# Java 高级架构师实战排查手册

> 本手册面向真实线上场景，每类问题给出 **排查命令 → 真实日志/输出片段 → 分析思路 → 处置建议** 的完整链路。
> 命令基于 Linux + JDK8/11/17 通用环境，工具默认已安装或可通过包管理器快速安装。

## 目录

- [第 0 章 排查总纲与工具准备](#第-0-章-排查总纲与工具准备)
- [第 1 章 CPU 飙高](#第-1-章-cpu-飙高)
- [第 2 章 内存泄漏与 OOM](#第-2-章-内存泄漏与-oom)
- [第 3 章 GC 问题排查](#第-3-章-gc-问题排查)
- [第 4 章 线程池与线程阻塞](#第-4-章-线程池与线程阻塞)
- [第 5 章 死锁检测](#第-5-章-死锁检测)
- [第 6 章 慢 SQL 与数据库连接池](#第-6-章-慢-sql-与数据库连接池)
- [第 7 章 Redis 问题排查](#第-7-章-redis-问题排查)
- [第 8 章 Kafka / RocketMQ 消息积压](#第-8-章-kafka--rocketmq-消息积压)
- [第 9 章 网络与网关 502/504](#第-9-章-网络与网关-502504)
- [第 10 章 Arthas 实战指令集](#第-10-章-arthas-实战指令集)
- [第 11 章 排查方法论 Checklist](#第-11-章-排查方法论-checklist)

---

## 第 0 章 排查总纲与工具准备

### 0.1 四步止损原则

```
1. 先止损   → 熔断 / 降级 / 扩容 / 回滚 / 摘除节点
2. 定范围   → 单机 or 集群？单接口 or 全站？持续性 or 偶发？
3. 逐层下钻 → 网关 → 应用 → JVM → 中间件 → DB
4. 留证据   → dump、堆栈、GC 日志、火焰图，事后复盘
```

### 0.2 一次性装齐排查工具

```bash
# JVM 原生命令已在 JDK 内：jps jstack jmap jstat jinfo jcmd jhat

# Arthas（阿里开源，线上问题神器，推荐优先使用）
curl -O https://arthas.aliyun.com/arthas-boot.jar
java -jar arthas-boot.jar

# 系统级工具
apt-get install -y sysstat procps net-tools lsof strace htop \
                   iotop dstat tcpdump nc

# 堆分析
# 下载 Eclipse MAT (Memory Analyzer Tool) 到本地分析 dump

# 火焰图（async-profiler）
wget https://github.com/async-profiler/async-profiler/releases/download/v3.0/async-profiler-3.0-linux-x64.tar.gz
tar -zxvf async-profiler-3.0-linux-x64.tar.gz
```

### 0.3 一分钟快速体检脚本

```bash
#!/bin/bash
# quick-check.sh <pid>
PID=$1
echo "===== 进程基本信息 ====="
ps -p $PID -o pid,ppid,etime,%cpu,%mem,rss,vsz,cmd --no-headers

echo "===== 线程数 ====="
ls /proc/$PID/task | wc -l

echo "===== 堆内存使用 ====="
jstat -gcutil $PID 1000 3

echo "===== 线程状态分布 ====="
jstack $PID | grep "java.lang.Thread.State" | sort | uniq -c | sort -rn

echo "===== 最近 GC 次数 ====="
jstat -gc $PID | awk 'NR==1{print} NR==2{print}'
```

---

## 第 1 章 CPU 飙高

### 1.1 现象

- 监控告警：单核 100%、系统 Load 持续高于 CPU 核数
- 接口 RT 上涨、吞吐下降

### 1.2 排查命令（标准五步法）

```bash
# ① 定位是哪个进程吃 CPU
top -c
# 记下 PID，例如 12345

# ② 定位是哪个线程吃 CPU（-H 显示线程）
top -H -p 12345
# 假设线程 TID = 12360，占用 99%

# ③ 把线程号转成十六进制（jstack 里是 hex）
printf "%x\n" 12360
# 输出：3048

# ④ dump 线程栈，抓出该线程
jstack 12345 > /tmp/jstack.txt
grep -A 30 "nid=0x3048" /tmp/jstack.txt

# ⑤ 或者直接一步到位（Arthas 推荐）
java -jar arthas-boot.jar
# 选择进程后：
thread -n 3        # 展示最忙的 3 个线程及栈
```

### 1.3 真实输出片段

```text
"http-nio-8080-exec-23" #123 daemon prio=5 os_prio=0 tid=0x00007f... nid=0x3048 runnable
   java.lang.Thread.State: RUNNABLE
        at java.util.regex.Pattern$Curly.match(Pattern.java:4227)
        at java.util.regex.Pattern$GroupHead.match(Pattern.java:4660)
        at com.demo.validator.EmailValidator.validate(EmailValidator.java:41)
        at com.demo.controller.UserController.register(UserController.java:88)
        ...
```

**结论**：正在跑一段**正则表达式**，栈顶在 `Pattern$Curly.match`，典型的**正则回溯（catastrophic backtracking）**。

### 1.4 常见根因对照表

| 栈顶特征 | 根因 | 处置 |
|---|---|---|
| `Pattern$Curly/GroupHead.match` | 正则回溯，输入触发最坏复杂度 | 换非回溯写法，或加长度限制/超时 |
| `java.security.MessageDigest` | 大文件哈希、过多 MD5/SHA | 异步化、缓存结果 |
| `com.fasterxml.jackson` | 超大 JSON 序列化/反序列化 | 分页、流式解析 |
| `Base64.encode/decode` | 大图片/附件 Base64 转换 | 限制大小、异步处理 |
| `GC task thread#` | 频繁 GC 导致的 CPU | 见第 3 章 |
| 自己的业务方法 | 死循环 / 全表遍历 | 看代码 |

### 1.5 系统 Load 高但 CPU 不高？

Load 高不等于 CPU 高，可能是**大量线程在等待 IO**：

```bash
# 看是否有 D 状态（不可中断睡眠）线程
ps -eLo pid,tid,stat,wchan:20,comm | awk '$3 ~ /D/'

# 看 IO 等待
iostat -x 1 3
vmstat 1 5
# 关键列：r（运行队列）b（阻塞）wa（IO等待百分比）

# 看磁盘 IO 大户
iotop -oP
```

> **经验值**：Load ≈ CPU 核数 属于满负荷；Load 远大于核数且 `wa` 高，先查磁盘/网络 IO。

---

## 第 2 章 内存泄漏与 OOM

### 2.1 现象

- `java.lang.OutOfMemoryError: Java heap space`
- `java.lang.OutOfMemoryError: Metaspace`
- `GC overhead limit exceeded`
- 堆内存曲线持续上升，Full GC 后不回落

### 2.2 排查命令

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

### 2.3 真实输出片段

```text
 num     #instances         #bytes  class name
----------------------------------------------
   1:       8234512      263504384  [C              # char[]
   2:       4102334      196912032  java.lang.String
   3:       1023456       81876480  com.demo.dto.OrderDTO
   4:        512300       40984000  java.util.HashMap$Node
```

**结论**：`char[]` 和 `String` 占比异常，且 `OrderDTO` 数量巨大 —— 疑似**某处把订单对象全部缓存进内存未释放**。

### 2.4 MAT 分析关键动作

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

### 2.6 元空间 Metaspace OOM

```bash
# 看 Metaspace 使用
jstat -gc 12345 | awk '{print "MC=%s MU=%s",$8,$9}'  # MC=容量 MU=使用

# 或 jcmd
jcmd 12345 GC.heap_info
jcmd 12345 VM.metaspace
```

> **常见根因**：反射滥用（如 BeanUtils 大量动态生成类）、热部署/CGLIB 代理类不断累积、`-XX:MaxMetaspaceSize` 设置过小。

---

## 第 3 章 GC 问题排查

### 3.1 现象

- Full GC 频繁（分钟级一次甚至更密）
- 单次 STW 停顿几百毫秒到数秒，接口毛刺
- `GC overhead limit exceeded`

### 3.2 排查命令

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

# ② 查看具体各区域容量大小（KB）
jstat -gc 12345

# ③ GC 日志分析（启动加参数）
# JDK8： -XX:+PrintGCDetails -XX:+PrintGCDateStamps
#        -Xloggc:/data/logs/gc.log -XX:+UseGCLogFileRotation
# JDK11+: -Xlog:gc*:file=/data/logs/gc.log:time,uptime,level,tags
```

### 3.3 真实输出片段

```text
 S0     S1     E      O      M     CCS    YGC     YGCT    FGC    FGCT     GCT
 0.00  99.80  45.20  99.87  95.10  92.30  18234  412.33  1893  3891.22  4303.55
```

**解读**：
- `O = 99.87%` → 老年代几乎打满
- `FGC = 1893` 次，`FGCT = 3891s` → Full GC 累计停了 **64 分钟**
- `TGCT` 与运行时间占比过高 → **内存泄漏或堆分配不合理**

### 3.4 GC 日志片段（JDK8 Parallel GC）

```text
2024-05-20T10:23:11.234+0800: 45231.234: [Full GC (Ergonomics)
[PSYoungGen: 512000K->0K(524288K)]
[ParOldGen: 1747324K->1746890K(1747456K)] 2259324K->1746890K(2271744K),
[Metaspace: 102345K->102345K(1064960K)], 2.3412340 secs]
[Times: user=9.12 sys=0.03, real=2.34 secs]
```

**关键信号**：Full GC 后老年代几乎**没有回收**（`1747324K->1746890K`），
说明对象**全部存活** → 确认是**内存泄漏**，不是 GC 参数问题。

### 3.5 判断逻辑树

```
Q1: Full GC 后老年代是否下降？
 ├── 明显下降 → 只是"对象创建太快"，GC 来不及
 │              → 优化代码减少对象 / 增大堆 / 调新生代比例
 └── 几乎不降 → 内存泄漏
                → jmap dump → MAT 找 GC Roots 引用链

Q2: Young GC 是否过于频繁？
 └── 是 → Eden 太小 / 短命对象太多 / 大对象直接进老年代
          → 调 -Xmn、-XX:SurvivorRatio、-XX:PretenureSizeThreshold

Q3: 单次 STW 是否过长？
 └── 是 → 堆过大 / GC 器选择不当
          → 大堆考虑 G1 / ZGC / Shenandoah
```

### 3.6 常用 GC 参数速查

```bash
-Xms8g -Xmx8g                      # 堆固定，避免动态扩容抖动
-Xmn3g                             # 新生代大小
-XX:SurvivorRatio=8                # Eden:Survivor = 8:1
-XX:MaxTenuringThreshold=15        # 对象晋升老年代年龄阈值
-XX:+UseG1GC -XX:MaxGCPauseMillis=200   # G1 目标停顿
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/data/dump/
-Xlog:gc*:file=/data/logs/gc.log:time,uptime,level,tags  # JDK11+
```

---

## 第 4 章 线程池与线程阻塞

### 4.1 现象

- 接口大面积超时，但 CPU / 内存都正常
- 日志出现 `RejectedExecutionException`（拒绝策略触发）
- 请求排队，QPS 上不去

### 4.2 排查命令

```bash
# ① 线程状态分布统计
jstack 12345 | grep "java.lang.Thread.State" | sort | uniq -c | sort -rn

# ② 找出所有处于 WAITING/TIMED_WAITING 的线程
jstack 12345 | grep -B 2 "java.lang.Thread.State: WAITING" | head -50

# ③ 统计线程名规律（看哪个池打满）
jstack 12345 | grep '"' | sed 's/".*//' | sort | uniq -c | sort -rn | head -20

# ④ 查看总线程数
ls /proc/12345/task | wc -l
```

### 4.3 真实输出片段（状态分布）

```text
    156 java.lang.Thread.State: WAITING (parking)
     89 java.lang.Thread.State: TIMED_WAITING (parking)
     23 java.lang.Thread.State: RUNNABLE
     12 java.lang.Thread.State: BLOCKED (on object monitor)
```

**解读**：大量 `WAITING (parking)` 说明线程在**等待某个资源**（锁/条件变量/连接池），
典型如：**数据库连接池耗尽后，业务线程集体阻塞在获取连接上**。

### 4.4 真实栈片段（连接池等待）

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
下一步去查：**是慢 SQL 占着连接不放，还是连接泄漏（借了没还）**。

### 4.5 线程池参数自检

```java
// 排查时必问的四个数：corePoolSize / maxPoolSize / queueCapacity / 拒绝策略
ThreadPoolExecutor executor = (ThreadPoolExecutor) pool;
System.out.println("核心线程: " + executor.getCorePoolSize());
System.out.println("最大线程: " + executor.getMaximumPoolSize());
System.out.println("活跃线程: " + executor.getActiveCount());
System.out.println("池中线程: " + executor.getPoolSize());
System.out.println("队列大小: " + executor.getQueue().size());
System.out.println("已完成任务: " + executor.getCompletedTaskCount());
```

> **经典坑**：用了 `Executors.newFixedThreadPool()` → 底层是 `LinkedBlockingQueue`（无界队列）
> → **maxPoolSize 永远用不上，队列无限堆积，最终 OOM**。
> 生产必须手写 `ThreadPoolExecutor` 并指定有界队列 + 自定义拒绝策略。

### 4.6 线程数爆掉

```bash
# 按进程看线程数排行
ps -eLo pid | sort | uniq -c | sort -rn | head

# 某进程按线程名分类计数
jstack 12345 | grep '"' | sed -E 's/"[^"]*"//' | awk '{print $2}' | sort | uniq -c | sort -rn
```

---

## 第 5 章 死锁检测

### 5.1 现象

- 接口莫名挂起、无响应
- 部分线程永远 RUNNABLE/BLOCKED 不推进
- 应用"卡死"但资源正常

### 5.2 一步定位命令

```bash
jstack 12345 | grep -A 30 "Found one Java-level deadlock"
```

### 5.3 真实输出片段

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

**结论**：`transferA` 和 `transferB` **加锁顺序相反** → 典型 AB-BA 死锁。
修复：**统一加锁顺序**或改用 `tryLock(timeout)`。

### 5.4 DB 死锁（MySQL）

```sql
-- 查看最近一次死锁详情
SHOW ENGINE INNODB STATUS\G
-- 关注 LATEST DETECTED DEADLOCK 段落

-- 查看当前所有事务及锁等待
SELECT * FROM information_schema.INNODB_TRX;
SELECT * FROM performance_schema.data_locks;
SELECT * FROM performance_schema.data_lock_waits;

-- 查看被阻塞的 SQL
SELECT r.trx_id waiting_trx, r.trx_mysql_thread_id waiting_thread,
       r.trx_query waiting_query, b.trx_id blocking_trx,
       b.trx_mysql_thread_id blocking_thread, b.trx_query blocking_query
FROM performance_schema.data_lock_waits w
JOIN information_schema.INNODB_TRX b ON b.trx_id = w.blocking_engine_transaction_id
JOIN information_schema.INNODB_TRX r ON r.trx_id = w.requesting_engine_transaction_id;

-- 必要时杀掉阻塞源
KILL <blocking_thread_id>;
```

---

## 第 6 章 慢 SQL 与数据库连接池

### 6.1 定位慢 SQL

```sql
-- MySQL 开启慢查询日志
SET GLOBAL slow_query_log = ON;
SET GLOBAL long_query_time = 1;          -- 超过 1 秒记录
SET GLOBAL log_queries_not_using_indexes = ON;

-- 查看慢 SQL 排行
SELECT * FROM performance_schema.events_statements_summary_by_digest
ORDER BY SUM_TIMER_WAIT DESC LIMIT 20;

-- 实时看正在执行的长事务
SELECT id, user, host, db, command, time, state, info
FROM information_schema.PROCESSLIST
WHERE command != 'Sleep' AND time > 3
ORDER BY time DESC;

-- 查看当前连接数
SHOW STATUS LIKE 'Threads_connected';
SHOW VARIABLES LIKE 'max_connections';
```

### 6.2 EXPLAIN 分析

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

**危险信号**：
- `type = ALL` → **全表扫描**
- `key = NULL` → **没走索引**
- `rows = 8234512` → 扫描 **800 多万行**
- `Using filesort` → **额外排序开销**
- `Using temporary` → **用了临时表**

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

-- 优化二：游标法（记住上一页最大 id）
SELECT * FROM orders WHERE id > 1000000 ORDER BY id LIMIT 20;
```

### 6.4 连接池监控（HikariCP）

```yaml
# 打开 HikariCP 指标（Spring Boot Actuator）
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
# 关键指标
curl -s localhost:8080/actuator/metrics/hikaricp.connections.active
curl -s localhost:8080/actuator/metrics/hikaricp.connections.pending   # 等待线程数
curl -s localhost:8080/actuator/metrics/hikaricp.connections.timeout
```

| 指标 | 含义 | 告警阈值 |
|---|---|---|
| `connections.active` | 活跃连接 | 持续 = maxPoolSize |
| `connections.pending` | 等待获取连接的线程 | > 0 持续出现即异常 |
| `connections.timeout` | 获取超时次数 | > 0 必须查 |
| `connections.idle` | 空闲连接 | 长期偏低说明池不够 |

> **判断连接泄漏**：`active` 长期接近上限且 `idle=0`，慢 SQL 排查无果 → 大概率代码借了连接没关。
> 临时方案：`leakDetectionThreshold=2000`（毫秒），HikariCP 会打印泄漏堆栈。

```properties
spring.datasource.hikari.leak-detection-threshold=2000
```

---

## 第 7 章 Redis 问题排查

### 7.1 大 key 排查

```bash
# 全量扫描找大 key（生产用 --bigkeys，勿用 KEYS *）
redis-cli --bigkeys

# 输出示例：
# [00.00%] Biggest string found so far 'user:profile:10086' with 102400 bytes
# [45.12%] Biggest hash   found so far 'cart:user:9527' with 20453 fields
# -------- summary -------
# Sampled 100000 keys in the keyspace!
# Total key length in bytes is 4567890 (avg len 45.67)
# Biggest string found 'session:token:aaaa' has 5242880 bytes
```

```bash
# 精确看某 key 占用内存（单位 byte，需 redis 4.0+）
redis-cli MEMORY USAGE cart:user:9527

# 采样分析（redis-rdb-tools 离线分析最准）
pip install rdbtools python-lzf
rdb -c memory /data/dump.rdb --bytes 1024 > redis_memory.csv
# 按内存排序取 top
sort -t, -k4 -nr redis_memory.csv | head -20
```

### 7.2 热 key 排查

```bash
# 查看某 key 的访问频率（需开启 monitor，生产慎用，会降性能）
redis-cli --hotkeys      # 基于 LFU 淘汰策略

# monitor 实时采样（短时间）
redis-cli monitor | head -1000 | awk '{print $4}' | sort | uniq -c | sort -rn | head -20

# 或使用 redis-cli --intrinsic-latency 看延迟
redis-cli --intrinsic-latency 100
```

**热 key 治理**：本地缓存（Caffeine）挡一层 → 热点 key 多副本打散 → 限流。

### 7.3 慢查询

```bash
# Redis 慢日志
redis-cli SLOWLOG GET 10
# 输出：
# 1) (integer) 1
# 2) (integer) 1716180000          # 时间戳
# 3) (integer) 15234               # 耗时（微秒）
# 4) 1) "KEYS"
#    2) "*"                        # 这条就是大坑命令

redis-cli SLOWLOG RESET
redis-cli CONFIG GET slowlog-log-slower-than   # 默认 10000 微秒 = 10ms
```

### 7.4 内存与淘汰

```bash
redis-cli INFO memory
# used_memory_human: 3.82G
# maxmemory_human: 4.00G
# mem_fragmentation_ratio: 1.87   ← 大于 1.5 说明碎片严重

redis-cli INFO stats
# evicted_keys: 1523400           ← 已淘汰 key 数，大量说明内存不足

redis-cli CONFIG GET maxmemory-policy
# 推荐 allkeys-lru 或 volatile-lru
```

### 7.5 连接与阻塞

```bash
redis-cli INFO clients
# connected_clients: 10000        ← 接近 maxclients 会拒绝连接
# blocked_clients: 23

redis-cli CLIENT LIST | head -20
redis-cli CONFIG GET maxclients

# 查看是否有阻塞命令
redis-cli INFO commandstats | sort -t= -k2 -rn | head
```

### 7.6 缓存三大问题速查

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

### 8.2 Kafka 排查命令

```bash
# ① 查看所有消费者组及其 Lag
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --all-groups --describe

# 输出片段：
# GROUP        TOPIC    PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG   CONSUMER-ID
# order-group  order-msg     0        1523400         4523400      3000000  consumer-1
# order-group  order-msg     1        1523400         1523500          100  consumer-2
```

**解读**：分区 0 堆积 300 万，分区 1 几乎不堆积 → **消费能力不均 / 分区倾斜**。

```bash
# ② 查看 Topic 详情
kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic order-msg
# 看 PartitionCount（分区数）和 ReplicationFactor

# ③ 查看消费者组成员
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group order-group --members --verbose

# ④ 手动重置 offset（危险操作，需谨慎）
kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --group order-group --topic order-msg \
  --reset-offsets --to-earliest --execute
```

### 8.3 RocketMQ 排查命令

```bash
# 查看消费者组堆积
mqadmin consumerProgress -n localhost:9876 -g order_consumer_group

# 输出：
# #Broker Name  #QID  #Broker Offset  #Consumer Offset  #Diff
# broker-a        0      1523400          4523400        3000000   ← Diff 即积压量
# broker-a        1      1523400          1523500            100

# 查看 Topic 状态
mqadmin topicStatus -n localhost:9876 -t order_topic

# 查看消息轨迹（定位某条消息是否被消费）
mqadmin queryMsgById -n localhost:9876 -i <msgId>
```

### 8.4 积压常见根因与处置

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

# 若卡在下游调用，栈会显示具体阻塞点
```

---

## 第 9 章 网络与网关 502/504

### 9.1 现象

- 网关返回 502 Bad Gateway / 504 Gateway Timeout
- 部分用户报错，部分正常（区域性/实例性）

### 9.2 排查命令

```bash
# ① Nginx 错误日志
tail -f /var/log/nginx/error.log
# 示例：
# 2024/05/20 10:23:11 [error] 1234#0: *5678 upstream timed out
#   (110: Connection timed out) while reading response header from upstream,
#   client: 10.0.0.5, server: api.demo.com,
#   request: "POST /order/create HTTP/1.1", upstream: "http://10.0.1.20:8080/order/create"

# ② 看 upstream 某台机器是否健康
curl -v http://10.0.1.20:8080/actuator/health

# ③ 网络连通性
telnet 10.0.1.20 8080
nc -zv 10.0.1.20 8080

# ④ 检查 TCP 连接状态（大量 TIME_WAIT / CLOSE_WAIT）
netstat -antp | awk '{print $6}' | sort | uniq -c | sort -rn
ss -s      # 连接统计汇总

# ⑤ 抓包（定位到具体握手/超时环节）
tcpdump -i eth0 -nn host 10.0.1.20 and port 8080 -w /tmp/cap.pcap
# 下载后用 Wireshark 分析三次握手、RST、重传
```

### 9.3 关键状态码含义

| 状态码 | 含义 | 排查方向 |
|---|---|---|
| **502** | 网关收到后端非法响应/后端挂了 | 后端进程存活？端口监听？ |
| **504** | 网关超时（后端处理太慢） | 后端慢、连接池、GC 停顿 |
| **499** | 客户端主动断开 | 用户端超时、网关超时设置太短 |
| **SYN Flood / 拒绝** | 无法建连 | 端口满、内核参数、防火墙 |

### 9.4 连接状态异常

```bash
# 大量 CLOSE_WAIT → 应用没关闭连接（代码问题）
# 大量 TIME_WAIT  → 主动关闭方，短连接频繁
# 大量 SYN_RECV    → 可能有 SYN Flood 攻击

# CLOSE_WAIT 定位
ss -antp | grep CLOSE_WAIT | head
# 找到占用进程和 fd，回到应用侧查连接是否泄漏
```

### 9.5 内核参数速查

```bash
sysctl -a | grep -E "somaxconn|tcp_tw_reuse|ip_local_port_range|file-max"
# net.core.somaxconn = 128          → 调大到 32768
# net.ipv4.tcp_tw_reuse = 0         → 开启为 1
# net.ipv4.ip_local_port_range      → 扩大端口范围
# fs.file-max                       → 调大
ulimit -n                           # 单进程 fd 上限，常调 655350
```

---

## 第 10 章 Arthas 实战指令集

> Arthas 是线上排查的"瑞士军刀"，无需重启、无需改代码。

```bash
java -jar arthas-boot.jar
# 或者 attach 指定进程：java -jar arthas-boot.jar <pid>
```

### 10.1 高频指令表

| 指令 | 用途 | 示例 |
|---|---|---|
| `dashboard` | 实时大盘（线程+内存+GC） | `dashboard` |
| `thread` | 线程分析 | `thread -n 3` 最忙线程；`thread -b` 找阻塞 |
| `jad` | 反编译类 | `jad com.demo.service.OrderService` |
| `watch` | 观测方法入参/出参 | `watch com.demo.service.OrderService query "{params,returnObj}" -x 3` |
| `trace` | 方法调用耗时链路 | `trace com.demo.service.OrderService query` |
| `stack` | 查看方法被谁调用 | `stack com.demo.service.OrderService query` |
| `tt` | 录制方法调用现场 | `tt -t com.demo.service.OrderService query` |
| `sc` | 查找类 | `sc -d com.demo.service.*` |
| `sm` | 查找方法 | `sm com.demo.service.OrderService` |
| `ognl` | 执行表达式（改静态字段等） | `ognl '@com.demo.Config@DEBUG'` |
| `getstatic` | 读静态字段 | `getstatic com.demo.Config DEBUG` |
| `profiler` | 生成火焰图 | `profiler start` / `profiler stop` |
| `heapdump` | dump 堆 | `heapdump /tmp/heap.hprof` |
| `vmtool` | 内存对象查询 | `vmtool --action getInstances --className java.lang.String` |

### 10.2 实战：找最慢的方法

```bash
# 直接对某方法做耗时追踪，展开 5 层调用
trace com.demo.service.OrderService createOrder -n 5 '#cost > 100'
# 只显示耗时超过 100ms 的调用
```

输出片段：
```text
`---ts=2024-05-20 10:23:11;thread_name=http-nio-8080-exec-5;id=25;is_daemon=true
    `---[412.34ms] com.demo.service.OrderService:createOrder()
        +---[2.11ms] com.demo.dao.OrderDao:insert()
        +---[398.20ms] com.demo.client.InventoryClient:deduct()   ← 慢在这里
        `---[10.02ms] com.demo.mq.OrderProducer:send()
```

### 10.3 实战：看某方法的真实入参

```bash
watch com.demo.service.OrderService createOrder \
  '{params[0], params[1], returnObj, throwExp}' -x 3 -b -s
# -x 3 展开 3 层，-b 方法前，-s 方法后
```

### 10.4 实战：热更新代码（应急）

```bash
# 1. jad 反编译拿到源码
jad --source-only com.demo.service.OrderService > /tmp/OrderService.java
# 2. 修改后编译
# 3. retransform 热替换
mc -c 3b7fb8c8 /tmp/OrderService.java -d /tmp
retransform /tmp/com/demo/service/OrderService.class
```

> ⚠️ **热更新是应急手段**，改完必须尽快走正式发布流程覆盖。

---

## 第 11 章 排查方法论 Checklist

### 11.1 通用排查流程

```
[ ] 1. 确认影响范围：多少用户/多少实例/哪些接口
[ ] 2. 是否可快速止损（回滚 / 扩容 / 降级 / 熔断）
[ ] 3. 收集现场证据：jstack / jmap / GC日志 / 慢SQL / 链路追踪
[ ] 4. 横向对比：异常实例 vs 正常实例（配置/版本/流量）
[ ] 5. 逐层下钻：网关 → 应用 → JVM → 中间件 → DB
[ ] 6. 定位根因，验证假设
[ ] 7. 修复 + 补监控 + 补告警 + 复盘沉淀
```

### 11.2 一分钟"体检"命令组合

```bash
# 拿到 PID 后一把梭
PID=12345
echo "== 线程数 =="; ls /proc/$PID/task | wc -l
echo "== GC ==";    jstat -gcutil $PID 1000 3
echo "== 线程状态 =="; jstack $PID | grep Thread.State | sort | uniq -c | sort -rn
echo "== 最忙线程 =="; top -H -p $PID -b -n 1 | head -15
echo "== 死锁 ==";  jstack $PID | grep -c "Found one Java-level deadlock"
```

### 11.3 各场景首选工具对照

| 场景 | 首选命令/工具 |
|---|---|
| CPU 高 | `top -H -p` + `jstack` / Arthas `thread -n` |
| 内存泄漏 | `jmap -dump` + MAT |
| GC 频繁 | `jstat -gcutil` + GC 日志 |
| 线程阻塞 | `jstack` 状态统计 / Arthas `thread -b` |
| 死锁 | `jstack \| grep -A 30 deadlock` |
| 慢 SQL | 慢查询日志 + `EXPLAIN` |
| 连接池 | Actuator `hikaricp.*` 指标 |
| Redis 大 key | `redis-cli --bigkeys` |
| Kafka 积压 | `kafka-consumer-groups.sh --describe` |
| 网关 502/504 | Nginx error.log + `tcpdump` |
| 方法慢 | Arthas `trace` |
| 方法入参 | Arthas `watch` |
| 火焰图 | async-profiler / Arthas `profiler` |

### 11.4 排查黄金法则

> 1. **先止血，后查因**——线上优先恢复业务。
> 2. **用数据说话**——不猜，看栈、看日志、看指标。
> 3. **缩小范围**——单机 vs 集群，先做二分定位。
> 4. **一次只改一个变量**——避免掩盖真实原因。
> 5. **留好现场**——dump/日志先留存，再重启。
> 6. **复盘必做**——每个故障都要沉淀成监控项和 checklist。

---

*本手册持续更新。建议配合团队实际的监控平台（Prometheus + Grafana + SkyWalking）与日志系统（ELK）使用，命令仅为定位手段，根因分析还需结合业务代码。*
