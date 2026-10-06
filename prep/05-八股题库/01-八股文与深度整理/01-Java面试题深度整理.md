# Java 深度面试题库

> 全栈架构师 · 面试考点全覆盖
> 覆盖 12 大章节 90+ 高频题：JVM 内存 → 类加载 → 垃圾回收 → Java 基础 → 集合源码 → 并发基础 → JUC 深度 → IO/Netty → Spring 核心 → Spring Boot/微服务 → 设计模式 → 分布式中间件。MySQL/Redis 考点见同名深度整理文档。

---

## 01 JVM 内存区域与对象

### 1.1 JVM 运行时内存区域如何划分？JDK8 有哪些变化？【高频】
**线程私有**：虚拟机栈、本地方法栈、程序计数器。
**线程共享**：堆、方法区（JDK8 起改为**元空间 Metaspace**，移出堆、使用本地内存）。

- **程序计数器**：唯一不会 OOM 的区域，记录字节码行号，用于分支/循环/跳转/异常恢复/线程切换。
- **虚拟机栈**：栈帧（局部变量表、操作数栈、动态链接、返回地址）；`StackOverflowError`（栈深度超限）与 `OutOfMemoryError`（动态扩展失败）。
- **本地方法栈**：为 native 方法服务，HotSpot 中与虚拟机栈合并。
- **堆**：GC 主战场，新生代(Eden + 2×Survivor) + 老年代；可细分为 TLAB。
- **方法区/元空间**：类元信息、常量、静态变量（JDK7 起静态变量移入堆）。JDK8 用元空间取代永久代：字符串常量池与静态变量仍在堆，类元数据用本地内存——**避免永久代 OOM、无需调 MaxPermSize**。

> 加分点：JDK8 移除永久代原因：永久代大小固定难调、Full GC 频繁；元空间受 OS 内存限制，默认无上限，可用 `-XX:MaxMetaspaceSize` 限制。

### 1.2 堆内存分代结构：新生代与老年代【基础】
- 新生代：Eden + S0 + S1（默认 **8:1:1**），对象优先在 Eden 分配，Minor GC 后幸存对象在 S0/S1 间复制，`-XX:MaxTenuringThreshold`(默认15) 次后晋升老年代。
- 老年代：大对象直接进入（`-XX:PretenureSizeThreshold`），Major/Full GC 触发点。
- 动态年龄判定：Survivor 中同年龄对象总和 > Survivor 一半时，≥该年龄对象直接晋升。

> 加分点：为什么不 1:1:1？复制算法只需一块 Survivor 空着，浪费率最小为 10%（Eden:S0:S1=8:1:1，总浪费 10%）。

### 1.3 对象创建过程？【高频】
1. **类加载检查**：new 指令先检查常量池能否定位到类符号引用，未加载则先加载。
2. **分配内存**：指针碰撞（堆规整）或空闲列表（堆不规整）；线程内 TLAB 优先分配，失败再 CAS 加锁分配。
3. **初始化零值**：对象字段置 0/null/false（保证字段无初始化也能用）。
4. **设置对象头**：Mark Word、类型指针、hashCode、GC 分代年龄、锁标志。
5. **执行构造方法**：`<init>` 真正按程序员意图初始化。

> 加分点：`Object o = new Object()` 在字节码层面 = new + dup + invokespecial `<init>`；DCL 单例需要 volatile 正是因为这 5 步可能重排（分配内存与构造可能颠倒，见 4.8）。

### 1.4 对象内存布局：对象头/实例数据/对齐填充【进阶】
- **对象头**：① Mark Word（64 位机 8 字节）：hashCode、分代年龄、锁状态标志、偏向线程 ID；② 类型指针（压缩后 4 字节，指向类元数据）；③ 数组长度（仅数组对象）。
- **实例数据**：字段值，相同宽度字段按规则重排以减少填充。
- **对齐填充**：对象大小必须是 **8 字节整数倍**（HotSpot 要求）。
- 开启 `-XX:+UseCompressedOops`（JDK8 默认）后，普通对象头 12 字节（8+4），压缩引用 4 字节。

> 追问：为什么要求 8 字节对齐？便于 CPU 高效访问与内存分配管理；也是 JOL 工具查看对象布局的基础。

### 1.5 对象访问定位：句柄 vs 直接指针【基础】
- **句柄**：栈中 reference 指向句柄池，句柄池存对象实例数据与类型数据地址。GC 移动对象只需改句柄，稳定。
- **直接指针**（HotSpot 默认）：reference 直接指向对象，对象头类型指针指向方法区类信息。**少一次定位，更快**；对象移动需更新引用（由 GC 处理）。
- 结论：HotSpot 用直接指针换速度，句柄换 GC 稳定性。

### 1.6 栈帧包含哪些结构？【基础】
局部变量表（Slot 复用，long/double 占 2 Slot）、操作数栈（字节码指令的工作区）、动态链接（符号引用→直接引用）、返回地址（方法出口）。`-Xss` 控制栈大小。

> 加分点：局部变量表 Slot 复用可能导致对象被提前回收（变量作用域结束但 Slot 仍被 GC Roots 引用）——在长生命周期循环里把大对象置 null 可辅助 GC，但现代 JIT 已优化，不必迷信。

### 1.7 OOM 的常见类型与排查流程？【高频】
- **StackOverflowError**：栈溢出，递归过深。
- **Java heap space**：堆满，`-Xmx` 不足或泄漏。
- **GC overhead limit exceeded**：98% 时间在 GC 且回收 <2%。
- **Metaspace**：元空间满，动态生成类过多（反射/字节码增强）。
- **Direct buffer memory**：堆外内存泄漏（NIO 未释放）。

排查流程：`jps` 找进程 → `jmap -dump` 导出堆 → MAT/JProfiler 分析 Dominator Tree（支配树）找大对象与 GC Roots 引用链 → 修复代码。

> 加分点：生产环境建议 `-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=...` 自动落盘；再配合 `jstat -gcutil` 观察 GC 频率。

### 1.8 逃逸分析、栈上分配与标量替换是什么？【进阶】
- **逃逸分析**：分析对象作用域，判断是否逃逸出方法/线程。
- 若不逃逸：**栈上分配**（HotSpot 实际未完全实现）、**标量替换**（把对象拆成多个标量字段直接放栈）、**锁消除**（同步块去掉锁）。
- 说明：HotSpot 通过标量替换间接实现栈上分配效果；`-XX:+DoEscapeAnalysis` 默认开启，Server 模式默认开启，Client 模式默认关闭。

> 深坑：很多人说"HotSpot 支持栈上分配"，准确说法是**通过标量替换实现**——小对象（如无逃逸的局部 POJO）可直接分配在栈上/寄存器，减少 GC 压力。

---

## 02 类加载机制

### 2.1 类加载过程分几步？每步做什么？【高频】
**加载 → 验证 → 准备 → 解析 → 初始化**（`--verify` 可用 `-Xverify:none` 跳过）。
- **加载**：通过类全限定名获取二进制字节流（jar/网络/动态代理），转为方法区运行时数据结构，生成 `Class` 对象。
- **验证**：文件格式、字节码语义（元数据、字节码、符号引用验证），防止恶意字节码。
- **准备**：为**静态变量分配内存并设零值**（`static int a = 1` 此时 a=0，真正的 1 在初始化阶段）。
- **解析**：符号引用 → 直接引用（类/接口/字段/方法）。
- **初始化**：执行 `<clinit>`，静态变量赋值 + 静态代码块；只有此阶段是"主动执行"。

> 加分点：接口与类的初始化时机不同——接口的字段引用不触发父接口初始化；`<clinit>` 由 JVM 加锁保证线程安全（一个类只初始化一次）。

### 2.2 类初始化的触发时机？被动引用不触发哪些？【高频】
**主动引用（6 种）**：new/getstatic/putstatic/invokestatic、反射、初始化子类先初始化父类、main 入口类、JDK7 动态语言支持、`MethodHandle`。
**被动引用（不触发）**：
1. `SubClass.value` 引用父类静态字段 → 只初始化父类。
2. `Class.forName` vs `ClassLoader.loadClass`：后者不初始化。
3. `new SubClass[10]` 数组 → 不触发。
4. 常量（`static final` 编译期常量）→ 编译期已入常量池。

