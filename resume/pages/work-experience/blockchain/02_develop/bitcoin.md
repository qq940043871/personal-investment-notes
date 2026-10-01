## 操作系统
ubuntu18.04

## 依赖环境
```shell
sudo apt-get update
sudo apt-get upgrade

sudo apt-get install build-essential libtool autotools-dev autoconf pkg-config libssl-dev
sudo apt-get install libboost-all-dev
sudo apt-get install libqt5gui5 libqt5core5 libqt5dbus5 qttools5-dev qttools5-dev-tools libprotobuf-dev protobuf-compiler
sudo apt-get install libqrencode-dev
sudo apt-get install libminiupnpc-dev
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
#important! if happen libtool -rpath,不用理会，直接编译即可
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
 - error: C++ preprocessor "/lib/cpp" fails sanity check
>原因：缺少必要的C++库
>解决：
```shell
apt-get install build-essential
apt-get install g++
```

#参考资料#
[github.build-unix](https://github.com/OmniLayer/omnicore/blob/master/doc/build-unix.md)
[csdn.比特币环境编译](https://blog.csdn.net/aaadssdffff/article/details/52992688)