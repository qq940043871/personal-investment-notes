# Java 排障速查卡（按场景分页）

> 打印建议：A4 横版、两栏、字号 9-10pt。每页一类场景，顶部是命令，底部是关键判断与阈值。
> 所有命令中 `PID` 请替换为实际进程号。

---

## 卡片 1 · CPU 飙高

### 命令链
```bash
# ① 定位进程
top -c                          # 记下高 CPU 的 PID

# ② 定位线程（-H 显示线程）
top -H -p PID                   # 记下高 CPU 的 TID

# ③ TID 转十六进制
printf "%x\n" <TID>             # 假设输出 3048

# ④ 抓该线程栈
jstack PID > /tmp/j.txt
grep -A 30 "nid=0x3048" /tmp/j.txt

# ⑤ 或一步到位（Arthas）
thread -n 3                     # 展示最忙的 3 个线程
thread -n 3 -i 1000             # 每 1 秒刷新，共 3 次
```

### 快速判断
| 观察点 | 判断 |
|---|---|
| 栈顶 `Pattern$Curly.match` | 正则回溯 |
| 栈顶 `MessageDigest / Base64` | 大文件加解密 |
| 栈顶 `jackson` 反序列化 | 超大 JSON |
| 栈顶 `GC task thread` | 是 GC 导致，转卡片 3 |
| 栈顶是业务方法 | 死循环 / 全表遍历 |

### 阈值
- Load ≈ CPU 核数：满负荷
- Load >> 核数 且 `wa` 高：先查 IO（`iostat -x 1`、`iotop -oP`）

---

## 卡片 2 · 内存泄漏 / OOM

### 命令链
```bash
# ① 堆概况
jstat -gcutil PID 1000 5        # 看 O 列是否逼近 100

# ② 对象排行（会 STW，线上慎用）
jmap -histo:live PID | head -30

# ③ dump 堆
jmap -dump:live,format=b,file=/tmp/heap.hprof PID

# ④ 提前埋 OOM 自动 dump（JVM 参数）
-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/data/dump/
```

### MAT 四步
```
1. 打开 heap.hprof → 看 Leak Suspects
2. Dominator Tree 找最大占用对象
3. 右键 → Path to GC Roots → exclude weak/soft
4. 找到"谁在持有" → 即泄漏点
```

### 常见泄漏源
| 场景 | 修复 |
|---|---|
| 静态 Map 无上限缓存 | 换 Caffeine + 淘汰策略 |
| ThreadLocal 未 remove | finally 里 remove() |
| 监听器未反注册 | 生命周期结束注销 |
| 连接未关闭 | try-with-resources |
| CGLIB/反射类累积 | Metaspace OOM，查热部署 |

### 阈值
- O（老年代）> 90% 且 Full GC 后不降 → 泄漏
- `mem_fragmentation_ratio` > 1.5 → 碎片严重

---

## 卡片 3 · GC 问题

### 命令链
```bash
# 实时统计（每 1 秒共 10 次）
jstat -gcutil PID 1000 10

# 列含义
# S0/S1 Survivor  E Eden  O 老年代  M Metaspace
# YGC/YGCT  YoungGC次数/耗时   FGC/FGCT  FullGC次数/耗时

# 各区域容量（KB）
jstat -gc PID
```

### 真实输出
```text
 S0    S1    E     O     M     YGC    YGCT   FGC    FGCT
0.00  99.8  45.2  99.87 95.1  18234  412.3  1893  3891.2
```
↑ O=99.87%，FGC 累计停了 64 分钟 → 内存泄漏或堆不合理

### 判断树
```
Full GC 后老年代是否下降？
├── 降  → 对象创建太快 → 减对象 / 增大堆 / 调新生代
└── 不降 → 内存泄漏 → dump + MAT
Young GC 过于频繁？ → Eden 太小 / 短命对象多 / 调 -Xmn
单次 STW 过长？    → 堆过大 / GC 器不当 → G1/ZGC
```

### 关键参数
```bash
-Xms8g -Xmx8g                    # 固定堆
-Xmn3g                           # 新生代
-XX:SurvivorRatio=8              # Eden:Survivor
-XX:MaxTenuringThreshold=15      # 晋升年龄
-XX:+UseG1GC -XX:MaxGCPauseMillis=200
-Xlog:gc*:file=/data/logs/gc.log:time,uptime,level,tags  # JDK11+
```

---

## 卡片 4 · 线程池 / 线程阻塞

### 命令链
```bash
# 线程状态分布
jstack PID | grep "java.lang.Thread.State" | sort | uniq -c | sort -rn

# 按线程名归类（看哪个池打满）
jstack PID | grep '"' | sed 's/".*//' | sort | uniq -c | sort -rn | head -20

# 总线程数
ls /proc/PID/task | wc -l
```

