# Agent / Harness / LLM 报文全链路拆解

> 把每一帧 JSON 报文摊开看：模型怎么发起 function call、Harness 怎么执行工具、MCP 报文长什么样。
>
> 适用场景：Agent Harness 架构设计、循环收敛与人工审批设计、面试技术追问、MCP 接入层排障。

---

## 0. 先立心智模型（这节立不住，后面全看错）

### 0.1 唯一一句必须刻进脑子的话

> **大模型从来不调用工具，也从来不认识 MCP。**
> 模型只会输出一段「我想调用名叫 X 的函数，参数是 Y」的**意图文本**。听懂这段话、去真的执行、再把结果贴回对话历史的人，是 **Harness**。

MCP 是 **Harness 与外部工具服务之间**的协议，跟模型没有一分钱关系。模型看到的永远只是「一个工具列表 + 一次调用请求」，它不知道背后是本地函数、还是 HTTP 上跑的 MCP server。

大量设计文档在这里就歪了：把 MCP 画成「模型直连的插件系统」。一旦这样理解，你后面所有的权限、审批、超时、重试都会设计错位置——这些东西必须落在 Harness，因为模型是**不可信**的一环。

### 0.2 四个角色

| 角色 | 干什么 | 用什么协议 |
|---|---|---|
| **Client / Agent（前端/调用方）** | 采集用户意图、展示流式输出、渲染工具执行过程 | 与 Harness 之间（自定义，常是 WebSocket/SSE/HTTP） |
| **Harness（编排器 / Agent Loop）** | 组装报文、解析 tool_calls、执行工具、回灌结果、控制循环与预算、审批闸门 | 上游对 LLM API，下游对工具/MCP |
| **LLM API（推理服务）** | 读 messages + tools，决定「直接答」还是「要先调工具」 | OpenAI Chat Completions / Responses / Anthropic Messages |
| **Tool 执行端** | 真正干活：本地函数、进程内工具、HTTP 服务、**MCP Server** | 本地调用 / HTTP / MCP(JSON-RPC) |

### 0.3 三条链路，别混为一谈

| 链路 | 谁跟谁说话 | 报文形态 |
|---|---|---|
| **A. 模型链路** | Harness → LLM API | 单次 HTTP 请求/响应（或 SSE 流） |
| **B. 工具链路（本地）** | Harness → 自己的函数 | 无协议，函数调用 |
| **C. 工具链路（MCP）** | Harness → MCP Server | JSON-RPC 2.0（stdio 或 Streamable HTTP） |

**A 和 C 是两种完全不同的协议，中间由 Harness 做翻译。** 这是本文档的主线。

---

## 1. 一次完整循环的时间线

以「用户问：通策医疗现在多少钱？」为例，工具是 `get_stock_quote`。

```
用户              Harness                    LLM API              工具/MCP Server
 │                   │                          │                        │
 │─"通策医疗多少钱"──▶│                          │                        │
 │                   │─① 请求(messages+tools)──▶│                        │
 │                   │◀─② 响应(tool_calls)──────│                        │
 │                   │                          │                        │
 │                   │─③ 执行工具───────────────┼───────────────────────▶│
 │                   │◀─④ 工具结果──────────────┼────────────────────────│
 │                   │                          │                        │
 │                   │─⑤ 回灌请求(带 tool 结果)─▶│                        │
 │                   │◀─⑥ 最终回答(content)─────│                        │
 │◀─"42.18 元"───────│                          │                        │
```

- **① ② ③ ④ ⑤ ⑥ 每一帧都是独立的 JSON**，本文档逐帧给出。
- ① 和 ⑤ 是**同一个 API 的两个不同请求**，不是一个请求的两个阶段。
- 模型是**无状态**的（Chat Completions / Messages 默认）：它不记得上一轮，历史全由 Harness 每次完整重发。所谓「对话记忆」是 Harness 在攒 messages 数组。

---

## 2. 第 0 层：Harness 怎么把工具「喂」给模型

模型事先不知道你有任何工具。你必须**在每个请求里附带工具清单**。四种主流写法，字段名各不相同——这是最容易踩坑的地方。

### 2.1 OpenAI Chat Completions（存量主流，外层有 `function` 包装）

```json
{
  "type": "function",
  "function": {
    "name": "get_stock_quote",
    "description": "查询指定 A 股/港股/美股标的的最新行情快照。当用户询问股价、涨跌幅、成交量时使用。不返回历史 K 线。",
    "strict": true,
    "parameters": {
      "type": "object",
      "properties": {
        "symbol": {
          "type": "string",
          "description": "带市场后缀的证券代码，例如 A 股 600763.SH、港股 00700.HK、美股 AAPL.US"
        },
        "fields": {
          "type": "array",
          "items": { "type": "string", "enum": ["last", "change_pct", "volume", "turnover"] },
          "description": "需要返回的字段，不传则返回全部"
        }
      },
      "required": ["symbol"],
      "additionalProperties": false
    }
  }
}
```

要点：
- 参数 schema 挂在 **`function.parameters`**。
- `strict: true` 才真正约束模型输出符合 JSON Schema；不写就是「建议」。
- `additionalProperties: false` 是 strict 模式的硬要求，漏了会被拒。
- **`description` 是选型依据**。模型靠它决定调不调、调哪个。写得含糊，模型就会乱调或漏调。

### 2.2 OpenAI Responses API（新代码推荐，扁平）

```json
{
  "type": "function",
  "name": "get_stock_quote",
  "description": "查询指定标的最新行情快照。",
  "strict": true,
  "parameters": { "type": "object", "properties": { "symbol": { "type": "string" } }, "required": ["symbol"], "additionalProperties": false }
}
```

差别只有一个：**少了 `function` 这一层包装**，其他字段原样上移。

### 2.3 Anthropic Messages API

```json
{
  "name": "get_stock_quote",
  "description": "查询指定标的最新行情快照。",
  "input_schema": {
    "type": "object",
    "properties": { "symbol": { "type": "string" } },
    "required": ["symbol"]
  }
}
```

差别：字段叫 **`input_schema`**（不是 `parameters`），且没有 `type: "function"` 外层。

### 2.4 MCP `tools/list` 的返回（**注意：模型看不到这个**）

```json
{
  "name": "get_stock_quote",
  "title": "行情快照",
  "description": "查询指定标的最新行情快照。",
  "inputSchema": {
    "type": "object",
    "properties": { "symbol": { "type": "string" } },
    "required": ["symbol"]
  },
  "outputSchema": { "type": "object", "properties": { "last": { "type": "number" } } },
  "annotations": {
    "readOnlyHint": true,
    "destructiveHint": false,
    "idempotentHint": true,
    "openWorldHint": true
  }
}
```

**MCP 用的是 `inputSchema`（驼峰）**，Anthropic 用 `input_schema`（下划线），OpenAI 用 `parameters`。三个名字，一个东西。Harness 的活儿就是把它们归一化。

`annotations` 是给 Harness 看的**安全提示**，模型不一定看得到：
- `readOnlyHint` — 只读，可免审批直接跑
- `destructiveHint` — 有破坏性（删除/覆盖），必须审批
- `idempotentHint` — 幂等，可安全重试
- `openWorldHint` — 会访问外部世界（联网、下单），结果不可预测

> 这组 hint 是设计审批闸门的**第一手依据**。只读工具放行，`destructiveHint: true` 或 `openWorldHint: true` 的一律挂审批。

### 2.5 四种 schema 对照与转换规则

| 维度 | OpenAI Chat Completions | OpenAI Responses | Anthropic Messages | MCP tools/list |
|---|---|---|---|---|
| 外层包装 | `{"type":"function","function":{...}}` | `{"type":"function", ...扁平}` | 扁平 | 扁平 |
| 名称字段 | `function.name` | `name` | `name` | `name` |
| schema 字段 | `function.parameters` | `parameters` | `input_schema` | `inputSchema` |
| 严格模式 | `strict` | `strict` | （无对应，靠 `tool_choice`） | （无对应） |
| 附加元数据 | — | — | — | `annotations` / `outputSchema` |

**转换口诀**：`inputSchema` ⇄ `input_schema` ⇄ `parameters`，形同实异，只改字段名，**不要动 schema 内部结构**（改内部会破坏 strict 校验）。

---

## 3. 完整循环 1：本地 function call（逐帧报文）

### 帧 ①｜Harness → LLM：初始请求

```json
{
  "model": "<你的模型 ID>",
  "messages": [
    {
      "role": "system",
      "content": "你是投资研究助手。涉及实时行情必须调用工具获取，禁止凭记忆回答价格。回答用简体中文，涨用红色语义、跌用绿色语义描述。"
    },
    {
      "role": "user",
      "content": "通策医疗现在多少钱？今天涨了没？"
    }
  ],
  "tools": [
    { "type": "function", "function": { "name": "get_stock_quote", "description": "查询指定标的最新行情快照。", "parameters": { "type": "object", "properties": { "symbol": { "type": "string" } }, "required": ["symbol"], "additionalProperties": false }, "strict": true } }
  ],
  "tool_choice": "auto",
  "parallel_tool_calls": true,
  "temperature": 0
}
```

