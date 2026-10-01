# Milvus 向量数据库学习指南

> 适用领域：向量检索、RAG 系统
> 关联文档：09_技术选型总览.md

---

## 一、Milvus 概述

### 1.1 什么是 Milvus

Milvus 是一个开源的向量数据库，专为海量向量检索设计：

```
Milvus 特点：
- 十亿级向量支持
- 毫秒级检索延迟
- 多种索引类型
- 高可用部署
- 丰富的 SDK 支持
```

### 1.2 架构概览

```
┌─────────────────────────────────────────────┐
│                  Milvus                     │
├─────────────────────────────────────────────┤
│                                             │
│   ┌─────────┐    ┌─────────┐              │
│   │  SDK    │    │  SDK    │              │
│   │ Python  │    │  Go     │              │
│   └────┬────┘    └────┬────┘              │
│        │              │                     │
│   ┌────┴──────────────┴────┐              │
│   │     API Gateway        │              │
│   └──────────┬─────────────┘              │
│              │                            │
│   ┌──────────┴─────────────┐              │
│   │    Coordinator Node    │              │
│   │  (元数据/负载均衡)      │              │
│   └──────────┬─────────────┘              │
│              │                            │
│   ┌──────────┼─────────────┐              │
│   │          │             │              │
│ ┌─┴───┐  ┌──┴───┐  ┌───┴──┐            │
│ │Worker│  │Worker│  │Worker│            │
│ │Node 1│  │Node 2│  │Node 3│            │
│ └──────┘  └──────┘  └──────┘            │
│                                             │
└─────────────────────────────────────────────┘
```

---

## 二、安装部署

### 2.1 Docker Compose 快速部署

```yaml
# docker-compose.yml
version: '3.8'

services:
  etcd:
    container_name: milvus-etcd
    image: quay.io/coreos/etcd:v3.5.5
    environment:
      - ETCD_AUTO_COMPACTION_MODE=revision
      - ETCD_QUOTA_BACKEND_BYTES=4294967296
    volumes:
      - etcd_data:/etcd
    command: etcd -advertise-client-urls=http://127.0.0.1:2379 -listen-client-urls http://0.0.0.0:2379 --data-dir /etcd

  minio:
    container_name: milvus-minio
    image: minio/minio:RELEASE.2023-03-20T20-16-18Z
    environment:
      MINIO_ACCESS_KEY: minioadmin
      MINIO_SECRET_KEY: minioadmin
    volumes:
      - minio_data:/minio_data
    command: minio server /minio_data

  milvus:
    container_name: milvus-standalone
    image: milvusdb/milvus:v2.3.3
    command: ["milvus", "run", "standalone"]
    environment:
      ETCD_ENDPOINTS: etcd:2379
      MINIO_ADDRESS: minio:9000
    volumes:
      - milvus_data:/var/lib/milvus
    ports:
      - "19530:19530"
      - "9091:9091"

volumes:
  etcd_data:
  minio_data:
  milvus_data:
```

```bash
# 启动
docker-compose up -d

# 检查状态
docker-compose ps
```

### 2.2 Kubernetes 部署

```yaml
# milvus-operator.yaml
apiVersion: zilliztech.com/v1beta1
kind: Milvus
metadata:
  name: milvus
spec:
  mode: cluster
  etcd:
    inCluster:
      deletionPolicy: Delete
      resources:
        etcdMeta:
          image: milvus-etcd:latest
  minio:
    inCluster:
      deletionPolicy: Delete
      resources:
        minioMeta:
          image: milvus-minio:latest
  components:
    resources:
      mainDefault:
        requests:
          cpu: "1"
          memory: 2Gi
  data:
    resources:
      dataDefault:
        requests:
          cpu: "1"
          memory: 4Gi
```

---

## 三、Python SDK 使用

### 3.1 安装

```bash
pip install pymilvus
```

### 3.2 基础连接

```python
from pymilvus import connections, Collection, CollectionSchema, FieldSchema, DataType

# 连接
connections.connect(
    alias="default",
    host="localhost",
    port="19530"
)

# 检查连接
print(connections.list_connections())
```

### 3.3 创建 Collection

```python
from pymilvus import CollectionSchema, FieldSchema, DataType, Collection

# 定义字段
fields = [
    FieldSchema(name="id", dtype=DataType.INT64, is_primary=True, auto_id=True),
    FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=1024),
    FieldSchema(name="text", dtype=DataType.VARCHAR, max_length=65535),
    FieldSchema(name="category", dtype=DataType.VARCHAR, max_length=100),
]

# 创建 Schema
schema = CollectionSchema(fields=fields, description="商品知识库")

# 创建 Collection
collection = Collection(name="commodity_knowledge", schema=schema)

# 创建索引
index_params = {
    "index_type": "IVF_FLAT",
    "metric_type": "L2",  # 或 IP（内积）
    "params": {"nlist": 128}
}
collection.create_index(
    field_name="embedding",
    index_params=index_params
)

# 加载到内存
collection.load()
```

### 3.4 插入数据

```python
import random

# 准备数据
vectors = [[random.random() for _ in range(1024)] for _ in range(100)]
texts = [f"商品描述 {i}" for i in range(100)]
categories = ["金属", "能源", "化工", "农产品"] * 25

entities = [
    vectors,           # embedding
    texts,            # text
    categories,       # category
]

# 插入
insert_result = collection.insert(entities)
print(f"插入 {insert_result.insert_count} 条数据")

# 刷新
collection.flush()
```

### 3.5 向量检索

