# HandlerController 网关功能详解

> **工程**：`midservice-1.1.188.228.5`（证券/金融行业中台，模块号 1018_S）
> **类全名**：`com.ylsoft.mid.service.controller.HandlerController`
> **源码**：`com/ylsoft/mid/service/controller/HandlerController.java`（2581 行，反编译自 `midservice-1.1.188.228.5.jar`，JD-Core 0.6.0）
> **定位**：前台/移动端 API 网关 —— 整个中台的唯一统一南北向入口
> **文档用途**：架构理解 / 面试准备 / 安全审计参考
> **关联文档**：[`ToBackController-后台网关与HandlerController对比.md`](./ToBackController-后台网关与HandlerController对比.md)（后台网关 `/toBack` 的实现与逐项差异对照）

---

## 目录

- [一、一句话定位](#一一句话定位)
- [二、整体架构](#二整体架构)
- [三、请求全链路](#三请求全链路)
- [四、execute()：14 道校验关卡](#四execute14-道校验关卡)
- [五、执行阶段三大横切能力](#五执行阶段三大横切能力)
- [六、MCallable：反射执行器](#六mcallable反射执行器)
- [七、响应治理与错误码](#七响应治理与错误码)
- [八、可观测性与审计](#八可观测性与审计)
- [九、配置驱动矩阵](#九配置驱动矩阵)
- [十、面试话术：设计亮点](#十面试话术设计亮点)
- [十一、改进点与风险](#十一改进点与风险)
- [附录 A：涉及的数据字典](#附录-a涉及的数据字典)
- [附录 B：外部依赖清单](#附录-b外部依赖清单)

---

## 一、一句话定位

它是证券/金融行业中台的**前台 API 网关**——整个 1018_S 中台的**唯一统一南北向入口**。本身不写业务，只做 6 件事：

> **协议路由 → 安全校验 → 参数校验 → 反射调用 → 响应治理 → 可观测**

真正的业务逻辑全在 `handler/*` 的 54 个执行器里，通过 `api.json` 配置表动态绑定。**"加一个接口不用发版"** 是这个网关最核心的设计目标。

---

## 二、整体架构

### 2.1 两个 HTTP 入口（故意设计的双通道）

| 入口 | 方法 | 作用 |
|---|---|---|
| `/api/**` | `handle()` | 普通 JSON / 加密协议请求 |
| `/api_upload/**` | `handle_upload()` | 带文件的协议请求 |

`handle_upload()` 只做两件事就转给 `handle()`：

```java
req.setAttribute("$MULTIPARTFILE", file);   // MultipartFile 塞进 request 属性
req.setAttribute("$API_PREFIX", "/api_upload");
handle(req, resp);
```

这样保证**文件上传协议和普通协议走完全相同的校验链路**，不用写两套。

### 2.2 三层结构

```
┌──────────────────────────────────────────────────┐
│ ① 协议层   api.json + HandlerRouter 表             │ 启动时加载：协议 → 类#方法
├──────────────────────────────────────────────────┤
│ ② 管控层   14 道校验 + 缓存 + 锁 + 风控 + 幂等│  execute() 循环
├──────────────────────────────────────────────────┤
│ ③ 执行层   MCallable 反射调用 handler/*           │  按方法签名注入 + 参数校验
└──────────────────────────────────────────────────┘
```

### 2.3 路由元数据 `HandlerRouter`

`api.json` 每一条记录被封装成一个 `HandlerRouter`：

| 字段 | 含义 |
|---|---|
| `API_PROTOCOL` | 协议号（如 `MT1100`） |
| `API_ISLOGIN` | 是否需要登录（`Y` 触发登录校验） |
| `API_BINDCLASS` | 绑定的执行器 `类全名#方法名` |
| `API_HANDLETYPE` | `B`=普通 Bean 绑定；`D`=按协议号自动映射 `com.ylsoft.mid.fdm.api.{协议号}#execute` |
| `API_RESTFULL` | RESTful 路径别名（`/api/xxx` 可替代协议号调用） |
| `APISTYLE` | `inner`=内部协议，**禁止从网关外呼** |
| `MODU_ID` | 所属模块（`1036` 特殊：自动注入客户端 IP） |
| `PARAMS` | 参数元数据：`PARAM_CODE / NAME / VALIDATE / ISREQUIRE / DEFVAL / LENGTH / TYPE` |
| `API_NAME` | 协议中文名（用于审计日志） |

**隐私参数自动识别**：`PARAMS` 里 `PARAM_MEMO` 含 `[隐私]` 的参数进入 `privateParamNames`，**打日志时自动替换为 `******`**。

**`initRouter()` 的工程细节**：

```java
BeanFactory.clear();                                             // 先清单例缓存
File f = new File(MonService.getUploadDir() + "/api.json");// 支持外置配置目录覆盖 classpath
if (白名单开启) whiteApis = Arrays.asList(WhiteApi.apis.split(","));
for (每条记录) { new HandlerRouter(mApi); }                      // 单条失败只打日志，不中断
// 每 100 条 MonUtils.sendMsg("load", ...) 上报加载进度
```

> **关键可用性设计**：单个脏配置不会让整个网关起不来。

### 2.4 两种调用模式

| 模式 | 入参 | 返回 |
|---|---|---|
| **单协议** `singleRtn=true` | `params = {api, params, restfull}` | `results[0]`（对象） |
| **批量** `singleRtn=false` | `directives = [{api,params,restfull}, ...]` | 结果数组 |

批量模式是**一次请求调多个协议**。典型场景：开户流程一次提交「协议签订 + 风险测评 + 开户 + 绑卡」，减少移动端 RTT。

---

## 三、请求全链路

### 阶段 0：前置处理

```java
restfull = URI 去掉 (contextPath + api_prefix);      // 支持 RESTful 风格调用
if (restfull.startsWith("encrypt/publicKey")) → 返回 RSA 公钥;
requesterIp= CoreUtils.getRemoteAddress(req);
requesterPort  = CoreUtils.getRemotePort(req);
```

- `/api/encrypt/publicKey` 返回 `{modulus, publicExponent}`（十六进制），供客户端做 RSA 加密
- 提前取客户端 IP / 端口（后面审计日志要用）

### 阶段 1：系统级熔断

```java
if ("1".equals(SysPara["40310"]))
    throw new HandlerException(RST_GB9998, SysPara["40311"] 或 "系统正在升级，请稍候进行操作！");
```

**全站一键降级**（发版维护时使用），提示语可在系统参数里配置，不用改代码发版。

### 阶段 2：请求解密（RSA + AES 混合加密）

`CoreConst.RequestEncrypt.enable` 开启时，两种模式：

**模式 A（加密模式）**

```
encrypt_key   → Hex 解码 → RSA 私钥解密 → revertString 反转字符 → 得到 AES Key
encrypt_data  → 还原被 URL 吃掉的 "+" → AES/CBC/PKCS5Padding 解密 → JSON → req_params
```

> `revertString` 把字符串倒序，是客户端约定的小 Trick。

**模式 B（明文模式）**

- 必须用 `directives` 批量格式
- **每个 api 都必须在 `ServiceConst.rsaAllowMap` 白名单**，否则直接 `"no auth"`
- 相当于给明文接口开了个小窗口，必须显式授权

### 阶段 3：注入防护 + 签名校验

1. `Validate.isSafe(params)` / `Validate.isSafe(directives)` —— 拦 SQL 注入 / XSS
2. `security.auth.isopen=Y` 时：用 `security.auth.publicKey` 反解 `directives`，与入参 `sign` 比对
   —— **客户端私钥签名 + 服务端公钥验签**，证明请求来自持证客户端
3. `directives` 格式合法性校验（解析失败 → `参数directives格式解析失败`）

### 阶段 4：开放平台 AppKey 鉴权

```java
if (accessKey、signature 非空) {
    Map appkey_data = AppKeyUtils.getApiKeyData(accessKey);   // 取 AppKey 配置
    AppKeyUtils.verifySignature(req, appkey_data);// 验签
    if (appkey_data.TOKEN == null) {                // 首次换取并缓存
        rtn = DSUtils.callSocket({0,2,0,7}, {USERNAME, USERFLAG=3});
        token = new Token(... IS_APIKEY=true);
        AppKeyUtils.saveData(accessKey, appkey_data);
    }
}
```

`USERFLAG=3` 表示**机构/第三方用户类型**。这是给第三方机构接入用的通道。

### 阶段 5：Token 解析与风控前置

```java
token = ServiceUtils.getToken(ServiceUtils.getTokenId(req), api);   // Cookie/Header 取
if (Security.Risk.enable && !RiskProcessor.process(req, resp, directives, keyMapping, keyMapper, token))
    throw new HandlerException("该请求已被拦截！");
```

风控拿到的是**原始请求 + 解密后的完整指令集 + 登录态**，可做频率 / 地域 / 设备 / 行为维度拦截。

### 阶段 6：响应

```java
if (!req.getAttribute("$RESPONSE_OUTPUTED")) {          // 执行器未自行输出
    if (singleRtn) respondJson(req, resp, results.get(0), aesKey);
    else            respondJson(req, resp, results,       aesKey);
}
```

`$RESPONSE_OUTPUTED` 让执行器可以自己接管响应（如文件下载、图片流）。

---

## 四、`execute()`：14 道校验关卡

每条 directive 在一个 `for` 循环里串行执行，每道校验都是**「全局开关 + 协议级 Map」双重控制**，支持灰度。

### 4.1 循环外准备：Token 自动巡检

```java
if (token != null && !token.IS_APIKEY && Token.autocheck_enable
        && (LASTCHECKTIME == null || now - LASTCHECKTIME > Token.autocheck_interval)) {
    jo = DSUtils.callSocket(PurviewAuth.tokenCheck, {TOKEN, LOAD_AUTH="0", MODULE=""});
    if ("0".equals(jo.FLAG))  logout_clear(request, response, token);  // 失效即踢下线
    else { token.setLASTCHECKTIME(now); ServiceUtils.saveToken(token); }
}
```

`logout_clear` 做四件事：清 Cookie → `removeToken` → DS 注销 → **`publish("{sysId}_logout")` 广播**（通知其他节点/客户端同步登出）。

> **被动失效检测**：Redis 里的 Token 可能被别处踢了，靠这个巡检发现。

### 4.2 循环内校验关卡表

| # | 校验 | 关键实现 | 拒绝码/提示 |
|---|---|---|---|
| 1 | **防重放** | `sha256(curtime + "czzdit")` == `signdata`，且 `\|now - curtime\| ≤ security.difftime`（默认 60000ms） | `时间戳为空` / `签名信息错误` / `请求时间与服务器时间差值过大` |
| 2 | **协议号防伪** | api 长度>32 时：`首16位 + 尾16位 == md5(中间部分)` | `API不正确，非授权访问` |
| 3 | **别名映射** | `keyMapper.mapAliasObject(cmd, true)`，小驼峰/别名 → 标准参数名 | — |
| 4 | **RESTful 路由** | api 为空时按 `API_RESTFULL` 反查协议号 | `路径无法识别` |
| 5 | **敏感词过滤** | `SensitivewordFilter.isContaintSensitiveWord`（仅 `sensitiveMap[api]==1`） | `信息中包含敏感词` |
| 6 | **协议升级映射** | `convertApi`：`MC*` → `XHV5*`（`xht.convert.v5` 开关） | — |
| 7 | **checkLoginType** | 见 §4.3，四套认证体系 | `GB2013/GB2014/GB2016/GB2018/GB2021` |
| 8 | **checkAllowThird** | 非 third 模式下 `onlyThirdApiMap` 里的协议强制走机构通道 | `请使用合作机构方式调用此协议` |
| 9 | **checkUserType** | `DF_` 前缀 → 必须 `USERFLAG=1`（管理员） | `请使用管理员方式调用此协议` |
| 10 | **第三方鉴权+解密** | `AuthUtils.validThirdApiAuth(thirdId, api)`；`SIGNDATA` 解密成正常参数 | — |
| 11 | **checkAgree** | DS hession `{0,9,0,97}`（`MODULE=B2B, INFOTYPE=501, BFIRMID, ISCREATE=1`）查 `SENDFLAG` | `GB2015 需要签订协议` |
| 12 | **checkValidDate** | DS `OPENS.findFirm` → `EXTENDDATA.10014001.ATTRIB_VALUE` 比当前日期 | `GB2017 请及时更新有效期` / `会员有效期为空` |
| 13 | **checkDaPing** | `dapingMap[api]==1` → 需登录且 `userId == is.daping.user` | `非大屏用户` |
| 14 | **checkFundPwdV2** | `Funds.enable && ver=="2.0"` → `FundsHandler.checkFundPwdV2(SYSID, CUSTMONEYPWD, token)` | `资金密码不能为空` |
| 15 | **checkFundSign** | `FundUtils.checkFundSign(FIRM_ID)` 资金签名校验 | — |
| 16 | **handleLang** | `FD` 开头（非 `FDD`）时读 Header `language` → 注入 `LANG`，`COMPID` 拼语言后缀 | — |
| 17 | **checkPowers** | `SF_` 前缀 → `USERFLAG=2`（机构）+ Redis `1001_AGENTFIRM_USERID` 代理关系校验 | `外部机构没有代理该客户的权限` / `外部机构未登录` |
| 18 | **checkStatus** | `token.EXTRA_DATA.STATUS==1` 且 Redis `1001_GATEWAY_API[api]==1` | `客户状态已挂起` |
| 19 | **checkApiAuth** | `API_ISLOGIN=Y` 时：`USERFLAG=3` 查 Redis `3002_API_AUTH_LIST` 授权列表（`noAuthApis` 白名单跳过） | `未授权访问,no power：xxx` |
| 20 | **批量上限** | `i >= Security.Api.maxMultiApiCount` | `超过最大执行量` |

### 4.3 `checkLoginType`：四套认证体系（亮点）

由 `bussiness.authtype` 切换，适配不同券商/客户的合规要求：

| 体系 | 实现 |
|---|---|
| **QYS（契约锁）** | DS hession `{0,65,16,6}` 查会员归属商 → socket `{1,98,48,3}`（`IFACECODE=1005`）查 `AUTHSTAUS == PASSED`，否则 `GB2016 需要契约锁认证通过`；外部会员无对应商 → `外部会员无对应的商` |
| **SSQ（上上签）** | 同上先查归属 → socket `{0,51,16,7}`，`FLAG==0` 通过，否则 `GB2021 需要上上签认证通过` |
| **PLAT（平台认证）** | `openClient.isPerfect(FIRM_ID)=="2"` 且 `openClient.findEdit(FIRM_ID).CHECKFLAG=="2"`，否则 `GB2018 需要平台认证` |
| **默认（登录强度分级）** | socket `{0,2,0,51}` 取 `LOGINTYPE`：`PASWD→1`、`MOBILE→2`、`OTHERKEY/AUTH→3`；与 `AuthTypeMap[api]` 要求等级比较，不足则 `GB2013 需要手机验证码登录` / `GB2014 需要证书登录`；未知方式 → `不支持此登录方式` |

最后一种的**登录强度分级**是很典型的金融合规设计：查询类接口密码登录即可，交易类必须证书/UKey。

### 4.4 `checkPowers`：外部机构代客操作

```
api 以 SF_ 开头（外部机构专用协议）
  → token.USERFLAG 必须 = 2（机构）
  → Redis 查 "1001_AGENTFIRM_USERID" + orgId → 得到可代理的客户号列表（逗号分隔）
  → 请求里的 AGENTFIRMID 必须在列表中（AGENTFIRMID == "THIRD" 直接放行）
  → 否则 "外部机构没有代理该客户的权限"
```

> **防止机构越权代客操作**，监管硬要求。

### 4.5 APISTYLE 网关隔离

```java
if ("custom".equals(mid.server.style) && "inner".equals(router.getAPISTYLE()))
    throw new HandlerException("网关模式不允许调用此协议:" + api);
```

内部协议与网关协议物理隔离，防止内部接口被外呼。

---

## 五、执行阶段三大横切能力

### 5.1 三级缓存（`ServiceConst.ApiCacheMap`）

```java
switch (cacheType) {
    case "PUB": redisKey = CACHE_KEY;                        // 公共数据（行情、公告）
    case "FRM": redisKey = CACHE_KEY + "-" + token.FIRM_ID;  // 按机构隔离（费率、配置）
    case "CLI": redisKey = CACHE_KEY + "-" + MD5(params);    // 按请求参数（客户资产）
    default:    throw new Exception("暂时不支持此缓存类型");
}
// 存储：Base64(JSON)，TTL = CACHE_EXPIRE × 1000 毫秒
```

> **缓存是「执行器级别」的**：命中则完全不进入反射调用，QPS 承载能力天差地别。

### 5.2 按用户维度的同步锁

```java
lockKey = api + "_" + tokenId;
if (LockUtils.lockMap.get(lockKey) == null) LockUtils.lockMap.put(lockKey, new ReentrantLock());
((Lock) LockUtils.lockMap.get(lockKey)).lock();
try { /* 反射执行 */ } finally { unLockApi(token, api); }
```

保证**同一用户同一协议串行执行**，防止重复点击下单/重复提交。开关 `is.open.syncLock` + 协议级 `syncLockMap`。

### 5.3 Greencard 幂等卡（重试卡）

```java
if (executeSuccess) greencard.invalide();                        // 成功 → 销毁卡
else if (greencard.alive || greencard.needUpdate) {
    if (greencard.count > 4) greencard.invalide();               // 失败超 4 次 → 废弃
    else { greencard.save(); rtn.put("greencard", greencard.id); } // 回传卡号
}
```

> **解决「客户端超时重试导致重复执行」**：服务端发卡，重试带卡号，识别为同一笔事务。银行业/证券业常见做法。

### 5.4 出参脱敏 `doAuthRtn`

```java
if (is.rtn.encode=Y && authRtnMap.containsKey(api)) {
    rtnType    = authRtnMap.get(api);    // List / Map / String
    apiRtnCode = encodeMap.get(api);// 该协议需脱敏的字段名列表
    命中字段的值 → 替换为 "*****"
}
```

**协议级字段级脱敏**——例如查询接口返回手机号 `138****1234`，完全由配置驱动。

---

## 六、`MCallable`：反射执行器

### 6.1 登录兜底

```java
if ("Y".equals(router.API_ISLOGIN) && token == null) {
    if (StringUtils.isEmpty(tokenId)) throw new HandlerException(RST_GB2004, "未登录,请登录");
    else                              throw new HandlerException(RST_GB2006, "您的登录已超时，请重新登录");
}
```

区分「从未登录」和「登录超时」，前端据此决定跳登录页还是弹窗。

### 6.2 按方法签名注入容器对象（依赖注入）

```java
if (type == HttpServletRequest.class)         o = request;
else if (type == HttpServletResponse.class)   o = response;
else if (type == Token.class)                 o = token;
else if (type == ApiContext.class)            o = apiContext;   // 流水号/IP/日志Key/幂等卡
else if (type == MultipartFile.class)         o = file;
else if (type == Map.class && "$params".equals(paramName)) o = $params;
```

> **业务执行器不用管参数从哪来**，声明式写法即可，可读性极好。`$params` 汇总所有业务参数。

### 6.3 `LIST_X_Y` 批量参数协议（设计巧妙）

形如 `LIST_TRADE_qty` 的形参名，自动解析为：

- `paramKeyName = TRADE`（外层JSON 数组的 key）
- `jsonKeyName  = qty`（数组元素的字段）

```java
JSONArray arr = JSONArray.parseArray(params.get("TRADE").toString());
for (int j = 0; j < arr.size(); j++) {
    o = JSONObject.fromObject(arr.get(j)).get("qty");
    o = ObjectUtils.toObject(o, methodParamType);          // 类型转换
    if (ClassUtils.isString(methodParamType)) o = ((String) o).trim();
    o = valideArray(paramName, o, handlerParam, type, paramConfig, j);  // 逐条校验
}
```

一个 `List<TradeItem> LIST_TRADE_xxx` 形参就能完成**批量下单的逐条校验**，无需在业务层重复写循环校验。

### 6.4 参数校验 `valide()`

| 能力 | 来源 |
|---|---|
| 必填 `unnull` | `PARAM_ISREQUIRE=Y` 或 apiConfig 覆盖 |
| 长度截断 `length` | `PARAM_LENGTH` |
| 正则匹配 `validate` | `PARAM_VALIDATE` + `ValidatorUtils.isMatch` |
| 默认值 `defValue` | `PARAM_DEFVAL` |
| 类型转换 | `ObjectUtils.toObject` 按形参类型（String/Number/Boolean/Map） |
| 错误文案 | `msg_empty` / `msg_invalide` 可按渠道自定义 |

**校验规则来自 `api.json`，文案可被 `apiConfig` 覆盖** —— 意味着不同渠道（`reffer`）可以有不同必填和提示语，同一套协议复用。

### 6.5 执行

```java
if (指定版本 && params.containsKey("zd_version"))
    throw new HandlerException("不允许在指定接口版本号的情况下调用包含入参关键字\"zd_version\"的接口！");
$params.put("zd_version", apiContext.getVersion());
return router.method.invoke(router.handler, args);
```

### 6.6 ApiContext：贯穿全链路的上下文

```java
serialNo     = serialService.gen();                    // 全局流水号
api          = 协议号
version      = zd_version
requesterIp / requesterPort
logKey       = "[" + api + "][" + version + "][" + serialNo + "][" + ip + "][" + port
                + "][" + tokenId + "/" + userId + "/" + phone + "]"
greencard    = Greencard.create(cmd.greencard, api)
```

`logKey` 放入 `ThreadLocal`（`KEY_LOGPRE` + `ThreadUtils.put/clear`），任何层的 `logger.info(X + getLogPre())` 都自动带上全链路标识。

---

## 七、响应治理与错误码

### 7.1 统一结构

```java
done(api, msg, data)   → { result: RST_SUCCESS, api, msg, data, timestamp }
undone(api, e)         → { result, api, msg, data, timestamp, appresult }
响应统一塞 seqno = apiContext.serialNo
```

### 7.2 异常分类

| 异常类型 | 处理 |
|---|---|
| `HandlerException` | 取 `Resp.result` + `explanation` + `data` |
| `ApplicationException` | msg 兜底「未知错误」，`appresult = code` |
| `InvocationTargetException` | 解包 `getTargetException()` 再分类 |
| 其他 `Throwable` | `error_detail` 关闭时 → 「服务器异常」 |
| DB 异常（`isDbException`） | 「处理失败」/「应用失败」 |

### 7.3 三层信息泄露防护（安全亮点）

```java
// ① SQL 关键字脱敏：绝不让 SQL 语句回传前端
if (msg.contains("insert") || msg.contains("update") || msg.contains("select")) msg = "数据库异常";

// ② 连接池耗尽降噪
if (error.isHide=Y && (msg.contains("could not get jdbc") || msg.contains("无法获取连接") || msg.contains("服务器异常"))) {
    msg = "系统异常，可忽略"; result = RST_GB9999; appresult = RST_GB9999;
}

// ③ 调试信息开关
if (develop.error_append=Y) msg = "[1018-" + result + "]" + msg;
```

### 7.4 响应加密与跨域

```java
respondJson():
    UTF-8 + application/json
    if (SYS.allowJsonp || creditToken 非空) JSONPUtils.responseAllow(req, resp);   // 跨域白名单
    if (aesKey != null) rtn = AESUtils.encrypt(aesKey, rtn, CBC_PKCS5, key.getBytes());
```

> 请求怎么加密，响应就用同一个 AES Key 加密返回 —— **混合加密的完整闭环**。

### 7.5 Cookie / SSO 穿透机制

```java
Header OOO_SSO_TOKEN 存在 → 写 Cookie "OOO_SSO_TOKEN"
Header Ooo-Org-Token  存在 → 写 Cookie "Ooo-Org-Token"
否则                     → 写 Cookie "TOKEN"
统一再写：mtrade.logined=true、mtrade.auth=ServiceUtils.getAuthData()
```

- **适配三种客户端形态**：SSO 统一门户、机构端（Org）、普通 App/小程序
- `NewCookie` 是自定义内部类（老 JDK `Cookie` 不支持 `SameSite`），`SameSite=None` 时**自动 `setSecure(true)`**
- 新旧两套 `addCookie/addCookieOld` 按 `devMode.enable` 切换
- CORS 头：`Access-Control-Allow-Origin: *` + `Access-Control-Allow-Credentials: true`
- `COOKIE_HANDLED` request属性让执行器可自己接管 Cookie（如登录接口）

---

## 八、可观测性与审计

### 8.1 三套日志流

| Logger | 用途 |
|---|---|
| `logger` | 全量 DEBUG：`[API][MIDREQ][version]`（入参，隐私字段 `******`）+ `[API][MIDRES]`（出参） |
| `loggerTime`（`TimeLog`） | **慢接口**：`costTime > 1000ms` 打 WARN，带 `refer` |
| `loggerMonitor`（`monitor`） | 重点监控协议（`LogUtils.isMonitorApi`）的独立流 |

### 8.2 监控数据上报

```java
if (is.open.monitor=Y) {
    rpush("1018_MONITOR_DATA", {
        STARTTIME, ENDTIME, API, RESULT, MSG, COST_TIME,
        MACHINE_IP = sys.clusterId
    });
}
```

异步队列 + 集群 IP，方便外部监控系统消费，做**接口耗时、成功率、错误码 TOP、集群水位**分析。

### 8.3 安全审计日志（登录类操作留痕）

硬编码审计点 + 可配置列表：

| 协议 | 审计主题 | USERID 取值 |
|---|---|---|
| `MT1100` | 用户登录 | `params.account` |
| `PA9999` | 验证码登录 | `params.USERNAME` |
| `PA0005` | 第三方登录 | `params.USERNAME` |
| `MT1102` | 登录注销 | `token.FIRM_ID` |
| `MT1103` | 修改登录密码 | `token.FIRM_ID` |
| `MA1000` | 重置登录密码 | `params.userId` |
| `security.log.api` 配置的协议 | 自定义 | `token.USER_ID` 或「未登陆」 |

```java
{ KEYID, USERID, OPERTIME(精确到毫秒), API, NOTE, ISOK(000000→1), OPERIP }
→ DSUtils.dsClient.publishInfo("1018_APP_LOG", json)
```

> 密码类、登录类操作全量审计，满足**金融行业操作留痕与等保要求**。

---

## 九、配置驱动矩阵

所有行为都是 `MVCUtils.getProperty()`（全局开关）+ `ServiceConst.xxxMap`（协议级）双重驱动。

### 9.1 全局开关

```
security.auth.isopen / security.auth.publicKey   客户端签名验签
security.cross / security.difftime               防重放
api.md5                                          协议号 MD5 防伪
is.third.mode                                    第三方合作机构模式
is.sensitive.valid                               敏感词过滤
is.rtn.encode                                    出参脱敏
is.open.syncLock                                 用户维度同步锁
is.open.monitor / sys.clusterId                  监控上报
is.open.secureLog / security.log.api             安全审计
is.check.apiauth / is.check.apiuser              协议级授权
is.open.daping / is.daping.user                  大屏白名单
is.verfiy.logintype / bussiness.authtype         登录级别校验体系
is.verfiy.agreetype                              协议签订校验
is.verify.validDate                              会员有效期校验
is.check.fundPwd.v2 / is.check.fundSign           资金密码 / 签名
mid.server.style                                 网关模式（禁 inner 协议）
xht.convert.v5                                   协议号升级映射
devMode.enable                                   新旧 Cookie 模式
error.isHide / develop.error_append              错误信息治理
```

### 9.2 协议级 Map（`ServiceConst`）

```
noAuthApis / sensitiveMap / onlyThirdApiMap / thirdApiMap / AuthTypeMap /
AgreeTypeMap / validDateMap / daPingMap / syncLockMap / ApiCacheMap /
authRtnMap / encodeMap / checkFundPwdV2Map / checkFundSignMap / rsaAllowMap
```

### 9.3 渠道差异化

```
reffer → apiConfig_all.get(reffer) 优先，回落 apiConfig_all.get("default")
apiConfig.params 可覆盖参数校验规则（unnull / validate / defValue / length）与错误文案
```

> **效果**：加协议、改校验规则、调文案、脱敏字段、开关风控，**全都不需要发版**。

---

## 十、面试话术：设计亮点

| # | 亮点 | 怎么讲 |
|---|---|---|
| 1 | **配置化动态路由** | 协议元数据（路由/鉴权/参数/日志/风格）全在 `api.json`，启动时反射预解析成 `HandlerRouter`；新增接口零发版 |
| 2 | **混合加密闭环** | RSA 传输 AES Key + AES-CBC 加密业务体，响应同 Key 回加密；非加密通道用 `rsaAllowMap` 白名单收口 |
| 3 | **纵深校验矩阵** | 20+ 道关卡，每道「全局开关 + 协议级 Map」双控，可灰度、可按渠道差异化 |
| 4 | **登录强度分级** | `LOGINTYPE` 映射 1/2/3 级，查询类密码登录、交易类证书登录，符合金融合规 |
| 5 | **防重放 + 协议号防伪** | 时间戳 SHA256 + 时间窗（防重放）；首尾 16 位 + 中间 MD5（防协议号枚举篡改） |
| 6 | **幂等（Greencard）** | 失败重试发卡、≤4 次可复用、超限废弃，解决客户端超时重试重复执行 |
| 7 | **三级缓存** | PUB/FRM/CLI 三个维度（公共/机构/参数），执行器级缓存，命中即不反射 |
| 8 | **用户维度串行锁** | `ReentrantLock(api_tokenId)` + `finally` 释放，防重复提交 |
| 9 | **信息泄露防护** | SQL 关键字脱敏、连接池异常降噪、字段级出参脱敏、入参 `[隐私]` 日志脱敏 |
| 10 | **可观测性三件套** | ThreadLocal 全链路 logKey + 独立慢接口流 + Redis 监控队列 + 安全审计流 |
| 11 | **渠道化能力** | `reffer` 段配置优先于 `default`，同一协议不同渠道不同校验与文案 |
| 12 | **批量协议** | 一次请求多协议，减少移动端 RTT，开户等复合流程体验优化 |
| 13 | **优雅降级** | 系统升级一键熔断、单协议初始化失败不阻断整体、DB 异常统一兜底 |
| 14 | **多语言** | `language` Header 注入 + `COMPID` 语言后缀 + `LibreTranslateMain` 翻译 |

### 一句话总结（面试收尾）

> `HandlerController` 是一个**配置驱动、纵深防护、高可观测**的 API 网关：把「协议定义」从代码里彻底解耦到 `api.json`，用反射路由 + 20 道可灰度校验 + 三级缓存 + 用户维度锁 + 幂等卡 + 三层脱敏 + 双日志流 + Redis 监控队列，把 54 个业务执行器安全地暴露给 App、小程序、机构端和第三方合作机构，是金融行业典型的**南北向统一网关**实现。

---

## 十一、改进点与风险

| 问题 | 改进方向 |
|---|---|
| 路由查找是 `for` 循环遍历 List，O(n) | 数据量到千级确实是瓶颈，应改 `Map<api, router>` + `Map<restfull, router>` 双索引，O(1) |
| 2581 行单类、`handle()`/`execute()` 方法过长 | 职责过多，应拆 `ProtocolDecoder` / `SecurityFilterChain` / `ParamValidator` / `ResponseAssembler` / `AuditLogger`；校验关卡用**责任链 + 注解配置**替代硬编码 if |
| 协议号 MD5 防伪属「混淆」而非「认证」 | 无法防重放（已由时间戳解决）；更现代的做法是 HMAC-SHA256 对 whole-body 签名 |
| AES-CBC 用 Key 当 IV | `aesKey.getBytes()` 同时作为 Key 和 IV，**不符合 CBC 语义**（IV 应随机且与 Key 不同），存在模式攻击风险；应由前端随机生成 IV 一并传输 |
| 硬编码审计协议号（MT1100/PA9999/PA0005/MT1102/MT1103/MA1000） | 应在 `api.json` 增加 `AUDIT_FLAG` / `SECURITY_LEVEL` 字段配置化 |
| `LockUtils.lockMap` 无淘汰机制 | 长期运行会累积 key，**内存泄漏风险**，需 `ConcurrentHashMap` + 过期清理或 Caffeine 缓存 |
| 大量 `catch (Throwable)` | 会吞掉 `Error`，建议 `catch (Exception)`，对 `Error` 单独处理 |
| SQL 关键字用 `contains` 判断 | 既误判（业务文本含 "update"）又漏判（`INTO` / `DELETE` / `EXEC`），应改用 SQL Parser（如 JSQLParser）或直接用持久层异常类型判定 |
| `apiConfig_all` / `handlerRouters` 启动时加载 | 协议配置不热更新，只能重启；可接配置中心（Apollo/Nacos）+ 文件 Watcher |
| `StringUtils.notEmpty(new String[]{...})` | 反编译产物，原源码应为 varargs 或自定义方法，不应出现在面试代码里 |
| DS 协议号是 `byte[]` 魔法值（如 `{1,114,16,5}`） | 应抽成枚举/常量类，否则不可维护、不可检索 |

---

## 附录 A：涉及的数据字典

### Redis Key

| Key | 用途 |
|---|---|
| `1018_MONITOR_DATA` | 监控数据上报队列（List，rpush） |
| `1018_APP_LOG` | 安全审计日志（通过 DS `publishInfo` 下发） |
| `1001_AGENTFIRM_USERID` | 外部机构可代理的客户号列表 |
| `1001_GATEWAY_API` | 客户状态挂起期间的协议限制 |
| `3002_API_AUTH_LIST` | `USERFLAG=3` 用户的协议授权列表 |
| `{sysId}_logout` | 登出广播频道 |
| Token缓存 / `ApiCacheMap` 对应缓存键 | 会话与业务结果缓存 |

### 系统参数（SysPara）

| 参数 | 用途 |
|---|---|
| `40310` | 系统升级开关（1 = 全站熔断） |
| `40311` | 升级提示文案 |
| `10106` | 文件服务器路径（大文件上传用） |

### 硬编码协议号

| 协议 | 用途 | DS 协议 |
|---|---|---|
| `MT1100` | 用户登录（审计） | AppKey 换取 Token：`{0,2,0,7}` |
| `MT1102` | 登录注销（审计） | — |
| `MT1103` | 修改登录密码（审计） | — |
| `MA1000` | 重置登录密码（审计） | — |
| `PA9999` | 验证码登录（审计） | — |
| `PA0005` | 第三方登录（审计） | — |
| — | Token 有效性巡检 | `{PurviewAuth.tokenCheck}` |
| — | 会员归属商查询 | hession `{0,65,16,6}` |
| — | 契约锁认证查询 | socket `{1,98,48,3}`，`IFACECODE=1005` |
| — | 上上签认证查询 | socket `{0,51,16,7}` |
| — | 登录级别查询 | socket `{0,2,0,51}` |
| — | 协议签订查询 | hession `{0,9,0,97}`，`MODULE=B2B, INFOTYPE=501` |
| — | 会员有效期 | `DSCommon.OPENS.findFirm` |
| — | 注销 | `DSCommon.PurviewAuth.logout` |

---

## 附录 B：外部依赖清单

| 类别 | 组件 | 用途 |
|---|---|---|
| 核心交易 | `DSClientAPI` / `DSUtils` / `DSBean` | 证券核心交易通信（socket / hession 两种模式） |
| 缓存 | `RedisClient` | Token、结果缓存、监控队列、权限字典 |
| 序列化 | `net.sf.json` / `fastjson` / `JSONUtils` | JSON 处理 |
| 加密 | `RSAUtils` / `AESUtils` / `Base64Utils` / `DigestUtil` / `MD5Utils` | 混合加密、验签 |
| 验签 | `AppKeyUtils` | 开放平台 AppKey 验签 |
| 反射 | `BeanFactory` / `ClassUtils` / `ObjectUtils` | 执行器单例、方法签名解析、类型转换 |
| 参数校验 | `ValidatorUtils` / `Validate` | 正则校验、注入防护 |
| 敏感词 | `SensitivewordFilter` | 敏感信息过滤 |
| 风控 | `RiskProcessor` | 请求拦截 |
| 幂等 | `Greencard` | 重试卡 |
| 翻译 | `LibreTranslateMain` | 多语言返回翻译 |
| 锁 | `LockUtils` / `ReentrantLock` | 用户维度串行锁 |
| 流水 | `SerialService` | 全局流水号 |
| 资金 | `FundsService` / `FundsHandler` / `FundUtils` | 资金密码 / 资金签名 |
| 会员 | `OpenClient` | 平台认证、会员信息 |
| 配置 | `MVCUtils` / `SysPara` / `ServiceConst` / `ServiceConfig` | 开关与数据字典 |
| 第三方 | `AuthUtils` | 合作机构鉴权与参数加解密 |
| 日志 | log4j + slf4j（`TimeLog`/`monitor`） | 多流日志 |

---

**文档生成时间**：2026-10-20
**适用范围**：代码走读 / 面试准备 / 安全审计 / 新人培训