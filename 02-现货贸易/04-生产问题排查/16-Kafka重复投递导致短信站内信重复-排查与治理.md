# Kafka 投递超时触发重复投递 — 短信/站内信重复发送（排查与治理实录）

> **文档定位**：典型故障排查实录（消息中间件 × 通知类副作用）。回答"Kafka 明明是 at-least-once，为什么用户会收到两条一模一样的短信、两条一模一样的站内信；超时到底是没发出去还是发出去了都不知道"。
> 核心结论先行：**这不是"Kafka 不可靠"，而是"把 at-least-once 的语义直接接到了不可撤销的外部副作用上，且没有幂等层"。**
>
> **配套阅读**：`14-Java架构师实战排障手册.md`（通用排障顺序）；`12-Tomcat接口超时排查速查表.md`（超时口径与线程栈取证的同类手法）。
>
> **与 `03-架构决策/一致性与异构/12-跨系统调用一致性方案.md` 的分工**：那篇是**出口派发侧的正向设计**（本地事务 + 待发送表 + 幂等键 + 阶梯重试，回答"怎么设计才重复"）；本文是**消费侧故障形态与排查取证**（回答"已经在重复了，现象长什么样、证据在哪、怎么止血"）。两篇共用"业务幂等键"这一地基，不重复维护。

---

## 1. 现象：同一条通知，用户收到两遍

### 1.1 故障表现

| 维度 | 描述 |
|------|------|
| **用户体验** | 订单成交后收到 2 条同内容短信（间隔几秒到几分钟），站内信列表里出现 2–3 条完全相同的记录；未读红点数字翻倍 |
| **触发条件** | 集中出现在**流量高峰 / 消费者重启 / 发布窗口 / 某个下游变慢**的时段，低峰期几乎不复现 |
| **时间分布** | 重复的两次发送间隔 ≈ `request.timeout.ms` 或 `max.poll.interval.ms` 量级（非随机，这是重要线索） |
| **数据表现** | `notify_record` 表里同一 `biz_id + receiver + channel` 有多行；有的行 `status=FAILED` 但用户其实收到了 |
| **维权成本** | 短信按条计费，重复 1 万条就是真金白银；站内信重复影响信任度；营销短信重复可能被投诉、被运营商限速 |

### 1.2 一句话定性

> **"超时"只说明"没等到应答"，不说明"没送达"。**
>
> 链路上一共有 3 个地方会"超时后就重来"：Kafka Producer 重试、业务方补偿任务重投、Consumer 位点重放。三者叠加在"发送短信"这种**不可撤销的外部副作用**上，而下游没有幂等 → 一份事件，发出 N 条通知。

```
                         ┌──────────────── 一次事件放大的三条路径 ────────────────┐
                         │                                                        │
 业务事件 ──▶ Producer ──┼─▶[① broker 已落盘，但 ACK 在网络上丢了 → 客户端重试]──▶│
                         │                                                        │
 待发消息表 ─▶ 补偿任务 ──┼─▶[② 标记成功前进程挂了 / 标记失败 → 定时任务再投一次]──▶│ 同一分区
                         │                                                        │  出现 2 条
 Consumer 处理 ─▶ 提交位点 ┼─▶[③ 处理成功但提交 offset 前 rebalance → 位点回退重放]─▶│  同内容消息
                         │                                                        │
                         └───────────────────────┬────────────────────────────────┘
                                                 ▼
                                     无幂等 → 短信发 2 条、站内信插 2 行
```

### 1.3 危害分级

| 级别 | 表现 | 后果 |
|:---:|------|------|
| **L1 体验** | 重复推送/重复站内信 | 用户以为系统有 bug，客服工单上涨 |
| **L2 资损** | 短信按条计费 | 高峰期重复率 0.5% × 日 200 万条 = 每天白烧 1 万条 |
| **L3 合规（严重）** | 营销短信重复 → 用户投诉 → 运营商通道限速/封禁 | 整条短信通道不可用，验证码也发不出去，**影响登录** |
| **L4 数据** | `notify_record` 出现重复行，下游统计/对账口径失真 | "已通知人数"虚高，运营决策错 |

---

