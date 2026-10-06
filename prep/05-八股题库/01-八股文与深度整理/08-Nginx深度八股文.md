# Nginx 深度八股文

> 考前背诵版 · 面向后端/运维/全栈面试
> 每题结构：**答案骨架（能说出口的标准答案）→ 记忆口诀 → 加分点 → 追问**。
> 共 13 大章 70 题，先背骨架，再看加分点，追问练到最后。

---

## 01 核心概念与架构

### 1.1 Nginx 是什么？【必背】

**答案骨架：**
- Nginx（engine X）是俄罗斯人 Igor Sysoev 写的，C 语言，2004 年开源，轻量级 Web 服务器。
- **三大角色**：HTTP 服务器（静态资源）、反向代理服务器、邮件代理服务器（POP3/IMAP/SMTP）。
- **核心卖点**：高并发（单机 5 万~10 万连接）、低内存占用、模块化、高可靠性（master/worker 多进程）。

**口诀：** `三大角色 + 两高一低 = 静态服务、反代、邮件；并发高、内存低、可靠高。`

**加分点：** 不是"单进程事件驱动"这一个点，而是 **进程模型 + 事件驱动 + 异步非阻塞 I/O + 模块化 + 内存池** 五件套组合拳。

**追问：** Nginx 算不算 Web Server？—— 算，但动态处理弱，动态请求要转发给 fastcgi（PHP-FPM）/ uwsgi / 应用容器。

### 1.2 正向代理 vs 反向代理？【必背】

**答案骨架：**

| 维度 | 正向代理 | 反向代理 |
|---|---|---|
| 代理对象 | 客户端（替客户端访问服务器） | 服务器（替服务器接请求） |
| 谁隐藏 | 隐藏客户端 | 隐藏服务器 |
| 部署位置 | 客户端侧 | 服务器侧 |
| 典型场景 | 翻墙、公司代理 | 负载均衡、网关、CDN 回源 |

**口诀：** `正隐客户端，反隐服务器。`

**加分点：** Nginx 默认做反向代理；做正向代理要配 `resolver` + `proxy_pass $http_host$request_uri`，且原生只支持 HTTP 正向代理，HTTPS 正向代理要加 `ngx_http_proxy_connect_module`（或 OpenResty）。

### 1.3 master / worker 进程模型？【必背】

**答案骨架：**
- **master 进程**：不处理业务，只做管理 —— 读配置、fork worker、收信号（HUP/QUIT/USR2）、监控 worker、平滑升级。
- **worker 进程**：真正干活的进程，事件循环处理海量连接，互相独立。
- **两个辅助进程**：cache manager（定时清过期缓存）、cache loader（启动时把磁盘缓存索引加载进内存）。
- worker 数量默认 1，建议 **= CPU 核数**（`worker_processes auto`）。

**口诀：** `master 管，worker 干；一个挂，master 拉。`

**加分点：** 为什么用多进程不用多线程？—— 高并发下多进程内存隔离更稳，某个请求崩了不会拖垮整个服务，且避免线程锁竞争。worker 之间通过共享内存（limit_req 计数）通信。

### 1.4 Nginx vs Apache？【中频】

**答案骨架：**
- Apache：进程/线程池模型（MPM），**每连接一线程/进程**，并发几千就吃力；支持 .htaccess 目录级配置，动态处理强（PHP 模块内置）。
- Nginx：**事件驱动 + 异步非阻塞**，一个进程管几万连接；静态文件快（sendfile 零拷贝）；动态弱，要转发。

**口诀：** `Apache 一连接一线程，Nginx 一进程万连接。`

**加分点：** 现代主流架构 = Nginx 做入口（静态+反代+负载），动态请求转发给 Apache/Tomcat/PHP-FPM。

### 1.5 nginx.conf 配置块结构？【基础】

**答案骨架：** 由外到内：
```
main（全局）→ events（事件模型）
            → http（HTTP 服务）
                → server（虚拟主机：监听/域名/ssl）
                    → location（URI 匹配规则）
                → upstream（后端服务器组）
            → stream（四层 TCP/UDP 代理，需编译 stream 模块）
```
配置继承：**子块继承父块，子块可覆盖**（类似 CSS 的层叠）。

**口诀：** `全局 > events > http > server > location，upstream 挂在 http 下。`

**加分点：** `include` 实现配置拆分；`nginx -t` 检查语法；`nginx -s reload` 平滑生效。

---

## 02 高性能原理

### 2.1 为什么 Nginx 快？核心六板斧【必背】

**答案骨架：**
1. **事件驱动**：基于 epoll/kqueue，一个进程同时监听几万个 socket，无阻塞。
2. **异步非阻塞 I/O**：读写不等待，事件就绪才处理。
3. **多进程无锁设计**：worker 间共享状态极少，连接分配用原子操作。
4. **内存池**：每请求独立内存池，减少 malloc/free 与碎片。
5. **零拷贝**：静态文件 sendfile 内核态直接搬，不经用户态。
6. **模块化精简**：核心小，功能按需编译。

**口诀：** `事件驱动、异步非阻塞、无锁多进程、内存池、零拷贝、模块化 —— 六板斧砍出高性能。`

**加分点：** 本质是 **用少量进程 + 事件循环 对抗 海量并发连接**，把"线程上下文切换"开销换成"事件回调"。

### 2.2 同步阻塞 / 同步非阻塞 / 异步阻塞 / 异步非阻塞？【必背】

**答案骨架：**
- **同步阻塞**：发起 I/O 后线程卡住等结果。（BIO）
- **同步非阻塞**：发起后立刻返回，轮询状态（浪费 CPU）。（NIO 轮询）
- **异步阻塞**：罕见组合，基本无意义。
- **异步非阻塞**：发起后干别的，事件就绪内核回调通知。（AIO / Nginx 的 I/O 多路复用）

**口诀：** `阻塞=等着，非阻塞=轮着，异步=回调。Nginx 是异步非阻塞（事件通知）。`

**加分点：** Nginx 实际用 **I/O 多路复用（epoll）+ 非阻塞 socket**：把 fd 交给内核，就绪了内核告诉你，不用轮询、不用等。

### 2.3 epoll 为什么比 select / poll 快？【必背】

**答案骨架：**
- select：fd 上限 1024，每次调用把全量 fd 从用户态拷到内核态，内核线性扫描，O(n)。
- poll：取消 1024 限制（链表），但仍是 **全量拷贝 + 线性扫描**，O(n)。
- epoll：**事件就绪通知**，注册后内核维护红黑树，只返回"就绪的 fd"（就绪链表），O(1)；**零拷贝**（mmap 共享内存，无需每次拷全量）。

**口诀：** `select/poll 全量轮询，epoll 就绪通知 —— 前者 O(n)，后者 O(1)。`

