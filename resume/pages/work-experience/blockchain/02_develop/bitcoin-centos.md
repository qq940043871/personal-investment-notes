## 操作系统
centos7.4

## 依赖环境
```shell
#Build requirements:
sudo yum install gcc-c++ libtool make autoconf automake openssl-devel libevent-devel boost-devel libdb4-devel libdb4-cxx-devel
#Optional:
sudo yum install miniupnpc-devel
#To build with Qt 5 (recommended) you need the following:
sudo yum install qt5-qttools-devel qt5-qtbase-devel protobuf-devel
#libqrencode (optional) can be installed with:
sudo yum install qrencode-devel
```

## 下载源码
```shell
cd ~
git clone https://github.com/bitcoin/bitcoin.git
```

## 编译环境Berkley DB 4.8
```shell
#cd到bitcoin的下载目录
cd ~

#创建Berkley的下载目录
BITCOIN_ROOT=$(pwd)
BDB_PREFIX="${BITCOIN_ROOT}/db4"
mkdir -p $BDB_PREFIX

# 下载Berkley4.8并验证是否正确
cd $BDB_PREFIX
wget 'http://download.oracle.com/berkeley-db/db-4.8.30.NC.tar.gz'
echo '12edc0df75bf9abd7f82f821795bcee50f42cb2e5f76a6a281b85732798364ef  db-4.8.30.NC.tar.gz' | sha256sum -c
# -> db-4.8.30.NC.tar.gz: OK

#解压
tar -xzvf db-4.8.30.NC.tar.gz
# Build the library and install to our prefix
cd db-4.8.30.NC/build_unix/

# 指定编译参数
../dist/configure --enable-cxx --disable-shared --with-pic --prefix=$BDB_PREFIX

#编译Berkley
make install

#编译BTC to use our own-built instance of BDB
cd $BITCOIN_ROOT
./autogen.sh
./configure LDFLAGS="-L${BDB_PREFIX}/lib/" CPPFLAGS="-I${BDB_PREFIX}/include/"
make install
```

## 运行BTC
```shell
#图形化界面
./src/qt/bitcoin-qt
#非图形化服务端
./src/bitcoind
#非图形化客户端
./src/bitcoin-cli
```

## 常见问题
 - error:C++ preprocessor "/lib/cpp" fails sanity check
>原因：缺少必要的C++库
>解决：
```shell
yum install glibc-headers
yum install gcc-c++
```

- error:"javac -version" is not valid
>解决：`yum install java-devel`

-  error:"echo $JAVA_HOME" is ""
>解决：
```shell
#定位使用的java位置
which java
#定位java安装的真实目录
ls -lrt /usr/bin/java
ls -lrt /etc/alternatives/java
```

- error:'LIBTOOL is undefined'
>原因:没有安装aclocal;aclocal与libtool没有安装在一个相同目录下面;安装了多个aclocal;
>解决:
```shell
#安装libtool
yum install libtool
#查看aclocal的路径 
aclocal --print-ac-dir
#将相应的*.m4文件复制到这个路径下
```

## 参考资料
[github.build-unix](https://github.com/OmniLayer/omnicore/blob/master/doc/build-unix.md)
[csdn.比特币环境编译](https://blog.csdn.net/aaadssdffff/article/details/52992688)
[csdn.# error: C++ preprocessor "/lib/cpp" fails sanity check](https://blog.csdn.net/john_f_lau/article/details/17652523)