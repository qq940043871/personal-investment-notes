# Qdrant 向量数据库内网部署指南

> 适用环境：内网隔离、中小型向量规模（千万级）
> 关联文档：11_00_内网私有化部署开源软件清单.md

---

## 一、Qdrant 简介

### 1.1 为什么选择 Qdrant

| 优势 | 说明 |
|------|------|
| 轻量高效 | Rust 实现，性能优秀 |
| 部署简单 | 单节点零配置 |
| HNSW 索引 | 高维向量检索最优 |
| 过滤支持 | 支持复杂标量过滤 |
| gRPC API | 高性能接口 |
| 内网友好 | Docker 一键部署 |

### 1.2 与 Milvus 对比

| 特性 | Qdrant | Milvus |
|------|--------|--------|
| 上手难度 | 简单 | 中等 |
| 性能 | 高 | 高 |
| 集群 | 商业版 | 开源支持 |
| 存储 | DiskANN 支持 | 支持 |
| 运维 | 简单 | 较复杂 |
| 生态 | 较新 | 更成熟 |

---

## 二、Docker 部署

### 2.1 单节点部署

```yaml
# docker-compose-qdrant.yml
version: '3.8'

services:
  qdrant:
    image: qdrant/qdrant:latest
    container_name: qdrant
    restart: unless-stopped
    ports:
      - "6333:6333"    # REST API
      - "6334:6334"   # gRPC API
    volumes:
      - /data/qdrant/storage:/qdrant/storage  # 数据存储
      - /data/qdrant/config:/qdrant/config     # 配置
    environment:
      - QDRANT__SERVICE__GRPC_PORT=6334
      - QDRANT__SERVICE__HTTP_PORT=6333
      - QDRANT__STORAGE__SNAPSHOT_DIR=/qdrant/snapshots
    deploy:
      resources:
        limits:
          memory: 8G
```

```bash
# 启动
docker-compose -f docker-compose-qdrant.yml up -d

# 查看日志
docker-compose -f docker-compose-qdrant.yml logs -f

# 检查状态
curl http://localhost:6333/collections
```

### 2.2 生产配置

```yaml
# docker-compose-qdrant-prod.yml
version: '3.8'

services:
  qdrant:
    image: qdrant/qdrant:v1.7.0
    container_name: qdrant
    restart: always
    ports:
      - "127.0.0.1:6333:6333"
      - "127.0.0.1:6334:6334"
    volumes:
      - /data/qdrant/storage:/qdrant/storage
      - /data/qdrant/snapshots:/qdrant/snapshots
    environment:
      - QDRANT__SERVICE__GRPC_PORT=6334
      - QDRANT__SERVICE__HTTP_PORT=6333
      - QDRANT__SERVICE__MAX_REQUEST_SIZE_MB=32
      - QDRANT__STORAGE__STORAGE_TYPE=disk
      - QDRANT__STORAGE__SNAPSHOTS_PATH=/qdrant/snapshots
      - QDRANT__CLUSTER__ENABLED=false
    ulimits:
      memlock: -1
      stack: 67108864
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:6333/health"]
      interval: 10s
      timeout: 5s
      retries: 3
```

---

## 三、REST API 使用

### 3.1 创建 Collection

```bash
# 创建 Collection
curl -X PUT http://localhost:6333/collections/commodity_kb \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "vectors": {
      "size": 1024,
      "distance": "Cosine"
    },
    "optimizers_config": {
      "indexing_threshold": 20000
    }
  }'
```

### 3.2 插入向量

```bash
# 插入单条
curl -X PUT 'http://localhost:6333/collections/commodity_kb/points' \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "id": 1,
    "vector": [0.05, 0.91, ...],  # 1024维向量
    "payload": {
      "text": "铜价今日上涨5%，报78500元/吨",
      "category": "金属",
      "date": "2024-01-15"
    }
  }'

# 批量插入
curl -X PUT 'http://localhost:6333/collections/commodity_kb/points/batch' \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "batch": {
      "ids": [1, 2, 3],
      "vectors": [
        [0.05, 0.91, ...],
        [0.12, 0.87, ...],
        [0.33, 0.72, ...]
      ],
      "payloads": [
        {"text": "铜", "category": "金属"},
        {"text": "铝", "category": "金属"},
        {"text": "原油", "category": "能源"}
      ]
    }
  }'
```

### 3.3 搜索

```bash
# 相似性搜索
curl -X POST 'http://localhost:6333/collections/commodity_kb/points/search' \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "vector": [0.05, 0.91, ...],
    "limit": 5,
    "with_payload": true,
    "score_threshold": 0.7
  }'

# 带过滤条件的搜索
curl -X POST 'http://localhost:6333/collections/commodity_kb/points/search' \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "vector": [0.05, 0.91, ...],
    "limit": 5,
    "filter": {
      "must": [
        {
          "key": "category",
          "match": {"value": "金属"}
        }
      ]
    },
    "with_payload": true
  }'
```

### 3.4 查询与删除