**加分点：** epoll 三个 API：`epoll_create` / `epoll_ctl`（注册、改、删）/ `epoll_wait`（等就绪）。ET（边沿触发，只通知一次，要一次性读完）vs LT（水平触发，没读完一直通知）。

### 2.4 Nginx 事件驱动处理一个请求的流程？【进阶】

**答案骨架：**
1. 监听 socket 有新连接 → epoll 返回可读事件 → accept 建立连接，注册读写事件。
2. 读事件就绪 → 读请求头/请求体（非阻塞，没读完继续等）。
3. 解析请求 → 走 HTTP 阶段钩子（rewrite、access、content…）。
4. 内容阶段：静态文件直接 sendfile / 动态请求 proxy_pass 转发。
5. 写事件就绪 → 非阻塞写出响应 → 关闭或 keepalive 复用连接。

**口诀：** `accept → 读 → 解析 → 处理（静态/代理）→ 写 → 关/复用。全程不阻塞。`

**加分点：** 一个 worker 的 epoll 实例管理所有连接，任何时刻都在"少数活跃事件"上忙，这就是高并发的秘密。

### 2.5 惊群问题与 accept_mutex / reuseport？【进阶】

**答案骨架：**
- **惊群**：多个 worker 同时监听同一 listen socket，一个连接进来，**所有 worker 都被唤醒**去抢 accept，但只有一个成功，其余空转 —— 浪费 CPU。
- 解决一：**accept_mutex on**（默认开）：同一时刻只有一个 worker 持有 accept 锁，其他 sleep，减少唤醒。
- 解决二：**reuseport**（Linux 3.9+）：内核把连接**哈希分发**到各 worker 的独立 socket，天然无竞争，性能更好（需编译支持）。

**口诀：** `惊群=一群 worker 抢一个连接；accept_mutex 排队抢，reuseport 内核分。`

**加分点：** reuseport 还解决了负载均衡问题（按哈希分发）；缺点是需要内核支持和编译选项，生产环境可用 `listen 80 reuseport;`。

### 2.6 worker 进程数与最大并发怎么算？【必背】

**答案骨架：**
- `worker_processes` = CPU 核数（IO 密集可 2 倍核数，避免进程切换）。
- `worker_connections` 每个 worker 的最大连接数（默认 1024，建议 4096~10240）。
- **最大并发（HTTP 场景）≈ worker_processes × worker_connections ÷ 4**（每个请求约占用 2 个连接：accept 一个 + 可能 upstream 一个；2 连接/请求 → ÷2，再留余量 ÷4）。

**口诀：** `并发 ≈ 进程数 × 每进程连接数 ÷ 4（÷2 是连接账，÷4 是留余量）。`

**加分点：** 还要调 **系统级限制**：`ulimit -n`（文件描述符上限）、内核 `net.core.somaxconn`（accept 队列）、`net.ipv4.tcp_max_syn_backlog`（半连接队列）。

### 2.7 平滑 reload / 平滑升级的原理？【高频】

**答案骨架：**
- **reload（HUP）**：master 重新读配置 → 校验 → fork 新 worker → 新请求走新 worker，旧 worker 处理完存量连接后优雅退出。**整个过程不断服务**。
- **平滑升级（USR2 + WINCH）**：master 起新 master + 新 worker，**新旧版本共存**，存量连接旧进程处理，新连接新进程处理，`kill -QUIT 旧master` 收尾。
- 关键：worker 是 **按需退出** 的（`worker_shutdown_timeout` 可限时）。

**口诀：** `HUP 换配置换 worker，USR2 换二进制 —— 都是"新老共存、优雅退旧"。`

**加分点：** 回滚 = 恢复旧二进制 + 再走一遍 USR2；二进制文件会备份为 `nginx.oldbin`。

---

## 03 反向代理

### 3.1 反向代理原理与最小配置？【必背】

**答案骨架：** 客户端访问 Nginx（只认 Nginx），Nginx 把请求**原样转发**给后端（Tomcat/SpringBoot/Go/Node），后端响应再回传客户端。客户端不知道后端存在。

```nginx
server {
    listen 80;
    location /api/ {
        proxy_pass http://192.168.1.10:8080;
    }
}
```

**口诀：** `统一入口，替后端接客，客户端只见 Nginx。`

**加分点：** 反向代理在 OSI 七层之上（HTTP 层），能做 7 层路由、改写、缓存；4 层用 `stream` 块。

### 3.2 proxy_pass 带路径与不带路径的区别？【必背】

**答案骨架：**
- **不带路径** `proxy_pass http://后端;`：URI **原样透传**。
- **带路径** `proxy_pass http://后端/xxx/;`：**location 匹配部分被替换**为 `/xxx/`。

```nginx
location /api/ { proxy_pass http://back/; }
# 请求 /api/user → 后端收到 /user（/api 被 / 替换）

location /api/ { proxy_pass http://back; }
# 请求 /api/user → 后端收到 /api/user（原样）
```

**口诀：** `不带路径原样传，带路径换前缀 —— proxy_pass 末尾的 / 决定命运。`

**加分点：** 关键看 proxy_pass 的 URI 部分是否以 `/` 结尾：带路径（含变量时）会替换 location 前缀；正则 location 里不能带 URI。

### 3.3 怎么把真实客户端 IP 传给后端？【高频】

**答案骨架：**
- 用请求头携带：`X-Forwarded-For: 客户端IP, 上一跳代理IP`（每层代理追加）。
- Nginx 配置：
```nginx
proxy_set_header X-Real-IP $remote_addr;        # 真实 IP
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;  # 追加链
proxy_set_header Host $host;
```
- 后端取 `X-Real-IP` 或 `X-Forwarded-For` 第一段（注意**伪造风险**：多层代理时要信任前置代理，用 `real_ip` 模块 + `set_real_ip_from` 从可信代理链取）。

**口诀：** `X-Real-IP 给真身，X-Forwarded-For 记全链。`

**加分点：** 生产一般 Nginx 只信任来自 LVS/云负载均衡的 IP（`set_real_ip_from`），防止客户端伪造 XFF。

### 3.4 WebSocket 反向代理怎么配？【高频】

**答案骨架：** WebSocket 是**长连接 + 升级协议**，需要：① 设置 Upgrade 头；② 加大超时（默认 60s 会断）。

```nginx
location /ws/ {
    proxy_pass http://ws_backend;
    proxy_http_version 1.1;                 # 必须，keepalive 需要
    proxy_set_header Upgrade $http_upgrade; # 升级协议
    proxy_set_header Connection "upgrade";  # 保持长连接
    proxy_read_timeout 3600s;               # 心跳间隔决定
    proxy_send_timeout 3600s;
}
```

**口诀：** `HTTP 1.1 + Upgrade + Connection upgrade + 大超时 = WebSocket 四件套。`

**加分点：** 超时建议略大于客户端心跳间隔；TCP 层还要考虑 `keepalive` 与防火墙 idle 超时。

### 3.5 反向代理超时与重试？【进阶】