## 2. 先分清：Kafka 到底承诺了什么

这一节决定后面所有方案，不能跳。

### 2.1 投递语义对照

| 语义 | 怎么做到 | 后果 | 本项目定位 |
|------|----------|------|-----------|
| **at-most-once** | 先提交 offset 再处理（或 `enable.auto.commit=true` + 异步处理） | 可能丢消息 | 通知场景**不可接受**（漏发比重复更严重） |
| **at-least-once** | 处理完再提交 offset + Producer `retries>0` | **必然可能重复** | 默认选择，**必须配幂等** |
| **exactly-once** | 事务 + `read_committed` + 事务性输出 | 只覆盖 Kafka→Kafka / Kafka→事务型存储，**覆盖不了短信网关和 HTTP** | 不适用于外呼类通知 |

> **关键认知**：Kafka 的 exactly-once 只保证"Kafka 内部读-处理-写"这一段不重不丢。
> 短信网关是**外部系统**，它不在事务里。所以"端到端 exactly-once"是个伪命题，
> 通知类业务的正确解法永远是：**at-least-once + 消费端幂等 + 副作用去重**。

### 2.2 生产者/消费者各自的重复来源

| 位置 | 配置/行为 | 是否产生重复 | 说明 |
|------|-----------|:---:|------|
| Producer | `enable.idempotence=true`（3.0+ 默认） | 大幅降低 | 保证**单会话内**单分区不重复，重启后 PID 变化即失效 |
| Producer | `acks=all` + `retries=MAX` + 幂等开启 | 安全 | 幂等 + 有序，是推荐基线 |
| Producer | 手动 `catch (TimeoutException) { producer.send(msg); }` | **必重复** | 最常见的人为重复：超时后自己再发一次，绕过了幂等保护 |
| Producer | `delivery.timeout.ms < linger.ms + request.timeout.ms` | 启动报错 / 频繁超时 | 参数关系被配反，导致"还没重试就被判失败" |
| Consumer | `enable.auto.commit=true` | **会重复**（rebalance 时批量回退） | 自动提交是时间驱动，与处理进度无关 |
| Consumer | 处理耗时 > `max.poll.interval.ms` | **必重复** | 被踢出组 → 分区重分配 → 从上次提交位点重放 |
| Consumer | 异步线程池发通知，主线程立即提交 | **会丢**（更危险） | 提交成功但线程池里任务没跑完 |

---

## 3. 三个"超时"的语义陷阱（根因常在这里）

所有重复故障的复盘，最终都能落到下面三句话之一。

### 3.1 陷阱一：把"调用超时"当成"调用失败"

```
业务代码（错误示范）
─────────────────────────────────────────────
try {
    smsClient.send(phone, content);     // readTimeout = 3s
} catch (SocketTimeoutException e) {
    smsClient.send(phone, content);     // ← 网关其实 5s 才返回，第一次已经发出去了
}
```

| 事实 | 说明 |
|------|------|
| 短信网关是**异步受理**的 | 你拿到 `Timeout` 时，报文早已进网关队列，短信已下发 |
| 网关**不一定支持按业务流水号去重** | 很多第三方网关的 `msgId` 是每次请求新生成的，天然无法去重 |
| 所以重试 = 必然重复 | 除非网关明确支持"相同 `outTradeNo` 幂等"，否则**发送类接口绝不能在超时后自动重试** |

**正确做法**：`send` 超时时不要重发，而是**置为 `UNKNOWN` 状态，走"查询接口确认"**（多数网关提供按流水号查询），查不到再补发；查不到且查不通就人工/延迟补偿，且补偿**必须带同一 `outTradeNo`**。

### 3.2 陷阱二：Producer "投递超时" = 不知道成功还是失败

| 场景 | broker 实际状态 | 客户端看到 | 客户端动作 | 结果 |
|------|-----------------|-----------|-----------|------|
| ACK 在网络上丢了 | **已写入** | `TimeoutException` | 自动重试 | 幂等开启 → 不重复；幂等关闭 → **重复** |
| 请求真的没到 | 未写入 | `TimeoutException` | 自动重试 | 正常 |
| `delivery.timeout.ms` 到期 | 可能在途 | `TimeoutException`（重试耗尽） | 业务层 catch 后自行重发 | **大概率重复** |

