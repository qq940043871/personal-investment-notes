#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""md2html.py — 面试题库 md → html 导出工具（md 为唯一事实源）。

用法:
    python tools/md2html.py <md路径> [<md路径> ...]   # 显式指定要导出的 md
    python tools/md2html.py                            # 缺省: 处理 03-技术真题/01-八股文与深度整理 下全部 14 对
    python tools/md2html.py --verify                   # 只做验证，不重写文件

两种版式（按旧 html 逆向）:
  * qa      —— 01~13: 章节(chapter) + 问答卡(qa)，hero/侧栏/计数。
  * article —— 16: h2/h3 文章流、.tw 表格、figure 原样透传（8 张 SVG 机制图）。

hero 文案(kicker/brand/hero p)与 <style> 从被覆盖前的旧 html 提取复用;
章节数/题数与 foot 计数按当前 md 解析结果重算; 旧 p 中的「本版改造…」等残留自动剥离;
md 头部引用块若未被旧 p 覆盖（如「与 xx 是同一批题目的两个版本」），自动补进 hero 描述。
"""

import re
import sys
import html as _html
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_DIR = REPO / "03-技术真题" / "01-八股文与深度整理"

QA_FILES = [
    "01-Java面试题深度整理", "02-Java深度八股文", "03-MySQL面试题深度整理",
    "04-MySQL八股文追问链", "05-Redis面试题深度整理", "06-Redis八股文追问链",
    "07-Nginx面试题深度整理", "08-Nginx深度八股文", "09-KafkaZookeeper深度八股文",
    "10-Linux面试题深度整理", "11-Tomcat面试题深度整理", "12-网络连接类型面试题深度整理",
    "13-网络连接类型八股文",
]
ARTICLE_FILES = ["16-五大中间件数据结构与算法全景"]

BANNED = ["整理时间", "真题来源", "口径标记", "反面教材", "本版改造", "口径红线"]
# 16 号文档中「历史反面教材 MMAPv1」是 MongoDB 存储引擎史的技术内容，非流程残留，允许保留。
BANNED_ALLOWED = ("历史反面教材",)

TAG_CLASS = {"高频": "hot", "必背": "hot", "进阶": "adv", "量级": "adv",
             "基础": "base", "中频": "base"}

# ---------------------------------------------------------------- 基础渲染

def esc(s: str) -> str:
    return _html.escape(s, quote=False)


def inline(s: str) -> str:
    """行内 md → html：先转义，再 **粗体**、`行内码`。"""
    s = esc(s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    return s


def inline_plain(s: str) -> str:
    """去掉 ** 与 ` 标记后转义（用于侧栏纯文本）。"""
    return esc(s.replace("**", "").replace("`", ""))


SQL_KW = ("SELECT FROM WHERE AND OR NOT NULL IS IN ON AS JOIN LEFT RIGHT INNER OUTER "
          "CROSS GROUP BY ORDER HAVING LIMIT OFFSET UNION ALL DISTINCT INSERT INTO VALUES "
          "UPDATE SET DELETE CREATE TABLE DATABASE SCHEMA INDEX VIEW PRIMARY KEY FOREIGN "
          "REFERENCES CONSTRAINT ALTER DROP TRUNCATE COMMIT ROLLBACK BEGIN START TRANSACTION "
          "IF EXISTS LIKE BETWEEN CASE WHEN THEN ELSE END ASC DESC ENGINE DEFAULT "
          "AUTO_INCREMENT CHARACTER CHARSET COLLATE SHOW EXPLAIN ANALYZE USE GRANT REVOKE "
          "PARTITION OVER ROWS FOR LOCK SHARE MODE DUPLICATE INTERVAL EXTRACT CHECK UNIQUE "
          "DECIMAL BIGINT VARCHAR DATETIME TIMESTAMP")
