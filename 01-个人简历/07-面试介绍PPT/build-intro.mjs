// ============================================================
// build-intro.mjs — 面试自我介绍 PPT（精简版 · 15 页）
// 事实口径：resume/pages/home.html
// 叙事顺序：简单自我介绍 → B2B 平台详解 → AI 简介 → 收尾
//   Part1 我是谁      2 定位 / 3 履历 / 4 核心数字
//   Part2 B2B 平台实战 5 定位价值 / 6 架构 / 7 取舍 / 8 解决问题 / 9 规范 / 10 成果 / 11 战绩
//   Part3 能带来什么  12 AI 简介 / 13 三标签 / 14 前三个月 / 15 收尾
// 设计令牌：./deck-kit.mjs
// ============================================================
import PptxGenJS from "pptxgenjs";
import {
  LAYOUT, CW, T, F, token, chrome, claim, sectionLabel, panel, band,
  bullets, table, tierRow, connector, numberedRow, STATUS,
} from "./deck-kit.mjs";

const TOTAL = 15;
const pptx = new PptxGenJS();
pptx.defineLayout({ name: "W169", width: LAYOUT.W, height: LAYOUT.H });
pptx.layout = "W169";
pptx.author = "haswhere";
pptx.title = "面试自我介绍 · B2B大宗贸易平台技术经理";

const NAME = "haswhere";
const CONTACT = "186-****-3592 ｜ 815841365@qq.com ｜ 郑州";

const PART = [
  "第一部分 · 我是谁", "第二部分 · B2B 平台实战", "第三部分 · 能带来什么",
];

function slide() {
  const s = pptx.addSlide();
  s.background = { color: T.bg };
  return s;
}

// —— 局部原语 ——
function gridX(n, gap = 0.2) {
  const w = (CW - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => ({ x: LAYOUT.M + i * (w + gap), w }));
}

function kpi(s, x, y, w, h, { eyebrow, value, label, accent = T.amber, vs = 24 }) {
  panel(s, x, y, w, h, { fill: T.surface });
  s.addText(eyebrow, {
    x: x + 0.18, y: y + 0.12, w: w - 0.32, h: 0.2, fontFace: F.en, fontSize: 8.5,
    color: T.faint, margin: 0, charSpacing: 1.2, valign: "middle",
  });
  token(s, value, {
    x: x + 0.16, y: y + 0.34, w: w - 0.24, h: 0.6, fontSize: vs, bold: true, color: accent, align: "left",
  });
  s.addText(label, {
    x: x + 0.18, y: y + h - 0.66, w: w - 0.32, h: 0.54, fontFace: F.zh, fontSize: 9.5,
    color: T.muted, margin: 0, valign: "top", lineSpacingMultiple: 1.18,
  });
}

function miniCard(s, x, y, w, h, { tag, title, text }) {
  panel(s, x, y, w, h, { fill: T.surface });
  s.addShape("rect", { x, y, w: 0.06, h, fill: { color: T.accent }, line: { type: "none" } });
  s.addText(tag, {
    x: x + 0.2, y: y + 0.1, w: w - 0.34, h: 0.18, fontFace: F.en, fontSize: 8,
    color: T.faint, margin: 0, charSpacing: 1, valign: "middle",
  });
  s.addText(title, {
    x: x + 0.2, y: y + 0.28, w: w - 0.34, h: 0.24, fontFace: F.zh, fontSize: 11.5,
    bold: true, color: T.ink, margin: 0, valign: "middle",
  });
  s.addText(text, {
    x: x + 0.2, y: y + 0.54, w: w - 0.34, h: h - 0.62, fontFace: F.zh, fontSize: 9.5,
    color: T.muted, margin: 0, valign: "top", lineSpacingMultiple: 1.2,
  });
}

// 带顶边强调的卡片（blocks 逐段换行；foot 为底部结论条）
function topCard(s, x, y, w, h, { eyebrow, title, blocks, foot, accent = T.accent, size = 11 }) {
  panel(s, x, y, w, h, { fill: T.surface });
  s.addShape("rect", { x, y, w, h: 0.07, fill: { color: accent }, line: { type: "none" } });
  const footH = foot ? 0.74 : 0;
  let cy = y + 0.22;
  if (eyebrow) {
    s.addText(eyebrow, {
      x: x + 0.2, y: cy, w: w - 0.38, h: 0.2, fontFace: F.en, fontSize: 8.5,
      color: T.faint, margin: 0, charSpacing: 1, valign: "middle",
    });
    cy += 0.28;
  }
  if (title) {
    s.addText(title, {
      x: x + 0.2, y: cy, w: w - 0.38, h: 0.34, fontFace: F.zh, fontSize: 15,
      bold: true, color: T.ink, margin: 0, valign: "middle",
    });
    cy += 0.46;
  }
  const runs = blocks.map((b, i) => ({
    text: b.text, options: { ...(b.options || {}), breakLine: i < blocks.length - 1 },
  }));
  s.addText(runs, {
    x: x + 0.2, y: cy, w: w - 0.38, h: y + h - footH - cy - 0.14, fontFace: F.zh, fontSize: size,
    color: T.muted, margin: 0, valign: "top", lineSpacingMultiple: 1.36, paraSpaceAfter: 5,
  });
  if (foot) {
    const fy = y + h - 0.64;
    s.addShape("rect", { x: x + 0.14, y: fy, w: w - 0.28, h: 0.56, fill: { color: T.surface2 }, line: { type: "none" } });
    s.addShape("rect", { x: x + 0.14, y: fy, w: 0.05, h: 0.56, fill: { color: accent }, line: { type: "none" } });
    s.addText(foot, {
      x: x + 0.3, y: fy, w: w - 0.5, h: 0.56, fontFace: F.zh, fontSize: 10, color: T.ink,
      margin: 0, valign: "middle", lineSpacingMultiple: 1.22,
    });
  }
}