字段逐个说：
- `messages` — 完整历史。第一轮只有 system + user。
- `tools` — 允许模型使用的工具清单（**每个工具的 schema 都计入 input tokens**，工具多了很贵）。
- `tool_choice` — `"auto"`（模型自决，默认）/ `"none"`（禁止调用）/ `"required"`（必须调至少一个）/ 指定工具对象（强制调它）。做「必须先查数再回答」的场景，用 `"required"` 比写一堆 prompt 靠谱。
- `parallel_tool_calls` — `true` 允许一轮吐多个工具调用。
- `temperature: 0` — 工具路由场景建议压低，减少乱选。

### 帧 ②｜LLM → Harness：模型输出「调用意图」

HTTP 200：

```json
{
  "id": "chatcmpl-9f3a2c71b4e0",
  "object": "chat.completion",
  "created": 1791770768,
  "model": "<你的模型 ID>",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          {
            "id": "call_a1b2c3d4e5",
            "type": "function",
            "function": {
              "name": "get_stock_quote",
              "arguments": "{\"symbol\":\"600763.SH\"}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ],
  "usage": { "prompt_tokens": 812, "completion_tokens": 34, "total_tokens": 846 }
}
```

**这一帧是全文最重要的地方，四个致命细节：**

1. **`content` 是 `null`**。模型没给自然语言回答，它只给了调用意图。前端此时应该渲染「正在调用 get_stock_quote…」而不是干等着。
2. **`arguments` 是一个 JSON 字符串，不是对象**。`"{\"symbol\":\"600763.SH\"}"` —— 里面还有一层转义。忘了 `JSON.parse()` 直接当对象用，是最经典的新手翻车点。
3. **`finish_reason: "tool_calls"`** 是 Harness 判断「要进下一轮」的唯一信号。若为 `"stop"`，说明模型直接答完了，循环终止。
4. **`id: "call_a1b2c3d4e5"`** 是关联键。后面回灌结果时必须原样带上这个 id。**绝对不要用数组下标关联**——并行调用和流式分片下，顺序不可靠。

### 帧 ③｜Harness → 工具：本地执行

这层没有协议，就是函数调用。但 Harness 在调之前必须做四件事，一步都不能省：

```
1. 白名单校验：name 在允许清单内？（模型可能幻觉出不存在的工具）
2. 参数解析：JSON.parse(arguments) → 再按 schema 校验（required / type / enum / pattern / 范围）
3. 授权审批：annotations 是否 readOnly？写操作需人工确认
4. 幂等/超时：生成幂等键，设定超时与重试上限
```

执行日志（Harness 侧）：

```json
{
  "trace_id": "tr_7b21e9",
  "turn": 1,
  "tool_call_id": "call_a1b2c3d4e5",
  "tool": "get_stock_quote",
  "parsed_arguments": { "symbol": "600763.SH" },
  "started_at": 1791770768.412,
  "finished_at": 1791770768.903,
  "latency_ms": 491,
  "status": "ok"
}
```

工具真实返回（原始对象）：

```json
{
  "symbol": "600763.SH",
  "name": "通策医疗",
  "last": 42.18,
  "prev_close": 41.65,
  "change": 0.53,
  "change_pct": 1.27,
  "volume": 5823100,
  "turnover": 244871000,
  "as_of": "2026-10-12T10:06:08+08:00"
}
```

### 帧 ④｜Harness → LLM：把结果回灌（关键在消息顺序）

Harness 往 `messages` 里**追加两条**消息，然后重新发一次完整请求：

```json
{
  "model": "<你的模型 ID>",
  "messages": [
    { "role": "system", "content": "你是投资研究助手。……" },
    { "role": "user", "content": "通策医疗现在多少钱？今天涨了没？" },
    {
      "role": "assistant",
      "content": null,
      "tool_calls": [
        { "id": "call_a1b2c3d4e5", "type": "function", "function": { "name": "get_stock_quote", "arguments": "{\"symbol\":\"600763.SH\"}" } }
      ]
    },
    {
      "role": "tool",
      "tool_call_id": "call_a1b2c3d4e5",
      "content": "{\"symbol\":\"600763.SH\",\"name\":\"通策医疗\",\"last\":42.18,\"prev_close\":41.65,\"change\":0.53,\"change_pct\":1.27,\"volume\":5823100,\"as_of\":\"2026-10-12T10:06:08+08:00\"}"
    }
  ],
  "tools": [ /* 与帧①完全一致，不能省 */ ],
  "tool_choice": "auto"
}
```

**四条铁律，违反任何一条服务端直接 400：**

1. **必须先把 `assistant` 那条带 `tool_calls` 的消息原样放回历史**，再紧跟 `role: "tool"` 的结果。漏掉 assistant 那条 = 400。
2. **`tool_call_id` 必须与 `tool_calls[].id` 精确对应**。
3. **一个 `tool_call` 必须对应一个 `role:"tool"` 消息**。模型并行发起 3 个调用，你就得回 3 条结果；少一条直接报错。（工具失败也要回一条，内容写错误说明，**不要**用异常打断循环——见 §11。）
4. **`content` 必须是字符串**。对象要用 `json.dumps` / `JSON.stringify` 序列化。直接塞对象会被拒。

另外：`tools` 数组每轮都要重发。Chat Completions 是无状态的，服务端不替你记工具表。

### 帧 ⑤｜LLM → Harness：基于工具结果的最终回答

```json
{
  "id": "chatcmpl-2c8d1f0a77b3",
  "object": "chat.completion",
  "created": 1791770771,
  "model": "<你的模型 ID>",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "截至 10:06，**通策医疗（600763.SH）报 42.18 元，涨 0.53 元，涨幅 +1.27%**，当日成交 582.31 万股、成交额约 2.45 亿元。\n\n数据为盘中快照，非收盘价。"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": { "prompt_tokens": 1087, "completion_tokens": 96, "total_tokens": 1183 }
}
```

`finish_reason: "stop"` → Harness 判定循环结束，把 `content` 推给前端。

### 3.6 循环状态机（Harness 主循环）

```
while turn < max_turns:
    发送(messages, tools)
    resp = 接收()
    if resp.finish_reason != "tool_calls":
        返回 resp.message.content        # 结束
        break
    messages.append(resp.message)        # 铁律 1
    for tc in resp.message.tool_calls:   # 并行遍历
        args = json.loads(tc.function.arguments)   # 注意是字符串
        校验(args)
        审批(args)
        result = 执行(tc.function.name, args)
        messages.append({"role":"tool","tool_call_id":tc.id,"content":str(result)})
    turn += 1
else:
    返回 「达到最大轮次，未收敛」          # 兜底，防止死循环烧钱
```

**必须有 `max_turns` 和 token 预算双闸门。** 没有终止条件的 Agent 循环，等于把钱扔进碎纸机。

> 循环的两道关键判定——**什么时候算结束**、**什么时候该拉人**——单独展开在 §4 和 §5。

---

## 4. Agent 怎么知道「结束了」——终止判定的三层信号

### 4.1 核心结论：结束是 Harness 拍板的，不是模型「说」的

模型**没有** `done: true` 这种字段。它只能给出两类信号：

1. **停止原因字段**（`finish_reason` / `stop_reason`）—— 被动信号，附带在响应里
2. **调用一个被 Harness 认定为「终止型」的工具** —— 主动信号，需要你事先设计

而真正拍板的是第三层：**Harness 自己的硬闸门**。

这三层的关系是：**第 1 层是模型的提示，第 2 层是模型的承诺，第 3 层才是你的保障。** 前两层都不可信，可以拿来优化体验，但不能拿来兜底。

### 4.2 第一层：停止原因字段（逐家枚举 + 应对）

**OpenAI Chat Completions 的 `finish_reason`：**

| 值 | 含义 | Harness 动作 |
|---|---|---|
| `stop` | 正常答完 | ✅ 结束，返回 `content` |
| `tool_calls` | 要调工具 | 继续循环：执行 → 回灌 |
| `length` | **撞到 `max_tokens` 被截断** | ⚠️ **假结束**！内容不完整。提高上限重试，或按「未完成」续写，**绝不能直接交付** |
| `content_filter` | 触发内容过滤 | ❌ 中断，走合规兜底话术 |
| `function_call` | 旧版单函数调用（已弃用） | 按 `tool_calls` 处理 |

**OpenAI Responses 的判定：**

```json
{
  "status": "completed",
  "incomplete_details": null,
  "output": [
    { "type": "message", "content": [ { "type": "output_text", "text": "..." } ] }
  ]
}
```

`status` 枚举：`completed` / `incomplete` / `failed` / `in_progress`。
判定规则：`status == "completed"` **且** `output[]` 里**没有** `type: "function_call"` 的项 → 结束。
若 `incomplete_details.reason == "max_output_tokens"` → 同样是假结束。

**Anthropic 的 `stop_reason`：**

| 值 | 含义 | Harness 动作 |
|---|---|---|
| `end_turn` | 正常结束 | ✅ 结束 |
| `tool_use` | 要调工具 | 继续循环 |
| `max_tokens` | 截断 | ⚠️ 假结束，处理同 `length` |
| `stop_sequence` | 命中自定义停止串 | 按业务语义解释 |
| `pause_turn` | **服务端工具跑到一半暂停** | ⚠️ 这是**暂停不是结束**。把整个 assistant 响应原样塞回 `messages` 再发一次，服务端会接着跑 |
| `refusal` | 模型拒答 | ❌ 走兜底 |

`pause_turn` 是最容易误判的一个。它跟 `tool_use` 长得像但语义完全不同：`tool_use` 是"交给**你**执行"，`pause_turn` 是"**服务端自己**还没跑完，等我一会儿"。

