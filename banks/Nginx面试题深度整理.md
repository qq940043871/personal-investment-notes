# Nginx 深度面试题库

> 全栈架构师 · 面试考点全覆盖
> 覆盖 13 大章节 86 题：基础认知 → 高性能原理 → 反向代理 → 负载均衡 → 静态资源与缓存 → location/rewrite → 限流与访问控制 → HTTPS 与安全 → 高可用 → 日志与监控 → 性能优化 → 源码级原理 → 场景题。

---

## 01 基础认知与核心概念

### 1.1 Nginx 是什么？主要特点与适用场景？【高频】
**Nginx**（engine X）是一个高性能的 **HTTP 服务器 / 反向代理服务器 / 邮件代理服务器**，由俄罗斯人 Igor Sysoev 于 2004 年开源，C 语言编写。

核心特点：
- **高并发**：单机可支撑 **5万~10万** 并发连接（事件驱动 + 异步非阻塞 I/O），远胜 Apache。
- **低资源占用**：一个 worker 进程即可处理大量连接，内存占用小。
- **高扩展性**：模块化设计，功能可插拔（gzip、ssl、proxy、rewrite、stream 等）。
- **高可靠性**：master 管理 + 多 worker，进程互相隔离，可平滑升级、热部署。

适用场景：
- **Web 服务器**：托管静态资源（HTML/JS/CSS/图片），性能极佳。
- **反向代理**：统一入口转发到后端应用（Tomcat、Spring Boot、Go、Node 等）。
- **负载均衡**：将请求分发到多台后端服务器。
- **网关/入口**：统一鉴权、限流、灰度、日志记录。
- **缓存服务器**：静态资源缓存、代理缓存、CDN 边缘节点。

> 加分点：Nginx 的高性能不是靠"单进程事件驱动"这一个点，而是 **进程模型（master/worker）+ 事件驱动 + 异步非阻塞 + 模块化 + 内存池** 的组合拳。

### 1.2 正向代理 vs 反向代理？【高频】

| 维度 | 正向代理 | 反向代理 |
|---|---|---|
| 代理对象 | **客户端**（替客户端访问服务器） | **服务器**（替服务器接收请求） |
| 位置 | 客户端一侧 | 服务器一侧 |
| 服务器感知 | 服务器不知道真实客户端，只看到代理 | 客户端不知道真实服务器，只看到代理 |
| 典型场景 | 翻墙、公司上网代理、抓包工具 | 负载均衡、网关、CDN 回源 |
| 配置位置 | 客户端（浏览器/系统代理） | 服务器端 nginx.conf |

一句话记忆：**正向代理隐藏客户端，反向代理隐藏服务器**。

> 追问：Nginx 默认就是反向代理的角色。做正向代理需要配置 `resolver` + `proxy_pass $http_host$request_uri`，且只支持 HTTP 协议（商业版/OpenResty 可扩展）。

### 1.3 Nginx vs Apache：为什么 Nginx 更适合高并发？【高频】

| 对比项 | Nginx | Apache |
|---|---|---|
| 架构 | 事件驱动 + 异步非阻塞 | 进程/线程池（MPM 模式），每连接一线程 |
| 并发能力 | 高（几万~十万） | 低（几千），受线程数限制 |
| 资源占用 | 低 | 高（每连接独立线程栈） |
| 静态文件 | 极快（sendfile + 零拷贝） | 一般 |
| 动态处理 | 弱（需 fastcgi/uwsgi 转发） | 强（PHP 等模块内置） |
| 配置灵活性 | .htaccess 不支持 | 支持 .htaccess 目录级配置 |
| 稳定性 | 高 | 高 |

> 结论：**静态资源 + 高并发入口用 Nginx，动态应用处理 + 目录级灵活配置用 Apache**；现代架构主流是 Nginx 做入口，动态请求转发给后端（PHP-FPM、Tomcat 等）。

### 1.4 进程模型：master 与 worker 各司其职【高频】
Nginx 采用 **master + worker 多进程** 模型（还有 cache manager / cache loader 两个辅助进程）：

- **master 进程**：不处理业务请求，只做管理——读取配置、fork 出 worker、接收信号（HUP/QUIT/USR2 等）、监控 worker 健康、平滑升级。
- **worker 进程**：真正处理请求。多个 worker 通过 **事件循环** 并发处理海量连接，互相独立、互不干扰。
- **cache manager**：定时清理过期缓存。
- **cache loader**：启动时把磁盘缓存加载到内存索引。

关键点：
- worker 数量默认 1，建议设为 **CPU 核数**（避免过多进程切换开销）。
- worker 之间通过 **共享内存**（如 limit_req 的计数）通信，通过 **accept_mutex / reuseport** 协调新连接分配。
- 一个 worker 挂了不影响其他 worker，master 会自动拉起新的。

> 加分点：为什么不用多线程？因为**高并发场景下多进程比多线程更稳定**——进程内存隔离，不会因某个请求的 bug 拖垮整个服务；且避免了线程切换和锁竞争。

### 1.5 为什么 Nginx 性能高？核心优势总结【高频】
1. **事件驱动模型**：基于 epoll/kqueue，一个进程可以同时监听数万个 socket，**没有阻塞**。
2. **异步非阻塞 I/O**：读写不等待，事件就绪才处理，CPU 利用率高。
3. **多进程 + 无锁设计**：worker 进程间尽量无共享状态，减少锁竞争（连接分配用原子操作）。
4. **内存池**：每个请求使用独立内存池，减少 malloc/free 次数和内存碎片。
5. **零拷贝**：静态文件用 `sendfile` 直接在内核态拷贝，不经用户态。
6. **模块化 + 精简**：核心很小，功能按需编译加载。

> 对比：传统阻塞式服务器（每连接一线程）在高并发下会因线程过多导致上下文切换开销巨大、内存耗尽。Nginx 用"少量进程处理海量连接"的思路解决了这个问题。

### 1.6 配置文件结构：nginx.conf 由哪些部分组成？【基础】
nginx.conf 主要包含以下块：

| 块 | 作用 | 层级 |
|---|---|---|
| `main`（全局块） | 全局配置：worker_processes、user、pid、error_log | 最外层 |
| `events` | 事件模型配置：worker_connections、epoll、accept_mutex | 全局 |
| `http` | HTTP 服务配置：server、upstream、gzip、proxy 等 | 全局 |
| `server` | 虚拟主机配置：监听端口/域名、location、ssl | http 内 |
| `location` | URI 匹配与请求处理规则 | server 内 |
| `upstream` | 后端服务器组（负载均衡池） | http 内 |
| `stream` | 四层（TCP/UDP）代理配置 | 全局（需编译 stream 模块） |

示例骨架：

```nginx
user nginx;                  # main
worker_processes auto;       # 与 CPU 核数一致
error_log /var/log/nginx/error.log warn;

events {
    worker_connections 1024; # 单 worker 最大连接数
    use epoll;               # Linux 事件模型
}

http {
    include mime.types;
    sendfile on;
    upstream backend {       # 负载均衡池
        server 10.0.0.1:8080 weight=2;
        server 10.0.0.2:8080 weight=1;
    }
    server {                 # 虚拟主机
        listen 80;
        server_name example.com;
        location /api/ {
            proxy_pass http://backend;
        }
    }
}
```

> 注意：`events`、`http`、`stream` 是平级的顶层块，`server` 必须在 `http`（或 `stream`）内，`location` 必须在 `server` 内。

### 1.7 Nginx 模块化架构【进阶】
Nginx 功能由模块实现，编译时通过 `--with-xxx` / `--without-xxx` 控制：

- **核心模块**：ngx_core_module（主进程）、ngx_events_module（事件）等，必须存在。
- **标准模块**：http_core、http_proxy、http_upstream、http_gzip、http_ssl、http_rewrite、http_limit_req 等。
- **第三方模块**：lua（OpenResty）、headers-more、echo、stream 等。

模块类型（按处理阶段）：
- **Handler 模块**：处理请求，生成响应（如 static、proxy、fastcgi）。
- **Filter 模块**：对响应内容做后处理（如 gzip、sub_filter 替换、ssi）。
- **Upstream 模块**：实现负载均衡逻辑（如 proxy、memcached、fastcgi 的 upstream）。
- **Load-Balance 模块**：upstream 中选择后端服务器的算法。

> 加分点：**OpenResty = Nginx + LuaJIT + 大量模块**，通过 Lua 在 Nginx 各阶段（rewrite/access/content 等）注入业务逻辑，是 API 网关（Kong、APISIX）的基石。

### 1.8 Nginx 常见的几种工作角色【基础】
1. **静态 Web 服务器**：直接返回磁盘文件。
2. **反向代理服务器**：转发到后端应用。
3. **负载均衡器**：多后端分发（七层 HTTP / 四层 TCP 均可）。
4. **HTTP 缓存服务器**：CDN 节点，缓存静态资源。
5. **网关**：统一鉴权、限流、灰度、跨域。
6. **邮件代理**：IMAP/POP3/SMTP 代理（远古功能，较少用）。

---

## 02 事件驱动与高性能原理

### 2.1 同步阻塞 / 同步非阻塞 / 异步非阻塞 I/O【高频】
以"读取 socket 数据"为例：

- **同步阻塞（BIO）**：调用 read 后线程阻塞，直到有数据才返回。多路并发需要多线程。
- **同步非阻塞（NIO）**：read 立即返回，没数据返回 EAGAIN，需要**用户态轮询**（忙等，浪费 CPU）。
- **I/O 多路复用**：一次系统调用（select/poll/epoll）监听大量 fd，内核通知"哪些 fd 就绪了"，再对就绪 fd 做非阻塞读写。Nginx/Redis 都采用此方案。
- **异步非阻塞（AIO）**：调用后立即返回，内核完成数据拷贝后通过信号/回调通知，全程不参与（Nginx 对磁盘 I/O 可选 AIO，网络 I/O 用多路复用）。

> 加分点：Nginx 的"异步非阻塞"准确说是 **基于事件驱动（epoll）的非阻塞 I/O 多路复用**，并不是 libuv 式的纯异步回调，两者要区分清楚。

### 2.2 epoll 是什么？为什么比 select/poll 快？【高频】
epoll 是 Linux 2.6 引入的高性能 I/O 多路复用接口，核心 API：`epoll_create`、`epoll_ctl`、`epoll_wait`。

对比 select/poll 的优势：

| 维度 | select/poll | epoll |
|---|---|---|
| 最大 fd 数 | select 1024（FD_SETSIZE），poll 无上限但数量大时退化 | 无上限 |
| 就绪检测方式 | **每次调用都要把 fd 集合从用户态拷贝到内核态**，内核全量扫描 O(n) | 内核维护**红黑树 + 就绪链表**，只返回就绪 fd O(1) |
| 用户态处理 | 全量遍历找就绪 fd | 直接遍历就绪链表 |
| 触发模式 | 仅水平触发（LT） | **LT + ET（边缘触发）** |

关键概念：
- **LT（水平触发）**：fd 有数据就一直通知，直到处理完；不易漏事件，可能重复唤醒。
- **ET（边缘触发）**：状态变化才通知一次；效率更高，但**必须一次性把数据读完**，否则丢数据。
- Nginx 默认使用 epoll 的 **LT 模式**（更稳妥），通过 `events { use epoll; }` 指定（Linux 下默认就是 epoll，可省略）。