// 定位锚点：标签 + 一行短句
function anchor(s, x, y, w, h, { tag, text, accent = T.accent }) {
  panel(s, x, y, w, h, { fill: T.surface });
  s.addShape("rect", { x, y, w, h: 0.05, fill: { color: accent }, line: { type: "none" } });
  s.addText(tag, {
    x: x + 0.18, y: y + 0.12, w: w - 0.32, h: 0.18, fontFace: F.en, fontSize: 8,
    color: T.faint, margin: 0, charSpacing: 1, valign: "middle",
  });
  s.addText(text, {
    x: x + 0.18, y: y + 0.35, w: w - 0.32, h: h - 0.45, fontFace: F.zh, fontSize: 10.5,
    bold: true, color: T.ink, margin: 0, valign: "top", lineSpacingMultiple: 1.24,
  });
}

// ============================================================
// 01 封面
// ============================================================
{
  const s = slide();
  const bars = [
    { h: 0.5, c: T.accentSoft }, { h: 0.9, c: T.accent }, { h: 1.5, c: T.accentDark },
    { h: 0.9, c: T.surface2 }, { h: 0.5, c: T.hairline },
  ];
  let by = 1.1;
  bars.forEach(b => {
    s.addShape("rect", { x: 11.55, y: by, w: 1.16, h: b.h, fill: { color: b.c }, line: { type: "none" } });
    by += b.h + 0.18;
  });
  s.addShape("rect", { x: 0, y: 0, w: LAYOUT.W, h: 0.14, fill: { color: T.accentDark }, line: { type: "none" } });

  sectionLabel(s, "面试自我介绍 ｜ 技术经理", 1.0, 1.5, { color: T.amber, w: 7 });
  s.addText(NAME, {
    x: 1.0, y: 1.95, w: 9, h: 1.15, fontFace: F.en, fontSize: 60, bold: true, color: T.ink, margin: 0,
  });
  s.addText("B2B 大宗商品在线交易平台 · 技术经理", {
    x: 1.0, y: 3.18, w: 9.8, h: 0.5, fontFace: F.zh, fontSize: 22, color: T.accentDark, bold: true, margin: 0,
  });
  s.addShape("line", { x: 1.0, y: 3.86, w: 8.8, h: 0, line: { color: T.hairline, width: 1 } });
  s.addText([
    { text: "13 年一线技术经验 ｜ 20 人研发团队 ｜ 异构架构治理 C + Java", options: { breakLine: true } },
    { text: "业务 × 技术双能力 ｜ B2B 交易平台从 0 到 N ｜ AI 工程化落地", options: {} },
  ], {
    x: 1.0, y: 4.06, w: 9.8, h: 0.85, fontFace: F.zh, fontSize: 14, color: T.muted, margin: 0, lineSpacingMultiple: 1.5,
  });
  s.addText([
    { text: CONTACT, options: { color: T.ink } },
  ], { x: 1.0, y: 6.3, w: 10, h: 0.35, fontFace: F.zh, fontSize: 12, margin: 0, valign: "middle" });
  s.addNotes("封面 15 秒带过，不停留。开场一句定位，再补三个标签；不要念标题。");
}

// ============================================================
// 02 自我介绍
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[0], label: "自我介绍", page: 2, total: TOTAL });
  const y0 = claim(s, "13 年一线技术，专注大宗商品交易这一个领域", {
    sub: "现任 B2B 大宗商品在线交易平台技术经理 · 带 20 人研发团队，向总经理汇报",
  });

  const lw = 7.3;
  panel(s, LAYOUT.M, y0 + 0.06, lw, 4.85, { fill: T.surface });
  sectionLabel(s, "个人简介", LAYOUT.M + 0.3, y0 + 0.24, { color: T.accent, w: 3 });
  s.addText("13 年一线技术经验，现任 B2B 大宗商品在线交易平台技术经理，负责业务中台（12+ 微服务）与数据服务中心的架构设计。平台服务大额资金交易场景——一条链路串起交易、支付、仓单、税务多个系统，任何环节出问题都是真金白银的风险。", {
    x: LAYOUT.M + 0.3, y: y0 + 0.56, w: lw - 0.6, h: 1.62, fontFace: F.zh, fontSize: 12,
    color: T.ink, margin: 0, valign: "top", lineSpacingMultiple: 1.4,
  });
  s.addShape("line", { x: LAYOUT.M + 0.3, y: y0 + 2.28, w: lw - 0.6, h: 0, line: { color: T.grid, width: 1 } });
  bullets(s, [
    [{ text: "驾驭异构架构：", options: { bold: true, color: T.ink } }, { text: "自研 DS 数据中心（防腐层）管住 C 核心引擎与 Java 微服务的全链路通信" }],
    [{ text: "技术 × 业务交叉：", options: { bold: true, color: T.ink } }, { text: "把客户一句话翻译成技术方案，守住「不让定制需求污染主链路」的红线" }],
    [{ text: "用机制替代亲力亲为：", options: { bold: true, color: T.ink } }, { text: "On-call 轮值 / 技术债台账 / 接口契约治理三件套" }],
    [{ text: "至今保持在一线：", options: { bold: true, color: T.ink } }, { text: "方案不飘——坑在哪、工作量多少，我能直接判断" }],
  ], LAYOUT.M + 0.3, y0 + 2.48, lw - 0.6, 2.25, { size: 11.5, line: 1.32 });

  const rx = LAYOUT.M + lw + 0.24;
  const rw = CW - lw - 0.24;
  const items = [
    { tag: "EXPERIENCE", title: "13 年一线", text: "专注大宗商品交易与资金场景" },
    { tag: "TEAM", title: "20 人团队", text: "3 C / 6 Java / 5 Vue / 5 测试" },
    { tag: "ARCHITECTURE", title: "12+ 微服务", text: "业务中台 + DS 数据中心两层" },
    { tag: "ROLE", title: "技术经理", text: "Java 侧负责人 · 向总经理汇报" },
  ];
  const ch = (4.85 - 3 * 0.12) / 4;
  items.forEach((it, i) => miniCard(s, rx, y0 + 0.06 + i * (ch + 0.12), rw, ch, it));
  s.addNotes("自我介绍 60 秒逐字稿：13 年一线技术 → 现在带 20 人做 B2B 大宗商品交易平台 → 四个标签（异构架构 / 技术×业务 / 机制带队 / 在一线）。全程不报名词清单。");
}

