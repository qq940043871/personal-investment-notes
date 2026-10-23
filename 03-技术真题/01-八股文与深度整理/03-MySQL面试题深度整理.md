# MySQL 深度面试题库

> 全栈架构师 · 面试考点全覆盖
> 覆盖 11 大章节 80+ 高频题：基础架构 → 索引 → 事务/MVCC → 锁 → 日志 → 主从复制 → 分库分表 → SQL 优化 → 数据库设计 → 场景题 → 进阶原理。

---

## 01 基础架构与存储引擎

### 1.1 一条 SELECT 语句在 MySQL 中的完整执行流程？
**流程**：`客户端 → 连接器 → 查询缓存(8.0已移除) → 分析器 → 优化器 → 执行器 → 存储引擎`

- **连接器**：TCP 握手、校验账号密码、获取权限；管理连接与空闲超时。
- **查询缓存**：8.0 之前按 SQL 文本缓存结果集，表一更新即失效，命中率低，8.0 已彻底移除。
- **分析器**：词法分析 → 语法分析，生成语法树；语法错误在此报出。
- **优化器**：决定执行计划——走哪个索引、连接顺序、是否索引下推。
- **执行器**：调用存储引擎接口取数；注意**权限在优化器之后才检查**。
- **存储引擎**：InnoDB 真正读写数据、维护 Buffer Pool 与行锁。

> 加分点：一条 UPDATE 还会触发 redo log 两阶段提交 + binlog 写入。

### 1.2 MySQL 逻辑架构分层
- **Server 层**：连接器/分析器/优化器/执行器 + 内置函数 + binlog + 视图/存储过程——跨引擎通用。
- **存储引擎层**：插件式（InnoDB/MyISAM/Memory），redo/undo log、Buffer Pool 属引擎层。
- 引擎通过统一的 `handler` 接口被 Server 层调用。

### 1.3 InnoDB vs MyISAM

| 维度 | InnoDB | MyISAM |
|---|---|---|
| 事务 | 支持 ACID | 不支持 |
| 锁粒度 | 行锁(+间隙锁) | 仅表锁 |
| 索引 | 聚簇索引（数据绑主键） | 非聚簇（存行指针） |
| 外键 | 支持 | 不支持 |
| MVCC | 支持 | 不支持 |
| 崩溃恢复 | redo+doublewrite | 无，可能损坏 |
| count(*) | 扫描 | O(1) 缓存 |

**为什么默认 InnoDB**：事务、行锁、外键、MVCC、崩溃恢复，5.5.5 起为默认引擎。

### 1.4 其他引擎
- **Memory**：数据在内存，重启丢失，适合临时表/缓存。
- **Archive**：只支持 INSERT/SELECT，高压缩，适合日志归档。
- **CSV/Blackhole**：CSV 可直接读文本；Blackhole 只收不存，用于复制中转。

---

## 02 索引原理与优化

### 2.1 为什么用 B+ 树做索引？
- **哈希表**：等值 O(1)，但不支持范围/排序/前缀；InnoDB 用它做自适应哈希索引。
- **AVL/红黑树**：树高随数据量增长，千万级 20+ 层 = 20+ 次磁盘 IO，不可接受。
- **B 树**：非叶子也存数据，扇出小、树更高；范围查询要中序遍历。
- **B+ 树**：非叶子只存键+指针，扇出大（16KB 页 ≈ 1170 分叉），**3 层 ≈ 2000 万行 = 3 次 IO**；叶子双向链表，范围查询/排序极快；查询路径稳定。

### 2.2 B+ 树 vs B 树
数据只存叶子 / 叶子有链表 / 树更矮扇出更大 / 范围查询快 / 查询路径等长。

### 2.3 聚簇索引、二级索引、回表、覆盖索引
- **聚簇索引**：主键即聚簇索引，叶子存整行；无主键则用第一个非空唯一索引，再没有生成隐藏 ROW_ID。
- **二级索引**：叶子存"索引列 + 主键值"。
- **回表**：二级索引 → 拿主键 → 回聚簇索引取整行，多一次 IO。
- **覆盖索引**：查询列全在索引里，无需回表（Extra: `Using index`）。

### 2.4 最左前缀原则
联合索引 `(a,b,c)` 相当于建了 a、(a,b)、(a,b,c) 三个索引，必须从最左连续匹配：

