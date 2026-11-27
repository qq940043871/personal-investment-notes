# 进程"凭空消失"且应用日志干净 — 内核 SIGKILL / OOM 完整排查步骤

> **文档定位**：本篇是"进程消失"问题 **SIGKILL（退出码 137）这一分支的权威口径**——适用于"进程没了、应用日志停在最后一行正常业务日志、没有任何异常堆栈"的场景。核心结论：**90% 是内核 OOM Killer 干的，唯一有效入口是内核日志（dmesg / journalctl -k / cgroup 计数），不是应用日志、不是代码**。
>
> **两条独立叙事**：本仓库「下载 PDF → 进程消失」拆为 **A · 被杀**（本篇：下载/导出链路、137、cgroup OOM）与 **B · 自崩**（生成/转换链路、134/139、native 崩溃，见 10 号）。二者证据链与修复方向不同，**面试同场只用一条**。本篇第 9 节给出叙事 A 的完整实例与 A/B 区分表。
>
> **边界**：
> - 退出码 **134 / 139 且有 `hs_err_pid*.log`** → JVM 自身崩溃（native / JNI），走 [`10-下载PDF致JVM进程消失-排查实录.md`](./10-下载PDF致JVM进程消失-排查实录.md)；
> - Java 层 **`OutOfMemoryError` 有堆栈**、进程未必退出 → 走 [`14-Java架构师实战排障手册.md`](./14-Java架构师实战排障手册.md) 故事二；
> - 本篇只处理 **"进程是怎么没的"（定性质）**，根因定位仍回到 14 号手册的六步 SOP。

---

## 0. 一页判定树

```
进程消失、应用日志干净（最后一行是正常业务日志）
  │
  ├─ ① 先拿退出码 / 终止原因（这是定性质的第一把钥匙）
  │    ├─ 137 (SIGKILL) ─→ 被强杀，信号捕不到，所以日志干净 ★本篇主线
  │    │     ├─ dmesg: "Out of memory: Killed process"        → 整机 / 容器 OOM Killer
  │    │     ├─ dmesg/cgroup: "Memory cgroup out of memory"   → cgroup OOM（容器超 limit）
  │    │     ├─ K8s: Reason=Evicted "node was low on resource" → kubelet 驱逐
  │    │     ├─ systemd: MemoryMax / OOMPolicy                 → systemd 杀
  │    │     └─ 以上皆无 → 审计 kill -9（history / auditd / 发布脚本 / cron）
  │    ├─ 139 (SIGSEGV) / 134 (SIGABRT) ─→ native 崩溃，找 hs_err → 10 号实录
  │    ├─ 143 (SIGTERM) ─→ 发布 / 探针驱逐 / 优雅停机超时后补刀
  │    └─ 1 ─→ Java 未捕获异常，去看应用日志堆栈
  │
  └─ ② 拿不到退出码？退而求其次：内核日志 + cgroup 计数 + 时间对齐（见第 2 节）
```

> **铁律**：SIGKILL（9）**不可捕获、不可忽略、不可注册 handler**，进程被杀的瞬间没有任何用户态执行机会，所以**"日志干净"本身就是 SIGKILL 的特征，而不是"程序没出错"**。不要因为日志干净就去翻业务代码。

---

## 1. 第一步：定性质 — 退出码 / 终止原因

| 退出码 | 信号 | 含义 | 下一步 |
|:---:|:---:|------|--------|
| **137** | SIGKILL(9) | 被强杀：OOM Killer / `kill -9` / 驱逐 | **查 dmesg + cgroup 计数（本篇）** |
| 139 | SIGSEGV(11) | 段错误：JNI / native 库踩内存 | 找 `hs_err_pid*.log`（10 号实录） |
| 134 | SIGABRT(6) | 进程 abort / native 断言失败 | 找 `hs_err_pid*.log`（10 号实录） |
| 143 | SIGTERM(15) | 优雅停机：发布 / 探针驱逐 | 查发布记录、K8s events |
| 1 | — | Java 未捕获异常退出 | 看应用日志堆栈 |

取值入口按部署形态：

```bash
# 容器 / K8s：Last State 就是上一轮的死亡档案
kubectl describe pod <pod> | sed -n '/Last State/,/Ready/p'
#   Last State: Terminated  Reason: OOMKilled  Exit Code: 137
kubectl get events --sort-by=.lastTimestamp | grep -iE "oom|evict|kill"

# systemd 托管
systemctl status <svc>          # 看 "Main PID ... status=9/KILL"
journalctl -u <svc> --since "-2h" | tail -50

# 裸进程 / 无托管：靠内核日志倒推（退出码可能已丢）
```