// ============================================================
// 03 工作经历（时间线）
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[0], label: "工作经历", page: 3, total: TOTAL });
  const y0 = claim(s, "工作经历：从清算开发到 20 人团队技术经理", {
    sub: "同一领域深耕 13 年——前 2 年金融级清算打底，后 11 年在同一业务域做到平台化；2024 起延伸 AI 支线",
  });

  const items = [
    { y: "2013 — 2015", role: "Java 开发工程师", org: "某软件公司 · 清算 / GIS",
      pts: ["清算与 GIS 后端开发", "日处理交易量超 10 万笔", "数据精确性 > 一切"] },
    { y: "2015 — 2020", role: "核心开发工程师", org: "某软件公司 · 交易系统",
      pts: ["从 0 到 1 参与交易系统建设", "参数化配置、多模式交易", "外部系统对接"] },
    { y: "2020 — 至今", role: "技术经理（Java 侧负责人）", org: "某软件公司 · B2B 交易平台",
      pts: ["带 20 人研发团队", "平台化 + 配置化 + 异构治理", "建规范体系与管理三件套"] },
    { y: "2024 — 至今", role: "AI 前期技术原型", org: "同一业务域的技术栈延伸",
      pts: ["模型选型 + 私有化验证", "多格式文档落向量库", "跑通 RAG 地基"] },
  ];
  const g = gridX(4, 0.2);
  const lineY = 3.2;
  s.addShape("line", { x: LAYOUT.M + 0.2, y: lineY, w: CW - 0.4, h: 0, line: { color: T.hairline, width: 1.25 } });
  items.forEach((it, i) => {
    const cx = g[i].x + g[i].w / 2;
    s.addText(it.y, {
      x: g[i].x, y: lineY - 0.5, w: g[i].w, h: 0.3, fontFace: F.en, fontSize: 11, bold: true,
      color: T.amber, align: "center", margin: 0, valign: "middle",
    });
    s.addShape("ellipse", {
      x: cx - 0.09, y: lineY - 0.09, w: 0.18, h: 0.18,
      fill: { color: T.accent }, line: { color: T.surface, width: 2 },
    });
    panel(s, g[i].x, lineY + 0.28, g[i].w, 2.8, { fill: T.surface });
    s.addShape("rect", { x: g[i].x, y: lineY + 0.28, w: g[i].w, h: 0.06, fill: { color: T.accent }, line: { type: "none" } });
    s.addText(it.role, {
      x: g[i].x + 0.18, y: lineY + 0.46, w: g[i].w - 0.34, h: 0.34, fontFace: F.zh, fontSize: 12.5,
      bold: true, color: T.ink, margin: 0, valign: "middle",
    });
    s.addText(it.org, {
      x: g[i].x + 0.18, y: lineY + 0.82, w: g[i].w - 0.34, h: 0.24, fontFace: F.zh, fontSize: 9,
      color: T.faint, margin: 0, valign: "middle",
    });
    bullets(s, it.pts, g[i].x + 0.18, lineY + 1.12, g[i].w - 0.36, 1.55, { size: 10, line: 1.26, gap: 7 });
  });
  band(s, { y: 6.42, text: "13 年 = 2 年清算 + 11 年本司；20 人 = 3 C / 6 Java / 5 Vue / 5 测试 —— 这两个数字必须脱口而出，全篇一致。" });
  s.addNotes("工作经历按「时间 → 职位 → 公司 → 职责」四段讲，重点落在 2020—至今这段（带团队、平台化、异构治理）。13 年只待过一家公司会被追问，先自己把结构讲清。");
}

// ============================================================
// 04 核心数字
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[0], label: "核心数字", page: 4, total: TOTAL });
  const y0 = claim(s, "先给结果，再讲过程", {
    sub: "运行时真实口径；涉及考核线的数字一律带「当时设定的团队目标」限定语",
  });
  const data = [
    { eyebrow: "RELIABILITY", value: "3 年+", label: "零资金差错 · 冬储高峰连续两季零 P0" },
    { eyebrow: "DELIVERY", value: "2 月 → 1 周", label: "新客户上线周期（配置化改造）" },
    { eyebrow: "INTEGRATION", value: "3 周 → 5 天", label: "外部系统对接周期（统一适配层）" },
    { eyebrow: "AVAILABILITY", value: "99.95%", label: "外部接口平均可用率" },
    { eyebrow: "EFFICIENCY", value: "5 天 → 1.5 天", label: "一笔交易周期" },
    { eyebrow: "RECONCILIATION", value: "9 人天 → 2 小时", label: "财务对账（三流自动勾稽）", vs: 18 },
    { eyebrow: "TEAM", value: "45% → 15%", label: "团队被动响应占比" },
    { eyebrow: "AUTONOMY", value: "80%", label: "线上问题团队独立处理" },
  ];
  const g = gridX(4, 0.2);
  const h = 2.05;
  data.forEach((d, i) => {
    const row = Math.floor(i / 4), col = i % 4;
    kpi(s, g[col].x, y0 + 0.1 + row * (h + 0.2), g[col].w, h, d);
  });
  band(s, { y: 6.42, text: "不要逐个念——挑三个讲：三年零资金差错、2 个月 → 1 周的上线提速、被动响应 45% → 15%。" });
  s.addNotes("这页是「先给结果」；99.95%、2 小时属运行结果可直说；故障次数/覆盖率那类考核线数字必须带「当时设定的团队目标」。");
}

