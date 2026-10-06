# Java 深度八股文 · 考前背诵版

> 全栈架构师 · 一问一答直接背
> 与《Java 面试题深度整理》互补：那份题库负责"讲透原理"，这份八股文负责"张口就来"。每题给出**一句话标准答案 + 关键点 + 记忆口诀**，覆盖 11 大板块 80 题。标注【高频】的必背。

---

## 01 JVM 内存区域与对象（8 题）

### Q01 JVM 运行时内存区域如何划分？JDK8 有哪些变化？【高频】
**答**：线程私有 3 块（程序计数器、虚拟机栈、本地方法栈）+ 线程共享 2 块（堆、方法区）。JDK8 起方法区改为**元空间 Metaspace**，移出堆、用本地内存。
- **程序计数器**：唯一不会 OOM 的区域，记录字节码行号。
- **虚拟机栈**：栈帧 = 局部变量表 + 操作数栈 + 动态链接 + 返回地址；栈深超限抛 `StackOverflowError`，扩展失败抛 OOM。
- **堆**：GC 主战场，新生代（Eden + 2×Survivor）+ 老年代。
- **元空间**：类元数据存本地内存（默认无上限）；字符串常量池、静态变量仍在堆（JDK7 起静态变量已移入堆）。
> **口诀**：私有 3 件套（计数/栈/本地），共享 2 件套（堆/方法区）；JDK8 永久代换元空间，解决永久代 OOM。

### Q02 新生代与老年代如何划分？对象如何晋升？【基础】
**答**：新生代 = Eden + S0 + S1（默认 **8:1:1**），老年代存长命对象。
- 对象优先在 Eden 分配；Minor GC 后幸存对象在 S0/S1 间复制，默认 15 次（`-XX:MaxTenuringThreshold`）后晋升老年代。
- 大对象直接进老年代（`-XX:PretenureSizeThreshold`）。
- **动态年龄判定**：Survivor 中同年龄对象总和 > Survivor 一半，则 ≥ 该年龄的对象直接晋升。
> **口诀**：Eden 生、Survivor 倒、15 次或过半就进老；8:1:1 只浪费 10%（复制算法只需一块 Survivor 空着）。

### Q03 对象创建过程？【高频】
**答**：类加载检查 → 分配内存 → 初始化零值 → 设置对象头 → 执行构造方法。
1. **类加载检查**：常量池能否定位到类符号引用，未加载先加载。
2. **分配内存**：指针碰撞（堆规整）/ 空闲列表（不规整）；TLAB 优先，失败 CAS 加锁。
3. **初始化零值**：字段置 0/null/false。
4. **设置对象头**：Mark Word、类型指针、hashCode、分代年龄、锁标志。
5. **执行 `<init>`**：真正按程序员意图初始化。
> **口诀**：查→分→零→头→构；DCL 要 volatile 就是因为 5 步可能重排。

### Q04 对象内存布局？为什么要求 8 字节对齐？【进阶】
**答**：对象头 + 实例数据 + 对齐填充。
- **对象头**：① Mark Word（64 位 8 字节：hashCode/分代年龄/锁标志/偏向线程 ID）；② 类型指针（压缩后 4 字节）；③ 数组长度（仅数组）。
- **实例数据**：字段值，相同宽度字段重排减少填充。
- **对齐填充**：对象大小必须 8 字节整数倍。
> **口诀**：头(8+4) + 数据 + 补齐；8 对齐 = CPU 高效访问 + 分配管理。

### Q05 对象访问定位：句柄 vs 直接指针？【基础】
**答**：HotSpot 用**直接指针**（reference 直接指向对象），少一次定位、更快；句柄方式 GC 移动对象只需改句柄、稳定。
- 直接指针：对象头类型指针指向方法区类信息。
> **口诀**：HotSpot 要速度选指针，GC 移动由 GC 自己更新引用。

### Q06 栈帧包含哪些结构？【基础】
**答**：局部变量表（Slot 复用，long/double 占 2 Slot）、操作数栈（字节码工作区）、动态链接（符号引用→直接引用）、返回地址。`-Xss` 控制栈大小。
> **口诀**：表、栈、链、址四件套。

### Q07 常见 OOM 类型与排查流程？【高频】
**答**：StackOverflowError（栈深）、Java heap space（堆满）、GC overhead limit exceeded（98% 时间 GC 且回收 <2%）、Metaspace（动态生成类过多）、Direct buffer memory（堆外泄漏）。
- 排查：`jps` 找进程 → `jmap -dump` 导出堆 → MAT/JProfiler 分析 Dominator Tree 找大对象与 GC Roots 引用链。
> **口诀**：栈、堆、GC 效率、元空间、Direct 五类；生产加 `-XX:+HeapDumpOnOutOfMemoryError` 自动落盘。

### Q08 逃逸分析、标量替换、锁消除是什么？【进阶】
**答**：分析对象是否逃逸出方法/线程，不逃逸则可优化。
- **标量替换**：对象拆成标量字段直接放栈（HotSpot 借此实现"栈上分配"）。
- **锁消除**：无竞争的 synchronized 直接去掉。
- `-XX:+DoEscapeAnalysis` 默认开启（Server 模式）。
> **口诀**：不逃逸 → 拆开放栈（标量替换）+ 去掉锁（锁消除），减少 GC 压力。

---

## 02 类加载机制（5 题）

