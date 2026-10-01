# AutoGen 多Agent框架学习指南

> 适用领域：多Agent协作、代码生成
> 关联文档：09_技术选型总览.md

---

## 一、AutoGen 概述

### 1.1 什么是 AutoGen

AutoGen 是微软开源的多Agent协作框架，核心特点是让多个AI Agent通过对话协作完成任务：

```
AutoGen 核心概念：

Agent（智能体）
├── 可以是LLM（GPT-4等）
├── 可以是人类
└── 可以是工具

GroupChat（群聊）
├── 多个Agent一起讨论
└── 自动决定谁来发言

Manager（管理器）
├── 协调多个Agent
└── 管理消息传递
```

### 1.2 与 LangChain Agent 的区别

| 特性 | AutoGen | LangChain Agent |
|------|---------|----------------|
| 协作模式 | 多Agent对话协作 | 单Agent+工具 |
| 代码生成 | 强（内置代码执行） | 一般 |
| 团队编排 | 灵活 | 较固定 |
| 适用场景 | 复杂协作任务 | 工具调用任务 |

---

## 二、安装部署

### 2.1 安装

```bash
pip install pyautogen
```

### 2.2 基础配置

```python
import autogen

# 配置模型
config_list = [
    {
        "model": "gpt-4o",
        "api_key": "your-api-key",
        "temperature": 0.7
    }
]

# 创建配置
llm_config = {
    "config_list": config_list,
    "timeout": 120,
}
```

---

## 三、基础用法

### 3.1 简单两Agent对话

```python
import autogen
from autogen import AssistantAgent, UserProxyAgent

# 创建助手Agent
assistant = AssistantAgent(
    name="assistant",
    llm_config={
        "config_list": config_list
    }
)

# 创建用户代理（可以执行代码）
user_proxy = UserProxyAgent(
    name="user_proxy",
    human_input_mode="NEVER",
    max_consecutive_auto_reply=10,
    code_execution_config={
        "work_dir": "coding",
        "use_docker": False
    }
)

# 开始对话
user_proxy.initiate_chat(
    assistant,
    message="帮我写一个计算斐波那契数列的Python函数"
)
```

### 3.2 带工具的Agent

```python
# 定义工具
def get_weather(city: str) -> str:
    """获取城市天气"""
    return f"{city}今天晴天，25度"

# 注册工具
weather_tool = {
    "name": "get_weather",
    "description": "获取指定城市的天气",
    "parameters": {
        "type": "object",
        "properties": {
            "city": {"type": "string", "description": "城市名称"}
        },
        "required": ["city"]
    }
}

assistant = AssistantAgent(
    name="assistant",
    llm_config={
        "config_list": config_list,
        "tools": [weather_tool]
    }
)

# 对话中Agent会自动调用工具
user_proxy.initiate_chat(
    assistant,
    message="北京今天天气怎么样？"
)
```

---

## 四、多Agent协作

### 4.1 GroupChat 群聊模式

```python
from autogen import GroupChat, GroupChatManager

# 创建多个Agent
coder = AssistantAgent(
    name="coder",
    llm_config=llm_config,
    system_message="你是一个Python程序员，负责写代码。"
)

reviewer = AssistantAgent(
    name="reviewer",
    llm_config=llm_config,
    system_message="你是一个代码审查员，负责检查代码质量。"
)

tester = AssistantAgent(
    name="tester",
    llm_config=llm_config,
    system_message="你是一个测试工程师，负责编写测试用例。"
)

# 创建群聊
group_chat = GroupChat(
    agents=[coder, reviewer, tester],
    messages=[],
    max_round=10
)

# 创建管理器
manager = GroupChatManager(groupchat=group_chat, llm_config=llm_config)

# 启动群聊
user_proxy.initiate_chat(
    manager,
    message="请实现一个排序算法，包括代码、review和测试。"
)
```

### 4.2 选择性发言

```python
# 允许选择下一个发言者
group_chat = GroupChat(
    agents=[coder, reviewer, tester],
    messages=[],
    max_round=10,
    speaker_selection_method="round_robin"  # 轮流
    # 或 "auto" - Agent自己决定
    # 或 custom 函数
)

def select_speaker(last_speaker, groupchat):
    """自定义选择逻辑"""
    if "代码" in last_speaker.last_message():
        return groupchat.agent_by_name("reviewer")
    elif "测试" in last_speaker.last_message():
        return groupchat.agent_by_name("tester")
    return groupchat.agent_by_name("coder")
```

---

## 五、代码执行Agent

### 5.1 代码生成与执行

```python
# UserProxyAgent 可以执行代码
code_writer = AssistantAgent(
    name="code_writer",
    llm_config=llm_config,
    system_message="你是代码专家，负责编写Python代码。"
)

executor = UserProxyAgent(
    name="executor",
    human_input_mode="NEVER",
    code_execution_config={
        "work_dir": "output",
        "use_docker": False  # 或 True 使用Docker
    }
)

# 发送代码给执行器
code_writer.send(
    message="""
    请在output目录下创建main.py，
    包含一个计算器类，支持加减乘除运算。
    """,
    recipient=executor
)

# 执行器会自动执行代码
executor.receive(message, code_writer, request_reply=True)
```

### 5.2 Docker 执行环境

```python
executor = UserProxyAgent(
    name="executor",
    human_input_mode="NEVER",
    code_execution_config={
        "work_dir": "coding",
        "use_docker": "python:3.11-slim",
        "timeout": 300
    }
)
```