> 追问：epoll 的两个关键数据结构？内核中每个 epoll 实例维护一棵**红黑树**（存储所有注册的 fd）和一个**就绪链表**（存放有事件发生的 fd），epoll_wait 只把就绪链表拷贝给用户态，所以效率与监听数量无关。

### 2.3 Nginx 事件驱动模型工作流程【进阶】
Nginx 每个 worker 内部有一个 **事件循环**（ngx_process_events_and_timers）：

```
循环开始
  ├─ 调用 epoll_wait 等待事件（阻塞/超时）
  ├─ 有新事件？
  │   ├─ 读事件：调用对应 handler（读请求头/读 body/读上游响应）
  │   └─ 写事件：调用对应 handler（写响应给客户端/写上游请求）
  ├─ 处理定时器：检查超时（keepalive 超时、proxy 超时、限速等）
  └─ 回到 epoll_wait 继续等待
```

特点：
- 一个 worker 内的所有连接都由这一个事件循环驱动，**无阻塞操作**。
- 每个连接关联一个状态机（读头 → 读 body → 处理 → 写响应），事件驱动状态机推进。
- 定时器用**红黑树**管理（ngx_event_timer_rbtree），到期事件批量处理。

> 加分点：Nginx 事件循环最核心的函数是 `ngx_process_events_and_timers`，它先处理事件再处理定时器；所谓"高并发"本质是**用极少的线程（worker）高效地轮转处理海量连接的状态机**。

### 2.4 worker 进程数如何设置？【高频】
```nginx
worker_processes 4;     # 或 auto（自动按 CPU 核数）
```
原则：
- 默认 **CPU 核数**（物理核）。例如 8 核 16 线程，一般设为 8 或 auto。
- 设太大会增加**进程切换开销**和内存占用（每个 worker 都有独立的内存副本，含各模块共享内存的拷贝成本）。
- 设太小无法充分利用多核。

进阶配置：
```nginx
worker_processes auto;
worker_cpu_affinity auto;        # worker 绑定 CPU 核，避免缓存抖动
worker_rlimit_nofile 65535;      # 单进程可打开文件数上限（配合 ulimit）
```
- `worker_cpu_affinity`：把每个 worker 绑定到固定 CPU，减少上下文切换和 cache miss。
- 实际经验：**I/O 密集型**可等于核数；**CPU 密集型**（如大量 gzip）可略少；若 worker 常处于空闲，可减少到核数一半。

> 追问：`worker_rlimit_nofile` 不设会怎样？进程默认 fd 上限通常 1024，即使 worker_connections 配了 65535，单 worker 也打不开那么多连接，会报 "too many open files"。

### 2.5 惊群问题与解决（accept_mutex / reuseport）【进阶】
**惊群（thundering herd）**：多个 worker 同时 accept 同一个监听 socket 的新连接，内核唤醒所有 worker，但只有一个能成功，其余白白空转。

Nginx 的解决方式：
1. **accept_mutex**（早期方案）：在 `events` 块开启 `accept_mutex on;`，同一时刻**只有一个 worker 持有 accept 锁**，抢到锁的 worker 才 accept 新连接（批量 accept 后立即释放），避免全部 worker 被唤醒。
2. **SO_REUSEPORT**（Linux 3.9+，Nginx 1.9.1+）：配置 `listen 80 reuseport;`，**每个 worker 独立监听同一个端口**，由内核在多个 socket 间负载均衡分发连接，彻底消除 accept 锁竞争，性能更高。

```nginx
events {
    accept_mutex off;    # 使用 reuseport 时关闭
}
server {
    listen 80 reuseport; # 内核级负载均衡
}
```

> 加分点：reuseport 的代价是**连接分布不保证均匀**（内核按四元组哈希），且在 worker 重启时其 socket 上的已有连接会断开，需权衡；多数场景 Nginx 默认 accept_mutex 足够。

### 2.6 worker_connections 与最大并发数计算【高频】
```nginx
events {
    worker_connections 1024;   # 默认 1024，单 worker 可同时打开的连接数
    use epoll;
}
```
计算模型：
- **总连接数** = `worker_processes × worker_connections`（文件描述符层面的上限）。
- 纯静态资源场景：一个客户端一个连接，最大并发 ≈ 该值。
- **反向代理场景：客户端与上游各占一个连接**，实际最大并发 ≈ `worker_processes × worker_connections / 2`。
- 还要受 `worker_rlimit_nofile`（fd 上限）和系统 `ulimit -n`、`net.core.somaxconn` 限制。

示例：8 worker × 65535 connections = 524,280 个 fd；做反向代理时约支撑 26 万并发连接。

> 追问：系统层面还要调什么？`ulimit -n`（进程 fd 上限）、`net.core.somaxconn`（accept 队列长度）、`net.ipv4.ip_local_port_range`（本地端口范围，影响主动连接上游的数量）、`net.ipv4.tcp_tw_reuse`（TIME_WAIT 复用）。

### 2.7 Nginx 是如何做到平滑 reload / 平滑升级的？【高频】
- **平滑 reload**（改配置生效）：向 master 发送 **HUP** 信号 → master 重新解析配置文件 → 若语法 OK，fork 出**新的 worker 组** → 新连接交给新 worker；旧 worker 处理完已接收的请求后自动退出（优雅退出）。
- **平滑升级**（换二进制）：向 master 发送 **USR2** → master 启动新的 master+worker（新二进制）→ 新老进程同时存在、共享监听端口 → 发 **WINCH** 让旧 worker 优雅退出 → 发 **QUIT** 退出旧 master，完成无缝升级。
- **立即退出**：QUIT（优雅退出，处理完当前请求）、TERM/INT（立即退出）。

| 信号 | 作用 |
|---|---|
| HUP | 平滑重载配置 |
| QUIT | 优雅退出（处理完当前请求） |
| TERM/INT | 立即退出 |
| USR1 | 重新打开日志（日志切割） |
| USR2 | 平滑升级新版本 |
| WINCH | 优雅关闭 worker（配合 USR2 升级） |

> 加分点：reload 不是"重启"，worker 进程号会变、旧连接不断；这也是 Nginx 高可用的体现——**配置文件出错时 reload 会失败但不会影响正在运行的进程**。

---

## 03 反向代理

### 3.1 反向代理的原理与最小配置【高频】
原理：客户端请求 Nginx → Nginx 按照配置**转发请求到上游服务器** → 拿到响应后再返回给客户端。客户端始终只与 Nginx 通信。

```nginx
server {
    listen 80;
    server_name example.com;
    location / {
        proxy_pass http://127.0.0.1:8080;   # 转发到后端
        proxy_set_header Host $host;         # 传递原始 Host
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```
常用指令：
- `proxy_pass`：上游地址（必填）。
- `proxy_set_header`：改写转发请求头。
- `proxy_connect_timeout / proxy_read_timeout / proxy_send_timeout`：连接/读/写超时（默认 60s）。
- `proxy_buffering on/off`：是否缓冲上游响应。
- `proxy_redirect`：改写上游返回的 Location/Refresh 头。

> 追问：反向代理为什么能隐藏后端？因为客户端只能看到 Nginx 的 IP，后端 IP 通过 `proxy_set_header` 只在内网传递，对外不可见；同时 Nginx 层可以做统一入口的鉴权、限流、白名单。

### 3.2 proxy_pass 带路径与不带路径的区别【高频】
这是**最经典的高频陷阱**，区别在于 URI 的处理方式：

- **不带 URI**（proxy_pass 后无 `/`，如 `proxy_pass http://backend;`）：**完整保留原始 URI** 转发。
  ```nginx
  location /api/ { proxy_pass http://backend; }
  # 请求 /api/user?id=1 → 上游收到 /api/user?id=1
  ```
- **带 URI**（proxy_pass 后带 `/` 或路径，如 `proxy_pass http://backend/;`）：**用指定 URI 替换 location 匹配部分**。
  ```nginx
  location /api/ { proxy_pass http://backend/; }
  # 请求 /api/user?id=1 → 上游收到 /user?id=1（/api/ 被替换为 /）
  location /api/ { proxy_pass http://backend/new/; }
  # 请求 /api/user → 上游收到 /new/user
  ```

> 追问：带正则的 location 里能用不带 URI 的 proxy_pass 吗？**不能**。当 location 使用正则（`~`、`~*`）或 `@` 命名 location 时，proxy_pass 必须不带 URI，否则启动报错 `"proxy_pass" cannot have URI part`。

### 3.3 反向代理的请求头传递【基础】
后端要拿到客户端的真实信息，必须显式传递请求头（否则看到的是 Nginx 的 IP/默认头）：

```nginx
proxy_set_header Host $host;                          # 原始 Host（多域名时关键）
proxy_set_header X-Real-IP $remote_addr;              # 客户端真实 IP
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;  # 追加式链路 IP
proxy_set_header X-Forwarded-Proto $scheme;           # http/https 标识（后端判跳转）
proxy_set_header Connection "";                       # 清空 Connection，配合上游长连接
```
- `$proxy_add_x_forwarded_for` = 客户端已有 XFF + `$remote_addr`，**追加而非覆盖**，保留完整链路。
- 如果经过多层代理，取**最左边第一个** IP 是真实客户端（需后端配合解析）。

> 注意：如果 Nginx 前面还有 CDN/其他代理，`$remote_addr` 是上一跳代理的 IP，应优先信任 CDN 传的 XFF/`X-Real-IP`，并做好**白名单校验**防止伪造。

### 3.4 反向代理超时与重试【进阶】
```nginx
proxy_connect_timeout 5s;     # 与上游建立 TCP 连接超时（默认 60s，内网建议调小）
proxy_send_timeout   30s;     # 向上游发送请求超时（两次写操作间隔）
proxy_read_timeout   30s;     # 读取上游响应超时（两次读操作间隔，长接口调大）
proxy_next_upstream  error timeout http_502 http_503 http_504;  # 触发重试的条件
proxy_next_upstream_tries 2;  # 重试次数
```
- **504 Gateway Timeout**：通常是 `proxy_read_timeout` 太小，或上游本身处理慢。
- **502 Bad Gateway**：上游连接失败（服务挂了/端口不对/防火墙）。
- `proxy_next_upstream` 指定哪些情况**换下一个上游重试**；默认对 GET 会重试，**POST 需谨慎**（可能导致重复提交，需接口幂等）。

> 加分点：写操作（POST/PUT）默认也会重试（error 类），生产环境建议显式配置重试策略，并对后端做好**幂等性设计**。

### 3.5 反向代理缓冲（proxy_buffering）【进阶】
```nginx
proxy_buffering on;                        # 默认开启
proxy_buffer_size 4k;                      # 读上游响应头缓冲
proxy_buffers 8 4k;                        # 响应体缓冲块数与大小
proxy_busy_buffers_size 8k;                # 正在发送给客户端时的缓冲上限
proxy_temp_path /var/tmp/nginx_proxy;      # 大响应落盘目录
proxy_max_temp_file_size 1024m;            # 落盘上限
```
原理与取舍：
- **开启缓冲**：Nginx 先**收完上游响应**（或收满缓冲）再发给客户端 → 上游可以快速释放连接，**保护上游**；适合大响应、慢客户端。
- **关闭缓冲**（`proxy_buffering off`）：边收边发 → 客户端首字节更快，适合 **SSE（Server-Sent Events）、WebSocket、直播流**等实时场景。
- 大响应超过 `proxy_busy_buffers_size` 会**临时落盘**（temp 文件），影响性能，可调大内存缓冲。

