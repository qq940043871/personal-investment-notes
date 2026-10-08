# 下载 PDF 导致 JVM 进程突然消失 — 排查实录

> **文档定位**：典型故障排查实录（基于真实架构的代表性场景），回答"'进程跑着跑着突然没了、日志里什么都没有'这类问题怎么排查"。核心方法：**先定性质（谁杀的），再定根因（为什么被杀）**。讲排障方法论 + 治乱能力。

---

## 1. 问题描述

### 1.1 背景链路（排查的地图）

```
浏览器（合同中心，批量勾选 120 份履约凭证 PDF）
   │ HTTPS（打包 ZIP 下载）
   ▼
midservice 网关 ──→ 合同服务（Java 微服务，K8s 部署，2 副本）
                        │ getObject(key)   ┌────────────────┐
                        ▼                  │ MinIO 对象存储 │
                   byte[] 全量读入堆 ←──────│ 合同 PDF /     │
                        │                  │ 仓单扫描件 /   │
                        ▼                  │ 质检报告等     │
                   ZipOutputStream 打包 ──→└────────────────┘
                        │
                        ▼
                   响应输出流返回浏览器
```

- 履约凭证（合同 PDF、仓单扫描件、质检报告、发票影像）统一存 **MinIO**；
- 单份 PDF 30~80MB（含扫描影像页）；客户习惯批量勾选打包下载。

### 1.2 故障现象

| 维度 | 描述 |
|------|------|
| **故障表现** | 客户批量下载履约凭证 PDF（勾选 120 份打包 ZIP），下载到一半连接断开、页面 502 |
| **进程状态** | "合同服务"进程消失：`ps` 查不到 PID、监控 Agent 掉线、K8s restartCount +1 后自动拉起 |
| **日志特征** | 应用日志最后一行是正常请求日志，**无任何异常堆栈**；GC 日志 Full GC 频繁 |
| **影响范围** | 单个合同服务实例（2 副本挂 1 个），下载中的所有任务中断 |
| **复现率** | 预发环境按同参数压测**必现**（这是定位闭环的关键一步） |

### 1.3 关键差异条件

| 对比维度 | 单份下载（<80MB） | 批量打包下载（120 份 ≈ 5GB） |
|----------|:---------------:|:--------------------------:|
| 服务存活 | ✅ 正常 | ❌ 进程消失 |
| GC 日志 | 正常 | Full GC 频繁后进程消失 |
| 响应 | 正常返回 | 下载中断 / 502 |

### 1.4 已排除的假设

| 假设 | 根因方向 | 排除依据 |
|------|---------|---------|
| JVM 自身崩溃（JIT bug / JNI / VM 内部错误） | JVM | 工作目录**无 `hs_err_pid*.log`**，JVM 崩溃必留此文件 |
| Java OutOfMemoryError | 应用内存 | Java OOM 会抛异常并写堆栈、进程不一定退出；本案日志无异常、退出码也不是 1 |
| 人为 kill / 发布重启 | 运维 | 无发布记录，时间点与下载动作强相关 |
| 宿主机整机 OOM / 宕机 | 硬件 | 同宿主机其他容器正常 |
| liveness 探针杀（假死被驱逐） | K8s | 探针杀是 SIGTERM→143 且有探针失败事件日志；本案退出码 137 |
| 依赖（DB/MQ）拖垮 | 依赖 | 本下载链路不查库不发消息，慢查询监控正常 |

---

## 2. 排查过程：先定性质，再定根因

> "进程消失"类问题的排查铁律：**不要先看应用代码，先回答"进程是怎么没的"**。判定树三问：①退出码是什么？②有 hs_err 吗？③内核日志说什么？

### 2.1 第一问：进程是怎么没的？— 看退出码

```bash
kubectl describe pod contract-service-xxx
# Last State: Terminated   Reason: Error   Exit Code: 137
```

**Exit Code 137 = 128 + 9（SIGKILL）**——被强杀，且 SIGKILL **不可捕获**，JVM 没有任何机会写日志、刷缓冲。这直接解释了"日志里什么都没有"：**"日志干净 + 进程消失"本身就是 SIGKILL 的典型指纹**，不是线索缺失。

退出码判定速查：