**三家停止原因归一化对照：**

| 语义 | OpenAI Chat Completions | OpenAI Responses | Anthropic Messages |
|---|---|---|---|
| 正常结束 | `stop` | `status: "completed"` 且无 `function_call` | `end_turn` |
| 要调工具 | `tool_calls` | `output[]` 含 `function_call` | `tool_use` |
| **被截断（假结束）** | `length` | `incomplete_details.reason = max_output_tokens` | `max_tokens` |
| 被拦截 | `content_filter` | `status: "failed"` | `refusal` |
| 服务端工具暂停 | — | `status: "in_progress"` | `pause_turn` |

> **归一化是 Harness 的活儿。** 你的循环控制器只应该认识一套内部枚举（比如 `DONE` / `CONTINUE` / `TRUNCATED` / `BLOCKED` / `PAUSED`），三家 API 的原始值在最外层就被翻译掉。否则你的循环判断里会长出一堆 `if provider == "openai"`。

### 4.3 第二层：终止型工具 —— 让模型显式声明「我收尾了」

推荐做法：给模型一个**只用于收尾**的工具。模型调用它，就等于宣布任务完成。

**工具定义报文：**

```json
{
  "type": "function",
  "function": {
    "name": "submit_final_answer",
    "description": "当你已收集到足够信息、可以给出最终结论时调用本工具。调用本工具即代表任务结束，此后不会再调用任何其他工具。若存在你无法自行消解的歧义、或需要人工确认的事项，置 needs_human = true。",
    "strict": true,
    "parameters": {
      "type": "object",
      "properties": {
        "answer": {
          "type": "string",
          "description": "给用户的最终回答正文"
        },
        "confidence": {
          "type": "number",
          "minimum": 0,
          "maximum": 1,
          "description": "你对本结论的置信度，0 到 1"
        },
        "citations": {
          "type": "array",
          "items": { "type": "string" },
          "description": "结论依据的来源标识，例如工具名加关键参数"
        },
        "needs_human": {
          "type": "boolean",
          "description": "是否存在需要人工介入的事项"
        }
      },
      "required": ["answer", "confidence", "needs_human"],
      "additionalProperties": false
    }
  }
}
```

**模型调用帧**（注意 `finish_reason` 依然是 `tool_calls`，跟普通工具调用长得一模一样）：

```json
{
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          {
            "id": "call_final_001",
            "type": "function",
            "function": {
              "name": "submit_final_answer",
              "arguments": "{\"answer\":\"截至 10:06，通策医疗（600763.SH）报 42.18 元，涨 1.27%。\",\"confidence\":0.93,\"citations\":[\"get_stock_quote:600763.SH\"],\"needs_human\":false}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ]
}
```

**Harness 的判定规则（这是与普通工具的关键差异）：**

> 若 `tool_calls[].function.name` **属于「终止型工具集合」**：
> ① **不执行**任何真实工具；
> ② **不产生** `role: "tool"` 回灌消息；
> ③ 直接取 `arguments.answer` 作为最终回答，**结束循环**；
> ④ 若 `confidence` 低于阈值 或 `needs_human == true` → 转人工（见 §5）。

**为什么值得专门设计一个工具（对比「靠 `finish_reason` 猜」）：**

| 维度 | 靠 `finish_reason: "stop"` | 终止型工具 |
|---|---|---|
| 收尾内容可否校验 | ❌ 只拿到自由文本 | ✅ 走 JSON Schema（`strict`） |
| 能否携带结构化元数据 | ❌ | ✅ `confidence` / `citations` / `needs_human` |
| 能否强制模型必须收尾 | ❌ 只能靠 prompt 求它 | ✅ `tool_choice` 直接指定该工具 |
| 能否区分「答完了」和「编完了」 | ❌ 长得一样 | ✅ 有 `confidence` 可分流 |
| 是否可审计 | ❌ 只有一段文本 | ✅ 字段齐全，可统计 |

**强制收尾的用法**——在最后一轮把 `tool_choice` 钉死在这个工具上，模型就不能再闲聊：

```json
{
  "tool_choice": {
    "type": "function",
    "function": { "name": "submit_final_answer" }
  }
}
```

Anthropic 等价写法：

```json
{
  "tool_choice": { "type": "tool", "name": "submit_final_answer" }
}
```

这条技巧在「结构化输出 + 工具调用」混合场景下特别有用：既保证输出是合法 JSON，又走的是工具通道（绕开部分厂商 `response_format` 与工具的互斥限制）。

### 4.4 第三层：Harness 硬闸门（模型之外的兜底，一个都不能少）

模型的信号全都不可靠：它可能永远不调终止工具，也可能无限调同一个工具。所以 Harness 必须有自己的判定清单：

| # | 闸门 | 触发信号 | 动作 |
|---|---|---|---|
| 1 | 轮次上限 | `turn >= max_turns` | 终止，返回当前最优结果 + 标注「未收敛」 |
| 2 | token / 成本预算 | 累计 `usage.total_tokens` 或费用超阈值 | 终止 |
| 3 | 墙钟超时 | 单次运行耗时超阈值 | 终止 |
| 4 | **无进展检测** | 连续 N 轮的 `(tool_name, arguments)` 指纹完全相同 | 终止，判定为死循环 |
| 5 | **重复失败检测** | 同一工具连续 3 次返回 `isError: true` | 转人工 |
| 6 | 输出校验失败 | 终止型工具结果 schema 校验连续失败 N 次 | 终止 或 转人工 |
| 7 | 空输出 | `content` 为空 **且** 无 `tool_calls` | 终止，返回兜底话术 |
| 8 | 合规拦截 | 命中敏感词 / 风控规则 | 终止 或 转人工 |

**第 4 条最容易被漏掉，也最贵。**

模型在原地打转——同一个工具、同一个参数，反复调——是生产环境最典型的失控形态。光靠 `max_turns` 兜住的话，你会在烧掉几十万 token 之后才发现它在打转。正确的做法是维护一个「调用指纹集合」：

```
指纹 = hash(tool_name + 规范化后的 arguments)
```

连续 N 轮指纹相同 → 立刻终止。N 取 2 或 3 都行，但**必须有**。

**终止判定清单（按顺序判断，先命中先执行）：**

```
1. finish_reason == "tool_calls" 且工具名 ∈ 终止型工具集合
       → 取 answer，结束循环
       → 若 confidence < 阈值 或 needs_human == true → 转人工（见 §5）
2. finish_reason == "tool_calls" 且工具名为普通工具
       → 执行 + 回灌，进入下一轮
3. finish_reason == "stop" 且 content 非空
       → 结束，返回 content
4. finish_reason ∈ {length, max_tokens, max_output_tokens}
       → 假结束：提高上限重试，或标记「不完整」，绝不静默交付
5. 命中任一硬闸门（轮次 / 预算 / 超时 / 无进展 / 重复失败）
       → 终止 或 转人工，并在 trace 中记录命中的是哪个闸门
6. 其余情况
       → 异常路径，告警 + 终止
```

### 4.5 别静默结束：终止原因必须能透出

> ⚠️ 不管因为什么终止，都要把「终止原因」透出来——trace 里记录，必要时告知用户。

「达到最大轮次，结果可能不完整」和「模型正常答完」，在 UI 上都是"转圈停了"，用户分不出来。但这俩的可信度差着十万八千里。

**静默结束是 Agent 产品体验的头号杀手。** 用户宁愿看到"我没能查全，以下是已知部分"，也不要看到一段装作完整的胡说。

---

## 5. Agent 怎么知道「需要人工介入」

### 5.1 核心结论：四个触发源，一个唯一安全插入点

**唯一安全的插入点：帧 ②（模型响应）之后、帧 ③（执行工具）之前。**

为什么只能是这里：

| 条件 | 在该插入点是否满足 |
|---|---|
| 模型输出已完整落盘 | ✅ `tool_calls` 是完整 JSON，不存在流式半截 |
| 尚无任何副作用发生 | ✅ 工具还没执行，没有下单、没有写库、没有发消息 |
| 消息历史自洽 | ✅ assistant 消息已追加，就差一条 tool 结果 |
| 可安全持久化 | ✅ 状态是干净的，随时可以存档走人 |

换到别的位置插，代价立刻上来：

- **插在工具执行中途** → 可能已扣款但没记录，对账地狱
- **插在回灌之后** → 要回滚模型上下文，等于重新构造一次对话
- **插在请求之前** → 没有上下文可给审批人看，他不知道自己在批什么

**四个触发源：**

| 源 | 谁发起 | 典型场景 | 报文特征 |
|---|---|---|---|
| **A. 模型主动** | 模型调 `escalate_to_human` | 意图含糊、超出能力边界、无权决策 | 普通 `tool_call`，工具名特殊 |
| **B. Harness 策略** | Harness 判定 | 高危工具、金额超阈值、循环无进展 | Harness 自造中断报文 |
| **C. 工具服务** | MCP Server 中途要输入 | 下单前确认、缺必填参数 | `resultType: "input_required"`（MRTR） |
| **D. 用户主动** | 用户点「停止」/ 纠正 | 发现跑偏、想补充约束 | 客户端中断报文 |

A 和 B 发生在链路 A 的边界上，C 发生在链路 C 中途，D 从链路外插进来。**但最终都收敛到同一个中断报文格式**（见 §5.3），由同一套审批 UI 承接。