### Q09 类加载过程分几步？【高频】
**答**：加载 → 验证 → 准备 → 解析 → 初始化。
- **加载**：全限定名取字节流 → 转方法区数据结构 → 生成 Class 对象。
- **验证**：文件格式、字节码语义、符号引用验证（防恶意字节码）。
- **准备**：静态变量分配内存并设**零值**（`static int a = 1` 此时 a=0）。
- **解析**：符号引用 → 直接引用。
- **初始化**：执行 `<clinit>`（静态赋值 + 静态代码块），JVM 加锁保证只执行一次。
> **口诀**：加验准解初；"准备"只给零值，真值在"初始化"。

### Q10 类初始化触发时机？哪些是"被动引用"不触发？【高频】
**答**：**主动引用 6 种**：new/getstatic/putstatic/invokestatic、反射、初始化子类先初始化父类、main 入口类、JDK7 动态语言、MethodHandle。
- **被动引用不触发**：① 引用父类静态字段只初始化父类；② `loadClass` 不初始化（`forName` 会）；③ `new SubClass[10]` 数组不触发；④ `static final` 编译期常量不触发。
> **口诀**：主动 = new/静态/反射/父子/main；被动 = 父静态、loadClass、数组、编译期常量。

### Q11 双亲委派模型是什么？为什么这样设计？【高频】
**答**：加载请求先委托给父加载器，父加载不了才自己加载。层级：Bootstrap → Extension（JDK9 起 Platform）→ Application → 自定义。
- **好处**：① 避免类重复加载；② 核心类安全（自定义 `java.lang.String` 永远不会被用到）。
> **口诀**：向上委派、向下兜底；重写 `findClass` 而非 `loadClass`。

### Q12 什么场景要打破双亲委派？【进阶】
**答**：JDBC SPI、Tomcat、OSGi、热部署。
- **JDBC SPI**：`DriverManager` 由 Bootstrap 加载，但实现类在 classpath → 用**线程上下文类加载器**反向加载。
- **Tomcat**：每个 WebApp 隔离加载自己的类，"先自己加载、不行再委派"。
> **口诀**：SPI 是官方对双亲委派的突破；打破方式 = 上下文类加载器 / 重写 loadClass。

### Q13 自定义类加载器与热部署原理？【进阶】
**答**：继承 ClassLoader 重写 `findClass`：读字节码 → `defineClass` → 返回 Class。
- **热部署**：换**新的类加载器**加载新版本，旧类可卸载（无引用 + 类加载器可回收）。
> **口诀**：同名不同加载器 = 两个类，`instanceof` 可能失效，强转抛 ClassCastException。

---

## 03 垃圾回收（8 题）

### Q14 如何判断对象存活？GC Roots 有哪些？【高频】
**答**：JVM 用**可达性分析**（引用计数有循环引用缺陷被弃用）。GC Roots：
1. 虚拟机栈引用的对象（局部变量、参数）。
2. 方法区静态属性引用的对象。
3. 方法区常量引用的对象（字符串常量池）。
4. 本地方法栈 JNI 引用的对象。
5. synchronized 锁住的对象、JVM 内部引用（Class、系统类加载器）。
> **口诀**：栈引用、静态、常量、JNI、锁对象；finalize 只有一次自救机会且不保证执行，永远别用。

### Q15 四种引用类型及场景？【高频】
**答**：强（永不回收）→ 软（内存不足回收）→ 弱（下次 GC 必回收）→ 虚（随时回收，须配引用队列）。
- **软引用**：内存敏感缓存（图片缓存）。
- **弱引用**：ThreadLocal 的 key、WeakHashMap。
- **虚引用**：堆外内存/DirectByteBuffer 回收跟踪（NIO Cleaner）。
> **口诀**：强不软、软救急、弱即死、虚管堆外；回收后进 ReferenceQueue 可做回调。

### Q16 三大 GC 算法对比？【高频】
**答**：标记-清除（有碎片）、复制（无碎片但浪费空间）、标记-整理（无碎片但 STW 移动对象）。
- **分代收集**：新生代朝生夕死 → 复制；老年代存活率高 → 标记-清除/整理。
> **口诀**：新生代复制、老年代整理；复制算法用 Eden 8:1:1 化解浪费。

### Q17 垃圾收集器演进路线？【高频】
**答**：Serial（单线程）→ Parallel（JDK8 默认，追求吞吐）→ CMS（低停顿，JDK9 弃用/JDK14 移除）→ G1（JDK9+ 默认，Region 化可预测停顿）→ ZGC/Shenandoah（亚毫秒）。
- CMS 4 阶段：初始标记(STW) → 并发标记 → 重新标记(STW) → 并发清除；缺陷：浮动垃圾 + 碎片 + 并发失败退化 Serial Old。
> **口诀**：串→并→CMS→G1→ZGC；CMS 与 G1 都追求低停顿，G1 用 Region 化解碎片。

### Q18 G1 收集器原理？【高频】
**答**：堆划为约 2048 个 Region，逻辑分代（Eden/Survivor/Old/Humongous）；跨 Region 引用用 **RSet** 记录，避免全堆扫描。
- **三色标记**：白（未访问）→ 灰（引用未扫完）→ 黑（引用扫完）。
- **SATB**：并发标记记录起始快照，防漏标。
- **Mixed GC**：新生代 + 部分老年代，`-XX:MaxGCPauseMillis`(默认 200ms) 控停顿。
> **口诀**：Region + RSet + SATB + Mixed；写屏障维护 RSet 与 SATB。

