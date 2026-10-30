# 系统缺陷清单与并发能力上限分析

> 分析对象：`dataShare-2.6.2` 服务端 + `dataShareClientAPI-1.3.4` SDK + `J_1018_midservice-v1.1.188.228.5`
> 全部结论附 `文件:行号` 证据。**代码能确定的写"事实"，需要实测的写"推断"并给出测定方法。**

---

## 目录

- [第一部分：缺陷清单](#第一部分缺陷清单)
  - [A 类：并发正确性缺陷（会导致数据错误、死锁、进程挂死）](#a-类并发正确性缺陷会导致数据错误死锁进程挂死)
  - [B 类：可用性缺陷（会放大故障、造成雪崩）](#b-类可用性缺陷会放大故障造成雪崩)
  - [C 类：性能缺陷（无界增长、重复计算、锁竞争）](#c-类性能缺陷无界增长重复计算锁竞争)
  - [D 类：功能缺陷（行为与设计意图不符）](#d-类功能缺陷行为与设计意图不符)
  - [E 类：安全缺陷](#e-类安全缺陷)
- [第二部分：并发能达到多少](#第二部分并发能达到多少)
  - [2.1 必须区分的三种"并发"](#21-必须区分的三种并发)
  - [2.2 连接并发（能挂多少客户端）](#22-连接并发能挂多少客户端)
  - [2.3 吞吐并发的真正天花板](#23-吞吐并发的真正天花板)
  - [2.4 全局串行点全表（含推导上限）](#24-全局串行点全表含推导上限)
  - [2.5 各级资源上限的实测方法](#25-各级资源上限的实测方法)
  - [2.6 端到端并发能力总结](#26-端到端并发能力总结)
- [第三部分：修复优先级](#第三部分修复优先级)

---

# 第一部分：缺陷清单

按"是否会导致系统错误/挂死"排序，而非按代码位置。

## A 类：并发正确性缺陷

> 这一类最危险：它们不报错，只是**在特定时序下静默地破坏正确性**。生产环境最难排查。

### A1.【致命】`LockCache.lockBusiness` 锁序倒置 —— 全局锁内获取业务锁

```java
// com/ylsoft/ds/constant/LockCache.java:41-54
public static void lockBusiness(String key) {
  if (key == null) return;
  businessLock.lock();          // ← ① 先拿全局锁
  try {
    if (!_lockCache.containsKey(key)) {
      _lockCache.put(key, new ReentrantLock());
    }
    ((Lock)_lockCache.get(key)).lock();   // ← ② 在持有全局锁的情况下阻塞获取业务锁
  } finally {
    businessLock.unlock();      // ← ③ 业务锁持有期间才释放全局锁
  }
}
```

**缺陷**：② 的 `lock()` 是**阻塞**调用，且发生在 ① 之后、③ 之前。若 key K 已被线程 A 持有，线程 B 调用 `lockBusiness(K)` 会在 ② 处阻塞，**同时紧握着 `businessLock`**。此时任何线程调用 `lockBusiness(任意其他 key)` 都会阻塞在 ①。

**后果**：**一个业务锁的持有者不释放，整个 dataShare 进程的所有 `lockBusiness` 调用全部卡死。**

**调用方**（仅 2 处，但都在关键路径）：
- `T00010033_PushlishMQService.java:53` — `lockBusiness("Producer_" + typeFlag)`，MQ 发布
- `T00010050_SendSMSService.java:45` — `lockBusiness("Producer_DS_SMS_TOPIC")`，短信投递

即：**MQ 发布与短信投递会互相锁死**。且 `new KrackleProducer(topicName)` 包含 Kafka broker 建连，耗时可达数百毫秒到数秒——**持锁窗口极长**。

**修复**：`businessLock` 只保护 map 结构，业务锁必须在**释放全局锁之后**获取：
```java
public static void lockBusiness(String key) {
  if (key == null) return;
  ReentrantLock target;
  businessLock.lock();
  try {
    target = _lockCache.computeIfAbsent(key, k -> new ReentrantLock());
  } finally {
    businessLock.unlock();      // ← 先释放全局锁
  }
  target.lock();                // ← 再阻塞获取业务锁
}
```

---

### A2.【致命】`SocketClientConnectManager` 池创建竞态 —— 永久死锁

```java
// com/ylsoft/ds/server/socket/core/SocketClientConnectManager.java:28-54
ConnectPool connectPool = (ConnectPool)cpCache.get(clientFlag);
if (connectPool == null) {
  AtomicBoolean atomicBoolean = (AtomicBoolean)lockMap.get(clientFlag);
  while ((atomicBoolean != null) && (!atomicBoolean.compareAndSet(false, true))) {
    Thread.sleep(1L);                              // ← 忙等
  }
  if (atomicBoolean == null) {
    atomicBoolean = new AtomicBoolean(true);
    lockMap.put(clientFlag, atomicBoolean);        // ← check-then-act，非原子
  }
  ...
} finally {
  atomicBoolean.set(false);                        // ← 释放的是局部变量持有的对象
}
```

**三重缺陷叠加**：

1. `lockMap.get()` → `new AtomicBoolean` → `put()` 是**非原子的 check-then-act**。两个线程可同时判定 null，各建一个 AtomicBoolean，后者覆盖前者。
2. `finally` 中 `atomicBoolean.set(false)` 释放的是**局部变量**持有的对象。若 (1) 发生覆盖，释放的是**已被覆盖的旧对象**——新对象的值永远停在 `true`。
3. 于是**后续所有线程的 `compareAndSet(false, true)` 永远失败**，全部卡在 `Thread.sleep(1L)` 循环里。

**后果**：该 `clientFlag`（= 一个后端协议）的所有请求**永久挂死**，且因为是 `Thread.sleep(1)` 忙等，**CPU 100% 占用**。这是最难恢复的一类故障——不重启进程无法自愈。

**修复**：`lockMap` 改 `ConcurrentHashMap` + `computeIfAbsent` 存 `AtomicBoolean`（或直接用 `putIfAbsent`），删除 `Thread.sleep` 自旋。

---

### A3.【致命】客户端池耗尽 → 关闭整池 → 递归重建的雪崩

**服务端侧**：
```java
// com/ylsoft/ds/service/nio/impl/conn/ConnSocketCommandParse.java:150-154
if (errMsg.indexOf("Timeout waiting for idle object") > -1) {
  SocketClientConnectManager.removeConnetPoll(mainProtocolKey);   // 关闭整个池
  str2 = callDSProtocol(mainProtocolKey, count);                  // 重建后重试
}
```
`removeConnetPoll` 是 `static synchronized`（`SocketClientConnectManager.java:63`）→ 关闭连接池期间**所有协议的所有请求都阻塞在这把锁上**。

**客户端侧（SDK）同样存在**：
```java
// dataShareClientAPI/com/ylsoft/ds/api/client/core/BIOSocketConnectManager.java:54-64
if (errMsg.indexOf("Timeout waiting for idle object") > -1) {
  ConnectPool cp = (ConnectPool)_cpCache.get(sp);
  if (cp != null) { cp.close(); _cpCache.remove(sp); }   // 关闭整池
  return getSocketClient(sp, poolConfig);                // 递归重试
}
```

**雪崩链**：池耗尽（`maxWaitMillis=5000`，即每个请求先阻塞 5 秒）→ 关闭整池 → **所有在途连接被强杀**（客户端侧 `cp.close()`）→ 那些请求也失败 → 更多重试 → 池持续重建。

**叠加放大器**：`ConnSocketCommandParse.java:142-146` 与 `:156-163` 的**递归重试深度最高 100 次**。一次 10 秒的读超时可放大为约 **1000 秒的占用**。

**修复**：递归改循环 + 指数退避 + 熔断；池耗尽时**不关闭整池**（只销毁坏连接）；`maxWaitMillis` 从 5000 降到 500~1000。

---

### A4.【严重】`HessianServiceCache` / `HttpServiceCache` / `AESKeyCache` / `ProducerCache` 用裸 HashMap 承载并发路由

| 类 | 位置 | 写方 | 读方 | 后果 |
|---|---|---|---|---|
| `HessianServiceCache._cache` | `server/hessian/HessianServiceCache.java:12` | 协议加载线程 | **NIO 请求线程**（`ConnHessianCommandParse.java:154`） | JDK7 HashMap resize 成环 → **get 死循环，进程挂死** |
| `HttpServiceCache._cache` | `server/http/HttpServiceCache.java:9` | 协议加载线程 | NIO 请求线程 | 同上 |
| `AESKeyCache._cache` | `server/socket/gomti/head/AESKeyCache.java:8,26` | 登录时 | **每次收发**（`GomtiCommonProtocol.java:138`） | 真实并发写 |
| `ProducerCache._cache` | `mq/cache/ProducerCache.java:9` | **并发 publish**（`T00010033:64`） | 同上 | 结构损坏 / 丢 producer |

**同库内已有正确写法**：`ProtocolCache` / `ServerProtocolCache` / `SocketClientParaCache` / `ClassLoaderCache` 都用了 ConcurrentHashMap ⇒ **这是无意识引入，不是设计权衡**。

**修复**：全部改 `ConcurrentHashMap`。

---

### A5.【严重】`SubscribeCache` 用 TreeMap，且遍历中删除

```java
// com/ylsoft/ds/service/subscribe/cache/SubscribeCache.java:24（_cache = new TreeMap()）
// T0001fe01_IPByTopicService.java:37  → 遍历 getValues()
// T0001fe01_IPByTopicService.java:58  → 同一路径内调用 SubscribeCache.removeKey()
```

TreeMap 非线程安全；`getValues()` 返回的视图被管理命令遍历时，另一线程 `removeKey` ⇒ **ConcurrentModificationException**，或 TreeMap 内部结构损坏。

**修复**：改 `ConcurrentHashMap`（`getValues()` 改返回快照 `new ArrayList<>(map.values())`）。

---

### A6.【严重】midservice `LockUtils.lockMap` 竞态导致互斥失效 + 内存泄漏

```java
// com/ylsoft/mid/service/utils/LockUtils.java:9
public static Map<String, Lock> lockMap = new ConcurrentHashMap();

// HandlerController.java:1735-1740
if (LockUtils.lockMap.get(lockKey) == null) {
  Lock lock = new ReentrantLock();
  LockUtils.lockMap.put(lockKey, lock);
}
((Lock)LockUtils.lockMap.get(lockKey)).lock();
```

**三个缺陷**：

1. **check-then-act 非原子**：`get` 与 `put` 之间有竞态，两线程可能各 new 一个 `ReentrantLock` 并互相覆盖 ⇒ **互斥完全失效**（线程 A 锁 L1，线程 B 锁 L2）。必须用 `computeIfAbsent`。
2. **无淘汰**：`lockMap` 全文**只有 put 没有 remove**（唯一写入点 `:1737-1739`）。key = `api + "_" + tokenId`，规模 = **API 数 × 在线用户数**，单调增长 ⇒ 内存泄漏。
3. **`unLockApi` 重新 `get`**（`:1756`）—— 若期间被覆盖，`unlock()` 抛 `IllegalMonitorStateException`（非持有者解锁）。

**修复**：`computeIfAbsent` + Caffeine 加过期清理 + unlock 时用局部变量持有同一个 Lock 引用。

---

### A7.【严重】midservice `HandlerController` 出参脱敏用 `indexOf` 子串匹配

```java
// HandlerController.java:1790,1807
if (apiRtnCode.indexOf(key) > -1) { tempRtn.put(key, "*****"); }
```

`apiRtnCode` 是逗号分隔的字段名列表，`indexOf` 做**子串**匹配：
- 字段 `ID` 会误命中 `IDNO`、`USERID`
- 字段 `NAME` 会误命中 `NICKNAME`、`USERNAME`

⇒ **脱敏越权（该脱敏的没脱）+ 漏脱敏（不该脱的脱了）**。同类问题见 `ToBackController.java:346`（`func_id` 匹配）。

**修复**：`apiRtnCode.split(",")` 成 `Set` 后 `contains`。

---

## B 类：可用性缺陷

### B1.【致命】业务处理在 IO 事件循环线程上同步执行（推断，需 jstack 证实）

**证据链**：

1. **全树仅 3 处业务相关线程创建**，无一是请求处理：
   - `DSRunMain.java:85` `new Thread(server).start()` — 启动 NIO server
   - `DSRunMain.java:146` `new Thread(new HandleLastOffsetThread())` — 刷 offset
   - `DSRunMain.java:156` `new Thread(new LogSpaceAutomaticallyCleanedThread())` — 清理日志
2. **两个无界线程池都不处理业务请求**：`ConnServerThreadUtils.java:11`（跑协议池初始化）、`SubscribeThreadUtils.java:8`（跑 Kafka consumer）。
3. **`HandlerImpl.run()` 无线程移交**：`:35` `setThreadName(...)` → `:36-57` 直接 `switch` 分派 → `:67,75,83,91` 调 `commandParse.run()`，中间**无 `executor.submit` / `new Thread`**。
4. **下游调用全部阻塞**：`ConnSocketCommandParse.java:137` `serverProtocol.execute(socketClient, ...)` 是阻塞式 socket 读写；`ConnHessianCommandParse.java:175` `Method.invoke(...)` 触发 Hessian HTTP POST（阻塞）。
5. **响应确实是异步入队的**：`this.session.reviewOffer(new ReviewBean(...))`（`ConnSocketCommandParse.java:72`、`ConnHessianCommandParse.java:99/115`），且 `KrackleConsumer.java:146` 检查 `bean.getSession().getReviewQueue().size() > 20` —— **存在 per-session 发送队列**。

**推论**：handler 在某个线程上同步跑完阻塞的业务调用，把响应投进 session 队列，由 IO 线程排空写出。

**如果该线程就是 IO 事件循环线程**（`PerferenceEnum.HIGN_PERFORMANCE` 暗示存在多线程策略，但单线程是可能的默认），则：

> **一次 10 秒的后端读超时，会让 dataShare 在这 10 秒内完全无法处理任何其它连接。**

**证实方法**：
```bash
jstack <pid> | grep -A5 "nio.reactor"
# 若只有 1 个 reactor 线程在跑 HandlerImpl.run → 单线程模型成立
# 若存在 N 个 worker 线程 → 吞吐上限 = N/RT
```

**这是整个系统最重要的单一未知量。** 它决定了并发是"1/RT"还是"N/RT"，差 N 倍。

---

### B2.【严重】midservice per-user 锁跨越整个远程调用

```java
// HandlerController.java:712 → 761
lockApi(token, api);          // :712  加锁
try {
  ...
  rtn = callable.call();      // :752  ← 整个业务执行（含所有 DS 往返）
} finally {
  unLockApi(token, api);      // :761  解锁
}
```

**锁粒度** = `api + "_" + tokenId`（`:1734`）⇒ **同一用户对同一 API 的并发被完全串行化**。

**触发条件**（`:1729-1732`）：`is.open.syncLock=Y` **且** `syncLockMap.get(api)` 为 null 或 ==1。`syncLockMap` 由 `ServiceServlet.java:322` 从外部配置装载。

**后果**：若下游 RT = 1s，则**单个用户对单个 API 的上限就是 1 QPS**，与系统总容量无关。

**修复**：锁范围收窄到"真正需要互斥的临界区"（如扣减库存），而不是整个 handler；或改为 per-user 排队 + 幂等键。

---

### B3.【严重】midservice 三处全局 `synchronized` 在每请求路径

```java
DSUtils.java:35          public static synchronized DSClientAPI getClient()   // 135 个 DS 调用点全经过
SerialService.java:31    public synchronized String _genSerialLocal(int)     // 每请求一次
ServiceUtils.java:169    public static synchronized String getTokenId(req)  // 每请求必经
```

- `getClient()`：方法体只有一次字段读，**纳秒级**，本身无害；但它是所有 135 个 DS 调用的必经点，等于给整个 DS 交互路径加了一层 monitor。
- `getTokenId()`：纯内存操作（读 4 个 header + `String.replace`），微秒级，但**每请求必过**。
- `_genSerialLocal()`：`System.currentTimeMillis` + 字符串拼接，`DateUtils.getNowDString` 很可能每次 new `SimpleDateFormat`。

**修复**：全部改 `volatile` 读 / `ThreadLocal` / 去锁。

---

### B4.【严重】`ShardedReidsPool.getConnect()` 在全局锁内做可能阻塞的借连接

```java
// com/ylsoft/ds/redis/ShardedReidsPool.java:58-75
public static ShardedJedis getConnect() {
  lock.lock();
  try {
    if (isEnable && shardedJedisPool != null) {
      localShardedJedis = shardedJedisPool.getResource();   // ← 池耗尽时阻塞至 MaxWaitMillis
      return localShardedJedis;
    }
    ...
  } finally { lock.unlock(); }
}
```

**缺陷**：全局 `ReentrantLock` 包住了 `getResource()`。commons-pool2 的 `getResource()` 在池耗尽时**阻塞等待 `MaxWaitMillis`**。

**后果**：Redis 池耗尽 ⇒ **全局锁被持有整个等待时长 ⇒ 全系统所有 Redis 操作（缓存读写、分布式锁、队列）全部归零**。

**更糟的耦合**：`T00010040_LockBusinessService.java:50-54` 的 `lockDetail` **在整个 1ms 忙等自旋期间一直持有 `jedis` 连接**（`finally` 才归还，`:64-66`）：

```java
ShardedJedis jedis = ShardedReidsPool.getConnect();
try {
  if (lockDetail(jedis, lockKey, ...)) { ... }   // :54  内含 while + setnx + Thread.sleep(1)
} finally {
  ShardedReidsPool.returnResource(jedis);         // :66
}
```

⇒ **N 个线程争抢同一把锁 = 占用 N 个 Redis 连接空转**，把池迅速耗尽 ⇒ 触发 B4 的全局阻塞。**这是一个正反馈崩溃回路。**

**修复**：`getResource()` 移出锁；锁自旋改为"循环 setnx，失败即归还连接并 sleep"。

---

### B5.【严重】`T00010040` 分布式锁用 `setnx` + `expire` 两条独立命令

```java
// T00010040_LockBusinessService.java:87-98
if (jedis.setnx(tkey, "1").longValue() == 1L) {
  jedis.expire(tkey, autoTimeoutTime);   // ← 两条命令，中间可能崩溃
  return true;
}
```

**四项缺陷**：

| 缺陷 | 后果 |
|---|---|
| `setnx` 与 `expire` **非原子** | 中间崩溃 ⇒ 锁**永不过期** ⇒ 永久锁死 |
| 锁值固定 `"1"`，**不存 owner token** | 不可重入；**任何客户端能 DEL 掉别人的锁**（`T00010041:43-44` 只 `exists`+`del`） |
| **无看门狗续期** | 业务执行超 TTL ⇒ 锁被提前释放 ⇒ 并发错误 |
| `waitTime>0` 时 **1ms 忙等 + 每次发一次 Redis 往返** | 每次迭代 = 1 RTT，1-2ms 间隔 ⇒ **每 key 约 300-500 RTT/秒** |

**修复**：改 `SET key <UUID> NX EX ttl` 原子命令；解锁用 Lua 脚本校验 token 后删除；加看门狗续期线程。

---

### B6.【中】`T00010033` MQ 发布在 Kafka 确认前就返回成功

```java
// T00010033_PushlishMQService.java:70-71
producer.send(value.getBytes(), ...);
returnFlag = "1";     // ← 立即返回成功，不等 ack
```

producer 参数 `request.required.acks=1`（`KrackleProducer.java:79-85`）—— **acks=1 而非 -1**，broker 故障时可能丢消息。代码中无 `Future.get()` 等待。

⇒ **Kafka 侧失败对调用方完全不可见**。审计日志、监控数据、交易事件都受影响。

---

### B7.【中】MQ 消费失败会杀掉整条订阅

- consumer 线程 `catch (Throwable)` 只记日志继续循环（`KrackleConsumer.java:171-173`）——**无重试、无 DLQ**。
- 但 `ReceiveHandleImpl` 抛 `RuntimeException` 时会 `consumer.setRun(false)` + 摘除订阅 + destroy session（`ReceiveHandleImpl.java:57-62`）⇒ **一条消息处理失败 = 整条订阅死亡**。
- 而 offset 已在推送前记录（`:50` 记 offset，`:51` 推送）⇒ **该消息永久丢失**。

---

### B8.【中】offset 刷库是 60 秒固定周期 + N+1 SQL

`HandleLastOffsetThread.java:34-41` 每 60s 遍历**所有** offset bean 逐条 UPDATE；每条 update 又先 `getExistRecord()` 查一次再决定 UPDATE/INSERT（`MQTopicServiceImpl.java:164-141`）⇒ **N+1 SQL**。

⇒ 崩溃时最多丢 60 秒的 offset（**消息重投**）；但内存中 offset 已推进 ⇒ 同一进程内**不重投**。整体是"可能重复也可能丢"的弱语义。

---

## C 类：性能缺陷

### C1.【高】每请求一次 JDBC —— 缓存位留了但从未接线

```java
// T00010101_LoasParaService.java:48 → ParameterServiceImpl.java:41 → PubConfigServiceImpl.java:54
List<Map> getAllPubConfig() { return jdbcTemplate.queryForList(query); }
```

`PubConfigCache` 类**存在且实现了 5 秒 TTL**，但全库 grep 只命中其自身定义 ⇒ **从未被调用**。

且 `getAllPubConfig` 的 catch 返回 `new ArrayList()`（`:52-54`）⇒ **DB 故障伪装成"配置为空"**，静默降级。

---

### C2.【高】每 publish 一次 Redis + 潜在 JDBC

`getTopicName` 先查 Redis `-INNER-DSMQ-{typeFlag}`，miss 再查 `TB_DS_MQ_TOPIC`，再 miss 才建 topic 并写库（`MQTopicServiceImpl.java:27-48`）。Redis 被 evict ⇒ 退化为**每次 publish 一次 JDBC**。

---

### C3.【高】HTTP 客户端每请求新建且从不关闭

```java
// com/ylsoft/ds/server/http/HttpClientUtils.java:34,83,125,159,192（5 个重载）
CloseableHttpClient httpclient = HttpClients.createDefault();
...
finally { if (httpPost != null) httpPost.releaseConnection(); }   // ← 只 release 请求，不 close client
```

每个 HTTP 请求 new 一个 `CloseableHttpClient`（含新的连接池和线程池），**从不 close** ⇒ 连接池对象泄漏，底层 socket 靠 GC 回收。

**修复**：改单例 + 显式 `close()`。

---

### C4.【高】midservice 路由查找 O(n) 线性扫描，每请求两次

```java
// HandlerController.java:622-628 与 :749-756
for (HandlerRouter _router : this.handlerRouters) {
  if (restfull.equals(_router.getAPI_RESTFULL())) { router = _router; ... break; }
}
```

`handlerRouters` 是 `ArrayList`（`:1109`）。本 jar 声明 **1296 个唯一协议号**（实测），**每请求两次线性扫描** + `String.equals` 逐个比较。

同类：
- `apiConfig` 线性扫描（`:798-710`）
- `KeyMapper.getNameByAlias` 扫描 ~1745 条（145 硬编码 + 10×10×16 个 `MT1xx` 码，`KeyMapper.java:41-52,113-124`）⇒ **一次 20 参数的请求 = 3.5 万次字符串比较**
- `MCallable` 每个方法参数一次线性查找（`:2410-2421`、`:2456-2465`）

---

### C5.【高】敏感词过滤器每次重建整棵 Trie

```java
// utils/sensitive/SensitivewordFilter.java:26-29
public static SensitivewordFilter getInstance() { return new SensitivewordFilter(); }   // ← 不是单例！
private SensitivewordFilter() { this.sensitiveWordMap = new SensitiveWordInit().initKeyWord(); }
```

`initKeyWord()` → `DSUtils.getClient().getRedisInfo("1001_INFO", "SENSITIVE")`（`SensitiveWordInit.java:109`）→ 再建一棵 `HashMap<Character,Map>` 字典树。

⇒ **每次命中敏感词检查的请求 = 1 次 DS Redis 往返 + 一次全量 Trie 重建**。

且 `isContaintSensitiveWord` 是 **O(len²)** 最坏（`:54-65` 每个字符位置重跑一次 `CheckSensitiveWord`，命中后**不 break**，仍扫全串）。

---

### C6.【高】`DSUtils.callHession` 的 Java 原生序列化往返 × 113

```java
// DSUtils.java:143 → :60-72
obj = revert(obj);
public static Object revert(Object obj) {
  ByteArrayOutputStream bos = new ByteArrayOutputStream();
  ObjectOutputStream oos = new ObjectOutputStream(bos);   // 每次 new
  oos.writeObject(obj);
  ... ObjectInputStream ois = new ObjectInputStream(bis);  // 每次 new
  return ois.readObject();
}
```

**113 个 hession 调用点，每次返回都要一次完整 Java 序列化 + 反序列化**。

---

### C7.【高】热路径 per-request 对象分配

- **2 次 Spring `getBean` + 2 次 prototype 实例化**（`HandlerImpl.java:67,75,83,91`；35 个 `T*Service` 全部 `@Scope("prototype")`）
- **1 次 clone**：`ServerProtocolCache.get()` 每次 clone（`:20`）→ `DSStandardProtocol.clone()` 再 clone `mainHeader`（`:144-148`）
- **至少 3 个 StringBuilder**：`CommandParseUtils.getCommand`（2 个）+ `getProtocolString`（1 个）+ `HandlerImpl.run()` 额外拼一次 procotolKey
- `CommandParseUtils.byteToString` 是 **256 分支 switch**（`:41-557`），**同样的实现在 3 个 jar 中重复了 3 份**

---

### C8.【中】消费线程无上限 + 每线程 1MB 缓冲 + 忙轮询背压

- `SubscribeThreadUtils.java:8` `Executors.newCachedThreadPool()`（**无界**），每订阅一个长驻线程
- `KrackleConsumer.java:133` `new byte[1048576]`（**1MB/线程**）⇒ 1000 订阅 = **1GB 常驻**
- `:175` 在 while 循环内每轮再 new 一个 2048 字节 keyBytes
- 背压：`:146` `reviewQueue.size() > 20` 时 `Thread.sleep(0L, 300000)`（**0.3ms 忙轮询**）

---

### C9.【中】队列统计 O(n) + Redis 内存单调泄漏

- `T00010039`：HGETALL 拉全量再**逐条 LLEN**（`:89-97`）⇒ N 个队列 = N+1 次 Redis 往返
- `T00010037` 每次 append 写 **3 个 hash + 1 个 list**（`:50-56`）
- `DS-QUEUE-ALL` 是**只增不减的全局注册表**，**无删除路径** ⇒ **Redis 内存单调泄漏**

---

### C10.【中】无界缓存三处

| 缓存 | 位置 | 增长规律 |
|---|---|---|
| `LockUtils.lockMap` | midservice `utils/LockUtils.java:9` | **API 数 × 在线用户数**，只增不删 |
| `LockCache._lockCache` | dataShare `constant/LockCache.java:12` | put 无 remove（key 量小） |
| `DS-QUEUE-ALL` | Redis | 队列注册表，只增 |

---

### C11.【中】热路径日志无级别守卫

```java
// ConnSocketCommandParse.java:41,70；ConnHessianCommandParse.java:46,65
this.log.info(new StringBuilder().append("...").append(protocolStr).append("] start...").toString());
```

**参数是已拼好的字符串**（非 log4j `{}` 占位符）⇒ **即使 INFO 关闭，字符串拼接开销照付**。

对照 `DSStandardProtocol.java:56,59,66` 用 `DS_SERVER_DETAIL_LOG` 判定是正确做法。

### C12.【中】`Validate` 27 处 `.matches()` 每次重编译正则

`String.matches()` 内部 `Pattern.compile()`。对照 `utils/xss/XssUtil.java:12-31` 正确做成了 `static final Pattern`。

### C13.【中】`DSUtils.callSocket` 二次序列化

`DSUtils.java:247,253`：`jo` 已是 JSONObject，又 `toString()` 再 `JSONUtils.toMap()`。

### C14.【中】`OpenHandler` 在请求路径上 `Thread.sleep`

`handler/OpenHandler.java:404` — 开户接口在 Tomcat 工作线程上**主动 sleep** 等开户完成，**直接吃掉一个工作线程**。

### C15.【中】审计 MQ 写同步阻塞在请求路径

`HandlerController.java:886,944` — `publishInfo` 在 dataShare 侧是同步 Kafka `send()` ⇒ **审计日志的 MQ 写延迟直接计入接口响应时间**。且 `1018_MONITOR_DATA` 是**无界 Redis List**（rpush 从不 ltrim）。

---

## D 类：功能缺陷

| # | 问题 | 位置 |
|---|---|---|
| D1 | `T0001fa01`(Suspended) 与 `T0001fa02`(Recovery) **代码逐行相同**，都只遍历订阅缓存回吐列表，**不挂起/不恢复任何消费者** | `service/nio/impl/control/` |
| D2 | `T0001fa03` 的 connType 3/4 分支空实现 ⇒ **HTTP / WebService 类型无法通过 reload 生效** | `T0001fa03_ReloadProtocoldService.java:69-70` |
| D3 | `connType=4`(WebService) / `connType=5`(Fix) 全链路空实现 —— **死代码** | `HandlerImpl.java:96-102`；`WebServiceConnService.java:12-14`；`FixConnService.java:12-14` |
| D4 | `T0001fc02` 名为 setDetailStatus，**不是熔断器**，只是全局日志开关 | `T0001fc02_setDetailStatusService.java:38` |
| D5 | `@HandlerRule` 注解（1332 处，1296 协议）**运行时不参与路由**，真正绑定在外部 `api.json` ⇒ **双重事实源** | `HandlerController.java:2137-2193` |
| D6 | 协议号防伪开关失效：`if/else if` 写反，Y 与非 Y 走**完全相同**的逻辑 | `HandlerController.java:501-522` |
| D7 | 攻击检测死代码：`MtradeInterceptor.preHandle` 直接 `return true`，`checkAttack()` 无调用方 | `MtradeInterceptor.java:42` |
| D8 | `WhiteApi.apis` 是**死配置** —— `whiteApis` 字段只写不读 | `HandlerController.java:1112` |
| D9 | `RedisPool`（非分片）整个是**死代码** | `redis/RedisPool.java` |
| D10 | `InterfaceBean` 的 `if (Modifier.isInterface(modifiers));` 是**空语句**，接口性检查形同虚设 | `server/asm/bean/InterfaceBean.java:18` |
| D11 | `MQTopicServiceImpl.putTopcNameToRedis` **重复归还同一 jedis 两次** | `db/update/impl/MQTopicServiceImpl.java:85,91` |
| D12 | `BeanFactory.clear()` 在热部署时清空单例缓存 ⇒ 在途请求可能拿到**新建的 handler 实例**，状态丢失 | `utils/BeanFactory.java:12-40`；`HandlerController.java:1101` |
| D13 | `LibreTranslateMain` 静态块硬编码 Linux 绝对路径 ⇒ 文件缺失则 `ExceptionInInitializerError` | `translate/LibreTranslateMain.java:78` |
| D14 | 退订命令号与订阅撞车（`DS0001fa10Protocol` 的 `getSubLowProtocol()` 返回 52=0x34） | SDK `DS0001fa10Protocol.java:31` |
| D15 | `DSBean` 构造函数 Bug：`this.userPswd = "test@123"` 误写成 `this.userName` ⇒ `getUserPswd()` 永远返回 null | SDK `bean/DSBean.java:37-38` |
| D16 | `ShardedReidsPool.getIntValue` 硬编码读小写 `"key"` | SDK `redis/ShardedReidsPool.java:56` |

---

## E 类：安全缺陷

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| **E1** | **SQL 注入** | `db/load/impl/ProtocolLoadImpl.java:115,125,136` | `"RANDOM_ID='" + key + "'"` 直接拼接，**无任何校验**。`key` 来自 `T0001fa03/04` 请求体的 `PROTOCOL` 字段 ⇒ **外部输入直达 SQL** |
| **E2** | **Redis 密码明文回吐** | `T00010030_GetRedisService.java:27` | `reJson.put("USERNAME", SystemRedisConfig.AUTH)` |
| **E3** | **解密后敏感参数进 INFO 日志** | `HandlerController.java:245,271` | 完整业务参数（密码、身份证、资金账号）落盘，每请求 2 条 |
| **E4** | **AES-CBC 用 Key 当 IV** | `HandlerController.java:321,1232` | `aesKey.getBytes("UTF-8")` 同时作 Key 与 IV |
| **E5** | **出参脱敏 indexOf 子串匹配** | `HandlerController.java:1790,1807`；`ToBackController.java:346` | 见 A7 |
| **E6** | **SQL 关键字脱敏用 contains** | `HandlerController.java:1193` | 误判 + 漏判（`INTO`/`DELETE`/`EXEC` 不在列表） |
| **E7** | **DSBean 密码硬编码在源码** | `ImageCompressUtils.java:85-86`；`ThirdNoitfyController.java:160-161` | `test` / `test@123` + 内网 IP `10.168.15.41` 明文入库 |

---

# 第二部分：并发能达到多少

## 2.1 必须区分的三种"并发"

| 概念 | 定义 | 本系统现状 |
|---|---|---|
| **连接并发** | 能同时挂多少客户端连接 | 受 fd 限制，**代码无限制**，可达数千 |
| **吞吐并发** | 每秒能处理多少请求 | **瓶颈在此**，由全局串行点决定 |
| **业务并发** | 能同时处理多少个业务请求 | 被 per-user 锁 + 池大小**双重收窄** |

**这三者相差 3～5 个数量级**。只报"能支持多少并发"是没有意义的。

---

## 2.2 连接并发（能挂多少客户端）

### dataShare 前端（接受 midservice 的连接）

**[事实]** **代码中无任何连接数限制**。`DSRunMain.java:67-78` 的全部配置项：

```java
NioSocketServer server = new NioSocketServer(port);
server.getConfig().setHandlerName("handlerAdapter");
server.getConfig().setIntervals(0L, 10000);
server.getConfig().setDetailLog(...);
server.getConfig().setClearedTimeoutTime(120000L);   // ← 唯一与连接相关的
server.getConfig().setReuseAddress(true);
server.getConfig().setTcpNoDelay(true);
server.getConfig().setReceiveBufferSize(65536);        // ← 每连接 64KB
server.getConfig().setSendBufferSize(200704);          // ← 每连接 200KB
```

**无 `maxConnection`、无 `backlog`**。

**[事实] 内核缓冲是真实成本**：`recv 64KB + send 200KB = 264KB/连接`。
- 1000 连接 → **264 MB 内核内存**
- 4000 连接 → **1 GB 内核内存**

**[事实] 空闲回收**：`clearedTimeoutTime=120000`（120s）。客户端只要每 2 分钟发一个包即永不超时。

**[推断] 实际上限 = OS 文件描述符**。Linux 默认 `nofile=1024` 时约 1000 条长连接；调至 65535 则 4000+ 条连接会吃掉 1GB 内核缓冲。

**⇒ 连接并发可达数千级，但这不是瓶颈。**

### midservice → dataShare 客户端侧

**[事实] SDK 池默认 `maxCon=100`**（`DSBean.java:36`），但**midservice 实际用了更小的值**：

```java
// ImageCompressUtils.java:88-90  ← 赋给全局 DSUtils.dsClient
dsBean.setTimeOut(20000);
dsBean.setInitCon(2);
dsBean.setMaxCon(5);            // ← ★ 只有 5 条连接！

// ThirdNoitfyController.java:162-164
dsBean.setTimeOut(10000);
dsBean.setInitCon(2);
dsBean.setMaxCon(30);
```

**[事实] 极严重的发现**：`ImageCompressUtils.initDS()` 里的 `dsBean.setMaxCon(5)` 设置的是 **`DSUtils.dsClient`（全局共享的客户端）**，而 135 个 DS 调用点全部走 `DSUtils.getClient()`。

**⇒ 若该配置在生产生效，midservice → dataShare 的并发上限只有 5 条连接。** 每个 DS 调用独占一条连接（`DSClientAPI.execute` 是同步 BIO，`getSocketClient` → `sendTo` → `readMainHeader` → `releaseConnection`），**第 6 个并发 DS 调用必须等 `maxWaitMillis=5000`**，超时抛 `Timeout waiting for idle object` → 触发 **A3 雪崩：关闭整池、全部在途连接被强杀**。

> ⚠️ `initDS()` 在本 jar 内的唯一调用点是 `ImageCompressUtils.main()`（测试用 main），生产的初始化可能在外部 `core` 模块（`com.ylsoft.mid.core.utils.CoreUtils`）中。**这是必须立即到生产环境核实的配置项。**

```bash
# 生产核实
grep -rn "setMaxCon\|setInitCon" /path/to/1018/core/ 2>/dev/null
jmap <pid> | grep -A20 ConnectPool   # 看实际池大小
```

---

## 2.3 吞吐并发的真正天花板

### 关键模型（若 B1 的单 IO 线程推断成立）

```
系统总 TPS ≈ 1 / (后端平均 RT)
```

**后端 10ms → ~100 TPS；后端 1s → ~1 TPS。**

且因为 `SocketClientConnectManager.java:56` 的 `static synchronized releaseConnection` 是**全协议共享**的，实际是：

```
系统总 TPS ≈ min( 1/RT_后端 , 1/T_归还锁 , 1/T_Redis借连接 , 1/T_tokenId )
```

**这个模型与"有多少线程"无关** —— 在单 IO 线程模型下，加线程数毫无帮助。

### 各级约束的数值

#### (1) 后端 socket 池

**[事实] 100% 来自数据库，无代码默认值**：

```java
// ProtocolBean.java:68-70
this.socketTimeout = ((Integer)inMap.get("SOCKET_TIMEOUT")).intValue();
this.socketInit   = ((Integer)inMap.get("SOCKET_INIT")).intValue();
this.socketMax    = ((Integer)inMap.get("SOCKET_MAX")).intValue();
```

SQL（`ProtocolLoadImpl.java:49`）从 `TB_DS_PROTOCOL` 读取。

**[事实] 若 DB 未配置该表，`((Integer)null).intValue()` 抛 NPE → 启动失败**。即 **DB 是硬依赖，不会静默降级**。

**[事实] 唯一硬编码池参数**：`maxWaitMillis=5000`（`SocketConnRunnable.java:120,169,213,257,302` 五处重复）。
**未设置 `testOnBorrow`** ⇒ commons-pool2 默认 false ⇒ **借出时不校验连接有效性**，坏连接由业务层发现。

**单协议并发上限 = `SOCKET_MAX`**。全局后端并发上限 = `Σ(SOCKET_MAX)`。

**协议数量无代码上限**（`TB_DS_PROTOCOL` 无 LIMIT、无校验）。

**实测**：
```sql
SELECT COUNT(*), SUM(SOCKET_MAX), SUM(SOCKET_INIT), AVG(SOCKET_TIMEOUT)
FROM TB_DS_PROTOCOL WHERE IS_VALID = 1;
```

#### (2) Redis 池

**[事实] 默认值全是空字符串**：
```java
// properties/core/imp/RedisPropertiesLoad.java:17-21
SystemRedisConfig.MaxTotal      = getMapValue(propMap, "MaxTotal", "");
SystemRedisConfig.MaxIdle       = getMapValue(propMap, "MaxIdle", "");
SystemRedisConfig.MaxWaitMillis = getMapValue(propMap, "MaxWaitMillis", "");
```

**[事实]** `initPool` 的守卫是 `if (StringUtils.isEmpty(REDIS_LIST)) return;`（`ShardedReidsPool.java:34-35`）。若填了 `REDIS_LIST` 却漏填 `MaxTotal` ⇒ `Integer.valueOf("")` 抛 `NumberFormatException` ⇒ `DSRunMain.java:41` 抛出 ⇒ `:60` `System.exit(-1)`。**快速失败，属正确设计**（但错误信息不明确）。

**[事实] `MaxTotal` 是全系统 Redis 并发的硬上限** —— 因为 `getConnect()` 的 `getResource()` 只会从这 N 个连接里借。

#### (3) midservice 后端池

**[事实] 21 个独立连接池**（`ServiceConst.java:56-78`），默认值统一 `maxCon=50, initCon=1, timeOut=10000`（`ServiceConfig.java:21-25` 等）。

**理论 21 × 50 = 1050 并发后端连接**，但受 Tomcat 线程数封顶。

**[事实] `Cxgp` 等部分类的 `maxCon/initCon/timeOut` 是 `Integer` 对象且无默认值**（`ServiceConfig.java:63-65,150-152,163-165,179-180`），依赖 `ServiceServlet.java:160` 从外部 properties 注入 ⇒ **未配置则自动拆箱 NPE**。

#### (4) Tomcat 线程池 —— 不在源码树内

**[事实]** 穷尽搜索 `maxThreads|minSpareThreads|maxConnections|acceptCount` 全树，仅命中 `ServiceServlet.java:104`：

```java
String p = outFile.getParentFile().getParentFile().getAbsolutePath() + "/conf/server.xml";
```

该代码**只读取 `port` 属性**（`:140-151` 遍历 `Service/Connector`，`:149` 取 port），**从不读取 `maxThreads`**。且 `server.xml` 在 Tomcat 安装目录，随部署包外置。

**⇒ midservice 的 HTTP 并发线程数必须读部署环境的 `conf/server.xml`。** Tomcat 默认 `maxThreads=200`。

#### (5) midservice per-user 锁（最狠的收窄）

`HandlerController.java:712` 加锁 → `:752` 执行 → `:761` 解锁，**锁跨越整个业务调用**。

**⇒ 同一用户对同一 API 的并发被完全串行化。上限 = 1/RT。**

若 `is.open.syncLock=Y`（且 `syncLockMap` 未把该 api 标为 0），**全平台每个用户每个 API 都只有 1 并发**。

**这意味着：系统的实际并发能力由"单用户单 API 的串行"决定，而不由总容量决定。** 1 万个用户同时下单，1 万个不同用户 → 1 万并发；但 1 个用户开 100 个并发请求 → **1 并发**。

---

## 2.4 全局串行点全表

| # | 位置 | 类型 | 保护范围 | 持锁内容 | 上限推导 |
|---|---|---|---|---|---|
| **1** | `SocketClientConnectManager.java:56` | `static synchronized` | **全系统所有协议** | `cpCache.get` + `connectPool.releaseConnection` | 归还含连接有效性校验/重连，估 **~1ms**。**10s RT 的后端下，N 个并发请求排队 ⇒ 全局 TPS ≈ N/10** |
| **2** | `SocketClientConnectManager.java:63` | `static synchronized` | 全系统 | `connectPool.close()` + `cpCache.remove` | **关池期间所有请求阻塞在此锁上**（罕见路径，但影响面全系统） |
| **3** | `SocketClientConnectManager.java:36-37` | CAS 自旋 + `Thread.sleep(1)` | 单协议 | 建池期串行自旋 | 非稳态瓶颈，但**存在永久死锁窗口**（见 A2） |
| **4** | **`ShardedReidsPool.java:58-63`** | **全局 `ReentrantLock`** | **全系统所有 Redis** | **锁内调用 `getResource()`**（池耗尽时阻塞至 MaxWaitMillis） | **最危险**。正常借连接 ~0.1-1ms ⇒ **1k～10k TPS**；池耗尽时**全系统 Redis 归零**。且被 `T00010040` 的 1ms 忙等锁放大成正反馈崩溃 |
| **5** | **`LockCache.java:41-54`** | **全局 `businessLock`** | **全系统**（仅 map 操作） | **在持有全局锁的情况下阻塞获取业务锁** | **理论上限趋于 0**。见 A1 |
| **6** | `LockCache.java:19-29` | 全局 `atomicLock` | 全系统 | `containsKey` + `put` + CAS | HashMap 操作 ~20-50ns ⇒ **理论 20M-50M ops/s**；N 路竞争退化为上下文切换漏斗 |
| **7** | `T00010033:59` | `LockCache.lockBusiness("Producer_"+typeFlag)` | 按 typeFlag | `new KrackleProducer(topicName)` —— **Kafka broker 建连，100ms～数秒** | 受 #5 传染：**一个慢 producer 创建冻结所有 Producer 锁请求** |
| **8** | **`T00010040:87-98`** | while + setnx + `Thread.sleep(1)` | 单 key | **整个自旋期间持有 Jedis 连接** | **每次迭代 = 1 次 Redis RTT**。1-2ms 间隔 ⇒ **每 key 约 300-500 RTT/秒**。K 线程争同 key ⇒ **有效吞吐 ≈ 500/K ops/s**。同时占用 #4 的全局锁与 Redis 池连接 ⇒ **正反馈崩溃回路** |
| **9** | **`ServiceUtils.java:169`** | `static synchronized` | 全系统 | 纯内存：4 次 `getHeader` + N 次 `getParameter` + `String.replace` | 约 1-10µs ⇒ **理论 10万-100万 ops/s**。**每请求必经**，是 midservice 最可疑的全局串行点 |
| **10** | `DSUtils.java:35` | `static synchronized` | 全系统 | 仅 `return dsClient` | 纳秒级，**可忽略** |
| **11** | `SerialService.java:31` | `synchronized`（实例级） | 单实例 | `currentTimeMillis` + 字符串拼接 | 约 100ns-1µs ⇒ **理论 100万-1000万 ops/s** |
| **12** | **`HandlerController.java:712→761`** | `ReentrantLock` 按 `api+tokenId` | 按用户+API | **跨越整个远程调用** | **最关键的吞吐塌陷点**：单用户单 API 并发**塌缩为 1** ⇒ 上限 = 1/RT。10s 下游 ⇒ **每用户每 API 仅 0.1 TPS** |
| **13** | `SubscribeCache.java:24` | TreeMap 内部锁 | 全系统 | `get`/`put`/`remove` | 约 100ns-1µs ⇒ 理论 100万-1000万 ops/s，但**所有订阅操作串行** + 正确性缺陷 |
| **14** | `ProducerCache.java:17` | 无锁 HashMap | — | `get`+`put` | 非串行，但**并发 put 可致链表成环 → get 死循环 → 进程挂死** |

**注**：`ConnServerThreadUtils.java:11` 与 `SubscribeThreadUtils.java:8` 均为 `Executors.newCachedThreadPool()`（**无界**），但**不处理业务请求**（前者跑协议池初始化，后者跑 Kafka 消费者），故不是请求瓶颈，但**是无界资源风险**。

---

## 2.5 各级资源上限的实测方法

代码无法确定的项，必须实测：

| # | 待测项 | 方法 |
|---|---|---|
| **1** | **NioSocketServer 的 IO 线程数（最关键）** | `jstack <pid> \| grep -A5 "nio.reactor"`；若只有 1 个线程在跑 `HandlerImpl.run` ⇒ **单线程模型成立，TPS = 1/RT** |
| **2** | handler 与 IO 线程是否同一线程 | `jstack` 抓 `HandlerImpl.run` 所在线程名，与 reactor 线程名比对 |
| **3** | Tomcat `maxThreads` | 读部署包 `conf/server.xml`（**不在源码树内**） |
| **4** | `TB_DS_PROTOCOL` 的 `SOCKET_MAX` 实际值 | `SELECT COUNT(*), SUM(SOCKET_MAX) FROM TB_DS_PROTOCOL WHERE IS_VALID=1;` |
| **5** | `TB_DS_PROTOCOL` 协议总数 | 同上 `COUNT(*)`（无代码上限） |
| **6** | **midservice DS 客户端池实际大小** | `grep -rn "setMaxCon" /path/to/1018/core/`；`jmap <pid> \| grep ConnectPool`。**重点核实是否真是 5** |
| **7** | `redis.properties` 实际内容 | `MaxTotal`/`MaxIdle`/`MaxWaitMillis`（默认全空字符串） |
| **8** | `is.open.syncLock` 实际取值 + `syncLockMap` 内容 | 外部配置 + `ServiceServlet.java:322` 装载 |
| **9** | 后端 RT 的 P50/P99 | APM 打点 `DSStandardProtocol.execute` 的耗时 |
| **10** | `T9ConnectPool`/`WdhConnectPool`/`CnjyConnectPool` 的借还语义 | 外部依赖，**若模仿了 `ShardedReidsPool` 的写法则 midservice 存在同类全局瓶颈** |

---

## 2.6 端到端并发能力总结

### 各层并发上限汇总

| 层 | 上限 | 决定因素 | 性质 |
|---|---|---|---|
| dataShare 前端连接 | fd 限制（1000～65535） | OS `nofile` | 代码无限制 |
| **midservice HTTP 线程** | **Tomcat maxThreads（默认 200）** | 外置 `server.xml` | **硬顶** |
| **midservice → dataShare 连接** | **DSBean.maxCon（发现配置为 5！）** | 外部 core 模块 | **硬顶，可能极小** |
| midservice → 业务后端连接 | 21 池 × maxCon=50 = 1050 | `ServiceConfig` | 受 Tomcat 封顶 |
| **midservice 单用户单 API** | **1** | per-user 锁（`:712→761`） | **硬顶，最狠** |
| dataShare → 后端连接 | `Σ(SOCKET_MAX)` | DB `TB_DS_PROTOCOL` | 硬顶 |
| **dataShare 全局归还** | **1/T_归还锁（~1ms）** | `static synchronized` | **全局串行** |
| **dataShare 全局 Redis** | **1/T_借连接（~0.1-1ms）** | `ShardedReidsPool.lock` | **全局串行 + 崩溃回路** |
| **dataShare 业务处理（若单 IO 线程）** | **1/RT_后端** | B1 推断 | **最关键未知** |

### 结论

**当前架构下的实际并发能力：**

```
有效并发 ≈ min(
    Tomcat_maxThreads,          # 默认 200
    DSBean.maxCon,              # ★ 可能只有 5
    单用户单API = 1,            # per-user 锁
    Σ(SOCKET_MAX)               # 后端池
)
```

**在 B1 单 IO 线程模型成立的前提下，整个平台的 TPS 上限是 `1/RT_后端`**，与上述任何一个数字无关 —— 也就是说：

> **即使给它 1000 个 Tomcat 线程、10000 条连接，只要有一个请求卡在 10 秒的后端调用上，整个 dataShare 就停摆 10 秒。**

**这是"全同步 + 无业务线程池"架构的根本问题，而不是任何单个类的实现问题。**

### 三档典型场景（假设 B1 成立）

| 后端 RT | 全局 TPS | 单用户单 API TPS | 备注 |
|---|---|---|---|
| 10 ms | ~100 | 100 | 健康 |
| 100 ms | ~10 | 10 | 可用 |
| 1 s | ~1 | 1 | 不可用 |
| 10 s（超时） | **~0，且被 A3 放大为 1000s** | — | **雪崩** |

**若 B1 不成立**（NIO 框架自带 worker 池，线程数 N），则上限变为 `N/RT`，N 的具体值必须 jstack 实测。

---

# 第三部分：修复优先级

## 立即（不改架构，直接消除可用性风险）

| # | 动作 | 位置 | 消除的风险 |
|---|---|---|---|
| 1 | **核实并放大 midservice DS 客户端池**（若确为 `maxCon=5`） | `ImageCompressUtils.java:90` | A3 雪崩 |
| 2 | **修 `LockCache` 锁序倒置**：全局锁只保护 map，业务锁在锁外获取 | `LockCache.java:41-54` | A1 全局死锁 |
| 3 | **修 `SocketClientConnectManager` 池创建竞态**：`computeIfAbsent` + 去 `Thread.sleep` | `SocketClientConnectManager.java:28-54` | A2 永久死锁 + CPU 100% |
| 4 | **递归重试改循环 + 指数退避 + 熔断**；池耗尽不关整池 | `ConnSocketCommandParse.java:130-173`；`BIOSocketConnectManager.java:54-64` | A3 雪崩放大 100 倍 |
| 5 | **`ShardedReidsPool.getResource()` 移出全局锁** | `ShardedReidsPool.java:58-75` | B4 全局阻塞 |
| 6 | **`T00010040` 自旋期间归还连接**；锁改 `SET NX EX` + token + Lua 解锁 | `T00010040_LockBusinessService.java:87-98` | B4 正反馈回路 + B5 四项缺陷 |
| 7 | **6 个无锁 Map 改 ConcurrentHashMap** | `HessianServiceCache` / `HttpServiceCache` / `AESKeyCache` / `ProducerCache` / `SubscribeCache` / `HessianFactoryUtils` | A4 进程挂死 |
| 8 | **`LockUtils.lockMap` 改 `computeIfAbsent` + Caffeine 过期清理** | `HandlerController.java:1735-1740` | A6 互斥失效 + 泄漏 |
| 9 | **去掉 midservice 三处 `static synchronized`** | `DSUtils.java:35`、`SerialService.java:31`、`ServiceUtils.java:169` | B3 monitor 争用 |
| 10 | **per-user 锁范围收窄**到真正临界区 | `HandlerController.java:712→761` | B2 单用户塌缩为 1 |
| 11 | **`ProtocolLoadImpl` SQL 改命名参数**；`T00010030` 停止回吐 Redis 密码 | `ProtocolLoadImpl.java:115,125,136`；`T00010030:27` | E1 注入 + E2 泄露 |
| 12 | **删/降级 `HandlerController.java:245,271` 两条 INFO** | 同上 | E3 敏感信息落盘 |

## 短期

| # | 动作 | 位置 |
|---|---|---|
| 13 | **接线 `PubConfigCache`**（5s TTL 已就绪） | `param/cache/PubConfigCache.java` |
| 14 | `getTopicName` 加进程内本地缓存 | `MQTopicServiceImpl.java:27-48` |
| 15 | `HttpClientUtils` 改单例 + 显式 close | `HttpClientUtils.java` ×5 |
| 16 | `handlerRouters` / `apiConfig` / `KeyMapper` 改 HashMap 索引 | `HandlerController.java:622,749,798`；`KeyMapper.java:113` |
| 17 | `SensitivewordFilter` 改真单例 + 定时刷新 + 命中即 break | `SensitivewordFilter.java:26-29,54-65` |
| 18 | `DSUtils.revert` 改 ThreadLocal 复用 ObjectStream | `DSUtils.java:143` |
| 19 | 消费线程池改有界；1MB buffer 提到循环外 | `SubscribeThreadUtils.java:8`；`KrackleConsumer.java:133,175` |
| 20 | `doAuthRtn` / `func_id` 的 `indexOf` 改 `Set.contains` | `HandlerController.java:1790`；`ToBackController.java:346` |
| 21 | `Validate` 27 处 `.matches()` 改 `static final Pattern` | `utils/Validate.java` |
| 22 | `DSUtils.callSocket` 去掉二次序列化 | `DSUtils.java:247,253` |
| 23 | `1018_MONITOR_DATA` 加 `ltrim`；审计 MQ 发送移到独立线程池 | `HandlerController.java:886,944` |
| 24 | `OpenHandler` 的 `Thread.sleep` 改异步轮询 | `OpenHandler.java:404` |
| 25 | `T00010033` 等待 Kafka ack 后再返回；`acks` 改 -1 | `T00010033:70-71`；`KrackleProducer.java:79-85` |
| 26 | `DS-QUEUE-ALL` 增加清理路径 | `T00010037:50-56` |

## 中期（架构 —— 唯一能把 TPS 从 `1/RT` 提到 `N/RT` 的改动）

| # | 动作 |
|---|---|
| 27 | **引入真正的业务 worker 线程池**：`IHandlerAdapter` 移交，把 IO 循环与业务阻塞解耦。这是**唯一结构性**的性能改造 |
| 28 | **引入 dataShare 分布式锁替换本地 ReentrantLock**，解决多实例一致性（`ServiceConfig.SYS.clusterId` 证明支持多节点） |
| 29 | 补齐服务治理：健康检查、熔断器（接入已有的 `isSuccessRun/errMsg` 标记）、限流、注册发现 |
| 30 | MQ 补 ack/重试/DLQ；offset 改为**推送确认后**记录；明确至少一次语义 + 业务幂等契约 |
| 31 | 抽取 `AbstractApiGateway` 模板 + `GatewayFilter` 责任链，消除 `HandlerController`(2581行)/`ToBackController`(1526行) 双份实现 |
| 32 | 统一 JSON 库，废弃 `net.sf.json`（反射 Bean 装配，最慢） |
| 33 | 消除 `plzg`/`PLZBzg`/`xht`/`xhtV5` 四套复制粘贴 |
| 34 | 明确 `@HandlerRule` 与 `api.json` 的单一事实源 |
| 35 | 实现或删除 `T0001fa01/fa02`（当前是同名不同义的外壳）；实现 `connType 4/5` 或删除 |
| 36 | 协议配置热更新接配置中心，消除 `BeanFactory.clear()` 的热部署状态不一致 |

---

## 附：缺陷统计

| 类别 | 数量 | 其中会导致数据错误/挂死 | 其中会导致雪崩 |
|---|---|---|---|
| A 并发正确性 | 7 | **7** | 2 |
| B 可用性 | 8 | 3 | **4** |
| C 性能 | 15 | — | — |
| D 功能 | 16 | — | — |
| E 安全 | 7 | — | — |
| **合计** | **53** | **10** | **6** |

**最危险的三个**（叠加后系统会完全不可用且难以自愈）：

1. **A2** 池创建竞态 ⇒ 永久死锁 + CPU 100%，需重启进程
2. **A1** 锁序倒置 ⇒ 全局死锁，MQ 发布与短信互相锁死
3. **B4 + B5** Redis 忙等锁占用连接 + 全局锁内借连接 ⇒ **正反馈崩溃回路**，Redis 池一耗尽就全系统归零

---

*本文档基于反编译源码（JD-Core 0.6.0）静态分析。所有 file:line 引用均可回溯核对。标注"推断"的部分必须按 §2.5 的方法实测确认。*