### 2.3 双亲委派模型是什么？为什么这么设计？【高频】
**流程**：类加载器收到加载请求 → 先委托给父加载器 → 父加载不了才自己加载。
**层级**：Bootstrap（rt.jar，C++ 实现）→ Extension（JDK9 起为 Platform）→ Application（classpath）→ 自定义。
**为什么**：
1. **避免类重复加载**：同名的类只加载一份。
2. **核心类安全**：防止自定义 `java.lang.String` 混入核心库——加载 `String` 时先被 Bootstrap 加载，自定义的同名类永远不会被用到。

> 加分点：`ClassLoader.loadClass` 内部先 `findLoadedClass` → 父加载 → `findClass`；重写时应重写 `findClass` 而非 `loadClass`，否则破坏委派。

### 2.4 什么场景要打破双亲委派？如何打破？【进阶】
- **JDBC SPI**：`DriverManager` 在 Bootstrap 加载，但实现（mysql-connector）在 classpath——需要**线程上下文类加载器**（ContextClassLoader）反向加载。
- **Tomcat**：每个 WebApp 独立加载自己 lib 下的类（避免不同应用同 JAR 冲突），且要能加载应用自身的 `Servlet`——采用"**先自己加载、不行再委派**"的顺序。
- **OSGi/JBoss**：更细粒度的模块化加载。
- **热部署**：换一个自定义类加载器加载新版本类，老类卸载。

> 加分点：双亲委派是"默认安全"而非"铁律"，SPI 机制本身就是官方对双亲委派的突破。

### 2.5 自定义类加载器怎么做？热部署原理？【进阶】
`extends ClassLoader` 重写 `findClass`：读字节码 → `defineClass` → 返回 Class。
**热部署**：用**新的类加载器**重新加载（旧类卸载的前提是：无引用 + 无 GC Roots 可达 + ClassLoader 可回收），Spring Boot DevTools 即基于此。注意：类名相同但加载器不同 = 两个不同的类，`instanceof`/`equals` 可能失效。

### 2.6 类加载器不同会导致什么坑？【进阶】
- 同全限定名类由不同加载器加载 → 类型不兼容，强转会 `ClassCastException`。
- 父加载器看不到子加载器的类（可见性单向）。
- `getClass().getClassLoader()` 判空表示 Bootstrap 加载。

---

## 03 垃圾回收

### 3.1 如何判断对象存活？GC Roots 有哪些？【高频】
- **引用计数**（Python/早期 JVM）：循环引用无法回收，JVM 弃用。
- **可达性分析**（JVM 采用）：从 **GC Roots** 出发做引用链遍历，不可达即回收。GC Roots 包括：
  1. 虚拟机栈中引用的对象（局部变量、参数）。
  2. 方法区静态属性引用的对象。
  3. 方法区常量引用的对象（如 String 常量池）。
  4. 本地方法栈 JNI 引用的对象。
  5. 被 `synchronized` 锁住的对象、JVM 内部引用（Class、系统类加载器、异常对象）。

> 加分点：finalize() 只有一次自救机会且不保证执行，**永远不要用**；现代观点：弱引用+引用队列才是正确的清理方式（如 ThreadLocal 的 expungeStaleEntry）。

### 3.2 四种引用类型及适用场景【高频】
- **强引用**：`new` 出来的，GC 永不回收，OOM 也不收。
- **软引用 SoftReference**：内存不足时回收 → 内存敏感缓存（图片缓存）。
- **弱引用 WeakReference**：下次 GC 必回收 → ThreadLocal 的 key、WeakHashMap。
- **虚引用 PhantomReference**：随时可能回收，必须配合引用队列，用于**堆外内存/DirectByteBuffer 的回收跟踪**（NIO 的 Cleaner）。

> 加分点：软/弱/虚引用对象被回收后会被放入关联的 `ReferenceQueue`，可据此做资源清理回调。

### 3.3 三大 GC 算法对比【高频】
| 算法 | 原理 | 优点 | 缺点 |
|---|---|---|---|
| 标记-清除 | 标记存活→清除未存活 | 简单 | 内存碎片、两次扫描慢 |
| 复制 | 存活对象复制到另一半 | 无碎片、高效 | 浪费一半空间（Eden 8:1:1 化解） |
| 标记-整理 | 标记后存活对象向一端移动 | 无碎片、空间利用率高 | 移动对象需更新引用，STW |

**分代收集**：新生代对象朝生夕死 → 复制；老年代存活率高 → 标记-清除/整理。

### 3.4 经典垃圾收集器演进路线【高频】
- **Serial / Serial Old**：单线程，Client 模式默认，停顿长。
- **Parallel / Parallel Old**（JDK8 默认）：多线程，追求吞吐量（`-XX:+UseParallelGC`）。
- **CMS**（JDK9 弃用 / JDK14 移除）：并发标记清除，追求低停顿，但**浮动垃圾 + 内存碎片 + 并发失败退化 Serial Old**。
- **G1**（JDK9+ 默认）：Region 化，可预测停顿，兼顾吞吐与延迟。
- **ZGC / Shenandoah**（JDK11/15+）：TB 级堆、亚毫秒停顿。

> 加分点：CMS 的 4 个阶段：初始标记(STW)→并发标记→重新标记(STW)→并发清除；"并发模式失败"= 老年代被并发线程塞满，触发 Full GC 兜底。

### 3.5 G1 收集器原理详解【高频】
- **堆划分为 2048 个 Region**，逻辑分代（Eden/Survivor/Old/Humongous 大对象区），Region 之间可达则记录在 **RSet（Remembered Set）**——避免全堆扫描，代价是维护 RSet 开销。
- **三色标记**：白（未访问）→灰（已访问，引用未扫完）→黑（已访问，引用已扫完）。
- **SATB（Snapshot At The Beginning）**：并发标记期间记录起始快照，防止**漏标**（黑色对象新引用白色对象）。
- **Mixed GC**：新生代 + 部分老年代 Region 一起回收，通过 `-XX:MaxGCPauseMillis`(默认200ms) 控制停顿；G1 通过**收集集合 CSet 选择**实现可预测停顿。
- **写屏障**：G1 用写屏障维护 RSet 与 SATB。

> 追问：为什么 G1 不用 ZGC 的读屏障？G1 是"增量式整理"（局部移动），不需要全局指针修正，读屏障成本高收益低。

### 3.6 ZGC 为什么能做到亚毫秒停顿？【进阶】
- **染色指针（Colored Pointer）**：把 64 位指针的高 4 位用作标记位（Finalizable/Remapped/Marked0/Marked1），对象状态编码在指针里。
- **读屏障**：每次访问对象时读指针，若指针染色与对象状态不一致则修复（转发到新地址），实现**并发移动对象**（不做 STW 的"搬家公司"）。
- **多代 ZGC**（JDK21）：引入分代，进一步降低 CPU 开销。

> 加分点：ZGC 的停顿不再随堆大小增长；JDK21 起 ZGC 支持分代，默认开启。

### 3.7 三色标记漏标问题与 CMS 的增量更新【进阶】
- 漏标条件：**黑色对象**重新引用了一个**白色对象**，且灰色对象不再引用它。
- 解决方案：**增量更新（CMS）**——黑色对象引用白色对象时，把黑色对象标灰（重新标记阶段再扫）；**SATB（G1）**——记录起始快照，把被删引用对象的快照保留为灰。
- 代价：增量更新会产生**浮动垃圾**（多标不回收，下次清）；SATB 会产生更多浮动垃圾但避免漏标。

### 3.8 安全点与安全区域【进阶】
- **安全点 Safepoint**：GC 只能在所有线程到达安全点时暂停；如方法调用、循环回跳、异常抛出处。
- 线程处于 Sleep/Blocked 时到不了安全点 → **安全区域 SafeRegion**：该区域内引用关系不变，GC 无需等待。
- 垃圾收集器扫描线程栈依赖安全点；`-XX:+PrintSafepointStatistics` 可排查 STW。

