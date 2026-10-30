# MCP 和 Function Calling 有什么区别？Agent 工具接入时两者怎样配合

> 摘要：从模型 Function Calling 到 MCP Host、Client、Server，讲清两者分层、组合调用链、安全边界、适用场景和渐进迁移方式。

## 30 秒先说结论

> Function Calling 是模型与宿主应用间的结构化调用接口，模型返回工具名和参数，应用负责执行。MCP 是 Host、Client、Server 间的能力接入协议，负责发现和调用外部资源或工具。Host 可以把 MCP 工具适配成模型 Schema，模型选中后再通过 MCP Client 调用 Server。MCP 不替代权限、确认、幂等和超时治理。

**关键词**：MCP 和 Function Calling 区别 / MCP Agent 工具 / Model Context Protocol / Agent 工具接入 / MCP 面试题

**本文边界**：聚焦 MCP 与 Function Calling 的架构比较，不追踪易变化的具体 SDK 版本、传输端点或厂商采用现状

---
面试官可能会问：“有了 Function Calling，为什么还需要 MCP？它们是不是两套竞争的工具调用方案？”

回答这道题先要把层次分开，不能急着二选一。Function Calling 解决模型怎样用结构化方式表达“我想调用哪个工具、参数是什么”；MCP 解决应用怎样用相对统一的客户端与服务器协议发现、连接和调用外部能力。一个更靠近模型决策接口，一个更靠近工具集成与通信层。

在同一个 Agent 里，两者完全可以同时出现：Host 通过 MCP Client 从服务器发现工具，把工具描述转换成当前模型能理解的 Schema；模型使用 Function Calling 产生 tool call；Host 校验后通过 MCP Client 请求对应服务器；服务器执行并返回结果；Host 再把结果回灌给模型。MCP 没有让模型获得执行权，Function Calling 也没有自动解决跨工具生态的标准接入。

## 先给出 30 秒回答

> Function Calling 是模型与宿主应用之间的结构化调用接口，模型根据工具 Schema 返回工具名和参数，真正执行仍由应用完成。MCP 是 Host、Client、Server 之间的能力接入协议，负责能力发现、资源或工具访问、请求响应与结果传输。两者不冲突：Host 可以通过 MCP 发现工具，再把它们适配成模型的 Function Calling Schema；模型选中后，Host 通过 MCP Client 调用 Server，并把结果回灌给模型。MCP 提升工具接入复用与解耦，但不会自动解决权限、审批、幂等、超时和模型选错工具的问题。

这段回答里，最关键的是“模型协议层”和“工具接入层”两个位置。

![Function Calling 与 MCP 的分层关系](/project-interview-assets/agent/mcp-vs-function-calling-agent-tools/image_1.png)

*把两者放回各自层次，就不会把 MCP Server 误写成模型，也不会把 Function Calling 误写成网络协议。*

## Function Calling 解决的是什么

模型本身看不到后端函数实现。应用把工具名称、描述和参数 Schema 随请求发给模型，模型选择是否调用，并返回结构化工具名、参数和调用 ID。

这一步完成的是意图表达。模型没有执行数据库查询，也没有访问文件。宿主程序解析 tool call，进行参数、业务和权限校验，再找到真实执行器。结果以 tool message 回传，模型下一轮继续决策或生成答案。

Function Calling 的优势是结构化。相比让模型输出 `Action: search(...)` 再用正则解析，工具名和参数更容易校验，多个调用也可以通过 ID 关联。

但它没有规定你的真实工具要怎样部署、不同应用怎样发现工具、如何连接远程服务，也不会替你管理每个数据源的接入方式。开发者仍可能为每个工具手写适配器、认证和错误转换。

## MCP 解决的是什么

MCP 把外部能力放在客户端与服务器协议中。Host 是运行模型与 Agent 的应用，Host 内的 MCP Client 连接一个或多个 MCP Server。Server 封装文件、数据库、搜索服务或业务 API，并按协议声明它提供的能力。

从概念上看，MCP Server 可以暴露三类能力：Resources 提供可读取的上下文资源；Tools 提供可调用操作；Prompts 提供可复用提示模板。具体能力与传输方式要以项目使用的协议版本和 SDK 为准，不能拿某个旧示例当永久规范。

MCP 的价值在于标准化接入。一个 Server 按协议实现后，多个兼容 Host 可以复用；Host 也可以用相似方式连接不同 Server，而不是每种工具都设计一套私有消息格式。