// ============================================================
// 05 [B2B] 产品定位与价值 —— 这是什么产品 / 行业卡点 / 价值主张
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[1], label: "产品定位与价值", page: 5, total: TOTAL });
  const y0 = claim(s, "产品定位：把「签了合同之后的事」全部线上化、可信化、金融化", {
    sub: "大宗商品 B2B 在线交易平台 · 技术经理 / Java 侧负责人 · 覆盖交易 · 支付结算 · 履约 · 仓单 · 物流 · 税务 · 供应链金融",
  });

  // 定位锚点
  const anchors = [
    { tag: "WHAT · 是什么", text: "大宗商品 B2B 在线交易平台" },
    { tag: "MODES · 交易模式", text: "挂牌 / 竞价 / 询价 / 招标 / 点价" },
    { tag: "WHO · 服务谁", text: "能源化工国企 · 贸易商 · 产业买方" },
    { tag: "VALUE · 价值", text: "发现价格 · 阳光采购 · 供应链金融" },
  ];
  const ga = gridX(4, 0.2);
  anchors.forEach((a, i) => anchor(s, ga[i].x, y0 + 0.06, ga[i].w, 1.0, a));

  // 行业三死结
  const cards = [
    {
      eyebrow: "死结 01 · 信任", title: "跟陌生人做生意不敢",
      blocks: [{ text: "大额交易、决策链长；先打款怕不给货、先发货怕不结款，对「信任」的敏感度远高于对「价格」。" }],
      foot: "解法：平台担保 + 资金监管，钱不过对方手；履约率与成交记录公开。",
    },
    {
      eyebrow: "死结 02 · 效率", title: "一笔交易跑断腿",
      blocks: [{ text: "比价靠打电话、合同来回寄、催货靠喊、对账靠翻凭证——一笔交易 20 个电话。" }],
      foot: "解法：询价 → 合同 → 支付 → 仓储 → 物流 → 质检 → 结算 → 开票全链路线上化。",
    },
    {
      eyebrow: "死结 03 · 资金", title: "有好机会但缺钱",
      blocks: [{ text: "货压仓库占资金、账期 30–90 天拖垮现金流，有好机会也吃不下。" }],
      foot: "解法：预付款融资 / 仓单质押 / 应收账款融资——让钱不够的买方也能成交。",
    },
  ];
  const g = gridX(3, 0.24);
  cards.forEach((c, i) => topCard(s, g[i].x, y0 + 1.18, g[i].w, 3.3, { ...c, size: 11.5 }));
  band(s, { y: 6.42, text: "价值主张：让大额交易从「靠人脉、靠电话」变成「靠数据、靠系统、靠信用」——技术在这里不是成本，是增长引擎。", h: 0.55 });
  s.addNotes("先讲产品定位（这是什么、卖给谁、价值在哪），再讲行业三死结。卡点不在「找货」，在「签了合同之后」的货权、资金、交收。");
}

// ============================================================
// 06 [B2B] 系统架构
// 层序：接入层 → DS 数据中心 → 业务中台（midservice / midmon / C 核心引擎）
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[1], label: "系统架构", page: 6, total: TOTAL });
  const y0 = claim(s, "四层架构：接入层 → midservice 网关 → DS 数据中心 → 业务中台", {
    sub: "不写 C 代码，但通过 DS 防腐层管住 C 核心引擎与 Java 微服务的全链路通信",
  });
  const tiers = [
    { name: "接入层 三端", cols: 3, items: [
      { t: "PC 端 / 机构端", s: "Vue3 全栈" }, { t: "移动端", s: "触屏适配" },
      { t: "外部生态 9+", s: "银行 / 物流 / 税务 / 签章 / 供应链金融" }] },
    { name: "midservice 网关", cols: 3, items: [
      { t: "鉴权 · 限流", s: "统一入口安全控制" },
      { t: "路由 · 分发", s: "承载 12+ 业务服务" },
      { t: "接口聚合", s: "对外 API 统一出口" }] },
    { name: "DS 数据中心", cols: 3, hl: true, items: [
      { t: "协议转换", s: "TCP 自定义二进制 ↔ Hessian 标准接口" },
      { t: "可靠性", s: "重试 / 幂等 / 顺序保证" },
      { t: "可观测性", s: "链路追踪 · 指标 · 告警收敛" }] },
    { name: "业务中台", cols: 3, items: [
      { t: "12+ 业务服务", s: "交易模式 / 履约保证 / 规则配置 / 生态对接" },
      { t: "midmon 监控网关", s: "指标 · 健康度 · 告警" },
      { t: "C 核心引擎", s: "内存撮合 · 多模式交易状态机 · 确定性优先" }] },
  ];
  let y = y0 + 0.06;
  const H = [0.92, 0.92, 1.02, 1.02];
  tiers.forEach((t, i) => {
    tierRow(s, { y, h: H[i], name: t.name, items: t.items, cols: t.cols, highlight: !!t.hl });
    y += H[i];
    if (i < tiers.length - 1) { connector(s, LAYOUT.M + CW / 2, y + 0.03, 0.14); y += 0.2; }
  });
  band(s, { y: 6.42, text: "C 核心引擎换确定性 · DS 防腐层换边界可控——异构复杂度收敛在一层，两侧独立演进、互不阻塞。", h: 0.5 });
  s.addNotes("四层自下而上：接入层（三端）→ midservice 网关（鉴权/限流/路由/聚合）→ DS 数据中心（防腐层）→ 业务中台（12+ 业务服务 + midmon 监控 + C 核心引擎）。重点讲 DS 层：协议转换、可靠性、可观测性收敛在一层，这是我能管住异构通信全链路的原因。");
}

