# dataShare 加 worker 线程池改造方案

> 目标：打破 dataShare「业务处理跑在 NIO reactor 线程」的单 IO 瓶颈，让 1000 TPS 撮合可落地。
> 改动量：**中等，仅 2 个文件**（`HandlerImpl.java`、`ConnServerThreadUtils.java`），不碰协议解析与撮合逻辑。

---

## 一、现状线程模型（问题在哪）

```
NioSocketServer（NIO reactor 线程）
   │  调用 handlerAdapter.run()
   ▼
HandlerImpl.run()                         ← @Scope("prototype")，每请求一个实例
   │  switch(connType) 同步分派
   ▼
ConnSocketCommandParse.run()              ← @Scope("prototype")
   │  callDSProtocol(...)
   │    SocketClientConnectManager.getSocketClient()   ← 借连接
   │    serverProtocol.execute(socketClient, body)     ← ★ 同步阻塞等后端响应
   │    releaseConnection(...)                          ← 归还
   ▼
session.reviewOffer(ReviewBean)           ← 写回响应
```

**根因**：`HandlerImpl.run()`（`HandlerImpl.java:31-62`）在 reactor 线程上**同步**执行 `commandParse.run()`，后者内部 `serverProtocol.execute()` 同步阻塞等后端。于是 **reactor 线程被一次后端往返占死**，等效「单 IO 线程」——一个 50ms 的撮合请求就占住 reactor 50ms，全平台 TPS ≈ 1/RT ≈ 20。

> 关键事实：`ConnServerThreadUtils.java:11` 已有一个 `Executors.newCachedThreadPool()`，但它**无界**（线程可无限增长 → 打满即 OOM），且 `HandlerImpl.run()` **根本没调用它**，等于白写。

---

## 二、改造目标

把「同步执行后端调用」从 reactor 线程**移交**到独立的有界 worker 线程池：

```
改造后：
NioSocketServer reactor 线程
   │  HandlerImpl.run()  → 立即把 dispatch 丢进 worker 池 → return（不阻塞）
   ▼
ds-worker 线程池（有界 32~128 线程）
   │  commandParse.run()  → 同步等后端（阻塞的是 worker，不是 reactor）
   ▼
session.reviewOffer(...)
```

**reactor 线程只做「收包 → 分派」，worker 线程承担「业务 + 后端往返」**。并发上限从 1（或 reactor 数）变成 worker 池大小。

---

## 三、改造三步

### 第一步：把无界 cachedThreadPool 换成有界 worker 池

`ConnServerThreadUtils.java` 改造：

```java
private static final ThreadPoolExecutor connServerExecutor = new ThreadPoolExecutor(
    32,                                  // corePoolSize：核心线程
    128,                                 // maximumPoolSize：峰值线程
    60, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(1000),      // 有界队列（背压的关键）
    new ThreadFactoryBuilder().setNameFormat("ds-worker-%d").build(),
    new ThreadPoolExecutor.CallerRunsPolicy()   // 队列满时让 reactor 自己跑 = 天然背压
);
```

- **有界队列**：防止队列无限堆积 → OOM。
- **CallerRunsPolicy**：队列满时，调用者（reactor 线程）自己执行任务——等价于「退化成现状同步执行」，从而 reactor 不再读新包，**自然限流**，且不丢请求（交易系统不能丢）。

### 第二步：`HandlerImpl.run()` 移交

`HandlerImpl.java` 改造——把 switch 抽成 `dispatch`，并在 `run()` 里移交：

