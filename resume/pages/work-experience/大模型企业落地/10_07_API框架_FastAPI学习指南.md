# FastAPI 后端框架学习指南

> 适用领域：大模型 API 服务、后端开发
> 关联文档：09_技术选型总览.md

---

## 一、FastAPI 概述

### 1.1 为什么选择 FastAPI

FastAPI 是现代 Python Web 框架的佼佼者：

| 特性 | 说明 |
|------|------|
| 高性能 | 与 NodeJS/Go 相当 |
| 自动文档 | Swagger/ReDoc 一键生成 |
| 类型安全 | Pydantic 数据验证 |
| 异步支持 | 原生 async/await |
| OpenAPI | 自动生成接口文档 |

### 1.2 与其他框架对比

| 框架 | 性能 | 易用性 | 生态 | 推荐场景 |
|------|-----|--------|------|---------|
| FastAPI | 高 | 高 | 中 | AI 服务、微服务 |
| Flask | 中 | 高 | 丰富 | 小型应用、传统后端 |
| Django | 中 | 中 | 最丰富 | 全栈应用 |
| Starlette | 高 | 中 | 中 | 底层框架 |

---

## 二、基础用法

### 2.1 安装

```bash
pip install fastapi uvicorn pydantic
```

### 2.2 第一个 API

```python
from fastapi import FastAPI

app = FastAPI(title="我的API", version="1.0.0")

@app.get("/")
async def root():
    return {"message": "Hello World"}

@app.get("/items/{item_id}")
async def get_item(item_id: int):
    return {"item_id": item_id, "name": f"商品{item_id}"}
```

### 2.3 启动服务

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

访问文档：
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

---

## 三、数据模型

### 3.1 Pydantic 模型

```python
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime

class User(BaseModel):
    id: int
    name: str = Field(..., min_length=2, max_length=50)
    email: str
    age: Optional[int] = Field(None, ge=0, le=150)
    created_at: datetime = Field(default_factory=datetime.now)

class Product(BaseModel):
    id: int
    name: str
    price: float = Field(..., gt=0)
    tags: List[str] = []
    description: Optional[str] = None
```

### 3.2 嵌套模型

```python
class Address(BaseModel):
    province: str
    city: str
    district: str
    detail: str

class UserWithAddress(BaseModel):
    user: User
    address: Address
```

### 3.3 请求体验证

```python
from fastapi import Body

@app.post("/users/")
async def create_user(
    user: User = Body(..., embed=True)
):
    return {"user_id": 1, **user.dict()}

# 多个 Body 参数
@app.post("/order/")
async def create_order(
    user_id: int = Body(...),
    items: List[Product] = Body(...),
    remark: Optional[str] = Body(None)
):
    return {"order_id": 1}
```

---

## 四、路由与参数

### 4.1 路径参数

```python
@app.get("/items/{item_id}")
async def get_item(item_id: int):
    return {"item_id": item_id}

# 类型转换自动完成
# "100" -> 100
```

### 4.2 查询参数

```python
from typing import Optional

@app.get("/items/")
async def list_items(
    skip: int = 0,
    limit: int = 10,
    category: Optional[str] = None,
    is_active: bool = True
):
    return {
        "skip": skip,
        "limit": limit,
        "category": category,
        "is_active": is_active
    }
```

### 4.3 请求头与 Cookie

```python
from fastapi import Header, Cookie

@app.get("/profile/")
async def get_profile(
    authorization: str = Header(...),
    session_id: Optional[str] = Cookie(None)
):
    return {
        "auth": authorization,
        "session": session_id
    }
```

---

## 五、大模型服务集成

### 5.1 OpenAI 服务封装

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import openai
import os

app = FastAPI()

# 配置
openai.api_key = os.getenv("OPENAI_API_KEY")

class ChatRequest(BaseModel):
    messages: List[dict]
    model: str = "gpt-4o"
    temperature: float = 0.7
    max_tokens: int = 2048

class ChatResponse(BaseModel):
    content: str
    usage: dict
    model: str