> 记住一句话：**`TimeoutException` 是"结果未知"，不是"失败"。** 对它只能做幂等重发，不能做"先落失败再补偿"。

### 3.3 陷阱三：rebalance 让 offset 回退

```
T0  分区 P3 分配给 消费者A，处理到 offset=1000，已提交 950
T1  处理 offset=951 时调了 3 次短信网关（每次 3s 超时），单条耗时 15000ms...
T2  一批 500 条 → 处理耗时 400s > max.poll.interval.ms(300s)
T3  GroupCoordinator 判定 A 死亡 → rebalance → P3 给 消费者B
T4  B 从 committed offset=950 开始消费 → 951~1000 全部重放
T5  A 恢复后也还在处理 951~1000（它并不知道自己已被踢）
    ⇒ 951~1000 同一时刻被两个消费者处理 → 双发
```

这段链路解释了两个现象：
- 为什么重复在高峰期集中出现（下游变慢 → 处理超时 → 被踢）；
- 为什么间隔恰好是分钟级（等于 `max.poll.interval.ms`）。

---

## 4. 止血 → 定位 → 根治 → 预防

### 4.1 止血（5 分钟内）

| 动作 | 命令/操作 | 目的 |
|------|-----------|------|
| 关掉短信外呼开关 | 配置中心 `notify.sms.enabled=false`（保留站内信） | 立刻停止资损与投诉风险，站内信可后续去重 |
| 降消费并发 / 暂停消费 | `kafka-consumer-groups.sh --bootstrap-server b:9092 --group notify-group --topic notify-event --reset-offsets --to-current --execute`（先停消费再 reset 到 latest） | 切断重复源头 |
| 查看是否在反复 rebalance | `kafka-consumer-groups.sh --describe` 反复看到 `Rebalance` / 成员不断变化 | 确认是"处理超时被踢"型 |
| 查重复量级 | `SELECT biz_id, receiver, channel, COUNT(*) c FROM notify_record GROUP BY 1,2,3 HAVING c>1 ORDER BY c DESC LIMIT 50;` | 判断影响面，决定是否对外解释 |

> 止血原则：**"通知"是可降级的业务。宁可延迟发，也不要重复发。** 先关掉，再治。

### 4.2 定位（看这 5 个地方）

| # | 看什么 | 关键字 / 命令 | 指向 |
|:--:|--------|--------------|------|
| 1 | 消费组是否频繁 rebalance | 消费者日志 `Rebalance` / `Attempt to heartbeat failed` / `member was removed` | 处理耗时超 `max.poll.interval.ms` |
| 2 | 单条消费耗时 | 埋点 `consume.cost` P99 | 是否 > 单批预算 |
| 3 | 是否有 `TimeoutException` 后业务重发 | `grep -n "TimeoutException"` + 其后 `send` 调用 | 陷阱一/二 |
| 4 | `notify_record` 的 `status` 分布 | `FAILED` 但用户收到 = 超时误判 | 陷阱一 |
| 5 | 生产者是否开启幂等 | `kafka-configs` / 代码里 `enable.idempotence` 值 | 是否只是基础配置缺失 |

### 4.3 根治（四层防线）

#### 第一层：消费端强制幂等（必须做的，也是最有效的一层）

**幂等键设计**——先决定"什么算同一条通知"：

| 键方案 | 组成 | 优点 | 缺点 |
|--------|------|------|------|
| 事件级 | `eventId`（生产者生成的 UUID） | 最简单，重放同一事件必命中 | 生产者若重发时**重新生成 eventId** 就失效 |
| 业务级（推荐） | `bizType + bizId + receiverId + channel + templateCode` | 与消息链路解耦，任何路径重复都能拦 | 需要业务键稳定、不可含时间戳 |
| 内容级 | `md5(content) + receiverId + 5min窗口` | 兜底 | 有误杀风险（同内容两次合法通知） |

> **推荐组合**：业务级键做主键，`eventId` 做辅助日志字段。业务级键天然覆盖"Producer 重试"和"补偿重投"两条路径。