> 追问：为什么 SSE 必须关缓冲？因为开启缓冲时 Nginx 会等上游响应满缓冲才推送，事件流会卡住；同时还要关闭 gzip、设置长超时。

### 3.6 反向代理如何传递真实 IP？【高频】
核心是三个头：`X-Real-IP`、`X-Forwarded-For`、`X-Forwarded-Proto`。

```nginx
location / {
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```
后端获取方式：
- **Nginx 层**：`$remote_addr` 就是直连客户端 IP（无前置代理时）。
- **Java**：`request.getHeader("X-Forwarded-For")` 取第一个 IP。
- **Go**：`X-Forwarded-For` 头解析。
- **Python（Django/Flask）**：需配置 `REMOTE_ADDR` 信任代理或使用 `ProxyFix` 中间件。

> 加分点：安全要点——XFF 是客户端可伪造的，**最左边 IP 不一定可信**。如果 Nginx 直连客户端，后端应优先信任 `$remote_addr`；若前面有可信 CDN，配置 CDN 白名单后取 CDN 写入的 XFF 最右（或倒数第二）个 IP。

### 3.7 反向代理 WebSocket【高频】
WebSocket 是**长连接双向通信**（基于 HTTP Upgrade），反向代理必须支持协议升级：

```nginx
location /ws/ {
    proxy_pass http://ws_backend;
    proxy_http_version 1.1;                    # 必须 HTTP/1.1（Upgrade 只在 1.1）
    proxy_set_header Upgrade $http_upgrade;    # 透传 Upgrade 头
    proxy_set_header Connection "upgrade";     # 固定为 upgrade
    proxy_read_timeout 3600s;                  # 长连接超时调大（默认 60s 会断）
    proxy_send_timeout 3600s;
}
```
关键点：
1. **HTTP/1.1**：HTTP/1.0 不支持 Upgrade。
2. **Connection "upgrade"**：`$http_upgrade` 有值时必须固定为 upgrade，否则 Nginx 默认转发 "close"。
3. **超时**：WebSocket 是长连接，`proxy_read_timeout` 必须大于心跳间隔，否则 Nginx 会掐断空闲连接。
4. **会话保持**：WebSocket 不支持 HTTP 层面的会话保持（无 Cookie 重定向），必须用 **ip_hash / sticky** 保证同一客户端始终连同一后端（或后端做广播/Redis 同步状态）。

> 追问：WebSocket 负载均衡怎么做？用 `ip_hash` 或第三方 `sticky` 模块按来源 IP/会话粘滞；后端是多实例时还要考虑**跨节点消息同步**（Redis Pub/Sub、MQ）或改造为**无状态**（状态放 Redis/DB）。

---

## 04 负载均衡

### 4.1 Nginx 负载均衡原理【高频】
Nginx 通过 `upstream` 定义**后端服务器池**，`proxy_pass http://池名` 将请求按策略分发给池内服务器。

```nginx
upstream backend {
    server 10.0.0.1:8080;
    server 10.0.0.2:8080;
    server 10.0.0.3:8080;
}
server {
    listen 80;
    location / {
        proxy_pass http://backend;
    }
}
```
- 默认算法：**加权轮询**（round-robin，按权重依次分发）。
- 支持**健康检查**（被动：连续失败 N 次标记 down，自动剔除）。
- 每个 upstream 池还有**会话保持**（ip_hash）、**最少连接**（least_conn）等策略。

> 加分点：upstream 是"逻辑池"，server 可以动态增删（配合 lua-upstream / DNS 动态解析），实现**无损扩缩容**——这是 Nginx 作为网关的核心能力之一。

### 4.2 五大负载均衡算法对比【高频】

| 算法 | 指令 | 原理 | 适用场景 |
|---|---|---|---|
| 轮询 | （默认） | 按顺序逐个分发，权重高的多分 | 后端性能均衡时 |
| 加权轮询 | `weight=N` | 按权重比例分发（权重=处理能力） | 后端配置不一时 |
| IP 哈希 | `ip_hash` | 按客户端 IP 哈希固定到后端 | 需要**会话保持**（无共享 Session） |
| 最少连接 | `least_conn` | 分配给当前活跃连接最少的后端 | 长连接/耗时差异大的接口 |
| URL 哈希 | `hash $request_uri`（第三方/1.7+） | 按 URL 哈希固定后端 | 缓存命中（同一 URL 固定一台） |
| 随机 | `random` | 随机选择（可配 weight） | 大流量下近似均匀 |

示例：
```nginx
upstream backend {
    least_conn;
    server 10.0.0.1:8080 weight=3 max_fails=3 fail_timeout=30s;
    server 10.0.0.2:8080 weight=1;
    server 10.0.0.3:8080 backup;   # 备用，仅当主全部不可用时启用
}
```
> 追问：ip_hash 的坑？① 上游 server 变更（增删）会导致大量用户会话"漂移"；② 若后端走的是 CDN/网关统一出口，客户端 IP 会集中在少数几个，哈希分布不均；③ 无法应对 NAT 场景。现代方案：**Redis 集中式 Session 或 JWT 无状态化**，负载均衡就不需要会话保持。

### 4.3 upstream server 参数详解【高频】

| 参数 | 说明 | 默认 |
|---|---|---|
| `weight` | 权重，越大分到的请求越多 | 1 |
| `max_fails` | 允许连续失败次数，超过则标记不可用 | 1 |
| `fail_timeout` | 失败统计时间窗 + 标记不可用后的**冷却时间** | 10s |
| `backup` | 标记为备用服务器，主全部不可用时才启用 | - |
| `down` | 手动下线（配合平滑摘除） | - |
| `max_conns` | 到该上游的最大并发连接数（限流保护上游） | 0（不限） |
| `resolve` | 配合 resolver 动态解析域名 | - |

> 加分点：`max_fails=0` 表示**不检查健康**（永不标记不可用）。注意 max_fails/fail_timeout 是**被动健康检查**，只对实际转发过的请求计数——没有流量就不会发现故障。

### 4.4 健康检查：被动 vs 主动【进阶】
- **被动检查**（内置）：基于 `max_fails + fail_timeout`，对失败请求计数，超阈值把节点摘除，冷却后自动恢复。**缺点**：没流量就不检查，无法提前发现故障。
- **主动检查**（需 `nginx_upstream_check_module` 第三方模块或 Nginx Plus）：
  ```nginx
  upstream backend {
      server 10.0.0.1:8080;
      check interval=3000 rise=2 fall=3 timeout=1000 type=http;
      check_http_send "GET /health HTTP/1.0\r\n\r\n";
      check_http_expect_alive http_2xx http_3xx;
  }
  ```
  定时主动探测 `/health` 接口，**rise 次成功视为恢复，fall 次失败视为挂掉**，无需流量即可发现故障。
- **实践**：后端自己暴露健康检查接口（如 Spring Boot Actuator `/actuator/health`），Nginx 主动探测；中间件加一层即可实现**优雅上下线**。

### 4.5 负载均衡的会话保持方案【进阶】
1. **ip_hash**：按来源 IP 固定，简单但有 NAT/CDN 出口集中问题。
2. **sticky cookie**（第三方 `nginx-sticky-module`）：首次请求下发 cookie，后续按 cookie 值路由到同一后端，**比 ip_hash 更精确**。
3. **URL hash**：按 URL 固定，适合缓存场景。
4. **推荐**：后端用 **Redis 共享 Session / JWT 无状态**，Nginx 层无需会话保持，任意分发，故障节点摘除不影响用户。

> 追问：为什么不建议依赖 ip_hash？当后端扩容/缩容时哈希结果变化，用户 Session 大面积失效（惊群重登）；且经过 L4 负载均衡后源 IP 可能相同，导致后端负载不均。

### 4.6 灰度发布怎么用 Nginx 实现？【高频】
**场景**：新版本先放给少量用户验证，再逐步放量。

方案一：**按 IP/参数分流**（if + upstream 池）
```nginx
upstream v1 { server 10.0.0.1:8080; }
upstream v2 { server 10.0.0.2:8080; }
server {
    location / {
        set $upstream v1;
        if ($remote_addr ~ "^(192\.168\.1\.100|10\.0\.0\.8)$") { set $upstream v2; }  # 内测 IP 走新版
        if ($arg_ver = "2") { set $upstream v2; }   # 带参数走新版
        proxy_pass http://$upstream;
    }
}
```
方案二：**权重渐进放量**（推荐，平滑可控）
```nginx
upstream backend {
    server 10.0.0.1:8080 weight=9;   # 90% 旧版
    server 10.0.0.2:8080 weight=1;   # 10% 新版 → 逐步调高权重
}
```
方案三：**A/B / 金丝雀**：配合 OpenResty/Lua 按用户特征（uid hash、地域、UA）动态路由；或使用 APISIX/Kong 等网关的灰度插件。

> 加分点：灰度发布的关键不是"转发"，而是**可观测 + 可回滚**——灰度期间要监控新版本错误率/耗时，异常时立即把权重调回或摘除节点（`down` 参数或从 upstream 移除）。

### 4.7 upstream 长连接（keepalive）【进阶】
HTTP/1.0 时代每次请求都新建 TCP 连接，开销大。配置上游长连接：

```nginx
upstream backend {
    server 10.0.0.1:8080;
    keepalive 32;          # 每个 worker 保留 32 个空闲长连接复用
}
server {
    location / {
        proxy_http_version 1.1;          # 上游必须 HTTP/1.1 才能 keepalive
        proxy_set_header Connection "";  # 清空 Connection 头（不传 close）
        proxy_pass http://backend;
    }
}
```
效果：避免频繁 TCP 三次握手 + TLS 握手，**高并发下 QPS 提升明显（尤其 TLS 场景）**。
注意：
- `keepalive N` 是**空闲连接缓存数**，不是并发数；请求多时自然创建更多连接。
- 若上游是 HTTP/1.0（老服务），keepalive 无效。
- Nginx 作为服务端时用 `keepalive_timeout`（默认 75s）控制**客户端长连接**的空闲超时。

> 加分点：为什么 TCP 连接建立成本高？三次握手 1 个 RTT + 慢启动；HTTPS 再加 1-2 个 RTT 的 TLS 握手。连接复用能省掉这几轮网络往返，对跨机房调用收益巨大。

---

## 05 静态资源与缓存

### 5.1 静态资源服务与 root/alias 的区别【高频】
```nginx
server {
    listen 80;
    server_name example.com;
    location /static/ {
        root /data/www;      # root: 完整拼接  → /data/www/static/xxx
    }
    location /images/ {
        alias /data/img/;    # alias: 替换匹配部分 → /data/img/xxx
    }
}
```
**root vs alias 核心区别**：

| 指令 | 拼接规则 | 示例（请求 /static/a.png） |
|---|---|---|
| `root /data/www;` | root + 完整 URI | /data/www/static/a.png |
| `alias /data/img/;` | alias + 去除匹配前缀后的 URI | /data/img/a.png |

