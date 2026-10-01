# Tomcat 深度面试题库

> 全栈架构师 · 面试考点全覆盖
> 覆盖 15 大章节 80 题：基础认知 → 架构体系 → 生命周期 → 线程模型 → 请求链路 → 容器体系 → Servlet 原理 → Session 机制 → 类加载器 → JSP 原理 → 性能调优 → 故障排查 → 安全加固 → 集群高可用 → 场景题与源码进阶。

---

## 01 基础认知与架构

### 1.1 Tomcat 是什么？和 Web 服务器、Servlet 容器的关系是什么？【高频】
**Tomcat** 是 Apache 基金会下的开源项目，是一个 **Servlet 容器（Servlet Container）** + **HTTP 服务器**。它实现了 Java EE（现 Jakarta EE）的 Servlet 规范、JSP 规范、EL 规范和 WebSocket 规范。

三者关系：
- **Web 服务器**：只负责处理静态资源 + HTTP 协议（如 Nginx、Apache）。
- **Servlet 容器**：负责管理 Servlet 生命周期、请求分发、Session、类加载等，是 Web 服务器能力的"Java 化"扩展。
- **Tomcat = 两者合一**：既能处理静态资源，又能运行动态 Servlet/JSP 应用。

> 加分点：Tomcat 不是完整 Java EE 服务器——它**不包含 EJB、JTA、JMS** 等企业级组件。需要时配 GlassFish / WildFly 或把 EJB 替换为 Spring。

### 1.2 Tomcat 的整体架构：Coyote + Catalina 分别是什么？【高频】
Tomcat 由两大部分组成：

| 组件 | 职责 | 本质 |
|---|---|---|
| **Coyote** | 连接器框架，负责 HTTP/AJP 协议解析、Socket 管理 | 与协议打交道，不关心业务 |
| **Catalina** | Servlet 容器，负责 Servlet 生命周期、请求路由、Session | 与业务规范打交道 |

- Coyote 处理完协议后，把 Request/Response 交给 **CoyoteAdapter** 适配成 HttpServletRequest/Response，再进入 Catalina。
- 二者通过 **Connector**（连接器）衔接。

> 加分点：这种"协议层与容器层解耦"的设计让 Tomcat 能灵活切换协议——HTTP/1.1、HTTP/2、AJP 甚至自定义协议，而 Catalina 完全无感。

### 1.3 server.xml 的核心组件层级：Server / Service / Connector / Engine / Host / Context【高频】
server.xml 是一个**树形结构**，层级如下：

```
Server（整个 Tomcat 实例，监听 8005 shutdown 端口）
 └── Service（逻辑服务分组，可多个）
      ├── Connector（连接器：8080 HTTP、8009 AJP）
      └── Engine（引擎，处理该 Service 的所有请求）
           └── Host（虚拟主机：localhost，对应域名）
                └── Context（Web 应用上下文，对应一个 webapp）
                     └── Wrapper（Servlet 包装器，一个 Servlet 一个 Wrapper）
```

- **Server**：最顶层，负责管理全局资源、生命周期，通过 shutdown 端口接收关闭指令。
- **Service**：由 1+ 个 Connector 和 1 个 Engine 组成，Connector 接收的请求都交给这个 Engine。
- **Engine**：请求处理入口，做虚拟主机路由。
- **Host**：虚拟主机，按 Host 请求头匹配，对应域名和 appBase 目录。
- **Context**：一个 Web 应用，对应 `webapps/xxx` 目录或一个 war 包。
- **Wrapper**：每个 Servlet 一个，管理 Servlet 实例。

> 追问：请求进来是怎么定位到 Context 的？→ 由 **Mapper** 组件根据 URL + Host 头做匹配，见 4.3 题。

### 1.4 一次请求在容器中的完整"旅程"分哪几步？【高频】
1. 客户端发起 HTTP 请求到 8080 端口。
2. **Connector** 的 Acceptor 线程 accept 连接。
3. Poller 检测到可读事件，把任务交给工作线程。
4. **Http11Processor** 解析请求行/请求头/请求体，生成 Request/Response 对象。
5. **CoyoteAdapter.service()** 把 Coyote 的 Request/Response 转换为 Servlet 规范的 Request/Response。
6. **Engine → Host → Context → Wrapper** 逐级 Pipeline/Valve 处理。
7. Mapper 定位到具体的 Servlet。
8. 执行 **Filter 链**，最后调用 **Servlet.service()**。
9. 响应逆序返回，连接按 keep-alive 策略复用或关闭。

> 加分点：第 2~4 步属于 **Coyote 层**，第 6~8 步属于 **Catalina 层**，面试时分层描述会显得体系清晰。

### 1.5 Tomcat 与 Jetty、Undertow 的对比【进阶】

| 维度 | Tomcat | Jetty | Undertow |
|---|---|---|---|
| 重量级 | 较重，功能全 | 轻量，可裁剪 | 最轻量，性能极致 |
| Servlet 规范 | 最权威的参考实现 | 支持较新 | 支持较新 |
| 默认 IO | NIO | NIO | NIO（XNIO） |
| 内存占用 | 较大 | 中等 | 最小 |
| 典型场景 | 企业级传统应用 | 嵌入式/微服务 | 高并发微服务 |

- Spring Boot 默认内嵌 **Tomcat**，可一键切换为 Jetty/Undertow。
- Undertow 在极限压测下吞吐常优于 Tomcat，但 Tomcat 生态和兼容性最稳。

> 加分点：Spring Boot 2.x 默认 Tomcat 9（Servlet 4.0），Spring Boot 3.x 默认 Tomcat 10.1（Servlet 6.0 / jakarta）。

---

## 02 生命周期与启动流程

### 2.1 Tomcat 的启动流程（Bootstrap → Catalina → 容器）【高频】
1. 入口脚本 `startup.sh` → 执行 `org.apache.catalina.startup.Bootstrap#main`。
2. Bootstrap 创建 **Catalina** 实例，通过反射加载（类加载器初始化）。
3. Catalina 解析 **server.xml**（Digester 解析成对象树）。
4. 触发 Server 的 `init()` → 层层向下初始化 Service → Engine → Host → Context（**自上而下 init**）。
5. 再触发 `start()`（**同样自上而下 start**）。
6. 等待请求；JVM 注册 shutdown hook 用于优雅停机。

> 加分点：整个容器实现统一的 **Lifecycle 接口**（见 2.2），所以 init/start/stop/destroy 的顺序天然一致——先父后子初始化，先子后父销毁。

### 2.2 Lifecycle 接口与状态机【进阶】
Tomcat 所有核心组件都实现 `org.apache.catalina.Lifecycle`：
- 核心方法：`init()` → `start()` → `stop()` → `destroy()`。
- 状态机：NEW → INITIALIZING → INITIALIZED → STARTING_PREP → STARTING → STARTED → STOPPING_PREP → STOPPING → STOPPED → DESTROYING → DESTROYED → FAILED。
- 状态变更会广播 **LifecycleEvent**，组件通过实现 `LifecycleListener` 监听并做出响应（如 Context 启动后触发 Web 应用部署）。

> 加分点：启动失败时状态会进入 FAILED 并抛出 LifecycleException，这是"为什么 Tomcat 启动报错时能看到一大串 Caused by"的原因——每层组件都在 init/start 上包了异常。

### 2.3 Digester 如何把 server.xml 变成对象？【进阶】
- Tomcat 使用 Apache Commons **Digester** 解析 server.xml。
- 规则（rule）定义在 `conf/server.xml` 旁边的 `catalina` 的 digester 规则中，如 `addObjectCreate("Server", "org.apache.catalina.core.StandardServer")`。
- 每遇到一个元素就创建对应对象、调用 setter、按父子关系组装。
- 好处：**无需手工写解析代码**，新增配置元素只需加规则。

> 追问：为什么不用 JAXB？→ 历史原因 + Digester 对"多个同名元素按不同规则处理"更灵活；现代版本内部逻辑依然沿用该设计。

### 2.4 Tomcat 9 / 10 / 10.1 的区别与 jakarta 迁移【高频】
| 版本 | Servlet 规范 | 关键变化 |
|---|---|---|
| Tomcat 8.5 | Servlet 3.1 | 默认 NIO，移除 BIO（9.0 正式移除） |
| Tomcat 9.0 | Servlet 4.0 | 支持 HTTP/2，支持 WebSocket 1.1 |
| Tomcat 10.0 | Servlet 5.0 | **javax.servlet → jakarta.servlet** 命名空间迁移 |
| Tomcat 10.1 | Servlet 6.0 | 要求 Java 11+，Spring Boot 3 内置 |

