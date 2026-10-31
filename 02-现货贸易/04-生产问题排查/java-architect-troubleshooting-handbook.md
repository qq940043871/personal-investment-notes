# Java 高级架构师实战排查手册（合并版）

> **本篇是 Java 技术排障的唯一权威版本**，由原先四份文档深度去重合并而成：
> ① 技术主手册 ② 按场景分页的 A4 速查卡 ③ Arthas `tt`/`ognl` + async-profiler 进阶篇 ④ 十类故障六步作业单（原 `13-故障排查工作台`）。
>
> **场景章（第 1–9 章）统一结构**（速查卡的"命令链 + 阈值"= 前两层，作业单的"动作编排 + 判读分流"= 第 x.5 层，命令细节一律回指 x.2，不重复抄写；Redis / MQ 两章与工具章、收口章按内容裁并）：
> ```
> x.1 现象与阈值  → 什么算异常、先分流到哪一章
> x.2 命令链      → 现场照敲，可单独打印应急
> x.3 现场判读    → 真实输出片段 + 怎么读数
> x.4 根因与处置  → 对照表 + 怎么修
> x.5 六步作业单  → 出事当场的动作顺序（命令细节回 x.2）
> ```
>
> 第 1–9 章为技术场景（CPU / 内存 / GC / 线程 / 死锁 / DB / Redis / MQ / 网络）；
> 第 10–12 章为工具与实战（Arthas `tt`·`ognl`、async-profiler 火焰图、联合排查）；
> 第 13–15 章为现场收口（日志风暴与磁盘满、服务假死、应急响应与工单复盘）。
> 命令基于 Linux + JDK8/11/17 通用环境；文中 `PID` 替换为实际进程号。

## 关联文档

| 文档 | 定位 |
|---|---|
| **本篇** | **技术主手册 + 排查方法论总纲**：第 0 章讲"排查什么、按什么流程"（四类场景分流 + 六步 SOP，原 `12-生产排查步骤-四类场景与六步SOP.md` 已并入本篇）；第 1–15 章讲每类技术问题"具体怎么查、怎么判、怎么修" |
| 本篇第 13–15 章 | **现场收口**：日志风暴与磁盘满、服务假死、应急响应与工单复盘（原 `13-故障排查工作台` 已并入本篇） |
| `jvm_diag.sh` | 现场一键取证脚本（系统 + JVM + 线程 + 网络，打包 tar.gz） |
| `11-网关扩容打穿DB-性能开发规范.md` | 容量基线与高并发五层防线（DB 侧的"事前"半边） |
| `08/09/10-*-排查实录.md` | 真实故障复盘（网络、竞速页变慢、JVM 进程消失） |

## 目录