### 5.2 触发源 A：模型主动请求转人工

**工具定义报文：**

```json
{
  "type": "function",
  "function": {
    "name": "escalate_to_human",
    "description": "当你无法在现有工具与信息范围内解决用户问题时调用本工具。适用于：用户意图存在无法自行消解的歧义、所需数据超出可用工具范围、涉及你无权决策的事项。调用后任务将移交人工处理。",
    "strict": true,
    "parameters": {
      "type": "object",
      "properties": {
        "reason_code": {
          "type": "string",
          "enum": ["ambiguous_intent", "out_of_scope", "insufficient_data", "no_permission", "policy_conflict"],
          "description": "转人工的原因分类"
        },
        "summary": {
          "type": "string",
          "description": "已完成的工作与当前卡点的简明摘要，供人工快速接手"
        },
        "attempted": {
          "type": "array",
          "items": { "type": "string" },
          "description": "已经尝试过的工具调用与结果"
        },
        "suggested_action": {
          "type": "string",
          "description": "建议人工如何处理"
        }
      },
      "required": ["reason_code", "summary"],
      "additionalProperties": false
    }
  }
}
```

**模型调用帧：**

```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call_esc_77",
      "type": "function",
      "function": {
        "name": "escalate_to_human",
        "arguments": "{\"reason_code\":\"ambiguous_intent\",\"summary\":\"用户希望调整持仓，但未指明标的与目标比例；已查询到当前持有通策医疗 600 股、石头科技 200 股。\",\"attempted\":[\"get_portfolio:ok\"],\"suggested_action\":\"请人工确认目标标的与目标仓位比例\"}"
      }
    }
  ]
}
```

**Harness 处理规则：**

> `escalate_to_human` 同样属于**终止型工具**（处理逻辑同 §4.3）：不执行、不回灌、直接结束循环，把 `summary` 推入人工队列，并给用户回一句「已转人工，正在为你转接」。

**`reason_code` 这个枚举是关键设计。**

它把「为什么转人工」变成了**可统计的结构化字段**。跑一段时间你就能看出来：到底是工具覆盖不够（`insufficient_data` 扎堆），还是意图识别太弱（`ambiguous_intent` 扎堆），还是权限模型设计有问题（`no_permission` 扎堆）。

靠模型的自由文本描述，这些你**永远统计不出来**——你只会得到一千条措辞各异的小作文。这是枚举字段相对自然语言的核心价值，值得复用到所有需要分类的决策点上。

### 5.3 触发源 B：Harness 策略闸门（最主要、也最该你控制）

**判定依据表（命中任一即挂起）：**

| # | 判定条件 | 依据来源 |
|---|---|---|
| 1 | 工具不在白名单内 | 模型幻觉出的工具名 |
| 2 | `annotations.destructiveHint == true` | MCP 工具注解 |
| 3 | `annotations.openWorldHint == true` 且为写操作 | MCP 工具注解 |
| 4 | `annotations.idempotentHint == false` 且本次要重试 | MCP 工具注解 |
| 5 | 金额 / 数量 / 影响面超过阈值 | 解析并校验后的 `arguments` |
| 6 | 置信度低于阈值 | 终止型工具的 `confidence` |
| 7 | 连续 N 轮无进展 | 循环指纹 |
| 8 | 同一工具连续失败 3 次 | `isError` 计数 |
| 9 | 命中合规 / 风控规则 | 规则引擎 |

**第 2、3、4 条直接由 §2.4 的 `annotations` 驱动。** 这就是为什么 MCP 要把这几个 hint 定义在协议里，而不是让每个 Harness 自己瞎猜工具的危险程度——**工具的危险等级应该由工具的提供方声明，而不是由调用方推断。**

**Harness → Client：中断报文**

```json
{
  "type": "interrupt.approval_required",
  "interrupt_id": "int_9f3a2c71",
  "trace_id": "tr_7b21e9",
  "turn": 2,
  "created_at": 1791770768,
  "expires_at": 1791771068,
  "tool_call_id": "call_c9d2e1",
  "tool": "place_order",
  "tool_title": "委托下单",
  "arguments": {
    "symbol": "600763.SH",
    "side": "buy",
    "qty": 300,
    "price_type": "market"
  },
  "risk_level": "high",
  "matched_rules": ["destructive_hint", "amount_over_threshold"],
  "human_readable": "拟按市价买入通策医疗（600763.SH）300 股，预计成交额约 12,654 元。该操作会真实产生资金变动。",
  "allowed_decisions": ["approve", "edit", "reject"],
  "editable_fields": ["qty", "price_type", "limit_price"]
}
```

**字段设计要点，每一个都对应一个真实踩过的坑：**

| 字段 | 为什么必须有 |
|---|---|
| `expires_at` | **审批必须有超时。** 没有超时的审批请求会变成僵尸任务，Agent 永远卡在那里，占着连接占着状态 |
| `human_readable` | 给人看的自然语言摘要。**别指望审批人自己去读 `arguments` 里的 JSON**，他看不懂也不该被要求看懂 |
| `matched_rules` | 说清**为什么**要审批。审批人最烦的就是"系统让我确认，但不说为什么"——于是无脑点通过，闸门形同虚设 |
| `editable_fields` | 明确哪些字段能改。避免"要么全同意要么全否决"的二元困境，让审批人可以做**最小修正** |
| `allowed_decisions` | 显式声明可选项，前端不用硬编码业务逻辑 |
| `risk_level` | 让审批 UI 能做出差异化呈现（高风险大红条，低风险小提示） |

**Client → Harness：用户裁决报文**

通过：

```json
{
  "interrupt_id": "int_9f3a2c71",
  "decision": "approve",
  "decided_by": "user:qq940",
  "decided_at": 1791770802,
  "comment": "按市价买 300 股，可以。"
}
```

改参后放行：

```json
{
  "interrupt_id": "int_9f3a2c71",
  "decision": "edit",
  "edited_arguments": {
    "symbol": "600763.SH",
    "side": "buy",
    "qty": 200,
    "price_type": "limit",
    "limit_price": 42.00
  },
  "decided_by": "user:qq940",
  "decided_at": 1791770805,
  "comment": "改成限价 42.00 买 200 股，不追高。"
}
```

拒绝：

```json
{
  "interrupt_id": "int_9f3a2c71",
  "decision": "reject",
  "decided_by": "user:qq940",
  "decided_at": 1791770808,
  "comment": "今天不建仓。"
}
```

**四种决策的语义：**

| decision | 含义 | Harness 动作 |
|---|---|---|
| `approve` | 原样放行 | 按原参数执行工具 |
| `edit` | 改参放行 | 用 `edited_arguments` 执行（**先做一次 schema 校验**） |
| `reject` | 否决 | **不执行**，但必须把否决意见作为 tool 结果回灌（见 §5.6） |
| `timeout`（Harness 侧自行产生） | 超时未响应 | 视同 `reject`，原因标记为超时 |

> `edit` 路径有个隐蔽风险：**用户改的参数可能不合法。** 比如把 `qty` 改成 `0` 或负数。改参放行前必须重新跑一遍 schema 校验，校验失败就退回给用户重填，**不要**把非法参数直接发给工具。

### 5.4 触发源 C：工具服务中途要输入（MCP MRTR）

链路 A 还没走到工具执行，链路 C 中途就要人了。完整报文序列：

**① Harness → MCP Server（正常发起调用）**

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "place_order",
    "arguments": { "symbol": "600763.SH", "side": "buy", "qty": 300 }
  }
}
```

**② MCP Server → Harness（暂停，要人确认）**

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "resultType": "input_required",
    "inputRequests": {
      "confirm": {
        "type": "elicitation",
        "message": "确认按市价买入通策医疗 300 股？预计成交额约 12,654 元。",
        "schema": { "type": "boolean" }
      }
    },
    "requestState": "<server 生成的不透明状态串，Harness 不得解析>"
  }
}
```

**③ Harness → 用户**（包装成与 §5.3 同构的中断报文，只是多标一个 `source`）

```json
{
  "type": "interrupt.approval_required",
  "interrupt_id": "int_mcp_001",
  "source": "mcp_mrtr",
  "server": "trading-mcp",
  "prompt": "确认按市价买入通策医疗 300 股？预计成交额约 12,654 元。",
  "response_schema": { "type": "boolean" },
  "request_state_ref": "rs_001"
}
```

**④ 用户裁决 → Harness → MCP Server（带 `requestState` 重放原调用）**

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "place_order",
    "arguments": { "symbol": "600763.SH", "side": "buy", "qty": 300 },
    "inputResponses": { "confirm": { "value": true } },
    "requestState": "<原样回传，不得篡改>"
  }
}
```

**⑤ MCP Server → Harness（这次给终局）**

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "content": [ { "type": "text", "text": "已成交：买入 600763.SH 300 股 @42.18" } ],
    "isError": false
  }
}
```

**四个必须记住的要点：**

1. **`requestState` 是 server 加密的，Harness 只能原样回传。** 想改内容？那是在伪造服务端状态，会直接导致校验失败或更糟的静默错误。
2. **同一 `inputRequests` 里可以有多个请求项。** 比如 `confirm`（确认）+ `missing_param`（缺参数）同时出现，Harness 要**一次性收集齐**再重放，不能分批。
3. **这是「暂停」，不是「取消」。** 服务端保留了上下文（在 `requestState` 里），你随时可以接着跑。
4. **新版（`2026-07-28`）的这一机制替代了旧的「挂一个 SSE 长连接等 elicitation」。** 好处是中途暂停**不占用连接**，服务端可以放心横向扩容——旧版那种挂长连接等人工的方式，在负载均衡后面基本没法用。