> 注意区分 `Reason`：`OOMKilled` 是 cgroup OOM；`Evicted` 且 message 为 `The node was low on resource: memory` 是 **kubelet 驱逐**（同宿主机争抢，不是本容器超 limit），处置方向完全不同。

---

## 2. 第二步：唯一有效入口 — 内核日志

`dmesg` 是内核的"黑匣子"，进程被 SIGKILL 的唯一证据链在这里（应用日志里永远不会有）。

```bash
# ① 实时内核环形缓冲区（-T 转人类可读时间）
dmesg -T | grep -iE "killed process|out of memory|oom|segfault"

# ② 只看最近 30 分钟、按时间对齐故障窗口
dmesg -T --since "-30 min" | grep -iE "oom|killed process"

# ③ journalctl 的内核通道（等价、可追溯历史）
journalctl -k --since "-2h" | grep -iE "killed process|out of memory|oom"

# ④ dmesg 被冲掉后的持久化日志
grep -i "killed process" /var/log/messages      # CentOS / RHEL
grep -i "killed process" /var/log/syslog        # Ubuntu / Debian（新版可能只有 journald）

# ⑤ cgroup 计数（OOM 事件是否真实发生，最硬的证据）
cat /sys/fs/cgroup/memory.events                # cgroup v2：oom / oom_kill 计数
cat /sys/fs/cgroup/memory/memory.failcnt        # cgroup v1：分配失败次数
cat /sys/fs/cgroup/memory/memory.oom_control    # cgroup v1：oom_kill 累计
```

**日志特征 → 死因对照**

| 日志特征（原文关键词） | 死因 | 关键字段怎么读 |
|---|---|---|
| `Out of memory: Killed process 1234 (java) total-vm:12345678kB, anon-rss:9876543kB, file-rss:...` | **整机 / 内存 OOM Killer** | `anon-rss` 才是进程真实吃掉的物理内存（匿名页）；`total-vm` 是虚拟地址空间，通常远大于物理内存，**不要拿它判断"吃了多少内存"** |
| `Memory cgroup out of memory: Killed process ...` + `memory.events: oom_kill 1` | **cgroup OOM**（容器/`MemoryMax` 超限） | 容器场景最常见，对应 K8s `reason: OOMKilled`、退出码 137 |
| `python3[9021]: segfault at 0 ip 00007f... error 4` | **段错误（不是 OOM）** | 退出码通常是 139；`error 4` 表示用户态读非法地址；开 core dump 用 gdb 看栈 |
| 无任何 OOM / segfault，但有 `journalctl -u` 的 stopping 记录 | **外部信号 / 管理工具** | systemd 超时、重启策略、`MemoryMax`、有人在 `kill -9` |
| 以上全部为空 | **审计方向** | `history`、`auditd`（`ausearch -sc kill`）、发布平台记录、cron / 巡检脚本 |

> **坑**：`dmesg -T` 的时间是内核按本地时钟推算的，机器挂起/休眠后会偏；与 `journalctl` 的 UTC 时间对齐时注意时区换算，否则会错判"故障窗口内没有 OOM 记录"。

---

## 3. 第三步：按特征定位三类死因

### 3.1 原因一：内存耗尽（OOM Killer）—— 最常见

物理内存 + Swap 耗尽后，内核挑一个"最该牺牲"的进程杀掉以保系统，选择依据是 `oom_score`（约等于按内存占用加权，可用 `oom_score_adj` 调整）。

- **判据**：`Out of memory: Killed process <pid> (<name>) ... anon-rss:<大值>`；
- **关键指标**：`anon-rss` 极大 → 就是它吃光了内存；`total-vm` 不用太在意；
- **常见诱因**（现货/B2B 语境）：
  - 批量导出 / 批量下载把文件全量读进堆（PDF、仓单扫描件、Excel 报表）；
  - 无界队列：`Executors.newFixedThreadPool()` 的队列无上限，任务堆积吃光堆；
  - 大结果集一次 `select` 进内存（缺分页 / 缺流式）；
  - 缓存无上限（本地 Caffeine/Map 未设 `maximumSize`）；
  - DB / 中间件自身 Buffer Pool、连接数配得过大，把宿主机内存吃穿（同宿混部时尤其明显）。