**答案骨架：**
- 超时三兄弟：`proxy_connect_timeout`（建连，默认 60s）、`proxy_send_timeout`（写，默认 60s）、`proxy_read_timeout`（读/等响应，默认 60s）。
- 重试：`proxy_next_upstream`（默认 `error timeout`）—— 失败后**换下一台上游重试**，可加 `http_502 http_504`。
- 配合：`proxy_next_upstream_tries 3`（最多试 3 台）。

**口诀：** `连不上、写不出、等不到，三超时；挂了就 next_upstream 换台。`

**加分点：** 注意**非幂等请求（POST）重试有风险**，可 `proxy_next_upstream non_idempotent` 谨慎开启。

### 3.6 proxy_buffering 缓冲是什么？【进阶】

**答案骨架：**
- 默认 `proxy_buffering on`：Nginx 先把后端响应**收进缓冲区**再发给客户端。
- 优点：慢客户端不拖累后端（后端瞬间写完就走）；缺点：首字节延迟。
- 相关参数：`proxy_buffer_size`（头缓冲，默认 4k~8k）、`proxy_buffers`（body 缓冲）、`proxy_busy_buffers_size`（发往客户端的大小）。
- 流式场景（SSE/下载）可 `proxy_buffering off` 或调大 `proxy_buffers`。

**口诀：** `缓冲 = Nginx 当蓄水池，后端秒完、慢客户端慢慢喝。`

**加分点：** SSE（Server-Sent Events）必须关缓冲或设 `X-Accel-Buffering: no`，否则流式数据被憋住。

---

## 04 负载均衡

### 4.1 Nginx 负载均衡原理？【必背】

**答案骨架：** `upstream` 定义后端服务器组，proxy_pass 指向组名，Nginx 按算法把请求分发给组内服务器，后端哪个"活着且合格"就分给谁。

```nginx
upstream backend {
    server 192.168.1.11:8080 weight=3;
    server 192.168.1.12:8080;
    server 192.168.1.13:8080 backup;
}
server {
    location / { proxy_pass http://backend; }
}
```

**口诀：** `upstream 是池子，proxy_pass 是水龙头，算法决定水流向。`

### 4.2 五大负载均衡算法？【必背】

**答案骨架：**
1. **轮询（默认）**：依次分发，平均。`weight` 加权轮询按权重。
2. **ip_hash**：按客户端 IP 哈希，**同一 IP 固定同一台**（会话保持）。
3. **least_conn**：发给**当前连接数最少**的（长连接/慢请求友好）。
4. **url_hash**：按 URL 哈希，同一 URL 固定一台（缓存命中友好，需 `hash $request_uri` 配置）。
5. **fair（第三方）**：按**响应时间**分配（按后端最快）。

**口诀：** `轮询排排坐，加权按分量，IP 哈希锁人，最少连接躲慢，URL 哈希锁资源。`

**加分点：** 一致性哈希（`hash $request_uri consistent`）解决扩缩容时大量重映射问题，缓存场景必备。

### 4.3 upstream server 常用参数？【高频】

**答案骨架：**
- `weight`：权重（配合轮询）。
- `max_fails=N`：连续失败 N 次判定不可用（默认 1）。
- `fail_timeout=时间`：失败计数窗口 + 熔断时间（默认 10s，同时是标记不可用的时长）。
- `backup`：备份机，**主机全挂才启用**。
- `down`：手动下线，不参与分发。
- `max_conns`：最大并发连接数（防打爆单机）。

**口诀：** `weight 分量、max_fails 记过、fail_timeout 关禁闭、backup 备胎、down 停用、max_conns 限流。`

**加分点：** `max_fails=0` 表示不做失败检测（永不熔断），适合健康检查由外部负责的场景。

### 4.4 健康检查：被动 vs 主动？【进阶】

**答案骨架：**
- **被动（默认）**：靠真实请求判断 —— 请求失败计数达 max_fails，fail_timeout 内不再分发；无真实流量就检测不到。
- **主动（商业版 / 开源补丁 / OpenResty）**：Nginx 定时主动发探测请求（`health_check interval=5s`），不依赖业务流量。

**口诀：** `被动=看真流量踩雷，主动=定时自己敲门。`

**加分点：** 开源版常用方案：OpenResty + lua-resty-healthcheck，或 LVS/云负载均衡器做主动探测。

### 4.5 负载均衡的会话保持怎么做？【高频】

**答案骨架：** 三种主流方案：
1. **ip_hash / hash 算法**：同一来源 IP 固定同一后端（简单，但 IP 变化/NAT 会失效）。
2. **sticky cookie（商业版）**：种 cookie 绑定后端。
3. **应用层会话共享**：Session 放 Redis（无状态化，最推荐，不依赖负载均衡策略）。

**口诀：** `哈希锁 IP、cookie 锁会话、Redis 一劳永逸。`

**加分点：** 面试加分点：**无状态化才是正解** —— 服务端 Session 移到 Redis/分布式缓存，负载均衡随便切。

### 4.6 灰度发布 + upstream 长连接？【进阶】

**答案骨架：**
- **灰度**：① 权重灰度（新版本 weight=1 先放量）；② 按头灰度（`map $http_user_agent` / 指定参数路由到灰度池）；③ 按 IP 白名单灰度（`geo` 模块）。
```nginx
upstream prod { server 10.0.0.1:8080; }
upstream gray { server 10.0.0.2:8080; }
map $http_canary $pool {
    default prod;   # 默认生产池
    "1"     gray;   # 请求头 canary:1 走灰度池
}
```
- **upstream 长连接**：`upstream { keepalive 32; }` + 转发时 `proxy_http_version 1.1` + `Connection ""`，减少频繁建连开销。

**口诀：** `灰度三招：权重放量、按头分流、IP 白名单；keepalive 32 省握手。`

**加分点：** 灰度发布配合监控：先 1% → 5% → 50% → 100%，异常立即 `down` 或改回 prod。

---

## 05 静态资源与缓存

### 5.1 root 与 alias 的区别？【必背】

**答案骨架：**
- **root**：把 location 匹配的 URI **拼在 root 路径后面** → 文件 = root + 完整URI。
- **alias**：把 location 匹配部分**替换**为 alias 路径 → 文件 = alias + 剩余URI。

```nginx
location /static/ { root /data/www; }
# /static/a.js → /data/www/static/a.js

location /static/ { alias /data/files/; }
# /static/a.js → /data/files/a.js
```

**口诀：** `root 是拼接，alias 是替换。alias 末尾要带 /，root 不用。`

**加分点：** alias 只能用在 location 里；正则 location 用 alias 时要注意捕获组。

### 5.2 静态资源浏览器缓存怎么配？【高频】