**Redis 抢占 + DB 唯一索引双保险**（生产可用形态）：

```lua
-- KEYS[1] = notify:idem:{bizType}:{bizId}:{receiverId}:{channel}
-- ARGV[1] = 状态(SENDING)，ARGV[2] = TTL(秒)
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', ARGV[2]) then
    return 1          -- 抢到，可以发
end
local cur = redis.call('GET', KEYS[1])
if cur == 'SENDING' then
    return 2          -- 别人正在发，跳过
end
return 0              -- 已发过，跳过
```

```sql
-- 兜底：数据库唯一索引，Redis 挂了/被清也拦得住
ALTER TABLE notify_record
  ADD UNIQUE KEY uk_biz_channel (biz_type, biz_id, receiver_id, channel);
```

**关键坑**（这几点写错就等于没做）：

| 坑 | 错误写法 | 正确写法 |
|----|----------|----------|
| 先发后记 | 发完短信再 `SETNX` | **先抢占**再发，失败释放或用短 TTL 兜底 |
| 状态不落库 | 只在 Redis 打标记 | `SENDING` → `SUCCESS/FAILED` 落 DB，Redis 只是性能前置 |
| 失败即释放导致重试重复 | 发送超时就 `DEL` key | 置 `UNKNOWN`，**不释放**，靠查询接口对账 |
| 幂等键含时间戳 | `...:{System.currentTimeMillis()}` | 业务键必须**稳定且可重算** |

#### 第二层：发送台账 + CAS 状态机（解决"超时未知"）

```
INIT ──CAS──▶ SENDING ──成功──▶ SUCCESS
  │              │
  │              ├──网关超时──▶ UNKNOWN ──查询确认──▶ SUCCESS / 回到 INIT
  │              └──明确失败──▶ FAILED ──(有额度)──▶ INIT
  └──重试超限──────────────────────────────────────▶ DEAD（人工介入，告警）
```

```sql
-- 只有抢到状态迁移权的那一次才允许真正调用网关
UPDATE notify_record
   SET status = 'SENDING', gmt_modified = NOW()
 WHERE id = ? AND status IN ('INIT', 'FAILED') AND retry_count < 3;
-- affectedRows == 1 才 send()，否则说明别的线程/实例已经在处理
```

> 这一层解决的是**并发双发**：Kafka 重放时两个消费者同时处理同一条消息，Redis 抢占可能因网络分区各有各的判断，但 DB 的 `affectedRows` 只能有 1。

#### 第三层：Kafka 侧参数对齐（别自己造重复）

```properties
# ---------- Producer：不重复的基线 ----------
enable.idempotence=true
acks=all
retries=2147483647
max.in.flight.requests.per.connection=5
linger.ms=5
request.timeout.ms=30000
delivery.timeout.ms=120000          # 必须 >= linger.ms + request.timeout.ms
# 若跨会话也要不重：使用事务 + 固定 transactional.id（同一 id 重启会 abort 未完成事务）
```

```java
// 错误：超时后自己重发，绕过一切保护
catch (TimeoutException e) { producer.send(record); }

// 正确：交给客户端重试；只关心"重试耗尽"这一终态，且该终态本身是"未知"
producer.send(record, (meta, ex) -> {
    if (ex == null) return;
    // 记录"投递结果未知"，由补偿任务按幂等键重投，绝不在此处直接改业务状态
    mapper.markUnknown(record.key(), ex.getMessage());
});
```

```properties
# ---------- Consumer：处理超时预算 ----------
enable.auto.commit=false
max.poll.records=50                  # 关键：单批条数决定单批耗时
max.poll.interval.ms=600000          # 与"单批最坏耗时"对齐，不要用默认 300s 硬扛
fetch.min.bytes=1
```

**超时预算金字塔**（从上到下必须严格递减，任一环反了就会出现"处理中被踢"）：

```
max.poll.interval.ms (600s)          ← 最外层：消费者被判定死亡的时间
  └─ 单批最坏处理耗时 (≤ 300s)        ← max.poll.records × 单条最坏耗时
      └─ 单条消息处理预算 (≤ 6s)
          └─ 网关调用超时 (3s) + 重试 1 次 (3s)   ← 最内层：HTTP 超时必须最小
```

