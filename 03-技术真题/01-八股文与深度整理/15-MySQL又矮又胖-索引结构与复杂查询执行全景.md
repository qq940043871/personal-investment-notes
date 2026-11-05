# MySQL 为什么设计得「又矮又胖」——从 16KB 页到复杂查询执行的完整账本

> **定位**：同目录 `03-MySQL面试题深度整理` 是广度题库，`04-MySQL八股文追问链` 是追问纵深，**这份专攻物理层**：一个 16KB 的页里到底装了什么、树为什么必须矮、范围/IN/LIKE/排序/GROUP BY/SUM 分别在结构上退化成什么动作、多表 join 又是怎么把这些动作串起来还不炸。
>
> **读法**：不要背结论。全文只有一条主线——**B+ 树用「结构自带的顺序」把昂贵的排序与随机查找，换成了廉价的顺序扫描**。能自己推出这条主线，剩下的都是细节。

---

## 目录

- [00 一页纸结论](#00-一页纸结论)
- [01 账本：为什么必须矮（树高 = 随机 IO 次数）](#01-账本为什么必须矮树高--随机-io-次数)
- [02 账本：为什么必须胖（16KB 一页的真实布局）](#02-账本为什么必须胖16kb-一页的真实布局)
- [03 六个基础动作：结构上到底发生了什么](#03-六个基础动作结构上到底发生了什么)
- [04 范围查询：定位下界 + 叶子链表右扫](#04-范围查询定位下界--叶子链表右扫)
- [05 LIKE：什么时候能二分，什么时候只能全扫](#05-like什么时候能二分什么时候只能全扫)
- [06 IN：一堆等值如何变成有序区间](#06-in一堆等值如何变成有序区间)
- [07 ORDER BY：索引序 vs filesort 的全部细节](#07-order-by索引序-vs-filesort-的全部细节)
- [08 GROUP BY：松散扫描、紧凑扫描、临时表](#08-group-by松散扫描紧凑扫描临时表)
- [09 SUM / COUNT / MIN / MAX：聚合的物理代价](#09-sum--count--min--max聚合的物理代价)
- [10 多表关联：把多张表压回一次有序扫描](#10-多表关联把多张表压回一次有序扫描)
- [11 关联 + 排序为什么会炸，以及五种救法](#11-关联--排序为什么会炸以及五种救法)
- [12 一次真实 SQL 的完整解剖](#12-一次真实-sql-的完整解剖)
- [13 辟谣：十二个被说烂的错误结论](#13-辟谣十二个被说烂的错误结论)
- [14 面试话术：60 秒 / 3 分钟 / 被打断时怎么接](#14-面试话术60-秒--3-分钟--被打断时怎么接)
- [15 参数速查表与源码入口](#15-参数速查表与源码入口)
- [16 自测 18 题](#16-自测-18-题)

### 图目录（先看图再看字，最快）

| 图 | 讲清什么 | 位置 |
|---|---|---|
| 图 1 | 树高 = 随机 IO 次数，三种结构差 9 倍 | §01 开头 |
| 图 2 | 同一棵 B+ 树的两种页：非叶导航 / 叶子整行 + 双向链表 | §02 开头 |
| 图 3 | 16KB 页的区域划分 + 页内「slot 二分 + ≤8 条链表比较」 | §2.1 |
| 图 4 | 范围查询：定位下界 → 沿叶子链表右扫 → 上界截断 | §04 开头 |
| 图 5 | ORDER BY 的四道判定门：走索引序还是 filesort | §07 开头 |
| 图 6 | filesort 内部流水线：sort_buffer → chunk → 多路归并 | §7.2 |
| 图 7 | GROUP BY 三条路径的代价对比 | §08 开头 |
| 图 8 | INLJ 执行过程，以及「输出为什么天然保序」 | §10.2 |
| 图 9 | 关联 + 排序必炸的算术链条 | §11.2 |

---

## 00 一页纸结论

**「矮」的定义**：一棵 B+ 树从根到叶子通常只有 **3~4 层**。也就是说，一次点查最多读 3~4 个 16KB 的页。根页几乎常驻 Buffer Pool，实际磁盘 IO 常常只有 2~3 次。

**「胖」的定义**：每个节点不是一个 key，而是一整个 **16KB 的页**，里面塞 900~1200 个键值（非叶子）或十几到上千行记录（叶子）。节点越"胖"，同样高度能装的键越多，扇出（fanout）越大。

**这两件事是同一件事**：树高 `H = ⌈log_fanout(N)⌉`。想让 H 小，只有两条路——要么把 fanout 做大（胖），要么把 N 做小（不可能）。所以**「胖」是「矮」的手段，「矮」是目的**。

**目的又是什么**：把随机磁盘 IO 次数压到最小。机械盘随机读 ~5~10 ms、顺序读带宽 ~100~200 MB/s；SSD 随机读 ~0.05~0.2 ms；NVMe 顺序读 3~7 GB/s。随机 IO 与顺序 IO 的代价差 **2~4 个数量级**。树高每多 1 层，就等于每次查询多付一次随机 IO。

**一个关键推论**（后文全在用它）：B+ 树的叶子是**按 key 物理有序、且用双向链表串起来的**。于是——

> SQL 里所有"要排序、要去重、要找区间"的操作，只要能落到索引的有序前缀上，就从 `O(n log n)` 的排序，退化成 `O(log n + k)` 的定位 + 顺序扫描。

一张表把这件事说穿：

| SQL 形态 | 在 B+ 树上实际发生的事 | 代价 | 生效前提 |
|---|---|---|---|
| `WHERE a = ?` | 根→叶二分下降，页内 slot 二分 | H 次页读 | 索引可用 |
| `a BETWEEN x AND y` / `a > x` | 下降定位下界，沿叶子链表右扫 | H + k / 页容量 | 最左前缀 |
| `a IN (1,3,5)` | 拆成多个等值区间，按 key 排序后依次扫 | m×H + Σk | m 不大 |
| `LIKE 'abc%'` | 优化器改写成区间 `[abc, abd)` | 同范围查询 | 通配符不在首位 |
| `LIKE '%abc%'` | 无法定界 → 全索引扫 / 全表扫 | O(N) | —— |
| `ORDER BY a` | 走索引序（0 排序）或 filesort | 0 或 k·log k | 列序 + 方向匹配 |
| `GROUP BY a` | 松散索引扫 / 紧凑索引扫 / 临时表 | 组数·log n 或 O(N) | 前缀匹配 |
| `SUM/MIN/MAX` | 全索引扫 / 直接取树两端 | O(N) 或 O(H) | —— |
| 多表 JOIN + ORDER BY | 让**驱动表**按序输出，nested loop 天然保序 | 同单表 | 排序键全来自驱动表 |

---

## 01 账本：为什么必须矮（树高 = 随机 IO 次数）

<figure>
<svg viewBox="0 0 1180 452" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Microsoft YaHei,PingFang SC,sans-serif">
<rect width="1180" height="452" rx="14" fill="#F7F9FC" stroke="#E3E7EE"/>
<text x="28" y="34" font-size="17" font-weight="700" fill="#1F2937">图 1｜「矮」的全部价值：树高 = 每次点查的随机 IO 次数</text>
<text x="28" y="56" font-size="12" fill="#4B5563">同样 1 亿行：二叉/跳表 27 层、B 树 5 层、B+ 树 3 层。HDD 一次随机读 5~10ms —— 多一层就是多付一次。</text>
<rect x="28" y="72" width="362" height="300" rx="12" fill="#FFFFFF" stroke="#E3E7EE"/>
<text x="48" y="100" font-size="14" font-weight="700" fill="#C0504D">二叉搜索树 / 跳表</text>
<text x="48" y="120" font-size="11.5" fill="#8A93A0">fanout = 2，每层只排除一半</text>
<g fill="#FBEAEA" stroke="#E7B6B4">
<rect x="48" y="136" width="152" height="20" rx="4"/>
<rect x="48" y="160" width="152" height="20" rx="4"/>
<rect x="48" y="184" width="152" height="20" rx="4"/>
<rect x="48" y="208" width="152" height="20" rx="4"/>
</g>
<text x="128" y="196" font-size="14" fill="#C0504D" font-weight="700" text-anchor="middle">︙</text>
<g fill="#FBEAEA" stroke="#E7B6B4">
<rect x="48" y="240" width="152" height="20" rx="4"/>
<rect x="48" y="264" width="152" height="20" rx="4"/>
</g>
<text x="286" y="206" font-size="44" font-weight="800" fill="#C0504D" text-anchor="middle">27</text>
<text x="286" y="228" font-size="12" fill="#C0504D" text-anchor="middle">层</text>
<text x="48" y="316" font-size="12.5" fill="#4B5563">点查 = 27 次随机 IO</text>
<text x="48" y="340" font-size="11.5" fill="#8A93A0">节点在磁盘上毫无局部性，预读失效</text>
<rect x="412" y="72" width="362" height="300" rx="12" fill="#FFFFFF" stroke="#E3E7EE"/>
<text x="432" y="100" font-size="14" font-weight="700" fill="#C2803A">B 树</text>
<text x="432" y="120" font-size="11.5" fill="#8A93A0">非叶也存整行 → fanout ≈ 80</text>
<g fill="#FBF0E4" stroke="#DCB98E">
<rect x="432" y="136" width="152" height="20" rx="4"/>
<rect x="432" y="160" width="152" height="20" rx="4"/>
<rect x="432" y="184" width="152" height="20" rx="4"/>
<rect x="432" y="208" width="152" height="20" rx="4"/>
<rect x="432" y="232" width="152" height="20" rx="4"/>
</g>
<text x="670" y="206" font-size="44" font-weight="800" fill="#C2803A" text-anchor="middle">5</text>
<text x="670" y="228" font-size="12" fill="#C2803A" text-anchor="middle">层</text>
<text x="432" y="316" font-size="12.5" fill="#4B5563">点查 = 5 次随机 IO</text>
<text x="432" y="340" font-size="11.5" fill="#8A93A0">范围查询要中序遍历，路径不稳定</text>
<rect x="796" y="72" width="356" height="300" rx="12" fill="#FFFFFF" stroke="#E3E7EE"/>
<text x="816" y="100" font-size="14" font-weight="700" fill="#3F8F5E">B+ 树（InnoDB）</text>
<text x="816" y="120" font-size="11.5" fill="#8A93A0">非叶只存 key + 4B 页号 → fanout ≈ 950</text>
<g fill="#E9F5EE" stroke="#9CCBAE">
<rect x="816" y="136" width="152" height="24" rx="4"/>
<rect x="816" y="168" width="152" height="24" rx="4"/>
<rect x="816" y="200" width="152" height="24" rx="4"/>
</g>
<g font-size="11" fill="#3F8F5E" text-anchor="middle">
<text x="892" y="152">根页</text>
<text x="892" y="184">中间页</text>
<text x="892" y="216">叶子页（整行）</text>
</g>
<text x="1052" y="206" font-size="44" font-weight="800" fill="#3F8F5E" text-anchor="middle">3</text>
<text x="1052" y="228" font-size="12" fill="#3F8F5E" text-anchor="middle">层</text>
<text x="816" y="316" font-size="12.5" fill="#3F8F5E">点查 = 3 次随机 IO（根常驻 → 实际 2 次）</text>
<text x="816" y="340" font-size="11.5" fill="#8A93A0">叶子有序 + 双向链表 → 范围/排序免费</text>
<text x="28" y="404" font-size="13" fill="#1F2937">H = ⌈ log<tspan font-size="10">fanout</tspan>(N) ⌉　→　3 层容量 = 950 × 950 × 16 行 ≈ 1440 万（1KB 行宽）；4 层 ≈ 137 亿</text>
<text x="28" y="430" font-size="12" fill="#8A93A0">想让 H 变小，只有一条路：把 fanout 做大，也就是「胖」。所以「胖」是手段，「矮」是目的。</text>
</svg>
<figcaption>图 1：三种结构的层数对比。不要把「矮」当成结论背，它只是「一次 IO 搬 16KB」这个前提的必然结果。</figcaption>
</figure>

### 1.1 先把成本说清楚：一次随机 IO 有多贵

| 介质 | 随机读延迟 | 顺序读带宽 | 4KB 随机 IOPS |
|---|---|---|---|
| 7200 转 SATA HDD | 5~10 ms（含寻道+旋转） | 100~200 MB/s | ~100~200 |
| SATA SSD | 0.05~0.1 ms | 500 MB/s | ~50k~100k |
| NVMe SSD | 0.02~0.08 ms | 3~7 GB/s | ~300k~800k |

换算成"每次查询的等待"：

- HDD 上 4 层树 = 4 × 8 ms ≈ **32 ms**；3 层 = 24 ms；2 层 = 16 ms。差一层就是 8 ms，是服务端 P99 的生死线。
- NVMe 上 4 层 ≈ 0.2 ms，看起来无所谓，但 **IOPS 是共享资源**：QPS 1 万 × 4 次 IO = 4 万 IOPS，已经吃掉普通 NVMe 的 10%；再叠上回表、二级索引、join，很容易打满。

所以"矮"在 HDD 时代是保命，在 NVMe 时代是**省 IOPS 预算**。这就是为什么 30 年过去，B+ 树依然是默认结构。

### 1.2 为什么一次搬 16KB，而不是 1 个 key

磁盘和文件系统的最小操作单位不是字节，是**块**：ext4/XFS 默认 4KB block，SSD 内部 page 通常 4KB/8KB/16KB。你读 1 个字节，实际也要搬 4KB。既然搬 4KB 和搬 16KB 的**寻道成本一样**，那就一次搬 4 个 block。

这就是 InnoDB 页大小的来源：

```
innodb_page_size 默认 16384（16KB），可设 4K / 8K / 16K / 32K / 64K（建库时定死，不可改）
16KB = 4×4KB（ext4 block / SSD page 对齐）
     = 顺序预读的最小有效粒度（innodb_read_ahead_threshold = 56 页触发线性预读）
     = doublewrite 一次批量 2MB = 128 页的整数分片
```

**这条"一次 IO 搬一整页"的设定，是后面所有细节的根**：页内再多的记录、再多的比较，都不额外花 IO；只有"跨页"才花 IO。所以：

> B+ 树的所有优化方向，都是**把更多的比较塞进同一次 IO 里**。这就是"胖"。

### 1.3 树高公式与逐结构对比

```
H = ⌈ log_fanout(N) ⌉        # N = 记录数，fanout = 单页可容纳的分支数
查询 IO 次数 ≈ H（根页常驻内存时 ≈ H-1）
```

不同结构的 fanout 与 1 亿行所需层数：

| 结构 | 单节点/单页容量 | fanout | 1 亿行树高 | 每次点查的随机 IO |
|---|---|---|---|---|
| 二叉搜索树 / AVL / 红黑树 | 1 key + 2 指针 | 2 | **~27 层** | 27 |
| 跳表（Redis ZSet 那种） | 期望 1/2 概率升层 | 2（每层） | **~27 层** | 27 |
| B 树（非叶也存整行，行宽 200B） | 16KB / 200B ≈ 80 | 80 | **~5 层** | 5 |
| B+ 树（非叶只存 key+页号，bigint 主键） | 16KB / 17B ≈ **950** | 950 | **3~4 层** | 3~4 |
| LSM-Tree（RocksDB，SST + Bloom） | 层数随 compaction 增长 | —— | 写极快，读要查多层 + Bloom | 读放大 10~30 |

一句话解释差距：**B 树和 B+ 树的差别不在"平衡"，而在"非叶子节点里放不放数据"**。放了数据，扇出掉一个数量级（80 vs 950），树就高一层；而一层 = 一次随机 IO。

### 1.4 精确算一遍"3 层到底能存多少"

先算**非叶子节点的真实记录大小**（bigint 主键为例）：

```
非叶记录 = 5B 记录头(record header)
         + 8B 主键值(key)
         + 4B 子页页号(child page no)
         = 17B

一页可用空间 ≈ 16384 - 76(FIL Header 38B + Page Header 38B) - 26(infimum/supremum)
              - 页目录(约 2B × 槽数) ≈ 16200B

单页扇出 ≈ 16200 / 17 ≈ 950
```

> 面试常引用的 `1170` 是**粗算**：把记录头也算成 `key(8) + pointer(6) = 14B` → `16384/14 ≈ 1170`。两种算法差 20%，不影响结论，但能说出"我按 17B 算是 950，常说的 1170 是只算 key+pointer"就已经赢了一半人。

再算叶子：叶子存的是**整行**，行宽直接决定每页能放多少行。

```sql
-- 假设行宽 1KB（宽表，含几个 varchar）
叶页行数 ≈ 16200 / 1024 ≈ 15~16 行
```

于是三个层次的容量：

| 行宽 | 叶页行数 | 3 层容量（根 1 + 中间 950 + 叶） | 4 层容量 |
|---|---|---|---|
| 1 KB | 16 | 950 × 950 × 16 ≈ **1440 万** | 950³ × 16 ≈ **137 亿** |
| 200 B | 80 | 950 × 950 × 80 ≈ **7200 万** | 685 亿 |
| 100 B | 160 | 950 × 950 × 160 ≈ **1.44 亿** | 1370 亿 |
| 按 1170 粗算 + 1KB 行 | 16 | 1170² × 16 ≈ **2190 万**（即"2000 万"的出处） | —— |

**由此得到三个工程结论**：

1. **"3 层 2000 万"是有前提的**：行宽约 1KB、主键 bigint。窄表 3 层能撑上亿，宽表（一堆 text/json）可能 1000 万就到 4 层。
2. **想让树变矮，最便宜的办法是让行变窄**：垂直拆分大字段、把 history 表拆冷热、`TEXT/BLOB` 走行溢出（见 2.6）。行宽从 1KB 降到 200B，3 层容量直接 ×5。
3. **二级索引天然比聚簇索引"更矮"**：它叶页只存 `(索引列, 主键)`，一行可能只有 20~40B，一页能放 400~800 项。这就是后文"为什么全表扫描时优化器偏爱二级索引"的物理原因。

### 1.5 为什么不能"又高又瘦"（这是本题的核心）

把二叉树/跳表放进磁盘，会发生四件坏事：

1. **每层一次随机 IO**。27 层 = 27 次 `pread`，且这 27 个页在磁盘上**毫无局部性**（指针跳来跳去），预读完全失效。
2. **一次 IO 只换来 1 次比较**。16KB 的搬运成本 vs 1 个 key 的收益，带宽利用率 0.02%。而 B+ 树的非叶页一次 IO 换来 ~950 次比较。
3. **页内二分彻底失效**。页内只有 1~2 条记录，没有可二分的空间。
4. **缓存不友好**。缓存一个 B+ 树非叶页（16KB）就能覆盖 950 条路径；缓存二叉树一个节点只覆盖 1 条路径。同样 1GB Buffer Pool，B+ 树能缓存几亿行的"导航层"，二叉树只能缓存几百万个节点。

反过来说，**"瘦"唯一的好处是写**：插入只改 1 个节点。而 B+ 树一次分裂要写 2 个页 + 改父页 + 写 redo。这也是 LSM-Tree（RocksDB/HBase）存在的理由——**用读放大换写放大**。所以结构选型的本质是一句话：

> **读多写少、要范围要排序 → B+ 树；写极多、读按 key、能容忍读放大 → LSM。**

### 1.6 为什么不再胖一点（32KB / 64KB 页）

既然胖有好处，为什么不胖到底？因为胖有四个硬顶：

| 加页大小的代价 | 具体机制 |
|---|---|
| **写放大** | 改 1 行也要整页刷盘（16KB→64KB，写放大 ×4）；redo 记录相应变大 |
| **页分裂更贵** | 分裂要把半页数据复制到新页，64KB 页的分裂 = 32KB memcpy + 2 次 64KB 落盘 |
| **内存浪费** | Buffer Pool 以页为最小分配单位，热点只有几行的小表也会吃掉 64KB；随机访问稀疏时命中率下降 |
| **崩溃恢复更慢** | doublewrite/checksum/页修复的粒度变大，单页损坏影响面 ×4 |

而且 **16KB 已经足够让树高收敛**：从 950 加到 3800，3 层容量只是从 1440 万变到 2.3 亿——但 4 层也能装 137 亿，多一层只多一次 IO。**边际收益已经趋零，成本却线性上涨**。这就是 16KB 的平衡点。

### 1.7 树"变高"的唯一时机：根分裂

树高不是设计出来的，是**分裂传染上去的**：

```
插入 → 目标叶页满（PAGE_N_RECS 用尽 / 页内空闲空间不足）
     → 申请新页，按 50/50（随机插入）或 右分裂（顺序插入）搬数据
     → 把"新页的最小 key + 页号"插入父页
     → 父页也满 → 继续向上 → 一直到根
     → 根也满 → 申请新根，树高 +1
```

**顺序插入（自增主键）为什么快**：InnoDB 用 `PAGE_DIRECTION` + `PAGE_N_DIRECTION` 记录"最近 N 次插入是否同方向"，判定为顺序插入时只做**右分裂**（新页只带走少量记录，旧页几乎保持满），几乎不产生碎片，且写入集中在最右页 → 顺序 IO。

**随机插入（UUID）为什么慢**：每次命中随机叶页 → Buffer Pool 命中率暴跌 → 50/50 分裂 → 页填充率长期只有 ~50%~70% → 同样的数据量多占 30%~50% 的页 → **树更容易变高**，且扫描时要读更多页。这就是"UUID 让索引变大、变慢"的完整因果链。

**碎片与治理**：

```sql
-- 页填充率过低时重建（本质是导出+导入，会锁/占空间，线上用 gh-ost 或 pt-osc）
ALTER TABLE t ENGINE=InnoDB;   -- 或 OPTIMIZE TABLE t;
-- 合并阈值：页使用率低于 50% 时尝试与兄弟页合并
SET GLOBAL innodb_merge_threshold_set_all_debug = 50;  -- 调试用；正常用 CREATE TABLE ... COMMENT='MERGE_THRESHOLD=45'
```

---

## 02 账本：为什么必须胖（16KB 一页的真实布局）

<figure>
<svg viewBox="0 0 1180 540" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Microsoft YaHei,PingFang SC,sans-serif">
<defs>
<marker id="f2a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#7E93AE"/></marker>
<marker id="f2b" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M10 0 L0 5 L10 10 z" fill="#2E9E8F"/></marker>
<marker id="f2c" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#2E9E8F"/></marker>
</defs>
<rect width="1180" height="540" rx="14" fill="#F7F9FC" stroke="#E3E7EE"/>
<text x="28" y="34" font-size="17" font-weight="700" fill="#1F2937">图 2｜同一棵 B+ 树的两种页：非叶只存「导航」，叶子存「整行」+ 页间双向链表</text>
<text x="28" y="56" font-size="12" fill="#4B5563">节点 = 一整个 16KB 页。非叶记录 17B → 一页约 950 个分叉；叶页 1KB 行 → 约 16 行/页。</text>
<rect x="450" y="76" width="280" height="50" rx="9" fill="#EAF1FB" stroke="#2C6FBE" stroke-width="1.6"/>
<text x="590" y="97" font-size="13" font-weight="700" fill="#2C6FBE" text-anchor="middle">根页　PAGE_LEVEL = 2</text>
<text x="590" y="115" font-size="11.5" fill="#4B5563" text-anchor="middle">[ 1 | 400 | 800 ]　键值 + 4B 子页号</text>
<g fill="#F3F8FE" stroke="#7FA8D6">
<rect x="100" y="180" width="250" height="50" rx="8"/>
<rect x="465" y="180" width="250" height="50" rx="8"/>
<rect x="830" y="180" width="250" height="50" rx="8"/>
</g>
<g font-size="12" fill="#2C6FBE" text-anchor="middle">
<text x="225" y="201" font-weight="700">中间页　LEVEL = 1</text>
<text x="590" y="201" font-weight="700">中间页　LEVEL = 1</text>
<text x="955" y="201" font-weight="700">中间页　LEVEL = 1</text>
</g>
<g font-size="11" fill="#4B5563" text-anchor="middle">
<text x="225" y="219">[k → 子页号] × 950</text>
<text x="590" y="219">[k → 子页号] × 950</text>
<text x="955" y="219">[k → 子页号] × 950</text>
</g>
<g stroke="#7E93AE" stroke-width="1.4" fill="none" marker-end="url(#f2a)">
<path d="M500 126 L225 178"/>
<path d="M590 126 L590 178"/>
<path d="M680 126 L955 178"/>
<path d="M180 230 L110 298"/>
<path d="M270 230 L300 298"/>
<path d="M545 230 L490 298"/>
<path d="M635 230 L680 298"/>
<path d="M910 230 L870 298"/>
<path d="M1000 230 L1060 298"/>
</g>
<g fill="#E7F4F1" stroke="#2E9E8F" stroke-width="1.4">
<rect x="30" y="300" width="160" height="78" rx="8"/>
<rect x="220" y="300" width="160" height="78" rx="8"/>
<rect x="410" y="300" width="160" height="78" rx="8"/>
<rect x="600" y="300" width="160" height="78" rx="8"/>
<rect x="790" y="300" width="160" height="78" rx="8"/>
<rect x="980" y="300" width="160" height="78" rx="8"/>
</g>
<g font-size="12" fill="#1F6B60" text-anchor="middle" font-weight="700">
<text x="110" y="322">叶子页　LEVEL = 0</text>
<text x="300" y="322">叶子页　LEVEL = 0</text>
<text x="490" y="322">叶子页　LEVEL = 0</text>
<text x="680" y="322">叶子页　LEVEL = 0</text>
<text x="870" y="322">叶子页　LEVEL = 0</text>
<text x="1060" y="322">叶子页　LEVEL = 0</text>
</g>
<g font-size="11" fill="#4B5563" text-anchor="middle">
<text x="110" y="344">整行 × 16</text>
<text x="300" y="344">整行 × 16</text>
<text x="490" y="344">整行 × 16</text>
<text x="680" y="344">整行 × 16</text>
<text x="870" y="344">整行 × 16</text>
<text x="1060" y="344">整行 × 16</text>
</g>
<g font-size="10.5" fill="#8A93A0" text-anchor="middle">
<text x="110" y="366">按 key 升序</text>
<text x="300" y="366">按 key 升序</text>
<text x="490" y="366">按 key 升序</text>
<text x="680" y="366">按 key 升序</text>
<text x="870" y="366">按 key 升序</text>
<text x="1060" y="366">按 key 升序</text>
</g>
<g stroke="#2E9E8F" stroke-width="1.8" marker-start="url(#f2b)" marker-end="url(#f2c)">
<path d="M190 400 L220 400"/>
<path d="M380 400 L410 400"/>
<path d="M570 400 L600 400"/>
<path d="M760 400 L790 400"/>
<path d="M950 400 L980 400"/>
</g>
<text x="590" y="430" font-size="12" fill="#1F6B60" text-anchor="middle" font-weight="700">FIL_PAGE_NEXT ↔ FIL_PAGE_PREV（File Header +12 / +8）——页级双向链表</text>
<text x="590" y="450" font-size="11.5" fill="#8A93A0" text-anchor="middle">范围扫描跨页时直接跳页，不必重新从根 descend</text>
<text x="30" y="486" font-size="12.5" fill="#1F2937">非叶记录 = key(8B) + 子页号(4B) + 记录头(5B) = <tspan font-weight="700">17B</tspan>　→　16KB / 17B ≈ <tspan font-weight="700">950 个分叉</tspan>（这就是「胖」）</text>
<text x="30" y="508" font-size="12.5" fill="#1F2937">叶页存整行 + 每行 13B 隐藏列　→　行宽决定每页行数，也就决定了树会不会「变高」</text>
<text x="30" y="530" font-size="13" font-weight="700" fill="#2C6FBE">3 层 = 950 × 950 × 16 ≈ 1440 万行　｜　4 层 ≈ 137 亿行（1KB 行宽）</text>
</svg>
<figcaption>图 2：注意两件事——① 只有叶子页存整行，所以「行宽」直接决定树高；② 双向链表只存在于页之间，页内是单链表。</figcaption>
</figure>

这一节是全篇的地基。后面所有"为什么这个查询快/慢"，答案都能在这张布局图里找到位置。

### 2.1 一个索引页的完整布局

<figure>
<svg viewBox="0 0 1180 520" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Microsoft YaHei,PingFang SC,sans-serif">
<defs>
<marker id="f3a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#C2803A"/></marker>
<marker id="f3b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#7E93AE"/></marker>
</defs>
<rect width="1180" height="520" rx="14" fill="#F7F9FC" stroke="#E3E7EE"/>
<text x="28" y="34" font-size="17" font-weight="700" fill="#1F2937">图 3｜16KB 页里到底装了什么，以及页内怎么"找"</text>
<text x="28" y="56" font-size="12" fill="#4B5563">左：一个索引页的区域划分（字节级）。右：页内定位的真实算法——不是纯二分。</text>
<rect x="40" y="80" width="280" height="44" rx="6" fill="#DBE7F7" stroke="#9DBBDD"/>
<text x="180" y="107" font-size="12.5" fill="#1F3F66" text-anchor="middle" font-weight="700">File Header　38B</text>
<rect x="40" y="124" width="280" height="44" rx="6" fill="#CFE0F5" stroke="#88ACD6"/>
<text x="180" y="151" font-size="12.5" fill="#1F3F66" text-anchor="middle" font-weight="700">Page Header　38B</text>
<rect x="40" y="168" width="280" height="34" rx="6" fill="#E4EBF4" stroke="#B7C6DA"/>
<text x="180" y="190" font-size="12" fill="#415065" text-anchor="middle" font-weight="700">Infimum / Supremum 伪记录</text>
<rect x="40" y="202" width="280" height="150" rx="6" fill="#EAF4F2" stroke="#9BD0C7"/>
<text x="180" y="226" font-size="12.5" fill="#1F6B60" text-anchor="middle" font-weight="700">用户记录区（按 key 升序）</text>
<text x="180" y="250" font-size="11.5" fill="#4B5563" text-anchor="middle">rec1 → rec2 → rec3 → …</text>
<text x="180" y="272" font-size="11.5" fill="#4B5563" text-anchor="middle">靠前的在低地址，向下增长</text>
<text x="180" y="296" font-size="11" fill="#8A93A0" text-anchor="middle">空 闲 区</text>
<text x="180" y="330" font-size="10.5" fill="#8A93A0" text-anchor="middle">↓ 页尾方向</text>
<rect x="40" y="352" width="280" height="48" rx="6" fill="#FBF0E4" stroke="#DCB98E"/>
<text x="180" y="372" font-size="12.5" fill="#8A5A20" text-anchor="middle" font-weight="700">Page Directory</text>
<text x="180" y="390" font-size="11" fill="#8A5A20" text-anchor="middle">每槽 2B，从页尾向上放</text>
<text x="40" y="424" font-size="11" fill="#8A93A0">偏移 0</text>
<text x="320" y="424" font-size="11" fill="#8A93A0" text-anchor="end">偏移 16384</text>
<g font-size="11.5" fill="#4B5563">
<text x="340" y="98">PREV / NEXT → 叶子链表 ★</text>
<text x="340" y="118">TYPE = 0x45BF（索引页）</text>
<text x="340" y="142">LEVEL(0=叶子) / N_RECS</text>
<text x="340" y="162">FREE / GARBAGE（可复用）</text>
<text x="340" y="186">infimum@99 / supremum@112</text>
<text x="340" y="226">记录从偏移 125 起</text>
<text x="340" y="246">记录头 5B（n_owned 4bit）</text>
<text x="340" y="378">slot → 组内最后一条</text>
</g>
<rect x="600" y="72" width="552" height="286" rx="10" fill="#FFFFFF" stroke="#E3E7EE"/>
<text x="620" y="96" font-size="13" font-weight="700" fill="#1F2937">页内查找 = slot 二分 + 组内 ≤ 8 条链表比较</text>
<g fill="#F3F8FE" stroke="#7FA8D6">
<rect x="620" y="108" width="64" height="32" rx="5"/>
<rect x="700" y="108" width="64" height="32" rx="5"/>
<rect x="860" y="108" width="64" height="32" rx="5"/>
<rect x="940" y="108" width="64" height="32" rx="5"/>
<rect x="1020" y="108" width="64" height="32" rx="5"/>
</g>
<rect x="780" y="108" width="64" height="32" rx="5" fill="#FBF0E4" stroke="#C2803A" stroke-width="1.8"/>
<g font-size="11.5" fill="#4B5563" text-anchor="middle">
<text x="652" y="129">slot 1</text>
<text x="732" y="129">slot 2</text>
<text x="892" y="129">slot 4</text>
<text x="972" y="129">slot 5</text>
<text x="1052" y="129">…</text>
</g>
<text x="812" y="129" font-size="11.5" fill="#8A5A20" text-anchor="middle" font-weight="700">slot 3</text>
<path d="M812 142 L812 158" stroke="#C2803A" stroke-width="1.6" fill="none" marker-end="url(#f3a)"/>
<g fill="#EAF4F2" stroke="#9BD0C7">
<rect x="620" y="162" width="52" height="30" rx="4"/>
<rect x="684" y="162" width="52" height="30" rx="4"/>
<rect x="748" y="162" width="52" height="30" rx="4"/>
<rect x="812" y="162" width="52" height="30" rx="4"/>
<rect x="876" y="162" width="52" height="30" rx="4"/>
<rect x="940" y="162" width="52" height="30" rx="4"/>
<rect x="1004" y="162" width="52" height="30" rx="4"/>
</g>
<rect x="1068" y="162" width="52" height="30" rx="4" fill="#FBF0E4" stroke="#C2803A" stroke-width="1.8"/>
<g stroke="#7E93AE" stroke-width="1.3" marker-end="url(#f3b)">
<path d="M672 177 L684 177"/>
<path d="M736 177 L748 177"/>
<path d="M800 177 L812 177"/>
<path d="M864 177 L876 177"/>
<path d="M928 177 L940 177"/>
<path d="M992 177 L1004 177"/>
<path d="M1056 177 L1068 177"/>
</g>
<g font-size="10.5" fill="#8A93A0" text-anchor="middle">
<text x="646" y="209">组头</text>
<text x="1146" y="209" text-anchor="end">组尾（slot 指向它）</text>
</g>
<text x="620" y="238" font-size="11.5" fill="#4B5563">① 在 slot 数组上二分，定位到「最后一个 ≤ 目标的组」（O(log N)）</text>
<text x="620" y="260" font-size="11.5" fill="#4B5563">② 从组头沿 next_record 线性比较，组内最多 8 条（n_owned ≤ 8）</text>
<text x="620" y="282" font-size="11.5" fill="#4B5563">③ 组内超过 8 条 → 分裂出新 slot；所以「8」是维护成本，不是硬上限</text>
<text x="620" y="312" font-size="11.5" fill="#8A5A20">为什么不真二分？记录是单链表，无法 O(1) 取中间元素。</text>
<text x="620" y="334" font-size="11.5" fill="#8A5A20">Page Directory = 用 2B/组 的空间，换 O(log N + 8) 的时间。</text>
<text x="28" y="452" font-size="13" font-weight="700" fill="#1F2937">页内比较再多次，也不会多花一次 IO —— 一次 IO 搬回来的 16KB 必须用到极致，这就是「胖」的红利。</text>
<text x="28" y="478" font-size="12" fill="#8A93A0">反过来说：如果树「又高又瘦」，每页只有 1 条记录，那这 16KB 的搬运成本就全浪费了（带宽利用率 0.02%）。</text>
<text x="28" y="502" font-size="11.5" fill="#8A93A0">记录头字段：deleted_flag(1bit) / min_rec(1) / n_owned(4) / heap_no(13) / record_type(3) / next_record(16) = 40bit = 5B</text>
</svg>
<figcaption>图 3：左侧的字节布局决定「一页能装多少」，右侧的查找算法决定「装进去之后多快能找到」。两者共同构成「胖」的收益。</figcaption>
</figure>

```
偏移 0    ┌─ File Header (38B)
          │    +8   FIL_PAGE_PREV        上一页页号   ★ 叶子链表
          │   +12   FIL_PAGE_NEXT        下一页页号   ★
          │    +4   FIL_PAGE_TYPE        0x45BF = INDEX
          │    +8   FIL_PAGE_LSN         页最后一次修改的 LSN
          │    +8   FIL_PAGE_SPACE_OR_CHKSUM
偏移 38   ├─ Page Header (38B)
          │    +0   PAGE_N_DIR_SLOTS    页目录槽数
          │    +2   PAGE_HEAP_TOP       空闲区起点
          │    +4   PAGE_N_HEAP         堆上记录数（含伪记录）
          │    +6   PAGE_FREE           已删记录链表头
          │    +8   PAGE_GARBAGE        可复用字节数
          │   +10   PAGE_LAST_INSERT    最后插入位置
          │   +12   PAGE_DIRECTION      插入方向（左/右/无序）
          │   +14   PAGE_N_DIRECTION    同方向插入计数
          │   +16   PAGE_N_RECS         用户记录数
          │   +18   PAGE_MAX_TRX_ID     最大事务 ID
          │   +26   PAGE_LEVEL          0 = 叶子页   ★
          │   +28   PAGE_INDEX_ID       所属索引 ID（8B，到 +36 结束）
          │   随后  PAGE_BTR_SEG_LEAF / PAGE_BTR_SEG_TOP   叶子/非叶段头（各 10B）
偏移 99   ├─ Infimum 伪记录（5B 头 + 8B 数据，"最小"）
偏移 112  ├─ Supremum 伪记录（"最大"）
偏移 125  ├─ 用户记录区：按 key 升序，靠前的在低地址（向下增长）
          │     rec1 → rec2 → rec3 → ...     用 next_record 串成单链表
          │                    ......（空闲区）
          │     从页尾倒着向上放 ↓
偏移 16384└─ Page Directory（每槽 2B，指向"组内最后一条记录"）
```

三个必须记住的点：

1. **`FIL_PAGE_PREV` / `FIL_PAGE_NEXT` 只存在于页级**，所以才叫"叶子节点之间是双向链表"。页内记录之间是**单向链表**（`next_record`），没有 prev。
2. **`PAGE_LEVEL = 0` 就是叶子页**。判断一个页是不是叶子，不需要"最底层"这种模糊说法，看这一个字段。
3. **页目录（Page Directory）是"稀疏索引"**，不是每条记录一个槽——这是下一节的重点。

### 2.2 页内查找：不是你以为的二分

很多人以为"页内二分查找记录"。**错**。真实算法是 **slot 二分 + 组内单链表线性（≤8 次比较）**：

```
Page Directory = [slot1, slot2, ..., slotN]，每槽 2B，指向一个"组"的最后一条记录
每组记录数 = n_owned ∈ [4, 8]（第一组含 infimum，可为 1~8）

查找 key = 42：
  ① 在 slot 数组上二分，找到"最后一条 ≤ 42 的记录所在槽"（O(log N_slots)）
  ② 从该槽所指记录**前一组**的起点开始，沿 next_record 单链表线性比较
  ③ 组内最多 8 条 → 最多 8 次比较，必然定位到"最后一个 ≤ 42 的记录"
```

为什么不做真正的二分？因为**记录之间只有单向链表**，无法 O(1) 取第 k 条记录（要 O(k) 遍历）。Page Directory 是"用 2B/组 的空间，换 O(log slots + 8) 的时间"——这就是"胖"页能够高效利用的微观基础。

`n_owned` 存在**记录头的 4 个 bit** 里（每组的最后一条记录才有效），所以一个 5B 记录头塞下了：`deleted_flag(1) + min_rec_flag(1) + n_owned(4) + heap_no(13) + record_type(3) + next_record(16)` = 40 bit = 5 字节。

> **追问：组内记录超过 8 条怎么办？** 分裂：把组一分为二，新组的第一条记录进 Page Directory，并更新两组的 `n_owned`。所以"8"是页目录的维护阈值，不是硬上限。

### 2.3 行记录格式（COMPACT）——"胖"到底胖在哪几字节

一行记录的物理结构（`ROW_FORMAT=COMPACT`，默认 `DYNAMIC` 也是这个头）：

```
┌ 变长字段长度列表（逆序存放，每列 1~2B）        ← 有 varchar/text 才有
│ NULL 位图（每列 1 bit，逆序）                   ← 有可空列才有
│ 5B 记录头（deleted/min_rec/n_owned/heap_no/record_type/next_record）
│ 主键列 / 各列值（定长在前，变长在后）
│ DB_TRX_ID   (6B)   ← MVCC：最后修改该行的事务 ID
└ DB_ROLL_PTR (7B)   ← 指向 undo log 版本链 ★
```

**每行固定 13B 的隐藏开销**（6B 事务 ID + 7B 回滚指针）+ 5B 记录头。这意味着：

- 一张只有 `id INT`（4B）的表，实际每行 22B → 一页能放 ~730 行 → **3 层可容纳 950²×730 ≈ 6.6 亿行**。这就是"窄表能撑到亿级还只有 3 层"的真相。
- **加一个可空 varchar(255) 列，行宽和 NULL 位图都会变**，页容量下降，树可能变高。这不是玄学，是算术。

### 2.4 二级索引页与聚簇索引页的差别

| | 聚簇索引（主键） | 二级索引（普通/唯一） |
|---|---|---|
| 叶子存什么 | **整行**（含 DB_TRX_ID / DB_ROLL_PTR） | 索引列 + **主键值** |
| 非叶存什么 | 主键 + 4B 子页号 | 索引列 + 4B 子页号 |
| 叶页密度 | 低（行宽决定） | 高（几个列） |
| 是否唯一 | 必须唯一 | 非唯一时，**重复 key 靠主键区分**（记录仍是全序，因为 key 后面隐式拼了主键） |
| 回表 | 不需要（它本身就是表） | 需要：拿主键再 descend 聚簇索引一次 ★ |

**"二级索引叶子隐式拼主键"这个细节极其重要**：

```sql
-- 表 t(id PK, name, age)，索引 idx_name(name)
-- 物理上二级索引的排序键是 (name, id)，不是 name！
-- 所以这条 SQL 可以完全避免排序：
SELECT id, name FROM t WHERE name = 'tom' ORDER BY id;   -- (name,id) 天然有序
```

这解释了为什么"非唯一二级索引上 `ORDER BY 主键` 不用排序"，也解释了为什么"主键越宽，二级索引越大、树越高"——**主键宽度会加倍放大到每一个二级索引上**。这是"自增 bigint 主键优于 UUID 字符串"的第二重原因（第一重是 1.7 的页分裂）。

### 2.5 「回表」到底多贵：把它算成 IO

```sql
SELECT * FROM orders WHERE customer_id = 10086;  -- idx_customer(customer_id)
```

```
① 二级索引 descend：3 次页读（根常驻→实际 2 次），定位到 customer_id=10086 的第一条
② 沿叶子链表右扫：命中 k 条，读到主键 id 列表（这部分是**顺序 IO**，很便宜）
③ 对这 k 个 id，逐个到聚簇索引 descend 取整行：k 次**随机 IO** ★★★
```

注意第 ③ 步的顺序：如果二级索引返回的 id 是 `[3, 99991, 1024, 58002, ...]`（按 `customer_id` 排序，而不是按 id 排序），那么这 k 次回表是**彻底的随机 IO**。这就是 MRR（Multi-Range Read）要解决的问题：

```
MRR 开启（optimizer_switch='mrr=on', mrr_cost_based=on）：
  → 把二级索引读到的 id 攒进 read_rnd_buffer（read_rnd_buffer_size = 256KB）
  → 按主键排序后批量回表 → 随机 IO 变近似顺序 IO
  → EXPLAIN Extra: "Using MRR"
```

**回表代价的经验线**：当命中行数占全表比例超过约 **20%~30%** 时，"二级索引 + 回表"的总代价会超过"聚簇索引全表顺序扫"，优化器就会**主动放弃索引**。很多人以为"有索引就一定会走"，其实优化器算的是：

```
走索引代价 ≈ H × io_block_read_cost + k × io_block_read_cost(随机回表) + k × row_evaluate_cost
全表扫代价 ≈ (页数) × io_block_read_cost(顺序，且有预读) + N × row_evaluate_cost
```

这也是为什么 `WHERE create_time > '2026-01-01'`（覆盖 80% 数据）明明有索引却走全表扫——**不是索引失效，是代价更优**。

### 2.6 行溢出：当"胖"遇到大字段

`TEXT/BLOB` 或超长 `varchar` 超过页容量一半时，InnoDB 会把**前 768B 或 20B 指针**留在页内，其余放到**溢出页（overflow page）**：

```
ROW_FORMAT=DYNAMIC（默认，8.0）：
  页内只留 20B 外部指针 → 主页几乎全是"有效"记录 → 叶页容量最大
ROW_FORMAT=COMPACT：
  页内至少留 768B 前缀 → 主页被"前缀"占满 → 叶页容量暴跌
```

所以：**大字段一定要 `DYNAMIC`，且最好垂直拆表**。一个 `content TEXT` 放在主表里，即使 99% 的行是 NULL，`COMPACT` 下也可能拖垮叶页密度。

---

## 03 六个基础动作：结构上到底发生了什么

把后文所有查询拆成六个原语，一切都能组合出来：

| 原语 | 对应 handler 接口 | 结构动作 |
|---|---|---|
| **定位（seek）** | `index_read_map(..., HA_READ_KEY_OR_NEXT)` | 从根二分下降到叶，页内 slot 二分 |
| **顺序前进（next）** | `index_next()` / `index_next_same()` | 沿 `next_record`；到页尾则跳 `FIL_PAGE_NEXT` |
| **顺序后退（prev）** | `index_prev()` | 反向扫描，沿 `prev_record` + `FIL_PAGE_PREV` |
| **取最值（first/last）** | `index_first()` / `index_last()` | 一路走"最左/最右"分支，O(H) |
| **回表（回聚簇索引）** | `rnd_pos()` | 用主键再 descend 一次聚簇索引 |
| **排序/临时表** | 由 Server 层 `filesort` / `create_tmp_table` 完成 | 与 B+ 树无关，纯内存/磁盘算法 |

执行器与引擎的分工边界也要清楚：

```
Server 层（sql_select.cc / JOIN::exec）
   ├─ 优化器：选索引、定 join 顺序、判断能否 skip sort
   ├─ 执行器：按 QEP 逐行调用 handler 接口
   └─ 算子：filesort、临时表、hash join、聚合
存储引擎层（InnoDB handler / row_search_mvcc）
   ├─ B+ 树定位与遍历（btr_cur_search_to_nth_level → page_cur_search_with_match）
   ├─ MVCC 可见性判断（ReadView + undo）
   ├─ 行锁 / 间隙锁
   └─ Buffer Pool 与页读写
```

**关键认知**：`LIKE`、`IN`、`ORDER BY`、`GROUP BY` 这些词在引擎层**根本不存在**。引擎只认"从哪条记录开始、往哪个方向走、走到哪停"。所有高级语义都是 Server 层翻译成"seek + next"的组合。这句话是理解全文的钥匙。

---

## 04 范围查询：定位下界 + 叶子链表右扫

<figure>
<svg viewBox="0 0 1180 430" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Microsoft YaHei,PingFang SC,sans-serif">
<defs>
<marker id="f4a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#2C6FBE"/></marker>
</defs>
<rect width="1180" height="430" rx="14" fill="#F7F9FC" stroke="#E3E7EE"/>
<text x="28" y="34" font-size="17" font-weight="700" fill="#1F2937">图 4｜范围查询的两步：先「定位下界」，再「沿叶子链表右扫」</text>
<text x="28" y="56" font-size="12" fill="#4B5563">WHERE create_time &gt;= '2026-10-01' AND create_time &lt; '2026-11-01'（KEY idx_ct）</text>
<text x="366" y="96" font-size="11.5" fill="#2C6FBE" text-anchor="middle" font-weight="700">① index_read_map(下界, KEY_OR_NEXT)</text>
<text x="366" y="114" font-size="11" fill="#4B5563" text-anchor="middle">根→叶二分下降，叶内 slot 二分</text>
<path d="M366 122 L366 166" stroke="#2C6FBE" stroke-width="2.4" fill="none" marker-end="url(#f4a)"/>
<g fill="#FFFFFF" stroke="#B7C6DA">
<rect x="40" y="170" width="196" height="96" rx="8"/>
<rect x="268" y="170" width="196" height="96" rx="8"/>
<rect x="496" y="170" width="196" height="96" rx="8"/>
<rect x="724" y="170" width="196" height="96" rx="8"/>
<rect x="952" y="170" width="196" height="96" rx="8"/>
</g>
<rect x="268" y="170" width="196" height="96" rx="8" fill="#EAF1FB" stroke="#2C6FBE" stroke-width="2"/>
<g font-size="11.5" fill="#4B5563" text-anchor="middle" font-weight="700">
<text x="138" y="192">叶子页 #1</text>
<text x="366" y="192" fill="#2C6FBE">叶子页 #2（起点）</text>
<text x="594" y="192">叶子页 #3</text>
<text x="822" y="192">叶子页 #4</text>
<text x="1050" y="192">叶子页 #5</text>
</g>
<g fill="#E7EEF8">
<rect x="58" y="206" width="160" height="9" rx="2"/>
<rect x="58" y="222" width="160" height="9" rx="2"/>
<rect x="58" y="238" width="160" height="9" rx="2"/>
<rect x="58" y="254" width="160" height="9" rx="2"/>
<rect x="286" y="206" width="160" height="9" rx="2" fill="#C7DBF5"/>
<rect x="286" y="222" width="160" height="9" rx="2"/>
<rect x="286" y="238" width="160" height="9" rx="2"/>
<rect x="286" y="254" width="160" height="9" rx="2"/>
<rect x="514" y="206" width="160" height="9" rx="2"/>
<rect x="514" y="222" width="160" height="9" rx="2"/>
<rect x="514" y="238" width="160" height="9" rx="2"/>
<rect x="514" y="254" width="160" height="9" rx="2"/>
<rect x="742" y="206" width="160" height="9" rx="2"/>
<rect x="742" y="222" width="160" height="9" rx="2"/>
<rect x="742" y="238" width="160" height="9" rx="2"/>
<rect x="742" y="254" width="160" height="9" rx="2"/>
<rect x="970" y="206" width="160" height="9" rx="2"/>
<rect x="970" y="222" width="160" height="9" rx="2"/>
</g>
<g stroke="#2C6FBE" stroke-width="2.2" fill="none" marker-end="url(#f4a)">
<path d="M366 288 L462 288"/>
<path d="M594 288 L690 288"/>
<path d="M822 288 L918 288"/>
</g>
<text x="590" y="312" font-size="11.5" fill="#2C6FBE" text-anchor="middle" font-weight="700">② index_next()：沿 next_record 前进；到页尾 → 读 FIL_PAGE_NEXT 跳页（免重新下树）</text>
<g stroke="#C0504D" stroke-width="2.4">
<path d="M1024 216 L1048 240"/>
<path d="M1048 216 L1024 240"/>
</g>
<text x="1148" y="150" font-size="11.5" fill="#C0504D" text-anchor="end" font-weight="700">上界：end_range 比较 → HA_ERR_END_OF_RANGE</text>
<text x="28" y="356" font-size="13" font-weight="700" fill="#1F2937">IO 次数 = H（定位）+ 扫描字节数 / 16KB（顺序）—— 只与「字节数」有关，与「行数」无关。</text>
<text x="28" y="382" font-size="12" fill="#4B5563">同样是 10 万行：覆盖索引扫描 ≈ 250 页顺序 IO　vs　二级索引逐行回表 = 10 万次随机 IO（差 400 倍）</text>
<text x="28" y="406" font-size="12" fill="#8A93A0">红叉之后立即停止 —— 上界比较发生在引擎层，不需要把后面的页也读进来。</text>
</svg>
<figcaption>图 4：范围扫描的代价由「扫了多少字节」决定。所以让索引变窄（覆盖索引），比让索引变多更有效。</figcaption>
</figure>

### 04.1 三段式执行路径

```sql
SELECT * FROM orders WHERE create_time >= '2026-10-01' AND create_time < '2026-11-01';
-- KEY idx_ct(create_time)
```

```
① index_init(idx_ct)                     打开索引
② index_read_map('2026-10-01', HA_READ_KEY_OR_NEXT)
      → btr_cur_search_to_nth_level()：根页 slot 二分 → 取子页 → ... → 叶页
      → page_cur_search_with_match()：叶页 slot 二分 + ≤8 次线性比较
      → 得到"第一个 >= 2026-10-01 的记录"（cursor 位置）
③ index_next() 循环
      → 沿 next_record 前进；next_record 越界（到 supremum）则读 FIL_PAGE_NEXT 指向的下一页
      → 上界由 handler 用 end_range 比较，越界返回 HA_ERR_END_OF_RANGE
④ ha_index_end()                         关闭
```

**注意第 ③ 步的本质**：跨页时**不需要重新从根 descend**，直接用 `FIL_PAGE_NEXT` 跳过去。这就是"叶子双向链表"的全部价值——

> 范围扫描的 IO 次数 = **H（定位）+ 扫描字节数 / 16KB（顺序）**，与"行数"无关，只与"字节数"有关。

量化对比（扫 10 万行，每行 100B）：

| 方式 | 页读次数 | IO 性质 |
|---|---|---|
| 覆盖索引范围扫（二级索引，项宽 40B） | 10 万×40B = 4MB / 16KB ≈ **250 页** | 顺序，可预读 |
| 聚簇索引范围扫（行宽 100B） | 10MB / 16KB ≈ **640 页** | 顺序 |
| 二级索引 + 逐行回表 | 250 + **10 万次随机** | 灾难 |

**这就是"覆盖索引"的真正收益**：不只是"省掉回表"，更是把 10 万次随机 IO 变成 250 次顺序 IO，差 **400 倍**。

### 04.2 为什么"范围列后面的索引列失效"

```sql
-- KEY idx_ab(a, b)
SELECT * FROM t WHERE a > 10 AND b = 5;
```

不是"引擎不够聪明"，而是**物理上不可能高效**：索引记录按 `(a, b)` 字典序排列，形如

```
(1,1) (1,5) (2,1) (2,5) (3,2) (3,5) (4,1) ...
```

`a > 10` 拿到的是一个**大区间**；在这个区间里，`b` 的值是"每个 a 内部有序，但跨 a 完全无序"。要在其中找 `b=5`，只能逐条比较——那就退化成了扫描，不如让 Server 层用 ICP（Index Condition Pushdown）在**引擎层**过滤，省掉回表：

```
ICP 开启：EXPLAIN Extra = "Using index condition"
  引擎遍历 idx_ab 时，先把 b=5 的条件在索引记录上判断（不回表），
  只有通过的才回表 → 回表次数从"区间内全部行"降到"满足 b=5 的行"
```

### 04.3 优化器为什么"有索引却不用"

范围查询最容易踩的坑：`rows` 估算失真导致计划翻转。

```
优化器估算区间行数的两条路（由 eq_range_index_dive_limit 与统计信息决定）：
  A. index dive（精确但贵）：对每个 range 真正在 B+ 树上"潜下去"
     数一数区间内大概多少行（records_in_range）
  B. 统计信息估算（便宜但不准）：用索引基数 cardinality + 直方图
```

- `innodb_stats_persistent_sample_pages = 20`（默认）：只采样 20 个页估算基数。**数据分布倾斜时，cardinality 严重失真** → 优化器以为 `status='CANCELLED'` 只有 100 行，实际 200 万行 → 选错索引。
- 解法：`ANALYZE TABLE t;`（重算统计）、8.0 的**直方图** `ANALYZE TABLE t UPDATE HISTOGRAM ON status WITH 100 BUCKETS;`、或 `FORCE INDEX` 兜底。

### 04.4 反向扫描与降序索引

```sql
SELECT * FROM orders ORDER BY create_time DESC LIMIT 20;
```

- 8.0 之前：`ORDER BY create_time DESC` 在**只有 ASC 索引**时，优化器曾倾向"扫全量 + filesort"，因为它认为反向扫描代价更高（早期实现有惩罚系数）。实际上 InnoDB 支持 `index_prev()` 反向遍历，可以从最右叶子往回走——**但要付出"页内逆序 + 跨页 prev"的成本**，且预读方向相反。
- 8.0 起：**降序索引**（`KEY idx (create_time DESC)`）是**真实物理存储**，`ORDER BY ... DESC` 直接正向扫描。

```
-- 混合方向
KEY idx_mix (a ASC, b DESC)
ORDER BY a ASC, b DESC   → 免排序（8.0 真实降序索引）
ORDER BY a ASC, b ASC    → 需要 filesort（8.0 之前 DESC 只是语法糖，索引全是 ASC 存储）
```

---

## 05 LIKE：什么时候能二分，什么时候只能全扫

### 05.1 前缀匹配 = 区间查询（数学推导）

`LIKE 'abc%'` 在字典序下等价于：

```
key >= 'abc'   AND   key < 'abc' + 0xFF...   （严格说是"下一个前缀"）
```

优化器（`range_optimizer`）会把它改写成区间，在 `optimizer_trace` 里能看到：

```json
"range_scan_alternatives": [{
  "index": "idx_name",
  "ranges": ["abc <= name < abd"],     // 实际边界按 collation 的 weight 计算
  "index_dives_for_eq_ranges": true,
  "rows": 1234,
  "cost": 456.7
}]
```

**关键细节：区间边界不是按字节算的，是按 collation 的排序权重（weight string）算的。**

- `utf8mb4_0900_ai_ci`（8.0 默认，大小写+重音不敏感）：`'abc'` 的等价类包含 `ABC`、`ábc` 等 → `LIKE 'abc%'` **能**匹配 `'ABCxxx'`，这正是业务想要的；代价是边界计算要走 weight，且可能"多扫"一些等价类。
- `utf8mb4_0900_as_cs` / `utf8mb4_bin`：精确匹配，边界就是字节序，区间最干净。
- **坑**：`WHERE name LIKE 'abc%'` 在 `_ci` 排序规则下能走索引，但如果 SQL 里写了 `WHERE BINARY name LIKE 'abc%'` 或 `WHERE name COLLATE utf8mb4_bin LIKE 'abc%'`，**索引可能失效**（表达式改变了排序规则，优化器无法把条件映射到索引顺序）。

### 05.2 为什么 `%abc` / `%abc%` 一定不能二分

B+ 树的键是**完整键值按字典序**排列。约束在"后缀"意味着：

```
要找 name 以 'abc' 结尾 → 可能的值域 = {'xabc', 'yyabc', 'zzzabc', ...} 无界
→ 在有序数组上没有下界可定位（下界是 -∞）
→ 只能全扫，逐条做字符串匹配
```

这是**信息论层面的不可能**，不是 MySQL 不努力。所有绕过方案的本质都是"把后缀约束变成前缀约束"：

| 方案 | 做法 | 代价 |
|---|---|---|
| **生成列 + 索引** | `ALTER TABLE t ADD COLUMN name_rev VARCHAR(64) AS (REVERSE(name)) STORED, ADD INDEX idx_rev(name_rev)`，查 `WHERE name_rev LIKE 'cba%'` | 多一列存储 + 写入开销；但要精确反转用 `REVERSE()` 而非"按字符反转"注意多字节 |
| **函数索引（8.0.13+）** | `ALTER TABLE t ADD INDEX idx_rev ((REVERSE(name)))`，查 `WHERE REVERSE(name) LIKE 'cba%'` | 不占额外列，但必须原样写表达式才命中 |
| **倒排索引 / 外部 ES** | 分词后建倒排表，`%abc%` 变成 term 查询 | 架构复杂度 ↑ |
| **InnoDB 全文索引** | `FULLTEXT KEY ft(name) WITH PARSER ngram`，`MATCH(name) AGAINST('abc')` | 只支持"词"级，短词/子串语义有限；中文要 `ngram_token_size=2` |
| **前缀索引 + 覆盖** | `KEY idx(name(10))`，`LIKE 'abc%'` 仍可用 | 前缀索引**不能**覆盖索引、**不能**用于 ORDER BY |

### 05.3 全文索引的物理结构（面试加分项）

InnoDB 的 `FULLTEXT` 不是 B+ 树，而是**倒排索引 + 一组辅助表**：

```
FTS_DOC_ID（隐藏列或显式列，唯一）标识文档
辅助表（每张全文索引一组）：
  FTS_<id>_idx              → (word, doc_id) 的倒排，按 word 聚簇
  FTS_<id>_being_deleted    正在删除的文档
  FTS_<id>_deleted          已删除文档
  FTS_<id>_config           分词配置
写入时先进 "FTS 缓存"（内存），再批量刷成索引页（避免每次插入都改倒排）
```

- 默认解析器按空格/标点切词，`innodb_ft_min_token_size = 3`（长度 <3 的词不建索引）。
- 中文必须用 `WITH PARSER ngram`，`ngram_token_size = 2` → `"数据库"` 切成 `数据`、`据库`。所以 `MATCH ... AGAINST('数据库')` 实际按 2-gram 匹配，**结果包含噪音，需要二次过滤**。

### 05.4 LIKE 与 ICP 的组合

```sql
-- KEY idx(name, age)
SELECT * FROM t WHERE name LIKE 'abc%' AND age = 20;
```

```
路径：range on idx(name) 区间 ['abc', 'abd')
      → 每条索引记录先判 age=20（ICP，不回表）
      → 通过才回表
EXPLAIN Extra: "Using index condition"
```

这是 `LIKE 前缀 + 联合索引后列` 唯一正确的写法——**等值列放前面、LIKE 列放最后**，或者反过来让 LIKE 列有前缀、后面的等值列靠 ICP 过滤。

---

## 06 IN：一堆等值如何变成有序区间

### 06.1 IN 在优化器里被"展开成多个区间"

```sql
SELECT * FROM t WHERE id IN (5, 1, 9, 3, 7);
```

`range_optimizer` 的处理：

```
① 逐个做 index dive，估算每个等值的行数
② 生成 5 个单点区间：(5,5), (1,1), (9,9), (3,3), (7,7)
③ **按 key 排序**（内部是 ordered set）→ (1,1),(3,3),(5,5),(7,7),(9,9)
④ 依次 seek + next，每个区间扫完就结束
```

**第 ③ 步是关键**：区间被排序后依次扫描，所以结果天然按索引序返回。

```sql
-- 因此这条 SQL 在 8.0 里通常不需要 filesort：
SELECT * FROM t WHERE id IN (5,1,9,3,7) ORDER BY id;
-- EXPLAIN Extra: "Using index condition" 或什么都不显示（无 filesort）

-- 但 ORDER BY 其他列还是要排序：
SELECT * FROM t WHERE id IN (5,1,9,3,7) ORDER BY name;  -- filesort
```

> **例外**：如果优化器选了 `index_merge`（多索引求并 `sort_union`），各分支结果必须归并排序 → 会出现 `Using sort_union(...)` + 排序。所以"IN + ORDER BY 免排序"要**看执行计划确认**，不能当定理背。

### 06.2 `eq_range_index_dive_limit` —— 长 IN 列表的计划翻转点

```sql
SHOW VARIABLES LIKE 'eq_range_index_dive_limit';   -- 默认 200
```

| IN 列表长度 | 优化器行为 | 后果 |
|---|---|---|
| ≤ 200 | 每个等值都做 **index dive**（在 B+ 树上定位并数页），`rows` 精确 | 计划稳定，但优化耗时随 m 线性增长 |
| > 200 | 放弃 dive，改用**索引统计信息**估算 | `rows` 可能严重失真 → **突然改走全表扫描** |

这就是生产上"IN 列表从 199 个涨到 201 个，接口从 20ms 变 2s"的真凶。三种解法：

```sql
-- ① 分批：每批 100~200 个，应用层合并
-- ② 临时表 / JOIN 替代长 IN（还能复用执行计划）
SELECT t.* FROM t JOIN tmp_ids x ON x.id = t.id;
-- ③ 强制索引（治标，要配合统计信息刷新）
SELECT * FROM t FORCE INDEX(idx_id) WHERE id IN (...);
```

### 06.3 `range_optimizer_max_mem_size` —— 更隐蔽的退化

```
range_optimizer_max_mem_size = 8388608 (8MB)
```

区间数太多（几万个 IN 值）时，优化器计算"每个区间约 230B"的内存，**超过 8MB 直接放弃 range 优化**，退化为全表扫描。`EXPLAIN` 的 `rows` 会突然变成全表行数，且 `optimizer_trace` 里有 `"cause": "too many ranges"`。

### 06.4 IN 子查询：semijoin 的五种策略

```sql
SELECT * FROM orders WHERE customer_id IN (SELECT id FROM customer WHERE level = 'A');
```

8.0 会把它转成 **semi-join**，候选策略（`optimizer_switch` 控制，优化器按代价选）：

| 策略 | 物理动作 | 适用 |
|---|---|---|
| **Table pullout** | 子查询表被"拉平"成普通 join（子查询列唯一时） | 最优，直接消灭子查询 |
| **FirstMatch** | 对每个外层行，在被驱动表找到第一条匹配即停 | 子查询结果重复度高 |
| **LooseScan** | 用子查询表的索引做"松散扫描"（跳过重复 key） | 子查询列有索引 |
| **Materialization** | 子查询结果物化成**临时表 + 唯一索引去重**，再 join | 子查询结果集小 |
| **DuplicateWeedout** | 用临时表消除 join 产生的重复外层行 | 兜底 |

物化的代价要会算：

```
物化成本 = 执行子查询（扫 customer 表）+ 建临时表（写 m 行 + 建唯一索引）
         + join 成本
→ 子查询结果很大时，物化反而比 EXISTS 慢
```

### 06.5 `NOT IN` 的 NULL 陷阱（三值逻辑）

```sql
-- customer_id 可为 NULL 时，这个查询可能返回 0 行！
SELECT * FROM orders WHERE customer_id NOT IN (SELECT id FROM customer);
```

原因：`x NOT IN (1, NULL)` 展开成 `x<>1 AND x<>NULL`，而 `x<>NULL` 的结果是 **UNKNOWN**（不是 TRUE），WHERE 只保留 TRUE → 整行被丢弃。**子查询结果里只要有一个 NULL，整个 NOT IN 就是空集。**

```sql
-- 正确写法
SELECT * FROM orders o
WHERE NOT EXISTS (SELECT 1 FROM customer c WHERE c.id = o.customer_id);
-- 或保证子查询列 NOT NULL
```

---

## 07 ORDER BY：索引序 vs filesort 的全部细节

<figure>
<svg viewBox="0 0 1180 470" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Microsoft YaHei,PingFang SC,sans-serif">
<defs>
<marker id="f5a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#C0504D"/></marker>
<marker id="f5b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#3F8F5E"/></marker>
</defs>
<rect width="1180" height="470" rx="14" fill="#F7F9FC" stroke="#E3E7EE"/>
<text x="28" y="34" font-size="17" font-weight="700" fill="#1F2937">图 5｜ORDER BY 的四道判定门：能不能不排序</text>
<text x="28" y="56" font-size="12" fill="#4B5563">对应优化器里的 test_if_skip_sort_order()。四道门全过 = 0 排序；任何一道不过 = filesort。</text>
<g fill="#F3F8FE" stroke="#2C6FBE" stroke-width="1.6">
<path d="M590 80 L740 110 L590 140 L440 110 Z"/>
<path d="M590 160 L740 190 L590 220 L440 190 Z"/>
<path d="M590 240 L740 270 L590 300 L440 270 Z"/>
<path d="M590 320 L740 350 L590 380 L440 350 Z"/>
</g>
<g font-size="12.5" fill="#1F3F66" text-anchor="middle" font-weight="700">
<text x="590" y="114">① WHERE 已把索引左侧列固定为等值？</text>
<text x="590" y="194">② ORDER BY 的列序与索引列序一致？</text>
<text x="590" y="274">③ 排序方向与索引存储方向一致？</text>
<text x="590" y="354">④ JOIN 时排序键是否全来自驱动表？</text>
</g>
<g stroke="#3F8F5E" stroke-width="1.8" fill="none" marker-end="url(#f5b)">
<path d="M590 140 L590 158"/>
<path d="M590 220 L590 238"/>
<path d="M590 300 L590 318"/>
<path d="M590 380 L590 398"/>
</g>
<g font-size="11" fill="#3F8F5E">
<text x="600" y="154">是</text>
<text x="600" y="234">是</text>
<text x="600" y="314">是</text>
<text x="600" y="394">是</text>
</g>
<g stroke="#C0504D" stroke-width="1.6" fill="none" marker-end="url(#f5a)">
<path d="M740 110 L788 110"/>
<path d="M740 190 L788 190"/>
<path d="M740 270 L788 270"/>
<path d="M740 350 L788 350"/>
</g>
<g font-size="11" fill="#C0504D">
<text x="752" y="104">否</text>
<text x="752" y="184">否</text>
<text x="752" y="264">否</text>
<text x="752" y="344">否</text>
</g>
<g fill="#FBEAEA" stroke="#E7B6B4">
<rect x="790" y="88" width="360" height="44" rx="8"/>
<rect x="790" y="168" width="360" height="44" rx="8"/>
<rect x="790" y="248" width="360" height="44" rx="8"/>
<rect x="790" y="328" width="360" height="44" rx="8"/>
</g>
<g font-size="11.5" fill="#8F3A38" text-anchor="middle">
<text x="970" y="115">filesort：结果集必须整体排序</text>
<text x="970" y="195">filesort：顺序被未固定的前缀列打断</text>
<text x="970" y="275">filesort：8.0 之前 DESC 只是语法糖</text>
<text x="970" y="355">filesort：被驱动表跨驱动行无序</text>
</g>
<rect x="340" y="400" width="500" height="48" rx="8" fill="#E9F5EE" stroke="#3F8F5E" stroke-width="1.8"/>
<text x="590" y="421" font-size="12.5" fill="#2C6B47" text-anchor="middle" font-weight="700">走索引序 → 0 排序</text>
<text x="590" y="439" font-size="11.5" fill="#2C6B47" text-anchor="middle">而且 LIMIT 可以提前终止：扫够 k 行就停，不必读完</text>
</svg>
<figcaption>图 5：四道门是「与」关系。最常失守的是第①道（WHERE 里出现了范围条件）和第④道（排序键来自被驱动表）。</figcaption>
</figure>

### 07.1 判定链：优化器先问"能不能不排序"

排序是**唯一一个可以完全消除的算子**，因为 B+ 树已经把顺序存好了。优化器里对应函数就叫 `test_if_skip_sort_order()`，判定顺序：

```
① ORDER BY 的列，是否是「WHERE 已固定为等值的列之后」的索引有序前缀？
② 方向是否与索引存储方向一致（8.0 需真实降序索引）？
③ 若是 join：排序键是否**全部来自驱动表**（nested loop 保序）？
④ 若 ORDER BY 列前面还有"未固定的前缀列"，顺序就被打断了 → 不能免排序
```

四类典型判定：

| 索引 | SQL | 能否免排序 | 原因 |
|---|---|---|---|
| `idx(a,b)` | `WHERE a=1 ORDER BY b` | ✅ | a 固定，b 在 a=1 内有序 |
| `idx(a,b)` | `WHERE a>1 ORDER BY b` | ❌ | a 是范围，b 跨 a 无序 |
| `idx(a,b)` | `ORDER BY b` | ❌ | 缺最左前缀 a |
| `idx(a,b)` | `WHERE a=1 ORDER BY b, a` | ✅ | 末尾加 a 不影响（a 是常量） |
| `idx(a,b)` | `WHERE a IN (1,2) ORDER BY b` | ⚠️ | 区间有序扫描通常保序，但计划可能变 |
| `idx(a,b)` | `WHERE a=1 ORDER BY b DESC` | 8.0 需 `(a,b DESC)` 索引 | 方向必须与物理存储一致 |

再看"用索引但顺序被打断"的经典误判：

```sql
-- KEY idx_status_ct(status, create_time)
SELECT * FROM orders WHERE status = 2 ORDER BY create_time DESC LIMIT 20;
-- ✅ 免排序：status 固定，create_time 在 status=2 内有序，反向扫 + LIMIT 早停，20 行就收工

-- KEY idx_ct(create_time)
SELECT * FROM orders WHERE status IN (2,3) ORDER BY create_time DESC LIMIT 20;
-- ⚠️ 坑：如果优化器用 idx_ct 扫，会命中大量 status=1 的行，扫到满足 20 行可能要读几万页
--    如果优化器选 idx_status_ct，则 status 有两个值 → 两个区间 → 必须归并排序
--    正确做法：建 idx_status_ct(status, create_time)，把 status=2 提到等值，或用 UNION ALL 拆
```

### 07.2 filesort 内部：从 sort_buffer 到归并

"Using filesort" 这个名字有历史包袱——**它不一定真的用文件**，小结果集全在内存完成。完整流程：

<figure>
<svg viewBox="0 0 1180 430" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Microsoft YaHei,PingFang SC,sans-serif">
<defs>
<marker id="f6a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#7E93AE"/></marker>
</defs>
<rect width="1180" height="430" rx="14" fill="#F7F9FC" stroke="#E3E7EE"/>
<text x="28" y="34" font-size="17" font-weight="700" fill="#1F2937">图 6｜filesort 内部：内存够就排，不够就切块落盘再归并</text>
<text x="28" y="56" font-size="12" fill="#4B5563">进程内没有"文件"这个开关，只有"sort_buffer 装不装得下"这一个分支。</text>
<rect x="30" y="82" width="230" height="76" rx="8" fill="#F3F8FE" stroke="#2C6FBE"/>
<text x="145" y="106" font-size="12.5" fill="#1F3F66" text-anchor="middle" font-weight="700">① 收集阶段</text>
<text x="145" y="126" font-size="11" fill="#4B5563" text-anchor="middle">sort_key + addon_fields</text>
<text x="145" y="144" font-size="11" fill="#4B5563" text-anchor="middle">→ sort_buffer（256KB）</text>
<path d="M260 120 L288 120" stroke="#7E93AE" stroke-width="1.8" fill="none" marker-end="url(#f6a)"/>
<path d="M420 84 L520 120 L420 156 L320 120 Z" fill="#FBF0E4" stroke="#C2803A" stroke-width="1.6"/>
<text x="420" y="117" font-size="12" fill="#8A5A20" text-anchor="middle" font-weight="700">装得下？</text>
<text x="420" y="133" font-size="11" fill="#8A5A20" text-anchor="middle">（内存）</text>
<path d="M504 108 L600 84" stroke="#3F8F5E" stroke-width="1.8" fill="none" marker-end="url(#f6a)"/>
<text x="540" y="86" font-size="11" fill="#3F8F5E">装得下</text>
<path d="M420 156 L420 196" stroke="#C0504D" stroke-width="1.8" fill="none" marker-end="url(#f6a)"/>
<text x="430" y="180" font-size="11" fill="#C0504D">装不下</text>
<rect x="620" y="60" width="250" height="60" rx="8" fill="#E9F5EE" stroke="#3F8F5E"/>
<text x="745" y="84" font-size="12" fill="#2C6B47" text-anchor="middle" font-weight="700">② 内存 std::sort</text>
<text x="745" y="103" font-size="11" fill="#2C6B47" text-anchor="middle">快排 + 堆排 + 插入（内省排序）</text>
<rect x="270" y="196" width="300" height="64" rx="8" fill="#FBEAEA" stroke="#E7B6B4"/>
<text x="420" y="220" font-size="12" fill="#8F3A38" text-anchor="middle" font-weight="700">②′ 每装满一个 buffer 就排序</text>
<text x="420" y="240" font-size="11" fill="#8F3A38" text-anchor="middle">落成一个 chunk 临时文件（number_of_tmp_files）</text>
<path d="M570 228 L630 228" stroke="#7E93AE" stroke-width="1.8" fill="none" marker-end="url(#f6a)"/>
<rect x="630" y="196" width="300" height="64" rx="8" fill="#FBF0E4" stroke="#DCB98E"/>
<text x="780" y="220" font-size="12" fill="#8A5A20" text-anchor="middle" font-weight="700">③ 多路归并</text>
<text x="780" y="240" font-size="11" fill="#8A5A20" text-anchor="middle">MERGEBUFF = 7 路，二次归并 15 路</text>
<path d="M870 120 L1000 120 L1000 330 L846 330" stroke="#7E93AE" stroke-width="1.6" fill="none" marker-end="url(#f6a)"/>
<path d="M780 260 L780 318" stroke="#7E93AE" stroke-width="1.6" fill="none" marker-end="url(#f6a)"/>
<rect x="340" y="318" width="500" height="62" rx="8" fill="#F3F8FE" stroke="#2C6FBE" stroke-width="1.8"/>
<text x="590" y="342" font-size="12.5" fill="#1F3F66" text-anchor="middle" font-weight="700">④ 输出（此时才回表取需要的列 / 或已在 buffer 里）</text>
<text x="590" y="363" font-size="11.5" fill="#1F3F66" text-anchor="middle">ORDER BY … LIMIT k：用优先队列，只维护 k 条候选，O(N + k·log k)</text>
<text x="28" y="404" font-size="12.5" fill="#1F2937">判断快慢看 <tspan font-weight="700">Sort_rows / Sort_merge_passes</tspan>，而不是看 Extra 里有没有 "Using filesort"。</text>
<text x="28" y="424" font-size="11.5" fill="#8A93A0">8.0.20 起 max_length_for_sort_data 已废弃：改为变长字段打包，优先全字段排序。</text>
</svg>
<figcaption>图 6：唯一的分支是「装不装得下」。所以真正要控制的是 N（参与排序的行数），调 sort_buffer_size 只是把落盘推迟，治不了 N 太大。</figcaption>
</figure>

```
-- 观察点
SHOW SESSION STATUS LIKE 'Sort%';
-- Sort_merge_passes   > 0  → 发生了磁盘归并（危险的信号）
-- Sort_scan / Sort_range   → filesort 的调用次数
-- Sort_rows                → 参与排序的行数（最关键！）
```

**成本模型（自己就能算）**：

```
filesort 成本 ≈ N × log₂N × key_compare_cost(0.05) + N × row_evaluate_cost
若溢出磁盘：+ chunk 数 × (写临时文件 + 归并读)
```

N 是**结果集行数**。所以"join 之后有 30 万行再 order by"必然炸——不是因为排序算法差，是因为 N 太大。**优化的唯一方向是减小 N**（提前过滤/分页），而不是调大 `sort_buffer_size`。

### 07.3 两种排序模式的演进（8.0.20 分水岭）

**8.0.19 及之前**——由 `max_length_for_sort_data`（默认 1024）决定：

| 模式 | 条件 | buffer 里放什么 | 代价 |
|---|---|---|---|
| **全字段排序**（single pass） | 需要的列总长 ≤ max_length_for_sort_data | `sort_key + 所有需要的列` | 一次读表，但 buffer 行数少 → chunk 多 |
| **rowid 排序**（two pass） | 超过阈值 | 只放 `sort_key + rowid` | buffer 能装更多行，但排序后要**按 rowid 回表**取列（随机 IO） |

**8.0.20 起**——`max_length_for_sort_data` 被废弃（设了也没用），改为：

- **优先全字段排序**，且对变长字段做**打包（packed addon fields）**：把变长列的实际长度记在记录里，使每条记录长度固定、可原地交换 → 排序时不用 memcpy 移动整行。
- 只有当"行太宽、全字段装不下"时才退回 rowid 模式。

> 这意味着：**老文章里"调大 max_length_for_sort_data 让排序走全字段"的优化手段，在 8.0.20+ 已经彻底失效**。这是面试里区分"看过书"和"踩过坑"的好细节。

### 07.4 ORDER BY + LIMIT：优先队列优化

```sql
SELECT * FROM orders ORDER BY create_time DESC LIMIT 20;
```

即使必须 filesort，也**不需要排全量**：优化器用**优先队列（堆）**，缓冲区只维护 20 条候选：

```
filesort 内部（sort_order + limit 存在时）：
  维护一个 20 元素的大顶堆（要最大的 20 个…取最小的 20 个则用小顶堆）
  每来一行：与堆顶比较 → 比堆顶差就丢弃（O(1)），比堆顶好就替换并下沉（O(log 20)）
  → 总代价 O(N + k·log k)，内存 O(k)
  → EXPLAIN 里仍显示 "Using filesort"，但实际只排了 20 条
```

所以：**"Using filesort" 不等于慢**。要看 `Sort_rows`：它是 20 还是 30 万，才是真相。

### 07.5 深分页为什么慢，以及唯一正确的救法

```sql
-- 慢：LIMIT 100000, 20
SELECT * FROM orders ORDER BY id LIMIT 100000, 20;
```

即使走索引序（`ORDER BY id` 免排序），也必须：

```
读 100020 条索引记录 → 对前 100000 条**逐条回表**（取 * 需要的列）→ 全丢弃
```

回表 10 万次随机 IO = 秒级。救法只有一个：**先只取主键，再回表 20 次**。

```sql
SELECT o.* FROM orders o
JOIN (SELECT id FROM orders ORDER BY id LIMIT 100000, 20) p ON p.id = o.id;
```

如果把 `ORDER BY` 列也做成覆盖索引（`(create_time, id)`），第一步就是**纯索引扫描、零回表**，10 万行可能只有几百页。

> **反模式**：`LIMIT 100000,20` 出现在商品列表/订单列表接口，且排序键没有覆盖索引 —— 这是线上慢查询排行榜前 3 的常客。

### 07.6 排序键含表达式 → 必 filesort（除非函数索引）

```sql
ORDER BY DATE(create_time)          -- 必 filesort
ORDER BY create_time + 0            -- 必 filesort
ORDER BY LOWER(name)                -- 必 filesort
ORDER BY FIELD(status, 2,1,3)       -- 必 filesort（自定义顺序）

-- 8.0.13+ 可用函数索引救：
ALTER TABLE t ADD INDEX idx_d ((DATE(create_time)));
-- 注意：查询里必须写成完全一致的表达式
```

---

## 08 GROUP BY：松散扫描、紧凑扫描、临时表

<figure>
<svg viewBox="0 0 1180 400" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Microsoft YaHei,PingFang SC,sans-serif">
<defs>
<marker id="f7a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#7E93AE"/></marker>
</defs>
<rect width="1180" height="400" rx="14" fill="#F7F9FC" stroke="#E3E7EE"/>
<text x="28" y="34" font-size="17" font-weight="700" fill="#1F2937">图 7｜同一个 GROUP BY，三条路径的代价差一个数量级</text>
<text x="28" y="56" font-size="12" fill="#4B5563">决定走哪条的只有一件事：GROUP BY 的列，能不能吃到某个索引的「最左前缀有序性」。</text>
<rect x="30" y="80" width="290" height="76" rx="8" fill="#E9F5EE" stroke="#3F8F5E"/>
<text x="175" y="104" font-size="12.5" fill="#2C6B47" text-anchor="middle" font-weight="700">① 松散索引扫描</text>
<text x="175" y="124" font-size="11" fill="#2C6B47" text-anchor="middle">Using index for group-by</text>
<text x="175" y="143" font-size="10.5" fill="#7A8A80" text-anchor="middle">前提：聚合只允许 MIN / MAX</text>
<path d="M320 118 L348 118" stroke="#7E93AE" stroke-width="1.8" fill="none" marker-end="url(#f7a)"/>
<rect x="350" y="80" width="470" height="76" rx="8" fill="#FFFFFF" stroke="#E3E7EE"/>
<text x="585" y="106" font-size="12" fill="#1F2937" text-anchor="middle">每个 group 只取首条记录（MIN）与末条（MAX）</text>
<text x="585" y="128" font-size="12" fill="#1F2937" text-anchor="middle">然后用 index_next_different 直接 seek 到下一个不同 key</text>
<text x="585" y="147" font-size="10.5" fill="#8A93A0" text-anchor="middle">中间记录被整段跳过，所以 SUM/COUNT 不能用这条路径</text>
<path d="M820 118 L848 118" stroke="#7E93AE" stroke-width="1.8" fill="none" marker-end="url(#f7a)"/>
<rect x="850" y="80" width="300" height="76" rx="8" fill="#F3FBF6" stroke="#9CCBAE"/>
<text x="1000" y="106" font-size="12" fill="#2C6B47" text-anchor="middle" font-weight="700">代价 ≈ 组数 × log n</text>
<text x="1000" y="128" font-size="11" fill="#2C6B47" text-anchor="middle">与行数无关，最快</text>
<text x="1000" y="147" font-size="10.5" fill="#8A93A0" text-anchor="middle">EXPLAIN 有 Using index for group-by</text>
<rect x="30" y="172" width="290" height="76" rx="8" fill="#EAF1FB" stroke="#2C6FBE"/>
<text x="175" y="196" font-size="12.5" fill="#1F3F66" text-anchor="middle" font-weight="700">② 紧凑索引扫描</text>
<text x="175" y="216" font-size="11" fill="#1F3F66" text-anchor="middle">Using index（无 temporary）</text>
<text x="175" y="235" font-size="10.5" fill="#7A8598" text-anchor="middle">GROUP BY 列是索引最左前缀</text>
<path d="M320 210 L348 210" stroke="#7E93AE" stroke-width="1.8" fill="none" marker-end="url(#f7a)"/>
<rect x="350" y="172" width="470" height="76" rx="8" fill="#FFFFFF" stroke="#E3E7EE"/>
<text x="585" y="198" font-size="12" fill="#1F2937" text-anchor="middle">顺序扫整个索引，边扫边聚合</text>
<text x="585" y="220" font-size="12" fill="#1F2937" text-anchor="middle">key 一变就输出一组（相邻即同组）</text>
<text x="585" y="239" font-size="10.5" fill="#8A93A0" text-anchor="middle">SUM / AVG / COUNT 都走这条：每行只读一次，但不用排序</text>
<path d="M820 210 L848 210" stroke="#7E93AE" stroke-width="1.8" fill="none" marker-end="url(#f7a)"/>
<rect x="850" y="172" width="300" height="76" rx="8" fill="#F5F9FE" stroke="#7FA8D6"/>
<text x="1000" y="198" font-size="12" fill="#1F3F66" text-anchor="middle" font-weight="700">代价 = O(n)</text>
<text x="1000" y="220" font-size="11" fill="#1F3F66" text-anchor="middle">无临时表、无排序</text>
<text x="1000" y="239" font-size="10.5" fill="#8A93A0" text-anchor="middle">生产上最常见的目标形态</text>
<rect x="30" y="264" width="290" height="76" rx="8" fill="#FBEAEA" stroke="#C0504D"/>
<text x="175" y="288" font-size="12.5" fill="#8F3A38" text-anchor="middle" font-weight="700">③ 临时表 + 排序</text>
<text x="175" y="308" font-size="11" fill="#8F3A38" text-anchor="middle">Using temporary; Using filesort</text>
<text x="175" y="327" font-size="10.5" fill="#9C7A79" text-anchor="middle">索引顺序帮不上忙</text>
<path d="M320 302 L348 302" stroke="#7E93AE" stroke-width="1.8" fill="none" marker-end="url(#f7a)"/>
<rect x="350" y="264" width="470" height="76" rx="8" fill="#FFFFFF" stroke="#E3E7EE"/>
<text x="585" y="290" font-size="12" fill="#1F2937" text-anchor="middle">建内部临时表（key = group 列）→ 按 group key 排序</text>
<text x="585" y="312" font-size="12" fill="#1F2937" text-anchor="middle">→ 排序后才"相邻去重"并累加聚合值</text>
<text x="585" y="331" font-size="10.5" fill="#8A93A0" text-anchor="middle">这里的排序不是为了输出顺序，而是为了"让相同 key 相邻"</text>
<path d="M820 302 L848 302" stroke="#7E93AE" stroke-width="1.8" fill="none" marker-end="url(#f7a)"/>
<rect x="850" y="264" width="300" height="76" rx="8" fill="#FDF1F0" stroke="#E7B6B4"/>
<text x="1000" y="290" font-size="12" fill="#8F3A38" text-anchor="middle" font-weight="700">代价 = O(n log n) + 可能落盘</text>
<text x="1000" y="312" font-size="11" fill="#8F3A38" text-anchor="middle">比路径② 慢 10~100 倍</text>
<text x="1000" y="331" font-size="10.5" fill="#9C7A79" text-anchor="middle">超过 temptable_max_ram 就落盘</text>
<text x="28" y="372" font-size="12.5" font-weight="700" fill="#1F2937">优化动作只有一个：给 GROUP BY 键建（或补齐）联合索引，把它从 ③ 推到 ②；聚合只有 MIN/MAX 时再推到 ①。</text>
<text x="28" y="390" font-size="11.5" fill="#8A93A0">5.7 起 GROUP BY 不再隐式排序；8.0 直接删掉了 GROUP BY … ASC/DESC 语法，要顺序必须显式写 ORDER BY。</text>
</svg>
<figcaption>图 7：路径 ③ 里的 filesort 是「为了实现分组」，不是为了「给用户排序」。这也是为什么 5.7 之后不能再靠 GROUP BY 拿顺序。</figcaption>
</figure>

### 08.1 三条路径，代价差一个数量级

```sql
SELECT customer_id, COUNT(*), SUM(amount) FROM orders GROUP BY customer_id;
```

| 路径 | EXPLAIN Extra | 物理动作 | 代价 |
|---|---|---|---|
| **① 松散索引扫描**（Loose Index Scan） | `Using index for group-by` | 在每个 group 的**第一条**记录上"跳读"，直接 seek 到下一个不同的 key | **组数 × log n**，与行数无关 |
| **② 紧凑索引扫描**（Tight Index Scan） | `Using index`（无 temporary） | 顺序扫整个索引，边扫边聚合，遇 key 变化就输出 | **O(n)**，无额外内存 |
| **③ 临时表 + 排序** | `Using temporary; Using filesort` | 建内部临时表（key = group 列），插入时聚合，最后按 group key 排序输出 | **O(n) + 建表 + 排序** |

**路径 ① 是 MySQL 里最被低估的优化**。它要求：

```
- GROUP BY 列必须是某个索引的「最左前缀」（顺序可任意，但必须连续）
- 聚合函数只能是 MIN / MAX（以及满足条件的 COUNT(DISTINCT)）★ 这是最常见的失败原因
- 不能有"作用于 group 列上的 WHERE 条件"打断前缀
- 不能有 ORDER BY（或 ORDER BY 与 GROUP BY 一致）
```

为什么只允许 MIN/MAX？因为"跳读"跳过了组内中间记录，**SUM/AVG/COUNT 需要看到每一条**，跳过就错了。MIN/MAX 在有序索引里，组内第一条就是 MIN、最后一条就是 MAX —— 天生可跳。

```sql
-- ✅ 松散索引扫描：idx(customer_id, amount)
SELECT customer_id, MIN(amount), MAX(amount) FROM orders GROUP BY customer_id;
-- Extra: Using index for group-by

-- ❌ 退化为紧凑扫描：SUM 需要逐条累加
SELECT customer_id, SUM(amount) FROM orders GROUP BY customer_id;
```

### 08.2 为什么 GROUP BY 常常伴随 "Using filesort"

GROUP BY 的本质是**按 key 分组去重**，实现只有两种范式：

```
① 有序去重：数据按 group key 排好序 → 相邻相同即一组（逐条比较即可）
② 哈希去重：建哈希表，key 映射到聚合状态
```

MySQL 的经典实现走 ①：如果索引不能提供顺序，就**先建临时表把数据收进来，再排序**，让相同 key 相邻，然后扫描聚合。所以 `Using temporary; Using filesort` 经常成对出现——**这里的 filesort 是为了"让相同 key 相邻"，不是为了给用户看顺序**。

> 5.7 起 `GROUP BY` **不再隐式排序**（老版本 `GROUP BY a` 等价于 `GROUP BY a ORDER BY a`）。8.0 更彻底：直接移除 `GROUP BY ... ASC/DESC` 语法。所以"GROUP BY 会自动排序"这句话在 5.7+ 是错的，要顺序必须显式写 ORDER BY。

### 08.3 Hash Aggregation（8.0.23+，需实测确认）

当 GROUP BY 无法利用索引顺序、且**不需要有序输出**时，8.0.23 之后优化器可以选择哈希聚合：

```
内存哈希表：group_key → {count, sum, ...}
  优势：不需要临时表排序，O(n) 单遍
  劣势：哈希表内存不够时要「分区溢出」到磁盘（按 key 的 hash 前缀分片，分片内再算）
```

**注意两点**：

1. 这个行为**强依赖小版本与是否需要排序**（有 `ORDER BY` 时仍可能需要排序），不要当成"8.0 就一定不 filesort"的定理。
2. 判断方法：`EXPLAIN FORMAT=TREE`（看是否是 `Group aggregate` 节点及其子节点有无 `Sort`）、`optimizer_trace`（搜 `using_hash_aggregation` 之类的标记）、`SHOW STATUS LIKE 'Created_tmp%'`。

### 08.4 临时表：内存还是磁盘，差 100 倍

```
internal_tmp_mem_storage_engine = TempTable   （8.0 默认，替代 MEMORY）
temptable_max_ram = 1G                        （内存上限，8.0.23+）
tmp_table_size / max_heap_table_size = 16M    （旧 MEMORY 引擎的上限，两者取小）

内存中：TempTable 用「分块 + 紧凑行格式」，比 MEMORY 引擎省 2~3 倍内存
溢出后：写 mmap 临时文件（temptable_use_mmap=ON）
再超：转 InnoDB 磁盘临时表（ibtmp1）
```

**两个硬性触发磁盘临时表的条件**（很容易被忽略）：

| 条件 | 原因 |
|---|---|
| SELECT 里有 `BLOB` / `TEXT` 列 | 旧 MEMORY 引擎不支持大字段 → 直接落盘 |
| group 数 × 行宽超过 `temptable_max_ram` | 溢出 |

```sql
-- 监控：一旦 Created_tmp_disk_tables 快速增长，就是 GROUP BY/DISTINCT/UNION 的锅
SHOW SESSION STATUS LIKE 'Created_tmp%';
-- Created_tmp_tables       内存临时表
-- Created_tmp_disk_tables  磁盘临时表 ★
```

### 08.5 DISTINCT 与 GROUP BY 的关系

```sql
SELECT DISTINCT customer_id FROM orders;       -- 语义 = GROUP BY customer_id
SELECT customer_id FROM orders GROUP BY customer_id;  -- 相同执行计划
```

所以 `DISTINCT` 的优化手段与 GROUP BY 完全一致：**让去重列成为索引前缀**，就能"扫索引顺带输出去重结果"（此时 Extra 显示 `Using index for group-by` 或 `Using index`），不建临时表。

反面案例：`SELECT DISTINCT a, b FROM t WHERE c=1` —— 若索引是 `(c)`，必须临时表；改成 `(c, a, b)` 就能免临时表，且变成覆盖索引扫描。

---

## 09 SUM / COUNT / MIN / MAX：聚合的物理代价

### 09.1 无 GROUP BY 的聚合：优化器会挑"最小的索引"

```sql
SELECT SUM(amount) FROM orders WHERE status = 2;
-- KEY idx_status_amount(status, amount)
```

```
执行：全索引扫描（不是全表扫描）
  → 只读 idx_status_amount 的叶页
  → 每页容纳约 (16KB / 20B) ≈ 800 条索引项
  → 10 万行 ≈ 125 页，vs 聚簇索引 10 万行×1KB ≈ 6250 页
  → IO 差 50 倍 ★
```

这就是"胖"的第二个红利：**二级索引叶页窄 → 同样的 IO 预算能扫更多行**。所以：

> `COUNT(*)`、`SUM(col)`、`AVG(col)` 这类"全表级聚合"，只要**走覆盖索引**，就比走聚簇索引快一个数量级。这是加联合索引最划算的场景之一。

### 09.2 `COUNT(*)` 的真实成本

```sql
SELECT COUNT(*) FROM orders;
```

- InnoDB **没有** MyISAM 那种"表行数缓存在表头、O(1) 返回"。原因：MVCC 下不同事务看到的行数不同（未提交/已删除/undo 里的版本），无法用单一数字表示。
- 所以 InnoDB 的 `COUNT(*)` **必然扫描**，优化器会自动选**最小的二级索引**（哪怕你写的是 `COUNT(1)`）。
- `COUNT(*)` / `COUNT(1)` / `COUNT(常量)` 在 8.0 里**执行计划完全一致**（优化器把常量折叠掉，都数行）。
- `COUNT(col)` 需要判断 `col IS NOT NULL`，多一层列判断，但**也是索引扫描**，差异微乎其微。

**工程结论**：大表精确计数请走缓存/计数表（Redis incr 或单独 count 表 + 事务内更新），不要在生产库上裸跑 `COUNT(*)`。

### 09.3 `MIN` / `MAX`：B+ 树两端 O(H)

```sql
SELECT MIN(id) FROM orders;      -- Extra: Select tables optimized away
SELECT MAX(create_time) FROM orders;  -- KEY idx_ct → 直接走最右叶子
```

```
MiN → index_first()：一路走"最左子页"到底的 0 号记录
MAX → index_last()：一路走"最右子页"到底的最后一条记录
代价 = H 次页读（3~4 次），与数据量无关
```

**约束**（不满足就退化成全扫）：

- 必须是单表、无 WHERE（或 WHERE 的条件与最值列无关但有索引能定位）；
- 列上有索引；
- 不能是 `MAX(col) WHERE other=xxx`（那是"分组最值"，要走 group-by 或 range）。

```sql
-- 常见坑：这个不能 optimized away，会全扫 idx
SELECT MAX(create_time) FROM orders WHERE status = 2;
-- 若 idx(status, create_time) 存在，则可用 "index_last" 定位 status=2 的最右端 → O(H) ⭐
```

### 09.4 `SUM` 的数值类型：金额必须 DECIMAL

```sql
SELECT SUM(amount) FROM order_item;   -- amount DECIMAL(18,2) → 结果 DECIMAL，精确
SELECT SUM(qty * price) FROM ...;     -- INT × DECIMAL → DECIMAL
SELECT SUM(price_double) FROM ...;    -- DOUBLE → 二进制浮点，累积误差
```

- 整型 `SUM` 结果类型是 `DECIMAL`（不是 BIGINT），避免溢出。
- `DECIMAL` 是**精确十进制**存储（每 9 位十进制数 4 字节），逐行累加无误差。
- `DOUBLE` 是 IEEE754，1.1+2.2 类问题会在百万行累加后放大到"分"级误差 → **金额字段一律 `DECIMAL`/`BIGINT 存分`**。
- 溢出：`BIGINT UNSIGNED` 求和的中间结果超过范围会截断并告警（`sql_mode` 严格时报错）——这是财务对账差 1 分钱的经典来源。

### 09.5 聚合 + JOIN：MySQL 不会自动"先聚合再连接"

```sql
-- 危险写法：先把三张表 join 成 300 万行，再 SUM
SELECT c.name, SUM(i.qty * i.price)
FROM customer c
JOIN orders o ON o.customer_id = c.id
JOIN order_item i ON i.order_id = o.id
WHERE c.level = 'A'
GROUP BY c.id;
```

MySQL **没有**"把聚合下推到连接之前"的通用改写能力。要不要手动改，取决于结果集规模：

```sql
-- 手动改写：先在明细表内聚合（结果集 = order 数），再与维表 join
SELECT c.name, x.amount
FROM customer c
JOIN (
  SELECT o.customer_id, SUM(i.qty * i.price) AS amount
  FROM orders o JOIN order_item i ON i.order_id = o.id
  GROUP BY o.customer_id
) x ON x.customer_id = c.id
WHERE c.level = 'A';
```

**为什么派生表有时"改写了也没用"**：`derived_merge` 优化默认开启，优化器会把派生表**合并**回外层（因为它认为合并后能更好地用索引），一合并，聚合就又跑到 join 之后了。阻断合并的三个手段：

```sql
-- ① 8.0 hint
SELECT /*+ NO_MERGE(x) */ ... FROM (SELECT ... GROUP BY ...) x
-- ② 派生表里加 LIMIT（有 LIMIT 的派生表不可合并）
-- ③ 关掉优化器开关（会话级，慎用）
SET SESSION optimizer_switch = 'derived_merge=off';
```

判断是否被合并：`EXPLAIN FORMAT=TREE` 里看有没有独立的 `Derived table` 节点，或 `SHOW WARNINGS` 看"Note: ... merged"。

### 09.6 窗口函数（8.0）：聚合的第三种形态

```sql
SELECT id, customer_id, amount,
       SUM(amount) OVER (PARTITION BY customer_id ORDER BY create_time) AS running
FROM orders;
```

物理代价：

```
① 按 PARTITION BY 键分组 → 需要排序（若索引是 (customer_id, create_time) 则可免排序）
② 组内按 ORDER BY 键排序 → 同上
③ 逐行维护窗口状态（累计和），输出
→ 必须物化整个结果集，无法 LIMIT 早停
```

所以窗口函数在"大表 + 无匹配索引"时，代价 = 全量 filesort + 全量输出。它适合报表，**不要放在高并发的列表接口里**。

---

## 10 多表关联：把多张表压回一次有序扫描

### 10.1 优化器在做什么：join order 搜索

```sql
SELECT ... FROM a JOIN b JOIN c JOIN d WHERE ...
```

```
逻辑空间：n 张表的排列 = n! 种 join 顺序（4 张表 = 24 种，10 张表 = 362 万种）
优化器不会全枚举，而是：
  贪心 + 剪枝（best_extension_by_limited_search）
  optimizer_search_depth = 62（默认；表数 > 7 时退化为贪心，只往前看有限步）
  搜索深度 = 2^k 增长，所以"表太多"时优化器本身也要花很久（这就是"烂 SQL 让优化器也崩"）
```

**代价常数表**（可查、可调，这是"为什么优化器选错了"的物理依据）：

```sql
SELECT * FROM mysql.server_cost;
-- disk_temptable_create_cost   20     建磁盘临时表
-- disk_temptable_row_cost      0.5    每行
-- key_compare_cost             0.05   每次比较
-- memory_temptable_create_cost 1
-- memory_temptable_row_cost    0.1
-- row_evaluate_cost            0.1    每行 CPU 处理

SELECT * FROM mysql.engine_cost;
-- io_block_read_cost           1.0    读一个页（随机）
-- memory_block_read_cost       0.25   从 Buffer Pool 读一个页
```

**这两个数字就是"随机 vs 顺序"的全部内核**：`io_block_read_cost = 1.0` 意味着"读一个 16KB 页"记 1 分。走索引读 3 页 = 3 分；回表 1000 次 = 1000 分；全表扫 6000 页 = 6000 分。于是"1000 行回表 vs 全表扫"的临界点就被算出来了 —— **优化器并不神秘，它只是在做这道算术题**。

### 10.2 四种连接算法：各自的数据结构

| 算法 | 版本 | 数据结构 | 复杂度 | EXPLAIN 关键字 |
|---|---|---|---|---|
| **Simple NLJ** | 全版本 | 双层循环，无索引 | O(N×M) | 最常见的"全表扫 + 全表扫" |
| **Index NLJ（INLJ）** | 全版本 | 驱动表每行 → 被驱动表 B+ 树 descend | O(N × log M) | `type=ref/eq_ref` |
| **Block NLJ（BNL）** | ≤8.0.19 | join_buffer（256KB）分块装驱动表行 | O(N/b × M) | `Using join buffer (Block Nested Loop)` |
| **Hash Join** | 8.0.18+，8.0.20 起替代 BNL | build 侧建**内存哈希表**，probe 侧探测；内存不够按 chunk 溢出到磁盘 | O(N + M) | `Using join buffer (hash join)` / TREE 里 `Inner hash join` |
| **BKA + MRR** | 5.6+ | 批量 key 排序后回表 | 把随机 IO 变顺序 | `Using join buffer (Batched Key Access)` |

<figure>
<svg viewBox="0 0 1180 470" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Microsoft YaHei,PingFang SC,sans-serif">
<defs>
<marker id="f8a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#2C6FBE"/></marker>
<marker id="f8b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#C0504D"/></marker>
</defs>
<rect width="1180" height="470" rx="14" fill="#F7F9FC" stroke="#E3E7EE"/>
<text x="28" y="34" font-size="17" font-weight="700" fill="#1F2937">图 8｜INLJ 执行过程：为什么 join 的输出「天然保序」</text>
<text x="28" y="56" font-size="12" fill="#4B5563">驱动表逐行 → 对每行做一次被驱动表索引 descend（≈2~3 页读）→ 命中就立即输出。</text>
<rect x="30" y="84" width="210" height="34" rx="6" fill="#EAF1FB" stroke="#2C6FBE"/>
<text x="135" y="106" font-size="12" fill="#1F3F66" text-anchor="middle" font-weight="700">驱动表 a（已过滤，2000 行）</text>
<g fill="#FFFFFF" stroke="#B7C6DA">
<rect x="30" y="118" width="210" height="46" rx="6"/>
<rect x="30" y="170" width="210" height="46" rx="6"/>
<rect x="30" y="222" width="210" height="46" rx="6"/>
</g>
<g font-size="12" fill="#1F2937" text-anchor="middle">
<text x="135" y="140">a.id = 1　（按索引序输出）</text>
<text x="135" y="192">a.id = 2</text>
<text x="135" y="244">a.id = 3</text>
</g>
<text x="135" y="288" font-size="11" fill="#8A93A0" text-anchor="middle">↓ 每行都触发一次查找</text>
<g fill="#F3F8FE" stroke="#7FA8D6">
<rect x="330" y="96" width="240" height="36" rx="6"/>
<rect x="330" y="176" width="240" height="36" rx="6"/>
</g>
<rect x="330" y="256" width="240" height="44" rx="6" fill="#E7F4F1" stroke="#2E9E8F"/>
<g font-size="12" text-anchor="middle">
<text x="450" y="119" fill="#1F3F66" font-weight="700">b 的索引 根页</text>
<text x="450" y="199" fill="#1F3F66" font-weight="700">中间页</text>
<text x="450" y="275" fill="#1F6B60" font-weight="700">叶子页：命中 3 行</text>
<text x="450" y="292" fill="#1F6B60" font-size="10.5">按 join_key 有序</text>
</g>
<g stroke="#7FA8D6" stroke-width="1.6" fill="none" marker-end="url(#f8a)">
<path d="M450 132 L450 174"/>
<path d="M450 212 L450 254"/>
</g>
<g stroke="#2C6FBE" stroke-width="1.8" fill="none" marker-end="url(#f8a)">
<path d="M240 138 L326 116"/>
<path d="M240 190 L326 194"/>
<path d="M240 242 L326 272"/>
</g>
<text x="284" y="128" font-size="10.5" fill="#2C6FBE" text-anchor="middle">descend</text>
<rect x="640" y="84" width="510" height="240" rx="10" fill="#FFFFFF" stroke="#E3E7EE"/>
<text x="660" y="108" font-size="12.5" fill="#1F2937" font-weight="700">join 输出流（边找边吐，不缓存、不重排）</text>
<g font-size="11.5" fill="#1F2937">
<text x="680" y="140">① (a=1) → b.x = 5</text>
<text x="680" y="168">② (a=1) → b.x = 9</text>
<text x="680" y="196" fill="#C0504D" font-weight="700">③ (a=2) → b.x = 1　← 从 9 掉回 1</text>
<text x="680" y="224" fill="#C0504D">④ (a=2) → b.x = 7</text>
<text x="680" y="252" fill="#C0504D">⑤ (a=3) → b.x = 3</text>
</g>
<rect x="668" y="128" width="4" height="48" fill="#3F8F5E"/>
<text x="1136" y="146" font-size="10.5" fill="#2C6B47" text-anchor="end">a 内有序</text>
<rect x="668" y="184" width="4" height="80" fill="#C0504D"/>
<text x="1136" y="214" font-size="10.5" fill="#8F3A38" text-anchor="end">a 变 → b.x 乱</text>

<text x="660" y="292" font-size="11.5" fill="#8A93A0">b 在「同一个 a 内部」有序，但跨 a 完全无序 —— 这就是全局有序被打破的位置。</text>
<text x="28" y="356" font-size="13" font-weight="700" fill="#1F2937">nested loop 是流式的：输出顺序 = 驱动表行顺序 × 被驱动表命中顺序，永远不会重排。</text>
<text x="28" y="382" font-size="12.5" fill="#3F8F5E">∴ ORDER BY 的键如果全来自驱动表 a，直接吃 a 的索引序 → 0 排序，且 LIMIT 能提前终止。</text>
<text x="28" y="408" font-size="12.5" fill="#C0504D">∴ 排序键一旦来自被驱动表 b，就必须等 join 把全部行吐完，再统一 filesort —— 结果集多大就排多大。</text>
<text x="28" y="436" font-size="11.5" fill="#8A93A0">交互式：驱动表 2000 行 × 每次 descend 2~3 页 ≈ 数千次页读；这也是「过滤后行数」比「表总行数」更重要的原因。</text>
</svg>
<figcaption>图 8：把「join 保序」理解成一句话——驱动表的顺序被原样继承下来，被驱动表的顺序只在单个驱动行内部有效。</figcaption>
</figure>

**INLJ 的物理图景（最重要）**：

```
驱动表 a（小表，全表扫或索引扫）
  for each row in a:                       ← 按 a 的物理顺序（或索引顺序）逐行
      b_index.search(row.join_key)         ← 一次 B+ 树 descend（H 次页读，根常驻则 2 次）
      if found: emit(a_row, b_row)         ← 立即输出
```

**注意 `emit` 的位置**：nested loop 是"边找边输出"，**输出顺序 = 驱动表行顺序 × 被驱动表命中顺序**。这句话是第 11 节"关联 + 排序能免 filesort"的物理基础。

**Hash Join 的物理图景**：

```
① build 阶段：读小表（或过滤后更小的表），把 [join_key, 需要的列] 放进哈希表
② probe 阶段：读大表，每行算 hash → 桶 → 比较 key → 输出
③ 内存不够：按 hash 高位把 build 侧分成若干 chunk 落盘，逐 chunk 重新 build+probe（Grace Hash Join）
```

Hash Join 的**致命前提**：join 条件必须是**等值**（`ON a.x = b.y`）。范围/不等值 join（`ON a.x > b.y`）无法哈希，只能 NLJ。

### 10.3 三表关联：逐层推演一个真实计划

```sql
SELECT o.id, c.name, i.sku
FROM orders o
JOIN customer c ON c.id = o.customer_id
JOIN order_item i ON i.order_id = o.id
WHERE o.create_time >= '2026-10-20' AND c.city = '杭州';
```

假设：`orders` 1000 万行，10 月 20 日之后 5 万行；`customer` 10 万行，杭州 2000 个；`order_item` 3000 万行，每单 3 条。

```
候选计划 A（c 驱动）：
  customer(杭州, 2000 行) → orders idx_customer(customer_id) → 过滤 create_time
  → order_item idx_order_id → 输出
  成本 ≈ 2000 × (2 + 3) 页 ≈ 1 万页

候选计划 B（o 驱动）：
  orders idx_ct(create_time) 范围扫 5 万行 → customer 主键 eq_ref → order_item idx_order_id
  成本 ≈ 范围扫 3000 页 + 5 万 × 2 页 + 5 万×3 × 2 页 ≈ 60 万页   ← 差 60 倍

优化器选 A。这就解释了"为什么小表驱动"不是玄学：
  驱动表行数直接乘在后两个表的 descend 次数上。
```

**"小表驱动"的准确表述**：不是"表的数据量小"，而是**"驱动阶段过滤后的行数 × 单次被驱动查找代价"最小**。一张 1000 万行的表，`WHERE` 过滤后只剩 100 行，它就是"小表"。

---

## 11 关联 + 排序为什么会炸，以及五种救法

### 11.1 先给判定表（这一张表值 90% 的面试分）

| 场景 | 排序键来源 | 能否免 filesort | 说明 |
|---|---|---|---|
| 单表 + 索引前缀 | 同表 | ✅ | 见 07.1 |
| `a JOIN b ON ... ORDER BY a.x` | **驱动表 a** | ✅ | nested loop 保序，且 a 走 `idx_x` 即可 |
| `a JOIN b ON ... ORDER BY b.x` | **被驱动表 b** | ❌ | b 的行是"每个 a 内部有序、跨 a 无序" |
| `... ORDER BY a.x, b.y` | 混合 | ❌ | 必然 filesort |
| `... GROUP BY a.id ORDER BY a.x` | 聚合后结果 | ❌（通常） | 聚合产物在临时表/哈希表里，顺序已丢 |
| `... ORDER BY 表达式` | —— | ❌ | 除非函数索引 |

**为什么"排序键来自被驱动表"必炸**——用 3 行伪数据就能看穿：

```
驱动表 a 按 id 顺序输出 1,2,3（每个 a 命中 b 的多行，b 内部按 b.x 有序）
join 输出流：
  (a=1, b.x=5) (a=1, b.x=9) (a=2, b.x=1) (a=2, b.x=7) (a=3, b.x=3)
                 ↑ 到这里 b.x 从 9 掉回 1 —— 全局无序
```

nested loop **永远不会重排**输出流（它是流式的），所以只能最后统一 filesort。

### 11.2 量化："join 后排序必炸"的算术

<figure>
<svg viewBox="0 0 1180 380" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Microsoft YaHei,PingFang SC,sans-serif">
<defs>
<marker id="f9a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#C2803A"/></marker>
</defs>
<rect width="1180" height="380" rx="14" fill="#F7F9FC" stroke="#E3E7EE"/>
<text x="28" y="34" font-size="17" font-weight="700" fill="#1F2937">图 9｜「关联 + 排序」必炸的算术链条（LIMIT 20 救不了）</text>
<text x="28" y="56" font-size="12" fill="#4B5563">排序的成本函数只有 N 和 log N；LIMIT 只决定「吐几条」，不决定「排多少条」。</text>
<g fill="#E9F5EE" stroke="#3F8F5E">
<rect x="30" y="96" width="170" height="80" rx="8"/>
</g>
<g fill="#FBF0E4" stroke="#DCB98E">
<rect x="216" y="96" width="170" height="80" rx="8"/>
<rect x="402" y="96" width="170" height="80" rx="8"/>
<rect x="588" y="96" width="170" height="80" rx="8"/>
</g>
<g fill="#FDF1F0" stroke="#E7B6B4">
<rect x="774" y="96" width="170" height="80" rx="8"/>
<rect x="960" y="96" width="170" height="80" rx="8"/>
</g>
<g font-size="12" text-anchor="middle" font-weight="700">
<text x="115" y="126" fill="#2C6B47">驱动表</text>
<text x="115" y="148" fill="#2C6B47">10 万行</text>
<text x="301" y="126" fill="#8A5A20">× 平均 3 行</text>
<text x="301" y="148" fill="#8A5A20">每驱动行</text>
<text x="487" y="126" fill="#8A5A20">join 输出</text>
<text x="487" y="148" fill="#8A5A20">30 万行</text>
<text x="673" y="126" fill="#8A5A20">排序数据量</text>
<text x="673" y="148" fill="#8A5A20">≈ 30MB</text>
<text x="859" y="126" fill="#8F3A38">sort_buffer 256KB</text>
<text x="859" y="148" fill="#8F3A38">→ ≈120 个 chunk</text>
<text x="1045" y="126" fill="#8F3A38">落盘 + 多路归并</text>
<text x="1045" y="148" fill="#8F3A38">→ 最后取 Top 20</text>
</g>
<g stroke="#C2803A" stroke-width="1.8" fill="none" marker-end="url(#f9a)">
<path d="M200 136 L214 136"/>
<path d="M386 136 L400 136"/>
<path d="M572 136 L586 136"/>
<path d="M758 136 L772 136"/>
<path d="M944 136 L958 136"/>
</g>
<text x="115" y="166" font-size="10.5" fill="#7A8A80" text-anchor="middle">过滤后行数才是 N</text>
<rect x="30" y="200" width="1100" height="48" rx="8" fill="#FBEAEA" stroke="#C0504D" stroke-width="1.6"/>
<text x="50" y="230" font-size="12.5" fill="#8F3A38" font-weight="700">LIMIT 20 在这里完全无效：优先队列必须「看完全部 30 万条候选」才能确定 Top 20，前 20 名可能出现在最后一行。</text>
<rect x="30" y="262" width="1100" height="48" rx="8" fill="#E9F5EE" stroke="#3F8F5E" stroke-width="1.6"/>
<text x="50" y="292" font-size="12.5" fill="#2C6B47" font-weight="700">四条出路：① 换驱动表让排序键吃到驱动表索引（LIMIT 立即早停）　② 延迟关联　③ 先分页再聚合　④ 反范式冗余排序键</text>
<text x="28" y="346" font-size="12" fill="#8A93A0">判断依据不是「有没有 Using filesort」，而是 Sort_rows 是 20 还是 30 万 —— 打开 SHOW SESSION STATUS LIKE 'Sort%' 就有答案。</text>
</svg>
<figcaption>图 9：把「必炸」拆成一条乘法链，就知道每一环各自能削掉多少：驱动行数、命中行数、行宽、buffer 大小。</figcaption>
</figure>

```
驱动表 10 万行 × 被驱动表平均命中 3 行 = 30 万行结果集
每行需排序的数据 100B → 30MB
sort_buffer_size = 256KB → 需要 120 个 chunk
→ 120 次落盘 + 多路归并（sort_merge_passes ≥ 2）
→ 加上前面 join 的 30 万次 descend
→ 秒级，且临时空间被打满
```

**关键洞察**：`LIMIT 20` 在这里**救不了你**——因为 filesort 的优先队列必须看到"所有候选行"才能确定 Top 20，而候选行来自 join 的完整输出。**除非**驱动表本身有序 + LIMIT 能早停。

### 11.3 五种救法（按优先级）

**救法 1：让驱动表有序，把排序"下沉"到驱动表的索引上**（最优，0 成本）

```sql
-- 原：ORDER BY o.create_time，但驱动表是 c
SELECT o.id, c.name FROM customer c JOIN orders o ON o.customer_id = c.id
WHERE c.city = '杭州' ORDER BY o.create_time DESC LIMIT 20;

-- 改：让 o 做驱动表，走 idx_ct(create_time) 反向扫，c 用主键 eq_ref
--    嵌套循环保序 + LIMIT 早停 → 扫到 20 条就结束
SELECT o.id, c.name FROM orders o JOIN customer c ON c.id = o.customer_id
WHERE c.city = '杭州' AND o.create_time >= '2026-01-01'  -- 给它一个范围，帮助选索引
ORDER BY o.create_time DESC LIMIT 20;
-- 必要时：FROM orders o FORCE INDEX(idx_ct) ...
```

**救法 2：延迟关联（先分页，再补字段）**

```sql
SELECT o.*, c.name
FROM (SELECT id FROM orders WHERE status = 2 ORDER BY create_time DESC LIMIT 100000, 20) p
JOIN orders o ON o.id = p.id
JOIN customer c ON c.id = o.customer_id
ORDER BY o.create_time DESC;   -- 只有 20 行，filesort 成本可忽略
```

**救法 3：先聚合/先去重，再 join 维表**（见 09.5）

```sql
-- 把"300 万行明细 join 后聚合"改成"明细内聚合 3 万组，再 join 维表"
```

**救法 4：反范式，把排序键冗余到驱动表**

```sql
-- 报表/列表场景：把 c.name 冗余进 orders（或建宽表/物化表）
ALTER TABLE orders ADD COLUMN customer_name VARCHAR(64);
-- 代价：一致性维护（写扩散），收益：彻底消灭 join 与回表
```

**救法 5（工程层）**：把"多维过滤 + 任意排序"的列表查询从 MySQL 挪到 ES / ClickHouse。关系库的 B+ 树只能为**一个**排序维度建索引，业务要"按时间/金额/状态任意排"时，索引数量会爆炸（每个组合一个索引），这是架构层面的无解，不是 SQL 技巧能救的。

---

## 12 一次真实 SQL 的完整解剖

### 12.1 原始 SQL（典型订单列表）

```sql
SELECT o.id, o.order_no, o.create_time, c.name,
       SUM(i.qty * i.price) AS amount
FROM orders o
JOIN customer c ON c.id = o.customer_id
JOIN order_item i ON i.order_id = o.id
WHERE o.status IN (2, 3)
  AND o.create_time >= '2026-10-01'
  AND c.name LIKE '华东%'
GROUP BY o.id
ORDER BY o.create_time DESC
LIMIT 20;
```

### 12.2 EXPLAIN 读出来的信息

```
+----+-------------+-------+--------+--------+-------+----------+----------------------------------------------------------+
| id | select_type | table | type   | key    | rows  | filtered | Extra                                                    |
+----+-------------+-------+--------+--------+-------+----------+----------------------------------------------------------+
|  1 | SIMPLE      | c     | range  | idx_nm |  1200 |   100.00 | Using index condition; Using temporary; Using filesort   |
|  1 | SIMPLE      | o     | ref    | idx_cu |    80 |    12.50 | Using where                                              |
|  1 | SIMPLE      | i     | ref    | idx_oi |     3 |   100.00 | NULL                                                     |
+----+-------------+-------+--------+--------+-------+----------+----------------------------------------------------------+
```

**逐条翻译**：

```
① c 用 idx_name(name) 做 range：[华东, 华冬) → 1200 个客户（range 天然保序，但没用）
② 每个 c 到 orders 用 idx_customer_id 查 80 单 → 过滤 status/create_time → 剩 10 单/客户
   1200 × 80 = 9.6 万次 descend，最终 1.2 万行
③ 每单到 order_item 查 3 条 → 3.6 万行明细
④ GROUP BY o.id → 1.2 万组 → **Using temporary**（1.2 万组的临时表）
⑤ ORDER BY o.create_time DESC → **Using filesort**（临时表里的 1.2 万行要排序）
⑥ LIMIT 20 → 排完 1.2 万行才取 20 行 ★ 全白干
```

### 12.3 三步改写与成本对比

```sql
-- 改写 v1：只把「分页」提前，聚合留在外层（仍要聚合 1.2 万组）
-- 改写 v2：分页只取 20 个 order_id，聚合只算 20 组 ★
SELECT o.id, o.order_no, o.create_time, c.name, x.amount
FROM (
  SELECT o.id
  FROM orders o JOIN customer c ON c.id = o.customer_id
  WHERE o.status IN (2,3) AND o.create_time >= '2026-10-01'
    AND c.name LIKE '华东%'
  ORDER BY o.create_time DESC
  LIMIT 20
) p
JOIN orders o ON o.id = p.id
JOIN customer c ON c.id = o.customer_id
LEFT JOIN (
  SELECT order_id, SUM(qty * price) AS amount
  FROM order_item WHERE order_id IN (SELECT id FROM p)   -- 或外层再过滤
  GROUP BY order_id
) x ON x.order_id = o.id
ORDER BY o.create_time DESC;
```

| 版本 | 参与排序行数 | 聚合组数 | 临时表 | 估计耗时 |
|---|---|---|---|---|
| 原始 | 1.2 万 | 1.2 万 | 磁盘 | 800~2000 ms |
| v1（只提前分页） | 1.2 万 → 20（外层） | 1.2 万 | 内存 | 400~800 ms |
| **v2（先分页再聚合）** | 20 | 20 | 无 | **10~30 ms** |
| 加覆盖索引 `(status, create_time)` | 0 排序 | —— | 无 | 5~15 ms |

**成本下降的本质**：把"先聚合全部再排前 20"改成"先取前 20 再聚合"。因为 **LIMIT 只能省"扫描"，不能省"计算"**；要让 LIMIT 生效，就必须让它**尽早出现在执行流程里**。

### 12.4 读 optimizer_trace 的三个必看字段

```sql
SET optimizer_trace = 'enabled=on';
SELECT ...;   -- 你的 SQL
SELECT trace FROM information_schema.OPTIMIZER_TRACE\G
SET optimizer_trace = 'enabled=off';
```

| 关键节点 | 看什么 | 用途 |
|---|---|---|
| `join_optimization.considered_execution_plans` | 每个候选计划的 `cost` 与 `chosen` | 为什么选了它，差多少 |
| `range_scan_alternatives` | 每个索引的 `ranges` / `rows` / `cost` / `index_dives_for_eq_ranges` | 判断 IN/LIKE 是否被改写成区间 |
| `filesort_summary` | `sort_algorithm` / `num_rows_estimate` / `num_rows_found` / `merge_passes` | 排序规模与是否落盘 |

---

## 13 辟谣：十二个被说烂的错误结论

| # | 常见说法 | 真相 |
|---|---|---|
| 1 | "B+ 树 3 层能存 2000 万" | 只在**行宽 ≈1KB、bigint 主键**时成立。窄表 3 层能撑上亿，宽表（含 text）可能 1000 万就到 4 层 |
| 2 | "有索引就一定快" | 回表率超 ~20%~30% 时，优化器会主动选全表扫——**这是对的，不是失效** |
| 3 | "IN 一定走索引" | 列表 > `eq_range_index_dive_limit`(200) 或总区间内存 > `range_optimizer_max_mem_size`(8MB) 时，可能直接退化为全表扫 |
| 4 | "ORDER BY 有索引就不排序" | 必须"WHERE 等值前缀 + 列顺序一致 + 方向一致"三者齐备；范围列之后顺序就断了 |
| 5 | "GROUP BY 会自动排序" | 5.7 起已移除隐式排序；8.0 连 `GROUP BY ... ASC/DESC` 语法都删了 |
| 6 | "COUNT(*) 比 COUNT(1) 慢" | 8.0 里两者计划完全相同；`COUNT(*)` 慢是因为 InnoDB 无行数缓存，跟写法无关 |
| 7 | "范围查询后面的索引列一定失效" | 传统上是；但 8.0.13+ 的 **Skip Scan** 可在前导列基数很低时（如 `status` 只有 3 个值）跳跃扫描救回来（`WHERE b=1` 在 `(a,b)` 索引上） |
| 8 | "LIKE '%x%' 加个索引就能快" | 不能。B+ 树对后缀约束无下界可定位，只能靠全文索引/倒排/函数索引/ES |
| 9 | "索引越多查询越快" | 每个索引都是一棵额外的 B+ 树：写放大、Buffer Pool 稀释、优化器搜索空间膨胀（>5~6 个索引开始明显） |
| 10 | "join 表越多一定越慢" | 小结果集驱动 + 被驱动表全走 `eq_ref` 时，10 表 join 也能是毫秒级；反之 2 表笛卡尔积就是灾难 |
| 11 | "子查询一定慢" | 8.0 的 semijoin（Table pullout / FirstMatch / Materialization / LooseScan）会把大部分 `IN`/`EXISTS` 子查询改写成 join |
| 12 | "Hash Join 一定优于 NLJ" | 结果集小、被驱动表有索引时，INLJ 的 3 次页读远优于建哈希表；Hash Join 只在"大表 join 大表且无可用索引"时赢 |

**关于第 7 条（Skip Scan）要补一句**：它的代价是"前导列每个不同值各来一次 descend"，所以只有前导列基数很低时才划算（`status` 3 个值 → 3 次 descend；`user_id` 10 万个值 → 10 万次，优化器直接放弃）。EXPLAIN 里会看到 `type=range` 且 `rows` 明显小于全表。

---

## 14 面试话术：60 秒 / 3 分钟 / 被打断时怎么接

### 14.1 60 秒版（先说结论，再给账）

> "InnoDB 用 B+ 树，本质是**为了少做随机 IO**。磁盘一次随机读是毫秒级、顺序读是 GB/s 级，差好几个数量级，所以索引结构的第一目标是把树高压到 3~4 层。
>
> 压树高只有一条路：**把扇出做大**，也就是'胖'——一页 16KB，非叶记录只存 `主键 + 4B 子页号` ≈17B，一页能装约 950 个分支；叶子存整行，1KB 行宽下一页 16 行。于是 3 层就是 `950×950×16 ≈ 1400 万`，4 层到百亿级。
>
> 而'胖'的副产品是**叶子按 key 有序、页间双向链表**。所有 SQL 的排序/范围/去重，只要能落到索引的有序前缀上，就从 `O(n log n)` 排序退化成 `O(log n + k)` 定位加顺序扫。范围查询是'定位下界 + 沿 `FIL_PAGE_NEXT` 右扫'，`ORDER BY` 命中索引序就是 0 排序，`GROUP BY` 命中前缀就是松散/紧凑索引扫描。这才是 B+ 树真正的价值，不只是'树矮'。"

### 14.2 3 分钟版（加三段）

1. **账本**：`H = log_fanout(N)`；一页 16KB 的来历（4KB block × 4、预读、doublewrite）；为什么不是 64KB（写放大、分裂成本、内存浪费）。
2. **结构**：页内不是纯二分，是"Page Directory slot 二分 + 组内 ≤8 条链表比较"，靠记录头 4 bit 的 `n_owned` 维护；叶页 `PAGE_LEVEL=0`；页间 `FIL_PAGE_PREV/NEXT` 才是链表。
3. **执行**：引擎只认 `seek / next / prev / rnd_pos`，`LIKE`/`IN`/`ORDER BY`/`GROUP BY` 全在 Server 层被翻译成这些原语的组合；`ORDER BY` 能否免排序取决于 `test_if_skip_sort_order` 的四个条件；join 的输出顺序 = 驱动表顺序，所以"排序键全来自驱动表"才能免 filesort。

### 14.3 被打断时怎么接（高频追问 → 一句话回答）

| 追问 | 回答骨架 |
|---|---|
| 为什么不用哈希索引 | 等值 O(1) 但不支持范围/排序/前缀；InnoDB 只在 Buffer Pool 页级做自适应哈希（`AHI`），且只对等值热点生效 |
| 为什么不用跳表 | 跳表是内存结构，每层一次随机 IO，27 层 = 27 次；且无页内批量比较的收益 |
| B 树差在哪 | 非叶也存整行 → 扇出从 950 掉到 ~80 → 多一层 = 多一次随机 IO；范围查询要中序遍历 |
| 为什么 3 层就够 | 因为 `950² × 叶页行数`，不是"3 层玄学"，是页大小与记录大小的算术 |
| 页内怎么找 | slot 二分 + 组内 ≤8 条线性；因为记录是单链表，不能真二分 |
| 分裂代价 | 2 页写 + 父页改 + 可能级联到根（树高 +1）；随机主键导致 50/50 分裂与碎片 |
| 为什么 `ORDER BY` 有时不排序 | `test_if_skip_sort_order`：等值前缀固定 + 列序一致 + 方向一致 + join 时来自驱动表 |
| `Using filesort` 一定慢吗 | 不一定，`ORDER BY ... LIMIT 20` 走优先队列只维护 20 条；看 `Sort_rows` |
| `Using temporary` 什么代价 | 内部临时表 + 通常伴随排序；超 `temptable_max_ram` 落盘，代价 ×10~100 |
| join 为什么小表驱动 | 驱动行数直接乘在被驱动表的 descend 次数上；"小"指**过滤后**行数 |

---

## 15 参数速查表与源码入口

### 15.1 与本文强相关的参数

| 参数 | 默认值 | 影响 |
|---|---|---|
| `innodb_page_size` | 16384 | 页大小，建库时定死；决定扇出与树高 |
| `innodb_buffer_pool_size` | 128M | 决定多少页常驻；根/非叶页基本常驻 → 实际 IO ≈ H-1 |
| `innodb_stats_persistent_sample_pages` | 20 | 采样页数，直接影响 `cardinality` 与 `rows` 估算 |
| `eq_range_index_dive_limit` | 200 | IN 列表 ≤200 逐值 dive，>200 用统计估算（计划易翻） |
| `range_optimizer_max_mem_size` | 8M | 区间元数据内存上限，超出直接放弃 range 优化 |
| `optimizer_search_depth` | 62 | join 顺序搜索深度；表多时退化为贪心 |
| `join_buffer_size` | 256K | BNL 分块 / Hash Join 的 build 侧内存 |
| `sort_buffer_size` | 256K | filesort 内存，决定 chunk 数与归并轮数（**不是越大越好**，每连接独占） |
| `read_rnd_buffer_size` | 256K | MRR 批量回表的缓冲 |
| `tmp_table_size` / `max_heap_table_size` | 16M | 内存临时表上限（取两者较小值） |
| `internal_tmp_mem_storage_engine` | TempTable | 8.0 的临时表引擎，比 MEMORY 省内存 |
| `temptable_max_ram` | 1G | TempTable 内存上限，超出溢写磁盘 |
| `optimizer_switch` | 多个 | `derived_merge` / `semijoin` / `materialization` / `mrr` / `prefer_ordering_index`（**为 ORDER BY 牺牲更好索引的倾向，可关**） |
| `innodb_read_ahead_threshold` | 56 | 连续读多少页触发线性预读（顺序扫描加速的来源） |

### 15.2 源码入口（想自己验证时按这个找）

| 想看的逻辑 | MySQL 8.0 源码位置 | 关键函数 |
|---|---|---|
| B+ 树下树 | `storage/innobase/btr/btr0cur.cc` | `btr_cur_search_to_nth_level()` |
| 页内二分 | `storage/innobase/page/page0cur.cc` | `page_cur_search_with_match()` |
| 行检索 + MVCC + 锁 | `storage/innobase/row/row0sel.cc` | `row_search_mvcc()` |
| 页分裂 | `storage/innobase/btr/btr0btr.cc` | `btr_page_split_and_insert()` |
| 优化器 join 顺序 | `sql/sql_select.cc` | `JOIN::optimize()` / `best_extension_by_limited_search()` |
| 能否免排序 | `sql/sql_select.cc` | `test_if_skip_sort_order()` |
| range 改写（LIKE/IN） | `sql/range_optimizer/` | `get_mm_tree()` / `get_mm_leaf()` |
| filesort | `sql/filesort.cc` | `Filesort::run()` / `merge_many_buff()` |
| 临时表 | `sql/sql_tmp_table.cc` | `create_tmp_table()` |
| 半连接改写 | `sql/sql_optimizer.cc` | `Optimize_table_order` / semijoin 相关 |
| Hash Join | `sql/iterators/hash_join_*.cc` | `HashJoinIterator` |

### 15.3 一分钟验证脚本

```sql
-- ① 看页大小与树高（近似：看索引的页数分布）
SELECT table_name, index_name, stat_name, stat_value
FROM mysql.innodb_index_stats
WHERE stat_name IN ('n_leaf_pages','size') AND table_name = 'orders';

-- ② 看某条 SQL 是否真的没排序
EXPLAIN FORMAT=TREE SELECT ...;   -- 有没有 "-> Sort:" 节点

-- ③ 看排序规模
SHOW SESSION STATUS LIKE 'Sort%';

-- ④ 看临时表是否落盘
SHOW SESSION STATUS LIKE 'Created_tmp%';

-- ⑤ 看优化器为什么选这个计划
SET optimizer_trace='enabled=on'; SELECT ...;
SELECT TRACE FROM information_schema.OPTIMIZER_TRACE;
```

---

## 16 自测 18 题

> 每题先自己口述 3 句，再看要点。答不上来的，回对应小节。

1. **"又矮又胖"分别指什么？哪个是因哪个是果？** —— 胖是手段（16KB 页、非叶 17B 记录 → 扇出 ~950），矮是目的（H=log_fanout N → 3~4 层 = 3~4 次随机 IO）。
2. **为什么一次 IO 要搬 16KB 而不是 1 个 key？** —— 磁盘/文件系统最小单位是 4KB block；寻道成本与搬运量无关，一次搬 4 个 block 才不浪费；页内比较再多也不额外花 IO。
3. **3 层能存 2000 万这个数字怎么来的、边界在哪？** —— `1170²×16`；前提是 bigint 主键 + 1KB 行宽；按 17B 精算是 950，1KB 行 3 层约 1400 万。
4. **为什么 UUID 主键会让索引"变大变慢"？** —— 随机插入 → Buffer Pool 命中率低 + 50/50 分裂 + 填充率 ~50% → 同数据量多占 30~50% 页 → 树更容易变高；且主键宽度放大到每个二级索引。
5. **页内查找为什么不是纯二分？** —— 记录是单链表无法 O(1) 取中间；靠 Page Directory slot 二分 + 组内 ≤8 条线性比较，`n_owned` 4 bit 维护。
6. **`FIL_PAGE_PREV/NEXT` 在哪、为什么重要？** —— File Header +8/+12；范围扫描跨页不用重新 descend，直接跳页，IO 从"行数×随机"降为"字节数/16KB 顺序"。
7. **内存池里根页常驻，为什么实际 IO 是 H-1？** —— 非叶页总量极小（千万行表的非叶页往往几百 MB 以内），Buffer Pool 基本全缓存。
8. **范围查询的 IO 次数由什么决定？** —— 由**扫描字节数/16KB** 决定，与行数无关；覆盖索引把行宽从 1KB 降到 20~40B，页数差 25~50 倍。
9. **`WHERE a>10 AND b=5`（索引 `(a,b)`）为什么 b 不能继续用索引定位？** —— 字典序下 b 跨 a 无序；只能用 ICP 在引擎层过滤减少回表。
10. **`LIKE 'abc%'` 为什么能走索引，`'%abc'` 为什么不能？** —— 前缀能算出区间上界；后缀约束在有序数组上无下界（-∞），信息论层面不可定位。
11. **`LIKE 'abc%'` 在 `utf8mb4_0900_ai_ci` 下有什么隐患？** —— 等价类含大小写/重音变体，区间边界走 weight 计算，可能多扫；精确匹配要 `_bin`/`_as_cs`。
12. **IN 列表超过 200 个为什么会翻计划？** —— `eq_range_index_dive_limit` 以上改用统计估算，`rows` 失真 → 改走全表扫。
13. **`ORDER BY` 免排序的四个条件？** —— 等值前缀固定 + 列序一致 + 方向与索引一致 + join 时排序键来自驱动表。
14. **`Using filesort` 一定慢吗？`max_length_for_sort_data` 还要调吗？** —— 不一定，优先队列只维护 k 条；8.0.20 起该参数已废弃、无效。
15. **`Using temporary; Using filesort` 同时出现说明什么？** —— 无法用索引有序性完成分组 → 建临时表 + 为"让相同 key 相邻"而排序；5.7+ 这个排序**不是**为了输出顺序。
16. **`Using index for group-by` 的前提？** —— GROUP BY 列是索引最左前缀 + 聚合只有 MIN/MAX（或满足条件的 COUNT(DISTINCT)）+ 无 ORDER BY。
17. **`COUNT(*)` 为什么不能 O(1)？** —— MVCC 下不同事务看到不同行数；InnoDB 无全局行数缓存，但优化器会自动选最小二级索引。
18. **"三表 join + ORDER BY 被驱动表字段"为什么必然 filesort？** —— nested loop 流式输出，顺序 = 驱动表序 × 被驱动命中序，被驱动字段全局无序；只能最后统一排序，且 LIMIT 无法早停。救法：换驱动表让排序键落到驱动表索引上。

---

## 附：一页速记

```
【为什么矮】H = ⌈log_950(N)⌉ → 3~4 层 = 3~4 次随机 IO = 一切设计的起点
【为什么胖】16KB 页 = 4×4KB block；非叶记录 17B → 扇出 950；叶页存整行
【容量账】  1KB 行：3 层 1400 万 / 4 层 137 亿；100B 行：3 层 1.4 亿
【页内查找】Page Directory slot 二分 + 组内 ≤8 条链表比较（n_owned 4bit）
【页间链表】FIL_PAGE_PREV/NEXT（File Header +8/+12）；PAGE_LEVEL=0 即叶子
【范围】    定位下界 + 沿叶子右扫；IO = H + 字节/16KB
【LIKE】    'x%' → 区间 [x, x+∞)；'%x' → 无下界 → 全扫（只能倒排/全文/函数索引）
【IN】      等值 → 多区间 → 排序后依次扫；>200 值改用统计 → 计划易翻
【排序】    索引序（0 排序）vs filesort（sort_buffer → chunk → 多路归并；LIMIT 用堆）
【分组】    松散扫描（组数×log n）/ 紧凑扫描（O(n)）/ 临时表+排序（8.0.23+ 可能哈希）
【聚合】    SUM 走覆盖索引；MIN/MAX 走树两端 O(H)；COUNT(*) 必扫
【JOIN】    INLJ 每行一次 descend；输出顺序 = 驱动表顺序 → 排序键必须来自驱动表
【必炸】    大结果集 join + 排序 → 先分页再聚合/延迟关联/换驱动表/反范式
```

