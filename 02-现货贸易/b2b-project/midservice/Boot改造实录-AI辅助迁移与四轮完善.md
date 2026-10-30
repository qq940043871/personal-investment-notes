# midservice Boot 化改造实录——AI 辅助迁移与四轮完善

> 本文是**过程实录**——AI 协作方式、决策链、方法论、坑与教训。

---

## 一、起点与目标

midservice 是自研 ylsoft 框架的大宗商品交易网关（1018 系统）：整个应用是一个
自举的 DispatcherServlet 子类链（ServiceServlet→CoreServlet→MVCServlet→
DispatcherServlet），Spring 4.3.24 ALL-in-one jar + 91 个遗留 jar，传统 WAR 由
外部 Tomcat 承载。目标两条：

1. **上云/容器化改造**：WAR → Spring Boot 可执行 war（JDK 8，`java -jar` 直跑）；
2. **容量与稳定性改造**：把《容量目标实现方案》《隔离设计》等文档中的改造项
   在网关侧落地（5 万 QPS + 1000 TPS 目标的网关侧部分）。

协作方式：AI 编码助手（ZCode）承担"读文档→反编译核实→方案设计→实施→冒烟
验证→记录"的完整闭环；人负责方向决策（升级到 2.7、改造范围取舍）与验收。

---

## 二、AI 辅助迁移：WAR → Boot 可执行 war（2026-10-25）

### 2.1 策略选择（AI 分析源码结构后给出）

AI 通读遗留框架源码后发现整个应用的加载结构，得出**最小侵入**策略：

- 只注册一个 `ServiceServlet`（load-on-startup=1），映射 `/`；
- 排除 Boot 自己的 DispatcherServlet/ErrorMvc/DataSource/Quartz 自动配置；
- Boot 上下文不扫描任何 `com.ylsoft.*` 包，与遗留上下文零共享；
- **零改动遗留 jar**——这条原则贯穿全程，后续所有 jar 内改造都走"影子类"而不是改 jar。

打包必须 war 不能 jar：JSP 编译、`getRealPath("/WEB-INF/classes/...")` 都需要
真实 docBase（AI 从遗留代码逐个核实了这两个硬依赖）。

### 2.2 版本路径：先 1.5 验证、再升 2.7

先做 **Boot 1.5.22** 验证可行性（Spring 4.3 线，兼容风险最小），跑通后再按
决策升级 **2.7.18**（Spring 5.3.31 + Tomcat 9.0.83），两版均实测通过。这个
"先老后新"的路径让升级问题被隔离在增量里。

### 2.3 升级 2.7 的五个坑（AI 逐个定位并修复）

| 坑 | 现象 | 处置 |
| --- | --- | --- |
| `C3P0NativeJdbcExtractor` | Spring 5.3 删除该类 | 核实无代码引用后从 applicationContext.xml 移除 bean |
| DataSourceAutoConfiguration | 探测 c3p0 时因 lib 里是**裁剪版 c3p0**（无 AbstractComboPooledDataSource）直接 CNFE 致命 | 排除 DataSource/事务/Quartz 自动配置 |
| API 包名迁移 | ErrorPage/WebServerFactoryCustomizer 等换了包 | 启动类按 2.7 包名重写 |
| commons-logging | Spring 5 的 spring-jcl 内置，再放真 jar 会重复类 | 移除显式依赖 |
| 3.0 版 XSD | 遗留 XML 引用旧 schema | 核实 Spring 5.3 jar 内 spring.schemas 有映射，无需改 |

升级前做了系统性兼容排查：**扫描全部 91 个遗留 jar 常量池引用的 105 个 Spring
类**，与 Spring 5.3.31 类清单做差集——只有 fastjson 里 spring-data-redis 的可选
引用缺失（本来就不在 classpath）。这个"常量池扫描差集"方法值得复用。

### 2.4 迁移验证口径

启动出现 `[][1018][启动完成]`；欢迎页 200、404/500 错误页渲染原 JSP、
`/etc/**` 静态资源 200、log4j 1.x 双输出。此口径沿用为后续每轮改造的回归基线。

---

## 三、AI 辅助完善：四轮改造实录（2026-10-25 ～ 10-26）

### 3.0 前置发现：MON/DS 配置失效与"影子类"方法论的诞生