### 3.2 原因二：程序自身崩溃（段错误 / Segfault）

程序 bug（空指针、越界、JNI 踩内存）触发硬件异常，内核终止进程。

- **判据**：`<proc>[pid]: segfault at <addr> ip <addr> error 4`，退出码 139；
- **排查**：开 core dump 后用 gdb 看崩溃栈

```bash
ulimit -c unlimited                              # 当前 shell 生效
cat /proc/sys/kernel/core_pattern                # 确认 core 落到哪（容器里常被改成管道，需核对）
gdb /path/to/bin /path/to/core.<pid> -ex bt -ex quit
```

- Java 进程若有 `hs_err_pid*.log`，转 [`10-下载PDF致JVM进程消失-排查实录.md`](./10-下载PDF致JVM进程消失-排查实录.md)。

### 3.3 原因三：被外部信号或管理工具终止

- **systemd 托管**：`journalctl -u <svc>` 看是否因启动超时、`Restart=` 策略、`MemoryMax=`/`MemoryHigh=` 被杀；`systemctl show <svc> -p MemoryMax -p OOMPolicy` 核对限制值；
- **K8s**：`kubectl describe pod` 的 `Last State`、`kubectl get events` 的 `Evicted`、探针失败事件；
- **人为 / 脚本**：`history | grep -i kill`、`ausearch -sc kill -ts recent`、发布平台与 cron 的变更记录；
- **特征**：内核日志里没有 OOM / segfault，只有"进程被 signal 9 结束"这类软记录，或干脆什么都没有（要审计补证）。

---

## 4. 第四步：OOM 的进阶排查与预防

### 4.1 先分清"泄漏"还是"尖峰"

```bash
grep -E "MemTotal|MemAvailable|SwapTotal|SwapFree" /proc/meminfo   # 当前水位（MemAvailable 才是可用）
free -h
# 历史曲线：容器看 working_set（含 page cache 的活跃部分）
kubectl top pod <pod> --containers
# Prometheus: container_memory_working_set_bytes{container="..."}  vs  limit
```

| 曲线形态 | 结论 | 处置方向 |
|---|---|---|
| 锯齿上升、每次 Full GC 后不回落，最终被 OOM | **内存泄漏** | dump + MAT 支配树找 GC Roots 引用链（14 号手册故事二） |
| 长期平稳，某个时间点垂直拉起 | **突发尖峰**（大文件 / 大批量 / 并发翻倍） | 限流 + 流式化 + 异步化，而不是加堆 |
| 一直贴着 limit 高位运行 | **配置错误**：limit 恰好等于 Xmx，堆外无预算 | `limit = Xmx + 堆外预算`（元空间 + 线程栈 + direct + 压缩缓冲） |

### 4.2 保护关键进程：`oom_score_adj`

每个进程有 `/proc/<pid>/oom_score_adj`（范围 **-1000 ~ 1000**，值越小越不容易被杀）：

```bash
cat /proc/<pid>/oom_score_adj
echo -500 > /proc/<pid>/oom_score_adj     # 需要权限；-1000 = 永不被选中
```

- 数据库等核心进程可设较低值，但 **`-1000` 有风险**：它占满内存后内核不会杀它，可能整机卡死/OOM 到别的进程或触发 panic，比"杀一个进程"更糟；
- 普通业务进程可适当调高（如 500），让内存紧张时优先牺牲它；
- 容器里 `oom_score_adj` 由 kubelet 按 QoS 自动设置（Guaranteed ≈ -997），手工改可能被覆盖。

### 4.3 配置资源上限（防一个进程拖垮整机）

```ini
# systemd：/etc/systemd/system/<svc>.service.d/limit.conf
[Service]
MemoryHigh=6G        # 软限：超过后内核开始回收/限速，给缓冲
MemoryMax=7G         # 硬限：超过直接 cgroup OOM（比整机 OOM 好，爆炸半径可控）
OOMPolicy=stop
```

- K8s：`resources.limits.memory` 即 cgroup 硬限，务必满足 **`limit ≥ Xmx + 堆外预算`**；
- 前提：**Swap 要关或受限**（`swapoff -a` / `kubelet --fail-swap-on`），否则"内存不够"先变"磁盘抖动"，表现成整体假死而不是干脆被杀，排查更难。

### 4.4 补上"能被发现"的能力（否则下次还是靠猜）