JAVA_KW = ("public private protected static final abstract class interface enum void int long "
           "short byte float double boolean char String Object Integer Long Boolean Double "
           "Float List Map Set HashMap ArrayList new return if else for while do switch case "
           "break continue default try catch finally throw throws synchronized volatile "
           "transient instanceof this super extends implements import package null true false "
           "assert record var")
EXTRA_KW = ("GET POST PUT DELETE HEAD OPTIONS PATCH HTTP HTTPS TCP UDP "
            "local function then end nil pairs ipairs require")

_KW_RE = re.compile(r"\b(?:%s)\b" % "|".join(
    sorted(set((SQL_KW + " " + JAVA_KW + " " + EXTRA_KW).split()), key=len, reverse=True)))
_NUM_RE = re.compile(r"\b\d+(?:\.\d+)?\b")
_TOKEN_RE = re.compile(
    r"(?P<cm><!--.*?(?:-->|$)|(?<!\S)/\*.*?(?:\*/|$)|(?<!\S)//.*$|(?<!\S)--.*$|(?<!\S)#.*$)"
    r"|(?P<st>'[^']*'|\"[^\"]*\")"
    r"|(?P<kw>%s)"
    r"|(?P<num>%s)" % (_KW_RE.pattern, _NUM_RE.pattern))


def _color_line(line: str, state: dict) -> str:
    out, pos = [], 0
    if state.get("cm"):                     # 处于多行 /* */ 或 <!-- --> 注释中
        close = "*/" if state.get("cm") == "block" else "-->"
        i = line.find(close)
        if i < 0:
            return '<span class="cm">%s</span>' % line
        out.append('<span class="cm">%s</span>' % line[:i + len(close)])
        pos = i + len(close)
        state["cm"] = None
    for m in _TOKEN_RE.finditer(line, pos):
        if m.start() > pos:
            out.append(line[pos:m.start()])
        kind = m.lastgroup
        tok = m.group()
        out.append('<span class="%s">%s</span>' % (kind, tok))
        if kind == "cm":
            if ("/*" in tok and "*/" not in tok) or (tok.startswith("<!--") and "-->" not in tok):
                state["cm"] = "block"
        pos = m.end()
    if pos < len(line):
        out.append(line[pos:])
    return "".join(out)


def code_block_html(lines):
    """``` 代码块 → <div class="code">，行间 <br>，注释/关键字/字符串/数字着色。

    着色用单趟词法切分（先注释、再字符串、再关键字、最后数字），
    生成的 span 属性不会被再次扫描，杜绝旧版 <span <span class="kw">class</span>="num"> 式嵌套损坏。
    """
    state = {}
    parts = []
    for ln in lines:
        parts.append(_color_line(esc(ln), state))
    return '<div class="code">%s</div>' % "<br>".join(parts)


# ---------------------------------------------------------------- md 解析

FENCE_RE = re.compile(r"^\s*(```|~~~)")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
HR_RE = re.compile(r"^\s*(-{3,}|\*{3,}|_{3,})\s*$")
QUOTE_RE = re.compile(r"^\s*>")
LIST_RE = re.compile(r"^(\s*)(?:([-*+])|(\d+)([.、)]))\s+(.*)$")
SEP_CELL_RE = re.compile(r"^:?-{2,}:?$")
LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")
LEAD_NUM_RE = re.compile(r"^(\d{1,3})(?:[、.．,)）]|\s+)\s*(.*)$")
RAW_BLOCK_TAGS = ("figure", "svg", "div", "table", "section", "pre", "details")


def strip_leading_emoji(t: str) -> str:
    """去掉章节标题开头的少量装饰符号（🔥 等），不动正文。"""
    m = re.match(r"^([^\w\u4e00-\u9fff]+)(\s*)(.*)$", t)
    if m and m.group(1) and not re.match(r"^\d", m.group(1)):
        return m.group(3)
    return t