Boot 化后联调发现：`[MON]连接失败.null` 每 5 秒重试、`DS初始化失败:host=null`。

AI 的定位路径（值得复用）：**行为差异 → 怀疑框架取配置路径 → javap 反汇编
`CoreServlet.getOuterConfigFilePath(String)` 字节码** → 发现原实现用
`HttpServlet.class.getResource("/")` 定位 classpath 根，**返回 null 时直接抛
RuntimeException**，后面的 `user.dir`/`catalina.home` 兜底目录永远走不到；
Boot WarLauncher 下该调用恰好返回 null。

改 zdsoft-core 源码不可行 → 诞生了本项目最重要的方法论——**classpath 影子类**：
用 ASM 把单个方法体替换为对兼容类的静态调用，产物 .class 放进
`src/main/resources`（→ WEB-INF/classes），按类加载顺序优先于 jar 内原类生效，
外部 Tomcat 部署形态同样有效。CoreServlet 补丁后 `[MON]连接成功.127.0.0.1:9999`
实连 midmon-ds，方法论得到验证，后续所有 jar 内改造都沿用。

同轮还挖出一个**配置文件名坑**：`ServiceServlet.getOuterConfigName()` 写死返回
`"1018_midservice"`——外部配置文件必须是 `lib/1018_midservice.properties`，
工作区原来的 `midservice.properties` 名字本来就是错的（查找规则
`<目录>/lib/<名>`，Boot 下实际生效 `<user.dir>/lib/`）。

### 3.1 第一轮：改造 0 容量配置 + 兜底探针（纯配置 + 零侵入 Filter）

- 容量配置：context-path=/midservice（解决配置文件名+URL 结构双问题，注意
  Git Bash 命令行传参会被 MSYS 路径转换弄坏，必须写进 application.properties）、
  Tomcat maxThreads=300/maxConnections=30000/acceptCount=2000、
  `-Dhttp.maxConnections=200`（Hessian 隐蔽硬约束）、DS 池
  maxCon=200/initCon=20/timeOut=3000（键名按 CoreUtils 反编译核实）。
- 兜底探针（设计文档 §2.2③）：`boot/probe/` 三个类——Filter 从 URL 提取协议
  （api:/toBack:前缀）、LongAdder 分钟桶本地聚合、30s 异步批量输出 JSON 到
  `logs/api-metrics.log`。调用线程零 IO，上报层异常静默丢弃。

### 3.2 第二轮：分协议舱壁/限流/熔断

对应隔离设计 §5/§7 的信号量隔离，Boot 侧零侵入：

- 判定序 = QPS 秒窗限流 → 三态熔断（分钟窗慢调用率/失败率达阈值且 ≥minCalls
  转 OPEN → openMillis 后半开放 2 个探测 → 成功闭合/失败回 OPEN）→ 每协议
  信号量并发上限；
- 拒绝响应保持网关原生 undone 报文（HTTP 200 + result=GB9999），客户端按业务
  错误处理；配置 `bulkhead.properties`（default.* + protocol.<协议号>.*）；
- 熔断判据用"慢调用+HTTP≥500+异常"——Filter 拿不到报文内业务成败码，且这正
  符合文档"识别慢而非错"的定位。

**验证方法论的一个教训**：curl 多进程并发测不出舱壁——curl 进程启动开销
(~30ms) 大于请求耗时(2-5ms)，信号量永不竞争；改用 Java 多线程+CyclicBarrier
同时发起，maxConcurrent=1 时 30 线程 passed=1 / rejected=29，精确生效。

### 3.3 第三轮：主探针影子 HandlerController + 去锁 + 真 bug

- **影子 HandlerController**：反编译源码经确定性重建脚本
  （`tools/patcher/build-handlercontroller-shadow.py`）生成，**24 组替换全部带
  命中数断言**（失配即失败、可重跑可审计）。修复 8 类 JD-Core 伪影（全部对照
  javap 核实）：非 ASCII 变量名 4 处、多余/冲突 import 3 条（Security.Token 与
  bean.Token 二义性）、MCallable 构造器被丢首参、execute 内 8 处重复 `rtn` 声明、
  裸迭代泛型、NewCookie super 参数等。埋点三处：缓存命中 incrCacheHit（量化
  缓存收益）、两处 call() 的 incrExecuteStart/Finish（在途数+机构维度）。
