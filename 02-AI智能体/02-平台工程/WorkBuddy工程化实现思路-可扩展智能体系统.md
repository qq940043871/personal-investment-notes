# WorkBuddy 工程化实现思路：如何落地为一个可扩展的智能体系统

> 版本：v1.0（2026-11-19）
> 适用读者：负责 Agent 平台 / 智能体工程的研发团队
> 文档性质：**本机逆向观察 + 通用工程方法论补全**，不是官方架构文档

---

## 0. 阅读约定与证据分级

本文所有结论都打了标记，请按标记的强度采信，不要混用：

| 标记 | 含义 | 采信方式 |
|---|---|---|
| 【实测】 | 在本机 `C:\Users\qq940\.workbuddy\` 下能直接看到文件、目录或运行时注入的上下文块 | 可直接当事实用，路径可复核 |
| 【行为】 | 从工具集、系统提示的分层结构、可观察到的运行行为反推出来的机制 | 机制成立，具体实现参数未知 |
| 【推断】 | 信息未暴露，我按主流工程实践补齐的合理推断 | 只能当设计参考，落地前必须验证 |
| 【库内】 | 项目既有认知框架里的定义（三层认知、Harness 职责边界） | 与本文观点互引，不改其定义 |

**一句话结论**：WorkBuddy 不是"一个大模型套一层壳"，而是一个 **Harness 型运行时**——宿主进程负责会话、上下文组装、工具执行与可观测；模型只负责"这一步该干什么"；能力（工具 / MCP / 技能 / 子 Agent / 提示词分片）全部以**可版本化的包**形式挂在外面，按需延迟加载。

这与项目内 `LLM-Agent-Harness-三层认知深度解读.md` 的口径一致：**LLM 是引擎，Agent 是应用，Harness 是操作系统**。本文讲的是"操作系统"这一层怎么工程化。

---

## 1. 整体架构

### 1.1 六层视图

| 层 | 职责 | 落地形态 | 本机位置（实证） |
|---|---|---|---|
| **L0 宿主运行时** | 进程管理、会话心跳、IPC、内置浏览器、模型网关 | 桌面 App + CLI 双入口，同一 `~/.workbuddy` 数据根 | `C:\Users\qq940\.workbuddy\sessions\<pid>.json`、`logs\main.log` |
| **L1 交互模式层** | 决定"这一轮用哪套行为约束"（Plan / Ask / Craft…） | 每个 mode 一个插件包，内含 6 个提示词分片 | `plugins\cache\workbuddy-builtin\interactionmode-*\` |
| **L2 主循环与调度** | Agent Loop（分析→思考→选工具→执行→观察→迭代）、子 Agent 派生、任务编排 | 由系统提示中的 loop 契约 + Task 系列工具实现 | 无独立文件，属宿主内置 |
| **L3 能力层** | 工具 / MCP Server / Skill / Plugin / Expert | 声明式清单 + 目录树，全部可版本化 | `mcp.json`、`skills\`、`plugins\cache\` |
| **L4 上下文与记忆** | 分层注入、预算裁剪、压缩、跨会话沉淀 | 云端 profile + 用户级 MEMORY.md + 工作区 memory | `user-<uid>-personal\MEMORY.md`、`<workspace>\.workbuddy\memory\` |
| **L5 治理与可观测** | Trace、日志、审计链、工具策略、审批记录 | 独立数据面，与业务上下文解耦 | `traces\`、`audit-log\`、`mcp-tool-policy.json` |

**关键结构判断**：L1 与 L3 全部落在**文件系统上的包**里，而不是编译进二进制。这意味着提示词、技能、子 Agent 角色都能像代码一样做 diff、灰度、回滚——这是"可扩展"的真正来源，也是后面版本管理与评测能成立的前提。

### 1.2 组件关系

```
                    ┌──────────────────────────────┐
                    │  L0 宿主进程（每会话 1 个 pid）│
                    │  session 心跳 / IPC / 浏览器   │
                    └───────────────┬──────────────┘
                                    │ 组装 system context
                    ┌───────────────▼──────────────┐
   用户输入 ───────▶ │  L2 Agent Loop（单主循环）    │
                    │  意图 → 规划 → 选工具 → 执行  │
                    └───┬───────────┬──────────┬───┘
                        │           │          │
              ┌─────────▼──┐  ┌─────▼─────┐  ┌─▼─────────────┐
              │ L3 内置工具 │  │ L3 MCP    │  │ L3 Skill/子Agent│
              │ Read/Edit/  │  │ stdio /   │  │ SKILL.md 按需   │
              │ Bash/Grep…  │  │ http      │  │ 载入，隔离上下文 │
              └─────────┬──┘  └─────┬─────┘  └─┬─────────────┘
                        └───────────┴───────────┘
                                    │ 观察结果（折叠后回填）
                    ┌───────────────▼──────────────┐
                    │  L4 上下文管理：预算/压缩/注入 │
                    └───────────────┬──────────────┘
                                    │ 全量落盘
                    ┌───────────────▼──────────────┐
                    │ L5 trace span / audit 链 / 日志│
                    └──────────────────────────────┘