但 MCP 不是安全产品。Server 怎样认证用户、Host 向模型暴露哪些工具、写操作是否审批、调用怎样幂等，仍由应用和服务端实现。协议统一不代表权限自动正确。

## 一条同时使用两者的完整链路

### 连接与能力发现

Host 启动 MCP Client，与允许的 Server 建立连接，协商当前可用能力。Client 获取工具名称、描述、参数信息和版本。

### 转换为模型工具 Schema

Host 根据当前用户、任务和权限过滤能力，再把候选 MCP Tools 适配成所使用模型的工具格式。不是所有服务器能力都要一次性发给模型。

### 模型生成 Function Calling 请求

模型读取用户目标和工具 Schema，返回工具名、参数与调用 ID。此时 Server 尚未执行。

### Host 校验与路由

Host 解析参数，检查工具仍可用、当前用户有权限、参数合法、高风险操作是否需要确认。然后将调用路由到对应 MCP Client 与 Server。

### Server 执行并返回结果

Server 调用真实数据源或服务，将结果或错误按协议返回。Host 把结果转换为模型可理解、大小受控的 Observation。

### 结果回灌模型

Host 使用原调用 ID 把 tool result 加回消息，模型决定继续使用其他工具或形成最终答案。停止条件仍由 Agent 运行时控制。

![MCP 与 Function Calling 协作流程](/project-interview-assets/agent/mcp-vs-function-calling-agent-tools/image_2.png)

*Function Calling 表达模型意图，MCP 承担 Host 到工具服务器的标准接入。*

## 为什么不能说“MCP 替代 Function Calling”

MCP 可以把工具 Schema 提供给 Host，也可以承载工具调用和结果，但模型仍需要某种方式表达选择。若模型支持原生 Function Calling，Host 可以直接使用；若不支持，也可以让模型输出结构化文本，再由 Host 解析。MCP 不规定模型内部一定使用哪种工具选择接口。

反过来，有 Function Calling 也不等于需要 MCP。应用只有少量本地函数，团队能维护直接适配，使用简单 Registry 就足够。引入 MCP 会增加连接、版本、进程或远程服务治理，不一定带来收益。

所以两者的关系不是替代，而是可组合。一个解决模型如何“说要做什么”，另一个解决应用如何“接到并调用外部能力”。

## 直接 Function Calling 什么时候更合适

工具数量少；执行器与应用在同一代码库；接口只服务一个 Agent；团队需要最小依赖和最短链路；工具协议变化可以由同一团队同步维护。

这时直接注册函数、做后端校验并回灌结果，结构更简单。为了追热点把每个本地函数都包装成独立 MCP Server，可能只增加排障层次。

简单不等于可以省安全。即使没有 MCP，仍要做工具权限、超时、幂等、审计和结果契约。

## MCP 什么时候开始有价值

多个 Host 或 Agent 需要复用相同工具；工具由不同团队维护；既有本地资源也有远程服务；希望服务端独立发布与能力发现；需要减少每个模型应用分别适配同一数据源的工作。

例如多个开发助手都要读取同一类代码资源、调用测试服务。将能力封装成标准 Server 后，Host 通过 Client 连接，工具团队可以独立维护实现。Host 仍决定哪些用户能看到、哪些任务能调用。

MCP 价值越明显，连接治理也越重要：Server 身份、版本兼容、能力变更、健康状态、超时、限流和审计都需要进入运行系统。

## Resources 和 Tools 不要混

Resources 主要提供上下文数据，Tools 表达可执行动作。两者都可能最终把内容交给模型，但安全语义不同。

读取一份被授权文件可以是 Resource；按参数创建一条记录属于 Tool。将所有数据访问都包装成高自由度 Tool，会让模型更容易传入任意路径和查询。将有副作用动作伪装成 Resource，则会掩盖确认和幂等要求。

Host 还要控制资源内容进入上下文的大小和可信度。MCP 能把资源传回来，不代表内容可以被当作系统指令，也不代表完整文件应该原样进入 Prompt。

Prompts 同样是可复用模板，不是不可被覆盖的安全策略。真正权限和执行边界仍在 Host 与 Server。

## MCP Server 提供工具后，模型会自动用好吗

