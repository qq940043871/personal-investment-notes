#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
pptx2html.py —— 把 .pptx 转成连续阅读流的 .html 派生件

用途：本仓库的 *.pptx 是演示源件，浏览器无法直接预览。
     本脚本按「位置 + 字号」还原标题层级、列表、表格与分栏，
     输出可滚动、可全文搜索、可打印的单文件 HTML。

用法：
    python pptx2html.py                # 转换全部已登记的 pptx
    python pptx2html.py --force        # 覆盖已存在的 html
    python pptx2html.py <某个.pptx>     # 只转指定文件
"""
import argparse
import html
import os
import re
import sys
import zipfile

from pptx import Presentation
from pptx.util import Emu

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 需转换的源件（相对 prep/）
TARGETS = [
    "03-客户案例/02-数字产业链服务平台-含痛点方案.pptx",
    "03-客户案例/04-B2B技术经理-能力全景介绍.pptx",
    "03-客户案例/05-B2B产品服务客户案例.slides.pptx",
    "04-架构决策/生产问题排查/07-Cookie认证失败-5Why根因分析.slides.pptx",
]

PAGENUM_RE = re.compile(r"^\s*\d+\s*/\s*\d+\s*$")
BULLET_RE = re.compile(r"^\s*(?:[•·▪◦\-–—*]|\(?\d+[).、]|[（(]\d+[）)]|[ivxIVX]+[.、])\s+")


# ---------------------------------------------------------------- 主题色
def extract_theme_colors(pptx_path):
    """从 theme1.xml 提取 accent1~accent6，失败则返回 None。"""
    try:
        with zipfile.ZipFile(pptx_path) as z:
            themes = [n for n in z.namelist() if n.startswith("ppt/theme/")]
            if not themes:
                return None
            xml = z.read(themes[0]).decode("utf-8", "ignore")
        acc = re.findall(
            r'<a:accent(\d)>\s*<a:srgbClr val="([0-9A-Fa-f]{6})"', xml
        )
        if not acc:
            return None
        found = {k: v for k, v in acc}
        keys = sorted(found, key=int)[:6]
        return [found[k] for k in keys]
    except Exception:
        return None


# ---------------------------------------------------------------- 解析
def shape_text_blocks(shape):
    """把一个 shape 的文字拆成若干 block（含字号/加粗/缩进级别）。"""
    blocks = []
    if not shape.has_text_frame:
        return blocks

    # 表格单独处理
    if getattr(shape, "has_table", False):
        return blocks

    for para in shape.text_frame.paragraphs:
        runs = [r for r in para.runs if r.text]
        if not runs:
            continue
        text = "".join(r.text for r in runs).strip()
        if not text:
            continue
        sizes = [r.font.size.pt for r in runs if r.font.size]
        size = max(sizes) if sizes else None
        bold = any(bool(r.font.bold) for r in runs)
        blocks.append(
            {
                "text": text,
                "size": size,
                "bold": bold,
                "level": para.level or 0,
            }
        )
    return blocks


def extract_slide(slide, slide_w, slide_h):
    """解析一页 -> 结构化 blocks（含过滤、分类、排序）。"""
    raw = []
    shape_seq = 0

    for shape in slide.shapes:
        # 表格
        if getattr(shape, "has_table", False):
            rows = []
            for tr in shape.table.rows:
                rows.append([c.text.strip() for c in tr.cells])
            if any(any(r) for r in rows):
                raw.append(
                    {
                        "kind": "table",
                        "rows": rows,
                        "top": shape.top or 0,
                        "left": shape.left or 0,
                        "size": None,
                        "bold": False,
                        "level": 0,
                        "shape_id": shape_seq,
                        "para_idx": 0,
                        "para_total": 1,
                    }
                )
            shape_seq += 1
            continue

        paras = shape_text_blocks(shape)
        if not paras:
            continue  # 纯装饰形状

        my_id = shape_seq
        shape_seq += 1

        for i, p in enumerate(paras):
            # 页码：形如 "3 / 24"
            if PAGENUM_RE.match(p["text"]):
                continue
            raw.append(
                {
                    "kind": "text",
                    "text": p["text"],
                    "size": p["size"],
                    "bold": p["bold"],
                    "level": p["level"],
                    "top": shape.top or 0,
                    "left": shape.left or 0,
                    "bottom": (shape.top or 0) + (shape.height or 0),
                    "width": shape.width or 0,
                    "shape_id": my_id,
                    "para_idx": i,
                    "para_total": len(paras),
                }
            )

    if not raw:
        return {"title": None, "subtitle": None, "groups": [[]], "max_size": 0}

    sizes = [b["size"] for b in raw if b["size"]]
    max_size = max(sizes) if sizes else 18

    # --- 识别页标题：位于页面上部区域 + 字号最大 + 有实际文字
    title = None
    cand = [
        b
        for b in raw
        if b["kind"] == "text"
        and b["top"] < slide_h * 0.30
        and b["size"]
        and len(b["text"]) >= 3
    ]
    if cand:
        best = max(cand, key=lambda b: b["size"])
        if best["size"] >= max_size * 0.8:
            title = best["text"]
            raw.remove(best)

    # --- 识别页眉（每页重复的章节标签，如 "Part 00 · 行业痛点与解决方案"）
    #保留为 kicker 展示，而不是丢弃——读者翻到任意页都能知道自己在哪个 Part
    kicker = None
    cand_k = [
        b
        for b in raw
        if b["kind"] == "text"
        and b["top"] < slide_h * 0.12
        and b["size"]
        and b["size"] <= 13
        and len(b["text"]) >= 3
    ]
    if cand_k:
        pick = min(cand_k, key=lambda b: b["top"])
        kicker = pick["text"]
        raw.remove(pick)

    # --- 识别副标题：页上部、字号小、非最大
    subtitle = None
    cand2 = [
        b
        for b in raw
        if b["kind"] == "text"
        and b["top"] < slide_h * 0.14
        and b["size"]
        and b["size"] <= 14
        and len(b["text"]) >= 3
    ]
    if cand2:
        pick = max(cand2, key=lambda b: b["top"])
        subtitle = pick["text"]
        raw.remove(pick)

    # --- 分栏聚类：按 left 聚成列，列内按 top 排序
    col_tol = slide_w * 0.04
    cols = []  # [(left, [blocks])]
    for b in sorted(raw, key=lambda x: (x["left"], x["top"])):
        if cols and abs(b["left"] - cols[-1][0]) <= col_tol:
            cols[-1][1].append(b)
        else:
            cols.append((b["left"], [b]))

    cols.sort(key=lambda c: c[0])

    groups = []
    for left, items in cols:
        items.sort(key=lambda x: x["top"])
        groups.append(items)

    # 注：页眉已在上面作为 kicker 提取并移除，此处不再做"页上部小字丢弃"，
    # 否则会误删正文里恰好位于页面上部的短文本（如章节名"收尾"）。
    cleaned = [g for g in groups if g]

    return {
        "title": title,
        "subtitle": subtitle,
        "kicker": kicker,
        "groups": cleaned,
        "tiers": size_tiers(raw),
        "max_size": max_size,
    }


def size_tiers(blocks):
    """把本页所有字号聚成'档位'（相差 <=2pt 视为同一档），降序。
    用于按页面自身的排版层级判定 h3/h4/p，而不是硬编码绝对字号。"""
    sizes = sorted({round(b["size"], 1) for b in blocks
                    if b.get("kind") == "text" and b["size"]}, reverse=True)
    tiers = []
    for s in sizes:
        if not tiers or s - tiers[-1] > 2.0:
            tiers.append(s)
    return tiers


def tier_of(size, tiers):
    """字号 -> 档位序号（0 为最大档）。"""
    if size is None or not tiers:
        return len(tiers) + 2
    return min(range(len(tiers)), key=lambda i: abs(tiers[i] - size))


# ---------------------------------------------------------------- 渲染
def esc(s):
    return html.escape(s, quote=False)


def render_blocks(items, tiers):
    """把一个列内的 blocks 渲染成 HTML。

    关键：按 shape_id 把同一个文本框的多段落聚成一个单元渲染，
    避免单段分支只输出第一段、丢弃同列后续文本框的内容。
    """
    out = []
    # 按 shape_id 聚成[[段落...], ...]，保持列内原有顺序
    groups = []
    index = {}
    for b in items:
        if b["kind"] == "table":
            groups.append([b])
            index.clear()
            continue
        key = b.get("shape_id")
        if key in index:
            groups[index[key]].append(b)
        else:
            index[key] = len(groups)
            groups.append([b])

    for g in groups:
        first = g[0]
        if first["kind"] == "table":
            out.append(render_table(first["rows"]))
            continue

        text = first["text"]
        size = first["size"] or 0
        t = tier_of(first["size"], tiers)

        # 同一文本框内多段落 -> 无序列表
        if len(g) > 1:
            out.append("<ul>")
            for b in g:
                out.append(f"<li>{esc(b['text'])}</li>")
            out.append("</ul>")
            continue

        if t == 0 and (size >= 15 or first["bold"]):
            out.append(f"<h3>{esc(text)}</h3>")
        elif t == 1 and (size >= 12.5 or first["bold"]):
            out.append(f"<h4>{esc(text)}</h4>")
        elif t == 0 and first["bold"]:
            out.append(f'<p class="lead">{esc(text)}</p>')
        else:
            out.append(f"<p>{esc(text)}</p>")
    return "\n".join(out)


def render_table(rows):
    if not rows:
        return ""
    head = rows[0]
    body = rows[1:]
    th = "".join(f"<th>{esc(c)}</th>" for c in head)
    trs = []
    for r in body:
        tds = "".join(f"<td>{esc(c)}</td>" for c in r)
        trs.append(f"<tr>{tds}</tr>")
    return (
        '<div class="tw"><table><thead><tr>'
        + th
        + "</tr></thead><tbody>"
        + "".join(trs)
        + "</tbody></table></div>"
    )


CSS = """
:root{
  --accent:#2563eb; --accent-soft:#eff6ff; --accent-line:#bfdbfe;
  --bg:#f6f7f9; --card:#fff; --ink:#1f2430; --ink-2:#4b5563; --ink-3:#8b93a3;
  --line:#e6e8ec; --code-bg:#f3f4f6;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{
  margin:0; background:var(--bg); color:var(--ink);
  font:16px/1.75 -apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;
}
/* ---------- 顶栏 ---------- */
header{
  position:sticky; top:0; z-index:20; background:rgba(255,255,255,.92);
  backdrop-filter:blur(10px); border-bottom:1px solid var(--line);
}
.bar{max-width:1180px; margin:0 auto; padding:12px 22px;
  display:flex; align-items:center; gap:16px; flex-wrap:wrap}