```

### 1.3 分层注入的上下文（真实顺序）

每一轮请求，宿主把下面这些块**按固定顺序**拼进 system context。这是上下文工程最硬的证据：

| # | 上下文块 | 来源 | 性质 |
|---|---|---|---|
| 1 | 行为总纲（身份、循环契约、工具使用政策、内容边界） | 宿主内置 | 静态 |
| 2 | 模式片段（六分片之一，见 §2.3） | `interactionmode-*/fragments/` | 半静态 |
| 3 | 可用工具 schema（含 `mcp__*` 工具名清单） | 工具注册表 | 按注册表生成 |
| 4 | 延迟工具名清单（仅名字，无 schema） | 注册表 | 只占名字 |
| 5 | `user_info` / `current_time` / `project_context`（工作区目录快照） | 宿主采集 | 每轮刷新 |
| 6 | `connector-status`（已连接连接器 + 授权状态） | 连接器管理器 | 每轮刷新 |
| 7 | 工作区身份文件（SOUL / IDENTITY / USER / BOOTSTRAP） | `<uid>-personal\`、工作区根 | 文件即状态 |
| 8 | 三层记忆（云端 profile / 用户级 MEMORY.md / 工作区 memory） | 见 §2.2 | 半静态 + 按需 |
| 9 | 技能清单（名称 + 一句话描述，正文不注入） | `skills\`、`plugins\` | 只占描述 |
| 10 | 风格与语气约束 | 用户配置 | 静态 |

**顺序本身就是设计**：越靠前 = 越不可协商（行为总纲、模式）；越靠后 = 越容易变（时间、目录快照）。同时"名字进上下文、正文不进"（第 4、9 块）是控制 token 的核心手法。

---

## 2. 核心模块

### 2.1 Agent 的角色分工与调度机制

#### 2.1.1 角色谱系

| 角色类 | 代表 | 工具权限 | 上下文 | 用途 |
|---|---|---|---|---|
| **主控 Agent** | 会话内唯一主循环 | 全量（按策略裁剪） | 全量对话 | 理解意图、决策、汇总 |
| **探索型子 Agent** | `Explore` | **只读**（Read/Glob/Grep/WebFetch/WebSearch） | 独立，仅回传结论 | 大范围代码/资料检索，避免污染主上下文 |
| **执行型子 Agent** | `general-purpose` | 全量 | 独立 | 多步自主任务、长链路执行 |
| **领域型子 Agent** | `sheet-agent`、`doc-writer`、`doc-formatter`、`doc-converter` | 绑定专用工具集 | 独立 + 专属 references | 表格 / 文档流水线的固定工位 |
| **团队模式 Agent** | 命名 teammate（`pm`、`fe-dev`…） | 按 mode | 独立 + 共享任务列表 | 多角色协作，靠消息互通 |

子 Agent 的角色定义**就是文件**，格式见附录 B.4：`agents/<role>.md`，front matter 里带 `name / description / category: agent / version / spec / tags`，正文写"角色与边界"。这套结构直接套用 `workbuddy-docx` 插件的三工位流水线（writer → formatter → converter），说明"子 Agent 即岗位说明书"是可复用的范式。

#### 2.1.2 四条调度通道

| 通道 | 触发方式 | 并发性 | 上下文代价 | 适用 |
|---|---|---|---|---|
| **同轮并行调用** | 一条消息里发多个独立工具调用 | 真并行 | 结果全部回填主上下文 | 互不依赖的读操作 |
| **子 Agent 派生** | `Agent(prompt, subagent_type)` | 可并行、可后台 | 只回传最终结论 | 探索、长任务、需要独立视角 |
| **后台任务** | `run_in_background: true` | 与主循环异步 | 通过 `TaskOutput` 拉取 | 构建、测试、长脚本 |
| **计划任务** | 一次性 / 周期（rrule） | 独立会话执行 | 不占当前上下文 | 定时任务、提醒 |

**调度原则（可迁移到自研系统）**：

1. **能并行的绝不打串**——同一 message 内多个独立 tool call 是显式契约，不是巧合。
2. **重活外派**——凡是"读 50 个文件找一个定义"这类动作，交给只读子 Agent，主上下文只收一段结论。这是最有效的上下文省钱手段。
3. **长活异步**——超过单轮合理耗时的一律后台化，主循环继续推进，需要结果时再拉取。
4. **失败可中断**——每个异步任务都有 ID，可查状态、可停止，不存在"发出去就失联"。

#### 2.1.3 模式切换即行为注入

本机存在 **5 个** mode 插件包：`interactionmode-ask / craft / plan / expert / quick`，而对用户暴露的是 3 种（Agent / Plan / Ask）。可以推断 `craft` 对应"Agent 模式"（执行优先），`expert`、`quick` 是内部或场景化模式。

每个包内含同一组 6 个分片（`agent-loop.md`、`current-mode.md`、`interaction.md`、`result-presentation.md`、`task-management.md`、`tool-use.md`）。**换模式 = 换一组分片**，代码零改动。注意 `plan` 模式下的 `current-mode.md` 实测是 **0 字节**——说明模式正文由运行时动态注入，静态分片只保留文件名占位。这是个很值得抄的设计：**约束能从状态推导时，不要写死在模板里**。

### 2.2 上下文工程：构建、压缩、注入

#### 2.2.1 构建（Build）

自下而上三层：**必要不变量**（身份/边界/循环契约）→ **场景包**（模式分片 + 技能描述 + 工具 schema）→ **实时态**（时间、目录、连接器状态、记忆）。

硬性要求是**每一块都有预算**。本机可见的预算约束：

- 用户级记忆写入限额 **4,000 字符/会话**；
- 工作区长期记忆限额 **3,000 字符/会话**；
- 最终回答建议 **50–70 行**，超出要压缩而非堆砌；
- 技能只注入 `name + description`，正文由 `Skill()` 触发时才载入。

#### 2.2.2 压缩（Compact）

七种手段，都可在本机观察到痕迹：

| 手段 | 机制 | 观测点 |
|---|---|---|
| **结果折叠** | 中间工具调用与进度消息在 UI 中折叠，模型看到的是"摘要 + 关键行" | 最终回答要求"复述被折叠工具的关键输出" |
| **子 Agent 隔离** | 子 Agent 的中间步骤永不进入主上下文，只回传结论 | `Agent` 工具返回"结果只返回给我" |
| **schema 延迟加载** | 未激活工具只留名字，schema 由 `ToolSearch` 现取 | 系统提示分列"可直接调用"与"需先搜索"两组 |
| **技能懒加载** | 清单只放描述，正文按需读入 | `available_skills` 声明"调用即载入指令" |
| **段落化 + 蒸馏** | 日志按日 append，超 30 天按主题蒸馏进长期记忆后删除 | 项目 memory 约定 |
| **检索式回忆** | 历史不整段回放，用会话检索按需取 | 存在 `conversation_search` 类能力 |
| **回答长度约束** | 用"高信息密度"换取上下文余量 | 硬性 50–70 行上限 |

#### 2.2.3 注入（Inject）

三种时机，区别在于"谁决定写进去"：

| 类型 | 触发者 | 例子 | 特点 |
|---|---|---|---|
| **强制注入** | 宿主 | 行为总纲、工具 schema、时间、目录快照 | 每轮必在，不可关 |
| **条件注入** | 宿主按状态 | `connector-status` 仅在连接器变化时出现；`wecom_wedrive_references` 仅在带附件徽标时注入 | 无状态则零成本 |
| **主动注入** | 模型 | 读文件、查记忆、加载技能、检索历史 | 模型自己决定"值不值得花 token" |

**这套"三种时机"是上下文工程的核心分工**：凡是正确性必需的，宿主强制；凡是可推导的，条件注入；凡是长尾的，让模型主动取。

#### 2.2.4 记忆三层（写入策略分离）

| 层 | 位置 | 谁写 | 限额 | 用途 |
|---|---|---|---|---|
| 云端 profile | 服务端生成，会话开始注入 | 系统自动学习 | 只读 | 长期偏好 |
| 用户级 | `C:\Users\qq940\.workbuddy\MEMORY.md`（工作区视图下为 `<uid>-personal\MEMORY.md`） | 用户显式要求时写 | 跨项目通用规则 | 环境坑、身份约定 |
| 工作区级 | `<workspace>\.workbuddy\memory\YYYY-MM-DD.md` + `MEMORY.md` | 完成任务后自动追加 | 项目约定 | 项目决策、口径 |

**要点**：三层不是"容量分级"，而是**写入权限分级**——自动学习的不许人工改，人工写的不许自动覆盖，项目级的绝不外溢到别的项目。

### 2.3 提示词工程：模板化、版本管理、评测

#### 2.3.1 模板化：三级粒度

| 粒度 | 载体 | 格式 | 变更频率 | 谁能改 |
|---|---|---|---|---|
| **模式级** | `fragments/*.md`（6 个） | 纯 md 片段，无 front matter | 低（跟产品版本） | 平台方 |
| **场景级** | `SKILL.md` | YAML front matter（`name` + `description`）+ md 正文流程 | 中 | 技能作者 |
| **角色级** | `agents/*.md` | front matter（`name/description/category/version/spec/tags`）+ 正文"角色与边界" | 中 | 插件作者 |

三级的共性：**声明与正文分离**。front matter 只放"什么时候该用我"（这是唯一进上下文的部分），正文放"怎么干"（按需载入）。这条约束把"提示词体积"和"提示词触发准确率"解耦了。

#### 2.3.2 版本管理：目录即版本

本机实测的版本机制：

```
plugins\cache\workbuddy-builtin\workbuddy-docx\
├── 5.11.3-wb.43806934.gecace0f7.ha395516167d4\      ← 当前版本（在 .in_use 里挂了 pid）
└── 5.9.3-wb.42398134.gd4692421.h480e8d1fee0f\       ← 旧版本，含 .orphaned_at 标记待回收
```

四个机制叠在一起才成立：

1. **版本号内嵌 git 短哈希**（`gecace0f7`、`ha395516167d4`），版本串可追溯到具体提交，不靠人工维护语义版本。
2. **多版本目录并存**，不原地覆盖——回滚 = 改指针，不是重新下载。
3. **`.in_use\<pid>` 文件做引用计数**：进程活着就占位，退出即释放，GC 只回收无人占用的旧版本（`.orphaned_at` 是回收标记）。
4. **清单登记**：`plugins\installed_plugins.json` 记录 `installPath / version / installedAt / lastUpdated / dependencies`，是运行时唯一的装配依据。

**这套做法的价值**：灰度、回滚、并行 A/B 都不需要额外基础设施，文件系统就是发布系统。

#### 2.3.3 评测：四道闸门

| 闸门 | 时机 | 做法 | 本机证据 |
|---|---|---|---|
| **① 静态校验** | 打包/安装 | JSON Schema 校验清单；`agents/*.md` 必须有 `name/description/version` | `mcp.json` 与插件 `mcp.json` 均带 `$schema: agent-plugins.org/schemas/1.0.0` |
| **② 需求可追溯** | 设计 | 每个 Agent 声明 `spec: [S-xxxxxxx, ...]`，需求条目 ↔ 角色定义双向可查 | `agents/doc-formatter.md` 的 `spec: [S-2605F42A7, S-26067CF39]` |
| **③ 干跑（dry-run）** | 上线前 | 只打印命中路径/参数不落盘，人工核对 | 技能与文档流水线均要求"先 dry-run 再真插" |
| **④ 回归用例** | 每次改动 | 固定输入集跑产物验收（链接可达、路径可解析、产物可打开） | 项目内可复跑脚本群（链接检查、HTML 路径检查、合并体覆盖率校验） |

线上还应有：分片 A/B（同 mode 两版 `fragments` 按流量切）、trace 回放（把真实失败会话喂回评测集）。本机未见对应文件，属合理推断。

### 2.4 RAG：入库、检索、召回、融合

#### 2.4.1 入库（Ingest）

本机的知识源是**连接器统一入口**，而不是单一向量库：

| 环节 | 做法 | 证据 |
|---|---|---|
| **统一入口** | `knowledge_search` 一次查询，跨多个源聚合；返回里带 `unavailable` 列表标注哪个源没查到 | 工具描述明确要求"对 unavailable 里的源再用该源自身能力补查" |
| **多源接入** | 连接器声明式注册，`ima` / `乐享知识库` / `腾讯文档` / `资料库` 各一个包，各自带 `mcp.json` | `plugins\cache\workbuddy-connector-plugins-official\*\mcp.json` |
| **类型归一** | 按扩展名分流：`.md → document`、`.csv → table`、`.html → saved page`、其余 → `original file` | 上传工具的类型映射规则 |
| **去重** | 按文件指纹登记，重复上传可识别 | `~\.workbuddy\knowledge-file-fingerprints\` |
| **大文件** | 100 MiB 上限，超限拒收而非静默截断 | 上传工具约束 |

#### 2.4.2 检索与召回

具体算法未暴露，按可观察行为反推的合理结构：

```
query
 ├─ ① 改写/扩展（同义词、实体归一、口语→术语）
 ├─ ② 并行多路召回
 │    ├─ 关键词/BM25：精确术语、编号、错误码
 │    ├─ 向量语义：近义表达、跨语言
 │    └─ 结构化：元数据过滤（来源、时间、类型、空间/项目）
 ├─ ③ 融合排序（RRF 或加权）→ 去重 → 时间衰减
 └─ ④ 裁剪 top-k → 按"可引用粒度"切块（段落/小节，非定长切片）
```

**注意"可引用粒度"这条**：文档类知识如果按固定 512 token 切，引用时给不出"第几节"，回答就变成不可核验的转述。本机的回答风格要求"给出文件路径 + 具体位置"，反推入库切块必须保留结构信息。

#### 2.4.3 融合回答（Fuse）

| 步骤 | 规则 | 目的 |
|---|---|---|
| **引用绑定** | 每段结论挂回具体来源（文件名/路径/`file_id`） | 可核验 |
| **冲突显式化** | 多源矛盾时并列呈现，不擅自"和稀泥" | 不制造假共识 |
| **证据不足标注** | 没检索到就写"未找到"，不用先验补 | 抗幻觉的第一道闸 |
| **分层归纳** | 先给结论，再给依据，再给原文位置 | 便于快速判断是否要下钻 |
| **来源透出** | 连接器不可用时明确告知缺口 | 让用户知道盲区 |

---

## 3. 运行流程（端到端）

| # | 步骤 | 执行者 | 落盘/可观测 |
|---|---|---|---|
| 1 | 用户输入进入会话，宿主启动/复用会话进程 | L0 | `sessions\<pid>.json` 心跳 |
| 2 | 组装 system context（§1.3 十块） | L0 + L1 | trace `span: agent` |
| 3 | 模型判断：直接答 / 调工具 / 派生 Agent / 问澄清 | 模型 | 首个 span |
| 4 | 工具调用按需加载：`ToolSearch` 取 schema → `DeferExecuteTool` 执行 | L3 | `span: tool` |
| 5 | 独立调用同轮并行；重活派子 Agent；长活转后台 | L2 | 子 trace（独立 traceId） |
| 6 | 结果回填：可折叠显示、超长摘要、敏感内容脱敏 | L4 | span 结束事件 |
| 7 | 迭代直到终止条件（任务完成 / 需澄清 / 达上限） | L2 | `trace_end` |
| 8 | 产物落盘 + 索引登记 | L3 | `artifact-index\<uuid>.json`、`file-history\` |
| 9 | 回答按"结论优先 + 关键证据"输出，必要时打开预览 | 模型 | `PresentFiles` 记录 `_meta.sourceTool` |
| 10 | 完成实质工作后，向工作区日志追加一条 | 模型 | `<workspace>\.workbuddy\memory\YYYY-MM-DD.md` |
| 11 | 每步写审计条目，链式哈希串联 | L5 | `audit-log\<date>.jsonl` + `state.json` |
| 12 | 会话结束：释放 `.in_use` 引用、GC 旧版本、关闭 segment | L0 | `.orphaned_at`、`segment-closed` 事件 |

**终止判定三层信号**（这个设计直接影响成本）：① 任务级完成（产物已生成并验收）；② 交互级阻塞（信息不足，必须问人）；③ 预算级熔断（轮次/时长/token 上限）。三者优先级不同，**阻塞要早于完成判定**——否则会出现"信息不全却硬给一个完成态"的经典事故。

---

## 4. 关键设计（问题 / 设计 / 代价）

| # | 问题 | 设计 | 代价 / 边界 |
|---|---|---|---|
| 1 | 子任务污染主上下文 | 单主循环 + 子 Agent 上下文隔离，只回传结论 | 子 Agent 看不到主对话细节，需在 prompt 里自包含背景 |
| 2 | 工具太多撑爆上下文 | 名字常驻、schema 延迟加载（两段式） | 多一次工具调用，且模型须先"知道该搜什么" |
| 3 | 提示词改一次全挂 | 六分片按 mode 组装，单分片可独立替换 | 分片间耦合要在评测里兜住（组合爆炸） |
| 4 | 升级无法回滚 | 目录即版本 + pid 引用计数 + 孤儿标记 | 磁盘占用上升，需 GC 策略 |
| 5 | 记忆乱写导致越权 | 三层记忆按写入权限分离，非容量分级 | 跨层迁移必须人工触发 |
| 6 | 审计可被篡改 | 每个 segment 记 `firstHash/lastHash/fileSha256`，`state.json` 维护全局 `sequence` 与 `lastHash` | 无法删改历史，存储只增 |
| 7 | 破坏性操作不可逆 | 危险操作四步：**先只读扫描 → 列清单 → 明示风险 → 二次确认**；删除优先走回收站 | 交互成本上升，自动化程度受限 |
| 8 | 长任务失联 | 后台任务 + 任务 ID + 状态查询 + 主动停止 | 需处理"进程重启后孤儿任务" |

**第 6 条值得单独说**：链式哈希把审计日志从"文本记录"升级成"可证未篡改的证据链"——每条记录 `lastHash` 指向前一条，segment 关闭时落盘整体 `fileSha256`，全局只增的 `sequence` 做序号兜底。这在金融、政企场景是准入项，不是加分项。

---

## 5. 数据流与接口契约

| 对象 | 生产者 | 消费者 | 落盘位置 | 格式 |
|---|---|---|---|---|
| 会话状态 | 宿主 | 宿主 / 崩溃恢复 | `sessions\<pid>.json` | JSON（pid、sessionId、cwd、心跳、endpoint、version） |
| Trace | Agent 循环 | 排障 / 回放 | `traces\<pid>\trace_<traceId>.jsonl` | JSONL（`trace_start` / `span_start` / `span_end`） |
| 审计条目 | 治理层 | 合规审计 | `audit-log\<date>.jsonl` + `state.json` | JSONL（链式哈希） |
| 工具策略 | 用户/管理员 | 工具调度器 | `mcp-tool-policy.json` | JSON（`disabledTools` 表） |
| 工具审批 | 用户 | 连接器管理器 | `mcp-approvals.json` | JSON（`toolHash::server → 时间戳`） |
| 产物索引 | PresentFiles | 产物面板 | `artifact-index\<uuid>.json` | JSON（name/mimeType/uri/`_meta.sourceTool`） |
| 插件装配 | 安装器 | 运行时 | `plugins\installed_plugins.json` | JSON（`installPath/version/installedAt/dependencies`） |
| 技能清单缓存 | 扫描器 | 上下文组装 | `.skill-list-cache.json` | JSON |
| 记忆 | 模型/用户 | 上下文组装 | `MEMORY.md` / `memory\<date>.md` | Markdown（纯文本，可 diff） |
| 提示词分片 | 平台 | 上下文组装 | `plugins\...\fragments\*.md` | Markdown |

**契约设计的三个共性**：① 全部**人类可读**（JSON/JSONL/Markdown），故障时能直接打开看；② 全部**追加优先**（JSONL、append-only md），避免并发写互相覆盖；③ **一个对象一个文件/一行**，天然支持按时间切片与增量同步。

---

## 6. 关键工程挑战

| 挑战 | 具体表现 | 对策 | 验收标准 |
|---|---|---|---|
| **上下文预算** | 工具结果 + 历史 + 技能描述三者争抢窗口 | 折叠 / 摘要 / 延迟加载 / 子 Agent 隔离 | 单轮上下文占用可控，长会话不出现"遗忘开头" |
| **工具爆炸** | 300+ 工具名进上下文，模型选错或漏选 | 名字常驻 + schema 按需；工具分组与命名前缀（`mcp__server__tool`） | 工具选择准确率可量化，新增工具不显著劣化 |
| **提示词组合爆炸** | 5 mode × N 技能 × M 角色，组合无法穷举 | 分片解耦 + 关键路径回归集 | 变更只影响声明范围内的用例 |
| **多版本并存** | 升级中断导致半旧半新 | 目录隔离 + pid 引用计数 + 原子指针切换 | 任意时刻只有一个版本在跑，回滚 < 秒级 |
| **并发写冲突** | 多会话同时改同一索引/记忆文件 | 定点编辑（唯一锚点）+ 原子写脚本 + 先读后写 | 无静默覆盖；冲突可检出 |
| **不可复现** | 同一请求两次结果差异大 | trace 全量落盘 + 版本号入 trace metadata | 可按 traceId 还原输入/工具/版本 |
| **成本与延迟** | 长链路 + 大上下文导致单轮秒级→分钟级 | 并行、后台化、结果裁剪、按需召回 | P95 延迟与单轮成本有基线并监控 |
| **权限越界** | Agent 误删、误改、误发布 | 策略禁用表 + 审批记录 + 危险操作四步 + 沙箱 | 高危动作 100% 二次确认 |
| **评测缺位** | "感觉变好了"无法证伪 | spec 可追溯 + dry-run + 回归用例 + 灰度 | 每次发布有可对比的指标差 |

---

## 7. 可观测性与质量保障

### 7.1 可观测性三面

| 面 | 内容 | 位置 | 用途 |
|---|---|---|---|
| **Trace（调用面）** | 每会话一个 `traceId`，每动作一个 `span`（`traceId/spanId/parentId/name/type/agentName/startedAt/duration/status/error`） | `traces\<pid>\` | 定位"哪一步慢/错"，还原链路 |
| **Log（进程面）** | 按进程分文件：`main.log`、`renderer.log`、`daemon.log`、`mcp-apps-diag.log` | `logs\` | 崩栈、IPC、MCP 握手问题 |
| **Audit（合规面）** | 链式哈希、按日分段、全局序号 | `audit-log\` | 谁在什么时候做了什么，可证未篡改 |

**Trace 结构是 OpenTelemetry 语义**（`traceId/spanId/parentId`），意味着可以直接对接现有 APM，不需要自造一套观测标准。子 Agent 派生会开独立 trace，父 span 记 `agentName` 关联——这条很重要，否则多 Agent 场景的链路根本串不起来。

### 7.2 质量闸门（四层递进）

```
提交 → ① 静态校验（清单 schema / front matter 必填）
     → ② 干跑（命中路径与参数，不落盘）
     → ③ 回归用例（固定输入集，产物可验收）
     → ④ 灰度（版本并存，按流量/用户切）
     → 全量
```

每层失败都**不允许跳级**。特别是第 ②层——本项目里所有批量改文件的操作都要求先 dry-run 打印命中，这是花了代价换来的规矩。

---

## 8. 从原型到生产化的实施步骤

| 阶段 | 目标 | 关键交付物 | 退出标准 | 主要风险 |
|---|---|---|---|---|
| **P0 骨架（1–2 周）** | 跑通"能读能改能看结果" | 单主循环 + 3–5 个基础工具（读/写/搜/执行）+ 会话落盘 | 端到端完成一个真实小任务，日志可回溯 | 过早做多 Agent，链路不可观测 |
| **P1 能力层（2–3 周）** | 能力与内核解耦 | 工具注册表 + 延迟加载 + 技能包格式 + 版本目录规范 | 新增能力不需改核心代码；旧版本可回滚 | 清单格式反复变，产生兼容债 |
| **P2 上下文与记忆（2–3 周）** | 长会话不崩、跨会话有沉淀 | 分层注入 + 预算与压缩策略 + 三层记忆写入策略 | 长会话质量不衰减；记忆不越权 | 压缩丢关键信息，且丢得无声 |
| **P3 治理与可观测（2 周）** | 可排障、可审计、可管控 | trace/span 埋点 + 审计链 + 工具策略与审批 | 任一失败可按 traceId 还原；高危动作有闸门 | 埋点侵入业务逻辑 |
| **P4 多 Agent 与评测（持续）** | 复杂任务并行、质量可证 | 子 Agent 角色库 + 团队协作 + 评测集与灰度 | 发布有指标差；子 Agent 可独立替换 | 上下文传递失真、成本失控 |

**跨阶段的四条硬规矩**（顺序不能反）：

1. **先可观测，再自动化**——没有 trace 的自动化等于不可维护。
2. **先延迟加载，再扩能力**——否则能力越多，选得越差。
3. **先写策略，再给权限**——工具策略与审批表必须早于高危工具上线。
4. **先有回滚，再谈升级**——多版本并存不是优化，是前提。

---

## 9. 假设与信息缺口（务必先验证再引用）

| # | 缺口 | 本文处理 |
|---|---|---|
| A1 | 向量库类型、embedding 模型、chunk 大小与重叠 | **未编造**，§2.4.2 只给结构，标【推断】 |
| A2 | 检索融合的具体算法（RRF？加权？学习排序？） | 列为可选方案，未指定实现 |
| A3 | 上下文压缩的触发阈值与算法（摘要模型 / 滑动窗口） | 只描述可观察的七种外显手段 |
| A4 | 模型路由与选型策略（何时切小模型） | 未涉及，属未暴露能力 |
| A5 | `expert` / `quick` 模式的具体差异 | 标为推断 |
| A6 | 审计日志的写入范围为"全部动作"还是"敏感动作" | 只描述链式结构，不断言覆盖范围 |
| A7 | 多 Agent 团队的调度是集中式还是去中心 | 只描述消息与共享任务列表两种可见机制 |
| A8 | 评测集规模与指标定义 | 给出闸门结构，不给具体指标数值 |

---

## 附录 A：本机路径索引（Windows）

根目录：`C:\Users\qq940\.workbuddy\`

| 类别 | 路径 | 说明 |
|---|---|---|
| 会话 | `sessions\<pid>.json` | pid、sessionId、cwd、心跳、endpoint、App 版本（本机 2.176.0） |
| 轨迹 | `traces\<pid>\trace_<traceId>.jsonl` | OTel 语义 span 流 |
| 审计 | `audit-log\<date>.jsonl`、`audit-log\state.json`、`audit-log\spool\` | 链式哈希 + 分段 + 缓冲 |
| 日志 | `logs\main.log`、`renderer.log`、`daemon.log`、`mcp-apps-diag.log` | 分进程 |
| 提示词 | `plugins\cache\<market>\<plugin>\<version>\fragments\*.md` | 模式分片（6 个） |
| 技能 | `skills\<skill>\SKILL.md` + `scripts\` + `references\` | 用户级技能；项目级在 `<workspace>\.workbuddy\skills\` |
| 子 Agent | `plugins\cache\<market>\<plugin>\<version>\agents\*.md` | 角色定义 + `agents\references\` |
| 插件装配 | `plugins\installed_plugins.json`、`plugins\configured-plugins.json` | 版本与安装路径登记 |
| MCP | `mcp.json`（用户级）、`plugins\cache\...\<connector>\mcp.json`（连接器级） | `stdio` 与 `streamable-http` 两类 |
| 工具治理 | `mcp-tool-policy.json`、`mcp-approvals.json`、`mcp-tool-list.json` | 禁用表 / 审批记录 / 工具清单 |
| 记忆（用户级） | `user-<uid>-personal\MEMORY.md`、`SOUL.md`、`IDENTITY.md`、`USER.md` | 身份与长期规则 |
| 记忆（项目级） | `<workspace>\.workbuddy\memory\YYYY-MM-DD.md`、`MEMORY.md` | 追加式日志 + 长期笔记 |
| 产物 | `artifact-index\<uuid>.json`、`media-index\`、`file-history\` | 产物元数据 |
| 知识 | `knowledge-file-fingerprints\`、`knowledge-upload-tmp\` | 指纹去重 |
| 任务/计划 | `tasks\<uuid>\`、`todos\`、`plans\*.md` | 异步任务与计划态 |
| 持久库 | `workbuddy.db`（SQLite） | 结构化状态 |

---

## 附录 B：文件格式样例（本机实拍）

### B.1 插件清单 `plugins\cache\...\interactionmode-plan\<ver>\.workbuddy-plugin\plugin.json`

```json
{
  "name": "interactionmode-plan",
  "version": "5.11.3-wb.43806934.gecace0f7.ha395516167d4",
  "description": "WorkBuddy plan interaction mode fragment and tool policy.",
  "author": { "name": "WorkBuddy" },
  "category": "interaction",
  "keywords": ["workbuddy", "interaction", "plan"]
}
```

### B.2 MCP 配置 `~\.workbuddy\mcp.json`（两种传输并存）

```json
{
  "mcpServers": {
    "blender": {
      "command": "C:\\Users\\qq940\\anaconda3\\Scripts\\uvx.exe",
      "args": ["mcp-for-blender"]
    },
    "lighthouse-ops": {
      "type": "streamableHttp",
      "url": "https://lightai.cloud.tencent.com/workbuddy/mcp",
      "timeout": 30000,
      "disabled": false
    }
  }
}
```

连接器自带的清单额外带 `$schema`，便于静态校验：

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "ima-mcp": { "url": "https://ima.qq.com/mcp", "type": "streamable-http" }
  }
}
```

### B.3 技能 `SKILL.md` 头部

```markdown
---
name: skill-creator
description: Guide for creating effective skills. This skill should be used when
  users want to create a new skill (or update an existing skill) that extends
  Claude's capabilities with specialized knowledge, workflows, or tool
  integrations.
---

# Skill Creator

This skill provides guidance for creating effective skills.
```

> `description` 就是"路由键"——写不好这句，技能永远不会被正确触发。

### B.4 子 Agent `agents\doc-formatter.md` 头部（带 spec 追溯）

```markdown
---
name: doc-formatter
description: |
  文档美化子 Agent（Stage 2）。职责单一：把「具体内容」生成/美化为一份新的 HTML 版式…
category: agent
version: "4.1.0"
spec: [S-2605F42A7, S-26067CF39]
tags: [doc-formatting, pipeline, stage2, design-token, typeset, html-review]
---
```

### B.5 Trace 行（JSONL）

```json
{"type":"trace_start","trace":{"traceId":"trace_0cd702d86168441d92736060d1222d61","name":"Agent workflow","workerPid":10048,"startedAt":"2026-10-30T15:35:52.423Z","status":"running","spanCount":0,"totalTokens":0}}
{"type":"span_start","span":{"traceId":"trace_0cd…","spanId":"span_b88dd9a2993f4ae98d2a46e9","parentId":null,"name":"terminalTitleGenerator","type":"agent","status":"running","agentName":"terminalTitleGenerator"}}
```

### B.6 审计状态 `audit-log\state.json`（节选）

```json
{
  "sequence": 15989,
  "lastHash": "989f5f9b8648c2aa369ee2ae23bf79c1e6930996b5a52c7fa4ef06ffc481f988",
  "currentSegment": "2026-11-19.jsonl",
  "closedSegments": ["2026-06-18.jsonl", "2026-06-22.jsonl", "..."]
}
```

对应 segment 关闭事件：

```json
{"event":"segment-closed","segment":"2026-06-18.jsonl","entryCount":26,
 "firstHash":"4b56fde4…","lastHash":"b3c09c3f…","fileSha256":"fcebebe1…","timestamp":1782127650237}
```

---

## 附录 C：与项目既有文档的关系

| 文档 | 关系 |
|---|---|
| `01-认知框架/LLM-Agent-Harness-三层认知深度解读.md` | 认知总纲。本文是它在"工程实现"维度的展开，不重复三层定位论证 |
| `01-认知框架/Harness-详细设计与项目落地.md` | 个人储备 Harness（Python/FastAPI）设计。本文是**商业产品 Harness** 的逆向对照，两者可互证"机制同构" |
| `01-认知框架/Agent-Harness-LLM报文全链路拆解.md` | 报文级细节。本文 §3 只保留端到端步骤，报文交给该文 |
| `01-认知框架/AI治理与护栏-分层设计与上线准入清单.md` | 治理清单。本文 §4-6、§7.2 与其准入项对齐 |
| `02-平台工程/Dify快速深入指南.md` | 另一条技术路线（编排即平台）。对照点：Dify 把编排做进 DSL，WorkBuddy 把编排做进提示词 + 文件包 |
| `02-平台工程/WorkBuddy机制拆解-日常体验背后的工程决策.md` | **姊妹篇（解剖层）**：本篇讲"有哪些模块、落在哪"，那篇讲"为什么体验好、代价是什么"，含 12 条机制与实测数字（753 会话 / 86k of 300k 上下文 / 27,560 个工具 span） |

---

**文档结束。** 凡标【推断】的段落，落地前必须先做一次最小验证——毕竟"看起来合理"和"跑得起来"之间，隔着的通常是三个没被写下来的约束。