> 关键坑：① alias 后**路径结尾的斜杠**与 location 前缀要保持一致（`location /images/` 配 `alias /data/img/;`）；② alias 用于 location 中不能带变量（早期版本）；③ 默认索引 `index` 指令在 root 下才生效；④ alias 通常用于**目录名与磁盘路径不一致**的场景（对外 /static/ 映射到磁盘 /data/www/）。

### 5.2 静态资源缓存策略（浏览器缓存 + 服务端）【高频】
**浏览器缓存**（协商/强缓存）：
```nginx
location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
    expires 30d;                          # 强缓存 30 天：Cache-Control: max-age=2592000
    add_header Cache-Control "public, immutable";  # 不可变，配合 hash 文件名
}
```
- `expires 30d`：自动生成 `Expires` 与 `Cache-Control: max-age`。
- `expires -1`：禁用强缓存，每次走协商缓存。
- 文件名带 **内容 hash**（如 app.a1b2c3.js）时配 `immutable`，发布新版本文件名变化即可。

**服务端缓存**（Nginx 代理缓存，见 5.4）与 **CDN**：静态资源最标准的架构是 **CDN + 源站（Nginx 静态服务）**，浏览器 → CDN 边缘 → 回源 Nginx。

> 追问：缓存更新怎么破？发布时**文件名带 hash**，新版本自动新 URL 不冲突；若接口动态数据，用 `Cache-Control: no-cache`（每次协商）或短 max-age + ETag。

### 5.3 gzip 压缩配置详解【高频】
```nginx
gzip on;
gzip_comp_level 5;                       # 1-9，5 是性价比折中（越高越耗 CPU）
gzip_min_length 1k;                      # 小于 1k 不压缩（压缩收益低）
gzip_types text/plain text/css application/javascript application/json image/svg+xml application/xml;
gzip_vary on;                            # 返回 Vary: Accept-Encoding，配合 CDN
gzip_buffers 16 8k;                      # 压缩缓冲
gzip_disable "msie6";                    # 老浏览器不压缩
```
要点：
- 只压缩**文本类**资源（JS/CSS/JSON/HTML/SVG）；图片/视频本身已压缩，再压无效还费 CPU（WebP/AVIF 除外）。
- `gzip_static on`：若磁盘上已预生成 `.gz` 文件，直接发送**零成本压缩**（配合构建时压缩）。
- 现代替代：**Brotli**（`ngx_http_brotli_module`，压缩率比 gzip 高 15%~25%，需编译或第三方包）。
- 注意：**已压缩内容不能二次压缩**（如 HTTP 传输层 TLS 已压缩的场景），会产生额外开销甚至安全风险（BREACH 攻击）。

> 追问：gzip 与 HTTPS 的坑？开启 TLS 后若再 gzip 敏感数据，存在 **BREACH 攻击**风险；常规做法是不对包含敏感信息（token、CSRF）的响应开启压缩。

### 5.4 Nginx 代理缓存（proxy_cache）【进阶】
把上游响应缓存到 Nginx 本地，后续相同请求直接返回，**大幅降低上游压力**：

```nginx
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=mycache:10m max_size=10g inactive=60m use_temp_path=off;

server {
    location / {
        proxy_cache mycache;
        proxy_cache_key $scheme$proxy_host$request_uri;   # 缓存 key
        proxy_cache_valid 200 302 60m;   # 2xx/302 缓存 60 分钟
        proxy_cache_valid 404 1m;        # 404 只缓存 1 分钟
        proxy_cache_min_uses 1;          # 至少被请求 1 次才缓存
        proxy_cache_use_stale error timeout http_502;  # 上游故障时用过期缓存兜底
        add_header X-Cache-Status $upstream_cache_status;  # 查看命中情况 HIT/MISS/BYPASS
        proxy_pass http://backend;
    }
}
```
关键概念：
- `keys_zone`：缓存 key 的共享内存区（10m 大约可存 8 万个 key）。
- `levels=1:2`：缓存文件目录层级，避免单目录文件过多。
- **缓存穿透**风险：恶意构造不同 URL 会生成海量缓存文件，需配合 `proxy_cache_key` 精简 + 限流。
- `proxy_cache_use_stale`：上游宕机时返回**过期缓存**（stale-while-error），是提高可用性的利器。

> 加分点：静态资源场景，Nginx 做**边缘缓存**（CDN 思路）：`proxy_cache` + `Cache-Control` 头配合，命中率可达 90%+，后端 QPS 骤降。

### 5.5 open_file_cache 文件缓存【进阶】
缓存**打开过的文件描述符、文件大小、修改时间**，减少重复 open/stat 系统调用：

```nginx
open_file_cache max=10000 inactive=30s;   # 最多缓存 1 万条，30s 无访问淘汰
open_file_cache_valid 60s;                # 检查文件是否变化的周期
open_file_cache_min_uses 2;               # 访问 2 次以上才缓存（过滤一次性请求）
open_file_cache_errors on;                # 缓存"文件不存在"的结果，减少 ENOENT 探测
```
适用：大量静态文件（图片、JS/CSS）的服务器，能显著降低磁盘 I/O 与 CPU。

> 追问：为什么静态文件服务器要开 sendfile + tcp_nopush？`sendfile` 把文件从磁盘直接拷到 socket（**零拷贝**，不经用户态）；`tcp_nopush` 合并小包、攒满一个包再发，减少小包数量；大文件再加 `aio on` 用异步 I/O。

### 5.6 大文件下载 / 断点续传【进阶】
```nginx
location /download/ {
    root /data;
    sendfile on;            # 零拷贝
    tcp_nopush on;          # 攒包发送，大文件吞吐更高
    tcp_nodelay on;
    limit_rate 1m;          # 限速 1MB/s（防占满带宽）
    limit_rate_after 10m;   # 前 10MB 不限速，之后限速
    add_header Accept-Ranges bytes;   # 支持 Range 断点续传
}
```
- **断点续传**基于 HTTP Range：`Accept-Ranges: bytes` + 客户端 `Range: bytes=0-1023` 请求 → 206 Partial Content。
- 大文件建议用 **CDN 分发** + 分片；Nginx 直接吐大文件时要关注磁盘 I/O 与带宽。

### 5.7 静态资源性能优化全清单【进阶】
1. **缓存**：浏览器强缓存（hash 文件名 + immutable）+ Nginx 代理缓存 + CDN。
2. **压缩**：gzip/brotli + gzip_static 预压缩。
3. **零拷贝**：sendfile on + tcp_nopush on。
4. **文件缓存**：open_file_cache。
5. **连接优化**：keepalive_timeout、keepalive_requests（单连接最大请求数）。
6. **HTTP/2**：多路复用，减少连接数。
7. **图片优化**：WebP/AVIF 格式、响应式尺寸、懒加载。
8. **磁盘**：缓存放 SSD；`access_log off`（静态资源不记日志或走 syslog）。

---

## 06 location 与 rewrite

### 6.1 location 匹配规则与优先级【高频】
```nginx
location = /exact { }        # ① 精确匹配（=）
location ^~ /prefix/ { }     # ② 前缀匹配，命中即停（^~）
location ~ /regex/ { }       # ③ 正则匹配（~ 区分大小写）
location ~* \.(jpg|png)$ { } # ④ 正则忽略大小写（~*）
location /prefix/ { }        # ⑤ 普通前缀匹配
location / { }               # ⑥ 兜底前缀
```
**匹配流程（优先级从高到低）**：
1. **精确匹配 `=`**：完全等于，命中直接使用，停止。
2. **前缀匹配 `^~`**：最长匹配的前缀，命中直接使用，**不再查正则**。
3. **正则匹配 `~`/`~*`**：按**配置文件出现顺序**第一个匹配生效。
4. **普通前缀匹配**：最长匹配（没有 `=`/`^~`/正则命中时使用）。

```
请求 /static/img/a.png
① = 无命中
② ^~ /static/ 命中 → 直接使用（不再查正则）
③~⑥ 跳过
```
```
请求 /api/user
① 无 = 命中
② 无 ^~ 命中（假设只配了 /api 普通前缀）
③ 正则 ~ /user 命中 → 用正则（正则优先于普通前缀！）
```
> 经典陷阱：**普通前缀的"最长匹配"优先级高于短的，但正则永远优先于普通前缀**（除非 ^~）。面试必考。

### 6.2 root vs alias 再次深挖【高频】
回顾第 5 章，这里强调易错点：
- `root` 可以出现在 http/server/location 任意层级；`alias` **只能出现在 location 中**。
- `alias` 与 location 前缀配合时，**目录映射关系**：
  ```nginx
  location /i/ { alias /data/w3/images/; }  # /i/top.gif → /data/w3/images/top.gif
  ```
- 正则 location 里**不能使用 alias**（1.9.2 前），会报错。
- 需求"URL 路径与磁盘路径完全一致"时用 root（最省事）；不一致时用 alias。

> 追问：`location / { root /app/dist; }` 与 `location / { alias /app/dist; }` 有区别吗？有！root 会把完整 URI 拼到 /app/dist 后（/app/dist/xxx），alias 则直接用 /app/dist 替换匹配部分（/app/dist 本身被当作静态目录）。SPA 部署用 root 更常见。

### 6.3 rewrite 指令与四个 flag【高频】
```nginx
# 语法：rewrite <正则> <替换> [flag]
rewrite ^/old/(.*)$ /new/$1 permanent;   # 301 永久重定向
rewrite ^/user/(\d+)$ /profile?id=$1 break;
```
**四个 flag**：

| flag | 行为 | 后续处理 |
|---|---|---|
| `last` | 停止 rewrite，**重新进入 location 匹配** | 用新 URI 重新找 location（类似重走流程） |
| `break` | 停止 rewrite，**不再重新匹配 location** | 用当前已改写 URI 直接执行剩余指令 |
| `redirect` | 返回 **302** 临时重定向 | 客户端重新请求新地址 |
| `permanent` | 返回 **301** 永久重定向 | 浏览器/搜索引擎缓存新地址 |

典型用例：
```nginx
# http → https 跳转
server {
    listen 80;
    server_name example.com;
    return 301 https://$host$request_uri;
}
# 带参数的跳转
rewrite ^/news/(\d+)$ /news-detail.html?id=$1 permanent;
```
> 陷阱：`last` 与 `break` 区别是面试必问——**last 会重新匹配 location（可能再次触发 rewrite 造成循环），break 不会**。rewrite 在 location 内与 server 内的行为也不同（server 内默认隐式 last 语义）。

### 6.4 if 指令的使用与陷阱【进阶】
Nginx 的 `if` 是 **rewrite 模块的指令**，只能在 location 中使用（且官方文档警告：**if 是邪恶的，不要在里面用非 rewrite 指令**）。

```nginx
location / {
    if ($request_method = POST) { return 405; }          # 可以用（return 是 rewrite 指令）
    if ($http_user_agent ~* "curl") { return 403; }      # 可用
    # if ($request_uri ~ ...) { proxy_pass ...; }        # 危险！if 里用 proxy_pass 行为不可控
}
```
正确姿势：
- if 内**只用 return / rewrite / set**。
- 需要按条件转发到不同上游时，用 `set` 设置变量 + `proxy_pass http://$var`（见 4.6 灰度方案）。
- 判断存在性：`if ($args) {}`、`if (-f $request_filename) {}`（文件是否存在）。
- 官方替代：try_files 已覆盖多数"文件是否存在"场景。