---

## 六、工作流编排

### 6.1 Sequential 顺序执行

```python
# Agent1 处理
task1 = AssistantAgent(name="task1", llm_config=llm_config)
output1 = task1.generate_reply(messages)

# Agent2 基于输出处理
task2 = AssistantAgent(name="task2", llm_config=llm_config)
output2 = task2.generate_reply(messages + [{"role": "assistant", "content": output1}])
```

### 6.2 并行处理

```python
from concurrent.futures import ThreadPoolExecutor

def agent_task(prompt, agent_name):
    agent = AssistantAgent(name=agent_name, llm_config=llm_config)
    return agent.generate_reply([{"content": prompt, "role": "user"}])

# 并行执行多个任务
prompts = ["任务1", "任务2", "任务3"]

with ThreadPoolExecutor(max_workers=3) as executor:
    results = list(executor.map(agent_task, prompts))
```

### 6.3 两阶段处理

```python
# 阶段1：多个专家并行分析
analyst1 = AssistantAgent(name="市场分析师", ...)
analyst2 = AssistantAgent(name="技术分析师", ...)
analyst3 = AssistantAgent(name="风控分析师", ...)

# 收集分析结果
analyst_results = [analyst1.reply, analyst2.reply, analyst3.reply]

# 阶段2：决策者综合
decider = AssistantAgent(
    name="决策者",
    llm_config=llm_config,
    system_message="综合多位专家意见，给出决策建议。"
)

final_decision = decider.generate_reply(
    messages + [{"role": "assistant", "content": str(analyst_results)}]
)
```

---

## 七、大宗商品场景实战

### 7.1 市场分析Agent团队

```python
# 创建分析师团队
macro_analyst = AssistantAgent(
    name="宏观分析师",
    llm_config=llm_config,
    system_message="""
    你是大宗商品宏观分析师。
    分析重点：
    - 宏观经济形势
    - 货币政策影响
    - 汇率波动
    - 地缘政治
    """
)

supply_analyst = AssistantAgent(
    name="供需分析师",
    llm_config=llm_config,
    system_message="""
    你是大宗商品供需分析师。
    分析重点：
    - 产能变化
    - 库存水平
    - 进出口数据
    - 替代品情况
    """
)

technical_analyst = AssistantAgent(
    name="技术分析师",
    llm_config=llm_config,
    system_message="""
    你是技术分析师。
    分析重点：
    - 价格趋势
    - 支撑位压力位
    - 技术指标
    - 交易量分析
    """
)

# 创建群聊
group_chat = GroupChat(
    agents=[macro_analyst, supply_analyst, technical_analyst],
    messages=[],
    max_round=6
)

manager = GroupChatManager(groupchat=group_chat, llm_config=llm_config)

# 启动分析
user_proxy.initiate_chat(
    manager,
    message="请分析当前铜价的走势，各分析师从自己角度发言。"
)
```

### 7.2 贸易决策Agent团队

```python
# 交易决策团队
risk_manager = AssistantAgent(
    name="风控经理",
    llm_config=llm_config,
    system_message="你负责评估交易风险，给出风险等级和建议。"
)

trader = AssistantAgent(
    name="交易员",
    llm_config=llm_config,
    system_message="你负责制定具体的交易策略和点位。"
)

compliance = AssistantAgent(
    name="合规专员",
    llm_config=llm_config,
    system_message="你负责检查交易是否符合监管要求和公司制度。"
)

# 最终决策
group_chat = GroupChat(
    agents=[risk_manager, trader, compliance],
    messages=[],
    max_round=9
)

manager = GroupChatManager(groupchat=group_chat, llm_config=llm_config)

user_proxy.initiate_chat(
    manager,
    message="客户希望买入5000吨铜用于套保，请给出综合建议。"
)
```

---

## 八、最佳实践

### 8.1 系统提示词设计

```python
# 清晰的角色定义
assistant = AssistantAgent(
    name="analyst",
    llm_config=llm_config,
    system_message="""
    你是大宗商品分析师，专注于金属类品种。
    
    你的职责：
    1. 分析市场供需基本面
    2. 解读价格走势和波动原因
    3. 提供交易建议
    
    你的原则：
    - 数据说话，避免主观臆断
    - 风险提示要醒目
    - 建议要有理有据
    """
)
```

### 8.2 错误处理

```python
# 设置最大重试次数
max_turns = 3
for i in range(max_turns):
    try:
        result = agent.generate_reply(messages)
        if result:
            break
    except Exception as e:
        logger.error(f"Error: {e}")
        if i == max_turns - 1:
            raise
```

### 8.3 性能优化

```python
# 使用缓存
from functools import lru_cache

@lru_cache(maxsize=100)
def cached_analysis(prompt):
    agent = AssistantAgent(name="cached", llm_config=llm_config)
    return agent.generate_reply(prompt)
```

---

## 九、学习资源

| 资源 | 链接 |
|------|------|
| 官方文档 | https://microsoft.github.io/autogen/ |
| GitHub | https://github.com/microsoft/autogen |
| 示例库 | https://github.com/microsoft/autogen/tree/main/notebook |
| Discord | AutoGen 社区 |

---

## 十、进阶主题

```
后续学习方向：
1. Human-in-the-loop（人机协作）
2. 深度研究助手（DeepResearch）
3. 多模态Agent
4. 跨语言协作
5. 长期记忆持久化
```

---

返回选型总览：09_技术选型总览.md
