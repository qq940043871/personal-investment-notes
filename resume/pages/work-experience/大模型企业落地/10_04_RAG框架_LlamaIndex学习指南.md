# LlamaIndex 学习指南

> 适用领域：RAG 系统、知识库构建
> 关联文档：09_技术选型总览.md

---

## 一、LlamaIndex 概述

### 1.1 与 LangChain 的区别

| 特性 | LangChain | LlamaIndex |
|------|-----------|------------|
| 定位 | 通用 LLM 应用框架 | 专用数据框架 |
| 优势 | 生态全面、Agent 能力强 | RAG 优化、数据连接强 |
| 学习曲线 | 较陡 | 较平缓 |
| 推荐场景 | Agent、复杂编排 | RAG、知识库 |

### 1.2 核心特点

- 专注数据连接和检索增强
- 丰富的文档加载器
- 多种索引类型
- 高级检索策略
- Query Engine 查询引擎

---

## 二、基础用法

### 2.1 安装

```bash
pip install llama-index
pip install llama-index-llms-openai
pip install llama-index-vector-stores-milvus
```

### 2.2 简单问答

```python
from llama_index.core import VectorStoreIndex, SimpleDirectoryReader
from llama_index.llms.openai import OpenAI

# 加载文档
documents = SimpleDirectoryReader("./data").load_data()

# 初始化 LLM
llm = OpenAI(model="gpt-4o")

# 构建索引
index = VectorStoreIndex.from_documents(documents)

# 创建查询引擎
query_engine = index.as_query_engine(llm=llm)

# 查询
response = query_engine.query("文档的主要内容是什么？")
print(response)
```

### 2.3 核心概念

```
LlamaIndex 核心概念：

1. Nodes（节点）- 分割后的文档块
2. Documents（文档）- 原始文档对象
3. Index（索引）- 结构化的数据索引
4. Retriever（检索器）- 如何从索引中检索
5. Query Engine（查询引擎）- 检索+生成
6. Response Synthesizer（响应合成器）- 如何生成答案
```

---

## 三、文档加载

### 3.1 支持的格式

```python
from llama_index.core import SimpleDirectoryReader

# 支持多种格式
documents = SimpleDirectoryReader(
    "./data",
    required_exts=[".pdf", ".docx", ".txt", ".csv", ".md", ".html"]
).load_data()

# 单独加载
from llama_index.core import Document

doc = Document(
    text="这是文档内容",
    metadata={"source": "manual", "category": "guide"}
)
```

### 3.2 专门的加载器

```python
# PDF 加载
from llama_index.core import PDFReader

loader = PDFReader()
documents = loader.load_data(file="document.pdf")

# 网页加载
from llama_index.readers.web import SimpleWebPageReader

reader = SimpleWebPageReader()
documents = reader.load_data(urls=["https://example.com"])

# Notion 加载
from llama_index.readers.notion import NotionPageReader

reader = NotionPageReader(api_key="notion-api-key")
documents = reader.load_data(page_ids=["page-id-1"])
```

---

## 四、文档分割

### 4.1 默认分割器

```python
from llama_index.core import VectorStoreIndex
from llama_index.core.node_parser import SentenceSplitter

# 使用默认分割器
index = VectorStoreIndex.from_documents(
    documents,
    transformations=[SentenceSplitter(chunk_size=500, chunk_overlap=50)]
)
```

### 4.2 自定义分割

```python
from llama_index.core.node_parser import (
    SentenceSplitter,
    TokenTextSplitter,
    HierarchicalNodeParser
)

# 按句子分割
splitter = SentenceSplitter(
    chunk_size=500,
    chunk_overlap=50,
    separator="\n"
)

# 按 token 分割（更精确）
token_splitter = TokenTextSplitter(
    chunk_size=512,
    chunk_overlap=64,
    separator=" "
)

# 层级分割（父子节点）
hierarchical_parser = HierarchicalNodeParser(
    chunk_sizes=[2048, 512, 128]
)
```

### 4.3 Semantic Splitter

```python
from llama_index.core.node_parser import SemanticSplitterNodeParser
from llama_index.embeddings.openai import OpenAIEmbedding

embed_model = OpenAIEmbedding()

splitter = SemanticSplitterNodeParser(
    buffer_size=1,
    sentence_chunk_size=500,
    embed_model=embed_model
)
```

---

## 五、索引类型

### 5.1 Vector Store Index

```python
from llama_index.core import VectorStoreIndex

# 最常用的索引类型
index = VectorStoreIndex.from_documents(documents)

# 指定向量维度
index = VectorStoreIndex.from_documents(
    documents,
    vector_store_config={
        "vector_store_kwargs": {"dimension": 1536}
    }
)
```

### 5.2 Summary Index

```python
from llama_index.core import SummaryIndex

# 适用于总结类任务
index = SummaryIndex.from_documents(documents)
```

### 5.3 Tree Index

```python
from llama_index.core import TreeIndex

# 构建树形索引，适合层级查询
index = TreeIndex.from_documents(documents)
```

### 5.4 Keyword Table Index

```python
from llama_index.core import KeywordTableIndex

# 基于关键词的索引
index = KeywordTableIndex.from_documents(documents)
```

