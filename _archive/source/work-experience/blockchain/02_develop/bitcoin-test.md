1.查询区块链信息  getinfo
```javascript
var getInfo = {
        "version" : 130200,
        "protocolversion" : 70015,
        "walletversion" : 130000,
        "balance" : 0,
        "blocks" : 0,
        "timeoffset" : 0,
        "connections" : 0,
        "proxy" : "",
        "difficulty" : 4.656542373906925E-10,
        "testnet" : false,
        "keypoololdest" : 1523321929,
        "keypoolsize" : 100,
        "paytxfee" : 0,
        "relayfee" : 1.0E-5,
        "errors" : ""
}
```

2.查询矿工相关信息getmininginfo
```javascript
var getmininginfo = {
        "blocks" : 0,
        "currentblocksize" : 0,
        "currentblockweight" : 0,
        "currentblocktx" : 0,
        "difficulty" : 4.656542373906925E-10,
        "errors" : "",
        "networkhashps" : 0,
        "pooledtx" : 0,
        "testnet" : false,
        "chain" : "regtest"
}
```

3.生成用来挖矿的地址到默认账户
getaccountaddress：mr8aXWzT1XgiWwYcvkpmCf4Les5kcdiKdK
```java
@Test
    public void getnewaddress() throws Throwable {
        try {
            String resData = rpcClient.invoke("getnewaddress", new Object[]{""}, String.class);
            System.out.println(resData);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
```

4.回归测试环境下generatetoaddress
```java
@Test
    public void generatetoaddress() throws Throwable {
        try {
            JSONArray resData = rpcClient.invoke("generatetoaddress", new Object[]{200,"mr8aXWzT1XgiWwYcvkpmCf4Les5kcdiKdK",50000}, JSONArray.class);
            System.out.println(resData.toString());
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
```

5.查询区块信息getblockhash(1)
```javascript
var getblock = {
    "hash" : "155ddda2631b867399dfd61da30a3fe670bc715c0c6ed8630579639e54b782b8",
    "confirmations" : 200,
    "strippedsize" : 216,
    "size" : 216,
    "weight" : 864,
    "height" : 1,
    "version" : 536870912,
    "versionHex" : "20000000",
    "merkleroot" : "27dd6194d214fb6b3e0610c1db7cfc85c175cd9a21b546278aa13f889fbb553c",
    "tx" : [ "27dd6194d214fb6b3e0610c1db7cfc85c175cd9a21b546278aa13f889fbb553c" ],
    "time" : 1523329412,
    "mediantime" : 1523329412,
    "nonce" : 1,
    "bits" : "207fffff",
    "difficulty" : 4.656542373906925E-10,
    "chainwork" : "0000000000000000000000000000000000000000000000000000000000000004",
    "previousblockhash" : "0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206",
    "nextblockhash" : "604f742d6ea47c746330136e9ed3cdd3510315941c400191ff1ba1e37ee3ce9f"
}
```
6.生成账户地址用来进行交易
getnewaddress：msMbtMaUnqoiRoXVqBFAuDxUnB3Ni4PaKf
getnewaddress：mpQnC4sNzkuJH8eu9QakWoUANPykJhydqK
```java
@Test
    public void getnewaddress() throws Throwable {
        try {
            String resData = rpcClient.invoke("getnewaddress", new Object[]{"haswhere"}, String.class);
            System.out.println(resData);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
```

7.查询地址接收过的余额
```json
//listAccounts: 查询所有账户的汇总余额,前100区块没有奖励、包含挖矿奖励，接收的外部账户的所有余额
{"":5000,"haswhere":0}

//getbalance(""):
5000.0

//listreceivedbyaddress:--查询所有地址接收过的余额、已花费的仍然统计，不包含挖矿奖励
[{"address":"mm7pX4URLoq3UBGsV1FDxQQcHxskNgnuQb","account":"","amount":0,"confirmations":0,"label":"","txids":[]},{"address":"mpQnC4sNzkuJH8eu9QakWoUANPykJhydqK","account":"haswhere","amount":0,"confirmations":0,"label":"haswhere","txids":[]},{"address":"mr8aXWzT1XgiWwYcvkpmCf4Les5kcdiKdK","account":"","amount":0,"confirmations":0,"label":"","txids":[]},{"address":"msMbtMaUnqoiRoXVqBFAuDxUnB3Ni4PaKf","account":"haswhere","amount":0,"confirmations":0,"label":"haswhere","txids":[]}]


//getreceivedbyaddress("mr8aXWzT1XgiWwYcvkpmCf4Les5kcdiKdK"):查询所有地址接收过的余额、已花费的仍然统计
0.0
```