**答案骨架：**
```nginx
location ~* \.(js|css|png|jpg|svg)$ {
    expires 30d;                 # 强缓存：Cache-Control: max-age=2592000
    add_header Cache-Control "public, immutable";
    etag on;                     # 协商缓存（默认开）
}
```
- **强缓存**（200 from cache）：`Expires` / `Cache-Control: max-age`。
- **协商缓存**（304）：`ETag`（内容哈希）/ `Last-Modified`。
- 关键：**带 hash 的文件名（webpack contenthash）才能放心用 max-age 永久缓存**；不带 hash 的用 `no-cache` 每次协商。

**口诀：** `带 hash 锁死 max-age，不带 hash 走 304。`

**加分点：** 面试点：更新策略 —— 文件名 hash 变了 → URL 变了 → 必然回源新文件，缓存自动失效，无需手动刷新。

### 5.3 gzip 压缩怎么配？【高频】

**答案骨架：**
```nginx
gzip on;
gzip_comp_level 5;                # 1-9，5 性价比最高
gzip_min_length 1k;               # 小于 1k 不压（压了更亏）
gzip_types text/plain text/css application/javascript application/json image/svg+xml;
gzip_vary on;                     # 返回 Vary: Accept-Encoding
```
- 只压缩文本类（html/js/css/json/svg）；**图片/视频本身已压缩，再 gzip 收益低还耗 CPU**。

**口诀：** `文本才压，1k 起步，level 5，图片别动。`

**加分点：** 现代可上 **Brotli（br）** 比 gzip 再小 15%~20%；开启后检查响应头是否带 `Content-Encoding: gzip`。

### 5.4 sendfile 零拷贝原理？【必背】

**答案骨架：**
- 传统读文件发网络：磁盘 → 内核缓冲 → 用户态 → 内核 socket 缓冲 → 网卡，**4 次拷贝 + 4 次上下文切换**。
- `sendfile`：磁盘 → 内核缓冲 → **直接** socket 缓冲 → 网卡，**2 次拷贝（还可用 DMA）**，全程不经过用户态。

**口诀：** `sendfile = 数据在内核里走 VIP 通道，不进用户态。`

**加分点：** `sendfile on`（默认开）只对静态文件生效；配合 `tcp_nopush on`（攒包发）、`tcp_nodelay on`（小包快发）。

### 5.5 proxy_cache 代理缓存？【进阶】

**答案骨架：**
```nginx
proxy_cache_path /data/nginx_cache levels=1:2 keys_zone=mycache:100m max_size=10g inactive=60m;
server {
    location / {
        proxy_cache mycache;              # 开缓存
        proxy_cache_key $scheme$host$uri; # 缓存键
        proxy_cache_valid 200 301 302 10m; # 哪些状态码缓存多久
        proxy_cache_valid 404 1m;
        proxy_cache_use_stale error timeout updating; # 后端挂了用旧缓存兜底
    }
}
```
- 原理：以 `proxy_cache_key` 为键，把后端响应**缓存到磁盘**，相同键直接返回。

**口诀：** `keys_zone 定池子，proxy_cache_key 定钥匙，valid 定保质期，use_stale 兜底。`

**加分点：** `proxy_cache_use_stale updating`（缓存更新时旧值先顶着，防止缓存击穿）；`X-Cache-Status: HIT/MISS` 看命中率。

### 5.6 open_file_cache 与断点续传？【进阶】

**答案骨架：**
```nginx
open_file_cache max=1000 inactive=20s;     # 缓存文件句柄/元数据
open_file_cache_valid 30s;                 # 校验间隔
open_file_cache_min_uses 2;                # 访问 2 次以上才缓存
open_file_cache_errors on;                 # 也缓存"找不到"的结果
```
- **断点续传**：Nginx 原生支持 `Range` 请求（206 Partial Content），`proxy_set_header Range $http_range` 透传；大文件下载默认支持。

**口诀：** `open_file_cache 缓存句柄省 open/close；Range 请求天生支持断点续传。`

**加分点：** 断点续传配合 `expires` 让客户端缓存部分内容；CDN 场景务必透传 Range，否则视频拖动全废。

---

## 06 location 与 rewrite

### 6.1 location 匹配优先级？【必背】

**答案骨架：** 优先级从高到低：
1. `= ` 精确匹配（最高）。
2. `^~` 前缀匹配，命中后**不再看正则**。
3. `~` / `~*` 正则匹配（区分/不区分大小写），**按书写顺序**取第一个命中。
4. `/` 通用前缀匹配（最长前缀）。

**口诀：** `等于 > 脱帽前缀（^~）> 正则（~）> 最长普通前缀（/）。`

**加分点：** 完整判定流程：先精确 `=`，再 `^~` 前缀（命中即停），再按顺序扫正则（命中即停），最后最长前缀；正则优先级高于普通前缀（除非前缀是 ^~）。

### 6.2 location 匹配示例？【高频】

```nginx
location = /a      { ... }  # 只匹配 /a
location ^~ /img/  { ... }  # 前缀匹配，命中后正则不再看
location ~ \.png$  { ... }  # 正则：.png 结尾
location /api/     { ... }  # 普通前缀
location /         { ... }  # 兜底
```
- 请求 `/a` → 精确；`/img/1.png` → `^~`（正则的 \.png$ 不会生效）；`/x/1.png` → 正则；`/api/user` → 前缀；`/other` → 兜底。

**口诀：** `越具体的匹配越优先，^~ 是正则的"免死金牌"。`

### 6.3 rewrite 指令与四个 flag？【必背】

**答案骨架：**
```nginx
rewrite ^/old/(.*)$ /new/$1 permanent;   # 301
rewrite ^/user/(\d+)$ /profile?id=$1 last; # 内部跳转
```
四个 flag：
- `last`：停止 rewrite，**重新进入 location 匹配**（换 location 处理）。
- `break`：停止 rewrite，**留在当前 location**，不再匹配。
- `redirect`：302 临时跳转。
- `permanent`：301 永久跳转。

**口诀：** `last 重进赛场，break 原地躺平，redirect 临时走，permanent 永久走。`

**加分点：** `last` 与 `break` 的区别是经典题：last 后再按新 URI 匹配 location；break 直接在当前 location 继续执行剩余指令（如 proxy_pass）。

### 6.4 if 指令的陷阱？【进阶】

**答案骨架：** if 在 location 里行为**不可预测**（官方文档原话："if is evil"），只有以下场景安全：
- `return`、`rewrite`、`set` 这几个指令在 if 里是可靠的。
- 其他（proxy_pass、try_files 等放 if 里）会产生诡异 bug。

```nginx
if ($request_method = POST) { return 405; }   # 安全用法
```
- 替代方案：需要复杂条件路由用 `map`、`geo`、`server 拆分`、`location 嵌套`。

**口诀：** `if 里只放 return / rewrite / set，其他都别碰。`

**加分点：** 典型坑：if 里写 proxy_pass 会按默认 server 处理或产生意外行为；官方推荐"多 location + map"代替 if 逻辑。

