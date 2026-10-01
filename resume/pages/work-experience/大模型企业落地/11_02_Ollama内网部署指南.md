# Ollama 内网私有化部署指南

> 适用环境：内网隔离、轻量级部署、快速上手
> 关联文档：11_00_内网私有化部署开源软件清单.md

---

## 一、Ollama 简介

### 1.1 为什么选择 Ollama

| 优势 | 说明 |
|------|------|
| 极简部署 | 一条命令启动模型 |
| 模型管理 | 内置模型市场，易于切换 |
| API 兼容 | OpenAI 兼容接口 |
| 跨平台 | 支持 Linux/Mac/Windows |
| 资源友好 | 支持量化，显存要求低 |

### 1.2 与 vLLM 对比

| 特性 | Ollama | vLLM |
|------|--------|------|
| 上手难度 | 极简 | 中等 |
| 性能 | 中等 | 最优 |
| 模型切换 | 一键 | 需要配置 |
| API 兼容性 | OpenAI | OpenAI |
| 多 GPU | 支持 | 优秀 |
| 生产级 | 一般 | 优秀 |

**推荐：内网快速验证用 Ollama，生产用 vLLM**

---

## 二、安装部署

### 2.1 Linux 安装

```bash
# 方式1：安装包（推荐）
curl -fsSL https://ollama.com/install.sh | sh

# 方式2：手动安装
# 下载二进制
curl -L https://github.com/ollama/ollama/releases/download/v0.1.25/ollama-linux-amd64 -o /usr/local/bin/ollama
chmod +x /usr/local/bin/ollama

# 启动服务
ollama serve
```

### 2.2 Docker 部署

```yaml
# docker-compose.yml
version: '3.8'

services:
  ollama:
    image: ollama/ollama:latest
    container_name: ollama
    restart: unless-stopped
    ports:
      - "11434:11434"
    volumes:
      - /data/ollama:/root/.ollama    # 模型存储
      - /data/models:/models           # 自定义模型目录
    environment:
      - OLLAMA_HOST=0.0.0.0
      - OLLAMA_MODELS=/root/.ollama/models
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
```

```bash
# 启动
docker-compose up -d

# 查看日志
docker-compose logs -f ollama
```

---

## 三、模型管理

### 3.1 拉取模型

```bash
# 拉取模型（内网需要先下载再导入）
# 通义千问
ollama pull qwen2.5:7b

# Llama 3
ollama pull llama3:8b

#Phi-3（最小模型，适合测试）
ollama pull phi3:latest

# Mistral
ollama pull mistral:7b

# 查看已下载模型
ollama list
```

### 3.2 内网模型导入

```bash
# 方式1：从 Huggingface 转换
# 安装转换工具
pip install transformers

# 转换模型
ollama create qwen2.5:7b-custom -f /data/templates/modelfile.qwen2.5

# 方式2：Modelfile 配置
# 创建 Modelfile
cat > /data/models/Modelfile << 'EOF'
FROM /data/models/Qwen2.5-7B-Instruct
TEMPLATE """{{ if .System }}<|system|>
{{ .System }}{{ end }}{{ if .Prompt }}<|user|>
{{ .Prompt }}<|end|>
{{ end }}<|assistant|>
{{ .Response }}"""

PARAMETER temperature 0.7
PARAMETER top_p 0.9
PARAMETER top_k 20
PARAMETER num_ctx 8192

SYSTEM """你是一个专业的金融分析师。"""
EOF

# 创建模型
ollama create qwen2.5-custom -f /data/models/Modelfile
```

### 3.3 模型量化

```bash
# 查看可用量化级别
# q4_0, q4_1, q5_0, q5_1, q8_0, f16, f32

# 推荐内网使用 Q5_K_M（精度与效率平衡）
ollama pull qwen2.5:7b-q5_k_m

# 不同量化级别对比
ollama pull qwen2.5:7b-q4_0    # 最小，约 4GB
ollama pull qwen2.5:7b-q4_k_m  # 推荐，约 5GB
ollama pull qwen2.5:7b-q5_k_m  # 高精度，约 6GB
ollama pull qwen2.5:7b-q8_0    # 接近原始，约 8GB
ollama pull qwen2.5:7b-f16     # 原始精度，约 14GB
```

---

## 四、API 使用

### 4.1 OpenAI 兼容 API

```bash
# 聊天 API
curl http://localhost:11434/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d '{
        "model": "qwen2.5:7b",
        "messages": [
            {"role": "user", "content": "你好"}
        ]
    }'

# 生成 API
curl http://localhost:11434/v1/completions \
    -H "Content-Type: application/json" \
    -d '{
        "model": "qwen2.5:7b",
        "prompt": "解释什么是通货膨胀",
        "max_tokens": 200
    }'
```