.bar h1{font-size:16px; margin:0; font-weight:650; letter-spacing:.2px}
.bar .meta{color:var(--ink-3); font-size:12.5px; white-space:nowrap}
.spacer{flex:1}
#q{
  padding:7px 12px; border:1px solid var(--line); border-radius:8px;
  font-size:13.5px; width:210px; outline:none; background:#fff; color:var(--ink);
}
#q:focus{border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-soft)}
#count{font-size:12.5px; color:var(--ink-3); min-width:52px; text-align:right}
.tocbtn{
  padding:7px 12px; border:1px solid var(--line); background:#fff;
  border-radius:8px; font-size:13px; cursor:pointer; color:var(--ink-2);
}
.tocbtn:hover{border-color:var(--accent); color:var(--accent)}
/* ---------- 布局 ---------- */
.wrap{max-width:1180px; margin:0 auto; padding:26px 22px 90px; display:flex; gap:30px}
nav.toc{
  position:sticky; top:78px; align-self:flex-start; flex:0 0 210px;
  max-height:calc(100vh - 100px); overflow:auto; font-size:13px;
}
nav.toc h5{margin:0 0 10px; font-size:11.5px; color:var(--ink-3);
  letter-spacing:1.2px; text-transform:uppercase; font-weight:600}
nav.toc a{
  display:block; padding:5px 10px; margin-bottom:1px; border-radius:6px;
  color:var(--ink-2); text-decoration:none; line-height:1.5;
  border-left:2px solid transparent; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap;
}
nav.toc a:hover{background:var(--accent-soft); color:var(--accent)}
nav.toc a.on{border-left-color:var(--accent); color:var(--accent); font-weight:600}
main{flex:1; min-width:0}
/* ---------- 页卡片 ---------- */
section.slide{
  background:var(--card); border:1px solid var(--line); border-radius:12px;
  padding:26px 30px; margin-bottom:22px; scroll-margin-top:86px;
}
section.slide.hidden{display:none}
.pnum{
  display:inline-block; font-size:11.5px; color:var(--accent);
  background:var(--accent-soft); border:1px solid var(--accent-line);
  padding:2px 9px; border-radius:20px; font-weight:600; margin-bottom:10px;
}
.sub{color:var(--ink-3); font-size:13.5px; margin:-4px 0 18px}
.kicker{
  display:inline-block; font-size:11.5px; font-weight:600; color:var(--accent);
  background:var(--accent-soft); border:1px solid var(--accent-line);
  padding:2px 10px; border-radius:4px; margin:0 0 8px; letter-spacing:.3px;
}
/* ---------- 排版 ---------- */
h2{font-size:21px; margin:0 0 6px; font-weight:680; line-height:1.4;
  letter-spacing:.2px}
