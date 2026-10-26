# ToBackController 后台网关详解与 HandlerController 对比

> **工程**：`midservice-1.1.188.228.5`（证券/金融行业中台，模块号 1018_S）
> **类全名**：`com.ylsoft.mid.service.controller.ToBackController`
> **源码**：`com/ylsoft/mid/service/controller/ToBackController.java`（1526 行，反编译自 `midservice-1.1.188.228.5.jar`，JD-Core 0.6.0）
> **定位**：后台运营管理网关 —— 与 `HandlerController` 共享同一套协议路由框架，但权限模型与管控深度完全不同
> **配套文档**：[`HandlerController-网关功能详解.md`](./HandlerController-网关功能详解.md)

---

## 目录

- [一、一句话定位](#一一句话定位)
- [二、请求链路](#二请求链路)
- [三、核心：菜单功能码权限模型](#三核心菜单功能码权限模型)
- [四、ToBack 保留的能力](#四toback-保留的能力)
- [五、ToBack 主动砍掉的能力](#五toback-主动砍掉的能力)
- [六、逐项差异对照表](#六逐项差异对照表)
- [七、共用能力实现差异](#七共用能力实现差异)
- [八、差异背后的设计取舍](#八差异背后的设计取舍)
- [九、面试话术](#九面试话术)
- [十、风险与改进点](#十风险与改进点)
- [附录 A：类结构对照](#附录-a类结构对照)
- [附录 B：两份文档的阅读顺序建议](#附录-b两份文档的阅读顺序建议)

---

## 一、一句话定位

它是**后台运营管理网关**——券商/基金运营人员、柜面、客服使用的内部系统的统一入口。

**与前台网关的本质差异**：

> **前台（`/api`）按「协议级 + 用户类型」授权，因为终端是海量 C 端用户，必须轻量、零学习成本；后台（`/toBack`）按「菜单功能码」授权，因为操作者是少量内部人员，需要的是「能点哪个页面就能调哪个接口」的直观映射。**

同一条协议在两侧都存在，但走完全不同的准入检查。

---

## 二、请求链路

### 2.1 入口（与前台完全对称）

| 入口 | 方法 | 说明 |
|---|---|---|
| `/toBack/**` | `handle()` | 后台主入口 |
| `/toBack_upload/**` | `handle_upload()` | 文件上传入口 |
| `/toBack/encrypt/publicKey` | `encrypt_publicKey()` | 隐含路径，返回 RSA 公钥 `{modulus, publicExponent}` |

```java
req.setAttribute("$MULTIPARTFILE", file);
req.setAttribute("$API_PREFIX", "/toBack_upload");
handle(req, resp);
```

### 2.2 完整流程

```
restfull 解析
   ↓
handlerRouters == null → "API未初始化"
   ↓
解密分支（按 encrypt_key 是否存在判断，而非全局开关）— §2.3
   ↓
func_id 必填校验 ★ 后台独有
   ↓
directives / params 解析（单协议模式 api 恒为 null）★ 与前台不同
   ↓
AppKey 验签（accessKey + signature，USERFLAG=3 换 Token）
   ↓
Token 解析：ServiceUtils.getToken(tokenId)  ← 注意：不带 api 参数
   ↓
★ 菜单功能码权限校验（AUTHS.MENU[].AUTHCODE 包含 func_id）
   ↓
风控 RiskProcessor.process
   ↓
execute()  ← 仅做：别名映射 → 路由查找 → 批量上限 → apiConfig → 反射 → Greencard
   ↓
respondJson（按 aesKey 加密）/ Cookie
```

### 2.3 解密分支的判断顺序（与前台相反）

| | `HandlerController`（前台） | `ToBackController`（后台） |
|---|---|---|
| 判断顺序 | **先**看全局 `RequestEncrypt.enable`，**再**看 `encrypt_key` | **先**看 `encrypt_key` 是否为空，**再**看 `enable` |
| 明文模式约束 | 必须用 `directives` 批量格式，且每条 api 必须在 `rsaAllowMap` 白名单，否则 `"no auth"` | **无白名单约束**，直接放行所有明文请求 |
| AES Key 处理 | `revertString()` | `revertString()` + **`AESUtils.fixPassword16()` 补齐 16 位** |
| `+` 号还原 | `encrypt_data.replaceAll(" ", "+")` | 无（后台不经网关 URL 编码） |
| JSON 解析 | `JSONUtils.toMap` | `HttpUtils.parse(str, "UTF-8")` |

> **语义差异**：前台是「**默认强制加密**」，个别接口显式豁免（且要登记白名单）；后台是「**默认明文**」，客户端想要加密就自己带 `encrypt_key`。后台部署在内网、终端是自家运营系统，默认强加密会带来不必要的接入成本。
>
> `fixPassword16` 是补齐 AES-128 密钥长度——后台前端传的密钥长度不可控，服务端做归一化，属防御性编程。

---

## 三、核心：菜单功能码权限模型

这是后台网关与前台网关**最本质的区别**。

### 3.1 `func_id` 强制必填

```java
String func_id = (String)req_params.get("func_id");
if (StringUtils.isEmpty(func_id))
    throw new HandlerException("func_id参数不能为空");
```

前台是 `api` 必填，后台是 **`func_id` 必填**。

### 3.2 校验逻辑

```java
if (token.getAUTHS().isEmpty())
    throw new HandlerException("访问权限为空");

JSONObject authJson = JSONObject.fromObject(token.getAUTHS());
JSONArray menuArray = authJson.getJSONArray("MENU");

StringBuffer authCode = new StringBuffer();
for (Iterator it = menuArray.iterator(); it.hasNext(); ) {
    Object menu = it.next();
    JSONObject menuJson = JSONObject.fromObject(menu);
    authCode.append(menuJson.getString("AUTHCODE")).append(",");   // 拼接所有菜单功能码
}

if (authCode.toString().indexOf(func_id) <= -1)
    throw new HandlerException("没有访问功能码：" + func_id + "的权限");
```

### 3.3 数据结构

```
Token.AUTHS (Map)
   └── MENU (JSONArray)
          ├── { AUTHCODE: "FUND001", MENU_NAME: "资金账户", ... }
          ├── { AUTHCODE: "TRADE002", MENU_NAME: "交易下单", ... }
          └── { AUTHCODE: "USER003", MENU_NAME: "客户管理", ... }
```

登录时把该用户**所有可见菜单的功能码**装进 Token。后台每次调接口，**只要带上了 `func_id`，且这个 `func_id` 在其菜单功能码里，就放行**。

### 3.4 为什么这样设计

| 维度 | 说明 |
|---|---|
| **对齐直觉** | 运营人员看到的是「菜单/页面」，前端组件天然知道自己的 `func_id`，不需要额外维护"我调的这个协议属于哪个权限点" |
| **免维护** | 新增协议时，只要把它挂到某个已有菜单下，权限自动生效，不需要额外做协议授权配置 |
| **前端零成本** | 拦截器统一注入 `func_id`，不用为每个接口单独标注权限点 |
| **可审计** | 每个后台操作都能对应到一个具体菜单功能码，审计日志天然可追溯 |

### 3.5 与前台授权模型的对比

| | 前台 `HandlerController` | 后台 `ToBackController` |
|---|---|---|
| 授权维度 | **协议级**（`api` 号） | **菜单功能码级**（`func_id`） |
| 授权依据 | Redis `3002_API_AUTH_LIST`（`USERFLAG=3` 第三方用户） | `Token.AUTHS.MENU[].AUTHCODE` |
| 用户类型区分 | 按协议前缀：`DF_`=管理员、`SF_`=外部机构 | 不区分，**所有后台用户同一套模型** |
| 必填参数 | `api` | `func_id` |
| 免检白名单 | `ServiceConst.noAuthApis` | 无（`func_id` 必填即天然收口） |
| 越权提示 | `未授权访问,no power：xxx` | `没有访问功能码：xxx 的权限` |

---

## 四、ToBack 保留的能力

虽然是"精简版"，但核心骨架完整保留：

| 能力 | 实现 |
|---|---|
| **RSA + AES 混合加密** | RSA 解 `encrypt_key` → `fixPassword16` → AES/CBC/PKCS5 解 `encrypt_data`；响应同 Key 加密 |
| **RSA 公钥下发** | `/toBack/encrypt/publicKey` |
| **RESTful 路由** | api 为空时按 `API_RESTFULL` 反查 `API_PROTOCOL`；路径不识别报 `路径无法识别` |
| **协议号后缀** | `api.split("-")` 取第 2 段作为实际协议号（子协议/版本变体） |
| **AppKey 开放通道** | `accessKey` + `signature` → `AppKeyUtils.verifySignature` → DS `{0,2,0,7}` 换 Token（`USERFLAG=3`）并缓存 |
| **Token 自动巡检** | `autocheck_enable` + `autocheck_interval` → `PurviewAuth.tokenCheck`；失效则 `logout_clear`（清 Cookie + `removeToken` + DS 注销 + `publish("{sysId}_logout")` 广播） |
| **风控** | `RiskProcessor.process(req, resp, directives, keyMapping, keyMapper, token)` |
| **单账号互斥** | `Login.singleAccount_enable` + Redis `getConflictRedisKey(tokenId)`，冲突提示 `账号已在其它地方登陆.时间:xx.IP:xx` |
| **别名映射** | `keyMapping`（全局开关 + 请求级 `keyMapping` 参数）+ `keyMapper.mapAliasObject(cmd, true)` |
| **批量协议** | `directives` 数组 + `maxMultiApiCount` 上限（`超过最大执行量`） |
| **渠道差异化** | `reffer` 段 `apiConfig` 优先，回落 `default` 段；`params` 可覆盖校验规则与文案 |
| **幂等卡** | `Greencard`：成功销毁；失败 `count > 4` 废弃，否则 `save` 并回传 `greencard.id` |
| **反射调用** | `HandlerRouter` 预解析 + `MCallable` 按签名注入 + 参数校验 |
| **参数校验** | `valide()` / `valideArray()`：必填、长度、正则、默认值、类型转换；`[隐私]` 参数日志脱敏 |
| **`LIST_X_Y` 批量参数** | 形参名解析外层数组 key + 元素字段，逐条转换校验 |
| **文件转字符串参数** | `$params.put("file", IOUtils.getString(file.getInputStream()))` ★ 后台特有 |
| **统一响应** | `done(api,msg,data)` → `{result, api, msg, data, timestamp}`；响应塞 `seqno` |
| **序列化注入** | `ClassUtils.setStaticField(Validate.Regex.class, name, regex)` 加载自定义正则 |
| **执行器单例** | `BeanFactory.require(clazz)` + `initRouter()` 前 `BeanFactory.clear()` |
| **ThreadLocal logKey** | `KEY_LOGPRE`，`put`/`clear` 配对 |
| **`$RESPONSE_OUTPUTED`** | 允许执行器自己接管响应（文件下载等） |

---

## 五、ToBack 主动砍掉的能力

共砍掉 **17 项**，全部有明确业务理由。

| # | 砍掉的能力 | 业务理由 |
|---|---|---|
| 1 | **系统升级全局熔断**（SysPara `40310`/`40311`） | 后台发版时运营人员照常工作，不应阻断 |
| 2 | **`Validate.isSafe()` 注入防护** | 后台是受信任的内网运营系统，非开放互联网入口 |
| 3 | **公私钥签名校验**（`security.auth.isopen`） | 前台用于证明"请求来自持证 App 客户端"，后台无需 |
| 4 | **明文白名单 `rsaAllowMap`** | 默认明文，无需白名单豁免 |
| 5 | **防重放**（`security.cross`：`signdata` + `curtime` + 时间窗） | 后台会话是长连接型操作，多为表单提交，误伤风险高 |
| 6 | **协议号 MD5 防伪**（`api.md5`） | 协议号由后台前端路由表决定，不需对抗枚举 |
| 7 | **敏感词过滤**（`SensitivewordFilter`） | 后台数据不是对外发布内容，无合规要求 |
| 8 | **协议升级映射**（`MC*`→`XHV5*`） | 后台不涉及 C 端版本适配 |
| 9 | **`checkLoginType` 登录强度分级**（含契约锁/上上签/平台认证四套体系） | 后台是员工账号，登录强度由统一认证中心保证，不在业务协议层重复校验 |
| 10 | **`checkAllowThird`**（`onlyThirdApiMap`） | 后台无第三方接入场景 |
| 11 | **`checkUserType`**（`DF_` 前缀） | 后台用户类型统一 |
| 12 | **第三方合作机构模式**（`is.third.mode` + `AuthUtils.validThirdApiAuth` + 参数加解密 + 返回加密） | 后台无合作机构通道 |
| 13 | **`checkAgree` 协议签订** | C 端合规要求，与后台无关 |
| 14 | **`checkValidDate` 会员有效期** | C 端会员概念，与后台无关 |
| 15 | **`checkDaPing` 大屏白名单** | 大屏是 C 端展示场景 |
| 16 | **`checkFundPwdV2` 资金密码 / `checkFundSign` 资金签名** | C 端资金安全设计，后台员工不走资金密码 |
| 17 | **`handleLang` 多语言**（`language` Header → `LANG`/`COMPID`） | 后台是单一语言（简体中文） |
| 18 | **`checkPowers` 机构代客权限**（`SF_` 前缀 + `1001_AGENTFIRM_USERID`） | 后台有完整菜单权限，不需代客代理模型 |
| 19 | **`checkStatus` 客户状态挂起**（`1001_GATEWAY_API`） | C 端客户挂起机制，与后台无关 |
| 20 | **`checkApiAuth` 协议级授权**（`3002_API_AUTH_LIST`） | 已被 `func_id` 菜单权限覆盖，避免双重授权 |
| 21 | **`APISTYLE=inner` 协议隔离** | `HandlerRouter` 里根本没有 `APISTYLE` 字段 |
| 22 | **三级缓存**（`ApiCacheMap` PUB/FRM/CLI） | 后台流量小，缓存收益低、失效一致性风险高 |
| 23 | **用户维度同步锁**（`ReentrantLock`） | 后台并发低，且管理操作本身应串行排队 |
| 24 | **出参脱敏**（`doAuthRtn` / `authRtnMap` / `encodeMap`） | 后台返回的就是管理所需的完整数据，脱敏会影响业务 |
| 25 | **入参监控日志流**（`loggerMonitor`） | 无监控 API 埋点需求 |
| 26 | **慢接口告警**（`loggerTime`） | 只有 1 个 Logger |
| 27 | **监控数据上报**（`1018_MONITOR_DATA`） | 后台无实时监控需求 |
| 28 | **安全审计日志**（`1018_APP_LOG`） | `HandlerRouter` 无 `API_NAME` 字段，无法组装审计主题 |
| 29 | **错误信息脱敏**（SQL 关键字、连接池降噪、`develop.error_append` 开关） | 见下节，是**明显的治理缺口** |

> 实际砍掉 **29 项**。核心规律：**砍掉的全部是「C 端合规 + 互联网攻击面对策」，保留的全部是「内网基础可用性能力」**。

---

## 六、逐项差异对照表

### 6.1 请求入口阶段

| 项 | `HandlerController` | `ToBackController` |
|---|---|---|
| 主路径 | `/api/**` | `/toBack/**` |
| 上传路径 | `/api_upload/**` | `/toBack_upload/**` |
| 公钥路径 | `/api/encrypt/publicKey` | `/toBack/encrypt/publicKey` |
| `singleRtn` 初值 | `false`（仅 params 分支置 `true`） | `true`（仅 directives 分支置 `false`） |
| 升级熔断 | 有（`SysPara 40310/40311`） | **无** |
| 注入防护 | `Validate.isSafe(params/directives)` | **无** |
| 公私钥验签 | 有（`security.auth.isopen`） | **无** |
| 明文白名单 | `rsaAllowMap` 强制 | **无** |
| `func_id` 校验 | — | **强制非空** |

### 6.2 参数封装阶段

| 项 | `HandlerController` | `ToBackController` |
|---|---|---|
| 单协议 `directives` 结构 | `{api: params.api, params: params.params, restfull}` | **`{api: null, params: params, restfull}`** |
| 含义 | api 由前端显式指定，params 剥离外层 | **api 恒为 null，完全依赖 restfull 路由；params 整体透传** |
| `execute()` 入参 | 多一个 `Map req_params` | 无（拿不到顶层参数如 `thirdorgid`） |
| `getToken()` 调用 | `getToken(tokenId, api)` | `getToken(tokenId)` |

> **这是后台路由设计的精髓**：后台前端是 SPA，URL 就是语义（`/toBack/user/edit`），`params` 里不再包一层 `api`，一个 RESTful 路径直接映射一个协议号。

### 6.3 授权阶段

| 项 | `HandlerController` | `ToBackController` |
|---|---|---|
| 核心校验 | `checkApiAuth` → Redis `3002_API_AUTH_LIST` | **`func_id` vs `Token.AUTHS.MENU[].AUTHCODE`** |
| 白名单 | `ServiceConst.noAuthApis` | 无 |
| 用户类型 | `USERFLAG` 1=个人/管理员、2=机构、3=第三方 | 不区分 |
| 协议前缀语义 | `DF_`=管理员、`SF_`=机构 | 无 |
| 越权提示 | `未授权访问,no power：xxx` | `没有访问功能码：xxx 的权限` |

### 6.4 执行阶段

| 项 | `HandlerController` | `ToBackController` |
|---|---|---|
| 防重放 | 有（`security.cross`） | **无** |
| 协议号 MD5 | 有（`api.md5`） | **无** |
| 敏感词 | 有（`sensitiveMap` + `SensitivewordFilter`） | **无** |
| API 转大写 | `convertApi()`（含 `MC*`→`XHV5*`） | 仅 `api.toUpperCase()` |
| 登录级别校验 | `checkLoginType`（四套体系） | **无** |
| 第三方模式 | `thirdApiMap` + `AuthUtils` | **无** |
| 协议签订 | `checkAgree` | **无** |
| 会员有效期 | `checkValidDate` | **无** |
| 大屏白名单 | `checkDaPing` | **无** |
| 资金密码/签名 | `checkFundPwdV2` / `checkFundSign` | **无** |
| 多语言 | `handleLang` | **无** |
| 机构代客权限 | `checkPowers`（`1001_AGENTFIRM_USERID`） | **无** |
| 客户挂起 | `checkStatus`（`1001_GATEWAY_API`） | **无** |
| 协议级授权 | `checkApiAuth` | **无**（`func_id` 覆盖） |
| `MODU_ID=1036` 注入 `optip` | 有 | **无** |
| APISTYLE 隔离 | 有 | **无**（无该字段） |
| 批量上限 | `maxMultiApiCount` | **有** |
| apiConfig 渠道差异化 | 有 | **有** |
| 缓存 | 三级（PUB/FRM/CLI） | **无** |
| 同步锁 | `lockApi`/`unLockApi` | **无** |
| 出参脱敏 | `doAuthRtn` | **无** |

### 6.5 响应与可观测阶段

| 项 | `HandlerController` | `ToBackController` |
|---|---|---|
| Logger 数量 | 3 个（`logger` / `loggerTime` / `loggerMonitor`） | **1 个**（`logger`） |
| 出入参 DEBUG 日志 | 有（`[API][MIDREQ]` / `[API][MIDRES]`） | 仅有入参，**无出参日志** |
| `LogUtils.isMonitorApi` | 有 | **无** |
| 监控上报 `1018_MONITOR_DATA` | 有 | **无** |
| 安全审计 `1018_APP_LOG` | 有（7 个埋点） | **无** |
| 慢接口告警（>1s） | 有 | **无** |
| JSONP 触发条件 | `allowJsonp \|\| creditToken 非空` | **仅 `allowJsonp`** |
| CORS 响应头 | `Access-Control-Allow-Origin: *` + `Allow-Credentials: true` | **无** |
| Cookie 名 | 按 Header `OOO_SSO_TOKEN`/`Ooo-Org-Token`/`TOKEN` 三选一 | **仅 `TOKEN`** |
| Cookie 实现 | 自定义 `NewCookie`（支持 `SameSite=None` + 自动 `Secure`） | **原生 `javax.servlet.http.Cookie`** |
| 新旧 Cookie 切换 | 有（`addCookie`/`addCookieOld` + `devMode.enable`） | **无** |
| 跨域 Cookie 场景 | 需要（多端域名 + 第三方前端） | 不需要（后台单体部署同域） |

### 6.6 `HandlerRouter` 构造差异

| 项 | `HandlerController` | `ToBackController` |
|---|---|---|
| 字段赋值方式 | 逐字段 `if (apiInfo.get("X") != null) this.X = ...` | **`BeanUtils.setBean(this, apiInfo)` 批量注入** |
| `HandlerRouterParam` 赋值 | 显式 `if` 判断 | **`BeanUtils.setBean(this, param)`** |
| `APISTYLE` 字段 | 有 | **无** |
| `API_NAME` 字段 | 有（审计日志用） | **无** |
| `API_HANDLETYPE=B/D` | 相同逻辑 | 相同逻辑 |
| `[隐私]` 参数识别 | 有（`PARAM_MEMO` 含 `[隐私]`） | **有**（逻辑一致） |

> `BeanUtils.setBean` 更简洁，新增字段自动映射；但代价是**没有 getter 的字段不会被加载**（如 `APISTYLE`、`API_NAME`），这正是两者行为差异的根源。

### 6.7 `MCallable` 差异

| 项 | `HandlerController` | `ToBackController` |
|---|---|---|
| 登录超时提示 | `您的登录已超时，请重新登录` | **`登录凭证已失效，请重新登录[tokenId]`**（`error_detail` 时带 tokenId 便于排查） |
| `MultipartFile` 注入 | `o = this.file` | `o = this.file` + **`$params.put("file", IOUtils.getString(file.getInputStream()))`** |
| 类型转换失败提示 | `{comment}格式错误` | **`error_detail=Y` 时输出 `:{paramName}[值]无法转换为{类型全名}`** |
| 日志格式 | `logKey + [API][ver]` | **`logKey + [API][ver][tokenId][ip:port] + params`** |
| `zd_version` 冲突检查 | 有 | **有**（相同） |

---

## 七、共用能力实现差异

### 7.1 `ApiContext.logKey` 组成

**前台**（5 段 + token 明细）：
```
[api][version][serialNo][ip][port][tokenId/userId/phone]
```

**后台**（4 段，**不含 ip/port**）：
```
[api][version][serialNo][userId/phone]
```

后台把 `ip:port` 放到了 `MCallable` 的 DEBUG 日志里，而不是 `logKey`：
```java
logger.debug(apiContext.getLogKey()
    + "[API][" + version + "][" + tokenId + "]"
    + "[" + requesterIp + ":" + requesterPort + "]" + JSONUtils.toString(log_params));
```

> **取舍**：后台不需要按 IP 做日志检索（内网 IP 单一），把 IP 放到 DEBUG 明细里更省字符串拼接；且 logKey 短一点点在高频日志下有微小收益。

### 7.2 错误信息治理（后台的明显缺口）

**前台 `undone()`**（层层开关）：
```java
if (msg.contains("insert") || msg.contains("update") || msg.contains("select"))
    msg = "数据库异常";                                   // ① SQL 脱敏

if (error.isHide=Y && (msg.contains("could not get jdbc") || msg.contains("无法获取连接") || msg.contains("服务器异常"))) {
    msg = "系统异常，可忽略"; result = RST_GB9999;        // ② 连接池降噪
}

if (develop.error_append=Y)                              // ③ 开关控制
    msg = "[1018-" + result + "]" + msg;
```

**后台 `undone()`**（无条件）：
```java
if (append) msg = "[1018-" + result + "]" + msg;        // 无任何开关、无脱敏
```

> **风险**：后台把 `insert`/`update`/`select` 关键字甚至 SQL 片段直接回传给浏览器。因为是内网 + 员工账号，风险等级低于互联网入口，但**从安全规范上仍属于信息泄露**（可通过浏览器报看到 SQL 结构、表名、字段名），且如果后台某天被挂到外网或被 CSRF 利用，风险会直接放大。

### 7.3 单账号互斥的错误码差异

| | 前台 | 后台 |
|---|---|---|
| 触发条件 | `RST_GB2006`（登录超时） | `RST_GB2006`（凭证失效） |
| 转换后 | `RST_GB2007` + `账号已在其它地方登陆.时间:xx.IP:xx` | **`RST_GB2006`** + `账号已在其它地方登陆.时间:xx.IP:xx` |

### 7.4 文件上传的后台特色

```java
// ToBackController.MCallable
} else if (ClassUtils.isEqualImpl(methodParamType, MultipartFile.class)) {
    o = this.file;
    $params.put("file", IOUtils.getString(this.file.getInputStream()));   // ★ 后台特有
}
```

**为什么后台需要**：运营人员大量场景是「上传 Excel/CSV 导入数据」「上传配置文件下发参数」「粘贴文本批量处理」。这些场景下业务执行器期望收到的是**文件内容字符串**，而不是 `MultipartFile`（因为往往还要按行解析、转换、脱敏）。前台则相反——上传图片/视频/签名文件，需要保留二进制流。

**注意**：`IOUtils.getString()` 未指定字符集，依赖平台默认编码，在 Windows + GBK 环境下导入口碑会有乱码风险。

---

## 八、差异背后的设计取舍

### 8.1 威胁模型不同

```
前台 /api  面向互联网          后台 /toBack  面向内网运营人员
     │                              │
     ├─ 攻击面：开放               ├─ 攻击面：内部（越权、误操作）
     ├─ 主体：百万级 C 端用户       ├─ 主体：数百内部员工
     ├─ 核心风险：                  ├─ 核心风险：
     │   枚举协议号                  │   横向越权（普通柜员访问清算菜单）
     │   越权调用他人接口            │   批量误操作
     │   重放交易                    │   敏感数据批量导出
     │   社会工程（协议签订）         │
     │   大规模自动化攻击            │
     └─ 必须：纵深防御、重放防护、    └─ 需要：
        频率风控、敏感词、协议签订     直观权限、可批量、防误操作
```

### 8.2 一句话总结取舍逻辑

> **前台把「安全」做在协议层，因为入口不可信；后台把「权限」做在菜单层，因为操作者可信但需要清晰的权限边界。**

### 8.3 三层收敛示意

```
             协议路由框架（100% 共享：api.json + HandlerRouter + MCallable + valide）
┌────────────────────────────────────────────────────────────────┐
│                ↓                        ↓                      │
│         /api（前台）                /toBack（后台）              │
│  ┌───────────────────────────┐  ┌──────────────────────────┐    │
│  │ 授权：协议级 + 用户类型     │  │ 授权：菜单功能码 func_id  │    │
│  │ 防重放 + 协议号防伪        │  │ 无防重放、无协议号防伪     │    │
│  │ 18 道业务合规校验          │  │ 0 道业务合规校验           │    │
│  │ 缓存 + 同步锁 + 脱敏       │  │ 无缓存、无锁、无脱敏      │    │
│  │ 三流日志 + 监控 + 审计      │  │ 单流日志                  │    │
│  │ 跨域 Cookie + SSO 穿透     │  │ 同域 Cookie              │    │
│  └───────────────────────────┘  └──────────────────────────┘    │
└────────────────────────────────────────────────────────────────┘
```

---

## 九、面试话术

### 9.1 讲这个对比的开场（30 秒版）

> 我们中台有两个网关，共用一套协议路由框架——都是读 `api.json` 把协议号反射绑定到执行器。但管控深度完全不同。
>
> **前台 `/api` 面向互联网 C 端用户**，所以在协议层做了 20 道校验：防重放、协议号 MD5 防伪、登录强度分级（交易类必须证书登录）、协议签订、会员有效期、资金密码、敏感词过滤、三级缓存、字段级脱敏、双日志流加 Redis 监控队列。
>
> **后台 `/toBack` 面向内部运营人员**，前台那套协议级鉴权环节全部省去。授权模型从「协议级」换成「**菜单功能码级**」——`func_id` 必填，校验它是否在 `Token.AUTHS.MENU[].AUTHCODE` 里。因为后台是 SPA，URL 就是语义，`/toBack/user/edit` 直接映射协议号，`params` 不用再包一层 `api`。这样运营人员看到什么菜单就能点什么功能，新增协议挂到已有菜单下权限自动生效，免维护。
>
> **核心取舍：入口不可信就把安全做深，操作者可信就把权限做直观。**

### 9.2 可能的追问与回答

**Q：为什么后台不做防重放？**
> 防重放靠时间戳 + 签名窗口，但后台大量是"表单提交 + 文件上传"，网络重试、用户重复点击概率高，容易误伤。而且后台是长会话操作，攻击者已经通过了身份认证和菜单权限校验，再做协议级防重放收益有限。前台是交易类接口，一次重放可能造成资金损失，必须做。

**Q：后台不做缓存不怕慢吗？**
> 后台流量比前台低 2~3 个数量级，QPS 压力小。但更重要的是**缓存一致性风险**——后台改一条费率，缓存没及时失效会导致运营看到旧数据并重复操作，代价远大于省下的几百毫秒。前台是读多写少的行情公告，缓存收益高、风险低。

**Q：后台为什么连出参脱敏都不做？**
> 后台返回的就是运营需要的完整数据（比如客户的完整手机号用于核对），脱敏会影响业务。但这是**有意识的取舍而非疏漏**——因为前端是受控的内部系统，访问者本来就该看到这些数据。真正的风险是后台被挂到外网，这个假设一旦打破就需要补齐。

**Q：为什么后台反而用了 `BeanUtils.setBean`，前台却逐字段赋值？**
> 演进顺序问题。后台网关是后期新建的，用批量注入更简洁；前台是早期代码，逐字段赋值虽然啰嗦但能被后续新增字段（如 `APISTYLE`、`API_NAME`）显式控制。代价就是后台 `HandlerRouter` 少这两个字段，导致 inner 协议隔离和审计日志两个功能没法做——**技术选型的差异直接演化成功能差异**，这是很典型的"历史包袱"。

**Q：两个网关 4000 多行代码重复严重，你怎么看？**
> 应该抽象成 `AbstractApiGateway` 模板类，把「解析 → 解密 → 路由 → 反射 → 响应」抽成模板方法，把校验关卡做成**可插拔的责任链**（每个校验实现 `GatewayFilter` 接口，`api.json` 里配 `filters: ["antiReplay","sensitiveWord","fundPwd"]`），前台装全部 Filter，后台装需要的那几个。这样新增校验只需加一个类 + 一行配置，两侧都能复用，也避免了当前这种"改前台顺手漏改后台"的隐患。

---

## 十、风险与改进点

| # | 问题 | 严重度 | 改进方向 |
|---|---|---|---|
| 1 | **4000+ 行代码双份重复**，`valide`/`valideArray`/`HandlerRouter`/`MCallable`/`initRouter`/`done`/`undone` 几乎逐行复制 | 高 | 抽 `AbstractApiGateway` 模板 + `GatewayFilter` 责任链 |
| 2 | **后台错误信息无脱敏**，SQL 片段直接回传浏览器 | 中高 | 复用前台的 SQL 关键字脱敏 + `error.isHide` + `develop.error_append` 开关 |
| 3 | **后台无防重放**，批量管理操作可被重放 | 中 | 对高危写操作（批量导入、参数下发）单独开防重放 |
| 4 | **后台无审计日志**，内部操作无留痕，违反内控要求 | 中高 | 补 `API_NAME` 字段 + `1018_APP_LOG` 上报（内部系统通常比 C 端更需审计） |
| 5 | **后台无监控上报**，性能劣化无法感知 | 中 | 接入 `1018_MONITOR_DATA` + 慢接口告警 |
| 6 | **`BeanUtils.setBean` 隐式契约**，新增字段易漏配/错配 | 中 | 改回显式赋值或加单元测试覆盖字段映射 |
| 7 | **`func_id` 用 `indexOf` 子串匹配**，`AUTHCODE` 为 `FUND01` 时会误命中 `FUND010` | 中 | 改为先 `split(",")` 成 `Set` 再 `contains` |
| 8 | **`IOUtils.getString()` 未指定字符集**，Windows GBK 环境 Excel 导入口碑乱码 | 中 | 显式 `getString(is, "UTF-8")` |
| 9 | **`HandlerRouter` 线性查找 O(n)** | 低 | 双索引 `Map<api, router>` / `Map<restfull, router>` |
| 10 | **`MCallable` 构造参数名错位**（反编译产物）：`MCallable(Map api, HandlerRouter params, HttpServletRequest router, HttpServletResponse request, MultipartFile response, String file, Token tokenId, ApiContext token, Map apiContext)` 与字段赋值顺序不匹配 | 低 | 实际赋值 `this.params=params` 等，说明源码是正常的，反编译器参数名推断错误；非真实缺陷 |
| 11 | **无协议配置热更新**，`api.json` 改动需重启 | 低 | 接配置中心 + 文件 Watcher |
| 12 | **`catch (Exception)` 而非 `Throwable`**（后台） | 低 | 反而比前台更规范，前台 `catch (Throwable)` 才该改 |

---

## 附录 A：类结构对照

```
ToBackController (1526 行)                    HandlerController (2581 行)
├─ 构造器                                      ├─ 构造器
│  ├─ KeyMapper 反射实例化                       │  ├─ KeyMapper 反射实例化
│  ├─ 加载 api.json → apiConfig_all              │  ├─ 加载 api.json → apiConfig_all
│  └─ 注入 Validate.Regex 静态正则               │  └─ 注入 Validate.Regex 静态正则
├─ encrypt_publicKey()        ★无 try-catch     ├─ encrypt_publicKey()  ★有 null 检查 + try-catch
├─ handle_upload()  /toBack_upload/**          ├─ handle_upload()  /api_upload/**
├─ handle()  ★含 func_id 校验                    ├─ handle()  ★含升级熔断/注入防护/验签/明文白名单
├─ execute()  ★精简 29 项能力                   ├─ execute()  ★完整 20 道校验 + 缓存 + 锁 + 脱敏 + 3 类日志
├─ addCookie()      ★3 个原生 Cookie            ├─ addCookie()      ★SSO/Org 穿透 + NewCookie + CORS
├─ clearCookie()                                   ├─ clearCookie()
│                                                  ├─ addCookieOld() / clearCookieOld()  ★新旧双套
├─ initRouter()                                   ├─ initRouter()
├─ done() ×4 / undone()  ★无脱敏                 ├─ done() ×4 / undone()  ★三层脱敏
├─ respondJson()                                  ├─ respondJson()
├─ getLogPre()                                    ├─ getLogPre()
├─ valide() / valideArray()                       ├─ valide() / valideArray()  ★多 Map 类型分支
├─ logout_clear()                                 ├─ logout_clear()
├─ revertString()                                 ├─ revertString()
│                                                  ├─ convertApi()          ★MC*→XHV5*
│                                                  ├─ checkLoginType()      ★四套认证体系
│                                                  ├─ checkAllowThird()
│                                                  ├─ checkUserType()
│                                                  ├─ checkAgree()
│                                                  ├─ checkValidDate()
│                                                  ├─ checkDaPing()
│                                                  ├─ checkFundPwdV2()
│                                                  ├─ checkFundSign()
│                                                  ├─ handleLang()
│                                                  ├─ checkPowers()
│                                                  ├─ checkStatus()
│                                                  ├─ translateRtn()       ★LibreTranslate
│                                                  ├─ checkApiAuth() / checkUserApi()
│                                                  ├─ lockApi() / unLockApi()
│                                                  ├─ doAuthRtn()           ★出参脱敏
├─ Result (内部类，未使用)                         ├─ Result (内部类，未使用)
├─ HandlerRouter  ★BeanUtils.setBean             ├─ HandlerRouter  ★逐字段赋值 + APISTYLE/API_NAME
├─ HandlerRouterParam  ★BeanUtils.setBean        ├─ HandlerRouterParam  ★逐字段赋值
├─ MCallable  ★含 file→String                  ├─ MCallable
└─ NewCookie  ★不存在                            └─ NewCookie  ★SameSite + Secure
```

---

## 附录 B：两份文档的阅读顺序建议

| 目标 | 阅读顺序 |
|---|---|
| **快速理解整个中台** | 本文档 §2 链路 → §4 保留能力 → §5 砍掉的能力 → 再看 [HandlerController 文档](./HandlerController-网关功能详解.md) §3~§5 |
| **准备面试** | 本文档 §8 设计取舍 → §9 面试话术 → [HandlerController 文档](./HandlerController-网关功能详解.md) §10 亮点 → 本文档 §9.2 追问应对 |
| **做安全审计** | 本文档 §10 风险表第 2/3/4 条 + [HandlerController 文档](./HandlerController-网关功能详解.md) §7.3 三层脱敏 → 对比评估后台缺口 |
| **准备重构方案** | 本文档 §10 第 1 条 + §9.2 最后一个追问（`AbstractApiGateway` + `GatewayFilter` 责任链） |
| **排查线上问题** | 两份文档 §3 章节对照 → 看错误提示文案反查是哪道校验抛的 |

---

**文档生成时间**：2026-10-20
**适用范围**：代码走读 / 面试准备 / 安全审计 / 重构评估 / 新人培训
**关联文档**：[HandlerController-网关功能详解.md](./HandlerController-网关功能详解.md)