// ============================================================
// 07 [B2B] 关键取舍
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[1], label: "关键取舍", page: 7, total: TOTAL });
  const y0 = claim(s, "三个组件不是堆技术，是三次取舍", {
    sub: "每个选择背后都写清了「换到什么」和「付出什么」",
  });
  const cards = [
    {
      eyebrow: "C · 核心引擎", title: "换确定性",
      blocks: [
        { text: "换到：", options: { color: T.positive, bold: true } },
        { text: "内存撮合、毫秒级稳定延迟，不受 GC 停顿影响" },
        { text: "付出：", options: { color: T.risk, bold: true } },
        { text: "迭代慢、C 人才稀缺、与 Java 生态割裂" },
      ],
      foot: "决策：否决重写，保留 C 兜住资金链路",
    },
    {
      eyebrow: "Java · 业务中台", title: "换迭代速度",
      blocks: [
        { text: "换到：", options: { color: T.positive, bold: true } },
        { text: "12+ 微服务快速迭代，生态与人才充足" },
        { text: "付出：", options: { color: T.risk, bold: true } },
        { text: "性能天花板、依赖治理成本" },
      ],
      foot: "决策：12+ 微服务承载业务迭代与定制",
    },
    {
      eyebrow: "DS · 数据中心", title: "换边界可控",
      blocks: [
        { text: "换到：", options: { color: T.positive, bold: true } },
        { text: "异构边界收敛在一层，可观测、可治理" },
        { text: "付出：", options: { color: T.risk, bold: true } },
        { text: "多一层转发、多一套需要维护的组件" },
      ],
      foot: "决策：协议 / 可靠性 / 可观测收敛一层",
    },
  ];
  const g = gridX(3, 0.24);
  cards.forEach((c, i) => topCard(s, g[i].x, y0 + 0.1, g[i].w, 4.0, c));
  band(s, {
    y: 6.42, h: 0.55, accent: T.accentDark,
    text: "我拍板的关键决策：否决「C 核心引擎重写成 Java 完成微服务化」——撮合是资金链路心脏，GC 停顿不可接受。",
  });
  s.addNotes("这页回答「你为什么保留 C」。关键决策：否决重写。确定性 > 技术栈统一的美感；用 DS 防腐层化解异构代价。");
}

// ============================================================
// 08 [B2B] 我带队解决的问题
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[1], label: "我解决的问题", page: 8, total: TOTAL });
  const y0 = claim(s, "我带队解决的问题——每个都有打法、有结果", {
    sub: "不是「遇到就修」，是先归因到架构层，再用机制兜住" ,
  });
  const cards = [
    {
      eyebrow: "01 · 资金一致性", title: "跨月长事务",
      blocks: [
        { text: "打法：", options: { color: T.accent, bold: true } },
        { text: "Saga + 状态机 + 事件溯源" },
        { text: "结果：3 年零资金差错", options: { color: T.positive, bold: true } },
      ],
    },
    {
      eyebrow: "02 · 架构红线", title: "定制污染主链路",
      blocks: [
        { text: "打法：", options: { color: T.accent, bold: true } },
        { text: "多租户配置化（策略模式 + 配置模板）" },
        { text: "结果：上线 2 月 → 1 周，代码零膨胀", options: { color: T.positive, bold: true } },
      ],
    },
    {
      eyebrow: "03 · 异构通信", title: "C ↔ Java 边界失控",
      blocks: [
        { text: "打法：", options: { color: T.accent, bold: true } },
        { text: "DS 防腐层收敛协议 / 可靠性 / 可观测" },
        { text: "结果：两团队独立演进，互不阻塞", options: { color: T.positive, bold: true } },
      ],
    },
    {
      eyebrow: "04 · 系统集成", title: "外部对接慢",
      blocks: [
        { text: "打法：", options: { color: T.accent, bold: true } },
        { text: "统一网关适配层，覆盖 9+ 外部系统" },
        { text: "结果：2-3 周 → 3-5 天，可用率 99.95%", options: { color: T.positive, bold: true } },
      ],
    },
    {
      eyebrow: "05 · AI 协同提效", title: "推动 AI 协同开发",
      blocks: [
        { text: "打法：", options: { color: T.accent, bold: true } },
        { text: "把 AI 协同开发引入研发流程，提效的同时沉淀团队可复用资产 SKILLS" },
        { text: "结果：能力沉淀为可复用资产，团队整体提效", options: { color: T.positive, bold: true } },
      ],
    },
    {
      eyebrow: "06 · 数据同步", title: "跨模块信息丢失",
      blocks: [
        { text: "打法：", options: { color: T.accent, bold: true } },
        { text: "Kafka 事件驱动 + 本地消息表 + 幂等 + 对账兜底" },
        { text: "结果：根治，沉淀为契约治理规范", options: { color: T.positive, bold: true } },
      ],
    },
  ];
  const g = gridX(3, 0.2);
  const ch = 2.16;
  cards.forEach((c, i) => {
    const row = Math.floor(i / 3), col = i % 3;
    topCard(s, g[col].x, y0 + 0.06 + row * (ch + 0.16), g[col].w, ch, { ...c, size: 10.5 });
  });
  band(s, { y: 6.42, text: "问题先归因，再定打法，最后拿结果验收——这些打法我换个场景也能直接用。", h: 0.5 });
  s.addNotes("这页是「我到底解决了什么」。六个问题都要能讲出：问题现象 → 根因 → 打法 → 结果数字。追问时优先展开 01（资金一致性）和 02（架构红线）。");
}