| 条件 | 是否走索引 |
|---|---|
| WHERE a=1 | ✅ |
| WHERE a=1 AND b=2 | ✅ |
| WHERE a=1 AND b=2 AND c=3 | ✅ |
| WHERE a=1 AND c=3 | ✅(a 用索引，c 走 ICP) |
| WHERE b=2 | ❌ |
| WHERE a>1 AND b=2 | ⚠️ b 在范围列之后失效 |

**设计启示**：等值条件放前，范围条件放后。

### 2.5 索引下推 ICP（5.6+）
将 WHERE 中能用索引判断的条件下推到引擎层过滤，减少回表。EXPLAIN Extra 显示 `Using index condition`。前提：下推列必须在二级索引中。

```sql
-- 例：(name, age) 联合索引
SELECT * FROM t WHERE name LIKE '张%' AND age=10;
-- 引擎层遍历索引时直接过滤 age=10，只有满足的行才回表
```

### 2.6 索引失效场景
1. 隐式类型转换：varchar 列与数字比较
2. 对索引列使用函数/运算：`DATE(create_time)=...`、`id+1=3`
3. LIKE 以 % 开头
4. OR 连接非索引条件
5. 联合索引范围列右侧失效
6. NOT IN / NOT LIKE / != / <>
7. 统计信息失真（ANALYZE TABLE 可刷新）
8. 表太小，优化器选全表扫描

> 最终以 EXPLAIN 为准。

### 2.7 普通索引 vs 唯一索引（change buffer）
- 查询：唯一索引命中即停，普通索引多找一条（代价极小）。
- 写入：唯一索引需先读后写判断唯一性，**不能用 change buffer**；普通索引可先记入 **change buffer**，读该页时再 merge，**减少随机 IO**。
- 适用：写多读少的普通二级索引收益大；写后立即读反而多一次 merge。
- 结论：无唯一性需求的列用普通索引。

### 2.8 前缀索引
大字段取前 N 字符建索引，省空间。坑：不能用于 ORDER BY 和覆盖索引；区分度不足要评估 `COUNT(DISTINCT LEFT(col,n))/COUNT(*)`。

### 2.9 自增主键 vs UUID
- 自增：追加写，几乎不页分裂，顺序 IO。
- UUID：随机无序 → 频繁**页分裂**、碎片、随机 IO；占用大，二级索引冗余主键成本高。
- 方案：雪花算法/号段生成趋势递增 bigint；UUID 可存 BINARY(16)。

### 2.10 索引设计规范
WHERE/ORDER BY/GROUP BY/JOIN ON 列优先；区分度 > 20%；避免冗余索引 (a) 与 (a,b) 并存；单表索引 ≤ 5~6 个；控制索引列长度。

---

## 03 事务与 MVCC

### 3.1 ACID 如何保证
| 特性 | 机制 |
|---|---|
| 原子性 | undo log 回滚 |
| 一致性 | 应用约束 + 各机制共同保证 |
| 隔离性 | 锁 + MVCC |
| 持久性 | redo log + doublewrite + 刷盘 |

### 3.2 隔离级别
RU（脏读）→ RC（避免脏读，可能不可重复读）→ RR（默认，避免不可重复读，基本避免幻读）→ Serializable（全避免）。

MySQL 的 RR 通过 MVCC（快照读）+ next-key lock（当前读）基本解决幻读。Oracle 默认 RC，很多互联网公司主动切 RC 提升并发。

### 3.3 MVCC 原理
- **隐藏字段**：DB_TRX_ID（最近修改事务 ID）、DB_ROLL_PTR（回滚指针 → undo 版本链）、DB_ROW_ID。
- **ReadView**：m_ids（活跃事务列表）、min_trx_id、max_trx_id、creator_trx_id。
- **可见性判断**：
```
trx_id == creator_trx_id      → 自己改的，可见
trx_id < min_trx_id           → 已提交，可见
trx_id >= max_trx_id          → 视图之后的事务，不可见
trx_id ∈ m_ids                → 仍在活跃，不可见
否则                           → 已提交，可见
```
- 一句话：读操作沿 undo 版本链按 ReadView 找到"快照创建时刻可见"的版本，不加锁实现隔离。

### 3.4 RR vs RC 的 MVCC 区别
- **RC**：每次快照读都生成新 ReadView → 能看到新提交 → 不可重复读。
- **RR**：事务内第一次快照读生成 ReadView 并复用 → 全程同一快照。

