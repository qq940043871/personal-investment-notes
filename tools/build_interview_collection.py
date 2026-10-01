# -*- coding: utf-8 -*-
"""
把仓库 banks/ 下 13 份「八股文 / 面试题深度整理」合并为一个单文件「面试背诵集合」HTML。
暗色 Ocean Gradient 风格，内联 CSS/JS，无外部依赖。
"""
import re
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANKS = os.path.join(ROOT, "banks")
OUT = os.path.join(BANKS, "面试背诵集合.html")

# ---------------------------------------------------------------
# 技术栈分组与配色（顺序即 Tab 顺序）
# ---------------------------------------------------------------
TECHS = [
    {
        "id": "java", "name": "Java", "icon": "☕",
        "color": "#f59e0b",
        "docs": [
            {"file": "Java深度八股文.md", "sub": "考前背诵版"},
            {"file": "Java面试题深度整理.md", "sub": "题库深度版"},
        ],
    },
    {
        "id": "mysql", "name": "MySQL", "icon": "🐬",
        "color": "#3b82f6",
        "docs": [
            {"file": "MySQL八股文追问链.md", "sub": "追问链冲刺版"},
            {"file": "MySQL面试题深度整理.md", "sub": "题库深度版"},
        ],
    },
    {
        "id": "redis", "name": "Redis", "icon": "⚡",
        "color": "#ef4444",
        "docs": [
            {"file": "Redis八股文追问链.md", "sub": "追问链冲刺版"},
            {"file": "Redis面试题深度整理.md", "sub": "题库深度版"},
        ],
    },
    {
        "id": "kafka", "name": "Kafka/ZK", "icon": "🔄",
        "color": "#06b6d4",
        "docs": [
            {"file": "KafkaZookeeper深度八股文.md", "sub": "考前背诵版"},
        ],
    },
    {
        "id": "nginx", "name": "Nginx", "icon": "🌐",
        "color": "#10b981",
        "docs": [
            {"file": "Nginx深度八股文.md", "sub": "考前背诵版"},
            {"file": "Nginx面试题深度整理.md", "sub": "题库深度版"},
        ],
    },
    {
        "id": "linux", "name": "Linux", "icon": "🐧",
        "color": "#eab308",
        "docs": [
            {"file": "Linux面试题深度整理.md", "sub": "题库深度版"},
        ],
    },
    {
        "id": "tomcat", "name": "Tomcat", "icon": "🐱",
        "color": "#a855f7",
        "docs": [
            {"file": "Tomcat面试题深度整理.md", "sub": "题库深度版"},
        ],
    },
    {
        "id": "net", "name": "网络连接", "icon": "🕸️",
        "color": "#38bdf8",
        "docs": [
            {"file": "网络连接类型八股文.md", "sub": "考前背诵版"},
            {"file": "网络连接类型面试题深度整理.md", "sub": "题库深度版"},
        ],
    },
]

TAG_SET = {"高频", "必背", "基础", "进阶", "中频", "超高频"}


# ---------------------------------------------------------------
# Markdown -> HTML 转换（支持标题/加粗/行内代码/列表/表格/代码块/引用/分隔线）
# ---------------------------------------------------------------
def _inline(text):
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)",
                  r'<a href="\2" target="_blank" rel="noopener">\1</a>', text)
    return text


def _table_to_html(lines):
    rows = []
    for ln in lines:
        cells = [c.strip() for c in ln.strip().strip("|").split("|")]
        rows.append(cells)
    if not rows:
        return ""
    header = rows[0]
    body_start = 1
    if len(rows) > 1 and all(re.match(r"^:?-{2,}:?$", c) for c in rows[1]):
        body_start = 2
    html = ["<table><thead><tr>"]
    html += "".join(f"<th>{_inline(c)}</th>" for c in header)
    html.append("</tr></thead><tbody>")
    for r in rows[body_start:]:
        html.append("<tr>")
        html += "".join(f"<td>{_inline(c)}</td>" for c in r)
        html.append("</tr>")
    html.append("</tbody></table>")
    return "".join(html)