// ============================================================
// 09 [B2B] 我制定的规范
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[1], label: "我制定的规范", page: 9, total: TOTAL });
  const y0 = claim(s, "我把研发过程做成「可预测、可追踪、可复盘」", {
    sub: "流程规范 + 工程规范 + 管理机制 —— 关键节点强制过审，用机制替代亲力亲为",
  });

  // 六阶段流程闸门
  const flow = [
    { t: "需求收口", s: "统一入口 · 评审" },
    { t: "设计评审", s: "方案 · 架构过审" },
    { t: "开发", s: "强制代码评审" },
    { t: "QA 验收", s: "用例 · 准出" },
    { t: "发布评审", s: "上线前闸门" },
    { t: "系统移交", s: "文档 · 交接" },
  ];
  const gf = gridX(6, 0.34);
  const fy = y0 + 0.06, fh = 1.22;
  flow.forEach((f, i) => {
    panel(s, gf[i].x, fy, gf[i].w, fh, { fill: T.surface });
    s.addShape("rect", { x: gf[i].x, y: fy, w: gf[i].w, h: 0.05, fill: { color: T.accent }, line: { type: "none" } });
    s.addText(f.t, {
      x: gf[i].x + 0.14, y: fy + 0.18, w: gf[i].w - 0.26, h: 0.34, fontFace: F.zh, fontSize: 12,
      bold: true, color: T.ink, margin: 0, valign: "middle",
    });
    s.addText(f.s, {
      x: gf[i].x + 0.14, y: fy + 0.56, w: gf[i].w - 0.26, h: 0.56, fontFace: F.zh, fontSize: 9,
      color: T.muted, margin: 0, valign: "top", lineSpacingMultiple: 1.2,
    });
    if (i < flow.length - 1) {
      s.addShape("rightArrow", {
        x: gf[i].x + gf[i].w + 0.06, y: fy + fh / 2 - 0.1, w: 0.22, h: 0.2,
        fill: { color: T.accent }, line: { type: "none" },
      });
    }
  });

  // 三类规范
  const cards = [
    {
      eyebrow: "PROCESS · 流程规范", title: "全流程闸门",
      blocks: [{ text: "覆盖需求、设计、开发、测试、发布、移交六阶段，关键节点强制过审；配套年度技术建设规划与故障复盘闭环，根因回灌规范。" }],
    },
    {
      eyebrow: "ENGINEERING · 工程规范", title: "守住架构红线",
      blocks: [{ text: "接口契约治理（管连线不管黑盒）；主链路强制代码评审；沉淀原型库与开发 skill，新人照着 skill 可独立交付典型功能。" }],
    },
    {
      eyebrow: "MECHANISM · 管理机制", title: "机制替代人治",
      blocks: [{ text: "On-call 轮值（主副双岗 + 四级 SLA）；技术债台账（20% 带宽固定偿还）；师徒制 + owner+backup 双人制，四维绩效考核。" }],
    },
  ];
  const g = gridX(3, 0.24);
  cards.forEach((c, i) => topCard(s, g[i].x, y0 + 1.5, g[i].w, 3.0, { ...c, size: 11 }));
  band(s, { y: 6.42, text: "规范的目的不是加流程，是让研发可预测、可追踪、可复盘——把个人能力沉淀成团队能力。", h: 0.5 });
  s.addNotes("这页回答「你制定了什么规范」。先说六阶段闸门（谁在什么节点把关），再讲三类规范：流程、工程、机制。强调每一条都落到了可验证的结果。");
}

// ============================================================
// 10 [B2B] 团队成果总账：四本账
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[1], label: "带队成果", page: 10, total: TOTAL });
  const y0 = claim(s, "我带队拿到的四本账", {
    sub: "交付 · 质量 · 效率 · 能力——不是个人成绩单，是体系结果",
  });
  const books = [
    { n: "01 · DELIVERY", t: "交付", items: ["12+ 微服务业务中台，从 0 到 1 建成", "销售端 + 采购端双平台并线交付", "9+ 外部系统对接（银行 / 仓储 / 税务 / 监管）"] },
    { n: "02 · QUALITY", t: "质量", items: ["3 年+ 零资金差错（交易 / 结算 / 清算）", "外联接口平均可用率 99.95%"] },
    { n: "03 · EFFICIENCY", t: "效率", items: ["新客户上线 2 月 → 1 周", "系统对接 2-3 周 → 3-5 天", "交易周期 5 天 → 1.5 天，对账 9 人天 → 2 小时"] },
    { n: "04 · CAPABILITY", t: "能力", items: ["20 人四梯队，核心模块无单点依赖", "团队独立处理 80% 线上问题，被动响应 45% → 15%", "沉淀规范 / 排查手册 / 原型库 / 开发 skill"] },
  ];
  const g = gridX(4, 0.2);
  books.forEach((b, i) => {
    panel(s, g[i].x, y0 + 0.1, g[i].w, 4.15, { fill: T.surface });
    s.addShape("rect", { x: g[i].x, y: y0 + 0.1, w: g[i].w, h: 0.07, fill: { color: T.accent }, line: { type: "none" } });
    s.addText(b.n, {
      x: g[i].x + 0.2, y: y0 + 0.28, w: g[i].w - 0.36, h: 0.2, fontFace: F.en, fontSize: 8.5,
      color: T.faint, margin: 0, charSpacing: 1, valign: "middle",
    });
    s.addText(b.t, {
      x: g[i].x + 0.2, y: y0 + 0.52, w: g[i].w - 0.36, h: 0.38, fontFace: F.zh, fontSize: 18,
      bold: true, color: T.accentDark, margin: 0, valign: "middle",
    });
    s.addShape("line", { x: g[i].x + 0.2, y: y0 + 0.98, w: g[i].w - 0.4, h: 0, line: { color: T.grid, width: 1 } });
    bullets(s, b.items, g[i].x + 0.2, y0 + 1.14, g[i].w - 0.4, 3.0, { size: 10.5, line: 1.3, gap: 8 });
  });
  band(s, { y: 6.42, h: 0.5, text: "追求的不是短期救火，而是长期可复制的研发体系——交付有节奏、质量有底线、效率可量化、能力能传承。" });
  s.addNotes("回答「你最有成就感的事」：讲四本账，每本都有交付物和数字。99.95% / 3 年零差错 / 45%→15% 可直说；覆盖率那类考核线数字带「当时设定的目标」。");
}

