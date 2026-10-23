# Linux 深度面试题库

> 全栈架构师 · 面试考点全覆盖
> 覆盖 15 大章节 120+ 高频题：启动流程 → 文件系统 → 进程线程 → 内存 → CPU → 网络 → 三剑客 → Shell → 权限安全 → 磁盘IO → 信号调试 → 容器 → 日志监控 → 实战场景题 → 概念辨析。

---

## 01 启动流程与系统管理

### 1.1 Linux 开机启动的完整流程？
**流程**：`加电 → BIOS/UEFI 自检 → 引导介质 → GRUB2 → 加载内核 → 挂载根文件系统 → 启动 systemd(PID=1) → 按 target 并行启动服务 → 登录`

- **BIOS/UEFI**：POST 自检硬件，UEFI 支持 GPT 磁盘与安全启动，比传统 BIOS 更快。
- **GRUB2**：引导程序，从磁盘读取 `/boot/grub2/grub.cfg`，支持多内核多系统选择。
- **内核**：解压并初始化，挂载根文件系统（只读）→ 切换为读写，启动 `/sbin/init`。
- **systemd**：作为 1 号进程，读取默认 target（`default.target` → 通常软链到 `multi-user.target` 或 `graphical.target`），**并行启动依赖单元**。
- 传统 SysVinit 是串行执行 `/etc/rc.d/rc*.d/` 下的脚本，系统越大启动越慢，这也是 systemd 取代它的核心理由。

> 加分点：内核启动参数可在 GRUB 界面按 e 编辑，如追加 `single` 进入单用户模式（忘记 root 密码时用）。

### 1.2 MBR vs GPT 区别？
| 维度 | MBR | GPT |
|---|---|---|
| 分区表位置 | 磁盘第一个扇区 | 磁盘头尾各一份（冗余） |
| 最大容量 | 2TB | 9.4ZB |
| 主分区数 | 4 个（逻辑分区扩展） | 128 个 |
| 引导 | BIOS/传统模式 | UEFI 模式 |
| 校验 | 无 | CRC32 校验 |

### 1.3 systemd 核心概念？
- **Unit**：最小管理单元，类型有 `.service` `.socket` `.target` `.mount` `.timer` 等，位于 `/usr/lib/systemd/system`（发行版）与 `/etc/systemd/system`（自定义，优先级高）。
- **target**：一组 unit 的组合，等价于运行级别：`multi-user.target`（3）、`graphical.target`（5）。
- **关键命令**：
```
systemctl start/stop/restart/reload/status  服务名
systemctl enable/disable                    设置开机自启
systemctl list-units --type=service --state=running
systemctl daemon-reload                     修改 unit 文件后重载
journalctl -u 服务名 -f                     查看服务日志
systemctl is-enabled 服务名                 查看是否开机自启
```
- **unit 文件关键字段**：`[Unit]` 里 `After=` 定义依赖顺序、`[Service]` 里 `ExecStart=` `Restart=`（on-failure 崩溃自动拉起）、`[Install]` 里 `WantedBy=multi-user.target`。

### 1.4 运行级别 runlevel？
- 0 关机、1 单用户、2 无网络多用户、3 命令行多用户、5 图形界面、6 重启。
- systemd 中对应 target：`runlevel3.target → multi-user.target`、`runlevel5.target → graphical.target`。
- 切换：`init 3` / `systemctl isolate multi-user.target`；查看：`runlevel` / `systemctl get-default`。

### 1.5 /etc/fstab 关键字段？
```
设备       挂载点  类型   选项                 dump  fsck
/dev/sda1  /boot   xfs    defaults            0     1
UUID=xxx   /       xfs    defaults            0     0
/dev/sdb1  /data   ext4   defaults,noatime    0     2
```
- **noatime**：不更新访问时间，减少写 IO（数据库服务器常用）。
- **fsck 列**：根分区 1，其他数据分区 2，0 表示开机不检查。
- 建议挂载数据盘用 UUID 而非设备名（设备名重启后可能变化）。

---

## 02 文件系统与文件管理

### 2.1 "一切皆文件"如何理解？
- 普通文件、目录、设备（`/dev`）、管道、socket、符号链接、`/proc` 与 `/sys` 下的内核信息都以文件形式暴露。
- 好处：统一操作接口（open/read/write/close），可以用重定向、管道、重定向等方式操作设备与内核参数。
- 例：`echo 1 > /proc/sys/net/ipv4/ip_forward` 开启 IP 转发；`/proc/cpuinfo` 查看 CPU 信息。

### 2.2 inode 是什么？索引节点的作用？
- **inode** 保存文件的元数据：权限、属主属组、大小、时间戳（atime/mtime/ctime）、数据块指针，**不包含文件名**。
- 文件名存在**目录项 dentry** 中，dentry 是"文件名 → inode 号"的映射，目录本质是存 dentry 的特殊文件。
- 一个文件由三部分组成：**dentry（文件名）+ inode（元数据）+ data block（数据）**。
- 查看：`ls -i`、`stat 文件`；`df -i` 查看 inode 使用率（**inode 耗尽但磁盘有空间**是经典故障）。
- 文件操作过程：open() 先按路径逐级找到 dentry → inode → 数据块，涉及路径缓存（dcache）与 inode 缓存。

### 2.3 硬链接 vs 软链接？
| 维度 | 硬链接 | 软链接（符号链接） |
|---|---|---|
| 本质 | 同一 inode 的多个文件名 | 独立文件，内容是指向目标的路径 |
| inode | 相同 | 不同 |
| 跨文件系统 | 不支持 | 支持 |
| 链接目录 | 不支持 | 支持 |
| 目标删除 | 原文件不受影响 | 失效（红底闪烁） |
| 命令 | `ln a b` | `ln -s a b` |
- 硬链接原理：inode 有 `nlink` 引用计数，删除一个硬链接只是 `nlink-1`，为 0 才真正释放数据块。
- 经典题：`cp` vs `mv` 对硬链接的影响——`cp` 会创建新 inode 破坏硬链接关系，`mv` 只改 dentry 不影响。

### 2.4 FHS 标准目录结构？
- `/bin` `/sbin`：基本命令（现代发行版软链到 `/usr/bin`）。
- `/etc`：配置文件；`/var`：可变数据（日志、缓存、锁）；`/tmp`：临时文件。
- `/home`：普通用户家目录；`/root`：root 家目录。
- `/dev`：设备文件；`/proc`：进程与内核虚拟文件系统；`/sys`：设备与驱动信息。
- `/usr`：只读的应用程序与库（类似 Windows 的 Program Files）；`/opt`：第三方软件。
- `/boot`：内核与引导文件；`/mnt` `/media`：挂载点。

