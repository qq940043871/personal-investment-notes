# Embedding 模型学习指南

> 适用领域：向量检索、RAG 系统
> 关联文档：09_技术选型总览.md

---

## 一、Embedding 模型概述

### 1.1 什么是 Embedding

Embedding（嵌入）是将文本、图像等高维数据映射到低维稠密向量的技术：

```
文本 -> Embedding -> 向量(1536维)

"大宗商品铜的价格走势"
     ↓
[0.123, -0.456, 0.789, ..., 0.234]
     ↓
语义相似的文本，向量距离更近
```

### 1.2 主流模型对比

| 模型 | 维度 | 中英双语 | 开源 | 特点 |
|------|-----|---------|------|------|
| text-embedding-3-large | 3072 | 是 | 否 | OpenAI官方，效果最好 |
| BGE-M3 | 1024 | 优化 | 是 | 智源开源，中文优化 |
| M3E | 768 | 是 | 是 | 开源免费，轻量 |
| GTE | 1024 | 是 | 是 | 阿里开源 |
| SFund | 1024 | 是 | 是 | 金融领域优化 |

---

## 二、BGE-M3 详解

### 2.1 模型介绍

BGE-M3 是智源研究院开源的多语言 Embedding 模型：

- 支持 100+ 语言
- 中文能力特别优化
- 支持三种检索模式：Dense、稀疏、ColBERT
- MTEB 评测多项第一

### 2.2 安装使用

```bash
pip install FlagEmbedding
```

### 2.3 基础用法

```python
from FlagEmbedding import BGEM3FlagModel

# 加载模型
model = BGEM3FlagModel('BAAI/bge-m3', use_fp16=True)

# 单句编码
embedding = model.encode("大宗商品贸易的风险管理策略")
print(f"向量维度: {len(embedding)}")

# 批量编码
sentences = [
    "铜价今日上涨5%",
    "原油期货走势分析",
    "农产品进出口政策"
]
embeddings = model.encode(sentences)
print(f"批量向量形状: {embeddings.shape}")
```

### 2.4 混合检索模式

```python
# 启用混合检索（Dense + 稀疏）
model = BGEM3FlagModel('BAAI/bge-m3', use_fp16=True)

# 输出包含 dense 和 sparse 向量
output = model.encode(
    "铝锭的期货价格分析",
    return_sparse=True,
    output_to_cpu=True
)

print(f"Dense向量: {output['dense_vectors'].shape}")
print(f"Sparse向量: {output['lexical_weights']}")  # 词级权重
```

---

## 三、M3E 模型详解

### 3.1 模型介绍

M3E 是 Moka 开源的 Embedding 模型：

- 中文优化，适合国内场景
- 轻量级，部署简单
- 完全开源可商用

### 3.2 安装使用

```bash
pip install sentence-transformers
```

### 3.3 基础用法

```python
from sentence_transformers import SentenceTransformer

# 加载模型
model = SentenceTransformer('moka-ai/m3e-base')

# 编码
embedding = model.encode("大宗商品交易平台")
print(f"向量维度: {len(embedding)}")

# 批量编码
embeddings = model.encode([
    "电解铜现货报价",
    "铝锭升贴水",
    "铁矿石进口"
])
```

---

## 四、向量化服务部署

### 4.1 使用 FastAPI 部署

```python
from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
import numpy as np

app = FastAPI()
model = SentenceTransformer('moka-ai/m3e-base')

class EncodeRequest(BaseModel):
    texts: list[str]
    normalize: bool = True

class EncodeResponse(BaseModel):
    embeddings: list[list[float]]
    dimension: int

@app.post("/encode", response_model=EncodeResponse)
async def encode(request: EncodeRequest):
    embeddings = model.encode(
        request.texts,
        normalize_embeddings=request.normalize
    )
    return EncodeResponse(
        embeddings=embeddings.tolist(),
        dimension=len(embeddings[0])
    )

@app.get("/health")
async def health():
    return {"status": "ok"}
```

### 4.2 Docker 部署

```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

COPY app.py .

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 4.3 性能测试

```python
import time
from sentence_transformers import SentenceTransformer

model = SentenceTransformer('moka-ai/m3e-base')

texts = ["样本文本"] * 1000

# 串行测试
start = time.time()
for text in texts:
    model.encode(text)
serial_time = time.time() - start

# 批量测试
start = time.time()
model.encode(texts)
batch_time = time.time() - start

print(f"串行: {serial_time:.2f}s")
print(f"批量: {batch_time:.2f}s")
print(f"加速比: {serial_time/batch_time:.1f}x")
```

---

## 五、RAG 中的 Embedding 实践

### 5.1 分块策略

```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

# 文本分块
text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,      # 块大小
    chunk_overlap=50,    # 重叠大小
    separators=["\n\n", "\n", "。", " "],
    length_function=len,
)

chunks = text_splitter.split_text(long_document)
```

### 5.2 Metadata 添加

```python
# 为每个块添加元信息
documents = []
for i, chunk in enumerate(chunks):
    doc = {
        "content": chunk,
        "metadata": {
            "source": "商品知识库",
            "category": "金属类",
            "chunk_id": i,
            "created_at": "2024-01-01"
        }
    }
    documents.append(doc)
```

### 5.3 批量向量化

```python
from langchain.embeddings import HuggingFaceBgeEmbeddings

# 初始化 Embedding
embeddings = HuggingFaceBgeEmbeddings(
    model_name="BAAI/bge-m3",
    model_kwargs={"device": "cuda"},
    encode_kwargs={"normalize_embeddings": True}
)

# 批量向量化
vectors = embeddings.embed_documents([doc["content"] for doc in documents])
```

---

## 六、模型选型建议

### 6.1 场景推荐

| 场景 | 推荐模型 | 理由 |
|------|---------|------|
| 通用中文场景 | BGE-M3 | 中文优化，效果好 |
| 成本敏感 | M3E | 开源免费，轻量 |
| 跨境电商 | text-embedding-3-large | 中英双语强 |
| 金融领域 | SFund / BGE-M3 | 金融语料优化 |
| 快速验证 | M3E-base | 速度快 |

### 6.2 性能对比

| 模型 | 中文平均 | 英文平均 | 推理速度 |
|------|---------|---------|---------|
| text-embedding-3-large | 65.2 | 64.6 | 中 |
| BGE-M3 | 64.8 | 63.5 | 快 |
| M3E | 62.1 | 58.3 | 最快 |

---

## 七、最佳实践

### 7.1 向量归一化

```python
# 始终使用归一化向量，便于余弦相似度计算
embedding = model.encode(text, normalize_embeddings=True)

# 相似度计算
similarity = np.dot(emb1, emb2)  # 余弦相似度（已归一化）
```

### 7.2 批处理优化

```python
# 合理设置 batch_size
embeddings = model.encode(
    texts,
    batch_size=32,        # 根据显存调整
    show_progress_bar=True
)
```

### 7.3 缓存编码结果

```python
import hashlib

def get_cache_key(text: str) -> str:
    return hashlib.md5(text.encode()).hexdigest()

# 检查缓存
cache_key = get_cache_key(text)
if cache_key in cache:
    return cache[cache_key]
```

---

## 八、学习资源

| 资源 | 链接 |
|------|------|
| BGE-M3 GitHub | https://github.com/FlagOpen/FlagEmbedding |
| M3E GitHub | https://github.com/moka-guys/m3e |
| MTEB 榜单 | https://huggingface.co/spaces/mteb/leaderboard |

---

返回选型总览：09_技术选型总览.md
