# 高级Java开发全栈 - 面试真题（含详细答案）

> 适用岗位：高级 Java 开发工程师 / 全栈工程师 / AI 应用开发工程师
> 整理时间：2025 年 · 来源：大厂真题、高频考点汇总
> 合并说明：2026-09 由《02_高级Java开发全栈面试真题》（实战详解 12 题）与《高级Java程序员面试题真题合集》（40 题要点版）合并，重合主题保留要点版并吸收实战内容，大模型应用开发 3 题为独有章节。

---

## 目录

- [一、Java核心基础](#一java核心基础)
- [二、JVM与性能优化](#二jvm与性能优化)
- [三、多线程与并发编程](#三多线程与并发编程)
- [四、框架知识（Spring全家桶）](#四框架知识spring全家桶)
- [五、数据库相关](#五数据库相关)
- [六、分布式与微服务](#六分布式与微服务)
- [七、系统设计](#七系统设计)
- [八、数据结构与算法](#八数据结构与算法)
- [九、设计模式](#九设计模式)
- [十、网络通信](#十网络通信)
- [十一、云原生与新技术](#十一云原生与新技术)
- [十二、大模型应用开发](#十二大模型应用开发)
- [十三、行为与经验题](#十三行为与经验题)

---

## 一、Java核心基础

### 1. String、StringBuilder 和 StringBuffer 的区别与适用场景

**真题来源：** 阿里、字节、腾讯高频题

**答案要点：**

| 特性 | String | StringBuilder | StringBuffer |
|------|--------|---------------|--------------|
| **可变性** | 不可变 | 可变 | 可变 |
| **线程安全** | 安全（不可变） | 不安全 | 安全（synchronized） |
| **性能** | 拼接效率低 | 最高 | 较高 |
| **适用场景** | 少量字符串操作 | 单线程大量拼接 | 多线程环境 |

**详细说明：**
- `String` 是不可变对象，每次拼接都会创建新对象
- `StringBuilder` 通过 `append()` 方法修改字符序列，不产生新对象
- `StringBuffer` 方法加了 `synchronized` 关键字，保证线程安全

**代码示例：**
```java
// String拼接底层优化
String s = "a" + "b" + "c";  // 编译期优化为 "abc"

// 循环拼接应使用StringBuilder
StringBuilder sb = new StringBuilder();
for (int i = 0; i < 1000; i++) {
    sb.append(i);
}
```

---

### 2. Java异常体系结构与分类

**真题来源：** 美团、京东面试题

**答案要点：**

```
Throwable
├── Error（严重错误，程序无法恢复）
│   ├── OutOfMemoryError
│   ├── StackOverflowError
│   └── VirtualMachineError
└── Exception（可处理的异常）
    ├── RuntimeException（运行时异常，非检查异常）
    │   ├── NullPointerException
    │   ├── ArrayIndexOutOfBoundsException
    │   ├── ClassCastException
    │   └── IllegalArgumentException
    └── 非运行时异常（检查异常，编译期强制处理）
        ├── IOException
        ├── SQLException
        └── FileNotFoundException
```

**区别：**
- **运行时异常**：编程错误导致，可不显式处理
- **非运行时异常**：必须 `try-catch` 或 `throws` 声明

---

### 3. HashMap、LinkedHashMap 和 TreeMap 的区别

**真题来源：** 阿里、字节高频题

**答案要点：**

| 特性 | HashMap | LinkedHashMap | TreeMap |
|------|---------|---------------|---------|
| **顺序** | 无序 | 插入顺序 | 键排序 |
| **时间复杂度** | O(1) | O(1) | O(log n) |
| **实现** | 数组+链表/红黑树 | HashMap+双向链表 | 红黑树 |
| **线程安全** | 不安全 | 不安全 | 不安全 |
| **null键值** | 允许 | 允许 | 键不允许null |

**底层原理：**
- **HashMap**：JDK8后，链表长度≥8且数组长度≥64时转为红黑树
- **扩容机制**：默认容量16，负载因子0.75，扩容为原来的2倍

---

### 4. Java中的四种引用类型

**真题来源：** 字节、腾讯面试题

**答案要点：**

| 引用类型 | 描述 | 回收时机 | 应用场景 |
|---------|------|---------|---------|
| **强引用** | `Object obj = new Object()` | 永不回收（除非不可达） | 普通对象 |
| **软引用** | `SoftReference` | 内存不足时回收 | 缓存 |
| **弱引用** | `WeakReference` | GC时回收 | ThreadLocal |
| **虚引用** | `PhantomReference` | 随时可回收，get()总返回null | 跟踪GC活动 |

**代码示例：**
```java
// 软引用 - 适合缓存
SoftReference<byte[]> cache = new SoftReference<>(new byte[1024*1024]);

// 弱引用 - ThreadLocal实现
WeakReference<Object> weakRef = new WeakReference<>(new Object());
```

---

### 5. Java多态性的实现机制

**真题来源：** 各大厂基础必考题

**答案要点：**

**多态三要素：**
1. 继承/实现
2. 方法重写
3. 父类引用指向子类对象

**方法重载 vs 方法重写：**

| 特性 | 重载（Overload） | 重写（Override） |
|------|-----------------|-----------------|
| **发生位置** | 同一个类中 | 父子类之间 |
| **方法签名** | 方法名相同，参数不同 | 完全一致 |
| **返回类型** | 可以不同 | 必须一致或为子类型 |
| **访问修饰符** | 可以不同 | 不能更严格 |
| **编译/运行** | 编译期确定 | 运行时动态绑定 |

---

## 二、JVM与性能优化

### 6. JVM内存模型与垃圾回收机制

**真题来源：** 阿里、字节、腾讯高频题

**答案要点：**

**JVM内存结构：**
```
JVM内存
├── 堆（Heap）- 线程共享
│   ├── 新生代（Eden + S0 + S1）
│   └── 老年代
├── 方法区（Method Area）- 线程共享
│   ├── 类信息
│   ├── 常量
│   └── 静态变量
├── 栈（Stack）- 线程私有
│   ├── 局部变量表
│   ├── 操作数栈
│   └── 方法出口
├── 本地方法栈（Native Stack）
└── 程序计数器（PC Register）
```

**GC算法：**

| 算法 | 原理 | 优点 | 缺点 | 适用场景 |
|------|------|------|------|---------|
| **标记-清除** | 标记后直接清除 | 简单 | 内存碎片 | 老年代 |
| **复制算法** | 分两块，复制存活对象 | 效率高 | 内存利用率低 | 新生代 |
| **标记-整理** | 标记后整理到一端 | 无碎片 | 效率较低 | 老年代 |
| **分代收集** | 根据对象年龄分代处理 | 综合优势 | 复杂 | 主流GC |

**垃圾回收器对比：**

| 回收器 | 类型 | 特点 | 适用场景 |
|--------|------|------|---------|
| **Serial** | 新生代 | 单线程，简单 | 单核CPU |
| **Parallel** | 新生代 | 多线程，高吞吐 | 后台计算 |
| **CMS** | 老年代 | 低停顿 | Web应用 |
| **G1** | 全堆 | Region化，可控停顿 | 大内存、低延迟 |
| **ZGC** | 全堆 | 低延迟（<10ms） | 超大内存 |

---

### 7. Java内存模型（JMM）与并发特性

**真题来源：** 字节、阿里架构师岗位

**答案要点：**

**JMM三大特性：**

| 特性 | 描述 | 实现方式 |
|------|------|---------|
| **原子性** | 操作不可分割 | synchronized、Lock、Atomic类 |
| **可见性** | 一个线程修改对其他线程立即可见 | volatile、synchronized、final |
| **有序性** | 程序执行顺序与代码顺序一致 | volatile、happens-before规则 |

**volatile关键字：**
- 保证可见性
- 禁止指令重排
- **不保证原子性**

**happens-before规则：**
1. 程序顺序规则
2. 监视器锁规则
3. volatile变量规则
4. 线程启动规则
5. 线程终止规则
6. 传递性规则

---

### 8. JVM调优实战经验

**真题来源：** 阿里P7+、字节架构师

**答案要点：**

**调优目标：**
- 降低GC停顿时间
- 提高吞吐量
- 减少内存占用

**常用参数：**
```bash
# 堆内存设置
-Xms2g          # 初始堆大小
-Xmx4g          # 最大堆大小
-Xmn1g          # 新生代大小
-XX:MetaspaceSize=256m    # 元空间大小

# GC器选择
-XX:+UseG1GC                # 使用G1
-XX:MaxGCPauseMillis=200    # 最大GC停顿时间

# GC日志
-Xlog:gc*:file=gc.log

# 内存溢出时dump
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/logs/heapdump.hprof
```

**排查工具：**
- jstat：查看GC统计
- jmap：堆内存快照
- jstack：线程堆栈
- VisualVM/JProfiler：图形化分析
- Arthas：在线诊断工具

---


**生产实战补充（G1 · 8G 堆）：**

```bash
# 1. 查看GC日志
jstat -gcutil <pid> 1000 10

# 2. 导出堆内存快照
jmap -dump:format=b,file=heap.hprof <pid>

# 3. 分析堆内存
# 使用 MAT 或 VisualVM 分析 heap.hprof

# 4. 查看线程栈
jstack <pid> > thread.txt
```

**常见问题与解决：**

| 问题 | 现象 | 解决方案 |
|------|------|---------|
| 内存泄漏 | Old区持续增长 | MAT分析泄漏对象，修复代码 |
| 大对象直接进老年代 | 频繁Full GC | 调大新生代，避免大对象 |
| System.gc()调用 | 意外Full GC | -XX:+DisableExplicitGC |
| 元空间不足 | Full GC | -XX:MaxMetaspaceSize=256m |

**JVM参数配置示例：**

```bash
# 生产环境推荐配置 (8G堆内存)
java -Xms8g -Xmx8g \
     -XX:+UseG1GC \
     -XX:MaxGCPauseMillis=200 \
     -XX:G1HeapRegionSize=16m \
     -XX:InitiatingHeapOccupancyPercent=45 \
     -XX:+ExplicitGCInvokesConcurrent \
     -XX:+HeapDumpOnOutOfMemoryError \
     -XX:HeapDumpPath=/logs/heap.hprof \
     -Xlog:gc*:file=/logs/gc.log:time,uptime,level,tags \
     -jar app.jar
```

**G1 GC 调优要点：**

```
1. MaxGCPauseMillis: 目标暂停时间，默认200ms
2. G1HeapRegionSize: Region大小，1-32MB
3. InitiatingHeapOccupancyPercent: 触发并发GC的堆占用率
4. G1ReservePercent: 预留空间，默认10%

调优原则:
- 不要频繁调整，一次只改一个参数
- 先分析GC日志，再针对性优化
- 关注P99延迟而非平均延迟
```

---

## 三、多线程与并发编程

### 9. synchronized与Lock的区别

**真题来源：** 阿里、美团高频题

**答案要点：**

| 特性 | synchronized | Lock |
|------|-------------|------|
| **实现层级** | JVM层面 | API层面 |
| **锁获取/释放** | 自动 | 手动lock()/unlock() |
| **中断响应** | 不支持 | lockInterruptibly()支持 |
| **公平性** | 非公平 | 可配置公平/非公平 |
| **条件变量** | 单一条件 | 多个Condition |
| **性能** | 优化后接近Lock | 高竞争时更好 |

**使用建议：**
- 简单同步用 `synchronized`
- 需要高级特性用 `ReentrantLock`

**代码示例：**
```java
// synchronized
public synchronized void method() { }

// ReentrantLock
ReentrantLock lock = new ReentrantLock(true); // 公平锁
lock.lock();
try {
    // 临界区代码
} finally {
    lock.unlock();
}
```

---

### 10. 线程池原理与参数配置

**真题来源：** 阿里、字节、腾讯必考题

**答案要点：**

**线程池核心参数：**

| 参数 | 说明 |
|------|------|
| **corePoolSize** | 核心线程数 |
| **maximumPoolSize** | 最大线程数 |
| **keepAliveTime** | 非核心线程存活时间 |
| **unit** | 时间单位 |
| **workQueue** | 任务队列 |
| **threadFactory** | 线程工厂 |
| **handler** | 拒绝策略 |

**任务执行流程：**
```
提交任务
    ↓
核心线程数未满？ → 创建核心线程执行
    ↓ 是
加入任务队列
    ↓
队列已满？ → 创建非核心线程
    ↓ 是
达到最大线程数？ → 执行拒绝策略
```

**四种拒绝策略：**
1. `AbortPolicy`：抛异常（默认）
2. `CallerRunsPolicy`：调用者执行
3. `DiscardPolicy`：直接丢弃
4. `DiscardOldestPolicy`：丢弃最老任务

**线程池类型：**

| 类型 | 特点 | 适用场景 |
|------|------|---------|
| **FixedThreadPool** | 固定线程数 | 负载稳定 |
| **CachedThreadPool** | 按需创建，60s回收 | 短期大量任务 |
| **SingleThreadExecutor** | 单线程 | 顺序执行 |
| **ScheduledThreadPool** | 定时任务 | 定时调度 |

**参数配置建议：**
```java
// CPU密集型
int coreSize = Runtime.getRuntime().availableProcessors() + 1;

// IO密集型
int coreSize = Runtime.getRuntime().availableProcessors() * 2;

// 混合型
int coreSize = (int)(CPU核数 * (1 + 等待时间/计算时间))
```

---

### 11. CAS与原子类

**真题来源：** 字节、美团高频题

**答案要点：**

**CAS（Compare And Swap）：**
- 三个操作数：内存值V、预期值A、新值B
- 当V==A时，将V更新为B
- 通过CPU指令保证原子性

**ABA问题解决：**
```java
// 使用AtomicStampedReference
AtomicStampedReference<Integer> ref = new AtomicStampedReference<>(1, 0);
int stamp = ref.getStamp();
ref.compareAndSet(1, 2, stamp, stamp + 1);
```

**原子类分类：**

| 类型 | 示例 |
|------|------|
| 基本类型 | AtomicInteger, AtomicLong, AtomicBoolean |
| 数组类型 | AtomicIntegerArray, AtomicLongArray |
| 引用类型 | AtomicReference, AtomicStampedReference |
| 字段更新器 | AtomicIntegerFieldUpdater |
| 累加器 | LongAdder（高并发下比AtomicLong更优） |

---

### 12. ConcurrentHashMap实现原理

**真题来源：** 阿里、腾讯高频题

**答案要点：**

**JDK7实现（分段锁）：**
```java
// Segment数组，每个Segment是一个ReentrantLock
Segment<K,V>[] segments;
```

**JDK8实现（CAS+synchronized）：**
```java
// Node数组，锁粒度更细
transient volatile Node<K,V>[] table;

// put操作流程
final V putVal(K key, V value, boolean onlyIfAbsent) {
    // 1. 计算hash
    // 2. 空位置：CAS插入
    // 3. 已存在：synchronized锁头节点
    // 4. 链表转红黑树（长度≥8）
}
```

**对比HashMap：**
- 线程安全
- 不允许null键值
- 迭代器弱一致性

---

## 四、框架知识（Spring全家桶）

### 13. Spring IOC容器原理与Bean生命周期

**真题来源：** 阿里、字节、美团必考题

**答案要点：**

**Bean生命周期：**
```
实例化（Instantiation）
    ↓
属性赋值（Populate）
    ↓
初始化前（BeanPostProcessor.postProcessBeforeInitialization）
    ↓
初始化（InitializingBean.afterPropertiesSet、init-method）
    ↓
初始化后（BeanPostProcessor.postProcessAfterInitialization）
    ↓
使用（Bean Ready）
    ↓
销毁（DisposableBean.destroy、destroy-method）
```

**单例Bean的线程安全问题：**
- Bean默认单例
- 无状态Bean安全
- 有状态Bean需自行处理（ThreadLocal、原型模式）

---

### 14. Spring AOP实现原理

**真题来源：** 阿里、字节面试题

**答案要点：**

**两种实现方式：**

| 方式 | 原理 | 限制 |
|------|------|------|
| **JDK动态代理** | 基于接口，反射生成代理类 | 只能代理接口 |
| **CGLIB** | 继承目标类，重写方法 | 不能代理final类/方法 |

**核心概念：**

| 概念 | 说明 |
|------|------|
| **切面（Aspect）** | 横切关注点的模块化 |
| **连接点（JoinPoint）** | 程序执行的特定点 |
| **切点（Pointcut）** | 匹配连接点的表达式 |
| **通知（Advice）** | 切面在连接点执行的动作 |
| **引入（Introduction）** | 添加新方法/属性 |
| **目标对象（Target）** | 被通知的对象 |
| **代理（Proxy）** | AOP框架创建的对象 |
| **织入（Weaving）** | 将切面应用到目标对象 |

**通知类型：**
- `@Before`：前置通知
- `@AfterReturning`：返回通知
- `@AfterThrowing`：异常通知
- `@After`：后置通知
- `@Around`：环绕通知

---

### 15. Spring Boot自动配置原理

**真题来源：** 阿里、字节高频题

**答案要点：**

**核心注解：**
```java
@SpringBootApplication
├── @SpringBootConfiguration  // 配置类
├── @ComponentScan            // 组件扫描
└── @EnableAutoConfiguration  // 自动配置
```

**自动配置流程：**
```
1. @EnableAutoConfiguration
       ↓
2. @Import(AutoConfigurationImportSelector.class)
       ↓
3. 加载 META-INF/spring.factories
       ↓
4. 根据条件注解过滤配置类
       ↓
5. 注册Bean到容器
```

**条件注解：**

| 注解 | 条件 |
|------|------|
| @ConditionalOnClass | 类路径存在指定类 |
| @ConditionalOnMissingBean | 容器中不存在指定Bean |
| @ConditionalOnProperty | 配置属性满足条件 |
| @ConditionalOnWebApplication | Web应用环境 |

---

### 16. Spring事务传播机制

**真题来源：** 阿里、美团高频题

**答案要点：**

| 传播行为 | 说明 |
|---------|------|
| **REQUIRED**（默认） | 有事务就加入，没有就新建 |
| **REQUIRES_NEW** | 总是新建事务，暂停当前事务 |
| **SUPPORTS** | 有事务就加入，没有就非事务运行 |
| **NOT_SUPPORTED** | 非事务运行，暂停当前事务 |
| **MANDATORY** | 必须在事务中运行，否则抛异常 |
| **NEVER** | 必须非事务运行，否则抛异常 |
| **NESTED** | 嵌套事务（保存点机制） |

**事务失效场景：**
1. 方法非public
2. 同类方法调用（未走代理）
3. 异常被catch捕获
4. 抛出非RuntimeException
5. 数据库不支持事务

---

## 五、数据库相关

### 17. MySQL索引数据结构与优化

**真题来源：** 阿里、字节、美团必考题

**答案要点：**

**B+树特点：**
- 非叶子节点只存储索引值
- 叶子节点存储所有数据，用双向链表连接
- 高度低（通常3层），减少磁盘I/O
- 范围查询效率高

**索引类型：**

| 类型 | 说明 |
|------|------|
| **聚簇索引** | 主键索引，叶子节点存完整行数据 |
| **非聚簇索引** | 二级索引，叶子节点存主键值 |
| **联合索引** | 多列组合，遵循最左前缀原则 |
| **唯一索引** | 列值唯一，允许null |
| **全文索引** | 文本搜索 |

**索引优化原则：**
1. 最左前缀原则
2. 避免索引列计算/函数
3. 避免隐式类型转换
4. 覆盖索引减少回表
5. 适当使用索引下推

**Explain关键字段：**
- `type`：访问类型（const > ref > range > index > ALL）
- `key`：实际使用的索引
- `rows`：预估扫描行数
- `Extra`：Using index（覆盖索引）、Using filesort（文件排序）

---

### 18. MySQL事务隔离级别与锁机制

**真题来源：** 阿里、字节高频题

**答案要点：**

**四种隔离级别：**

| 隔离级别 | 脏读 | 不可重复读 | 幻读 | 实现方式 |
|---------|------|-----------|------|---------|
| **读未提交** | √ | √ | √ | - |
| **读已提交** | × | √ | √ | MVCC |
| **可重复读**（默认） | × | × | √ | MVCC+间隙锁 |
| **串行化** | × | × | × | 锁 |

**MVCC原理：**
- 版本链：每行数据有隐藏列（trx_id, roll_ptr）
- ReadView：活跃事务ID列表
- 快照读：读取历史版本

**锁类型：**

| 锁类型 | 说明 |
|--------|------|
| **共享锁（S）** | 读锁，允许多个读 |
| **排他锁（X）** | 写锁，独占 |
| **记录锁** | 锁单行记录 |
| **间隙锁** | 锁范围，防止幻读 |
| **临键锁** | 记录锁+间隙锁 |

---

### 19. SQL优化实战经验

**真题来源：** 各大厂高频题

**答案要点：**

**优化方向：**

| 层面 | 优化方法 |
|------|---------|
| **SQL层** | 避免SELECT *、合理使用索引、优化JOIN |
| **表结构层** | 选择合适数据类型、适度冗余、分表 |
| **架构层** | 读写分离、分库分表、缓存 |

**慢查询排查：**
```sql
-- 开启慢查询日志
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 2;

-- 查看执行计划
EXPLAIN SELECT * FROM orders WHERE user_id = 100;

-- 查看表状态
SHOW TABLE STATUS LIKE 'orders';
```

**分页优化：**
```sql
-- 传统分页（越往后越慢）
SELECT * FROM orders LIMIT 1000000, 10;

-- 优化方案1：覆盖索引
SELECT * FROM orders o 
JOIN (SELECT id FROM orders LIMIT 1000000, 10) t 
ON o.id = t.id;

-- 优化方案2：记录上次ID
SELECT * FROM orders WHERE id > 1000000 LIMIT 10;
```

---

## 六、分布式与微服务

### 20. CAP定理与BASE理论

**真题来源：** 阿里架构师、字节高频题

**答案要点：**

**CAP定理：**

| 特性 | 说明 |
|------|------|
| **Consistency（一致性）** | 所有节点数据一致 |
| **Availability（可用性）** | 每个请求都有响应 |
| **Partition Tolerance（分区容错）** | 网络分区时系统仍运行 |

**取舍：**
- **CA**：单机数据库（无分布式）
- **CP**：Redis、HBase、Zookeeper
- **AP**：Cassandra、DynamoDB、Eureka

**BASE理论：**
- **Basically Available**：基本可用
- **Soft State**：软状态
- **Eventually Consistent**：最终一致性

---

### 21. 分布式事务解决方案

**真题来源：** 阿里、字节架构师岗位

**答案要点：**

| 方案 | 原理 | 优点 | 缺点 | 适用场景 |
|------|------|------|------|---------|
| **2PC** | 两阶段提交 | 强一致 | 性能差、单点故障 | 传统分布式事务 |
| **TCC** | Try-Confirm-Cancel | 灵活 | 开发成本高 | 金融、支付 |
| **Saga** | 长事务拆分+补偿 | 高可用 | 无隔离性 | 长流程业务 |
| **本地消息表** | 消息持久化+定时任务 | 简单 | 耦合 | 简单场景 |
| **事务消息** | RocketMQ半消息 | 解耦 | 依赖MQ | 异步场景 |

**Seata AT模式：**
```java
@GlobalTransactional
public void placeOrder(Order order) {
    // 业务代码，自动回滚
    orderService.create(order);
    inventoryService.reduce(order.getItemId(), order.getCount());
}
```

---

### 22. 服务注册与发现

**真题来源：** 阿里、美团高频题

**答案要点：**

**主流注册中心对比：**

| 特性 | Eureka | Nacos | Consul | Zookeeper |
|------|--------|-------|--------|-----------|
| **CAP** | AP | AP/CP切换 | CP | CP |
| **健康检查** | 心跳 | 多种方式 | TCP/HTTP | 心跳 |
| **配置中心** | 需要 | 内置 | 支持 | 需要 |
| **社区活跃度** | 停止维护 | 活跃 | 活跃 | 活跃 |

**服务发现流程：**
```
服务启动 → 注册到注册中心 → 心跳续约
    ↓
调用方 → 从注册中心获取服务列表 → 负载均衡调用
    ↓
服务下线 → 主动注销或超时剔除
```

---

### 23. 分布式锁实现

**真题来源：** 阿里、字节高频题

**答案要点：**

**Redis实现：**
```java
// 加锁
SET lock_key unique_value NX PX 30000

// 解锁（Lua脚本保证原子性）
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
```

**Redisson实现：**
```java
RLock lock = redissonClient.getLock("myLock");
lock.lock(30, TimeUnit.SECONDS);
try {
    // 业务代码
} finally {
    lock.unlock();
}
```

**对比：**

| 方案 | 优点 | 缺点 |
|------|------|------|
| **Redis** | 高性能 | 需要处理锁续期 |
| **Zookeeper** | 强一致 | 性能较低 |
| **数据库** | 简单 | 性能差 |

---

### 24. 消息队列核心问题

**真题来源：** 阿里、字节、美团高频题

**答案要点：**

**三大核心问题：**

| 问题 | 解决方案 |
|------|---------|
| **消息丢失** | 生产者确认、持久化、消费者手动ACK |
| **消息重复** | 幂等性设计（唯一ID、去重表） |
| **消息顺序** | 单队列单消费者、Sharding Key |

**RocketMQ事务消息：**
```
1. 发送半消息（不可消费）
2. 执行本地事务
3. 提交/回滚消息
4. 回查机制（事务状态未知时）
```

**幂等性设计：**
```java
// 唯一ID + Redis
public boolean process(String messageId) {
    if (redis.setnx(messageId, "1", 24h) == 0) {
        return false; // 已处理
    }
    // 业务处理
}
```

---

## 七、系统设计

### 25. 缓存三大问题及解决方案

**真题来源：** 阿里、字节、美团必考题

**答案要点：**

| 问题 | 描述 | 解决方案 |
|------|------|---------|
| **缓存穿透** | 查询不存在的数据，绕过缓存直达DB | 布隆过滤器、缓存空对象 |
| **缓存击穿** | 热点Key过期瞬间大量请求 | 热点数据永不过期、互斥锁 |
| **缓存雪崩** | 大量Key同时过期 | 随机过期时间、多级缓存 |

**布隆过滤器：**
```java
// Guava实现
BloomFilter<String> filter = BloomFilter.create(
    Funnels.stringFunnel(Charsets.UTF_8), 
    1000000,  // 预期元素数量
    0.001     // 误判率
);
filter.put("key");
boolean exists = filter.mightContain("key");
```

**缓存与数据库一致性：**
- **延迟双删**：先删缓存 → 更新DB → 延迟删缓存
- **Canal**：监听MySQL binlog异步更新缓存

---

### 26. 高并发系统设计

**真题来源：** 阿里架构师、字节高频题

**答案要点：**

**设计原则：**
```
请求链路：用户 → CDN → 负载均衡 → 网关 → 服务 → 缓存 → MQ → DB
```

**各层优化：**

| 层级 | 手段 |
|------|------|
| **接入层** | CDN、DNS轮询、LVS |
| **网关层** | 限流、熔断、降级 |
| **服务层** | 异步处理、服务拆分 |
| **缓存层** | 多级缓存、预热 |
| **数据层** | 读写分离、分库分表 |

**限流算法：**

| 算法 | 说明 |
|------|------|
| **固定窗口** | 简单，但临界突发 |
| **滑动窗口** | 平滑，但内存占用高 |
| **令牌桶** | 允许突发，主流方案 |
| **漏桶** | 恒定速率 |

**Sentinel限流：**
```java
// 定义规则
FlowRule rule = new FlowRule();
rule.setResource("resourceName");
rule.setGrade(RuleConstant.FLOW_GRADE_QPS);
rule.setCount(100);
FlowRuleManager.loadRules(Collections.singletonList(rule));

// 使用
Entry entry = SphU.entry("resourceName");
try {
    // 业务代码
} finally {
    entry.exit();
}
```

---

### 27. 秒杀系统设计

**真题来源：** 阿里、字节高频题

**答案要点：**

**核心挑战：**
- 高并发流量
- 库存一致性
- 防止超卖
- 黄牛恶意请求

**架构设计：**
```
前端 → CDN静态化 → 限流排队 → 缓存预热 → Redis扣库存 → MQ异步下单 → DB
```

**关键实现：**

```java
// Redis预扣库存（Lua脚本）
String script = """
    if redis.call('get', KEYS[1]) <= 0 then
        return 0
    end
    return redis.call('decr', KEYS[1])
    """;

// 防超卖
if (redisScript.execute(KEYS, ARGS) > 0) {
    // 发送MQ异步创建订单
    mqTemplate.send("order-topic", orderId);
}

// 用户去重
Boolean acquired = redis.setnx("seckill:" + userId + ":" + itemId, "1", "1h");
if (!acquired) {
    throw new RuntimeException("请勿重复下单");
}
```

---

**完整实现参考（Redis Lua + MQ 异步下单）：**

```java
// Redis Lua脚本 - 原子扣减库存
String luaScript = """
    local stock = redis.call('GET', KEYS[1])
    if not stock then
        return -1
    end
    if tonumber(stock) <= 0 then
        return 0
    end
    redis.call('DECR', KEYS[1])
    return 1
    """;

// 秒杀接口
@PostMapping("/seckill")
public Result seckill(@RequestParam Long userId, @RequestParam Long itemId) {
    // 1. 检查用户是否已购买
    if (redis.sismember("seckill:users:" + itemId, userId.toString())) {
        return Result.fail("已购买过");
    }
    
    // 2. 预扣减库存
    Long stock = redis.execute(luaScript, 
        Collections.singletonList("seckill:stock:" + itemId), 
        Collections.emptyList());
    
    if (stock == 0) {
        return Result.fail("库存不足");
    }
    
    // 3. 记录购买用户
    redis.sadd("seckill:users:" + itemId, userId.toString());
    
    // 4. 发送MQ异步下单
    SeckillMessage message = new SeckillMessage(userId, itemId);
    kafkaTemplate.send("seckill-order", message);
    
    return Result.success("下单成功，请等待处理");
}

// MQ消费者 - 异步创建订单
@KafkaListener(topics = "seckill-order")
public void createOrder(SeckillMessage message) {
    try {
        // 创建订单
        Order order = orderService.createOrder(message);
        // 扣减真实库存
        inventoryService.deductStock(message.getItemId(), 1);
        // 发送通知
        notificationService.notify(message.getUserId(), "秒杀成功");
    } catch (Exception e) {
        // 失败补偿：恢复库存
        redis.incr("seckill:stock:" + message.getItemId());
        redis.srem("seckill:users:" + message.getItemId(), 
                   message.getUserId().toString());
    }
}
```

## 八、数据结构与算法

### 28. 红黑树特性与Java中的应用

**真题来源：** 字节、阿里高频题

**答案要点：**

**红黑树特性：**
1. 节点是红色或黑色
2. 根节点是黑色
3. 叶子节点（NIL）是黑色
4. 红色节点的子节点必须是黑色
5. 从任一节点到叶子节点的路径包含相同数量的黑色节点

**时间复杂度：**
- 查找、插入、删除：O(log n)

**Java中的应用：**
- `TreeMap`
- `TreeSet`
- `HashMap`（链表转红黑树）
- `ConcurrentSkipListMap`

---

### 29. 布隆过滤器原理

**真题来源：** 字节、美团高频题

**答案要点：**

**原理：**
- 使用多个哈希函数
- 将元素映射到位数组
- 判断存在时检查所有位置是否为1

**特点：**
- 判断**可能存在**：可能误判（假阳性）
- 判断**一定不存在**：准确
- **不能删除**（除非使用计数布隆过滤器）

**应用场景：**
- 缓存穿透防护
- 垃圾邮件过滤
- 推荐系统去重

---

### 30. 常见排序算法对比

**真题来源：** 各大厂基础题

**答案要点：**

| 算法 | 平均时间 | 最坏时间 | 空间 | 稳定性 |
|------|---------|---------|------|--------|
| **快速排序** | O(nlogn) | O(n²) | O(logn) | 不稳定 |
| **归并排序** | O(nlogn) | O(nlogn) | O(n) | 稳定 |
| **堆排序** | O(nlogn) | O(nlogn) | O(1) | 不稳定 |
| **冒泡排序** | O(n²) | O(n²) | O(1) | 稳定 |
| **插入排序** | O(n²) | O(n²) | O(1) | 稳定 |

---

## 九、设计模式

### 31. 单例模式的多种实现

**真题来源：** 各大厂高频题

**答案要点：**

**饿汉式：**
```java
public class Singleton {
    private static final Singleton INSTANCE = new Singleton();
    
    private Singleton() {}
    
    public static Singleton getInstance() {
        return INSTANCE;
    }
}
```

**双重检查锁：**
```java
public class Singleton {
    private static volatile Singleton instance;
    
    private Singleton() {}
    
    public static Singleton getInstance() {
        if (instance == null) {
            synchronized (Singleton.class) {
                if (instance == null) {
                    instance = new Singleton();
                }
            }
        }
        return instance;
    }
}
```

**静态内部类：**
```java
public class Singleton {
    private Singleton() {}
    
    private static class Holder {
        static final Singleton INSTANCE = new Singleton();
    }
    
    public static Singleton getInstance() {
        return Holder.INSTANCE;
    }
}
```

**枚举（最佳实践）：**
```java
public enum Singleton {
    INSTANCE;
    
    public void doSomething() { }
}
```

---

### 32. 代理模式与装饰器模式的区别

**真题来源：** 阿里、字节面试题

**答案要点：**

| 特性 | 代理模式 | 装饰器模式 |
|------|---------|-----------|
| **目的** | 控制访问 | 增强功能 |
| **关系** | 代理类创建对象 | 装饰器接收已有对象 |
| **功能** | 可能限制功能 | 只增强不减少 |
| **应用** | AOP、RPC | IO流、JScrollPane |

---

## 十、网络通信

### 33. TCP三次握手与四次挥手

**真题来源：** 阿里、字节高频题

**答案要点：**

**三次握手：**
```
客户端                服务端
  |  ──── SYN ────→  |  (客户端：SYN_SENT)
  |  ←── SYN+ACK ──  |  (服务端：SYN_RCVD)
  |  ──── ACK ────→  |  (双方：ESTABLISHED)
```

**为什么是三次？**
- 防止历史连接
- 同步双方序列号

**四次挥手：**
```
客户端                服务端
  |  ──── FIN ────→  |  (客户端：FIN_WAIT_1)
  |  ←─── ACK ────   |  (客户端：FIN_WAIT_2，服务端：CLOSE_WAIT)
  |  ←─── FIN ────   |  (服务端：LAST_ACK)
  |  ──── ACK ────→  |  (客户端：TIME_WAIT → CLOSED)
```

**TIME_WAIT状态：**
- 持续2MSL
- 确保ACK到达
- 防止旧包干扰

---

### 34. HTTP与HTTPS的区别

**真题来源：** 各大厂基础题

**答案要点：**

| 特性 | HTTP | HTTPS |
|------|------|-------|
| **端口** | 80 | 443 |
| **加密** | 无 | SSL/TLS |
| **证书** | 不需要 | 需要CA证书 |
| **安全性** | 明文传输 | 加密传输 |

**HTTPS握手流程：**
1. 客户端发起请求
2. 服务端返回证书（含公钥）
3. 客户端验证证书
4. 客户端生成对称密钥，用公钥加密发送
5. 服务端用私钥解密获取对称密钥
6. 后续用对称密钥加密通信

---

## 十一、云原生与新技术

### 35. Docker与Kubernetes核心概念

**真题来源：** 阿里、字节高频题

**答案要点：**

**Docker核心概念：**

| 概念 | 说明 |
|------|------|
| **镜像（Image）** | 只读模板 |
| **容器（Container）** | 镜像的运行实例 |
| **仓库（Registry）** | 镜像存储 |

**Kubernetes核心概念：**

| 概念 | 说明 |
|------|------|
| **Pod** | 最小部署单元 |
| **Service** | 服务发现与负载均衡 |
| **Deployment** | 声明式部署 |
| **ConfigMap/Secret** | 配置管理 |
| **Namespace** | 资源隔离 |

---

### 36. Java新特性（JDK17/21）

**真题来源：** 阿里、字节技术前沿题

**答案要点：**

**JDK17 LTS新特性：**
- Sealed Classes（密封类）
- Pattern Matching for switch
- Records（正式版）
- Text Blocks（正式版）

**JDK21 LTS新特性：**
- **Virtual Threads（虚拟线程）**
```java
Thread.ofVirtual().start(() -> {
    // 轻量级线程，高并发场景
});
```
- **Sequenced Collections**
- **Record Patterns**
- **Switch Pattern Matching**

---

## 十二、大模型应用开发

> 合并自《02_高级Java开发全栈面试真题》——AI 应用开发岗位差异化考点。

### 41. LangChain Java 开发实战

**标准答案：**

**LangChain4j 核心组件：**

```java
// 1. 模型配置
ChatLanguageModel model = OpenAiChatModel.builder()
    .apiKey("your-api-key")
    .modelName("gpt-4o")
    .temperature(0.7)
    .maxTokens(1024)
    .build();

// 2. Prompt模板
PromptTemplate template = PromptTemplate.from(
    "根据以下上下文回答问题:\n" +
    "{{context}}\n\n" +
    "问题: {{question}}\n" +
    "答案:"
);

Map<String, Object> variables = Map.of(
    "context", context,
    "question", question
);
Prompt prompt = template.apply(variables);

// 3. RAG实现
EmbeddingModel embeddingModel = OpenAiEmbeddingModel.builder()
    .apiKey("your-api-key")
    .build();

EmbeddingStore<TextSegment> embeddingStore = new InMemoryEmbeddingStore<>();

// 索引文档
String text = "文档内容...";
TextSegment segment = TextSegment.from(text);
Embedding embedding = embeddingModel.embed(segment).content();
embeddingStore.add(embedding, segment);

// 检索
Embedding queryEmbedding = embeddingModel.embed(question).content();
List<EmbeddingMatch<TextSegment>> matches = embeddingStore.findRelevant(
    queryEmbedding, 
    5  // top-k
);

// 4. 构建RAG Chain
String context = matches.stream()
    .map(m -> m.embedded().text())
    .collect(Collectors.joining("\n\n"));

String response = model.generate(prompt.text());
```

**与Spring Boot集成：**

```java
@Configuration
public class LangChainConfig {
    
    @Bean
    public ChatLanguageModel chatModel() {
        return OpenAiChatModel.builder()
            .apiKey("${openai.api-key}")
            .modelName("gpt-4o")
            .build();
    }
    
    @Bean
    public EmbeddingModel embeddingModel() {
        return OpenAiEmbeddingModel.builder()
            .apiKey("${openai.api-key}")
            .build();
    }
    
    @Bean
    public EmbeddingStore<TextSegment> embeddingStore() {
        // 使用Milvus
        return MilvusEmbeddingStore.builder()
            .host("localhost")
            .port(19530)
            .collectionName("documents")
            .build();
    }
}

@Service
public class RAGService {
    
    private final ChatLanguageModel chatModel;
    private final EmbeddingModel embeddingModel;
    private final EmbeddingStore<TextSegment> embeddingStore;
    
    public String chat(String question) {
        // 1. Embedding查询
        Embedding queryEmbedding = embeddingModel.embed(question).content();
        
        // 2. 检索相关文档
        List<EmbeddingMatch<TextSegment>> matches = 
            embeddingStore.findRelevant(queryEmbedding, 5);
        
        // 3. 构建上下文
        String context = matches.stream()
            .map(m -> m.embedded().text())
            .collect(Collectors.joining("\n\n"));
        
        // 4. 生成答案
        String prompt = String.format(
            "上下文:\n%s\n\n问题: %s\n答案:", 
            context, question
        );
        
        return chatModel.generate(prompt);
    }
}
```

---

### 42. 向量数据库集成

**标准答案：**

**Milvus Java SDK 集成：**

```java
// 1. 依赖
// implementation 'io.milvus:milvus-sdk-java:2.3.4'

// 2. 连接配置
MilvusServiceClient milvusClient = new MilvusServiceClient(
    ConnectParam.newBuilder()
        .withHost("localhost")
        .withPort(19530)
        .build()
);

// 3. 创建Collection
String collectionName = "documents";
FieldType idField = FieldType.newBuilder()
    .withName("id")
    .withDataType(DataType.Int64)
    .withPrimaryKey(true)
    .withAutoID(true)
    .build();

FieldType embeddingField = FieldType.newBuilder()
    .withName("embedding")
    .withDataType(DataType.FloatVector)
    .withDimension(1024)  // BGE-M3向量维度
    .build();

FieldType contentField = FieldType.newBuilder()
    .withName("content")
    .withDataType(DataType.VarChar)
    .withMaxLength(65535)
    .build();

CreateCollectionParam createParam = CreateCollectionParam.newBuilder()
    .withCollectionName(collectionName)
    .withDescription("Document embeddings")
    .withShardsNum(2)
    .addFieldType(idField)
    .addFieldType(embeddingField)
    .addFieldType(contentField)
    .build();

milvusClient.createCollection(createParam);

// 4. 创建索引
CreateIndexParam indexParam = CreateIndexParam.newBuilder()
    .withCollectionName(collectionName)
    .withFieldName("embedding")
    .withIndexType(IndexType.HNSW)
    .withMetricType(MetricType.COSINE)
    .withExtraParam("{\"M\": 16, \"efConstruction\": 200}")
    .build();

milvusClient.createIndex(indexParam);

// 5. 插入数据
List<List<Float>> embeddings = Arrays.asList(embedding1, embedding2);
List<String> contents = Arrays.asList(content1, content2);

InsertParam insertParam = InsertParam.newBuilder()
    .withCollectionName(collectionName)
    .addField(Field.newBuilder()
        .withName("embedding")
        .withFloatVectors(embeddings)
        .build())
    .addField(Field.newBuilder()
        .withName("content")
        .withStrings(contents)
        .build())
    .build();

milvusClient.insert(insertParam);

// 6. 搜索
SearchParam searchParam = SearchParam.newBuilder()
    .withCollectionName(collectionName)
    .withMetricType(MetricType.COSINE)
    .withTopK(10)
    .withVectors(queryEmbedding)
    .withVectorFieldName("embedding")
    .withOutFields(Arrays.asList("content"))
    .withParams("{\"ef\": 100}")
    .build();

R<SearchResults> results = milvusClient.search(searchParam);
```

---

### 43. 异步调用与流式响应

**标准答案：**

**Spring WebFlux 流式响应：**

```java
@RestController
public class ChatController {
    
    private final ChatLanguageModel chatModel;
    
    // 同步调用
    @PostMapping("/chat")
    public String chat(@RequestBody ChatRequest request) {
        return chatModel.generate(request.getMessage());
    }
    
    // 流式响应 (SSE)
    @GetMapping(value = "/chat/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<String> chatStream(@RequestParam String message) {
        return chatModel.generateStream(message);
    }
    
    // 使用WebFlux
    @PostMapping("/chat/webflux")
    public Mono<String> chatWebFlux(@RequestBody Mono<ChatRequest> request) {
        return request
            .map(ChatRequest::getMessage)
            .flatMap(msg -> Mono.fromCallable(() -> chatModel.generate(msg)))
            .subscribeOn(Schedulers.boundedElastic());
    }
}
```

**LangChain4j 流式调用：**

```java
// 流式模型配置
StreamingChatLanguageModel streamingModel = OpenAiStreamingChatModel.builder()
    .apiKey("your-api-key")
    .modelName("gpt-4o")
    .build();

// 流式调用
@PostMapping(value = "/chat/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public Flux<String> streamChat(@RequestBody ChatRequest request) {
    return Flux.create(emitter -> {
        streamingModel.generate(request.getMessage(), new StreamingResponseHandler<>() {
            @Override
            public void onNext(String token) {
                emitter.next(token);
            }
            
            @Override
            public void onComplete(Response<AiMessage> response) {
                emitter.complete();
            }
            
            @Override
            public void onError(Throwable error) {
                emitter.error(error);
            }
        });
    });
}
```

---

## 十三、行为与经验题

### 37. 线上故障排查经验

**真题来源：** 阿里P7+、字节架构师

**答案要点：**

**排查流程：**
```
监控报警 → 确定影响范围 → 快速止损 → 定位原因 → 修复上线 → 复盘总结
```

**常见问题与工具：**

| 问题 | 排查工具 |
|------|---------|
| CPU飙高 | top、jstack、Arthas |
| 内存溢出 | jmap、MAT |
| 线程死锁 | jstack、Arthas |
| 响应慢 | Arthas trace、Skywalking |
| 网络问题 | tcpdump、netstat |

**止损策略：**
- 快速回滚
- 限流降级
- 扩容

---

### 38. 项目难点与挑战

**真题来源：** 所有大厂必考题

**答题框架（STAR法则）：**

| 要素 | 说明 |
|------|------|
| **S（情境）** | 项目背景、遇到的问题 |
| **T（任务）** | 目标是什么 |
| **A（行动）** | 具体做了什么（技术选型、方案设计、代码实现） |
| **R（结果）** | 取得的成果（量化指标） |

**示例：**
> 在电商项目中，我们遇到了秒杀场景下的超卖问题。通过Redis Lua脚本实现原子扣减库存、消息队列异步创建订单，最终QPS从1000提升到50000，超卖率降为0。

---

### 39. 架构设计原则与经验

**真题来源：** 阿里架构师、技术专家

**答案要点：**

**SOLID原则：**

| 原则 | 说明 |
|------|------|
| **S**ingle Responsibility | 单一职责 |
| **O**pen/Closed | 开闭原则 |
| **L**iskov Substitution | 里氏替换 |
| **I**nterface Segregation | 接口隔离 |
| **D**ependency Inversion | 依赖倒置 |

**高可用设计：**
- 无单点（集群化）
- 故障隔离（舱壁模式）
- 快速失败（熔断）
- 降级保核心

**高并发设计：**
- 削峰填谷
- 异步解耦
- 缓存加速
- 分片扩容

---

### 40. 团队协作与冲突解决

**真题来源：** 高级职位必考题

**答案要点：**

**冲突处理方式：**
1. **倾听理解**：了解各方立场和诉求
2. **数据分析**：用事实说话，技术选型可做PoC
3. **求同存异**：聚焦共同目标
4. **达成共识**：明确决策依据和后续行动

**沟通技巧：**
- 定期同步会议
- 清晰的文档
- 明确的责任分工
- 及时的风险预警

---

## 附录：面试准备清单

### 技术能力自查表

| 领域 | 知识点 | 掌握程度 |
|------|--------|---------|
| Java基础 | 集合、异常、反射、泛型 | □ |
| JVM | 内存模型、GC、调优 | □ |
| 并发 | 线程池、锁、CAS、JMM | □ |
| Spring | IOC、AOP、事务、Boot | □ |
| 数据库 | 索引、事务、锁、优化 | □ |
| 分布式 | CAP、分布式锁、事务 | □ |
| 微服务 | 注册中心、配置中心、网关 | □ |
| 消息队列 | 可靠性、顺序、幂等 | □ |
| 缓存 | Redis、三大问题 | □ |
| 网络 | TCP/IP、HTTP、HTTPS | □ |
| 设计模式 | 单例、工厂、代理、策略 | □ |
| 架构设计 | 高可用、高并发、可扩展 | □ |

### 项目准备要点

1. **项目背景**：业务价值、团队规模
2. **技术选型**：为什么用这个技术
3. **核心难点**：遇到的最大挑战
4. **解决方案**：具体做了什么
5. **量化成果**：性能提升多少、解决了什么问题

---

## 参考资料

1. 《Effective Java》
2. 《Java并发编程实战》
3. 《深入理解Java虚拟机》
4. 《凤凰架构》
5. 阿里巴巴Java开发手册
6. 各大厂技术博客

---

> **声明**：本面试题合集整理自公开资料，仅供学习参考。面试题目会随技术发展更新，建议结合实际项目经验深入理解每个知识点。

**祝面试顺利！** 🎯
