# _vendor-tools

题库 HTML 生成脚本。输出目录统一为 `interview-kit/banks/`。

| 脚本 | 用途 |
|------|------|
| `md2html.py` | 通用渲染器：`interview-kit/banks/` 下任一题库 `.md` → 同名单文件 HTML（配色见脚本内 `TOPICS`）。无参数运行即全量重生成 |
| `build_interview_collection.py` | 聚合 banks/ 全部题库 MD → `banks/面试背诵集合.html` |

约定：

- `.md` 是唯一源文件；`.html` 是生成物，可随时用上述脚本重建，不要手改 HTML
- 2026-09 之前的 11 个按主题硬编码的 `gen_*.py` 已由 `md2html.py` 取代，旧脚本归档于 `_local-archive/_vendor-tools/scripts/`（不入库）