def split_table_row(line: str):
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    cells, buf, in_code, i = [], [], False, 0
    while i < len(s):
        c = s[i]
        if c == "`":
            in_code = not in_code
            buf.append(c)
        elif c == "\\" and i + 1 < len(s) and s[i + 1] == "|":
            buf.append("|")
            i += 1
        elif c == "|" and not in_code:
            cells.append("".join(buf).strip())
            buf = []
        else:
            buf.append(c)
        i += 1
    cells.append("".join(buf).strip())
    return cells


def tokenize(md_text: str):
    """把 md 切成 token 流（fence 感知）。"""
    toks, i = [], 0
    lines = md_text.splitlines()
    while i < len(lines):
        line = lines[i]
        if FENCE_RE.match(line):
            i += 1
            buf = []
            while i < len(lines) and not FENCE_RE.match(lines[i]):
                buf.append(lines[i])
                i += 1
            i += 1  # 跳过收尾 ```
            toks.append(("code", buf))
            continue
        m = HEADING_RE.match(line)
        if m:
            toks.append(("h%d" % len(m.group(1)), m.group(2).strip()))
            i += 1
            continue
        if HR_RE.match(line) and not line.lstrip().startswith("|"):
            toks.append(("hr", None))
            i += 1
            continue
        if QUOTE_RE.match(line):
            paras, qlines, cur = [], [], []
            while i < len(lines) and QUOTE_RE.match(lines[i]):
                content = QUOTE_RE.sub("", lines[i], count=1)
                content = content[1:] if content.startswith(" ") else content
                if content.strip():
                    cur.append(content.rstrip())
                    qlines.append(content.strip())
                elif cur:
                    paras.append(" ".join(cur))
                    cur = []
                i += 1
            if cur:
                paras.append(" ".join(cur))
            toks.append(("quote", {"paras": paras, "lines": qlines}))
            continue
        if line.lstrip().startswith("|") and "|" in line.strip()[1:]:
            rows = []
            while i < len(lines) and lines[i].lstrip().startswith("|") and "|" in lines[i].strip()[1:]:
                rows.append(split_table_row(lines[i]))
                i += 1
            toks.append(("table", rows))
            continue
        first = line.strip()
        m2 = re.match(r"<(%s)\b" % "|".join(RAW_BLOCK_TAGS), first, re.I)
        if first.startswith("<") and m2:
            close_tag = "</%s>" % m2.group(1).lower()
            buf = [line]
            i += 1
            while i < len(lines) and close_tag not in lines[i].lower():
                buf.append(lines[i])
                i += 1
            if i < len(lines):
                buf.append(lines[i])
                i += 1
            toks.append(("raw", buf))
            continue
        m = LIST_RE.match(line)
        if m:
            items = []
            while i < len(lines):
                mm = LIST_RE.match(lines[i])
                if not mm:
                    break
                level = 2 if len(mm.group(1)) >= 2 else 1
                tag = "ul" if mm.group(2) else "ol"
                items.append((level, tag, mm.group(5)))
                i += 1
            toks.append(("list", items))
            continue
        if line.strip():
            toks.append(("p", line.strip()))
        i += 1
    return toks


def render_list(items, inline_fn):
    """两级列表 → <ul>/<ol>（带嵌套）。"""
    out, idx = [], 0

    def parse(level, tag):
        nonlocal idx
        lis = []
        while idx < len(items) and items[idx][0] == level and items[idx][1] == tag:
            text = items[idx][2]
            idx += 1
            sub = ""
            if idx < len(items) and items[idx][0] > level:
                sub, _ = parse(items[idx][0], items[idx][1])
            lis.append("<li>%s%s</li>" % (inline_fn(text), sub))
        return "<%s>%s</%s>" % (tag, "".join(lis), tag), idx

    while idx < len(items):
        frag, idx = parse(items[idx][0], items[idx][1])
        out.append(frag)
    return "".join(out)


def render_table(rows, inline_fn):
    if not rows:
        return ""
    body = []
    has_sep = len(rows) > 1 and all(SEP_CELL_RE.match(c) for c in rows[1] if c != "")
    for r_i, row in enumerate(rows):
        if has_sep and r_i == 1:
            continue
        kind = "th" if r_i == 0 else "td"
        cells = ["<%s>%s</%s>" % (kind, inline_fn(c), kind) for c in row]
        body.append("<tr>%s</tr>" % "".join(cells))
    return "<table>%s</table>" % "".join(body)