经典坑：RR 下先 SELECT 再 UPDATE（当前读），UPDATE 基于最新版本，快照读仍显示旧值。

### 3.5 快照读 vs 当前读
- 快照读：普通 SELECT，MVCC，不加锁。
- 当前读：`SELECT ... FOR UPDATE` / `LOCK IN SHARE MODE` / UPDATE / DELETE / INSERT，读最新版并加锁。

### 3.6 幻读解决
快照读靠 MVCC；当前读靠 **next-key lock（记录锁+间隙锁）** 阻止插入。严格讲 InnoDB 的 RR 不是标准定义下的"完全无幻读"（先快照读后插入再更新的场景仍可能感知到），能指出边界是加分项。

### 3.7 长事务危害
持锁阻塞并发、undo 无法清理撑爆磁盘、版本链过长影响查询、拖慢主从同步。避免：及时 COMMIT、autocommit=1、事务内不做远程调用/大查询、巡检 innodb_trx。

---

## 04 锁机制

### 4.1 锁分类
- **全局锁**：FLUSH TABLES WITH READ LOCK，备份用（推荐 mysqldump --single-transaction）。
- **表级锁**：表锁、**MDL 元数据锁**（DDL 与 DML 互斥）、**意向锁 IS/IX**（表级标记，不阻塞）。
- **行级锁**：记录锁、间隙锁、临键锁。**加在索引记录上**——无索引 WHERE 会全表加锁（经典坑）。
- **自增锁**：AUTO-INC Lock，8.0 支持交错模式提并发。

### 4.2 记录锁 / 间隙锁 / 临键锁
- 记录锁：锁单条索引记录。
- 间隙锁：锁开区间，只阻止插入。
- 临键锁：记录锁+前向间隙锁，左开右闭 (a,b]，RR 下加锁默认单位。
- 间隙锁/临键锁**只在 RR 及以上生效**；RC 只有记录锁。

### 4.3 InnoDB 加锁规则（丁奇版）
1. 原则1：加锁基本单位是 next-key lock（前开后闭）。
2. 原则2：查找过程中访问到的对象才加锁。
3. 优化1：等值查询向右遍历到第一个不满足等值条件的值，next-key 退化为**间隙锁**。
4. 优化2：唯一索引等值查询命中，next-key 退化为**记录锁**。
5. 已知现象：唯一索引**范围查询**会锁到第一个不满足条件的值（右边界也加锁）。

```sql
-- 表 t(id 唯一, 数据 1,3,5,10)，RR：
SELECT * FROM t WHERE id=5 FOR UPDATE;   -- 只锁 5（记录锁）
SELECT * FROM t WHERE id=3 FOR UPDATE;   -- 3 不存在 → 间隙锁 (1,3)
SELECT * FROM t WHERE id>=3 FOR UPDATE;  -- 锁 (1,3]...(10,+∞)
```

### 4.4 死锁
- 定义：循环等待。
- 处理：等待图检测，**回滚代价最小的事务**，抛 1213，应用重试。
- 避免：固定顺序访问、缩小锁范围、控制事务大小、RC 降级、热点行高并发可关死锁检测用锁超时兜底。
- 查看：`SHOW ENGINE INNODB STATUS` 的 LATEST DETECTED DEADLOCK。

### 4.5 乐观锁 vs 悲观锁
- 悲观锁：SELECT ... FOR UPDATE（须在事务内、走索引）。
- 乐观锁：版本号 / 条件更新，UPDATE 受影响行数=0 则重试。
```sql
UPDATE t SET stock=stock-1, version=version+1 WHERE id=1 AND version=3;
UPDATE t SET stock=stock-1 WHERE id=1 AND stock>0;
```

---

## 05 日志与可靠性

### 5.1 redo log 与 WAL
- redo log：InnoDB 层**物理日志**（页修改），崩溃恢复前滚，保证持久性。
- WAL：先写日志（顺序写）再刷脏页，大幅提升写性能。
- 循环写文件，write pos 与 checkpoint；`innodb_flush_log_at_trx_commit`：1(每次fsync)/0(每秒)/2(写OS cache每秒刷)。

### 5.2 binlog 三种格式
- **STATEMENT**：原始 SQL，日志小，非确定性函数（NOW/UUID/LIMIT）可能主从不一致。
- **ROW**（8.0 默认）：行级变更，最安全，日志大。
- **MIXED**：默认 STATEMENT，非安全语句自动切 ROW。