### 4.2 流式响应

```bash
curl http://localhost:11434/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d '{
        "model": "qwen2.5:7b",
        "stream": true,
        "messages": [{"role": "user", "content": "写一个Python快速排序"}]
    }'
```

### 4.3 Embedding

```bash
# Ollama 支持部分模型的 embedding
ollama pull nomic-embed-text

curl http://localhost:11434/v1/embeddings \
    -H "Content-Type: application/json" \
    -d '{
        "model": "nomic-embed-text",
        "prompt": "大宗商品铜的交易策略"
    }'
```

---

## 五、应用集成

### 5.1 Python SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:11434/v1",
    api_key="ollama"  # 任意字符串
)

# 聊天
response = client.chat.completions.create(
    model="qwen2.5:7b",
    messages=[
        {"role": "user", "content": "你好"}
    ],
    stream=False
)
print(response.choices[0].message.content)

# 流式
stream = client.chat.completions.create(
    model="qwen2.5:7b",
    messages=[{"role": "user", "content": "写一个冒泡排序"}],
    stream=True
)
for chunk in stream:
    print(chunk.choices[0].delta.content, end="", flush=True)
```

### 5.2 LangChain 集成

```python
from langchain_community.llms import Ollama
from langchain.chains import LLMChain
from langchain.prompts import PromptTemplate

# 初始化
llm = Ollama(model="qwen2.5:7b", base_url="http://localhost:11434")

# 简单调用
response = llm.invoke("解释什么是RAG")

# Chain
prompt = PromptTemplate.from_template("{topic}的核心优势是什么？")
chain = LLMChain(llm=llm, prompt=prompt)
result = chain.invoke({"topic": "大模型"})
```

### 5.3 JavaScript SDK

```javascript
import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'ollama'
})

// 聊天
const response = await client.chat.completions.create({
  model: 'qwen2.5:7b',
  messages: [{ role: 'user', content: '你好' }]
})

console.log(response.choices[0].message.content)
```

---

## 六、运维管理

### 6.1 模型操作

```bash
# 查看运行中的模型
ollama ps

# 停止模型
ollama stop qwen2.5:7b

# 删除模型
ollama rm qwen2.5:7b

# 复制模型
ollama cp qwen2.5:7b qwen2.5:7b-copy
```

### 6.2 日志查看

```bash
# 查看 Ollama 日志（systemd）
journalctl -u ollama -f

# Docker 日志
docker logs -f ollama
```

### 6.3 资源监控

```bash
# 查看 GPU 使用
nvidia-smi

# 查看 Ollama 状态
curl http://localhost:11434/api/tags
```

---

## 七、系统服务配置

### 7.1 systemd 服务

```bash
# /etc/systemd/system/ollama.service
[Unit]
Description=Ollama Service
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/ollama serve
Environment="OLLAMA_HOST=0.0.0.0"
Environment="OLLAMA_MODELS=/root/.ollama/models"
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable ollama
systemctl start ollama
```

### 7.2 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| OLLAMA_HOST | 监听地址 | 127.0.0.1 |
| OLLAMA_MODELS | 模型目录 | ~/.ollama/models |
| OLLAMA_NUM_PARALLEL | 并行数 | 1 |
| OLLAMA_MAX_LOADED_MODELS | 最大加载模型数 | 1 |
| OLLAMA_KEEP_ALIVE | 模型保持时间 | 5m |

---

## 八、常见问题

### 8.1 模型加载失败

```bash
# 检查模型文件
ls -la ~/.ollama/models/

# 重新下载模型
ollama rm qwen2.5:7b
ollama pull qwen2.5:7b
```

### 8.2 显存不足

```bash
# 使用更小的量化版本
ollama pull qwen2.5:7b-q4_0

# 或使用更小的模型
ollama pull phi3:3.8b
ollama pull llama3:8b
```

### 8.3 响应慢

```bash
# 检查 GPU 利用率
nvidia-smi

# 降低并发数
export OLLAMA_NUM_PARALLEL=1
```

---

## 九、快速命令速查

```bash
# 启动服务
ollama serve

# 拉取模型
ollama pull 模型名:版本

# 查看模型
ollama list

# 运行模型
ollama run 模型名

# 删除模型
ollama rm 模型名

# 聊天测试
ollama run qwen2.5:7b "你好"

# 创建自定义模型
ollama create 自定义名 -f Modelfile
```

---

返回清单：11_00_内网私有化部署开源软件清单.md