```java
public void run() throws Exception {
    String procotolKey = CommandParseUtils.byteToString(this.reqBean.getMainHeader().getMainHigh())
                       + CommandParseUtils.byteToString(this.reqBean.getMainHeader().getMainLow());
    final ProtocolBean procotolBean = ProtocolCache.get(procotolKey);
    if (procotolBean == null) {
        throw new ServiceNoExistExcepion(CommandParseUtils.getProtocolString(this.reqBean.getMainHeader()));
    }
    // ★ 移交 worker 池，reactor 线程立即返回
    ConnServerThreadUtils.runThread(new Runnable() {
        public void run() {
            try {
                dispatch(procotolBean);                      // 原 switch 分派逻辑
            } catch (Exception e) {
                session.writeErr(reqBean.getMainHeader(), e.getMessage());  // 兜底写错
            }
        }
    });
}

private void dispatch(ProtocolBean procotolBean) throws Exception {
    switch (procotolBean.getConnType()) {
        case 0: handleDSSystemProtocol(); break;
        case 1: handleHessianConn();      break;
        case 2: handleSocketConn();       break;
        case 3: handleHttpConn();         break;
        // ...其余 case 不变
    }
}
```

### 第三步（可选增强）：按 connType 分组隔离

呼应「协议隔离」，慢撮合不占满查询线程：

```java
private static final ExecutorService TRADE_POOL  = namedFixed(64, "ds-trade-%d");  // connType=2 撮合
private static final ExecutorService QUERY_POOL  = namedFixed(32, "ds-query-%d");  // connType=0/1 查询

// dispatch 里按 connType 路由到不同池，而非单一 connServerExecutor
```

---

## 四、线程安全与必须验证的点

| 点 | 结论 |
|---|---|
| `HandlerImpl` / `ConnSocketCommandParse` 都是 `@Scope("prototype")` | ✅ 每请求一个实例，`reqBean`/`session` 无跨请求共享，移交安全 |
| **`session.reviewOffer()` / `session.writeErr()` 线程安全** | ⚠️ **必须验证**：这是 `IMidIoSession`（`com.ylsoft.nio.reactor` 依赖，不在源码树）。若它是异步入队（`review` 语义暗示），worker 线程调用安全；若是同步写 socket，需改回 reactor 线程写（或加写锁）。**改造前先看依赖 jar 的实现。** |
| 连接池并发 | ⚠️ worker 64 线程并发 `getSocketClient()`，`SOCKET_MAX` 必须 ≥ worker 并发，否则池上排队（见《连接池参数配置建议》） |
| 后端超时阻塞 worker | `serverProtocol.execute()` 仍同步阻塞，靠 `SOCKET_TIMEOUT` 封顶；超时后的递归重试会占住 worker，须配合护栏改造 |

---

## 五、配套改造（缺一不可）

worker 池只是把瓶颈从 reactor 移到 worker，若不同步处理下面的问题，worker 线程会被同样耗死：

| 配套 | 原因 |
|---|---|
| **去全局锁**（`releaseConnection` 的 `static synchronized`） | worker 并发归还连接时，全局锁串行会抵消 worker 收益 |
| **连接池调大**（`SOCKET_MAX`、DS 池 `maxCon`） | worker 并发 > 池大小则排队 |
| **递归重试收短 + 熔断**（`callDSProtocol` count<100） | 一次超时在 worker 里递归 100 次 ≈ 1000s 占死 worker |
| **超时分级**（`SOCKET_TIMEOUT` 按协议） | 慢撮合快速失败，释放 worker |

---

## 六、收益量化

| 指标 | 现状（reactor 同步） | 改造后（worker 池） |
|---|---|---|
| 并发执行能力 | 1 个 reactor 线程（待实测） | 64 worker 线程 |
| 撮合 TPS（RT=50ms） | ~20 | **~1280** |
| 提升 | — | **64×（线程数倍）** |
| 慢后端影响 | 一个慢请求停摆全平台 | 只占满自己的 worker（配合分组池更彻底） |

> 结论：改动仅 `HandlerImpl` + `ConnServerThreadUtils` 两个文件，就能把 dataShare 从「单线程 ~20 TPS」提到「64 线程 ~1280 TPS」，满足 1000 TPS 目标；前提是**先验证 `reviewOffer` 写回线程安全**，并同步做去锁 + 池调大 + 递归重试护栏。

---

*本文档基于反编译源码（`HandlerImpl.java`、`ConnServerThreadUtils.java`、`ConnSocketCommandParse.java`），行号可回溯；`reviewOffer` 线程安全与 reactor 线程数为待验证项。*
