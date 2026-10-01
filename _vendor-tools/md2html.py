# -*- coding: utf-8 -*-
"""interview-kit/banks 题库 Markdown → 单文件 HTML 通用渲染器。

用法：
    python md2html.py                 # 按 TOPICS 渲染 banks/ 下全部已配置主题
    python md2html.py Redis八股文追问链.md   # 只渲染指定文件（须在 TOPICS 中登记配色）

MD 结构约定：`#` 总标题 / `##` 章节 / `###` 题目（可含【高频】【进阶】【基础】标签）。
_html 是生成物，源文件始终以 .md 为准（见仓库根 CLAUDE.md）。
"""
import os
import re
import html
import io
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANKS = os.path.join(ROOT, "interview-kit", "banks")

# 各题库配色（brand / brand2 / hero 渐变起止），未登记文件用 DEFAULT
DEFAULT = {"brand": "#2563eb", "brand2": "#1d4ed8", "hero1": "#1e3a8a", "hero2": "#2563eb", "hero3": "#1d4ed8",
           "brand_name": "全栈八股文题库", "brand_sub": "深度整理 · 考点全覆盖"}
TOPICS = {
    "Java深度八股文.md":          {"brand": "#dc2626", "brand2": "#b91c1c", "hero1": "#7f1d1d", "hero2": "#dc2626", "hero3": "#b91c1c", "brand_name": "Java 八股文题库", "brand_sub": "考前背诵版 · 11 板块"},
    "Java面试题深度整理.md":      {"brand": "#dc2626", "brand2": "#b91c1c", "hero1": "#7f1d1d", "hero2": "#dc2626", "hero3": "#b91c1c", "brand_name": "Java 面试题库", "brand_sub": "深度整理 · 12 章节"},
    "MySQL八股文追问链.md":       {"brand": "#0f766e", "brand2": "#115e59", "hero1": "#134e4a", "hero2": "#0f766e", "hero3": "#115e59", "brand_name": "MySQL 题库", "brand_sub": "追问链冲刺版"},
    "MySQL面试题深度整理.md":     {"brand": "#0f766e", "brand2": "#115e59", "hero1": "#134e4a", "hero2": "#0f766e", "hero3": "#115e59", "brand_name": "MySQL 题库", "brand_sub": "深度整理"},
    "Redis八股文追问链.md":       {"brand": "#b45309", "brand2": "#92400e", "hero1": "#78350f", "hero2": "#b45309", "hero3": "#92400e", "brand_name": "Redis 题库", "brand_sub": "追问链冲刺版"},
    "Redis面试题深度整理.md":     {"brand": "#b45309", "brand2": "#92400e", "hero1": "#78350f", "hero2": "#b45309", "hero3": "#92400e", "brand_name": "Redis 题库", "brand_sub": "深度整理"},
    "Nginx深度八股文.md":         {"brand": "#059669", "brand2": "#047857", "hero1": "#064e3b", "hero2": "#059669", "hero3": "#047857", "brand_name": "Nginx 题库", "brand_sub": "考前背诵版"},
    "Nginx面试题深度整理.md":     {"brand": "#059669", "brand2": "#047857", "hero1": "#064e3b", "hero2": "#059669", "hero3": "#047857", "brand_name": "Nginx 题库", "brand_sub": "深度整理"},
    "Tomcat面试题深度整理.md":    {"brand": "#d97706", "brand2": "#b45309", "hero1": "#78350f", "hero2": "#d97706", "hero3": "#b45309", "brand_name": "Tomcat 题库", "brand_sub": "深度整理"},
    "Linux面试题深度整理.md":     {"brand": "#4338ca", "brand2": "#3730a3", "hero1": "#312e81", "hero2": "#4338ca", "hero3": "#3730a3", "brand_name": "Linux 题库", "brand_sub": "深度整理"},
    "KafkaZookeeper深度八股文.md": {"brand": "#be185d", "brand2": "#9d174d", "hero1": "#831843", "hero2": "#be185d", "hero3": "#9d174d", "brand_name": "MQ 题库", "brand_sub": "Kafka / ZooKeeper 背诵版"},
    "网络连接类型八股文.md":       {"brand": "#0369a1", "brand2": "#075985", "hero1": "#0c4a6e", "hero2": "#0369a1", "hero3": "#075985", "brand_name": "网络题库", "brand_sub": "连接类型背诵版"},
    "网络连接类型面试题深度整理.md": {"brand": "#0369a1", "brand2": "#075985", "hero1": "#0c4a6e", "hero2": "#0369a1", "hero3": "#075985", "brand_name": "网络题库", "brand_sub": "连接类型深度整理"},
}

