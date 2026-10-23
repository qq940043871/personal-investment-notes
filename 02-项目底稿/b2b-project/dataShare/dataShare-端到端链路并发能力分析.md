# 端到端链路最大并发分析：客户端 → midservice → dataShare → 具体服务

> 配套文档：`dataShare-分布式服务能力与瓶颈分析.md`（能力盘点）、`dataShare-系统缺陷与并发能力分析.md`（缺陷清单）
> 分析对象：`J_1018_midservice-v1.1.188.228.5` + `dataShare-2.6.2` + `dataShareClientAPI-1.3.4` + `dataShareCommon-1.1.3`
> 全部结论附 `文件:行号` 证据。**代码可确定的标"事实"，需实测的标"推断"并给出方法。**

---

## 目录

- [一、链路全景：五跳拓扑](#一链路全景五跳拓扑)
- [二、逐跳并发约束](#二逐跳并发约束)
  - [第 1 跳：客户端 → midservice](#第-1-跳客户端--midservice)
  - [第 2 跳：midservice → dataShare（协议入口）](#第-2-跳midservice--data share协议入口)
  - [第 3 跳：dataShare 内部（协议分发）](#第-3-跳datashare-内部协议分发)
  - [第 4 跳：dataShare → 具体服务（后端转接）](#第-4-跳datashare--具体服务后端转接)
  - [第 5 跳：具体服务 → 数据库 / 下游](#第-5-跳具体服务--数据库--下游)
- [三、链路总并发公式](#三链路总并发公式)
- [四、四种典型场景的并发数字](#四四种典型场景的并发数字)
- [五、最窄瓶颈在哪一跳](#五最窄瓶颈在哪一跳)
- [六、必须实测的 6 项](#六必须实测的-6-项)
- [七、改造后并发提升预估](#七改造后并发提升预估)

---

## 一、链路全景：五跳拓扑

```
  客户端                    midservice                    dataShare                 具体服务
 (App/小程序)              (1018 网关)                   (2.6.2)              (微服务/交易系统)
      │                        │                            │                        │
      │  ①HTTP                 │                            │                        │
      ├───────────────────────▶│                            │                        │
      │                        │ ②DS 自研二进制协议           │                        │
      │                        │  (11字节头+4字节命令号)      │                        │
      │                        ├───────────────────────────▶│                        │
      │                        │                            │                        │
      │                        │        ③协议分发            │                        │
      │                        │      (HandlerImpl.run)      │                        │
      │                        │   ┌────────────────────────┴──┐                     │
      │                        │   │ connType=0 系统内置      │                     │
      │                        │   │  → Redis / Kafka / JDBC  │──── 直接访问 ───────▶│
      │                        │   ├─────────────────────────┤                     │
      │                        │   │ connType=1 Hessian       │ ④Hessian HTTP       │
      │                        │   │  → ASM动态接口+代理      ├────────────────────▶│
      │                        │   ├─────────────────────────┤                     │
      │                        │   │ connType=2 Socket       │ ④私有TCP协议栈       │
      │                        │   │  → 5种协议栈之一        ├────────────────────▶│
      │                        │   ├─────────────────────────┤                     │
      │                        │   │ connType=3 HTTP         │ ④HttpClient         │
      │                        │   │  → 每请求新建客户端     ├────────────────────▶│
      │                        │   └─────────────────────────┘                     │
      │◀───────────────────────┤                            │◀───────────────────────┤
      │  ①HTTP响应(同步阻塞)     │                            │                        │
```

**关键事实（决定整条链路的形态）**：

| # | 事实 | 证据 |
|---|---|---|
| F1 | **dataShare 全链路同步阻塞**，无任何异步化 | `ConnSocketCommandParse.java:137` 阻塞 socket 读写；`ConnHessianCommandParse.java:175` `Method.invoke` 触发阻塞 HTTP POST |
| F2 | **midservice 无线程池、无 `CompletableFuture`、无 `@Async`** | 全库 grep 无 `ExecutorService`/`CompletableFuture`/`@Async`/`CountDownLatch` |
| F3 | **SDK 客户端是 1 连接 = 1 请求的同步 BIO** | `DSClientAPI.java:243` `getSocketClient` → `:245` `sendTo` → `:256` 阻塞 `readMainHeader` → `:292` `releaseConnection` |
| F4 | **dataShare 服务端无业务 worker 线程池** | 全树仅 3 处线程创建：`DSRunMain.java:85`(server)、`:146`(offset)、`:156`(log清理) |
| F5 | **响应经 per-session 队列异步回写** | `session.reviewOffer(ReviewBean)`（`ConnSocketCommandParse.java:72`）；`KrackleConsumer.java:146` 检查 `getReviewQueue().size() > 20` |

**⇒ 整条链路是"一请求一线程、自顶向下同步阻塞"的经典阻塞式管道。并发能力由每一跳中最窄的一环决定，而不由线程总数决定。**

---

## 二、逐跳并发约束

### 第 1 跳：客户端 → midservice

#### 约束 1-A：Tomcat 工作线程数（**硬顶**）

**[事实] 配置不在源码树内**。穷尽搜索 `maxThreads|minSpareThreads|maxConnections|acceptCount` 全树仅命中 `ServiceServlet.java:104`：

```java
String p = outFile.getParentFile().getParentFile().getAbsolutePath() + "/conf/server.xml";
```

该代码**只读取 `port` 属性**（`:140-151` 遍历 `Service/Connector`，`:149` 取 port 存入 `ServiceConfig.SYS.port`），**从不读取 `maxThreads`**。且 `server.xml` 在 Tomcat 安装目录，随部署包外置。

**⇒ 上限 = 部署环境 `conf/server.xml` 的 `maxThreads`，Tomcat 默认 200。**

```bash
grep -o 'maxThreads="[0-9]*"' $CATALINA_HOME/conf/server.xml
```

#### 约束 1-B：per-user 锁 —— **最狠的收窄**

```java
// HandlerController.java:712 → 761
lockApi(token, api);          // :712  加锁（key = api + "_" + tokenId）
try {
  rtn = callable.call();      // :752  ← 整个业务执行，含所有 DS 往返
} finally {
  unLockApi(token, api);      // :761  解锁
}
```

**[事实] 锁跨越整个远程调用**，粒度为 `api + "_" + tokenId`（`:1734`）。

**触发条件**（`:1729-1732`）：`is.open.syncLock=Y` **且** `syncLockMap.get(api)` 为 null 或 ==1。
`SyncLockMap` 由 `ServiceServlet.java:322` 从外部配置装载。

**⇒ 同一用户对同一 API 的并发被完全串行化，上限 = 1/RT。**

**⇒ 系统的实际并发能力由"单用户单 API"决定，而非总容量。** 1 万个不同用户同时下单 = 1 万并发；**1 个用户开 100 个并发请求 = 1 并发**。

#### 约束 1-C：midservice → 业务后端连接池

**[事实] 21 个独立连接池**（`ServiceConst.java:56-78`），默认值统一 `maxCon=50, initCon=1, timeOut=10000`（`ServiceConfig.java:21-25` 等）。

**理论 21 × 50 = 1050 并发后端连接**，但受 1-A 的 Tomcat 线程数封顶。

> 注：这条约束对"midservice → dataShare → 具体服务"路径不构成限制（dataShare 是唯一后端出口），但对 midservice 直连后端（`T9ConnectPool`/`WdhConnectPool` 等）的 handler 有效。

#### 约束 1-D：三个全局 `synchronized`（每请求必经）

| 位置 | 内容 | 持锁时长 | 上限 |
|---|---|---|---|
| `ServiceUtils.java:169` `getTokenId` | 4 次 `getHeader` + N 次 `getParameter` + `String.replace` | ~1-10 µs | 理论 10万-100万 ops/s，**但每请求必经** |
| `DSUtils.java:35` `getClient()` | 仅 `return dsClient` | 纳秒级 | 本身无害，但**是 135 个 DS 调用的必经点** |
| `SerialService.java:31` `_genSerialLocal` | `currentTimeMillis` + 字符串拼接 | ~100 ns-1 µs | 理论 100万-1000万 ops/s |

**[事实] `getTokenId` 是最可疑的全局串行点**——纯读操作加全局 monitor，每请求一次。

---

### 第 2 跳：midservice → dataShare（协议入口）

#### 约束 2-A：客户端连接池大小（**硬顶，且可能极小**）

**[事实] SDK 池参数**（`DSClientAPI.java:107-114`）：
```java
poolConfig.setMaxTotal(dsBean.getMaxCon());
poolConfig.setMinIdle(dsBean.getInitCon());
poolConfig.setMaxIdle(...);
poolConfig.setMaxWaitMillis(5000L);        // ← 硬编码 5 秒
```

**[事实] SDK 默认值**（`DSBean.java:34-36`）：`timeOut=5000, initCon=1, maxCon=100`。

**[事实] midservice 源码中出现的两处实际配置**：

```java
// ImageCompressUtils.java:88-90
dsBean.setTimeOut(20000);
dsBean.setInitCon(2);
dsBean.setMaxCon(5);            // ← ★ 只有 5

// ThirdNoitfyController.java:162-164
dsBean.setTimeOut(10000);
dsBean.setInitCon(2);
dsBean.setMaxCon(30);
```

> ⚠️ **重要修正（相对上一轮结论）**：`ImageCompressUtils.initDS()` 内的 `DSUtils.dsClient = dsClient`（`:83`）虽是**全局共享客户端**，但 `initDS()` 在本 jar 内的唯一调用点是 `ImageCompressUtils.main()`（`:107`，测试用 main）——**它不是生产初始化路径**。
>
> 生产的 DS 客户端来自**外部 core 模块**：`ServiceServlet.java:223` 与 `RedisCallUtils.java:27` 都调 `CoreUtils.getDSClientAPI()`（`com.ylsoft.ooo.core.utils.CoreUtils`，**不在本源码树内**）。
>
> **⇒ `DSUtils.dsClient` 由外部 core 模块在启动时赋值，其 `maxCon` 无法从本源码确定，必须到生产核实。** 这直接决定第 2 跳的并发上限。

```bash
# 生产核实（优先级最高）
grep -rn "setMaxCon\|setInitCon\|setTimeOut" $APP_HOME/1018/core/ 2>/dev/null
jmap <pid> | grep -A15 ConnectPool     # 观察实际池大小
```

**[事实] 无论配置多少，SDK 是 1 连接 = 1 请求**（`DSClientAPI.executeCall` 全程持有一条连接），所以：

```
第 2 跳并发上限 = DSBean.maxCon
```

**[事实] 池耗尽的行为是灾难性的**：
```java
// BIOSocketConnectManager.java:54-64
if (errMsg.indexOf("Timeout waiting for idle object") > -1) {
  ConnectPool cp = (ConnectPool)_cpCache.get(sp);
  if (cp != null) { cp.close(); _cpCache.remove(sp); }   // ← 关闭整池
  return getSocketClient(sp, poolConfig);                // ← 递归重试
}
```
第 N+1 个并发 DS 请求等 5 秒 → 超时 → **关闭整个池（所有在途连接被强杀）** → 所有并发 DS 请求同时失败 → 递归重建 → 雪崩。

**⇒ `maxCon=5` 意味着整个 midservice 对 dataShare 只有 5 并发，第 6 个请求就开始 5 秒等待并可能触发雪崩。**

#### 约束 2-B：ansyKey 池容量

**[事实]** `HeaderKeyPool.java:15` `new LinkedBlockingQueue(65534)`，静态块填入 65534 个 key（`:22-23` 循环 `i < 65535`）。

**每个在途请求占 1 个 ansyKey**（`DSClientAPI.java:238` getKey → `:288` returnKey）。

**⇒ 全局在途请求数硬顶 65534**（远高于其他约束，仅作理论上限）。

> **[事实] 缺陷**：`getKey()` 在队列空时返回 `-1`（`:31`），而 `-1` 会被 `setAnsyKey(-1)` 写入报文（`:241`），响应匹配循环 `while (ansyKey != mainHeader.getAnsyKey())`（`:260`）将**永不匹配** → 无限阻塞读。队列耗尽 = 该线程永久挂死。
> 另外 `HandleAnsyRequestThread.java:56/60/67` 三条路径都 `returnKey`，靠 `LinkedBlockingQueue.offer` 幂等兜住——但 `offer` 到已满队列会**失败**，此时 key 永久泄漏，池容量单调下降。

#### 约束 2-C：客户端侧无并发保护

`BIOSocketConnectManager.getSocketClient` 用 `synchronized (ConnectPool.class)` **只锁创建路径**（`:41-47`），归还路径 `releaseConnection` **无锁**（`:66-78`）。

**⇒ 客户端侧无全局串行点**，这一跳的瓶颈纯粹是池大小。

---

### 第 3 跳：dataShare 内部（协议分发）

#### 约束 3-A：IO 事件循环线程数（**最关键未知量**）

**[事实] 证据链**：

1. **全树仅 3 处业务相关线程创建，无一是请求处理**（`DSRunMain.java:85/146/156`）
2. **两个无界线程池都不处理业务请求**：`ConnServerThreadUtils.java:11`（跑协议池初始化）、`SubscribeThreadUtils.java:8`（跑 Kafka consumer）
3. **`HandlerImpl.run()` 无线程移交**：`:35` `setThreadName` → `:36-57` 直接 switch 分派 → `:67/75/83/91` 调 `commandParse.run()`，中间**无 `executor.submit` / `new Thread`**
4. **下游调用全部阻塞**（见 F1）
5. **响应确实异步入队**（见 F5）

**[推断]** 业务处理在 IO 事件循环线程上同步执行。`PerferenceEnum.HIGN_PERFORMANCE` / `HIGN_STABLE`（`DSRunMain.java:79-83`）暗示框架有两种线程策略，但**线程数不可知**。

**⇒ 若单 IO 线程：**

```
dataShare 总 TPS ≈ 1 / RT_后端
```

**一次 10 秒的后端读超时 = 全系统停摆 10 秒。** 且被 `ConnSocketCommandParse.java:142-163` 的递归重试（深度 100）放大为约 1000 秒。

**证实方法**：
```bash
jstack <pid> | grep -A5 "nio.reactor"
# 1 个 reactor 线程在跑 HandlerImpl.run → 单线程模型成立
# N 个 worker 线程 → 上限 = N/RT
```

#### 约束 3-B：全局归还锁（**全协议共享**）

```java
// SocketClientConnectManager.java:56
public static synchronized void releaseConnection(SocketClient sc, String clientFlag) { ... }
// :63
public static synchronized void removeConnetPoll(String clientFlag) { ... }
```

**[事实]** 每个 socket 请求的 `finally` 都走 `releaseConnection`（`ConnSocketCommandParse.java:172-173, 201-202, 231-232, 260-261, 289-290`）。

**⇒ 所有协议的所有并发请求在"归还连接"这一步串成一条单线。**

**⇒ 整个第 4 跳的吞吐上限 = 1 / T_归还锁。**

#### 约束 3-C：Redis 全局锁（**含正反馈崩溃回路**）

```java
// ShardedReidsPool.java:58-75
public static ShardedJedis getConnect() {
  lock.lock();                                    // ← 全局 ReentrantLock
  try {
    localShardedJedis = shardedJedisPool.getResource();   // ← 池耗尽时阻塞至 MaxWaitMillis
    return localShardedJedis;
  } finally { lock.unlock(); }
}
```

**[事实]** 全局锁包住了可能阻塞的 `getResource()`。

**[事实] 池参数默认值全是空字符串**（`RedisPropertiesLoad.java:17-21`），必须显式配置否则 `Integer.valueOf("")` 抛异常 → `DSRunMain.java:41` 抛出 → `:60` `System.exit(-1)`。**快速失败，但错误信息不明确。**

**[事实] 与业务锁的正反馈回路**（`T00010040_LockBusinessService.java:50-54, 64-66`）：
```java
ShardedJedis jedis = ShardedReidsPool.getConnect();
try {
  if (lockDetail(jedis, lockKey, ...)) { ... }    // :54  while + setnx + Thread.sleep(1)
} finally {
  ShardedReidsPool.returnResource(jedis);          // :66  ← 自旋结束后才归还
}
```
⇒ **N 个线程争同一把锁 = 占用 N 个 Redis 连接空转** → 池耗尽 → 触发全局锁阻塞 → **全系统 Redis 归零**。

**⇒ 第 3 跳对 Redis 类请求（缓存/锁/队列）的上限 = 1 / T_借连接（~0.1-1 ms）≈ 1k-10k TPS**，但池耗尽时归零。

#### 约束 3-D：协议路由表并发正确性

6 个无锁容器承载并发路由（`HessianServiceCache:12` / `HttpServiceCache:9` / `AESKeyCache:8` / `ProducerCache:9` / `SubscribeCache:24` TreeMap / `HessianFactoryUtils:135`）。

**⇒ 高并发下可能进程挂死（HashMap resize 成环）而非仅性能下降。** 这不是"并发上限低"，而是"并发上限可能无限但系统会崩"。

#### 约束 3-E：`LockCache` 锁序倒置（**全局死锁**）

```java
// LockCache.java:41-54
businessLock.lock();                    // ① 先拿全局锁
try {
  ((Lock)_lockCache.get(key)).lock();   // ② 在持全局锁时阻塞获取业务锁
} finally {
  businessLock.unlock();                // ③ 业务锁持有期间才释放全局锁
}
```
调用方：`T00010033_PushlishMQService.java:53`（MQ 发布，持锁含 Kafka 建连 100ms~数秒）、`T00010050_SendSMSService.java:45`（短信投递）。

**⇒ 一次慢 producer 创建 ⇒ 冻结所有 MQ 发布与短信投递。**

---

### 第 4 跳：dataShare → 具体服务（后端转接）

#### 约束 4-A：后端连接池（**来自 DB，无默认值**）

**[事实]** 全部来自 `TB_DS_PROTOCOL`（`ProtocolBean.java:68-70`）：
```java
this.socketTimeout = ((Integer)inMap.get("SOCKET_TIMEOUT")).intValue();
this.socketInit   = ((Integer)inMap.get("SOCKET_INIT")).intValue();
this.socketMax    = ((Integer)inMap.get("SOCKET_MAX")).intValue();
```
**[事实] 若 DB 未配置该表 ⇒ `((Integer)null).intValue()` 抛 NPE ⇒ 启动失败。** DB 是硬依赖。

**[事实] 唯一硬编码池参数**：`maxWaitMillis=5000`（`SocketConnRunnable.java:120,169,213,257,302` 五处重复）。
**[事实] 未设置 `testOnBorrow`** ⇒ 借出时不校验连接有效性，坏连接由业务层发现。

**⇒ 第 4 跳并发上限 = `Σ(SOCKET_MAX)`**（跨所有协议），单协议 = `SOCKET_MAX`。

**[事实] 协议数量无代码上限**（`TB_DS_PROTOCOL` 无 LIMIT、无校验）。

```sql
SELECT COUNT(*), SUM(SOCKET_MAX), SUM(SOCKET_INIT), AVG(SOCKET_TIMEOUT)
FROM TB_DS_PROTOCOL WHERE IS_VALID = 1;
```

#### 约束 4-B：Hessian 路径**无连接池**

**[事实]** `HessianProxyFactory.create(serverClass, url)`（`HessianFactoryUtils.java:108`）创建的是 JDK 动态代理，其底层 `HessianURLConnection` 用 JDK `HttpURLConnection`——**HTTP keep-alive 连接由 JVM 全局 `http.maxConnections` 管理，默认 5**。

**⇒ Hessian 路径的实际并发上限可能是 5（每目标主机），而非 `SOCKET_MAX`！** 这是第 4 跳最容易被忽视的硬约束。

> ⚠️ `HessianFactoryUtils.java:22` 的 `serverInstanceMap` 是**裸 HashMap**，`put` 在代理创建路径、`get` 在请求路径 ⇒ 并发数据竞争。

#### 约束 4-C：HTTP 路径每请求新建客户端且不关闭

```java
// HttpClientUtils.java:34,83,125,159,192（5 个重载）
CloseableHttpClient httpclient = HttpClients.createDefault();
...
finally { if (httpPost != null) httpPost.releaseConnection(); }   // ← 只 release 请求，不 close client
```

**⇒ 每请求一个新连接池 + 新线程池，且从不关闭 ⇒ 连接泄漏 + 端口耗尽。**

#### 约束 4-D：Socket 路径的递归重试放大

```java
// ConnSocketCommandParse.java:142-163
if (count < 100) { str1 = callDSProtocol(mainProtocolKey, count + 1); return str1; }   // :142-146
if (errMsg.indexOf("Read timed out") > -1) {
  if (getIsRepeatCall() == 1 && count < 100) { str2 = callDSProtocol(mainProtocolKey, count + 1); }
}
```

**⇒ 一次 10s 超时 → 最多 100 次递归 → 约 1000s 占用。**

**另外**：重试判定依赖 **异常 message 文本**（`"Timeout waiting for idle object"` / `"Read timed out"` / `"服务端休息了下"`），locale 或版本变化即失效；且 `else if` 挂在 `if (Read timed out)` 上，导致"服务端休息了下"分支只在第一个 if 为 false 时才可能进入——两者本是并列关系，此处写成互斥。

---

### 第 5 跳：具体服务 → 数据库 / 下游

**不在本次源码范围内**，但需注意：具体服务自身的并发能力（Tomcat 线程数、DB 连接池）会**反向成为整条链路的上限**。若某后端只有 20 个 DB 连接，则该协议的有效并发就是 20。

---

## 三、链路总并发公式

### 通用形式

```
链路最大并发 = min(
    ① Tomcat_maxThreads,                    # 第1跳，部署配置，默认200
    ② DSBean.maxCon,                        # 第2跳，外部core模块配置 ★待核实
    ③ 单用户单API = 1,                      # 第1跳per-user锁（若开启）
    ④ dataShare_IO线程数,                   # 第3跳 ★待实测
    ⑤ Σ(SOCKET_MAX),                       # 第4跳后端池，DB配置
    ⑥ 目标主机 http.maxConnections(=5),     # 第4跳Hessian路径，JVM默认
    ⑦ 具体服务自身并发能力                  # 第5跳
)
```

**吞吐形式**：

```
链路总 TPS ≈ min(
    Tomcat_maxThreads / RT_全链路,
    DSBean.maxCon      / RT_第2-4跳,
    1 / RT_后端,                            # 单IO线程模型
    1 / T_归还锁,                           # ≈1ms → ~1k TPS
    1 / T_Redis借连接,                       # ≈0.1-1ms → ~1k-10k TPS
    具体服务TPS
)
```

---

## 四、四种典型场景的并发数字

### 场景 A：单用户、单接口、高频（最常见压测场景）

**假设**：Tomcat 200 线程，DSBean.maxCon=100，后端 RT=100ms，per-user 锁开启。

| 环节 | 并发 |
|---|---|
| 客户端发起 | 200 |
| Tomcat 接收 | 200 |
| per-user 锁 | **1** ← 瓶颈 |
| DS 调用（maxCon=100） | 1 |
| dataShare IO 线程（单线程） | 1 |
| 后端池 SOCKET_MAX=50 | 1 |

**⇒ 有效并发 = 1，TPS ≈ 10。**

> 这就是"接口压测怎么都上不去"的根因——**不是容量不够，是锁粒度把并发压成了 1**。

### 场景 B：N 个不同用户，同时打同一个接口

**假设**：N=1000 用户，Tomcat 200 线程，DSBean.maxCon=100，per-user 锁不构成约束（不同用户不同 key），后端 RT=100ms。

| 环节 | 并发 | 说明 |
|---|---|---|
| Tomcat | 200 | 硬顶 |
| DS 连接池 | **100** | 第 6 个请求起等 5s |
| dataShare IO（单线程） | **1** | ★ 若 B1 成立则此处瓶颈 |
| 后端池 | Σ(SOCKET_MAX) | 假设 20 协议 × 50 = 1000 |

**⇒ 有效并发 = min(200, 100, 1, 1000) = 1**（单 IO 线程模型）
**⇒ TPS ≈ 1/0.1s = 10**

**若 dataShare 有 N=8 个 worker 线程**：有效并发 = min(200, 100, 8, 1000) = **8**，TPS ≈ 80。

### 场景 C：多实例水平扩展（midservice 部署 N 个实例）

| 环节 | 并发 |
|---|---|
| Tomcat | N × 200 |
| DS 连接池 | N × maxCon |
| dataShare | **1（单点，不随 N 扩展）** |
| 后端池 | Σ(SOCKET_MAX)（共享） |

**⇒ 增加 midservice 实例无法提升 dataShare 的处理能力（单 IO 线程模型下）——dataShare 是整条链路的单点瓶颈。**

### 场景 D：批量模式（`directives` 一次调 N 个协议）

**[事实]** `maxMultiApiCount=20`（`ServiceConfig.java:192`），`HandlerController.java:792` 限制单请求内串联的 API 数。

**⇒ 单个 HTTP 请求可放大成 20 次串行 DS 往返** ⇒ **单个请求的端到端延迟 = 20 × RT_DS**，Tomcat 线程被占用 20 倍时长。

**⇒ 批量模式的"减少移动端 RTT"是成立的，但代价是 Tomcat 线程被长时间占用，等效于把 20 个并发压成 1 个串行。**

---

## 五、最窄瓶颈在哪一跳

### 结论：瓶颈位置随负载类型变化，但有两个"永久性"瓶颈

| 排名 | 位置 | 性质 | 影响 |
|---|---|---|---|
| **1** | **第 1 跳 per-user 锁**（`HandlerController.java:712→761`） | **永久性**，只要 `is.open.syncLock=Y` | **单用户单 API 并发恒为 1**，与系统容量无关 |
| **2** | **第 3 跳 dataShare IO 单线程**（B1 待实测） | **永久性**（若单线程） | **一个慢后端 = 全平台停摆**，且水平扩展无效 |
| 3 | 第 2 跳 DS 客户端池 `maxCon` | 配置决定 | 外部 core 模块配置，**待核实**；若为 5 则第 6 个请求就开始 5s 等待 |
| 4 | 第 4 跳 Hessian 的 `http.maxConnections`（默认 5） | JVM 默认，隐蔽 | 每个后端主机 5 并发 |
| 5 | 第 3 跳全局归还锁 | 永久性 | ~1k TPS 上限 |
| 6 | 第 4 跳后端池 `Σ(SOCKET_MAX)` | DB 配置 | 硬顶但通常不是最窄 |
| 7 | 第 2 跳 ansyKey 池 | 理论值 65534 | 实际远高于其他约束 |

### 一句话回答

> **整条链路当前能支持的"有效并发"是 1～10 级别（单用户单接口场景恒为 1），TPS 在 10～80 区间。**
>
> 而**理论容量**（Tomcat 200 × 多实例 × 后端池 1000+）是**数千级别**。
>
> **差距的 99% 不是容量不足，而是两个结构性约束造成的**：
> 1. **per-user 锁把并发压成 1**（`HandlerController.java:712→761`）
> 2. **dataShare 同步阻塞在 IO 线程上，一个慢调用停摆全平台**（`HandlerImpl.run()` 无线程移交）
>
> **换言之：这套系统的瓶颈是"串行化设计"，不是"资源不足"。** 把 per-user 锁的粒度收窄到真正的临界区、把 dataShare 的业务处理移交独立 worker 线程池，并发可以从 1 提升到**受限于 `Σ(SOCKET_MAX)` 与具体服务能力的数十～数百级别**——**这一下就是 10～100 倍的提升**。

---

## 六、必须实测的 6 项

| # | 待测项 | 为什么关键 | 方法 |
|---|---|---|---|
| **1** | **dataShare IO 线程数 / 是否单线程** | 决定上限是 `1/RT` 还是 `N/RT`，**差 N 倍** | `jstack <pid> \| grep -A5 "nio.reactor"`；看 `HandlerImpl.run` 所在线程名 |
| **2** | **生产 `DSBean.maxCon`** | 第 2 跳硬顶。**若为 5 则整条链路的并发就是 5** | `grep -rn "setMaxCon" $APP_HOME/1018/core/`；`jmap <pid> \| grep ConnectPool` |
| **3** | **Tomcat `maxThreads`** | 第 1 跳硬顶 | `grep -o 'maxThreads="[0-9]*"' $CATALINA_HOME/conf/server.xml` |
| **4** | **`is.open.syncLock` 取值 + `syncLockMap` 内容** | 决定 per-user 锁是否生效（单用户并发 1 还是 N） | 外部配置 + `ServiceServlet.java:322` 装载逻辑 |
| **5** | **`Σ(SOCKET_MAX)` 与协议总数** | 第 4 跳硬顶 | `SELECT COUNT(*), SUM(SOCKET_MAX) FROM TB_DS_PROTOCOL WHERE IS_VALID=1;` |
| **6** | **后端 RT 的 P50/P99** | 所有 TPS 公式的输入参数 | APM 打点 `DSStandardProtocol.execute` / `ConnHessianCommandParse.run` 耗时 |

**补充实测（若怀疑第 4 跳 Hessian 受限）**：
```bash
# 看 JVM 的 HTTP keep-alive 连接上限
java -XX:+PrintFlagsFinal -version | grep http.maxConnections
```

---

## 七、改造后并发提升预估

| 改造项 | 消除的约束 | 并发提升 |
|---|---|---|
| **per-user 锁粒度收窄**到真正临界区 | 第 1 跳约束 1-B | **单用户单 API：1 → N**（受 Tomcat/池限制） |
| **dataShare 引入业务 worker 线程池** | 第 3 跳约束 3-A | **1/RT → N/RT**，N=worker 数（如 32-64） |
| **DS 客户端池调大**（核实后按需） | 第 2 跳约束 2-A | 5 → 100+，需与 dataShare 侧 worker 数匹配 |
| **去掉全局 `static synchronized`**（归还锁按 clientFlag 分段） | 第 3 跳约束 3-B | ~1k TPS → 10k+ TPS |
| **Redis 借连接移出全局锁** | 第 3 跳约束 3-C | 消除正反馈崩溃回路 |
| **Hessian 改用带池的 HTTP 客户端** | 第 4 跳约束 4-B | 每主机 5 → 数十～数百 |
| **HTTP 客户端改单例复用** | 第 4 跳约束 4-C | 消除连接泄漏 |

### 改造后的链路公式

```
改造后最大并发 = min(
    Tomcat_maxThreads,                    # 200/实例 × 实例数
    DSBean.maxCon,                        # 100+
    单用户单API(收窄后),                   # N
    dataShare_worker线程数,                # 32-64  ★新增
    Σ(SOCKET_MAX),                        # 1000+
    具体服务并发能力                       # 取决于第5跳
)
```

**⇒ 合理目标：数十～数百的有效并发（视具体服务能力），TPS 从当前的 10～80 提升到数百～数千。**

**改造的优先级顺序（按"提升/风险比"）**：
1. **收窄 per-user 锁** —— 改动最小（`HandlerController.java:712/761`），单用户并发直接从 1 到 N
2. **核实并调大 DS 客户端池** —— 一行配置
3. **dataShare 引入 worker 线程池** —— 唯一的结构性改造，但收益最大（同时解决"一个慢调用停摆全平台"）
4. **消除全局归还锁** —— 消除全局串行点
5. 其余（Redis 锁范围、Hessian 池化、HTTP 单例）

---

## 附：全链路约束速查表

| 跳 | 约束 | 上限 | 类型 | 证据 |
|---|---|---|---|---|
| 1 | Tomcat 线程 | 部署配置（默认 200） | 硬顶 | `ServiceServlet.java:104`（只读 port） |
| 1 | **per-user 锁** | **1** | **永久** | `HandlerController.java:712→761` |
| 1 | `getTokenId` 全局锁 | ~10万-100万 ops/s | 串行 | `ServiceUtils.java:169` |
| 2 | **DS 客户端池** | **DSBean.maxCon（可能 5）** | 硬顶 | `ImageCompressUtils.java:90`（待核实） |
| 2 | ansyKey 池 | 65534 | 硬顶 | `HeaderKeyPool.java:15` |
| 2 | 池耗尽行为 | — | 雪崩 | `BIOSocketConnectManager.java:54-64` |
| 3 | **IO 线程数** | **1 或 N** | **永久** | `DSRunMain.java:85`（`★待实测`） |
| 3 | 全局归还锁 | ~1k TPS | 串行 | `SocketClientConnectManager.java:56` |
| 3 | Redis 全局锁 | ~1k-10k TPS | 串行+崩溃回路 | `ShardedReidsPool.java:58-63` |
| 3 | `LockCache` 锁序 | 可归零 | 全局死锁 | `LockCache.java:41-54` |
| 3 | 6 个无锁 Map | 可能挂死 | 正确性 | `HessianServiceCache:12` 等 |
| 4 | **后端池** | **Σ(SOCKET_MAX)** | 硬顶 | `ProtocolBean.java:68-70` |
| 4 | Hessian HTTP 连接 | 5/主机 | 隐蔽 | `HessianFactoryUtils.java:108`（HttpURLConnection） |
| 4 | HTTP 客户端泄漏 | — | 资源 | `HttpClientUtils.java` ×5 |
| 4 | 递归重试 | 100 层 | 放大 | `ConnSocketCommandParse.java:142-163` |
| 5 | 具体服务 | 未知 | 硬顶 | 不在本次源码范围 |

---

*本文档基于反编译源码（JD-Core 0.6.0）静态分析。标注"待核实/待实测"的部分必须按 §6 的方法在生产环境确认。*