### 2.5 文件权限与 ACL？
- 权限位：`rwx` 三组（属主/属组/其他），`r=4 w=2 x=1`，可用数字表示。
- **目录权限要点**：目录的 r 决定能否 `ls` 列出文件名，w 决定能否增删文件，x 决定能否 `cd` 进入并访问内部文件。目录没有 x 权限时，即使有 r 也列不出 inode 信息。
- **umask**：默认权限 = 666/777 - umask。如 umask=022 → 文件 644、目录 755。
- **ACL**：`setfacl -m u:tom:rwx file` 给指定用户/组单独授权，解决"一个用户属于多个组但权限不匹配"的问题；查看 `getfacl`。

### 2.6 特殊权限 setuid / setgid / sticky？
- **setuid（SUID，4）**：`chmod u+s 文件`——执行时以**属主身份**运行，如 `/usr/bin/passwd` 以 root 身份改密码。`ls -l` 显示 `rws`。
- **setgid（SGID，2）**：对可执行文件以属组身份运行；对目录则新文件继承目录属组（常用于共享目录）。
- **sticky（1）**：`/tmp` 目录有 t 位，只有**文件属主或 root** 才能删除目录内的文件，防止互相删文件。显示 `drwxrwxrwt`。
- 数字法：`chmod 4755`（SUID）、`chmod 2755`（SGID）、`chmod 1777`（sticky）。
- 安全风险：SUID 文件若属主是 root 且可写，是提权漏洞，排查：`find / -perm -4000 2>/dev/null`。

### 2.7 磁盘满了怎么排查？
1. `df -h` 看哪个分区满；`df -i` 看 inode 是否耗尽。
2. `du -sh /*` 逐层定位大目录：`du -h --max-depth=1 /var | sort -rh | head`。
3. 文件被删除但进程仍占用 → `lsof | grep deleted`，确认后重启该进程或 `> 文件` 清空。
4. 日志膨胀：检查 `/var/log`，配置 logrotate 轮转。
5. 定位大文件：`find / -type f -size +1G -exec ls -lh {} \;`。

### 2.8 RAID 与 LVM 概念？
- **RAID0**：条带，读写快、无冗余，一块坏全坏。**RAID1**：镜像，容量减半、安全性最高。**RAID5**：分布式校验，至少 3 块盘，允许坏 1 块。**RAID10**：先镜像再条带，性能与安全兼顾，至少 4 块。
- **LVM**（逻辑卷管理）：PV（物理卷）→ VG（卷组）→ LV（逻辑卷）。核心优势：**容量可在线扩展/缩减**（`lvextend -L +10G /dev/vg0/data && xfs_growfs /`），而传统分区扩容麻烦。
- 查看：`pvdisplay` `vgdisplay` `lvdisplay`、`lsblk`、`blkid`。

---

## 03 进程与线程

### 3.1 进程与线程的区别？
- **进程**：资源分配的最小单位，有独立地址空间、文件描述符表、信号处理器；进程间通信需 IPC 机制，切换开销大。
- **线程**：CPU 调度的最小单位，共享进程的地址空间与资源（堆、全局变量、fd），各自拥有栈、寄存器、程序计数器；切换开销小。
- Linux 里两者都用 `clone()` 创建，线程是通过共享地址空间标志的"轻量级进程"。
- 多进程优势：隔离性好、一个崩溃不影响其他；多线程优势：共享数据方便、创建切换快。

### 3.2 fork 的写时拷贝（COW）原理？
- `fork()` 后子进程**不复制父进程全部内存**，而是共享页表并标记为只读。
- 只有一方写入时才触发缺页异常，复制该页（写时拷贝），大幅减少 fork 开销。
- **COW 解决了"fork 后立刻 exec"的场景**：exec 会完全替换地址空间，若 fork 时全量复制就是纯浪费。
- 追问：为什么 fork 不直接复制？——大进程 fork 慢且浪费内存，COW 让 fork 近乎 O(1)。

### 3.3 孤儿进程与僵尸进程？
- **孤儿进程**：父进程先退出，子进程被 **init/systemd（PID=1）收养**，继续正常运行，无害。
- **僵尸进程**：子进程先退出，但父进程没调用 `wait()` 回收，进程变成 **Z 状态**——保留 PCB 供父进程读取退出状态，但不占内存只占进程表项。
- 危害：大量僵尸进程会耗尽进程号（`pid_max`）与进程表，导致无法创建新进程。
- **处理**：定位父进程 `ps -ef | awk '$3==父PID'`；父进程是代码问题——需修改代码调用 wait()；临时手段：杀掉父进程让其变孤儿，由 init 统一回收；`kill -SIGCHLD 父进程` 通知父进程收尸（对不写 wait 的无效）。

### 3.4 进程状态？
```
R  running    运行/就绪
S  sleeping   可中断睡眠（等 IO）
D  uninterruptible sleep  不可中断睡眠（等磁盘IO，kill 不掉）
T  stopped    停止（Ctrl+Z 或 kill -STOP）
Z  zombie     僵尸
X  dead       已退出（瞬时）
```
- **D 状态**：正在等待磁盘 IO 的内核路径，无法被信号杀死，只能等 IO 完成；NFS 挂掉时常见，排查 `ps -eo stat,pid,comm | grep ^D`。

### 3.5 进程调度？
- Linux 默认调度器 **CFS（完全公平调度）**：按"虚拟运行时间"维护红黑树，每次选 vruntime 最小的进程运行，保证公平。
- **优先级**：普通进程 nice 值 -20~19（越小优先级越高）；实时进程（SCHED_FIFO/SCHED_RR）优先级 1~99 高于普通进程。
- 调整：`nice -n -5 命令`（启动时）、`renice -n -5 -p PID`（运行中）；`top` 里按 r 可调。
- 交互式进程 vs 批处理进程：CFS 通过 sleep 时间补偿，保证交互式响应快。

### 3.6 守护进程（daemon）？
- 特点：后台运行、无控制终端、通常以 root 启动、独立会话。
- 创建步骤：fork 一次或两次 → 子进程 setsid() 创建新会话 → 忽略 SIGHUP → 切换工作目录到 / → 重定向 stdin/stdout/stderr 到 /dev/null → 设置 umask。
- 现代做法：直接写 systemd unit 文件，由 systemd 管理（`Type=forking` 或 `Type=simple`），不需要手工 daemon 化。

### 3.7 进程间通信 IPC 有哪些？
| 方式 | 特点 | 适用 |
|---|---|---|
| 管道 pipe | 半双工、血缘关系进程 | 命令间 |
| 命名管道 FIFO | 无血缘进程 | 简单消息 |
| 信号 | 异步通知 | 控制进程 |
| 消息队列 | 内核管理、可带类型 | 结构化消息 |
| 共享内存 | 最快、需同步 | 大数据量 |
| 信号量 | 计数器同步 | 互斥/资源数 |
| Socket | 跨主机 | 分布式 |