| 缺口 | 补法 |
|---|---|
| OOM 事发无人知 | cgroup `memory.events.oom_kill` 增长告警；K8s `reason=OOMKilled` 重启次数告警 |
| 内存曲线无历史 | `container_memory_working_set_bytes / limit` 水位大盘（85% 黄色、95% 红色） |
| 现场被重启销毁 | 抓 dump 前置动作写进预案（`-XX:+HeapDumpOnOutOfMemoryError`、`-XX:ErrorFile`） |
| 反复复发 | 复盘写进 checklist 红线（大文件流式化、队列必须有界、导出必须异步） |

---

## 5. 判定口径对照（避免误判，面试常考）

| 类型 | 触发者 | 现象 | 决定性证据 | 退出码 |
|---|---|---|---|---|
| **cgroup OOM（容器超限）** | 容器内核 | 进程消失、日志干净、Pod 重启 | dmesg `Memory cgroup out of memory`、`memory.events: oom_kill`、K8s `reason=OOMKilled` | **137** |
| **整机 OOM Killer** | 内核 | 进程消失、同宿其他进程可能也被杀 | dmesg `Out of memory: Killed process ... anon-rss:` | **137** |
| kubelet 驱逐 | kubelet | Pod 被驱逐，节点内存压力 | Pod `reason=Evicted`，`node was low on resource: memory` | 137（容器侧） |
| 人为 `kill -9` / 脚本 | 人 / 平台 | 时间点与操作、发布强相关 | auditd、history、发布记录 | 137 |
| Java `OutOfMemoryError` | JVM | 有异常堆栈，进程可能还活着 | 应用日志堆栈 + heap dump | 1（若退出） |
| native 崩溃 | JVM / native 库 | 日志干净但有 `hs_err_pid*.log` | hs_err 头部信号 + `Problematic frame` | **134 / 139** |
| 优雅停机 | 发布 / 探针 | 有 shutting down 日志 | 发布记录、K8s events | 143 |

> 一句话区分：**"日志干净 + 137 + dmesg 有 OOM" = 被杀；"日志干净 + 134/139 + hs_err" = 自己崩；"日志有堆栈" = Java 层问题。**

---

## 6. 命令速查卡

| 目的 | 命令 |
|---|---|
| 拿退出码 / 终止原因 | `kubectl describe pod <pod>`、`systemctl status <svc>`、`journalctl -u <svc>` |
| 进程被谁杀的（内核） | `dmesg -T \| grep -iE "killed process\|out of memory\|oom\|segfault"` |
| 历史内核日志 | `journalctl -k --since "-2h"`、`/var/log/messages`、`/var/log/syslog` |
| cgroup OOM 计数 | `cat /sys/fs/cgroup/memory.events`（v2）、`.../memory/memory.oom_control`（v1） |
| 当前内存水位 | `cat /proc/meminfo \| grep -E "MemAvailable\|SwapFree"`、`free -h` |
| 容器内存 | `kubectl top pod --containers`、`container_memory_working_set_bytes` |
| OOM 优先级 | `cat /proc/<pid>/oom_score_adj`（-1000 最不容易被杀） |
| 资源上限 | `systemctl show <svc> -p MemoryMax -p MemoryHigh -p OOMPolicy` |
| 段错误取证 | `ulimit -c unlimited` + `/proc/sys/kernel/core_pattern` + `gdb -ex bt` |
| 审计 kill | `ausearch -sc kill -ts recent`、`history \| grep -i kill` |
| 一键取证 | [`jvm_diag.sh`](./jvm_diag.sh)（系统 + JVM + 线程 + 网络打包） |

---

## 7. 现场 30 分钟收口 checklist

1. **0–3 min｜留证**：抓 `dmesg -T`、`journalctl -k`、`kubectl describe pod`、`systemctl show` 输出，别急着重启（重启会销毁 Last State）。
2. **3–10 min｜定性质**：退出码是否为 137；dmesg 是否命中 OOM 关键词；`memory.events` 的 `oom_kill` 是否增长。
3. **10–20 min｜定爆炸半径**：只挂 1 个实例还是同宿多个；是整机 OOM（多进程受害）还是 cgroup OOM（单容器超限）。
4. **20–30 min｜定形态**：看内存曲线是"泄漏爬坡"还是"尖峰冲顶"，决定加堆还是限流 + 流式化。
5. **当天｜止血**：降并发（信号量）、关掉批量入口、转异步；必要时临时上调 limit（并同步上调 Xmx 或留足堆外预算）。
6. **1 周内｜治本**：`limit = Xmx + 堆外预算` 纳入评审；大文件流式化 / 预签名 URL 直连；队列有界 + 拒绝策略；OOM 事件与内存水位告警上线。
7. **复盘｜固化**：写清"证据链 → 根因 → 防再发"，能写进 checklist 红线的就不靠人的记忆。