```python
# 搜索向量
query_vectors = [[random.random() for _ in range(1024)]]

# 搜索参数
search_params = {
    "metric_type": "L2",
    "params": {"nprobe": 10}
}

# 执行搜索
results = collection.search(
    data=query_vectors,
    anns_field="embedding",
    param=search_params,
    limit=10,
    output_fields=["text", "category"]
)

# 处理结果
for result in results:
    print(f"找到 {len(result)} 条结果")
    for hit in result:
        print(f"  ID: {hit.id}, 距离: {hit.distance}")
        print(f"  文本: {hit.entity.get('text')}")
        print(f"  类别: {hit.entity.get('category')}")
```

### 3.6 条件过滤

```python
# 带过滤条件的搜索
results = collection.search(
    data=query_vectors,
    anns_field="embedding",
    param=search_params,
    limit=10,
    expr='category == "金属"',  # 过滤条件
    output_fields=["text", "category"]
)
```

---

## 四、集成 LangChain

### 4.1 LangChain Milvus 向量存储

```python
from langchain_community.vectorstores import Milvus
from langchain_openai import OpenAIEmbeddings

# 初始化 Embedding
embeddings = OpenAIEmbeddings()

# 创建 Milvus 向量存储
vector_store = Milvus(
    embedding_function=embeddings,
    connection_args={"host": "localhost", "port": 19530},
    collection_name="commodity_knowledge"
)

# 添加文档
from langchain.schema import Document

docs = [
    Document(page_content="铜是一种重要的有色金属...", metadata={"category": "金属"}),
    Document(page_content="原油是重要的能源商品...", metadata={"category": "能源"}),
]

vector_store.add_documents(docs)

# 相似性搜索
results = vector_store.similarity_search("铜的价格走势", k=5)
```

### 4.2 集成 LlamaIndex

```python
from llama_index.vector_stores.milvus import MilvusVectorStore
from llama_index.core import VectorStoreIndex

# 创建向量存储
vector_store = MilvusVectorStore(
    host="localhost",
    port=19530,
    collection_name="commodity_knowledge",
    embedding_dimension=1536
)

# 构建索引
index = VectorStoreIndex.from_vector_store(vector_store)

# 查询
query_engine = index.as_query_engine()
response = query_engine.query("铜的交易策略")
```

---

## 五、索引类型详解

### 5.1 索引类型对比

| 索引类型 | 适用规模 | 精度 | 速度 | 内存 |
|---------|---------|------|------|------|
| FLAT | 小规模 | 100% | 慢 | 高 |
| IVF_FLAT | 中等 | 高 | 中 | 中 |
| IVF_SQ8 | 中等 | 中 | 快 | 低 |
| HNSW | 大规模 | 高 | 快 | 高 |
| DISKANN | 超大规模 | 高 | 快 | 低 |

### 5.2 选择建议

```python
# 小规模数据（<100万）
index_params = {
    "index_type": "FLAT",
    "metric_type": "L2",
    "params": {}
}

# 中等规模（100万~1亿）
index_params = {
    "index_type": "IVF_FLAT",
    "metric_type": "L2",
    "params": {"nlist": 1024}
}

# 大规模（>1亿）
index_params = {
    "index_type": "HNSW",
    "metric_type": "L2",
    "params": {"M": 16, "efConstruction": 200}
}
```

---

## 六、性能优化

### 6.1 分区管理

```python
# 创建分区
collection.create_partition("金属分区", description="金属类商品")
collection.create_partition("能源分区", description="能源类商品")

# 插入到指定分区
collection.insert(entities, partition_name="金属分区")

# 只在特定分区搜索
results = collection.search(
    data=query_vectors,
    anns_field="embedding",
    param=search_params,
    limit=10,
    partition_names=["金属分区"]  # 只搜索金属分区
)
```

### 6.2 批量操作

```python
# 批量插入（推荐）
batch_size = 1000
for i in range(0, len(vectors), batch_size):
    batch_vectors = vectors[i:i+batch_size]
    collection.insert(batch_vectors)
```

### 6.3 内存管理

```python
# 释放内存（不使用时）
collection.release()

# 重新加载
collection.load()
```

---

## 七、运维管理

### 7.1 查看 Collection 信息

```python
# 获取 Collection
collection = Collection("commodity_knowledge")

# 查看统计
print(f"实体数量: {collection.num_entities}")
print(f"分区: {collection.partitions}")

# 查看索引
print(collection.indexes)
```

### 7.2 数据导出

```python
# 导出数据
collection.load()

# 查询所有数据（用于备份）
results = collection.query(
    expr="id > 0",
    output_fields=["id", "text", "category"]
)

print(f"导出 {len(results)} 条数据")
```

### 7.3 健康检查

```bash
# 使用 Milvus Attu 管理界面
docker run -p 3000:3000 \
  -e MILVUS_ADDRESS=localhost:19530 \
  zilliz/attu:latest
```

---

## 八、常见问题

### 8.1 插入很慢
```python
# 检查：是否频繁 flush
# 解决：批量插入 + 定期 flush

collection.insert(entities)
collection.flush()  # 不要每批次都 flush
```

### 8.2 检索不准
```python
# 检查：索引是否正确
collection.indexes

# 检查：是否已加载
collection.has_index()  # 索引是否存在
collection.is_loaded()  # 是否已加载
```

### 8.3 内存不足
```python
# 解决：使用更高效的索引
index_params = {
    "index_type": "IVF_SQ8",  # 更节省内存
    "params": {"nlist": 512}
}
```

---

## 九、学习资源

| 资源 | 链接 |
|------|------|
| 官方文档 | https://milvus.io/docs |
| GitHub | https://github.com/milvus-io/milvus |
| 示例代码 | https://github.com/milvus-io/bootcamp |
| Milvus Attu | https://github.com/zilliztech/attu |

---

返回选型总览：09_技术选型总览.md