- 经典追问：共享内存为什么最快？——无需内核拷贝，进程直接映射同一物理内存。
- 追问：它有什么问题？——需要自己加锁（信号量/互斥锁）保证同步。

### 3.8 文件描述符（fd）？
- fd 是进程打开文件的整数索引，指向内核的文件表（含文件偏移、打开模式）。
- 限制：`ulimit -n`（默认 1024，高并发服务需调大）；查看进程占用：`ls /proc/PID/fd`、`lsof -p PID`。
- **经典故障**：fd 耗尽 → "Too many open files"，排查 `lsof | wc -l`、`cat /proc/PID/limits`。
- 调整：`ulimit -n 65535`（临时）；`/etc/security/limits.conf` 加 `* soft nofile 65535`（永久）。

---

## 04 内存管理

### 4.1 虚拟内存与地址空间？
- 每个进程看到独立的 4GB（32 位）/ 128TB（64 位）虚拟地址空间，通过**页表**映射到物理内存。
- 好处：进程隔离（互不干扰）、地址统一（编译期无需关心物理地址）、允许超卖（虚拟 > 物理）。
- 64 位进程地址空间布局（从高到低）：栈 → 共享库/内存映射 → 堆 → BSS → 数据段 → 代码段。
- **栈 vs 堆**：栈由编译器管理、自动分配释放、容量小（8MB，`ulimit -s`）、访问快；堆由 malloc 管理、需手动释放、容量大（受虚拟内存限制）、易碎片化。

### 4.2 分页、缺页中断、页面置换？
- **分页**：物理内存按固定大小页（4KB）管理，虚拟页 → 物理页框映射。
- **缺页中断**：访问的页不在物理内存时触发，分为：① 有效缺页（页表项无效，需加载）；② 无效缺页（非法访问 → segment fault）。
- **页面置换算法**：LRU、LFU、Clock（改进型 LRU）；Linux 用近似 LRU。
- **thrashing（颠簸）**：物理内存不足时频繁换页，系统性能骤降——现象是 load 高但 CPU 空闲等待 IO，解决靠加内存或减少进程。

### 4.3 swap 的作用与调优？
- swap 是磁盘上的交换分区/文件，内存不足时把冷页换出。
- `swapon -s`、`/etc/fstab` 中配置；**swap 不是越多越好**：过量 swap 会导致频繁磁盘交换、延迟激增。
- `vm.swappiness`（0-100，默认 60）：值越小越倾向用物理内存。数据库服务器常设 0~10 避免 swap 抖动。
- 经典题：swap 使用率高一定内存不足吗？——可能只是内存充足但内核按策略提前换出冷页，需结合 `free` 的 available 判断。

### 4.4 OOM Killer 原理？
- 内存严重不足时，内核启动 OOM Killer 选择进程杀掉，依据 `oom_score`（内存占用大 + 分值高）。
- `/proc/PID/oom_score` 查看分值、`oom_score_adj` 可调（-1000 表示永不杀）。
- 常见误杀：数据库/缓存服务被 OOM，解决：保证内存冗余、限制单进程内存、给关键进程调低 oom_score_adj。
- 查看被杀记录：`dmesg | grep -i oom` 或 `journalctl -k | grep -i oom`。

### 4.5 free 命令详解（buffer vs cache）？
```
              total    used    free   shared  buff/cache   available
Mem:          15Gi    6.2Gi   1.1Gi   120Mi     7.7Gi       8.6Gi
```
- **buffer**：块设备写缓存（攒批落盘）。
- **cache**：文件页缓存（读加速），用 `page cache` 统一管理。
- **available ≈ free + 可回收 cache**——判断内存是否紧张应看 available 而非 free。
- 经典题：cache 占用大要不要清理？——不需要，page cache 会被自动回收；`echo 3 > /proc/sys/vm/drop_caches` 仅用于压测前清缓存。

### 4.6 内存泄漏如何排查？
1. `top` 看 RES 持续增长的进程（`ps aux --sort=-%mem`）。
2. `pmap -x PID` 看进程各段内存；`/proc/PID/status` 的 `VmRSS`。
3. Java：jmap/jstat；C/C++：valgrind memcheck、ASAN。
4. 监控工具：`free -s 2` 持续观察、Prometheus + cAdvisor。
5. 确认泄漏：重启后内存回落再观察是否缓慢爬升。

---

## 05 CPU 与性能分析

### 5.1 top 各字段含义？
- `load average`：1/5/15 分钟平均运行队列长度（含 D 状态），**单核 >1、多核 >核数**即超载，应除以核数判断。
- `%CPU`：进程占用；`RES`：物理内存；`SHR`：共享内存。
- 按 `P` 按 CPU 排序、`M` 按内存排序、`1` 展开多核。
- `us` 用户态 / `sy` 内核态 / `ni` 优先级调整 / `id` 空闲 / `wa` IO等待 / `hi` 硬中断 / `si` 软中断 / `st` 被虚拟机偷走（宿主机超卖）。

### 5.2 CPU 100% 如何排查？（高频实战）
```
top -c                        # 找到 CPU 最高的 PID
top -Hp PID                   # 找到该进程内最耗 CPU 的线程 TID
printf "%x\n" TID             # 转 16 进制
jstack PID | grep -A10 TID十六进制   # Java 场景看线程栈
strace -p PID -f              # C/C++ 场景跟踪系统调用
perf top / perf record        # 内核级采样
```
- 死循环 vs 频繁 GC：Java 看 GC 日志；业务代码看线程栈；内核态高（sy）看系统调用是否异常。

### 5.3 load average 高但 CPU 空闲？
- 说明大量进程处于 **D 状态**（等磁盘/网络 IO）或 R 队列排长队。
- 排查：`vmstat 1` 看 `b`（阻塞进程）、`wa`；`iostat -x 1` 看磁盘 `%util`；NFS 挂载是否卡住。
- 结论：load 高不一定 CPU 忙，可能是 IO 瓶颈。

### 5.4 上下文切换与中断？
- **上下文切换**：内核在不同进程/线程间切换，保存恢复寄存器、页表、栈。切换太频繁浪费 CPU，`vmstat` 的 `cs` 列查看，`pidstat -w` 看每个进程自愿/非自愿切换。
- **硬中断**：硬件设备通知 CPU（网卡、磁盘），`/proc/interrupts` 查看；**软中断**：内核延迟处理的任务（网络收包、定时器），`/proc/softirqs` 查看。
- 高并发网络场景：软中断（si）高是正常的，可开启 RPS 把软中断分散到多核。