| 退出码 | 信号 | 含义 | 下一步 |
|:---:|:---:|------|--------|
| 137 | SIGKILL(9) | 强杀：OOM Killer / `kill -9` | 查 dmesg / 审计（本案） |
| 143 | SIGTERM(15) | 优雅停机：发布 / 探针驱逐 | 查发布记录、探针事件 |
| 134 | SIGABRT(6) | JVM abort：致命错误 | 找 `hs_err_pid*.log` |
| 139 | SIGSEGV(11) | 段错误：JNI / VM bug | 找 `hs_err_pid*.log` |
| 1 | — | Java 未捕获异常退出 | 看应用日志堆栈 |

### 2.2 第二问：JVM 自己崩了吗？— 找 hs_err

```bash
ls /app/logs/hs_err_pid*.log    # 无结果
```

无 `hs_err_pid` 文件 → 排除 JIT 编译崩溃、JNI 段错误、GC 算法 bug 等 JVM 内部错误。（若有：hs_err 头部会写 `# SIGSEGV/# Out of Memory Error`、出问题的线程、寄存器与栈——按图索骥即可。）

### 2.3 第三问：谁发的 SIGKILL？— 内核日志

```bash
dmesg -T | grep -iE "out of memory|killed process"
journalctl -k --since "10:00" | grep -i oom
```

实测命中：

```
Memory cgroup out of memory: Killed process 21453 (java) total-vm:12.3G,
anon-rss:5.9G, shmem-rss:0G, UID:1000 pgtables:23M oom_score_adj:0
```

**结论：cgroup OOM Killer**（容器内存超限被内核强杀），不是整机 OOM（`System OOM` 才是）。

### 2.4 内存去向分析 — 为什么会超限

| 项 | 配置/实测 | 说明 |
|----|----------|------|
| JVM 堆 | `-Xmx4g` | 应用自以为只用 4G |
| 容器内存上限 | `limits.memory = 6Gi` | **进程 RSS 超过这条线就被杀** |
| 故障时 RSS | **6.1Gi**（峰值） | 堆 4G + 堆外 > 上限 |
| 堆外组成 | 线程 230 × 1MB 栈 + NIO direct + ZIP 压缩缓冲 + JVM 自身 ≈ 2G | 被忽略的部分 |
| GC 日志 | 老年代驻留多个 30~80MB 大 byte[] | 大对象入堆的直接证据 |

**关键认知**：`-Xmx` 只是堆上限，**进程真实占用 = 堆 + 堆外（线程栈/direct/CodeCache/元空间）**。容器 limit 不给堆外留预算，堆外一涨就被 cgroup 掐死——Java 层毫无感知。

### 2.5 代码定位 — 是谁把内存吃成这样

```java
// 合同下载接口（问题实现）：把整个 PDF 读进堆
byte[] data = minioService.getObjectBytes(key);   // 30~80MB 一次性入堆
response.getOutputStream().write(data);

// 批量打包：多份字节同时驻留堆内
ZipOutputStream zip = new ZipOutputStream(response.getOutputStream());
for (String key : keys) {                          // 120 份循环
    byte[] pdf = minioService.getObjectBytes(key); // 每份都全量入堆
    zip.write(pdf);
}
```

故障机理：批量打包时**堆内同时驻留多份 PDF 字节 + ZIP 压缩缓冲**，并发 8 个打包下载任务 → 瞬时堆需求远超 4G → Full GC 抖动 + 堆外持续增长 → **RSS 冲破 6Gi 容器上限 → cgroup OOM Killer 发 SIGKILL → 进程消失**。

### 2.6 闭环：预发复现

按同参数压测（120 份 × 并发 8）：3 分钟后复现 Exit Code 137 + 相同 dmesg 记录——**能复现、能解释、修复后能验证**，排障闭环完成。

---

## 3. 根本原因总结

### 3.1 直接根因

> **批量下载接口把 MinIO 中的 PDF 全量读入 JVM 堆（byte[]）再打包输出，大批量并发时堆内大对象与堆外内存（线程栈/direct/压缩缓冲）总和超过容器 6Gi 内存上限，被 cgroup OOM Killer 发送 SIGKILL 强杀，进程无任何日志地消失（Exit Code 137）。**

### 3.2 深层根因

1. **大文件 IO 设计违规**：文件字节流经 JVM 堆中转，把对象存储变成了"内存缓冲区"——违背 MinIO 作为对象存储的定位；
2. **运行时容量错配**：`-Xmx4g` 与容器 limit 6Gi 之间只留 2G 给堆外，且无人对"堆外 + limit"做容量评审；
3. **观测盲区**：没有 RSS/堆外/cgroup OOM 事件监控，`memory.events` 里的 oom_kill 计数无人看——进程"失踪"才发现问题。