> 加分点：为什么 if 里不能用 proxy_pass？因为 Nginx 的 if 是"配置期指令"，在 location 匹配后再执行，改变 proxy_pass 会导致**选择上游的时机与 location 解析不一致**，产生不可预期行为。复杂逻辑请用 Lua（OpenResty）或拆分 location。

### 6.5 try_files 原理【高频】
```nginx
location / {
    try_files $uri $uri/ /index.html;   # 依次尝试，全部失败则内部重定向到 /index.html
}
```
执行逻辑：按顺序检查：
1. `$uri`：磁盘上是否有该文件 → 有则返回。
2. `$uri/`：是否有该目录（找 index）→ 有则返回目录索引。
3. `/index.html`：**内部重定向**（类似 last，重新匹配 location）。

经典场景：
- **SPA history 路由**：刷新 `/user/123` 时磁盘无此文件 → 兜底到 `/index.html`，由前端路由接管。
- **前端资源 + 后端 API 分离**：
  ```nginx
  location /api/ { proxy_pass http://backend; }
  location / {
      try_files $uri $uri/ /index.html;
  }
  ```
- **多级 fallback**：`try_files $uri $uri/ @fallback;`（@命名 location）。

> 追问：try_files 的坑？① 最后的 fallback 若写成普通路径 `/index.html` 会内部重定向（可能循环）；② 对**动态接口**不要用 try_files 兜底到 index.html（会返回 HTML 而不是 404）；③ `$uri` 是解码后的路径，包含中文文件名要注意。

### 6.6 Nginx 常用正则速查【基础】

| 元字符 | 含义 | 示例 |
|---|---|---|
| `^` | 开头 | `^/api` 以 /api 开头 |
| `$` | 结尾 | `\.js$` 以 .js 结尾 |
| `.` | 任意字符 | `a.c` 匹配 abc/adc |
| `*` | 前一个字符 0 次以上 | `ab*c` 匹配 ac/abbc |
| `+` | 前一个字符 1 次以上 | `ab+c` 匹配 abc/abbc |
| `?` | 前一个字符 0 或 1 次 | `colou?r` 匹配 color/colour |
| `()` | 分组捕获 | `(\d+)` 捕获数字 |
| `\|` | 或 | `(jpg\|png\|gif)$` |
| `[abc]` | 字符集 | `[0-9]` 数字 |
| `\d` `\w` `\s` | 数字/单词/空白 | `\d+` 数字串 |
| `(?i)` | 忽略大小写（等价 ~*） | - |

> 注意：Nginx 正则基于 **PCRE**，与 grep/Java 正则基本一致；`~` 区分大小写、`~*` 不区分。

### 6.7 实战：SPA history 路由刷新 404【高频】
**问题**：Vue/React 用 history 模式，用户直接访问 `/user/123` 或刷新时，Nginx 找不到该文件返回 404。

**解决**：try_files 兜底到 index.html + API 与静态资源分离：
```nginx
server {
    listen 80;
    server_name example.com;
    root /usr/share/nginx/html;   # 前端构建产物目录

    location /api/ {                     # 后端接口先行匹配
        proxy_pass http://backend;
        proxy_set_header Host $host;
    }
    location /assets/ {                  # 带 hash 的静态资源，长缓存
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
    location / {
        try_files $uri $uri/ /index.html;  # 前端路由兜底
    }
}
```
要点：
- `try_files $uri $uri/ /index.html` 中 `/index.html` 是**内部重定向**，不会 301，URL 保持 `/user/123`。
- 必须保证 `/index.html` 本身可访问；若 index.html 也找不到，会 500 而非 404（可加 `=404` 兜底）。
- 接口与页面分离部署时，`location /api/` 必须写在通用 `location /` 之前（前缀匹配按最长优先其实无顺序要求，但正则必须有序）。

---

## 07 限流与访问控制

### 7.1 限流算法：漏桶 vs 令牌桶【高频】

| 算法 | 原理 | 特点 | 典型实现 |
|---|---|---|---|
| **漏桶** | 请求进入桶，按**固定速率**流出；桶满则拒绝 | 输出**绝对平滑**（严格速率），但无法应对突发 | Nginx limit_req、Guava RateLimiter |
| **令牌桶** | 桶内按速率**生成令牌**，请求需拿令牌；桶可积累令牌 | 允许**一定突发**（桶内积累的令牌），平滑且灵活 | 阿里 Sentinel、API 网关常见 |

- **漏桶**：无论来多少请求，处理速率恒定 → 适合**保护下游**（如限上游调用）。
- **令牌桶**：空闲时可攒令牌，突发时一次消耗 → 适合**允许业务突刺**的入口。

> 加分点：Nginx 的 `limit_req` 实现的是**漏桶**（rate 是流出速率，burst 是桶容量）；`limit_conn` 是连接数限流（类似"最大并发"）；令牌桶在 Nginx 里没有内置，但可用 Lua（OpenResty）实现。

### 7.2 limit_req 限流配置与原理【高频】
```nginx
http {
    # 定义限流区：按客户端 IP 计数，10m 共享内存，速率 1r/s
    limit_req_zone $binary_remote_addr zone=req_zone:10m rate=1r/s;

    server {
        location /api/ {
            limit_req zone=req_zone burst=5 nodelay;   # 桶容量 5，nodelay 不延迟
            proxy_pass http://backend;
        }
    }
}
```
参数拆解：
- `rate=1r/s`：每秒 1 个请求（也可 `10r/m` 每分钟 10 个）。
- `burst=5`：**桶容量**，超过速率的请求先排队（最多 5 个），超过桶容量的直接 **503**。
- `nodelay`：排队请求**不延迟**直接放行（瞬时打满 burst）；不带 nodelay 则按速率"排队延迟"放行（漏桶的平滑流出）。
- 不带 nodelay 时，超出 rate 的请求会**排队等待**（延迟返回），体验不好但平滑；生产常见 `burst + nodelay`。

响应码：默认超限返回 **503 Service Unavailable**；可自定义：
```nginx
limit_req_status 429;   # 返回 429 Too Many Requests
```
> 追问：`limit_req_zone $binary_remote_addr` 为什么用 binary 而不是字符串 IP？`$binary_remote_addr` 是 4 字节二进制 IP，10m 内存能存约 **16 万个 IP**；`$remote_addr` 是字符串形式，同样内存只能存约 1.6 万个，且占用 CPU。

### 7.3 limit_conn 并发连接限流【高频】
```nginx
http {
    limit_conn_zone $binary_remote_addr zone=conn_zone:10m;
    server {
        location /download/ {
            limit_conn conn_zone 10;      # 每个 IP 最多 10 个并发连接
            limit_conn_status 429;
            limit_rate 1m;                # 配合限速
        }
    }
}
```
与 limit_req 的区别：

| 指令 | 限制对象 | 场景 |
|---|---|---|
| `limit_req` | **请求速率**（个/秒） | 防刷、防爬虫、API 限流 |
| `limit_conn` | **并发连接数** | 防下载占满连接、防 CC 攻击 |

> 追问：CC 攻击怎么防？CC 攻击是"高频请求耗尽资源"，需要 **limit_req（速率）+ limit_conn（并发）+ 请求特征识别（UA/Referer/行为分析）+ WAF** 组合；单靠一个指令不够。

### 7.4 访问控制：allow/deny【基础】
```nginx
# 按来源 IP 黑白名单（顺序匹配，先命中先生效）
location /admin/ {
    allow 192.168.1.0/24;   # 内网放行
    deny  all;              # 其余拒绝（403）
}
```
- 判断顺序：**从上到下，第一个匹配的规则生效**。
- 支持 IP 段：`allow 10.0.0.0/8;`、`allow 114.114.114.114;`。
- 按国家/地区封禁（需第三方模块 geoip2）：`geoip2` + `map` 结合。

> 注意：allow/deny 是**源 IP** 维度，若前面有 CDN/代理，需配合 `real_ip` 模块（set_real_ip_from）还原真实 IP 后再判断。

### 7.5 防盗链配置【高频】
**原理**：通过检查 `Referer` 头判断请求来源是否合法。

```nginx
location ~* \.(gif|jpg|jpeg|png|webp|mp4|zip|rar)$ {
    valid_referers none blocked server_names *.example.com www.example.com;
    if ($invalid_referer) {
        return 403;                       # 或重定向到防盗链图
        # rewrite ^/.*$ /hotlink.png redirect;
    }
}
```
- `none`：无 Referer（直接输 URL/部分 APP）→ 放行。
- `blocked`：Referer 被浏览器/代理去掉（不以 http 开头）→ 放行。
- `server_names`：本机域名放行。
- `*.example.com`：指定来源域名放行。
- `$invalid_referer`：valid_referers 未匹配时自动为 1。

> 局限：Referer **可以伪造**，防盗链只是"防君子不防小人"；严格场景需**签名 URL**（带过期时间戳的 token）或鉴权。

### 7.6 接口防刷实战【进阶】
组合方案：
```nginx
http {
    limit_req_zone $binary_remote_addr zone=api:10m rate=5r/s;
    limit_conn_zone $binary_remote_addr zone=conn:10m;

    server {
        location /api/send-sms/ {         # 高价值接口重点防护
            limit_req zone=api burst=2 nodelay;
            limit_conn conn 3;
            proxy_pass http://backend;
        }
        location /api/ {
            limit_req zone=api burst=10 nodelay;   # 通用接口宽松些
            proxy_pass http://backend;
        }
    }
}
```
更高阶（配合 Lua / 网关）：
1. **滑动窗口**：Redis 记录固定时间窗请求数（比漏桶更精确的"X 秒 N 次"）。
2. **验证码**：同 IP 失败 N 次后强制滑块/图形验证码。
3. **用户维度限流**：登录态 uid 维度（不只是 IP，防多 IP 绕过）。
4. **风控联动**：设备指纹、行为分析（OpenResty + 规则引擎）。

> 追问：IP 限流被多 IP 攻击绕过怎么办？结合 **uid + 设备指纹** 维度限流，配合验证码升级、云 WAF（大禹、阿里云盾）做整体防护。

---

## 08 HTTPS 与安全

### 8.1 HTTPS 完整配置【高频】
```nginx
server {
    listen 443 ssl http2;                  # http2 需 Nginx ≥1.25.1（或 listen 443 ssl; 加 http2 on;）
    server_name example.com;

    ssl_certificate     /etc/nginx/cert/example.com.pem;   # 证书（含证书链）
    ssl_certificate_key /etc/nginx/cert/example.com.key;   # 私钥

    ssl_protocols TLSv1.2 TLSv1.3;         # 禁用 SSLv3/TLSv1.0/1.1（有漏洞）
    ssl_ciphers HIGH:!aNULL:!MD5;          # 或现代套件推荐
    ssl_prefer_server_ciphers on;

    ssl_session_cache shared:SSL:10m;      # TLS 会话缓存（省握手）
    ssl_session_timeout 10m;
    ssl_session_tickets on;                # 会话票据（集群可共享）

    ssl_stapling on;                       # OCSP Stapling
    ssl_stapling_verify on;
    resolver 8.8.8.8 114.114.114.114 valid=300s;

    # HTTP 自动跳 HTTPS
    # 另写一个 server { listen 80; return 301 https://$host$request_uri; }
}
```
要点：
- 证书 = **证书链**（服务器证书 + 中间 CA 证书），必须按顺序拼接，否则移动端/部分客户端报错。
- 私钥权限要收紧（`chmod 600`），**私钥泄露=HTTPS 失效**。
- 证书到期监控（Let's Encrypt 自动续期、腾讯云/阿里云托管）。

