1.比特币的私钥格式：WIF(base58编码)
**表4-1 Base58Check版本前缀和编码后的结果**

| 种类 | 版本前缀 (hex) | Base58格式 |
| --- | --- | --- |
| Bitcoin Address | 0x00 | 1 |
| Pay-to-Script-Hash Address | 0x05 | 3 |
| Bitcoin Testnet Address | 0x6F | m or n |
| Private Key WIF | 0x80 | 5, K or L |
| BIP38 Encrypted Private Key | 0x0142 | 6P |
| BIP32 Extended Public Key | 0x0488B21E | xpub |

*WIF（base58编码格式）与比特币的网络有关*


2.HEX转化为WIF格式时的过程（encode方法）
```java
public DumpedPrivateKey getPrivateKeyEncoded(NetworkParameters params) {
        return new DumpedPrivateKey(params, getPrivKeyBytes(), isCompressed());
    }
```
//判断是否需要压缩
```java
private static byte[] encode(byte[] keyBytes, boolean compressed) {
        Preconditions.checkArgument(keyBytes.length == 32, "Private keys must be 32 bytes");
        if (!compressed) {
            return keyBytes;
        } else {
            // Keys that have compressed public components have an extra 1 byte on the end in dumped form.
            byte[] bytes = new byte[33];
            System.arraycopy(keyBytes, 0, bytes, 0, 32);
            bytes[32] = 1;
            return bytes;
        }
    }
```
//版本号+私钥+checksum
```java
 /**
     * Returns the base-58 encoded String representation of this
     * object, including version and checksum bytes.
     */
    public final String toBase58() {
        // A stringified buffer is:
        //   1 byte version + data bytes + 4 bytes check code (a truncated hash)
        byte[] addressBytes = new byte[1 + bytes.length + 4];
        addressBytes[0] = (byte) version;
        System.arraycopy(bytes, 0, addressBytes, 1, bytes.length);
        byte[] checksum = Sha256Hash.hashTwice(addressBytes, 0, bytes.length + 1);
        System.arraycopy(checksum, 0, addressBytes, bytes.length + 1, 4);
        return Base58.encode(addressBytes);
    }
```

3.公钥生成地址与私钥转换WIF格式步骤流程一致
