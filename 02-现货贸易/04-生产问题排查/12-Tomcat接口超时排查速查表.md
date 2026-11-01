# Tomcat 接口超时排查速查表

> 接口超时不是单一参数，而是多类超时叠加。排查前先分清：**连接阶段超时 / 等待线程超时 / 业务处理超时 / 网关或客户端超时**。

---

## 0. 一张图看清责任边界

```
客户端 ──> [Nginx/网关] ──> [Tomcat Connector] ──> [工作线程] ──> [业务: DB/缓存/下游]
          │                │                     │              │
    客户端超时           proxy_read_timeout    connectionTimeout  DB慢查询
    刷新/取消            proxy_send_timeout    maxThreads 耗尽    连接池耗尽
    前端短超时           proxy_connect_timeout acceptCount 排队    下游无超时
```

---

## 1. 连接阶段超时：`connectionTimeout`

**含义**：TCP 建连后，Tomcat 等待客户端发送**第一个 HTTP 请求行**的超时（毫秒），默认 20000（20s）。
**不是**接口处理超时。

**配置文件**：`conf/server.xml` 的 `<Connector>`

```xml
<Connector port="8080" protocol="HTTP/1.1"
           connectionTimeout="20000"
           disableUploadTimeout="false" />
```

| 参数 | 说明 |
|---|---|
| `connectionTimeout` | 等第一个请求行的毫秒数 |
| `disableUploadTimeout` | `false` 时，上传数据间隔也受此约束 |

**典型场景**：
- 客户端连上后迟迟不发请求
- 网络抖动导致请求头没完整到达
- 大文件上传时数据间隔过长

**排查**：
```bash
# 大量 ESTABLISHED 但无数据交互的连接
netstat -antp | grep 8080

# 抓包看请求头是否完整到达
tcpdump -i eth0 -A port 8080
```

---

## 2. 线程池耗尽：`maxThreads` / `acceptCount`

**含义**：`maxThreads` 打满后，新请求进 `acceptCount` 队列排队，排不进即拒绝或长时间等待。

**配置文件**：`conf/server.xml` 的 `<Connector>`

```xml
<Connector port="8080" protocol="HTTP/1.1"
           maxThreads="200"
           acceptCount="100"
           maxConnections="10000" />
```

| 参数 | 含义 | 默认 |
|---|---|---|
| `maxThreads` | 工作线程上限 | 200 |
| `acceptCount` | 线程满时的排队队列长度 | 100 |
| `maxConnections` | 最大连接数 | 10000 |

**常见诱因**：并发突增、慢接口占线程、下游无超时阻塞、死循环/锁竞争/死锁。

**排查**：
```bash
# 数活跃工作线程数
jstack <pid> | grep "http-nio-8080-exec" | wc -l

# JMX: 查看 currentThreadsBusy / maxThreads
# ObjectName: Catalina:type=ThreadPool,name="http-nio-8080"
```

---

## 3. 业务处理慢：数据库 / 缓存 / 下游

**这里改的不是 Tomcat，而是依赖方超时。**

**数据源连接池（HikariCP）**：
```properties
spring.datasource.hikari.connection-timeout=30000
spring.datasource.hikari.maximum-pool-size=50
```

**下游 HTTP 调用（HttpClient / RestTemplate / Feign）——必须三个都设**：
```java
connectionRequestTimeout = 2000;  // 从池里拿连接
connectTimeout          = 2000;   // 建连
readTimeout             = 5000;   // 读响应
```

**常见诱因**：
- 慢 SQL、缺索引、锁等待、连接池耗尽
- Redis/缓存不可用导致阻塞
- 下游无 `connectTimeout` / `readTimeout`
- 大文件导出、大批量查询引发 GC 压力

**排查**：
```sql
-- 锁等待 / 长事务
SHOW PROCESSLIST;
SELECT * FROM information_schema.innodb_trx;
```

```bash
# Redis 延迟
redis-cli --latency
```

---

## 4. 网关先超时：Nginx 504

**现象**：Nginx 返回 504，Tomcat 日志不一定有错误。

**配置文件**：`nginx.conf`

```nginx
location / {
    proxy_connect_timeout 5s;   # 连后端超时
    proxy_send_timeout    60s;  # 向后端发请求超时
    proxy_read_timeout    60s;  # 等后端响应超时（504 主要看这个）
}
```

**关键原则**：
```
proxy_read_timeout > 后端接口最长处理时间 > Tomcat 侧超时
```

**排查**：看 Nginx `access.log` / `error.log`，`504` 出现在网关层即后端未在限时内返回。

---

## 5. 客户端先断开：`ClientAbortException`

**典型日志**：
```
ClientAbortException: java.io.IOException
Caused by: java.net.SocketException: Connection reset by peer
```

**含义**：Tomcat 还在写响应，客户端已关闭连接。

**常见场景**：刷新/取消请求、前端短超时、大文件下载过慢、Nginx `send_timeout` 到期。

**处理**：
- 大文件下载改流式 + 分块写出
- 检查前端 `timeout` 是否过短
- 检查 Nginx `send_timeout`

---

## 6. 异步请求超时：`asyncTimeout`

**含义**：Servlet 异步处理的默认超时（毫秒），默认 30000（30s）。只影响异步 Servlet。

**代码（优先级高）**：
```java
AsyncContext ctx = request.startAsync();
ctx.setTimeout(30000);
```

**web.xml**：
```xml
<async-supported>true</async-supported>
<async-timeout>30000</async-timeout>
```

---

## 7. 上传 / 下载类接口

| 场景 | 关注点 |
|---|---|
| 大文件上传 | `connectionTimeout` + `disableUploadTimeout`，防数据间隔过长被断 |
| 大文件导出 | 网关 `proxy_read_timeout`、客户端超时，易被先判超时 |
| 下载长时间无数据 | Nginx `send_timeout` / `proxy_buffering` |

关闭 Nginx 缓冲：
```nginx
proxy_buffering off;
```

---

## 8. 通用排查顺序（速查卡）

```
1. 看日志   → catalina.out / localhost.log / 应用日志，找 ClientAbortException、线程池告警
2. 看网关   → Nginx 504/502，定界是网关断还是 Tomcat 断
3. 看线程池 → 活跃线程 vs maxThreads
4. 看依赖   → 慢 SQL、连接池、下游超时是否合理
5. 看 JVM    → Full GC、内存泄漏、CPU 单核打满
```

---

## 9. 一句话总结

> `connectionTimeout` 只管「连上后等不等得到请求」，接口处理慢通常不是它直接导致。
> 真正让接口超时的，多数是**线程池、数据库、下游依赖、网关或客户端超时**几类问题叠加。