### 真实输出
```text
 156 WAITING (parking)     ← 大量等待，典型资源池耗尽
  89 TIMED_WAITING
  23 RUNNABLE
  12 BLOCKED (on object monitor)
```

### 典型栈
```
at com.zaxxer.hikari.pool.HikariPool.getConnection
```
→ 全堵在获取 DB 连接 → 查慢 SQL / 连接泄漏

### 线程池四必看
```java
executor.getActiveCount()        // 活跃线程
executor.getQueue().size()       // 队列积压
executor.getPoolSize()           // 当前线程数
executor.getCompletedTaskCount() // 已完成
```

### 经典坑
> `Executors.newFixedThreadPool()` 底层是**无界** `LinkedBlockingQueue`
> → maxPoolSize 永远用不上，队列无限堆积 → **OOM**
> **生产必须手写 `ThreadPoolExecutor` + 有界队列 + 自定义拒绝策略**

---

## 卡片 5 · 死锁

### 一步定位
```bash
jstack PID | grep -A 30 "Found one Java-level deadlock"
```

### 真实输出
```text
Found one Java-level deadlock:
"Thread-1": waiting to lock <0x...1b0>, which is held by "Thread-0"
"Thread-0": waiting to lock <0x...2c0>, which is held by "Thread-1"
  at TransferService.transferB(...)   ← 加锁顺序相反
  at TransferService.transferA(...)
```
→ **AB-BA 死锁**，修复：统一加锁顺序 / `tryLock(timeout)`

### MySQL 死锁
```sql
SHOW ENGINE INNODB STATUS\G        -- LATEST DETECTED DEADLOCK

-- 当前锁等待
SELECT * FROM performance_schema.data_lock_waits;

-- 被杀掉阻塞源
KILL <blocking_thread_id>;
```

---

## 卡片 6 · 慢 SQL / 连接池

### 定位慢 SQL
```sql
SET GLOBAL slow_query_log = ON;
SET GLOBAL long_query_time = 1;

-- 慢 SQL 排行
SELECT * FROM performance_schema.events_statements_summary_by_digest
ORDER BY SUM_TIMER_WAIT DESC LIMIT 20;

-- 实时长事务
SELECT id,user,host,time,state,info FROM information_schema.PROCESSLIST
WHERE command!='Sleep' AND time>3 ORDER BY time DESC;
```

### EXPLAIN 危险信号
| 输出 | 含义 |
|---|---|
| `type = ALL` | 全表扫描 |
| `key = NULL` | 没走索引 |
| `rows` 很大 | 扫描行数多 |
| `Using filesort` | 额外排序 |
| `Using temporary` | 用了临时表 |

### 深分页优化
```sql
-- 慢：SELECT * FROM t ORDER BY id LIMIT 1000000,20;
-- 快（延迟关联）：
SELECT o.* FROM orders o JOIN
 (SELECT id FROM orders ORDER BY id LIMIT 1000000,20) t ON o.id=t.id;
-- 更快（游标法）：
SELECT * FROM orders WHERE id > 1000000 ORDER BY id LIMIT 20;
```

### HikariCP 监控
```bash
curl -s localhost:8080/actuator/metrics/hikaricp.connections.pending  # >0 即异常
curl -s localhost:8080/actuator/metrics/hikaricp.connections.timeout  # >0 必须查
```
```properties
# 连接泄漏检测
spring.datasource.hikari.leak-detection-threshold=2000
```

---

## 卡片 7 · Redis

### 命令链
```bash
redis-cli --bigkeys                 # 找大 key（勿用 KEYS *）
redis-cli MEMORY USAGE <key>        # 单 key 内存
redis-cli --hotkeys                 # 热 key（需 LFU）
redis-cli SLOWLOG GET 10            # 慢查询
redis-cli INFO memory               # 内存/碎片
redis-cli INFO stats                # evicted_keys
redis-cli INFO clients              # 连接数
redis-cli --intrinsic-latency 100   # 固有延迟
```

### 真实输出
```text
used_memory_human: 3.82G
maxmemory_human:   4.00G
mem_fragmentation_ratio: 1.87       ← >1.5 碎片严重
evicted_keys: 1523400               ← 大量淘汰 = 内存不足
```

### 缓存三问题
| 问题 | 方案 |
|---|---|
| 穿透 | 空值缓存 + 布隆过滤器 |
| 击穿 | 互斥锁重建 + 逻辑过期 |
| 雪崩 | 过期时间随机 + 多级缓存 + 熔断 |

---

## 卡片 8 · Kafka / RocketMQ 积压

