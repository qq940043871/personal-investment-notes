// ============================================================
// deck-kit.mjs — 设计令牌与页面原语
// 风格配方：正式工作汇报（严谨 · 秩序 · 克制）
// 张力：金融级的严肃，但有人物叙事温度
// ============================================================

export const LAYOUT = { W: 13.333, H: 7.5, M: 0.62 };
export const CW = LAYOUT.W - 2 * LAYOUT.M; // 内容区宽度 12.093

// —— 颜色按角色定义 ——
export const T = {
  bg: "FAF7F2",        // 暖米白背景
  surface: "FFFFFF",   // 面板
  surface2: "F2EDE3",  // 次级面板（暖纸感）
  ink: "1F2430",       // 主文本（近黑）
  muted: "5B6472",     // 次级文本
  faint: "8A93A0",     // 注释文本
  accent: "2E6DA4",    // 主强调（钢蓝）
  accentDark: "1E4E79",
  accentSoft: "E2ECF5",
  amber: "A86A0E",     // 数字强调（琥珀）
  amberSoft: "F5EAD3",
  positive: "2F8F5B",  // 语义：达成/✓
  caution: "B4700F",   // 语义：待填/注意
  risk: "B44A3C",      // 语义：否决/风险
  hairline: "D9D3C7",  // 细线
  grid: "EAE5DA",
};

export const F = { zh: "Microsoft YaHei", en: "Arial" };

// ============================================================
// 短令牌保护组件（序号/日期/百分比/金额/页码 不换行）
// ============================================================
const EM = 0.62;
function estWidth(text, size) {
  // CJK 按 1em，拉丁/数字按 0.62em 估算
  let w = 0;
  for (const ch of String(text)) w += /[\u4e00-\u9fff\uff00-\uffef]/.test(ch) ? 1 : EM;
  return (w * size) / 72 * 1.15 + 0.1;
}

export function token(slide, value, o = {}) {
  const { minFontSize = 10, ...opts } = o;
  const req = opts.fontSize ?? 14;
  const need = estWidth(value, req);
  let fs = req;
  if (opts.w && need > opts.w) fs = Math.max(minFontSize, req * opts.w / need);
  // 含中文的取值必须走中文字体：Arial 无 CJK 字形，回退后会触发负字距、字符重叠
  const cjk = /[\u4e00-\u9fff\uff00-\uffef]/.test(String(value));
  slide.addText(String(value), {
    fontFace: cjk ? F.zh : F.en,
    color: T.ink,
    ...opts,
    fontSize: fs,
    margin: 0,
    wrap: false,
    fit: "shrink",
    vert: "horz",
    valign: opts.valign ?? "middle",
  });
}

// ============================================================
// 页面骨架：页眉（章节标签+细线）、页脚（页码）、结论带
// ============================================================
export function chrome(slide, { part, label, page, total = 24, name = "haswhere · 技术经理" }) {
  // 页眉：左侧章节标签，右侧文档名
  slide.addText([
    { text: part ? `${part}  ` : "", options: { color: T.amber, bold: true } },
    { text: label ?? "", options: { color: T.accentDark, bold: true } },
  ], {
    x: LAYOUT.M, y: 0.26, w: 8, h: 0.3, fontFace: F.zh, fontSize: 11, charSpacing: 2,
    margin: 0, align: "left", valign: "middle",
  });
  slide.addText("个人简历介绍 · 面试/述职", {
    x: LAYOUT.W - LAYOUT.M - 4, y: 0.26, w: 4, h: 0.3, fontFace: F.zh, fontSize: 9,
    color: T.faint, margin: 0, align: "right", valign: "middle",
  });
  slide.addShape("line", { x: LAYOUT.M, y: 0.66, w: CW, h: 0, line: { color: T.hairline, width: 1 } });
  // 页脚
  token(slide, `${String(page).padStart(2, "0")} / ${total}`, {
    x: LAYOUT.W - LAYOUT.M - 1.2, y: 7.1, w: 1.2, h: 0.26, fontSize: 9, color: T.faint, align: "right",
  });
  slide.addText(name, {
    x: LAYOUT.M, y: 7.1, w: 6, h: 0.26, fontSize: 9, fontFace: F.zh, color: T.faint, margin: 0, valign: "middle",
  });
  slide.addShape("line", { x: LAYOUT.M, y: 7.06, w: CW, h: 0, line: { color: T.grid, width: 0.75 } });
}

// 主张标题（claim band）
export function claim(slide, text, { sub, y = 0.84 } = {}) {
  slide.addText(text, {
    x: LAYOUT.M, y, w: CW, h: 0.52, fontFace: F.zh, fontSize: 23, bold: true,
    color: T.ink, margin: 0, valign: "middle",
  });
  if (sub) {
    slide.addText(sub, {
      x: LAYOUT.M, y: y + 0.52, w: CW, h: 0.3, fontFace: F.zh, fontSize: 11.5,
      color: T.muted, margin: 0, valign: "top",
    });
    return y + 0.52 + 0.34; // 返回正文起始 y
  }
  return y + 0.62;
}

// 小节标签
export function sectionLabel(slide, text, x, y, { color = T.accent, w = 3 } = {}) {
  slide.addText(text, {
    x, y, w, h: 0.26, fontFace: F.zh, fontSize: 10.5, bold: true, color,
    charSpacing: 1.5, margin: 0, valign: "middle",
  });
}

// 平面面板
export function panel(slide, x, y, w, h, { fill = T.surface, line = T.hairline, lineW = 1 } = {}) {
  slide.addShape("rect", {
    x, y, w, h, fill: { color: fill },
    line: line ? { color: line, width: lineW } : { type: "none" },
  });
}