### 3.9 JVM 调优实战：常用参数与排查工具【高频】
**常用参数**：
```
-Xms -Xmx（堆大小，建议相等避免动态扩缩）
-Xmn（新生代）、-XX:SurvivorRatio=8
-XX:MaxMetaspaceSize
-XX:+UseG1GC -XX:MaxGCPauseMillis=200
-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/tmp/dump.hprof
-XX:+PrintGCDetails -Xloggc:/tmp/gc.log（JDK9+ 用 -Xlog:gc*）
```
**排查工具**：jps（进程）、jstat（GC 统计）、jmap（堆转储）、jstack（线程栈，排查死锁）、jinfo（参数）、jcmd、MAT/Arthas。

> 加分点：调优流程 = 明确目标（吞吐 or 延迟）→ 收集 GC 日志 → 分析停顿来源 → 调整参数单变量验证；避免堆外大数组/大集合、避免频繁 Full GC。

---

## 04 Java 基础与字符串

### 4.1 String 为什么不可变？不可变有什么好处？【高频】
**不可变**：`final class` + `private final char[] value`（JDK9 起 byte[] + coder 编码标记）+ 不暴露修改方法。
**好处**：
1. **字符串常量池**可复用，节省内存。
2. **线程安全**，天然可共享。
3. **hashCode 可缓存**，HashMap 的 key 首选 String。
4. 作为网络参数/文件路径安全，不被篡改。

> 加分点：JDK9 的 Compact Strings：Latin-1 编码用 1 字节/字符，减少 50% 内存；`==` 比较的是引用，`equals` 比较内容，常量池中的字符串用 `==` 可能相等（见 4.3）。

### 4.2 String、StringBuilder、StringBuffer 区别【基础】
| 类 | 可变 | 线程安全 | 性能 |
|---|---|---|---|
| String | 不可变 | 安全 | 拼接产生新对象，慢 |
| StringBuilder | 可变 | 不安全 | 最快 |
| StringBuffer | 可变 | 安全（方法级 synchronized） | 较慢 |

> 加分点：循环内 `s += x` 会被 javac 优化成 `new StringBuilder`，但每次循环都 new，O(n²)；字符串拼接 `+` 在单表达式内编译器自动用 StringBuilder。

### 4.3 == 与 equals 的区别？String 常量池是什么？【高频】
- `==` 比较引用地址；`equals` 默认也是比较地址（Object），String 重写为比较内容。
- 字符串常量池（JDK7 起在堆）：`"a"` 字面量入池；`new String("a")` 创建两个对象（池中一个、堆中一个）。
- `intern()`：字符串入池，返回池中引用。

```java
String s1 = "a";               // 池中
String s2 = new String("a");   // 堆中，池中已有 "a"
s1 == s2          // false
s2.intern() == s1 // true
```

### 4.4 hashCode 与 equals 的约定？为什么重写 equals 必须重写 hashCode？【高频】
**约定**：equals 相等 → hashCode 必相等；hashCode 相等 → equals 不一定相等（哈希冲突）。
**为什么**：HashMap 用 hashCode 定位桶，equals 比较桶内元素。只重写 equals 不重写 hashCode → 相同逻辑对象 hashCode 不同 → 分到不同桶，`get` 永远查不到 → **内存泄漏（丢失）**。

### 4.5 Integer 缓存与装箱拆箱的坑【高频】
- `Integer a = 127, b = 127; a == b` → **true**（-128~127 缓存，`IntegerCache`）。
- `Integer a = 128, b = 128; a == b` → **false**（超出缓存）。
- 装箱 = `Integer.valueOf`（带缓存），拆箱 = `intValue`。
- **坑**：`Integer i = null; if (i == 1)` 拆箱 NPE；`Integer i1=1000, i2=1000; i1 == i2` false——比较包装类要 `equals`。
- `-XX:AutoBoxCacheMax` 可调整缓存上限。

### 4.6 反射的用途、原理与性能开销【进阶】
- 用途：框架（Spring IOC/MyBatis）、动态代理、序列化、注解处理、热部署。
- 原理：Class 对象持有方法/字段元数据，`Method.invoke` 走 JNI → MethodAccessor 生成字节码实现，多次调用后走**字节码版本**（Inflation）。
- 开销：类型检查、访问检查、方法查找、参数装箱、无法内联。
- 优化：缓存 Method/Field 反射对象、`setAccessible(true)` 跳过安全检查、尽量用接口调用。

> 加分点：JDK17+ 的 **MethodHandle** 更轻量（invokedynamic 支持），`VarHandle` 提供字段原子操作；反射获取泛型用 `getGenericSuperclass`。

### 4.7 深拷贝与浅拷贝？如何实现深拷贝？【基础】
- **浅拷贝**：只复制引用，共享对象（`clone()` 默认 + `Arrays.copyOf` 元素引用共享）。
- **深拷贝**：连对象内容一起复制。实现：重写 clone 逐层复制、序列化反序列化（实现 Serializable）、**JSON 序列化**（Jackson/Gson，推荐）、手动构造。
- 注意：`List.copyOf`/`Collections.copy` 都是浅拷贝。

### 4.8 单例模式的线程安全问题（DCL 为什么加 volatile）【高频】
```java
class Singleton {
    private static volatile Singleton instance;
    private Singleton() {}
    public static Singleton getInstance() {
        if (instance == null) {           // 1 快速判断
            synchronized (Singleton.class) { // 2 加锁
                if (instance == null) {   // 3 二次判断
                    instance = new Singleton(); // 4 创建
                }
            }
        }
        return instance;
    }
}
```
- 需要 volatile：`new Singleton()` 三步（分配内存→初始化→引用赋值）可能**重排**为（分配→赋值→初始化），另一线程在 1 处读到**未初始化**的对象。
- volatile 禁止重排 + 保证可见性。
- 其他单例：枚举（天然防反射/序列化）、静态内部类（懒加载 + 线程安全）。

---

## 05 集合框架与 HashMap 源码

### 5.1 ArrayList 扩容机制？与 LinkedList 如何选择？【高频】
- **ArrayList**：默认容量 10，`add` 满时扩容为 **1.5 倍**（`old + (old >> 1)`），`Arrays.copyOf` 复制；随机访问 O(1)，插入/删除 O(n)。
- **LinkedList**：双向链表，插入/删除 O(1)（已知节点），随机访问 O(n)。
- 选择：读多写少 → ArrayList；频繁头尾插入 → LinkedList。**实际 ArrayList 几乎总是更好**：内存连续、CPU 缓存友好、1.5 倍扩容摊还 O(1)。

> 加分点：`new ArrayList(0)` 后首次 add 直接扩到 10；`subList` 是视图（结构性修改抛 ConcurrentModificationException）；`ArrayList` 与 `Vector` 区别 = 线程安全 + 2 倍扩容 vs 1.5 倍。

### 5.2 HashMap 底层结构与 put 流程（JDK8）【高频】
**结构**：数组 + 链表 + **红黑树**。
**put 流程**：
1. `hash = (h = key.hashCode()) ^ (h >>> 16)`——**扰动函数**，让高位参与低 16 位运算，减少碰撞。
2. 数组空 → `resize()` 初始化 16。
3. `(n - 1) & hash` 定位桶。
4. 桶空 → 直接 new Node；桶有节点 → 链表尾插 / 树插（红黑树）。
5. 链表长度 ≥ 8 且数组长度 ≥ 64 → 树化；否则仅扩容。
6. 重复 key 覆盖旧值返回旧值。
7. 元素数 > `threshold`（容量×0.75）→ 扩容。

> 加分点：为什么是 2 的幂？`(n-1)&hash` 等价取模且更快，还能保证扩容后元素要么原位要么 +oldCap，rehash 高效。

### 5.3 HashMap 为什么线程不安全？JDK7 扩容死循环【进阶】
- **JDK7**：头插法 + 并发扩容 → 两个线程 rehash 时链表成环 → **get 死循环 CPU 100%**。
- **JDK8**：改尾插法解决死循环，但仍有**数据丢失**（put 覆盖）、**size 不准确**。
- 解决：`ConcurrentHashMap` / `Collections.synchronizedMap` / `Hashtable`。

### 5.4 为什么链表转红黑树阈值是 8？【进阶】
- 泊松分布：负载因子 0.75 下，桶中节点数 ≥8 的概率约 **0.00000006**（千万分之六），几乎不可能，说明 8 是"树化兜底"而非常态。
- 转树条件：**链表长度 ≥ 8 且数组容量 ≥ 64**（容量不足优先扩容，扩容后链表会拆散）。
- 退化条件：树节点 ≤ 6 时转回链表（防频繁震荡，8/6 留 2 的缓冲）。
- 树化代价：红黑树节点占内存约为链表节点 2 倍（TreeNode 含 parent/red/left/right）。