---

## 六、检索策略

### 6.1 基础检索

```python
# 获取检索器
retriever = index.as_retriever(
    similarity_top_k=5,
    vector_store_query_mode="default"
)

# 检索
nodes = retriever.retrieve("查询内容")
```

### 6.2 混合检索

```python
from llama_index.core.retrievers import QueryFusionRetriever

# 融合多个检索器
retriever = QueryFusionRetriever(
    retrievers=[
        vector_retriever,
        keyword_retriever,
    ],
    mode="reciprocal_rerank",  # 或 "dist_based_score"
    similarity_top_k=5
)
```

### 6.3 Auto Retrieval

```python
from llama_index.core.retrievers import AutoVectorRetriever

# 根据查询自动选择检索策略
retriever = AutoVectorRetriever(
    index=index,
    vector_store=vector_store
)
```

### 6.4 递归检索

```python
from llama_index.core.retrievers import RecursiveRetriever

retriever = RecursiveRetriever(
    "vector",
    retriever_dict={"vector": vector_retriever, "sql": sql_retriever},
    node_ids=["node-id-1"]
)
```

---

## 七、Query Engine

### 7.1 基础用法

```python
# 创建查询引擎
query_engine = index.as_query_engine(
    llm=llm,
    streaming=True,
    similarity_top_k=3
)

# 执行查询
response = query_engine.query("你的问题")
print(response)
```

### 7.2 自定义 Response Mode

```python
from llama_index.core import ResponseMode

# 不同响应模式
query_engine = index.as_query_engine(
    response_mode=ResponseMode.REFINE  # 精炼模式
    # 或 ResponseMode.COMPACT 紧凑模式
    # 或 ResponseMode.TREE_SUMMARIZE 树摘要
)
```

### 7.3 支持上下文

```python
# 支持上下文的查询引擎
query_engine = index.as_query_engine(
    llm=llm,
    include_source_nodes=True,
    response_mode="compact"
)

response = query_engine.query(
    "问题",
    similarity_top_k=5,
    # 额外上下文
    runtime_context={
        "user_id": "123",
        "session_id": "abc"
    }
)
```

---

## 八、Rerank 重排序

### 8.1 使用重排序

```python
from llama_index.core.postprocessor import SentenceEmbeddingReranker

# 添加重排序
reranker = SentenceEmbeddingReranker(
    top_n=5,
    embed_model=embed_model
)

query_engine = index.as_query_engine(
    node_postprocessors=[reranker]
)
```

### 8.2 Cohere Rerank

```python
from llama_index.core.postprocessor import CohereRerank

reranker = CohereRerank(
    api_key="cohere-api-key",
    top_n=5,
    model="rerank-multilingual-v2.0"
)
```

---

## 九、Query Pipeline

### 9.1 构建 Pipeline

```python
from llama_index.core.query_pipeline import QueryPipeline

pipeline = QueryPipeline(
    modules={
        "llm": llm,
        "prompt": prompt,
        "output": output_parser,
    },
    verbose=True
)

pipeline.add_link("llm", "output")
```

### 9.2 条件分支

```python
from llama_index.core.query_pipeline import (
    QueryPipeline as QP,
    RouterComponent
)

router = RouterComponent(
    selector=simple_selector,
    components={"sql": sql_pipeline, "vector": vector_pipeline},
    default_component=None
)
```

---

## 十、评估与优化

### 10.1 评估工具

```python
from llama_index.core.evaluation import (
    RetrievalEvaluator,
    QueryResponseEvaluator
)

# 检索评估
retrieval_evaluator = RetrievalEvaluator()

# 查询评估
response_evaluator = QueryResponseEvaluator()

# 评估
eval_result = response_evaluator.evaluate(
    query="问题",
    response="回答",
    contexts=["上下文"]
)
```

### 10.2 优化建议

```python
# 常见的优化方向：
# 1. 调整 chunk_size
# 2. 增加 rerank
# 3. 使用混合检索
# 4. 尝试不同的 embedding 模型
# 5. 添加 metadata filter
```

---

## 十一、最佳实践

### 11.1 生产环境配置

```python
from llama_index.core import Settings

# 全局设置
Settings.llm = OpenAI(model="gpt-4o", temperature=0)
Settings.embed_model = OpenAIEmbedding()
Settings.chunk_size = 512
Settings.chunk_overlap = 50
```

### 11.2 流式输出

```python
query_engine = index.as_query_engine(streaming=True)

streaming_response = query_engine.query("问题")

# 流式打印
for text in streaming_response.response_gen:
    print(text, end="", flush=True)
```

### 11.3 错误处理

```python
try:
    response = query_engine.query("问题")
except Exception as e:
    logger.error(f"Query failed: {e}")
    # 降级处理
    response = fallback_query_engine.query("问题")
```

---

## 十二、学习资源

| 资源 | 链接 |
|------|------|
| 官方文档 | https://docs.llamaindex.ai |
| GitHub | https://github.com/run-llama/llama_index |
| 示例库 | https://github.com/run-llama/llama_index/tree/main/docs/examples |
| Discord | LlamaIndex 社区 |

---

返回选型总览：09_技术选型总览.md