### 5.5 常用性能命令全家桶？
- `vmstat 1`：r（运行队列）b（阻塞）swpd si so bi bo cs us sy wa id。
- `iostat -x 1`：%util（磁盘忙）、await（IO 等待）、svctm。
- `mpstat -P ALL 1`：各核使用率；`pidstat -u -r -d 1`：按进程统计。
- `sar`：历史性能数据（/var/log/sa）；`uptime`：load；`dstat`：综合。
- 排查顺序建议：uptime → vmstat → iostat → pidstat → 定位进程。

---

## 06 网络

### 6.1 网络排查命令体系？
- `ip addr` / `ifconfig`：网卡与 IP；`ip route` / `route -n`：路由。
- `ss -tlnp` / `netstat -tlnp`：监听端口与进程（**ss 更快，netstat 已废弃**）。
- `ss -ant`：查看 TCP 连接状态统计（TIME_WAIT 等）。
- `ping`：连通性与延迟；`traceroute`：路由路径；`curl -v`：HTTP 层排错。
- `dig` / `nslookup`：DNS 解析；`hostname -I`：本机 IP。
- 排查顺序：先 ping（通不通）→ 再 telnet/curl 端口（服务在不在）→ 再抓包（内容对不对）。

### 6.2 TCP 三次握手、四次挥手？
- **握手**：SYN → SYN+ACK → ACK；**挥手**：FIN → ACK → FIN → ACK。
- 为什么握手三次？——防止历史重复 SYN 建立无效连接，双方确认收发能力。
- 为什么挥手四次？——半关闭，一方发 FIN 只代表"我的数据发完了"，另一方可能还有数据要发，需分开确认。
- **TIME_WAIT**：主动关闭方进入，持续 2MSL（约 60s），作用：① 保证最后一个 ACK 到达；② 防止旧连接数据串扰。大量 TIME_WAIT 常见于短连接高并发。
- 处理：复用连接（连接池/HTTP keep-alive）；调 `net.ipv4.tcp_tw_reuse`（仅出方向）+ `tcp_fin_timeout`；服务端是被动方一般不会大量 TW。

### 6.3 DNS 解析流程？
`浏览器缓存 → 系统 hosts → 本地 DNS 缓存(nscd/systemd-resolved) → 递归 DNS 服务器 → 根服务器 → 顶级域服务器 → 权威服务器`。
- 常用文件：`/etc/hosts`、`/etc/resolv.conf`（nameserver 配置）。
- 排错：`dig 域名` 看响应、`getent hosts 域名` 测解析、`nslookup`。
- 经典题：ping 域名通但 curl 不通？——可能代理、防火墙 80/443、DNS 返回不同 IP。

### 6.4 防火墙 iptables / firewalld？
- **iptables**：四表五链——filter（过滤）/ nat（地址转换）/ mangle（修改）/ raw；PREROUTING、INPUT、FORWARD、OUTPUT、POSTROUTING。
- 常用命令：
```
iptables -L -n                        # 查看
iptables -A INPUT -p tcp --dport 22 -j ACCEPT
iptables -A INPUT -s 10.0.0.0/8 -j ACCEPT
iptables -A INPUT -j DROP             # 默认拒绝（放最后）
iptables -I INPUT 1 -p tcp --dport 8080 -s 1.2.3.4 -j ACCEPT
```
- **firewalld**：zone 概念（public/trusted），`firewall-cmd --permanent --add-port=8080/tcp && firewall-cmd --reload`。
- **nftables**：iptables 的继任者，语法统一。
- 注意：改防火墙前先确认自己有控制台/其他通道，防止把自己锁外面。

### 6.5 SSH 原理与安全加固？
- 原理：非对称加密握手（RSA/ECDSA 交换密钥）+ 对称加密传输（AES）+ HMAC 完整性校验。
- 流程：客户端连接 → 服务器发公钥 → 密钥协商（Diffie-Hellman）→ 认证（密码/公钥）→ 加密会话。
- 免密登录：`ssh-keygen -t ed25519` → `ssh-copy-id user@host`。
- **加固**：禁用 root 登录（`PermitRootLogin no`）、禁用密码登录用密钥（`PasswordAuthentication no`）、改端口（`Port 2222`）、`fail2ban` 防爆破、`AllowUsers` 白名单。
- 排错：`ssh -vvv` 详细日志、`/var/log/secure` 查看认证记录、`ss -tlnp | grep 22`。

### 6.6 tcpdump 抓包？
```
tcpdump -i eth0 -nn port 80          # 抓 80 端口
tcpdump -i any host 1.2.3.4          # 按 IP
tcpdump -i eth0 -w /tmp/a.pcap       # 存文件用 Wireshark 看
tcpdump -i eth0 'tcp[tcpflags] & tcp-syn != 0'  # 只抓 SYN
```
- 经典排查：应用连不上数据库 → 抓包看 SYN 是否重传、是否被 RST（防火墙拦截/服务未监听）。

### 6.7 端口与进程互查？
- 端口 → 进程：`lsof -i :8080`、`ss -tlnp | grep 8080`、`fuser 8080/tcp`。
- 进程 → 端口：`ss -tlnp | grep PID`、`lsof -p PID | grep TCP`。
- 经典故障：端口被占 → `lsof -i :8080` 找到 PID → 确认是否可杀 → `kill -9`。

### 6.8 HTTP 与 curl 常用？
- 状态码：2xx 成功、3xx 重定向、4xx 客户端错误（401 未认证、403 无权限、404 不存在、429 限流）、5xx 服务端错误（500、502 网关错误、503 不可用、504 超时）。
- `curl -v`（详细）、`curl -I`（只看头）、`curl -X POST -d '{}' -H 'Content-Type: application/json' url`、`curl -k`（跳过证书校验）、`curl -o file`、`curl -w '%{http_code} %{time_total}'`。

---

## 07 文本处理三剑客

### 7.1 grep 高频用法？
- `grep -E 'a|b'` 扩展正则、`grep -P` Perl 正则（支持 \d \s 等）、`grep -i` 忽略大小写、`grep -v` 取反、`grep -c` 计数、`grep -l` 只列文件名、`grep -r` 递归、`grep -A2 -B2` 上下文。
- 经典：`grep -rn "关键字" /目录/`、`ps aux | grep [j]ava`（反斜杠技巧防匹配自身）。

### 7.2 sed 高频用法？
```
sed -n '5p' file                  # 打印第 5 行
sed -n '10,20p' file              # 打印 10-20 行
sed -i 's/old/new/g' file         # 全局替换并写回
sed -i '/pattern/d' file          # 按模式删行
sed 's/^/前缀/' file              # 行首加前缀
sed '$a 新增行' file              # 末尾追加
```
- 注意：`-i` 直接改文件，建议先不加 -i 预览。