// ============================================================
// 11 [B2B] 客户案例：广西晔龙 + 广西林控
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[1], label: "客户案例", page: 11, total: TOTAL });
  const y0 = claim(s, "两个客户、两种业态，验证同一套平台底座", {
    sub: "民营贸易商（广西晔龙）· 国有要素交易场所（广西林控）——均为我方承建",
  });
  const g4 = gridX(4, 0.2);
  const stats = [
    { eyebrow: "EELONG · SHARE", value: ">15%", label: "进口菜粕全国第一 · 年贸易量 50 万吨", vs: 22 },
    { eyebrow: "EELONG · CUSTOMER", value: "3000 家", label: "下游饲料企业 · 郑商所产融基地", vs: 22 },
    { eyebrow: "LINKONG · BIDDING", value: "32 轮", label: "单场竞价轮次 · 溢价 18.2%", vs: 22 },
    { eyebrow: "LINKONG · MARKET", value: "2022", label: "国有全资平台上线 · 面向东盟", vs: 22 },
  ];
  stats.forEach((d, i) => kpi(s, g4[i].x, y0 + 0.06, g4[i].w, 1.6, d));

  const g2 = gridX(2, 0.24);
  topCard(s, g2[0].x, y0 + 1.8, g2[0].w, 2.65, {
    eyebrow: "CASE 01 · 广西晔龙国际贸易", title: "民营贸易商：期现结合",
    blocks: [
      { text: "画像：全国最大进口菜籽粕贸易商（份额 >15%），年贸易量 50 万吨，下游客户约 3000 家。" },
      { text: "我们解决：套保策略绑定现货合同、敞口实时计算、风险限额分级预警；预售与远期采购的履约批次拆分。" },
      { text: "价值：把「拍脑袋锁价」变成可量化、可预警的期现风控。", options: { color: T.positive, bold: true } },
    ],
    size: 10,
  });
  topCard(s, g2[1].x, y0 + 1.8, g2[1].w, 2.65, {
    eyebrow: "CASE 02 · 中国-东盟林业资源平台", title: "国有要素场所：非标资产线上化",
    blocks: [
      { text: "画像：广西林业局批准的国有全资平台（2022 上线），品种覆盖活立木、林地流转、原木、人造板。" },
      { text: "我们解决：活立木等非标资产线上化——标的清单结构化、延时竞价以服务器时间为基准、保证金三层配置。" },
      { text: "价值：公开竞价 + 全程留痕 + 结果公示，守住国有资产不被「贱卖」。", options: { color: T.positive, bold: true } },
    ],
    size: 10,
  });
  band(s, { y: 6.42, text: "一个是民营贸易商的「活下来、赚价差」，一个是国企的「不贱卖、说得清」——同一套底座，两种价值主张。", h: 0.5 });
  s.addNotes("用两个客户证明产品通用性：晔龙（民营贸易商，期现结合 / 套保风控），林控（国有要素交易场所，非标资产线上化）。都是我方承建；追问时展开各自的技术落点。");
}

// ============================================================
// 12 AI 智能服务平台（前期技术原型 · 简要）
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[1], label: "AI 前期原型", page: 12, total: TOTAL });
  const y0 = claim(s, "各类型文档 → 向量数据库：我把 RAG 的地基打扎实", {
    sub: "2024 年至今 · B2B 主线之外，做 AI 智能服务平台的前期技术原型：模型选型验证 + 多格式文档落向量库",
  });

  // 落库流程
  const pipe = [
    { n: "01", t: "多格式文档", s: "PDF / Word / Excel / 网页 / 图片" },
    { n: "02", t: "解析与清洗", s: "结构化抽取 · 去噪" },
    { n: "03", t: "切分", s: "Chunking：按语义 / 标题层级" },
    { n: "04", t: "向量化", s: "Embedding：文本 → 向量" },
    { n: "05", t: "向量数据库", s: "入库索引 · 相似度检索" },
  ];
  const g = gridX(5, 0.46);
  const py = y0 + 0.1, ph = 1.62;
  pipe.forEach((p, i) => {
    panel(s, g[i].x, py, g[i].w, ph, { fill: T.surface });
    s.addShape("rect", {
      x: g[i].x, y: py, w: g[i].w, h: 0.06,
      fill: { color: i === pipe.length - 1 ? T.accentDark : T.accent }, line: { type: "none" },
    });
    s.addText(p.n, {
      x: g[i].x + 0.18, y: py + 0.16, w: g[i].w - 0.34, h: 0.2, fontFace: F.en, fontSize: 8.5,
      color: T.faint, margin: 0, charSpacing: 1, valign: "middle",
    });
    s.addText(p.t, {
      x: g[i].x + 0.18, y: py + 0.4, w: g[i].w - 0.34, h: 0.36, fontFace: F.zh, fontSize: 12.5,
      bold: true, color: T.ink, margin: 0, valign: "middle",
    });
    s.addText(p.s, {
      x: g[i].x + 0.18, y: py + 0.84, w: g[i].w - 0.34, h: 0.64, fontFace: F.zh, fontSize: 9.5,
      color: T.muted, margin: 0, valign: "top", lineSpacingMultiple: 1.2,
    });
    if (i < pipe.length - 1) {
      s.addShape("rightArrow", {
        x: g[i].x + g[i].w + 0.07, y: py + ph / 2 - 0.13, w: 0.32, h: 0.26,
        fill: { color: T.accent }, line: { type: "none" },
      });
    }
  });

  // 我做的两件事
  const cards = [
    {
      eyebrow: "前期技术原型", title: "选型 + 私有化验证",
      blocks: [{ text: "模型选型与内网私有化（vLLM）可行性验证，跑通「文档 → 向量库 → 检索」端到端链路。" }],
    },
    {
      eyebrow: "通道判断", title: "数据敏感度决定通道",
      blocks: [{ text: "通用咨询走第三方大模型快速见效；涉密数据走内网私有化，合规与成本都占住。" }],
    },
  ];
  const g2 = gridX(2, 0.24);
  cards.forEach((c, i) => topCard(s, g2[i].x, py + ph + 0.3, g2[i].w, 2.3, { ...c, size: 11.5 }));

  band(s, { y: 6.42, text: "AI 是主线之外的一块拼图——我把重心放在前期原型与文档落库，这一步决定 RAG 能不能用、检索准不准。", h: 0.5 });
  s.addNotes("AI 页只讲两件事，不展开：① 前期技术原型——模型选型 + 私有化可行性验证；② 各类型文档落向量库的过程（解析 → 切分 → 向量化 → 入库）。");
}