- **去锁**：`DSUtils.getClient`（static synchronized 只读一个字段、135 调用点
  串行）→ ASM **清除 ACC_SYNCHRONIZED 标志**（方法体零改动）；`ShardedReidsPool`
  影子类（快路径锁外借连接）。**核实发现**：文档说的第三处全局锁
  （ConnectPool.releaseConnection）在本版字节码里不存在——文档描述与 v1.3.4
  不符，如实记录不盲改。
- **真 bug 实锤**：`ShardedReidsPool.getIntValue` 字节码恒读字面量 `"key"`，
  MAXTOTAL/MAXIDLE/MAXWAITMILLIS 配置**从未生效过**（文档观察到"MAXIDLE 恒为 5"
  的根因）。影子版修复并按建议把 MAXIDLE 默认 5→50。

### 3.4 第四轮：隔离设计 §八 瓶颈清单扫尾

| 瓶颈 | 核实 | 处置 |
| --- | --- | --- |
| 路由 O(n) 线性扫描（1296 协议 × 每请求 2 次） | 属实 | 影子 HandlerController 加 routerByProtocol/routerByRestfull 双索引（putIfAbsent 保"首命中"语义，volatile 原子换新） |
| 敏感词 Trie 每次重建 | **属实且更重**：`getInstance()` 每次 new → 每请求一次 `getRedisInfo("1001_INFO","SENSITIVE")` **同步网络往返** + 全量 Trie 重建 | 真单例 + 定时刷新（默认 300s，刷新失败留旧表、首载失败 fail-open 同原行为）+ 命中 break |
| 池耗尽 → 关整池 → 递归重试雪崩 | 属实（`BIOSocketConnectManager` 无界递归） | 影子类：有界重试（重建至多 1 次 + 50ms 退避） |
| per-user 锁跨整个远程调用 | 核实为**配置驱动**（is.open.syncLock + 注册表 syncLock），承担防同一用户重复提交的业务语义 | **有意不改**（收窄=业务决策），生产放宽改配置即可 |
| DSUtils.revert 序列化往返 ×113 | 属实 | **有意不做**：deep-copy 是 113 个调用点的正确性底线，GC 收益配不上影子化风险，留待 CPU 剖析 |

### 3.5 每轮的固定动作（节奏）

每轮都走同一闭环：**文档论断 → javap 字节码核实 → 实施（影子/配置）→ 构建 →
冒烟（启动全绿 + 请求响应与改前逐字节对比）→ README 章节 + 长期记忆同步**。
四轮下来，请求行为回归零破坏。

---

## 四、方法论沉淀（给下一个类似工程）

### 4.1 jar 内代码改造的两种影子模式

| 模式 | 适用 | 本工程实例 |
| --- | --- | --- |
| **ASM 单方法补丁/标志清除** | 改动可收敛到一个方法体或方法修饰符 | CoreServlet.getOuterConfigFilePath（方法体替换为静态调用）、DSUtils.getClient（清 ACC_SYNCHRONIZED，方法体零改动） |
| **反编译源码清洗 → 全类影子** | 改动点多/分散，或有源码可用 | HandlerController（2585 行，24 组断言替换）、ShardedReidsPool、SensitivewordFilter、BIOSocketConnectManager |

影子类放 `src/main/java`（→WEB-INF/classes）或 `src/main/resources`（直接放
.class），类加载顺序保证优先于 `WEB-INF/lib` 内原类，两种部署形态（Boot 可执行
war / 外部 Tomcat）都成立。

### 4.2 确定性重建脚本

全类影子不由手工编辑产生，而是**脚本从反编译源确定性生成**：每处替换断言精确
命中次数，任何失配立即失败。好处：可重跑、可审计、diff 可读、改需求时改脚本
而非改产物。

### 4.3 不信文档，信字节码

四轮中与文档不符的实证三处：`ConnectPool.releaseConnection` 全局锁（v1.3.4 无）、
`PubConfigCache` 类（本版 jar 不存在）、`ShardedReidsPool.getIntValue` 真 bug
（文档只观察到症状）。**每条论断用 javap 反汇编核实**是本轮最有效的纠错手段。

