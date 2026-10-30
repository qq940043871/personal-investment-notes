# dataShare 数据交互网关 SDK — 功能与设计解析

---

## 目录

- [一、整体定位](#一整体定位)
- [二、整体架构](#二整体架构)
- [三、六大网关能力逐个拆解](#三六大网关能力逐个拆解)
  - [网关 1：接入层网关](#网关-1接入层网关--长连接--认证鉴权--路由寻址)
  - [网关 2：协议网关](#网关-2协议网关--自研二进制协议栈)
  - [网关 3：消息网关](#网关-3消息网关--发布订阅)
  - [网关 4：缓存网关](#网关-4缓存网关--双通道设计)
  - [网关 5：分布式协调网关](#网关-5分布式协调网关--分布式锁)
  - [网关 6：集成网关](#网关-6集成网关--通知下发--配置中心--可观测)
- [四、命令号全表](#四命令号全表)
- [ 五、SDK 提供的调用形态](#五sdk-提供的调用形态)
- [六、关键流程时序](#六关键流程时序)
- [七、设计亮点](#七设计亮点)
- [八、已知不足与风险点](#八已知不足与风险点)
- [九、面试话术](#九面试话术)
- [附录 A：核心类速查表](#附录-a核心类速查表)

---

## 一、整体定位

这是一套**企业级私有数据交换网关（Data Exchange Gateway）的 Java 客户端 SDK**。它把六类网关能力打包成一套 SDK，让业务系统只需调用几个方法即可接入平台：

| # | 网关能力 | 核心类 |
|---|---|---|
| 1 | 接入层：长连接、认证鉴权、心跳保活、请求路由 | `BIOSocketConnectManager` / `DSLoginImpl` / `DSHeartBeatExplore` / `HeaderKeyPool` |
| 2 | 协议层：二进制协议编解码、分片、压缩、序列化 | `MainHeader` / `IProtocol` / `ProtocolAbst` / `BIOProtocolReadUtils` |
| 3 | 消息层：发布订阅、断线自愈 | `publishInfo` / `subscribeInfo*` / `AutoSubscribeThread` |
| 4 | 缓存层：网关代理 + 客户端直连双通道 | `putRedisInfo` / `ShardedReidsPool` / `RedisTools` |
| 5 | 协调层：分布式锁（含批量） | `lockBusiness` / `lockBatchBusiness` |
| 6 | 集成层：短信/邮件、配置下发、可观测埋点 | `sendSMS` / `sendEmail` / `publishSummary` |

**两个 jar 的分工**

| jar | 职责 | 是否可独立复用 |
|---|---|---|
| `dataShareCommon-1.1.3` | 协议内核：`MainHeader` / `IProtocol` / `ProtocolAbst` / 工具类 | 是，纯协议层无业务依赖 |
| `dataShareClientAPI-1.3.4` | 客户端能力层 | 依赖外部 `com.ylsoft.niosocket` 包提供 `SocketClient` / `HostConfig` |

---

## 二、整体架构

```
┌──────────────────────────────────────────────────────┐
│  接入层（Access Gateway）                              │
│  长连接 · 连接池 · 登录鉴权 · 心跳保活 · ansyKey 池       │
└──────────────────┬───────────────────────────────────┘
                   │ 自研 TCP 二进制协议（11 字节定长头）
┌──────────────────▼───────────────────────────────────┐
│  协议层（Protocol Gateway）                            │
│  命令号路由 · 分片 · gzip · Hessian/JSON · 状态位         │
└──────────────────┬───────────────────────────────────┘
┌──────────────────▼───────────────────────────────────┐
│  能力层（Capability Gateway）                          │
│  消息 · 缓存 · 锁 · 通知 · 配置下发 · 监控                │
└──────────────────────────────────────────────────────┘
```

**主入口**：`com.ylsoft.ds.api.client.DSClientAPI`（`dataShareClientAPI-1.3.4.src/com/ylsoft/ds/api/client/DSClientAPI.java`）

---

## 三、六大网关能力逐个拆解

### 网关 1：接入层网关 — 长连接 + 认证鉴权 + 路由寻址

**核心职责**：把业务系统接入网关，维护可复用的长连接，避免"每次调用都建连接"的开销。

#### 连接池

| 项 | 实现 | 位置 |
|---|---|---|
| 池缓存 | `ConcurrentHashMap<HostConfig, ConnectPool>` + `ConcurrentHashMap<SocketClient, ConnectPool>` 双向映射 | `core/BIOSocketConnectManager.java:13-55` |
| 建池 | `getSocketClient()` 双重检查锁 | 同上 |
| 池异常自愈 | 捕获 `Timeout waiting for idle object` → `cp.close()` 后**递归重建** | `BIOSocketConnectManager.java:41-52` |
| 归还 | `releaseConnection()` 反查所属池 | `BIOSocketConnectManager.java` |

#### 池参数（`DSClientAPI.java:96-114`）

```java
poolConfig = new GenericObjectPoolConfig();
poolConfig.setMaxTotal(dsBean.getMaxCon());                    // 默认 100
poolConfig.setMinIdle(dsBean.getInitCon());                    // 默认 1
poolConfig.setMaxIdle(initCon + 10 > maxCon ? maxCon : initCon + 10);
poolConfig.setMaxWaitMillis(5000L);                            // 取连接最多等 5s
```

#### 默认连接参数（`bean/DSBean.java:21-28`）

| 参数 | 默认值 |
|---|---|
| host | `www.ds.com` |
| port | `8070` |
| timeOut | `5000` ms |
| initCon / maxCon | `1` / `100` |
| tcpNoDelay | `true` |
| receiveBufferSize / sendBufferSize | `0`（用 JVM 默认） |
| encoding | `UTF-8`（`DSClientAPI.java:137` 硬编码） |

#### 登录鉴权

`core/DSLoginImpl.java`

1. `getLoging()`：发送 `00010001` 登录包，body 为 `{USERNAME, USERPSWD, USERFLAG}` JSON
2. `isLoginOK()`：校验四段命令号 `(0,1,0,1)` + `mainHeader.isStateOk()`（`0x40` 位）
3. 解析响应 JSON，`FLAG=="1"` 视为认证通过
4. 登录态挂载在 `HostConfig` 上（`setLoginService`），后续取连接自动携带

#### 心跳保活

`core/DSHeartBeatExplore.java:17-55`

```
取一个 ansyKey
  → 发 00010000 空包（DSHeartProtocol，body 为空）
  → 循环读包并丢弃，直到收到的 mainHeader.ansyKey 与自己相等 → 探活成功
  → 耗时 > 1000ms 打 warn 日志
  → finally: 归还 ansyKey + sc.stop() 强制关闭该连接
```

> ⚠️ 注意：心跳探活完成后**强制关闭连接**，说明心跳连接是"用完即弃"的一次性探活，不是保活长连接。

#### ansyKey 路由池

`core/HeaderKeyPool.java`

```java
private static final Queue<Integer> POOL = new LinkedBlockingQueue<>(65534);

static {
    int idx = random.nextInt() % 30;                 // 随机选一个基数段
    for (int i = 0; i < 30; i++) {
        int base = flags[i];                          // 100000 ~ 3000000
        if (i == idx) {
            for (int k = base + 1; k <= 65534; k++) POOL.offer(base + k);
        }
    }
}

getKey()      // 空则返回 -1
returnKey(k)  // 归还（LinkedBlockingQueue.offer 幂等）
```

**设计意图**：
- 65534 个 key 循环复用，24bit 头字段足够表达
- **按 JVM 实例随机选基数段**（30 档，100000~3000000），多实例部署时 key 空间不重叠，服务端无需额外实例标识即可正确路由

---

### 网关 2：协议网关 — 自研二进制协议栈

#### 报文格式：11 字节定长头 + 变长 body

```
 0        1        2   3    4    5    6       7       8     9    10
┌────────┬────────┬───┬────┬────┬────┬───────┬───────┬───────────────┐
│length(2)│ cmd(4)  │st │enc │  ansyKey(3)     │  body...         │
│ 大端    │ 四段命令 │(1)│(1)│     24bit        │   变长           │
└────────┴────────┴───┴────┴────┴────┴───────┴───────┴───────────────┘
                    ↑ state 是位标志
```

来源：`dataShareCommon-1.1.3.src/com/ylsoft/protocol/ds/internal/head/MainHeader.java`

| 字段 | 长度 | 说明 |
|---|---|---|
| `length` | 2 byte，大端 | body 字节数 |
| `mainHigh`/`mainLow`/`subHigh`/`subLow` | 4 byte | 四段命令号，拼接成 8 位十六进制字符串 |
| `state` | 1 byte | 位标志（见下） |
| `encryption` | 1 byte | 加密标志，配套 `DesUtils`（DES/ECB/NoPadding + Base64），客户端实际未启用 |
| `ansyKey` | 3 byte | 请求-响应配对路由键 |

#### state 位标志（`MainHeader.java:129-211`）

| 位 | 方法 | 含义 |
|---|---|---|
| `0x40` | `isStateOk()` | 响应正常（**默认值就是 64**） |
| `0x20` | `isNext()` | 分片续包（还有后续片） |
| `0x10` | `isCompression()` | body 已 gzip 压缩 |
| `0x08` | `isAnsyFlag()` | 服务端主动推送 |
| `0x02` | `isBase64()` | body 是 base64 |
| `0x01` | `isHessian()` | body 是 Hessian2 序列化 |

`MainHeaderStatus` 中对应的常量：`DEFAULT=64`、`NEXT_YES=32`、`COMP_YES=16`、`ANSY_YES=8`、`BASE64_YES=2`、`HESSIAN_YES=1`、`ERROR=0`。

#### 命令号体系

命令号 = 4 字节 = `DS` + 8 位十六进制。通过抽象方法声明：

```java
public byte getMainHighProtocol()  { return 0; }   // 默认
public byte getMainLowProtocol()   { /* 子类实现 */ }
public byte getSubHighProtocol()   { return 0; }   // 默认
public byte getSubLowProtocol()    { /* 子类实现 */ }
```

动态构造任意命令（业务扩展入口）：

```java
// protocol/CommonProtocol.java:13-53
new CommonProtocol(mainHigh, mainLow, subHigh, subLow)
new CommonHessianProtocol(...)   // 构造时自动 setHessian(true)
```

#### 分片机制

`dataShareCommon-1.1.3.src/com/ylsoft/protocol/ds/internal/abst/ProtocolAbst.java:65-115`

```
body ≤ 4096  → 单包直发（一次 setLength + write + flush）
body > 4096  → 按 4096 切片
               中间片 setNext(true)
               末片  setNext(false)
               每片各自生成一个完整的 11 字节头 + 分片 body
               每次 sendToServer: write + flush

发送后：ClientRequestCount.incrementAndGet(commandStr)   // 流量埋点
```

读侧拼接：`utils/BIOProtocolReadUtils.java:19-97` 的 `readProtocolBodyByteByNext()` 按 `isNext()` 循环读取拼接，最后检测 `isCompression()` 则 `GZipUtils.ungzip()`。

#### 推流与响应分流（关键设计）

`utils/BIOProtocolReadUtils.java` 的 `readMainHeader()`：

```
读取 mainHeader
  ├─ 若 mainHeader.isAnsyFlag()（0x08 服务端推送）
  │    → 投入 AnsyResponseQueue，继续读下一个包（不返回给业务）
  └─ 否则 → 返回给业务线程
```

> **保证同步调用的业务线程永远只拿到自己的响应包，不会与异步推送串包。** 这是长连接网关的必备能力。

#### 序列化双栈

| 方式 | API | 说明 |
|---|---|---|
| JSON | `execute(IProtocol)` → `JSONObject` | `net.sf.json`，可读性优先 |
| String | `executeByStr(IProtocol)` → `String` | 原始报文 |
| Hessian2 | `executeHessian(IProtocol)` → `Object` | 任意 Java 对象跨进程直传 |

#### 同步容错

`DSClientAPI.java:162-230` `executeCall`：

```java
try {
    ...
} catch (FirstMainHeaderNoDefined ex) {       // 响应头异常 / 脏数据
    if (executeNum > 2) throw t;
    return executeCall(protocol, isHessian, executeNum + 1, ex);   // 递归重试 1 次
} catch (Exception ex) {
    socketClient.close();                       // 其他异常直接关闭连接
    throw ex;
} finally {
    HeaderKeyPool.returnKey(ansyKey);            // 归还 ansyKey
    socketClient.stop();
    BIOSocketConnectManager.releaseConnection(socketClient);   // 归还连接
}
```

响应包循环读取时会丢弃 ansyKey 不匹配的包（伪广播包/推送包）：

```java
do {
    mainHeader = BIOProtocolReadUtils.readMainHeader(ins);
    reBytes = BIOProtocolReadUtils.readProtocolBodyByteByNext(ins, mainHeader);
} while (ansyKey != mainHeader.getAnsyKey());
```

---

### 网关 3：消息网关 — 发布/订阅

#### 消息模型

发布（`protocol/system/DS00010033Protocol.java`）：

```json
{ "TYPEFLAG": "主题", "VALUE": "消息体", "APPENDMSG": {扩展JSON} }
```

订阅（`protocol/system/DS00010034Protocol.java`）：

```json
{
  "TYPEFLAG":   "主题",
  "STARTINDEX": 0,              // 消费位点，支持断点续传/历史回溯
  "CLIENTID":   "消费者实例ID",
  "GROUPID":    "消费组ID",
  "ISLIKE":     "Y",            // 是否启用服务端条件过滤
  "WHERELIST":  [ {"NAME":"字段","VALUE":"值","WHERETYPE":"EQUALS|CONTAIN"} ]
}
```

条件类型（`bean/SubscribeWhere.java:50-55`）：`equals` → `"EQUALS"`，`constain` → `"CONSTAIN"`。

> ⚠️ `"HEART"` 是系统心跳保留主题，业务方禁止使用（`DSClientAPI.java:736` 直接抛异常）。

#### 四种订阅模式差异矩阵

| 模式 | 回调接口 | 扩展字段 | 过滤心跳 | 失败回调 | 断线重连 |
|---|---|:---:|:---:|:---:|:---:|
| `subscribeInfo` | `ISubscribeCall.execute(typeFlag, seqNo, data)` | — | ✗ | ✗ | ✗ |
| `subscribeInfoByAuto` | `ISubscribeCall` + `onFailure(msg)` | — | ✓ | ✓ | ✓ |
| `subscribeInfoByLike` | `ISubscribeLikeCall.execute(typeFlag, seqNo, data, appendMsg)` | `APPENDMSG` | ✗ | ✗ | ✗ |
| `subscribeInfoByLikeAuto` | `ISubscribeLikeCall` + `onFailure(msg)` | `APPENDMSG` | ✓ | ✓ | ✓ |

**差异本质**

- **ByLike** = 服务端做条件过滤（`WHERELIST`），只推客户端关心的数据，**省客户端解析与 CPU**；回调多拿一个 `APPENDMSG`
- **Auto** = 订阅关系持久化在 `SubscribedCache`，**断线自动恢复**

#### 回调接口继承体系（`face/` 包）

```
ISubscribeAbstCall                       (空标记接口，父接口)
├── ISubscribeCall          execute(String, long, String)
│   └── ISubscribeAutoCall  + onFailure(String msg)
└── ISubscribeLikeCall      execute(String, long, String, JSONObject)
    └── ISubscribeLikeAutoCall + onFailure(String msg)

IDSClientAsynCall (独立体系，用于 execute 异步请求)
    onSuccess(Object) / onFailure(JSONObject)
```

#### 四种订阅处理线程

| 线程 | 处理 SubscribeType | 关键行为 |
|---|---|---|
| `SubscribeInfoHandleThread` | `BASE` | 读循环；退出条件：读异常 **或** `SubscribedCache.get(key).isSubscribe()==false`；**finally 中 `SubscribedCache.remove()`**（一次性订阅，断线即注销） |
| `SubscribeInfoHandleAutoThread` | `BASE_AUTO` | 读循环；**过滤 `typeFlag=="HEART"` 不回调**；异常调 `call.onFailure(msg)`；**finally 只 close+release，不 remove 缓存**（保留供重连） |
| `SubscribeInfoHandleByLikeThread` | `LIKE` | 额外解析 `APPENDMSG` 并作为第 4 参回调；同 BASE，finally remove |
| `SubscribeInfoHandleByLikeAutoThread` | `LIKE_AUTO` | ByLike + Auto 组合：过滤 HEART + onFailure + 不 remove |

消息体解析字段：`TYPEFLAG` / `SEQNO`(序号) / `DATA`(消息体) / `APPENDMSG`(扩展)。

#### 缓存与重连自愈链路

```
┌──────────────────────────────────────────────────────────────┐
│ SubscribedCache  (ConcurrentHashMap<String, SubscriptionInfo>) │
│ key = typeFlag + "-" + groupId + "-" + clientId               │
│ (queue/bean/SubscriptionInfo.java:65-78)                       │
└───────────────────────────┬──────────────────────────────────┘
                            │ 扫描
                            ▼
   AutoScanningSubscribeThread
     if (isAutoSubscribe && now - lastUpdateTime > 10000ms)   // 10s 沉默 = 假死
        → setSubscribe(false)
        → offer 到 WaitSubscriptionTopicQueue (LinkedBlockingQueue)
                            │
                            ▼ 每 100ms poll 队首（3 个消费者线程）
   AutoSubscribeThread
     if 订阅已存在 → 跳过（幂等）
     else 按 info.isLike() 分派：
        isLike=true  → subscribeInfoByLikeAuto()
        isLike=false → subscribeInfoByAuto()
        （使用原始 typeFlag / startIndex / clientId / groupId / whereList / 回调引用）
```

**并发模型**（`DSClientAPI.java:118-128`，`init()` 时固定启动 9 个后台线程）：

| 线程 | 数量 | 职责 |
|---|---|---|
| `AutoScanningSubscribeThread` | 1 | 假死扫描 |
| `AutoSubscribeThread` | 3 | 订阅重连 |
| `HandleAnsyRequestThread` | 5 | 异步推送分发 |

**启动幂等**：`init()` 用 `ReentrantLock` + 双重检查（`hostConfig == null`），重复调 `init` 不会重复起线程。

**其他保护**：
- `checkSubscription()`（`DSClientAPI.java:500-510`）：若 `SubscribedCache` 中已存在且 `isSubscribe()==true`，打 warn 日志并直接返回 true，**订阅去重**
- 订阅失败时 `finally` 中把 `setSubscribe(false)` 并 `releaseConnection`，保证连接不泄漏

#### 异步推送分发

```
服务端推送包 → readMainHeader 识别 0x08 → AnsyResponseQueue
   → 5 个 HandleAnsyRequestThread poll
      → 按 ansyKey 反查 AnsyRequestCache
         ├─ request.isAnsy() && latch != null  → 存 DSClientAnsyCallVal + latch.countDown()
         └─ 否则 → isHessian() ? Hessian 字节流 : JSON 解析 → onSuccess(val)
   → 队列空时 Thread.sleep(10L)
```

---

### 网关 4：缓存网关 — 双通道设计

#### 通道 A：网关代理模式（走 DS 转发）

| 能力 | 命令号 | API |
|---|---|---|
| 写入 | `00010031` | `putRedisInfo(module, key, value[, expire])` |
| 批量写入 | `00010031` + `ISBATCH=Y` | `putRedisInfoByBatch(module, key, JSONObject, expire)` |
| 读取 | `00010032` | `getRedisInfo(module, key)` → `VALUE` |
| 存在判断 | `00010035` | 内部使用 |
| 更新 TTL | `00010036` | `upateRedisInfoExpire(module, key, expire)` |
| 删除 | — | `removeRedisInfo(module, key)`（命令号 `00010035`） |

统一响应约定：`FLAG=="1"` 表示成功，失败时取 `MSG` 抛 `RuntimeException`。

- **优点**：客户端零依赖，不用关心地址/密码/拓扑；适合强隔离与审计场景
- **缺点**：多一跳网络开销

#### 通道 B：客户端直连模式

初始化流程：

```
execute(DS00010030Protocol)         // 命令号 00010030，向网关索取 Redis 连接串
   → 返回 JSON { "REDIS": "host1:port1,host2:port2", "USERNAME": "密码", ... }
   → ShardedReidsPool.initPool(json)
       ├─ 解析 REDIS 逗号分隔的 host:port → JedisShardInfo
       ├─ 密码取 USERNAME 字段
       ├─ MAXTOTAL=200 / MAXIDLE=5 / MAXWAITMILLIS=1000
       └─ ReentrantLock 保护初始化
   → 之后 RedisTools 走 Jedis 直连
```

> **核心思想：配置中心化 + 连接本地化。** 地址/密码由网关统一下发（配置变更无需改客户端），但数据流量走客户端直连（省一跳）。

#### RedisTools 能力（`redis/RedisTools.java`）

| 方法 | 说明 |
|---|---|
| `putStringToRedis` / `getStringFromRedis` | String，**读取时可传 expire 续期** |
| `putObjectToRedis` / `getObjectFromRedis` | Java 对象，**Hessian2 序列化** |
| `putListToRedis(key, List)` | 批量 LPUSH，用 `ShardedJedisPipeline` 管道 |
| `putListToRedis(key, String)` | 单条 LPUSH |
| `getFromRedisList` / `getLenFromRedisList` | LPOP / LLEN |
| `removeKey` / `removeKeys(String[])` / `removeKeys(Collection)` | DEL |
| `hset` / `hgetAll` / `removeHset` | Hash 操作，**hset 硬编码 TTL = 10800 秒** |

---

### 网关 5：分布式协调网关 — 分布式锁

| 能力 | 命令号 | API |
|---|---|---|
| 单锁加锁 | `00010040` | `lockBusiness(module, key[, lockTime][, waitTime])` |
| 单锁解锁 | `00010041` | `unlockBusiness(module, key)` |
| 批量加锁 | `00010042` | `lockBatchBusiness(module, serinalNo, keys[, lockTime=600][, waitTime=3000])` |
| 批量解锁 | `00010043` | `unlockBatchBusiness(module, serinalNo)` |

**设计要点**

- `MODULE + KEY` 二级命名空间，避免不同业务锁冲突
- `lockTime`（锁持有时间）：**必须有**，防止持锁方宕机造成死锁，靠网关侧 TTL 自动释放
- `waitTime`（获取等待时间）：获取不到锁时阻塞等待，超时返回 `false`，**调用方必须处理 false 分支**
- 批量锁用 `serinalNo`（流水号）标识同批操作，配套 `unlockBatchBusiness` 整体释放 —— 典型场景"批量下单锁一批库存"

---

### 网关 6：集成网关 — 通知下发 + 配置中心 + 可观测

#### 通知下发（不走 `protocol/system`，直接动态构造命令号）

| 能力 | 命令号 | body 字段 |
|---|---|---|
| 短信 | `CommonProtocol(0,1,0,80)` | `PHONE` / `CONTENT` / `MODULE` / `MARKETID`(营销标识) |
| 邮件 | `CommonProtocol(0,1,0,81)` | `EMAIL` / `CONTENT` / `TITLE` / `MODULE` |

> **设计亮点**：这两个能力没有对应的 Protocol 子类，而是用 `CommonProtocol` 动态构造，说明**网关支持业务方自定义命令号**，新增能力无需改 SDK。

#### 配置中心

| API | 命令号 | 用途 |
|---|---|---|
| `getMQ()` | `00010010` | 拉取 MQ 全局配置 |
| `getMqInfoByType(typeFlag)` | `00010011` | 按主题查 MQ 配置 |
| `GetRedis()` / `initRedisConnnection()` | `00010030` | 拉取 Redis 连接串 |

#### 可观测

| 能力 | 实现 |
|---|---|
| `getClientSendCommandCount()` | 从 `ClientRequestCount`（`ConcurrentHashMap<String, AtomicLong>`）读出**按命令号维度的请求量统计** |
| `publishSummary(level, module, msg)` | 客户端上报摘要日志到 `INTERNAL_SUMMARY` 主题，级别 `ERROR` / `WARN` / `BUSINESS` |
| 慢调用告警 | 单次请求耗时 > 1000ms 打 warn（`DSClientAPI.java:264-265`） |
| 全链路日志 | 日志中 `[ansyKey]` 贯穿请求与响应；`_lastReceiveCache` 记录每连接最后收包，异常时打印帮助定位 |
| 连接耗时埋点 | 打印获取 SocketClient 耗时（`DSClientAPI.java:244`） |

---

## 四、命令号全表

| 命令号 | 类名 | 业务 |
|---|---|---|
| `00010000` | `DSHeartProtocol` | 心跳探测 |
| `00010001` | `DSLoginProtocol` | 登录认证 |
| `00010010` | `DS00010010Protocol` | MQ 全局配置 |
| `00010011` | `DS00010011Protocol` | MQ 按主题配置 |
| `00010030` | `DS00010030Protocol` | Redis 连接配置 |
| `00010031` | `DS00010031Protocol` | 缓存写入 |
| `00010032` | `DS00010032Protocol` | 缓存读取 |
| `00010033` | `DS00010033Protocol` | 消息发布 |
| `00010034` | `DS00010034Protocol` | 消息订阅 |
| `00010035` | `DS00010035Protocol` | 缓存删除 / 存在判断 |
| `00010036` | `DS00010036Protocol` | 缓存 TTL 更新 |
| `00010040` | `DS00010040Protocol` | 分布式锁加锁 |
| `00010041` | `DS00010041Protocol` | 分布式锁解锁 |
| `00010042` | `DS00010042Protocol` | 批量加锁 |
| `00010043` | `DS00010043Protocol` | 批量解锁 |
| `000100ff` | `DS000100ffProtocol` | 空包保留（subLow=-1） |
| `0001fa10` | `DS0001fa10Protocol` | 消息退订 |
| `80` | `CommonProtocol(0,1,0,80)` | 短信 |
| `81` | `CommonProtocol(0,1,0,81)` | 邮件 |

---

## 五、SDK 提供的调用形态

| 形态 | API | 适用场景 |
|---|---|---|
| 同步 JSON | `execute(IProtocol)` → `JSONObject` | 常规查询、简单写入 |
| 同步字符串 | `executeByStr(IProtocol)` → `String` | 需要原始报文 |
| 同步 Hessian | `executeHessian(IProtocol)` → `Object` | **Java 对象跨系统直传，性能最好** |
| 异步回调 | `execute(IProtocol, IDSClientAsynCall)` | 长耗时接口，不阻塞业务线程 |
| 异步 + Latch | `getExecuteAnsyChannel()` → `ExecuteAnsy.execute()` | 60s 超时控制 |

`ExecuteAnsy` 的异步语义（`core/ExecuteAnsy.java:32-102`）：

```java
CountDownLatch latch = new CountDownLatch(1);
// 发送时设置 ansyFlag=true，缓存 DSClientRequest(latch)
if (latch.await(60000L, TimeUnit.MILLISECONDS)) {
    byte[] bodyBytes = DSClientAnsyCallVal.get(ansyKey);
    return isHessian() ? HessianSeriUtils.byteToObject(bodyBytes)
                       : JSONObject.fromObject(new String(bodyBytes, UTF_8));
} else {
    // 超时：主动调 onFailure
    json.put("FLAG", "0");
    json.put("MSG", "More than 1 minute without feedback!");
    tr.getAnsyCall().onFailure(json);
}
```

**初始化兜底**：任一 API 若发现未 `init()`，会自动用 `DSBean` 默认配置初始化并打 warn 日志（`DSClientAPI.java:230-232`）。

---

## 六、关键流程时序

### 6.1 同步请求

```
业务线程
  → HeaderKeyPool.getKey()                        取 ansyKey
  → BIOSocketConnectManager.getSocketClient()     从池取连接（登录态已就绪）
  → mainHeader.setAnsyKey(ansyKey)
  → protocol.sendTo(out)                          分片 + 写头写体 + flush
  → BIOProtocolReadUtils.readMainHeader()         循环读，丢弃 ansyKey 不匹配的包
       └─ 遇到 0x08 推送包 → 投 AnsyResponseQueue，继续读
  → readProtocolBodyByteByNext()                  按 isNext 拼接 + gunzip
  → mainHeader.isStateOk() ? 返回 body : 抛异常（含服务端错误报文）
  → finally: returnKey + socketClient.stop() + releaseConnection
```

### 6.2 订阅 + 自动重连

```
subscribeInfoByLikeAuto()
  → 校验 typeFlag != "HEART"
  → SubscriptionInfo.getFlagKey() = typeFlag-groupId-clientId
  → checkSubscription() 幂等检查
  → SubscribedCache.put(subsInfo) + setSubscribe(true) + setLastUpdateTime(now)
  → 发送 00010034 订阅包
  → FLAG=="1" → new Thread(SubscribeInfoHandleByLikeAutoThread).start()
       └─ 长循环读包：
            if ("HEART".equals(typeFlag)) continue;      过滤心跳
            call.execute(typeFlag, seqNo, data, appendMsg);
          退出条件：异常 或 !isSubscribe()
          finally: close + release（不 remove 缓存）
          异常时: call.onFailure(msg)

—— 同时，AutoScanningSubscribeThread 持续扫描 ——
  now - lastUpdateTime > 10s  →  setSubscribe(false)  →  入队
       ↓
  AutoSubscribeThread（3 个，100ms 轮询）
     poll → 未订阅 → 用缓存中的原始参数重建订阅
```

### 6.3 Redis 直连初始化

```
initRedisConnnection()
  → execute(DS00010030Protocol)
  → ShardedReidsPool.initPool(返回的 JSON)
       REDIS: "h1:p1,h2:p2" → JedisShardInfo[]
       USERNAME → 密码
  → 之后 RedisTools.* 走 ShardedJedis 直连
```

---

## 七、设计亮点

| # | 亮点 | 说明 |
|---|---|---|
| 1 | **11 字节定长头 + 位标志扩展** | 用 1 byte 承载 6 个协议能力（正常/分片/压缩/推送/base64/hessian），高并发下省带宽 |
| 2 | **推流与响应自动分流** | `readMainHeader` 识别 `0x08` 后分流到异步队列，同步调用永不受推送干扰 |
| 3 | **订阅两级自愈** | 10s 心跳沉默检测 + 队列化重连 + 参数幂等保存，断线业务无感 |
| 4 | **配置中心 + 连接本地化** | Redis 地址网关下发、数据本地直连，控制面与数据面分离 |
| 5 | **可观测内建 SDK** | 按命令字流量统计、业务节点摘要上报、`[ansyKey]` 全链路日志、慢调用告警 |
| 6 | **协议开放扩展** | 新能力用 `CommonProtocol(h,l,sh,sl)` 自定义命令号，无需改 SDK（短信/邮件即如此实现） |
| 7 | **订阅幂等保护** | 按 `typeFlag-groupId-clientId` 去重，避免重复订阅 |
| 8 | **心跳下沉客户端过滤** | `HEART` 包混在业务订阅流下发，客户端自行剔除，避免维护第二条独立心跳连接 |
| 9 | **实例级 key 随机化** | ansyKey 按 JVM 随机基数段填充，多实例部署天然避免 key 碰撞 |
| 10 | **消费组模型** | `clientId`（实例）+ `groupId`（消费组）分离，支持集群消费与动态扩缩容 |
| 11 | **启动幂等** | `ReentrantLock` + 双重检查，重复 `init` 不重复起线程 |

---

## 八、已知不足与风险点

### 代码缺陷

| # | 问题 | 位置 |
|---|---|---|
| 1 | **`DSBean` 构造函数 Bug**：`this.userPswd = "test@123"` 误写成 `this.userName`，导致 `getUserPswd()` 永远返回 null。**必须显式调 `setUserPswd()`**，否则登录失败 | `bean/DSBean.java:25-26` |
| 2 | **退订命令号异常**：类名 `DS0001fa10Protocol` 暗示命令号 `0001fa10`，但 `getSubLowProtocol()` 返回 `52`(0x34)，**与订阅命令号完全相同**，只能靠 body 差异区分，不符合协议设计规范 | `DS0001fa10Protocol.java:31` vs `DS00010034Protocol.java:35` |
| 3 | **ansyKey 三次归还**：`HandleAnsyRequestThread` 在 try / catch / finally 三条路径都调 `returnKey`，靠 `LinkedBlockingQueue.offer` 幂等兜住，属明显重复代码 | `thread/HandleAnsyRequestThread.java:52/57/64` |
| 4 | **配置键名 Bug**：`ShardedReidsPool` 中 `getIntValue` 硬编码读小写 `"key"`，与传入的大写字段名不匹配 | `redis/ShardedReidsPool.java:56` |
| 5 | **硬编码 TTL**：`hset` 固定 10800 秒不可配置 | `redis/RedisTools.java:317` |
| 6 | **死代码残留**：`getFromObjectFromRedis` 分支中 `str1 = null; return str1;` 使用前未声明（反编译伪影，原逻辑可疑） | `redis/RedisTools.java:26-28` |
| 7 | **调试输出残留**：`removeKeys` 中 `System.out.println(infoKeys.length)` | `redis/RedisTools.java:267` |

### 架构局限

| # | 问题 | 说明 |
|---|---|---|
| 1 | **同步 IO + 忙轮询** | `HandleAnsyRequestThread` 队列空时 `Thread.sleep(10L)`，典型忙轮询而非条件唤醒，空闲也有 CPU 开销 |
| 2 | **连接独占** | `execute` 是 BIO 同步流，一条连接同一时刻只能服务一个请求，并发只能靠池大小堆（默认 100） |
| 3 | **重试策略单一** | 仅在 `FirstMainHeaderNoDefined` 时重试 1 次，无指数退避、无熔断、无限流 |
| 4 | **静态初始化陷阱** | `ContentHelper` 静态块即加载 `applicationContext.xml`，缺 Spring 配置会 `ExceptionInInitializerError`，且异常被吞 |
| 5 | **订阅并发窗口** | 非 Auto 模式订阅成功后，若并发重复调用，`checkSubscription` 的检查与实际订阅之间存在竞态窗口 |
| 6 | **锁无续期机制** | 只有 TTL 没有看门狗续期，Redis failover 场景下可能丢锁；需将 `lockTime` 设得比业务执行时间更宽裕 |
| 7 | **队列空转与重复消费风险** | 消息处理线程未做 ack/幂等保证，断线重连从 `startIndex` 恢复，**需业务侧自行保证幂等** |

### 依赖陈旧

| 依赖 | 风险 |
|---|---|
| `net.sf.json` | 早已停止维护，存在历史 CVE |
| `log4j 1.x` | 存在 Log4Shell 等重大漏洞，已被完全淘汰 |
| `commons-lang` 2.x | 建议迁移到 commons-lang3 |
| 老版本 `jedis` | `ShardedJedisPool` 官方已不推荐 |
| `com.mid.util.comm.ByteUtils`、`com.ylsoft.niosocket` | 私有/内部工具，外部不可得，**可移植性与可维护性差** |

---

## 九、面试话术

### 30 秒电梯陈述

> "dataShare 是公司的**企业级数据交换网关**客户端 SDK。它做了六件事：**接入层**用长连接池 + 登录握手 + 心跳探活 + ansyKey 路由；**协议层**是自研的 11 字节定长二进制头，用位标志支持分片/gzip/Hessian/推送，解决推流与响应串包问题；**能力层**提供消息发布订阅（4 种模式，断线两级自愈）、双通道缓存（网关代理 + 本地直连）、分布式锁、短信邮件通知、配置下发和可观测埋点。整体是典型的**控制面与数据面分离**设计：连接串、MQ 配置由网关统一下发，数据流量走客户端直连，既集中管控又不让网关成为瓶颈。"

### 深挖点 1：为什么自己定二进制协议而不用 HTTP？

> "网关是全公司共用的，QPS 高、报文普遍很小（多为状态更新、通知类消息）。HTTP 的 header 开销和 JSON 的解析开销在这种场景下是纯浪费。定长 11 字节头 + 变长 body，可以用最小的解析成本拿到全部路由信息（命令号 4 字节 + 状态位 1 字节 + 关联键 3 字节），**业务报文用 JSON 保可读性，用 Hessian 保类型和性能**，两头都能占。"

### 深挖点 2：订阅的断线自愈怎么做的？

> "两级可靠性。第一级是**心跳识别**：`SubscribedCache` 记录每个订阅的 `lastUpdateTime`，超过 10 秒没更新就判定假死——注意 TCP 层可能没报错但对端已经不可达，光靠 `socket.close()` 是发现不了的，所以要靠**应用层静默超时**而不是连接异常。第二级是**重连队列**：3 个消费者线程每 100 毫秒轮询 `WaitSubscriptionTopicQueue`，把假死的订阅按缓存中的原始参数（typeFlag、startIndex、clientId、groupId、whereList、回调引用）幂等重建。
>
> 为什么 `clientId` 和 `groupId` 要分开？因为 `groupId` 是**消费组**语义——同组内一条消息只被消费一次；`clientId` 是消费者实例标识，服务端靠它识别谁掉线了。这也顺带支持了**动态扩缩容**：加实例改 clientId 就行，不用改配置。"

### 深挖点 3：推流和响应怎么区分？

> "同一长连接上既有同步响应又有服务端主动推送，这是长连接网关的经典难题。这里的做法是在 `readMainHeader` 里判断 state 的 `0x08` 位——如果是推送包，**不返回给业务线程，直接塞进异步队列，然后继续读下一个包**。所以业务线程的 `execute` 永远只拿到自己的响应包，天然不会串包。异步推送统一由 5 个 `HandleAnsyRequestThread` 从队列里取出来，按 ansyKey 反查回调对象分发。"

### 深挖点 4：缓存为什么要两套？

> "两条通道对应两类场景。走网关代理的适合要强隔离、要审计的业务；走本地直连的适合性能敏感的。关键设计是**直连的地址和密码仍然是网关下发的**——用 `00010030` 命令号向网关申请连接串，在客户端建 Jedis 分片池。这就是**控制面和数据面分离**：网关只管下发配置，数据流走直连，既享受集中管控，又避免了网关成为单点瓶颈。"

### 深挖点 5：这套设计的不足？

> "有几个我自己复盘出来的问题：一是 `DSBean` 构造函数把 `userPswd` 误赋给了 `userName`，密码默认值永远拿不到，必须显式 set；二是退订协议的命令号和订阅撞了，只能靠 body 区分，协议设计不规范；三是 `HandleAnsyRequestThread` 的 ansyKey 在三条路径上重复归还，靠队列幂等兜住；四是最关键的——**消息处理没有 ack 机制**，断线重连后从 startIndex 恢复，业务侧必须自己做幂等，否则会重复消费，这是接入文档里明确要求的。另外依赖上，`net.sf.json` 和 `log4j 1.x` 都已经被淘汰了，如果有升级计划我会先替换这两块。"

---

## 附录 A：核心类速查表

### dataShareCommon-1.1.3

| 类 | 职责 |
|---|---|
| `protocol/ds/internal/head/MainHeader.java` | 11 字节协议头定义、位标志、序列化 |
| `protocol/ds/internal/IProtocol.java` | 协议接口，`LENGTH = 4096` |
| `protocol/ds/internal/abst/ProtocolAbst.java` | 协议抽象基类，分片发送、流量计数 |
| `protocol/ds/internal/constant/MainHeaderStatus.java` | 状态常量（OK=64、ERROR=0 及各标志位） |
| `protocol/ds/internal/count/ClientRequestCount.java` | 按命令字统计请求量 |
| `protocol/ds/exception/*` | `BaseException` / `ProtocolException` / `FirstMainHeaderNoDefined` / `RemoteCloseException` / `RemoteReceiverDelayException` / `ServiceNoExistExcepion` / `ServiceSuspendedException` / `SocketSizeExcepion` |
| `protocol/utils/ChannelReadUtils.java` | NIO 读满指定字节，`-1` 时按 position 区分对端关闭 / 数据不全 |
| `utils/ContentHelper.java` | 静态块加载 `applicationContext.xml`，`getBean(name, cls)` |
| `utils/GZipUtils.java` | gzip / ungzip |
| `utils/HessianSerializationUtils.java` | Hessian2 `objectToByte` / `byteToObject` |
| `utils/DesUtils.java` | DES/ECB/NoPadding + Base64 |
| `utils/IPUtils.java` | `getMyIp()`，Win/Linux 分支实现 |
| `utils/LoggerUtils.java` | 日志工具 |

### dataShareClientAPI-1.3.4

| 包 | 类 | 职责 |
|---|---|---|
| （根） | `DSClientAPI.java` | **主入口**，全部对外能力 |
| `bean` | `DSBean` | 连接配置 |
| `bean` | `DSClientRequest` / `DSClientResponse` | 异步请求/响应包装 |
| `bean` | `SubscribeType` | `BASE` / `BASE_AUTO` / `LIKE` / `LIKE_AUTO` |
| `bean` | `SubscribeWhere` | `NAME` / `VALUE` / `WHERETYPE(equals|constain)` |
| `bean` | `SummaryLevel` | `ERROR` / `WARN` / `BUSINESS` |
| `core` | `BIOSocketConnectManager` | 连接池管理 |
| `core` | `DSLoginImpl` / `DSHeartBeatExplore` | 登录 / 心跳 |
| `core` | `HeaderKeyPool` | ansyKey 池（65534，随机基数段） |
| `core` | `AnsyResponseQueue` | 异步推送包队列 |
| `core` | `ExecuteAnsy` | 异步执行（CountDownLatch 60s 超时） |
| `core/protocol` | `DSLoginProtocol` / `DSHeartProtocol` | 登录 / 心跳协议 |
| `cache` | `SubscribedCache` | 订阅关系缓存 |
| `cache` | `AnsyRequestCache` / `DSClientAnsyCallVal` | 异步请求 / 结果缓存 |
| `cache` | `DsConstant` | 常量 |
| `face` | `ISubscribeAbstCall` / `ISubscribeCall` / `ISubscribeAutoCall` / `ISubscribeLikeCall` / `ISubscribeLikeAutoCall` | 订阅回调 |
| `face` | `IDSClientAsynCall` | 异步请求回调（`onSuccess` / `onFailure`） |
| `protocol` | `CommonProtocol` / `CommonHessianProtocol` | 通用协议（自定义命令号） |
| `protocol/system` | 15 个 `DS*Protocol` | 系统命令协议 |
| `queue` | `WaitSubscriptionTopicQueue` | 订阅重连队列 |
| `queue/bean` | `SubscriptionInfo` | 订阅信息，`flagKey = typeFlag-groupId-clientId` |
| `redis` | `ShardedReidsPool` | Jedis 分片池 |
| `redis` | `RedisTools` | String/Object/List/Hash 操作 |
| `thread` | `AutoScanningSubscribeThread` ×1 | 假死扫描 |
| `thread` | `AutoSubscribeThread` ×3 | 订阅重连 |
| `thread` | `HandleAnsyRequestThread` ×5 | 异步推送分发 |
| `thread` | `SubscribeInfoHandleThread` | BASE 订阅读循环 |
| `thread` | `SubscribeInfoHandleAutoThread` | BASE_AUTO 订阅读循环 |
| `thread` | `SubscribeInfoHandleByLikeThread` | LIKE 订阅读循环 |
| `thread` | `SubscribeInfoHandleByLikeAutoThread` | LIKE_AUTO 订阅读循环 |
| `utils` | `BIOProtocolReadUtils` | 读头 / 读体 / 推流分流 / 分片拼接 |
| `utils` | `BIOInputStreamUtils` / `BytePrint` | IO 与调试工具 |
| `utils` | `HessianSeriUtils` | Hessian 序列化封装 |

---

*文档由源码阅读整理，命令号与行为均以 `dataShareClientAPI-1.3.4.src` / `dataShareCommon-1.1.3.src` 中的实际实现为准。*