### 6.5 try_files 原理？【高频】

**答案骨架：** 按顺序尝试文件/URI，**第一个命中的生效**，全不命中走最后兜底：
```nginx
location / {
    try_files $uri $uri/ /index.html;   # 文件 → 目录 → 兜底 index.html
}
```
- `$uri`：真实文件路径；`$uri/`：目录（会找 index）；`/index.html`：最后兜底（内部重定向）。

**口诀：** `try_files 依次找，找到即停，找不到走最后一个。`

**加分点：** 是 **SPA history 路由刷新不 404** 的核心方案；也可配合 `=404` 显式兜底。

### 6.6 SPA history 路由刷新 404 怎么解决？【必背】

**答案骨架：** 原因：前端 history 路由刷新时，浏览器请求真实路径（如 /user/123），Nginx 找不到该文件 → 404。解决：**所有非文件请求都回退到 index.html**（由前端路由接管）：

```nginx
location / {
    root /data/dist;
    try_files $uri $uri/ /index.html;
}
location /assets/ {        # 静态资源目录要单独放行
    root /data/dist;
    expires 30d;
}
```

**口诀：** `try_files 兜底 index.html，静态资源目录单独放行。`

**加分点：** 面试追问：API 请求不能也兜底到 index.html → API 用独立 location 转发后端；否则接口 404 会返回 HTML。

---

## 07 限流与访问控制

### 7.1 漏桶 vs 令牌桶？【必背】

**答案骨架：**
- **漏桶（Leaky Bucket）**：请求像水进桶，桶底按**固定速率**漏水 → **限速恒定**，溢出则丢弃/排队。适合**平滑突发、保护后端**（nginx limit_req 默认漏桶）。
- **令牌桶（Token Bucket）**：按固定速率往桶里**加令牌**，请求要拿令牌才能走 → **允许一定突发**（桶里攒的令牌可瞬间消耗）。适合**允许短时突刺**。

**口诀：** `漏桶：进多出少，速率恒定；令牌桶：攒令牌，允许爆发。`

**加分点：** Nginx 的 limit_req 是漏桶；令牌桶一般用 Redis 实现（Lua/Java）或在网关层（如 Kong/APISIX）配置。

### 7.2 limit_req 配置与 burst/nodelay？【必背】

**答案骨架：**
```nginx
limit_req_zone $binary_remote_addr zone=req:10m rate=10r/s;
server {
    location /api/ {
        limit_req zone=req burst=20 nodelay;
    }
}
```
- `rate=10r/s`：平均速率 10 请求/秒（漏桶出口）。
- `burst=20`：桶容量，允许**瞬时多来 20 个**（排队或直接过）。
- `nodelay`：突发请求**不排队**、直接放行（配合 burst 用）；不加 nodelay 则超出平均速率的请求会被**延迟**（排队）。
- 超限返回 503（可 `limit_req_status 429`）。

**口诀：** `rate 定平均，burst 给余量，nodelay 不排队 —— 三件套。`

**加分点：** 排队 vs nodelay 是经典追问：有 nodelay 时突发立即处理但总量受 rate 约束；无 nodelay 时突发被延迟到"匀速"，体验差但后端稳。

### 7.3 limit_conn 连接数限制？【中频】

**答案骨架：**
```nginx
limit_conn_zone $binary_remote_addr zone=conn:10m;
server {
    location /download/ {
        limit_conn conn 5;   # 每个 IP 最多 5 个并发连接
        limit_conn_status 503;
    }
}
```
- 按 key（IP/UA 等）限制**并发连接数**，区别于 limit_req 的**请求速率**。

**口诀：** `limit_req 限速率，limit_conn 限并发。`

**加分点：** 下载站限并发常用；也可按 `$server_name` 限制全站连接数。

### 7.4 allow / deny 访问控制？【基础】

**答案骨架：**
```nginx
location /admin/ {
    allow 192.168.1.0/24;
    allow 10.0.0.1;
    deny all;           # 兜底拒绝
}
```
- 按**顺序**匹配：从上到下，第一个命中的生效。

**口诀：** `先 allow 白名单，再 deny all 兜底 —— 顺序就是规则。`

**加分点：** 更细的控制用 `geo` 模块按 IP 分段给变量，再配合 if/limit；或 `auth_basic` 基础认证、`auth_request` 统一鉴权。

### 7.5 防盗链 + 接口防刷？【高频】

**答案骨架：**
```nginx
# 防盗链：校验 Referer
location ~* \.(gif|jpg|png)$ {
    valid_referers none blocked *.example.com;
    if ($invalid_referer) { return 403; }
}
```
- 接口防刷三件套：**limit_req（速率）+ limit_conn（并发）+ 业务层验证码/Token 鉴权**。

**口诀：** `防盗链看 Referer，防刷靠 限速 + 限连 + 验证码。`

**加分点：** Referer 可伪造，真正防盗链要**签名 URL（时间戳 + token）**；防刷要结合登录态、设备指纹、风控。

---

## 08 HTTPS 与安全

### 8.1 HTTPS 配置与握手流程？【必背】

**答案骨架：**
```nginx
server {
    listen 443 ssl;
    server_name example.com;
    ssl_certificate     /etc/nginx/cert.pem;      # 证书（含公钥）
    ssl_certificate_key /etc/nginx/cert.key;      # 私钥
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    # 80 端口跳转
}
```
- **握手流程（TLS 1.2）**：ClientHello → ServerHello + 证书 → 客户端验证证书 → 密钥交换（ECDHE/RSA）→ 双方生成会话密钥 → 对称加密通信。
- 混合加密：**非对称（握手换密钥）+ 对称（传输数据）**。

**口诀：** `证书验身、非对称换钥、对称传数 —— TLS 三连。`

**加分点：** 证书链要配全（含中间证书），否则部分客户端报错；`ssl_session_cache shared:SSL:10m` 复用会话省握手。

### 8.2 HTTPS 性能怎么优化？【进阶】

**答案骨架：**
1. `ssl_session_cache shared:SSL:10m`（会话复用，省完整握手）。
2. `ssl_session_timeout 10m`（会话过期）。
3. **TLS 1.3**：1-RTT，会话恢复 0-RTT，握手更快。
4. `ssl_ecdh_curve` 用高效曲线；OCSP Stapling（`ssl_stapling on`）减少证书验证往返。
5. HTTP/2 多路复用，一个连接并发请求。

**口诀：** `会话缓存省握手，TLS1.3 减往返，HTTP/2 复连接。`

**加分点：** OCSP Stapling 由服务器代查证书吊销状态并缓存，客户端少一次外呼。

### 8.3 HTTP/2 特性？【中频】

**答案骨架：**
- **二进制分帧**（不再文本解析）。
- **多路复用**：一个 TCP 连接并发多个请求（解决队头阻塞 I）。
- **头部压缩 HPACK**（静态+动态表）。
- **服务端推送 Server Push**（HTTP/2 原生，后被 HTTP/3 移除）。
- 开启：`listen 443 ssl http2;`。