### Q19 ZGC 为什么能做到亚毫秒停顿？【进阶】
**答**：**染色指针**（64 位指针高 4 位存状态：Finalizable/Remapped/Marked0/Marked1）+ **读屏障**实现并发移动对象。
- 停顿不再随堆大小增长；JDK21 起多代 ZGC 默认开启。
> **口诀**：状态写进指针里（染色），读时发现不对就转发修复（读屏障）；"并发搬家公司"。

### Q20 三色标记漏标问题如何解决？【进阶】
**答**：漏标条件 = 黑色对象新引用白色对象 + 灰色对象不再引用它。
- **CMS 增量更新**：黑对象引用白对象时把黑对象标灰，重新标记再扫。
- **G1 SATB**：记录起始快照，把被删引用对象的快照保留为灰。
> **口诀**：增量更新多标（浮动垃圾）、SATB 也多标但防漏；漏标 = 该回收的没回收，比多标危险。

### Q21 安全点/安全区域是什么？调优常用参数？【高频】
**答**：**安全点**：GC 只能在所有线程到达安全点时暂停（方法调用、循环回跳、异常抛出）；**安全区域**：Sleep/Blocked 线程引用关系不变，GC 无需等待。
- 常用参数：`-Xms -Xmx`（建议相等）、`-Xmn`、`-XX:SurvivorRatio=8`、`-XX:+UseG1GC`、`-XX:MaxGCPauseMillis=200`、`-XX:+HeapDumpOnOutOfMemoryError`。
- 工具：jps/jstat/jmap/jstack/jinfo/Arthas。
> **口诀**：调优 = 定目标（吞吐 or 延迟）→ 看 GC 日志 → 找停顿来源 → 单变量验证。

---

## 04 Java 基础与字符串（8 题）

### Q22 String 为什么不可变？好处？【高频】
**答**：`final class` + `private final byte[] value`（JDK9 起）+ 不暴露修改方法。
- **好处**：① 常量池复用省内存；② 线程安全；③ hashCode 可缓存（适合做 HashMap key）；④ 网络参数/文件路径安全。
- JDK9 **Compact Strings**：Latin-1 编码 1 字节/字符，省约 50% 内存。
> **口诀**：final 类 + final 数组 + 不暴露改法；四好处：省、安、快、稳。

### Q23 String / StringBuilder / StringBuffer 区别？【基础】
**答**：String 不可变；StringBuilder 可变非线程安全（最快）；StringBuffer 可变线程安全（方法级 synchronized）。
> **口诀**：拼接少用 String（循环内 O(n²)）；单线程 StringBuilder，多线程 StringBuffer。

### Q24 == 与 equals？字符串常量池与 intern？【高频】
**答**：`==` 比引用地址；`equals` 默认比地址，String 重写为比内容。
- 常量池（JDK7 起在堆）：字面量 `"a"` 入池；`new String("a")` 建两个对象（池 + 堆各一）。
- `intern()`：入池并返回池中引用。
> **口诀**：字面量在池、new 在堆；`s2.intern() == s1` → true。

### Q25 hashCode 与 equals 的约定？【高频】
**答**：equals 相等 → hashCode 必相等；hashCode 相等 → equals 不一定相等（冲突）。
- **只重写 equals 不重写 hashCode**：HashMap 中相同逻辑对象分到不同桶，get 永远查不到 → 内存泄漏（对象丢失）。
> **口诀**：equals 相同则 hash 必同；hash 相同不保证 equals。

### Q26 Integer 缓存与装箱拆箱的坑？【高频】
**答**：`IntegerCache` 缓存 -128~127，`valueOf` 装箱走缓存。
- `Integer a=127,b=127; a==b` → **true**；128 → **false**。
- **坑**：`Integer i=null; if(i==1)` 拆箱 NPE；包装类比较用 `equals`。
> **口诀**：128 就是分界线；装箱=valueOf，拆箱=intValue，null 拆箱必 NPE。

### Q27 反射的原理与性能开销？【进阶】
**答**：Class 对象持有方法/字段元数据；`Method.invoke` 先走 JNI，多次调用后走**字节码版本**（Inflation 机制）。
- **开销**：类型检查、访问检查、装箱、无法内联。
- **优化**：缓存 Method/Field、`setAccessible(true)`、用 MethodHandle/VarHandle。
> **口诀**：invoke 有通胀机制——调多了生成字节码加速；反射是框架（Spring/MyBatis）的基石。

### Q28 深拷贝与浅拷贝？如何深拷贝？【基础】
**答**：浅拷贝只复制引用（共享对象）；深拷贝连内容一起复制。
- 实现深拷贝：重写 clone 逐层复制、序列化反序列化、**JSON 序列化（推荐）**、手动构造。
> **口诀**：`clone()` 默认浅；`Arrays.copyOf`/`List.copyOf` 都是浅拷贝。

### Q29 单例 DCL 为什么加 volatile？【高频】
**答**：`new Singleton()` 三步（分配内存 → 初始化 → 引用赋值）可能重排为（分配 → 赋值 → 初始化），另一线程读到**未初始化**对象。volatile 禁止重排 + 保证可见性。
- 更优写法：**静态内部类**（JVM 保证初始化唯一）、**枚举**（天然防反射/序列化破坏）。
> **口诀**：不加 volatile 可能拿到"半成品"对象；枚举单例 = 反射和序列化都打不穿。