### 3.3 根因因果链

```
客户批量下载 120 份大 PDF（业务正常操作）
  → 下载实现全量读入堆 + ZIP 打包多份字节驻留（设计缺陷）
    → 并发 8 路打包，堆内大对象 + 堆外内存同时膨胀
      → 进程 RSS 突破容器 6Gi 内存上限
        → cgroup OOM Killer 发 SIGKILL（不可捕获）
          → 进程无日志消失、Exit Code 137、下载中断 502
```

---

## 4. 处置经过与改进措施

### 4.1 应急处置（当天）

| 序号 | 措施 | 说明 |
|:---:|------|------|
| S-1 | K8s 自动拉起 + 人工确认恢复 | 2 副本架构保住了可用性，另一副本顶住 |
| S-2 | 批量下载上限临时调至 20 份，页面提示分批 | 削减单请求内存需求 |
| S-3 | 大批量下载入口临时切异步任务排队 | 避开内存尖峰 |

### 4.2 中期技术改进（1-2 周）

| 序号 | 措施 | 优先级 | 说明 |
|:---:|------|:-----:|------|
| M-1 | **MinIO 预签名 URL 直连下载** | **P0** | Java 只签发 presigned URL（过期时间 + 权限审计），浏览器直连 MinIO 下载，**文件字节完全不过 JVM**——最契合架构的方案 |
| M-2 | **剩余场景流式化**：`try (InputStream in = minio.getObject(...)) { IOUtils.copy(in, response.getOutputStream()); }`，固定 8KB 缓冲；ZIP 打包逐文件流式写、写完即释放 | **P0** | 堆占用与文件大小解耦 |
| M-3 | 大批量打包走**异步导出**：XXL-Job/异步任务生成 ZIP 存 MinIO，完成后通知下载 | P1 | 批量场景彻底脱离在线请求 |
| M-4 | **运行时容量匹配**：`limits.memory = Xmx + 堆外预算(线程栈+direct+CodeCache+余量)`，本案配 `-Xmx4g` → limit 7Gi；`-XX:MaxDirectMemorySize` 限死 direct | P1 | 容器与 JVM 一起评审，不允许只配一个 |
| M-5 | 下载并发信号量限流（如全局 4 路） | P1 | 控制瞬时内存尖峰 |

### 4.3 长期预防（流程与规范）

| 序号 | 措施 | 层面 | 说明 |
|:---:|------|------|------|
| L-1 | **大文件 IO 设计规范**：文件类接口一律流式/预签名直连，禁止 `byte[]` 全量入堆；纳入 Code Review 红线 | 设计规范 | 根治类问题 |
| L-2 | 容量评审模板补"堆外内存 + 容器 limit"项；压测用例必须含大文件/批量场景 | 流程 | 本案场景压测可提前暴露 |
| L-3 | 观测补齐：RSS / 堆外 / direct buffer / cgroup `memory.events` oom_kill 计数告警、GC 日志常开 | 可观测 | "进程失踪"提前预警 |
| L-4 | JVM 参数基线化：NativeMemoryTracking（`-XX:NativeMemoryTracking=summary`）纳入排障标准动作 | 运维 | 排查堆外问题的标配 |

### 4.4 改进优先级路线图

```
当天               1 周内                2 周内               持续
┌──────────┐   ┌────────────────┐   ┌───────────────┐   ┌──────────┐
│ 限批量    │ → │ M-1 预签名直连 │ → │ M-3 异步导出  │ → │ L-1~L-4  │
│ 重启拉起  │   │ M-2 流式改造   │   │ M-4 容量匹配  │   │ 规范/评审 │
└──────────┘   └────────────────┘   └───────────────┘   └──────────┘
```

---

## 5. 附录

### 5.1 "进程消失"判定树（通用）

```
进程没了（日志干净）
  ├─ 看退出码
  │   ├─ 137 (SIGKILL) ─→ dmesg/journalctl 查 OOM
  │   │     ├─ "Memory cgroup out of memory" → cgroup OOM（容器超限）★本案
  │   │     └─ "Out of memory: Kill process"  → 整机 OOM（宿主机内存）
  │   ├─ 143 (SIGTERM) ─→ 发布/探针驱逐：查发布记录、K8s events
  │   ├─ 134/139        ─→ JVM 崩溃：找 hs_err_pid*.log
  │   └─ 1              ─→ Java 异常：看应用日志堆栈
  └─ 有 hs_err_pid*.log？─→ 有：按文件头部信号/线程/栈分析
```