**口诀：** `二进制、多路复用、头压缩、服务端推送 —— H2 四宝。`

**加分点：** 追问：HTTP/2 的**队头阻塞仍在 TCP 层**（丢包重传阻塞），HTTP/3（QUIC，基于 UDP）彻底解决。

### 8.4 HSTS 与安全响应头？【基础】

**答案骨架：**
```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Content-Security-Policy "default-src 'self'" always;
```
- HSTS：告诉浏览器**强制 HTTPS** 访问，防降级攻击/SSL 剥离。

**口诀：** `HSTS 锁 HTTPS，CSP 锁资源，X-Frame 锁嵌套。`

### 8.5 安全加固清单？【高频】

**答案骨架：**
1. 隐藏版本号：`server_tokens off;`。
2. 禁用不安全的 HTTP 方法：只留 GET/HEAD/POST（if 判断 method 返回 405）。
3. 限制请求体：`client_max_body_size 10m;`（防大包攻击）。
4. 限制超时与连接：`client_body_timeout`、limit_conn。
5. 防目录遍历：`autoindex off;`（默认关）。
6. 防 SQL 注入/XSS 由业务层处理，Nginx 可加 WAF（ModSecurity / OpenResty）。
7. 最小权限：worker 用低权限用户跑。

**口诀：** `藏版本、禁方法、限体积、限并发、关列表、上 WAF、低权限。`

---

## 09 高可用架构

### 9.1 Keepalived + VIP 方案？【必背】

**答案骨架：**
- 两台 Nginx（主/备）跑 keepalived，共享一个**虚拟 IP（VIP）**，客户端只访问 VIP。
- keepalived 用 **VRRP 协议**：主节点定期发心跳，备节点收不到（超时）就**抢 VIP** 顶上。
- 故障检测：keepalived 通过脚本检查 nginx 进程/端口，挂了先降级再切 VIP。

**口诀：** `VIP 是招牌，VRRP 是心跳，谁活着谁扛招牌。`

**加分点：** 追问：主备切换时间（默认秒级）；业务无感知靠**连接迁移**难，一般配合 DNS 短 TTL 或 LVS。

### 9.2 脑裂问题？【进阶】

**答案骨架：**
- **脑裂**：主备之间的心跳断了（网络分区），**两边都以为自己是主**，都绑 VIP → 双主写冲突、服务紊乱。
- 解决：① 心跳走**独立网卡/专线**；② 仲裁机制（`nopreempt`、脚本连第三方仲裁如数据库/锁）；③ VRRP 选举依赖优先级 + 多播隔离；④ 监控告警。

**口诀：** `心跳断了就分裂，仲裁+隔离治脑裂。`

**加分点：** 云环境用云厂商 HA（如腾讯云 CLB / 阿里 SLB）更省心，天然解决脑裂。

### 9.3 LVS + Nginx 四七层架构？【进阶】

**答案骨架：**
- **LVS（四层）**：工作在传输层，只做 IP+端口转发，**不解析 HTTP**，性能极高（DR 模式转发效率最高），扛大流量。
- **Nginx（七层）**：应用层，做路由、rewrite、缓存、限流。
- 经典分层：**DNS/LB（四层 LVS）→ Nginx（七层）→ 应用集群**；LVS 在前面挡流量，Nginx 精细化分发。

**口诀：** `LVS 挡前面扛流量，Nginx 在后面精分发 —— 四层粗筛，七层细磨。`

**加分点：** LVS 三种模式：NAT（改写地址）、DR（改 MAC，回包直连）、TUN（隧道）；DR 性能最好，要求后端和 LVS 同网段。

### 9.4 平滑升级与回滚细节？【高频】

**答案骨架：**
1. `kill -USR2 旧master` → 启动新 master + 新 worker（新老共存，新连接进新版）。
2. `kill -WINCH 旧master` → 旧 worker 优雅退出（存量连接处理完）。
3. `kill -QUIT 旧master` → 彻底退出旧进程。
- **回滚**：旧二进制保留为 `nginx.oldbin`，重复 USR2/WINCH 流程切回去。

**口诀：** `USR2 上新，WINCH 退旧，QUIT 收尾；回滚再走一遍。`

### 9.5 多级缓存架构与 CDN？【进阶】

**答案骨架：**
- 访问链路：**浏览器缓存 → CDN 边缘 → LVS → Nginx（proxy_cache）→ 应用 → 数据库**。
- CDN：就近缓存静态资源，回源到源站（源站可用 Nginx 做缓存层）。
- 缓存刷新：CDN 按 URL/目录刷新、带版本号资源天然隔离。

**口诀：** `近处先挡：浏览器、CDN、Nginx 缓存；逐级回源。`

**加分点：** 缓存一致性：资源带 contenthash 最稳；动态接口用 `Cache-Control: no-store` 或短 TTL。

---

## 10 日志与监控

### 10.1 access_log 格式与字段？【高频】

**答案骨架：**
```nginx
log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                '$status $body_bytes_sent "$http_referer" "$http_user_agent" '
                '$request_time $upstream_response_time $upstream_addr';
access_log /var/log/nginx/access.log main;
```
关键字段：`$remote_addr`（客户端 IP）、`$status`（状态码）、`$request_time`（总耗时）、`$upstream_response_time`（后端耗时）、`$upstream_addr`（哪台上游）。

**口诀：** `IP、时间、请求、状态、大小、Referer、UA、耗时 —— 一条全记录。`

**加分点：** `$request_time - $upstream_response_time` 可估算 Nginx 自身耗时（排队/网络）。

### 10.2 日志切割方案？【高频】

**答案骨架：**
- 方案一（官方）：`nginx -s reopen` + 外部定时（logrotate）：
```bash
# logrotate daily
/var/log/nginx/*.log {
    daily; rotate 30; compress;
    postrotate { /usr/sbin/nginx -s reopen; }
}
```
- 方案二：`access_log` 支持 `timeiso8601` 变量按时间动态分文件（生产不推荐，句柄多）。
- 方案三：切割后必须 `nginx -s reopen`（USR1 信号），让 nginx 重开新文件句柄。

**口诀：** `移动旧日志 → USR1/reopen 开新句柄 —— 两步切日志。`

**加分点：** 忘记 reopen 会导致日志继续写旧文件（句柄未释放），磁盘不释放。

### 10.3 stub_status 监控指标？【中频】

**答案骨架：**
```nginx
location /nginx_status {
    stub_status on;
    allow 127.0.0.1;  deny all;
}
```
输出字段：`Active connections`（活跃连接）、`accepts`（累计接受）、`handled`（累计处理）、`requests`（累计请求）、`Reading/Writing/Waiting`（读/写/空闲 keepalive 连接）。