- Tomcat 10 起不再兼容旧 `javax.*` 包名，老项目迁移需全局替换 import 或使用迁移工具。
- Spring Boot 3.x 必须用 Tomcat 10.1+，因为已全面切换到 jakarta。

> 加分点：`javax.servlet` 属于 Java EE（Oracle 维护），`jakarta.servlet` 属于 Jakarta EE（Eclipse 基金会维护）。Oracle 收回 javax 命名空间后，整个 Java EE 生态迁往 jakarta。

### 2.5 Spring Boot 内嵌 Tomcat 与独立 Tomcat 部署的区别【高频】
| 维度 | 独立 Tomcat | 内嵌 Tomcat（Spring Boot） |
|---|---|---|
| 部署物 | war 包丢 webapps | 可执行 fat jar |
| 启动 | 启动脚本 | java -jar |
| 类加载器 | 独立 WebappClassLoader | 单一应用类加载器 |
| 配置 | server.xml / web.xml | application.yml（server.xxx） |
| 运维 | 独立进程管理 | 进程即应用，便于容器化 |

- Spring Boot 内嵌 Tomcat 时，`TomcatServletWebServerFactory` 以编程方式创建 Connector/Context。
- war 包方式部署时，需实现 `SpringBootServletInitializer`，由外部 Tomcat 启动。

> 加分点：内嵌模式没有标准 WebappClassLoader 的多应用隔离，所以一个 JVM 只能跑一个应用——这也是微服务"一个进程一个应用"的天然基础。

---

## 03 Connector 与线程模型

### 3.1 四种 I/O 模型：BIO / NIO / NIO2 / APR【高频】
Tomcat Connector 支持四种协议处理器（protocol）：

| 协议 | 全称 | 特点 | 状态 |
|---|---|---|---|
| BIO | Blocking IO | 一个连接一个线程，高并发下线程爆炸 | 8.5 废弃，9.0 移除 |
| NIO | Non-blocking IO | 多路复用，Poller 轮询，默认 | **8.5+ 默认** |
| NIO2 | Async IO | AIO 回调模型，Windows 上支持较好 | 可选（非默认） |
| APR | Apache Portable Runtime | 基于 C 原生库（tcnative），sendfile/SSL 加速 | 需装 native 库 |

- 8.5 之前默认 BIO（每连接一线程），8.5 起默认 NIO。
- 配置方式：`protocol="org.apache.coyote.http11.Http11NioProtocol"` 或简写 `protocol="HTTP/1.1"`。

> 加分点：NIO 之所以成为主流，是因为**连接数可以远大于线程数**——线程只在线程池内复用，连接由 Poller 统一监听就绪事件。

### 3.2 NIO 的 Acceptor / Poller / Worker 三线程模型详解【高频】
这是 Tomcat 面试的**必考源码点**。NioEndpoint 内部有三类线程：

```
Acceptor（默认1个）  accept 新连接
      │  注册 SocketChannel
      ▼
Poller（默认2个）    Selector 多路复用，监听 OP_READ/OP_WRITE
      │  就绪事件 → 包装成 SocketProcessor
      ▼
Worker（线程池）    Http11Processor 解析请求并调用 Servlet
```

1. **Acceptor**：一个循环线程，`ServerSocketChannel.accept()` 接收新 TCP 连接，把 SocketChannel 注册进 Poller 的事件队列（PollerEvent）。
2. **Poller**：每个 Poller 持有一个 Selector，`select(1000)` 轮询就绪事件，把可读/可写的 Socket 包装成 `SocketProcessor` 提交给 Worker 线程池。
3. **Worker**：线程池中的线程执行 SocketProcessor.run()，即走 Http11Processor 解析请求 → 容器处理 → 写响应。

> 加分点：**Acceptor 只负责 accept，Poller 只负责"监听就绪"，真正的协议解析和业务都在 Worker 线程池**。三者通过无锁队列/并发队列解耦，这是 Tomcat 支撑高并发的核心设计。

### 3.3 maxThreads / maxConnections / acceptCount 三者的区别【高频】
这是最容易混淆的一组参数：

| 参数 | 默认值 | 含义 | 超限表现 |
|---|---|---|---|
| `maxThreads` | 200 | 工作线程池最大线程数 | 线程耗尽 → 任务排队 |
| `maxConnections` | 8192（NIO） | 连接器同时接受的最大连接数 | 新连接进 accept 队列等待 |
| `acceptCount` | 100 | OS 层 accept 队列（backlog）长度 | 队列满 → 拒绝连接（Connection refused） |

- **maxConnections 是"连接"层面的闸门，maxThreads 是"处理"层面的闸门**。连接数可以远大于线程数（NIO 下连接不占线程）。
- 请求流程：连接数 < maxConnections 直接接受；≥ maxConnections 时新连接排入 acceptCount 队列；队列满后内核拒绝。

> 追问：BIO 下三者关系？→ BIO 一个连接占一个线程，所以 maxConnections 实际受 maxThreads 限制，这也是 BIO 必须被淘汰的原因。

### 3.4 Tomcat 为什么不用 JDK 自带 ThreadPoolExecutor？【进阶】
Tomcat 自己实现了 `org.apache.tomcat.util.threads.ThreadPoolExecutor`，核心区别在**任务队列**：

- JDK 默认策略：core 线程满 → **先入队**（无界/有界队列）→ 队列满才扩线程。Web 场景下会导致**排队延迟被放大**。
- Tomcat 的 `TaskQueue`（继承 LinkedBlockingQueue）重写了 `offer()`：
  - 当前线程数 < maxThreads 时 → **返回 false，强制线程池新建线程**；
  - 线程数达到 maxThreads 后 → 才真正入队等待。
- 效果：**先用满线程，再排队**。这是 Tomcat 为了降低请求延迟的刻意设计。

> 加分点：如果线程池满且队列满，会抛 RejectedExecutionException，Tomcat 对连接返回 503 并断开——压测时看到大量 503，先查这三个参数。

### 3.5 keep-alive 的原理与参数【高频】
HTTP keep-alive 让**同一个 TCP 连接复用处理多个请求**，避免反复三次握手/慢启动。

关键参数：
- `keepAliveTimeout`：空闲连接多久关闭，默认等于 connectionTimeout（8.5+ 默认 60s）。
- `maxKeepAliveRequests`：一个连接最多处理多少个请求后关闭，默认 100（HTTP/1.1）。
- `connectionTimeout`：建立连接后等待首个请求的时间，默认 60s。

> 加分点：keep-alive 能显著提升 HTTPS 性能（省去 TLS 握手）；但**长连接会占用连接数上限**，maxConnections 需要相应调大。大量 keep-alive 空闲连接被 NIO 的 Poller 挂起（不占线程），这也是 NIO 能扛高连接数的原因。

### 3.6 NIO 与 BIO 在"一个请求一个线程"上的本质差异【进阶】
- BIO：Socket 阻塞读 → 每 accept 一个连接就必须分配一个线程 → 10000 连接 = 10000 线程，线程切换开销 + 栈内存爆炸（默认线程栈 1MB，10000 线程 ≈ 10GB 虚拟内存）。
- NIO：连接不阻塞线程，只有"数据就绪"的 Socket 才被提交给线程池 → **10000 连接 ≈ 几十个线程**。

> 追问：那 NIO 下为什么还会线程打满？→ 线程打满说明**同时就绪且处理中的请求太多**，即业务处理太慢（慢 SQL、外部调用阻塞），而不是连接太多。排查方向完全不同。

### 3.7 NIO2（AIO）与 NIO 的区别，为什么 Tomcat 默认不用 NIO2？【进阶】
- NIO2 基于操作系统异步 IO 回调：发起读后线程立即返回，内核完成后再回调。
- 优势：读写阶段也不占用线程。
- 劣势：Linux 上 AIO 实现（io_uring 之前）表现不稳定，JDK 的 AIO 在 Linux 下常退化为阻塞模拟；API 复杂。
- Tomcat 默认 NIO 的原因：**NIO 的多路复用已经足够高效**（就绪事件驱动的阻塞读只占线程极短时间），且生态最成熟。

> 加分点：现代高并发服务端（如 Netty）同样默认 NIO 多路复用而非 AIO，原因一致。