@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    try:
        response = await openai.ChatCompletion.acreate(
            model=request.model,
            messages=request.messages,
            temperature=request.temperature,
            max_tokens=request.max_tokens
        )
        
        return ChatResponse(
            content=response.choices[0].message.content,
            usage=response.usage.to_dict(),
            model=response.model
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

### 5.2 流式响应

```python
from fastapi.responses import StreamingResponse

@app.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    async def generate():
        stream = await openai.ChatCompletion.acreate(
            model=request.model,
            messages=request.messages,
            stream=True
        )
        
        async for chunk in stream:
            if chunk.choices[0].delta.content:
                yield f"data: {chunk.choices[0].delta.content}\n\n"
        
        yield "data: [DONE]\n\n"
    
    return StreamingResponse(
        generate(),
        media_type="text/event-stream"
    )
```

### 5.3 RAG 问答 API

```python
from langchain_openai import ChatOpenAI
from langchain_community.vectorstores import Milvus
from langchain.chains import RetrievalQA

# 初始化（启动时一次）
llm = ChatOpenAI(model="gpt-4o")
vectorstore = Milvus.from_existing_collection(...)
qa_chain = RetrievalQA.from_chain_type(llm=llm, retriever=vectorstore.as_retriever())

class QARequest(BaseModel):
    query: str
    top_k: int = 5

@app.post("/qa", response_model=dict)
async def qa(request: QARequest):
    result = qa_chain({"query": request.query})
    return {
        "answer": result["result"],
        "query": request.query
    }
```

---

## 六、中间件与异常处理

### 6.1 中间件

```python
from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware
import time

# CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 自定义中间件
@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    process_time = time.time() - start_time
    response.headers["X-Process-Time"] = str(process_time)
    return response
```

### 6.2 全局异常处理

```python
from fastapi.responses import JSONResponse
from fastapi import Request

@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    return JSONResponse(
        status_code=400,
        content={"error": "Value Error", "detail": str(exc)}
    )

@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"error": "Internal Server Error"}
    )
```

### 6.3 自定义异常

```python
from fastapi import HTTPException

class NotFoundException(HTTPException):
    def __init__(self, item_id: int):
        super().__init__(
            status_code=404,
            detail=f"Item {item_id} not found"
        )

@app.get("/items/{item_id}")
async def get_item(item_id: int):
    item = get_item_from_db(item_id)
    if not item:
        raise NotFoundException(item_id)
    return item
```

---

## 七、依赖注入

### 7.1 简单依赖

```python
from fastapi import Depends

def get_db():
    db = connect_to_db()
    try:
        yield db
    finally:
        db.close()

@app.get("/users/")
async def list_users(db = Depends(get_db)):
    return db.query(User).all()
```

### 7.2 带参数的依赖

```python
from functools import lru_cache

@lru_cache()
def get_settings():
    return Settings()

@app.get("/config")
async def get_config(settings: Settings = Depends(get_settings)):
    return settings.dict()
```

### 7.3 多个依赖

```python
def verify_token(token: str = Header(...)):
    if not token:
        raise HTTPException(status_code=401)
    return token

def verify_admin(token: str = Depends(verify_token)):
    # 额外验证管理员权限
    return token

@app.delete("/items/{item_id}")
async def delete_item(
    item_id: int,
    admin: str = Depends(verify_admin)
):
    # 只有管理员可以删除
    pass
```

---

## 八、数据库集成

### 8.1 SQLAlchemy 集成

```python
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

SQLALCHEMY_DATABASE_URL = "sqlite:///./app.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class Item(Base):
    __tablename__ = "items"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    price = Column(Float)

# 创建表
Base.metadata.create_all(bind=engine)

# 依赖
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

### 8.2 CRUD 操作

```python
from sqlalchemy.orm import Session

@app.post("/items/", response_model=Item)
def create_item(item: ItemCreate, db: Session = Depends(get_db)):
    db_item = Item(**item.dict())
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item

@app.get("/items/", response_model=List[Item])
def list_items(
    skip: int = 0,
    limit: int = 10,
    db: Session = Depends(get_db)
):
    return db.query(Item).offset(skip).limit(limit).all()
```

---

## 九、部署与生产

### 9.1 Docker 部署

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 9.2 Docker Compose

```yaml
version: '3.8'

services:
  api:
    build: .
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://user:pass@db:5432/mydb
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    depends_on:
      - db

  db:
    image: postgres:15
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: mydb
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

### 9.3 Gunicorn + Uvicorn Workers

```bash
gunicorn main:app \
    -w 4 \
    -k uvicorn.workers.UvicornWorker \
    --bind 0.0.0.0:8000
```

---

## 十、最佳实践

### 10.1 项目结构

```
project/
├── app/
│   ├── __init__.py
│   ├── main.py
│   ├── config.py
│   ├── models/
│   │   ├── __init__.py
│   │   └── models.py
│   ├── schemas/
│   │   ├── __init__.py
│   │   └── schemas.py
│   ├── api/
│   │   ├── __init__.py
│   │   └── v1/
│   │       ├── __init__.py
│   │       └── items.py
│   ├── services/
│   │   ├── __init__.py
│   │   └── item_service.py
│   └── core/
│       ├── __init__.py
│       ├── security.py
│       └── dependencies.py
├── tests/
├── requirements.txt
└── Dockerfile
```

### 10.2 日志配置

```python
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)

logger = logging.getLogger(__name__)

@app.post("/items/")
async def create_item(item: Item):
    logger.info(f"Creating item: {item.name}")
    # ...
```

---

## 十一、学习资源

| 资源 | 链接 |
|------|------|
| 官方文档 | https://fastapi.tiangolo.com/zh/ |
| GitHub | https://github.com/tiangolo/fastapi |
| 教程 | https://fastapi.tiangolo.com/zh/tutorial/ |
| 视频课程 | B站 FastAPI 教程 |

---

返回选型总览：09_技术选型总览.md
