# LangChain 学习指南

> 适用领域：RAG 系统、Agent 开发
> 关联文档：09_技术选型总览.md

---

## 一、LangChain 概述

### 1.1 什么是 LangChain

LangChain 是一个用于构建 LLM 应用的开发框架，核心价值：

```
LangChain = LLM + 工具 + 链式调用 + 记忆

           ┌─────────────┐
           │   Chains    │
           └──────┬──────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
┌───┴───┐    ┌────┴────┐   ┌────┴────┐
│ Prompts│    │ Models  │   │ Tools  │
└───────┘    └─────────┘   └─────────┘
```

### 1.2 核心组件

| 组件 | 说明 |
|------|------|
| Models | 支持多种 LLM（OpenAI、Anthropic、本地模型） |
| Prompts | Prompt 模板管理、优化 |
| Chains | 链式调用编排 |
| Agents | 自主决策执行 |
| Memory | 对话记忆管理 |
| Indexes | 文档加载、分割、向量化 |
| Callbacks | 事件回调、日志 |

---

## 二、基础用法

### 2.1 安装

```bash
pip install langchain langchain-openai langchain-community
```

### 2.2 简单对话

```python
from langchain_openai import ChatOpenAI

# 初始化模型
llm = ChatOpenAI(
    model="gpt-4o",
    api_key="your-api-key",
    temperature=0.7
)

# 简单调用
response = llm.invoke("请介绍一下你自己")
print(response.content)
```

### 2.3 Prompt 模板

```python
from langchain.prompts import PromptTemplate

# 定义模板
template = """
你是一个{role}，请回答关于{topic}的问题。

问题：{question}

回答：
"""

prompt = PromptTemplate(
    template=template,
    input_variables=["role", "topic", "question"]
)

# 使用模板
formatted_prompt = prompt.format(
    role="金融分析师",
    topic="大宗商品",
    question="铜价近期走势如何？"
)

response = llm.invoke(formatted_prompt)
```

### 2.4 Chat 提示模板

```python
from langchain.prompts import ChatPromptTemplate

# 定义对话模板
template = ChatPromptTemplate.from_messages([
    ("system", "你是一个专业的{domain}助手。"),
    ("user", "{user_input}"),
    ("assistant", "好的，让我来帮助你。"),
    ("user", "请进一步说明{follow_up}")
])

prompt = template.format(
    domain="大宗商品贸易",
    user_input="什么是点价交易？",
    follow_up="在实践中如何操作？"
)
```

---

## 三、RAG 实战

### 3.1 完整 RAG 流程

```python
from langchain_openai import OpenAIEmbeddings, ChatOpenAI
from langchain_community.vectorstores import Milvus
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.chains import RetrievalQA

# 1. 文档加载与分割
loader = WebBaseLoader("https://example.com/article")
documents = loader.load()

text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=50
)
docs = text_splitter.split_documents(documents)

# 2. 向量化存储
embeddings = OpenAIEmbeddings()
vectorstore = Milvus.from_documents(
    documents=docs,
    embedding=embeddings,
    connection_args={"host": "localhost", "port": 19530}
)

# 3. 构建检索链
llm = ChatOpenAI(temperature=0)
qa_chain = RetrievalQA.from_chain_type(
    llm=llm,
    chain_type="stuff",
    retriever=vectorstore.as_retriever()
)

# 4. 问答
result = qa_chain.invoke({"query": "文章主要讲了什么？"})
print(result["result"])
```

### 3.2 多路检索

```python
from langchain.retrievers import MultiRetriever

# 多源检索
retriever1 = vectorstore.as_retriever(
    search_kwargs={"k": 3}
)
retriever2 = another_vectorstore.as_retriever(
    search_kwargs={"k": 2}
)

# 自定义合并策略
multi_retriever = MultiRetriever(
    retrievers=[retriever1, retriever2]
)
```

### 3.3 上下文压缩

```python
from langchain.retrievers import ContextualCompressionRetriever
from langchain_community.document_compressors import LLMChainExtractor

# 压缩检索器
compressor = LLMChainExtractor.from_llm(llm)
compression_retriever = ContextualCompressionRetriever(
    base_retriever=base_retriever,
    compressors=[compressor]
)
```

---

## 四、Chain 链式调用

### 4.1 LLMChain

```python
from langchain.chains import LLMChain

# 创建链
chain = LLMChain(
    llm=llm,
    prompt=prompt_template
)

# 执行链
result = chain.invoke({
    "role": "金融分析师",
    "topic": "铜",
    "question": "分析近期走势"
})
```

### 4.2 Sequential Chain

```python
from langchain.chains import SequentialChain

# 链1：生成大纲
chain1 = LLMChain(
    llm=llm,
    prompt=outline_prompt,
    output_key="outline"
)

# 链2：基于大纲生成内容
chain2 = LLMChain(
    llm=llm,
    prompt=content_prompt,
    output_key="content"
)

# 串联
full_chain = SequentialChain(
    chains=[chain1, chain2],
    input_variables=["topic"],
    output_variables=["outline", "content"]
)

result = full_chain.invoke({"topic": "大宗商品市场分析"})
```