```bash
# 查询单条
curl 'http://localhost:6333/collections/commodity_kb/points/1'

# 列出所有
curl 'http://localhost:6333/collections/commodity_kb/points?limit=10'

# 删除
curl -X DELETE 'http://localhost:6333/collections/commodity_kb/points/1'

# 删除 Collection
curl -X DELETE 'http://localhost:6333/collections/commodity_kb'
```

---

## 四、Python SDK

### 4.1 安装

```bash
pip install qdrant-client
```

### 4.2 基本操作

```python
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct
import numpy as np

# 连接
client = QdrantClient(url="http://localhost:6333")

# 创建 Collection
client.create_collection(
    collection_name="commodity_kb",
    vectors_config=VectorParams(size=1024, distance=Distance.COSINE)
)

# 插入数据
points = [
    PointStruct(
        id=i,
        vector=np.random.rand(1024).tolist(),  # 你的向量
        payload={
            "text": f"商品描述 {i}",
            "category": ["金属", "能源", "化工"][i % 3]
        }
    )
    for i in range(100)
]

client.upsert(
    collection_name="commodity_kb",
    points=points
)

# 搜索
results = client.search(
    collection_name="commodity_kb",
    query_vector=np.random.rand(1024).tolist(),
    limit=5,
    query_filter={
        "must": [
            {"key": "category", "match": {"value": "金属"}}
        ]
    }
)

for result in results:
    print(f"ID: {result.id}, Score: {result.score}")
    print(f"Payload: {result.payload}")
```

---

## 五、与 LangChain 集成

### 5.1 LangChain Qdrant

```python
from langchain_community.vectorstores import Qdrant
from langchain_openai import OpenAIEmbeddings

# 嵌入模型
embeddings = OpenAIEmbeddings()

# 连接到 Qdrant
vectorstore = Qdrant(
    client=QdrantClient(url="http://localhost:6333"),
    collection_name="commodity_kb",
    embeddings=embeddings
)

# 添加文档
from langchain.schema import Document

docs = [
    Document(page_content="铜是一种重要的有色金属...", metadata={"category": "金属"}),
    Document(page_content="原油是重要的能源商品...", metadata={"category": "能源"}),
]
vectorstore.add_documents(docs)

# 相似性搜索
results = vectorstore.similarity_search("铜的交易策略", k=5)

# 带过滤
results = vectorstore.similarity_search(
    "价格分析",
    k=5,
    filter={"category": "金属"}
)
```

### 5.2 与 LlamaIndex 集成

```python
from llama_index.vector_stores.qdrant import QdrantVectorStore
from llama_index.core import VectorStoreIndex

# 创建向量存储
vector_store = QdrantVectorStore(
    client=QdrantClient(url="http://localhost:6333"),
    collection_name="commodity_kb"
)

# 构建索引
index = VectorStoreIndex.from_vector_store(vector_store)

# 查询
query_engine = index.as_query_engine()
response = query_engine.query("铜价走势分析")
```

---

## 六、运维管理

### 6.1 集群信息

```bash
# 查看集群状态
curl http://localhost:6333/service

# 查看 Collection 详情
curl http://localhost:6333/collections/commodity_kb
```

### 6.2 快照与备份

```bash
# 创建快照
curl -X POST 'http://localhost:6333/collections/commodity_kb/snapshots'

# 列出快照
curl 'http://localhost:6333/collections/commodity_kb/snapshots'

# 恢复快照
curl -X PUT 'http://localhost:6333/collections/commodity_kb/snapshots/{snapshot_name}/recovery' \
  -H 'Content-Type: application/json'
```

### 6.3 监控

```bash
# 查看指标
curl http://localhost:6333/metrics

# Prometheus 格式指标
# 需要启用 metrics 端点
```

---

## 七、性能优化

### 7.1 HNSW 参数调优

```json
{
  "vectors": {
    "size": 1024,
    "distance": "Cosine",
    "hnsw_config": {
      "m": 16,
      "ef_construct": 200
    }
  },
  "optimizers_config": {
    "indexing_threshold": 20000
  }
}
```

| 参数 | 说明 | 推荐值 |
|------|------|--------|
| m | 每层连接数 | 8-64 |
| ef_construct | 构建时的动态列表大小 | 100-500 |
| ef_search | 搜索时的动态列表大小 | 128-512 |

### 7.2 分区策略

```python
# 根据业务分区
# Collection: commodity_kb_metals
# Collection: commodity_kb_energy
# Collection: commodity_kb_chemicals

# 或使用 payload 过滤
client.search(
    collection_name="commodity_kb",
    query_vector=vector,
    filter={"must": [{"key": "category", "match": {"value": "金属"}}]}
)
```

---

## 八、常见问题

### 8.1 内存不足

```bash
# 使用磁盘存储
QDRANT__STORAGE__STORAGE_TYPE=disk
```

### 8.2 插入慢

```python
# 批量插入优化
client.upsert(
    collection_name="commodity_kb",
    points=points,  # 批量插入，而非逐条
    wait=True
)
```

### 8.3 搜索不准

```bash
# 增加 ef_search
curl -X PATCH 'http://localhost:6333/collections/commodity_kb' \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "hnsw_config": {
      "ef": 256
    }
  }'
```

---

返回清单：11_00_内网私有化部署开源软件清单.md