### 3.8 Connector 常用属性总览【基础】
```xml
<Connector port="8080"
           protocol="org.apache.coyote.http11.Http11NioProtocol"
           connectionTimeout="30000"
           maxThreads="400"
           minSpareThreads="40"
           maxConnections="10000"
           acceptCount="200"
           keepAliveTimeout="15000"
           maxKeepAliveRequests="100"
           maxHttpHeaderSize="8192"
           compression="on"
           compressionMinSize="2048"
           URIEncoding="UTF-8"/>
```

- `minSpareThreads`：核心线程数（默认 10）。
- `maxHttpHeaderSize`：请求头上限 8KB，防止恶意超大请求头。
- `compression`：响应压缩（gzip），CPU 换带宽。

> 加分点：配置 Connector 时记住"**连接参数（maxConnections/acceptCount/connectionTimeout）与线程参数（maxThreads/minSpareThreads）分开调**"的思维模型，面试回答更有层次。

---

## 04 HTTP 请求处理完整流程

### 4.1 从 Socket 到 Servlet 的完整源码级链路【高频】
```
SocketChannel (OS)
  → Acceptor.accept()                       // NioEndpoint
  → PollerEvent 入队 → Poller.select()      // 多路复用
  → SocketProcessor.run() → 提交 Worker 线程池
  → Http11Processor.service()               // Coyote: 协议解析
  → Http11InputBuffer 解析请求行/头/体
  → CoyoteAdapter.service(request, response)// 适配 Servlet API
  → Mapper.map()                            // 路由定位
  → Engine.pipeline → Host.pipeline → Context.pipeline → Wrapper.pipeline
  → ApplicationFilterChain.doFilter()       // Filter 链
  → Servlet.service() → 业务代码
  → 响应逆序写回 → NioSocketWrapper 注册 OP_WRITE → 完成
```

> 加分点：面试能一口气说出这条链上每个环节的类名（Acceptor、Poller、Http11Processor、CoyoteAdapter、Mapper、Pipeline、ApplicationFilterChain），是"真看过源码"的最有力证明。

### 4.2 Http11Processor 是如何解析 HTTP 请求的？【进阶】
- 复用 `Http11InputBuffer`，通过 **`HttpParser`** 逐个字符解析：请求行（方法+URI+版本）→ 请求头（到 `\r\n\r\n`）→ 请求体（按 Content-Length 或 chunked 编码）。
- 解析完请求头后立即回调 `prepareRequest()` 填充 Request 对象；请求体**懒加载**（需要时才读取）。
- 解析失败（如 400 非法请求行）直接返回错误并关闭连接。
- `maxHttpHeaderSize` 超限 → 431/400。
- 解析采用**直接操作字节数组**的方式，避免不必要的 String 转换，性能优化到极致。

> 加分点：Header 解析是逐字节扫描冒号分隔，请求体支持 chunked 分块传输，都发生在进入 Servlet 之前——所以自定义 Filter 里读 body 时其实已经"消费"过一次了。

### 4.3 Mapper 路由：如何根据 URL 定位到 Servlet？【高频】
Mapper 是 Tomcat 的高性能路由组件：
1. 根据 **Host 请求头** 匹配虚拟主机（MappedHost）。
2. 解析 URI 的 **Context Path** 前缀匹配 Web 应用。
3. 在 Context 内按规则匹配 Wrapper（Servlet 映射）：
   - **精确匹配** `/login`；
   - **最长路径前缀** `/user/*`；
   - **扩展名匹配** `*.do`；
   - **默认 Servlet** `/`（兜底）。
4. 匹配过程使用**排序数组 + 二分查找**（不是 Map 遍历），O(logN) 级别。

> 追问：找不到匹配时怎么办？→ 走默认 Servlet（DefaultServlet 返回 404）；若连默认都没有则 404。Context 未部署则 404。

### 4.4 Pipeline / Valve 责任链模式【进阶】
- 每个容器（Engine/Host/Context/Wrapper）内部有一条 **Pipeline**（管道），管道上有多个 **Valve**（阀门）。
- 请求按 `Engine Valve → Host Valve → Context Valve → Wrapper Valve → 目标 Servlet` 依次经过。
- 核心 Valve：
  - **AccessLogValve**：访问日志。
  - **ErrorReportValve**：错误页。
  - **RemoteAddrValve / RemoteHostValve**：IP 访问控制。
  - **StandardWrapperValve**：真正加载并调用 Servlet 的阀门。
- 每个 Valve 执行后可以决定 `continue` 或中断（比如拒绝访问直接返回）。

> 加分点：Valve 是**容器级**的拦截，Filter 是**应用级**的拦截——Valve 在 Filter 之前执行，且不依赖 Servlet 规范，可做容器层的鉴权/限流。

### 4.5 Filter 的执行时机与责任链细节【高频】
- Filter 在 Servlet 之前执行，按 **web.xml 声明顺序**（或 `@WebFilter` + FilterRegistrationBean 顺序）组成链。
- 每个 Filter 调用 `chain.doFilter()` 放行，否则中断（可做鉴权短路）。
- Filter 可以**包装 request/response**（如 `HttpServletRequestWrapper` 实现 body 缓存、XSS 过滤）。
- 生命周期：`init()`（应用启动）→ 每次请求 `doFilter()` → 应用卸载 `destroy()`。

> 加分点：Filter 的典型用途：日志、鉴权、编码设置、GZIP、XSS/SQL 注入过滤、请求日志。它与 Spring MVC 的 Interceptor 的区别：Filter 在 Servlet 容器层（Servlet 之前），Interceptor 在 Spring MVC 层（Handler 之前）。

---

## 05 Catalina 容器体系

### 5.1 Engine / Host / Context / Wrapper 四级容器各自的职责【高频】
| 容器 | 职责 | 典型配置 |
|---|---|---|
| Engine | 请求总入口，路由到 Host | name="Catalina" |
| Host | 虚拟主机，按域名分流 | name="localhost" appBase="webapps" |
| Context | Web 应用边界，类加载器/ Session 管理器/资源都在此 | path="/app" docBase="xxx" |
| Wrapper | 单个 Servlet 的包装，管理实例与映射 | load-on-startup、asyncSupported |

- 一个请求只会经过**一条**确定的容器链：Engine → 某个 Host → 某个 Context → 某个 Wrapper。
- 每级容器都有自己独立的 Pipeline（见 4.4）。

> 加分点：Context 是资源隔离的最小单元——**每个 Context 有独立的 WebappClassLoader、SessionManager、ServletContext**，这也是为什么两个应用部署在同一个 Tomcat 里互不干扰。

### 5.2 Context 的配置方式与部署【基础】
- 目录式部署：`webapps/xxx/` 或 `webapps/xxx.war`（自动解压）。
- `conf/server.xml` 中显式 `<Context path docBase>`。
- `conf/Catalina/localhost/xxx.xml` 配置文件（推荐，热部署友好）。
- 参数：`autoDeploy="true"`、`reloadable="true"`（类变更自动重载）、`unpackWAR`、`sessionCookiePath`。

> 加分点：生产环境**不要**开 reloadable（重载会触发类加载器重建，易造成内存泄漏与请求中断），用热部署工具（如 Spring Boot DevTools / 构建脚本）替代。

### 5.3 Web 应用目录结构与 web.xml 的作用【基础】
```
webapp/
├── WEB-INF/
│   ├── web.xml          # 部署描述符（Servlet/Filter/Listener 声明）
│   ├── classes/         # 编译后的 class
│   └── lib/             # 应用依赖 jar
├── META-INF/
└── 静态资源（html/js/css/图片）
```

- Servlet 3.0+ 支持**注解扫描**（`@WebServlet`/`@WebFilter`/`@WebListener`），web.xml 可部分省略。
- `metadata-complete="true"` 时跳过注解扫描，加速启动。
- 现代 Spring Boot 项目已基本不使用 web.xml，改用编程式注册。

> 加分点：`WEB-INF` 下的文件**对外不可直接访问**，只能通过 Servlet 内部转发——这是安全边界。

### 5.4 虚拟主机（Host）与多域名部署【进阶】
- 一个 Engine 下可配置多个 Host，通过请求的 Host 头区分。
- 例：
```xml
<Engine name="Catalina" defaultHost="localhost">
  <Host name="localhost" appBase="webapps"/>
  <Host name="www.example.com" appBase="webapps2"/>
</Engine>
```
- 未匹配到任何 Host 时走 `defaultHost`。
- 配合 Nginx 时，通常由 Nginx 按 server_name 分流，Tomcat 只需一个 Host。