h3{font-size:17px; margin:22px 0 8px; font-weight:650; color:var(--ink);
  padding-left:11px; border-left:3px solid var(--accent)}
h4{font-size:15px; margin:18px 0 6px; font-weight:650; color:var(--ink-2)}
p{margin:7px 0}
p.lead{font-weight:600; font-size:15.5px}
ul{margin:8px 0; padding-left:22px}
li{margin:5px 0}
li::marker{color:var(--accent)}
.cols{display:grid; gap:4px 30px}
.tw{overflow-x:auto; margin:14px 0}
table{border-collapse:collapse; width:100%; font-size:14px}
th,td{border:1px solid var(--line); padding:9px 12px; text-align:left;
  vertical-align:top}
th{background:var(--accent-soft); font-weight:650; color:var(--ink)}
mark{background:#fde68a; color:inherit; padding:0 1px; border-radius:2px}
.hit{animation:fl 1.1s ease-out}
@keyframes fl{0%{background:#fef3c7}100%{background:transparent}}
footer{text-align:center; color:var(--ink-3); font-size:12.5px; padding:22px}
.empty{display:none; text-align:center; color:var(--ink-3); padding:60px 0}
@media (max-width:900px){
  nav.toc{display:none}
  .wrap{padding:18px 14px 70px}
  section.slide{padding:20px 18px}
}
@media print{
  header,nav.toc{display:none}
  body{background:#fff}
  section.slide{break-inside:avoid; page-break-inside:avoid;
    border-color:#ccc; box-shadow:none}
  .cols{grid-template-columns:1fr 1fr}
}
"""

JS = """
const secs=[...document.querySelectorAll('section.slide')];
const links=[...document.querySelectorAll('nav.toc a')];
const q=document.getElementById('q');
const count=document.getElementById('count');
const empty=document.getElementById('empty');

function clearMarks(){
  document.querySelectorAll('mark').forEach(m=>{
    const p=document.createDocumentFragment();
    m.replaceWith(p); p.appendChild(document.createTextNode(m.textContent));
  });
  secs.forEach(s=>s.classList.remove('hit'));
}
function filter(){
  const kw=q.value.trim().toLowerCase();
  clearMarks();
  if(!kw){ secs.forEach(s=>s.classList.remove('hidden'));
    count.textContent=''; empty.style.display='none';
    links.forEach(l=>l.style.display=''); return; }
  let hit=0;
  secs.forEach(s=>{
    const hitOne=s.textContent.toLowerCase().includes(kw);
    s.classList.toggle('hidden',!hitOne);
    links.forEach(l=>{});
    if(hitOne) hit++;
  });
  links.forEach(l=>{
    const t=l.textContent.toLowerCase();
    l.style.display=t.includes(kw)?'':'none';
  });
  // 当前目录页高亮
  const vis=secs.filter(s=>!s.classList.contains('hidden'));
  vis.forEach(s=>{ if(s.textContent.toLowerCase().includes(kw)) s.classList.add('hit'); });
  empty.style.display=hit?'none':'block';
  count.textContent=hit? hit+' 页命中':'';
}
q.addEventListener('input',filter);
q.addEventListener('keydown',e=>{ if(e.key==='Escape'){q.value='';filter();} });

// 滚动高亮目录
const io=new IntersectionObserver(es=>{
  es.forEach(e=>{
    if(e.isIntersecting){
      links.forEach(l=>l.classList.toggle('on', l.hash==='#'+e.target.id));
    }
  });
},{rootMargin:'0px 0px -70% 0px'});
secs.forEach(s=>io.observe(s));

document.addEventListener('keydown',e=>{
  if(e.key==='/'&&document.activeElement!==q){e.preventDefault();q.focus();}
});
"""


def build_html(src_path, out_path, title):
    prs = Presentation(src_path)
    sw = prs.slide_width
    sh = prs.slide_height
    colors = extract_theme_colors(src_path)
    accent = "#" + colors[0] if colors else "#2563eb"

    parts = []
    parts.append(
        "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n"
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
        f"<title>{esc(title)}</title>\n<style>{CSS}</style>\n</head>\n<body>\n"
    )

    # 顶栏
    n = len(prs.slides)
    parts.append(
        "<header><div class=\"bar\">"
        f"<h1>{esc(title)}</h1>"
        f'<span class="meta">{n} 页 · 演示源件：{esc(os.path.basename(src_path))}</span>'
        '<span class="spacer"></span>'
        '<input id="q" type="search" placeholder="搜索内容（/ 聚焦）">'
        '<span id="count"></span>'
        '<button class="tocbtn" onclick="window.scrollTo({top:0,behavior:\'smooth\'})">回到顶部</button>'
        "</div></header>\n"
    )

    parts.append('<div class="wrap"><nav class="toc"><h5>页码导航</h5>')
    parts.append("</nav><main>")

    for i, slide in enumerate(prs.slides, 1):
        info = extract_slide(slide, sw, sh)
        toc_label = info["title"] or f"第 {i} 页"
        parts.append(
            f'<a href="#s{i}">{i}. {esc(toc_label)}</a>'
        )

    for i, slide in enumerate(prs.slides, 1):
        info = extract_slide(slide, sw, sh)
        parts.append(f'<section class="slide" id="s{i}">')
        parts.append(f'<span class="pnum">第 {i} / {n} 页</span>')
        if info["kicker"]:
            parts.append(f'<div class="kicker">{esc(info["kicker"])}</div>')
        parts.append(f'<h2>{esc(info["title"] or f"第 {i} 页")}</h2>')
        if info["subtitle"]:
            parts.append(f'<p class="sub">{esc(info["subtitle"])}</p>')

        groups = info["groups"]
        if groups:
            ncol = len(groups)
            style = ""
            if ncol >= 2:
                widths = max(len(g) for g in groups)
                style = f' style="grid-template-columns:repeat({ncol},1fr)"'
            parts.append(f'<div class="cols"{style}>')
            for g in groups:
                parts.append("<div>" + render_blocks(g, info["tiers"]) + "</div>")
            parts.append("</div>")

        parts.append("</section>")

    parts.append('<div class="empty">没有命中内容</div>')
    parts.append("</main></div>\n")
    parts.append(
        "<footer>本文档由 pptx 自动转写为阅读流，仅保留内容层级，"
        "版式与源件不完全一致；需要完整视觉还原请打开 .pptx 源件。</footer>\n"
    )
    parts.append(f"<script>{JS}</script>\n</body>\n</html>")

    with open(out_path, "w", encoding="utf-8") as f:
        f.write("".join(parts))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="*")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    targets = args.files or [os.path.join(ROOT, t) for t in TARGETS]
    ok = skip = 0
    for src in targets:
        if not os.path.isabs(src):
            src = os.path.join(ROOT, src)
        if not os.path.exists(src):
            print(f"[skip] 不存在: {src}")
            skip += 1
            continue
        out = os.path.splitext(src)[0] + ".html"
        if os.path.exists(out) and not args.force:
            print(f"[skip] 已存在（用 --force 覆盖）: {os.path.basename(out)}")
            skip += 1
            continue
        title = os.path.basename(src).replace(".pptx", "")
        build_html(src, out, title)
        size = os.path.getsize(out) / 1024
        print(f"[ok]   {os.path.basename(out)}  ({size:.0f} KB)")
        ok += 1

    print(f"\n完成：{ok} 个转换，{skip} 个跳过")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())