### 5.5 HashMap 的容量为什么是 2 的幂？初始化传 17 会怎样？【进阶】
- `(n-1) & hash` 位运算取代 `%` 取模；2 的幂保证低位全 1，索引均匀。
- 传 17 → `tableSizeFor` 向上取整为 **32**（大于等于参数的最小 2 次幂）。
- 负载因子 0.75 是空间与时间折中；`initialCapacity` 建议预估值 / 0.75 + 1，避免频繁扩容。

### 5.6 ConcurrentHashMap 原理（JDK7 vs JDK8）【高频】
**JDK7**：**分段锁 Segment**（继承 ReentrantLock），默认 16 段，锁粒度 = 段。
**JDK8**：
- 放弃分段锁，用 **CAS + synchronized** 锁桶（链表头节点）。
- put：桶空 CAS 插入；桶非空 synchronized 锁头节点；扩容多线程协助（`Transfer` 任务拆分）。
- 并发度更高、内存更省；`size()` 用 baseCount + CounterCell 累加。
- **禁止 null key/null value**（与 HashMap 不同，因为并发下无法区分"不存在"与"值为 null"）。

> 加分点：JDK8 CHM 的扩容是"并发迁移"，通过 `ForwardingNode`（fwd 节点）标记已迁移桶，读线程遇到 fwd 会跳到新表继续读。

### 5.7 CopyOnWriteArrayList 的原理与适用场景【高频】
- **写时复制**：写操作先复制整份数组，在副本上修改，再 `setArray` 发布；读不加锁。
- 适用：**读多写极少**（白名单、监听器列表、配置）。
- 缺点：写代价高、内存翻倍、数据短暂不一致（弱一致性迭代器）。

### 5.8 LinkedHashMap 如何实现 LRU？【进阶】
- `LinkedHashMap` = HashMap + 双向链表维护插入/访问顺序。
- `accessOrder=true` 时，每次 get/put 把节点移到链表尾部 → 链表头部即最久未使用。
- 重写 `removeEldestEntry` 返回 `size() > capacity` → **天然 LRU 缓存**（LinkedHashMap 源码自带思路，Redis 淘汰策略同理）。

### 5.9 TreeMap 与 Comparable/Comparator【基础】
- TreeMap 红黑树实现，key 有序，O(log n) 查找；`firstKey/lastKey/subMap` 等有序 API。
- key 需实现 `Comparable` 或在构造器传入 `Comparator`；两者不一致时以 Comparator 为准（TreeSet 同理）。

---

## 06 并发基础与 JMM

### 6.1 线程的创建方式与生命周期状态【高频】
- 创建：继承 Thread、实现 Runnable（推荐）、实现 Callable（可返回结果/抛异常，配合 FutureTask）、线程池。
- 状态：`NEW → RUNNABLE → (BLOCKED/WAITING/TIMED_WAITING) → TERMINATED`；`RUNNABLE` 涵盖运行与就绪（OS 层面）。
- **BLOCKED**（等 synchronized 锁）、**WAITING**（wait/join/park 无限等待）、**TIMED_WAITING**（sleep/wait(timeout)/join(timeout)）。
- `sleep` 不释放锁；`wait` 释放锁（必须在 synchronized 块内）；`yield` 让出 CPU 但不阻塞。

### 6.2 JMM 是什么？三大特性如何保证？【高频】
**JMM（Java 内存模型）**：规定线程与主内存的交互规则——每个线程有**工作内存**（寄存器/缓存），共享变量在主内存；线程间不可见，通过主内存传递。
- **原子性**：synchronized / Lock / CAS 保证（`i++` 不是原子的：读-改-写三步）。
- **可见性**：volatile / synchronized / final（初始化安全）保证。
- **有序性**：volatile（禁重排）/ synchronized / happens-before 规则保证。

> 加分点：JMM 与物理内存模型对应——工作内存 ≈ CPU 缓存，主内存 ≈ RAM；缓存一致性协议（MESI）解决多核可见性，JMM 是对底层的内存抽象。

### 6.3 happens-before 规则有哪些？【高频】
1. **程序顺序规则**：单线程内代码顺序。
2. **锁规则**：unlock happens-before 后续 lock。
3. **volatile 规则**：volatile 写 happens-before 后续读。
4. **传递性**：A→B→C 则 A→C。
5. **线程启动**：start() happens-before 该线程内所有操作。
6. **线程终止**：线程内操作 happens-before 其他线程 join() 返回。
7. **中断规则**：interrupt() happens-before 被中断线程检测到中断。
8. **对象终结**：构造完成 happens-before finalize() 开始。

> 加分点：happens-before 是"逻辑可见性"保证，不是"物理时间先后"——JIT 重排只要不破坏该规则即可。

### 6.4 volatile 的原理与作用【高频】
- **可见性**：volatile 写后插入 StoreStore/StoreLoad 屏障，强制写回主内存；读前插入 LoadLoad/LoadStore 屏障，失效本地缓存（实际上依赖 MESI 缓存一致性协议）。
- **有序性**：禁止 volatile 读写指令重排序。
- **不保证原子性**：`volatile int i; i++` 仍非原子。
- 经典用法：**状态标志**（`running` 开关）、**DCL 单例**、**双写模式**（double-checked locking）。

### 6.5 synchronized 的锁升级过程与原理【高频】
**对象头 Mark Word** 记录锁状态，升级路径：**无锁 → 偏向锁 → 轻量级锁 → 重量级锁**（不可逆）。
- **偏向锁**：记录线程 ID，同线程重入无 CAS；有竞争即撤销偏向。
- **轻量级锁**：CAS 自旋抢锁（自旋次数/自适应），适合锁占用短。
- **重量级锁**：依赖 OS 互斥量（Monitor），线程阻塞唤醒涉及内核态切换，开销大。
- JDK15 起偏向锁废弃（维护成本高），JDK18 移除。

> 加分点：锁升级本质是"根据竞争程度选择代价"：无竞争→偏向，轻竞争→自旋，重竞争→阻塞；`-XX:+UseBiasedLocking` 可开关。

### 6.6 CAS 原理与 ABA 问题【高频】
- **CAS（Compare And Swap）**：比较内存值是否等于预期值，相等才更新，否则重试；`Unsafe.compareAndSwapInt`，CPU 原子指令（cmpxchg）。
- 优点：无锁、无阻塞，乐观并发。
- 缺点：① 自旋空转耗 CPU；② **ABA 问题**：值 A→B→A，CAS 误判未修改——用 `AtomicStampedReference`（版本号）或 `AtomicMarkableReference` 解决；③ 只能保证**单个变量**原子性（多变量用 AtomicReference 包装）。

### 6.7 ThreadLocal 原理与内存泄漏【高频】
- 每个线程持有 `ThreadLocalMap`，key 是 ThreadLocal 的**弱引用**，value 是强引用。
- **内存泄漏**：ThreadLocal 被回收（弱引用）后，key=null 但 value 仍被线程（如线程池复用线程）强引用 → 无法回收。
- **解决**：使用后 `remove()`；ThreadLocalMap 的 `get/set` 会顺带清理 key=null 的过期条目（expungeStaleEntry），但不保证。
- **适用**：线程内上下文（数据库连接、用户信息、事务）；**继承**用 `InheritableThreadLocal`（线程池场景失效，需 TransmittableThreadLocal 阿里 TTL）。

### 6.8 死锁的产生条件与排查【高频】
四个必要条件：**互斥、占有且等待、不可剥夺、循环等待**。
- 排查：`jstack` 查看 `Found one Java-level deadlock`；JMC/Arthas `thread -b`。
- 避免：锁顺序一致、加锁超时（`tryLock`）、锁粒度最小化、用更高层并发工具（如单锁、数据库行锁）。

### 6.9 锁优化手段有哪些？【进阶】
- **锁消除**：逃逸分析证明对象不逃逸 → 去掉 synchronized（如 StringBuffer 局部变量）。
- **锁粗化**：连续加锁同一对象合并（循环内拼接）。
- **自适应自旋**：根据上次自旋成功率动态调整自旋次数。
- 以及偏向锁/轻量级锁/重量级锁的升级设计（见 6.5）。