def md_to_html(md):
    lines = md.split("\n")
    out = []
    i, n = 0, len(lines)
    while i < n:
        line = lines[i]
        s = line.strip()
        if not s:
            i += 1
            continue
        # 代码块
        if s.startswith("```"):
            lang = s[3:].strip()
            i += 1
            code = []
            while i < n and not lines[i].strip().startswith("```"):
                code.append(lines[i])
                i += 1
            i += 1  # 跳过结尾 ```
            code_html = "\n".join(code).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            cls = f' class="lang-{lang}"' if lang else ""
            out.append(f"<pre><code{cls}>{code_html}</code></pre>")
            continue
        # 表格
        if s.startswith("|"):
            tl = []
            while i < n and lines[i].strip().startswith("|"):
                tl.append(lines[i].strip())
                i += 1
            out.append(_table_to_html(tl))
            continue
        # 引用
        if s.startswith(">"):
            q = []
            while i < n and lines[i].strip().startswith(">"):
                t = lines[i].strip()
                t = re.sub(r"^>\s?", "", t)
                q.append(t)
                i += 1
            out.append("<blockquote>" + _inline("<br>".join(q)) + "</blockquote>")
            continue
        # 标题（正文中极少，但兜底）
        m = re.match(r"^(#{1,4})\s+(.*)", s)
        if m:
            lv = min(len(m.group(1)) + 2, 6)
            out.append(f"<h{lv}>{_inline(m.group(2))}</h{lv}>")
            i += 1
            continue
        # 无序列表
        if re.match(r"^[-*+]\s+", s):
            items = []
            while i < n and re.match(r"^[-*+]\s+", lines[i].strip()):
                items.append(re.sub(r"^[-*+]\s+", "", lines[i].strip()))
                i += 1
            out.append("<ul>" + "".join(f"<li>{_inline(x)}</li>" for x in items) + "</ul>")
            continue
        # 有序列表
        if re.match(r"^\d+[.)]\s+", s):
            items = []
            while i < n and re.match(r"^\d+[.)]\s+", lines[i].strip()):
                items.append(re.sub(r"^\d+[.)]\s+", "", lines[i].strip()))
                i += 1
            out.append("<ol>" + "".join(f"<li>{_inline(x)}</li>" for x in items) + "</ol>")
            continue
        # 分隔线
        if s in ("---", "***", "___"):
            out.append("<hr>")
            i += 1
            continue
        # 普通段落（合并连续行）
        para = []
        while i < n and lines[i].strip() and not lines[i].strip().startswith(
                ("```", "|", ">", "- ", "* ", "+ ")) \
                and not re.match(r"^\d+[.)]\s+", lines[i].strip()) \
                and not re.match(r"^#{1,4}\s+", lines[i].strip()) \
                and lines[i].strip() not in ("---", "***", "___"):
            para.append(lines[i].strip())
            i += 1
        out.append("<p>" + _inline("<br>".join(para)) + "</p>")
    return "\n".join(out)


def split_title(h3):
    """拆出题目正文与标签。"""
    h3 = h3.strip()
    tag = ""
    m = re.search(r"【([^】]+)】\s*$", h3)
    if m and m.group(1) in TAG_SET:
        tag = m.group(1)
        h3 = h3[:m.start()].strip()
    return h3, tag