def render_body(tokens, article=False, inline_fn=None):
    """qa 正文 / article 正文通用渲染。"""
    if inline_fn is None:
        inline_fn = inline
    out = []
    for tok, val in tokens:
        if tok == "p":
            out.append("<p>%s</p>" % inline_fn(val))
        elif tok == "list":
            out.append(render_list(val, inline_fn))
        elif tok == "table":
            t = render_table(val, inline_fn)
            out.append('<div class="tw">%s</div>' % t if article else t)
        elif tok == "code":
            out.append(code_block_html(val) if not article
                       else "<pre><code>%s</code></pre>" % "<br>".join(esc(x) for x in val))
        elif tok == "quote":
            paras = val["paras"]
            if article:
                out.append("<blockquote>%s</blockquote>" % "".join(
                    "<p>%s</p>" % inline_fn(p) for p in paras))
            else:
                out.append('<div class="tip"><b>💡 </b>%s</div>' % "<br>".join(inline_fn(p) for p in paras))
        elif tok == "hr":
            if article:
                out.append("<hr>")
        elif tok == "raw":
            out.append("\n".join(val))
        elif tok == "h3" and article:
            out.append("<h3>%s</h3>" % inline_fn(val))
        elif tok == "h4" and article:
            out.append("<h4>%s</h4>" % inline_fn(val))
    return "".join(out)


# ---------------------------------------------------------------- 旧 html 提取

def scrub_copy(s: str) -> str:
    """剥离旧文案中的清理残留（本版改造… 等流程性标注）。"""
    s = re.sub(r"\s*本版改造.*$", "", s, flags=re.S)
    for term in BANNED:
        if term in BANNED_ALLOWED:
            continue
        if term in s:
            s = re.sub(r"[^。；;\n]*%s[^。；;\n]*[。；;]?" % term, "", s)
    return s.strip()


def extract_old(html_path: Path):
    d = {"css": "", "kicker": "Interview Deep-Dive", "brand_b": "", "brand_s": "",
         "hero_p": "", "meta_spans": [], "title_suffix": "", "old_h1": ""}
    if not html_path.exists():
        return d
    s = html_path.read_text(encoding="utf-8").replace("\r\n", "\n")
    m = re.search(r"<style>(.*?)</style>", s, re.S)
    d["css"] = m.group(1) if m else ""
    m = re.search(r'<div class="kicker">(.*?)</div>', s, re.S)
    if m:
        d["kicker"] = scrub_copy(m.group(1))
    m = re.search(r'<div class="brand">(.*?)</div>', s, re.S)
    if m:
        mb = re.search(r"<b>(.*?)</b>", m.group(1), re.S)
        ms = re.search(r"<span>(.*?)</span>", m.group(1), re.S)
        d["brand_b"] = mb.group(1) if mb else ""
        d["brand_s"] = ms.group(1) if ms else ""
    m = re.search(r'<header class="hero">.*?<h1>(.*?)</h1>\s*<p>(.*?)</p>', s, re.S)
    if m:
        d["old_h1"] = m.group(1)
        d["hero_p"] = scrub_copy(m.group(2))
    m = re.search(r'<div class="meta">(.*?)</div>\s*</header>', s, re.S)
    if m:
        d["meta_spans"] = re.findall(r"<span>(.*?)</span>", m.group(1))
    m = re.search(r"<title>(.*?)</title>", s, re.S)
    if m:
        old_title = m.group(1)
        if d["old_h1"] and old_title.startswith(d["old_h1"]):
            d["title_suffix"] = old_title[len(d["old_h1"]):]
    return d


# ---------------------------------------------------------------- 章节结构