### 4.3 Router Chain

```python
from langchain.chains import LLMChain
from langchain.prompts import PromptTemplate

# 路由决策
router_template = """
根据用户问题，选择合适的助手：

{input}

选项：
- sales: 销售相关问题
- technical: 技术支持问题
- general: 通用问题

输出格式：只需输出选项名称，如：sales
"""

router_chain = LLMChain(
    llm=llm,
    prompt=PromptTemplate(
        template=router_template,
        input_variables=["input"]
    )
)

# 根据路由选择不同的链
# ... 路由逻辑
```

---

## 五、Agent 开发

### 5.1 基础 Agent

```python
from langchain.agents import Agent, Tool
from langchain.agents import initialize_agent

# 定义工具
def search_price(query: str) -> str:
    """查询商品价格"""
    return f"铜当前价格：78500元/吨"

def get_inventory(product: str) -> str:
    """查询库存"""
    return f"{product}库存：5000吨"

tools = [
    Tool(
        name="价格查询",
        func=search_price,
        description="用于查询大宗商品当前价格"
    ),
    Tool(
        name="库存查询",
        func=get_inventory,
        description="用于查询商品库存情况"
    )
]

# 初始化 Agent
agent = initialize_agent(
    tools=tools,
    llm=llm,
    agent="zero-shot-react-description",
    verbose=True
)

# 执行
result = agent.invoke("现在铜的价格是多少？库存够吗？")
```

### 5.2 自定义 Tool

```python
from langchain.tools import tool
import requests

@tool
def query_trade_data(symbol: str, date: str) -> str:
    """查询指定日期的交易数据
    
    Args:
        symbol: 交易品种代码，如 "CU" 表示铜
        date: 查询日期，格式 YYYY-MM-DD
    
    Returns:
        当日的开盘价、收盘价、成交量等数据
    """
    # 实际调用 API
    response = requests.get(
        f"https://api.example.com/trade",
        params={"symbol": symbol, "date": date}
    )
    return response.json()
```

### 5.3 ReAct Agent

```python
from langchain.agents import AgentType, initialize_agent

agent = initialize_agent(
    tools=tools,
    llm=llm,
    agent=AgentType.STRUCTURED_CHAT_ZERO_SHOT_REACT_DESCRIPTION,
    verbose=True,
    max_iterations=5,
    early_stopping_method="generate"
)
```

---

## 六、Memory 记忆管理

### 6.1 对话记忆

```python
from langchain.memory import ConversationBufferMemory

memory = ConversationBufferMemory(
    memory_key="chat_history",
    return_messages=True
)

# 添加对话
memory.save_context(
    {"input": "你好"},
    {"output": "你好！有什么可以帮助你的？"}
)

# 获取历史
chat_history = memory.load_memory_variables({})
```

### 6.2 摘要记忆

```python
from langchain.memory import SummarizerMixin

memory = ConversationSummaryMemory(llm=llm)

# 自动摘要长对话
memory.save_context(
    {"input": "..."},
    {"output": "..."}
)

summary = memory.load_memory_variables({})
```

### 6.3 知识图谱记忆

```python
from langchain.memory import KnowledgeGraphMemories

memory = KnowledgeGraphMemories(
    llm=llm,
    # 连接知识图谱
)
```

---

## 七、生产级最佳实践

### 7.1 流式输出

```python
from langchain.callbacks import streaming_stdout

# 流式响应
for chunk in agent.stream("查询铜价"):
    print(chunk, end="", flush=True)
```

### 7.2 错误处理

```python
from langchain.schema import OutputParserException

try:
    result = chain.invoke({...})
except OutputParserException as e:
    # 处理解析错误
    logger.error(f"Output parsing error: {e}")
except Exception as e:
    # 处理其他错误
    logger.error(f"Chain execution error: {e}")
```

### 7.3 回调监控

```python
from langchain.callbacks import CallbackManager

class CustomCallbackHandler(BaseCallbackHandler):
    def on_llm_start(self, serialized, prompts, **kwargs):
        print(f"LLM 开始处理...")
    
    def on_llm_end(self, response, **kwargs):
        print(f"LLM 处理完成")

agent = initialize_agent(
    tools=tools,
    llm=llm,
    callback_manager=CallbackManager([CustomCallbackHandler()])
)
```

---

## 八、学习路径

```
阶段一：入门
1. 理解 LangChain 核心概念
2. 掌握 Model I/O（Prompt、Output Parser）
3. 学会使用 LLMChain

阶段二：进阶
4. 深入 Indexes（文档加载、分割、检索）
5. 掌握 RetrievalQA 链
6. 学习 Memory 机制

阶段三：高级
7. Agent 开发（Tool、ReAct）
8. 自定义 Chain
9. 性能优化与监控
```

---

## 九、资源链接

| 资源 | 链接 |
|------|------|
| 官方文档 | https://python.langchain.com |
| GitHub | https://github.com/langchain-ai/langchain |
| 示例库 | https://github.com/langchain-ai/langchain/tree/master/docs |
| Discord | LangChain 官方社区 |

---

返回选型总览：09_技术选型总览.md
