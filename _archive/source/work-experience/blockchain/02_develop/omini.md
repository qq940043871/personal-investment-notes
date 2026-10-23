1.发行固定数量的众筹omni_sendissuancefixed
```java
@Test
    public void omni_sendissuancefixed() throws Throwable {
        try {
            Object[] paraObj = new Object[10];
            paraObj[0] =  "msMbtMaUnqoiRoXVqBFAuDxUnB3Ni4PaKf";
            paraObj[1] =  2;
            paraObj[2] =  1;
            paraObj[3] =  0;
            paraObj[4] =  "Companies";
            paraObj[5] = "Bitcoin Mining";
            paraObj[6] = "BTC";//众筹名称--众筹编码自动生成
            paraObj[7] = "";
            paraObj[8] =  "";
            paraObj[9] = 100000;
            String aa = rpcClient.invoke("omni_sendissuancefixed", paraObj, String.class);
            System.out.println(aa);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
```

2.查询Omni协议层的所有众筹omni_listproperties
```javascript
CurrencyID:1:Omni
CurrencyID:2:Test Omni
CurrencyID:2147483651:BTC
```

3.查询众筹余额omni_getbalance
```java
@Test
    public void omni_getbalance() throws Throwable {
        try {
            long currencyID = 2147483652l;
            Object aa = rpcClient.invoke("omni_getbalance", new Object[]{"msMbtMaUnqoiRoXVqBFAuDxUnB3Ni4PaKf",currencyID}, Object.class);
            System.out.println(aa.toString());
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
```

4.创建omni简单发送的交易
```java
public void testOmniTx() {
        long currencyID = 2147483652l;
        // 创建无签名的交易
        try {
            NetworkParameters params = RegTestParams.get();
            OmniTxBuilder omniTxBuilder = new OmniTxBuilder(params);
            Address fromAddr = Address.fromBase58(params, "mrpk51fedhsDUFZeLAJ6eATsqX2NitZrdK");
            Address toAddr = Address.fromBase58(params, "muv4moZrSp8o5oNn1wMXjrLMgNeLmWtdHX");
            // 创建交易输入
            List<TransactionOutput> outputs = omniClient.listUnspentJ(fromAddr);
            List<TransactionInput> inputs = new ArrayList<TransactionInput>();
            for (TransactionOutput output : outputs) {
                long outputIndex = output.getIndex();
                TransactionOutPoint outpoint;
                if (output.getParentTransaction() != null) {
                    outpoint = new TransactionOutPoint(params, outputIndex, output.getParentTransaction());
                } else {
                    outpoint = new TransactionOutPoint(params, output);
                }
                TransactionInput input = new TransactionInput(params, output.getParentTransaction(), output.getScriptBytes(), outpoint,output.getValue());
                inputs.add(input);
            }
            OmniValue amount = OmniDivisibleValue.ofWillets(9);
            byte[] aaa = Base58.decode("cUPrRCcML1B3BM9t1iAx2z364YxowZj1MVDxzptWr751Wwgmvymx");
            byte[] aaa1 = new byte[aaa.length-6];
            System.arraycopy(aaa, 1, aaa1, 0, aaa.length-6);
            ECKey fromKey = ECKey.fromPrivate(aaa1);
            ECKey fromKey1 = ECKey.fromPublicOnly(ByteUtils.fromHexString("02a929fcba7a2bee55d094a18711d3c9f51503e56dac088b1e5d8b03150f9bbc85"));
            Transaction omniTx = omniTxBuilder.createUnsignedSimpleSend(fromKey1, inputs, toAddr, new CurrencyID(currencyID), amount);
            String hexTx = omniClient.signRawTransaction(TransactionHexSerializer.bytesToHexString(omniTx.bitcoinSerialize())).getHex();
            System.out.println(omniClient.sendRawTransaction(hexTx));
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
```
5.查询omni协议的交易omni_gettransaction
```java
var omni_gettransaction = {
    "txid" : "55596444a8073a1025acb33313dcd3af2aa5dfc437de261dfaa685769c8230af",
    "fee" : "0.00005140",
    "sendingaddress" : "msMbtMaUnqoiRoXVqBFAuDxUnB3Ni4PaKf",
    "ismine" : true,
    "version" : 0,
    "type_int" : 50,
    "type" : "Create Property - Fixed",
    "propertyid" : 2147483651,
    "divisible" : false,
    "ecosystem" : "test",
    "propertytype" : "indivisible",
    "category" : "Companies",
    "subcategory" : "Bitcoin Mining",
    "propertyname" : "BTC",
    "data" : "",
    "url" : "",
    "amount" : "100000",
    "valid" : true,
    "blockhash" : "525912e12612fb7ce45b53fa673af98cf4a5f3093baf072872d46da93ab4773a",
    "blocktime" : 1523347329,
    "positioninblock" : 1,
    "block" : 261,
    "confirmations" : 10
}
```