def assign_nums(headings):
    """headings: [raw_text] → [(num, rest, id)]。编号取标题前导数字，
    无编号章节用顺延号；id = cNN（qa 模式）。"""
    taken, out = set(), []
    for raw in headings:
        t = strip_leading_emoji(raw)
        m = LEAD_NUM_RE.match(t)
        if m:
            num = m.group(1).zfill(2)
            taken.add(int(num))
            out.append([num, m.group(2).strip(), raw])
        else:
            out.append([None, t, raw])
    nxt = 1
    for row in out:
        if row[0] is None:
            while nxt in taken:
                nxt += 1
            row[0] = str(nxt).zfill(2)
            taken.add(nxt)
    return [(num, rest, "c" + num) for num, rest, _ in out]


def slugify(t: str) -> str:
    t = t.strip().lower()
    t = re.sub(r"[^\w\u4e00-\u9fff\- ]+", "", t, flags=re.UNICODE)
    return re.sub(r"\s+", "-", t)


_STRIP_SYNC_RE = re.compile(r"[\s*`\d]+")


def _sync_line(old_p: str, ln: str):
    """旧 p 里某句只有数字过期（如题数 70 → 72）时，原位替换为 md 版本。
    匹配基于去掉空白/加粗/反引号/数字后的文本，替换保留原文其余部分。"""
    n2c, idx = [], []
    for i, ch in enumerate(old_p):
        if not _STRIP_SYNC_RE.match(ch):
            n2c.append(ch)
            idx.append(i)
    n2 = "".join(n2c)
    l2 = _STRIP_SYNC_RE.sub("", ln)
    pos = n2.find(l2)
    if pos < 0 or not l2:
        return None
    start = idx[pos]
    end = idx[pos + len(l2) - 1] + 1
    return old_p[:start] + ln + old_p[end:]


def make_inline_linker(slug_map):
    """article 版式行内渲染: 支持 [文字](#锚点) 解析到章节 id。"""
    def inline_a(s: str) -> str:
        store = []

        def stash(m):
            text, target = m.group(1), m.group(2)
            if target.startswith("#"):
                sid = slug_map.get(slugify(target[1:]))
                href = "#" + sid if sid else target
            else:
                href = target
            store.append((href, text))
            return "\x00%d\x01" % (len(store) - 1)

        s = LINK_RE.sub(stash, s)
        s = inline(s)
        for i, (href, text) in enumerate(store):
            s = s.replace("\x00%d\x01" % i, '<a href="%s">%s</a>' % (esc(href), inline(text)))
        return s
    return inline_a


# ---------------------------------------------------------------- qa 版式