### 5.2 常用命令速查

| 目的 | 命令 |
|------|------|
| 容器退出码/重启原因 | `kubectl describe pod <pod>`、`kubectl get pod --sort-by=.status.containerStatuses[0].restartCount` |
| 内核 OOM 记录 | `dmesg -T \| grep -iE "out of memory\|killed process"`、`journalctl -k` |
| cgroup OOM 计数 | `cat /sys/fs/cgroup/memory.events`（看 `oom_kill`） |
| JVM 内存分布 | `jmap -histo:live <pid> \| head -30`、`jstat -gcutil <pid> 1000` |
| 堆外内存（NMT） | `jcmd <pid> VM.native_memory summary`（需 `-XX:NativeMemoryTracking=summary`） |
| 线程栈/线程数 | `jstack <pid>`、`ls /proc/<pid>/task \| wc -l` |
| hs_err 判读 | 文件头部 `#` 注释行：信号类型、出错线程、Problematic frame、堆信息 |

### 5.3 三种 OOM 的区分（面试高频）

| 类型 | 触发者 | 现象 | 证据 |
|------|--------|------|------|
| Java OOM | JVM | 抛 `OutOfMemoryError`，日志有堆栈，进程可能不死 | 应用日志 + heap dump |
| cgroup OOM | 容器内核 | 进程直接消失、退出码 137、日志干净 | dmesg `Memory cgroup out of memory`（本案） |
| 整机 OOM | 宿主机内核 | 同宿主机多个进程被杀 | dmesg `Out of memory: Kill process` |

### 5.4 面试速答（90 秒版）

> "客户批量下载 120 份履约凭证 PDF，下到一半 Java 进程没了——`ps` 查不到、日志里没有任何异常。这类问题我先**定性质**再定根因：看退出码是 137，也就是 SIGKILL 强杀，SIGKILL 不可捕获，所以'日志干净'本身就是指纹；工作目录没有 `hs_err_pid` 文件，排除 JVM 自身崩溃；`dmesg` 里命中'Memory cgroup out of memory: Killed process (java)'，是**容器内存超限被 cgroup OOM Killer 杀掉**。再分析内存去向：`-Xmx4g` 但容器上限 6Gi，RSS 峰值 6.1G——堆外的线程栈、direct buffer、ZIP 缓冲把剩下的 2G 吃穿了。代码层面找到元凶：下载接口把 MinIO 的 PDF **全量读进堆**再打包，批量下载时多份字节同时驻留，压测复现了同样的 137。根治两条：一是 MinIO **预签名 URL 直连下载**，文件字节完全不过 JVM；二是剩余场景流式改造，逐文件流式写 ZIP 写完即释放。再把'堆 + 堆外 = 容器 limit'纳入容量评审、补上 RSS 和 oom_kill 计数告警。"

**追问预案**：

| 追问 | 回答要点 |
|------|---------|
| 为什么日志里什么异常都没有？ | SIGKILL 不可捕获，JVM 没机会写日志/刷缓冲；"日志干净 + 进程消失 + 退出码 137"就是 OOM Killer 的典型指纹 |
| Java OOM 和这个有什么区别？ | Java OOM 是 JVM 抛异常（有堆栈、进程未必死）；cgroup OOM 是内核直接杀进程（退出码 137、无异常日志） |
| Xmx 到底该怎么配？ | `容器 limit = Xmx + 堆外预算（线程栈+direct+CodeCache+元空间+余量）`；只配 Xmx 不配 limit 会拖垮节点，只配 limit 不配 Xmx 会被误杀 |
| 为什么选预签名 URL 而不是流式下载？ | 两者都做：预签名直连让字节完全不过 JVM，是最优解；但内网审批类场景需要走服务端鉴权/水印，那就流式。不是二选一，是按场景分工 |
| 预签名 URL 有什么安全考虑？ | 过期时间短（如 5 分钟）、按用户授权签发、MinIO 侧开访问日志审计、敏感凭证加水印走服务端流式 |

---

> **文档变更记录**
> | 版本 | 日期 | 变更内容 | 作者 |
> |------|------|---------|------|
> | v1.0 | 2026-10-07 | 初稿：判定树（退出码→hs_err→内核日志）+ 全量入堆致 cgroup OOM 案例实录 | 技术团队 |