> 加分点：Host 的 name 匹配发生在 **Mapper 层**，基于请求头而非 DNS——所以用 IP + Host 头也能命中指定虚拟主机（常用于压测时指定 Host 头）。

### 5.5 StandardEngine / StandardHost 等核心实现类【进阶】
- `StandardServer` → `StandardService` → `StandardEngine` → `StandardHost` → `StandardContext` → `StandardWrapper`。
- 每个容器都有对应 Manager：Context 有 `Manager`（Session 管理）、`Loader`（类加载）、`Resources`（静态资源）、`Realm`（认证）。

> 加分点：看到"Standard"前缀的类基本就是 Tomcat 对规范接口的标准实现；面试提到 `StandardContext` 的 reloadable 重载原理、`StandardWrapperValve` 的 Servlet 实例化逻辑，都能体现源码功底。

---

## 06 Servlet 生命周期与线程安全

### 6.1 Servlet 的生命周期：init / service / destroy【高频】
```
加载 → 实例化（构造）→ init() → 处理请求 service() ×N → destroy() → 卸载
```

- **init()**：只调用一次。首次请求时触发，或 `load-on-startup` 指定启动时加载。可读取配置、初始化连接池。
- **service()**：每次请求调用。按方法分发到 `doGet/doPost/doPut/doDelete`。
- **destroy()**：容器关闭/应用卸载时调用一次，释放资源。
- 一个 Servlet 默认**只有一个实例**（单例多线程模型）。

> 追问：为什么 Servlet 是单例？→ Servlet 规范规定容器为每个 Servlet 只维护一个实例以节省内存，多线程并发调用 service()，所以 Servlet 默认**线程不安全**，实例字段要慎用。

### 6.2 load-on-startup 的作用【基础】
- web.xml：`<load-on-startup>1</load-on-startup>`。
- 正数：启动时按数值**从小到大**依次初始化；负数或不配置：首次访问时才初始化。
- 用途：启动时预加载重量级 Servlet（如初始化数据、连接池）。

> 加分点：Spring MVC 的 DispatcherServlet 配置 load-on-startup=1，就是为了让 Spring 容器在启动阶段就初始化完毕。

### 6.3 Servlet 线程安全问题如何解决？【高频】
Servlet 单例 + 多线程并发调用，出现线程安全问题的根源是**实例字段**（成员变量）。

解决方式：
1. **不要用可变实例字段**——局部变量是线程安全的。
2. 必须共享状态时用 **ThreadLocal**（注意 remove 防泄漏）或原子类。
3. 用锁/同步块（降低并发度，慎用）。
4. 把状态放到 Session/Request 作用域（本身按用户隔离）。

> 加分点：典型面试陷阱——"Servlet 是线程安全的吗？"答案：**Servlet 本身线程安全（容器保证实例唯一且方法调用不共享），但业务代码若用了共享可变状态则不安全**。

### 6.4 三大作用域：request / session / application【基础】
| 作用域 | 存活时间 | 实现 | 典型用途 |
|---|---|---|---|
| request | 一次请求 | HttpServletRequest | 请求内传递参数 |
| session | 一个会话 | HttpSession | 登录态、购物车 |
| application | 应用生命周期 | ServletContext | 全局配置、缓存 |

- 传递方向：request 可向上读 session/application；反之不行。

> 加分点：Spring 的 Bean Scope（singleton/prototype/request/session）就是在这个体系上的扩展——Spring MVC 中 request/session 作用域 Bean 底层用 AOP 代理从当前请求中取。

### 6.5 Servlet 3.0 异步处理（AsyncContext）【进阶】
Servlet 3.0 引入异步处理，解决**长耗时任务占用工作线程**的问题：

```java
AsyncContext ctx = request.startAsync();
// 释放当前请求线程，另开线程处理
executor.execute(() -> {
    // 耗时业务
    ctx.dispatch("/result");  // 或直接 getResponse().getWriter().write(...)
    ctx.complete();
});
```

- 配合 `asyncSupported=true`（注解或 web.xml）。
- 注意：**不是给业务并发加速**，而是让 Servlet 线程不被长任务占死，提高连接利用率。

> 追问：和消息队列/异步框架的区别？→ AsyncContext 只是"释放容器线程"，真正的异步处理仍需要自己管理线程池；更现代的方案是用 Spring MVC 的 `@Async` + `Callable`/`DeferredResult`，或直接上响应式 WebFlux。

### 6.6 Servlet 3.1 非阻塞 IO：ReadListener / WriteListener【进阶】
- 传统：`getInputStream().read()` 是阻塞的，读不完会占用线程。
- 3.1 非阻塞 IO：注册 `ReadListener`/`WriteListener`，数据就绪时回调，线程不被 IO 阻塞。
- 适用于**流式大请求体**（上传）、SSE 等场景。

> 加分点：这和 NIO 的 Poller 思路一致——"数据就绪才干活"。但代码复杂度高，普通项目用 Spring 的流式处理（如 `StreamingResponseBody`）更省心。

---

## 07 Session 机制

### 7.1 Session 的创建时机与原理【高频】
- 服务器为每个"会话"分配唯一 **SessionId**（默认 32 位随机串，`ManagerBase` 生成）。
- **不是一建立连接就创建 Session**——只有第一次调用 `request.getSession(true)` 时才创建。
- Session 对象存在服务器内存中（StandardManager 的 Map<sessionId, StandardSession>）。
- SessionId 通过 **Cookie**（默认名 JSESSIONID）或 URL 重写传给客户端。

> 追问：SessionId 怎么保证唯一且不可预测？→ Tomcat 使用 SecureRandom 生成，包含时间戳+随机数；同时校验 SessionId 格式，防 Session Fixation 攻击。

### 7.2 Cookie 与 URL 重写两种会话传递方式【基础】
- **Cookie**：`Set-Cookie: JSESSIONID=xxx; Path=/`，后续请求自动携带。
- **URL 重写**：`response.encodeURL(url)` → `http://host/app;jsessionid=xxx`（浏览器禁 Cookie 时的兜底）。
- Cookie 相关属性：`HttpOnly`（防 JS 读取）、`Secure`（仅 HTTPS）、`SameSite`、`Path`、`Max-Age`。

> 加分点：URL 重写会把 SessionId 暴露在 URL 里（容易泄漏/被 Referer 带出），生产环境默认用 Cookie；`SameSite=Strict/Lax` 可缓解 CSRF。

### 7.3 Session 超时与销毁【基础】
- 默认超时 30 分钟（web.xml `<session-config><session-timeout>30</session-timeout>`）。
- 超时判定：StandardManager 的**后台线程**（backgroundProcess）周期性扫描，超过 maxInactiveInterval 的 Session 被过期删除。
- 主动销毁：`session.invalidate()`。
- 过期事件触发 `HttpSessionListener.sessionDestroyed()`。

> 加分点：Session 过期是**惰性+定期扫描**双机制——访问时检查是否过期（惰性），Manager 后台线程定期清理（定期），兼顾准确性与性能。

### 7.4 Session 持久化：StandardManager 与 PersistentManager【进阶】
- **StandardManager**：Session 全在内存，Tomcat 关闭时（正常 shutdown）会序列化保存到 `SESSIONS.ser`，重启恢复；异常退出则丢失。
- **PersistentManager**：按需将不活跃 Session 换出（swap out）到 Store：
  - `FileStore`：序列化到文件。
  - `JDBCStore`：存到数据库表。
- 适用场景：Session 内存占用大、需要跨重启保持登录态。

> 加分点：`maxActiveSessions` 控制内存中最大 Session 数，超限的新 Session 创建会失败——生产上要监控这个指标，防止 Session 无上限导致内存涨。

### 7.5 集群环境下 Session 共享的四种方案对比【高频】
| 方案 | 原理 | 优点 | 缺点 |
|---|---|---|---|
| Sticky Session（粘性会话） | 负载均衡按 SessionId 固定转发到同一节点 | 零改造、性能最好 | 节点故障时会话丢失、扩容缩容需重连 |
| Session 复制（DeltaManager） | 节点间广播 Session 变更 | 故障转移好 | 网络带宽/内存消耗大，节点多时性能差 |
| 集中式存储（Redis） | Session 数据放 Redis | 水平扩展、故障转移好 | 多一次网络 IO、需引入中间件 |
| 无状态化（JWT 等） | 服务端不存会话 | 完全无状态、天然水平扩展 | 退出/吊销困难、Token 体积大 |

- 生产主流：**Sticky + Redis Session** 或**纯无状态 JWT**。
- Spring Session 把 Session 无缝搬到 Redis，对业务代码几乎透明。