---

## 8. 面试速答（90 秒）

> "进程突然没了、应用日志里干干净净，我先判断它不是'崩'而是'被杀'——因为 **SIGKILL 不可捕获**，进程连写一行日志的机会都没有，日志干净本身就是信号。
>
> 第一步拿退出码：容器看 `kubectl describe pod` 的 Last State，**137 = SIGKILL**，和 134/139（native 崩溃、有 `hs_err`）、143（发布/探针驱逐）是三条完全不同的分支。
>
> 第二步直接进内核日志，这是唯一入口：`dmesg -T | grep -iE "killed process|oom"`。命中 `Out of memory: Killed process ... anon-rss:` 就是 OOM Killer，看 `anon-rss` 就知道是谁吃光了内存；容器场景再对一下 `/sys/fs/cgroup/memory.events` 的 `oom_kill` 计数和 Pod 的 `OOMKilled` 原因，确认是 cgroup 超限还是整机争抢，这两者处置方向不一样。
>
> 根因上再分两种形态：内存曲线锯齿爬坡、Full GC 后不回落的是**泄漏**，走 dump + MAT 找引用链；长期平稳但某个点垂直冲顶的是**尖峰**，多半是批量导出把文件全量读进堆，治本是流式化 / 预签名 URL 直连 / 导出异步化，再加并发信号量。
>
> 防再发三件事：`limit = Xmx + 堆外预算` 一起评审；cgroup `oom_kill` 与容器内存水位做告警；把'大文件不许全量进堆、队列必须有界'写进开发规范红线。"

**追问预案**

| 追问 | 回答要点 |
|---|---|
| 为什么应用日志什么都没有？ | SIGKILL 是内核强杀，用户态无执行机会，handler 也注册不上；证据只在 dmesg / cgroup |
| `total-vm` 很大是不是就是它吃光了内存？ | 不是。看 `anon-rss`（真实物理内存占用），虚拟内存大是 JVM 预留地址空间的正常现象 |
| 怎么区分 cgroup OOM 和整机 OOM？ | cgroup OOM 有 `Memory cgroup out of memory` + `memory.events: oom_kill`，只死一个容器；整机 OOM 是 `Out of memory: Killed process`，同宿可能多个进程一起死 |
| 设 `oom_score_adj=-1000` 保护数据库行不行？ | 能防止被杀，但它占满内存后会把系统拖到卡死或 OOM panic，比杀一个进程更糟；应配合 `MemoryMax` 与容量预算 |
| 加了 `-Xmx` 为什么还会 OOM？ | 堆外没算：元空间、线程栈、direct buffer、压缩/加密缓冲、native 库。`limit` 必须覆盖 Xmx + 堆外预算 |
| 137 一定是 OOM 吗？ | 不一定。kubelet 驱逐、`kill -9`、systemd `MemoryMax` 都是 137，要按 dmesg 有无 OOM 记录、events、审计记录三者交叉定 |
| 为什么不先加机器/加堆？ | 加堆只是推迟复发，掩盖泄漏；先定形态（泄漏 vs 尖峰），泄漏必须修代码 |

---

## 9. 叙事 A 实例：批量导出 PDF 把堆读满 → cgroup OOM（137）

> **两条叙事别混讲**：本仓库里"下载 PDF 导致进程消失"有**两个独立案例**，触发路径、退出码、证据、根因全不同——本篇是 **A · 被杀（137 / cgroup OOM，发生在"下载/导出"链路）**；B · 自崩（134/139 / native 崩溃，发生在"word 模板转 PDF 生成"链路）见 [`10-下载PDF致JVM进程消失-排查实录.md`](./10-下载PDF致JVM进程消失-排查实录.md)。

### 9.1 现象与证据