// 结论带（implication band）：左侧强调竖条 + 文本
export function band(slide, { x = LAYOUT.M, y, w = CW, h = 0.52, text, runs, accent = T.accent, size = 12.5, bold = true }) {
  slide.addShape("rect", { x, y, w, h, fill: { color: T.surface2 }, line: { type: "none" } });
  slide.addShape("rect", { x, y, w: 0.07, h, fill: { color: accent }, line: { type: "none" } });
  slide.addText(runs ?? text, {
    x: x + 0.24, y, w: w - 0.4, h, fontFace: F.zh, fontSize: size, bold, color: T.ink,
    margin: 0, valign: "middle",
  });
}

// 项目符号文本（▪ 前缀，颜色可控）
export function bullets(slide, items, x, y, w, h, {
  size = 12, color = T.ink, marker = T.accent, gap = 6, bold = false, line = 1.28,
} = {}) {
  const runs = [];
  items.forEach((it, i) => {
    const brk = i < items.length - 1;
    runs.push({ text: "▪ ", options: { color: marker, bold: true } });
    if (typeof it === "string") {
      runs.push({ text: it, options: { breakLine: brk } });
    } else {
      it.forEach((r, ri) => runs.push({
        text: r.text,
        options: { ...r.options, breakLine: ri === it.length - 1 ? brk : false },
      }));
    }
  });
  slide.addText(runs, {
    x, y, w, h, fontFace: F.zh, fontSize: size, color, bold, margin: 0, valign: "top",
    lineSpacingMultiple: line, paraSpaceAfter: gap,
  });
}

// 状态色映射
export const STATUS = {
  "极高": T.risk, "高": T.caution, "中高": T.caution, "中": T.accent,
  "✓": T.positive, "✗": T.risk,
};

// 表格封装（扁平、细线、深色表头）
export function table(slide, { x, y, w, colW, rows, rowH = 0.4, header = true, fontSize = 10.5, aligns, valign = "middle" }) {
  const body = rows.map((r, ri) => r.map((c, ci) => {
    const isHead = header && ri === 0;
    const opt = {
      fontFace: F.zh, fontSize: isHead ? 10 : fontSize,
      bold: isHead, color: isHead ? "FFFFFF" : T.ink,
      fill: { color: isHead ? T.accentDark : (ri % 2 === 0 ? T.surface : "FBF9F4") },
      align: aligns?.[ci] ?? "left", valign,
      border: [
        { type: "none" }, { type: "none" },
        { pt: 0.75, color: T.hairline }, { type: "none" },
      ],
      margin: [3, 6, 3, 6],
    };
    if (c && typeof c === "object" && c.text !== undefined) {
      return { text: c.text, options: { ...opt, ...(c.options ?? {}) } };
    }
    return { text: String(c ?? ""), options: opt };
  }));
  slide.addTable(body, { x, y, w, colW, rowH, border: { type: "none" } });
}

// 层级行（架构图用）：左侧层名 + 右侧若干单元
export function tierRow(slide, { y, h, name, note, items, x = LAYOUT.M, w = CW, cols, highlight = false }) {
  const labelW = 1.55;
  panel(slide, x, y, labelW, h, { fill: highlight ? T.accentDark : T.accentSoft, line: null });
  slide.addText(name, {
    x, y, w: labelW, h, fontFace: F.zh, fontSize: 11, bold: true,
    color: highlight ? "FFFFFF" : T.accentDark, align: "center", valign: "middle", margin: 0,
  });
  const gap = 0.12;
  const innerX = x + labelW + gap;
  const innerW = w - labelW - gap;
  const n = cols ?? items.length;
  const cellW = (innerW - gap * (n - 1)) / n;
  items.forEach((it, i) => {
    const cx = innerX + i * (cellW + gap);
    panel(slide, cx, y, cellW, h, { fill: T.surface, line: highlight ? T.accent : T.hairline });
    const sub = it.s ? it.s : null;
    slide.addText([
      { text: it.t, options: { bold: true, fontSize: 10.5, color: T.ink, breakLine: !!sub } },
      ...(sub ? [{ text: sub, options: { fontSize: 8.5, color: T.muted } }] : []),
    ], {
      x: cx + 0.08, y, w: cellW - 0.16, h, fontFace: F.zh, align: "center", valign: "middle",
      margin: 0, lineSpacingMultiple: 1.1,
    });
  });
}

// 向下连接箭头
export function connector(slide, x, y, h = 0.16) {
  slide.addShape("downArrow", { x: x - 0.09, y, w: 0.18, h, fill: { color: T.accent }, line: { type: "none" } });
}

// 带数字圆点的条目行（壁垒/五维模型等）
export function numberedRow(slide, { x, y, w, h, n, title, desc, note, accent = T.accent }) {
  panel(slide, x, y, w, h, { fill: T.surface, line: T.hairline });
  token(slide, String(n), { x: x + 0.18, y: y + h / 2 - 0.17, w: 0.34, h: 0.34, fontSize: 16, bold: true, color: accent, align: "center" });
  slide.addText([
    { text: title, options: { bold: true, fontSize: 12.5, color: T.ink } },
    ...(desc ? [{ text: `　${desc}`, options: { fontSize: 10.5, color: T.muted } }] : []),
  ], { x: x + 0.62, y, w: w - 0.8, h, fontFace: F.zh, margin: 0, valign: "middle", lineSpacingMultiple: 1.15 });
  if (note) {
    slide.addText(note, {
      x: x + 0.62, y: y + h - 0.3, w: w - 0.8, h: 0.28, fontFace: F.zh, fontSize: 9.5,
      color: accent, margin: 0, valign: "bottom",
    });
  }
}