---

## 05 集合框架与 HashMap 源码（8 题）

### Q30 ArrayList 扩容机制？【高频】
**答**：默认容量 10，满时扩容 **1.5 倍**（`old + (old >> 1)`），`Arrays.copyOf` 复制。
- 随机访问 O(1)，中间插入/删除 O(n)。
- **实际 ArrayList 几乎总是优于 LinkedList**：内存连续、CPU 缓存友好、扩容摊还 O(1)。
> **口诀**：1.5 倍扩容；`subList` 是视图，结构性修改抛 ConcurrentModificationException。

### Q31 HashMap 底层结构与 put 流程（JDK8）？【高频】
**答**：数组 + 链表 + 红黑树。
1. `hash = key.hashCode() ^ (hash >>> 16)`（**扰动函数**，高位参与低 16 位）。
2. 数组空 → resize 初始化 16。
3. `(n - 1) & hash` 定位桶。
4. 桶空直接插入；有节点链表尾插/树插。
5. 链表长度 ≥ 8 **且**数组长度 ≥ 64 → 树化。
6. 重复 key 覆盖旧值。
7. 元素数 > threshold（容量 × 0.75）→ 扩容。
> **口诀**：异或高位、按位取模、尾插、8 和 64 双条件树化、0.75 扩容。

### Q32 HashMap 为什么线程不安全？【高频】
**答**：JDK7 头插法 + 并发扩容 → 链表成环 → get 死循环 CPU 100%；JDK8 尾插解决死循环，但仍**数据丢失**、size 不准。
- 解决：ConcurrentHashMap / synchronizedMap。
> **口诀**：JDK7 死循环、JDK8 丢数据；并发一律 ConcurrentHashMap。

### Q33 为什么链表转红黑树阈值是 8？【进阶】
**答**：泊松分布下，负载因子 0.75 时桶中节点 ≥ 8 的概率约 0.00000006（千万分之六）——8 是"树化兜底"。
- 转树：链表 ≥ 8 **且**容量 ≥ 64（容量不足先扩容拆链表）。
- 退化：树节点 ≤ 6 转回链表（8/6 留 2 缓冲防震荡）。
> **口诀**：8 = 概率兜底；转树看"8 且 64"，退化看 6。

### Q34 HashMap 容量为什么是 2 的幂？传 17 会怎样？【进阶】
**答**：`(n-1) & hash` 位运算取代取模，更快且索引均匀；扩容后元素要么原位要么 +oldCap。
- 传 17 → `tableSizeFor` 向上取整为 **32**。
> **口诀**：2 的幂 = 位运算取模 + 扩容高效；预估容量 = 数据量 / 0.75 + 1。

### Q35 ConcurrentHashMap 原理（JDK7 vs JDK8）？【高频】
**答**：JDK7 **分段锁 Segment**（继承 ReentrantLock，默认 16 段）；JDK8 **CAS + synchronized 锁桶**（锁链表头）。
- JDK8：桶空 CAS 插入，非空锁头节点；多线程协助扩容（ForwardingNode 标记已迁移桶）。
- **禁止 null key/value**（并发下无法区分"不存在"与"值为 null"）。
> **口诀**：JDK7 分段、JDK8 锁桶；fwd 节点让读线程跳新表。

### Q36 CopyOnWriteArrayList 原理与场景？【高频】
**答**：写时复制整份数组，读不加锁。
- 适用：**读多写极少**（白名单、监听器、配置）。
- 缺点：写代价高、内存翻倍、弱一致性迭代器。
> **口诀**：写复制、读无锁；只适合读多写极少的场景。

### Q37 LinkedHashMap 如何实现 LRU？【进阶】
**答**：HashMap + 双向链表维护顺序；`accessOrder=true` 时每次 get/put 把节点移到尾部 → 头部即最久未使用。
- 重写 `removeEldestEntry` 返回 `size() > capacity` → 天然 LRU 缓存。
> **口诀**：访问后移尾部，头部即最久未用；override removeEldestEntry 即得 LRU。

---

## 06 并发基础与 JMM（9 题）

### Q38 线程创建方式与生命周期状态？【高频】
**答**：继承 Thread、实现 Runnable（推荐）、实现 Callable + FutureTask、线程池。
- 状态：`NEW → RUNNABLE → (BLOCKED/WAITING/TIMED_WAITING) → TERMINATED`。
- `sleep` 不释放锁；`wait` 释放锁（须在 synchronized 内）；`yield` 让出 CPU 不阻塞。
> **口诀**：BLOCKED 等 synchronized 锁，WAITING 等 wait/join/park，TIMED_WAITING 是带超时版。

### Q39 JMM 是什么？三大特性如何保证？【高频】
**答**：JMM 规定线程工作内存与主内存的交互规则（工作内存 ≈ CPU 缓存，主内存 ≈ RAM）。
- **原子性**：synchronized / Lock / CAS（`i++` 是读-改-写三步，非原子）。
- **可见性**：volatile / synchronized / final。
- **有序性**：volatile / synchronized / happens-before。
> **口诀**：原子加锁、可见 volatile、有序靠 happens-before。