---

## 07 JUC 深度

### 7.1 AQS 原理：核心数据结构与模板方法【高频】
**AbstractQueuedSynchronizer** 是 JUC 锁与同步器的基石（ReentrantLock/CountDownLatch/Semaphore 都基于它）。
- **核心成员**：`volatile int state`（同步状态）+ **CLH 双向队列**（等待线程节点，含 prev/next/thread/waitStatus）。
- **模板方法**：`tryAcquire/tryRelease/tryAcquireShared/tryReleaseShared`（由子类实现，AQS 用模板方法模式）；`acquire` 流程：tryAcquire 失败 → `addWaiter` 入队 → `acquireQueued` 自旋/park。
- **释放**：head 节点出队唤醒后继（`unparkSuccessor`）。
- **公平 vs 非公平**：非公平在入队前先 CAS 抢一次（`hasQueuedPredecessors` 为 false 才抢），公平严格 FIFO。
- **CLH 优化**：前驱节点状态判断，避免惊群。

> 加分点：AQS 用 `LockSupport.park/unpark` 阻塞唤醒，而不是 Object.wait（不依赖监视器、不抛中断异常、可指定线程精确唤醒）。

### 7.2 ReentrantLock 与 synchronized 的对比【高频】
| 维度 | synchronized | ReentrantLock |
|---|---|---|
| 获取释放 | 自动 | 手动 lock/unlock（finally 释放） |
| 公平性 | 非公平 | 公平/非公平可选 |
| 可中断 | 不可中断 | lockInterruptibly |
| 超时 | 无 | tryLock(timeout) |
| 条件队列 | 一个 wait/notify | 多个 Condition（精确唤醒） |
| 性能 | JDK6 后已接近 | 相当（自适应自旋） |

**可重入原理**：`state` 计数——重入一次 state+1，释放一次 state-1，归零才真正释放锁。

### 7.3 读写锁：ReentrantReadWriteLock 与 StampedLock【进阶】
- **ReentrantReadWriteLock**：读读共享、读写互斥、写写互斥；state 高 16 位读计数、低 16 位写计数；**锁降级**（写锁→读锁）支持，**锁升级**不支持（会死锁）。
- **StampedLock**（JDK8）：乐观读（不阻塞写）、悲观读、写锁三种模式；读多写少时用乐观读 + 版本戳校验，性能更高；**不可重入、不支持 Condition**。

### 7.4 CountDownLatch / CyclicBarrier / Semaphore 区别【高频】
| 工具 | 作用 | 可复用 | 方向 |
|---|---|---|---|
| CountDownLatch | 倒计数门闩，等 N 个任务完成 | 否（一次） | 一个线程等多个 |
| CyclicBarrier | 栅栏，N 个线程互相等待齐头并进 | 是（reset） | 多个线程互相等 |
| Semaphore | 信号量，控制并发访问数（限流） | 是 | 共享资源池 |

> 加分点：CountDownLatch 底层 AQS 共享模式（state=N，countDown 递减，归零唤醒 await）；Semaphore 公平/非公平对应 AQS 两种 acquire；`await` 与 `await(timeout)` 防死等。

### 7.5 线程池七大参数与执行流程【高频】
**七大参数**：corePoolSize、maximumPoolSize、keepAliveTime + TimeUnit、workQueue（阻塞队列）、threadFactory、handler（拒绝策略）。
**执行流程**：
1. 线程数 < corePoolSize → 新建核心线程执行。
2. ≥ corePoolSize → 入队 workQueue。
3. 队列满 → 线程数 < maximumPoolSize → 新建非核心线程（临时线程）。
4. 队列满且线程数 = maximumPoolSize → **拒绝策略**。
5. 空闲线程超过 keepAliveTime → 回收（allowCoreThreadTimeOut 可回收核心线程）。

> 加分点：**先入队后扩线程**（核心线程不够先排队），与"先扩线程后入队"（SynchronousQueue 场景）的区别常被问；线程池与队列的组合决定是"缓存型"还是"弹性型"。

### 7.6 拒绝策略与阻塞队列如何选？【高频】
**4 种拒绝策略**（`ThreadPoolExecutor.AbortPolicy` 默认）：Abort（抛异常）、CallerRuns（调用线程执行）、Discard（静默丢弃）、DiscardOldest（丢弃队头最老任务）。
**阻塞队列**：
- `ArrayBlockingQueue`：有界数组 FIFO，容量固定。
- `LinkedBlockingQueue`：可选有界链表，默认 Integer.MAX（**易 OOM**）。
- `SynchronousQueue`：无缓冲，任务直接交给线程（配合大 maxPoolSize 做"弹性"池）。
- `DelayQueue`：延迟任务（ScheduledThreadPoolExecutor 用 DelayedWorkQueue）。
- 生产建议：**有界队列 + CallerRuns/自定义策略**，宁可降速不可丢任务。

### 7.7 线程池大小如何确定？如何监控？【进阶】
- **CPU 密集**：`N + 1`（N=核数）。
- **IO 密集**：`N * (1 + 等待时间/计算时间)` 或 `2N`（经验值）；更精确用 `N * CPU利用率 * (1 + W/C)`。
- 队列容量与拒绝策略要配合压测验证；**避免无界队列**。
- 监控：`getPoolSize/getActiveCount/getTaskCount/getQueue().size()` 定时采集；ThreadPoolExecutor 支持 hook 方法（beforeExecute/afterExecute）打点。

> 加分点：核心线程数设置建议用 `Runtime.getRuntime().availableProcessors()`；线程池**不允许用 Executors 快速创建**——FixedThreadPool/单线程池无界队列 OOM、CachedThreadPool 最大线程 Integer.MAX 创建大量线程——这是阿里规约硬性要求。

### 7.8 Future / CompletableFuture 异步编程【进阶】
- **Future**：get() 阻塞、isDone 轮询，无法组合编排。
- **CompletableFuture**（JDK8）：回调式异步，`thenApply/thenCompose/thenCombine/whenComplete` 链式编排，`allOf/anyOf` 聚合，异常用 `exceptionally/handle`。
- 原理：内部基于 **Completion 栈**（Treiber 栈）实现回调链，默认使用 ForkJoinPool.commonPool。
- 生产：**自定义线程池传入**，避免 commonPool 被阻塞任务耗尽（阿里规约）。

### 7.9 并发容器一览【基础】
| 容器 | 替代 | 特性 |
|---|---|---|
| ConcurrentHashMap | HashMap | 分段/CAS+锁桶，高并发读 |
| CopyOnWriteArrayList | ArrayList | 写复制，读无锁 |
| ConcurrentLinkedQueue | LinkedList | 无锁 CAS 队列 |
| BlockingQueue 族 | 队列 | 生产者消费者解耦 |
| ConcurrentSkipListMap | TreeMap | 跳表，并发有序 |
| DelayQueue | 定时 | 延迟任务调度 |

---

## 08 IO 与网络

### 8.1 BIO / NIO / AIO 的区别【高频】
| 模型 | 阻塞 | 模型 | 并发支撑 | 代表 |
|---|---|---|---|---|
| BIO | 阻塞 IO | 一连接一线程 | 差（线程爆炸） | Socket 传统 |
| NIO | 非阻塞 IO | 多路复用（Selector） | 好（一线程管多连接） | Netty |
| AIO | 异步 IO | 内核完成回调 | 好但 Linux 实现不成熟 | JDK7 AIO |

> 加分点：NIO 是"**同步非阻塞**"（同步指读写过程由用户线程自己完成）；AIO 是"异步非阻塞"（内核完成 IO 后回调）；Linux 下 epoll 使 NIO 成为主流，AIO 因 glibc 生态问题应用少。

### 8.2 NIO 三大组件：Buffer / Channel / Selector【高频】
- **Buffer**：缓冲区（position/limit/capacity 三指针），`flip()` 读模式、`compact()`、`rewind()`。
- **Channel**：双向通道（FileChannel/SocketChannel/DatagramChannel），与流的最大区别是**双向**。
- **Selector**：多路复用器，一个线程 `select()` 监听多个 Channel 的 OP_ACCEPT/OP_READ/OP_WRITE 事件，返回 `SelectionKey` 集合。
- 流程：注册 Channel 到 Selector → 事件就绪 → 遍历 key 处理 → `key.channel()` 读写。