TAG_MAP = {"高频": "hot", "进阶": "adv", "基础": "base"}
KEYWORDS = ("class", "interface", "new", "return", "if", "else", "for", "while", "switch", "case",
            "public", "private", "protected", "static", "final", "void", "int", "long", "boolean",
            "String", "Object", "this", "super", "null", "true", "false", "try", "catch", "finally",
            "throw", "throws", "synchronized", "volatile", "extends", "implements", "import",
            "SELECT", "FROM", "WHERE", "JOIN", "GROUP", "ORDER", "INSERT", "UPDATE", "DELETE",
            "BEGIN", "COMMIT", "ROLLBACK", "GET", "POST", "PUT", "DELETE", "HTTP", "TCP", "UDP")

CSS_TMPL = """
  :root{--bg:#f5f7fb;--card:#fff;--ink:#1f2937;--muted:#6b7280;--line:#e5e7eb;
    --brand:%(brand)s;--brand2:%(brand2)s;--accent:#f59e0b;--code-bg:#111827;--code-ink:#e5e7eb;
    --green:#059669;--red:#dc2626;--amber:#d97706;}
  *{box-sizing:border-box;margin:0;padding:0} html{scroll-behavior:smooth}
  body{font-family:"PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif;background:var(--bg);color:var(--ink);line-height:1.75;font-size:15px}
  .layout{display:flex;max-width:1440px;margin:0 auto}
  aside{width:280px;flex-shrink:0;position:sticky;top:0;height:100vh;overflow-y:auto;padding:24px 18px 40px;border-right:1px solid var(--line);background:var(--card)}
  aside h2{font-size:14px;color:var(--brand);margin:18px 0 8px;letter-spacing:.5px}
  aside a{display:block;color:var(--muted);text-decoration:none;font-size:13px;padding:4px 10px;border-radius:6px;transition:.15s}
  aside a:hover{color:var(--brand);background:#f1f5f9}
  aside a.ch{font-weight:600;color:var(--ink);margin-top:6px}
  aside .brand{margin-bottom:6px} aside .brand b{font-size:16px} aside .brand span{font-size:12px;color:var(--muted);display:block}
  main{flex:1;min-width:0;padding:0 42px 80px}
  header.hero{background:linear-gradient(135deg,%(hero1)s 0%%,%(hero2)s 45%%,%(hero3)s 100%%);color:#fff;border-radius:0 0 24px 24px;padding:48px 42px 40px;margin:0 -42px 36px}
  header.hero .kicker{font-size:13px;letter-spacing:3px;opacity:.8;text-transform:uppercase}
  header.hero h1{font-size:34px;margin:10px 0 8px;letter-spacing:1px}
  header.hero p{font-size:15px;opacity:.92;max-width:820px}
  header.hero .meta{margin-top:18px;display:flex;gap:12px;flex-wrap:wrap}
  header.hero .meta span{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.25);padding:4px 14px;border-radius:999px;font-size:13px}
  .chapter{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px 30px;margin-bottom:26px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
  .chapter>h2{font-size:22px;color:var(--brand);margin-bottom:4px;display:flex;align-items:center;gap:10px}
  .chapter>h2 .num{background:linear-gradient(135deg,var(--brand),var(--brand2));color:#fff;width:34px;height:34px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0}
  .qa{background:#fafbfe;border:1px solid var(--line);border-left:4px solid var(--brand);border-radius:10px;padding:18px 20px 16px;margin-bottom:16px}
  .qa .q{font-weight:700;font-size:15.5px;margin-bottom:8px;display:flex;align-items:flex-start;gap:8px}
  .qa .q::before{content:"Q";background:var(--brand);color:#fff;font-size:12px;width:20px;height:20px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:3px}
  .qa .a{font-size:14.5px} .qa .a p{margin-bottom:8px} .qa .a ul,.qa .a ol{margin:6px 0 8px 22px} .qa .a li{margin-bottom:4px}
  .tag{display:inline-block;font-size:11.5px;padding:1px 9px;border-radius:999px;margin-left:8px;vertical-align:2px;font-weight:600}
  .tag.hot{background:#fee2e2;color:var(--red)} .tag.adv{background:#fef3c7;color:#b45309} .tag.base{background:#f1f5f9;color:#475569}
  .code{background:var(--code-bg);color:var(--code-ink);border-radius:8px;padding:14px 16px;margin:10px 0;font-family:"JetBrains Mono","Cascadia Code",Consolas,monospace;font-size:13px;line-height:1.6;overflow-x:auto}
  .code .cm{color:#64748b} .code .kw{color:#fca5a5} .code .st{color:#86efac} .code .num{color:#fbbf24}
  table{border-collapse:collapse;width:100%%;margin:12px 0;font-size:13.5px}
  th{background:#f1f5f9;color:#334155;text-align:left;padding:8px 12px;border:1px solid var(--line);font-weight:600}
  td{padding:7px 12px;border:1px solid var(--line);vertical-align:top} tr:nth-child(even) td{background:#f9fafb}
  .tip{background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:10px 14px;font-size:13.5px;margin:10px 0}
  .tip b{color:var(--green)}
  .foot{text-align:center;color:var(--muted);font-size:13px;padding:20px 0 40px}
  @media (max-width:960px){aside{display:none}main{padding:0 16px 60px}header.hero{margin:0 -16px 24px;padding:36px 24px}}
  @media print{aside{display:none}header.hero{margin:0;border-radius:0}.chapter{break-inside:avoid}}
"""