def build_qa(md_text: str, old: dict) -> str:
    toks = tokenize(md_text)
    h1 = ""
    head_lines = []
    chapters, cur_ch, cur_qa = [], None, None

    for tok, val in toks:
        if tok == "h1":
            h1 = val
        elif tok == "h2":
            cur_ch = {"title": val, "qas": [], "lead": []}
            chapters.append(cur_ch)
            cur_qa = None
        elif tok == "h3":
            if cur_ch is None:
                cur_ch = {"title": "未分章", "qas": [], "lead": []}
                chapters.append(cur_ch)
            tags = re.findall(r"【([^】]+)】", val)
            qtext = re.sub(r"【[^】]+】", "", val).strip()
            cur_qa = {"q": qtext, "tags": tags, "body": []}
            cur_ch["qas"].append(cur_qa)
        elif tok == "h4":
            if cur_qa is not None:
                cur_qa["body"].append(("p", "**%s**" % val))
            elif cur_ch is not None:
                cur_qa = {"q": val, "tags": [], "body": []}
                cur_ch["qas"].append(cur_qa)
        elif tok == "quote" and cur_ch is None:
            head_lines.extend(val["lines"])
        elif cur_qa is not None:
            cur_qa["body"].append((tok, val))
        elif cur_ch is not None and tok != "hr":
            cur_ch["lead"].append((tok, val))
        elif tok == "quote":
            head_lines.extend(val["lines"])

    nums = assign_nums([c["title"] for c in chapters])

    # ---- hero 描述: 旧 html 文案为主; md 头部引用块逐句比对,
    #      未被旧 p 覆盖的句子补入; 仅数字漂移的句子（如旧 p 里过期的题数）原位同步
    norm = lambda s: re.sub(r"[\s*`]+", "", s)
    norm2 = lambda s: re.sub(r"[\s*`\d]+", "", s)
    old_p = _html.unescape(old.get("hero_p", "")) or " ".join(head_lines)
    extras = []
    for ln in head_lines:
        if norm(ln) and norm(ln) in norm(old_p):
            continue
        if norm2(ln) and norm2(ln) in norm2(old_p):
            synced = _sync_line(old_p, ln)
            if synced is not None:
                old_p = synced
                continue
        extras.append(ln)
    hero_p = old_p + ((" " + " ".join(extras)) if extras else "")

    n_ch, n_q = len(chapters), sum(len(c["qas"]) for c in chapters)

    # ---- meta: 旧 span 结构保留, 仅重算章/题计数
    spans = []
    for sp in old.get("meta_spans") or ["📚 %d 章节", "❓ %d 题"]:
        sp2 = re.sub(r"^(\D*?)\d+(\s*章节)$", lambda m, n=n_ch: "%s%d%s" % (m.group(1), n, m.group(2)), sp)
        sp2 = re.sub(r"^(\D*?)\d+(\s*题)$", lambda m, n=n_q: "%s%d%s" % (m.group(1), n, m.group(2)), sp2)
        spans.append(sp2)
    meta_html = "".join("<span>%s</span>" % esc(sp) for sp in spans)

    title = esc(h1 + old.get("title_suffix", ""))

    parts = []
    parts.append("<!DOCTYPE html>")
    parts.append('<html lang="zh-CN">')
    parts.append("<head>")
    parts.append('<meta charset="UTF-8">')
    parts.append('<meta name="viewport" content="width=device-width, initial-scale=1.0">')
    parts.append("<title>%s</title>" % title)
    parts.append("<style>%s</style>" % old.get("css", ""))
    parts.append("</head>")
    parts.append("<body>")
    parts.append('<div class="layout">')
    aside = ['<aside><div class="brand"><b>%s</b><span>%s</span></div>' % (old.get("brand_b", ""), old.get("brand_s", ""))]
    for (num, rest, cid), ch in zip(nums, chapters):
        aside.append('<a class="ch" href="#%s">%s %s</a>' % (cid, num, inline_plain(rest)))
    aside.append("</aside>")
    parts.append("\n".join(aside))
    parts.append("<main>")
    parts.append('<header class="hero"><div class="kicker">%s</div><h1>%s</h1><p>%s</p><div class="meta">%s</div></header>'
                 % (esc(old.get("kicker", "")), esc(h1), esc(hero_p), meta_html))
    for (num, rest, cid), ch in zip(nums, chapters):
        parts.append('<section class="chapter" id="%s"><h2><span class="num">%s</span> %s</h2>'
                     % (cid, num, inline(rest)))
        parts.append(render_body(ch["lead"]))
        for qa in ch["qas"]:
            tag_html = "".join('<span class="tag %s">%s</span>' % (TAG_CLASS.get(t, "base"), esc(t))
                               for t in qa["tags"])
            body = render_body(qa["body"])
            parts.append('<div class="qa"><div class="q">%s%s</div><div class="a">%s</div></div>'
                         % (esc(qa["q"]), tag_html, body))
        parts.append("</section>")
    parts.append('<div class="foot">%s · 共 %d 章 %d 题 · 由 tools/md2html.py 生成</div>'
                 % (esc(h1), n_ch, n_q))
    parts.append("</main>")
    parts.append("</div>")
    parts.append("</body>")
    parts.append("</html>")
    return "\n".join(parts) + "\n"


# ---------------------------------------------------------------- article 版式