### 8.3 IO 多路复用：select / poll / epoll 对比【进阶】
| 维度 | select | poll | epoll |
|---|---|---|---|
| 结构 | fd_set 位图 | pollfd 数组 | 事件表 + 红黑树 |
| 上限 | 1024 | 无限制 | 无限制 |
| 拷贝 | 每次全量拷贝到内核 | 同左 | mmap 共享，注册一次 |
| 触发 | 水平 LT | 水平 LT | 水平 LT + **边缘 ET** |
| 效率 | O(n) 轮询 | O(n) 轮询 | **O(1)** 事件回调 |

> 加分点：epoll 的 ET（边缘触发）模式只在状态变化时通知一次，要求一次性读完，Netty 默认 **LT**；epoll 适合大量空闲连接场景，select/poll 适合连接少且活跃。

### 8.4 零拷贝是什么？Java 里如何实现？【进阶】
- 传统 read+write 需 **4 次拷贝 + 4 次上下文切换**（内核态/用户态）。
- **mmap**：用户态与内核态共享内核缓冲区，减少 1 次拷贝（`MappedByteBuffer`）。
- **sendfile**：数据不经过用户态，内核直接 DMA 到 Socket（`FileChannel.transferTo` → `sendfile` 系统调用）→ **2 次拷贝**；支持 scatter-gather 后仅 2 次 DMA 拷贝。
- Netty 的 `FileRegion` 底层即 transferTo。

### 8.5 Netty 的核心架构与线程模型【高频】
- **Reactor 模型**：Main Reactor（boss，accept 连接）→ Sub Reactor（worker，IO 读写），即主从多线程模型。
- **核心组件**：Bootstrap/ServerBootstrap、EventLoopGroup（线程组，每个 EventLoop 绑定一个线程 + 一个 Selector）、ChannelPipeline（责任链）、ByteBuf（池化、引用计数）、ChannelHandler（入站/出站）。
- **ByteBuf**：读写双指针，支持零拷贝（CompositeByteBuf、slice、Unpooled.wrappedBuffer）、池化（PooledByteBufAllocator）。
- **粘包拆包**：`LineBasedFrameDecoder`、`DelimiterBasedFrameDecoder`、`FixedLengthFrameDecoder`、**`LengthFieldBasedFrameDecoder`**（最常用，带长度字段）。

> 加分点：Netty 的写事件由 eventLoop 线程保证单线程写，避免多线程写 ByteBuf 的竞态；业务处理耗时任务要丢到独立业务线程池，避免阻塞 eventLoop。

### 8.6 TCP 三次握手、四次挥手与 TIME_WAIT【基础】
- 三次握手：SYN → SYN+ACK → ACK；确认双方收发能力，防历史重复连接。
- 四次挥手：FIN → ACK → FIN → ACK；因半关闭（单向关闭）。
- **TIME_WAIT**（主动关闭方，2MSL）：保证最后的 ACK 可达 + 让旧连接报文在网络中消失；大量 TIME_WAIT 出现在短连接高并发场景 → 调整内核参数或改长连接。
- 服务端大量 CLOSE_WAIT：**对端关闭但本地未 close**，通常代码未关闭 Socket/连接池泄漏。

---

## 09 Spring 核心

### 9.1 IOC 容器：BeanFactory 与 ApplicationContext【高频】
- **BeanFactory**：最底层容器，懒加载（getBean 时才创建）。
- **ApplicationContext**：继承 BeanFactory，**启动时预实例化单例** + AOP、事件、国际化、环境抽象等企业级能力；常用实现：ClassPathXmlApplicationContext（XML）、AnnotationConfigApplicationContext（注解）。
- **IOC 本质**：控制反转——对象创建与依赖注入交给容器，降低耦合；对应 DI（依赖注入）：构造器注入（推荐，final 保证）、setter 注入、字段注入（@Autowired，不推荐，难测试）。

> 加分点：Spring 中单例 Bean 默认**非懒加载**（预实例化）——启动即创建，利于发现问题；`@Lazy` 可改。

### 9.2 Bean 生命周期完整流程【高频】
`实例化 → 属性填充（依赖注入）→ Aware 回调（BeanNameAware/BeanFactoryAware/ApplicationContextAware）→ BeanPostProcessor.postProcessBeforeInitialization → @PostConstruct / InitializingBean.afterPropertiesSet / init-method → BeanPostProcessor.postProcessAfterInitialization（AOP 代理在此生成）→ 使用 → 销毁（@PreDestroy / DisposableBean / destroy-method）`

> 加分点：**AOP 代理在 postProcessAfterInitialization 生成**（AbstractAutoProxyCreator）——所以被代理 Bean 的初始化方法仍走原对象，但对外暴露的是代理；`@PostConstruct` 在依赖注入完成后执行，早于 InitializingBean。

### 9.3 循环依赖与三级缓存【高频】
```java
// 三级缓存（DefaultSingletonBeanRegistry）
Map<String, Object> singletonObjects;        // 一级：成品单例（完成初始化）
Map<String, Object> earlySingletonObjects;   // 二级：早期暴露的半成品（未完成属性填充）
Map<String, ObjectFactory<?>> singletonFactories; // 三级：对象工厂（用于生成代理）
```
**流程（A 依赖 B，B 依赖 A）**：
1. 创建 A → 实例化 → 放入三级缓存（singletonFactory）→ 属性填充时发现依赖 B。
2. 创建 B → 实例化 → 三级缓存 → 填充属性发现依赖 A。
3. 从三级缓存取 A 的 ObjectFactory → `getEarlyBeanReference` 生成 A 的**早期引用**（若 A 需要 AOP，此处生成代理）→ 放入二级缓存 → 注入给 B。
4. B 完成 → B 入一级缓存 → A 继续完成属性填充 → A 入一级缓存。

**为什么三级不用二级**：二级缓存无法在"实例化后、属性填充前"用 BeanPostProcessor 生成 AOP 代理（代理要等目标对象真实被引用时才知道是否需要），三级缓存用 ObjectFactory 延迟决策。

> 追问：构造器注入的循环依赖无法解决（实例化阶段就要依赖）；`@Async`/`@Transactional` 代理对象循环依赖 JDK 版本不同行为不同，Spring Boot 2.6+ 默认**禁止循环依赖**（spring.main.allow-circular-references=false）。

### 9.4 AOP 原理：JDK 动态代理 vs CGLIB【高频】
- **JDK 动态代理**：基于接口，`Proxy.newProxyInstance` + `InvocationHandler`，运行时生成代理类。
- **CGLIB**：基于继承，生成目标类子类（`Enhancer` + `MethodInterceptor`），可代理无接口类；**final 方法/类无法代理**。
- Spring 选择：目标有接口 → JDK 代理；无接口 → CGLIB；**Spring Boot 2.x+ 默认强制 CGLIB**（`spring.aop.proxy-target-class=true`）。
- AOP 概念：切面（@Aspect）、切点（@Pointcut）、通知（@Before/@After/@Around/@AfterReturning/@AfterThrowing）、连接点、织入（编译期/类加载期/运行期——Spring 是运行期代理织入）。

> 加分点：`@Around` 最灵活（可控制是否执行方法）；AOP 自调用失效——`this.method()` 不走代理，必须注入自身代理或 `AopContext.currentProxy()`。

### 9.5 @Transactional 事务失效的常见场景【高频】
1. **自调用**：同类内 this 调用，不走代理。
2. **方法非 public**（默认拦截器仅 public）。
3. **异常被吞**：`try-catch` 住了 RuntimeException；或抛出的不是 RuntimeException（checked 异常默认不回滚，需 `rollbackFor = Exception.class`）。
4. 数据库引擎不支持事务（MyISAM）。
5. 传播行为配置错误（REQUIRES_NEW 内层回滚不影响外层等）。
6. `final` 方法/类被 CGLIB 代理后无法覆盖。

> 加分点：默认传播 REQUIRED（加入当前事务）；默认回滚规则 = RuntimeException/Error 回滚、checked 异常不回滚（Spring 设计哲学：checked 异常表示可预期业务异常，不该回滚）。