### 7.3 awk 高频用法？
```
awk '{print $1, $NF}' file        # 打印第 1 列和最后一列
awk -F: '{print $1}' /etc/passwd  # 指定分隔符
awk '$3 > 100 {print $1}'         # 条件过滤
awk '{sum += $1} END {print sum}' # 求和
awk 'NR==FNR{a[$1]=1} NR>FNR{...}' # 文件关联（类似 join）
```
- 内置变量：`$0` 整行、`NF` 列数、`NR` 行号、`FS/OFS` 分隔符、`BEGIN/END` 块。
- 经典统计：`awk '{print $1}' access.log | sort | uniq -c | sort -rn | head` 统计 top IP。

### 7.4 三剑客综合实战？
- 统计 access.log 各状态码数量：`awk '{print $9}' access.log | sort | uniq -c | sort -rn`。
- 提取 IP 并去重：`awk '{print $1}' access.log | sort -u | wc -l`。
- 统计 500 错误最多的 URL：`awk '$9==500 {print $7}' access.log | sort | uniq -c | sort -rn | head`。
- 找出日志中某个时间段：`sed -n '/2026-08-24 10:00/,/2026-08-24 11:00/p' app.log`。

---

## 08 Shell 脚本

### 8.1 变量与特殊变量？
- `$0` 脚本名、`$1-$9` 位置参数、`$#` 参数个数、`$@` 全部参数（独立）、`$*` 全部参数（一个字符串）、`$?` 上条命令退出码（0 成功）、`$$` 当前 PID。
- `$VAR` vs `${VAR}`：花括号用于拼接边界，如 `${name}_file`。
- 变量默认值：`${var:-默认值}`（未设/空时用）、`${var:=默认值}`（顺带赋值）、`${var:?报错}`。
- 只读变量、环境变量：`export` 导出给子进程；`env` 查看。

### 8.2 引号区别？
- **单引号**：所见即所得，不解析变量。
- **双引号**：解析变量与命令替换，推荐优先用。
- **反引号** `` `cmd` `` 与 `$(cmd)`：命令替换（推荐后者，可嵌套）。
- `(( ))`：算术运算 `$((1+2))`；`[ ]` 与 `[[ ]]`：条件测试（`[[ ]]` 支持 `&&` `||` 和正则 `=~`，更推荐）。

### 8.3 数组与关联数组？
```
arr=(a b c)                     # 普通数组
echo ${arr[0]} ${arr[@]} ${#arr[@]}   # 首元素/全部/个数
declare -A map=([k1]=v1 [k2]=v2)      # 关联数组（Bash4+）
echo ${map[k1]}
```
- 遍历：`for i in "${arr[@]}"`（注意引号防止空格分词）。

### 8.4 条件判断与流程控制？
```
if [ -f "$file" ]; then ... fi   # -f 文件存在 -d 目录 -z 空串 -n 非空
if [ "$a" = "$b" ]; then ... fi  # 字符串比较（= 而非 ==）
if [ "$n" -gt 10 ]; then ... fi  # 数字比较 -gt -lt -ge -le -eq -ne
case "$1" in
  start) ... ;;
  stop)  ... ;;
  *) echo "unknown"; exit 1 ;;
esac
```
- 逻辑：`[ a ] && [ b ]`（POSIX）、`[[ a && b ]]`（Bash）、`!` 取反。
- **注意坑**：`[` 后面必须有空格；变量必须加引号防止空值报错。

### 8.5 循环？
```
for i in {1..10}; do echo $i; done
for f in *.log; do echo $f; done
while read line; do echo "$line"; done < file.txt
while IFS= read -r line; do ... done < file   # 保留空格/反斜杠的标准写法
until [ 条件 ]; do ... done
```
- `break` / `continue`；`for i in $(seq 1 10)` 慢于 `{1..10}`。

### 8.6 函数与陷阱？
```
func() { local x=1; echo $x; return 0; }
```
- `local` 局部变量；函数需先定义再调用；`return` 返回值是退出码而非值。
- 脚本健壮性：`set -e`（出错即停）、`set -u`（未定义变量报错）、`set -o pipefail`（管道中任一失败算失败）。
- 调试：`bash -x script.sh`、`set -x`。

### 8.7 常用组合命令？
- `find / -name "*.conf" -mtime -7`（7 天内修改）；`find /tmp -type f -size +100M -delete`。
- `xargs`：`find . -name "*.log" | xargs rm -f`（注意文件名带空格用 `-0`/`-d '\n'`）；`echo '1 2 3' | xargs -n1 echo`。
- `sort -k2 -n -r`（按第 2 列数值倒序）、`uniq -c`（去重计数，需先 sort）、`wc -l`、`head/tail -n`、`tail -f`（跟踪日志）。
- `tee`：输出同时写文件和终端；`tr 'a-z' 'A-Z'` 大小写转换；`cut -d: -f1` 取列。

### 8.8 I/O 重定向？
- `>` 覆盖、`>>` 追加、`2>` 错误、`2>&1` 合并（顺序有讲究）、`&>` 全部、`<` 输入。
- `/dev/null` 丢弃；`/dev/zero` 造零、`/dev/random` 随机数。
- 经典：`nohup cmd > /tmp/a.log 2>&1 &` 后台运行不随终端退出；`setsid` 摆脱会话。

---

## 09 权限与安全

### 9.1 用户与组管理？
- 用户：`useradd` / `usermod` / `userdel`；组：`groupadd` / `groupmod` / `groupdel`；`passwd` 改密码、`id` 查看身份、`whoami`、`su` 切换用户、`sudo` 提权。
- `useradd -m -s /bin/bash -G wheel tom`：创建用户并指定 shell 和附加组。
- **wheel 组**：sudo 白名单组（CentOS/RHEL 系列）。
- 文件：`/etc/passwd`（用户信息）、`/etc/shadow`（加密密码，仅 root 可读）、`/etc/group`。

### 9.2 sudo 配置？
- `visudo` 编辑 `/etc/sudoers`。
- `tom ALL=(ALL) ALL`：tom 可执行所有命令；`tom ALL=(ALL) NOPASSWD: /usr/bin/systemctl`：免密执行指定命令。
- 原理：sudo 有 5 分钟时间戳缓存；日志记录在 `/var/log/secure`。
- 安全：尽量用 `NOPASSWD` + 最小命令集，避免 `ALL ALL=(ALL) ALL`。