### Q40 happens-before 规则有哪些？【高频】
**答**：① 程序顺序；② 锁（unlock 先于后续 lock）；③ volatile 写先于读；④ 传递性；⑤ 线程 start 先于其内部操作；⑥ 线程内操作先于 join 返回；⑦ interrupt 先于被中断线程感知；⑧ 构造完成先于 finalize。
> **口诀**：程序、锁、volatile、传递、start、join、interrupt、finalize 八条。

### Q41 volatile 的原理与作用？【高频】
**答**：**可见性**（写后写回主内存 + 失效其他线程缓存，底层靠 MESI 缓存一致性）+ **有序性**（禁止重排），**不保证原子性**。
- 经典用法：状态标志、DCL 单例、双检锁。
> **口诀**：可见 + 有序，不原子；`volatile i++` 照样丢数据。

### Q42 synchronized 锁升级过程？【高频】
**答**：无锁 → 偏向锁 → 轻量级锁 → 重量级锁（不可逆）。
- **偏向锁**：记录线程 ID，同线程重入无 CAS。
- **轻量级锁**：CAS 自旋抢锁，适合锁占用短。
- **重量级锁**：依赖 OS 互斥量 Monitor，内核态切换开销大。
- JDK15 起偏向锁废弃，JDK18 移除。
> **口诀**：偏→轻→重，按竞争程度选代价；无竞争偏向、轻竞争自旋、重竞争阻塞。

### Q43 CAS 原理与 ABA 问题？【高频】
**答**：比较内存值是否等于预期值，相等才更新（`Unsafe.compareAndSwapInt`，CPU 指令 cmpxchg）。
- **ABA**：A→B→A，CAS 误判未修改 → `AtomicStampedReference`（版本号）解决。
- 缺点：自旋空转耗 CPU；只能保证单变量原子性。
> **口诀**：比较-交换-失败重试；ABA 用版本号戳破。

### Q44 ThreadLocal 原理与内存泄漏？【高频】
**答**：每线程持有 ThreadLocalMap，key 是 ThreadLocal **弱引用**，value 强引用。
- **泄漏**：ThreadLocal 被回收后 key=null，value 仍被线程（尤其线程池复用）强引用 → 无法回收。
- **解决**：用后 `remove()`；get/set 会顺带清理过期条目（expungeStaleEntry）。
- 线程池下继承失效 → 阿里 **TransmittableThreadLocal**。
> **口诀**：弱 key 强 value，用完必 remove；InheritableThreadLocal 在线程池里是坑。

### Q45 死锁四条件与排查？【高频】
**答**：**互斥、占有且等待、不可剥夺、循环等待**。
- 排查：`jstack` 见 `Found one Java-level deadlock`；Arthas `thread -b`。
- 避免：锁顺序一致、tryLock 超时、锁粒度最小化。
> **口诀**：互斥、占有等待、不可剥夺、循环；破循环最常用。

### Q46 锁优化手段？【进阶】
**答**：**锁消除**（逃逸分析证明不逃逸就去掉锁）、**锁粗化**（连续加锁合并）、**自适应自旋**（按上次成功率动态调次数）。
> **口诀**：消、粗、自适应，配合锁升级三档。

---

## 07 JUC 深度（8 题）

### Q47 AQS 原理？【高频】
**答**：`volatile int state`（同步状态）+ CLH 双向等待队列。
- **模板方法**：tryAcquire/tryRelease/tryAcquireShared/tryReleaseShared 由子类实现；acquire = tryAcquire 失败 → addWaiter 入队 → acquireQueued 自旋/park。
- **非公平**：入队前先 CAS 抢一次；公平严格 FIFO。
- 用 `LockSupport.park/unpark` 阻塞唤醒（不依赖监视器、可精确唤醒）。
> **口诀**：state + CLH 队列 + 模板方法；ReentrantLock/CountDownLatch/Semaphore 都基于它。

### Q48 ReentrantLock 与 synchronized 对比？【高频】
**答**：ReentrantLock 手动 lock/unlock、可选公平、可中断（lockInterruptibly）、可超时（tryLock）、多 Condition 精确唤醒。
- **可重入原理**：state 计数，重入 +1、释放 -1，归零才真正释放。
> **口诀**：公平、中断、超时、多条件队列是 Lock 四张牌；synchronized 自动省心。

### Q49 读写锁与 StampedLock？【进阶】
**答**：ReentrantReadWriteLock 读读共享、读写/写写互斥；state 高 16 位读计数、低 16 位写计数；支持**锁降级**（写→读），不支持锁升级（死锁）。
- **StampedLock**：乐观读（不阻塞写）+ 悲观读 + 写锁三模式；不可重入、无 Condition。
> **口诀**：RRW 可降级不可升级；StampedLock 乐观读用版本戳校验。

### Q50 CountDownLatch / CyclicBarrier / Semaphore 区别？【高频】
**答**：CountDownLatch 倒计数门闩（等 N 个任务，**一次**）；CyclicBarrier 栅栏（N 个线程互相等，**可 reset 复用**）；Semaphore 信号量（限流，控制并发数）。
> **口诀**：一个等多个用 Latch，多个互相等用 Barrier，控制并发数用 Semaphore。

### Q51 线程池七大参数与执行流程？【高频】
**答**：corePoolSize、maximumPoolSize、keepAliveTime+TimeUnit、workQueue、threadFactory、handler。
- 流程：线程 < core → 建核心线程；≥ core → 入队；队列满 → 建非核心线程；队列满且达 max → **拒绝策略**；空闲超 keepAliveTime → 回收。
> **口诀**：核心不够就建、满了先排队、队列满了才扩、扩无可扩就拒绝——**先入队后扩线程**。