> 协议层细节见 §9.6。

### 5.5 触发源 D：用户主动中断与暂停恢复

**用户点「停止」**，客户端发：

```json
{
  "type": "interrupt.user_cancel",
  "trace_id": "tr_7b21e9",
  "reason": "user_stopped",
  "comment": "方向不对，先停一下"
}
```

**取消语义（别踩这个坑）：**

Harness 收到后**不能硬杀**正在执行的工具调用。工具可能已经下单了但还没返回——硬杀会造成「钱扣了，状态没记录」，这是最难对账的一类事故。

正确顺序：

```
① 置取消标记（不再发起新的工具调用）
② 等待在飞的工具调用自然返回或超时
③ 把已产生的结果落库
④ 产出「部分完成」的收尾结果给用户
```

对**非幂等**工具（`idempotentHint: false`），取消后必须能通过业务查询接口**对账**，确认到底执行了没有。这是设计约束，不是可选项。

**暂停 / 恢复：长审批场景的正确姿势**

> 如果要等人工几小时甚至几天（比如大额转账审批），**不要**让 Harness 阻塞在那里等。

阻塞等待的问题：进程被占住、连接会超时、服务重启就全丢了、无法水平扩容。

正确做法是把整个运行状态**检查点化**：

```json
{
  "checkpoint_id": "ckpt_5a1b",
  "trace_id": "tr_7b21e9",
  "status": "suspended",
  "suspended_at": 1791770768,
  "resume_token": "rt_9f8e7d6c",
  "turn": 2,
  "pending_tool_call": {
    "id": "call_c9d2e1",
    "name": "place_order",
    "arguments": { "symbol": "600763.SH", "side": "buy", "qty": 300 }
  },
  "messages_snapshot_ref": "blob://runs/tr_7b21e9/turn2.json",
  "interrupt_id": "int_9f3a2c71"
}
```

裁决到达后，凭 `resume_token` 恢复：载回 `messages_snapshot`、把裁决转成 tool 结果、继续循环。

**这是设计上的分水岭：**

| 方式 | 适用 | 代价 |
|---|---|---|
| 阻塞等待（Harness 进程持住循环） | 秒级审批 | 进程/连接被占，易超时，重启即丢 |
| 检查点 + 恢复（推荐） | 分钟级及以上 | 要能把整个 run 状态序列化并持久化 |

**判断标准很简单：审批等待时间会不会超过你的进程或连接超时。** 会，就必须做检查点。而"会不会超过"这个问题，在金融场景里的答案几乎总是"会"。

### 5.6 裁决结果怎么回灌给模型（这一步最容易做错）

> **铁律：无论用户怎么裁决，`tool_call` 都必须对应一条 `role: "tool"` 结果消息。**

§3 帧 ④ 的铁律 3 在这里**同样成立**。模型发起了 3 个调用，你就得回 3 条结果。

**「用户拒绝了所以不执行」不等于「不用回消息」。** 直接跳过被拒绝的那个调用，下一轮请求立刻 400 —— 这是人工介入功能上线后最常见的线上故障。

**四种裁决的回灌报文：**

**approve → 执行 → 正常结果**

```json
{
  "role": "tool",
  "tool_call_id": "call_c9d2e1",
  "content": "{\"status\":\"filled\",\"symbol\":\"600763.SH\",\"side\":\"buy\",\"qty\":300,\"price\":42.18,\"order_id\":\"ORD-20261012-0007\"}"
}
```

**edit → 按改后参数执行 → 结果里必须说明改了什么**

```json
{
  "role": "tool",
  "tool_call_id": "call_c9d2e1",
  "content": "{\"status\":\"filled\",\"symbol\":\"600763.SH\",\"side\":\"buy\",\"qty\":200,\"price\":42.00,\"order_id\":\"ORD-20261012-0008\",\"note\":\"用户将数量由 300 改为 200，价格类型由市价改为限价 42.00\"}"
}
```

> **为什么必须在结果里说明改动：** 模型以为执行的是它给的原参数。如果你不告诉它真实执行值，它后续的推理会建立在错误前提上——它会以为"我买了 300 股"，然后基于这个错误数字继续算仓位、算成本。**这个 bug 的可怕之处在于它不会报错，只会一路错到底。**

**reject → 不执行，但必须回灌一条 tool 结果**

```json
{
  "role": "tool",
  "tool_call_id": "call_c9d2e1",
  "content": "{\"status\":\"rejected_by_user\",\"message\":\"用户拒绝执行本操作。用户备注：今天不建仓。请勿重试该操作，如需替代方案请征求用户意见。\"}"
}
```

注意最后那句 `请勿重试该操作`。

**如果不明确禁止，模型很可能换个说法再调一次同一个工具**，然后又被拒，然后形成「请求—拒绝」死循环，一路把你的轮次预算烧完。这是真实存在且相当常见的行为模式——模型会把"被拒绝"理解成"参数不对"，然后满怀信心地换个参数再来一次。

**timeout → 视同拒绝，但标注真实原因**

```json
{
  "role": "tool",
  "tool_call_id": "call_c9d2e1",
  "content": "{\"status\":\"approval_timeout\",\"message\":\"该操作在 5 分钟内未获得用户确认，已自动取消。如需继续请重新发起。\"}"
}
```

**Anthropic 侧等价写法**（`tool_result` 的 `is_error` 置 `true`）：

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_c9d2e1",
      "is_error": true,
      "content": [
        { "type": "text", "text": "用户拒绝执行本操作。备注：今天不建仓。请勿重试。" }
      ]
    }
  ]
}
```

**一个反例：不要用 system 消息承载裁决。**

有人会把用户决定写成一条 `role: "system"` 的消息插进历史，觉得这样更"像指令"。**这是错的**，因为它破坏了 `tool_call` 与 `tool_result` 的配对关系，下一轮请求会直接 400（OpenAI）或行为未定义（Anthropic）。裁决**只能**通过 tool 结果通道回灌。

### 5.7 完整时序（人工介入一次，最长路径）

```
用户           Harness              LLM API           MCP Server        审批人
 │                │                    │                  │              │
 │─提问──────────▶│                    │                  │              │
 │                │─① 请求────────────▶│                  │              │
 │                │◀─② tool_calls──────│                  │              │
 │                │                                       │              │
 │                │  ③ 闸门判定：place_order 命中           │              │
 │                │     destructiveHint + 金额超阈值       │              │
 │                │                                       │              │
 │◀─④ 审批中断────│                                       │              │
 │                │                                       │              │
 │  ════ 或走 MCP MRTR 路径 ════                          │              │
 │                │─④' tools/call────────────────────────▶│              │
 │                │◀─resultType: input_required───────────│              │
 │◀─④'' 审批中断──│                                       │              │
 │                │                                       │              │
 │                │                          ┌────────────┼──────────────┤
 │                │                          │ ⑤ 人工裁决：approve       │
 │                │                          └────────────┼──────────────┤
 │─裁决──────────▶│                                       │              │
 │                │─⑥ tools/call + requestState──────────▶│              │
 │                │◀─成交回报─────────────────────────────│              │
 │                │─⑦ 回灌 tool 结果───▶│                 │              │
 │                │◀─⑧ 最终回答─────────│                 │              │
 │◀─最终回答──────│                                       │              │