### 9.3 SELinux 与 AppArmor？
- **SELinux**（强制访问控制 MAC）：主体（进程）对客体（文件/端口）的安全上下文强制校验，三种模式：Enforcing / Permissive / Disabled。
- 经典故障：服务端口被 SELinux 拦截（`Permission denied` 但权限没问题）→ `getenforce`、`ausearch -m avc` 查日志、`semanage port -a -t http_port_t -p tcp 8080` 放行，或临时 `setenforce 0`。
- **AppArmor**：基于路径的 MAC（Ubuntu 默认），配置简单；SELinux 基于标签更精细但学习成本高。

### 9.4 chroot 与容器隔离？
- `chroot` 把进程的根目录切换到指定目录，限制其可见文件系统。
- 局限：chroot 只隔离文件系统视图，进程仍可访问网络、共享内核资源，配合权限限制使用。
- 现代容器 = **namespace（隔离视图）+ cgroup（限制资源）+ 联合文件系统（镜像）**，比 chroot 隔离更全面。

### 9.5 密码安全与爆破防护？
- 密码哈希：shadow 文件存哈希（SHA512/yescrypt），带随机 salt。
- 爆破防护：`fail2ban`（封禁多次失败 IP）、`pam_tally2`（登录失败锁定）、密钥登录替代密码。
- 审计：`last`（登录历史）、`lastb`（失败登录）、`/var/log/secure`。

---

## 10 磁盘与 IO

### 10.1 五种 IO 模型？
1. **阻塞 IO**：read 没数据就一直等，占用线程。
2. **非阻塞 IO**：立即返回，轮询检查（忙等浪费 CPU）。
3. **IO 多路复用**：select/poll/epoll 一个线程监控大量 fd。
4. **信号驱动 IO**：数据就绪发信号通知。
5. **异步 IO（AIO）**：内核完成全部操作后通知，如 io_uring。
- **epoll 优势**（对比 select/poll）：无 1024 上限、O(1) 就绪通知、mmap 共享内核事件表、水平/边缘触发。
- 经典追问：为什么 Redis/Nginx 高并发用 epoll？——单线程处理万级连接，靠事件驱动避免线程切换开销。

### 10.2 page cache 与脏页回写？
- 读文件先到 page cache，命中免磁盘 IO；写文件先写 cache 标记脏页，后台按策略回写。
- 回写触发：`vm.dirty_ratio`（脏页占内存比例，默认 20%）触发后台回写；`vm.dirty_background_ratio`（默认 10%）触发前台阻塞。
- 刷盘：`sync` 手动；`/proc/sys/vm/dirty_expire_centisecs` 超时回写。
- 追问：为什么 MySQL 需要 `innodb_flush_log_at_trx_commit=1` 且不依赖 OS 缓存？——OS 缓存掉电丢数据，InnoDB 自己控制 fsync。

### 10.3 磁盘性能排查？
- `iostat -x 1`：`%util`（磁盘繁忙度）、`await`（平均 IO 等待，含队列）、`svctm`（实际服务时间）、`rrqm/s wrqm/s`（合并率）。
- `iotop`：按进程看 IO 占用；`pidstat -d 1`。
- 判断：`%util` 接近 100% 且 await 大 → 磁盘瓶颈；await 大但 %util 低 → 可能是单盘随机 IO 或内存不足引起换页。
- 优化：SSD、RAID 条带、顺序 IO、批量写入、合并小文件。

### 10.4 大文件处理？
- 创建：`dd if=/dev/zero of=/tmp/big bs=1M count=1024`；查看大小：`ls -lh`、`du -h`、`stat`。
- 切割：`split -b 100M file part_`（按大小）、`split -l 10000 file part_`（按行数）；合并：`cat part_* > file`。
- 只看开头结尾：`head -100`、`tail -100`、`tail -f`。
- 大文件搜日志：避免 `cat` 整文件，用 `grep`/`sed` 直接流式处理；超大文件先 `split` 并行处理。

---

## 11 信号与调试

### 11.1 常见信号？
| 信号 | 值 | 含义 |
|---|---|---|
| SIGHUP | 1 | 终端挂断/重新加载配置（Nginx reload） |
| SIGINT | 2 | Ctrl+C 中断 |
| SIGQUIT | 3 | Ctrl+\ 退出并 core dump（Java 用它打线程栈） |
| SIGKILL | 9 | 强制杀死，不可捕获/忽略 |
| SIGTERM | 15 | 优雅终止，可捕获做清理（kill 默认） |
| SIGCHLD | 17 | 子进程退出通知父进程 |
| SIGSTOP | 19 | 暂停，不可捕获 |
| SIGTSTP | 20 | Ctrl+Z 暂停 |

- 原则：优先 SIGTERM（优雅退出），实在不行才 SIGKILL（可能丢数据、不落盘）。
- 经典题：`kill -9` 的危害？——进程无法清理临时文件、释放锁、落盘，可能留下脏数据或半成品文件。

### 11.2 信号操作命令？
- `kill -l` 列出所有信号；`kill -TERM PID`、`kill -9 PID`；`killall 进程名`（按名）；`pkill -f 模式`（按命令行匹配）。
- 按端口杀：`fuser -k 8080/tcp`、`lsof -i :8080 | awk 'NR>1{print $2}' | xargs kill -9`。
- **trap**：脚本里捕获信号做清理：`trap 'echo 清理; exit' TERM INT`。
- 例：`kill -HUP $(cat /var/run/nginx.pid)` 优雅 reload。

### 11.3 strace / ltrace / gdb？
- **strace**：跟踪系统调用与信号，`strace -p PID`（附加）、`strace -f -e trace=network ./app`（只看网络调用）、`strace -c`（统计）。
- 经典排查：程序卡住 → `strace -p PID` 看到卡在哪个系统调用（connect/read）。
- **ltrace**：跟踪库函数调用（malloc/free 等）。
- **gdb**：调试器，`gdb -p PID` 附加、`bt` 看调用栈、`info threads`。
- Java 替代：`jstack`、`jmap`、`jcmd`。

### 11.4 dmesg 与内核日志？
- `dmesg` 查看内核环形缓冲区：硬件错误、OOM、段错误、磁盘 IO 错误。
- `dmesg -T` 显示人类可读时间；`journalctl -k`（systemd 系统）。
- 经典：程序崩溃 → `dmesg | grep -i segfault` 看是否访问非法内存。
- core dump：`ulimit -c unlimited` 开启，`gdb 程序 core文件` 分析崩溃现场。

---

## 12 容器与虚拟化