// ============================================================
// 13 三个标签
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[2], label: "我的差异化", page: 13, total: TOTAL });
  const y0 = claim(s, "三个标签，钉住记忆", {
    sub: "业务翻译官 · 技术操盘手 · 流程守护者",
  });
  const cards = [
    { eyebrow: "01 · POSITIONING", title: "业务翻译官", blocks: [
      { text: "把「支持分批付款」五个字拆成 14 个子需求、识别 3 个风险点。" },
      { text: "能在评审中反问：这个合同条款的违约触发条件，系统哪个状态节点对应？" }],
      foot: "落地动作：需求评审先翻译，再谈方案" },
    { eyebrow: "02 · CAPABILITY", title: "技术操盘手", blocks: [
      { text: "在 C + Java 异构架构里做选型、评审、技术债管理。" },
      { text: "不写 C 代码，但通过防腐层管住异构通信全链路。" }],
      foot: "落地动作：异构边界明确，方案先讲坑" },
    { eyebrow: "03 · MECHANISM", title: "流程守护者", blocks: [
      { text: "建立 On-call 轮值、技术债台账、接口契约治理三大机制。" },
      { text: "让团队从被动救火转向主动建设。" }],
      foot: "落地动作：被动响应 45% → 15%" },
  ];
  const g = gridX(3, 0.24);
  cards.forEach((c, i) => topCard(s, g[i].x, y0 + 0.1, g[i].w, 4.0, c));
  band(s, {
    y: 6.42, h: 0.55, accent: T.accentDark,
    text: "责任金句：技术经理的价值不是方案多漂亮，是对可实施性与落地效果负责——坑在哪、工作量多少、风险在哪一层，我能直接判断。",
  });
  s.addNotes("收尾三标签要钉死。业务翻译官、技术操盘手、流程守护者——每个标签配一个具体动作，不说形容词。");
}

// ============================================================
// 14 我的落地打法
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[2], label: "落地打法", page: 14, total: TOTAL });
  const y0 = claim(s, "我的落地打法：先止血、再还债、后增值", {
    sub: "接手一个团队或系统，我先用机制把确定性拉起来，再用复用与 AI 提效",
  });
  const cols = [
    { tag: "第一阶段", t: "先止血", items: ["稳线上：盯核心链路与资金相关告警", "补齐监控 / 告警 / On-call 与故障流程", "梳理主链路，识别单点与最大风险"] },
    { tag: "第二阶段", t: "再还债", items: ["建技术债台账，20% 带宽固定偿还", "推接口契约治理，收敛跨模块耦合", "补关键回归与自动化，减少手工发布"] },
    { tag: "第三阶段", t: "后增值", items: ["复用底座与配置化，压缩新需求交付周期", "AI 提效：知识检索 / 研发辅助落地", "沉淀规范与人才梯队，机制可自转"] },
  ];
  const g = gridX(3, 0.24);
  cols.forEach((c, i) => {
    panel(s, g[i].x, y0 + 0.1, g[i].w, 4.1, { fill: T.surface });
    s.addShape("rect", { x: g[i].x, y: y0 + 0.1, w: g[i].w, h: 0.07, fill: { color: T.accent }, line: { type: "none" } });
    s.addText(c.tag, {
      x: g[i].x + 0.24, y: y0 + 0.28, w: g[i].w - 0.4, h: 0.22, fontFace: F.en, fontSize: 9,
      color: T.faint, margin: 0, charSpacing: 1, valign: "middle",
    });
    s.addText(c.t, {
      x: g[i].x + 0.24, y: y0 + 0.56, w: g[i].w - 0.4, h: 0.4, fontFace: F.zh, fontSize: 19,
      bold: true, color: T.accentDark, margin: 0, valign: "middle",
    });
    s.addShape("line", { x: g[i].x + 0.24, y: y0 + 1.06, w: g[i].w - 0.48, h: 0, line: { color: T.grid, width: 1 } });
    bullets(s, c.items, g[i].x + 0.24, y0 + 1.22, g[i].w - 0.48, 2.85, { size: 11, line: 1.3, gap: 10 });
  });
  band(s, { y: 6.42, h: 0.5, text: "先让团队从救火里抽身，再用复用和 AI 把效率拉起来——这是我换了场景也能复用的打法。" });
  s.addNotes("这页讲我的工作方法：先止血、再还债、后增值——按阶段推进，重点是让面试官看到我有方法，不是只有热情。");
}

// ============================================================
// 15 收尾
// ============================================================
{
  const s = slide();
  s.addShape("rect", { x: 0, y: 0, w: LAYOUT.W, h: 0.14, fill: { color: T.accentDark }, line: { type: "none" } });
  sectionLabel(s, "SUMMARY · 三个标签", 1.0, 1.15, { color: T.amber, w: 6 });
  s.addText("业务翻译官 · 技术操盘手 · 流程守护者", {
    x: 1.0, y: 1.55, w: 11.3, h: 0.95, fontFace: F.zh, fontSize: 40, bold: true, color: T.ink, margin: 0, valign: "middle",
  });
  s.addShape("line", { x: 1.0, y: 2.72, w: 11.0, h: 0, line: { color: T.hairline, width: 1 } });
  panel(s, 1.0, 2.98, 11.0, 1.24, { fill: T.surface2 });
  s.addShape("rect", { x: 1.0, y: 2.98, w: 0.07, h: 1.24, fill: { color: T.accent }, line: { type: "none" } });
  s.addText([
    { text: "责任金句：", options: { bold: true, color: T.accentDark } },
    { text: "技术经理的价值不是方案多漂亮，是对可实施性与落地效果负责——坑在哪、工作量多少、风险在哪一层，我能直接判断，不给团队挖坑。", options: {} },
  ], { x: 1.24, y: 2.98, w: 10.6, h: 1.24, fontFace: F.zh, fontSize: 14.5, color: T.ink, margin: 0, valign: "middle", lineSpacingMultiple: 1.4 });

  s.addShape("line", { x: 1.0, y: 4.52, w: 11.0, h: 0, line: { color: T.hairline, width: 1 } });
  sectionLabel(s, "THANK YOU", 1.0, 4.76, { color: T.amber, w: 4 });
  s.addText("我的介绍完了。谢谢", {
    x: 1.0, y: 5.08, w: 11.0, h: 0.9, fontFace: F.zh, fontSize: 36, bold: true,
    color: T.accentDark, margin: 0, valign: "middle",
  });
  s.addNotes("收尾 30 秒：三标签钉死 → 责任金句 → 一句「我的介绍完了，谢谢」收住，然后把时间交给面试官。");
}

// —— 输出 ——
const out = "面试自我介绍-haswhere.pptx";
await pptx.writeFile({ fileName: out });
console.log("OK ->", out, "slides:", TOTAL);