不会。模型是否选对仍受工具名称、描述、候选数量、当前上下文和任务拆解影响。Server 只提供能力，Host 要决定暴露子集，必要时做工具路由。

参数仍可能格式正确但业务错误，Host 和 Server 都需要校验。Server 不应相信“来自可信 Host 就一定合法”，尤其在多租户和远程场景。

工具结果也可能为空、超时或内容过大。Host 需要统一错误 Observation、结果截断、工件存储和 Agent 停止条件。

因此，接入 MCP 解决“工具怎么接”，没有直接解决“模型怎么选、任务怎么完成”。

## 安全边界放在哪里

### Host 侧

认证当前用户；根据任务与权限过滤 Server 和工具；限制模型可见能力；对高风险 tool call 做确认；控制 Agent 总步数、时间和预算。

### Client 侧

管理连接、Server 身份、协议版本、超时和错误；为调用附加可信上下文；避免把凭证暴露给模型。

### Server 侧

再次鉴权与授权；校验参数和资源范围；隔离数据；执行限流、沙箱、幂等和审计；拒绝越权调用。

### 模型侧

遵守工具说明、选择工具和使用结果，但不承担最终安全责任。Prompt 中的限制是辅助，不是授权系统。

双端校验不是重复浪费。Host 防止错误能力暴露，Server 防止恶意或配置错误客户端绕过。

![两种接入方式的工程取舍](/project-interview-assets/agent/mcp-vs-function-calling-agent-tools/image_3.png)

*少量本地工具优先简单，跨应用复用与独立演进时再考虑标准协议层。*

## 最容易答错的六个点

### 把 MCP Server 说成模型

Server 是提供资源或工具能力的服务端组件，模型运行在 Host 的 Agent 链路中。两者职责不同。

### 说 MCP 让模型直接执行工具

仍然是 Host 与 Client 发起请求，Server 执行。模型只产生选择信号。

### 说 Function Calling 只能调用本地函数

Function Calling 表达的是结构化请求，宿主程序可以把它路由到本地函数、远程 API 或 MCP Server。

### 说 MCP 自带完整安全

协议可以支持能力协商和错误格式，但认证、授权、业务权限、审批、幂等和沙箱仍需实现。

### 所有工具都包装 MCP

工具少且只服务一个应用时，直接 Registry 更简单。应看复用、团队边界和独立发布需求。

### 忽略版本与能力变化

Server 工具列表和 Schema 会变化。长任务要绑定能力快照或版本，恢复时检查兼容，不能静默用新契约解释旧调用。

## 工具发现怎样与权限结合

Client 能列出 Server 提供的能力，不表示这些能力都应该发给模型。Host 先按 Server 信任、用户身份、租户、任务域和风险过滤。

模型选择后，Host 再验证一次；Server 收到请求后做最终授权。三次位置关注不同风险：发现阶段减少暴露，执行前防止模型与配置错误，服务端防止客户端绕过。

高风险工具还要返回 Dry-run 或审批状态。MCP 调用成功只说明协议往返正常，不能把“请求已接收”写成业务动作完成。

## 错误和超时怎样传播

Server 返回协议错误、工具错误或业务结果，Client 转成 Host 能理解的状态。Host 再决定向模型暴露多少信息。内部堆栈、路径和凭证不能直接回灌。

一次超时可能发生在模型请求、Client 到 Server 连接、Server 执行或真实下游。Trace 要分层记录，否则只看到“MCP 调用失败”，无法定位。

重试策略也不由协议自动决定。只读暂时故障可以在预算内重试；参数和权限错误不重试；写操作结果不确定先按幂等键核对。

Server 故障时，Host 可以从候选中移除其工具、切换契约兼容的 Server、返回部分结果或停止。不能让模型在多个不等价工具间盲目跳转。

## 怎样评估是否值得引入 MCP

先建立直接接入基线：当前有多少类工具接入工作，Schema、认证、错误与日志是否重复，多个 Host 是否真的需要复用。再做一个最小 Server 与 Client，只接一类低风险工具。

比较的不是“代码行数少了多少”一个指标，还要看连接故障、版本兼容、调试路径、部署和权限边界。标准化减少了各自适配，但增加了协议和服务治理。

对工具调用质量，分别评估发现是否完整、过滤是否正确、模型选择、参数、执行和结果忠实度。MCP 接入成功不能替代 Agent 端到端任务评估。