### 12.1 Docker 核心原理？
- **namespace**：隔离视图——PID（进程号）、NET（网络栈）、MNT（挂载）、UTS（主机名）、IPC、USER（用户）。
- **cgroup**：限制资源——CPU、内存、IO、PID 数，防止单个容器吃光宿主。
- **联合文件系统（OverlayFS）**：镜像分层，只读底层 + 可写顶层，写时拷贝，节省磁盘。
- 与传统虚拟机区别：**共享宿主内核**、无硬件虚拟化、启动毫秒级；虚拟机有独立内核，隔离更彻底。

### 12.2 Docker 常用命令？
```
docker ps -a                          # 所有容器
docker images                         # 镜像
docker exec -it 容器 bash             # 进入容器
docker logs -f 容器                   # 日志
docker build -t app:v1 .              # 构建
docker run -d -p 8080:80 --name web nginx
docker stop/start/rm 容器
docker inspect 容器                   # 查看配置
docker rmi 镜像 / docker system prune # 清理
```
- `-v /data:/data` 挂载卷、`--restart=always` 崩溃自启、`--network host/bridge/none`。

### 12.3 Dockerfile 最佳实践？
```
FROM openjdk:17-jre-slim
WORKDIR /app
COPY target/app.jar app.jar          # 先拷贝依赖再拷贝代码，利用层缓存
EXPOSE 8080
CMD ["java", "-jar", "app.jar"]
```
- 层缓存：**变更频率低的指令放前面**（依赖 → 代码），改动代码只重建最后一层。
- 多阶段构建：builder 阶段编译，runtime 阶段只拷贝产物，镜像更小。
- `.dockerignore` 排除无用文件；尽量用 slim 基础镜像；单进程原则。

### 12.4 容器网络模式？
- **bridge（默认）**：容器经 docker0 网桥 NAT 出网，端口映射 -p。
- **host**：直接使用宿主网络栈，无 NAT，性能好但端口冲突风险。
- **none**：无网络。
- **container**：与指定容器共享网络栈。
- 容器间通信：自定义 bridge 网络（`docker network create`）内用服务名互访；k8s 中 Pod 内共享网络。

### 12.5 容器故障排查？
- 启动失败：`docker logs 容器` 看报错；`docker inspect` 看 ExitCode。
- 进不去：`docker run --entrypoint sh 镜像` 覆盖入口。
- 资源占用：`docker stats` 实时监控。
- 宿主机被容器拖垮：设置 `--memory`、`--cpus` 限制；`pids-limit`。
- 文件系统：容器删除后数据丢失 → 用 volume 持久化。

---

## 13 日志与监控

### 13.1 日志体系？
- **syslog/rsyslog**：系统日志 `/var/log/messages`（CentOS）、`/var/log/syslog`（Ubuntu）。
- **journald**：systemd 的二进制日志，`journalctl -u 服务名 -f`、`journalctl --since "1 hour ago"`、`journalctl -k`（内核）。
- 其他：`/var/log/secure`（认证/安全）、`/var/log/cron`（定时任务）、`/var/log/dmesg`。
- 应用日志规范：统一格式（时间/级别/请求ID）、分级（DEBUG/INFO/WARN/ERROR）、按天/按大小切分。

### 13.2 logrotate 日志轮转？
```
/etc/logrotate.conf + /etc/logrotate.d/ 配置：
/var/log/nginx/*.log {
    daily
    rotate 30          # 保留 30 份
    compress           # 压缩旧日志
    missingok
    notifempty
    postrotate
        /bin/kill -USR1 $(cat /var/run/nginx.pid)   # 通知应用重开日志
    endscript
}
```
- 触发：cron 每天执行 `logrotate -f`（-f 强制）；`logrotate -d` 调试模式预览。
- 经典故障：日志不轮转 → 磁盘写满；应用持有已删除 fd 仍写盘（`lsof | grep deleted`）。

### 13.3 定时任务 crontab？
- `crontab -e` 编辑、`crontab -l` 查看、`crontab -r` 删除；系统级 `/etc/crontab`、`/etc/cron.d/`。
- 格式：`分 时 日 月 周 命令`；`*/5 * * * *` 每 5 分钟；`0 2 * * *` 每天 2 点。
- 环境坑：cron 环境变量少（无 PATH），命令用绝对路径；输出重定向到日志：`>> /var/log/cron.log 2>&1`。
- 日志：`/var/log/cron` 看是否执行；检查服务：`systemctl status crond`。

### 13.4 监控告警思路？
- 采集：Prometheus node_exporter（CPU/内存/磁盘/网络）、Telegraf、脚本 + crontab。
- 告警：阈值（CPU>80%、内存 available<10%、磁盘>85%、load>核数、fd 使用率>90%）+ 通知（企业微信/钉钉/SMTP）。
- 看板：Grafana。
- 自建简单监控脚本：`df -h | awk '$5+0 > 85 {print}'` 配合 cron 发邮件。

---

## 14 高频场景题（实战排查）

### 14.1 线上 CPU 100% 怎么办？
```
top -c → 找 PID
top -Hp PID → 找线程 TID
printf '%x\n' TID → 转十六进制
jstack PID | grep -A30 十六进制TID   # Java
strace -p PID -f                     # 系统调用
perf top -p PID                      # 采样热点
```
- 常见原因：死循环、正则回溯、GC 频繁、线程池打满、JIT 编译期（瞬态）。
- 处置：先保留现场（jstack 快照）→ 再决定重启还是修复。

### 14.2 内存不足 / OOM 怎么排查？
1. `free -h` 看 available、`dmesg | grep -i oom` 确认被杀进程。
2. `ps aux --sort=-%mem | head` 找内存大户。
3. 判断是正常峰值（加内存/限流）还是泄漏（持续增长）。
4. 处置：调大内存、限制单进程（`ulimit -v`）、优化代码/连接池、调 `oom_score_adj` 保护关键进程。

### 14.3 磁盘空间满（含 inode 满）？
- `df -h` vs `df -i` 区分：空间满清大文件（见 2.7）；**inode 满**通常是大量小文件/缓存目录，用 `find / -xdev -type f | wc -l` 定位目录。
- 经典：`/tmp` 下大量 session 文件、`/var/spool` 邮件队列、Docker 容器日志未轮转。
- 处置：`du -sh /var/*` 逐层定位 → 清日志/清缓存/扩容。

### 14.4 大量 TIME_WAIT 怎么处理？
- 现象：`ss -ant | grep TIME_WAIT | wc -l` 上万。
- 原因：短连接高并发（服务端主动关闭或客户端大量短连）。
- 处理：
```
net.ipv4.tcp_tw_reuse = 1      # 出方向复用（3.6+ 安全）
net.ipv4.tcp_fin_timeout = 30  # 缩短 TIME_WAIT
net.ipv4.tcp_max_tw_buckets   # 上限
```
- 根本方案：**连接池/HTTP keep-alive 复用连接**，从源头减少建连。
- 注意：`tcp_tw_recycle` 已废弃（NAT 环境会导致丢包），勿用。