```

**注意 ⑦ 的位置：** 无论中间绕了多少路（MRTR 暂停、人工审批、改参），**回到模型链路时，永远是一条干净的 `tool` 结果**。模型完全不知道刚才发生了什么——它不知道有人工审批、不知道参数被改过（除非你把 `note` 写进结果）。

**这是正确的抽象层次。** 人工介入是 Harness 的内部事务，不该污染模型链路的报文形态。

### 5.8 防卡死：超时与降级策略

| 场景 | 超时阈值 | 到期动作 |
|---|---|---|
| 审批等待 | 按业务定（下单 5 min / 大额转账 24 h） | 视同 `reject`，回灌 `approval_timeout` |
| MCP `tools/call` | 按工具定 | 中断等待，回灌 `isError` |
| 用户中断后等在飞调用 | 单工具超时 | 强制落库部分结果，标注不完整 |
| 检查点保留期 | 按合规要求 | 过期清理，用户需重新发起 |
| 人在审批队列中积压 | 队列深度阈值 | 告警 / 限流 / 自动降级为拒绝 |

**最后一条原则，也是这一节最重要的一句：**

> **人工介入的每一步都要能序列化、持久化、重放。**

做不到这三样，你的 Agent 撑不过一次进程重启——**而进程重启是必然会发生的。** 部署、扩缩容、OOM、机器维护，全都会打断你那根"正在等的内存态连接"。凡是把审批状态放在内存里的 Agent，上线第一天就会在某次发布重启后卡住一批单子。

---

## 6. 完整循环 2：并行 tool calls

用户问「通策医疗和石头科技比一下」。

### 帧 ②：一轮吐两个调用

```json
{
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          { "id": "call_aaa111", "type": "function", "function": { "name": "get_stock_quote", "arguments": "{\"symbol\":\"600763.SH\"}" } },
          { "id": "call_bbb222", "type": "function", "function": { "name": "get_stock_quote", "arguments": "{\"symbol\":\"688169.SH\"}" } }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ]
}
```

### 帧 ④：回灌两条结果（顺序无所谓，靠 id 关联）

```json
[
  { "role": "assistant", "content": null, "tool_calls": [ /* 上面两条，原样 */ ] },
  { "role": "tool", "tool_call_id": "call_aaa111", "content": "{\"symbol\":\"600763.SH\",\"last\":42.18,\"change_pct\":1.27}" },
  { "role": "tool", "tool_call_id": "call_bbb222", "content": "{\"symbol\":\"688169.SH\",\"last\":268.90,\"change_pct\":-0.84}" }
]
```

要点：
- Harness 应当**并发执行**这两个调用（`asyncio.gather` / `Promise.all`），而不是串行等。串行会让延迟翻倍。
- 若工具**有状态**（比如同一账户的下单）或有顺序依赖，必须 `parallel_tool_calls: false` 串行化。让模型自己拍并行顺序，是危险的。
- 同一工具被调两次、甚至同名同参重复调，都要能正确处理（去重 / 幂等）。

---

## 7. 完整循环 3：内置工具（server-side tool）

OpenAI Responses API 提供**由服务端自己执行**的内置工具：`web_search`、`file_search`、`code_interpreter`、`computer_use`、`image_generation`，以及**远程 MCP 服务器**直连。

这些工具**你不需要自己执行**，服务端跑完直接把结果给你。

```json
{
  "model": "<你的模型 ID>",
  "input": "检索一下最近一周关于通策医疗的分析师评级变化。",
  "tools": [
    { "type": "web_search" },
    { "type": "file_search", "vector_store_ids": ["vs_abc123"] },
    { "type": "code_interpreter", "container": { "type": "auto" } },
    { "type": "mcp", "server_label": "market-data", "server_url": "https://mcp.example.com/mcp", "require_approval": "never" }
  ],
  "parallel_tool_calls": false
}
```

关键认知：**这是「链路 A」里嵌了「链路 C」。** 模型侧的报文形态没变（还是 tool 调用），但执行方从你的 Harness 变成了 OpenAI 服务端。

于是出现一个重要的架构分歧：

| 模式 | 谁执行工具 | 你能否审批 | token 账算在谁头上 |
|---|---|---|---|
| 自建 function（§3） | 你的 Harness | ✅ 完全可控 | 你的 |
| 服务端内置工具（本节） | LLM 厂商 | ❌ 只有 `require_approval` 粗粒度开关 | 你的（仍计入 usage） |
| 远程 MCP 直连（本节 `type:"mcp"`） | 厂商中转 | 半可控 | 你的 |

**金融/资金类场景，慎给服务端内置工具写权限。** `require_approval` 只有 `never` / `always` 两档，粒度太粗，挡不住「同一批里只放行其中一笔」这种需求。要精细闸门，工具必须握在自己手里。

---

## 8. 完整循环 4：Anthropic `tool_use` / `tool_result`

Anthropic 的形态跟 OpenAI **完全不同**：工具调用不是独立字段，而是 **`content` 数组里的一个 block**。

### 帧 ①｜请求

```json
{
  "model": "<你的模型 ID>",
  "max_tokens": 1024,
  "system": "你是投资研究助手。涉及实时行情必须调用工具获取。",
  "tools": [
    {
      "name": "get_stock_quote",
      "description": "查询指定标的最新行情快照。",
      "input_schema": {
        "type": "object",
        "properties": { "symbol": { "type": "string", "description": "带市场后缀的代码" } },
        "required": ["symbol"]
      }
    }
  ],
  "tool_choice": { "type": "auto", "disable_parallel_tool_use": false },
  "messages": [ { "role": "user", "content": "通策医疗现在多少钱？" } ]
}
```

注意：`system` 是**顶层字段**，不在 `messages` 里（跟 OpenAI 不同）。

### 帧 ②｜响应：`stop_reason: "tool_use"`，`input` 是**对象**

```json
{
  "id": "msg_01XyZ",
  "type": "message",
  "role": "assistant",
  "model": "<你的模型 ID>",
  "stop_reason": "tool_use",
  "stop_sequence": null,
  "content": [
    { "type": "text", "text": "我来查一下实时行情。" },
    {
      "type": "tool_use",
      "id": "toolu_9f8e7d",
      "name": "get_stock_quote",
      "input": { "symbol": "600763.SH" }
    }
  ],
  "usage": { "input_tokens": 820, "output_tokens": 45 }
}
```

**最重要的对比**：

| | OpenAI | Anthropic |
|---|---|---|
| 参数形态 | `arguments`: **JSON 字符串**，要 parse | `input`: **已是对象**，直接用 |
| 关联 ID | `tool_calls[].id` | `tool_use.id` |
| 结束信号 | `finish_reason: "tool_calls"` | `stop_reason: "tool_use"` |
| 文本+调用 | `content` 与 `tool_calls` 并列 | 同一 `content` 数组里的不同 block |
| 能否同帧带文本 | 通常 `content: null` | **可以**，见上面 `"我来查一下实时行情。"` |

Anthropic 允许模型在调用工具时**同时说话**，这对「边思考边调用」的 UX 更友好。Harness 要记得把 `text` block 也渲染出去。

### 帧 ④｜回灌：`tool_result` 塞进 **user 消息**

```json
{
  "model": "<你的模型 ID>",
  "max_tokens": 1024,
  "system": "你是投资研究助手。……",
  "tools": [ /* 同帧① */ ],
  "messages": [
    { "role": "user", "content": "通策医疗现在多少钱？" },
    {
      "role": "assistant",
      "content": [
        { "type": "text", "text": "我来查一下实时行情。" },
        { "type": "tool_use", "id": "toolu_9f8e7d", "name": "get_stock_quote", "input": { "symbol": "600763.SH" } }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "tool_result",
          "tool_use_id": "toolu_9f8e7d",
          "content": [ { "type": "text", "text": "{\"symbol\":\"600763.SH\",\"last\":42.18,\"change_pct\":1.27}" } ],
          "is_error": false
        }
      ]
    }
  ]
}
```

**反直觉但必须记住**：工具结果是以 **`role: "user"`** 发回去的（不是 OpenAI 的 `role:"tool"`）。因为 Anthropic 的消息角色只有 user/assistant，工具结果被视作「用户侧的输入」。

- `tool_use_id` 对应 `tool_use.id`。
- 工具失败时：**不要**中断请求，改为 `is_error: true` 并把错误文本放进去，让模型自己决定重试还是换路。这与 OpenAI 侧「错误也要回一条 tool 消息」是同一原则。

---

## 9. MCP 侧报文（Harness ↔ MCP Server）——模型看不见这一层

MCP 是 **JSON-RPC 2.0**。三种能力：`tools`（可调操作）、`resources`（上下文数据）、`prompts`（消息模板）。本节只讲最常用的 tools。

### 9.1 传输方式

| 传输 | 形态 | 适用 |
|---|---|---|
| **stdio** | 子进程标准输入输出，按行分隔的 JSON-RPC | 本地工具、单机 |
| **Streamable HTTP** | `POST /mcp`，响应可为 JSON 或该请求专属的 SSE 流 | 远程服务、多实例 |
| （旧）HTTP+SSE | 已弃用 | 遗留系统 |

### 9.2 旧版握手（≤ `2025-11-25`，**目前存量部署仍是这套**）

**① client → server：initialize**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-06-18",
    "capabilities": { "roots": { "listChanged": true }, "sampling": {} },
    "clientInfo": { "name": "my-harness", "version": "1.0.0" }
  }
}
```

**② server → client：initialize result**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-06-18",
    "capabilities": {
      "tools": { "listChanged": true },
      "resources": { "subscribe": true, "listChanged": true },
      "prompts": { "listChanged": true },
      "logging": {}
    },
    "serverInfo": { "name": "market-data-mcp", "version": "0.4.2" },
    "instructions": "行情类工具为只读，可直接调用；下单类工具需用户确认。"
  }
}
```

**③ client → server：通知（无 id，不需要回复）**

```json
{ "jsonrpc": "2.0", "method": "notifications/initialized" }
```

握手完成，且服务端会返回一个 `Mcp-Session-Id` 响应头，后续请求要带上。

### 9.3 `tools/list`：拉取工具清单

请求：

```json
{ "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {} }
```

（支持分页：`"params": { "cursor": "<上一页返回的 nextCursor>" }`）

响应：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "get_stock_quote",
        "title": "行情快照",
        "description": "查询指定标的最新行情快照。",
        "inputSchema": {
          "type": "object",
          "properties": { "symbol": { "type": "string" } },
          "required": ["symbol"]
        },
        "annotations": { "readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": true }
      },
      {
        "name": "place_order",
        "title": "委托下单",
        "description": "提交一笔股票委托单。会真实产生资金变动。",
        "inputSchema": {
          "type": "object",
          "properties": {
            "symbol": { "type": "string" },
            "side": { "type": "string", "enum": ["buy", "sell"] },
            "qty": { "type": "integer", "minimum": 100 }
          },
          "required": ["symbol", "side", "qty"]
        },
        "annotations": { "readOnlyHint": false, "destructiveHint": true, "idempotentHint": false, "openWorldHint": true }
      }
    ],
    "nextCursor": null
  }
}
```

**Harness 拿到这个列表后的动作，就是 §2.5 的转换：**
`inputSchema` → OpenAI 的 `parameters` / Anthropic 的 `input_schema`，然后塞进 `tools` 数组，再发给模型。**这就是「模型链路」和「MCP 链路」的接缝所在。**

### 9.4 `tools/call`：真正执行

请求：

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "get_stock_quote",
    "arguments": { "symbol": "600763.SH" }
  }
}
```

> 注意这里 `arguments` 是**对象**。跟 OpenAI 模型输出的那个「字符串」完全不同——转换层要负责 parse。别把两种东西搞混。

成功响应：

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      { "type": "text", "text": "{\"symbol\":\"600763.SH\",\"last\":42.18,\"change_pct\":1.27}" }
    ],
    "structuredContent": { "symbol": "600763.SH", "last": 42.18, "change_pct": 1.27 },
    "isError": false
  }
}
```