### Kafka
```bash
kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --all-groups --describe
```
```text
GROUP        TOPIC     PART  CURRENT    LOG-END   LAG       CONSUMER
order-group  order-msg  0    1523400    4523400   3000000   consumer-1
order-group  order-msg  1    1523400    1523500       100   consumer-2
```
↑ `LAG` 即积压；分区 0 高、分区 1 低 → **分区倾斜**

```bash
# 查看/重置 offset（重置为危险操作）
kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --group order-group --topic order-msg --reset-offsets --to-earliest --execute
```

### RocketMQ
```bash
mqadmin consumerProgress -n localhost:9876 -g order_consumer_group
# #Diff 列即积压量
mqadmin topicStatus -n localhost:9876 -t order_topic
```

### 积压根因
| 根因 | 处置 |
|---|---|
| 消费逻辑慢 | 提高并发 / 批量消费 |
| 分区倾斜 | 调分区策略 / 扩容消费者 |
| 异常重试 | 修业务异常，死信单独处理 |
| 突增流量 | 临时扩容消费者 |

---

## 卡片 9 · 网关 502/504 / 网络

### 命令链
```bash
tail -f /var/log/nginx/error.log     # 看 upstream 错误
curl -v http://10.0.1.20:8080/actuator/health
telnet 10.0.1.20 8080                # 或 nc -zv
ss -s                                # 连接状态汇总
netstat -antp | awk '{print $6}' | sort | uniq -c | sort -rn
tcpdump -i eth0 -nn host 10.0.1.20 and port 8080 -w /tmp/cap.pcap
```

### 状态码对照
| 码 | 含义 | 排查 |
|---|---|---|
| 502 | 后端挂/非法响应 | 进程存活？端口监听？ |
| 504 | 后端超时 | 慢 SQL / 连接池 / GC 停顿 |
| 499 | 客户端断开 | 网关超时太短 |
| CLOSE_WAIT 多 | 应用没关连接 | 代码连接泄漏 |
| TIME_WAIT 多 | 短连接频繁 | 开 tcp_tw_reuse |

### 内核参数
```bash
sysctl -w net.core.somaxconn=32768
sysctl -w net.ipv4.tcp_tw_reuse=1
ulimit -n 655350
```

---

## 卡片 10 · Arthas 高频指令

```bash
java -jar arthas-boot.jar        # attach 后选进程
```

| 指令 | 用途 |
|---|---|
| `dashboard` | 实时大盘（线程+内存+GC） |
| `thread -n 3` | 最忙的 3 个线程 |
| `thread -b` | 找阻塞其他线程的元凶 |
| `jad <类>` | 反编译 |
| `watch <类> <方法> "{params,returnObj}" -x 3` | 看入参出参 |
| `trace <类> <方法> '#cost>100'` | 耗时链路（>100ms） |
| `stack <类> <方法>` | 谁调用了它 |
| `tt -t <类> <方法>` | 录制调用现场 |
| `ognl '<表达式>'` | 执行表达式 |
| `profiler start/stop` | 火焰图 |
| `heapdump /tmp/h.hprof` | dump 堆 |

### 常用组合
```bash
# 找最慢方法（展开 5 层，只看 >100ms）
trace com.demo.service.OrderService createOrder -n 5 '#cost > 100'

# 看真实入参出参
watch com.demo.service.OrderService createOrder \
  '{params[0],params[1],returnObj,throwExp}' -x 3 -b -s
```

---

## 卡片 11 · 通用检查 Checklist

### 一分钟体检
```bash
PID=12345
echo "线程数:";   ls /proc/$PID/task | wc -l
echo "GC:";       jstat -gcutil $PID 1000 3
echo "线程状态:"; jstack $PID | grep Thread.State | sort | uniq -c | sort -rn
echo "最忙线程:"; top -H -p $PID -b -n 1 | head -15
echo "死锁数:";   jstack $PID | grep -c "Found one Java-level deadlock"
```

### 排查七步
```
[ ] 1. 确认影响范围（用户/实例/接口）
[ ] 2. 快速止损（回滚/扩容/降级/熔断）
[ ] 3. 收集现场（jstack/jmap/GC日志/慢SQL/链路）
[ ] 4. 横向对比（异常实例 vs 正常实例）
[ ] 5. 逐层下钻（网关→应用→JVM→中间件→DB）
[ ] 6. 定位根因，验证假设
[ ] 7. 修复 + 补监控/告警 + 复盘
```

### 黄金法则
> 1. **先止血，后查因**
> 2. **用数据说话**，不猜
> 3. **缩小范围**，二分定位
> 4. **一次只改一个变量**
> 5. **留好现场**再重启
> 6. **复盘必做**，沉淀成 checklist