**口诀：** `活跃数、累计量、Reading/Writing/Waiting 三态。`

**加分点：** 判断连接泄漏：`requests/handled` 长期小于 100% 说明有连接未正常处理；Waiting 太多说明 keepalive 空闲多。

### 10.4 502 / 504 / 499 怎么排查？【必背】

**答案骨架：**
- **502 Bad Gateway**：Nginx 拿到**无效响应** —— 后端挂了/没起来/端口错/超时/防火墙。排查：后端进程、端口、日志。
- **504 Gateway Timeout**：Nginx 等后端响应**超时** —— 后端慢或卡死。排查：调大 `proxy_read_timeout`、查后端慢查询/死锁。
- **499 Client Closed Request**：**客户端主动断开**（Nginx 已发出请求但客户端等不及关了）—— 不是后端错误！排查：客户端超时设置、接口是否太慢、App 弱网。

**口诀：** `502 后端挂，504 后端慢，499 客户端跑。`

**加分点：** 499 常见于移动端/网关超时设置过短；大量 499 说明接口响应太慢，客户端等不起。

### 10.5 常见 HTTP 状态码速记？【基础】

**答案骨架：** `200 成功 / 301 永久跳转 / 302 临时跳转 / 304 协商缓存未变 / 400 参数错 / 401 未认证 / 403 无权限 / 404 不存在 / 405 方法不允许 / 408 请求超时 / 413 请求体过大 / 429 限流 / 500 服务器错 / 502 网关错 / 503 服务不可用（过载/维护）/ 504 网关超时 / 499 客户端断开`。

**口诀：** `4 开头客户端错，5 开头服务器错，502/504 网关在中间。`

---

## 11 性能优化

### 11.1 Nginx 性能优化清单？【必背】

**答案骨架：**
1. `worker_processes` = CPU 核数；`worker_cpu_affinity` 绑核。
2. `worker_connections` 调大到 4096~10240；`worker_rlimit_nofile` = worker_connections × 2。
3. `use epoll`；开启 `accept_mutex` / reuseport。
4. `sendfile on; tcp_nopush on; tcp_nodelay on;`。
5. gzip/Brotli 压缩文本资源。
6. 静态资源 `expires` 长缓存 + contenthash。
7. 上游 `keepalive 32` 长连接。
8. proxy 缓冲（buffering）挡慢客户端。
9. 系统内核参数：`net.core.somaxconn`、`net.ipv4.tcp_tw_reuse`、`file-max`。
10. 日志异步/最小化（`access_log off` 或 buffer）。

**口诀：** `进程绑核、连接放大、零拷贝三件套、压缩缓存长连接、内核参数跟紧。`

### 11.2 内核参数调优？【进阶】

**答案骨架：**
```bash
net.core.somaxconn = 65535        # accept 队列长度
net.ipv4.tcp_max_syn_backlog = 65535  # 半连接队列
net.ipv4.tcp_tw_reuse = 1         # TIME_WAIT 复用
net.ipv4.tcp_fin_timeout = 30     # 快速回收
net.core.rmem_max / wmem_max     # 内核 socket 缓冲上限
fs.file-max = 1000000             # 全局 fd 上限
```
注意：`tcp_tw_recycle` 已废弃（NAT 环境出问题），别再开。

**口诀：** `队列放大、TIME_WAIT 复用、fd 上限抬 —— 三块大头。`

### 11.3 压测工具与指标？【进阶】

**答案骨架：**
- 工具：`ab -n 100000 -c 1000 URL`、`wrk -t8 -c1000 -d30s URL`、`hey`、`JMeter`。
- 核心指标：**QPS/RPS**（每秒请求）、**TPS**（每秒事务）、**平均/TP99 延迟**、**错误率**、**CPU/内存/连接数**。
- 压测结论关注：瓶颈在 Nginx 还是在后端（看 `$upstream_response_time` vs `$request_time`）。

**口诀：** `QPS 看吞吐，TP99 看体验，错误率看稳定。`

**加分点：** 压测要分开打：纯静态（测 Nginx 上限）和走后端（测全链路），才能定位瓶颈。

### 11.4 慢客户端攻击防护？【进阶】

**答案骨架：** Slowloris 攻击 = 慢速发请求头占住连接不释放，耗尽连接数。
- 防护：`client_header_timeout 10s`（头超时）、`client_body_timeout 10s`（体超时）、`client_max_body_size` 限体积、`limit_conn` 限并发、`keepalive_timeout 65`、超时缩小到 5~10s。

**口诀：** `把超时调小、连接限住 —— 慢速攻击就废了。`

---

## 12 源码原理

### 12.1 内存池 ngx_pool_t？【进阶】

**答案骨架：**
- 每个**连接/请求**分配一个内存池，小块内存直接从池里切（链表管理大块），**请求结束整池释放**。
- 好处：减少 malloc/free 次数、避免内存碎片、提高分配速度。
- 关键点：池是**一次性释放**，生命周期跟随请求。

**口诀：** `一请求一池，池随请求生，池随请求亡。`

**加分点：** 大块内存（> pool->max）走独立 malloc 挂到池链表，释放时统一回收。

### 12.2 模块化与 HTTP 阶段钩子？【进阶】

**答案骨架：**
- Nginx 是**模块化架构**：核心 + 功能模块（http/stream/event/过滤链）。
- HTTP 处理被拆成**11 个阶段**：`post_read → rewrite → find_config(location 匹配) → rewrite 再检查 → preaccess → access → post_access → try_files(precontent) → content → log`。
- 内容阶段（content）决定"谁来响应"（static/proxy/fastcgi）；**过滤链**（header filter / body filter）依次加工响应（gzip、sub_filter）。

**口诀：** `阶段拆流程、过滤链加工 —— 请求像流水线过 11 关。`

**加分点：** 官方文档有 PHASE 图；面试能说出"location 匹配发生在 find_config 阶段、limit_req 在 preaccess"就加分。

### 12.3 核心数据结构速览？【进阶】

**答案骨架：**
- `ngx_connection_t`：连接对象（fd、读写事件、缓冲）。
- `ngx_event_t`：事件对象（回调 handler、超时、标志）。
- `ngx_http_request_t`：请求对象（方法、URI、头、连接、阶段）。
- `ngx_chain_t` / `ngx_buf_t`：**缓冲链表**，贯穿读写（零拷贝的数据载体）。
- `ngx_pool_t`：内存池。
- `ngx_queue_t` / `ngx_rbtree_t`（红黑树）：定时器、epoll fd 管理。

**口诀：** `连接、事件、请求三巨头，buf 链传数据，池管内存，红黑树管定时器。`

### 12.4 从源码角度回答"为什么 Nginx 能撑高并发"？【高频】