### 5.3 redo vs binlog
| 项 | redo log | binlog |
|---|---|---|
| 层 | InnoDB 层 | Server 层 |
| 内容 | 物理（页修改） | 逻辑（SQL/行变更） |
| 写入 | 循环写 | 追加写归档 |
| 作用 | 崩溃恢复 | 复制、恢复 |

### 5.4 两阶段提交
```
1. 写 redo log = PREPARE
2. 写 binlog
3. 写 redo log = COMMIT
```
崩溃恢复判断：redo PREPARE + binlog 不存在 → 回滚；redo PREPARE + binlog 存在 → 提交；redo COMMIT → 提交。
配合**组提交**减少 fsync；双1配置（sync_binlog=1 + innodb_flush_log_at_trx_commit=1）最安全。

### 5.5 undo log
回滚 + MVCC 版本链；purge 线程清理不被引用的版本。

### 5.6 doublewrite buffer
解决**部分页写入（torn page）**：16KB 页只写一半，redo 无法恢复坏页。先整页写入双写区（2MB 连续写），再写数据文件。SSD/云盘原子写场景可关闭（innodb_doublewrite=0）。

---

## 06 主从复制与高可用

### 6.1 复制原理
```
主库 binlog ──(IO线程)──▶ relay log ──(SQL线程)──▶ 从库数据
```
8.0 支持 GTID：事务全局唯一 ID，自动跳过已执行事务，切换无需找位点。扩展：一主多从、级联复制。

### 6.2 异步 / 半同步 / MGR
- 异步：不等确认，延迟小可能丢数据。
- 半同步：等至少一个从库 ACK 才返回，降低丢数据风险；从库故障会阻塞写入（可降级异步）。
- MGR：Paxos 共识 + 多主，强一致自动选主，需 3 节点以上、网络稳定。

### 6.3 主从延迟
**原因**：SQL 线程单线程回放跟不上、大事务、DDL/锁传导、从库负载。
**解决**：并行复制（5.7 按库、8.0 writeset 事务级）、拆分大事务、一主多从分流、监控 Seconds_Behind_Master。
**读写分离注意**：写完立即读可能读到旧数据，一致性要求高的走主库。

### 6.4 高可用与脑裂
- MHA（经典）、Orchestrator（拓扑管理）、MGR + Router（官方推荐）、双主 + VIP。
- **脑裂**：网络分区两个主同时写。避免：过半仲裁（Paxos）、心跳+仲裁、fencing/STONITH 强制下线旧主。
- 一致性校验：pt-table-checksum + pt-table-sync。

### 6.5 主从不一致排查
pt-table-checksum 定位 → 常见原因（STATEMENT 格式/人工改从库/复制中断/DDL）→ pt-table-sync 回补或重建从库 → 预防：ROW 格式 + GTID + 定期巡检。

---

## 07 分库分表

### 7.1 何时需要
- 分库：连接数/IO 瓶颈、业务域拆分。
- 分表：单表千万~亿级或 >10GB，B+ 树加深、缓冲命中率下降、DDL 阻塞。
- **先做减法**：归档、加索引、优化 SQL、换硬件。垂直优先，水平次之。

### 7.2 垂直 vs 水平
- 垂直分库：按业务域（用户库/订单库/库存库）。
- 垂直分表：大字段拆扩展表。
- 水平分表：同结构拆 t_order_0..N，路由计算、扩容复杂。

### 7.3 分片键与算法
- 分片键：选最频繁的等值条件（user_id），保证均匀、避免时间热点。
- 取模：均匀但扩容全量迁移；范围：扩容友好可能倾斜；一致性哈希：扩容只影响相邻；**基因法**：订单号嵌入 user_id 哈希后缀，订单号/user_id 都能直接路由（电商经典）。

### 7.4 平滑扩容
双写 + 全量迁移 + 校验 + 灰度切换；取模翻倍只迁一半；配合 canal 订阅 binlog 做增量。

### 7.5 分布式 ID
数据库自增（可步长错位）/ Redis INCR / UUID（无序不适合主键）/ **雪花算法**（1符号+41毫秒时间戳+10机器+12序列，趋势递增无中心；**时钟回拨**会重复，可用 Leaf-snowflake+ZK）/ 号段模式（Leaf-segment）。