### Q52 拒绝策略与阻塞队列如何选？【高频】
**答**：AbortPolicy（默认，抛异常）、CallerRuns（调用线程执行）、Discard（静默丢）、DiscardOldest（丢最老）。
- 队列：ArrayBlockingQueue（有界）、LinkedBlockingQueue（默认无界**易 OOM**）、SynchronousQueue（无缓冲，任务直接交线程）、DelayQueue（延迟任务）。
> **口诀**：生产用有界队列 + CallerRuns；Executors 的 Fixed 池无界队列 OOM、Cached 池线程数 Integer.MAX。

### Q53 线程池大小如何确定？【进阶】
**答**：CPU 密集 `N+1`；IO 密集 `N × (1 + 等待/计算)` 或经验 2N。
- 队列容量与拒绝策略要压测验证；用 `availableProcessors()` 取核数。
> **口诀**：CPU 算、IO 等；严禁 Executors 快捷创建（阿里规约）。

### Q54 Future / CompletableFuture？【进阶】
**答**：Future get() 阻塞、无法编排；CompletableFuture 回调式链式编排（thenApply/thenCompose/thenCombine/whenComplete），allOf/anyOf 聚合，exceptionally/handle 处理异常。
- 原理：Completion 栈（Treiber 栈）回调链，默认 ForkJoinPool.commonPool。
> **口诀**：生产必须自定义线程池，别用 commonPool 被阻塞任务拖垮。

---

## 08 IO 与网络（6 题）

### Q55 BIO / NIO / AIO 区别？【高频】
**答**：BIO 阻塞（一连接一线程，线程爆炸）；NIO 同步非阻塞（多路复用 Selector，一线程管多连接）；AIO 异步非阻塞（内核完成回调，Linux 生态不成熟）。
> **口诀**：NIO 是"同步非阻塞"，AIO 才是"异步非阻塞"；Linux 下 epoll 让 NIO 成主流。

### Q56 NIO 三大组件？【高频】
**答**：**Buffer**（position/limit/capacity 三指针，flip 转读模式）、**Channel**（双向通道）、**Selector**（多路复用器，一个线程监听多 Channel 事件）。
- 流程：注册 → 事件就绪（select 返回 SelectionKey）→ 遍历处理。
> **口诀**：缓冲、通道、选择器；Channel 与流最大区别是"双向"。

### Q57 select / poll / epoll 对比？【进阶】
**答**：select fd_set 位图（上限 1024、每次全量拷贝、O(n)）；poll pollfd 数组（无上限、仍全量拷贝）；epoll 事件表 + 红黑树（**mmap 共享**、注册一次、O(1) 事件回调、支持 **ET 边缘触发**）。
- Netty 默认 LT（水平触发）。
> **口诀**：select 上限 1024、poll 无限不增量、epoll 注册一次 O(1)；ET 要一次读完。

### Q58 零拷贝是什么？Java 如何实现？【进阶】
**答**：传统 read+write 4 次拷贝 + 4 次上下文切换。
- **mmap**：用户态与内核共享缓冲区，少 1 次拷贝（MappedByteBuffer）。
- **sendfile**：内核直接 DMA 到 Socket（FileChannel.transferTo）→ 2 次拷贝。
- Netty FileRegion 底层即 transferTo。
> **口诀**：4 拷贝 → mmap 3 拷贝 → sendfile 2 拷贝；关键是不经过用户态。