def parse_doc(path):
    """解析单个 md，返回 chapters 列表。"""
    with open(path, encoding="utf-8") as f:
        lines = f.read().split("\n")

    chapters = []          # [{"title":..., "intro": html, "questions":[...]}]
    cur_chapter = None
    cur_q = None
    buf = []               # 当前题目/章节的正文缓冲

    def flush_q():
        nonlocal buf, cur_q
        if cur_q is not None:
            cur_q["body"] = md_to_html("\n".join(buf).strip())
            buf = []
            cur_q = None

    def flush_chapter():
        nonlocal buf, cur_chapter
        if cur_chapter is not None:
            # 剩余缓冲作为章节引言（无题目章节的说明）
            intro = "\n".join(buf).strip()
            if intro:
                cur_chapter["intro"] = md_to_html(intro)
            buf = []
            if cur_chapter["questions"] or cur_chapter.get("intro"):
                chapters.append(cur_chapter)
            cur_chapter = None

    for line in lines:
        s = line.rstrip()
        if s.startswith("## "):
            flush_q()
            flush_chapter()
            cur_chapter = {"title": s[3:].strip(), "questions": []}
            buf = []
        elif s.startswith("### "):
            flush_q()
            q, tag = split_title(s[4:])
            cur_q = {"q": q, "tag": tag, "body": ""}
            if cur_chapter is None:
                cur_chapter = {"title": "", "questions": []}
            cur_chapter["questions"].append(cur_q)
        elif s.startswith("# "):
            continue  # 文档 H1 标题忽略
        else:
            buf.append(line)

    flush_q()
    flush_chapter()
    return chapters


# ---------------------------------------------------------------
# 主流程：解析全部文档
# ---------------------------------------------------------------
data = []
total_q = 0
for tech in TECHS:
    t = {"id": tech["id"], "name": tech["name"], "icon": tech["icon"],
         "color": tech["color"], "docs": []}
    for d in tech["docs"]:
        path = os.path.join(BANKS, d["file"])
        if not os.path.exists(path):
            print("MISSING:", path)
            continue
        chapters = parse_doc(path)
        qcount = sum(len(c["questions"]) for c in chapters)
        total_q += qcount
        t["docs"].append({
            "sub": d["sub"], "chapters": chapters, "qcount": qcount,
        })
    data.append(t)

print("总题目数:", total_q)
for t in data:
    n = sum(d["qcount"] for d in t["docs"])
    print(f"  {t['name']}: {n} 题, {len(t['docs'])} 份文档")

# ---------------------------------------------------------------
# 渲染 HTML
# ---------------------------------------------------------------
json_data = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")