> 追问：证书链为什么要包含中间证书？因为客户端只内置根证书，服务器证书由中间 CA 签发，客户端必须收到中间证书才能验出完整的信任链；缺少中间证书会导致 **SSL_ERROR_BAD_CERT_DOMAIN / unable to verify**。

### 8.2 HTTP 与 HTTPS 的区别【基础】

| 维度 | HTTP | HTTPS |
|---|---|---|
| 端口 | 80 | 443 |
| 传输层 | TCP | **TLS/SSL 加密** |
| 安全性 | 明文，可窃听/篡改/冒充 | 加密 + 完整性 + 身份认证 |
| 性能 | 快（无握手） | 有 TLS 握手开销（可优化） |
| SEO | 一般 | 搜索引擎更友好（权重加成） |
| 适用 | 内网、非敏感 | 一切对外公网服务（已是默认要求） |

TLS 握手（简版）：
1. ClientHello（支持的版本/套件/随机数）→ ServerHello（选定套件/随机数）+ 证书。
2. 客户端**验证证书链**，生成预主密钥，用服务器公钥加密发送。
3. 双方各自计算会话密钥，发送 Finished，开始对称加密通信。
- **RSA 握手**：2 个 RTT；**TLS 1.3**：1-RTT（0-RTT 可恢复，但有重放风险）。

### 8.3 HTTPS 性能优化【进阶】
1. **会话复用**：`ssl_session_cache shared:SSL:10m`（内存缓存会话）+ `ssl_session_tickets`（票据方式，**无状态可跨实例**，适合集群）。10m ≈ 4 万个会话。
2. **TLS 1.3**：握手 1-RTT，比 1.2 少一个 RTT。
3. **OCSP Stapling**：Nginx **代查证书吊销状态并缓存**，客户端无需自己访问 OCSP 服务器（省一次网络请求 + 更可靠）。
4. **HTTP/2**：多路复用，并发请求共享连接。
5. **硬件加速**：`ssl_engine` 使用 AES-NI 指令集、支持硬件 SSL 加速卡。
6. **减少证书链大小**：ECC 证书比 RSA 证书小、握手更快。

> 加分点：全站 HTTPS + HTTP/2 是现代 Web 标配；性能上 TLS 握手成本可通过**会话复用**大幅摊薄，TLS 1.3 后 HTTPS 与 HTTP 性能差距已很小。

### 8.4 HTTP/2 与 HTTP/3 特性【进阶】
**HTTP/2**（Nginx 1.9.5+，需要 `--with-http_v2_module`）：
- **多路复用**：一个 TCP 连接并发多个请求，解决队头阻塞（应用层）。
- **头部压缩**：HPACK 压缩头（首部表 + 哈夫曼编码）。
- **二进制分帧**：数据以二进制帧传输，解析更高效。
- **服务器推送**（Server Push，已废弃/不推荐）。
- **必须配 HTTPS**（主流浏览器强制 h2 仅限 TLS）。

**HTTP/3**（QUIC，基于 UDP，Nginx 1.25+ 实验支持）：
- 基于 **UDP 的 QUIC** 协议，连接建立 0-1 RTT。
- 解决**传输层队头阻塞**（TCP 丢包导致整条流阻塞）。
- 更适合弱网、移动端。

```nginx
server {
    listen 443 ssl http2;         # HTTP/2
    listen 443 quic reuseport;    # HTTP/3（QUIC，Nginx 1.25+）
    add_header Alt-Svc 'h3=":443"; ma=86400';  # 告知浏览器支持 h3
}
```

### 8.5 HSTS 与安全响应头【基础】
```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
add_header X-Content-Type-Options "nosniff" always;         # 防 MIME 嗅探
add_header X-Frame-Options "SAMEORIGIN" always;             # 防点击劫持（frame 嵌入）
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'" always;   # CSP（按需收紧）
```
- **HSTS**：告诉浏览器**强制 HTTPS 访问**（连首次 http 请求都不发，直接内部跳 https），杜绝"降级攻击"；`preload` 表示申请加入浏览器 HSTS 预加载列表。
- 注意：`add_header` 在**有响应的 location** 中会覆盖 server 级的同名头（Nginx 的继承陷阱），建议用 `always` 并在每层确认。

### 8.6 安全加固清单【高频】
1. **隐藏版本号**：`server_tokens off;`（防针对特定版本漏洞扫描）。
2. **最小权限**：worker 用低权限用户运行（`user nginx;`），root 启动仅用于绑定 80/443。
3. **禁用危险方法**：`if ($request_method !~ ^(GET|HEAD|POST|PUT|DELETE|OPTIONS)$) { return 405; }`。
4. **限制请求体**：`client_max_body_size 10m;`（防恶意大包）。
5. **超时收紧**：`client_body_timeout`、`client_header_timeout` 调小（防慢速攻击 slowloris）。
6. **TLS 配置加固**：禁用 TLSv1.0/1.1、弱密码套件。
7. **目录安全**：拒绝访问隐藏文件/敏感路径：
   ```nginx
   location ~ /\. { deny all; }            # 防 .git/.env 泄露
   location ~ \.(sql|log|bak|sh|py)$ { deny all; }
   ```
8. **限流防刷**：limit_req / limit_conn（见第 7 章）。
9. **WAF**：ModSecurity（开源）或云 WAF。
10. **日志**：access_log 全量记录 + 定期分析异常。

---

## 09 高可用架构

### 9.1 Nginx 高可用方案：Keepalived + VIP【高频】
**问题**：Nginx 单点故障 → 服务全挂。**方案**：多台 Nginx + **Keepalived（VRRP 协议）** 提供虚拟 IP（VIP）。

架构：
```
        客户端
          │  访问 VIP（如 192.168.1.100）
   ┌──────┴──────┐
 Nginx-Master    Nginx-Backup   ← Keepalived 心跳互检（VRRP 组播）
 (VIP 绑定)      (随时接管)
   │  │  │
 后端1 后端2 后端3
```
原理：
- **VRRP**：Master 周期发送 VRRP 通告（组播），Backup 收不到（超时，默认 3 个通告周期约 3s）则判定 Master 挂掉 → **抢占 VIP** 继续服务。
- VIP 只在 Master 的网卡上；切换时 VIP 漂移到 Backup，**客户端无感知**（IP 没变）。
- 健康检查脚本：Keepalived 定期检查 Nginx 进程/端口，Nginx 挂掉则**主动降级**（或重启）。

关键配置（keepalived.conf）：
```
vrrp_instance VI_1 {
    state MASTER            # Backup 上写 BACKUP
    interface eth0
    virtual_router_id 51    # 同一组必须一致
    priority 100            # Master 高（如 100），Backup 低（如 90）
    advert_int 1            # 通告间隔 1s
    virtual_ipaddress {
        192.168.1.100/24    # VIP
    }
    track_script { chk_nginx }   # 健康检查脚本
}
```
> 加分点：Keepalived 解决的是**入口高可用**（VIP 漂移），不是负载均衡——两台 Nginx 是**主备（热备）**关系，同一时刻只有一台工作；若要**双活**，用 DNS 轮询、LVS+多组、或上云 SLB。

### 9.2 主备切换的细节与脑裂【进阶】
- **抢占模式 vs 非抢占**：`nopreempt` 配置可让 Backup 不自动抢回 VIP（避免频繁切换抖动）。
- **脑裂（split-brain）**：两台都认为自己是 Master，都绑定 VIP → 请求可能打到两台，后端数据不一致。
  - 原因：VRRP 心跳被隔离（网络抖动/防火墙）。
  - 防御：**仲裁机制**（如检查网关连通性、共享存储锁）、心跳走**独立网卡/独立网络**、配置 `unicast_peer` 单播。
- **服务探测**：`track_script` 里检查 Nginx 进程 + `curl 127.0.0.1/health`，双保险。

### 9.3 四层 vs 七层：LVS + Nginx 分层架构【进阶】
**为什么分层**：Nginx（七层）做负载均衡时每个请求都要解析 HTTP，海量连接下成为瓶颈；LVS（四层）在内核态转发，吞吐极高。

典型大型架构（三层）：
```
客户端 → DNS/GSLB → LVS(四层, 内核态转发) → Nginx(七层, 反向代理/网关) → 应用服务
                     VIP 负载均衡            负载均衡+路由+限流+缓存     业务逻辑
```
- **LVS 三种模式**：NAT（改 IP，回程也走 LVS）、DR（改 MAC，回程直连客户端，性能最好）、TUN（IP 隧道）。
- **Nginx 四层代理**（stream 模块）也可做 L4：`stream { upstream tcp_backend { server ...; } server { listen 3306; proxy_pass tcp_backend; } }`（适合 MySQL/Redis 等 TCP 服务的负载均衡）。
- 选型：**四层**性能高但无法做 HTTP 层路由/限流；**七层**功能丰富但性能上限低。二者组合是互联网标配。

> 追问：四层和七层的判断依据？四层只认 IP:端口（TCP/UDP），不看内容；七层解析 HTTP 头/URL/Cookie，能做路由、重写、限流、灰度。

### 9.4 多级缓存架构与 CDN【进阶】
```
浏览器缓存 → CDN 边缘节点 → Nginx 边缘缓存 → 应用服务器 → 数据库
   (强缓存)   (静态就近)     (proxy_cache)    (业务)      (数据)
```
- **CDN**：把静态资源分发到离用户最近的节点，回源到 Nginx。
- **Nginx 边缘缓存**：`proxy_cache` 缓存动态接口/未命中 CDN 的资源，减轻应用压力。
- 配合 `Cache-Control` 头做**多级缓存一致性**：CDN 依据源站响应头决定缓存时长。

### 9.5 平滑升级与回滚【高频】
回顾 2.7 的信号机制，补充**回滚**：
- 升级前备份旧二进制：`cp nginx nginx.old`。
- 升级失败回滚：发送 **USR2** 重新启动旧版 master（新老并存）→ **WINCH** 关闭新 worker → **QUIT** 退出新 master。
- 配置回滚：`nginx -t` 校验通过才 `kill -HUP`；出错则直接改回旧配置再 HUP。

> 加分点：`nginx -t`（测试配置）是发布前**必须**的步骤，语法错误会导致 reload 失败（但不会中断运行中的服务）；`nginx -s reload` 等价于发 HUP。

---

## 10 日志与监控