### Q59 Netty 核心架构与线程模型？【高频】
**答**：**主从 Reactor**：Main Reactor（boss 管 accept）→ Sub Reactor（worker 管 IO 读写）。
- 组件：Bootstrap、EventLoopGroup（每 EventLoop = 一线程 + 一 Selector）、ChannelPipeline（责任链）、ByteBuf（双指针、池化、零拷贝）、ChannelHandler。
- **粘包拆包**：LineBased/DelimiterBased/FixedLength/**LengthFieldBasedFrameDecoder**（最常用）。
> **口诀**：boss 接客、worker 干活；耗时业务丢独立线程池，别堵 eventLoop。

### Q60 TCP 三次握手、四次挥手与 TIME_WAIT？【基础】
**答**：三次握手 SYN → SYN+ACK → ACK（确认收发能力、防历史连接）；四次挥手 FIN → ACK → FIN → ACK（半关闭）。
- **TIME_WAIT**（主动关闭方，2MSL）：保证最后 ACK 可达 + 让旧报文消失；大量 TIME_WAIT 出现在短连接高并发 → 改长连接/调内核参数。
- 服务端大量 **CLOSE_WAIT**：对端关闭但本地没 close（代码/连接池泄漏）。
> **口诀**：握手 3 次建双向、挥手 4 次因半关；TIME_WAIT 在主动方、CLOSE_WAIT 是被动方没关。

---

## 09 Spring 核心（8 题）

### Q61 IOC 容器：BeanFactory 与 ApplicationContext？【高频】
**答**：BeanFactory 最底层、懒加载；ApplicationContext 继承之，**启动时预实例化单例** + AOP/事件/国际化。
- 注入方式：构造器注入（推荐，final 保证）、setter 注入、字段注入（@Autowired，不推荐）。
> **口诀**：BeanFactory 懒、ApplicationContext 饿（启动即建）；单例默认非懒加载，@Lazy 可改。

### Q62 Bean 生命周期完整流程？【高频】
**答**：实例化 → 属性填充 → Aware 回调（BeanName/BeanFactory/ApplicationContext）→ BeanPostProcessor.before → @PostConstruct / InitializingBean / init-method → **BeanPostProcessor.after（AOP 代理在此生成）** → 使用 → 销毁（@PreDestroy / DisposableBean）。
> **口诀**：实→填→Aware→前后置→初始化→代理→用→销毁；AOP 代理生成于 after 阶段。

### Q63 循环依赖与三级缓存？【高频】
**答**：一级 singletonObjects（成品）→ 二级 earlySingletonObjects（半成品）→ 三级 singletonFactories（对象工厂）。
- 流程（A 依赖 B、B 依赖 A）：A 实例化入三级 → 填属性发现 B → B 实例化入三级 → 填属性发现 A → 三级工厂 getEarlyBeanReference 生成早期引用（需要 AOP 则在此出代理）→ 注入 B → B 完成入一级 → A 完成入一级。
- **为什么三级不用二级**：二级无法在实例化后、属性填充前用 BeanPostProcessor 生成 AOP 代理，三级用 ObjectFactory 延迟决策。
> **口诀**：一二三 = 成品/半成品/工厂；构造器循环依赖无解；Boot 2.6+ 默认禁止循环依赖。

### Q64 AOP 原理：JDK 动态代理 vs CGLIB？【高频】
**答**：JDK 代理基于接口（Proxy + InvocationHandler）；CGLIB 基于继承生成子类（Enhancer + MethodInterceptor），final 类/方法无法代理。
- Spring 选择：有接口 → JDK；无接口 → CGLIB；**Boot 2.x+ 默认强制 CGLIB**。
- 通知类型：@Before/@After/@Around/@AfterReturning/@AfterThrowing；@Around 最灵活。
> **口诀**：有接口 JDK、没接口 CGLIB、Boot2 全 CGLIB；**自调用 this.method() 不走代理**——AOP 失效经典坑。

### Q65 @Transactional 事务失效场景？【高频】
**答**：① 自调用（this 调用不走代理）；② 非 public 方法；③ 异常被 try-catch 吞掉；④ checked 异常默认不回滚（需 `rollbackFor = Exception.class`）；⑤ 数据库引擎不支持事务（MyISAM）；⑥ final 方法/类。
> **口诀**：默认只回滚 RuntimeException/Error；checked 异常是"可预期业务异常"不该回滚（Spring 哲学）。

### Q66 事务传播行为有哪几种？【进阶】
**答**：REQUIRED（默认，有则加入）、REQUIRES_NEW（总是新建，挂起外层）、SUPPORTS、NOT_SUPPORTED、MANDATORY（必须有）、NEVER（必须无）、NESTED（savepoint 嵌套）。
> **口诀**：R 家族记四个（REQUIRED/NEW/SUPPORTS/NOT_SUPPORTED）+ 强制两个（MANDATORY/NEVER）+ 嵌套 NESTED；日志/MQ 发送用 REQUIRES_NEW。

### Q67 单例 Bean 的线程安全问题？【高频】
**答**：单例 Bean 默认线程不安全（有状态字段并发读写）。
- 解决：① 无状态设计；② ThreadLocal；③ 加锁；④ 原型作用域（如 SimpleDateFormat）。
> **口诀**：Controller/Service 只放方法参数（无状态）；有状态放 ThreadLocal。

### Q68 @Autowired 与 @Resource 区别？【基础】
**答**：@Autowired（Spring）**byType 优先**，同类型多个按字段名找，找不到报错（需 @Qualifier）；@Resource（JSR-250）**byName 优先**。
> **口诀**：Autowired 按类型、Resource 按名字；构造器注入永远优先。

---

## 10 Spring Boot 与微服务（5 题）

### Q69 Spring Boot 自动装配原理？【高频】
**答**：`@SpringBootApplication = @SpringBootConfiguration + @EnableAutoConfiguration + @ComponentScan`。
- 流程：@EnableAutoConfiguration 导入 AutoConfigurationImportSelector → 读 `META-INF/spring/...AutoConfiguration.imports`（Boot 2.7+）所有自动配置类 → 逐类按 `@Conditional*` 判断是否生效（@ConditionalOnClass/@ConditionalOnMissingBean/@ConditionalOnProperty）→ 绑定 @ConfigurationProperties。
> **口诀**：导入选择器 → 读 imports 清单 → 条件注解裁决 → 属性绑定；本质是"默认配置 + 用户可覆盖"。

### Q70 Spring Boot 启动流程（run 做了什么）？【高频】
**答**：创建 SpringApplication（推断 Web 类型、加载 SPI 监听器）→ run()：监听器 starting → 创建 Environment → 打 Banner → 创建 ApplicationContext → prepareContext → **refreshContext（refresh() 即容器启动心脏）** → started → 执行 CommandLineRunner/ApplicationRunner → running。
> **口诀**：环境→容器→refresh→Runner；Runner 用于启动后初始化数据。

### Q71 starter 原理与自定义 starter？【进阶】
**答**：starter = 自动配置类 + 依赖管理；自定义：① 写 @Configuration + @EnableConfigurationProperties；② META-INF 注册；③ 打包。
- @ConfigurationProperties 类型安全、支持校验，优于 @Value。
> **口诀**：自动配置类 + imports 注册 + 条件生效；配置类用 Properties 不用 Value。

### Q72 @Configuration 与 @Component 区别（CGLIB 代理）？【进阶】
**答**：@Configuration 被 **CGLIB 增强** → 类内 @Bean 方法互调返回**同一个单例**；@Component 不增强 → 每次 new。
- `proxyBeanMethods = false` = Lite 模式，启动更快，适合无内部互调的配置类。
> **口诀**：Configuration 会"拦截互调"保单例；Lite 模式快但别内部互调。

### Q73 Spring Cloud 核心组件？【高频】
**答**：注册中心（Eureka AP / Nacos AP|CP / Consul）、配置中心（Nacos Config）、网关（Gateway WebFlux）、负载均衡（LoadBalancer）、熔断（Sentinel/Resilience4j）、链路追踪（Sleuth+Zipkin/SkyWalking）、服务调用（OpenFeign）。
> **口诀**：注册、配置、网关、负载、熔断、链路、调用七件套；**CAP**：Eureka 是 AP，Consul/Nacos-CP 是 CP。

---

## 11 分布式与中间件（7 题）

### Q74 分布式事务方案对比？【高频】
**答**：2PC/XA（强一致，同步阻塞、协调者单点）、**TCC**（Try-Confirm-Cancel 补偿，业务侵入高）、**Saga**（正向 + 反向补偿，长事务）、**Seata AT**（全局锁 + undo_log 回滚日志，侵入最小）、本地消息表 + MQ（最终一致）。
> **口诀**：强一致 2PC、最终一致靠补偿；Seata AT 用 undo_log 自动生成反向 SQL。

### Q75 分布式锁实现与对比？【高频】
**答**：Redis `SET key clientId NX EX`（快、简单，主从切换丢锁）、ZooKeeper 临时顺序节点（强一致，性能差）、数据库唯一键（简单，性能差）。
- **要点**：原子加锁 → 业务 → **Lua 脚本比对 clientId 再 DEL（防误删）** → 看门狗续期（Redisson）。
> **口诀**：加锁 SETNX、释放 Lua 校验、续期看门狗；极致一致性选 ZK/etcd。

### Q76 分布式 ID 方案？【高频】
**答**：UUID（无序长，不适合作主键）、号段模式（批量取号）、Redis INCR（依赖 Redis）、**雪花算法**（时间戳 41 + 机器 10 + 序列号 12，趋势递增，坑：时钟回拨）。
- 工业级：美团 Leaf、百度 UidGenerator。
> **口诀**：雪花 = 时间 + 机器 + 序列；时钟回拨可等待/备用位/内存序列。

### Q77 MQ 选型与消息可靠性？【高频】
**答**：Kafka 高吞吐（日志流，可能重复消费）、RocketMQ 事务消息/延迟消息/死信队列（金融订单）、RabbitMQ 功能全吞吐低、Pulsar 存算分离。
- **可靠性三阶段**：生产端 confirm + 重试、Broker 持久化 + 多副本、消费端**手动 ACK + 消费幂等**。
- **积压**：扩容消费者 → 临时转存 → 排查慢消费；**顺序**：Kafka 同分区有序。
> **口诀**：不丢 = 生产确认 + 存储多副本 + 消费手动 ACK；幂等是消费端底线。

### Q78 限流算法对比？【进阶】
**答**：计数器（临界突刺）、**滑动窗口**（平滑，Sentinel 默认）、**令牌桶**（匀速放令牌、允许突发，Guava RateLimiter）、漏桶（强制平滑，不能突发）。
> **口诀**：要突发选令牌桶、要强制平滑选漏桶、分布式限流 Redis + Lua。

### Q79 缓存一致性：Cache Aside 与延迟双删？【高频】
**答**：Cache Aside：读 miss 查库回填；写 = **先更新 DB，再删缓存**（不是更新缓存）。
- **延迟双删**：更新 DB → 删缓存 → sleep 短暂 → 再删一次（兜底并发读回填的旧值）。
- 极端一致：订阅 binlog（Canal）异步删缓存。
> **口诀**：先更库再删缓存；双删兜底；穿透/击穿/雪崩 → 布隆/互斥/随机过期。

### Q80 高并发系统设计通用套路？【进阶】
**答**：读多写少 → 缓存 + CDN；写多 → MQ 削峰 + 分库分表；防雪崩 → 限流、熔断、降级、隔离；链路保护 → 超时 + 重试幂等 + 熔断；容量评估 → QPS × 峰值系数 → 压测定阈值 → 监控告警。
> **口诀**：场景 → 约束 → 方案 → 细节 → 容灾 五步法；先澄清 QPS/数据量/一致性再动手。

---

## 附 背诵顺序建议

- **第一梯队（必背必问）**：HashMap put 流程、synchronized 锁升级、volatile、线程池 7 参数、AQS、JVM 内存区域、GC Roots、双亲委派、Bean 生命周期、循环依赖三级缓存。
- **第二梯队（原理深挖）**：G1/ZGC、CAS+ABA、ThreadLocal 泄漏、ConcurrentHashMap、AOP 代理、事务传播、自动装配。
- **第三梯队（场景题）**：分布式锁/事务/ID、缓存一致性、限流熔断、幂等设计、系统设计五步法。
- **复习节奏**：先背"口诀"→ 再口述"关键点"→ 最后对着深度题库查漏补缺。祝面试顺利！
