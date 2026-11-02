# Java 架构师实战排障手册（STAR 叙事版 · 现货贸易语境）

> 原版是一份「命令速查 + 阈值表」的技术手册，读起来像字典、不好记。这一版改用 **STAR 叙事**：每类故障都从**交易员/客户的业务第一现场现象**讲起，讲清**发生了什么（S）→ 要解决什么（T）→ 我们怎么一步步排查处置（A）→ 最终定位到什么根因、怎么修好、结果如何（R）**。
>
> 技术命令不再是孤立的一堆，而是「排查行动」里自然要用到的工具。每个故事末尾保留一份**同场景速查卡**，应急时仍可单独照做。
>
> 所有现象都落在**现货贸易平台**的真实业务上：竞价专场、行情/挂牌、撮合引擎、报价确认、履约凭证下载、支付结算、仓单、授信风控。

## 关联文档

| 文档 | 定位 |
|---|---|
| **本篇** | 排障方法论 + 14 类故障的 STAR 案例：从交易员/客户现象出发，讲清每个故障怎么查、怎么判、怎么修 |
| `jvm_diag.sh` | 现场一键取证脚本（系统 + JVM + 线程 + 网络，打包 tar.gz） |
| `11-网关扩容打穿DB-性能开发规范.md` | 容量基线与高并发五层防线（DB 侧的「事前」半边） |
| `08/09/10-*-排查实录.md` | 真实故障复盘（多机房线路、竞价页面变慢、下载 PDF 致 JVM 进程消失） |

## 业务现象 → 故事速查