### 14.5 文件删了但磁盘空间不释放？
- 原因：进程仍持有已删除文件的 fd。
- 排查：`lsof | grep deleted` → 找到 PID 与文件大小。
- 处置：能重启就重启；不能重启可 `> /proc/PID/fd/N` 清空（注意 N 是 fd 号）。
- 预防：日志服务正确轮转、应用打开文件后及时 close。

### 14.6 僵尸进程怎么清理？
- `ps -eo stat,pid,ppid,cmd | grep ^Z` 定位。
- 处置：`kill -SIGCHLD 父PID` 提示父进程收尸；杀父进程（若可）由 init 收养回收；根治需修代码 `wait()`/`waitpid()`。
- 注：僵尸进程无法用 kill -9 杀死（已死），只能清父进程或父进程正确 wait。

### 14.7 SSH 连接慢？
- 原因：DNS 反向解析（`UseDNS no`）、GSSAPI 认证（`GSSAPIAuthentication no`）、网络延迟、密码认证慢。
- 排查：`ssh -vvv user@host` 看卡在哪一步；`tail -f /var/log/secure`。
- 加固同时优化：`vim /etc/ssh/sshd_config` 设 `UseDNS no` + `GSSAPIAuthentication no` + 密钥认证，重启 sshd。

### 14.8 端口被占用？
- `lsof -i :8080` 或 `ss -tlnp | grep 8080` → 拿到 PID。
- `ps -p PID -o pid,cmd` 确认是什么程序 → 决定 kill 或换端口。
- 排查 TIME_WAIT 大量占用端口的假象：`ss -ant state time-wait` 单独看。

### 14.9 服务启动失败排查路径？
1. `systemctl status 服务` 看报错与 ExitCode。
2. `journalctl -u 服务 -n 100 --no-pager` 看最近日志。
3. 二进制直接前台运行看输出：`/usr/bin/服务 -c 配置`。
4. 常见原因：端口被占、配置语法错（`nginx -t`）、权限不足、依赖服务未起（数据库没连上）、内存不足。
5. 验证配置：多数服务有 `-t`（测试）参数，先测后重启。

### 14.10 系统整体变慢排查思路？
```
uptime        # load 是否高
vmstat 1 5    # us/sy/wa、r/b、cs 上下文切换
free -h       # 内存 available
iostat -x 1   # 磁盘 %util/await
ss -ant       # 连接数、队列
dmesg -T | tail   # 内核报错、OOM、软锁定
```
- 结论分支：CPU 瓶颈（加核/优化代码）、IO 瓶颈（换 SSD/合并写）、内存瓶颈（加内存/减少进程）、网络瓶颈（带宽/连接数）、系统调用风暴（strace 定位）。

### 14.11 找大文件 / 占空间排行？
```
du -h --max-depth=1 / | sort -rh | head -20
find / -xdev -type f -size +500M -exec ls -lh {} \;
du -sh /var/log/* 2>/dev/null | sort -rh | head
find . -name "*.log" -size +100M -exec ls -lh {} \;
```
- 配合 `df -h` 先锁定分区，再往下钻，避免全盘扫太慢。

### 14.12 应用连接数据库超时？
1. `ping` 网络通不通、`telnet DB_IP 3306` 端口通不通。
2. `ss -ant | grep 3306` 看连接建立情况、是否 SYN_SENT 堆积（防火墙丢包）。
3. 数据库侧：`show processlist` 看连接数、`max_connections` 是否打满。
4. 应用侧：连接池配置（初始/最大/超时）、是否 fd 耗尽。
5. 防火墙/SELinux 是否拦截：临时 `setenforce 0` 验证、检查 iptables。

---

## 15 常考概念辨析

### 15.1 软链接 vs 硬链接？
见 2.3 表格。一句话：**硬链接同一 inode 多名字，软链接是存路径的指针**。

### 15.2 静态库 vs 动态库？
- 静态库（.a）：编译时打入可执行文件，独立部署但体积大、升级需重新编译。
- 动态库（.so）：运行时加载，多个进程共享一份、可单独升级（`ldd` 查看依赖、`LD_LIBRARY_PATH` 指定路径）。
- 经典故障：`error while loading shared libraries` → `ldconfig` 刷新缓存、`LD_LIBRARY_PATH`、或 `rpath`。

### 15.3 阻塞/非阻塞 vs 同步/异步？
- **阻塞/非阻塞**：描述调用方在等待结果时是否挂起（read 是否立即返回）。
- **同步/异步**：描述结果由谁通知（调用方自己取 vs 内核主动通知）。
- 组合：同步阻塞（传统 read）、同步非阻塞（轮询）、异步阻塞（少见）、异步非阻塞（epoll + io_uring、AIO）。

### 15.4 用户态 vs 内核态、系统调用？
- 内核态：有完整硬件访问权限；用户态：受限（通过系统调用进入内核）。
- 划分目的：**安全隔离**，防止用户程序破坏系统。
- 切换代价：涉及特权级切换、栈切换、上下文保存，**频繁系统调用是性能杀手**（所以有 epoll、sendfile、零拷贝优化）。
- 查看系统调用：strace；`/usr/include` 查看接口。

### 15.5 中断 vs 异常 vs 系统调用？
- **中断**：外部硬件异步触发（网卡收包）。
- **异常**：CPU 执行指令时同步触发（缺页、除零）。
- **系统调用**：用户程序主动请求内核服务（int 0x80 / syscall 指令）。
- 共同点：都要切换到内核态处理。

### 15.6 buffer vs cache？
- buffer：块设备缓冲（写合并）；cache：文件页缓存（读加速）；现代内核统一为 page cache 管理。
- 追问见 4.5：判断内存看 `available` 而非 `free`。

### 15.7 进程 vs 线程 vs 协程？
| 维度 | 进程 | 线程 | 协程 |
|---|---|---|---|
| 调度者 | 内核 | 内核 | 用户态自己 |
| 切换开销 | 大（页表/上下文） | 中 | 极小（函数级） |
| 共享 | 不共享 | 共享进程资源 | 共享线程栈外的变量 |
| 适用 | 隔离要求高 | 计算密集/并行 | IO 密集高并发（如 Go goroutine） |

- 追问：协程为什么快？——用户态调度，无内核陷阱，切换只换寄存器上下文；单线程内跑成千上万协程。

---

> 面试心法：Linux 八股背结论（命令、参数、原理一句话），但**高分全靠场景题**——把 14 章的排查思路背成自己的"肌肉记忆"，追问时能"先确认现象 → 再给命令 → 再给处置"三层递进回答。