**答案骨架：**
1. **事件模型**：epoll 就绪通知，worker 进程内一个循环管所有 fd（`ngx_event_process`）。
2. **无阻塞**：socket 全部非阻塞 + 事件驱动，没有线程睡等。
3. **无锁/少锁**：worker 尽量无共享数据，连接分配用原子操作（`ngx_atomic_*`）。
4. **内存池**：请求级分配，快速且无碎片。
5. **零拷贝**：sendfile 内核搬数据。
6. **多进程**：master 管理 + worker 干活，单 worker 崩溃不影响整体。

**口诀：** `epoll 通知 + 非阻塞 + 原子无锁 + 内存池 + sendfile + 多进程 —— 源码级六连。`

### 12.5 源码级高频追问？【进阶】

**答案骨架：**
- **worker 之间怎么负载均衡连接？** accept_mutex 锁 / reuseport 内核哈希。
- **一个请求生命周期经过哪些结构？** listen socket → ngx_connection_t → 读事件 → ngx_http_request_t → 阶段处理 → 过滤链 → 写事件。
- **Nginx 为什么不用多线程？** 进程隔离更稳、避免锁竞争、事件驱动本来就不需要线程池（对比 Java Netty 需要线程池执行回调）。
- **reload 时旧请求怎么处理？** 旧 worker 继续处理存量连接直到完成或超时（worker_shutdown_timeout）。
- **keepalive 连接归谁？** 空闲 keepalive 连接挂在 worker 的事件循环里，只占 fd 不占 CPU。

**口诀：** `追问万变不离其宗：连接归事件循环，请求走阶段钩子，内存走请求池。`

---

## 13 场景题与快问快答

### 13.1 前端项目（Vue/React history 路由）部署？【必背】

**答案骨架：**
```nginx
server {
    listen 80;
    server_name example.com;
    root /data/dist;
    index index.html;

    location /assets/ { expires 30d; }         # 静态资源长缓存
    location /api/    { proxy_pass http://backend; }  # 接口转后端
    location / {
        try_files $uri $uri/ /index.html;      # 前端路由兜底
    }
}
```
要点：**history 路由兜底 index.html + 接口单独转发 + 静态资源长缓存**。

**口诀：** `资源长缓存、接口走代理、页面兜底 index.html。`

### 13.2 跨域（CORS）怎么配？【高频】

**答案骨架：**
```nginx
location /api/ {
    add_header Access-Control-Allow-Origin  $http_origin always;
    add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;
    add_header Access-Control-Allow-Credentials true always;
    if ($request_method = OPTIONS) { return 204; }   # 预检直接回
    proxy_pass http://backend;
}
```
要点：**预检 OPTIONS 直接 204 返回，不转发后端**；带凭证时 Allow-Origin 不能是 `*`。

**口诀：** `OPTIONS 预检自己扛，CORS 头加三件套，带 cookie 不能写 *。`

### 13.3 大文件上传/下载？【中频】

**答案骨架：**
```nginx
client_max_body_size 100m;              # 上传大小限制
proxy_request_buffering off;            # 大上传关缓冲，边收边转
location /download/ {
    sendfile on; tcp_nopush on;          # 下载零拷贝
}
```
- 下载支持 Range 断点续传（原生）；上传一般配合后端分片（业务层）。

**口诀：** `上传限体积、关缓冲；下载 sendfile + Range。`

### 13.4 WebSocket / SSE / 直播流？【中频】

**答案骨架：**
- **WebSocket**：Upgrade 头 + HTTP 1.1 + 大超时（见 3.4）。
- **SSE**：`proxy_buffering off`（或 `X-Accel-Buffering: no`）+ 长超时。
- **直播（HLS/RTMP）**：HLS 是切片文件（静态/缓存友好）；RTMP 需编译 `ngx_rtmp_module`。

**口诀：** `WS 升级协议、SSE 关缓冲、HLS 静态切片。`

### 13.5 网关能力组合（鉴权+限流+灰度+日志）？【进阶】

**答案骨架：**
```nginx
# 统一入口：一个 server 里组合
location /api/ {
    limit_req zone=req burst=20 nodelay;   # ① 限流
    auth_request /auth;                    # ② 鉴权（auth_request 模块）
    proxy_set_header X-Canary $http_canary;# ③ 灰度（配合 map）
    access_log /data/log/gateway.log main; # ④ 统一日志
    proxy_pass http://backend;             # ⑤ 转发
}
location = /auth { internal; proxy_pass http://auth_service; }  # 内部鉴权端点
```
要点：`auth_request` 把鉴权交给独立服务，返回 200 放行、401/403 拦截。

**口诀：** `限流 → 鉴权 → 灰度 → 日志 → 转发，网关五连。`

**加分点：** 更复杂网关直接上 OpenResty（Lua）或 APISIX/Kong。

### 13.6 快问快答 15 连【高频】

**Q1. reload 和 restart 区别？** reload 平滑（旧连接不断），restart 全断。
**Q2. Nginx 默认 worker 数？** 1，生产设 CPU 核数。
**Q3. 惊群怎么解决？** accept_mutex / reuseport。
**Q4. 最大并发怎么算？** worker × connections ÷ 4。
**Q5. proxy_pass 末尾带不带 /？** 带则替换前缀，不带原样传。
**Q6. root 和 alias？** root 拼接，alias 替换。
**Q7. location 匹配优先级？** = > ^~ > ~ > 最长前缀。
**Q8. rewrite last 和 break？** last 重新匹配 location，break 停在本 location。
**Q9. 限流默认返回码？** 503，可改 429。
**Q10. 502/504/499 含义？** 后端挂/后端慢/客户端断开。
**Q11. 怎么拿真实 IP？** X-Real-IP + X-Forwarded-For（可信代理内）。
**Q12. HTTPS 握手为什么快不了？** 非对称协商慢，用会话缓存/TLS1.3 优化。
**Q13. HTTP/2 队头阻塞还在吗？** TCP 层还在，HTTP/3（QUIC）解决。
**Q14. 为什么 Nginx 不用多线程？** 多进程隔离稳 + 事件驱动无需线程池。
**Q15. 后端挂了缓存怎么兜底？** proxy_cache_use_stale。

### 13.7 送命题：OpenResty / 网关怎么答？【进阶】

**答案骨架：**
- **OpenResty** = Nginx + LuaJIT + 丰富模块，在 Nginx 阶段钩子里写 Lua 逻辑（限流、鉴权、动态路由、聚合 API）。
- 与 Spring Cloud Gateway / APISIX / Kong 对比：OpenResty/APISIX 性能最高（C+Lua）、动态能力强；Java 网关生态好、易二次开发。
- 选型：**入口流量巨大选 OpenResty 系，业务复杂团队 Java 系**。

**口诀：** `Nginx 是"死配置"，OpenResty 是"活逻辑"，网关是"全家桶"。`

---

> 背诵节奏建议：第 1 遍只背"口诀"；第 2 遍背"答案骨架"；第 3 遍口述"加分点"；考前只看"追问"。
> 祝面试顺利，Offer 到手 🎉