def build_article(md_text: str, old: dict) -> str:
    toks = tokenize(md_text)
    h1 = ""
    head_paras = []
    head_extra = []
    sections, cur = [], None
    for tok, val in toks:
        if tok == "h1":
            h1 = val
        elif tok == "h2":
            cur = {"title": val, "body": []}
            sections.append(cur)
        elif tok == "quote" and cur is None:
            head_paras.extend(val["paras"])
        elif cur is None:
            head_extra.append((tok, val))
        else:
            cur["body"].append((tok, val))

    ids, pos = [], 0
    for s in sections:
        t = strip_leading_emoji(s["title"])
        m = LEAD_NUM_RE.match(t)
        if m:
            ids.append("sec-" + m.group(1).zfill(2))
        else:
            ids.append("sec-x%d" % pos)
        pos += 1

    slug_map = {slugify(strip_leading_emoji(s["title"])): sid
                for s, sid in zip(sections, ids)}
    inline_a = make_inline_linker(slug_map)

    n_ch = len(sections)
    n_q = sum(1 for s in sections for tok, _ in s["body"] if tok == "h3")

    spans = []
    for sp in old.get("meta_spans") or ["%d 章节"]:
        sp2 = re.sub(r"^(\D*?)\d+(\s*章节)$", lambda m, n=n_ch: "%s%d%s" % (m.group(1), n, m.group(2)), sp)
        sp2 = re.sub(r"^(\D*?)\d+(\s*题)$", lambda m, n=n_q: "%s%d%s" % (m.group(1), n, m.group(2)), sp2)
        spans.append(sp2)
    meta_html = "".join("<span>%s</span>" % esc(sp) for sp in spans)

    title = esc(h1 + old.get("title_suffix", ""))

    parts = []
    parts.append("<!DOCTYPE html>")
    parts.append('<html lang="zh-CN">')
    parts.append("<head>")
    parts.append('<meta charset="UTF-8">')
    parts.append('<meta name="viewport" content="width=device-width, initial-scale=1.0">')
    parts.append("<title>%s</title>" % title)
    parts.append("<style>%s</style>" % old.get("css", ""))
    parts.append("</head>")
    parts.append("<body>")
    parts.append('<div class="layout">')
    aside = ['<aside><div class="brand"><b>%s</b><span>%s</span></div>' % (old.get("brand_b", ""), old.get("brand_s", ""))]
    for sid, s in zip(ids, sections):
        aside.append('<a class="ch" href="#%s">%s</a>' % (sid, inline_plain(strip_leading_emoji(s["title"]))))
    aside.append("</aside>")
    parts.append("\n".join(aside))
    parts.append("<main>")
    parts.append('<header class="hero"><div class="kicker">%s</div>\n<h1>%s</h1><p>%s</p>\n<div class="meta">%s</div>\n</header>'
                 % (esc(old.get("kicker", "")), esc(h1), esc(_html.unescape(old.get("hero_p", ""))), meta_html))
    if head_paras:
        parts.append("<blockquote>%s</blockquote>" % "".join(
            "<p>%s</p>" % inline_a(p) for p in head_paras))
    parts.append(render_body(head_extra, article=True, inline_fn=inline_a))
    for sid, s in zip(ids, sections):
        parts.append('<h2 id="%s">%s</h2>' % (sid, inline_a(strip_leading_emoji(s["title"]))))
        parts.append(render_body(s["body"], article=True, inline_fn=inline_a))
    parts.append('<div class="foot">%s · 共 %d 章 %d 题 · 由 tools/md2html.py 生成</div>'
                 % (esc(h1), n_ch, n_q))
    parts.append("</main>")
    parts.append("</div>")
    parts.append("</body>")
    parts.append("</html>")
    return "\n".join(parts) + "\n"


# ---------------------------------------------------------------- 主流程

def count_md_structure(md_text: str):
    """fence 感知地数 md 的二级/三级标题。"""
    n2 = n3 = 0
    in_fence = False
    for line in md_text.splitlines():
        if FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m = HEADING_RE.match(line)
        if m:
            if len(m.group(1)) == 2:
                n2 += 1
            elif len(m.group(1)) == 3:
                n3 += 1
    return n2, n3


