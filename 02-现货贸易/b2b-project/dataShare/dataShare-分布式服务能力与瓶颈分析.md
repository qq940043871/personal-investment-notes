# dataShare 分布式服务能力 · 深度解读与瓶颈分析

> 分析对象：`dataShare-2.6.2`（服务端 159 个类） + `dataShareClientAPI-1.3.4` / `dataShareCommon-1.1.3`（SDK）
> 消费方：`J_1018_midservice-v1.1.188.228.5`（188 个类 / 46943 行）
>
> 本文档所有结论均以源码为准，关键论断附 `文件:行号` 证据。SDK 侧能力清单见同目录 `dataShare-SDK网关能力解析.md`，本文不重复，只聚焦**服务端**与**端到端链路**。

---

## 目录

- [一、一句话定位](#一一句话定位)
- [二、端到端拓扑](#二端到端拓扑)
- [三、dataShare 提供的六大能力](#三datashare-提供的六大能力)
  - [能力 1：协议路由与命令分发](#能力-1协议路由与命令分发)
  - [能力 2：分布式服务调用（ASM 动态接口 + Hessian 代理）](#能力-2分布式服务调用asm-动态接口--hessian-代理)
  - [能力 3：五套异构后端协议栈](#能力-3五套异构后端协议栈)
  - [能力 4：共享缓存（Redis 代理通道）](#能力-4共享缓存redis-代理通道)
  - [能力 5：消息总线（Kafka 发布订阅 + 推送回写）](#能力-5消息总线kafka-发布订阅--推送回写)
  - [能力 6：分布式锁](#能力-6分布式锁)
  - [附带能力：通知下发、配置读取、运行时控制面](#附带能力通知下发配置读取运行时控制面)
- [四、midservice 侧的使用画像](#四midservice-侧的使用画像)
- [五、关键流程时序](#五关键流程时序)
- [六、系统瓶颈](#六系统瓶颈)
  - [P0 级瓶颈](#p0-级瓶颈)
  - [P1 级瓶颈](#p1-级瓶颈)
  - [P2 级瓶颈](#p2-级瓶颈)
  - [瓶颈汇总表](#瓶颈汇总表)
- [七、缺陷与安全风险清单](#七缺陷与安全风险清单)
- [八、改造建议与优先级](#八改造建议与优先级)
- [九、架构评价](#九架构评价)

---

## 一、一句话定位

> **dataShare 是平台的「分布式服务总线 + 共享中间件」层**。它对 midservice 屏蔽了 40+ 个业务子系统的异构接入差异（私有 TCP 协议栈、Hessian、HTTP、Go 透传），提供统一 4 字节命令号寻址；同时以 Redis / Kafka / JDBC 为底座，向全平台提供共享缓存、消息总线、分布式锁、通知通道和一份粗粒度的运行时控制面。
>
> **它不是注册中心**（无服务注册/心跳上报/负载均衡），**不是熔断器**（有标记但无决策），**不是配置中心**（有缓存位但未接线）。它的本质是 **ESB 式协议转接器 + 共享中间件代理**。

---

## 二、端到端拓扑

```
                          ┌──────────────────────────────────────────┐
   C端App / 小程序          │  midservice (1018)                       │
   B2B机构端      ──HTTP──▶│  HandlerController /api/**               │  ← 南北向
   第三方机构      ──HTTP──▶│  ToBackController /toBack/**            │     HTTP 网关
                          └───────────────┬──────────────────────────┘
                                          │ DSClientAPI (SDK, 11字节二进制协议)
                                          │ 113 处 callHession + 22 处 callSocket
                                          │ 15 处 getRedisInfo + 2 处 publishInfo
                                          ▼
              ┌───────────────────────────────────────────────────────────────┐
              │  dataShare 服务端 (NioSocketServer, 单端口)                    │
              │                                                               │
              │  HandlerImpl.run()  ── 按 {mainHigh,mainLow} 查 ProtocolCache  │
              │        │                                                      │
              │        ├─ connType=0 → 35 个 T*Service  (系统内置能力)         │
              │        │      ├─ Redis  : 缓存/队列/锁                          │
              │        │      ├─ Kafka  : 发布/订阅/短信/邮件                    │
              │        │      └─ JDBC  : 配置读取                             │
              │        │                                                      │
              │        ├─ connType=1 → Hessian  → 微服务 (ASM 动态接口)        │
              │        ├─ connType=2 → Socket  → 私有 TCP 协议栈 (5 选 1)       │
              │        ├─ connType=3 → HTTP    → 后端 HTTP 服务                 │
              │        └─ connType=4/5 → 空实现 (死代码)                        │
              └───────────────────────────────────────────────────────────────┘
                     │                          │                 │
                     ▼                          ▼                 ▼
              Redis (共享缓存)          Kafka (消息总线)      后端业务系统
                                       + 40+ 微服务/交易系统
```

**关键点**：midservice **只 import SDK**（`com.ylsoft.ds.api.client.DSClientAPI`），不依赖任何 `com.ylsoft.ds.*` 服务端包。两者是独立构件，靠 4 字节命令号 + DB 配置表 `TB_DS_PROTOCOL` / `TB_DS_REGISTEERED_SERVICE` 耦合。

---

## 三、dataShare 提供的六大能力

### 能力 1：协议路由与命令分发

**寻址模型**：`MainHeader`（11 字节定长头）中 `mainHigh`/`mainLow`/`subHigh`/`subLow` 四字节构成两级路由键。

```
粗键 (2字节) = mainHigh + mainLow   → ProtocolCache → ProtocolBean → 决定 connType（后端走哪套协议栈）
细键 (4字节) = 上述四字节            → "t" + 8位hex + "Service" → 具体的 T*Service 或远程服务
```

- 粗键查表：`com/ylsoft/ds/db/memory/ProtocolCache.java:10`（ConcurrentHashMap），数据来自 `TB_DS_PROTOCOL`（`db/load/impl/ProtocolLoadImpl.java:49`）
- 细键生成：`com/ylsoft/ds/service/nio/core/CommandParseUtils.java:7-17`
  ```java
  stb.append("t"); stb.append(getProtocolString(mainHeader)); stb.append("Service");
  ```
- 分发：`com/ylsoft/ds/service/core/HandlerImpl.java:35-57`
  ```java
  String procotolKey = byteToString(getMainHigh()) + byteToString(getMainLow());
  ProtocolBean procotolBean = ProtocolCache.get(procotolKey);
  if (procotolBean != null) {
    switch (procotolBean.getConnType()) {
      case 0: handleDSSystemProtocol(); break;   // 系统内置
      case 1: handleHessianConn();    break;      // 微服务
      case 2: handleSocketConn();    break;      // 私有 TCP
      case 3: handleHttpConn();      break;      // HTTP
      case 4: handleWebServiceConn();break;      // 空实现
      case 5: handleFixConn();       break;      // 空实现
    }
  }
  ```

**设计价值**：同一套命令号空间同时承载「系统内置能力」和「远端服务调用」，调用方无需感知后端是本地实现、Hessian 微服务还是私有 TCP 交易系统。

**局限**：`connType=4`（WebService）和 `connType=5`（Fix）在 `HandlerImpl.java:96-102` 是空方法，在 `server/webservice/WebServiceConnService.java:12-14`、`server/fix/FixConnService.java:12-14` 的 `load()` 也是空方法 —— **死代码**。

---

### 能力 2：分布式服务调用（ASM 动态接口 + Hessian 代理）

这是 dataShare 提供"分布式服务能力"的**技术核心**，也是最容易误解的部分。

#### 关键澄清：ASM 生成的不是代理实现类，是「凭空造出的接口」

```java
// com/ylsoft/ds/server/asm/internal/InterfaceClass.java:26-42
public byte[] getBytes() {
  String interNameStr = this.interfaceBean.getInterfaceName().replaceAll("\\.", "/");
  ClassWriter classWrite = new ClassWriter(0);
  classWrite.visit(51, 1537, interNameStr, null, "java/lang/Object", new String[0]);
  for (MethodBean methodBean : this.interfaceBean.getMethodList()) addMethod(classWrite, methodBean);
  classWrite.toByteArray();
}
private void addMethod(ClassWriter cw, MethodBean bean) {
  MethodVisitor mv = cw.visitMethod(1025, bean.getMethodName(), getMethdDesc(bean), null, null);
  mv.visitEnd();     // ← 无 visitCode / visitInsn，方法体为空
}
```

- `visit(51, 1537, ...)`：`1537 = 0x601 = ACC_PUBLIC | ACC_INTERFACE | ACC_ABSTRACT`
- `visitMethod(1025, ...)`：`1025 = 0x401 = ACC_PUBLIC | ACC_ABSTRACT`

**结论**：生成的是**纯抽象接口字节码**。它的唯一作用是——在 dataShare 进程内**凭空造出后端微服务接口的类型**（接口名 + 方法签名），从而让 Hessian 能以该类型创建 JDK 动态代理。

#### 完整链路

```
① 后端暴露接口元数据
   HessianMetaInfoAPI._hessian_getAttribute("com.ylsoft.class.desc")
   → JSON: { CN: 接口全名, MS: [{ N: 方法名, RT: 返回类型, IP: [{ IT: 参数类型 }] }] }
   HessianFactoryUtils.java:134-137

② dataShare 现场生成接口字节码
   InterfaceBean.parse(json)  →  InterfaceClass.getBytes()  →  MyClassLoader.defineClass()
   InterfaceBean.java:14-35 / HessianConnRunnable.java:52-56

③ 创建 Hessian 代理
   HessianProxyFactory(classLoader).create(remoteClass, url)   → JDK 动态代理
   HessianFactoryUtils.java:104-108

④ 注册到路由表
   HessianServiceCache.put(key, HessianServcieBean(method, callObj, serviceBean))
   HessianConnRunnable.java:68 / HessianServiceCache.java:20-22

⑤ 每次调用
   反射取出 Method → Method.invoke(callObj, params) → 代理负责序列化并发 HTTP POST 到后端
   ConnHessianCommandParse.java:154-177
```

#### 双序列化协议栈

`MainHeader.state` 的 `0x01` 位（Hessian 标志）决定 body 形态（`dataShareCommon/.../MainHeader.java:129-206`）：

| 模式 | 参数来源 | 返回 |
|---|---|---|
| **Hessian**（二进制） | `HessianSeriUtils.byteToObject(bodyBytes)` 直接得 `Object[]` | `HessianSeriUtils.objectToByte()` |
| **JSON**（文本） | `getInParams()` 逐个按名字从 JSON 取，手工类型转换 | `JSONObject.put("DATA", reVal)` |

JSON 模式的类型转换靠 4 次 `equalsIgnoreCase` 字符串比较（`ConnHessianCommandParse.java:196,203,209,216`：`java.lang.String` / `java.util.Map` / `java.util.List` / `java.lang.Integer`），Map/List 还要再走一次 `jsonStrToMap`/`jsonStrToList` 二次解析（`:239-276`）。

> **参数名丢失**：`ParameterBean` 只存类型名，参数名恒为 `""`（`server/asm/bean/ParameterBean.java:8-12`）。JSON 模式按名字匹配依赖 DB 表 `TB_DS_INPARAS` 的定义（`ProtocolLoadImpl.getInParamsListByOne`）。

#### 懒加载 + 运行时重载

`ConnHessianCommandParse.java:154-156`：查不到 `HessianServiceCache` 时，**在 NIO 处理线程上同步**执行 `hessianConnService.connServer(...)` —— 现场做类加载 + 代理创建 + 网络握手。

---

### 能力 3：五套异构后端协议栈

`TB_DS_PROTOCOL.PROTOCOL_TYPE` 决定出向使用哪套栈（`SocketConnRunnable.java:59-74`）：

| type | 栈 | 头长 | 关键字段 | 编码 | 分片 | 加密 |
|---|---|---|---|---|---|---|
| 0 | **dsstandard**（DS 平台标准） | **11 字节** | length(2)+cmd(4)+state+encryption+ansyKey(3) | UTF-8 | 4096 | state 位可选 |
| 1 | **trade32_f406** | 32 字节 | length+Main+Son+State+Next+Sign+Compress+BL(4)+TraderID(15) | **GBK** | 30720 | 无 |
| 2 | **trade32_f401** | 32 字节 | 同上 | GBK | 30720 | 无 |
| 3 | **trade32_f406MultiLine** | 32 字节 | 同上 | GBK | 30720 | 无 |
| 4 | **gomti**（Go 透传） | 16 字节 | 魔数{16,36}+length(2)+high+low+state/next/compress+keep+serialNum(4)+checkSum(2) | UTF-8 | 4096 | **AES/CBC/PKCS7** |

**dsstandard 是 midservice 用的那套**——它与 SDK 侧 `CommonProtocol` / `MainHeader` 完全对应（11 字节头 + 4 字节命令号）。

**三兄弟 trade32 的差异全在 body 语义**（头部字节布局完全一致，`diff` 仅差类名）：

- **f406**：JSON → `k=v\x01` 扁平串；响应按 `\x06` 切数组，**每行自描述**（`Trade32_f406Protocol.java:118-129,164-193`）
- **f401**：JSON → `k=v\x01`，支持 `DETAIL_LIST` 子数组；响应是**表格式**——首行列名，后续按列名映射（`Trade32_f401Protocol.java:119-161,196-223`）
- **f406MultiLine**：请求侧同 f406，响应侧同 f401 的表格式（`Trade32_f406MultiLineProtocol.java:118-129,164-193`）——**MultiLine = f406 请求 + f401 响应**

**gomti** 是唯一有加密和 TCP 校验和的栈：请求体经 `AESUtils.encrypt`（AES/CBC/PKCS7，密钥登录时由后端下发，`GomtiLoginImpl.java:72,82`）；16 字节头含 `serialNum`（原子递增）和 `checkSum`（TCP 校验和）；收发靠 serialNum 匹配实现**异步响应与请求关联**，不匹配则丢弃并回写被动心跳（`GomtiCommonProtocol.java:54-56`，`BIOProtocolReadUtils.java:27-43`）。

> **注意**：这 5 套栈**不在同一端口上复用**。dataShare 对前端只有一个 NIO 端口；5 套栈是**出向**到不同后端地址的不同 TCP 连接。前端的多路复用靠 4 字节命令号。

---

### 能力 4：共享缓存（Redis 代理通道）

| 命令 | 类 | 行为 |
|---|---|---|
| `00010030` | `T00010030_GetRedisService` | 回吐 Redis 地址 + **明文密码**（`SystemRedisConfig.AUTH`） |
| `00010031` | `T00010031_PutRedisInfoService` | 写 KV；`ISBATCH=true` 走 pipeline，上限 5000 |
| `00010032` | `T00010032_GetRedisInfoService` | 读 KV（`jedis.get(module + "-" + key)`） |
| `00010035` | `T00010035_RemoveRedisInfoService` | 删 KV |
| `00010036` | `T00010036_UpdateRedisInfoExprieService` | 改 TTL（先 GET 再 EXPIRE） |
| `00010037` | `T00010037_AppendQueueRedisService` | LPUSH/RPUSH + 3 次 HSET 建索引 |
| `00010038` | `T00010038_GetFromQueueRedisService` | 循环 LPOP 取 N 条，`!@!` 拼接 |
| `00010039` | `T00010039_GetLenFromQueueRedisService` | HGETALL + **逐条 LLEN** |

**命名空间隔离**：`module + "-" + key`。这让不同业务模块共享同一个 Redis 集群但互不干扰。

**"控制面 / 数据面分离"设计**：客户端 SDK 侧有两条通道——走网关代理（`0001003x`）或申请连接串后本地直连（`00010030` → `ShardedReidsPool`）。地址密码由网关下发，数据流量走直连。

**midservice 侧有 15 处走 DS Redis**，全部是**跨系统共享数据**（本地 Redis 无法替代）：

```
HandlerController.java:1909  getRedisInfo("1001_AGENTFIRM_USERID", orgId)   // 机构代客映射
HandlerController.java:1940  getRedisInfo("1001_GATEWAY_API", api)           // 客户挂起
HandlerController.java:1985  getRedisInfo("3002_API_AUTH_LIST", USERID)      // 第三方授权清单
B2CHandler.java:554/572     getRedisInfo("2020", "HQ_" + WAREID)            // 行情
CxgpHandler.java:102        getRedisInfo("2007", X)                          // 挂牌/模板静态数据
PayHandler.java:450/459     getRedisInfo("1003", "PUBLIC_TRADE_LIST")        // 交易品种清单
FundsV1Handler.java:100     getRedisInfo("1001_FUND_LOGINNUM", USERNAME)
SensitiveWordInit.java:109  getRedisInfo("1001_INFO", "SENSITIVE")           // 敏感词库
```

---

### 能力 5：消息总线（Kafka 发布订阅 + 推送回写）

**发布**（`T00010033_PushlishMQService`）：

```
topicServer.getTopicName(typeFlag)      ← Redis → JDBC → 自动建 topic
  → ProducerCache.get(typeFlag)         ← 每 typeFlag 一个 KrackleProducer
  → producer.send(value, key)           ← 异步，100ms 缓冲
  → 立即返回 FLAG=1
```

producer 参数（`KrackleProducer.java:79-85`）：`queue.buffering.max.ms=100`、`request.required.acks=1`、`message.send.max.retries=10`、`compression.code=none`。

**订阅**（`T00010034_SubscribeMQService`）：dataShare 自己消费 Kafka，再**推回订阅者的 socket**：

```
SubscribeCache.get(flagKey) == null → 新建 KrackleConsumer（独立线程）
  → consumer 拉取 → ReceiveHandleImpl.reviewOfferByNext → session.reviewOffer(...) 写回原 socket
```

这是典型的 **MQ → 长连接推送网关**：订阅者只需保持 TCP 连接，dataShare 负责 Kafka offset 管理与推送。

**Offset 机制**：
- 内存态 `MqOffsetConstant`（ConcurrentHashMap），key = `topicName + "@" + groupFlag`，offset 是 `AtomicLong`（`MqOffsetConstant.java:19,23`，`OffsetBean.java:9,15`）
- 去重：`ReceiveHandleImpl.isSended()` 比较 `offsetBean.getOffset() >= offset` 视为已发（`ReceiveHandleImpl.java:110`）
- 持久化：`HandleLastOffsetThread` **每 60 秒**全量刷库到 `TOPIC_CONSUMER_INDEX`（`HandleLastOffsetThread.java:34-41`，`MQTopicServiceImpl.java:126-143`）；启动时恢复（`MqOffsetConstant.java:54-65`）

**可靠性语义**：offset 在**推送之前**写入（`ReceiveHandleImpl.java:50` 记 offset，`:51` 推送）。⇒ 进程内近似 at-most-once，崩溃重启后近似 at-least-once，**整体是"可能重复也可能丢"的弱语义**。

**失败处理**：consumer 内 `catch (Throwable)` 只记日志继续循环（`KrackleConsumer.java:171-173`），**无重试、无 DLQ**。而 `ReceiveHandleImpl` 抛 `RuntimeException` 会 `consumer.setRun(false)` + 摘除订阅 + destroy session（`ReceiveHandleImpl.java:57-62`）——**一条消息处理失败会杀掉整条订阅**。

---

### 能力 6：分布式锁

| 命令 | 类 | 行为 |
|---|---|---|
| `00010040` | `T00010040_LockBusinessService` | 单 key 业务锁 |
| `00010041` | `T00010041_unLockBusinessService` | 解单锁（DEL） |
| `00010042` | `T00010042_LockBatchService` | 批量锁（排序防死锁）+ serialNo 幂等 |
| `00010043` | `T00010043_unLockBatchService` | 批量解锁（pipeline DEL） |

实现（`T00010040_LockBusinessService.java:87-101`）：

```java
if (waitTime == 0L) {
  if (jedis.setnx(tkey, "1").longValue() == 1L) {
    jedis.expire(tkey, autoTimeoutTime);
    return true;
  }
}
else while (System.currentTimeMillis() - startTime < waitTime) {
  if (jedis.setnx(tkey, "1").longValue() == 1L) {
    jedis.expire(tkey, autoTimeoutTime);
    return true;
  }
  Thread.sleep(1L);
}
```

锁键：`"DS-LOCK-DETAIL_" + module + "-" + key`（`:53`）。

**批量锁的亮点**：`Collections.sort(keyList)`（`T00010042_LockBatchService.java:63`）保证所有节点同序加锁避免死锁——标准做法。

**⚠️ 重要事实：midservice 完全没用这套锁。** `grep` 全库无 `lockBusiness` 调用。midservice 用的是进程内 `ReentrantLock`（`utils/LockUtils.java:9` 的 `ConcurrentHashMap`）。这意味着**多实例部署时"同一用户同一协议串行"的保证只在单 JVM 内成立**。而 `ServiceConfig.SYS.clusterId` 证明系统支持多集群节点——**这是架构级的选型缺失**。

**⚠️ `LockCache` 不是分布式锁**：`constant/LockCache.java:13` 是进程内 `ConcurrentHashMap<String, Lock>`，**只用于保护 dataShare 进程内的 producer 创建**（`T00010033_PushlishMQService.java:59,67`）。它与业务锁无关，名字相近极易混淆。

---

### 附带能力：通知下发、配置读取、运行时控制面

**通知**（走 Kafka 间接投递，master 节点才消费）：

| 命令 | 行为 | 位置 |
|---|---|---|
| `00010050` | 投递短信到 `DS_SMS_TOPIC` | `T00010050_SendSMSService.java:47-56` |
| `00010051` | 投递邮件到 `DS_EMAIL_TOPIC` | `T00010051_SendEmailService.java:52-58` |

`DSRunMain.java:62-66`：`if (SystemConfig.isMaster())` 才启动 `UcsExtendMain`——**slave 节点不消费短信/邮件 topic**。

**配置读取**：`00010101`（`T00010101_LoasParaService`）读公共配置。⚠️ **每次请求一次 JDBC**（`ParameterServiceImpl.java:41` → `PubConfigServiceImpl.java:54`）。

**运行时控制面**：

| 命令 | 类 | 实际语义 |
|---|---|---|
| `0001fa03` | `ReloadProtocoldService` | **真正有效**：重读 DB 协议 + 重建后端连接（`:63-68`）。但 connType 3/4 分支是空实现 |
| `0001fa04` | `UninstallProtocoldService` | 从 ProtocolCache 移除（`:60-63`） |
| `0001fa10` | `UninstallSubscription` | 停掉某订阅的 consumer（`:64-65`） |
| `0001fc01/02` | `get/setDetailStatus` | **不是熔断器**，只是全局静态日志开关 `isDetailLog`（`:26,38`） |
| `0001fa01/02` | `ServiceSuspended/Recovery` | **未实现的功能外壳**——两者代码逐行相同，都只遍历订阅缓存回吐列表，**不挂起/不停止任何消费者** |
| `0001fe01/02/06/07` | IP/Topic/Module/Protocol 列表 | 运维视图，O(n) 线性扫描 |

> **结论**：dataShare 提供了一个**半成品的运行时控制面**。真正的服务治理（限流、熔断、灰度、注册发现）**在本层完全缺失**。熔断/健康检查的雏形只存在于 `ServiceBaen.isSuccessRun/errMsg` 标记（`ServiceBaen.java:20-21`），**但该标记仅用于 0001fe07 展示，不参与任何流量决策**。

**关于"服务注册中心"**：`TB_DS_REGISTEERED_SERVICE` 是**库内配置表**（`ProtocolLoadImpl.java:61`），启动时全量载入内存，**没有服务主动上报 IP/端口的注册接口**。唯一的"IP 目录"（`0001fe01/02`）列的是 **MQ 订阅者的 socket 远端地址**（`T0001fe01_IPByTopicService.java:50` 取 `getSocketChannel().getRemoteAddress()`），不是业务服务实例。

---

## 四、midservice 侧的使用画像

### 调用规模（实测 grep 统计）

| SDK 能力 | 调用点数 | 分布 |
|---|---|---|
| `DSUtils.callHession`（Hessian 微服务） | **113** | 47 个文件 |
| `DSUtils.callSocket`（Socket 协议栈） | **22** | — |
| `getRedisInfo`（共享缓存） | **15** | 9 个文件 |
| `publishInfo`（MQ 发布） | **2** | 审计日志 + 监控 |
| 涉及 `DSUtils.*` 的文件总数 | **72** | — |

热点：`HandlerController`(10)、`XydLsHandler`(8)、`XhtV5Handler`(8)、`PlzgHandler`(8)、`PLZBzgHandler`(8)、`UploadController`(7)、`XhtHandler`(6)、`AuthHandler`(6)。

### 每请求的 dataShare 往返

**不是所有调用都在请求路径上**，分三档：

**A. 每请求必做（但不是 DS）**

| 调用 | 位置 | 说明 |
|---|---|---|
| `ServiceUtils.getToken()` → **本地 Redis** | `HandlerController.java:470` | 含 1 次 GET + 2 次 EXPIRE |
| `serialService.gen()` | `HandlerController.java:617` | `public synchronized` |
| `MVCUtils.getProperty(...)` | 36 处 | 内存 Map |

**B. 每请求可能发生的 DS 同步往返**

| 调用 | 位置 | 触发条件 | 往返数 |
|---|---|---|---|
| `callSocket({0,2,0,51})` 取 LOGINTYPE | `HandlerController.java:1605` | `is.verfiy.logintype=Y` 且走默认分支 | 1 |
| `callHession({0,65,16,6})` + `callHession({1,98,48,3})` 契约锁 | `:1491` / `:1511` | 同上 + `USERFLAG=2` | 2 |
| `callHession({0,9,0,97})` 协议签订 | `:1670` | `is.verfiy.agreetype=Y` | 1 |
| `callHession(OPENS.findFirm)` 会员有效期 | `:1700` | `is.verify.validDate=Y` | 1 |
| `getRedisInfo("1001_AGENTFIRM_USERID")` | `:1909` | `api.startsWith("SF_")` | 1 |
| `getRedisInfo("1001_GATEWAY_API")` | `:1940` | token `EXTRA_DATA.STATUS==1` | 1 |
| `getRedisInfo("3002_API_AUTH_LIST")` | `:1985` | `USERFLAG=3` | 1 |
| `publishInfo("1018_APP_LOG")` | `:944` | `is.open.secureLog=Y` | 1 |
| `callSocket(PurviewAuth.tokenCheck)` | `:452` | 每用户每 10 分钟 1 次 | 摊薄 |

> **推断**（配置值不在源码树中，无法确定生产实际开关组合）：最坏情况单请求 ≈ **8 次同步网络往返**，全部在 Tomcat 工作线程上**串行阻塞**。

**C. handler 内部按业务触发**：`CxgpHandler.get2007_X()`（`:102`）**每次调用都过 dataShare 读一次静态数据**，却支撑 **36 个 GP9xxx 公开查询协议**（挂牌品种、行情模板、交货地…，全部 `needLogin=false`）。

### 同步 vs 异步

**几乎全同步。** 全文无 `ExecutorService` / `CompletableFuture` / `@Async` / `CountDownLatch` / `Semaphore`。

- 所有 DS 调用阻塞：`DSUtils.callSocket` → `getClient().execute()` 同步等返回（`DSUtils.java:180`）
- 唯一的"异步"是 **MQ 回环实现同步 RPC**（`CallBackSubscribe.java:207-268`）：先 publish 到 Kafka，再 `bq.poll(timeout)` **阻塞等回调**。用于 `PAY_PAY`、`PAY_SMS`、`10031_CASHIER`、`WX_CASH_POINT`、`F_CONVER` 等**支付交易类协议**。实际未降低端到端延迟，反而叠加 Kafka 往返 + 回调调度开销。

---

## 五、关键流程时序

### 5.1 一次 Hessian 微服务调用（midservice → dataShare → 微服务）

```
Tomcat 线程
  → DSUtils.callHession({1,98,48,3}, params)
      → DSUtils.revert(obj)                    ← Java 原生序列化+反序列化往返
      → getClient().executeHessian(CommonHessianProtocol)
          → HeaderKeyPool.getKey()             取 ansyKey
          → BIOSocketConnectManager 取连接      连接池
          → 11字节头 + body（state&0x1=1 → Hessian 二进制）
          → write + flush
          → readMainHeader() 循环读，丢弃 ansyKey 不匹配的包
             ├─ 0x08 推送包 → AnsyResponseQueue（不返回业务线程）
             └─ 自己的响应包 → body
          → HessianSeriUtils.byteToObject() → Object
      → revert() 再序列化一次
  → 调用方
```

**dataShare 服务端侧**：

```
NIO reactor 线程
  → HandlerImpl.run()
      → ProtocolCache.get("0198")  → connType=1
      → handleHessianConn() → ConnHessianCommandParse
          → HessianServiceCache.get("t01983003Service")
              ├─ 命中 → 直接用
              └─ 未命中 → 【同步】类加载 + 代理创建 + 网络握手
          → getInParams(): JSON 文本 → 逐参数按名取值 + 4 次 equalsIgnoreCase 类型判定
          → Method.invoke(callObj, params)  ← 反射
              → Hessian 代理 → Hessian 序列化 → HTTP POST → 微服务
          → 返回值 Hessian 序列化 → 写回 socket
```

### 5.2 一次 Socket 私有协议调用

```
ConnSocketCommandParse.callDSProtocol()
  → SocketClientConnectManager.getSocketClient()   ← 池借出
  → DSStandardProtocol.execute()                   ← 阻塞写 + 阻塞读
  → finally: SocketClientConnectManager.releaseConnection()   ← static synchronized!
```

**失败重试链**（`ConnSocketCommandParse.java:130-173`）：

```java
if (errMsg.indexOf("Timeout waiting for idle object") > -1) {
  SocketClientConnectManager.removeConnetPoll(mainProtocolKey);   // 关掉整个池
  str2 = callDSProtocol(mainProtocolKey, count);                   // 用同一个 count 重建
}
if (errMsg.indexOf("Read timed out") > -1) {
  if (serverProtocol.getServiceBaen().getIsRepeatCall() == 1 && count < 100)
    str2 = callDSProtocol(mainProtocolKey, count + 1);              // 递归重试
}
else if (errMsg.indexOf("服务端休息了下") > -1 && ...) { ... }
```

⚠️ 三处问题：① **依赖异常 message 文本**匹配，locale/版本变化即失效；② `else if` 挂在 `if (Read timed out)` 上，导致"服务端休息了下"分支**只在第一个 if 为 false 时才可能进入**——两者本是并列关系，此处写成互斥；③ 递归深度最高 **100 层**（`count < 100`）。

### 5.3 订阅推送

```
客户端 subscribeInfoByAuto
  → dataShare T00010034
      → SubscribeCache.get(flagKey)==null → 新建 KrackleConsumer + 独立线程
      → consumer 拉 Kafka → ReceiveHandleImpl
          → 记 offset（推送前）
          → session.reviewOffer(ReviewBean)  ← 写回订阅者的 TCP 连接
```

---

## 六、系统瓶颈

### P0 级瓶颈

#### P0-1 `SocketClientConnectManager` 全局锁 + 池创建竞态

```java
// com/ylsoft/ds/server/socket/core/SocketClientConnectManager.java:28-54
private static SocketClient getSocketClient(String clientFlag) throws Exception {
  ConnectPool connectPool = (ConnectPool)cpCache.get(clientFlag);
  if (connectPool == null) {
    AtomicBoolean atomicBoolean = (AtomicBoolean)lockMap.get(clientFlag);
    while ((atomicBoolean != null) && (!atomicBoolean.compareAndSet(false, true))) {
      Thread.sleep(1L);                                    // ← 忙等
    }
    if (atomicBoolean == null) {
      atomicBoolean = new AtomicBoolean(true);
      lockMap.put(clientFlag, atomicBoolean);              // ← check-then-act，非原子
    }
    connectPool = (ConnectPool)cpCache.get(clientFlag);
    if (connectPool == null) {
      SocketPara sp = (SocketPara)socketParaCache.get(clientFlag);
      connectPool = new ConnectPool(sp.getHostConfig(), sp.getPoolConfig());
      cpCache.put(clientFlag, connectPool);
    }
  }
  return connectPool.getConnection();
}
```

**三个缺陷叠加**：
1. `lockMap.get()` → `new AtomicBoolean` → `put()` 是**非原子的 check-then-act**。两个线程可同时判定 null，各建一个池，后者覆盖前者，前者泄漏。
2. `finally { atomicBoolean.set(false) }` 释放的是**局部变量**持有的对象。若 (1) 中发生覆盖，释放的是旧对象，新对象的 CAS 永远失败 → **该 clientFlag 永久死锁**（所有后来者卡在 `Thread.sleep(1)` 循环）。
3. `Thread.sleep(1L)` 忙等 = 上下文切换风暴。

**更严重的是归还路径**：

```java
// :56, :63
public static synchronized void releaseConnection(SocketClient sc, String clientFlag) { ... }
public static synchronized void removeConnetPoll(String clientFlag) { ... }
```

**类级 `static synchronized`** ⇒ **所有协议的所有并发请求在"归还连接"这一步被串成一条单线**。每个 socket 请求的 `finally` 都会走这里（`ConnSocketCommandParse.java:172-173,201-202,231-232,260-261,289-290`）。这是后端调用路径上的**全局单点**。

> 对照：客户端 SDK 侧用的是 `synchronized (ConnectPool.class)` 且只锁创建路径，**服务端版本更差**。

#### P0-2 池耗尽 → 关闭池 → 递归重试的雪崩链

池参数全部来自 DB（`ProtocolBean.java:83-85`），代码里**没有默认值**，池大小不可静态评估。`maxWaitMillis=5000`（`SocketConnRunnable.java:120`）⇒ 池耗尽时请求线程**阻塞 5 秒**后抛 `Timeout waiting for idle object` ⇒ 触发 `removeConnetPoll`（又一个全局锁）**关闭整个池** ⇒ 递归重建 ⇒ 全部请求再来一轮。

**放大器**：`SocketConnRunnable.java:112-121`、`:161-170`、`:205-214`、`:249-258`、`:294-303` —— **5 份几乎逐行重复的池配置代码**，任何调优都要改 5 处。

#### P0-3 midservice 三处全局 `synchronized` 在每请求路径上

```java
// com/ylsoft/mid/service/utils/DSUtils.java:35
public static synchronized DSClientAPI getClient() { return dsClient; }
// com/ylsoft/mid/service/service/SerialService.java:31
public synchronized String _genSerialLocal(int length) { ... }
// com/ylsoft/mid/service/utils/ServiceUtils.java:169
public static synchronized String getTokenId(HttpServletRequest req) { ... }
```

- `DSUtils.getClient()`：**135 个 DS 调用点全部经过它**，方法体只有一次字段读，但 monitor 争用真实存在（biased locking 在 JDK15+ 已移除）。
- `SerialService._genSerialLocal`：每请求一次，且 `DateUtils.getNowDString` 很可能每次 new `SimpleDateFormat`。
- `ServiceUtils.getTokenId`：纯读操作，锁完全无必要。

#### P0-4 `LockUtils.lockMap` 的竞态导致互斥失效 + 内存泄漏

```java
// com/ylsoft/mid/service/utils/LockUtils.java:9
public static Map<String, Lock> lockMap = new ConcurrentHashMap();
```

调用点（`HandlerController.java:1735-1740`）：

```java
if (LockUtils.lockMap.get(lockKey) == null) {
  Lock lock = new ReentrantLock();
  LockUtils.lockMap.put(lockKey, lock);
}
((Lock)LockUtils.lockMap.get(lockKey)).lock();
```

**三个缺陷**：
1. **无淘汰** —— `lockMap` 永不清理，key 数 = 协议数 × 在线用户数，**单调增长 → 内存泄漏**。
2. **check-then-act 非原子** —— `get` 与 `put` 之间有竞态，两线程可能各 new 一个 `ReentrantLock` 并互相覆盖，**导致互斥完全失效**（线程 A 锁 L1，线程 B 锁 L2）。必须用 `computeIfAbsent`。
3. **`unLockApi` 重新 `get`**（`:1756`）—— 若期间被覆盖会抛 `IllegalMonitorStateException`。

#### P0-5 midservice 不用 dataShare 分布式锁，多实例一致性缺失

dataShare 提供 `T00010040`（集群级 Redis 锁），midservice 却用进程内 `ReentrantLock`。`ServiceConfig.SYS.clusterId` 证明系统支持多节点。**用户串行保证在多实例下失效。**

---

### P1 级瓶颈

#### P1-1 无锁 HashMap 承载并发路由表

| 类 | 位置 | 并发模式 |
|---|---|---|
| `HessianServiceCache._cache` | `server/hessian/HessianServiceCache.java:12` | **put 在协议加载线程，get 在 NIO 请求线程**（`ConnHessianCommandParse.java:154`） |
| `HttpServiceCache._cache` | `server/http/HttpServiceCache.java:9` | 同上（`ConnHttpCommandParse.java:108`） |
| `AESKeyCache._cache` | `server/socket/gomti/head/AESKeyCache.java:8,26` | **put 在登录时，get 在每次收发**（`GomtiCommonProtocol.java:138`） |
| `ProducerCache._cache` | `mq/cache/ProducerCache.java:9` | **put 在并发 publish 路径**（`T00010033_PushlishMQService.java:64`） |
| `SubscribeCache._cache` | `service/subscribe/cache/SubscribeCache.java:24`（**TreeMap**） | NIO 线程 + consumer 线程并发；`getValues()` 遍历时另一线程 `removeKey` ⇒ **ConcurrentModificationException**（`T0001fe01_IPByTopicService.java:37,58`） |
| `HessianFactoryUtils.serverInstanceMap` | `server/hessian/core/HessianFactoryUtils.java:135` | 无锁 |
| `DSUserCache._cache` | `db/memory/DSUserCache.java:13` | 启动后只读 |

> 对照：`ProtocolCache` / `ServerProtocolCache` / `SocketClientParaCache` / `ClassLoaderCache` 都用了 ConcurrentHashMap ⇒ **作者知道该用，只是没用全**。

#### P1-2 每次请求一次 JDBC 查配置（缓存位留了没接线）

```java
// T00010101_LoasParaService.java:48 → ParameterServiceImpl.java:41 → PubConfigServiceImpl.java:54
List<Map> getAllPubConfig() { return jdbcTemplate.queryForList(query); }
```

`PubConfigCache` 类**存在且实现了 5 秒 TTL**，但全库 grep 只命中其自身定义 —— **从未被调用**。确定性 N+1 数据库热点。

`PubConfigServiceImpl.getAllPubConfig` 的 catch 返回 `new ArrayList()`（`:52-54`）⇒ **DB 故障伪装成"配置为空"**。

#### P1-3 每次 publish 一次 Redis + 潜在 JDBC

`getTopicName` 先查 Redis `-INNER-DSMQ-{typeFlag}`，miss 再查 `TB_DS_MQ_TOPIC`，再 miss 才建 topic 并写库（`MQTopicServiceImpl.java:27-48`）。Redis 被 evict / 抖动 ⇒ 退化为**每次 publish 一次 JDBC**。

#### P1-4 分布式锁的四项缺陷

见 [能力 6](#能力-6分布式锁)。摘要：
- `setnx` + `expire` **两条独立命令** ⇒ 非原子，存在"已 setnx 未 expire 即崩溃"→ **永久锁死**窗口
- 锁值固定 `"1"`，**不存 owner token** ⇒ **不可重入**、**无所有权校验**（任何客户端能 DEL 别人的锁）
- **无看门狗**，一次性 TTL（默认 600s），持锁方崩溃靠自然过期
- `waitTime>0` 时 **1ms 忙等 + 每次都发一次 Redis 往返**（`T00010040_LockBusinessService.java:93-98`）

#### P1-5 HTTP 客户端每请求新建且从不关闭

```java
// com/ylsoft/ds/server/http/HttpClientUtils.java:189-224（另有 4 个重载 :45,:101,:146,:183）
CloseableHttpClient httpclient = HttpClients.createDefault();
HttpPost httpPost = new HttpPost();
...
finally { if (httpPost != null) httpPost.releaseConnection(); }   // ← 只 release 请求，不 close client
```

每个 HTTP 请求 new 一个 `CloseableHttpClient`（含新的连接池和线程池），**从不 close** ⇒ 连接池对象泄漏，底层 socket 靠 GC 回收。Apache HttpClient 官方明确要求复用实例。

#### P1-6 热路径 per-request 对象分配

一个请求至少：

- **2 次 Spring `getBean` + 2 次 prototype 实例化**（`HandlerImpl.java:67,75,83,91`；35 个 `T*Service` 全部 `@Scope("prototype")`；`ConnSocketCommandParse` 自身也是 prototype）
- **1 次 clone**：`ServerProtocolCache.get()` 每次 `clone()` 一份（`:20`）→ `DSStandardProtocol.clone()` 再 clone `mainHeader`（`:144-148`）⇒ 每请求 3 个对象
- **至少 3 个 StringBuilder**：`CommandParseUtils.getCommand`（2 个）+ `getProtocolString`（1 个）+ `HandlerImpl.run()` 额外拼一次 procotolKey

`CommandParseUtils.byteToString` 是 **256 分支 switch**（`:41-557`），每次调用重走分支树。**同样的实现还在 `MainHeader.byteToString`（dataShareCommon）和 `BIOProtocolReadUtils.byteToString`（clientAPI）中重复了三份。**

#### P1-7 midservice 路由查找 O(n) 线性扫描（每请求两次）

```java
// HandlerController.java:622-628 与 :749-756
for (HandlerRouter _router : this.handlerRouters) {
  if (restfull.equals(_router.getAPI_RESTFULL())) { router = _router; ... break; }
}
```

`handlerRouters` 是 `ArrayList`（`:1109`）。本 jar 声明 **1296 个唯一协议号**（实测 `grep -rho 'protocol *= *"[^"]*"' | sort -u | wc -l` = 1296，`@HandlerRule` 共 1332 处）。**每请求两次线性扫描** + `String.equals` 逐个比较。

同类问题：
- `apiConfig` 线性扫描（`HandlerController.java:798-710`）
- `KeyMapper.getNameByAlias` 线性扫描 `dictionary`（**~1745 条** = 145 硬编码 + 10×10×16 个 `MT1xx` 码，`utils/KeyMapper.java:41-52,113-124`）⇒ 一次带 20 个参数的请求 = **3.5 万次字符串比较**
- `MCallable` 每个方法参数做一次线性查找（`:2410-2421`、`:2456-2465`）

#### P1-8 敏感词过滤器每次重建整棵 Trie

```java
// utils/sensitive/SensitivewordFilter.java:26-29
public static SensitivewordFilter getInstance() { return new SensitivewordFilter(); }   // ← 不是单例！
private SensitivewordFilter() { this.sensitiveWordMap = new SensitiveWordInit().initKeyWord(); }
```

`initKeyWord()` → `DSUtils.getClient().getRedisInfo("1001_INFO", "SENSITIVE")`（`SensitiveWordInit.java:109`）→ 再建一棵 `HashMap<Character,Map>` 字典树。

**每次命中敏感词检查的请求 = 1 次 DS Redis 往返 + 一次全量敏感词字典树重建**。且 `isContaintSensitiveWord` 是 **O(len²)** 最坏（`:54-65` 每个字符位置重跑一次 `CheckSensitiveWord`，且 `:61-62` 命中后 `flag = true` 但**不 break**，仍扫全串）。

#### P1-9 `DSUtils.callHession` 的 Java 原生序列化往返

```java
// utils/DSUtils.java:143 → :40-56
obj = revert(obj);
public static Object revert(Object obj) throws Exception {
  ByteArrayOutputStream bos = new ByteArrayOutputStream();
  ObjectOutputStream oos = new ObjectOutputStream(bos);   // 每次 new
  oos.writeObject(obj);
  ByteInputStream bis = new ByteInputStream(bos.toByteArray());
  ObjectInputStream ois = new ObjectInputStream(bis);       // 每次 new
  return ois.readObject();
}
```

**113 个 hession 调用点，每次返回都要一次完整的 Java 序列化 + 反序列化**（含类描述符解析）。应在 dataShare 侧改用 JSON/Hessian，或至少用 `ThreadLocal` 复用 ObjectStream。

#### P1-10 消费线程数无上限 + 背压是忙轮询

- `SubscribeThreadUtils.executorService = Executors.newCachedThreadPool()`（`service/subscribe/utils/SubscribeThreadUtils.java:8`）—— **无界**，每个订阅一个长驻线程
- `KrackleConsumer.java:162` 每线程 `new byte[1048576]`（**1MB 缓冲**），且 `:175` 在 while 循环内每轮再 new 一个 2048 字节 keyBytes
- 背压：`reviewQueue.size() > 20` 时 `Thread.sleep(0L, 300000)`（**0.3ms**）后 continue（`:179-182`）—— **忙轮询**而非条件变量

#### P1-11 队列统计 O(n) + Redis 内存单调泄漏

- `T00010039`：HGETALL 拉全量再**逐条 LLEN**（`:89-97`）⇒ N 个队列 = N+1 次 Redis 往返
- `T00010037` 每次 append 写 **3 个 hash + 1 个 list**（`:50-56`）
- `DS-QUEUE-ALL` 是**只增不减的全局注册表**，**无对应删除路径** ⇒ **Redis 内存单调泄漏**

#### P1-12 每 60 秒全量刷 offset 的 N+1 SQL

`HandleLastOffsetThread` 遍历**所有** offset bean 逐条 UPDATE（`:34-38`），60s 一轮（`:41`）；每条 update 又先 `getExistRecord()` 查一次再决定 UPDATE/INSERT（`MQTopicServiceImpl.java:164-141`）⇒ **N+1 SQL**。

---

### P2 级瓶颈

| # | 问题 | 证据 | 说明 |
|---|---|---|---|
| P2-1 | **日志在热路径无条件执行** | `ConnSocketCommandParse.java:41,70`；`ConnHessianCommandParse.java:46,65` | `log.info(new StringBuilder()...)`——**参数是已拼好的字符串**（非 log4j `{}` 占位符），**即使 INFO 关闭，字符串拼接开销照付**。对照 `DSStandardProtocol.java:56,59,66` 用 `DS_SERVER_DETAIL_LOG` 判定是正确做法 |
| P2-2 | **trade32 报文组装用 `String.format`** | `Trade32_f406Header.java:103,134,147`（f401/MultiLine 同） | 每报文 **3 次 `String.format("%1$5s",...)`**，走 Formatter 解析，代价约为手工 padding 的 20~50 倍 |
| P2-3 | **gomti 每请求 2 次 `Security.addProvider(new BouncyCastleProvider())`** | `server/socket/gomti/head/AESUtils.java:22-58`；`GomtiCommonProtocol.java:132-141` | `new BouncyCastleProvider()` 构造开销大（数百个静态初始化） |
| P2-4 | **midservice `Validate` 27 处 `.matches()`** | `utils/Validate.java` | `String.matches()` 内部 `Pattern.compile()`，**每次调用编译一次正则**。对照 `utils/xss/XssUtil.java:12-31` 正确做成了 `static final Pattern` |
| P2-5 | **敏感信息全量打进 INFO 日志** | `HandlerController.java:245,271` | 第二条把**解密后的完整业务参数**（账号、密码、身份证、资金账号）打进日志。每请求 2 条 |
| P2-6 | **审计 MQ 写同步阻塞在请求路径** | `HandlerController.java:886,944` | `publishInfo` 在 dataShare 侧是同步 Kafka `producer.send()`，**审计日志的 MQ 写延迟直接计入接口响应时间**。`1018_MONITOR_DATA` 是**无界 Redis List**（rpush 从不 ltrim） |
| P2-7 | **敏感词 / 脱敏用 `indexOf` 子串匹配** | `HandlerController.java:1790,1807` | 字段 `ID` 会误命中 `IDNO`/`USERID`；`NAME` 误命中 `NICKNAME` ⇒ **脱敏越权/漏脱敏**。`ToBackController.java:346` 的 `func_id` 匹配同问题 |
| P2-8 | **`DSUtils.callSocket` 二次序列化** | `utils/DSUtils.java:247,253` | `jo` 已是 JSONObject，又 `toString()` 再 `JSONUtils.toMap()`——一次多余的序列化+反序列化。22 个 callSocket 点全中 |
| P2-9 | **`OpenHandler` 请求路径上 `Thread.sleep`** | `handler/OpenHandler.java:404` | 开户接口在 Tomcat 工作线程上**主动 sleep** 等开户完成，**直接吃掉一个工作线程** |
| P2-10 | **`e.printStackTrace()` 在生产路径** | `HandlerController.java:429,884`；`DSUtils.java:139` | 直写 stderr，不受 log4j 配置控制 |
| P2-11 | **连接池 `maxCon` 一律 50 且各业务独立** | `common/ServiceConfig.java:21,35,49,80,103,115` | `ServiceConst.java:56-78` 有 20 个池字段 ⇒ 理论 1000+ 连接，每个池独立占用后端 T9/资金/存管系统的连接数。`initCon=1` 意味着**冷启动后首次请求要现场建连** |
| P2-12 | **`Thread.sleep(5000)` 轮询 / 无界 `LinkedBlockingDeque`** | `ServiceServlet.java:457`；`CallBackSubscribe.java:331` | 监控重连轮询；`w4back` 无界 |
| P2-13 | **`BeanFactory.clear()` 在热部署时清空单例缓存** | `utils/BeanFactory.java:12-40`；`HandlerController.java:1101` | 正在处理的请求可能拿到**新建的 handler 实例**（`@Autowired` 字段是新注入的），状态丢失。配合 `MonService.deploy_complete()` → `DeployThread` → `loadService()`（`MonService.java:403-414`）存在**请求语义不一致窗口** |
| P2-14 | **`LibreTranslateMain` 静态块硬编码 Linux 绝对路径** | `translate/LibreTranslateMain.java:78` | `/root/D03/1018/tokens.txt` 不存在 → 类初始化失败 → `ExceptionInInitializerError`；且 `translate()` 每次调 `System.out.println`（`:25-26`） |
| P2-15 | **无界线程池 × 2** | `ConnServerThreadUtils.java:11`；`SubscribeThreadUtils.java:8` | 均为 `Executors.newCachedThreadPool()`。`T0001fa03` 远程重载可反复触发 → 投进无界池 |
| P2-16 | **`RedisPool`（非分片）整个是死代码** | `redis/RedisPool.java` | 全库 grep `RedisPool.` 零命中 |
| P2-17 | **`ShardedReidsPool.getConnect()` 全局锁串行化借出** | `redis/ShardedReidsPool.java:58-66` | 所有 Redis 命令的**借出阶段**被一把全局 ReentrantLock 串行 |
| P2-18 | **三套 JSON 库混用** | `net.sf.json`（21 文件 38 处）、`fastjson`、`JSONUtils`（62 处） | `net.sf.json` 的 `fromObject` 走反射 Bean 装配，是**公认最慢的 JSON 路径**。`HandlerController` 单文件 11 处 `fromObject`，其中 `checkLoginType` 路径每请求 1 次（`:1607`） |
| P2-19 | **`DSUserCache` / `DSUser` 用 TreeMap** | `db/memory/DSUserCache.java:13`；`db/load/bean/DSUser.java:30-31` | 启动后只读，风险低；但 `getAllowUser()` 每次启动遍历 |
| P2-20 | **`MqOffsetConstant` 60s 全量刷 + `MQTopicServiceImpl.putTopcNameToRedis` 重复归还同一 jedis 两次** | `MQTopicServiceImpl.java:85` 与 finally 的 `:91` | **双重 close 风险** |

---

### 瓶颈汇总表

| 级别 | 瓶颈 | 位置 | 影响面 |
|---|---|---|---|
| **P0** | `SocketClientConnectManager` 类级锁 + 池创建竞态死锁 | `SocketClientConnectManager.java:28-63` | **全部后端调用串行化**；极端情况永久死锁 |
| **P0** | 池耗尽 → 关池 → 递归重试雪崩 | `ConnSocketCommandParse.java:150-154` | 全链路放大 |
| **P0** | midservice 3 处全局 `synchronized` | `DSUtils.java:35`、`SerialService.java:31`、`ServiceUtils.java:169` | **每请求** |
| **P0** | `LockUtils.lockMap` 竞态 + 泄漏 | `HandlerController.java:1735-1740` | 互斥失效 + 内存泄漏 |
| **P0** | 不用 dataShare 分布式锁 | midservice 全库 | 多实例一致性缺失 |
| **P1** | 6 个无锁 HashMap/TreeMap 承载并发路由 | `HessianServiceCache` / `HttpServiceCache` / `AESKeyCache` / `ProducerCache` / `SubscribeCache` / `HessianFactoryUtils` | 数据竞争，可能死循环/CME |
| **P1** | 每请求一次 JDBC（缓存未接线） | `PubConfigServiceImpl.java:54` | DB QPS |
| **P1** | 每 publish 一次 Redis + 潜在 JDBC | `MQTopicServiceImpl.java:27-48` | DB QPS |
| **P1** | 分布式锁四项缺陷 | `T00010040_LockBusinessService.java:87-101` | 正确性 + 性能 |
| **P1** | HTTP 客户端每请求 new + 不 close | `HttpClientUtils.java` ×5 | 连接泄漏 |
| **P1** | 热路径 per-request 分配（prototype/clone/StringBuilder） | `HandlerImpl`、`ServerProtocolCache`、`CommandParseUtils` | GC 压力 |
| **P1** | midservice 路由 O(n) 扫描（每请求 2 次 + 1745 条 KeyMapper） | `HandlerController.java:622,749`；`KeyMapper.java:113` | CPU |
| **P1** | 敏感词 Trie 每次重建 + O(len²) | `SensitivewordFilter.java:26-29,54-65` | DS 往返 + CPU |
| **P1** | `DSUtils.revert` 原生序列化往返 ×113 | `DSUtils.java:143` | CPU + 分配 |
| **P1** | 消费线程无界 + 1MB/线程 + 忙轮询背压 | `SubscribeThreadUtils.java:8`、`KrackleConsumer.java:162,175,179` | 资源耗尽 |
| **P1** | 队列统计 O(n) + `DS-QUEUE-ALL` 泄漏 | `T00010039:89-97`、`T00010037:50-56` | Redis 内存 |
| **P1** | 60s 全量刷 offset 的 N+1 SQL | `HandleLastOffsetThread.java:34-41` | DB |
| **P2** | 20 项（热路径日志、String.format、addProvider、正则重编译、脱敏 indexOf、审计 MQ 阻塞、无界连接池、BeanFactory.clear 等） | 见上表 | 综合 |

---

## 七、缺陷与安全风险清单

### 安全问题（严重度高于性能问题）

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| **S1** | **SQL 注入** | `db/load/impl/ProtocolLoadImpl.java:115,125,136` | `"RANDOM_ID='" + key + "'"`、`"SERVER_KEY LIKE '" + key + "%'"` 直接拼接，**无任何校验**。`key` 来自 `T0001fa03/T0001fa04` 请求体的 `PROTOCOL` 字段 ⇒ **外部输入直达 SQL 拼接** |
| **S2** | **Redis 密码明文回吐** | `T00010030_GetRedisService.java:27` | `reJson.put("USERNAME", SystemRedisConfig.AUTH)`——通过协议直接返回 Redis AUTH 密码 |
| **S3** | **解密后敏感参数打进 INFO 日志** | `HandlerController.java:245,271` | 完整业务参数（含密码、身份证、资金账号）落盘，每请求 2 条 |
| **S4** | **AES-CBC 用 Key 当 IV** | `HandlerController.java:321`、`:1232` | `aesKey.getBytes("UTF-8")` 同时作 Key 与 IV，不符合 CBC 语义 |
| **S5** | **出参脱敏 `indexOf` 子串匹配** | `HandlerController.java:1790,1807`；`ToBackController.java:346` | 误命中 + 漏脱敏 |
| **S6** | **SQL 关键字脱敏用 `contains`** | `HandlerController.java:1193` | 误判（文案含 "update" 被吞）+ 漏判（`INTO`/`DELETE`/`EXEC` 不在列表） |
| **S7** | **`ProtocolLoadImpl` 的 `getProcotolListByOne` 等无参数化** | 对比 `PubConfigServiceImpl.java:38-51` 的 `:PARAM` 写法 | 后者有白名单兜底，前者没有 |

> 注：`PubConfigServiceImpl` 的 `cfgType`/`sysId` 也有拼接，但有 `Pattern.compile("^[a-zA-Z0-9_,]+$")` 白名单（`:27`）兜底。

### 功能缺陷

| # | 问题 | 位置 |
|---|---|---|
| F1 | 退订命令号与订阅撞车：类名 `DS0001fa10Protocol` 暗示 `0001fa10`，但 `getSubLowProtocol()` 返回 `52`(0x34)，与订阅命令号完全相同，只能靠 body 区分 | SDK `DS0001fa10Protocol.java:31` vs `DS00010034Protocol.java:35` |
| F2 | `DSBean` 构造函数 Bug：`this.userPswd = "test@123"` 误写成 `this.userName`，`getUserPswd()` 永远返回 null | SDK `bean/DSBean.java:25-26` |
| F3 | `ShardedReidsPool.getIntValue` 硬编码读小写 `"key"`，与传入的大写字段名不匹配 | SDK `redis/ShardedReidsPool.java:56` |
| F4 | `hset` 硬编码 TTL = 10800 秒 | SDK `redis/RedisTools.java:317` |
| F5 | ansyKey 三次归还（try/catch/finally），靠 `LinkedBlockingQueue.offer` 幂等兜住 | SDK `thread/HandleAnsyRequestThread.java:52,57,64` |
| F6 | `removeKeys` 中 `System.out.println(infoKeys.length)` | SDK `redis/RedisTools.java:267` |
| F7 | `InterfaceBean.java:18` 的 `if (Modifier.isInterface(modifiers));` 是**空语句**，接口性检查形同虚设 | `server/asm/bean/InterfaceBean.java:18` |
| F8 | `CommandParseUtils.getSringCommand` 是 `getCommand` 的非静态重复实现，方法名拼写错误，**无调用者** | `service/nio/core/CommandParseUtils.java:19-29` |
| F9 | `MQTopicServiceImpl.putTopcNameToRedis` 重复归还同一 jedis 两次 | `db/update/impl/MQTopicServiceImpl.java:85,91` |
| F10 | `RedisPool`（非分片）整个死代码 | `redis/RedisPool.java` |
| F11 | `T0001fa01`（Suspended）与 `T0001fa02`（Recovery）代码逐行相同，**都不实现挂起/恢复** | `service/nio/impl/control/` |
| F12 | `T0001fa03` 的 connType 3/4 分支空实现 → **HTTP / WebService 类型无法通过 reload 生效** | `T0001fa03_ReloadProtocoldService.java:69-70` |
| F13 | 协议号防伪开关失效：`if/else if` 写反，开关为 Y 和不为 Y 走**完全相同**的逻辑 | `HandlerController.java:501-522` |
| F14 | 攻击检测是死代码：`MtradeInterceptor.preHandle` 直接 `return true`，`checkAttack()` 无调用方 | `MtradeInterceptor.java:42` |
| F15 | `ServiceConfig.Security.Api.WhiteApi.apis` 是**死配置** —— `whiteApis` 字段只写不读 | `HandlerController.java:1112` |
| F16 | `@HandlerRule` 注解**运行时不参与路由** —— 真正的绑定在外部 `api.json`（不在源码树）。形成**双重事实源** | `HandlerController.java:2137-2193` |

---

## 八、改造建议与优先级

### 立即（不改架构，直接提 QPS）

| # | 动作 | 位置 | 预期收益 |
|---|---|---|---|
| 1 | 去掉 3 处 `static synchronized`：`getClient()` → `volatile`；`_genSerialLocal` → `ThreadLocal`+`AtomicLong`；`getTokenId` → 去锁 | `DSUtils.java:35`、`SerialService.java:31`、`ServiceUtils.java:169` | 消除每请求的 monitor 争用 |
| 2 | `SocketClientConnectManager` 去掉类级 `static synchronized`，改为**按 clientFlag 分段锁**；`Thread.sleep(1)` 自旋换 `synchronized`/`CountDownLatch`；初始化改 `putIfAbsent` | `SocketClientConnectManager.java:28-63` | **消除全局串行点 + 消除死锁窗口** |
| 3 | `LockUtils.lockMap` 改 `ConcurrentHashMap.computeIfAbsent`，并加 Caffeine 过期清理 | `HandlerController.java:1735-1740` | 消除互斥失效 + 内存泄漏 |
| 4 | 6 个无锁 Map 改 `ConcurrentHashMap`（`SubscribeCache` 改 `ConcurrentSkipListMap` 或同步包装） | 见 P1-1 | 消除数据竞争 |
| 5 | `handlerRouters` / `apiConfig` / `KeyMapper` 三处线性扫描改 HashMap 双向索引 | `HandlerController.java:622,749,798`；`KeyMapper.java:113` | 消除每请求 O(n)/O(1745) |
| 6 | `Validate` 27 处 `.matches()` 改 `static final Pattern` | `utils/Validate.java` | 消除重复编译 |
| 7 | `SensitivewordFilter.getInstance()` 改真单例 + 定时刷新；命中即 break | `SensitivewordFilter.java:26-29,54-65` | 消除每请求 Trie 重建 |
| 8 | 删/降级 `HandlerController.java:245,271` 两条 INFO 日志 | 同上 | 安全 + IO |
| 9 | `HttpClientUtils` 改单例 `CloseableHttpClient` + 连接池复用 | `HttpClientUtils.java` ×5 | 消除连接泄漏 |

### 短期

| # | 动作 | 位置 |
|---|---|---|
| 10 | **接线 `PubConfigCache`**（5s TTL 已就绪），`T00010101` 改读缓存 | `param/cache/PubConfigCache.java` |
| 11 | `getTopicName` 加进程内 `ConcurrentHashMap` 本地缓存（Redis/DB 之上） | `MQTopicServiceImpl.java:27-48` |
| 12 | 分布式锁改 `SET key token NX EX ttl` 原子命令；value 存 UUID；unlock 用 Lua 校验 token 后删除 | `T00010040/41/42/43` |
| 13 | `CxgpHandler.get2007_X` 加本地缓存（支撑 36 个 GP9xxx 公开协议） | `CxgpHandler.java:102` |
| 14 | `checkLoginType` 的 LOGINTYPE 结果随 Token 缓存（Token 已有 `EXTRA_DATA` 机制） | `HandlerController.java:1605` |
| 15 | `doAuthRtn` / `func_id` 的 `indexOf` 改 `Set.contains` | `HandlerController.java:1790`；`ToBackController.java:346` |
| 16 | `DSUtils.callSocket` 去掉 `jo.toString()` → `JSONUtils.toMap` 二次序列化 | `DSUtils.java:247,253` |
| 17 | `DSUtils.revert` 改 `ThreadLocal` 复用 ObjectStream，或在 dataShare 侧改 JSON/Hessian | `DSUtils.java:143` |
| 18 | `1018_MONITOR_DATA` 加 `ltrim`；审计 MQ 发送移到独立线程池 | `HandlerController.java:886,944` |
| 19 | `OpenHandler` 的 `Thread.sleep` 改异步轮询 | `OpenHandler.java:404` |
| 20 | `ProtocolLoadImpl` 的 SQL 改命名参数；`T00010030` 停止回吐 Redis 密码 | `ProtocolLoadImpl.java:115,125,136`；`T00010030:27` |
| 21 | 消费线程池改有界；`KrackleConsumer` 的 1MB buffer 提到循环外 | `SubscribeThreadUtils.java:8`；`KrackleConsumer.java:162,175` |
| 22 | 敏感词、静态数据加采样/截断；`T0001fc02` 加管理端鉴权 | `T0001fc02_setDetailStatusService.java:38` |

### 中期（架构）

| # | 动作 |
|---|---|
| 23 | **引入 dataShare 分布式锁（`T00010040`）替换本地 `ReentrantLock`**，解决多实例一致性 |
| 24 | 抽取 `AbstractApiGateway` 模板 + `GatewayFilter` 责任链，消除 `HandlerController`(2581行) 与 `ToBackController`(1526行) 的 4107 行双份实现 |
| 25 | 统一 JSON 库，废弃 `net.sf.json` |
| 26 | 消除 `plzg`/`PLZBzg`/`xht`/`xhtV5` 四套复制粘贴（`DSCommon` 中 `PLZG_*`/`PLZGZB_*`/`XHV5_*`/`H_IFACE_*` 四套 11 个常量一一对应，仅协议号第 2 字节不同） |
| 27 | 协议配置热更新：`api.json` 接到配置中心（Apollo/Nacos），避免 `BeanFactory.clear()` 导致的热部署状态不一致 |
| 28 | 明确 `@HandlerRule` 与 `api.json` 的**单一事实源**（建议以注解为源，启动时生成 `api.json`） |
| 29 | 消息可靠性：补 ack/重试/DLQ，offset 改为**推送确认后**再记录，明确至少一次语义 + 业务幂等契约 |
| 30 | 补齐真正的服务治理：健康检查、熔断器、限流、`isSuccessRun` 标记接入流量决策 |

---

## 九、架构评价

### 值得肯定的设计

| # | 亮点 | 说明 |
|---|---|---|
| 1 | **两级命令号寻址 + 统一能力面** | 4 字节命令号同时表达"协议"和"服务"，调用方零感知后端形态 |
| 2 | **ASM 动态接口 + Hessian 代理** | 后端新增接口无需 dataShare 改一行代码，运行时协商元数据，现场生成类型 —— **真正的"分布式服务"能力内核** |
| 3 | **双序列化栈** | JSON 保可读性、Hessian 保类型与性能，业务可按场景选 |
| 4 | **推流与响应自动分流** | `readMainHeader` 识别 `0x08` 后分流到异步队列，同步调用永不受推送干扰（SDK 侧） |
| 5 | **订阅两级自愈** | 10s 静默超时检测 + 队列化重连 + 参数幂等保存（SDK 侧） |
| 6 | **控制面 / 数据面分离** | Redis 地址密码由网关下发，数据流可走客户端直连 |
| 7 | **MQ 回环实现同步 RPC** | 用 Kafka + 回调队列替代同步阻塞，天然解耦、可重试（虽然延迟更高） |
| 8 | **批量锁排序防死锁** | `Collections.sort(keyList)` 标准做法 |
| 9 | **运行时协议热重载** | `0001fa03/0001fa04` 免重启扩缩容/改路由 |
| 10 | **多市场适配的协议常量体系** | `DSCommon` 的 `PLZG_*`/`PLZGZB_*`/`XHV5_*`/`H_IFACE_*` 一一对应，扩展新市场成本低 |

### 架构层面的核心问题

| # | 问题 | 本质 |
|---|---|---|
| 1 | **"分布式服务"名不副实** | 没有服务注册、没有健康检查、没有熔断限流、没有负载均衡。dataShare 是 **ESB 协议转接器**，不是微服务治理组件。`isSuccessRun/errMsg` 标记已存在却**不参与任何流量决策** |
| 2 | **控制面未与数据面分离** | 协议路由表、配置、topic 名在**请求路径上**从 DB/Redis 取（`T00010101` 每请求一次 JDBC、`getTopicName` 每次 Redis+可能 JDBC）。控制面本该是启动期快照 + 变更推送 |
| 3 | **完全同步的调用链** | midservice 端到端 8 次串行 DS 往返，dataShare 端出向调用全部阻塞。**系统没有任何一处把等待转成并发**——`PerferenceEnum.HIGN_PERFORMANCE` 暗示 NIO 层有并发模型，但业务层是纯串行 |
| 4 | **共享中间件代理成了单点** | 15 处 DS Redis 读、2 处 MQ 写都在请求路径上。缓存网关本身成了**额外一跳 + 额外故障域** |
| 5 | **并发原语使用不一致** | 同一个代码库里 ConcurrentHashMap（4 处）与裸 HashMap（7 处）并存，`static synchronized`（2 处）与 `ReentrantLock`（2 处）并存 —— **说明这些缺陷是无意识引入的，而非设计权衡** |
| 6 | **配置双事实源** | `@HandlerRule` 注解（1332 处，1296 协议）声明了一套绑定，外部 `api.json` 又定义了一套。运行时不读注解 ⇒ **文档、代码、运行态三者可能不一致** |
| 7 | **能力集存在大量"外壳"** | `T0001fa01/02`（挂起/恢复）未实现、`connType 4/5` 是死代码、`RedisPool` 死代码、`@HandlerRule` 死代码、`WhiteApi` 死配置、`MtradeInterceptor.checkAttack()` 死代码。**表面能力远大于实际能力** |
| 8 | **midservice 未使用 dataShare 已有的分布式锁** | 平台自建了分布式锁能力，核心网关却用进程内锁 —— **最可惜的一处架构不一致** |

### 一句话总结

> dataShare 把 **"40+ 异构后端的统一寻址"** 这件事做得很扎实（两级命令号 + ASM 动态接口 + 5 套协议栈），是整条链路上**工程完成度最高**的一环；
>
> 但它的**运行时性能治理**几乎为零：控制面没和数据面分离（每请求查 DB/Redis）、没有并发原语的统一纪律（全局锁 + 裸 HashMap + 无界线程池）、没有服务治理闭环（无注册/健康/熔断/限流）；
>
> 而 midservice 作为消费方，**每请求 8 次串行往返 + 3 处全局锁 + 4 处 O(n) 扫描**，把 dataShare 的每一次能力调用都放进了同步阻塞的关键路径。
>
> **瓶颈不在任何单个类的实现，而在"控制面未分离 + 全同步 + 无并发纪律"这三个系统性问题上。** 优先级最高的改造是：`SocketClientConnectManager` 全局锁（消除串行点）、`PubConfigCache` 接线（消除每请求 JDBC）、midservice 三处 `synchronized`（消除每请求争用）、以及路由改 HashMap 索引（消除 O(n)）—— 这四项不改变任何架构，即可显著提升吞吐。

---

*本文档基于反编译源码（JD-Core 0.6.0）静态分析，未包含运行时性能数据。所有 file:line 引用均可回溯核对。*