> 加分点：Tomcat 自带 DeltaManager/BackupManager 做集群 Session 复制，但只适合 2~4 个节点的小集群；大规模场景必须外部化。

### 7.6 Session 相关的经典坑【进阶】
1. **Cookie 丢失/失效**：Path 不一致（多个 Context 不同 cookiePath）、Secure 属性在 HTTPS 下调到 HTTP 请求丢失、浏览器隐私模式。
2. **SessionId 不一致**：跨域（不同域名 Cookie 不共享）需 SSO 方案。
3. **Session 未序列化**：往 Session 放对象后，若做持久化/复制需实现 Serializable，否则报 NotSerializableException。
4. **并发修改**：同一 Session 被多线程同时访问可能抛 IllegalStateException（已失效）。
5. **Session 泄漏**：登录用户无上限，Session 数量膨胀 → 内存溢出，需要控制 maxActiveSessions 与超时时间。

---

## 08 类加载器体系

### 8.1 Tomcat 的类加载器架构【高频】
```
          Bootstrap ClassLoader (JDK 核心 java.*)
                  ↑
          Ext/Platform ClassLoader
                  ↑
          System/App ClassLoader (Tomcat 自身 lib)
                  ↑
   ┌──────────────┼──────────────┐
   │                              │
Common ClassLoader ──────────────┘   (common.loader: conf 与 lib)
   │              │
Shared(Webapp共享)    （默认与 Common 合并）
   │
Webapp ClassLoader（每个 Web 应用一个）
   │
JSP ClassLoader（每个 JSP 一个，继承 Webapp）
```

- 默认配置下 Common = Shared = App 的类路径（`common.loader` 指向 `lib`）。
- **每个 Context（Web 应用）拥有独立的 WebappClassLoader**，实现应用间类隔离。

> 加分点：Tomcat 类加载体系 = 标准的双亲委派（上层）+ 对 Webapp 破坏双亲委派（下层），见 8.2。

### 8.2 WebappClassLoader 为什么要破坏双亲委派？【高频】
标准双亲委派：类加载先交给父加载器。但 Web 应用需要"**应用自己的类优先**"，否则：

1. **版本冲突**：不同应用依赖不同版本的同一个 jar（如 log4j 1.x vs 2.x），若都由父加载器加载，只能存在一个版本。
2. **重载能力**：reloadable=true 时 Tomcat 需要重建类加载器来"卸载旧类"，若类都由父加载器加载则无法实现。
3. **隔离**：一个应用的类不能污染另一个应用。

所以 WebappClassLoader 的策略是：
- `java.*`、`javax.servlet.*` 等**容器基础类**仍由父加载器加载（保证规范一致性）；
- **其余类优先自己加载**，找不到再委托父加载器。

> 加分点：这被称为"**逆向委派**"。但 JVM 加载类时是用"全限定名 + 加载器实例"做缓存，两个 Webapp 加载器各自持有同名类的不同副本，互不可见——这就是应用隔离的本质。

### 8.3 classes/ 与 lib/ 的加载优先级【基础】
- 同一 Web 应用内：`WEB-INF/classes` **优先于** `WEB-INF/lib`。
- 用途：把某个 jar 里的类以 class 形式覆盖（打补丁、替换版本）。
- 优先级链：JVM 基础类 > 容器 lib（common/shared）> WEB-INF/classes > WEB-INF/lib。

> 追问：为什么 classes 优先？→ 开发时无需打包 jar 即可直接覆盖类，方便调试与热更新。

### 8.4 JSP 为什么需要独立的类加载器？热加载原理【进阶】
- JSP 是动态编译的，编译出的 Servlet 类需要**可卸载、可重新编译**（JSP 修改后无需重启应用）。
- 因此 JSP 编译产物由 **JspClassLoader**（继承 WebappClassLoader）加载。
- JspServlet 每次请求检查 JSP 文件**修改时间戳**，变了就重新编译 → 新类由**新的类加载器**加载 → 旧类自然可被 GC。

> 加分点：热加载的核心不是"重新加载同一个类"，而是**创建新的类加载器去加载新副本**，旧类与旧加载器一起被 GC——这也是"热加载后内存短暂上涨"的原因。

### 8.5 类加载相关的经典报错与排查【高频】
| 报错 | 原因 | 排查方向 |
|---|---|---|
| `ClassNotFoundException` | 类不存在或没打进包 | 检查依赖、构建产物 |
| `NoClassDefFoundError` | 编译期存在、运行期类缺失（或静态初始化失败） | 检查运行期 classpath、依赖冲突 |
| `NoSuchMethodError` | 依赖版本冲突（编译版本和运行版本不一致） | `mvn dependency:tree` 排查 |
| `java.lang.ClassCastException` | 同一个类被不同加载器加载了两份 | 检查是否在容器 lib 和应用 lib 重复放 jar |
| 内存泄漏（PermGen/Metaspace 涨） | Webapp 类被 JVM 类引用导致加载器无法 GC | ThreadLocal、static、JDBC Driver、Quartz 等 |

> 加分点："同一个类名却是 ClassCastException"是类加载器隔离的经典面试题——对象由应用加载器加载，却和容器加载器加载的同名类做强转。**容器 lib 里尽量不要重复放应用依赖**。

---

## 09 JSP 原理

### 9.1 JSP 的编译运行流程【高频】
```
JSP 文件（xxx.jsp）
  → 首次访问由 Jasper 引擎解析（JspCompilationContext）
  → 生成 Java 源码（xxx_jsp.java，本质是一个 HttpJspBase 子类）
  → javac 编译为 class（xxx_jsp.class）
  → 由 JspClassLoader 加载实例化
  → 每次请求调用 _jspService(request, response)
```

- 编译产物默认在 `work/Catalina/localhost/<app>/org/apache/jsp/`。
- JSP 修改后重新编译（按时间戳）。

> 加分点：**JSP 本质就是 Servlet**——`_jspService()` 等价于 Servlet 的 `service()`，页面 HTML 被封装成 `out.write()` 输出。这是面试最常用的"一句话点破 JSP 本质"。

### 9.2 JSP 九大内置对象【基础】
| 对象 | 类型 | 作用域 |
|---|---|---|
| request | HttpServletRequest | 请求 |
| response | HttpServletResponse | 请求 |
| out | JspWriter | 请求（页面输出） |
| session | HttpSession | 会话 |
| application | ServletContext | 应用 |
| config | ServletConfig | 应用（页面配置） |
| pageContext | PageContext | 页面（可访问其他所有对象） |
| page | this（当前 Servlet） | 页面 |
| exception | Throwable | 仅 errorPage 中可用 |

> 加分点：九大对象中最容易漏的是 `pageContext`——它是页面作用域的入口，也能 `findAttribute()` 按 request→session→application 顺序查找。

### 9.3 JSP 与 Servlet、模板引擎（Thymeleaf/Freemarker）的对比【进阶】
| 维度 | JSP | 模板引擎 |
|---|---|---|
| 编译方式 | 运行时编译为 Servlet | 编译为模板类/解释执行 |
| 与 Java 耦合 | 可写 `<% %>` 脚本（耦合高） | 强制模板语法，禁止脚本 |
| 前后端分离 | 适合服务端渲染旧项目 | 更适合 MVC 分离 |
| 现状 | 新项目基本不用 | 主流（Thymeleaf 与 Spring Boot 集成好） |

> 加分点：JSP 被淘汰的核心原因：**前后端分离趋势 + JSP 脚本元素破坏了 MVC 分层**。现代项目要么后端模板引擎，要么纯静态 + REST API。

### 9.4 JSP 性能与安全注意点【进阶】
1. **禁用脚本元素**：`<jsp-property-group>` 设置 `scripting-invalid="true"`，强制 EL/JSTL。
2. **使用 JSTL + EL**：避免 `<% %>` 混写。
3. **page 指令**：`<%@ page import session="false" %>` 可避免 JSP 自动创建 Session。
4. **缓存**：JSP include 是编译期静态包含（jsp:include 是请求期动态包含，性能更差）。
5. **XSS**：EL 输出默认不转义，用 JSTL `<c:out>` 或 fn:escapeXml。

---

## 10 性能调优