| 交易员/客户第一现场现象（现货贸易语境） | 去看哪个故事 | 故事里第一步动作 |
|---|---|---|
| 竞价专场开市后「报价确认没反应、页面卡死」，竞价服务单机 CPU 打满 | [故事一 CPU 飙高](#故事一-cpu-飙高) | `top -H -p PID` 定位到具体线程 |
| 客户批量下载履约凭证（合同 PDF / 仓单扫描件）后，合同服务半夜自动重启、内存只涨不落 | [故事二 内存泄漏与 OOM](#故事二-内存泄漏与-oom) | 先分清 OOM 关键字，再抓 dump |
| 行情/挂牌列表每隔几分钟就卡一下，很有规律 | [故事三 GC 问题](#故事三-gc-问题) | `jstat -gcutil` 看 `O` 列和 `FGC` |
| 报价提交大面积超时，但 CPU / 内存都正常 | [故事四 线程池与线程阻塞](#故事四-线程池与线程阻塞) | 抓两份 `jstack` 统计线程状态 |
| 支付/结算接口点完没反应（保证金与授信额度互相卡住） | [故事五 死锁](#故事五-死锁) | `jstack` 搜 deadlock |
| 挂牌列表越翻越慢、询价比价变慢 | [故事六 慢 SQL 与连接池](#故事六-慢-sql-与数据库连接池) | 慢查询日志 + `EXPLAIN` |
| 行情刷不动、挂牌列表变慢、缓存命中率掉 | [故事七 Redis](#故事七-redis) | `redis-cli --bigkeys` / `INFO memory` |
| 成交回报延迟、仓单/库存状态不同步、支付后状态没变 | [故事八 消息积压](#故事八-kafka--rocketmq-消息积压) | 查消费组 Lag |
| 华北/山东客户报价提交失败，部分区域 502/504 | [故事九 网关与网络](#故事九-网关-502504-与网络) | 网关 `error.log` + `ss -s` |
| 偶发出价慢，只有某些租户/标的才触发、白天不明显 | [故事十 Arthas 偶发问题](#故事十-arthas-偶发问题排查) | `tt -t` 录制一晚 |
| 行情解析/价格计算吃 CPU；或成交回报链路慢但 CPU 不高 | [故事十一 火焰图](#故事十一-火焰图定位热点) | `profiler.sh -e cpu/wall` |
| 磁盘告警、下游行情源挂了日志刷屏 | [故事十二 日志风暴与磁盘满](#故事十二-日志风暴与磁盘满) | `df -h; df -i` + `lsof` |
| 撮合/竞价进程活着、端口在听，但报价全超时 | [故事十三 服务假死](#故事十三-服务假死) | 本机直连 `/health` + 两份 `jstack` |
| 开市高峰期大面积不可用，需要立刻决策 | [故事十四 应急响应](#故事十四-应急响应与复盘) | 评估影响面 → 止血 → 保现场 |

---

## 故事一：CPU 飙高

### S 情境

某个竞价专场开市 15 分钟后，客服陆续接到交易员反馈：「**报价点下去没反应、页面一直转圈**」。监控同步告警：竞价服务某台机器的 CPU 冲到 100%，系统负载（Load）远高于核数。开市还在继续，出价窗口稍纵即逝，交易员急着下单，投诉量在涨。

### T 任务

1. 先恢复出价（止血），别让交易员一直卡着。
2. 定位到**是哪段代码**把 CPU 吃满，修复根因。

### A 行动

**第 1 步｜先确认「是这台机器、这个进程」的问题**

```bash
top -c                          # 记下吃 CPU 的进程 PID，例如 12345
```

看到就是竞价服务在吃 CPU，先记下 PID。如果发现**多台机器同时飙高**，要先怀疑宿主机资源不足或互相抢占，而不是单机代码问题。

**第 2 步｜钻进进程，找出是哪个线程在忙**

```bash
top -H -p 12345                 # -H 显示线程，假设最忙线程 TID = 12360，占 99%
```

**第 3 步｜把这个线程的现场栈抓出来看**

```bash
printf "%x\n" 12360             # 线程号转十六进制 → 3048（jstack 里是 hex）
jstack 12345 > /tmp/jstack.txt
grep -A 30 "nid=0x3048" /tmp/jstack.txt
```

抓到的栈长这样：

```text
"http-nio-8080-exec-23" ... nid=0x3048 runnable
   java.lang.Thread.State: RUNNABLE
        at java.util.regex.Pattern$Curly.match(Pattern.java:4227)
        at java.util.regex.Pattern$GroupHead.match(Pattern.java:4660)
        at com.demo.validator.PriceValidator.validate(PriceValidator.java:41)
        at com.demo.controller.QuoteController.submitQuote(QuoteController.java:88)
```

**第 4 步｜判读：栈顶暴露了元凶**

栈顶一直停在 `Pattern$Curly.match`，是典型的**正则回溯（catastrophic backtracking）**——某条报价参数触发了正则的最坏复杂度，CPU 被它烧穿。

> 更省事的一步到位：用 Arthas 直接看最忙线程。
> ```bash
> java -jar arthas-boot.jar
> thread -n 3                     # 展示最忙的 3 个线程及栈
> thread -n 3 -i 1000             # 每 1 秒刷新一次
> ```

### R 结果

定位到报价提交接口的**价格/委托参数校验正则存在灾难性回溯**，修复为**非回溯写法 + 输入长度限制**后，CPU 立即回落，出价恢复正常。事后把这个正则纳入代码评审检查项。

### 同场景速查卡

| 栈顶特征 | 根因 | 处置 |
|---|---|---|
| `Pattern$Curly/GroupHead.match` | 正则回溯，输入触发最坏复杂度 | 换非回溯写法，或加长度限制 / 超时 |
| `java.security.MessageDigest` | 大文件哈希、过多 MD5/SHA | 异步化、缓存结果 |
| `com.fasterxml.jackson` | 超大 JSON 序列化/反序列化 | 分页、流式解析 |
| `Base64.encode/decode` | 大附件 Base64 转换 | 限制大小、异步处理 |
| `GC task thread#` | 频繁 GC 导致的 CPU | 转 [故事三 GC 问题](#故事三-gc-问题) |
| 自己的业务方法 | 死循环 / 全表遍历 | 看代码 |

> **一个常见误判**：Load 高 ≠ CPU 高。如果 Load 高但 CPU 不高，多半是**大量线程在等 IO**，别一头扎进 JVM。用 `ps -eLo pid,tid,stat,wchan:20,comm | awk '$3 ~ /D/'` 找 D 状态线程，`iostat -x 1 3`、`vmstat 1 5` 看 `wa`（IO 等待）列。

---

## 故事二：内存泄漏与 OOM

### S 情境

运维发现合同服务**隔几天就会在深夜「自动重启」一次**，重启前内存曲线**持续爬升、Full GC 也压不回来**。最近一次日志里留下了这样一行：

```text
java.lang.OutOfMemoryError: Java heap space
```

回溯发现，每次重启前都有客户在**批量下载履约凭证（合同 PDF、仓单扫描件、质检报告）**。用户白天偶尔也会遇到下载失败，体验时好时坏。

### T 任务

1. 搞清楚是**哪种 OOM**（方向完全不同，先别急着抓 dump）。
2. 找到「谁在无限占用内存不释放」，修复后让内存曲线稳定回落。

### A 行动

**第 1 步｜先分清 OOM 类型**

日志里 `OutOfMemoryError` 后面跟的关键字，决定了整个排查方向：

| OOM 关键字 | 含义 | 主查方向 |
|---|---|---|
| `Java heap space` | 堆内存不足 | 大结果集 / 无界集合 / 缓存无上限 / 队列积压 |
| `GC overhead limit exceeded` | 堆快满且 GC 低效 | 同上，先看 GC 是否已空转 |
| `Metaspace`（JDK8+） | 元空间耗尽 | 动态类生成：CGLIB / 反射 / 热部署 |
| `Direct buffer memory` | 堆外直接内存耗尽 | NIO / `DirectByteBuffer` / Netty |
| `unable to create new native thread` | 线程数 / 栈空间耗尽 | 线程失控 → 转 [故事四](#故事四-线程池与线程阻塞) |
| `Requested array size exceeds VM limit` | 单次分配超大数组 | 回代码定位该次分配（全量查询 / 大文件读入） |

**第 2 步｜保现场，抓堆转储**

```bash
jmap -dump:live,format=b,file=/tmp/heap.hprof 12345
```

> 已配置 `-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/data/dump/` 的话，直接去指定目录找自动生成的 `.hprof`，不用手工抓。

**第 3 步｜快速看堆里到底是什么占着**

```bash
jstat -gcutil 12345 1000 5       # 重点看 O（老年代使用率）是否接近 100 且 Full GC 后不降
jmap -histo:live 12345 | head -30 # 对象实例统计（会 STW，线上慎用）
```

```text
 num     #instances         #bytes  class name
----------------------------------------------
   1:       8234512      263504384  [C              # char[]
   2:       4102334      196912032  java.lang.String
   3:       1023456       81876480  com.demo.dto.ListingDTO   # 挂牌/行情对象
```

`char[]`、`String` 和 `ListingDTO` 数量异常巨大 → 疑似**某处把挂牌列表对象全部缓存进内存没释放**。

**第 4 步｜用 MAT 定位「谁在持有它」**

用 MAT 打开 `heap.hprof`，按四步走：`Leak Suspects` 报告 → `Dominator Tree` 找到占用最大的对象 → 右键 `Path to GC Roots`（排除 weak/soft 引用）→ 找到「谁在持有它」，那通常就是泄漏点。

### R 结果

定位到一个**静态 `HashMap` 做的挂牌列表缓存没有上限**，每次查询都往里塞对象、从不淘汰，最终把堆塞满。修复为 `Caffeine` 缓存 + 淘汰策略后，内存曲线恢复平稳，服务不再半夜重启。

### 同场景速查卡：常见泄漏根因

| 场景 | 典型表现 | 修复 |
|---|---|---|
| 静态 Map 做缓存无上限 | HashMap 无限增长 | 换 Caffeine/Guava Cache + 淘汰策略 |
| ThreadLocal 未 remove | 线程池复用导致累积 | finally 里 remove() |
| 监听器/回调未注销 | Listener 列表越加越多 | 生命周期结束时反注册 |
| 数据库/网络连接未关闭 | 连接对象 + 缓冲区堆积 | try-with-resources |
| 自定义类加载器泄漏 | Metaspace OOM | 排查热部署、反射、动态代理 |
| 大对象短生命周期 | 频繁大数组分配 | 池化或流式处理 |

> **两个容易踩的坑**：
> - 进程**没有日志就消失**、Exit Code 137 → 不是 OOM 崩溃，是 **cgroup OOM Killer** 杀的，走 `10-下载PDF致JVM进程消失-排查实录.md`（`limits.memory = Xmx + 堆外预算`）。
> - 大 dump（>1GB）会让 MAT 自己 OOM，先用零依赖流式工具出**类直方图 → 数组长度指纹 → `char[]` 关键词取证**，再回代码找分配点。

---

## 故事三：GC 问题

### S 情境

交易员反馈**行情/挂牌列表「每隔几分钟就会卡一下」**，监控上接口响应时间（RT）出现有规律的毛刺，但 CPU 和内存数值看起来都「还行」，运维一时找不到头绪。开市时段交易员对行情实时性要求极高，这种周期性卡顿很伤体验。

### T 任务

判断这些周期性毛刺是不是 **Full GC 停顿**引起的，并找出「为什么 GC 这么频繁 / 停这么久」。

### A 行动

**第 1 步｜先看 GC 的真实频率和停顿**

```bash
jstat -gcutil 12345 1000 10      # 每 1 秒一次，共 10 次
```

```text
 S0     S1     E      O      M     CCS    YGC     YGCT    FGC    FGCT     GCT
 0.00  99.80  45.20  99.87  95.10  92.30  18234  412.33  1893  3891.22  4303.55
```

- `O = 99.87%` → 老年代几乎打满
- `FGC = 1893` 次、`FGCT = 3891s` → Full GC 累计停了 **64 分钟**，这就是毛刺的来源

**第 2 步｜看一次 Full GC 到底回收了多少**

GC 日志片段（JDK8 Parallel GC）：

```text
[Full GC (Ergonomics) [PSYoungGen: 512000K->0K(524288K)]
[ParOldGen: 1747324K->1746890K(1747456K)] 2259324K->1746890K(2271744K),
[Times: user=9.12 sys=0.03, real=2.34 secs]
```

关键信号：Full GC 后老年代**几乎没回收**（`1747324K->1746890K`），对象全部存活。

**第 3 步｜判断：是「创建太快」还是「泄漏」**

```
Q1: Full GC 后老年代是否下降？
 ├── 明显下降 → 只是"对象创建太快"，GC 来不及
 │              → 优化代码减少对象 / 增大堆 / 调新生代比例
 └── 几乎不降 → 内存泄漏 → 走 [故事二](#故事二-内存泄漏与-oom) 找 GC Roots 引用链
```

### R 结果

本例 Full GC 后老年代几乎不降，判定为**内存泄漏**而非 GC 参数问题，转 [故事二](#故事二-内存泄漏与-oom) 的 dump + MAT 流程定位泄漏源。修好后 `FGC` 不再增长，行情列表的周期毛刺消失。

### 同场景速查卡：GC 调参

```bash
-Xms8g -Xmx8g                            # 堆固定，避免动态扩容抖动
-Xmn3g                                   # 新生代大小
-XX:SurvivorRatio=8                      # Eden:Survivor = 8:1
-XX:MaxTenuringThreshold=15              # 对象晋升老年代年龄阈值
-XX:+UseG1GC -XX:MaxGCPauseMillis=200    # G1 目标停顿
-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/data/dump/
-Xlog:gc*:file=/data/logs/gc.log:time,uptime,level,tags   # JDK11+
```

> 排查提示：Young GC 太频繁 → Eden 太小 / 短命对象太多；单次 STW 过长 → 堆过大 / 收集器不当（大堆考虑 G1 / ZGC / Shenandoah）；GC 日志里出现固定周期的 `Full GC (System)` → 大概率有定时任务显式 `System.gc()`。

---

## 故事四：线程池与线程阻塞

### S 情境

交易员集中反馈「**报价提交、挂牌查询全都超时**」，但奇怪的是：监控里 CPU、内存**都很正常**。请求像是「进得去但出不来」，QPS 上不去，日志里开始出现 `RejectedExecutionException`。开市时段这种大面积超时直接导致交易机会错失。

### T 任务

在 CPU / 内存都「正常」的前提下，找出「请求堵在哪了」，恢复报价。

### A 行动

**第 1 步｜抓两份线程栈，先看线程都卡在什么状态**

```bash
jstack 12345 > /tmp/s1.txt; sleep 5; jstack 12345 > /tmp/s2.txt
jstack 12345 | grep "java.lang.Thread.State" | sort | uniq -c | sort -rn
```

```text
    156 java.lang.Thread.State: WAITING (parking)
     89 java.lang.Thread.State: TIMED_WAITING (parking)
     23 java.lang.Thread.State: RUNNABLE
     12 java.lang.Thread.State: BLOCKED (on object monitor)
```

大量 `WAITING (parking)` 说明线程在**等某个资源**。抽一个线程看栈：

```text
"http-nio-8080-exec-88" ... waiting on condition
   java.lang.Thread.State: WAITING (parking)
        at sun.misc.Unsafe.park(Native Method)
        at java.util.concurrent.locks.LockSupport.park(LockSupport.java:175)
        at com.zaxxer.hikari.pool.HikariPool.getConnection(HikariPool.java:190)
        at com.zaxxer.hikari.HikariDataSource.getConnection(HikariDataSource.java:128)
        at com.demo.dao.ListingDao.query(ListingDao.java:33)
```

**第 2 步｜判读：全堵在「获取数据库连接」**

线程集体卡在 HikariCP 的 `getConnection` → **连接池被占满**。下一步要分清是「慢 SQL 占着连接不放」还是「连接泄漏（借了没还）」，转到 [故事六](#故事六-慢-sql-与数据库连接池)。

**第 3 步｜顺手核对线程池参数「四必看」**

```java
executor.getCorePoolSize();         // 核心线程
executor.getMaximumPoolSize();      // 最大线程
executor.getActiveCount();          // 活跃线程
executor.getQueue().size();         // 队列积压   ← 单调上升就是打满
```

### R 结果

本例根因是**慢 SQL 占着连接不放**（详见故事六），连接池被打满后业务线程全部阻塞在等连接。修好慢 SQL 后连接释放，报价超时消失。

> **经典坑**：`Executors.newFixedThreadPool()` 底层是**无界队列**，`maxPoolSize` 永远用不上，队列无限堆积最终 OOM。生产必须手写 `ThreadPoolExecutor` + 有界队列 + 自定义拒绝策略。

### 同场景速查卡

| 观察 | 判读 |
|---|---|
| 大量 `BLOCKED` 等同一把锁 | 锁内做了慢操作（RPC / IO） |
| `WAITING` 在 `getTask` | 工作线程空闲，问题在上游 |
| 全 `RUNNABLE` 卡同一外部调用 | 外呼没配超时（典型全卡 `socketRead` 且没配 `connectTimeout`/`readTimeout`） |
| 线程数持续增长不回落 | 每请求新建线程 / 定时任务反复起线程 |

---

## 故事五：死锁

### S 情境

用户反馈**支付/结算接口「点完没反应」**，页面一直转圈但既不报错也不返回——比如下单后冻结保证金、同时扣减授信额度这两个动作卡住了。检查发现进程活着、资源都正常，但有一批线程永远卡住不推进。

### T 任务

快速判断这是不是**死锁**，并定位是哪两段代码互相卡住。

### A 行动

**第 1 步｜一步定位**

```bash
jstack 12345 | grep -A 30 "Found one Java-level deadlock"
```

```text
Found one Java-level deadlock:
=============================
"Thread-1":
  waiting to lock monitor ... (a java.lang.Object), which is held by "Thread-0"
"Thread-0":
  waiting to lock monitor ... (a java.lang.Object), which is held by "Thread-1"
...
"Thread-1":
        at com.demo.service.SettlementService.freezeMargin(SettlementService.java:55)
        - waiting to lock <0x...d6f8a1b0>
        - locked <0x...d6f8a2c0>
"Thread-0":
        at com.demo.service.CreditService.deductQuota(CreditService.java:33)
        - waiting to lock <0x...d6f8a2c0>
        - locked <0x...d6f8a1b0>
```

### R 结果

`freezeMargin`（冻结保证金）和 `deductQuota`（扣减授信额度）**加锁顺序相反** → 典型 **AB-BA 死锁**。修复：**统一加锁顺序**（或改用 `tryLock(timeout)`）。改完支付接口恢复响应。

> 如果 `jstack` 里**没有** deadlock 段落，就不是死锁，转 [故事四](#故事四-线程池与线程阻塞)（池耗尽 / 外呼无超时）。

### 同场景速查卡：DB 侧死锁

死锁也可能发生在数据库层（事务互相等锁，常见于保证金冻结 + 额度扣减这种跨表事务）。MySQL 看 `SHOW ENGINE INNODB STATUS\G` 的 `LATEST DETECTED DEADLOCK` 段落，配合 `performance_schema.data_lock_waits` 找阻塞源，必要时 `KILL <blocking_thread_id>`（先留证再 kill）。

---

## 故事六：慢 SQL 与数据库连接池

### S 情境

交易员反馈「**挂牌列表越翻越慢**」，翻到几百页之后要等十几秒，询价比价也跟着变慢；同时 [故事四](#故事四-线程池与线程阻塞) 里那些「全堵在获取连接」的线程，根子也指向这里——数据库连接被慢查询占着不放。

### T 任务

1. 找到「是哪条 SQL 慢、为什么慢」。
2. 分清是慢查询占连接、还是连接泄漏（借了没还）。

### A 行动

**第 1 步｜应用侧先看连接池水位**

```bash
curl -s localhost:8080/actuator/metrics/hikaricp.connections.active
curl -s localhost:8080/actuator/metrics/hikaricp.connections.pending   # 等待线程数
curl -s localhost:8080/actuator/metrics/hikaricp.connections.timeout
```

| 指标 | 含义 | 告警阈值 |
|---|---|---|
| `connections.active` | 活跃连接 | 持续 = maxPoolSize |
| `connections.pending` | 等待获取连接的线程 | **> 0 持续出现即异常** |
| `connections.timeout` | 获取超时次数 | **> 0 必须查** |

**第 2 步｜DB 侧看谁在跑**

```sql
SELECT id, user, host, db, command, time, state, info
FROM information_schema.PROCESSLIST
WHERE command != 'Sleep' AND time > 3
ORDER BY time DESC;
```

**第 3 步｜对慢 SQL 做 `EXPLAIN` 判读**

```sql
EXPLAIN SELECT * FROM listing WHERE supplier_id = 100 AND status = 'ON_SHELF' ORDER BY update_time DESC LIMIT 10;
```

```text
| type | key  | rows    | Extra                        |
| ALL  | NULL | 8234512 | Using where; Using filesort  |
```

`type=ALL`（全表扫描）+ `key=NULL`（没走索引）+ 扫描 800 多万行 → 就是它。

**第 4 步｜修复**

```sql
ALTER TABLE listing ADD INDEX idx_supplier_status_time(supplier_id, status, update_time);
```

深分页再顺手优化一下：

```sql
-- 反例：越翻越慢
SELECT * FROM listing ORDER BY id LIMIT 1000000, 20;
-- 游标法（记住上一页最大 id，最快）
SELECT * FROM listing WHERE id > 1000000 ORDER BY id LIMIT 20;
```

### R 结果

补上联合索引后，挂牌列表查询从秒级回到毫秒级；连接池不再被打满，[故事四](#故事四-线程池与线程阻塞) 里的大面积报价超时随之消失。

### 同场景速查卡：危险信号与连接泄漏

| 危险信号 | 含义 |
|---|---|
| `type = ALL` | 全表扫描 |
| `key = NULL` | 没走索引 |
| `rows` 很大 | 扫描行数过多 |
| `Using filesort` / `Using temporary` | 额外排序 / 临时表 |

> **判断连接泄漏**：`active` 长期接近上限且 `idle=0`，慢 SQL 又查无结果 → 大概率代码借了连接没关。临时方案：`spring.datasource.hikari.leak-detection-threshold=2000`（毫秒），HikariCP 会打印泄漏堆栈。

---

## 故事七：Redis

### S 情境

交易员反馈「**行情刷不动、挂牌列表和商品详情变慢**」，缓存命中率监控持续走低；Redis 监控显示某时刻开始内存接近打满、出现大量 key 被淘汰，偶尔还伴随连接被拒。

### T 任务

找出是**大 key / 热 key / 慢命令 / 内存不足**里的哪一种，恢复行情与挂牌的实时性。

### A 行动

```bash
redis-cli --bigkeys                 # 找大 key（生产勿用 KEYS *）
redis-cli MEMORY USAGE <key>        # 单 key 精确内存（4.0+）
redis-cli --hotkeys                 # 热 key（需 maxmemory-policy 为 LFU）
redis-cli SLOWLOG GET 10            # 慢查询
redis-cli INFO memory               # 内存 / 碎片率
redis-cli INFO stats                # evicted_keys
redis-cli INFO clients              # 连接数 / 阻塞客户端
redis-cli --intrinsic-latency 100   # 固有延迟（排除客户端因素）
```

判读要点：

- `SLOWLOG` 里出现 `KEYS *` → 这就是大坑命令，生产禁用它（阻塞整个实例，行情推送会整体卡住）。
- `mem_fragmentation_ratio > 1.5` → 内存碎片严重。
- `evicted_keys` 大量增长 → 内存不足，正在大量淘汰。

### R 结果

定位到某个热门品种的行情 key 被做成了超大 string（5MB）高频读写，加上定时任务里 `KEYS *` 拖垮了实例。清理大 key、改掉危险命令后，缓存命中率回升，行情与挂牌恢复流畅。

### 同场景速查卡：缓存三大问题

| 问题 | 现象 | 方案 |
|---|---|---|
| 穿透 | 查 DB 不存在的数据，绕过缓存 | 空值缓存 + 布隆过滤器 |
| 击穿 | 热点 key（如某热门品种行情）过期瞬间大量请求打到 DB | 互斥锁重建 / 逻辑过期永不失效 |
| 雪崩 | 大批 key 同时过期 | 过期时间加随机值 + 多级缓存 + 熔断降级 |

---

## 故事八：Kafka / RocketMQ 消息积压

### S 情境

交易员反馈「**成交回报延迟、下单后订单状态迟迟不更新**」，仓单/库存状态也不同步；客服接到一批「钱付了但状态没变」的投诉。业务侧怀疑是消息没消费掉。

### T 任务

确认是不是**消息积压**，找到「为什么消费跟不上」，恢复成交回报与状态的准实时性。

### A 行动

**第 1 步｜看消费 Lag**

```bash
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --all-groups --describe
```

```text
GROUP          TOPIC        PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG
trade-report   trade-msg        0        1523400         4523400      3000000
trade-report   trade-msg        1        1523400         1523500          100
```

分区 0 堆积 300 万、分区 1 几乎不堆积 → **分区倾斜**，某个消费者扛不住。

**第 2 步｜定位消费线程卡在哪**

```bash
jstack 12345 | grep -A 20 "kafka-coordinator-heartbeat-thread\|trade-report"
trace com.demo.mq.TradeReportConsumer onMessage -n 3 '#cost > 500'   # 看单条消费耗时
```

### R 结果

定位到**分区倾斜 + 消费逻辑里调了下游慢服务（仓单同步）**。调整分区策略、扩容消费者、对下游调用加缓存后，Lag 逐步回落，成交回报和订单状态恢复准实时更新。

### 同场景速查卡：积压根因

| 根因 | 判断依据 | 处置 |
|---|---|---|
| 消费逻辑太慢 | 单条消费耗时高、线程池小 | 提高并发线程数、批量消费 |
| 分区/队列倾斜 | 个别分区 Lag 高 | 调整分区策略、扩容消费者 |
| 消费异常重试 | 日志大量异常、重试队列膨胀 | 修复业务异常，死信单独处理 |
| 下游依赖慢 | 消费中调用的 DB/RPC 慢 | 异步化、加缓存 |
| 突增流量 | 生产速率远超消费速率 | 临时扩容消费者实例 |

---

## 故事九：网关 502/504 与网络

### S 情境

华北/山东客户报「**App 提示 502 / 504，报价提交失败、页面打不开**」，但客服发现**只是部分用户、部分地区**报错，华东客户一切正常。这种「区域性 / 实例性」报错，第一反应就该怀疑网络或某台后端实例。

### T 任务

分清是「网关问题」还是「后端某台机器问题」，定位具体环节。

### A 行动

**第 1 步｜看网关错误日志，分清 502 / 504**

```bash
tail -f /var/log/nginx/error.log
# upstream timed out (110: Connection timed out) while reading response header from upstream,
#   request: "POST /quote/submit", upstream: "http://10.0.1.20:8080/quote/submit"
```

**第 2 步｜验证那台 upstream 是否健康 + 网络连通**

```bash
curl -v http://10.0.1.20:8080/actuator/health
telnet 10.0.1.20 8080
nc -zv 10.0.1.20 8080
```

**第 3 步｜看 TCP 连接状态分布**

```bash
ss -antp | awk '{print $6}' | sort | uniq -c | sort -rn
ss -s
```

### R 结果

本例发现那台后端有**数万个 `CLOSE_WAIT` 连接不降**——应用侧借了连接没关（连接泄漏）。修复代码、给连接池配上 `maxLifetime` + 空闲剔除后，连接数回落，报价提交失败消失。

### 同场景速查卡：状态码与连接状态

| 状态码 | 含义 | 排查方向 |
|---|---|---|
| 502 | 网关收到后端非法响应 / 后端挂了 | 后端进程存活？端口监听？ |
| 504 | 网关超时（后端处理太慢） | 后端慢、连接池、GC 停顿 |
| 499 | 客户端主动断开 | 用户端超时、网关超时太短 |

| 连接状态 | 根因 |
|---|---|
| 大量 `CLOSE_WAIT` | 应用没关闭连接（连接泄漏） |
| 大量 `TIME_WAIT` | 主动关闭方，短连接频繁 |
| 大量 `SYN_RECV` | 可能有 SYN Flood 攻击 |

> **接口慢的分层定界**：`curl -o /dev/null -s -w "连接:%{time_connect} 首字节:%{time_starttransfer} 总:%{time_total}\n" <url>`——首字节慢是服务端慢；连接慢是网络/端口积压。分流去向：等 DB → 故事六；等下游 → 补超时；GC 停顿 → 故事三；线程池满 → 故事四。

---

## 故事十：Arthas 偶发问题排查

### S 情境

竞价出价接口「**偶发 4–5 秒**」，复现困难，**白天不明显、一到开市或夜里就冒出来**。交易员零星投诉「点报价要等几秒」，但每次人工复测都抓不到现场，非常头疼。

### T 任务

抓到一个「偶发慢调用」的**完整现场**（入参 + 返回值 + 耗时），定位共性根因。

### A 行动

Arthas 的 `tt`（时光隧道）就是为「偶发、难复现」设计的：它不像 `trace`/`watch` 只能盯当下，而是**录制历史调用、事后检索回放**。

**第 1 步｜挂 tt，只录慢调用，让它跑一整晚**

```bash
tt -t com.demo.service.QuoteService submitQuote '#cost > 3000'
```

**第 2 步｜次日检索**

```bash
tt -l
#  1000    02:13:11   4521.22
#  1001    03:41:52   5120.88
```

**第 3 步｜看现场，找共性**

```bash
tt -i 1000
#  PARAMETERS:
#     [0]=10086
#     [1]={"tenantId":9527,"itemSpec":[...],"couponId":"CPN999"}   ← 都带 couponId
```

**第 4 步｜用 trace 深挖这条链路**

```bash
trace com.demo.service.DiscountService calcDiscount -n 3
#  `---[3980.12ms] DiscountService:calcDiscount()
#       +---[3975.33ms] DiscountDao.queryTenantDiscount()   ← 慢 SQL！
```

### R 结果

所有慢报价都带 `couponId`（优惠券），最终定位到 `tenant_discount` 表**缺索引**，带优惠券的报价走全表扫描（修好见 [故事六](#故事六-慢-sql-与数据库连接池)）。修复后用 `tt -i 1000 -p` 回放验证，耗时从 4.5 秒降到几百毫秒。

> ⚠️ **安全警告**：`tt -p` 回放会**真实执行业务逻辑**（可能落库、发消息），生产回放必须极其谨慎，优先在预发/测试环境操作。

### 同场景速查卡：Arthas 高频指令

| 指令 | 用途 |
|---|---|
| `thread -n 3` / `thread -b` | 最忙线程 / 找阻塞元凶 |
| `trace 类 方法 '#cost > N'` | 方法调用耗时链路 |
| `watch 类 方法 '{params,returnObj}' -x 3` | 看方法真实入参/出参 |
| `tt -t 类 方法 '#cost > N'` | 录制（可事后检索回放） |
| `jad 类` / `getstatic 类 字段` | 反编译 / 读静态字段 |
| `ognl '@类@字段'` | 读/改运行时值（见下） |

> **ognl 读运行时配置**是排查「配置为何不生效」的王牌：`ognl '@com.demo.config.Constants@WHITE_LIST.contains("10.0.0.5")'` 直接看 JVM 里真实加载的值，避免「本地改了没发布」的困惑。⚠️ 但 `ognl` 改字段立即生效、重启即失效，属高危操作，需审批 + 记录。

---

## 故事十一：火焰图定位热点

### S 情境

一个行情/计算服务 CPU 持续 90%，但 `jstack` 抓了好几次，看到的都是「**一堆 RUNNABLE、栈五花八门**」，看不出统一热点。另一个场景反过来：成交回报接口 RT 3 秒、CPU 却只有 10%，用 CPU 指标根本解释不了慢在哪。

### T 任务

在一段时间内**统计**出真正的 CPU / 内存 / 锁 / 墙钟热点，而不是靠某一瞬间的快照瞎猜。

### A 行动

`jstack` 只是「某一瞬间」的快照，而**火焰图**是「一段时间内调用分布」的统计采样，能回答「80% 时间花在哪些方法上」。用 async-profiler（Arthas 已内置，不必单独装）：

```bash
./profiler.sh -e cpu   -d 30 -f /tmp/cpu.html   PID   # CPU 热点
./profiler.sh -e alloc -d 30 -f /tmp/alloc.html PID   # 内存分配热点
./profiler.sh -e lock  -d 30 -f /tmp/lock.html  PID   # 锁竞争
./profiler.sh -e wall -t -d 30 -f /tmp/wall.html PID  # 墙钟（含 IO 等待/睡眠）
```

**看图三原则**：① 直接找**最宽的顶层方块**（那就是热点）；② 从热点往下看调用链找业务入口；③ 窄而高的「塔尖」是偶发调用，通常忽略。

### R 结果

- **CPU 高场景**：火焰图显示 `BigDecimal.multiply` 占近 60% 采样，CPU 全耗在**价格的高精度浮点运算**（循环内大量 BigDecimal 计算）。改用 `long`（以「分」为单位）整数运算后 CPU 回落。
- **CPU 低但慢场景**：换成 `wall` 模式，显示慢在 `SocketInputStream.socketRead0`——是下游**行情源/第三方接口**响应慢。补超时 + 降级 + 缓存后恢复。

### 同场景速查卡

| 你想查什么 | 用哪个模式 |
|---|---|
| CPU 高 | `-e cpu` |
| 内存涨/OOM | `-e alloc` |
| 锁竞争 | `-e lock` |
| **慢但 CPU 不高** | **`-e wall -t`（cpu 模式看不到等待时间）** |

> 无 GUI 环境用 `-o flat` 直接打文本排行，一眼定位：`./profiler.sh -e cpu -d 30 -o flat -f /tmp/flat.txt PID`。

---

## 故事十二：日志风暴与磁盘满

### S 情境

凌晨收到磁盘告警：**磁盘使用率冲到 100%**，业务写入开始失败（日志、临时文件、DB 落盘一起挂）。查下来日志目录**每分钟 GB 级增长**，同一行异常在疯狂刷屏——追查发现是**下游行情源挂了，每个请求都打一遍全栈异常**。

### T 任务

先恢复磁盘空间（止血），再找「为什么日志会疯涨」，最后防复发。

### A 行动

```bash
# ① 找到满的挂载点（inode 也要看：海量小文件会先把 inode 用光）
df -h; df -i
# ② 逐层定位大目录
du -sh /* 2>/dev/null | sort -rh | head
# ③ 识别是否异常风暴
tail -1000 <log> | grep Exception | sort | uniq -c | sort -rn | head
# ④ 清盘后空间不释放
lsof | grep deleted
```

判读要点：

- 同一异常**每秒几十次全栈打印** → 异常风暴（典型：行情源挂了，每个请求都打一遍全栈）。
- `lsof | grep deleted` 有输出 → 文件已删但进程仍持句柄，空间不释放。**`echo "" > 大日志` 比 `rm` + 重启更稳妥**；不要 `rm` 正在被写的日志文件。

### R 结果

根因是**下游行情源故障导致每个请求都打全栈异常**。**异常限频 + 降级别 + 补重试退避**止血，再用 `logrotate` 按天轮转防复发，磁盘恢复正常。

### 同场景速查卡

| 根因 | 处置 |
|---|---|
| 异常风暴：同一异常高频全栈打印 | 异常聚合 / 限频；降级别；修下游根因 |
| 下游故障导致重试刷屏 | 补超时与退避，避免「超时→重试→更慢」放大日志 |
| 生产 debug 未关 | 发布基线固化日志级别；配置中心下发 |
| 轮转缺失 | `logrotate` 按天 + 保留份数 + 压缩 |
| 被删文件仍被进程占用 | `lsof \| grep deleted` → `truncate` / 重启 |

---

## 故事十三：服务假死

### S 情境

「**撮合/竞价进程还活着、端口也在监听，但报价请求全部超时**」。健康检查从 UP 变 DOWN，可进程就是不退出。这种「假死」比崩溃更隐蔽——因为所有表面指标看起来都「正常」，但交易员就是提交不了报价。

### T 任务

在「重启就会丢现场」的前提下，先抓齐证据，再判断是什么把报价卡死。

### A 行动

```bash
# ① 本机直连，绕开网关
curl -v --max-time 5 http://127.0.0.1:8080/actuator/health
# ② 抓栈看工作线程在干嘛
jstack <PID> > /tmp/s.txt
grep -A 15 "http-nio-.*exec" /tmp/s.txt | head -60
# ③ 排查 GC 死循环
jstat -gcutil <PID> 1000 10
# ④ 保现场再重启
jstack <PID> > /tmp/s1.txt; sleep 5; jstack <PID> > /tmp/s2.txt
```

| 观察 | 判读与去向 |
|---|---|
| 本机直连也 hang | 应用自身问题（继续往下查） |
| 本机正常、经网关超时 | 网关 / 网络 → [故事九](#故事九-网关-502504-与网络) |
| 全 `WAITING` 空闲但请求进不来 | 线程池 / accept 配置问题 |
| 全 `BLOCKED` | 锁死 → [故事五](#故事五-死锁) |
| 全卡 `socketRead` | 下游全慢（如行情源），线程池被拖死 → [故事四](#故事四-线程池与线程阻塞) |
| `O` 长期 100% + 每秒 FGC 且单次极长 | 堆陷入 GC 循环 → [故事二](#故事二-内存泄漏与-oom) |

### R 结果

最常见根因是**堆耗尽引发 GC 死循环**（接近 OOM 的假死形态），或**线程池全被无超时外呼占满**（如行情源无超时）。按对应故事定位泄漏、给所有外呼补超时 + 熔断后，假死不再复发。

### 同场景速查卡

| 根因 | 处置 |
|---|---|
| 堆耗尽引发 GC 死循环（最常见） | 按故事二定位泄漏；临时扩堆 / 重启止血 |
| 线程池全被无超时外呼占满 | 所有外呼补 `connectTimeout` / `readTimeout` + 熔断降级 |
| 全局锁死锁 | 统一加锁顺序 / 缩小临界区 |
| 单线程瓶颈阻塞入口 | 拆异步、加缓冲、批量处理 |
| 日志 / 磁盘 IO 卡住同步写 | 异步 appender + 磁盘告警 |

---

## 故事十四：应急响应与复盘

### S 情境

**开市高峰期**，线上大面积报错/不可用——交易员无法报价，涉及资金或数据一致性风险，老板和客户都在等，**却没人拍板要不要重启/切流/降级**。

### T 任务

**先恢复业务，再定位根因**——顺序不能反。

### A 行动（六步，先恢复再定位）

| 步 | 动作 | 要点 |
|:--:|---|---|
| ① | 评估影响面（1 分钟内） | 哪些接口、哪些客户/租户？有无资损/数据一致性风险？**数据类风险（重复扣款、半提交）优先保全数据**，不急着恢复 |
| ② | 快速止血 | 按成本从低到高：重启实例（无状态首选）→ 摘节点/切流 → 开降级开关 → 版本回滚；**留痕：谁、几点、做了什么** |
| ③ | 止血前保现场（2 分钟） | 两份 `jstack`、heap dump、`jstat`、日志尾部、`top`，落 `/tmp` 并拷出；宁可多花 2 分钟，也不重启后从零猜 |
| ④ | 观察恢复后状态 | 验证报价成功率、线程数、内存基线、连接数；快速反弹 = 周期性问题未根治 |
| ⑤ | 落工单记录时间线 | 时间线（发现/响应/止血/恢复）、现象、临时措施、根因与永久修复项 |
| ⑥ | 复盘与防复发 | 48 小时内出复盘：根因、为何没被提前发现（监控缺口）、永久修复项与负责人 |

### R 结果

止血后开市恢复，复盘补齐监控盲区和告警阈值（如开市前缓存预热、命中率告警、Canal 位点告警），同类故障的排查步骤沉淀回本手册对应故事，下次不再手忙脚乱。

### 止血成本排序

```
重启实例（无状态） → 摘节点 / 切流 → 开降级开关 → 版本回滚
```

> 能摘流就不要重启，能重启就不要改代码；一次只改一个变量；30 分钟定不了位就升级（拉 DBA / 中间件 / 网络）。

---

## 附录：口诀 / 红线 / 用法

### A.1 一页纸记忆口诀（现货贸易业务版）

```
竞价页面卡死     → 火焰图 cpu 找最宽方块（正则回溯最常见）
内存只涨不落     → dump + MAT + 火焰图 alloc（挂牌/合同缓存无上限）
行情周期性卡顿   → jstat 看 O 列 + alloc 找分配源
报价提交慢       → trace 找慢方法；CPU 低就用 wall
偶发出价慢       → tt 录制一晚，次日检索回放
配置疑云         → ognl 读运行时真实值
线程卡           → jstack 状态分布 + thread -b
保证金/额度互卡  → jstack grep deadlock，统一加锁顺序

安全底线：回放慎用、改字段要审批、dump 记得删
```

### A.2 三大安全红线

> 1. **`tt -p` 回放会真实执行业务逻辑** —— 写操作（下单/扣款/发消息）绝不在生产回放。
> 2. **`ognl` 改字段立即生效** —— 高危操作，需审批、需记录、需回滚预案。
> 3. **火焰图 / dump / monitor 都有成本** —— 采样别太久、dump 文件几个 G 记得清、`redis-cli monitor` 与 `jmap -histo:live` 会 STW / 降性能，生产慎用。

### A.3 四种用法

1. **故障当场**：先按 [故事十四](#故事十四-应急响应与复盘) 的六步定流程 → 用顶部「业务现象速查表」选故事 → 照故事里的行动走，命令细节就在「行动」步骤里。
2. **日常巡检**：`jvm_diag.sh` 平时存一份基线，告警时再采一份做差。
3. **复盘沉淀**：工单按故事十四第 ⑤ 步记录；同类故障的排查步骤回写对应故事，不另起新文档。
4. **面试口径**：方法论讲「先恢复再定位」的六步，案例讲这十几个业务现象驱动的故事；命令是「行动」里的工具，不是孤立知识点。

---

*本手册持续更新。命令只是定位手段，根因分析仍需结合业务代码与变更记录；讲清每个故障的「交易员/客户现象 → 目标 → 行动 → 结果」，比背一堆命令更经得起实战。*