`content` 是**块数组**，支持 `text` / `image` / `audio` / `resource_link` / `embedded_resource` 等多种类型。

**两层错误，必须分清（高频排障点）：**

| 层 | 表现 | 含义 | Harness 应对 |
|---|---|---|---|
| **JSON-RPC 协议层** | 顶层有 `"error": {...}`，无 `result` | 请求本身不合法：`-32601` method not found、`-32602` invalid params、`-32603` internal error | 修 Harness 的调用代码 |
| **工具业务层** | 有 `result`，但 `"isError": true` | 参数合法但执行失败：标的不存在、上游超时、余额不足 | 把错误文本回灌给模型，让它换路 |

业务失败示例：

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [ { "type": "text", "text": "标的不存在：600763.XX 不是有效的市场后缀" } ],
    "isError": true
  }
}
```

**把 `isError: true` 当成异常抛出，是最常见的错误实现。** 正确做法是把它转成 `role:"tool"` 的文本内容回灌给模型——模型看到「标的不存在」，多半会自己修正后缀重试。这才是 Agent 该有的自愈能力。

### 9.5 工具清单变更通知

服务端工具集变化时，主动推：

```json
{ "jsonrpc": "2.0", "method": "notifications/tools/list_changed" }
```

Harness 收到后应重新 `tools/list`，并刷新给模型的 `tools` 数组。**注意：这会打断 prompt 前缀缓存**，所以别在每次请求前无脑重拉。新版规范给 `tools/list` 加了 `ttlMs` 和 `cacheScope` 缓存提示，就是为解决这个问题。

### 9.6 新版（`2026-07-28`）：无状态协议

三个破坏性变化：

**① 握手没了。** `initialize` / `notifications/initialized` 与 `Mcp-Session-Id` 一并移除。协议版本、客户端身份、能力改为随**每个请求**走 `_meta`：

```http
POST /mcp HTTP/1.1
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tools/call
Mcp-Name: get_stock_quote
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_stock_quote",
    "arguments": { "symbol": "600763.SH" },
    "_meta": {
      "io.modelcontextprotocol/clientInfo": { "name": "my-harness", "version": "1.0.0" },
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  }
}
```

**② 路由信息搬到 HTTP header。** `Mcp-Method` + `Mcp-Name` 让网关、限流器、WAF **不解析 JSON body** 就能路由和鉴权。写权限的 `tools/call` 可以在网关层直接拦，不用进业务代码。

**③ 能力探测改为按需。** 新增 `server/discover`，只在需要时提前拉能力表，不再强制握手。

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "server/discover",
  "params": { "_meta": { "io.modelcontextprotocol/clientInfo": { "name": "my-harness", "version": "1.0.0" } } }
}
```

**④ 多轮往返请求（MRTR）替换旧的 elicitation 长连接。** 工具执行中需要用户确认时，服务端不再挂着一个双向流，而是直接返回：

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "resultType": "input_required",
    "inputRequests": {
      "confirm": {
        "type": "elicitation",
        "message": "确认按市价买入通策医疗 300 股？预计成交额约 12,654 元。",
        "schema": { "type": "boolean" }
      }
    },
    "requestState": "<server 加密的不透明状态串>"
  }
}
```

Harness 收集到用户答复后，**带上 `requestState` 重发原调用**：

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "place_order",
    "arguments": { "symbol": "600763.SH", "side": "buy", "qty": 300 },
    "inputResponses": { "confirm": { "value": true } },
    "requestState": "<原样回传>"
  }
}
```

> **这是金融场景做「人工审批闸门」的标准姿势。** 注意审批发生在**工具执行中途**，由 MCP server 发起、Harness 承接、用户裁决。这比在 Harness 里写死规则更灵活——阈值判断这类业务逻辑可以下沉到 server。

**⑤ 状态改为显式句柄。** 协议层不再管会话，需要跨调用保持状态的，由工具返回一个 id，让**模型自己把它当普通参数传回来**（如 `create_basket` → `basket_id` → `add_item`）。文档明确说这种「让模型看见状态」的做法，往往比藏在传输层更适合 Agent。

### 9.7 `resources` 与 `prompts`（顺带提一下）

```json
{ "jsonrpc": "2.0", "id": 5, "method": "resources/list", "params": {} }
```
```json
{ "jsonrpc": "2.0", "id": 6, "method": "resources/read", "params": { "uri": "market://docs/fee-schedule" } }
```
```json
{ "jsonrpc": "2.0", "id": 7, "method": "prompts/get", "params": { "name": "stock_review", "arguments": { "symbol": "600763.SH" } } }
```

**关键区别**：`tools` 是**模型自己决定调**的；`resources` / `prompts` 通常是**Harness 或用户在界面里主动选**的（比如用户点一个「附上费率表」按钮）。把 `resources` 强行暴露给模型当工具用，会白白吃掉上下文预算。

---

## 10. 端到端总装：三方报文对照表

同一次「查行情」，三条链路上的报文长得完全不一样：

| 环节 | 报文关键片段 |
|---|---|
| **① 模型请求**（链路 A） | `tools[].function.parameters` + `messages[]` |
| **② 模型响应**（链路 A） | `tool_calls[].function.arguments` = **字符串** |
| **③ Harness 转换** | `json.loads(arguments)` → 得到 `{"symbol":"600763.SH"}` |
| **④ MCP 请求**（链路 C） | `{"method":"tools/call","params":{"name":"get_stock_quote","arguments":{"symbol":"600763.SH"}}}` ← **对象** |
| **⑤ MCP 响应**（链路 C） | `{"result":{"content":[{"type":"text","text":"..."}],"isError":false}}` |
| **⑥ Harness 转换** | 取出 `content[0].text`（或 `structuredContent`）→ 序列化成字符串 |
| **⑦ 模型回灌**（链路 A） | `{"role":"tool","tool_call_id":"call_xxx","content":"<上一步的字符串>"}` |

**整条链上「参数」被序列化/反序列化了三次。** 每一次转换都是 bug 高发区。Harness 里最好有明确的类型边界，而不是到处 `str()` / `JSON.parse()` 随手糊。

---

## 11. Harness 的职责清单（面试高频，逐条能讲清就是加分项）

**A. 报文组装与转换**
1. **Schema 归一化**：MCP `inputSchema` → OpenAI `parameters` / Anthropic `input_schema`。只改字段名，不动内部结构。
2. **工具命名空间化**：多个 MCP server 可能都有 `search`。要加前缀（`market__search`）。注意 OpenAI 工具名限制 `^[a-zA-Z0-9_-]{1,64}$`——超长或含点号斜杠会被拒，映射关系要能反向还原。
3. **工具裁剪与检索**：工具上百个时，全量塞进去 token 直接爆。需要按意图做 top-k 召回（向量检索工具描述），只暴露相关工具。
4. **系统提示与工具的一致性**：system prompt 里承诺的能力，必须与 `tools` 数组对得上。对不上模型就会幻觉调不存在的工具。

**B. 循环控制**
5. **终止条件**：`max_turns` + token 预算 + 无新增 tool_call，三选一命中即止。缺了就是无限烧钱循环。
6. **消息历史管理**：上下文超限时的压缩/摘要/滑窗策略。注意别把 `tool_calls` 和对应的 `tool` 结果切散——切一半必 400。
7. **并行调度**：`asyncio.gather` 并发执行，按 `tool_call_id` 聚合，而非按下标。

**C. 安全与可靠性**
8. **白名单 + 参数校验**：模型会幻觉工具名和参数。必须服务端再校验一次，不能信模型。
9. **审批闸门**：依据 MCP `annotations` 分层——只读放行，`destructiveHint` / `openWorldHint` 拦截。资金类必须人工确认（可用 §9.6 的 MRTR）。
10. **幂等与重试**：网络重试不能导致重复下单。生成幂等键，服务端去重。
11. **超时与退避**：每个工具单独超时，指数退避重试，有上限。
12. **结果截断**：工具可能返回 10MB（比如整张 K 线表）。要截断、或落盘存句柄只回灌摘要。**顺带警告：别把 base64 图片直接塞进 tool 结果，token 会炸。**

**D. 可观测性**
13. **全链路 trace**：`trace_id` + 每轮 `turn` + `tool_call_id` + 工具耗时 + 每轮 tokens。出问题时能一眼看出是模型选错工具、还是工具自己挂了。
14. **错误结构化回灌**：工具失败**不抛异常**，转成 `isError` 内容回灌给模型，让它自愈。