### 7.6 跨库难题
- join：应用层内存组装 / 字段冗余 / 宽表/ES。
- 事务：XA（刚性慢）/ TCC / **本地消息表+MQ（最终一致，最常用）** / Saga。
- 全局分页：各分片 limit + 归并；深分页用**游标翻页**。
- 中间件：ShardingSphere-JDBC（客户端主流）/ ShardingSphere-Proxy、MyCat（服务端透明）。

---

## 08 SQL 优化与调优

### 8.1 EXPLAIN 关键列
- **type**（重点）：system > const > eq_ref > ref > range > index > ALL，至少到 range/ref。
- **key/key_len**：实际索引/长度（判断联合索引用了几列）。
- **rows**：预估扫描行数。
- **Extra**：Using index（覆盖✅）/ Using index condition（ICP✅）/ Using filesort⚠️ / Using temporary⚠️ / Using join buffer⚠️。
- 注意 rows 是估算值。

### 8.2 定位慢 SQL
慢查询日志（long_query_time=1）→ mysqldumpslow / pt-query-digest 汇总 → SHOW PROCESSLIST 抓实时 → EXPLAIN 分析 → 加索引/改写 SQL/上缓存。

### 8.3 深分页优化
LIMIT 1000000,10 要扫 100 万行。方案：
```sql
-- 延迟关联
SELECT * FROM t WHERE id IN (SELECT id FROM t WHERE xxx ORDER BY id LIMIT 1000000, 10);
-- 游标翻页（推荐，适合下一页场景）
SELECT * FROM t WHERE id > 1000000 ORDER BY id LIMIT 10;
```
游标翻页不能随机跳页。

### 8.4 count(*) 优化
count(*) 与 count(1) 等价；count(列) 数非空最慢。InnoDB 无行数缓存（MVCC 可见性）。优化：汇总计数表 / Redis 缓存 / 接受近似值（SHOW TABLE STATUS、EXPLAIN rows）/ 归档。

### 8.5 ORDER BY / GROUP BY / JOIN
- 排序：排序列命中索引免 filesort；减少 SELECT 列宽。
- 分组：走索引免临时表。
- JOIN：小表驱动大表（NLJ 被驱动表走索引）；无索引用 BNL/Hash Join（8.0）；MRR 把随机回表变顺序读。

### 8.6 大表 DDL
直接 ALTER 加 MDL 锁阻塞 DML。方案：Online DDL（ALGORITHM=INPLACE, LOCK=NONE）、**pt-osc / gh-ost**（建新表拷贝+binlog 同步+rename，生产标准做法）、8.0 INSTANT 即时加列。

### 8.7 Buffer Pool 调优
大小设物理内存 60%~75%（innodb_buffer_pool_size）；多 instance 减少争用；LRU 冷热区防全表扫描挤占热点；命中率 >99%。

### 8.8 连接数打满
SHOW PROCESSLIST 找长连接/慢 SQL 并 kill → 排查连接泄漏、连接池过大、wait_timeout → max_connections 调大要评估内存 → 读写分离分流。

### 8.9 SQL 注入预防
预编译参数绑定（PreparedStatement / MyBatis #{}）最有效；白名单校验；最小权限账号；屏蔽错误堆栈；${} 动态拼接单独做白名单。

---

## 09 数据库设计

### 9.1 三范式与反范式
- 1NF 字段原子；2NF 完全依赖；3NF 无传递依赖。
- 反范式：刻意冗余换查询性能（少 join、报表直接查），一致性靠业务保证。
- 经验：核心交易链路偏范式，查询聚合场景偏反范式。

### 9.2 字段类型规范
- 金额用 **DECIMAL(18,2)**，绝不用 FLOAT/DOUBLE。
- 时间用 DATETIME（TIMESTAMP 有 2038 限制），需要毫秒用 DATETIME(3)。
- 字符集统一 **utf8mb4**；NOT NULL DEFAULT；大字段拆表；主键推荐自增/雪花 bigint。

### 9.3 MySQL 与 Redis 缓存一致性
- Cache Aside：写时先更新 DB 再**删缓存**（不是更新）。
- 延迟双删：更新后删缓存，等 1~2 秒再删一次。
- **canal 订阅 binlog**：应用只写 DB，canal 删缓存——解耦可靠，主流方案。
- 目标最终一致；强一致不依赖缓存。

### 9.4 大字段影响
TEXT/BLOB 可能溢出到 off-page，主页只存指针 → 额外 IO。方案：拆表、只 SELECT 必要列、内容放 OSS。