### 10.1 access_log 格式与字段【高频】
```nginx
http {
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for" '
                    'rt=$request_time uct=$upstream_connect_time uht=$upstream_header_time urt=$upstream_response_time';
    access_log /var/log/nginx/access.log main;   # 格式 + 路径
    # access_log off;   # 静态资源可关闭日志
}
```
常用变量：
- `$remote_addr` 客户端 IP、`$request` 请求行、`$status` 状态码、`$body_bytes_sent` 响应字节数。
- `$request_time` **整个请求耗时**（含上游）、`$upstream_response_time` 上游响应耗时 → 定位是 Nginx 慢还是后端慢。
- `$http_referer`、`$http_user_agent`、`$http_x_forwarded_for`。
- `$upstream_addr` 实际命中的上游地址（多上游排查用）。

> 加分点：`rt` 与 `urt` 对比是排查手段——`rt ≈ urt` 说明慢在后端；`rt >> urt` 说明慢在 Nginx 到客户端的传输（如带宽/大响应）。

### 10.2 error_log 级别【基础】
```nginx
error_log /var/log/nginx/error.log warn;   # 全局
error_log /var/log/nginx/error_http.log info;  # 可按 http/server 覆盖
```
级别（从低到高）：`debug` → `info` → `notice` → `warn` → `error` → `crit` → `alert` → `emerg`。
- 生产默认 **warn**；排查疑难问题开 **debug**（注意 debug 日志量巨大，且需编译时开启 `--with-debug`）。
- 常见错误定位：`connect() failed (111: Connection refused)` → 上游没起来；`worker_connections are not enough` → 连接数不够。

### 10.3 日志切割方案【高频】
Nginx 默认日志无限增长。标准方案：

方案一：**logrotate**（Linux 标配）
```
/var/log/nginx/*.log {
    daily
    rotate 30
    compress
    dateext
    missingok
    notifempty
    sharedscripts
    postrotate
        /usr/sbin/nginx -s reopen    # USR1 信号：重新打开日志文件
    endscript
}
```
方案二：手动（USR1 信号）
```bash
mv /var/log/nginx/access.log /var/log/nginx/access.log.20260824
kill -USR1 $(cat /var/run/nginx.pid)   # 让 Nginx 重新打开新文件
```
- 原理：USR1 信号让 Nginx **重新打开日志文件**，旧文件可任意压缩归档。
- 注意：**直接删日志文件不重启**会导致 Nginx 继续写已删除的 inode（磁盘空间不释放），必须用 USR1 reopen。

### 10.4 监控指标：stub_status / vts【进阶】
```nginx
server {
    location /nginx_status {
        stub_status on;          # 内置指标（Nginx 开源版）
        access_log off;
        allow 127.0.0.1;         # 只允许内网访问
        deny all;
    }
}
```
输出指标：
```
Active connections: 100          # 当前活跃连接数
server accepts handled requests
 1234 1234 5678                  # 累计接受连接 / 处理连接 / 请求数
Reading: 1 Writing: 3 Waiting: 99   # 读请求头 / 写响应 / 空闲 keepalive 连接
```
进阶方案：
- **ngx_http_stub_status_module**：上述基础指标。
- **nginx-module-vts**（第三方）：提供 JSON 格式的详细指标（各 server/upstream 请求数、响应码、耗时分布）。
- **Prometheus + nginx-prometheus-exporter**：导出指标到监控体系。
- **ELK/Loki**：日志采集分析（Filebeat → ES / Promtail → Loki）。

> 加分点：`Waiting` 数量大说明**长连接复用好**（keepalive 生效）；`Reading` 长期大说明有慢请求/慢速攻击，需检查 `client_header_timeout`。

### 10.5 通过日志做业务分析【进阶】
- **QPS/状态码统计**（awk）：
  ```bash
  awk '{print $9}' access.log | sort | uniq -c | sort -rn     # 状态码分布
  ```
- **Top IP**：`awk '{print $1}' access.log | sort | uniq -c | sort -rn | head -10`
- **慢请求**：`awk '$NF > 3 {print}' access.log`（rt 字段 > 3s）。
- **4xx/5xx 趋势**：配合 Grafana 按时间聚合。
- 规范做法：接入 **Loki/ES + Grafana** 做实时监控大盘；日志结构化（JSON 格式）便于检索。

### 10.6 常见故障排查：502 / 504 / 499【高频】
| 错误 | 含义 | 排查方向 |
|---|---|---|
| **502 Bad Gateway** | Nginx 无法连接上游 | 上游进程挂了？端口错？防火墙？`proxy_connect_timeout` 内未建立连接 |
| **504 Gateway Timeout** | 上游响应超时 | 上游处理慢？`proxy_read_timeout` 太小？数据库慢？ |
| **499 Client Closed** | 客户端提前断开 | 客户端超时设置比 Nginx 小（如浏览器/网关 60s）；大响应被客户端丢弃 |
| **499 大量** | 客户端/中间层超时 | 检查 CDN/客户端超时配置、响应大小、是否日志记录慢 |

排查命令：
```bash
nginx -t                          # 配置检查
tail -f /var/log/nginx/error.log  # 错误日志
curl -v http://127.0.0.1:8080/health   # 直连上游验证
ss -tnlp | grep :8080             # 端口监听
```

---

## 11 性能优化实战

### 11.1 Nginx 常规性能优化清单【高频】
**配置层面**：
```nginx
worker_processes auto;
worker_cpu_affinity auto;
worker_rlimit_nofile 65535;
events {
    use epoll;
    worker_connections 65535;
    accept_mutex off;        # reuseport 时关
}
http {
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    keepalive_requests 1000;
    gzip on; gzip_comp_level 5; gzip_min_length 1k; gzip_types ...;
    open_file_cache max=10000 inactive=30s;
    client_header_buffer_size 1k;
    large_client_header_buffers 4 8k;
}
```
**系统层面**：
```bash
# /etc/sysctl.conf
net.core.somaxconn = 65535        # accept 队列
net.ipv4.ip_local_port_range = 1024 65535   # 本地端口范围（出站连接）
net.ipv4.tcp_tw_reuse = 1         # TIME_WAIT 复用
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_max_syn_backlog = 65535
fs.file-max = 655350
ulimit -n 65535                   # 进程 fd 上限
```
**业务层面**：
- 静态资源走 CDN / 独立静态域名。
- 开 HTTP/2、上 TLS 1.3。
- 配置 `access_log off` 于高流量静态资源。

### 11.2 缓冲与超时参数精调【进阶】
```nginx
http {
    client_body_buffer_size 8k;        # 请求体缓冲（小于此值内存，大于落盘）
    client_max_body_size 10m;          # 最大请求体（上传限制）
    client_header_buffer_size 1k;      # 请求头缓冲
    large_client_header_buffers 4 8k;  # 大请求头（Cookie/长 URL）缓冲

    proxy_buffer_size 4k;              # 上游响应头缓冲
    proxy_buffers 8 4k;                # 上游响应体缓冲
    proxy_busy_buffers_size 8k;
    proxy_temp_path /data/nginx_tmp;   # 大响应落盘路径（放 SSD）
}
```
- 请求头太大报 **414**：调大 `large_client_header_buffers`。
- 请求体太大报 **413**：调大 `client_max_body_size`。
- 缓冲过多会**吃内存**：每个并发连接 × 缓冲大小，估算内存上限。

### 11.3 压测与指标解读【进阶】
常用工具：
- **ab**（ApacheBench）：`ab -n 100000 -c 1000 http://host/` → RPS、平均延迟、失败率。
- **wrk**：支持脚本、更精确：`wrk -t8 -c1000 -d30s --latency http://host/`。
- **siege / hey / Vegeta**。
核心指标：
- **QPS/TPS**、**RT（P50/P95/P99）**、**错误率**、**连接成功率**。
- 关注 P99 而非平均值（均值掩盖长尾）。
压测注意：**先压 Nginx 直连静态**，再压动态链路，区分 Nginx 与后端瓶颈；压测机与目标机**分开**，避免本机资源干扰。

### 11.4 优化案例：单机性能怎么提上去【进阶】
**案例**：8 核 16G 单机，静态资源 + 少量反向代理，目标 10w QPS。
1. `worker_processes 8` + `worker_cpu_affinity auto`（每核一个 worker）。
2. `worker_connections 65535` + `worker_rlimit_nofile 65535` + 系统 fd 调大。
3. `sendfile on; tcp_nopush on;`（静态文件零拷贝）。
4. 静态资源 `expires 30d` + 开 CDN 把压力下沉。
5. 动态接口 `proxy_cache` 缓存热点 + 上游 keepalive 长连接。
6. gzip 预压缩（gzip_static）减少实时压缩 CPU。
7. 日志：静态路径 `access_log off`。
8. 压测验证：`ab -c 1000`，观察 `nginx -s` 指标（Reading/Writing 无堆积、无 `worker_connections are not enough` 报错）。

### 11.5 慢客户端与慢速攻击防护【进阶】
- **慢速攻击（Slowloris）**：客户端只发不读，占用连接不释放 → 拖垮 worker。
- 防护：
  ```nginx
  client_body_timeout 10s;    # 读请求体超时
  client_header_timeout 10s;  # 读请求头超时
  send_timeout 10s;           # 写响应超时
  limit_conn conn 10;         # 限制单 IP 连接数
  ```
- 另外：`http2_max_concurrent_streams`、`keepalive_timeout` 配合；高防场景前置 **LVS/云 WAF**。

### 11.6 缓存类性能问题定位【进阶】
- 命中率低：检查 `proxy_cache_key` 是否太细（带时间戳参数导致 key 爆炸）、`proxy_cache_min_uses` 是否过高。
- 缓存击穿：热点 key 过期瞬间大量请求穿透 → 用 `proxy_cache_use_stale`（stale-while-revalidate）或后端加锁。
- 缓存雪崩：大量 key 同时过期 → 过期时间加**随机抖动**。
- 验证缓存：`add_header X-Cache-Status $upstream_cache_status;` 看 HIT/MISS/EXPIRED/BYPASS/STALE。

---

## 12 深入原理（源码级）

### 12.1 master-worker 的信号与生命周期【进阶】
- master 启动流程：解析配置 → 初始化模块 → **fork worker** → 进入事件循环等待信号。
- 信号处理（回顾 2.7）：HUP reload、USR1 reopen log、USR2 升级、QUIT 优雅退出、TERM/INT 立即退出、WINCH 优雅关 worker。
- worker 生命周期：初始化（各模块 init_process）→ 进入 `ngx_worker_process_cycle` 事件循环 → 退出时清理。
- 关键点：**reload 是"新 fork 一组 worker + 旧 worker 优雅退出"**，不是复用旧 worker。

### 12.2 内存池设计（ngx_pool_t）【进阶】
- 为什么用内存池：请求处理中大量小对象（字符串、头结构、缓冲区），频繁 malloc/free 慢且碎片化。
- 设计：
  - `ngx_pool_t` 由多个 **ngx_pool_data_t 块**（默认 4KB 起步）组成链表。
  - 分配小内存：在当前块剩余空间分配（线性分配，O(1)）；大内存（> max_size）单独 malloc。
  - **请求结束统一销毁整个池**，无需逐个 free。
- 好处：分配快（指针移动）、释放快（整池回收）、无碎片。
- 代价：内存不能单独释放，长生命周期对象（如 upstream 缓存）需要独立池。