---

## 12. 高频坑清单（照着对，能省一整天）

| # | 坑 | 症状 / 后果 |
|---|---|---|
| 1 | `arguments` 当对象用 | OpenAI 返回的是**字符串**，不 parse 直接取值 → 拿到 undefined |
| 2 | 忘了把 assistant 的 `tool_calls` 消息放回历史 | 直接 400 |
| 3 | N 个 tool_call 只回了 N-1 条结果 | 直接 400 |
| 4 | 用数组下标关联调用与结果 | 并行/流式下顺序错乱，结果串台 |
| 5 | 工具失败时抛异常中断循环 | 模型失去自愈机会，用户看到 500 |
| 6 | 混淆 JSON-RPC 层 error 与 `isError: true` | 把业务错误当协议错误处理，重试逻辑全错 |
| 7 | `inputSchema` / `input_schema` / `parameters` 混用 | schema 校验静默失效（严格模式下被拒） |
| 8 | 写 strict 但漏 `additionalProperties: false` | 请求被拒 |
| 9 | 每轮重新拉 `tools/list` | 打断 prompt 前缀缓存，成本飙升。用 `ttlMs` 缓存 |
| 10 | 还在为实现 `2026-07-28` 的 server 写 `initialize` | 新版已移除，调用失败 |
| 11 | 无 `max_turns` | 模型反复调工具，无限循环烧钱 |
| 12 | 把 base64 图片塞进 tool 结果 | token 爆炸，单次请求可能超限 |
| 13 | `description` 写得太笼统 | 模型选错工具、该调不调 |
| 14 | 跨轮次工具表不一致 | 模型幻觉调用已下线的工具 |
| 15 | 把 `finish_reason: "length"` 当正常结束 | 交付被截断的半句，用户拿到残缺答案 |
| 16 | 用户拒绝后不回灌 tool 结果 | 下一轮请求直接 400 |
| 17 | 回灌 `reject` 时不说「请勿重试」 | 模型换个说法反复重试同一操作，陷入请求-拒绝死循环 |
| 18 | 审批不设超时 | 僵尸任务，Agent 永久卡住，连接与状态被占死 |
| 19 | 没有无进展检测（同一工具同参数反复调） | 烧掉巨额 token 才被 `max_turns` 兜住 |
| 20 | 硬杀正在执行的工具调用 | 钱扣了状态没记，对账地狱 |
| 21 | 用 system 消息承载审批裁决 | 破坏 tool_call 配对，下一轮 400 |
| 22 | 终止原因不透出 | 用户分不清「答完了」和「没查全」，静默交付残缺结果 |

---

## 13. 面试速答（把答案浓缩到能一口气说完）

**Q1：模型是怎么调用工具的？**
模型不调用工具。它输出一个结构化的「调用意图」——OpenAI 是 `message.tool_calls[]`，Anthropic 是 `content[]` 里的 `tool_use` block。真正解析、授权、执行、回灌的是 Harness。模型只负责「决定」。

**Q2：MCP 和 function calling 是什么关系？**
两层的协议，不是竞争关系。function calling 是**模型↔Harness**的接口；MCP 是**Harness↔工具服务**的接口。模型完全不知道 MCP 的存在。Harness 把 MCP 的 `tools/list` 结果翻译成 LLM 需要的 `tools` 数组，把模型的 `tool_calls` 翻译成 MCP 的 `tools/call`。

**Q3：为什么工具执行要放在 Harness 而不是让模型直连？**
因为模型不可信。权限、审批、幂等、超时、审计、脱敏——这些必须有确定性的执行点，而模型输出是概率性的。把安全边界放在模型外面，是 Agent 架构的第一原则。

**Q4：Anthropic 和 OpenAI 工具调用最大的报文差异？**
三点：① 参数形态——OpenAI `arguments` 是 JSON 字符串，Anthropic `input` 是对象；② 结果回灌角色——OpenAI 用 `role:"tool"`，Anthropic 塞进 `role:"user"` 的 `tool_result` block；③ 结束信号——`finish_reason:"tool_calls"` vs `stop_reason:"tool_use"`。

**Q5：MCP 2026-07-28 最大的变化？**
从有状态双向协议变成**无状态请求/响应**。移除了 `initialize` 握手和 `Mcp-Session-Id`，协议版本与能力改走每请求的 `_meta`；路由信息提升到 HTTP header（`Mcp-Method` / `Mcp-Name`），网关不用解析 body 就能鉴权；服务端中途要用户输入改用 MRTR（`resultType: "input_required"`）替代长连接。

**Q6：并行工具调用要注意什么？**
用 `call_id` / `tool_use_id` 关联，不能合下标；Harness 要并发执行；有状态或有顺序依赖的工具必须 `parallel_tool_calls: false`；同名工具被调多次要能正确处理。

**Q7：工具执行失败怎么办？**
两种错误分开处理。协议层错误（JSON-RPC `error`）是 Harness 自己的 bug，修代码；业务层错误（`isError: true`）要转成文本 result 回灌给模型，让它自己换参数重试或换方案。绝不抛异常中断循环。

**Q8：Agent 怎么知道任务结束了？**

分三层，一层比一层可靠。第一层是**停止原因字段**：`stop` / `end_turn` 是正常结束，`tool_calls` / `tool_use` 是要继续循环，`length` / `max_tokens` 是**假结束**（被截断，不能直接交付），`pause_turn` 是暂停而非结束。第二层是**终止型工具**：给模型一个 `submit_final_answer`，它调这个工具就等于宣布收尾，Harness 不执行、不回灌，直接取参数当最终答案——好处是能带 `confidence` / `citations` 这类结构化元数据，还能被 schema 校验。第三层是 **Harness 自己的硬闸门**：轮次上限、token 预算、墙钟超时、无进展检测。**只有第三层是真正可靠的兜底，前两层都只能用来优化体验。**

**Q9：什么时候该转人工？怎么转？**

四个触发源。**模型主动**调 `escalate_to_human`；**Harness 策略闸门**命中（`destructiveHint`、金额超阈值、连续失败、循环无进展）；**MCP 服务端**中途要输入（MRTR 的 `resultType: input_required`）；**用户主动**中断。唯一的**安全插入点**是模型响应之后、工具执行之前——此刻模型输出已完整落盘、尚无任何副作用、状态可安全持久化。转人工时必须把裁决结果作为 tool 结果回灌给模型，**拒绝也要回一条**，否则违反 tool_call 配对规则直接 400；且拒绝时要明确写「请勿重试」，否则模型会换个说法反复重试。长审批场景必须做检查点 + `resume_token`，不能阻塞进程。

---

## 附：一页速查

```
┌─ 链路 A（Harness ↔ LLM）────────────────────────────┐
│ 请求: model + messages[] + tools[] + tool_choice    │
│ 响应: finish_reason="tool_calls" → tool_calls[]     │
│       └ arguments 是【字符串】                       │
│ 回灌: {role:"tool", tool_call_id, content:字符串}    │
│ Anthropic: content[] 里 tool_use / tool_result      │
│            └ input 是【对象】                        │
└─────────────────────────────────────────────────────┘
                     │ Harness 转换层
                     ▼
┌─ 链路 C（Harness ↔ MCP Server）─────────────────────┐
│ JSON-RPC 2.0；stdio 或 Streamable HTTP              │
│ 老版: initialize → notifications/initialized        │
│       → tools/list → tools/call                     │
│ 新版: 无握手；_meta 带版本与能力；                    │
│       header: Mcp-Method / Mcp-Name                 │
│ 字段: inputSchema（驼峰）；arguments 是【对象】        │
│ 结果: {content:[{type,text}], structuredContent,     │
│        isError}                                     │
│ 错误: 协议层 error ≠ 业务层 isError                  │
└─────────────────────────────────────────────────────┘
```


┌─ 终止判定（三层信号，只有第三层可靠）──────────────────────┐
│ 第 1 层  模型被动信号  finish_reason / stop_reason          │
│    stop | end_turn          → 正常结束                      │
│    tool_calls | tool_use    → 继续循环                      │
│    length | max_tokens      → 假结束（被截断），勿静默交付    │
│    pause_turn               → 服务端工具暂停，不是结束        │
│ 第 2 层  模型主动声明  调用终止型工具 submit_final_answer     │
│    → 不执行、不回灌，取 answer 直接结束循环                   │
│ 第 3 层  Harness 硬闸门（唯一可靠的一层）                    │
│    max_turns / token 预算 / 墙钟超时 / 无进展检测            │
└────────────────────────────────────────────────────────────┘
┌─ 人工介入（四个触发源 · 一个插入点）────────────────────────┐
│ 插入点：模型响应之后、工具执行之前 —— 唯一安全点              │
│    A 模型主动   escalate_to_human / needs_human = true      │
│    B Harness    destructiveHint / 金额阈值 / 连续失败        │
│    C 工具服务   MCP MRTR  resultType = input_required       │
│    D 用户       interrupt.user_cancel / 检查点暂停恢复       │
│ 回灌铁律：裁决结果必须作为 tool 结果回灌给模型                │
│            拒绝也要回一条，否则下一轮直接 400                 │
│ 长审批：检查点 + resume_token，绝不阻塞进程                  │
└────────────────────────────────────────────────────────────┘

---

*文档基线：2026-10-12 · MCP 2026-07-28 / OpenAI Chat Completions + Responses / Anthropic Messages*