### 4.4 行为等价验证

每轮冒烟必做：同一请求改前/改后响应逐字节对比；启动日志按固定口径
（MON 连接成功 / 启动完成 / 无 NoClassDefFound）；错误行逐条定性（环境性 vs
回归）——dev 环境 `API未初始化`（缺 `1018_midservice_api.json` 协议注册表）、
DS 引导失败、Redis 关闭均为已知环境项。

---

## 五、坑与教训清单

1. **Boot 可执行 war 下 `getResource("/")` 返回 null**——大量自研框架靠它定位
   classpath 根，这是 WAR→Boot 最常见的隐性破坏点。
2. **配置文件名与查找规则藏在框架字节码里**（`1018_midservice.properties`、
   `<user.dir>/lib/`），不反汇编根本无从知晓。
3. **Git Bash 传 `--server.servlet.context-path=/midservice` 会被 MSYS 路径转换
   弄坏**，此类参数写进 application.properties。
4. **裁剪版第三方 jar（c3p0）会让 Boot 自动配置的条件探测直接致命**，排除自动
   配置是唯一解。
5. **cmd 批处理文件用 Write/Edit 工具编辑容易引入编码/行尾问题**（中文注释+
   LF/CRLF 混排会让 cmd 解析成乱命令），脚本尽量 ASCII，或直接在 bash 里跑。
6. **行号手术不可靠，模式断言才可靠**——对大文件做行级 sed 修补多次翻车，最终
   全部改为"模式+命中数断言"的确定性脚本。
7. **LongAdder 没有 incrementAndGet**（限流计数要 CAS 语义时用 AtomicInteger）。
8. **curl 多进程并发测不出毫秒级资源的竞争**，要用进程内多线程+CyclicBarrier。
9. **war 文件被运行中的 java 进程锁住会让 mvn repackage 静默失败**——重建前先
   清理冒烟进程（且要精确识别，别误杀机器上其他 java 服务）。
10. **反编译代码的 `???` 变量名、重复声明、多余 import 都是常见伪影**，逐条对照
    javap 核实后再改，避免把真语义改掉。

---

## 六、产物清单

**Boot 工程（D:\ai_work\p002_source_read\midservice）**

- 启动壳与注册：`src/main/java/boot/MidServiceApplication.java`（Servlet/错误页/
  探针 Filter/舱壁 Filter 注册）
- 兼容与探针：`boot/compat/OuterConfigPath`、`boot/probe/{ApiMetricsProbe,
  MetricsProbeFilter,MetricsReporter}`、`boot/bulkhead/{BulkheadFilter,
  ProtocolBulkhead,BulkheadConfig}`
- 影子类：`com/ylsoft/ooo/core/web/servlet/CoreServlet.class`（resources）、
  `com/ylsoft/mid/service/utils/DSUtils.class`（resources）、
  `com/ylsoft/mid/service/controller/HandlerController.java`、
  `com/ylsoft/ds/api/client/redis/ShardedReidsPool.java`、
  `com/ylsoft/mid/service/utils/sensitive/SensitivewordFilter.java`、
  `com/ylsoft/ds/api/client/core/BIOSocketConnectManager.java`
- 配置：`application.properties`（context-path+Tomcat 容量）、
  `lib/1018_midservice.properties`（mon.*+ds.*）、`bulkhead.properties`、
  `log4j.properties`（+API_METRICS 通道）、`run.cmd`/`run.sh`（http.maxConnections）
- 工具：`tools/patcher/{patch-core-servlet.cmd, PatchCoreServlet.java,
  DesyncMethods.java, build-handlercontroller-shadow.py}`

**文档**：工程内 `README-SPRINGBOOT.md`（四轮技术记录）+ 本实录。

**未竟事项归属**（详见 README 收口表）：读 Redis 直连接线、三级缓存配置下发、
dataShare worker 池/撮合 Netty → dataShare 侧；WebSocket 事件驱动 → 前端+dataShare；
水平扩展+LB → 运维；探针换 Kafka → 可选；线程池隔离+AsyncContext → 压测不达标时。

---

*本实录由 AI 编码助手（ZCode）根据工程记录与长期记忆整理，全部关键论断均可
通过工程内工具（javap 反汇编对照、确定性重建脚本断言）复现验证。*
