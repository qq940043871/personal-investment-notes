#!/bin/bash

PID=$1
if [ -z "$PID" ]; then
  echo "Usage: $0 <java_pid>"
  exit 1
fi

TS=$(date +%Y%m%d_%H%M%S)
DIR="jvm_diag_${PID}_${TS}"
mkdir -p $DIR

echo "==== JVM + Linux Diagnostic Collection ===="
echo "PID: $PID"
echo "Output: $DIR"
echo "==========================================="

############################################
# 1. 基础系统信息
############################################
echo "[1] Collecting system info..."
uptime > $DIR/uptime.txt
uname -a > $DIR/uname.txt
cat /etc/os-release > $DIR/os-release.txt 2>/dev/null
lscpu > $DIR/lscpu.txt 2>/dev/null
free -h > $DIR/free.txt

############################################
# 2. 负载 / CPU / 内存
############################################
echo "[2] Collecting CPU / load / memory..."
vmstat 1 5 > $DIR/vmstat.txt
mpstat -P ALL 1 3 > $DIR/mpstat.txt 2>/dev/null
top -b -n 1 > $DIR/top.txt

############################################
# 3. IO 状态
############################################
echo "[3] Collecting IO info..."
iostat -x 1 3 > $DIR/iostat.txt 2>/dev/null
df -h > $DIR/df.txt
mount > $DIR/mount.txt

############################################
# 4. 进程 / 线程状态
############################################
echo "[4] Collecting process / thread info..."
ps -p $PID -o pid,ppid,stat,%cpu,%mem,cmd > $DIR/ps_pid.txt
ps -eLo pid,tid,stat,pcpu,comm --sort=-pcpu | head -50 > $DIR/ps_threads_top.txt

# D 状态线程
ps -eLo pid,tid,stat,comm | awk '$3=="D"' > $DIR/d_state_threads.txt

############################################
# 5. JVM 专项
############################################
echo "[5] Collecting JVM info..."

# JVM 基本信息
jcmd $PID VM.version > $DIR/jvm_version.txt 2>/dev/null
jcmd $PID VM.flags > $DIR/jvm_flags.txt 2>/dev/null

# GC 状态
jstat -gcutil $PID 1 5 > $DIR/jstat_gcutil.txt 2>/dev/null

# jstack（非阻塞方式）
echo "  - jstack"
jstack $PID > $DIR/jstack.txt 2>/dev/null &
sleep 5

# 强制 SIGQUIT（兜底）
echo "  - kill -3 (SIGQUIT)"
kill -3 $PID
sleep 3

############################################
# 6. Native / 内核
############################################
echo "[6] Collecting native / kernel info..."

# 文件句柄
ls -l /proc/$PID/fd > $DIR/fd_list.txt 2>/dev/null

# limits
cat /proc/$PID/limits > $DIR/limits.txt 2>/dev/null

# 内核日志
dmesg -T | tail -200 > $DIR/dmesg_tail.txt

############################################
# 7. 网络
############################################
echo "[7] Collecting network info..."
ss -s > $DIR/ss_summary.txt
ss -antp > $DIR/ss_antp.txt 2>/dev/null

############################################
# 8. JVM 进程级 CPU Top（线程）
############################################
echo "[8] Collecting top threads..."
top -H -b -n 1 -p $PID > $DIR/top_threads.txt

############################################
# 打包
############################################
tar czf ${DIR}.tar.gz $DIR

echo "==========================================="
echo "Collection completed:"
echo "  ${DIR}.tar.gz"
echo "==========================================="