如果现有项目没有真实 MCP 运行证据，就把回答限定为架构比较和迁移方案，不声称已经接入多少 Server、降低多少成本或提升多少准确率。

## 一条渐进式迁移路径

第一步，先把现有 Function Calling 工具收敛到统一 Registry 和执行网关，厘清 Schema、执行器、权限与错误。

第二步，选择复用需求最高、低副作用的一组工具包装为 MCP Server，Host 通过 Client 发现并调用，但保留原执行路径用于对照。

第三步，补齐 Server 身份、版本、健康、超时、审计与工具过滤。用相同任务比较直接调用和 MCP 路径的结果与故障定位。

第四步，再考虑独立团队和更多 Host 复用。高风险写工具最后迁移，并保留审批与幂等，不能因为协议统一就放宽安全。

![MCP 与 Function Calling 验收清单](/project-interview-assets/agent/mcp-vs-function-calling-agent-tools/image_4.png)

*是否值得引入 MCP，要看复用与治理收益是否超过新增协议层成本。*

## 面试官会怎样连续追问

### 追问一：MCP 和 Function Calling 能同时用吗

可以。Host 通过 MCP 发现工具并适配为模型 Schema，模型用 Function Calling 选择，Host 再通过 MCP Client 调用 Server。

### 追问二：MCP Server 是不是直接和模型通信

通常由 Host 内的 Client 管理通信，模型通过 Host 的工具调用链路间接使用结果。不要跳过 Host 的校验、权限和消息回灌。

### 追问三：用了 MCP 还需要 Tool Registry 吗

仍需要一份运行视图来管理 Server、能力版本、用户可见工具、风险、健康和策略。MCP 提供发现与通信，Host 仍要治理。

### 追问四：什么时候不应该上 MCP

少量本地函数、单一应用、没有跨团队复用且链路延迟敏感时，直接 Function Calling 加 Registry 更简单。

### 追问五：MCP 能解决权限问题吗

不能自动解决。Host 过滤和确认，Server 最终鉴权，工具自身执行对象权限、幂等与审计。

### 追问六：怎样证明迁移 MCP 有价值

用同一组工具与任务比较接入复用、版本治理、故障定位和端到端结果，同时计算新增连接与部署复杂度，不预设协议一定更优。

## Function Calling 与 MCP，面试时这样区分

> Function Calling 和 MCP 不在同一层。Function Calling 是模型与宿主应用之间的结构化意图接口，模型根据 Schema 返回工具名和参数，执行仍由应用完成；MCP 是 Host、Client、Server 之间的能力接入协议，负责发现资源或工具、请求响应和结果传输。它们可以一起用：Host 从 MCP Server 发现工具，按当前身份过滤并适配成模型 Schema；模型返回 Function Calling 请求；Host 校验参数、权限和副作用后，经 MCP Client 调用 Server；结果再按调用 ID 回灌模型。MCP 适合跨 Host、跨团队复用和独立演进，少量本地工具直接 Registry 更简单。协议不会自动解决模型选错、鉴权、审批、幂等、超时和业务成功，Host 与 Server 仍要各自守住边界。

## 引入 MCP 前后，你应能展示什么

1. 是否能画清模型、Host、MCP Client、Server 和真实工具的关系。
1. 是否明确 Function Calling 表达意图，MCP 负责接入与通信。
1. 工具发现后是否按身份、任务和风险过滤，再发给模型。
1. Host 与 Server 是否都做权限、超时、错误和审计。
1. 是否比较了直接接入与 MCP 的复用收益和治理成本。
1. 没有真实 MCP 项目时，是否只讲架构与迁移，不报工具规模或效果。

一句话收口：Function Calling 决定模型怎么“说要用工具”，MCP 决定应用怎么“接上并调用工具”。两者配合，才是一条完整但仍然受控的 Agent 工具链。


---

## 继续追问（官方给出）

1. MCP 与 Function Calling 为什么不是替代关系？
1. Host、MCP Client、Server 和模型分别负责什么？
1. 少量本地工具为什么未必需要 MCP？
1. 用了 MCP 后，权限、超时和高风险副作用放在哪里控制？


## 项目事实自检

- [ ] 画清模型、Host、Client、Server 与真实工具的关系
- [ ] 区分模型意图接口和外部能力接入协议
- [ ] 在 Host 过滤能力并在 Server 最终授权
- [ ] 用直接接入基线验证 MCP 的复用与治理价值