### 10.1 高并发场景的完整调优清单【高频】
1. **线程池**：maxThreads 按 CPU 密集/IO 密集调整（IO 密集可调高至 400~800，配合压测验证）。
2. **连接参数**：maxConnections（NIO 下可 10000+）、acceptCount、connectionTimeout。
3. **内存**：-Xms=-Xmx 固定堆（防抖动）、合理 MetaspaceSize。
4. **JVM GC**：优先 G1，年轻代大小与 Tomcat 线程数匹配。
5. **压缩**：compression="on"，减带宽。
6. **静态资源分离**：交给 Nginx/CDN，Tomcat 只处理动态。
7. **连接器缓冲**：`socket.txBufSize`/`socket.rxBufSize` 按需调整。
8. **禁用 reloadable**、`metadata-complete="true"` 跳过注解扫描加速启动。

> 加分点：调优必须**以压测数据为准**——先定目标 QPS/RT，再用 JMeter/wrk 压测，观察线程池、连接数、GC、CPU 四个指标联动调整，不要盲调参数。

### 10.2 JVM 内存参数配置建议【高频】
```bash
JAVA_OPTS="-server -Xms2g -Xmx2g -XX:MetaspaceSize=256m -XX:MaxMetaspaceSize=512m \
-XX:+UseG1GC -XX:MaxGCPauseMillis=100 -Xss512k \
-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/data/logs/heap.hprof"
```
- `-Xms = -Xmx`：避免堆动态伸缩导致 Full GC 与抖动。
- G1 适合大堆（4G+）与低延迟场景。
- `-Xss` 调小可支持更多线程（但过小易栈溢出，递归深度大的别调）。
- 生产必须开 **OOM Dump**，否则 OOM 后无从排查。

> 加分点：Tomcat 每个请求线程默认栈 1MB → 400 线程约 400MB 虚拟内存；`-Xss512k` 能显著降低线程内存开销。

### 10.3 压测中"连接数打满 / 线程打满"的现象与对策【高频】
| 现象 | 特征 | 对策 |
|---|---|---|
| 连接数打满 | 大量 Connection refused / 超时 | 调大 maxConnections + acceptCount；检查 keep-alive 长连接占用；增加实例 |
| 线程打满 | CPU 不高但请求排队、RT 飙升 | 说明业务阻塞（慢 SQL/外部调用），优化业务或用异步化；临时调大 maxThreads 只是拖延 |
| CPU 打满 | CPU 100%，吞吐上不去 | 业务计算密集/死循环/GC 频繁，用 jstack 定位热点 |

> 加分点：**线程打满 ≠ 参数不够，而是业务太慢**——先 jstack 看线程在等什么（锁/IO/DB），再决定是加机器还是改代码。调参是最后手段。

### 10.4 慢请求定位：jstack 线程 dump 分析【进阶】
1. `jstack <pid> > dump.txt`（可连续抓 3~5 次间隔 2s）。
2. 找 `http-nio-8080-exec-N` 线程的栈。
3. 看卡点：`java.net.SocketInputStream.socketRead0`（等网络）、`Object.wait`（等锁）、`MySQL 驱动 waiting for connection`（DB 连接池满）、`GC` 线程（Full GC 频繁）。
4. 用 `top -Hp` 找 CPU 高的线程 nid，在 dump 中对应定位。

> 加分点：Tomcat 工作线程名 `http-nio-8080-exec-*` 里直接带协议、端口、编号，dump 里一眼可辨；连续 dump 对比线程栈是否变化可判断"真阻塞还是偶发慢"。

### 10.5 常见 OOM 类型与排查【进阶】
| OOM 类型 | 含义 | 常见原因 |
|---|---|---|
| Java heap space | 堆满 | 对象泄漏、Session 无上限、缓存无限增长 |
| Metaspace | 元空间满 | 热部署/动态代理生成类过多、类加载器泄漏 |
| Direct buffer memory | 堆外满 | NIO 缓冲区泄漏 |
| unable to create new native thread | 线程数超 OS 限制 | 线程池泄漏、每连接一线程 |

排查套路：`jmap -dump` 拿堆 → MAT/Eclipse 分析支配树 → 找大对象与 GC Roots 引用链。

> 加分点：Tomcat 经典 OOM 场景之一：**反复热部署 + ThreadLocal 未 remove**，Webapp 类被线程池线程的 ThreadLocalMap 强引用 → 类加载器泄漏 → Metaspace 涨。排查时重点看 static 集合、ThreadLocal、JDBC Driver 注册。

### 10.6 静态资源与缓存优化【进阶】
- 静态资源默认由 **DefaultServlet** 处理，支持 Range 请求、gzip、ETag/Last-Modified。
- `resources` 缓存：`<Resources cachingAllowed="true" cacheMaxSize="10240"/>`（缓存静态文件解析结果，减少磁盘 IO）。
- `cacheTtl`、`cacheObjectMaxSize` 控制缓存条目。
- 最佳实践：静态资源**外置到 Nginx/CDN**，Tomcat 专注动态。

> 加分点：DefaultServlet 支持 **sendfile**（APR 下）直接把文件从磁盘送网卡，零拷贝，性能极高。

### 10.7 开启 HTTP 响应压缩【基础】
```xml
<Connector ... compression="on" compressionMinSize="2048"
           compressibleMimeType="text/html,text/xml,text/plain,text/css,application/javascript,application/json"/>
```
- 默认只压缩文本类 MIME，图片/视频不要压（已压缩格式再压无收益还耗 CPU）。
- 也可以完全交给 Nginx 层压缩，Tomcat 不压。

> 加分点：压缩以 CPU 换带宽，内网服务一般不用；**前端 gzip 由 Nginx 做更划算**（缓存压缩结果、支持 brotli）。

### 10.8 keep-alive 与大并发下的连接治理【进阶】
- keep-alive 复用连接省握手，但**占用 maxConnections 额度**。
- 调优思路：`maxKeepAliveRequests` 限制单连接请求数（防个别连接长期霸占）；`keepAliveTimeout` 缩短空闲连接存活。
- 配合 Nginx：Nginx 与客户端保持长连接，**与 Tomcat 的 upstream 也开 keepalive**（`upstream` 块配 `keepalive 100`），避免每个请求都重建后端连接。

> 加分点：压测时若用短连接（无 keep-alive）测得的结果和长连接差异巨大——**测试模型必须贴近真实流量**，否则调优方向会错。

---

## 11 故障排查与监控

### 11.1 CPU 100% 的排查流程【高频】
1. `top` 看哪个进程 CPU 高 → 确定是 Java 进程。
2. `top -Hp <pid>` 找出 CPU 最高的线程的 **nid**（十六进制）。
3. `jstack <pid> | grep -A20 <nid十六进制>` 定位线程栈。
4. 分析热点：
   - 业务死循环/大计算 → 优化代码；
   - **GC 线程忙** → 堆太小/对象分配太快，用 `jstat -gcutil` 看 GC 频率；
   - `jmap -dump` 分析对象。

> 加分点：`printf "%x\n" <nid十进制>` 转十六进制再 grep，是面试官爱考的细节。GC 导致 CPU 高的标志：线程栈顶部是 `G1YoungRemSetSamplingThread`/`VM Thread` 且 `jstat` 显示 FGC 频繁。

### 11.2 内存泄漏的经典场景（Webapp 类加载器泄漏）【进阶】
Tomcat 特有的泄漏模式：**WebappClassLoader 无法被 GC**。

常见原因（都有"引用逃出应用"的特征）：
1. ThreadLocal 里存了应用类对象，线程未清理。
2. 静态变量持有了应用对象（`static Map` 缓存）。
3. JDBC Driver 注册在容器级 DriverManager。
4. 第三方库启动了独立线程（Quartz、Timer、Netty boss 线程）持有应用 Context。
5. Tomcat 官方提供 `manager` 应用的"Find Leaks"功能扫描。

> 加分点：Leak 检测原理是创建**新的** WebappClassLoader 再比对旧加载器加载的类实例——如果有实例仍存活，说明有外部引用，即泄漏。

### 11.3 线程池满 / 连接数打满的快速确认【基础】
- 查看线程数：`jstack` 数 `http-nio-8080-exec-*` 个数是否达到 maxThreads。
- 查看连接数：`netstat -an | grep 8080 | grep ESTABLISHED | wc -l` 对比 maxConnections。
- 查看队列：Tomcat 日志中的 `RejectedExecutionException`。
- 监控端点：JMX 的 `Catalina:type=ThreadPool,name="http-nio-8080"` 的 currentThreadsBusy / maxThreads。

> 加分点：`currentThreadsBusy == maxThreads` 持续饱和 → 业务瓶颈；`connectionCount == maxConnections` 持续饱和 → 连接参数或 keep-alive 策略问题。