CSS = r"""
:root{
  --bg1:#070b1a;--bg2:#0b1830;--bg3:#0a1226;
  --card:rgba(255,255,255,0.045);--card2:rgba(255,255,255,0.07);
  --line:rgba(120,180,255,0.16);--line2:rgba(120,180,255,0.28);
  --txt:#dbe6f5;--txt2:#9fb2cc;--muted:#6d7f9c;
  --accent:#38bdf8;--accent2:#22d3ee;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{
  font-family:"Segoe UI","PingFang SC","Microsoft YaHei",-apple-system,BlinkMacSystemFont,sans-serif;
  color:var(--txt);
  background:
    radial-gradient(1200px 600px at 12% -8%, rgba(56,189,248,.22), transparent 60%),
    radial-gradient(900px 500px at 88% 8%, rgba(34,211,238,.16), transparent 55%),
    radial-gradient(700px 500px at 50% 110%, rgba(99,102,241,.18), transparent 60%),
    linear-gradient(160deg,var(--bg1),var(--bg2) 55%,var(--bg3));
  background-attachment:fixed;
  min-height:100vh;
  -webkit-font-smoothing:antialiased;
}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}

/* 顶部 */
header{
  position:sticky;top:0;z-index:50;
  backdrop-filter:blur(14px);
  background:linear-gradient(180deg,rgba(7,11,26,.92),rgba(7,11,26,.72));
  border-bottom:1px solid var(--line);
  padding:14px 22px 10px;
}
.hd-top{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.logo{
  width:38px;height:38px;border-radius:10px;flex:none;
  display:flex;align-items:center;justify-content:center;
  font-size:20px;color:#fff;
  background:linear-gradient(135deg,#0ea5e9,#6366f1);
  box-shadow:0 4px 18px rgba(56,189,248,.4);
}
.hd-title h1{font-size:18px;font-weight:700;letter-spacing:.5px}
.hd-title p{font-size:12px;color:var(--muted);margin-top:2px}
.hd-stats{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.stat{
  background:var(--card);border:1px solid var(--line);border-radius:10px;
  padding:6px 12px;font-size:12px;color:var(--txt2);
}
.stat b{color:var(--accent2);font-size:15px;margin:0 2px}
.search-wrap{flex:1;min-width:220px;position:relative}
.search-wrap input{
  width:100%;background:var(--card);border:1px solid var(--line);
  border-radius:10px;padding:9px 12px 9px 34px;color:var(--txt);
  font-size:13px;outline:none;transition:.2s;
}
.search-wrap input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(56,189,248,.15)}
.search-wrap::before{content:"🔍";position:absolute;left:11px;top:50%;transform:translateY(-50%);font-size:13px;opacity:.6}

/* Tab */
.tabs{
  display:flex;gap:6px;overflow-x:auto;padding:10px 22px 2px;scrollbar-width:none;
}
.tabs::-webkit-scrollbar{display:none}
.tab{
  flex:none;display:flex;align-items:center;gap:6px;
  padding:7px 14px;border-radius:999px;cursor:pointer;
  border:1px solid var(--line);background:var(--card);color:var(--txt2);
  font-size:13px;white-space:nowrap;transition:.18s;user-select:none;
}
.tab:hover{border-color:var(--line2);color:var(--txt)}
.tab.active{
  color:#fff;border-color:transparent;
  background:linear-gradient(135deg,var(--accent),#6366f1);
  box-shadow:0 4px 16px rgba(56,189,248,.35);
}
.tab .n{font-size:11px;opacity:.8}

/* 主区 */
main{max-width:1180px;margin:0 auto;padding:18px 22px 60px}
.tech-head{display:flex;align-items:baseline;gap:10px;margin:6px 0 4px}
.tech-head h2{font-size:22px;font-weight:800}
.tech-head .cnt{font-size:12px;color:var(--muted)}

/* 文档区块 */
.doc{margin-top:18px}
.doc-title{
  display:flex;align-items:center;gap:10px;margin-bottom:12px;
}
.doc-badge{
  font-size:12px;font-weight:600;color:var(--accent2);
  background:rgba(34,211,238,.12);border:1px solid rgba(34,211,238,.3);
  padding:3px 10px;border-radius:999px;
}
.doc-title .sub{font-size:14px;color:var(--txt2);font-weight:600}
.doc-title .q{font-size:12px;color:var(--muted)}

/* 章节 */
.chapter{
  background:var(--card);border:1px solid var(--line);border-radius:14px;
  margin-bottom:12px;overflow:hidden;
}
.chapter>summary{
  list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;
  padding:13px 16px;font-size:14px;font-weight:700;color:var(--txt);
  transition:.15s;user-select:none;
}
.chapter>summary::-webkit-details-marker{display:none}
.chapter>summary:hover{background:var(--card2)}
.chapter>summary .arrow{transition:.2s;font-size:11px;color:var(--muted)}
.chapter[open]>summary .arrow{transform:rotate(90deg)}
.chapter>summary .ccount{margin-left:auto;font-size:11px;color:var(--muted);font-weight:500}
.chapter-intro{
  padding:10px 16px;font-size:13px;color:var(--txt2);
  border-top:1px dashed var(--line);line-height:1.7;
}
.chapter-body{padding:2px 12px 12px}

/* 题目卡片 */
.qcard{
  border:1px solid var(--line);border-radius:12px;margin:10px 0;
  background:rgba(255,255,255,0.02);overflow:hidden;transition:.15s;
}
.qcard:hover{border-color:var(--line2)}
.qcard.mastered{border-color:rgba(52,211,153,.45);background:rgba(16,185,129,.05)}
.qhead{
  display:flex;align-items:flex-start;gap:10px;padding:12px 14px;cursor:pointer;user-select:none;
}
.qhead:hover{background:var(--card2)}
.qhead .idx{flex:none;font-size:11px;color:var(--muted);font-weight:700;padding-top:2px;min-width:26px}
.qhead .qtxt{flex:1;font-size:14px;font-weight:600;line-height:1.55;color:var(--txt)}
.qhead .qtag{
  flex:none;font-size:10px;padding:2px 8px;border-radius:6px;margin-top:2px;font-weight:700;
  background:rgba(56,189,248,.15);color:#7dd3fc;border:1px solid rgba(56,189,248,.3);
}
.qhead .qtag.t-高频{background:rgba(239,68,68,.15);color:#fca5a5;border-color:rgba(239,68,68,.35)}
.qhead .qtag.t-必背{background:rgba(239,68,68,.15);color:#fca5a5;border-color:rgba(239,68,68,.35)}
.qhead .qtag.t-进阶{background:rgba(168,85,247,.15);color:#d8b4fe;border-color:rgba(168,85,247,.35)}
.qhead .qtag.t-中频{background:rgba(234,179,8,.15);color:#fde68a;border-color:rgba(234,179,8,.35)}
.qhead .qtag.t-基础{background:rgba(16,185,129,.15);color:#6ee7b7;border-color:rgba(16,185,129,.35)}
.qhead .caret{flex:none;color:var(--muted);font-size:11px;transition:.2s;padding-top:3px}
.qcard.open .qhead .caret{transform:rotate(90deg)}
.qbody{display:none;padding:0 14px 14px 50px;font-size:13.5px;line-height:1.8;color:var(--txt2)}
.qcard.open .qbody{display:block}
.qbody p{margin:6px 0}
.qbody ul,.qbody ol{margin:8px 0;padding-left:22px}
.qbody li{margin:4px 0}
.qbody strong{color:#eaf2ff}
.qbody code{
  font-family:"SFMono-Regular",Consolas,"JetBrains Mono",monospace;font-size:12.5px;
  background:rgba(56,189,248,.12);color:#93d5ff;padding:1px 6px;border-radius:5px;
}
.qbody pre{
  background:rgba(3,8,20,.7);border:1px solid var(--line);border-radius:10px;
  padding:12px 14px;overflow-x:auto;margin:10px 0;
}
.qbody pre code{background:transparent;color:#b8d8ff;padding:0;font-size:12.5px;line-height:1.65}
.qbody table{border-collapse:collapse;width:100%;margin:10px 0;font-size:12.5px}
.qbody th,.qbody td{border:1px solid var(--line);padding:6px 10px;text-align:left}
.qbody th{background:rgba(56,189,248,.1);color:#dbeafe;font-weight:600}
.qbody blockquote{
  border-left:3px solid var(--accent);background:rgba(56,189,248,.07);
  padding:8px 14px;margin:10px 0;border-radius:0 8px 8px 0;color:#c4d6ec;
}
.qbody hr{border:none;border-top:1px dashed var(--line);margin:12px 0}

/* 操作按钮 */
.qactions{flex:none;display:flex;align-items:center;gap:6px}
.btn-master{
  border:1px solid var(--line2);background:transparent;color:var(--muted);
  border-radius:8px;padding:3px 8px;font-size:11px;cursor:pointer;transition:.15s;
}
.btn-master:hover{color:var(--txt);border-color:var(--accent)}
.btn-master.on{background:rgba(16,185,129,.18);color:#6ee7b7;border-color:rgba(52,211,153,.5)}

/* 空态 */
.empty{padding:40px;text-align:center;color:var(--muted);font-size:14px}
.float-actions{position:fixed;right:20px;bottom:20px;display:flex;flex-direction:column;gap:8px;z-index:40}
.fab{
  width:42px;height:42px;border-radius:50%;border:1px solid var(--line2);cursor:pointer;
  background:rgba(11,24,48,.85);color:var(--txt2);font-size:16px;backdrop-filter:blur(8px);
  display:flex;align-items:center;justify-content:center;transition:.15s;box-shadow:0 4px 14px rgba(0,0,0,.4);
}
.fab:hover{color:#fff;border-color:var(--accent)}
@media (max-width:720px){.hd-stats{margin-left:0;width:100%}.qbody{padding-left:14px}}
"""