#### 第四层：渠道侧去重 + 降级

| 手段 | 说明 |
|------|------|
| 短信网关幂等 | 提交时带**固定业务流水号**（`outTradeNo`），确认网关是否支持相同流水号幂等；支持就用它做最后一道闸 |
| 站内信直接 DB 唯一索引 | 站内信是自建库，唯一索引即可，成本最低、最可靠 |
| 通知合并 | 同一 `receiver + 模板` 在 30s 窗口内合并为一条（"您有 3 笔订单成交"），从产品层面消灭重复观感 |
| 分级降级 | 高峰期关闭非核心通知（营销类），只保留验证码/成交通知，降低放大面 |

### 4.4 预防（让它不再复发）

| 措施 | 落地形式 |
|------|----------|
| **代码规约** | Code Review 检查项：凡是 `catch (TimeoutException)` 后调用 `send` 的，一律驳回；发送类接口禁止自动重试 |
| **幂等自测用例** | 单测/集成测试：同一消息投递 3 次，断言网关只被调用 1 次、`notify_record` 只有 1 行 |
| **重复率监控** | 分钟级窗口统计 `count(receiver+template) > 1` 的占比，> 0.1% 告警；这是最直接的业务指标 |
| **rebalance 监控** | 消费组 `rebalance` 次数突增即告警（比看 CPU 更早发现问题） |
| **消费耗时 P99 看板** | `consume.cost` P99 接近 `单批预算/条数` 时预警 |
| **故障演练** | 手工 kill 消费者 / 注入 3s 延迟，验证不产生重复 |

---

## 5. 5Why 根因链（复盘可直接套用）

| 层级 | 追问 | 答案 |
|:---:|------|------|
| Why1 | 为什么用户收到两条短信？ | 同一条通知事件被发送了两次 |
| Why2 | 为什么事件被处理了两次？ | 消费者处理超时被踢出组，分区重分配后从旧位点重放 |
| Why3 | 为什么会处理超时？ | 单批 500 条 × 单条 3s 网关超时 > `max.poll.interval.ms` |
| Why4 | 为什么单条要 3s？ | 短信网关在高峰期变慢，触发了 `readTimeout=3s`，且代码在超时后重试了一次 |
| Why5 | **为什么重试会造成重复？** | **发送链路全程没有幂等键**：Producer 幂等未开、消费端无去重、DB 无唯一索引、网关流水号每次新生成 |
| 根因 | — | **把 at-least-once 的语义直接接到了不可撤销的外部副作用上**。重复不是 Kafka 的缺陷，是架构上缺了"幂等层"这一环。 |

---

## 6. 验收清单（上线前逐条打勾）

- [ ] 幂等键为**业务级**且不含时间戳/随机数
- [ ] Redis 抢占在**发送之前**，且 `SENDING` 状态有 TTL 兜底
- [ ] `notify_record` 有 `uk_biz_channel` 唯一索引
- [ ] DB CAS 更新 `affectedRows==1` 才调用网关
- [ ] 网关超时**不重试**，置 `UNKNOWN` 并走查询确认
- [ ] Producer `enable.idempotence=true`、`acks=all`、`retries=MAX`
- [ ] `delivery.timeout.ms >= linger.ms + request.timeout.ms`
- [ ] Consumer `enable.auto.commit=false`，处理完再提交
- [ ] `max.poll.records × 单条最坏耗时 < max.poll.interval.ms × 0.5`
- [ ] 存在 DLQ，重试链路有上限（不死循环）
- [ ] 重复率与 rebalance 次数有监控告警
- [ ] 有"关闭短信"的一键开关

---

## 7. 一句话总结（面试/答辩口径）

> Kafka 是 at-least-once，"可能重复"是它的**契约**而不是 bug。把通知类副作用直接挂在消费端上，
> 重复就只是时间问题。正确姿势是四层：**Producer 幂等与参数对齐 → 消费端业务级幂等键抢占 →
> DB 状态机 CAS 兜底 → 渠道侧流水号去重**，并接受"短信网关超时 ≠ 未送达"这一事实——
> 超时后只能查询确认，绝不能重发。