### 11.4 日志体系：catalina.out 与各日志文件【基础】
| 文件 | 内容 |
|---|---|
| catalina.out | 控制台输出（System.out/err、启动信息） |
| localhost.log | 应用级日志（localhost 虚拟主机） |
| localhost_access_log.*.txt | 访问日志（AccessLogValve 开启后） |
| manager.log / host-manager.log | 管理应用日志 |

- 生产建议：**catalina.out 一定要做日志轮转**（logrotate），否则磁盘写满导致服务挂掉。
- 访问日志配置：`<Valve className="org.apache.catalina.valves.AccessLogValve" pattern="%h %l %u %t "%r" %s %b %D"/>`，`%D` 是耗时毫秒，可用于慢请求统计。

> 加分点：`%D`（耗时）结合 `%s`（状态码）可以快速统计"哪些 URL 慢、哪些 5xx 多"，是运维定位问题的第一手数据。

### 11.5 常用排查命令速查【基础】
```bash
# 线程
jstack <pid> > dump.txt
# 堆使用
jmap -heap <pid>
# 堆 dump
jmap -dump:format=b,file=heap.hprof <pid>
# GC 统计
jstat -gcutil <pid> 1000
# CPU 高的线程
top -Hp <pid>
# 网络连接
netstat -ant | grep :8080 | awk '{print $6}' | sort | uniq -c
```

> 加分点：jmap -dump 会**触发 STW**，大堆生产环境慎用，可换 Arthas 的 heapdump 或加 `-XX:+HeapDumpOnOutOfMemoryError` 自动导出。

---

## 12 安全加固

### 12.1 常见安全加固项【高频】
1. **禁用 shutdown 端口**：`<Server port="8005" shutdown="SHUTDOWN">` → 改为随机口令或 `port="-1"` 彻底禁用。
2. **隐藏版本号**：`server.xml` 中 Server 加 `server="自定义字符串"`；`/conf/web.xml` 或错误页处理。
3. **关闭目录列表**：DefaultServlet 的 `listings="false"`（默认就是 false）。
4. **删除默认应用**：移除 webapps 下的 ROOT/examples/docs/manager/host-manager（生产只留自己的应用）。
5. **最小权限**：Tomcat 进程用专用低权限用户运行；`catalina.sh` 加 `-Djava.security.manager`（需要配置策略文件，慎用）。
6. **开启 HTTPS**，禁用 TLSv1/1.1，配 HSTS。

> 加分点：版本号隐藏的本质是**信息暴露**——攻击者扫描到 Tomcat 8.0 可针对性利用已知 CVE；`server=" "` 会把响应头的 Server 字段置空。

### 12.2 HTTPS 配置与 TLS 优化【进阶】
```xml
<Connector port="8443" protocol="org.apache.coyote.http11.Http11NioProtocol"
           SSLEnabled="true" scheme="https" secure="true"
           keystoreFile="conf/keystore.p12" keystoreType="PKCS12" keystorePass="***">
</Connector>
```
- 证书链：`keystoreFile` + `keystorePass`（PKCS12 推荐，JKS 已废弃）。
- 调优：`sslProtocol="TLS"`、指定 `ciphers`（禁用弱套件如 3DES/RC4）、`maxThreads` 配合。
- TLS 握手是 CPU 密集操作，SSL 卸载到 Nginx/硬件加速卡更优。
- HTTP/2 需要 TLS 的 **ALPN** 协商。

> 加分点：`SSLEnabled="true"` 的 Connector 端口一般用 8443；生产更常见的是 **Nginx 终结 TLS**，Tomcat 只收 HTTP 内网流量，安全且性能好。

### 12.3 常见的容器层防护手段【进阶】
- **请求头限制**：maxHttpHeaderSize、RelaxedPathChars 限制特殊字符（防路径穿越/注入）。
- **IP 白名单**：RemoteAddrValve/RemoteHostValve 控制访问来源。
- **限流**：自定义 Valve 或接入网关限流。
- **CSRF**：SameSite Cookie + Token。
- **XSS**：Filter 层统一转义输出。
- **上传安全**：`maxPostSize`/`maxSwallowSize` 限制请求体，校验文件类型（防上传恶意脚本）。

> 加分点：安全是**分层防御**——容器层（Valve/Filter）+ 应用层（Spring Security）+ 网关层（WAF）。Tomcat 只做基础防线，别指望它挡应用漏洞。

### 12.4 AJP 协议与安全【进阶】
- AJP 是 Tomcat 与 Apache/前端之间用的**二进制协议**（端口 8009），比 HTTP 头开销小。
- **Ghostcat 漏洞（CVE-2020-1938）**：AJP 端口未设认证时可读任意文件（含 WEB-INF）→ 危害极大。
- 加固：**不用 AJP 就直接禁用**（注释掉 8009 Connector）；必须用时设置 `requiredSecret`，且只监听内网。

> 加分点：2020 年 Ghostcat 是 Tomcat 最有名的漏洞——凡问"Tomcat 安全"几乎必提它。回答"禁用未使用的 AJP + 配置 requiredSecret + 防火墙限制来源"即满分。

---

## 13 集群与高可用

### 13.1 常见的 Tomcat 集群部署形态【基础】
1. **单体 + Nginx 负载均衡**（最常见）：Nginx 按 ip_hash/least_conn 分发，Tomcat 多实例。
2. **多机多实例**：每台机器跑多个 Tomcat 实例（端口不同），提高单机利用率。
3. **容器化**：Docker/K8s 下每个 Pod 一个内嵌 Tomcat，水平扩缩容。
4. **Session 集群**：见 7.5，配合粘性或外部存储。

> 加分点：部署形态的核心是"**无状态化**"——应用尽量不依赖本地 Session/本地文件，才可能水平扩容。

### 13.2 Nginx 负载均衡 + 粘性会话的配置要点【进阶】
```nginx
upstream backend {
    ip_hash;                 # 按 IP 固定节点（粘性）
    server 10.0.0.1:8080 max_fails=3 fail_timeout=10s;
    server 10.0.0.2:8080 max_fails=3 fail_timeout=10s;
    keepalive 32;            # 与后端的长连接池
}
```
- `ip_hash` 对 NAT 后的用户不友好（同出口 IP 集中到一台）；更好的是按 Cookie 粘性（`sticky` 模块）。
- 故障转移：节点挂掉后健康检查剔除；Session 会丢（粘性的代价）——所以粘性 + Redis Session 组合最稳。

> 加分点：粘性会话下**单个节点故障 = 该节点用户掉登录**，这往往不可接受，所以生产主流还是"无状态 JWT + Redis"或"Redis Session 共享"。

### 13.3 Tomcat 自带的 Session 集群方案【进阶】
- **DeltaManager**：主节点 Session 变化（创建/更新/过期）**广播**给所有节点，任意节点都有完整会话。节点多时广播风暴。
- **BackupManager**：只备份到一个备用节点，减少广播量，但故障恢复不如 DeltaManager 完整。
- 配置：`<Cluster className="org.apache.catalina.ha.tcp.SimpleTcpCluster">`，需要 `<Manager>` 替换为 DeltaManager。

> 加分点：Tomcat 自带集群基于 **Multicast 组播 + TCP 备份**，只适合小规模；这是"Tomcat 集群"面试题的标准答法——先讲方案对比（见 7.5），再讲自带实现，最后给生产建议。

### 13.4 分布式 Session 的选型建议【高频】
| 场景 | 推荐 |
|---|---|
| 中小规模、已有 Redis | Spring Session + Redis（首选） |
| 无状态 API 服务 | JWT/Token，不做 Session |
| 老系统改造 | Nginx 粘性 + Session 复制兜底 |
| 高可用要求极高 | Redis Cluster + Spring Session + 会话续期 |

- Spring Session 原理：实现 `HttpSession` 接口，把 Session 数据读写到 Redis（序列化 + TTL 自动过期），对业务代码透明。
- 注意：Session 中的对象必须**可序列化**；Redis 故障要有降级策略。

> 加分点：选型的关键判断是"**Session 里到底存了什么**"——如果能瘦身成"只存 userId"甚至 JWT，问题直接消失；方案从简到繁逐步演进。

---

## 14 生产场景题