JS = r"""
const DATA = __DATA__;
const storeKey = "interview_collection_mastered_v1";
let mastered = new Set(JSON.parse(localStorage.getItem(storeKey) || "[]"));
let curTech = 0;
let searchMode = false;

const $ = s => document.querySelector(s);
const el = (t, cls) => { const e = document.createElement(t); if(cls) e.className = cls; return e; };

function save(){ localStorage.setItem(storeKey, JSON.stringify([...mastered])); updateStats(); }

function uid(ti, di, ci, qi){ return `${ti}:${di}:${ci}:${qi}`; }

function esc(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function refreshStats(){
  let total = 0, done = 0;
  DATA.forEach((t,ti)=>t.docs.forEach((d,di)=>d.chapters.forEach(c=>c.questions.forEach((q,qi)=>{
    total++;
    if(mastered.has(uid(t.id,di,chapterIndexOf(t,di,c),qi))) done++;
  }))));
  $("#statTotal").textContent = total;
  $("#statDone").textContent = done;
  $("#statPct").textContent = total ? Math.round(done/total*100) : 0;
}

// 通过章节对象定位其索引（章节数组内顺序稳定）
function chapterIndexOf(t, di, ch){
  return t.docs[di].chapters.indexOf(ch);
}

function buildTabs(){
  const wrap = $("#tabs"); wrap.innerHTML = "";
  DATA.forEach((t,ti)=>{
    const n = t.docs.reduce((a,d)=>a+d.qcount,0);
    const b = el("div","tab"+(ti===curTech?" active":""));
    b.style.setProperty("--accent", t.color);
    b.innerHTML = `<span>${t.icon}</span>${esc(t.name)}<span class="n">${n}</span>`;
    b.onclick = ()=>{ curTech = ti; searchMode = false; $("#search").value=""; buildTabs(); renderTech(); };
    wrap.appendChild(b);
  });
}

function renderTech(){
  const main = $("#main"); main.innerHTML = "";
  const t = DATA[curTech];
  const head = el("div","tech-head");
  head.innerHTML = `<h2>${t.icon} ${esc(t.name)}</h2><span class="cnt">共 ${t.docs.reduce((a,d)=>a+d.qcount,0)} 题 · ${t.docs.length} 份文档</span>`;
  main.appendChild(head);

  t.docs.forEach((d,di)=>{
    const doc = el("div","doc");
    const dt = el("div","doc-title");
    dt.innerHTML = `<span class="doc-badge">${esc(d.sub)}</span><span class="sub">${esc(d.sub === "题库深度版" ? "深度题库" : d.sub)}</span><span class="q">${d.qcount} 题</span>`;
    doc.appendChild(dt);

    d.chapters.forEach((ch,ci)=>{
      if(!ch.questions.length && !ch.intro) return;
      const det = el("details","chapter");
      const sum = el("summary");
      sum.innerHTML = `<span class="arrow">▶</span><span>${esc(ch.title)}</span><span class="ccount">${ch.questions.length} 题</span>`;
      det.appendChild(sum);
      if(ch.intro){ const inr = el("div","chapter-intro"); inr.innerHTML = ch.intro; det.appendChild(inr); }
      const body = el("div","chapter-body");
      ch.questions.forEach((q,qi)=>{
        body.appendChild(buildCard(t,di,ch,ci,q,qi));
      });
      det.appendChild(body);
      doc.appendChild(det);
    });
    main.appendChild(doc);
  });
  refreshStats();
}

function buildCard(t,di,ch,ci,q,qi){
  const id = uid(t.id,di,ci,qi);
  const card = el("div","qcard"+(mastered.has(id)?" mastered":""));
  const head = el("div","qhead");
  const tag = q.tag ? `<span class="qtag t-${esc(q.tag)}">${esc(q.tag)}</span>` : "";
  const mbtn = el("button","btn-master"+(mastered.has(id)?" on":""));
  mbtn.textContent = mastered.has(id) ? "✓ 已掌握" : "标记掌握";
  mbtn.onclick = (e)=>{ e.stopPropagation(); if(mastered.has(id)){mastered.delete(id);}else{mastered.add(id);} save(); card.classList.toggle("mastered"); mbtn.classList.toggle("on"); mbtn.textContent = mastered.has(id)?"✓ 已掌握":"标记掌握"; refreshStats(); };
  head.innerHTML = `<span class="idx">${String(qi+1).padStart(2,'0')}</span><div class="qtxt">${esc(q.q)}</div>${tag}<span class="qactions"></span><span class="caret">▶</span>`;
  head.querySelector(".qactions").appendChild(mbtn);
  head.onclick = (e)=>{ if(e.target===mbtn) return; card.classList.toggle("open"); };
  const body = el("div","qbody");
  body.innerHTML = q.body || "<p>（暂无解析）</p>";
  card.appendChild(head); card.appendChild(body);
  return card;
}

function doSearch(kw){
  kw = kw.trim().toLowerCase();
  const main = $("#main"); main.innerHTML = "";
  if(!kw){ searchMode = false; renderTech(); return; }
  searchMode = true;
  let found = 0;
  const results = [];
  DATA.forEach((t,ti)=>t.docs.forEach((d,di)=>d.chapters.forEach((ch,ci)=>{
    ch.questions.forEach((q,qi)=>{
      const hay = (q.q + " " + ch.title + " " + t.name).toLowerCase();
      if(hay.includes(kw)){
        results.push({t,di,ch,ci,q,qi});
      }
    });
  })));
  const head = el("div","tech-head");
  head.innerHTML = `<h2>🔍 搜索结果</h2><span class="cnt">「${esc(kw)}」命中 ${results.length} 题</span>`;
  main.appendChild(head);
  if(!results.length){ main.appendChild(el("div","empty","没有匹配的题目，换个关键词试试")); refreshStats(); return; }
  results.forEach(r=>{
    const card = buildCard(r.t,r.di,r.ch,r.ci,r.q,r.qi);
    card.classList.add("open");
    main.appendChild(card);
  });
  refreshStats();
}

function expandAll(open){
  document.querySelectorAll(".qcard").forEach(c=>{ if(open)c.classList.add("open"); else c.classList.remove("open"); });
}
function masterAll(){
  // 只对当前可见题目全部标记
  document.querySelectorAll(".qcard").forEach(c=>{
    const mb = c.querySelector(".btn-master"); if(mb && !mb.classList.contains("on")) mb.click();
  });
}

document.addEventListener("DOMContentLoaded", ()=>{
  buildTabs();
  renderTech();
  $("#search").addEventListener("input", e=>doSearch(e.target.value));
  $("#btnExpand").onclick = ()=>expandAll(true);
  $("#btnCollapse").onclick = ()=>expandAll(false);
  $("#btnMasterAll").onclick = ()=>masterAll();
  $("#btnTop").onclick = ()=>window.scrollTo({top:0,behavior:"smooth"});
});
""".replace("__DATA__", json_data)