8.sendtoaddress默认记账到""的账户\如果默认账户没钱、则会记账为负，BUG
```java
@Test
    public void sendtoaddress() throws Throwable {
        try {
            String aa = rpcClient.invoke("sendtoaddress", new Object[]{"msMbtMaUnqoiRoXVqBFAuDxUnB3Ni4PaKf",100}, String.class);
            System.out.println(aa);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

//返回结果：b4c65c4d3bac2f6a1125f264910bddd711ca85f2c2d5de24b56ad281f9153b2f
```
9.gettransaction("b4c65c4d3bac2f6a1125f264910bddd711ca85f2c2d5de24b56ad281f9153b2f") 根据txid查询交易信息
```javascript
var gettransaction = {
    "amount" : 0,
    "fee" : -6.356E-4,
    "confirmations" : 0,
    "trusted" : true,
    "txid" : "29bbb5b14c575c1c208334f7381b11acd557dd5b1904e0520d7f96d82941bd5f",
    "walletconflicts" : [],
    "time" : 1523327479,
    "timereceived" : 1523327479,
    "bip125-replaceable" : "no",
    "details" : [ {
        "account" : "",
        "address" : "mrMPWBKsbycM7UcDYhLMDVXSwPdL3wFTRr",
        "category" : "send",
        "amount" : -1000,
        "label" : "haswhere",
        "vout" : 0,
        "fee" : -6.356E-4,
        "abandoned" : false
    }, {
        "account" : "haswhere",
        "address" : "mrMPWBKsbycM7UcDYhLMDVXSwPdL3wFTRr",
        "category" : "receive",
        "amount" : 1000,
        "label" : "haswhere",
        "vout" : 0
    } ],
    "hex" : "01000000159a22923f508618b7eef7e3e5a4fbc67c52bbc9eee487a855d50b114673a569a9000000006b483045022100f8382fd324d489645ba394de3b32e2569997c85c974eda3b8f5d47b87923006e0220503a474010c1782e8cff0c059ca592102b45746daa8f508582344949bfe31127012103bb0e8b1729761c223b521c447b346444b15df537d36d0d96ddf6015e8bf3af03feffffff548aa425a5a8b907712dbf3a46b3436cdc1ab48f01c06ae10cb271130c3a9b0a000000006b483045022100d381ac314809360cecd2093568ae886efe780280060d818b65a11971fb822105022063d05a42358c0adefbdc85ee64c31579f989b311432d71647b75b118148213e4012103bb0e8b1729761c223b521c447b346444b15df537d36d0d96ddf6015e8bf3af03feffffff15ddffe7f80788c5bc63953748d1f6933e7d6f4d15709f548e54e692fa049470000000006a47304402203c2d1eee1ea7103f6963cf7c314dd83c4e0ac4b53d7f960b9049be5f4ad31bd8022018306141f808c3a37c3d8655b2f2f83f681d74cc3e9b3e70d03d6ebdf519aa63012103bb0e8b1729761c223b521c447b346444b15df537d36d0d96ddf6015e8bf3af03fefffffffe9a1348a8ec0326e361a27eb3efa3443ce01783c25a468255ecc1427bed767b000000006b483045022100f259d5f7e56be36cfe1950f05dc435e8f44572adbf1e3dab66721fd733cdc05902201358322ebd92a26a082a0ef0a5a5da2947be036fef9353956ffb7c17ec6a8eed012103bb0e8b1729761c223b521c447b346444b15df537d36d0d96ddf6015e8bf3af03fefffffff74a0bb7c54893245b44b50d7f477015c36bccbdbd8257bee60807c8566b1f24000000006b483045022100ff76759c5e97f4ebe3c176421d0ebe3c83c6e77794f9bf1d87a157e8849b121302204a45c0b6c6994277bbf7d27615d50d21174284accbd7ef85631597b4c8ee44c5012103bb0e8b1729761c223b521c447b346444b15df537d36d0d96ddf6015e8bf3af03feffffff728b6d6af4ee412a5a4893c9286627d96e53e3dd173ab954bf317cb920100a99000000006b483045022100b8c3eced1b02f5aa1a825c3de7f5c7d0ee2b5b81612390ed4855e5ec89851d280220320990575c6bcc36b3aba21aabb451b802c9b2af0499dc2a23f39a97685a92d2012103bb0e8b1729761c223b521c447b346444b15df537d36d0d96ddf6015e8bf3af03feffffffcad442018b52fcc43428fae3684bc102aea24615f0b6a7ca25ea380eefda7a1e000000006a4730440220412dd137fd006dfb4980d956832b34e22d78ff43f70975310603b0cc93e1e338022072ef1c609cc80a59e5402c0308a6cbdf8627c85954cac67911714a781e47227c012103bb0e8b1729761c223b521c447b346444b15df537d36d0d96ddf6015e8bf3af03feffffff007e1e52fd828c8f8fbb0ffcd09c2cc40c7798a9e68c6320ace0dd84ec4c9303000000006b483045022100e6cd6ec3d5d71431fa61c58e16eeb449cf988629bddea14eb8f87d430c8c4be702202392a0af309c10d5970e73be954691aee337b84996585373ab9debf75013d916012103bb0e8b1729761c223b521c447b346444b15df537d36d0d96ddf6015e8bf3af03feffffffd5c3358a5d83aa6e0af8dfb312fc6ceaee98404503416c05f61d1a0fceed1d4c000000006a473044022020b5627521fe27e0fc5bd116e973eadd9905ef0ef63fc116204f95fb714eadb102201a60086d190dca37ca69394e4153ff2a0e705f4e1a706e37320bfa34a8e8998e012103bb0e8b1729761c223b521c447b346444b15df537d36d0d96ddf6015e8bf3af03feffffffd61bd2b25bf0c9f755cd60c0f13dc126a3c0a92e3b72d8211eb2384d69957f2e000000006b483045022100dca7a3a7f71c24e24c256f8b425822a0e53137527fa28b052e5bcfd3e86ee81a02204d5a659b1a13c41d6dde13cd1bea3eeb4f41d7f2f80880cb4812ab790c4c492c012103bb0e8b1729761c223b521c447b346444b15df537d36d0d96ddf6015e8bf3af03feffffffad07fd4fd31beebb49ede3a4dcb3916ce3a09d8b64a2cfd8b3279363e1d0eecc000000006a47304402204c3aa1df561a1cee5cfc26d8a6f8f6b8d445bb67aae68c9d641f78027b94e393022001353546b6cd5d8193a0596f9adf3e46a3c2c3c737a9acc42582c7007848c91a012103bb0e8b1729761c223b521c447b346444b15df537d36d0d96ddf6015e8bf3af03feffffff5d20a250d38e837cd348483255f6d7b066fb015e9f22b73376aee5ddafe696c5000000006b483045022100a57a16e53ae539203900ff2914f7b7224d88a390dc45d91f2a602bfda000df1d02207bbff4ff73fdc032e5a174a94b285e92e0a0591ab69b59ff94479436fdf940f3012103bb0e8b1729761c223b521c447b346444b15df537d36d0d96ddf6015e8bf3af03feffffff6798c3c2e5d67082b14617cf20478f3e547aa5d13c5123b81bafedf8753c4fec000000006b483045022100e3f8c930e77a4e90e25e08cc20e4a6cdcf875f8a45221711c8d56069fe67dd2d02207a7241e29a5d4bc19e708cc30456ae83ce92f7736d5f625941c08a89e877ff7a012103bb0e8b1729761c223b521c447b346444b15df537d36d0d96ddf6015e8bf3af03feffffff5e834755fa01f4a1218af8b8c9a4efa4d40947a5f8c2f3382fc27def6617ba01000000006b483045022100ac28715ef1e9ba09160d1ee6dbb92acaf2b740426a78aee5a593f59ecd0fb48502206414ff17e5cfe2662fd69a33d6af3689d15a5839bef4c020a56d6ccefe966a4f012103bb0e8b1729761c223b521c447b346444b15df537d36d0d96ddf6015e8bf3af03feffffff175625d54df3da5a9a6af88ddc86826a9182182b56ebfb2c141201424d47b475000000006b483045022100ff1e8950d70ad838d6243e7f6cb65407be85c6cd0775405fbbfbb970ee82c385022035409f0c7e4296389d3525a5506d0000eecc5196959f8934c5994b1f2e3affe9012103bb0e8b1729761c223b521c447b346444b15df537d36d0d96ddf6015e8bf3af03feffffff97868b6ef026b3d3e3e738ede3e801d4c85fe260e1c6feadbae960b2fb80a0ff000000006a473044022034dd0242f7c06012bc49b8adfac4514b7c30f036cd0de66690ee93412a71a70002201ff8c414f665fc5183e7c9c5073106ceef8fd50ab71c9113b6442b9536c86616012103bb0e8b1729761c223b521c447b346444b15df537d36d0d96ddf6015e8bf3af03feffffffcdab652c1e3e047d05cca84ab66cf4262bc692fd173921ae13f242040f71d288000000006a47304402206b526369c1c219f06237f37c703da5d600c09ac2b952c2f344b4ec641937e65d02203635d173d3a7a0b2d29e97a8d3abd1ccb4e1f77699b045819bd89b7eeebe786e012103bb0e8b1729761c223b521c447b346444b15df537d36d0d96ddf6015e8bf3af03feffffffc235fb72c822535a930d7c49c779252101c3b0c8eef07db53c636d88cfbb76aa000000006a4730440220202137074ca8d07f2ae87d2a2e9f2e1c1e17056f068b095be2eebe68a3d6ffa302200cec33244760c29fc2f25ed5cb0dcef854bcfccdecfe6fe72e1cce5309ee0793012103bb0e8b1729761c223b521c447b346444b15df537d36d0d96ddf6015e8bf3af03feffffff9bb225420790984f8c2271f07a5b8819409214c3075cb016a640c3f758c0eee2000000006b483045022100de26c84b85e25206dcd7cf557b514c6d3bbe472e4045ba8e8d228d9e4e49335e02207a09344715d430f39c7e52c8c52a5aba83e938aac3f7640bc0d2a8b8cf182095012103bb0e8b1729761c223b521c447b346444b15df537d36d0d96ddf6015e8bf3af03feffffff02e5a62f69aa6eb91f95b5cc32db466849e8418e3b04abaeeba5d8da4b798837000000006a47304402205a9f37929238c6d30b32cd141ee804344b32a341b9839951f6475941cea2c1a4022024c0235d1d2ace7f0049dd7641c78e06ccffef42741ac873d27b0948b3e45561012103bb0e8b1729761c223b521c447b346444b15df537d36d0d96ddf6015e8bf3af03feffffff67d0de11a9ecb044bf0a90c777f744a63d2efc64c5e003e646bc3cb35000eabf000000006b483045022100cedd42a8ff25ae6b32b2f02c13c8623b99b3e2f9cde0f789a1e5351dd0b5e60b02202946b3cc29466e7ee58d133a2a03cfe8603d0fa2e8d458ce43ee2b6b416a3fde012103bb0e8b1729761c223b521c447b346444b15df537d36d0d96ddf6015e8bf3af03feffffff0200e87648170000001976a91476da44781ba46c648618c269526837e8c7c9dc2588acb8f9042a010000001976a914697dbbefe7855be7b60642bb1a29d680cfeb038288acd4000000"
}
```
10.查询未花费的输出UTXO--listunspent
```java
@Test
    public void listunspent() throws Throwable {
        Object[] paraObj = new Object[3];
        paraObj[0] = 1;
        paraObj[1] = 9999999;
        String[] addr = new String[2];
        addr[0] = "mpQnC4sNzkuJH8eu9QakWoUANPykJhydqK";
        addr[1] = "msMbtMaUnqoiRoXVqBFAuDxUnB3Ni4PaKf";
        paraObj[2] = addr;
        try {
            JSONArray aa = rpcClient.invoke("listunspent", paraObj, JSONArray.class);
            System.out.println(aa.toString());
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
```
```javascript
//未花费输出的返回结果
var listunspent = [
        {
            "txid" : "221e506416e462494ed132d5248d1dd6ec2fe56fbbb238a67c12c4c7efdbf376",
            "vout" : 0,
            "address" : "mpQnC4sNzkuJH8eu9QakWoUANPykJhydqK",
            "account" : "haswhere",
            "scriptPubKey" : "76a914618e33d9e5ddb197337ae8478dfcb0a1cb7eb83a88ac",
            "amount" : 35,
            "confirmations" : 30,
            "spendable" : true,
            "solvable" : true
        },
        {
            "txid" : "79b9f2e8905c9efe89f4e2f64b482050da258970097bdd019600b8581499bccf",
            "vout" : 0,
            "address" : "mpQnC4sNzkuJH8eu9QakWoUANPykJhydqK",
            "account" : "haswhere",
            "scriptPubKey" : "76a914618e33d9e5ddb197337ae8478dfcb0a1cb7eb83a88ac",
            "amount" : 55,
            "confirmations" : 10,
            "spendable" : true,
            "solvable" : true
        },
        {
            "txid" : "79b9f2e8905c9efe89f4e2f64b482050da258970097bdd019600b8581499bccf",
            "vout" : 1,
            "address" : "msMbtMaUnqoiRoXVqBFAuDxUnB3Ni4PaKf",
            "account" : "haswhere",
            "scriptPubKey" : "76a91481dcbac1620a961b5d41162b5a48b353990215dd88ac",
            "amount" : 44,
            "confirmations" : 10,
            "spendable" : true,
            "solvable" : true
        } ]
```
11.创建交易createrawtransaction
```java
@Test
    public void createrawtransaction() throws Throwable{
        try {
            Object[] paraObj = new Object[3];
            paraObj[0] = 1;
            paraObj[1] = 9999999;
            String[] addr = new String[1];
            addr[0] = "msMbtMaUnqoiRoXVqBFAuDxUnB3Ni4PaKf";
            paraObj[2] = addr;
            JSONArray utxoArr = rpcClient.invoke("listunspent", paraObj, JSONArray.class);
            Object[] rawObj = new Object[2];
            JSONArray inArr = new JSONArray();
            for(Object utxo:utxoArr){
                JSONObject vout = JSONObject.fromObject(utxo);
                JSONObject vin = new JSONObject();
                vin.accumulate("txid", vout.getString("txid"));
                vin.accumulate("vout", vout.getInt("vout"));
                inArr.add(vin);
            }
            rawObj[0] =  inArr;
            //btc交易输出
            JSONObject out = new JSONObject();
            out.accumulate("mpQnC4sNzkuJH8eu9QakWoUANPykJhydqK", 55);
            out.accumulate("msMbtMaUnqoiRoXVqBFAuDxUnB3Ni4PaKf", 44);
            rawObj[1] =  out;
            String aa = rpcClient.invoke("createrawtransaction", rawObj, String.class);
            System.out.println(aa);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
```
12.交易数据签名signrawtransaction
```java
@Test
    public void signrawtransaction() throws Throwable{
        try {
            Object[] signObj = new Object[1];
            signObj[0] = "0100000001675b5162829b6636d10777889da9249a191d13712399e1f2a1c1592d84efe1890000000000ffffffff020057d347010000001976a914618e33d9e5ddb197337ae8478dfcb0a1cb7eb83a88ac00ac4206010000001976a91481dcbac1620a961b5d41162b5a48b353990215dd88ac00000000";
            Object signRet = rpcClient.invoke("signrawtransaction", signObj, Object.class);
            System.out.println(signRet.toString());
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
```

13.广播交易到区块链sendrawtransaction
```java
@Test
    public void sendrawtransaction() throws Throwable{
        try {
            Object[] paraObj = new Object[2];
            paraObj[0] =  "0100000001675b5162829b6636d10777889da9249a191d13712399e1f2a1c1592d84efe189000000006b483045022100b4c8c9a19a8a1a8c18f2f34a9cd5325cb130658a6e7ea0ecafb8f7e35739a7bc0220560e4cdcd195adb407ef9af3fa40e4d7cd241af51bcfaa4556c774557b514357012103160697b43f38f83a21790a25f6bdc43833c2cfb40d24b1b78b25523bae4ceca0ffffffff020057d347010000001976a914618e33d9e5ddb197337ae8478dfcb0a1cb7eb83a88ac00ac4206010000001976a91481dcbac1620a961b5d41162b5a48b353990215dd88ac00000000";
            //建议不设置、如果设置为true、在没有设置找零地址的情况下、有可能导致地址中剩余的余额被当做矿工奖励、永久损失
            paraObj[1] = true;
            String aa = rpcClient.invoke("sendrawtransaction", paraObj, String.class);
            System.out.println(aa);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
```