### 9.6 事务传播行为有哪几种？【进阶】
- **REQUIRED**（默认）：有则加入，无则新建。
- **REQUIRES_NEW**：总是新建，挂起外层事务（常用于日志、MQ 发送）。
- **SUPPORTS**：有则加入，无则非事务执行。
- **NOT_SUPPORTED**：非事务执行，挂起外层。
- **MANDATORY**：必须有事务，否则抛异常。
- **NEVER**：必须无事务，有则抛异常。
- **NESTED**：嵌套事务（savepoint 回滚点，外层回滚内层必回滚，内层回滚不影响外层）——**只对 DataSourceTransactionManager 有效**。

### 9.7 Spring 中单例 Bean 的线程安全问题【高频】
- 单例 Bean 默认线程不安全：有状态字段（非 final 的 mutable 字段）并发读写。
- 解决：① 无状态设计（Controller/Service 只放方法参数）；② ThreadLocal 存有状态数据；③ 加锁；④ 换成原型作用域（@Scope("prototype")，如非线程安全的 SimpleDateFormat）。

### 9.8 @Autowired 与 @Resource 的区别【基础】
| 维度 | @Autowired | @Resource |
|---|---|---|
| 来源 | Spring | JSR-250（JDK 标准） |
| 装配方式 | **byType** 优先 | **byName** 优先（name 缺省用字段名） |
| 存在多个同类型 | 按字段名找，找不到报错（需 @Qualifier） | 按 name 找 |
| required | 可配 required=false | 无 |

> 加分点：构造器注入优先（final + 不可变 + 循环依赖提前暴露）；字段注入虽方便但破坏封装、难单测。

---

## 10 Spring Boot 与微服务

### 10.1 Spring Boot 自动装配原理【高频】
**核心注解**：`@SpringBootApplication = @SpringBootConfiguration + @EnableAutoConfiguration + @ComponentScan`。
**自动装配流程**：
1. `@EnableAutoConfiguration` 导入 `AutoConfigurationImportSelector`。
2. 读取 `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`（Spring Boot 2.7 起）中所有自动配置类（如 RedisAutoConfiguration、DataSourceAutoConfiguration）。
3. 逐类用 `@Conditional*` 条件注解判断是否生效（`@ConditionalOnClass`：classpath 有类才装配；`@ConditionalOnMissingBean`：用户已定义则不覆盖；`@ConditionalOnProperty`：配置项开启）。
4. 装配的 Bean 绑定 `@ConfigurationProperties`（如 `spring.redis.*`）。

> 加分点：**自动装配是"按条件加载的默认配置 + 用户可覆盖"**；Spring Boot 3 后 imports 文件路径变化，且强制 Java 17 + Spring 6。

### 10.2 Spring Boot 启动流程（run 方法做了什么）【高频】
1. 创建 `SpringApplication`，推断 Web 应用类型、加载 ApplicationContextInitializer/ApplicationListener（SPI）。
2. 调用 `run()`：`SpringApplicationRunListeners.starting()`（事件发布）→ 创建 Environment（配置解析）→ 打印 Banner → 创建 ApplicationContext（AnnotationConfigServletWebServerApplicationContext）→ **prepareContext**（注册启动类）→ **refreshContext**（核心：`refresh()` 即 Spring 容器启动全流程，见 9.2）→ afterRefresh → `listeners.started()` → 执行 `CommandLineRunner`/`ApplicationRunner` → `listeners.running()`。

> 加分点：`refresh()` 是 Spring 容器启动的心脏（BeanFactory 创建、BeanDefinition 注册、Bean 实例化、内嵌 Tomcat 启动、Web 容器初始化）；Runner 用于启动后初始化数据。

### 10.3 starter 原理与自定义 starter【进阶】
- **starter** = 一组自动配置 + 依赖管理：`mybatis-spring-boot-starter` 内含 `xxxAutoConfiguration` + `spring.factories`/imports 注册。
- 自定义 starter 步骤：① 写自动配置类（@Configuration + @EnableConfigurationProperties）；② META-INF 下注册；③ 依赖打包。
- **@ConfigurationProperties 与 @Value**：前者类型安全、支持校验（@Validated）、可复用，推荐用于配置类。

### 10.4 @Configuration 与 @Component 的区别（CGLIB 代理）【进阶】
- `@Configuration` 类被 **CGLIB 增强**（`ConfigurationClassEnhancer`）→ 类内 `@Bean` 方法互调时返回**同一个单例**（不做代理则每次 new）。
- `@Component` 不增强 → `@Bean` 方法互调会创建多个实例。
- 因此 `@Configuration` 中 @Bean 方法互调是安全的；若为 Lite 模式（@Component 或 proxyBeanMethods=false）互调则不走单例池。

> 加分点：`@Configuration(proxyBeanMethods = false)` 是 **Lite 模式**——启动更快（少生成代理类），适合无内部互调的配置类；Spring Boot 内部大量使用 Lite 模式。

### 10.5 Spring Cloud 核心组件与职责【高频】
| 组件 | 职责 | 常见实现 |
|---|---|---|
| 注册中心 | 服务发现/健康检查 | Eureka（AP）、Nacos（AP/CP 可选）、Consul |
| 配置中心 | 动态配置 | Nacos Config、Spring Cloud Config |
| 网关 | 路由/鉴权/限流/聚合 | Spring Cloud Gateway（WebFlux 响应式） |
| 负载均衡 | 客户端负载 | LoadBalancer（替代 Ribbon） |
| 熔断降级 | 故障隔离 | Sentinel、Resilience4j（替代 Hystrix） |
| 链路追踪 | 全链路监控 | Sleuth + Zipkin / SkyWalking |
| 服务调用 | 声明式 HTTP | OpenFeign |

> 加分点：**CAP 权衡**：Eureka 是 AP（宁可注册表不一致也要可用），Consul/Nacos-CP 是 CP（宁可不可用也不给错误数据）；生产常用 Nacos——临时实例 AP、持久实例 CP。

### 10.6 微服务拆分原则与常见问题【进阶】
- 拆分维度：业务域（DDD 限界上下文）、团队结构（康威定律）、独立演进/独立部署。
- 常见坑：分布式事务（见 12.1）、分布式锁（12.2）、配置漂移、服务间调用链过长（>3 跳考虑聚合）、数据一致性、故障蔓延（熔断/隔离/降级/限流四件套）。

---

## 11 设计模式与场景题

### 11.1 单例模式的 5 种写法对比【高频】
| 写法 | 线程安全 | 懒加载 | 备注 |
|---|---|---|---|
| 饿汉（static final） | ✅ | ❌ | 类加载即创建 |
| 懒汉（方法加锁） | ✅ | ✅ | 性能差 |
| **DCL + volatile** | ✅ | ✅ | 推荐 |
| 静态内部类 Holder | ✅ | ✅ | JVM 保证初始化唯一 |
| **枚举** | ✅ | 天然 | **防反射、防序列化破坏**，最佳 |

> 加分点：反射可破坏除枚举外的所有单例（Constructor.setAccessible）；序列化反序列化也会产生新实例（需 readResolve）；枚举底层是类 + static final 字段，天然免疫。

### 11.2 策略 / 模板方法 / 责任链 模式（源码中的应用）【进阶】
- **策略**：算法族封装（`Comparator`、线程池拒绝策略、`RejectedExecutionHandler`、Spring `Resource` 解析）。
- **模板方法**：父类定骨架、子类实现细节（AQS 的 tryAcquire、Spring `JdbcTemplate`、`AbstractApplicationContext.refresh`）。
- **责任链**：请求沿链传递（Servlet Filter、Netty ChannelPipeline、MyBatis 插件 Interceptor、Spring MVC HandlerInterceptor）。
- **工厂**：BeanFactory（抽象工厂）、静态工厂 `Integer.valueOf`、简单工厂（Calendar）。

### 11.3 动态代理的实现方式与选择【高频】
- JDK 动态代理：接口 + InvocationHandler；CGLIB：继承 + MethodInterceptor。
- Spring AOP 默认选择逻辑：**有接口且未强制 → JDK 代理；否则 CGLIB**。
- 对比：JDK 代理仅能代理接口方法，但无需额外依赖；CGLIB 可代理类但 final 无法代理、生成子类。
- **静态代理 vs 动态代理**：静态代理写死目标类；动态代理运行时生成。

