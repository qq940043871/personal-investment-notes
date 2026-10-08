# Java 排障进阶：Arthas tt/ognl 与 async-profiler 火焰图实战

> 本篇是《Java 高级架构师实战排查手册》的**进阶篇**，聚焦两个高频但难精通的工具：
> **Arthas 的 `tt`（时光隧道）与 `ognl`（表达式引擎）**，以及 **async-profiler 火焰图**。
> 所有示例均基于真实线上场景，含完整命令与真实输出。

## 目录

- [第一篇 Arthas tt 命令深度实战](#第一篇-arthas-tt-命令深度实战)
- [第二篇 Arthas ognl 高级用法](#第二篇-arthas-ognl-高级用法)
- [第三篇 async-profiler 火焰图实战](#第三篇-async-profiler-火焰图实战)
- [第四篇 三件套联合排查实战](#第四篇-三件套联合排查实战)

---

# 第一篇 Arthas tt 命令深度实战

## 1.1 tt 是什么，为什么需要它

`trace` / `watch` 是**"实时盯梢"**——只有你盯着的这一刻发生的调用才能被捕获。
但线上问题常常是**偶发**的：某个参数组合、某个特定用户、某个时间点才触发。

`tt`（Time Tunnel，时光隧道）解决的就是这个问题：

> **它把所有方法调用的"入参、返回值、异常、耗时、发生时间"全部录制下来，
> 事后可以逐条检索、查看现场、甚至"回放"复现。**

一句话对比：

| 工具 | 时效性 | 能否回溯 |
|---|---|---|
| `watch` | 实时 | ❌ 只能看当下 |
| `trace` | 实时 | ❌ 只能看当下 |
| `tt` | **录制 + 事后** | ✅ 可检索任意历史调用 |

## 1.2 基础用法

```bash
# 1. attach
java -jar arthas-boot.jar

# 2. 开始录制（-t 表示 record，记录每次调用）
tt -t com.demo.service.OrderService createOrder

# 输出：
#  INDEX   TIMESTAMP            COST(ms)  IS-RET  IS-EXP   OBJECT         CLASS                          METHOD
#  --------------------------------------------------------------------------------------------------------------
#  1000    2024-05-20 10:23:11  12.34     true    false    0x3f2a1b0c     OrderService                   createOrder
#  1001    2024-05-20 10:23:12  8.21      true    false    0x7a1c2d3e     OrderService                   createOrder
#  1002    2024-05-20 10:23:15  4210.55   true    false    0x9b4e5f6a     OrderService                   createOrder  ← 这条慢！
```

字段含义：

| 字段 | 含义 |
|---|---|
| `INDEX` | 调用序号（后续检索用） |
| `TIMESTAMP` | 调用发生时间 |
| `COST(ms)` | 耗时（毫秒） |
| `IS-RET` | 是否正常返回 |
| `IS-EXP` | 是否抛异常 |
| `OBJECT` | 对象 hash |
| `CLASS` / `METHOD` | 类名 / 方法名 |

## 1.3 核心杀招：按耗时/异常过滤

只关心慢调用和异常：

```bash
# 只录制耗时 > 500ms 的调用
tt -t com.demo.service.OrderService createOrder '#cost > 500'

# 只录制抛异常的调用
tt -t com.demo.service.OrderService createOrder 'throwExp != null'

# 只录制特定入参（第一个参数等于 10086 的订单）
tt -t com.demo.service.OrderService createOrder 'params[0] == 10086'

# 组合条件：慢 且 是某用户
tt -t com.demo.service.OrderService createOrder '#cost > 1000 && params[0].userId == 9527'
```

> **表达式支持**（tt 特有的内置变量）：
> - `params[]` —— 方法入参数组
> - `returnObj` —— 返回值
> - `throwExp` —— 抛出的异常
> - `#cost` —— 本次调用耗时（ms）
> - `target` —— 当前对象实例

## 1.4 检索与查看现场

录制一段时间后（比如让"偶发问题"跑一夜），开始事后分析：

```bash
# ① 列出所有录制的调用（默认按 INDEX 升序，最多 100 条）
tt -l

# 输出：
#  INDEX   TIMESTAMP            COST(ms)  IS-RET  IS-EXP   OBJECT         CLASS            METHOD
#  1000    2024-05-20 02:13:11  4521.22   true    false    0x3f2a1b0c     OrderService     createOrder
#  1001    2024-05-20 03:41:52  5120.88   true    false    0x3f2a1b0c     OrderService     createOrder
#  ...

# ② 按耗时倒序，找出最慢的调用
tt -l | sort -k3 -rn | head

# ③ 查看某一条的完整现场（入参 + 返回值）
tt -i 1000

# 输出：
#  INDEX:          1000
#  GMT-CREATE:     2024-05-20 02:13:11
#  COST(ms):       4521.22
#  ...
#  PARAMETERS:
#     [0]=10086
#     [1]={"userId":9527,"items":[...]}
#  RETURN-ON:
#     {"orderId":"ORD20240520001","status":"PAID"}
```

**关键**：`tt -i 1000` 能把那一刻**完整的入参和返回值**打印出来 —— 这就是"复现偶发问题"的核心能力。

## 1.5 进阶：tt 的所有子命令

```bash
# 列出现有录制
tt -l

# 查看某条记录详情
tt -i <INDEX>

# 删除某条记录
tt -d <INDEX>              # 删除单条
tt -d                      # 删除全部

# 修改记录（改变索引号）
tt -m <INDEX> <NEW_INDEX>

# 生成统计报告（按耗时分布）
tt --stat

# 输出：
#  Affect(class-cnt:1, method-cnt:1) cost in 234 ms.
#  +----------------------------------------------------+
#  |  COST(ms)  |  COUNT  |  PERCENT  |  PERCENT(累计)  |
#  +----------------------------------------------------+
#  |  0-10      |  8234   |  82.34%   |  82.34%        |
#  |  10-50     |  1200   |  12.00%   |  94.34%        |
#  |  50-100    |  400    |   4.00%   |  98.34%        |
#  |  100-1000  |  150    |   1.50%   |  99.84%        |
#  |  >1000     |   16    |   0.16%   | 100.00%        |
#  +----------------------------------------------------+
#  有 16 次调用超过 1 秒 → 这些就是问题所在
```

## 1.6 高阶：tt 回放（复现问题）

`tt` 最强大的能力 —— **把历史调用的入参重新执行一次**，用于在修复后验证：

```bash
# 回放某条调用（重新执行一遍，执行业务逻辑）
tt -i 1000 -p

# 输出：
# RE-INDEX:     2000
# COST(ms):     4120.33        ← 重放了，依然慢 → 问题可复现
# RETURN-ON:
#     {"orderId":"ORD20240520001","status":"PAID"}
```

甚至可以**修改入参后再回放**（需结合 ognl，见第二篇）：

```bash
# 回放时修改参数（把第一个参数改成 99999 试试）
tt -i 1000 -p --params '99999'
```

> ⚠️ **安全警告**：`-p` 回放会**真实执行业务逻辑**（可能写库、发消息）！
> 生产环境回放**必须极其谨慎**，优先在预发/测试环境操作。

## 1.7 实战案例：偶发慢订单排查

**背景**：订单创建接口偶发 4-5 秒，复现困难，白天不明显。

```bash
# Step 1：挂上 tt，只录慢的，让它跑一整晚
tt -t com.demo.service.OrderService createOrder '#cost > 3000'

# Step 2：次日早上检索
tt -l
#  INDEX   TIMESTAMP            COST(ms)  ...
#  1000    2024-05-20 02:13:11  4521.22
#  1001    2024-05-20 03:41:52  5120.88

# Step 3：看第一条现场
tt -i 1000
#  PARAMETERS:
#     [0]=10086
#     [1]={"userId":9527,"items":[...],"couponId":"CPN999"}   ← 注意这个 couponId
#  RETURN-ON:
#     {"orderId":"ORD...","status":"PAID"}

# Step 4：发现规律 —— 都带 couponId；用 trace 深挖
trace com.demo.service.CouponService calcDiscount -n 3
#  `---[3980.12ms] CouponService:calcDiscount()
#       +---[3975.33ms] CouponDao.queryUserCoupons()   ← 慢 SQL！
```

**根因**：优惠券查询表 `user_coupon` 缺索引，带 `couponId` 的订单走全表扫描。

## 1.8 tt 使用注意事项

| 事项 | 说明 |
|---|---|
| **内存占用** | 录制会占内存，长跑需 `-n` 限制条数或定期 `tt -d` 清理 |
| **只录不查** | 录制本身开销小，但高频方法（QPS 上万）慎用 |
| **回放安全** | `-p` 会真实执行，禁止对写操作随意回放 |
| **退出清空** | Arthas 退出后录制数据丢失，需及时分析 |
| **限制条数** | `tt -t <类> <方法> -n 100` 只保留 100 条 |

```bash
# 推荐写法：限制条数 + 只录慢的
tt -t com.demo.service.OrderService createOrder '#cost > 1000' -n 200
```

---

# 第二篇 Arthas ognl 高级用法

## 2.1 ognl 是什么

OGNL（Object-Graph Navigation Language）是一种**表达式语言**，Arthas 内置了 ognl 命令，
可以直接在**运行中的 JVM 里读取/修改对象、调用方法、遍历容器**。

> 它是线上"**动态调试**"的终极武器：不改代码、不重启，就能看/改运行时状态。

## 2.2 基础语法

```bash
# 执行表达式（注意整个表达式用引号包裹）
ognl '<表达式>'

# 常见内置对象
ognl '#context'                  # 当前上下文
ognl '#classLoader'              # 当前类加载器
```

## 2.3 实战一：读取/修改静态字段

**场景**：线上某个开关写死为 `false`，想临时打开验证。

```bash
# ① 先看静态字段当前值
getstatic com.demo.config.FeatureConfig DEBUG
# 输出：
# field: DEBUG
# @Boolean[false]

# ② 或者用 ognl 读
ognl '@com.demo.config.FeatureConfig@DEBUG'
# 输出：@Boolean[false]

# ③ 动态修改（临时打开开关）
ognl '@com.demo.config.FeatureConfig@DEBUG = true'
```

> ⚠️ **注意**：`final` 修饰的字段无法被 ognl 修改；
> 且修改是**临时的**，重启即失效，务必同步回代码。

## 2.4 实战二：读取静态 Map/List 配置

```bash
# 读取一个静态 Map 配置
ognl '@com.demo.config.Constants@ERROR_CODES'

# 获取 Map 中某个 key 的值
ognl '@com.demo.config.Constants@ERROR_CODES.get("1001")'

# 遍历 Map 的所有 key
ognl '@com.demo.config.Constants@ERROR_CODES.keySet()'

# 读取静态 List 大小
ognl '@com.demo.config.Constants@WHITE_LIST.size()'

# 判断某元素是否在 List 中
ognl '@com.demo.config.Constants@WHITE_LIST.contains("10.0.0.5")'
```

**典型用途**：排查"配置为何不生效"——直接看**运行时真实加载的配置**，
避免"本地改了但没发布"或"配置中心没推送成功"的困惑。

## 2.5 实战三：调用方法

```bash
# 调用静态方法
ognl '@com.demo.util.DateUtils@format(new java.util.Date())'

# 调用实例方法（需要先有实例，见下）
ognl '@java.lang.System@currentTimeMillis()'

# 常用：查看系统属性
ognl '@java.lang.System@getProperty("java.version")'
ognl '@java.lang.System@getProperty("user.dir")'

# 查看 JVM 环境变量
ognl '@java.lang.System@getenv("JAVA_HOME")'
```

## 2.6 实战四：查看 Spring 容器中的 Bean

这是 ognl 在 Spring 项目里的**王牌用法** —— 直接定位容器里的 Bean 状态。

```bash
# ① 先拿到 Spring 上下文（不同版本类名不同）
# Spring Boot 2.x：
ognl '@org.springframework.web.context.ContextLoader@getCurrentWebApplicationContext()'

# 或通过 ApplicationContextHolder（项目自定义的静态持有）
ognl '@com.demo.util.SpringContextUtil@getBean("orderService")'

# ② 查看某个 Bean 的字段值
ognl '@com.demo.util.SpringContextUtil@getBean("dataSource")'

# ③ 查看线程池 Bean 的实时状态（超实用！）
ognl '@com.demo.util.SpringContextUtil@getBean("orderExecutor").getActiveCount()'
ognl '@com.demo.util.SpringContextUtil@getBean("orderExecutor").getQueue().size()'
ognl '@com.demo.util.SpringContextUtil@getBean("orderExecutor").getPoolSize()'
```

**典型场景**：线程池参数"配了但没生效"——用 ognl 读**运行时的真实参数**，一查便知。

## 2.7 实战五：遍历与条件筛选

OGNL 支持类集合的操作：

```bash
# 若某静态 List 存放了连接信息，筛选出特定元素
ognl '@com.demo.config.ServerConfig@SERVERS.{? #this.port == 8080}'

# 投影：取出所有元素的某个属性
ognl '@com.demo.config.ServerConfig@SERVERS.{host}'

# 集合大小
ognl '@com.demo.config.ServerConfig@SERVERS.size()'

# 求和（假设是数值 List）
ognl '@com.demo.config.StatsConfig@COUNTERS.{ #this }.sum()'
```

## 2.8 实战六：配合 tt / watch 使用

`ognl` 的表达式语法可以直接用在 `watch` / `tt` 里：

```bash
# watch 里用 ognl 表达式加工输出
watch com.demo.service.OrderService createOrder \
  '{params[0], params[1].userId, @com.demo.util.DateUtils@format(new java.util.Date())}' -x 3

# 只观察特定条件
watch com.demo.service.OrderService createOrder \
  'returnObj' 'params[0] > 10000' -x 2

# tt 里用 ognl 判断
tt -t com.demo.service.OrderService createOrder \
  '@com.demo.config.FeatureConfig@DEBUG == true'
```

## 2.9 实战七：查看/触发 GC、查看内存

```bash
# 触发一次 Full GC（Arthas 自带命令更直观）
ognl '@java.lang.System@gc()'

# 查看可用处理器数
ognl '@java.lang.Runtime@getRuntime().availableProcessors()'

# 查看最大堆内存
ognl '@java.lang.Runtime@getRuntime().maxMemory()'

# 查看当前空闲内存
ognl '@java.lang.Runtime@getRuntime().freeMemory()'
```

## 2.10 ognl 安全与注意事项

| 事项 | 说明 |
|---|---|
| **改字段风险** | 会立即生效，可能导致业务异常，操作前想清楚 |
| **final 字段** | 无法修改 |
| **不可持久** | 重启失效，必须回写代码/配置 |
| **权限** | 生产环境 ognl 是**高危操作**，需审批 + 记录 |
| **类名要全** | 必须用**全限定类名**（含包名） |
| **表达式引号** | shell 里注意单双引号嵌套，建议整个表达式用单引号包住 |

```bash
# 引号处理示例：表达式内部含双引号时用单引号包外层
ognl '@com.demo.config.Constants@MAP.get("key")'
```

---

# 第三篇 async-profiler 火焰图实战

## 3.1 为什么需要火焰图

`jstack` 只能看到**某一瞬间**的线程快照，无法回答：
- 一个接口 80% 的时间花在**哪些方法**上？
- CPU 热点到底在哪里？
- 内存分配的热点在哪里？

**火焰图**能把这"**一段时间内的调用分布**"可视化。它不是快照，而是**统计采样**。

## 3.2 async-profiler 的优势

相比传统工具（JVisualVM、JProfiler、perf）：

| 工具 | 优点 | 缺点 |
|---|---|---|
| JVisualVM | 图形化 | 需 GUI、开销大 |
| JProfiler | 功能全 | 商业收费 |
| perf | 系统级 | 不识别 Java 栈 |
| **async-profiler** | **低开销、无 safe-point 偏差、支持 CPU/内存/锁** | 命令行使用 |

**核心优势**：基于 `AsyncGetCallTrace` + `perf_events`，
**不依赖安全点（Safe Point）**，能精确采集到真实热点，且开销通常 < 2%。

## 3.3 安装

```bash
# 下载（按 CPU 架构选，常见 x86_64）
wget https://github.com/async-profiler/async-profiler/releases/download/v3.0/async-profiler-3.0-linux-x64.tar.gz
tar -zxvf async-profiler-3.0-linux-x64.tar.gz
cd async-profiler-3.0-linux-x64

# 目录结构
# bin/       可执行文件
# lib/       依赖库
# profiler.sh  主脚本
```

## 3.4 基础用法

```bash
# 语法：./profiler.sh [选项] <pid>

# 采集 CPU 火焰图，持续 30 秒，输出到 HTML
./profiler.sh -d 30 -f /tmp/cpu.html <PID>

# 或采集到就停止（按回车/交互）
./profiler.sh start <PID>
sleep 30
./profiler.sh stop <PID>
```

生成的 `cpu.html` **下载到本地用浏览器打开**即可交互查看。

### 采集对象（event 类型）

```bash
# CPU 热点（默认）
./profiler.sh -e cpu -d 30 -f /tmp/cpu.html PID

# 内存分配（malloc/对象分配）—— 排查内存问题神器
./profiler.sh -e alloc -d 30 -f /tmp/alloc.html PID

# 锁竞争（排查 synchronized/ReentrantLock 争用）
./profiler.sh -e lock -d 30 -f /tmp/lock.html PID

# 墙钟时间（含 IO 等待、睡眠，适合排查"慢"但 CPU 不高）
./profiler.sh -e wall -t -d 30 -f /tmp/wall.html PID

# 按线程拆分（wall 模式常用 -t）
./profiler.sh -e wall -t -d 30 -f /tmp/wall.html PID
```

## 3.5 如何读懂火焰图

火焰图的规则：

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
3. **顶层的方块**：正在实际执行的方法（叶子方法）
4. **颜色**：通常随机会色，无固定含义（某些版本按类型着色）

**看图三原则**：
> 1. 直接找**最宽的顶层方块** —— 那就是热点
> 2. 从热点**往下看调用链** —— 找到业务入口
> 3. **窄而高的"塔尖"** 是偶发调用，通常忽略

## 3.6 实战案例一：CPU 飙高定位（火焰图版）

**背景**：某服务 CPU 持续 90%，`jstack` 多次抓取都看到"一堆 RUNNABLE 但栈五花八门"。

```bash
# 采集 30 秒 CPU 火焰图
./profiler.sh -e cpu -d 30 -f /tmp/cpu.html <PID>
```

打开火焰图后看到：

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

**结论**：`BigDecimal.multiply` 占了接近 60% 的采样 →
所有 CPU 都耗在**高精度浮点乘法**上，业务在**循环内做大量 BigDecimal 运算**。

**修复**：改用 `long`（以"分"为单位）做整数运算，或缓存计算结果，或减少精度位数。

## 3.7 实战案例二：内存分配热点（alloc 模式）

**背景**：GC 频繁，Young GC 每秒好几次，但堆不算小。

```bash
# 采集内存分配火焰图
./profiler.sh -e alloc -d 30 -f /tmp/alloc.html <PID>
```

火焰图显示：

```text
最宽的顶层方块：
 └─ ...业务链路...
      └─ LogUtil.buildLogMessage          ← 超宽
           └─ StringBuilder.toString
                └─ char[] 分配            ← 顶层最宽，占 45%
```

**结论**：大量 `char[]` 是**日志拼接**产生的 —— 某处高频打日志（比如循环里打日志、
或开了 DEBUG 日志打印大对象）。

**修复**：日志加级别判断 / 用占位符 `log.info("{}", obj)` / 降日志级别 / 关闭无用日志。

## 3.8 实战案例三：锁竞争（lock 模式）

**背景**：接口 RT 高但 CPU 不高，怀疑锁竞争。

```bash
./profiler.sh -e lock -d 30 -f /tmp/lock.html <PID>
```

火焰图顶层出现：

```text
 └─ ...业务链路...
      └─ OrderService.updateStock
           └─ synchronized (OrderService.class)  ← 大面积阻塞
```

**结论**：库存更新用了**类级别锁**（锁粒度太大），所有订单串行化。

**修复**：锁粒度细化到商品维度（`synchronized (productId)` 或分段锁 / Redis 分布式锁）。

## 3.9 实战案例四：CPU 不高但接口慢（wall 模式）

**背景**：接口 RT 3 秒，但 CPU 只有 10%。

```bash
# wall 模式采集（含 IO 等待、线程睡眠）
./profiler.sh -e wall -t -d 30 -f /tmp/wall.html <PID>
```

火焰图显示某线程：

```text
 └─ http-nio-exec-15
      └─ OrderService.query
           └─ HttpClient.execute        ← 超宽
                └─ SocketInputStream.socketRead0   ← 卡在网络 IO
```

**结论**：慢在下游 HTTP 调用（第三方接口响应慢）。

**修复**：加超时 + 降级 + 缓存，或换异步调用。

> **wall vs cpu 的关键区别**：CPU 不高但慢 → 一定用 **wall** 模式，因为 CPU 模式看不到等待时间。

## 3.10 与 Arthas profiler 的配合

Arthas 内置了 async-profiler，无需单独安装：

```bash
# Arthas 里直接采集
profiler start
# 采集中...
profiler stop --format html --file /tmp/cpu.html

profiler start -e alloc      # 采集内存分配
profiler start -e lock       # 采集锁竞争
profiler status              # 查看状态
```

输出会提示 `Profiling started` 和生成的文件路径。

## 3.11 常用参数速查

```bash
./profiler.sh -h                    # 帮助

# 关键参数
-e <event>      # 事件类型：cpu / alloc / lock / wall / itimer
-d <seconds>    # 持续秒数
-f <file>       # 输出文件（.html 交互 / .jfr / .collapsed）
-t              # 按线程拆分
-i <ms>         # 采样间隔（默认 10ms）
--all-threads   # 采集所有线程（默认只采集活跃的）
-o <option>     # 输出选项，如 collapsed, flat
```

```bash
# 导出原始折叠数据（可自定义分析）
./profiler.sh -d 30 -o collapsed -f /tmp/flame.collapsed PID
# 每行格式：栈帧;栈帧;栈帧 采样次数

# 导出 JFR 格式（可导入 JMC 深度分析）
./profiler.sh -d 30 -f /tmp/prof.jfr PID

# 查看采样统计（无 GUI 时快速定位）
./profiler.sh -d 30 -o flat -f /tmp/flat.txt PID
```

## 3.12 火焰图之外：flat 输出（无 GUI 快速定位）

不方便打开 HTML 时，用 `flat` 模式直接打文本排行：

```bash
./profiler.sh -e cpu -d 30 -o flat -f /tmp/flat.txt <PID>
cat /tmp/flat.txt
```

输出示例：
```text
Total samples: 45231
      Frame                              Samples   % 
  java.math.BigDecimal.multiply          27138   60.00%   ← 一眼定位
  java.lang.StringBuilder.toString         4523   10.00%
  com.demo.service.PriceCalculator.calc   2714    6.00%
  ...
```

## 3.13 火焰图注意事项

| 事项 | 说明 |
|---|---|
| **权限** | 需与目标进程同用户，或 root |
| **采样开销** | 通常 < 2%，生产可用 |
| **容器环境** | 需挂载 `--privileged` 或放开 `perf_event_paranoid` |
| **perf 权限** | `sysctl -w kernel.perf_event_paranoid=-1`（或用 `-e itimer` 规避） |
| **采样时长** | 太短不准，建议 30 秒以上；偶发问题需长时间采集 |
| **图表解读** | X 轴是**占比不是时间**，不要误读为时序 |

```bash
# 容器/受限环境 fallback（不需要 perf_events）
./profiler.sh -e itimer -d 30 -f /tmp/cpu.html PID
```

---

# 第四篇 三件套联合排查实战

## 4.1 场景：接口偶发 RT 高 + CPU 中等

**目标**：一个完整闭环，展示 tt / ognl / 火焰图如何配合。

```bash
# ── Step 1：tt 录制，抓出偶发慢调用 ──────────────────
tt -t com.demo.service.OrderService createOrder '#cost > 2000' -n 100

# 等一段时间后检索
tt -l
#  1000    02:13:11   4521.22
#  1001    03:41:52   5120.88

# 看现场，找共性
tt -i 1000
#  PARAMETERS: [0]=10086  [1]={...,"source":"APP"}   ← 发现都来自 APP 端

# ── Step 2：trace 定位到具体子调用 ──────────────────
trace com.demo.service.OrderService createOrder -n 5 '#cost > 1000'
#  `---[4521ms] createOrder()
#       +---[2ms]   OrderDao.insert()
#       +---[4120ms] PriceCalculator.calc()   ← 慢在这里
#       `---[10ms]  OrderProducer.send()

# ── Step 3：火焰图确认 CPU/耗时热点 ──────────────────
./profiler.sh -e cpu -d 30 -o flat -f /tmp/flat.txt <PID>
cat /tmp/flat.txt
#  java.math.BigDecimal.multiply   60.00%   ← 印证是计算问题

# ── Step 4：ognl 查看运行时参数/配置 ─────────────────
# 看看价格计算是否走了某个"高精度"开关
ognl '@com.demo.config.PriceConfig@HIGH_PRECISION'
#  @Boolean[true]   ← 开关开着，导致走 BigDecimal 高精度路径

# ── Step 5：临时验证（修改开关，观察效果）────────────
ognl '@com.demo.config.PriceConfig@HIGH_PRECISION = false'
# 观察 RT 是否下降

# ── Step 6：修复后 tt 回放验证 ───────────────────────
tt -i 1000 -p
#  COST(ms): 320.11   ← 从 4521ms 降到 320ms，验证通过
```

## 4.2 工具选择决策树

```
问题现象是什么？
│
├─ CPU 高 ──────────────→ 火焰图(cpu) + jstack + Arthas thread
│
├─ 内存涨/OOM ──────────→ jmap dump + MAT + 火焰图(alloc)
│
├─ GC 频繁 ─────────────→ jstat + GC日志 + 火焰图(alloc)找分配热点
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

## 4.3 组合使用速记

| 你要做的事 | 命令 |
|---|---|
| 抓到偶发调用的现场 | `tt -t <类> <方法> '#cost > N'` |
| 看历史某次调用详情 | `tt -i <INDEX>` |
| 重放历史调用 | `tt -i <INDEX> -p` |
| 录制的耗时分布 | `tt --stat` |
| 读运行时静态字段 | `ognl '@类@字段'` 或 `getstatic 类 字段` |
| 改运行时静态字段 | `ognl '@类@字段 = 新值'` |
| 调运行时 Bean 方法 | `ognl '@工具类@getBean("x").getActiveCount()'` |
| CPU 热点 | `profiler.sh -e cpu -d 30 -f x.html PID` |
| 分配热点 | `profiler.sh -e alloc -d 30 -f x.html PID` |
| 锁竞争 | `profiler.sh -e lock -d 30 -f x.html PID` |
| 慢但 CPU 低 | `profiler.sh -e wall -t -d 30 -f x.html PID` |
| 无 GUI 快速看排行 | `profiler.sh -e cpu -o flat -f x.txt PID` |

## 4.4 三大安全红线

> 1. **`tt -p` 回放会真实执行业务逻辑** —— 写操作（下单/扣款/发消息）绝不在生产回放。
> 2. **`ognl` 改字段立即生效** —— 高危操作，需审批、需记录、需回滚预案。
> 3. **火焰图采样线上可用但注意时长** —— 长时间采集会占磁盘，采集完及时清理文件。

---

## 附：一页纸记忆口诀

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
