# 面试工作台 interview-kit

B2B 技术经理求职材料库：八股题库、备战手册、实战案例、简历站点，入口为本地工作台。

- 入口：`index.html`（面试工作台 App）
- 启动：双击 `start.bat` → http://127.0.0.1:3003

## 目录

| 目录 | 内容 |
|------|------|
| `banks/` | 八股题库（MD 源 + 生成 HTML）+ `面试真题/` 各岗位真题（原 `face-exp/`） |
| `prep/` | 面试备战资料库：`00-全目录概览` + `01~08` 分类（备战 / 成长 / 架构 / 业务 / 工具排版 / 演示 / 职业 / 模拟面试） |
| `cases/` | 实战材料：`bid-proposal/` 投标技术方案、`customer-cases/` 客户案例 |
| `slides/` | 数字产业链服务平台 PPT 截图（169 页）+ 翻页器 `slides/index.html` |
| `resume/` | 简历与项目实战经验站点（浏览器打开 `resume/index.html`） |
| `tools/` | 全部生成脚本（题库 HTML / 背诵集合 / PPT / docx），用法见 `tools/README.md` |

## 边界

- AI 课程 / LLM 刷题 → `personal-tech-knowledge/ai-study/`
- 架构知识长文 → `personal-tech-knowledge/knowledge-base/`；项目叙事 → 本仓库 `resume/pages/work-experience/`
- 题库 HTML 由 `tools/md2html.py` 重建，源文件以 `.md` 为准