### 11.4 观察者模式与 Spring 事件机制【进阶】
- Spring 事件：`ApplicationEvent` + `@EventListener`/`ApplicationListener` + `ApplicationEventPublisher.publishEvent`。
- 默认**同步**执行（发布线程阻塞）；`@Async` + `@EnableAsync` 可异步；支持泛型事件精确匹配。
- 用途：业务解耦（下单 → 发短信/发积分/写日志，避免主流程阻塞）。
- 对比 MQ：进程内事件用 Spring Event，跨服务用 MQ。

### 11.5 高频场景题：如何实现接口幂等？【高频】
1. **唯一索引/唯一键**：数据库约束兜底（最可靠）。
2. **Token 令牌机制**：请求前发 token，请求时校验并删除（Redis SETNX）。
3. **状态机**：订单状态流转，重复请求状态不匹配直接返回。
4. **去重表**：业务唯一键 + 状态标记。
5. **乐观锁**：version 字段，update where version=?。
- 判定幂等键：用户 ID + 业务参数 hash 或全局 ID（见 12.3）。

### 11.6 SOLID 设计原则【基础】
- **S** 单一职责：一个类一个职责。
- **O** 开闭：对扩展开放、对修改关闭（策略/模板方法）。
- **L** 里氏替换：子类可替换父类且行为不破坏。
- **I** 接口隔离：接口按调用方细分。
- **D** 依赖倒置：面向接口编程，依赖抽象不依赖具体。
> 加分点：日常 Review 时 SOLID 是最实用的一把尺子；配合"高内聚低耦合"一起答。

---

## 12 分布式与中间件原理

### 12.1 分布式事务方案对比【高频】
| 方案 | 原理 | 一致性 | 适用 |
|---|---|---|---|
| 2PC/XA | 准备→提交，两阶段 | 强一致 | 短事务、跨库少 |
| **TCC** | Try-Confirm-Cancel 补偿 | 最终一致 | 业务可拆分（账户/库存） |
| **Saga** | 正向流程 + 反向补偿 | 最终一致 | 长事务、异步 |
| **Seata AT** | 全局锁 + 回滚日志 undo_log | 最终一致 | 对业务侵入最小 |
| 本地消息表 + MQ | 事务消息（RocketMQ） | 最终一致 | 异步解耦 |

> 加分点：2PC 缺点——同步阻塞、协调者单点、数据不一致窗口；TCC 需要业务实现 Try/Confirm/Cancel 三方法（侵入高）；Seata AT 用全局事务管理器 + undo_log 自动生成反向 SQL，代价是性能与全局锁。

### 12.2 分布式锁的实现与对比【高频】
| 方案 | 优点 | 缺点 |
|---|---|---|
| **Redis SET NX EX** | 快、简单 | 主从切换丢锁（需 Redlock/Redisson watchDog 续期） |
| **ZooKeeper 临时顺序节点** | 强一致、无过期风险 | 性能差、依赖 ZK |
| **数据库唯一键/乐观锁** | 简单 | 性能差、单点 |

**Redis 分布式锁要点**：`SET lockKey clientId NX EX 30`（原子）→ 业务 → Lua 脚本比对 clientId 再 DEL（**防误删别人锁**）→ 看门狗自动续期（Redisson）。  
**Redlock**：多数节点加锁成功才算成功，解决主从切换问题（但仍被业界质疑，需权衡）。

> 加分点：Redis 锁本质是"CP 服务当 AP 用"的妥协；极致一致性场景选 ZK/etcd。

### 12.3 分布式 ID 方案【高频】
1. **UUID**：本地生成，无序、长、无业务含义 → 不适合作主键（页分裂）。
2. **数据库自增/号段模式**：批量取号（如一次取 1000 个），简单可靠，需维护号段表。
3. **Redis INCR**：快，但依赖 Redis、持久化可能丢号。
4. **雪花算法 Snowflake**：`时间戳(41) + 机器ID(10) + 序列号(12)`，64 位 Long，**趋势递增**、无依赖、QPS 高；坑：时钟回拨（可等待/备用位/内存序列）。
5. **美团 Leaf / 百度 UidGenerator**：雪花 + 号段结合。

### 12.4 消息队列选型与消息可靠性【高频】
| MQ | 特点 |
|---|---|
| Kafka | 高吞吐、日志流、分区有序，可能重复消费，适合大数据/日志 |
| RocketMQ | 事务消息、延迟消息、死信队列，适合金融/订单 |
| RabbitMQ | 功能全、管理界面友好，吞吐相对低，适合中小规模 |
| Pulsar | 存算分离、多租户，云原生 |

**可靠性三阶段**：生产端（confirm 确认 + 重试）、Broker（持久化 + 多副本）、消费端（**手动 ACK + 消费幂等**）。  
**消息积压处理**：扩容消费者 → 临时转存（堆积消息先 dump 到 Redis/文件再慢慢消费）→ 排查慢消费原因。  
**顺序消息**：Kafka 同分区有序（按 key hash 到同一分区）；RocketMQ 普通消息要保序需顺序队列 + 单消费者。

### 12.5 限流算法对比【进阶】
| 算法 | 原理 | 特点 |
|---|---|---|
| 计数器 | 固定窗口计数 | 临界突刺问题 |
| **滑动窗口** | 细分子窗口 | 平滑，主流（Sentinel 默认） |
| **令牌桶** | 匀速放令牌，可突发 | 允许突发流量（Guava RateLimiter） |
| 漏桶 | 匀速流出 | 强制平滑，无法突发 |

> 加分点：分布式限流 = Redis + Lua 原子操作（计数/令牌）；单机限流用 Guava/Sentinel；网关层 + 应用层双层限流。

### 12.6 缓存一致性：Cache Aside 与延迟双删【高频】
- **Cache Aside（旁路缓存）**：读 miss 查库回填；写 = **先更新 DB，再删缓存**（不是更新缓存）。
- 为什么删缓存而非更新缓存：并发写场景更新缓存会产生旧数据污染，删除更简单安全。
- **延迟双删**：更新 DB → 删缓存 → **sleep 短暂时间** → 再删一次（兜底读线程回填的旧值）。
- 极端一致方案：订阅 binlog（Canal）→ 异步删除缓存；DB 与缓存用事务消息保证最终一致。

> 加分点：先删缓存再更新 DB 的风险更大（删后读请求回填旧值）；缓存穿透/击穿/雪崩的防御：布隆过滤器、互斥锁重建、过期时间加随机值、多级缓存——详见《Redis 深度面试题库》第 9 章。

### 12.7 高并发系统设计的通用套路【进阶】
1. **读多写少**：缓存 + CDN + 多级缓存。
2. **写多**：MQ 削峰填谷、批量写、分库分表。
3. **热点数据**：本地缓存 + 热 key 探测 + 备份 key。
4. **防止雪崩**：限流、熔断、降级、隔离（线程池/信号量）、超时控制、重试退避。
5. **链路保护**：超时（连接/读/写三层）+ 重试幂等 + 熔断（错误率阈值）+ 优雅降级（返回默认值）。
6. **容量评估**：QPS × 峰值系数 → 压测定阈值 → 监控告警（Prometheus + Grafana）。

> 加分点：面试答系统设计题遵循"**场景 → 约束 → 方案 → 细节 → 容灾**"五步法，先澄清 QPS/数据量/一致性要求再动手。

---

## 附 面试复习路线图

- **第一层（必背）**：JVM 内存模型、类加载、GC 算法与收集器、HashMap 源码、synchronized/volatile、线程池、JMM。
- **第二层（原理）**：AQS、ConcurrentHashMap、ThreadLocal、Spring IOC/AOP/循环依赖/事务、Netty 线程模型。
- **第三层（场景）**：分布式锁/事务/ID、缓存一致性、限流熔断、幂等设计、系统设计五步法。
- **关联文档**：数据库 →《MySQL 深度面试题库》；缓存 →《Redis 深度面试题库》。
- **备考建议**：先画 JVM/并发/Spring 三张脑图，再对着高频题口述 1 分钟版 + 追问版，最后用 jstack/jstat/Arthas 实操验证。

> 祝面试顺利！知其然，更知其所以然。