### 12.3 核心数据结构速览【进阶】
- **ngx_cycle_t**：全局配置周期（所有模块配置、连接池、监听端口）。
- **ngx_connection_t**：连接对象（socket fd、读写事件、发送缓冲）。
- **ngx_event_t**：事件对象（读/写事件、handler、超时红黑树节点）。
- **ngx_http_request_t**：HTTP 请求对象（请求行、头、URI 解析、各阶段处理函数指针）。
- **ngx_rbtree_t**：红黑树（定时器、epoll 注册管理）。
- **ngx_queue_t**：侵入式双向链表。
- 设计哲学：**对象复用**（连接池、buffer 池）+ **池化分配**，减少系统调用。

### 12.4 HTTP 请求处理全流程（阶段钩子）【进阶】
```
读请求头 → 解析请求行/头 → 11 个 HTTP 阶段 → 生成响应 → 过滤链 → 写响应
```
HTTP 阶段的 11 个钩子（NGX_HTTP_*_PHASE）：
1. `post_read`：读完后钩子。
2. `server_rewrite`：server 级 rewrite。
3. `find_config`：**location 匹配**。
4. `rewrite`：location 内 rewrite。
5. `post_rewrite`：rewrite 后处理（last 重新匹配）。
6. `preaccess`：limit_req/limit_conn。
7. `access`：allow/deny。
8. `post_access`：访问控制后。
9. `try_files`：try_files 阶段。
10. `content`：**生成响应**（static/proxy/fastcgi 都挂这）。
11. `log`：记录日志。
- **Filter 链**：响应内容依次经过各 filter（header_filter 处理响应头，body_filter 处理响应体——gzip、sub_filter 都在 body_filter）。
- 掌握这个流程，就能解释"为什么 limit_req 在 location 匹配后执行"、"为什么 try_files 会重新走 location"。

### 12.5 为什么 Nginx 能支撑高并发（源码角度汇总）【高频】
1. **事件驱动 + 非阻塞**：`ngx_event_core_module` 基于 epoll，连接状态机驱动，一个 worker 处理数十万连接。
2. **进程模型**：worker 无共享内存（除少量共享区），**无锁或少锁**，多核线性扩展。
3. **连接池 + 内存池**：`ngx_connection_t` 预分配复用，request 内存池随请求回收。
4. **零拷贝**：`sendfile()` 系统调用，静态文件不走用户态。
5. **定时器红黑树**：海量连接的超时管理 O(logN)。
6. **模块化阶段处理**：每个请求在固定阶段流转，处理逻辑高度内聚。

### 12.6 常见源码级追问【进阶】
- **epoll 的 LT 与 ET 在 Nginx 中如何选择**？Nginx 默认 LT（`ngx_epoll_module` 支持 ET 但默认 LT），因为 ET 要求一次性读完，处理不当易丢数据；性能差异在高并发下可忽略。
- **accept_mutex 的实现**？基于**原子锁 + 尝试获取**（ngx_trylock_accept_mutex），抢到锁的 worker 调用 accept；获取锁失败则让出 CPU（ngx_sched_yield），并设置 accept 延迟事件。
- **为什么 worker 数超过 CPU 核数反而慢**？进程切换（context switch）开销增大、缓存亲和性变差；对 I/O 密集型，超配一点点可弥补阻塞，但 Nginx 几乎不阻塞。
- **Nginx 如何实现限流计数共享**？`limit_req_zone` 用**共享内存**（mmap 的 ngx_shm_zone_t）存 IP→计数，worker 间通过共享内存同步（加锁/原子操作）。

---

## 13 高频场景题与快问快答

### 13.1 场景：前端项目部署（Vue/React + history 路由）【高频】
```nginx
server {
    listen 80;
    server_name www.example.com;
    root /data/www/dist;               # 构建产物
    index index.html;

    location /api/ {
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    location / {
        try_files $uri $uri/ /index.html;    # 前端路由兜底
    }
    location ~* \.(js|css|png|jpg|svg|woff2?)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```
发布流程：构建（npm run build）→ 产物上传服务器 → **hash 文件名**保证缓存正确 → 无需重启 Nginx（纯静态文件）。

### 13.2 场景：跨域配置（CORS）【高频】
```nginx
location /api/ {
    if ($request_method = 'OPTIONS') {          # 预检请求
        add_header Access-Control-Allow-Origin $http_origin;
        add_header Access-Control-Allow-Methods 'GET, POST, PUT, DELETE, OPTIONS';
        add_header Access-Control-Allow-Headers 'Content-Type, Authorization, X-Requested-With';
        add_header Access-Control-Max-Age 86400;
        add_header Access-Control-Allow-Credentials true;
        return 204;
    }
    add_header Access-Control-Allow-Origin $http_origin;   # 动态回显来源（支持多域名/带凭证）
    add_header Access-Control-Allow-Credentials true;
    add_header Access-Control-Expose-Headers 'Content-Disposition';
    proxy_pass http://backend;
}
```
- 带 `credentials`（Cookie）时 `Access-Control-Allow-Origin` **不能为 `*`**，必须回显具体来源。
- 预检（OPTIONS）通常由浏览器自动发起，Nginx 直接返回 204 短路，减少后端负担。

### 13.3 场景：大文件上传/下载【进阶】
```nginx
server {
    client_max_body_size 500m;             # 上传上限
    client_body_timeout 300s;              # 大文件上传超时调大
    proxy_read_timeout 300s;

    location /upload/ {
        proxy_pass http://upload_backend;
        proxy_request_buffering off;       # 边传边转（默认会先缓整个 body）
    }
    location /download/ {
        alias /data/files/;
        sendfile on;
        limit_rate_after 100m;             # 超过 100MB 后限速
        limit_rate 2m;
    }
}
```
- 大上传建议：`proxy_request_buffering off` 流式转发，避免 Nginx 临时落盘整个请求体。
- 超大文件（GB 级）走 **对象存储（COS/OSS）+ 分片上传 + 预签名 URL**，Nginx 只做静态下载。

### 13.4 场景：图片服务与 CDN 回源【进阶】
```nginx
location ~* ^/(avatars|uploads)/.*\.(png|jpg|jpeg|gif|webp)$ {
    root /data/images;
    expires 7d;
    add_header Cache-Control "public";
    access_log off;                        # 图片高流量不记日志
    open_file_cache max=10000 inactive=60s;
}
```
- CDN 回源时，源站 Nginx 要**正确处理条件请求**（If-Modified-Since/ETag → 304），避免重复回源全量。
- 图片实时裁剪：Nginx + **image_filter** 模块（`image_filter resize 200 200;`）或对象存储图片处理。
- WebP 协商：根据 `Accept` 头返回 WebP 格式（`map $http_accept $webp_suffix { ... }`）。

### 13.5 场景：WebSocket + SSE + 直播流【进阶】
- WebSocket：见 3.7（Upgrade + http1.1 + 长超时）。
- SSE：
  ```nginx
  location /sse/ {
      proxy_pass http://backend;
      proxy_buffering off;                 # 关键：关缓冲，边收边推
      proxy_cache off;
      proxy_read_timeout 3600s;
      add_header Cache-Control no-cache;
  }
  ```
- HLS 直播（.m3u8 分片）：
  ```nginx
  location ~ \.m3u8$  { root /data/hls; add_header Cache-Control no-cache; }
  location ~ \.ts$    { root /data/hls; expires 10s; }   # 分片短缓存
  ```
- 直播推流（RTMP）需编译 **nginx-rtmp-module**；现代方案更多用 SRS/云直播，Nginx 只做分发。

### 13.6 场景：网关能力组合（鉴权 + 限流 + 灰度 + 日志）【进阶】
```nginx
# 网关层 server
server {
    listen 443 ssl http2;

    # 全局限流
    limit_req zone=api burst=50 nodelay;
    limit_conn conn 100;

    location /open/ {                     # 开放接口：轻限流
        limit_req zone=open burst=20 nodelay;
        proxy_pass http://open_backend;
    }
    location /inner/ {                    # 内网接口：IP 白名单
        allow 10.0.0.0/8;
        deny all;
        proxy_pass http://inner_backend;
    }
    location / {                          # 默认走灰度池
        set $gw_pool main;
        if ($cookie_version = "beta") { set $gw_pool beta; }
        proxy_pass http://$gw_pool;
        proxy_set_header X-Gateway-Host $host;   # 链路追踪信息
    }
}
```
> 生产更推荐 **OpenResty/APISIX/Kong**：Lua 脚本实现复杂鉴权（JWT 校验）、动态路由、灰度、熔断，比纯 nginx.conf 可维护性好得多。

### 13.7 快问快答 20 连【高频】
1. **Nginx 默认端口**？80（HTTP）、443（HTTPS）。
2. **Nginx 用什么事件模型**？Linux 用 epoll，FreeBSD 用 kqueue。
3. **worker_processes 最佳值**？CPU 核数（auto）。
4. **最大并发怎么算**？worker_processes × worker_connections（反向代理约一半）。
5. **502 是什么**？上游连接失败/无响应。
6. **504 是什么**？上游响应超时。
7. **location 优先级**？= > ^~ > 正则 > 普通前缀。
8. **root 与 alias 区别**？root 拼接完整 URI，alias 替换匹配前缀。
9. **rewrite last 与 break**？last 重新匹配 location，break 不匹配。
10. **正向与反向代理**？正向代理隐藏客户端，反向代理隐藏服务器。
11. **Nginx 高可用**？Keepalived + VIP（VRRP 主备）。
12. **平滑 reload 信号**？HUP。
13. **日志切割信号**？USR1。
14. **限流算法**？Nginx limit_req 是漏桶。
15. **keepalive 作用**？连接复用省握手。
16. **HTTPS 为什么慢**？TLS 握手 + 加解密（可会话复用、TLS1.3、HTTP/2 优化）。
17. **防爬虫**？limit_req + UA 识别 + 验证码 + 风控。
18. **四层与七层**？四层 IP:端口（LVS/stream），七层 HTTP 内容（Nginx http 模块）。
19. **Nginx 能否处理 UDP**？可以，stream 模块支持 TCP/UDP。
20. **Nginx 与 Tomcat 区别**？Nginx 是 Web 服务器/反向代理，Tomcat 是 Java Servlet 容器（应用服务器）。

### 13.8 面试官追问：Nginx 与 OpenResty / API 网关【进阶】
- **OpenResty**：Nginx + LuaJIT + 官方/第三方模块。在 Nginx 各阶段注入 Lua 逻辑（access_by_lua、content_by_lua、balancer_by_lua），实现**动态路由、限流、灰度、鉴权、自定义负载均衡算法**。
- **Kong / APISIX**：基于 OpenResty 的成熟 API 网关，插件化（认证、限流、熔断、可观测），支持**动态配置**（配置中心同步，无需 reload）。
- 对比纯 Nginx：
  - Nginx 配置是**静态文件**，改配置要 reload；网关支持**动态下发**。
  - Nginx 的限流/灰度能力有限（IP/权重），Lua 可做**任意维度**（uid、设备、参数）。
  - 复杂网关逻辑推荐 APISIX/Kong；简单场景原生 Nginx 足够。

> 总结：Nginx 是"发动机"，OpenResty 是"发动机 + 可编程变速箱"，API 网关是"整车"。面试回答要体现**由浅入深**：先讲 Nginx 本身，再讲如何扩展，最后落到生产架构选型。