---

## 10 高频场景题

### 10.1 千万级表查询慢
定位（EXPLAIN/慢日志）→ 索引优化（联合索引/覆盖索引）→ SQL 优化（免函数/隐式转换/深分页，游标翻页）→ 架构（归档冷数据、读写分离、缓存、分表）→ 硬件（Buffer Pool/SSD）。

### 10.2 秒杀防超卖
前端限流 → Redis Lua 原子预扣 → MQ 削峰 → DB 条件更新 `UPDATE t_stock SET stock=stock-1 WHERE sku_id=? AND stock>0` 兜底 + 幂等（订单号唯一索引）→ 超时未支付回补库存。
**防超卖本质**：读-判断-写 变成原子条件更新。

### 10.3 订单号设计
全局唯一 + 趋势递增 + 可路由分片 + 可读。雪花变体/号段 + 尾部嵌入分片基因。不要用数据库自增对外暴露。

### 10.4 误删数据恢复
前提 binlog_format=ROW。mysqlbinlog 按时间点/位点解析，回放到误操作前一秒；或全量备份+增量 binlog。预防：sql_safe_updates、DML 前备份、定期演练。

### 10.5 数据库 CPU 100%
SHOW PROCESSLIST 找慢会话 → 慢查询日志/监控定位 SQL → EXPLAIN 分析 → 加索引/改写/kill → 长期 SQL 评审、读写分离。

### 10.6 好友关系表
```sql
CREATE TABLE friend (
  user_id BIGINT NOT NULL, friend_id BIGINT NOT NULL, created_at DATETIME NOT NULL,
  PRIMARY KEY (user_id, friend_id), KEY idx_friend (friend_id)
) ENGINE=InnoDB;
```
存两行（A→B、B→A）简化列表查询；按 user_id 分片。

### 10.7 树形结构
邻接表（8.0 递归 CTE）/ 路径枚举 / 闭包表（查询 O(1) 写放大）。评论深层级场景：闭包表或冗余 path + 缓存。

---

## 11 进阶原理

### 11.1 一条 UPDATE 的内部流程
定位加锁（当前读+X锁/next-key）→ 读页进 Buffer Pool → 写 undo（版本链）→ 改内存页（脏页）→ 写 redo(PREPARE) → 写 binlog → redo(COMMIT) → 返回，脏页延迟刷盘。

### 11.2 Buffer Pool LRU 优化
冷热两区（冷区 37%）：新页进冷区头部，停留超 1000ms 再访问才晋升热区——全表扫描的一次性页不会挤掉热点。预读机制减少连续 IO。

### 11.3 自增主键用尽
TINYINT 127 / INT 21.47 亿 / BIGINT 922亿亿。用尽后 INSERT 报主键冲突。8.0 计数器持久化到 redo（重启不回退），5.7 重启可能复用已删最大值。

### 11.4 一张表能存多少行
16KB 页、主键 8B+指针 6B ≈ 1170 分叉/页；3 层 ≈ 1170×1170×16 ≈ **2190 万行**（行 1KB）。千万级仍 3~4 次 IO，但运维/锁/DDL 成本上升。

### 11.5 CHAR vs VARCHAR
CHAR 定长读取快无碎片；VARCHAR 变长省空间（1~2 字节长度前缀）。上限 65535 字节（utf8mb4 约 16383 字符）。定长短字段用 CHAR，长短差异大用 VARCHAR。

### 11.6 utf8 vs utf8mb4
MySQL 的 utf8 = utf8mb3，最多 3 字节，存不了 emoji 和生僻字；utf8mb4 才是完整 UTF-8。8.0 默认 utf8mb4。迁移注意索引 key_len 变长。

### 11.7 NULL 的影响
IS NULL/IS NOT NULL 可走索引（与 Oracle 不同）；count(列) 跳过 NULL；**唯一索引允许多个 NULL**；WHERE col != 'x' 不匹配 NULL；排序 NULL 最前。建议 NOT NULL DEFAULT。

### 11.8 MySQL 8.0 重要变化
默认 utf8mb4、binlog_format=ROW、CTE 与窗口函数、移除查询缓存、数据字典入 InnoDB、Hash Join、INSTANT 加列、caching_sha2_password、增强并行复制（writeset）、SHOW REPLICA STATUS 新命名。

---

*整理时间：2026-08 · 建议结合线上 EXPLAIN 实测验证各规则*
