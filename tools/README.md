# tools/

生成脚本集中地：仓库里所有「源文件 → 产物」的构建脚本都放在这里，产物不手工维护。

| 脚本 | 源 → 产物 |
|------|-----------|
| `md2html.py` | `banks/*.md` → 同名单文件 HTML（配色见脚本内 `TOPICS`，无参数运行即全量重生成） |
| `build_interview_collection.py` | `banks/` 全部题库 MD → `banks/面试背诵集合.html` |
| `build_ppt.js` | → `prep/06-演示材料/B2B技术经理-能力全景介绍.pptx` |
| `build_ppt_biz.js` | → `prep/06-演示材料/产品全业务链条与运营思路.pptx` |
| `build_customer_cases.js` | → `cases/customer-cases/B2B产品服务客户案例.pptx` |
| `md2docx.py` | `cases/bid-proposal/01-技术方案正文.md` → 同目录 `.docx` |

约定：

- 题库以 `.md` 为唯一源文件；`.html` 是生成物，可随时用脚本重建，不要手改
- JS 脚本依赖 `pptxgenjs`（`npm i pptxgenjs` 后运行）
- 2026-09 之前的 11 个按主题硬编码的 `gen_*.py` 已由 `md2html.py` 取代，旧脚本归档于 `_local-archive/_vendor-tools/scripts/`（不入库；目录沿用当时旧称 `_vendor-tools`，2026-10 更名本目录 `tools/`）