| 维度 | 内容 |
|---|---|
| 业务动作 | 客户批量勾选 **120 份**合同/履约凭证 PDF，打成一个 ZIP 下载（业务正常操作） |
| 现象 | 下载中断、页面 502；下游"合同/文件服务"实例消失后自动拉起 |
| 日志 | 应用日志最后一行是正常的"开始导出"业务日志，**无异常堆栈** |
| 退出码 | **137**（SIGKILL） |
| 容器原因 | Pod `Last State: Terminated  Reason: OOMKilled` |
| 内核证据 | `dmesg` 有 `Memory cgroup out of memory`；`/sys/fs/cgroup/memory.events` 的 `oom_kill` 从 0 → 1 |
| 关键配置 | 容器 `limits.memory = 6Gi`，JVM `-Xmx4g`（**堆外只剩 2G 预算，事故成因之一**） |

### 9.2 根因链

```
批量下载 120 份 PDF（业务正常操作）
  → 每个 PDF 被整份读入堆（byte[] 大对象），再交给 ZipOutputStream 打包
    → 8 路并发同时持有多个大数组，堆内占用冲高
      → 叠加堆外：线程栈 + direct buffer + 压缩缓冲 + Metaspace
        → 进程 RSS 突破 cgroup limit 6Gi（Xmx 4g 只留 2G 堆外，无人评审）
          → cgroup OOM Killer 发 SIGKILL（捕不到、写不了日志）
            → 实例消失，下载中断 502
```

深层两条：**① 架构缺陷**——文件字节本不该经过 JVM（对象存储在 MinIO，中间还绕了一层应用内存）；**② 观测缺口**——没有 RSS / 堆外 / cgroup `oom_kill` 监控，死于无人知晓，只能靠客户投诉发现。

### 9.3 处置与治本

| 阶段 | 动作 |
|---|---|
| 止血（当天） | 下载并发信号量收紧（8 → 3）；单次导出份数上限（120 → 20）；大批量入口临时转异步导出 |
| 治本 P0 | **MinIO 预签名 URL 直连下载**——文件字节完全不过 JVM，从根上消掉堆内大对象 |
| 治本 P1 | 剩余必须经服务的场景改**流式**（8KB 缓冲 + ZIP 逐文件写，禁止 `readAllBytes` / `IOUtils.toByteArray`） |
| 治本 P1 | 大批量导出统一走**异步任务 + 结果文件**，前端轮询/通知取件 |
| 治本 P2 | `limit = Xmx + 堆外预算` 纳入发布评审单；容器内存水位与 `oom_kill` 增长告警 |
| 防再发 | 写进开发规范红线：**大文件/大结果集禁止全量进堆；导出类接口必须限份数 + 流式 + 可异步** |

### 9.4 与叙事 B（native 崩溃）的区分表

| 维度 | A · 本篇（cgroup OOM） | B · 10 号实录（native 崩溃） |
|---|---|---|
| 业务动作 | 批量**下载/导出**既有 PDF（打 ZIP） | **生成** PDF（word 模板 → native 渲染引擎） |
| 退出码 | **137**（SIGKILL） | **134 / 139**（SIGABRT / SIGSEGV） |
| 应用日志 | 干净，无堆栈 | 干净，无堆栈 |
| `hs_err_pid*.log` | **无** | **有**（头部给出信号 + `Problematic frame`） |
| 内核日志 | `Memory cgroup out of memory`、`oom_kill` 计数 | 无 OOM 记录 |
| 根因性质 | 容量/架构问题（内存预算 + 文件过 JVM） | **代码 bug**（多线程无锁并发操作同一中间文件） |
| 治本 | 预签名直连 / 流式化 / 异步 / limit 预算 | 唯一临时文件 + 原子替换 / 文件级锁 / 队列化 |
| 复活表现 | 内存曲线尖峰冲顶 | 转换并发时必现崩溃，可预发复现 |

> 面试时**挑一条讲透**即可；若面试官追问"另一种情况怎么区分"，用上表一句话切开：**"137 且无 hs_err 是被杀，查 dmesg；134/139 且有 hs_err 是自己崩，读 hs_err。"**

---

## 10. 关联文档

- 同一现象但走 native 崩溃分支：[`10-下载PDF致JVM进程消失-排查实录.md`](./10-下载PDF致JVM进程消失-排查实录.md)
- 排查方法论与六步 SOP：[`14-Java架构师实战排障手册.md`](./14-Java架构师实战排障手册.md)（故事二：内存泄漏与 OOM）
- 现场一键取证：[`jvm_diag.sh`](./jvm_diag.sh)
- 面试口径主线：[`../../00-面试计划/07-JVM与线上排查.md`](../../00-面试计划/07-JVM与线上排查.md)