esc = lambda s: html.escape(s, quote=False)


def inline(s):
    s = esc(s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    return s


def code_hl(code):
    out = []
    for ln in code.split("\n"):
        if not ln.strip():
            out.append("<br>")
            continue
        m = re.search(r"(\s*)((?:--|#|//)\s.*)$", ln)
        body, cm = ln, ""
        if m:
            body = ln[: m.start(2)]
            cm = m.group(2)
        body = esc(body)
        body = re.sub(r'("(?:\\.|[^"\\])*")', r'<span class="st">\1</span>', body)
        body = re.sub(r"(\b\d+(?:\.\d+)?\b)", r'<span class="num">\1</span>', body)
        for kw in KEYWORDS:
            body = re.sub(r"(?<![A-Za-z0-9_])" + re.escape(kw) + r"(?![A-Za-z0-9_])",
                          r'<span class="kw">\g<0></span>', body)
        out.append(body + ('<span class="cm">%s</span>' % esc(cm) if cm else ""))
    return "<br>".join(out)


def parse_table(rows):
    rows = [r.strip().strip("|") for r in rows]
    cells = [[c.strip() for c in r.split("|")] for r in rows]
    cells = [r for r in cells if not all(re.fullmatch(r":?-{3,}:?", c) for c in r)]
    if not cells:
        return ""
    h = "<table><tr>" + "".join("<th>%s</th>" % inline(c) for c in cells[0]) + "</tr>"
    for r in cells[1:]:
        h += "<tr>" + "".join("<td>%s</td>" % inline(c) for c in r) + "</tr>"
    return h + "</table>"


def render(raw, cfg):
    chapters, hero_title, hero_desc = [], "", ""
    cur_ch = cur_qa = None
    lines = raw.split("\n")
    i, qa_count = 0, 0
    while i < len(lines):
        ln = lines[i]
        if ln.startswith("# "):
            hero_title = ln[2:].strip()
        elif ln.startswith("> ") and cur_ch is None:
            hero_desc += " " + ln[2:].strip()
        elif ln.startswith("## "):
            title = ln[3:].strip()
            m = re.match(r"(\d+)[\s·｜|]*(.*)", title)
            num = m.group(1) if m else str(len(chapters) + 1)
            name = m.group(2).strip() if m and m.group(2).strip() else title
            cur_ch = {"id": "c%s" % num, "num": num, "name": name, "qas": []}
            chapters.append(cur_ch)
            cur_qa = None
        elif cur_ch is not None and ln.startswith("### "):
            qa_count += 1
            q = ln[4:].strip()
            tags = re.findall(r"【(高频|进阶|基础)】", q)
            q_clean = re.sub(r"【(高频|进阶|基础)】", "", q).strip()
            q_html = inline(q_clean)
            q_html += "".join('<span class="tag %s">%s</span>' % (TAG_MAP[t], t) for t in tags)
            cur_qa = {"q": q_html, "a": []}
            cur_ch["qas"].append(cur_qa)
        elif cur_qa is not None:
            if ln.startswith("|"):
                tbl = []
                while i < len(lines) and lines[i].startswith("|"):
                    tbl.append(lines[i]); i += 1
                cur_qa["a"].append(parse_table(tbl))
                continue
            if ln.startswith("```"):
                i += 1
                buf = []
                while i < len(lines) and not lines[i].startswith("```"):
                    buf.append(lines[i]); i += 1
                i += 1
                cur_qa["a"].append('<div class="code">%s</div>' % code_hl("\n".join(buf)))
                continue
            if ln.startswith(">"):
                tips = []
                while i < len(lines) and lines[i].startswith(">"):
                    tips.append(inline(lines[i][1:].strip())); i += 1
                cur_qa["a"].append('<div class="tip"><b>💡 </b>%s</div>' % "<br>".join(tips))
                continue
            if re.match(r"^\s*[-*] ", ln):
                items = []
                while i < len(lines) and re.match(r"^\s*[-*] ", lines[i]):
                    items.append("<li>%s</li>" % inline(re.sub(r"^\s*[-*]\s+", "", lines[i]))); i += 1
                cur_qa["a"].append("<ul>%s</ul>" % "".join(items))
                continue
            if re.match(r"^\s*\d+\. ", ln):
                items = []
                while i < len(lines) and re.match(r"^\s*\d+\. ", lines[i]):
                    items.append("<li>%s</li>" % inline(re.sub(r"^\s*\d+\.\s+", "", lines[i]))); i += 1
                cur_qa["a"].append("<ol>%s</ol>" % "".join(items))
                continue
            if ln.strip() and ln.strip() != "---" and not ln.startswith(("#", "```")):
                cur_qa["a"].append("<p>%s</p>" % inline(ln.strip()))
        i += 1

    aside = ['<aside><div class="brand"><b>📚 %s</b><span>%s</span></div>' % (cfg["brand_name"], cfg["brand_sub"])]
    body = ['<header class="hero"><div class="kicker">Interview Deep-Dive</div>',
            "<h1>%s</h1>" % esc(hero_title),
            "<p>%s</p>" % esc(hero_desc.strip()),
            '<div class="meta"><span>📚 %d 章节</span><span>❓ %d 题</span></div></header>' % (len(chapters), qa_count)]
    for ch in chapters:
        aside.append('<a class="ch" href="#%s">%s %s</a>' % (ch["id"], ch["num"], esc(ch["name"])))
        body.append('<section class="chapter" id="%s"><h2><span class="num">%s</span> %s</h2>' % (ch["id"], ch["num"], esc(ch["name"])))
        for qa in ch["qas"]:
            body.append('<div class="qa"><div class="q">%s</div><div class="a">%s</div></div>'
                        % (qa["q"], "".join(qa["a"])))
        body.append("</section>")
    aside.append("</aside>")
    body.append('<div class="foot">%s · 共 %d 章 %d 题 · 由 _vendor-tools/md2html.py 生成</div>'
                % (esc(hero_title), len(chapters), qa_count))
    return CSS_TMPL % cfg, "".join(aside), "".join(body)


def convert(name):
    cfg = TOPICS.get(name, DEFAULT)
    src = os.path.join(BANKS, name)
    dst = os.path.join(BANKS, os.path.splitext(name)[0] + ".html")
    with io.open(src, encoding="utf-8") as f:
        raw = f.read()
    css, aside, body = render(raw, cfg)
    doc = ("<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"UTF-8\">\n"
           "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n"
           "<title>%s · 全栈架构师</title>\n<style>%s</style>\n</head>\n<body>\n"
           '<div class="layout">\n%s\n<main>\n%s\n</main>\n</div>\n</body>\n</html>'
           % (esc(re.sub(r"^#\s*", "", raw.split("\n")[0]) or name), css, aside, body))
    with io.open(dst, "w", encoding="utf-8", newline="\n") as f:
        f.write(doc)
    print("OK", name, "->", os.path.relpath(dst, ROOT))


if __name__ == "__main__":
    targets = sys.argv[1:] or sorted(TOPICS)
    missing = [t for t in targets if not os.path.exists(os.path.join(BANKS, t))]
    for m in missing:
        print("SKIP(未找到 MD):", m)
    for t in targets:
        if t not in missing:
            convert(t)