HTML = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>面试背诵集合 · 全栈八股文</title>
<style>{CSS}</style>
</head>
<body>
<header>
  <div class="hd-top">
    <div class="logo">📘</div>
    <div class="hd-title">
      <h1>面试背诵集合</h1>
      <p>Java · MySQL · Redis · Kafka/ZK · Nginx · Linux · Tomcat · 网络连接</p>
    </div>
    <div class="search-wrap">
      <input id="search" type="text" placeholder="搜索题目关键词，如：HashMap、MVCC、三次握手、B+树…">
    </div>
    <div class="hd-stats">
      <span class="stat">总题 <b id="statTotal">0</b></span>
      <span class="stat">已掌握 <b id="statDone">0</b></span>
      <span class="stat">掌握率 <b id="statPct">0</b>%</span>
    </div>
  </div>
  <div class="tabs" id="tabs"></div>
</header>
<main id="main"></main>
<div class="float-actions">
  <button class="fab" id="btnExpand" title="全部展开">▾</button>
  <button class="fab" id="btnCollapse" title="全部折叠">▸</button>
  <button class="fab" id="btnMasterAll" title="当前页全部标记掌握">✓</button>
  <button class="fab" id="btnTop" title="回到顶部">↑</button>
</div>
<script>{JS}</script>
</body>
</html>"""

with open(OUT, "w", encoding="utf-8") as f:
    f.write(HTML)

print("已生成:", OUT, f"({os.path.getsize(OUT)/1024:.0f} KB)")