def convert(md_path: Path, write=True):
    md_text = md_path.read_text(encoding="utf-8")
    html_path = md_path.with_suffix(".html")
    old = extract_old(html_path)
    name = md_path.stem
    article = any(name.startswith(p) for p in ARTICLE_FILES)
    doc = build_article(md_text, old) if article else build_qa(md_text, old)
    if write:
        html_path.write_text(doc, encoding="utf-8", newline="\n")
    n2, n3 = count_md_structure(md_text)
    h2 = doc.count("<h2 id=") if article else doc.count('<section class="chapter"')
    h3 = doc.count("<h3>") if article else doc.count('<div class="qa">')
    return {"name": name, "mode": "article" if article else "qa", "md_ch": n2, "html_ch": h2,
            "md_q": n3, "html_q": h3, "ok": (n2 == h2 and n3 == h3), "path": html_path}


VOID_TAGS = {"meta", "br", "hr", "img", "link", "input", "path", "rect", "circle", "line",
             "polygon", "polyline", "ellipse"}
TAG_EV_RE = re.compile(r"</?([a-zA-Z][a-zA-Z0-9]*)((?:[^>\"]|\"[^\"]*\")*)>")


def check_html(s: str):
    errs = []
    for term in BANNED:
        n = s.count(term)
        if term == "反面教材":
            n -= sum(s.count(a) for a in BANNED_ALLOWED)
        if n > 0:
            errs.append("残留 %s×%d" % (term, n))
    if re.search(r"<span\s+<span", s):
        errs.append("span 嵌套损坏")
    stack = []
    for ev in TAG_EV_RE.finditer(s):
        tag, attr = ev.group(1).lower(), ev.group(2)
        closing = ev.group(0).startswith("</")
        if tag in VOID_TAGS:
            continue
        if attr.rstrip().endswith("/"):
            continue
        if closing:
            if not stack or stack[-1] != tag:
                errs.append("标签不闭合: </%s> (栈顶=%s)" % (tag, stack[-1] if stack else "空"))
                return errs
            stack.pop()
        else:
            stack.append(tag)
    if stack:
        errs.append("未闭合标签: %s" % stack[-4:])
    return errs


def verify(paths):
    print("\n== 验证 ==")
    all_pass = True
    for p in paths:
        html_path = p.with_suffix(".html")
        if not html_path.exists():
            print("[MISS] %s" % html_path.name)
            all_pass = False
            continue
        s = html_path.read_text(encoding="utf-8")
        errs = check_html(s)
        if errs:
            all_pass = False
            print("[FAIL] %-44s %s" % (html_path.name, "; ".join(errs)))
        else:
            print("[OK]   %s" % html_path.name)
    return all_pass


def main(argv):
    if "--verify" in argv:
        argv.remove("--verify")
        write = False
    else:
        write = True
    if argv:
        paths = [Path(a) if Path(a).is_absolute() else REPO / a for a in argv]
    else:
        paths = [DEFAULT_DIR / (n + ".md") for n in QA_FILES + ARTICLE_FILES]
    rows = []
    for p in paths:
        if not p.exists():
            print("[SKIP] 不存在: %s" % p)
            continue
        rows.append(convert(p, write=write))
    print("%-44s %-8s %6s %6s %6s %6s  %s" % ("文件", "模式", "md章", "html章", "md题", "html题", "对账"))
    for r in rows:
        print("%-44s %-8s %6d %6d %6d %6d  %s" % (r["name"], r["mode"], r["md_ch"], r["html_ch"],
                                                  r["md_q"], r["html_q"], "PASS" if r["ok"] else "FAIL"))
    ok = all(r["ok"] for r in rows)
    if write:
        ok = verify(paths) and ok
    print("\n总计: %d 个文件, 全部一致: %s" % (len(rows), "是" if ok else "否"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