- [第 0 章 总纲：止损、流程与工具准备](#第-0-章-总纲止损流程与工具准备)
- [第 1 章 CPU 飙高](#第-1-章-cpu-飙高)
- [第 2 章 内存泄漏与 OOM](#第-2-章-内存泄漏与-oom)
- [第 3 章 GC 问题](#第-3-章-gc-问题)
- [第 4 章 线程池与线程阻塞](#第-4-章-线程池与线程阻塞)
- [第 5 章 死锁](#第-5-章-死锁)
- [第 6 章 慢 SQL 与数据库连接池](#第-6-章-慢-sql-与数据库连接池)
- [第 7 章 Redis](#第-7-章-redis)
- [第 8 章 Kafka / RocketMQ 消息积压](#第-8-章-kafka--rocketmq-消息积压)
- [第 9 章 网关 502/504 与网络](#第-9-章-网关-502504-与网络)
- [第 10 章 Arthas 指令集与 tt ognl 深度实战](#第-10-章-arthas-指令集与-tt-ognl-深度实战)
- [第 11 章 async-profiler 火焰图](#第-11-章-async-profiler-火焰图)
- [第 12 章 联合排查实战与工具选型](#第-12-章-联合排查实战与工具选型)
- [第 13 章 日志风暴与磁盘满](#第-13-章-日志风暴与磁盘满)
- [第 14 章 服务假死](#第-14-章-服务假死)
- [第 15 章 应急响应与故障工单](#第-15-章-应急响应与故障工单)
- [附录 速查索引 / 口诀 / 安全红线 / 使用方式](#附录-速查索引--口诀--安全红线--使用方式)

## 现象 → 章节速查

| 现象 | 去第几章 | 首条命令 |
|---|---|---|
| 单核 100%、Load 高 | [1](#第-1-章-cpu-飙高) | `top -H -p PID` → `jstack` / `thread -n 3` |
| Heap / Metaspace OOM、曲线不回落 | [2](#第-2-章-内存泄漏与-oom) | `jstat -gcutil PID` → `jmap -dump` + MAT |
| Full GC 频繁、接口毛刺 | [3](#第-3-章-gc-问题) | `jstat -gcutil PID 1000 10` |
| 大面积超时但 CPU/内存正常 | [4](#第-4-章-线程池与线程阻塞) | `jstack PID \| grep Thread.State` 统计 |
| 接口挂起、线程不推进 | [5](#第-5-章-死锁) | `jstack PID \| grep -A 30 deadlock` |
| 接口慢、DB 相关指标异常 | [6](#第-6-章-慢-sql-与数据库连接池) | 慢查询日志 + `EXPLAIN` |
| 缓存命中率低、Redis 抖动 | [7](#第-7-章-redis) | `redis-cli --bigkeys` / `INFO memory` |
| 消费 Lag 增长、业务延迟 | [8](#第-8-章-kafka--rocketmq-消息积压) | `kafka-consumer-groups.sh --describe` |
| 502 / 504 / 区域性报错 | [9](#第-9-章-网关-502504-与网络) | Nginx `error.log` + `ss -s` |
| 偶发难复现、配置疑似不生效、方法级耗时 | [10](#第-10-章-arthas-指令集与-tt-ognl-深度实战) | `tt -t` / `ognl` / `trace` |
| 不知道热点在哪、CPU 高或慢但 CPU 低 | [11](#第-11-章-async-profiler-火焰图) | `profiler.sh -e cpu/wall -d 30` |
| 磁盘满、日志 GB 级增长、同一异常刷屏 | [13](#第-13-章-日志风暴与磁盘满) | `df -h; df -i` + `lsof \| grep deleted` |
| 进程活着、端口在听、请求全超时 | [14](#第-14-章-服务假死) | 本机直连 `/health` + 两次 `jstack` |
| 大面积不可用，需要立刻决策 | [15](#第-15-章-应急响应与故障工单) | 影响面评估 → 止血 → 保现场 → 工单 |

---

## 第 0 章 总纲：止损、流程与工具准备

### 0.1 四步止损原则

```
1. 先止损   → 熔断 / 降级 / 扩容 / 回滚 / 摘除节点
2. 定范围   → 单机 or 集群？单接口 or 全站？持续性 or 偶发？
3. 逐层下钻 → 网关 → 应用 → JVM → 中间件 → DB
4. 留证据   → dump、堆栈、GC 日志、火焰图，事后复盘
```

### 0.2 通用排查七步

```
[ ] 1. 确认影响范围：多少用户 / 多少实例 / 哪些接口
[ ] 2. 是否可快速止损（回滚 / 扩容 / 降级 / 熔断）
[ ] 3. 收集现场证据：jstack / jmap / GC 日志 / 慢 SQL / 链路追踪
[ ] 4. 横向对比：异常实例 vs 正常实例（配置 / 版本 / 流量）
[ ] 5. 逐层下钻：网关 → 应用 → JVM → 中间件 → DB
[ ] 6. 定位根因，验证假设
[ ] 7. 修复 + 补监控 + 补告警 + 复盘沉淀
```

### 0.3 排查黄金法则

> 1. **先止血，后查因**——线上优先恢复业务。
> 2. **用数据说话**——不猜，看栈、看日志、看指标。
> 3. **缩小范围**——单机 vs 集群，先做二分定位。
> 4. **一次只改一个变量**——避免掩盖真实原因。
> 5. **留好现场**——dump / 日志先留存，再重启。
> 6. **复盘必做**——每个故障都要沉淀成监控项和 checklist。

### 0.4 一次性装齐排查工具

```bash
# JVM 原生命令已在 JDK 内：jps jstack jmap jstat jinfo jcmd jhat

# Arthas（阿里开源，线上问题神器，推荐优先使用；内置 async-profiler）
curl -O https://arthas.aliyun.com/arthas-boot.jar
java -jar arthas-boot.jar

# 系统级工具
apt-get install -y sysstat procps net-tools lsof strace htop \
                   iotop dstat tcpdump nc

# 堆分析：本地安装 Eclipse MAT (Memory Analyzer Tool)

# 火焰图（如需脱离 Arthas 单独用，见第 11 章）
wget https://github.com/async-profiler/async-profiler/releases/download/v3.0/async-profiler-3.0-linux-x64.tar.gz
tar -zxvf async-profiler-3.0-linux-x64.tar.gz
```

### 0.5 现场取证：一键采集 vs 一分钟体检

**① 完整取证用同目录脚本**（推荐，出问题先跑它，拿到 tar 包离线分析）：

```bash
./jvm_diag.sh <PID>
# 产物 jvm_diag_<PID>_<时间>.tar.gz 内含：
#   系统信息 / load / CPU / 内存 / IO / 磁盘
#   进程与线程（含 D 状态线程）/ top 线程
#   jcmd VM.version + VM.flags / jstat -gcutil / jstack（含 kill -3 兜底）
#   /proc/PID/fd、limits、dmesg、ss -s、ss -antp
```

**② 只想知道"大概哪儿不对"，敲这一把梭：**

```bash
PID=12345
echo "== 线程数 ==";   ls /proc/$PID/task | wc -l
echo "== GC ==";       jstat -gcutil $PID 1000 3
echo "== 线程状态 =="; jstack $PID | grep Thread.State | sort | uniq -c | sort -rn
echo "== 最忙线程 =="; top -H -p $PID -b -n 1 | head -15
echo "== 死锁 ==";     jstack $PID | grep -c "Found one Java-level deadlock"
```

> 这两套只做**分流**：结果指向哪一类，进哪一章。真正定位靠各章的判读逻辑。

### 0.6 十类故障分诊总览（一页纸）

| # | 故障类型 | 一句话特征 | 第一步动作 | 判定后出口 |
|:--:|---|---|---|---|
| 1 | JVM 内存溢出（OOM） | 日志出现 `OutOfMemoryError`，或老年代涨到 FGC 不回落 | 先分清 OOM 关键字（[2.1](#21-现象与阈值)） | 堆 → dump；元空间 → 动态类；堆外 → DirectByteBuffer；线程 → 转 4 |
| 2 | CPU 飙高 | 进程 `%CPU` 长期 80%+，Load 接近或超核数 | `top -c` 定进程 → `top -Hp` 定线程（[1.2](#12-命令链)） | 栈顶是 GC → 转 3；是业务 → 死循环 / 热点 |
| 3 | 频繁 Full GC / 停顿抖动 | FGC 持续增长，接口周期性卡顿 | `jstat -gcutil` 看 `O` 与 `FGC`（[3.2](#32-命令链)） | 泄漏 → 转 2；配置 / 晋升 / 大对象 → 本章调参 |
| 4 | 线程问题（死锁 / 池耗尽） | 线程数暴涨、大量 BLOCKED/WAITING、接口 hang | 间隔 5 秒抓两份 `jstack`（[4.2](#42-命令链)） | 死锁 → 转 5；池耗尽 → 查外呼超时；线程失控 → 查 `new Thread` |
| 5 | 接口慢 / 超时 | 单接口 P99 飙升，调用方大量 read timeout | `curl -w` 分解耗时（[9.5](#95-接口慢的分层定界入口侧先分账)） | 等 DB → 转 6；等下游 → 补超时；GC → 转 3；池满 → 转 4 |
| 6 | 数据库问题（慢查询 / 连接池 / 锁） | 获取连接超时、大量线程卡 `socketRead`、DB CPU 高 | 应用侧看连接池 `active`/`wait`（[6.4](#64-连接池监控hikaricp)） | 慢 SQL → `EXPLAIN`；泄漏 → 查 finally；锁 → 查 `pg_locks` / `innodb_trx` |
| 7 | 日志风暴 / 磁盘满 | `df` 100%、日志每分钟 GB 级、同一异常刷屏 | `df -h` + `df -i`（[13.2](#132-命令链)） | 异常风暴 → 降级限频；句柄未释放 → `lsof` |
| 8 | 网络问题（CLOSE_WAIT / 连接堆积） | `CLOSE_WAIT` 数万不降、偶发超时 | `ss -s` 看状态分布（[9.2](#92-命令链)） | 本端没 close → 查代码 / 连接池；短连接 → 连接池化 |
| 9 | 服务假死（进程在但不干活） | 端口在听、请求全超时、健康检查 DOWN | 本机直连 `/health` 绕网关（[14.2](#142-命令链)） | GC 死循环 → 转 2；线程全卡 → 转 4；锁死 → 转 5 |
| 10 | 应急响应（先恢复，再定位） | 大面积不可用，需要立即决策 | 1 分钟评估影响面（[15.2](#152-六步作业单先恢复再定位)） | 止血 → 保现场 → 观察 → 工单 → 复盘 |

### 0.7 五条铁律（十类场景通用）

1. **先止损，再定位**：回滚最近变更（发布 / 配置 / DDL / 网络）优先；30 分钟定不了位就升级。
2. **先保现场，再重启**：两份 `jstack` + heap dump + `jstat` 采样 + 日志尾部 + `top`，落 `/tmp` 并拷出。直接重启 = 根因永远未知。
3. **先定性质，再定根因**：崩溃（有 `hs_err` / OOM 栈）还是被杀（SIGKILL / 137）？错误率涨（故障）还是只 RT 涨（慢而不报错）？方向不同，工具不同。
4. **一条证据链解释全部现象**：包括"为什么别的机器没事"。解释不了，就是还没到底。
5. **修复后固化三件套**：补监控（盲区）、补告警（阈值 + 分级）、补压测用例（回归）。能进 checklist 的不靠记忆。

---

## 第 1 章 CPU 飙高

### 1.1 现象与阈值

- 监控告警：单核 100%、系统 Load 持续高于 CPU 核数
- 接口 RT 上涨、吞吐下降
- **阈值**：`Load ≈ CPU 核数` 属于满负荷；`Load >> 核数` 且 `wa` 高 → 先查 IO（见 1.5），不要一头扎进 JVM

### 1.2 命令链

```bash
# ① 定位是哪个进程吃 CPU
top -c                          # 记下 PID，例如 12345

# ② 定位是哪个线程吃 CPU（-H 显示线程）
top -H -p 12345                 # 假设线程 TID = 12360，占用 99%

# ③ 线程号转十六进制（jstack 里是 hex）
printf "%x\n" 12360             # 输出 3048

# ④ dump 线程栈，抓出该线程
jstack 12345 > /tmp/jstack.txt
grep -A 30 "nid=0x3048" /tmp/jstack.txt

# ⑤ 或者一步到位（Arthas 推荐）
java -jar arthas-boot.jar
thread -n 3                     # 展示最忙的 3 个线程及栈
thread -n 3 -i 1000             # 每 1 秒刷新一次
```

### 1.3 现场判读

```text
"http-nio-8080-exec-23" #123 daemon prio=5 os_prio=0 tid=0x00007f... nid=0x3048 runnable
   java.lang.Thread.State: RUNNABLE
        at java.util.regex.Pattern$Curly.match(Pattern.java:4227)
        at java.util.regex.Pattern$GroupHead.match(Pattern.java:4660)
        at com.demo.validator.EmailValidator.validate(EmailValidator.java:41)
        at com.demo.controller.UserController.register(UserController.java:88)
        ...
```

**结论**：栈顶在 `Pattern$Curly.match`，正在跑一段**正则表达式** → 典型的**正则回溯（catastrophic backtracking）**。

### 1.4 根因对照与处置

| 栈顶特征 | 根因 | 处置 |
|---|---|---|
| `Pattern$Curly/GroupHead.match` | 正则回溯，输入触发最坏复杂度 | 换非回溯写法，或加长度限制 / 超时 |
| `java.security.MessageDigest` | 大文件哈希、过多 MD5/SHA | 异步化、缓存结果 |
| `com.fasterxml.jackson` | 超大 JSON 序列化/反序列化 | 分页、流式解析 |
| `Base64.encode/decode` | 大图片/附件 Base64 转换 | 限制大小、异步处理 |
| `GC task thread#` | 频繁 GC 导致的 CPU | 转[第 3 章](#第-3-章-gc-问题) |
| 自己的业务方法 | 死循环 / 全表遍历 | 看代码 |

### 1.5 Load 高但 CPU 不高？—— 查 IO 等待

Load 高不等于 CPU 高，可能是**大量线程在等待 IO**：

```bash
# 看是否有 D 状态（不可中断睡眠）线程
ps -eLo pid,tid,stat,wchan:20,comm | awk '$3 ~ /D/'

# 看 IO 等待
iostat -x 1 3
vmstat 1 5
# 关键列：r（运行队列）b（阻塞）wa（IO 等待百分比）

# 看磁盘 IO 大户
iotop -oP
```

### 1.6 六步作业单（现场动作顺序）

| 步 | 动作 | 命令（详见 1.2） | 判读与分流 |
|:--:|---|---|---|
| ① | 找最耗 CPU 的进程 | `top -c`（大写 `P` 按 CPU 排序） | 多个进程同时高 → 宿主机资源不足或互踩 |
| ② | 找进程内最耗 CPU 的线程 | `top -Hp PID` | 记下 TID（可能不止一个） |
| ③ | TID 转十六进制 | `printf '%x\n' TID` | 对应 `jstack` 里的 `nid` |
| ④ | 抓栈看线程在干什么 | `jstack PID \| grep -A 30 "nid=0x<hex>"` | 栈顶 `GC task thread` / `VM Thread` → 转第 3 章；业务代码 → 继续 ⑤ |
| ⑤ | 连抓 2–3 次对比 + 线程采样 | `jstack PID > /tmp/s1.txt; sleep 5; jstack PID > /tmp/s2.txt`；`pidstat -t -p PID 1 5`；`ps -o nlwp PID` | 栈不变 → 固定热点（死循环 / 正则回溯）；快速变化 → 大量小任务并发（序列化 / 加解密） |
| ⑥ | 对照根因处置 | 见 1.4；`vmstat 1 5` 看 `cs` 列 | `cs` 极高 → 线程数远超核数，切换开销吃掉 CPU；`wa` 高 → 先查 IO（1.5） |

---

## 第 2 章 内存泄漏与 OOM

### 2.1 现象与阈值

- `java.lang.OutOfMemoryError: Java heap space`
- `java.lang.OutOfMemoryError: Metaspace`（见 2.6）
- `GC overhead limit exceeded`
- 堆内存曲线持续上升，Full GC 后不回落
- **阈值**：老年代使用率 `O > 90%` 且 Full GC 后不下降 → 按泄漏处理

**先分清 OOM 类型**（这一步决定后续全部动作，别急着抓 dump）：

| OOM 关键字 | 含义 | 主查方向 |
|---|---|---|
| `Java heap space` | 堆内存不足 | 大结果集 / 无界集合 / 缓存无上限 / 队列积压 |
| `GC overhead limit exceeded` | 堆快满且 GC 低效（堆溢出的变体） | 同上，先看 GC 是否已陷入空转 |
| `Metaspace`（JDK8+） | 元空间耗尽 | 动态类生成：CGLIB / 反射 / 热部署；JDK7 对应 `PermGen space`，看 `jmap -permstat` |
| `Direct buffer memory` | 堆外直接内存耗尽 | NIO / `DirectByteBuffer` / Netty；查 `-XX:MaxDirectMemorySize` |
| `unable to create new native thread` | 线程数 / 栈空间耗尽 | 线程失控 → 转第 4 章；同时看 `ulimit -u`、`nproc` |
| `Requested array size exceeds VM limit` | 单次分配超大数组 | 回代码定位该次分配（全量查询 / 大文件读入） |

### 2.2 命令链

```bash
# ① 先看堆概况
jstat -gcutil 12345 1000 5
# 重点看 O（老年代使用率）是否接近 100 且 Full GC 后不降

# ② 看对象实例统计（快速版，会 STW，线上慎用）
jmap -histo:live 12345 | head -30

# ③ dump 堆快照（正式分析，注意文件可能几个 G）
jmap -dump:live,format=b,file=/tmp/heap.hprof 12345

# ④ 如果是 OOM 自动 dump（推荐提前埋参数）
# JVM 启动加：
#   -XX:+HeapDumpOnOutOfMemoryError
#   -XX:HeapDumpPath=/data/dump/
```

> **`:live` 口径别混用**：活进程手工定位泄漏用 `:live`（会先触发一次 Full GC，只看存活对象）；
> OOM 自动生成的 dump、以及事故取证时的 `jmap -histo`（**不加** `:live`）包含不可达对象——历史峰值也是线索。
>
> **大 dump（>1GB）**：MAT 需要接近等量内存，"分析 OOM 的工具自己 OOM"是常态。
> 先用零依赖流式工具出**类直方图 → 基本类型数组长度指纹 → `char[]` 关键词取证**，
> 再按数组长度回代码找分配点，最后用 `jstack` 交叉验证（本机 `jvm-triage` skill 内有对应脚本）。

### 2.3 现场判读

```text
 num     #instances         #bytes  class name
----------------------------------------------
   1:       8234512      263504384  [C              # char[]
   2:       4102334      196912032  java.lang.String
   3:       1023456       81876480  com.demo.dto.OrderDTO
   4:        512300       40984000  java.util.HashMap$Node
```

**结论**：`char[]` 和 `String` 占比异常，且 `OrderDTO` 数量巨大 —— 疑似**某处把订单对象全部缓存进内存未释放**。

### 2.4 MAT 分析四步

```text
1. 用 MAT 打开 heap.hprof
2. 看 "Leak Suspects" 报告（自动给出可疑点）
3. 看 Dominator Tree（支配树）→ 找到占用最大的对象
4. 右键对象 → Path to GC Roots → exclude weak/soft references
   → 找到"谁在持有它"，就是泄漏点
```

### 2.5 常见泄漏根因

| 场景 | 典型表现 | 修复 |
|---|---|---|
| 静态 Map 做缓存无上限 | HashMap 无限增长 | 换 Caffeine/Guava Cache + 淘汰策略 |
| ThreadLocal 未 remove | 线程池复用导致累积 | finally 里 remove() |
| 监听器/回调未注销 | Listener 列表越加越多 | 生命周期结束时反注册 |
| 数据库/网络连接未关闭 | 连接对象 + 缓冲区堆积 | try-with-resources |
| 自定义类加载器泄漏 | Metaspace OOM | 排查热部署、反射、动态代理 |
| 大对象短生命周期 | 频繁大数组分配 | 池化或流式处理 |

> 想知道"**谁在疯狂分配**"而不只是"堆里有什么"，用火焰图 alloc 模式：[第 11 章 11.6](#116-案例二内存分配热点alloc-模式)。

### 2.6 元空间 Metaspace OOM

```bash
# 看 Metaspace 容量(MC)与使用(MU) —— jstat -gc 字段序：OC=$7 OU=$8 MC=$9 MU=$10
jstat -gc 12345 | awk 'NR==2{printf "OC=%s OU=%s MC=%s MU=%s\n",$7,$8,$9,$10}'

# 或用 jcmd
jcmd 12345 GC.heap_info
jcmd 12345 VM.metaspace
```

> **常见根因**：反射滥用（如 BeanUtils 大量动态生成类）、热部署/CGLIB 代理类不断累积、`-XX:MaxMetaspaceSize` 设置过小。

### 2.7 六步作业单（现场动作顺序）

| 步 | 动作 | 命令（详见 2.2） | 判读与分流 |
|:--:|---|---|---|
| ① | 先分清 OOM 类型，别急着抓 dump | 日志搜 `OutOfMemoryError` 看后面跟的关键字 | 按 2.1 表定方向：堆 / 元空间 / 堆外 / 线程，方向完全不同 |
| ② | 保现场：抓堆转储 | `jmap -dump:live,format=b,file=/tmp/heap.hprof PID` | 会 STW（大堆几十秒），有条件先切流/摘流量；已配 `-XX:+HeapDumpOnOutOfMemoryError` 就直接找 `.hprof` |
| ③ | 快速看堆里是什么 | `jmap -histo:live PID \| head -30` | `char[]`/`byte[]` 靠前 → 大字符串 / 大结果集；`HashMap$Node` 靠前 → 无界集合；业务实体靠前 → 大结果集 |
| ④ | 观察回收行为 | `jstat -gcutil PID 2000 30` | `O` 100% 且 FGC 持续增长、回收后不回落 → 泄漏或堆过小；偶发 FGC 后回落 → 大对象 / 流量尖峰 |
| ⑤ | 分析 dump 定位持有链 | MAT 四步（2.4）；>1GB 用流式工具 | 直方图 → 支配树 → `Path to GC Roots`；`char[]` 里是 SQL 结果字段就基本锁定来源 |
| ⑥ | 改代码并复验 | 改完回第 ④ 步观察 | 老年代基线稳定、FGC 不再增长；否则回 ⑤ 继续找持有链 |

> **易混边界**：进程**没有日志就消失**、Exit Code 137 → 不是 OOM 崩溃，是 cgroup OOM Killer 杀的，
> 走 `10-下载PDF致JVM进程消失-排查实录.md`（`limits.memory = Xmx + 堆外预算`）。

---

## 第 3 章 GC 问题

### 3.1 现象与阈值

- Full GC 频繁（分钟级一次甚至更密）
- 单次 STW 停顿几百毫秒到数秒，接口毛刺
- `GC overhead limit exceeded`
- **阈值**：单次 Full GC 停 > 1s、或 Full GC 间隔 < 5min 即需介入

### 3.2 命令链

```bash
# ① GC 实时统计（每 1 秒一次，共 10 次）
jstat -gcutil 12345 1000 10
# 列含义：
#   S0/S1  新生代两个 Survivor 使用率
#   E      Eden 使用率
#   O      老年代使用率        ← 重点
#   M      Metaspace 使用率
#   YGC    Young GC 次数
#   YGCT   Young GC 总耗时
#   FGC    Full GC 次数        ← 重点
#   FGCT   Full GC 总耗时
#   GCT    GC 总耗时

# ② 查看各区域容量大小（KB）
jstat -gc 12345

# ③ GC 日志（启动加参数）
# JDK8： -XX:+PrintGCDetails -XX:+PrintGCDateStamps
#        -Xloggc:/data/logs/gc.log -XX:+UseGCLogFileRotation
# JDK11+: -Xlog:gc*:file=/data/logs/gc.log:time,uptime,level,tags
```

### 3.3 现场判读

```text
 S0     S1     E      O      M     CCS    YGC     YGCT    FGC    FGCT     GCT
 0.00  99.80  45.20  99.87  95.10  92.30  18234  412.33  1893  3891.22  4303.55
```

- `O = 99.87%` → 老年代几乎打满
- `FGC = 1893` 次，`FGCT = 3891s` → Full GC 累计停了 **64 分钟**
- `GCT` 占运行时间比例过高 → **内存泄漏或堆分配不合理**

**GC 日志片段（JDK8 Parallel GC）**：

```text
2024-05-20T10:23:11.234+0800: 45231.234: [Full GC (Ergonomics)
[PSYoungGen: 512000K->0K(524288K)]
[ParOldGen: 1747324K->1746890K(1747456K)] 2259324K->1746890K(2271744K),
[Metaspace: 102345K->102345K(1064960K)], 2.3412340 secs]
[Times: user=9.12 sys=0.03, real=2.34 secs]
```

**关键信号**：Full GC 后老年代几乎**没有回收**（`1747324K->1746890K`），对象**全部存活**
→ 确认是**内存泄漏**，不是 GC 参数问题。

### 3.4 判断逻辑树

```
Q1: Full GC 后老年代是否下降？
 ├── 明显下降 → 只是"对象创建太快"，GC 来不及
 │              → 优化代码减少对象 / 增大堆 / 调新生代比例
 └── 几乎不降 → 内存泄漏
                → jmap dump → MAT 找 GC Roots 引用链（第 2 章）

Q2: Young GC 是否过于频繁？
 └── 是 → Eden 太小 / 短命对象太多 / 大对象直接进老年代
          → 调 -Xmn、-XX:SurvivorRatio、-XX:PretenureSizeThreshold
             （或先用火焰图 alloc 找出分配源，见 11.6）

Q3: 单次 STW 是否过长？
 └── 是 → 堆过大 / GC 器选择不当
          → 大堆考虑 G1 / ZGC / Shenandoah
```

### 3.5 常用 GC 参数速查

```bash
-Xms8g -Xmx8g                            # 堆固定，避免动态扩容抖动
-Xmn3g                                   # 新生代大小
-XX:SurvivorRatio=8                      # Eden:Survivor = 8:1
-XX:MaxTenuringThreshold=15              # 对象晋升老年代年龄阈值
-XX:+UseG1GC -XX:MaxGCPauseMillis=200    # G1 目标停顿
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/data/dump/
-Xlog:gc*:file=/data/logs/gc.log:time,uptime,level,tags   # JDK11+
```

### 3.6 六步作业单（现场动作顺序）

| 步 | 动作 | 命令（详见 3.2） | 判读与分流 |
|:--:|---|---|---|
| ① | 确认 FGC 频率与形态 | `jstat -gcutil PID 1000 60` | 每分钟多次且每次几秒 → 必须处理；每次回收后基线逐步抬升 → 泄漏型（转第 2 章） |
| ② | 看是否大对象推动 | `jmap -histo:live PID \| head -20` | `byte[]`/`Object[]`/业务大实体靠前 → 查一次性载入大数据的代码；单次几 MB 以上直接进老年代 |
| ③ | 核对堆配置是否太小 | `jinfo -flags PID` | `Xmx` 远小于机器内存或业务峰值 → 调大；以"老年代稳态占用 ×1.5 再留余量"校准 |
| ④ | 排查提前晋升 | 核 `SurvivorRatio`、`MaxTenuringThreshold`；看 Eden 满的频率 | Eden 频繁满且晋升快 → 增大年轻代 / Survivor |
| ⑤ | 查显式 `System.gc()` | GC 日志里出现 `Full GC (System)` | 周期固定（整点 / 每小时）→ 大概率定时任务；可加 `-XX:+DisableExplicitGC`（依赖显式 GC 回收堆外内存的场景先评估） |
| ⑥ | dump 分析残留对象 | 见 2.2 / 2.4 | 以上都对不上 → 走第 2 章找持有链 |

---

## 第 4 章 线程池与线程阻塞

### 4.1 现象与阈值

- 接口大面积超时，但 CPU / 内存都正常
- 日志出现 `RejectedExecutionException`（拒绝策略触发）
- 请求排队，QPS 上不去
- **阈值**：同一线程名的线程数持续增长、队列 size 单调上升、`WAITING (parking)` 占绝对多数 → 池打满

### 4.2 命令链

```bash
# ① 线程状态分布
jstack 12345 | grep "java.lang.Thread.State" | sort | uniq -c | sort -rn

# ② 找出所有处于 WAITING/TIMED_WAITING 的线程
jstack 12345 | grep -B 2 "java.lang.Thread.State: WAITING" | head -50

# ③ 按线程名归类（看哪个池打满）
jstack 12345 | grep '"' | sed 's/".*//' | sort | uniq -c | sort -rn | head -20

# ④ 总线程数
ls /proc/12345/task | wc -l

# ⑤ 线程数爆掉：按进程看线程数排行
ps -eLo pid | sort | uniq -c | sort -rn | head

# ⑥ Arthas：一把揪出"阻塞别人的元凶"
thread -b
```

### 4.3 现场判读

```text
    156 java.lang.Thread.State: WAITING (parking)
     89 java.lang.Thread.State: TIMED_WAITING (parking)
     23 java.lang.Thread.State: RUNNABLE
     12 java.lang.Thread.State: BLOCKED (on object monitor)
```

大量 `WAITING (parking)` 说明线程在**等待某个资源**（锁/条件变量/连接池），
典型如：**数据库连接池耗尽后，业务线程集体阻塞在获取连接上**。

```text
"http-nio-8080-exec-88" #188 daemon prio=5 ... nid=0x4abc waiting on condition
   java.lang.Thread.State: WAITING (parking)
        at sun.misc.Unsafe.park(Native Method)
        at java.util.concurrent.locks.LockSupport.park(LockSupport.java:175)
        at com.zaxxer.hikari.pool.HikariPool.getConnection(HikariPool.java:190)
        at com.zaxxer.hikari.HikariDataSource.getConnection(HikariDataSource.java:128)
        at com.demo.dao.OrderDao.query(OrderDao.java:33)
        ...
```

**结论**：线程全部堵在 **HikariCP `getConnection`** → 连接池被占满。
下一步查：**是慢 SQL 占着连接不放，还是连接泄漏（借了没还）** → [第 6 章](#第-6-章-慢-sql-与数据库连接池)。

### 4.4 线程池参数自检（四必看）

```java
// 排查时必问的四个数：corePoolSize / maxPoolSize / queueCapacity / 拒绝策略
ThreadPoolExecutor executor = (ThreadPoolExecutor) pool;
executor.getCorePoolSize();         // 核心线程
executor.getMaximumPoolSize();      // 最大线程
executor.getActiveCount();          // 活跃线程
executor.getPoolSize();             // 池中线程
executor.getQueue().size();         // 队列积压   ← 单调上升就是打满
executor.getCompletedTaskCount();   // 已完成任务
```

> **经典坑**：`Executors.newFixedThreadPool()` 底层是 `LinkedBlockingQueue`（**无界队列**）
> → **maxPoolSize 永远用不上，队列无限堆积，最终 OOM**。
> 生产必须手写 `ThreadPoolExecutor` 并指定**有界队列 + 自定义拒绝策略**。

> 线上不改代码读运行时真实参数（"配了但没生效"）：`ognl '@工具类@getBean("orderExecutor").getQueue().size()'`，见 [10.6](#106-ognl-高级用法动态调试)。

### 4.5 六步作业单（死锁 / 池耗尽 / 线程失控）

| 步 | 动作 | 命令（详见 4.2） | 判读与分流 |
|:--:|---|---|---|
| ① | 抓两份线程栈 | `jstack PID > /tmp/s1.txt; sleep 5; jstack PID > /tmp/s2.txt` | 对比线程状态是否变化：不变 = 真卡住，变化 = 慢而非死 |
| ② | 先搜死锁标记 | 搜 `Found one Java-level deadlock`、`BLOCKED` | 有 deadlock 段落 → JVM 已给出互等线程与锁对象，直接读（第 5 章） |
| ③ | 统计状态分布 | `grep -c BLOCKED /tmp/s1.txt`；按 `Thread.State` 分组计数 | 大量 `BLOCKED` 等同一把锁 → 锁内做了慢操作（RPC / IO）；`WAITING` 在 `getTask` → 工作线程空闲，问题在上游 |
| ④ | 看线程池是否积压 | 栈里找 `pool-N-thread-M` | 都 `WAITING` 而上游仍超时 → 查调用方；都 `RUNNABLE` 卡同一外部调用 → 外呼无超时（典型：全卡 `socketRead` 且没配 `connectTimeout`/`readTimeout`） |
| ⑤ | 数线程数与趋势 | `ps -o nlwp PID` / `ls /proc/PID/task \| wc -l` | 持续增长不回落 → 每请求新建线程、定时任务反复起线程；`unable to create new native thread` 是失控终点 |
| ⑥ | 对照根因处置 | 修锁粒度 / 补超时 / 换有界队列 + 拒绝策略 | 回 4.4 复验四个数：active / queue.size / poolSize / completedTaskCount |

---

## 第 5 章 死锁

### 5.1 现象

- 接口莫名挂起、无响应
- 部分线程永远 RUNNABLE/BLOCKED 不推进
- 应用"卡死"但资源正常

### 5.2 命令链

```bash
# 一步定位
jstack 12345 | grep -A 30 "Found one Java-level deadlock"
```

### 5.3 现场判读

```text
Found one Java-level deadlock:
=============================
"Thread-1":
  waiting to lock monitor 0x00007f8a4c003e28 (object 0x00000000d6f8a1b0, a java.lang.Object),
  which is held by "Thread-0"
"Thread-0":
  waiting to lock monitor 0x00007f8a4c003f58 (object 0x00000000d6f8a2c0, a java.lang.Object),
  which is held by "Thread-1"

Java stack information for the threads listed above:
===================================================
"Thread-1":
        at com.demo.service.TransferService.transferB(TransferService.java:55)
        - waiting to lock <0x00000000d6f8a1b0> (a java.lang.Object)
        - locked <0x00000000d6f8a2c0> (a java.lang.Object)
"Thread-0":
        at com.demo.service.TransferService.transferA(TransferService.java:33)
        - waiting to lock <0x00000000d6f8a2c0> (a java.lang.Object)
        - locked <0x00000000d6f8a1b0> (a java.lang.Object)
```

**结论**：`transferA` 和 `transferB` **加锁顺序相反** → 典型 **AB-BA 死锁**。
修复：**统一加锁顺序**或改用 `tryLock(timeout)`。

### 5.4 DB 死锁（MySQL）

```sql
-- 查看最近一次死锁详情，关注 LATEST DETECTED DEADLOCK 段落
SHOW ENGINE INNODB STATUS\G

-- 当前所有事务及锁等待
SELECT * FROM information_schema.INNODB_TRX;
SELECT * FROM performance_schema.data_locks;
SELECT * FROM performance_schema.data_lock_waits;

-- 谁在等谁（定位阻塞源）
SELECT r.trx_id waiting_trx, r.trx_mysql_thread_id waiting_thread,
       r.trx_query waiting_query, b.trx_id blocking_trx,
       b.trx_mysql_thread_id blocking_thread, b.trx_query blocking_query
FROM performance_schema.data_lock_waits w
JOIN information_schema.INNODB_TRX b ON b.trx_id = w.blocking_engine_transaction_id
JOIN information_schema.INNODB_TRX r ON r.trx_id = w.requesting_engine_transaction_id;

-- 必要时杀掉阻塞源
KILL <blocking_thread_id>;
```

### 5.5 六步作业单（含 DB 侧死锁）

| 步 | 动作 | 命令（详见 5.2 / 5.4） | 判读与分流 |
|:--:|---|---|---|
| ① | 先确认是 JVM 死锁还是资源耗尽 | `jstack PID \| grep -A 30 deadlock` | 无 deadlock 段落 → 不是死锁，转第 4 章（池耗尽 / 外呼无超时） |
| ② | 读 JVM 给出的互等链 | 输出里的 `waiting to lock ... held by` | 两线程加锁顺序相反 → AB-BA；单锁被长期持有 → 锁内有慢操作 |
| ③ | 修代码 | 统一加锁顺序 / `tryLock(timeout)` / 缩小临界区 | 锁内禁止 RPC、IO、大批量计算 |
| ④ | 排除 DB 死锁 | MySQL `SHOW ENGINE INNODB STATUS\G`；PG `SELECT * FROM pg_locks WHERE NOT granted` | 数据库侧互等 → 按 5.4 / 6.5 找阻塞源 |
| ⑤ | 必要时止血 | `KILL <blocking_thread_id>` | 先留证再 kill，并记录被杀的 SQL |
| ⑥ | 防复发 | 拆大事务、收敛唯一键并发冲突、固化加锁顺序规范 | 用 5.4 的锁等待视图复验 |

---

## 第 6 章 慢 SQL 与数据库连接池

### 6.1 定位慢 SQL

```sql
-- 开启慢查询日志
SET GLOBAL slow_query_log = ON;
SET GLOBAL long_query_time = 1;                    -- 超过 1 秒记录
SET GLOBAL log_queries_not_using_indexes = ON;

-- 慢 SQL 排行
SELECT * FROM performance_schema.events_statements_summary_by_digest
ORDER BY SUM_TIMER_WAIT DESC LIMIT 20;

-- 实时看正在执行的长事务
SELECT id, user, host, db, command, time, state, info
FROM information_schema.PROCESSLIST
WHERE command != 'Sleep' AND time > 3
ORDER BY time DESC;

-- 连接数水位
SHOW STATUS LIKE 'Threads_connected';
SHOW VARIABLES LIKE 'max_connections';
```

### 6.2 现场判读：EXPLAIN

```sql
EXPLAIN SELECT * FROM orders WHERE user_id = 100 AND status = 'PAID' ORDER BY create_time DESC LIMIT 10;
```

```text
+----+-------------+--------+------+---------------+------+---------+------+---------+-------------+
| id | select_type | table  | type | possible_keys | key  | key_len | ref  | rows    | Extra       |
+----+-------------+--------+------+---------------+------+---------+------+---------+-------------+
|  1 | SIMPLE      | orders | ALL  | NULL          | NULL | NULL    | NULL | 8234512 | Using where; Using filesort |
+----+-------------+--------+------+---------------+------+---------+------+---------+-------------+
```

| 危险信号 | 含义 |
|---|---|
| `type = ALL` | **全表扫描** |
| `key = NULL` | **没走索引** |
| `rows` 很大（这里 800 多万） | 扫描行数过多 |
| `Using filesort` | **额外排序开销** |
| `Using temporary` | **用了临时表** |

**修复**：加联合索引

```sql
ALTER TABLE orders ADD INDEX idx_user_status_time(user_id, status, create_time);
```

### 6.3 深分页优化

```sql
-- 反例：越翻越慢
SELECT * FROM orders ORDER BY id LIMIT 1000000, 20;

-- 优化一：延迟关联（先查主键再回表）
SELECT o.* FROM orders o
JOIN (SELECT id FROM orders ORDER BY id LIMIT 1000000, 20) t ON o.id = t.id;

-- 优化二：游标法（记住上一页最大 id，最快）
SELECT * FROM orders WHERE id > 1000000 ORDER BY id LIMIT 20;
```

### 6.4 连接池监控（HikariCP）

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,metrics,prometheus
  metrics:
    tags:
      application: ${spring.application.name}
```

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
| `connections.idle` | 空闲连接 | 长期偏低说明池不够 |

> **判断连接泄漏**：`active` 长期接近上限且 `idle=0`，慢 SQL 排查无果 → 大概率代码借了连接没关。
> 临时方案：`leakDetectionThreshold=2000`（毫秒），HikariCP 会打印泄漏堆栈。

```properties
spring.datasource.hikari.leak-detection-threshold=2000
```

### 6.5 openGauss / PostgreSQL 专用命令

```sql
-- 活动会话与长事务（state<>'idle' 才是真正在跑的）
SELECT pid, state, now()-xact_start AS 事务时长, left(query,80)
FROM pg_stat_activity WHERE state <> 'idle' ORDER BY xact_start;

-- 锁等待：谁在等谁（PG 9.6+ 可直接找堵源）
SELECT * FROM pg_locks WHERE NOT granted;
SELECT pid, pg_blocking_pids(pid) FROM pg_stat_activity
WHERE cardinality(pg_blocking_pids(pid)) > 0;

-- 执行计划（openGauss 另有 EXPLAIN PERFORMANCE，看算子级耗时）
EXPLAIN ANALYZE <慢SQL>;

-- 累计耗时 Top SQL（openGauss 需先建 pg_stat_statements 扩展）
SELECT * FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;
```

> **判读**：大表 `seq scan`、估算行数与实际差几个量级 → 统计信息或索引问题；
> `active` 查询多且都慢 → 全局性问题（资源 / 锁）；少量长查询 → 单点 SQL。

### 6.6 六步作业单（慢查询 / 连接池 / 锁）

| 步 | 动作 | 命令（详见 6.1–6.5） | 判读与分流 |
|:--:|---|---|---|
| ① | 应用侧看连接池 | Druid / Hikari 监控：`active` 接近 `max`、`wait` 大量增长 | `active=max` 且持续 → 有连接被长期占用；先确认 `max` 是否配太小 |
| ② | 应用侧看谁占着连接 | `jstack PID \| grep -A 15 socketRead` | 都等同一 SQL → 慢查询；各等各的 → DB 整体慢；借出未归还 → 泄漏（查异常分支是否漏 `finally close`） |
| ③ | DB 侧看谁在跑 | MySQL `SHOW FULL PROCESSLIST`；PG 见 6.5 | `active` 多且都慢 → 全局性问题；少量长查询 → 单点 SQL |
| ④ | DB 侧看锁等待 | MySQL `performance_schema.data_lock_waits`；PG `pg_locks` / `pg_blocking_pids` | 常见于大事务、唯一键并发冲突、外键 |
| ⑤ | 慢 SQL 分析 | `EXPLAIN ANALYZE`（6.2 / 6.5） | 危险信号：`type=ALL` / `key=NULL` / `rows` 很大 / `Using filesort` / `Using temporary` |
| ⑥ | 处置并复验 | 补索引 / 拆大事务 / 修泄漏 / 调池 / 隔离报表查询 | 用 ① 的 `active` 与 ② 的线程栈复验 |

---

## 第 7 章 Redis

### 7.1 命令链

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

### 7.2 大 key

```bash
redis-cli --bigkeys
# [00.00%] Biggest string found so far 'user:profile:10086' with 102400 bytes
# [45.12%] Biggest hash   found so far 'cart:user:9527' with 20453 fields
# -------- summary -------
# Sampled 100000 keys in the keyspace!
# Total key length in bytes is 4567890 (avg len 45.67)
# Biggest string found 'session:token:aaaa' has 5242880 bytes
```

```bash
# 离线最准：rdb 文件分析
pip install rdbtools python-lzf
rdb -c memory /data/dump.rdb --bytes 1024 > redis_memory.csv
sort -t, -k4 -nr redis_memory.csv | head -20
```

### 7.3 热 key

```bash
# 需开启 LFU 淘汰策略
redis-cli --hotkeys

# monitor 短时采样（生产慎用，会降性能）
redis-cli monitor | head -1000 | awk '{print $4}' | sort | uniq -c | sort -rn | head -20
```

**热 key 治理**：本地缓存（Caffeine）挡一层 → 热点 key 多副本打散 → 限流。

### 7.4 慢查询

```bash
redis-cli SLOWLOG GET 10
# 1) (integer) 1
# 2) (integer) 1716180000          # 时间戳
# 3) (integer) 15234               # 耗时（微秒）
# 4) 1) "KEYS"
#    2) "*"                        # 这条就是大坑命令

redis-cli SLOWLOG RESET
redis-cli CONFIG GET slowlog-log-slower-than   # 默认 10000 微秒 = 10ms
```

### 7.5 内存、淘汰与连接

```bash
redis-cli INFO memory
# used_memory_human: 3.82G
# maxmemory_human: 4.00G
# mem_fragmentation_ratio: 1.87   ← > 1.5 碎片严重

redis-cli INFO stats
# evicted_keys: 1523400           ← 大量淘汰 = 内存不足

redis-cli CONFIG GET maxmemory-policy    # 推荐 allkeys-lru / volatile-lru

redis-cli INFO clients
# connected_clients: 10000        ← 接近 maxclients 会拒绝连接
# blocked_clients: 23

redis-cli CLIENT LIST | head -20
redis-cli CONFIG GET maxclients
redis-cli INFO commandstats | sort -t= -k2 -rn | head   # 哪类命令最耗 CPU
```

### 7.6 缓存三大问题

| 问题 | 现象 | 方案 |
|---|---|---|
| **穿透** | 查 DB 不存在的数据，绕过缓存 | 空值缓存 + 布隆过滤器 |
| **击穿** | 热点 key 过期瞬间大量请求打到 DB | 互斥锁重建 / 逻辑过期永不失效 |
| **雪崩** | 大批 key 同时过期 | 过期时间加随机值 + 多级缓存 + 熔断降级 |

---

## 第 8 章 Kafka / RocketMQ 消息积压

### 8.1 现象

- 消费 Lag 持续增长
- 业务延迟（如订单状态不更新、通知延迟）

### 8.2 Kafka 命令链

```bash
# ① 查看所有消费者组及其 Lag
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --all-groups --describe

# 输出片段：
# GROUP        TOPIC    PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG   CONSUMER-ID
# order-group  order-msg     0        1523400         4523400      3000000  consumer-1
# order-group  order-msg     1        1523400         1523500          100  consumer-2
```

**判读**：分区 0 堆积 300 万、分区 1 几乎不堆积 → **消费能力不均 / 分区倾斜**。

```bash
# ② Topic 详情（PartitionCount / ReplicationFactor）
kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic order-msg

# ③ 消费者组成员
kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --describe --group order-group --members --verbose

# ④ 重置 offset（危险操作，需谨慎）
kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --group order-group --topic order-msg \
  --reset-offsets --to-earliest --execute
```

### 8.3 RocketMQ 命令链

```bash
# 消费堆积（#Diff 列即积压量）
mqadmin consumerProgress -n localhost:9876 -g order_consumer_group
# #Broker Name  #QID  #Broker Offset  #Consumer Offset  #Diff
# broker-a        0      1523400          4523400        3000000
# broker-a        1      1523400          1523500            100

# Topic 状态
mqadmin topicStatus -n localhost:9876 -t order_topic

# 消息轨迹（定位某条消息是否被消费）
mqadmin queryMsgById -n localhost:9876 -i <msgId>
```

### 8.4 根因与处置

| 根因 | 判断依据 | 处置 |
|---|---|---|
| 消费逻辑太慢 | 单条消费耗时高、线程池小 | 提高并发消费线程数、批量消费 |
| 分区/队列倾斜 | 个别分区 Lag 高 | 调整分区策略、扩容消费者 |
| 消费异常重试 | 日志大量异常、重试队列膨胀 | 修复业务异常，死信单独处理 |
| 下游依赖慢 | 消费中调用的 DB/RPC 慢 | 异步化、加缓存 |
| 突增流量 | 生产速率远超消费速率 | 临时扩容消费者实例 |

### 8.5 消费线程定位（JVM 侧）

```bash
# 找到 Kafka 消费线程
jstack 12345 | grep -A 20 "kafka-coordinator-heartbeat-thread\|order-group"

# 若卡在下游调用，栈会显示具体阻塞点；确认耗时用
trace com.demo.mq.OrderConsumer onMessage -n 3 '#cost > 500'
```

---

## 第 9 章 网关 502/504 与网络

### 9.1 现象

- 网关返回 502 Bad Gateway / 504 Gateway Timeout
- 部分用户报错、部分正常（区域性 / 实例性）

### 9.2 命令链

```bash
# ① Nginx 错误日志
tail -f /var/log/nginx/error.log
# 2024/05/20 10:23:11 [error] 1234#0: *5678 upstream timed out
#   (110: Connection timed out) while reading response header from upstream,
#   client: 10.0.0.5, server: api.demo.com,
#   request: "POST /order/create HTTP/1.1", upstream: "http://10.0.1.20:8080/order/create"

# ② 看 upstream 某台机器是否健康
curl -v http://10.0.1.20:8080/actuator/health

# ③ 网络连通性
telnet 10.0.1.20 8080
nc -zv 10.0.1.20 8080

# ④ TCP 连接状态（大量 TIME_WAIT / CLOSE_WAIT）
netstat -antp | awk '{print $6}' | sort | uniq -c | sort -rn
ss -s

# ⑤ 抓包（定位到具体握手/超时环节，下载后用 Wireshark 看三次握手、RST、重传）
tcpdump -i eth0 -nn host 10.0.1.20 and port 8080 -w /tmp/cap.pcap
```

### 9.3 状态码与连接状态判读

| 状态码 | 含义 | 排查方向 |
|---|---|---|
| **502** | 网关收到后端非法响应 / 后端挂了 | 后端进程存活？端口监听？ |
| **504** | 网关超时（后端处理太慢） | 后端慢、连接池、GC 停顿 |
| **499** | 客户端主动断开 | 用户端超时、网关超时设置太短 |
| **SYN Flood / 拒绝** | 无法建连 | 端口满、内核参数、防火墙 |

| 连接状态 | 根因 |
|---|---|
| 大量 `CLOSE_WAIT` | 应用没关闭连接（**代码连接泄漏**） |
| 大量 `TIME_WAIT` | 主动关闭方，短连接频繁 |
| 大量 `SYN_RECV` | 可能有 SYN Flood 攻击 |

```bash
# CLOSE_WAIT 定位到进程与 fd，回应用侧查连接是否泄漏
ss -antp | grep CLOSE_WAIT | head
```

### 9.4 内核参数速查

```bash
sysctl -a | grep -E "somaxconn|tcp_tw_reuse|ip_local_port_range|file-max"

sysctl -w net.core.somaxconn=32768
sysctl -w net.ipv4.tcp_tw_reuse=1
ulimit -n 655350                     # 单进程 fd 上限
# net.ipv4.ip_local_port_range        → 扩大端口范围
# fs.file-max                         → 调大
```

### 9.5 接口慢的分层定界（入口侧先分账）

```bash
# ① 分解一次请求的耗时构成
curl -o /dev/null -s -w "连接:%{time_connect} 首字节:%{time_starttransfer} 总:%{time_total}\n" \
  https://api.demo.com/order/query
# 首字节慢 → 服务端慢；连接慢 → 网络 / 端口积压；总慢但首字节快 → 响应体太大

# ② 用网关日志分清"网关慢"还是"应用慢"
# access log 对比 upstream_response_time（应用耗时）与 request_time（客户端总耗时）
# 两者接近 → 应用慢；两者都小但用户觉得慢 → 网络 / 客户端
```

分流去向：等 DB → 第 6 章；等下游 HTTP → 补超时 + 查下游；GC 停顿 → 第 3 章；线程池满 → 第 4 章；
方法级耗时 → 第 10 章 `trace`；CPU 不高但慢 → 第 11 章 `wall` 火焰图。

### 9.6 六步作业单（网络与连接堆积）

| 步 | 动作 | 命令（详见 9.2） | 判读与分流 |
|:--:|---|---|---|
| ① | 连接状态总览并对基线 | `ss -s` | 平时几千、突然几万 → 异常；再看是哪个状态在涨 |
| ② | 分状态计数 | `ss -antp \| awk '{print $1}' \| sort \| uniq -c \| sort -rn` | `CLOSE_WAIT` 堆积 → 本端没 close（代码 / 连接池）；`TIME_WAIT` 暴增 → 短连接（该上连接池 / 长连接） |
| ③ | 找 `CLOSE_WAIT` 归属 | `ss -antp state close-wait \| head` | 集中在数据库端口 → DB 侧已断而池没回收（查 `maxLifetime` / 空闲剔除）；集中在某外呼 → 查该组件 |
| ④ | 基础连通性 | `telnet host port` / `nc -zv host port` | 不通 → 防火墙 / 监听挂了；通但慢 → 对端负载高 |
| ⑤ | 抓包取证 | `tcpdump -i any host IP and port PORT -w /tmp/a.pcap` | Wireshark 看谁先发 FIN、有无重传 / 零窗，确定责任方 |
| ⑥ | 对照根因处置 | 连接池配 `maxLifetime` + 空闲检测；短连接改长连接 | 回 ① ② 复验状态分布是否回落 |

---

## 第 10 章 Arthas 指令集与 tt ognl 深度实战

> Arthas 是线上排查的"瑞士军刀"，无需重启、无需改代码。

```bash
java -jar arthas-boot.jar            # 交互选择进程
java -jar arthas-boot.jar <pid>      # 直接 attach
```

### 10.1 高频指令表

| 指令 | 用途 | 示例 |
|---|---|---|
| `dashboard` | 实时大盘（线程+内存+GC） | `dashboard` |
| `thread` | 线程分析 | `thread -n 3` 最忙线程；`thread -b` 找阻塞元凶 |
| `jad` | 反编译类 | `jad --source-only com.demo.service.OrderService` |
| `watch` | 观测方法入参/出参/异常 | `watch com.demo.service.OrderService query "{params,returnObj}" -x 3` |
| `trace` | 方法调用耗时链路 | `trace com.demo.service.OrderService query` |
| `stack` | 查看方法被谁调用 | `stack com.demo.service.OrderService query` |
| `tt` | 录制方法调用现场（可回放） | `tt -t com.demo.service.OrderService query` |
| `sc` | 查找类 | `sc -d com.demo.service.*` |
| `sm` | 查找方法 | `sm com.demo.service.OrderService` |
| `ognl` | 执行表达式（读/改静态字段） | `ognl '@com.demo.Config@DEBUG'` |
| `getstatic` | 读静态字段 | `getstatic com.demo.config.FeatureConfig DEBUG` |
| `profiler` | 生成火焰图 | `profiler start` / `profiler stop` |
| `heapdump` | dump 堆 | `heapdump /tmp/heap.hprof` |
| `vmtool` | 内存对象查询 | `vmtool --action getInstances --className java.lang.String` |

### 10.2 trace：找最慢的子调用

```bash
# 展开 5 层调用，只显示耗时 > 100ms 的
trace com.demo.service.OrderService createOrder -n 5 '#cost > 100'
```

```text
`---ts=2024-05-20 10:23:11;thread_name=http-nio-8080-exec-5;id=25;is_daemon=true
    `---[412.34ms] com.demo.service.OrderService:createOrder()
        +---[2.11ms] com.demo.dao.OrderDao:insert()
        +---[398.20ms] com.demo.client.InventoryClient:deduct()   ← 慢在这里
        `---[10.02ms] com.demo.mq.OrderProducer:send()
```

### 10.3 watch：看某方法的真实入参

```bash
watch com.demo.service.OrderService createOrder \
  '{params[0], params[1], returnObj, throwExp}' -x 3 -b -s
# -x 3 展开 3 层，-b 方法调用前，-s 方法返回后
```

### 10.4 tt：时光隧道（录制 + 事后回放）

**为什么需要**：`trace` / `watch` 是**"实时盯梢"**，只有你盯着的这一刻发生的调用才能被捕获；
线上问题常常**偶发**（某个参数组合、某个用户、某个时间点才触发）。

| 工具 | 时效性 | 能否回溯 |
|---|---|---|
| `watch` | 实时 | ❌ 只能看当下 |
| `trace` | 实时 | ❌ 只能看当下 |
| `tt` | **录制 + 事后** | ✅ 可检索任意历史调用 |

#### ① 录制

```bash
tt -t com.demo.service.OrderService createOrder
#  INDEX   TIMESTAMP            COST(ms)  IS-RET  IS-EXP   OBJECT         CLASS          METHOD
#  1000    2024-05-20 10:23:11  12.34     true    false    0x3f2a1b0c     OrderService   createOrder
#  1002    2024-05-20 10:23:15  4210.55   true    false    0x9b4e5f6a     OrderService   createOrder  ← 这条慢！
```

| 字段 | 含义 |
|---|---|
| `INDEX` | 调用序号（后续检索用） |
| `TIMESTAMP` / `COST(ms)` | 调用时间 / 耗时 |
| `IS-RET` / `IS-EXP` | 是否正常返回 / 是否抛异常 |
| `OBJECT` | 对象 hash（区分实例） |
| `CLASS` / `METHOD` | 类名 / 方法名 |

#### ② 过滤：只录关心的调用

```bash
tt -t com.demo.service.OrderService createOrder '#cost > 500'                        # 只录 > 500ms
tt -t com.demo.service.OrderService createOrder 'throwExp != null'                   # 只录抛异常
tt -t com.demo.service.OrderService createOrder 'params[0] == 10086'                 # 只录特定入参
tt -t com.demo.service.OrderService createOrder '#cost > 1000 && params[0].userId == 9527'
tt -t com.demo.service.OrderService createOrder '#cost > 1000' -n 200                # 推荐：限条数防内存涨
```

> tt 内置变量：`params[]` 入参数组、`returnObj` 返回值、`throwExp` 异常、`#cost` 耗时(ms)、`target` 当前实例。

#### ③ 检索与看现场

```bash
tt -l                                  # 列出录制（默认最多 100 条）
tt -l | sort -k3 -rn | head             # 按耗时倒序
tt -i 1000                             # 看某条完整现场
#  INDEX:          1000
#  GMT-CREATE:     2024-05-20 02:13:11
#  COST(ms):       4521.22
#  PARAMETERS:
#     [0]=10086
#     [1]={"userId":9527,"items":[...],"couponId":"CPN999"}
#  RETURN-ON:
#     {"orderId":"ORD20240520001","status":"PAID"}
```

**这是"复现偶发问题"的核心能力**：`tt -i` 能把那一刻**完整入参和返回值**打出来。

#### ④ 子命令全集

```bash
tt -l                  # 列出现有录制
tt -i <INDEX>          # 查看某条详情
tt -d <INDEX>          # 删除单条；tt -d 删除全部
tt -m <INDEX> <NEW>    # 修改索引号
tt --stat              # 耗时分布报告
```

```text
tt --stat
+----------------------------------------------------+
|  COST(ms)  |  COUNT  |  PERCENT  |  PERCENT(累计)  |
+----------------------------------------------------+
|  0-10      |  8234   |  82.34%   |  82.34%        |
|  10-50     |  1200   |  12.00%   |  94.34%        |
|  50-100    |  400    |   4.00%   |  98.34%        |
|  100-1000  |  150    |   1.50%   |  99.84%        |
|  >1000     |   16    |   0.16%   | 100.00%        |
+----------------------------------------------------+
# 有 16 次调用超过 1 秒 → 这些就是问题所在
```

#### ⑤ 回放：复现与验证

```bash
tt -i 1000 -p                                   # 重新执行一遍
# RE-INDEX: 2000
# COST(ms): 4120.33        ← 重放了依然慢 → 问题可复现
tt -i 1000 -p --params '99999'                  # 改入参后回放
```

> ⚠️ **安全警告**：`-p` 会**真实执行业务逻辑**（可能写库、发消息）！
> 生产回放**必须极其谨慎**，优先在预发/测试环境操作；修复后用它验证耗时是否下降。

#### ⑥ 完整案例：偶发慢订单排查

**背景**：订单创建接口偶发 4–5 秒，复现困难，白天不明显。

```bash
# Step 1：挂 tt，只录慢的，让它跑一整晚
tt -t com.demo.service.OrderService createOrder '#cost > 3000'

# Step 2：次日早上检索
tt -l
#  1000    2024-05-20 02:13:11  4521.22
#  1001    2024-05-20 03:41:52  5120.88

# Step 3：看第一条现场，找共性
tt -i 1000
#  PARAMETERS:
#     [0]=10086
#     [1]={"userId":9527,"items":[...],"couponId":"CPN999"}   ← 都带 couponId

# Step 4：用 trace 深挖
trace com.demo.service.CouponService calcDiscount -n 3
#  `---[3980.12ms] CouponService:calcDiscount()
#       +---[3975.33ms] CouponDao.queryUserCoupons()   ← 慢 SQL！
```

**根因**：`user_coupon` 表缺索引，带 `couponId` 的订单走全表扫描（修好见 [第 6 章](#第-6-章-慢-sql-与数据库连接池)）。

#### ⑦ tt 注意事项

| 事项 | 说明 |
|---|---|
| **内存占用** | 录制会占内存，长跑需 `-n` 限条数或定期 `tt -d` 清理 |
| **高频方法慎用** | 录制本身开销小，但 QPS 上万的方法慎用 |
| **回放安全** | `-p` 会真实执行，禁止对写操作随意回放 |
| **退出清空** | Arthas 退出后录制数据丢失，需及时分析 |

### 10.5 jad + mc + retransform：热更新（应急）

```bash
# 1. jad 反编译拿到源码
jad --source-only com.demo.service.OrderService > /tmp/OrderService.java
# 2. 修改后编译
mc -c 3b7fb8c8 /tmp/OrderService.java -d /tmp
# 3. 热替换
retransform /tmp/com/demo/service/OrderService.class
```

> ⚠️ **热更新是应急手段**，改完必须尽快走正式发布流程覆盖。

### 10.6 ognl 高级用法：动态调试

OGNL（Object-Graph Navigation Language）是表达式语言，Arthas 内置 `ognl` 命令，
可在**运行中的 JVM 里读取/修改对象、调用方法、遍历容器** —— 不改代码、不重启。

```bash
ognl '<表达式>'                 # 整个表达式用引号包住
ognl '#context'                 # 当前上下文
ognl '#classLoader'             # 当前类加载器
```

#### ① 读写静态字段（应急开关）

```bash
getstatic com.demo.config.FeatureConfig DEBUG        # field: DEBUG  @Boolean[false]
ognl '@com.demo.config.FeatureConfig@DEBUG'          # @Boolean[false]
ognl '@com.demo.config.FeatureConfig@DEBUG = true'   # 动态打开（临时）
```

> ⚠️ `final` 字段无法修改；修改**重启即失效**，务必同步回代码/配置。

#### ② 读运行时配置（排查"配置为何不生效"）

```bash
ognl '@com.demo.config.Constants@ERROR_CODES'
ognl '@com.demo.config.Constants@ERROR_CODES.get("1001")'
ognl '@com.demo.config.Constants@ERROR_CODES.keySet()'
ognl '@com.demo.config.Constants@WHITE_LIST.size()'
ognl '@com.demo.config.Constants@WHITE_LIST.contains("10.0.0.5")'
```

直接看**运行时真实加载的配置**，避免"本地改了没发布""配置中心没推送成功"的困惑。

#### ③ 调用方法

```bash
ognl '@com.demo.util.DateUtils@format(new java.util.Date())'
ognl '@java.lang.System@currentTimeMillis()'
ognl '@java.lang.System@getProperty("java.version")'
ognl '@java.lang.System@getenv("JAVA_HOME")'
```

#### ④ 查 Spring 容器 Bean（Spring 项目王牌用法）

```bash
# Spring Boot 2.x 取上下文
ognl '@org.springframework.web.context.ContextLoader@getCurrentWebApplicationContext()'
# 或项目自定义静态持有
ognl '@com.demo.util.SpringContextUtil@getBean("orderService")'
ognl '@com.demo.util.SpringContextUtil@getBean("dataSource")'

# 线程池实时状态（"配了但没生效"一查便知）
ognl '@com.demo.util.SpringContextUtil@getBean("orderExecutor").getActiveCount()'
ognl '@com.demo.util.SpringContextUtil@getBean("orderExecutor").getQueue().size()'
ognl '@com.demo.util.SpringContextUtil@getBean("orderExecutor").getPoolSize()'
```

#### ⑤ 遍历、投影与筛选

```bash
ognl '@com.demo.config.ServerConfig@SERVERS.{? #this.port == 8080}'   # 条件筛选
ognl '@com.demo.config.ServerConfig@SERVERS.{host}'                   # 投影取属性
ognl '@com.demo.config.ServerConfig@SERVERS.size()'
ognl '@com.demo.config.StatsConfig@COUNTERS.{ #this }.sum()'
```

#### ⑥ 与 watch / tt 联动

```bash
# watch 里用 ognl 加工输出
watch com.demo.service.OrderService createOrder \
  '{params[0], params[1].userId, @com.demo.util.DateUtils@format(new java.util.Date())}' -x 3

# 只观察特定条件
watch com.demo.service.OrderService createOrder 'returnObj' 'params[0] > 10000' -x 2

# tt 里用 ognl 做录制条件
tt -t com.demo.service.OrderService createOrder '@com.demo.config.FeatureConfig@DEBUG == true'
```

#### ⑦ JVM 运行时指标

```bash
ognl '@java.lang.Runtime@getRuntime().availableProcessors()'
ognl '@java.lang.Runtime@getRuntime().maxMemory()'
ognl '@java.lang.Runtime@getRuntime().freeMemory()'
ognl '@java.lang.System@gc()'          # 触发一次 Full GC（更推荐 Arthas 自带命令）
```

#### ⑧ ognl 安全与注意事项

| 事项 | 说明 |
|---|---|
| **改字段风险** | 立即生效，可能导致业务异常，操作前想清楚 |
| **final 字段** | 无法修改 |
| **不可持久** | 重启失效，必须回写代码/配置 |
| **权限** | 生产 `ognl` 是**高危操作**，需审批 + 记录 |
| **类名要全** | 必须用**全限定类名**（含包名） |
| **表达式引号** | shell 里注意嵌套，整个表达式用单引号包住 |

```bash
# 表达式内部含双引号时，外层用单引号
ognl '@com.demo.config.Constants@MAP.get("key")'
```

---

## 第 11 章 async-profiler 火焰图

### 11.1 为什么需要火焰图

`jstack` 只能看到**某一瞬间**的线程快照，无法回答：

- 一个接口 80% 的时间花在**哪些方法**上？
- CPU 热点到底在哪里？
- 内存分配的热点在哪里？

**火焰图**把"一段时间内的调用分布"可视化——它不是快照，而是**统计采样**。

| 工具 | 优点 | 缺点 |
|---|---|---|
| JVisualVM | 图形化 | 需 GUI、开销大 |
| JProfiler | 功能全 | 商业收费 |
| perf | 系统级 | **不识别 Java 栈** |
| **async-profiler** | **低开销、无 safe-point 偏差、支持 CPU/内存/锁/wall** | 命令行使用 |

**核心优势**：基于 `AsyncGetCallTrace` + `perf_events`，**不依赖安全点（Safe Point）**，
能精确采集真实热点，开销通常 **< 2%**。

### 11.2 安装

```bash
wget https://github.com/async-profiler/async-profiler/releases/download/v3.0/async-profiler-3.0-linux-x64.tar.gz
tar -zxvf async-profiler-3.0-linux-x64.tar.gz && cd async-profiler-3.0-linux-x64
# bin/ 可执行文件   lib/ 依赖库   profiler.sh 主脚本
```

> Arthas 已内置 async-profiler，**不必单独安装**（见 11.9）。

### 11.3 基础用法与事件类型

```bash
# 语法：./profiler.sh [选项] <pid>

./profiler.sh -d 30 -f /tmp/cpu.html <PID>       # 采 30 秒 CPU，输出 HTML
./profiler.sh start <PID>; sleep 30; ./profiler.sh stop <PID>   # 或手工启停

# 四种采集对象
./profiler.sh -e cpu   -d 30 -f /tmp/cpu.html   PID   # CPU 热点（默认）
./profiler.sh -e alloc -d 30 -f /tmp/alloc.html PID   # 内存分配 ← 内存问题神器
./profiler.sh -e lock  -d 30 -f /tmp/lock.html  PID   # 锁竞争
./profiler.sh -e wall -t -d 30 -f /tmp/wall.html PID  # 墙钟（含 IO 等待/睡眠）
```

生成的 HTML **下载到本地用浏览器打开**即可交互查看。

### 11.4 怎么读图

```
        ┌──────────────────────────────────┐
        │           root                    │   ← 顶部只有一层
        ├─────────────┬──────────┬─────────┤
        │  main       │  GC      │  JIT    │   ← 越往下越"亮"（耗时越多）
        ├──────┬──────┼──────┬───┴─────────┤
        │  A   │  B   │  C   │   D         │
        ├──┬───┴──┬───┴──┬───┴──┬──────────┤
        │  │      │      │      │          │   ← 顶层是"当前正在执行的方法"
        └──┴──────┴──────┴──────┴──────────┘
```

**四要素**：

1. **Y 轴 = 调用栈深度**：下面是调用者，上面是被调用者
2. **X 轴 = 采样占比（不是时间顺序！）**：**越宽的方块 = 耗时越多**
3. **顶层方块**：正在实际执行的方法（叶子方法）
4. **颜色**：随机色，无固定含义（部分版本按类型着色）

**看图三原则**：

> 1. 直接找**最宽的顶层方块** —— 那就是热点
> 2. 从热点**往下看调用链** —— 找到业务入口
> 3. **窄而高的"塔尖"** 是偶发调用，通常忽略

### 11.5 案例一：CPU 飙高（cpu 模式）

**背景**：某服务 CPU 持续 90%，`jstack` 多次抓取都看到"一堆 RUNNABLE 但栈五花八门"。

```bash
./profiler.sh -e cpu -d 30 -f /tmp/cpu.html <PID>
```

```text
最宽的顶层方块：
 ┌────────────────────────────────────────────────────────┐
 │ ... Web 请求入口 ...                                    │
 │   └─ OrderService.createOrder                          │
 │        └─ PriceCalculator.calcPrice        ← 超宽！     │
 │             └─ BigDecimal.multiply          ← 顶层最宽  │
 │                  └─ BigInteger.multiply                  │
 └────────────────────────────────────────────────────────┘
```

**结论**：`BigDecimal.multiply` 占近 60% 采样 → CPU 全耗在**高精度浮点乘法**（循环内大量 BigDecimal 运算）。
**修复**：改用 `long`（以"分"为单位）整数运算 / 缓存计算结果 / 降低精度位数。

### 11.6 案例二：内存分配热点（alloc 模式）

**背景**：Young GC 每秒好几次，但堆不算小。

```bash
./profiler.sh -e alloc -d 30 -f /tmp/alloc.html <PID>
```

```text
 └─ ...业务链路...
      └─ LogUtil.buildLogMessage          ← 超宽
           └─ StringBuilder.toString
                └─ char[] 分配            ← 顶层最宽，占 45%
```

**结论**：大量 `char[]` 是**日志拼接**产生的 —— 高频打日志（循环里打、或开了 DEBUG 打印大对象）。
**修复**：加级别判断 / 用占位符 `log.info("{}", obj)` / 降日志级别 / 关无用日志。

### 11.7 案例三：锁竞争（lock 模式）

**背景**：接口 RT 高但 CPU 不高，怀疑锁竞争。

```bash
./profiler.sh -e lock -d 30 -f /tmp/lock.html <PID>
```

```text
 └─ ...业务链路...
      └─ OrderService.updateStock
           └─ synchronized (OrderService.class)  ← 大面积阻塞
```

**结论**：库存更新用了**类级别锁**（粒度太大），所有订单串行化。
**修复**：锁粒度细化到商品维度（`synchronized (productId)`）或分段锁 / Redis 分布式锁。

### 11.8 案例四：CPU 不高但接口慢（wall 模式）

**背景**：接口 RT 3 秒，CPU 只有 10%。

```bash
./profiler.sh -e wall -t -d 30 -f /tmp/wall.html <PID>
```

```text
 └─ http-nio-exec-15
      └─ OrderService.query
           └─ HttpClient.execute        ← 超宽
                └─ SocketInputStream.socketRead0   ← 卡在网络 IO
```

**结论**：慢在下游 HTTP 调用（第三方响应慢）。
**修复**：加超时 + 降级 + 缓存，或改异步调用。

> **wall vs cpu 的关键区别**：CPU 不高但慢 → **一定用 wall**，cpu 模式看不到等待时间。

### 11.9 Arthas 内置 profiler

```bash
profiler start
profiler stop --format html --file /tmp/cpu.html
profiler start -e alloc      # 采集内存分配
profiler start -e lock       # 采集锁竞争
profiler status
```

### 11.10 参数速查与无 GUI 用法

```bash
./profiler.sh -h                    # 帮助
-e <event>      # 事件：cpu / alloc / lock / wall / itimer
-d <seconds>    # 持续秒数
-f <file>       # 输出（.html 交互 / .jfr / .collapsed / flat）
-t              # 按线程拆分（wall 常用）
-i <ms>         # 采样间隔（默认 10ms）
--all-threads   # 采集所有线程（默认只采活跃的）
-o <option>     # 输出格式：collapsed / flat
```

```bash
# flat：不方便开 HTML 时直接打文本排行（最快定位）
./profiler.sh -e cpu -d 30 -o flat -f /tmp/flat.txt PID
cat /tmp/flat.txt
# Total samples: 45231
#       Frame                              Samples   %
#   java.math.BigDecimal.multiply          27138   60.00%   ← 一眼定位
#   java.lang.StringBuilder.toString         4523   10.00%
#   com.demo.service.PriceCalculator.calc   2714    6.00%

# collapsed：原始折叠数据（可自定义分析），每行 "栈帧;栈帧 采样次数"
./profiler.sh -d 30 -o collapsed -f /tmp/flame.collapsed PID

# JFR：可导入 JMC 深度分析
./profiler.sh -d 30 -f /tmp/prof.jfr PID
```

### 11.11 注意事项

| 事项 | 说明 |
|---|---|
| **权限** | 需与目标进程同用户，或 root |
| **采样开销** | 通常 < 2%，生产可用 |
| **容器环境** | 需 `--privileged` 或放开 `perf_event_paranoid` |
| **perf 权限** | `sysctl -w kernel.perf_event_paranoid=-1`（或用 `-e itimer` 规避） |
| **采样时长** | 太短不准，建议 30 秒以上；偶发问题需长时间采集 |
| **图表解读** | X 轴是**占比不是时间**，不要误读为时序 |
| **磁盘** | 长时间采集会占磁盘，采完及时清理 |

```bash
# 容器/受限环境 fallback（不需要 perf_events）
./profiler.sh -e itimer -d 30 -f /tmp/cpu.html PID
```

---

## 第 12 章 联合排查实战与工具选型

### 12.1 完整闭环：接口偶发 RT 高 + CPU 中等

```bash
# ── Step 1：tt 录制，抓出偶发慢调用 ──────────────────
tt -t com.demo.service.OrderService createOrder '#cost > 2000' -n 100
tt -l
#  1000    02:13:11   4521.22
#  1001    03:41:52   5120.88
tt -i 1000
#  PARAMETERS: [0]=10086  [1]={...,"source":"APP"}   ← 发现都来自 APP 端

# ── Step 2：trace 定位到具体子调用 ──────────────────
trace com.demo.service.OrderService createOrder -n 5 '#cost > 1000'
#  `---[4521ms] createOrder()
#       +---[2ms]    OrderDao.insert()
#       +---[4120ms] PriceCalculator.calc()   ← 慢在这里
#       `---[10ms]   OrderProducer.send()

# ── Step 3：火焰图确认 CPU/耗时热点 ──────────────────
./profiler.sh -e cpu -d 30 -o flat -f /tmp/flat.txt <PID>
#  java.math.BigDecimal.multiply   60.00%   ← 印证是计算问题

# ── Step 4：ognl 查运行时开关 ───────────────────────
ognl '@com.demo.config.PriceConfig@HIGH_PRECISION'
#  @Boolean[true]   ← 走了 BigDecimal 高精度路径

# ── Step 5：临时验证（改开关观察效果，高危需审批）────
ognl '@com.demo.config.PriceConfig@HIGH_PRECISION = false'

# ── Step 6：修复后 tt 回放验证 ───────────────────────
tt -i 1000 -p
#  COST(ms): 320.11   ← 从 4521ms 降到 320ms，验证通过
```

### 12.2 工具选择决策树

```
问题现象是什么？
│
├─ CPU 高 ──────────────→ 火焰图(cpu) + jstack + Arthas thread -n
│
├─ 内存涨/OOM ──────────→ jmap dump + MAT + 火焰图(alloc)
│
├─ GC 频繁 ─────────────→ jstat + GC日志 + 火焰图(alloc) 找分配热点
│
├─ 接口慢但CPU不高 ─────→ 火焰图(wall) + trace
│
├─ 偶发问题难复现 ──────→ tt 录制 + 事后检索 + 回放
│
├─ 配置/参数不生效 ─────→ ognl 读运行时值 + getstatic
│
├─ 线程阻塞/死锁 ───────→ jstack + Arthas thread -b + 火焰图(lock)
│
└─ 方法级耗时 ──────────→ Arthas trace / watch
```

### 12.3 各场景首选工具 / 一句话命令

| 你想做的事 | 首选命令/工具 |
|---|---|
| CPU 高 | `top -H -p` + `jstack` / `thread -n 3` / `profiler -e cpu` |
| 内存泄漏 | `jmap -dump` + MAT（+ `profiler -e alloc`） |
| GC 频繁 | `jstat -gcutil` + GC 日志（+ `profiler -e alloc`） |
| 线程阻塞 | `jstack` 状态统计 / `thread -b` |
| 死锁 | `jstack \| grep -A 30 deadlock` |
| 慢 SQL | 慢查询日志 + `EXPLAIN` |
| 连接池 | Actuator `hikaricp.*` 指标 |
| Redis 大 key | `redis-cli --bigkeys` |
| MQ 积压 | `kafka-consumer-groups.sh --describe` |
| 网关 502/504 | Nginx `error.log` + `tcpdump` |
| 抓到偶发调用现场 | `tt -t <类> <方法> '#cost > N'` |
| 看历史某次调用 | `tt -i <INDEX>` |
| 重放历史调用 | `tt -i <INDEX> -p` |
| 录制耗时分布 | `tt --stat` |
| 方法级耗时 | `trace <类> <方法> '#cost > N'` |
| 方法入参出参 | `watch <类> <方法> '{params,returnObj}' -x 3` |
| 读运行时静态字段 | `ognl '@类@字段'` / `getstatic 类 字段` |
| 改运行时静态字段 | `ognl '@类@字段 = 新值'` |
| 调运行时 Bean 方法 | `ognl '@工具类@getBean("x").getActiveCount()'` |
| 无 GUI 快速看排行 | `profiler -e cpu -o flat -f x.txt PID` |
| 慢但 CPU 低 | `profiler -e wall -t -d 30` |

---

## 第 13 章 日志风暴与磁盘满

### 13.1 现象与阈值

- `df` 使用率 100%，业务写入失败（日志、临时文件、DB 落盘一起挂）
- 日志每分钟增长 GB 级
- 同一异常重复刷屏（异常风暴）
- 清理文件后空间不释放
- **阈值**：磁盘 > 85% 告警；同一异常每秒几十次 = 风暴

### 13.2 命令链

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

### 13.3 现场判读

- 同一异常每秒几十次**全栈**打印 → 异常风暴（典型：下游挂了，每个请求都打一遍全栈）
- 单一异常占比极高 → 先降级别 / 限频止血，再修根因
- `lsof | grep deleted` 有输出 → 文件已删但进程仍持句柄，空间不释放：
  让进程关句柄（重启）或 `truncate` 该 fd；**`echo "" > 大日志` 比 `rm` + 重启更稳妥**
- 不要 `rm` 正在被写的日志文件（空间不会立即释放，且丢证据）

### 13.4 六步作业单

| 步 | 动作 | 命令（详见 13.2） | 判读与分流 |
|:--:|---|---|---|
| ① | 找到满的挂载点 | `df -h; df -i` | 确认哪个目录所在盘满；inode 用光也会报"空间不足" |
| ② | 逐层定位大目录 | `du -sh /* \| sort -rh \| head` | 应用日志目录暴增 → 优先判断是否异常风暴 |
| ③ | 识别是否日志风暴 | `tail -1000 <log> \| grep Exception \| sort \| uniq -c \| sort -rn \| head` | 同一异常高频全栈 → 风暴；单一异常占绝对多数 → 先降级别 / 限频 |
| ④ | 清盘后空间不释放 | `lsof \| grep deleted` | 句柄未释放 → `truncate` 该 fd 或重启进程 |
| ⑤ | 恢复与止损 | 顺序：日志降级 / 抑制重复 → rotate 清旧日志 → 修根因（下游恢复 / SQL 修正）→ 撤临时措施 | 临时措施必须留痕，否则复盘无从追溯 |
| ⑥ | 防复发 | `logrotate` 按天 + 保留 N 份；磁盘告警 85%；异常聚合限频打印；清理脚本纳入例行运维 | 生产 debug 未关也是常见根因 |

### 13.5 根因与处置

| 根因 | 处置 |
|---|---|
| 异常风暴：同一异常高频全栈打印 | 异常聚合 / 限频；降级别；修下游根因 |
| 下游故障导致重试 / 断连日志刷屏 | 补超时与退避，避免"超时→重试→更慢"放大日志 |
| 日志级别不当（生产 debug 未关） | 发布基线固化日志级别；配置中心下发 |
| 轮转缺失：日志无限增长 | `logrotate` 按天 + 保留份数 + 压缩 |
| 被删文件仍被进程占用，空间不释放 | `lsof \| grep deleted` → `truncate` / 重启 |

---

## 第 14 章 服务假死

> "进程活着但请求全超时"是独立形态，比崩溃更难——因为所有现象看起来都"正常"。

### 14.1 现象与阈值

- 进程存活、端口在监听，但请求全部超时
- 健康检查 UP 变 DOWN，但进程不退出
- CPU 极低，或某单核打满
- 重启后短时间内又复发

### 14.2 命令链

```bash
# ① 本机直连，绕开网关
curl -v --max-time 5 http://127.0.0.1:8080/actuator/health

# ② 抓栈看工作线程在干嘛（Tomcat 线程名）
jstack <PID> > /tmp/s.txt
grep -A 15 "http-nio-.*exec" /tmp/s.txt | head -60

# ③ 排查 GC 死循环
jstat -gcutil <PID> 1000 10

# ④ 看是否单点串行瓶颈（卡在 log / flush / 同步块）
grep -B 2 -A 8 "flush\|Logger\|synchronized" /tmp/s.txt | head -60

# ⑤ 保现场再重启
jstack <PID> > /tmp/s1.txt; sleep 5; jstack <PID> > /tmp/s2.txt
```

### 14.3 现场判读

| 观察 | 判读与去向 |
|---|---|
| 本机直连也 hang | 应用自身问题（继续 ②③④） |
| 本机正常、经网关超时 | 网关 / 网络问题 → 第 9 章 |
| 全 `WAITING` 空闲但请求进不来 | 线程池 / accept 配置问题（`maxThreads`、`acceptCount`） |
| 全 `BLOCKED` | 锁死 / 锁竞争 → 第 5 章 |
| 全卡 `socketRead` | 下游全慢，线程池被拖死 → 第 4 章 |
| `O` 长期 100% + 每秒 FGC 且单次极长 | 堆陷入 GC 循环（接近 OOM 的假死形态）→ 第 2 章 |
| 栈里卡在同步日志 / `flush` | 单线程瓶颈堵死入口 → 改异步 / 加缓冲 / 批量 |

### 14.4 六步作业单

| 步 | 动作 | 命令（详见 14.2） | 判读与分流 |
|:--:|---|---|---|
| ① | 确认入口层真实状态 | `curl -v --max-time 5 http://127.0.0.1:<port>/health` | 本机也 hang → 应用自身；本机正常 → 网关 / 网络 |
| ② | 抓栈看工作线程 | `jstack PID`；搜 `http-nio-*-exec-*` | 全 WAITING 空闲 → 池 / accept 配置；全 BLOCKED → 锁死；全 `socketRead` → 下游拖死 |
| ③ | 排查 GC 死循环 | `jstat -gcutil PID 1000 10` | `O` 100% + 每秒 FGC 且耗时极长 → 转第 2 章 |
| ④ | 查单点串行瓶颈 | 看栈里是否卡在 `log` / `flush` / 同步块 | 单线程卡死 / 同步刷盘堵入口 → 拆异步 / 加缓冲 / 改批量 |
| ⑤ | 保现场再重启 | 两份 jstack + heap dump + `jstat` + 日志尾部 + `top`（见 15.4） | 假死现场重启即失，先花 1–2 分钟抓齐落 `/tmp` 并拷出 |
| ⑥ | 复盘定位根因 | 按抓到的栈分类 | 死锁 → 第 5 章；GC 循环 → 第 2 章；全卡外呼 → 补超时；修后压测验证不复现 |

### 14.5 根因与处置

| 根因 | 处置 |
|---|---|
| 堆耗尽引发 GC 死循环（最常见） | 按第 2 章定位泄漏；临时扩堆 / 重启止血 |
| 线程池全被无超时外呼占满 | 所有外呼补 `connectTimeout` / `readTimeout` + 熔断降级 |
| 全局锁死锁 | 统一加锁顺序 / 缩小临界区 |
| 单线程瓶颈阻塞入口 | 拆异步、加缓冲、批量处理 |
| 日志 / 磁盘 IO 卡住同步写 | 异步 appender + 磁盘告警 |

---

## 第 15 章 应急响应与故障工单

### 15.1 何时进入应急

- 线上大面积报错 / 不可用（影响用户，不等人）
- 存在资金或数据一致性风险
- 需要立即决策（重启 / 切流 / 降级 / 回滚）却没人拍板

### 15.2 六步作业单（先恢复，再定位）

| 步 | 动作 | 要点 |
|:--:|---|---|
| ① | 评估影响面（1 分钟内） | 哪些接口、哪些用户？有无资损 / 数据一致性风险？影响面决定动作级别；**数据类风险（重复写入、半提交）优先保全数据**，不急着恢复 |
| ② | 快速止血 | 按成本从低到高：重启实例（无状态服务首选）→ 摘除节点 / 切流量 → 开降级开关 → 版本回滚；止血动作必须留痕：谁、几点、做了什么 |
| ③ | 止血前保现场（2 分钟） | 两份 `jstack`、heap dump、`jstat` 采样、日志尾部、`top`，落 `/tmp` 并拷出；宁可多花 2 分钟，也不要重启后从零猜 |
| ④ | 观察恢复后状态 | 立即验证接口成功率、线程数、内存基线、连接数；快速反弹 → 周期性问题未根治，重点盯 |
| ⑤ | 落工单记录时间线 | 时间线（发现 / 响应 / 止血 / 恢复）、现象、临时措施；已定位的根因与永久修复项列清 |
| ⑥ | 复盘与防复发 | 48 小时内出复盘：根因、为何没被提前发现（监控缺口）、永久修复项与负责人；同类故障步骤沉淀回本篇 |

### 15.3 止血手段的成本排序

```
重启实例（无状态） → 摘节点 / 切流 → 开降级开关 → 版本回滚
```

- 能摘流就不要重启，能重启就不要改代码（`retransform` 是最后的应急手段）
- 一次只改一个变量，否则无法归因
- 30 分钟定不了位就升级（拉上 DBA / 中间件 / 网络）

### 15.4 保现场一键采集

```bash
# 手工版（最少集）
jstack <PID> > /tmp/s1.txt; sleep 5; jstack <PID> > /tmp/s2.txt
jstat -gcutil <PID> 1000 10
top -b -n 1 -p <PID>
netstat -antp | grep <PID> | wc -l

# 完整版（推荐）：同目录脚本，产物 tar.gz 可带走离线分析
./jvm_diag.sh <PID>
```

### 15.5 故障工单字段（建库 / 建表照此）

| 字段 | 类型 | 必填 | 说明 |
|---|---|:--:|---|
| `id` | string | ✅ | 自动生成 |
| `title` | string（≤60） | ✅ | 如"iface 节点2 OOM 重启" |
| `type` | enum | ✅ | 故障类型（0.6 表十选一） |
| `severity` | enum | — | P1 紧急 / P2 高 / P3 中（默认）/ P4 低 |
| `status` | enum | — | 排查中（默认）/ 已定位 / 已解决 |
| `symptom` | text（≤600） | — | 现象 |
| `root_cause` | text（≤600） | — | 根因 |
| `solution` | text（≤600） | — | 解决措施 |
| `done_steps` | text（≤2000） | — | 步骤进度（存 JSON 数组，勾选到第几步） |
| `note` | text（≤800） | — | 复盘笔记 |
| `resolved_at` | string（≤40） | — | 解决时间 |
| `created_at` | datetime | ✅ | 自动生成 |

> **填写纪律**：时间线要能还原"发现 → 响应 → 止血 → 恢复"；临时措施与永久修复分开写；
> 根因未定位时 `status` 保持"排查中"，不提前写"已解决"。

### 15.6 应急失分点

- 无监控告警导致发现滞后（用户先于监控发现）
- 止血动作无留痕，复盘时时间线拼不出来
- 现场未保存就重启，根因永久丢失
- 修复未验证就宣布恢复，短时复发
- 只修现象不改监控，同类故障重复发生

---

## 附录 速查索引 / 口诀 / 安全红线 / 使用方式

### A.1 一页纸记忆口诀

```
CPU 高     → 火焰图 cpu 找最宽方块
内存涨     → dump + MAT + 火焰图 alloc
GC 频繁    → jstat 看 O 列 + alloc 找分配源
接口慢     → trace 找慢方法；CPU 低就用 wall
难复现     → tt 录制一晚，次日检索回放
配置疑云   → ognl 读运行时真实值
线程卡     → jstack 状态分布 + thread -b
死锁       → jstack grep deadlock，统一加锁顺序

安全底线：回放慎用、改字段要审批、dump 记得删
```

### A.2 三大安全红线

> 1. **`tt -p` 回放会真实执行业务逻辑** —— 写操作（下单/扣款/发消息）绝不在生产回放。
> 2. **`ognl` 改字段立即生效** —— 高危操作，需审批、需记录、需回滚预案。
> 3. **火焰图 / dump / monitor 都有成本** —— 采样别太久、dump 文件几个 G 记得清、`redis-cli monitor` 与 `jmap -histo:live` 会 STW / 降性能，生产慎用。

### A.3 打印建议

各章的 `x.2 命令链` + `x.3 现场判读` 可按场景拆成 A4 横版两栏打印（9–10pt），
每页一类场景：顶部命令链、底部阈值与判读要点，现场应急够用；细节回正文。

### A.4 十类故障 → 章节 / 实录对照

| 故障类型 | 本篇章节 | 六步作业单 | 实录 / 外部件 |
|---|---|---|---|
| 1 OOM | 第 2 章 | 2.7 | `10` 进程消失（137 / cgroup）；`jvm-triage`（大 dump 流式分析） |
| 2 CPU 飙高 | 第 1 章 | 1.6 | — |
| 3 Full GC | 第 3 章 | 3.6 | `09` 竞价变慢（GC 正常但 RT 涨的排除项） |
| 4 线程 / 死锁 | 第 4、5 章 | 4.5 / 5.5 | `08` 连接堆积的外部形态 |
| 5 接口慢 | 第 9.5 节 + 第 6 章 | 9.6 | `09` 竞价变慢（分层定界） |
| 6 数据库 | 第 6 章（含 6.5 PG） | 6.6 | `11` 网关扩容打穿 DB（容量与配置基线） |
| 7 日志风暴 / 磁盘满 | 第 13 章 | 13.4 | `jvm-triage`（异常风暴 / 固定容量缓冲区指纹） |
| 8 网络 CLOSE_WAIT | 第 9 章 | 9.6 | `08` 多机房多线路（传输层四步定位） |
| 9 服务假死 | 第 14 章 | 14.4 | `jvm-triage`（D 状态 / 线程栈 / 句柄） |
| 10 应急响应 | 第 15 章 | 15.2 | `12` 六步 SOP（方法论总纲） |

### A.5 四种用法

1. **故障当场**：`12` 的六步 SOP 定流程 → 本篇 0.6 分诊表选类型 → 进对应章 `x.5 作业单` 照走；命令细节回 `x.2`。
2. **日常巡检**：`0.5` 一分钟体检 + `jvm_diag.sh` 平时存一份基线（闲时），告警时再采一份做差。
3. **复盘沉淀**：工单按 15.5 字段记录；同类故障的排查步骤回写对应章 `x.5`，不另起新文档。
4. **面试口径**：方法论讲 `12` 的六步 SOP，实录用 `00-面试计划/07` 的四个案子；本篇是"技术动作层"的依据库，不替代主线件。

---

*本手册持续更新。建议配合团队监控平台（Prometheus + Grafana + SkyWalking）与日志系统（ELK）使用：
命令只是定位手段，根因分析仍需结合业务代码与变更记录。*