### 14.1 双十一大促，Tomcat 怎么扛？【高频】
分层回答（体现架构思维）：
1. **流量入口**：Nginx/网关 + CDN + WAF，静态资源全部外置。
2. **应用层**：Tomcat 多实例水平扩容；容器化后按 QPS 指标自动扩缩容。
3. **单实例调优**：maxThreads/maxConnections/keep-alive/压缩按压测调。
4. **依赖治理**：Redis 扛热点读、MQ 削峰填谷、DB 连接池限量、缓存防止击穿。
5. **容量规划**：先压测得出单机 QPS，再算实例数，留 30% 冗余。
6. **兜底**：限流（网关）、降级（开关）、熔断（Sentinel/Hystrix）。

> 加分点：大促题考察的不是"Tomcat 参数"，而是**全链路容量思维**——Tomcat 只是其中一环，先问清业务模型（读写比、热点占比、可缓存性）。

### 14.2 连接数被占满，所有请求超时，怎么排查处理？【高频】
排查步骤：
1. `netstat -ant | grep :8080` 看连接状态分布：大量 ESTABLISHED 长时间空闲 → keep-alive 连接占满；大量 TIME_WAIT → 短连接过多。
2. 看 `currentThreadsBusy`：线程忙则查业务卡点（jstack）；线程闲但连接满 → 就是连接参数/长连接策略问题。
3. 处理：临时调大 maxConnections/acceptCount；缩短 keepAliveTimeout、限制 maxKeepAliveRequests；把长连接交给 Nginx 管理；扩容实例。
4. 根因预防：压测复现、监控连接数指标、告警。

> 加分点：注意**先分清楚是"连接多"还是"线程忙"**——两者对策完全不同（一个是参数，一个是业务），这是这道题的核心考点。

### 14.3 上传大文件（1GB）导致连接长时间占用怎么办？【进阶】
- 参数：`maxPostSize="-1"`（不限请求体大小，默认 2MB）、`maxSwallowSize` 调大。
- 超时：`connectionUploadTimeout` 针对上传的慢客户端放宽。
- 架构解法：
  1. **直传 OSS/对象存储**：前端签名直传，Tomcat 只拿 URL，完全不碰文件流。
  2. **分片上传**：客户端切片 + 服务端合并。
  3. **异步处理**：上传后立刻返回，后台任务处理。

> 加分点：大文件上传的最优解永远是**别让应用服务器碰文件**——签名直传 OSS + 回调通知，Tomcat 只做元数据。回答这一点会明显加分。

### 14.4 请求偶发 503 / Connection reset 怎么查？【进阶】
可能原因：
1. **RejectedExecutionException**：线程池满 + 队列满 → 503（看 catalina 日志）。
2. **maxConnections 打满**：连接拒绝。
3. **连接被重置（RST）**：客户端/中间层超时后关闭（Nginx proxy_read_timeout、防火墙）、后端处理超时。
4. **响应超时**：处理超过连接器/前端超时时间，连接被断开，客户端读到 Connection reset。

排查：看 access log 状态码、`%D` 耗时、catalina 日志异常栈、网络层抓包（tcpdump 看 RST 来源）。

> 加分点：`Connection reset by peer` 大多是**对端先关的连接**——要先分清是"我们主动关"还是"客户端/中间层主动关"，方向对了问题就解决一半。

### 14.5 Tomcat 单机能扛多少并发？如何突破？【进阶】
- 单机 NIO 下**连接数**轻松上万，但**吞吐瓶颈**在：线程数（CPU 核数）、业务耗时、GC、网络。
- 经验值：普通 IO 业务单机 **1000~5000 QPS** 量级（取决于业务复杂度），纯静态或缓存命中场景更高。
- 突破手段：水平扩容（加实例）+ 负载均衡；缓存与异步化降低平均耗时；必要时换 Undertow/Netty。

> 加分点：面试官真正想听的是"**并发是一个系统问题不是 Tomcat 问题**"——单机压到极限后唯一的正确解法是水平扩展。

---

## 15 源码级进阶

### 15.1 NioEndpoint 的内部结构【进阶】
NioEndpoint 继承 AbstractEndpoint，核心成员：
- `Acceptor`（1 个）：accept 循环。
- `Poller[] pollers`（默认 2 个）：每个 Poller 一个 Selector + 一个线程。
- `PollerEvent`：SocketChannel 注册事件的封装（可复用，减少对象创建）。
- `SocketProcessor`：连接 + 请求处理任务（实现 Runnable，提交线程池）。
- `NioSocketWrapper`：Socket 状态包装（interestOps、readLatch 等）。
- `SelectorPool` / `BlockPoller`：阻塞读的辅助。

> 加分点：Tomcat 的 PollerEvent 是**对象池复用**的（EventCache），这是它在高连接数下 GC 压力小的细节设计。

### 15.2 Http11Processor 处理请求的伪代码流程【进阶】
```
service(SocketWrapperBase socketWrapper):
  // 1. 解析请求行与请求头（循环直到读完整）
  inputBuffer.parseRequestLine()
  inputBuffer.parseHeaders()
  // 2. 校验请求（协议版本、host 头等）
  prepareRequest()
  // 3. 交给容器
  getAdapter().service(request, response)
  // 4. 写响应：flush → 检查 keep-alive
  outputBuffer.flush()
  // 5. 决定连接状态：KEEP_ALIVE / CLOSE / 出错
  checkKeepAlive()
```

- 响应写完检查 `keepAlive`：可复用则进入下一轮解析，否则 `endRequest()` 关闭。
- 特殊处理：`Expect: 100-continue`、`Upgrade`（WebSocket/HTTP2）、`maxKeepAliveRequests` 计数。

> 加分点：Http11Processor 是**有状态对象**（持有 InputBuffer/OutputBuffer），Tomcat 会对它做**回收复用**（Processor 缓存），减少创建开销。

### 15.3 CoyoteAdapter 做了什么适配？【进阶】
- 把 Coyote 层的 `org.apache.coyote.Request/Response`（面向协议）转换为 Servlet 规范的 `org.apache.catalina.connector.Request/Response`（面向容器）。
- 设置 URI 解码（URIEncoding）、CharacterEncoding、SessionId 解析（从 Cookie/URL）。
- 调用 `connector.getService().getContainer().getPipeline().getFirst().invoke(request, response)` 进入容器 Pipeline。
- 响应完成时把结果回填到 Coyote Response（状态码、头、字节）。

> 加分点：**Coyote 不依赖 Servlet API**——这是 Tomcat 分层解耦的关键；Adapter 是两层之间的"翻译官"。

### 15.4 Tomcat 线程池的内部实现（TaskQueue + ThreadPoolExecutor）【进阶】
```java
// 重写 offer：线程未满时不入队，强制创建线程
public boolean offer(Runnable o) {
    if (parent.getPoolSize() == parent.getMaximumPoolSize())
        return super.offer(o);          // 线程已满，正常入队
    if (parent.getSubmittedCount() < parent.getPoolSize())
        return super.offer(o);          // 提交数少于线程数，入队
    if (parent.getPoolSize() < parent.getMaximumPoolSize())
        return false;                   // 有空闲容量，拒绝入队 → 建新线程
    return super.offer(o);
}
```
- `ThreadPoolExecutor` 在 `execute()` 时还会对 **rejected 任务做重试**（若线程池状态允许），并记录 submittedCount 统计。
- 线程空闲超过 `keepAliveTime`（默认 60s）回收至 minSpareThreads。

> 加分点：这是 Tomcat 与 JDK 默认线程池策略差异的源码证据，面试背出这段 offer 逻辑基本就是"源码级理解"。

### 15.5 Tomcat 的优雅关闭（Graceful Shutdown）【进阶】
- 传统关闭：shutdown 端口发字符串 → stop() → 立即断开连接（进行中的请求可能被中断）。
- **9.0.31+** 引入优雅关闭：
  1. 停止 accept 新连接。
  2. 等待已建立连接在超时窗口内处理完（`connectionTimeout` 内），或等待运行中的任务结束。
  3. 再 stop/destroy。
- 实现：`Tomcat 9` 的 `StandardServer` 支持通过 `stop()` 前等待；Spring Boot 也有 `server.shutdown=graceful`。

> 加分点：优雅关闭的本质是"**先摘流量，再排空存量，最后销毁**"——与 K8s 的 preStop hook + terminationGracePeriodSeconds 配合，实现零中断发布。这是把容器知识串起来的加分点。

---

> **面试心法**：Tomcat 面试题的三个层次——① 会说（参数、流程、概念）② 会算（线程模型、容量估算、调优逻辑）③ 会查（源码类名、异常定位、排查命令）。能把这 15 章内容按"架构 → 请求链路 → 线程模型 → 调优 → 排查"的脉络讲下来，基本可以覆盖面试官 80% 的追问。
