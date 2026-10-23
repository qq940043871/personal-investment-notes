// ============================================================
// build-deck.mjs — 个人简历介绍 PPT（24 页）
// 内容蓝本：prep/09-个人简历/08-简历与自我介绍脚本.md 第二部分
// 数据校准：resume/pages/home.html（真实口径数字）
// ============================================================
import PptxGenJS from "pptxgenjs";
import {
  LAYOUT, CW, T, F, token, chrome, claim, sectionLabel, panel, band,
  bullets, table, tierRow, connector, numberedRow, STATUS,
} from "./deck-kit.mjs";

const pptx = new PptxGenJS();
pptx.defineLayout({ name: "W169", width: LAYOUT.W, height: LAYOUT.H });
pptx.layout = "W169";
pptx.author = "haswhere";
pptx.title = "个人简历介绍 · B2B大宗贸易平台技术经理";

const NAME = "haswhere";
const CONTACT = "186-****-3592 ｜ 815841365@qq.com ｜ 郑州";

function slide() {
  const s = pptx.addSlide();
  s.background = { color: T.bg };
  return s;
}
const PART = [
  "第一部分 · 开场定位", "第二部分 · 系统架构", "第三部分 · 业务深度",
  "第四部分 · 技术深度", "第五部分 · 管理能力", "第六部分 · 成长规划",
];

// ============================================================
// Slide 1 封面
// ============================================================
{
  const s = slide();
  // 身份层：右侧竖向架构条带（低频装饰）
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

  sectionLabel(s, "个人简历介绍 ｜ 面试 · 述职 · 路演", 1.0, 1.55, { color: T.amber, w: 7 });
  s.addText(NAME, {
    x: 1.0, y: 2.0, w: 9, h: 1.15, fontFace: F.en, fontSize: 60, bold: true, color: T.ink, margin: 0,
  });
  s.addText("B2B 大宗贸易供应链平台 · 技术经理", {
    x: 1.0, y: 3.25, w: 9.5, h: 0.5, fontFace: F.zh, fontSize: 22, color: T.accentDark, bold: true, margin: 0,
  });
  s.addShape("line", { x: 1.0, y: 3.95, w: 8.6, h: 0, line: { color: T.hairline, width: 1 } });
  s.addText([
    { text: "Java + Vue 全栈 ｜ 异构架构治理", options: { breakLine: true } },
    { text: "交易系统 ｜ 供应链金融 ｜ 平台化建设 ｜ 13 年一线技术经验", options: {} },
  ], {
    x: 1.0, y: 4.15, w: 9.5, h: 0.85, fontFace: F.zh, fontSize: 14, color: T.muted, margin: 0, lineSpacingMultiple: 1.5,
  });
  s.addText([
    { text: CONTACT, options: { color: T.ink } },
    { text: "  ｜  2026", options: { color: T.faint } },
  ], { x: 1.0, y: 6.35, w: 10, h: 0.35, fontFace: F.zh, fontSize: 12, margin: 0, valign: "middle" });
  s.addNotes("封面 15 秒带过，不停留。");
}

// ============================================================
// Slide 2 一句话定位
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[0], label: "一句话定位", page: 2 });
  const y0 = claim(s, "我做什么，我的差异化是什么", { sub: "30 秒内建立第一印象——三个标签要刻在面试官脑子里" });

  panel(s, LAYOUT.M, y0 + 0.1, CW, 1.62, { fill: T.surface });
  sectionLabel(s, "我做什么", LAYOUT.M + 0.25, y0 + 0.26, { color: T.accent });
  s.addText("负责大宗商品 B2B 交易平台的业务中台，管理交易撮合、履约保证、数据服务、规则配置和生态对接五大核心模块；带 20 人团队（3C / 6Java / 5Vue / 5测试），对接 9+ 外部系统。", {
    x: LAYOUT.M + 0.25, y: y0 + 0.56, w: CW - 0.5, h: 1.0, fontFace: F.zh, fontSize: 13.5, color: T.ink, margin: 0, lineSpacingMultiple: 1.45, valign: "top",
  });

  const ty = y0 + 1.95;
  sectionLabel(s, "我的差异化 —— 三个标签", LAYOUT.M, ty, { color: T.amber });
  const tags = [
    ["01", "驾驭 C+Java 异构架构", "管住黑盒的经典防腐层范式，市场稀缺"],
    ["02", "技术 × 业务深度交叉", "懂撮合引擎，也懂大宗贸易全链路"],
    ["03", "三年零资金差错", "大额资金场景的金融级可靠性"],
  ];
  tags.forEach((t, i) => {
    const x = LAYOUT.M + i * (CW / 3 + 0.02) - i * 0.04;
    const w = CW / 3 - 0.12;
    panel(s, x, ty + 0.32, w, 1.72, { fill: T.surface, line: T.hairline });
    s.addShape("rect", { x, y: ty + 0.32, w, h: 0.06, fill: { color: T.accent }, line: { type: "none" } });
    token(s, t[0], { x: x + 0.22, y: ty + 0.52, w: 0.7, h: 0.4, fontSize: 24, bold: true, color: T.amber });
    s.addText(t[1], { x: x + 0.22, y: ty + 0.98, w: w - 0.4, h: 0.42, fontFace: F.zh, fontSize: 14.5, bold: true, color: T.ink, margin: 0 });
    s.addText(t[2], { x: x + 0.22, y: ty + 1.4, w: w - 0.4, h: 0.55, fontFace: F.zh, fontSize: 10.5, color: T.muted, margin: 0, lineSpacingMultiple: 1.3 });
  });

  band(s, {
    y: ty + 2.35, h: 0.5, accent: T.amber, size: 12,
    runs: [{ text: "加分句：", options: { bold: true, color: T.amber } },
    { text: "我至今保持在一线——方案能不能落地、坑在哪、工作量多少，我能直接判断，不给团队挖坑。", options: { bold: true } }],
  });
  s.addNotes("定调页。三个标签必须脱口而出。");
}

// ============================================================
// Slide 3 核心数据看板
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[0], label: "核心数据看板", page: 3 });
  const y0 = claim(s, "用数据建立可信度", { sub: "面试官判断段位，先看数字再听故事" });

  const quads = [
    ["平台规模", T.accent, [
      ["13年", "一线技术经验（2年清算 + 11年本司）"],
      ["100+", "大客户差异化支撑，代码零膨胀"],
      ["20人", "研发团队 · 3C/6Java/5Vue/5测试"],
    ]],
    ["技术指标", T.accent, [
      ["12+", "Java 微服务（业务中台）"],
      ["9+", "外部系统对接（银行/物流/税务…）"],
      ["4层", "接入 / 网关 / 中台 / 数据 异构架构"],
    ]],
    ["业务价值", T.amber, [
      ["5天→1.5天", "交易周期"],
      ["2个月→1周", "新客户上线周期"],
      ["20→50笔/月", "月交易量翻倍"],
    ]],
    ["质量指标", T.positive, [
      ["3年", "零资金差错"],
      ["99.95%", "外部接口平均可用率"],
      ["连续两季", "冬储高峰零 P0 事故"],
    ]],
  ];
  const gw = (CW - 0.24) / 2, gh = 2.12;
  quads.forEach((q, i) => {
    const x = LAYOUT.M + (i % 2) * (gw + 0.24);
    const y = y0 + 0.12 + Math.floor(i / 2) * (gh + 0.18);
    panel(s, x, y, gw, gh, { fill: T.surface });
    s.addShape("rect", { x, y, w: 0.07, h: gh, fill: { color: q[1] }, line: { type: "none" } });
    sectionLabel(s, q[0], x + 0.24, y + 0.14, { color: q[1] });
    q[2].forEach((r, ri) => {
      const ry = y + 0.48 + ri * 0.5;
      token(s, r[0], { x: x + 0.24, y: ry, w: 2.1, h: 0.4, fontSize: 18, bold: true, color: T.accentDark });
      s.addText(r[1], { x: x + 2.5, y: ry, w: gw - 2.75, h: 0.4, fontFace: F.zh, fontSize: 10.5, color: T.muted, margin: 0, valign: "middle" });
    });
  });
  band(s, { y: 6.4, h: 0.5, accent: T.positive, size: 12.5, runs: [{ text: "最有力的一句话：", options: { bold: true, color: T.positive } }, { text: "三年零资金差错——这是大额资金场景给我的名片。", options: { bold: true } }] });
  s.addNotes("用数据建立可信度。零资金差错是最有力的一句话。");
}

// ============================================================
// Slide 4 系统架构全景
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[1], label: "系统架构全景", page: 4 });
  const y0 = claim(s, "四层架构 + 双核驱动 + 9+ 外部生态", { sub: "先讲分层（30秒），再展开双核（1分钟），最后扫外部接口矩阵" });

  let y = y0 + 0.08;
  const H = 0.62, G = 0.16;
  tierRow(s, { y, h: H, name: "接入层", items: [
    { t: "外部大屏" }, { t: "普通客户 PC" }, { t: "机构客户 PC" }, { t: "移动端（Vue）" },
  ] });
  connector(s, LAYOUT.M + CW / 2, y + H + 0.02, 0.14); y += H + G;
  tierRow(s, { y, h: H, name: "网关层", highlight: true, items: [
    { t: "midservice 业务网关", s: "鉴权 / 限流 / 路由 —— 管请求怎么进" },
    { t: "midmon 监控网关", s: "指标 / 健康度 / 告警 —— 管系统怎么样" },
    { t: "Java 自研", s: "非开源组件，深度定制" },
  ], cols: 3 });
  connector(s, LAYOUT.M + CW / 2, y + H + 0.02, 0.14); y += H + G;
  tierRow(s, { y, h: 1.28, name: "业务中台\n（核心）", highlight: true, items: [
    { t: "管理系统 10+ 模块" }, { t: "DS 数据中心", s: "Java 桥接 / 防腐层" }, { t: "交易核心", s: "C 语言内存撮合" },
    { t: "业务服务集群", s: "12+ 微服务：认证/账本/合同/资金/挂牌/竞价/风控…" },
  ], cols: 4 });
  connector(s, LAYOUT.M + CW / 2, y + 1.28 + 0.02, 0.14); y += 1.28 + G;
  tierRow(s, { y, h: H, name: "数据层", items: [
    { t: "MySQL ×2", s: "主从 + 分库分表" }, { t: "Redis", s: "缓存 / 分布式锁" }, { t: "MinIO", s: "对象存储" }, { t: "ES", s: "全文检索" },
  ] });
  y += H + G;
  tierRow(s, { y, h: H, name: "外部生态", items: [
    { t: "银行 ×5" }, { t: "物流 WMS" }, { t: "CTRM" }, { t: "税务" }, { t: "电子签章" }, { t: "企查查 / 金融" },
  ], cols: 6 });

  band(s, { y: 6.42, h: 0.5, size: 11.5, runs: [
    { text: "讲法要点：", options: { bold: true, color: T.accent } },
    { text: "每层按「为什么存在 / 不这么做会怎样 / 取舍了什么」讲——两个网关分工一句话说清。", options: {} },
  ] });
  s.addNotes("最有料的一页。midservice=业务网关，midmon=监控网关，别含糊成中间件网关。");
}

// ============================================================
// Slide 5 双核驱动
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[1], label: "双核驱动 · 异构架构核心设计", page: 5 });
  const y0 = claim(s, "DS 数据中心 + 交易核心：管住黑盒的经典范式", { sub: "不把 Java 写进 C 撮合引擎，也不把 C 逻辑外泄到 Java 业务层" });

  const lx = LAYOUT.M, lw = 6.4;
  let y = y0 + 0.15;
  const box = (h, title, sub, fill, line, tc) => {
    panel(s, lx, y, lw, h, { fill, line });
    s.addText(title, { x: lx + 0.2, y, w: lw - 0.4, h: h * 0.52, fontFace: F.zh, fontSize: 13.5, bold: true, color: tc ?? T.ink, margin: 0, valign: "bottom" });
    s.addText(sub, { x: lx + 0.2, y: y + h * 0.5, w: lw - 0.4, h: h * 0.5, fontFace: F.zh, fontSize: 9.5, color: T.muted, margin: 0, valign: "top", lineSpacingMultiple: 1.2 });
  };
  const link = (txt) => {
    connector(s, lx + lw / 2, y + 0.02, 0.24);
    s.addText(txt, { x: lx + lw / 2 + 0.22, y: y - 0.04, w: 3.4, h: 0.32, fontFace: F.en, fontSize: 9.5, color: T.accent, margin: 0, valign: "middle" });
    y += 0.32;
  };
  box(0.92, "Java 业务编排层", "订单 / 风控 / 结算 / 报表 / 生态对接", T.surface, T.hairline); y += 0.92;
  link("Hessian over HTTP（同步） · Socket（异步）");
  box(0.92, "DS 数据中心（Java）", "桥接层 / 防腐层 Anti-Corruption Layer —— 协议转换、连接管理、可靠性收敛于一层", T.accentSoft, T.accent, T.accentDark); y += 0.92;
  link("TCP 自定义二进制协议");
  box(0.92, "交易核心（C 语言）", "单线程内存撮合 · 纳秒级延迟确定性 · 无 GC 停顿 · 异步落库", T.surface, T.hairline); y += 0.92;

  const rx = lx + lw + 0.3, rw = CW - lw - 0.3;
  panel(s, rx, y0 + 0.15, rw, 3.7, { fill: T.surface });
  sectionLabel(s, "核心设计理念", rx + 0.22, y0 + 0.32, { color: T.accent });
  bullets(s, [
    [{ text: "C 负责「快」", options: { bold: true } }, { text: "——撮合不能有 GC 停顿" }],
    [{ text: "Java 负责「稳」", options: { bold: true } }, { text: "——业务编排灵活可迭代" }],
    [{ text: "DS 负责「翻译」", options: { bold: true } }, { text: "——异构复杂度收敛在一层" }],
    [{ text: "两个团队独立演进", options: { bold: true } }, { text: "——C 团队与 Java 团队互不阻塞" }],
  ], rx + 0.22, y0 + 0.68, rw - 0.44, 2.6, { size: 12, gap: 10, line: 1.35 });

  band(s, { y: 6.4, h: 0.52, accent: T.amber, size: 11.5, runs: [
    { text: "选型决策：", options: { bold: true, color: T.amber } },
    { text: "否决「C 撮合引擎重写成 Java」——撮合是资金链路心脏，GC 停顿不可接受；保留 C + DS 防腐层，确定性与可维护性兼得。", options: {} },
  ] });
  s.addNotes("技术杀手锏页。金句：用 DS 做翻译官——异构架构的经典范式。");
}

// ============================================================
// Slide 6 技术栈全景
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[1], label: "技术栈全景", page: 6 });
  const y0 = claim(s, "驾驭的技术广度", { sub: "快速扫一遍即可——重点是广度，细节等面试官追问" });

  const rows = [
    ["接入层", "Vue 前端（PC + 移动端 + 大屏三端） ｜ Nginx"],
    ["网关层", "midservice 业务网关（Java 自研） ｜ midmon 监控网关"],
    ["业务中台", "Java 微服务（Spring Cloud 生态） ｜ DS 数据中心（Hessian + Socket） ｜ 交易核心（C 语言内存撮合）"],
    ["数据存储", "MySQL（主从 / 分库分表） ｜ Redis（缓存 / 分布式锁） ｜ MinIO 对象存储 ｜ Elasticsearch"],
    ["中间件", "Kafka（outbox 本地消息表 + 消费幂等） ｜ Canal CDC ｜ XXL-Job ｜ Redisson ｜ Drools 规则引擎"],
    ["运维部署", "Docker + K8s ｜ GitLab CI/CD ｜ Prometheus + Grafana"],
    ["异构通信", "TCP 自定义二进制协议 ｜ Hessian 序列化 ｜ Socket 长连接"],
    ["外部对接", "银行 / 物流 WMS / CTRM / 税务 / 电子签章 / 企查查 / 供应链金融（9+ 接口）"],
  ];
  rows.forEach((r, i) => {
    const y = y0 + 0.12 + i * 0.64;
    panel(s, LAYOUT.M, y, 1.75, 0.58, { fill: i % 2 === 0 ? T.accentSoft : T.surface2, line: null });
    s.addText(r[0], { x: LAYOUT.M, y, w: 1.75, h: 0.58, fontFace: F.zh, fontSize: 11.5, bold: true, color: T.accentDark, align: "center", valign: "middle", margin: 0 });
    panel(s, LAYOUT.M + 1.87, y, CW - 1.87, 0.58, { fill: T.surface, line: T.hairline });
    s.addText(r[1], { x: LAYOUT.M + 2.1, y, w: CW - 2.3, h: 0.58, fontFace: F.zh, fontSize: 11, color: T.ink, valign: "middle", margin: 0 });
  });
  s.addNotes("不逐个讲，展示广度即可。");
}

// ============================================================
// Slide 7 深度区 vs 治理区
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[1], label: "技术深度区 vs 治理区", page: 7 });
  const y0 = claim(s, "我管什么、怎么管：守心脏，不管全部", { sub: "高级技术经理的标志是知道什么该管、什么该放" });

  const colW = (CW - 0.3) / 2;
  // 左：深度区
  panel(s, LAYOUT.M, y0 + 0.12, colW, 3.9, { fill: T.surface, line: T.accent });
  s.addShape("rect", { x: LAYOUT.M, y: y0 + 0.12, w: colW, h: 0.5, fill: { color: T.accent }, line: { type: "none" } });
  s.addText("深度区 —— 直接掌控", { x: LAYOUT.M, y: y0 + 0.12, w: colW, h: 0.5, fontFace: F.zh, fontSize: 13, bold: true, color: "FFFFFF", align: "center", valign: "middle", margin: 0 });
  bullets(s, [
    "交易模式（挂牌 / 竞价 / 询价 / 招标 / 基差点价）",
    "履约保证（仓单 / 质检 / 交收）",
    "数据服务（行情 / 报表 / 对账）",
    "规则配置（计费 / 风控 / 促销）",
    "生态对接（银行 / 仓储 / 物流 / 税务）",
  ], LAYOUT.M + 0.25, y0 + 0.78, colW - 0.5, 2.3, { size: 11.5, gap: 7 });
  s.addText("→ 平台耦合最复杂的「心脏」：我直接 review 代码、做架构决策", {
    x: LAYOUT.M + 0.25, y: y0 + 3.35, w: colW - 0.5, h: 0.55, fontFace: F.zh, fontSize: 10.5, bold: true, color: T.accent, margin: 0, lineSpacingMultiple: 1.25, valign: "top",
  });

  // 右：治理区
  const rx = LAYOUT.M + colW + 0.3;
  panel(s, rx, y0 + 0.12, colW, 3.9, { fill: T.surface, line: T.hairline });
  s.addShape("rect", { x: rx, y: y0 + 0.12, w: colW, h: 0.5, fill: { color: T.surface2 }, line: { type: "none" } });
  s.addText("治理区 —— 契约管理", { x: rx, y: y0 + 0.12, w: colW, h: 0.5, fontFace: F.zh, fontSize: 13, bold: true, color: T.accentDark, align: "center", valign: "middle", margin: 0 });
  const gov = [
    ["◇ 交易核心（C 撮合）", "通过 DS 桥接层 + 可观测性管控"],
    ["◇ 财务清结算", "通过接口契约 + SLA 管控"],
    ["◇ 物流执行 / 风控引擎", "通过依赖风险地图管控"],
  ];
  gov.forEach((g, i) => {
    const gy = y0 + 0.78 + i * 0.82;
    s.addText(g[0], { x: rx + 0.25, y: gy, w: colW - 0.5, h: 0.32, fontFace: F.zh, fontSize: 11.5, bold: true, color: T.ink, margin: 0 });
    s.addText("→ " + g[1], { x: rx + 0.45, y: gy + 0.32, w: colW - 0.7, h: 0.32, fontFace: F.zh, fontSize: 10.5, color: T.muted, margin: 0 });
  });
  s.addText("→ 管「连线」不管「黑盒内部」：守住接口、SLA、爆炸半径", {
    x: rx + 0.25, y: y0 + 3.35, w: colW - 0.5, h: 0.55, fontFace: F.zh, fontSize: 10.5, bold: true, color: T.accentDark, margin: 0, lineSpacingMultiple: 1.25, valign: "top",
  });

  band(s, { y: 6.4, h: 0.5, accent: T.amber, runs: [{ text: "管理理念：", options: { bold: true, color: T.amber } }, { text: "用机制替代亲力亲为。", options: { bold: true } }] });
  s.addNotes("金句：我守心脏，不管全部。展示管理成熟度。");
}

// ============================================================
// Slide 8 数据流：一笔交易的技术链路
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[1], label: "数据流 · 一笔挂牌交易", page: 8 });
  const y0 = claim(s, "一笔挂牌交易经过的完整技术链路", { sub: "把所有技术点串成一条链——中间件不是孤立的" });

  const steps = [
    ["买方下单", "行情比价 → 选择挂牌 → 提交订单", null],
    ["网关层 midservice", "鉴权 / 限流 / 路由", null],
    ["交易服务（Java）", "创建订单", "Redis SETNX 防重复提交 ｜ Redisson 锁防超卖"],
    ["DS 数据中心 → C 撮合", "Hessian → 二进制协议 → 内存撮合", "撮合结果异步落库"],
    ["撮合成功 → Kafka", "outbox 本地消息表 + 消费幂等", "异步通知 4 个下游：仓储备货 / 财务记账 / 风控调额度 / 客户通知"],
    ["Saga 分布式事务", "锁库存 → 扣额度 → 创建合同", "失败反向补偿，保证最终一致"],
  ];
  const bh = 0.54, gap = 0.1;
  let y = y0 + 0.1;
  steps.forEach((st, i) => {
    panel(s, LAYOUT.M, y, 3.6, bh, { fill: i >= 2 && i <= 4 ? T.accentSoft : T.surface, line: i >= 2 && i <= 4 ? T.accent : T.hairline });
    s.addText(st[0], { x: LAYOUT.M + 0.15, y, w: 3.3, h: bh * 0.55, fontFace: F.zh, fontSize: 11, bold: true, color: T.ink, margin: 0, valign: "bottom" });
    s.addText(st[1], { x: LAYOUT.M + 0.15, y: y + bh * 0.5, w: 3.3, h: bh * 0.5, fontFace: F.zh, fontSize: 8.5, color: T.muted, margin: 0, valign: "top" });
    if (st[2]) {
      s.addShape("line", { x: LAYOUT.M + 3.6, y: y + bh / 2, w: 0.35, h: 0, line: { color: T.hairline, width: 1 } });
      s.addText(st[2], { x: LAYOUT.M + 4.05, y, w: CW - 4.05 - 0.1, h: bh, fontFace: F.zh, fontSize: 10, color: T.accentDark, margin: 0, valign: "middle", lineSpacingMultiple: 1.15 });
    }
    if (i < steps.length - 1) connector(s, LAYOUT.M + 1.8, y + bh + 0.01, 0.12);
    y += bh + gap;
  });

  const extraY = y + 0.06;
  s.addText([
    { text: "▪ 规则引擎 Drools", options: { bold: true, color: T.accent } },
    { text: " —— 实时计算手续费，热更新不重启", options: { color: T.ink } },
  ], { x: LAYOUT.M, y: extraY, w: CW, h: 0.28, fontFace: F.zh, fontSize: 11, margin: 0, valign: "middle" });
  s.addText([
    { text: "▪ Canal CDC", options: { bold: true, color: T.accent } },
    { text: " —— binlog 同步缓存服务加速行情网页 ｜ 全链路 traceId + Prometheus + Grafana 可观测", options: { color: T.ink } },
  ], { x: LAYOUT.M, y: extraY + 0.3, w: CW, h: 0.28, fontFace: F.zh, fontSize: 11, margin: 0, valign: "middle" });

  band(s, { y: 6.45, h: 0.5, size: 11.5, runs: [
    { text: "金句：", options: { bold: true, color: T.accent } },
    { text: "这套组合解决三件最难的事——高并发撮合、长周期一致、规则热更。", options: { bold: true } },
  ] });
  s.addNotes("串链页。Redis/锁/MQ/Saga/规则引擎/CDC/ES 一条链讲通。");
}

// ============================================================
// Slide 9 业务全链路
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[2], label: "业务全链路", page: 9 });
  const y0 = claim(s, "一笔大宗交易的生命周期：从挂牌到结算", { sub: "用业务语言讲——大宗跟淘宝不一样：价格跟期货走、一笔几百万、合同十几页、付款分三四次" });

  const steps = [
    ["1. 挂牌报价", "卖方发布，实时行情"],
    ["2. 询价撮合", "买方标准化比价"],
    ["3. 合同签约", "模板化 + 电子签章"],
    ["4. 备货发货", "仓单流转 + 物流跟踪"],
    ["5. 收货验收", "质检 + 异议处理"],
    ["6. 结算支付", "银企直连，分期付款"],
    ["7. 收款对账", "自动对账 + 开票"],
    ["8. 售后服务", "流失预警 + 复购"],
  ];
  const cw2 = (CW - 0.7) / 4, ch2 = 1.15;
  steps.forEach((st, i) => {
    const x = LAYOUT.M + (i % 4) * (cw2 + 0.22);
    const y = y0 + 0.15 + Math.floor(i / 4) * (ch2 + 0.42);
    panel(s, x, y, cw2, ch2, { fill: T.surface, line: T.hairline });
    token(s, `0${i + 1}`, { x: x + 0.16, y: y + 0.12, w: 0.6, h: 0.32, fontSize: 15, bold: true, color: T.amber });
    s.addText(st[0], { x: x + 0.16, y: y + 0.42, w: cw2 - 0.32, h: 0.3, fontFace: F.zh, fontSize: 12, bold: true, color: T.ink, margin: 0 });
    s.addText(st[1], { x: x + 0.16, y: y + 0.72, w: cw2 - 0.32, h: 0.35, fontFace: F.zh, fontSize: 9.5, color: T.muted, margin: 0 });
    if (i % 4 !== 3) s.addShape("rightArrow", { x: x + cw2 + 0.015, y: y + ch2 / 2 - 0.07, w: 0.2, h: 0.14, fill: { color: T.accent }, line: { type: "none" } });
  });

  const ry = y0 + 0.15 + 2 * (ch2 + 0.42) + 0.1;
  const vs = [
    ["交易周期", "线下 5–7 天", "平台 1–1.5 天"],
    ["月交易量", "20 笔", "50 笔"],
    ["沟通成本", "20 个电话", "3 次点击"],
  ];
  const vw = (CW - 0.4) / 3;
  vs.forEach((v, i) => {
    const x = LAYOUT.M + i * (vw + 0.2);
    panel(s, x, ry, vw, 1.05, { fill: T.surface2, line: null });
    s.addText(v[0], { x: x + 0.18, y: ry + 0.08, w: vw - 0.36, h: 0.28, fontFace: F.zh, fontSize: 10.5, bold: true, color: T.accentDark, margin: 0 });
    s.addText([
      { text: v[1], options: { color: T.faint, fontSize: 11, strike: true } },
      { text: "  →  ", options: { color: T.amber, bold: true, fontSize: 12 } },
      { text: v[2], options: { color: T.ink, bold: true, fontSize: 14 } },
    ], { x: x + 0.18, y: ry + 0.4, w: vw - 0.36, h: 0.55, fontFace: F.zh, margin: 0, valign: "middle" });
  });
  s.addNotes("讲业务不讲技术。金句见备注。");
}

// ============================================================
// Slide 10 平台三层价值
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[2], label: "平台三层价值", page: 10 });
  const y0 = claim(s, "效率是入场券，风险是生死线，增长才是壁垒", { sub: "从下往上讲，层层递进——回答老板的问题：投了几千万，带来了什么？" });

  const layers = [
    ["第三层 · 增长价值（最高级）", "帮客户多赚钱、做大生意", "供应链金融：交易数据 → 金融资产，让钱不够的买方也能成交 ｜ 月交易量 20→50 笔 ｜ 采购效率 +40%", T.accentDark, "FFFFFF"],
    ["第二层 · 风险价值（B2B 特有）", "帮客户避免资金 / 合规风险", "三年零资金差错 ｜ 电子仓单杜绝一货多押 ｜ 关键合同条款自动校验", T.accent, "FFFFFF"],
    ["第一层 · 效率价值（最易量化）", "帮客户省时间、省人力", "交易周期 5天→1.5天 ｜ 财务对账 9人天→2小时 ｜ 签约 1周→1天", T.accentSoft, T.accentDark],
  ];
  const lh = 1.32;
  layers.forEach((l, i) => {
    const y = y0 + 0.18 + i * (lh + 0.16);
    panel(s, LAYOUT.M, y, CW, lh, { fill: l[3], line: null });
    s.addText(l[0], { x: LAYOUT.M + 0.3, y: y + 0.1, w: CW - 0.6, h: 0.32, fontFace: F.zh, fontSize: 13.5, bold: true, color: l[4], margin: 0 });
    s.addText(l[1], { x: LAYOUT.M + 0.3, y: y + 0.44, w: 3.4, h: 0.28, fontFace: F.zh, fontSize: 10.5, color: l[4], margin: 0, italic: true });
    s.addText(l[2], { x: LAYOUT.M + 0.3, y: y + 0.74, w: CW - 0.6, h: 0.5, fontFace: F.zh, fontSize: 11.5, color: l[4], margin: 0, lineSpacingMultiple: 1.3 });
  });
  band(s, { y: y0 + 0.18 + 3 * (lh + 0.16) + 0.04, h: 0.5, accent: T.amber, size: 11.5, runs: [
    { text: "飞轮：", options: { bold: true, color: T.amber } },
    { text: "有了真实交易数据才能做供应链金融；金融一做起来，客户更离不开平台。", options: { bold: true } },
  ] });
  s.addNotes("开口说三层就必须数出三层。金融服务只背一句：让钱不够的买方也能成交，直接提高成交率。");
}

// ============================================================
// Slide 11 为什么客户愿意来平台
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[2], label: "四种价值 · 客户为什么来", page: 11 });
  const y0 = claim(s, "为什么上下游愿意来平台交易？", { sub: "线下老关系信任强，但拓展新客户时信任为零——平台把「你跟张老板熟不熟」变成「系统显示履约率 97%」" });

  const cards = [
    ["信任中介", "个人信任 → 系统信任", "履约率透明可见，仓单不可篡改，关键操作全量留痕"],
    ["信息聚合", "一家家问价 → 一键比价", "5 家供应商报价实时汇聚，按规格 / 产地 / 交期并排对比"],
    ["交易效率", "5–7 天 → 1–1.5 天", "全链路数字化：下单、合同、物流、对账在线闭环"],
    ["金融服务", "有好机会但缺钱 → 平台放款", "交易数据变金融资产，直接提高成交率"],
  ];
  const cw2 = (CW - 0.26) / 2, ch2 = 1.5;
  cards.forEach((c, i) => {
    const x = LAYOUT.M + (i % 2) * (cw2 + 0.26);
    const y = y0 + 0.12 + Math.floor(i / 2) * (ch2 + 0.22);
    panel(s, x, y, cw2, ch2, { fill: T.surface, line: T.hairline });
    s.addShape("rect", { x, y, w: 0.07, h: ch2, fill: { color: T.accent }, line: { type: "none" } });
    s.addText(c[0], { x: x + 0.24, y: y + 0.12, w: 2.2, h: 0.32, fontFace: F.zh, fontSize: 13.5, bold: true, color: T.accentDark, margin: 0 });
    s.addText(c[1], { x: x + 0.24, y: y + 0.5, w: cw2 - 0.48, h: 0.3, fontFace: F.zh, fontSize: 11, bold: true, color: T.amber, margin: 0 });
    s.addText(c[2], { x: x + 0.24, y: y + 0.84, w: cw2 - 0.48, h: 0.6, fontFace: F.zh, fontSize: 10, color: T.muted, margin: 0, lineSpacingMultiple: 1.3 });
  });

  band(s, { y: y0 + 0.12 + 2 * (ch2 + 0.22) + 0.1, h: 0.62, accent: T.amber, size: 11.5, runs: [
    { text: "增长飞轮：", options: { bold: true, color: T.amber } },
    { text: "更多买方 → 更多订单 → 更多数据 → 更好金融风控 → 更多客户 → 飞轮加速", options: { bold: true } },
  ] });
  s.addNotes("展示你懂业务，不只是技术人。");
}

// ============================================================
// Slide 12 五大竞争壁垒
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[2], label: "五大竞争壁垒", page: 12 });
  const y0 = claim(s, "平台的护城河，也是我的经验护城河", { sub: "竞品一句话：传统软件厂商有产品没数据，纯交易平台有交易没深入行业，银行系有钱但没交易数据" });

  const walls = [
    ["数据飞轮", "交易 + 仓单 + 履约数据 → 金融风控", "最难复制，追赶成本随时间指数增长"],
    ["配置化引擎", "100+ 客户喂出来的灵活度", "新进入者至少 2 年才能达到同等水平"],
    ["外部集成深度", "5 家银行 + 10 个 WMS + 税务接口", "对接越多壁垒越高，光搞定税局就要 3–6 个月"],
    ["行业复合人才", "既懂技术又懂大宗", "市场极度稀缺，培养周期 2–3 年"],
    ["信任资产", "时间 × 零事故", "多年运营、零重大资金事故，不可速成"],
  ];
  walls.forEach((w, i) => {
    numberedRow(s, {
      x: LAYOUT.M, y: y0 + 0.12 + i * 0.92, w: CW, h: 0.8,
      n: i + 1, title: w[0], desc: w[1], note: w[2], accent: i === 0 ? T.amber : T.accent,
    });
  });
  s.addNotes("收尾竞品对比一句话。");
}

// ============================================================
// Slide 13 七大技术难点概览
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[3], label: "七大技术难点", page: 13 });
  const y0 = claim(s, "七大核心技术难点（按影响排序）", { sub: "快速过一遍，挑面试官感兴趣的 2–3 个展开：跨月长事务、异构协议治理、外部系统稳定性" });

  const rows = [
    ["#", "难点", "影响", "难度", "解法"],
    ["1", "多租户深度定制架构", "极高", "极高", "策略模式 + 规则引擎 + 配置化模板"],
    ["2", "跨月长事务一致性", "极高", "极高", "Saga + 状态机 + 事件溯源 + 补偿表"],
    ["3", "多外部系统集成", "高", "中高", "超时 / 重试 / 熔断 / 降级四层防护 + 统一网关适配"],
    ["4", "极端流量模式（冬储）", "中高", "中", "分库分表 + 读写分离 + 3 倍容量规划压测"],
    ["5", "金融级数据精确性", "极高", "中", "Decimal + 行锁 + 自动对账三道防线"],
    ["6", "仓单防伪与货权确认", "极高", "中高", "电子仓单 + 全量留痕存证 + 银行实时校验"],
    ["7", "异构系统协议治理", "高", "中高", "DS 桥接层（Hessian + Socket）+ 可观测性"],
  ];
  const styled = rows.map((r, ri) => r.map((c, ci) => {
    if (ri === 0) return c;
    if (ci === 2 || ci === 3) return { text: c, options: { color: STATUS[c] ?? T.ink, bold: true, align: "center" } };
    if (ci === 0) return { text: c, options: { bold: true, color: T.accent, align: "center" } };
    if (ci === 1) return { text: c, options: { bold: true } };
    return c;
  }));
  table(s, { x: LAYOUT.M, y: y0 + 0.15, w: CW, colW: [0.55, 3.3, 1.1, 1.1, 6.04], rows: styled, rowH: 0.56, fontSize: 11 });
  s.addNotes("条目与《角色定位与技术竞争力》源件保持一致。");
}

// ============================================================
// Slide 14 跨月长事务一致性
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[3], label: "难点深挖 · 跨月长事务", page: 14 });
  const y0 = claim(s, "难点 2：跨月长事务的分布式一致性", { sub: "电商的事务是秒级的，不行就退款；我们一笔交易跨 3 个月——货发了不能回滚、钱付了不能撤回" });

  panel(s, LAYOUT.M, y0 + 0.1, CW, 1.05, { fill: T.surface });
  sectionLabel(s, "问题：一笔交易跨 1–3 个月，十几个状态变迁", LAYOUT.M + 0.2, y0 + 0.2, { color: T.risk, w: CW - 0.5 });
  s.addText("签约 → 付保证金 → 备货 → 付进度款 → 发货 → 在途 → 收货 → 质检 → 异议处理 → 付尾款 → 开票 → 对账 → 结算完成", {
    x: LAYOUT.M + 0.2, y: y0 + 0.52, w: CW - 0.4, h: 0.5, fontFace: F.zh, fontSize: 11.5, color: T.ink, margin: 0, lineSpacingMultiple: 1.35,
  });

  const py = y0 + 1.35;
  panel(s, LAYOUT.M, py, 6.1, 2.5, { fill: T.surface2 });
  sectionLabel(s, "方案演进", LAYOUT.M + 0.2, py + 0.14, { color: T.accentDark });
  const opts = [
    ["XA 两阶段", "锁太长——月级事务不可能", "✗"],
    ["TCC", "实现太复杂，侵入每个服务", "✗"],
    ["Saga + 状态机 + 事件溯源", "最终选择：补偿 + 前置条件 + 超时控制", "✓"],
  ];
  opts.forEach((o, i) => {
    const oy = py + 0.5 + i * 0.62;
    token(s, o[2], { x: LAYOUT.M + 0.25, y: oy, w: 0.35, h: 0.4, fontSize: 16, bold: true, color: o[2] === "✓" ? T.positive : T.risk, align: "center" });
    s.addText([
      { text: o[0], options: { bold: true, fontSize: 11.5, color: i === 2 ? T.positive : T.ink, breakLine: true } },
      { text: o[1], options: { fontSize: 9.5, color: T.muted } },
    ], { x: LAYOUT.M + 0.68, y: oy, w: 5.2, h: 0.58, fontFace: F.zh, margin: 0, valign: "middle", lineSpacingMultiple: 1.15 });
  });

  const kx = LAYOUT.M + 6.35;
  panel(s, kx, py, CW - 6.35, 2.5, { fill: T.surface });
  sectionLabel(s, "关键设计", kx + 0.2, py + 0.14, { color: T.accent });
  bullets(s, [
    "每个操作有补偿动作（锁库存 → 释放库存）",
    "状态机定义：前置条件 / 触发事件 / 副作用 / 补偿 / 超时",
    "每个状态变更同步 4–6 个系统，Kafka outbox + 幂等送达",
    [{ text: "运行结果：3 年零资金差错", options: { bold: true, color: T.positive } }],
  ], kx + 0.2, py + 0.48, CW - 6.75, 1.95, { size: 10.5, gap: 6, line: 1.3 });

  band(s, { y: 6.4, h: 0.5, accent: T.amber, size: 11.5, runs: [
    { text: "壁垒：", options: { bold: true, color: T.amber } },
    { text: "做一个「能跑」的状态机 1 个月，做一个「不会出事」的状态机要 2 年。", options: { bold: true } },
  ] });
  s.addNotes("金句：电商事务秒级，不行就退款；我们跨月，货发了不能回滚。");
}

// ============================================================
// Slide 15 异构系统协议治理
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[3], label: "难点深挖 · 异构协议治理", page: 15 });
  const y0 = claim(s, "难点 7：C 撮合引擎 + Java 业务层的异构治理", { sub: "飞行员不需要会修发动机，但必须知道仪表盘每个数值代表什么" });

  panel(s, LAYOUT.M, y0 + 0.1, 5.9, 2.0, { fill: T.surface });
  sectionLabel(s, "架构选择", LAYOUT.M + 0.2, y0 + 0.22, { color: T.accent });
  bullets(s, [
    [{ text: "C 负责「快」", options: { bold: true } }, { text: "：单线程内存撮合，GC 停顿是定时炸弹" }],
    [{ text: "Java 负责「稳」", options: { bold: true } }, { text: "：业务编排灵活，生态丰富" }],
    [{ text: "DS 负责「翻译」", options: { bold: true } }, { text: "：协议转换 / 防腐层" }],
  ], LAYOUT.M + 0.2, y0 + 0.55, 5.5, 1.4, { size: 11, gap: 7 });

  panel(s, LAYOUT.M + 6.15, y0 + 0.1, CW - 6.15, 2.0, { fill: T.surface });
  sectionLabel(s, "通信机制", LAYOUT.M + 6.35, y0 + 0.22, { color: T.accent });
  bullets(s, [
    [{ text: "同步：", options: { bold: true } }, { text: "Hessian over HTTP——二进制、跨语言、体积小" }],
    [{ text: "异步：", options: { bold: true } }, { text: "Socket 服务——低延迟回灌撮合结果" }],
    [{ text: "选型：", options: { bold: true } }, { text: "撮合是高频二进制交互，不选 JSON" }],
  ], LAYOUT.M + 6.35, y0 + 0.55, CW - 6.55, 1.4, { size: 11, gap: 7 });

  const gy = y0 + 2.3;
  sectionLabel(s, "我的治理抓手", LAYOUT.M, gy, { color: T.amber });
  const hooks = [
    ["01", "DS 是 Java", "我能直接 review 协议转换代码"],
    ["02", "接口契约", "C 只暴露输入输出，黑盒化"],
    ["03", "可观测性", "桥接日志 + 指标判断健康度"],
    ["04", "熔断限流", "C 连续失败自动熔断降级"],
  ];
  const hw = (CW - 0.6) / 4;
  hooks.forEach((h, i) => {
    const x = LAYOUT.M + i * (hw + 0.2);
    panel(s, x, gy + 0.32, hw, 1.35, { fill: T.accentSoft, line: null });
    token(s, h[0], { x: x + 0.18, y: gy + 0.46, w: 0.6, h: 0.36, fontSize: 17, bold: true, color: T.accent });
    s.addText(h[1], { x: x + 0.18, y: gy + 0.86, w: hw - 0.36, h: 0.3, fontFace: F.zh, fontSize: 12, bold: true, color: T.ink, margin: 0 });
    s.addText(h[2], { x: x + 0.18, y: gy + 1.16, w: hw - 0.36, h: 0.45, fontFace: F.zh, fontSize: 9.5, color: T.muted, margin: 0, lineSpacingMultiple: 1.2 });
  });

  band(s, { y: 6.4, h: 0.5, size: 11.5, runs: [
    { text: "成果：", options: { bold: true, color: T.accent } },
    { text: "C 团队与 Java 团队独立演进、互不阻塞——异构复杂度全部收敛在 DS 一层。", options: { bold: true } },
  ] });
  s.addNotes("市场稀缺能力的直接证据。");
}

// ============================================================
// Slide 16 Socket 可靠性设计
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[3], label: "Socket 长连接可靠性", page: 16 });
  const y0 = claim(s, "异构 Socket 长连接：可靠性与高可用设计", { sub: "面试官深挖异构通信时的弹药页" });

  const tiers = [
    ["业务层", "数据一致性 · 幂等消费", T.accentDark],
    ["可靠传输层", "ACK + 重试 + 去重 + offset 续传", T.accent],
    ["连接管理层", "心跳 + 重连 + 连接池 + 熔断", T.accentSoft],
  ];
  tiers.forEach((t, i) => {
    const y = y0 + 0.12 + i * 0.72;
    panel(s, LAYOUT.M, y, 5.6, 0.6, { fill: t[2], line: null });
    s.addText(t[0], { x: LAYOUT.M + 0.2, y, w: 1.7, h: 0.6, fontFace: F.zh, fontSize: 12, bold: true, color: i === 2 ? T.accentDark : "FFFFFF", margin: 0, valign: "middle" });
    s.addText(t[1], { x: LAYOUT.M + 1.95, y, w: 3.55, h: 0.6, fontFace: F.zh, fontSize: 10.5, color: i === 2 ? T.ink : "FFFFFF", margin: 0, valign: "middle" });
  });
  s.addText("三层解耦", { x: LAYOUT.M, y: y0 + 2.35, w: 5.6, h: 0.3, fontFace: F.zh, fontSize: 10, color: T.faint, margin: 0, align: "center" });

  const rows = [
    ["问题", "解法"],
    ["消息不丢不重", "ACK + SETNX 去重 + 指数退避重试"],
    ["断线自愈", "双向心跳 + 退避重连 + offset 续传"],
    ["数据一致", "最终一致 + 幂等 + 三道对账防线"],
    ["故障可切", "Redis 主从 + 熔断降级 + 无状态化"],
  ];
  table(s, { x: LAYOUT.M + 5.9, y: y0 + 0.12, w: CW - 5.9, colW: [1.9, 4.29], rows: rows.map((r, ri) => r.map((c, ci) => ri === 0 ? c : (ci === 0 ? { text: c, options: { bold: true, color: T.risk } } : c))), rowH: 0.58, fontSize: 10.5 });

  band(s, { y: 6.15, h: 0.72, size: 11.5, runs: [
    { text: "Redis 不只是缓存，还是可靠性持久化底座：", options: { bold: true, color: T.accent } },
    { text: "去重表（SETNX）/ 消费 offset / 会话状态", options: { breakLine: true } },
    { text: "黄金法则：异构系统间不追求强一致，走最终一致 + 对账兜底。", options: { bold: true, color: T.amber } },
  ] });
  s.addNotes("被追问异构通信可靠性时展开。");
}

// ============================================================
// Slide 17 中间件 × 模块映射
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[3], label: "中间件 × 业务模块矩阵", page: 17 });
  const y0 = claim(s, "12 类中间件 × 5 大模块的连接矩阵", { sub: "主线：以「交易链路一致性」为轴串联所有中间件" });

  const rows = [
    ["我的模块", "关键中间件", "解决什么"],
    [{ text: "交易模式（挂牌/竞价）", options: { bold: true } }, "MQ / 分布式锁 / 分布式事务 / 规则引擎", "高并发撮合下的状态一致 + 防超卖"],
    [{ text: "履约保证（仓单/质检）", options: { bold: true } }, "MQ / 工作流引擎 / 对象存储 / CDC", "长周期多角色流程编排 + 凭证存证"],
    [{ text: "数据服务（行情/报表）", options: { bold: true } }, "ES / CDC / 调度 / Redis", "海量检索 + 读写分离 + 批处理"],
    [{ text: "规则配置（计费/风控）", options: { bold: true } }, "规则引擎 / 配置中心", "业务规则热更新，不重启生效"],
    [{ text: "生态对接（银行/仓储）", options: { bold: true } }, "API 网关 / MQ / 注册中心", "多租户路由 + 异步回调 + 服务治理"],
  ];
  table(s, { x: LAYOUT.M, y: y0 + 0.15, w: CW, colW: [3.3, 4.3, 4.49], rows, rowH: 0.62, fontSize: 11 });

  band(s, { y: y0 + 0.15 + 6 * 0.62 + 0.3, h: 0.55, size: 11.5, runs: [
    { text: "讲法：", options: { bold: true, color: T.accent } },
    { text: "不是罗列中间件，而是讲「哪条业务链路需要哪种一致性保证，才选了它」——技术决策挂钩业务结果。", options: {} },
  ] });
  s.addNotes("展示体系化：中间件是为一致性服务的，不是孤立技术点。");
}

// ============================================================
// Slide 18 技术经理五维价值模型
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[4], label: "五维价值模型", page: 18 });
  const y0 = claim(s, "技术经理的五个价值维度", { sub: "核心问题：你来了之后发生了什么变化？这些变化是你推动的，还是换个人也一样？" });

  const dims = [
    ["技术决策 — 选对路", "不是「用了 XX 技术」，而是「在 XX 约束下为什么选 A 不选 B」"],
    ["防患未然 — 阻止灾难", "技术经理最高级的价值是「什么都没发生」"],
    ["流程建设 — 个人能力→团队能力", "让「只有你能做的事」变成「没有你团队也能做的事」"],
    ["业务翻译 — 业务语言→技术方案", "B2B 行业最被低估的价值"],
    ["团队建设 — 让人变强", "「带了几个人」不是数人头，是「你让这些人变强了吗」"],
  ];
  dims.forEach((d, i) => {
    numberedRow(s, { x: LAYOUT.M, y: y0 + 0.1 + i * 0.88, w: CW, h: 0.76, n: i + 1, title: d[0], desc: d[1], accent: T.accent });
  });
  band(s, { y: y0 + 0.1 + 5 * 0.88 + 0.12, h: 0.55, size: 11, runs: [
    { text: "被追问「有什么证据」时：", options: { bold: true, color: T.amber } },
    { text: "年度技术建设规划（四方向）+ 四类落地证据（规范表 / 项目看板 / 技术沉淀 / 故障报告）+ 团队目标数字。", options: {} },
  ] });
  s.addNotes("五维是管理成熟度的总纲。");
}

// ============================================================
// Slide 19 管理三件套
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[4], label: "管理三件套 · 从救火到建设", page: 19 });
  const y0 = claim(s, "从「救火队长」到「技术领导者」的转型", { sub: "刚接手时凌晨被电话叫醒是常态——半年内用机制替代亲力亲为" });

  const cards = [
    ["1. On-call 轮值", ["主 + 副双岗按周轮值", "P0–P3 四级 SLA，P0/P1 24h 复盘", "团队独立处理 80% 线上问题", "我被叫起：月均 8 次 → 2 次"]],
    ["2. 技术债台账", ["债务项｜风险｜成本｜优先级｜状态", "临时方案从隐性 → 显性 → 可控", "向上要资源的弹药", "配套 20% 带宽原则固定偿还"]],
    ["3. 接口契约治理", ["API Schema 审批 + 事件/消息定义", "SLA / 降级约定 + 数据口径统一", "管连线不管黑盒", "定制需求不允许污染主链路"]],
  ];
  const cw2 = (CW - 0.44) / 3;
  cards.forEach((c, i) => {
    const x = LAYOUT.M + i * (cw2 + 0.22);
    panel(s, x, y0 + 0.12, cw2, 3.15, { fill: T.surface, line: T.hairline });
    s.addShape("rect", { x, y: y0 + 0.12, w: cw2, h: 0.46, fill: { color: T.accent }, line: { type: "none" } });
    s.addText(c[0], { x: x + 0.15, y: y0 + 0.12, w: cw2 - 0.3, h: 0.46, fontFace: F.zh, fontSize: 12.5, bold: true, color: "FFFFFF", margin: 0, valign: "middle" });
    bullets(s, c[1], x + 0.18, y0 + 0.72, cw2 - 0.36, 2.4, { size: 10.5, gap: 9, line: 1.35, marker: T.amber });
  });

  band(s, { y: y0 + 3.5, h: 0.55, accent: T.positive, size: 12, runs: [
    { text: "效果：", options: { bold: true, color: T.positive } },
    { text: "被动响应占比从 45% 降至 15% 以下。", options: { bold: true } },
    { text: "　金句：临时方案不可怕，没有退路、没有记录、没有终点的临时方案才可怕。", options: { color: T.muted, fontSize: 10.5 } },
  ] });
  s.addNotes("管理转型的主证据页。")
  ;
}

// ============================================================
// Slide 20 BOUNDARY 治理框架
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[4], label: "非熟悉模块的治理框架", page: 20 });
  const y0 = claim(s, "BOUNDARY：怎么管不熟悉的模块", { sub: "我不靠懂每个模块取胜，靠治理机制让整个系统可控——Manager 与 Senior Engineer 的分水岭" });

  const B = [
    ["B", "Boundary", "坦诚深度领域边界"],
    ["O", "Operating", "契约治理 + 依赖风险地图"],
    ["U", "Unified", "接口契约 + SLA + 数据口径三件套"],
    ["N", "Net value", "专科专注深度，我专注耦合与一致"],
    ["D", "Demonstrated", "具体案例：用治理机制兜住事故"],
    ["A", "Awareness", "持续扩展边界，不追求替代专科"],
    ["R", "Results", "跨模块事故恢复时间↓，breaking change 归零"],
  ];
  const lw = 6.3;
  B.forEach((b, i) => {
    const y = y0 + 0.12 + i * 0.68;
    panel(s, LAYOUT.M, y, 0.5, 0.56, { fill: T.accentDark, line: null });
    token(s, b[0], { x: LAYOUT.M, y, w: 0.5, h: 0.56, fontSize: 18, bold: true, color: "FFFFFF", align: "center" });
    s.addText([
      { text: b[1], options: { bold: true, fontSize: 11.5, color: T.accentDark } },
      { text: `　${b[2]}`, options: { fontSize: 10.5, color: T.ink } },
    ], { x: LAYOUT.M + 0.68, y, w: lw - 0.7, h: 0.56, fontFace: F.en, margin: 0, valign: "middle" });
  });

  const rx = LAYOUT.M + lw + 0.3, rw = CW - lw - 0.3;
  sectionLabel(s, "决策权三档", rx, y0 + 0.12, { color: T.amber });
  const rows = [
    ["档位", "范围"],
    [{ text: "直接拍板", options: { bold: true, color: T.positive } }, "熟悉模块内部设计 + 平台级架构标准"],
    [{ text: "参与不独断", options: { bold: true, color: T.accent } }, "不熟悉模块架构评审 + 重大选型"],
    [{ text: "授权 + 兜底", options: { bold: true, color: T.caution } }, "不熟悉模块日常实现 + 局部重构"],
  ];
  table(s, { x: rx, y: y0 + 0.42, w: rw, colW: [1.55, 3.94], rows, rowH: 0.52, fontSize: 10 });
  const ly = y0 + 0.42 + 4 * 0.52 + 0.25;
  bullets(s, [
    [{ text: "红线（必须介入）：", options: { bold: true, color: T.risk } }, { text: "资金安全 / 数据合规 / 资损事故" }],
    [{ text: "蓝线（授权不干预）：", options: { bold: true, color: T.accent } }, { text: "体验优化 / 局部重构 / 性能微调" }],
  ], rx, ly, rw, 1.1, { size: 10.5, gap: 8, line: 1.3 });
  s.addNotes("金句：靠治理机制让整个系统可控。");
}

// ============================================================
// Slide 21 向上沟通
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[4], label: "向上沟通 · 技术翻译", page: 21 });
  const y0 = claim(s, "把技术语言翻译成老板语言", { sub: "黄金公式：现状风险（量化）+ 解决方案（低成本）+ 业务收益" });

  const rows = [
    ["你想说", "翻译成老板语言"],
    [{ text: "「重构结算模块」", options: { color: T.faint } }, "「Q4 大促可能漏账资损，5 人日自动化，杜绝风险」"],
    [{ text: "「技术债太多」", options: { color: T.faint } }, "「3 个隐患不处理，明年业务翻倍时频繁宕机」"],
    [{ text: "「引入监控」", options: { color: T.faint } }, "「出问题客户投诉才知道，加监控提前 30 分钟发现」"],
  ];
  table(s, { x: LAYOUT.M, y: y0 + 0.15, w: CW, colW: [4.0, 8.09], rows, rowH: 0.56, fontSize: 11.5 });

  const py = y0 + 0.15 + 4 * 0.56 + 0.3;
  panel(s, LAYOUT.M, py, CW, 2.2, { fill: T.surface });
  sectionLabel(s, "季度技术健康度汇报（一页纸）", LAYOUT.M + 0.22, py + 0.14, { color: T.accent });
  bullets(s, [
    "本季度还了 X 项技术债，避免 Y 次潜在事故",
    "系统稳定性：故障次数 / 恢复时长变化趋势",
    "沉淀了 X 个标准件，团队效率提升 Y%",
  ], LAYOUT.M + 0.22, py + 0.52, 6.4, 1.5, { size: 11, gap: 9, line: 1.35 });
  s.addText([
    { text: "让「看不见的建设工作」\n变得可见、可量化", options: { bold: true, fontSize: 13, color: T.accentDark, breakLine: true } },
    { text: "→ 信任建立 → 资源就好要了", options: { fontSize: 11, color: T.amber, bold: true } },
  ], { x: LAYOUT.M + 7.0, y: py + 0.35, w: CW - 7.2, h: 1.6, fontFace: F.zh, margin: 0, valign: "middle", lineSpacingMultiple: 1.4, align: "center" });
  s.addNotes("对老板讲经营价值多于技术 ROI。");
}

// ============================================================
// Slide 22 能力提升路线图
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[5], label: "能力提升路线图", page: 22 });
  const y0 = claim(s, "四阶段 12 个月：从救火到跨越", { sub: "展示学习方法论与进取心——每阶段有可验收的量化目标" });

  const stages = [
    ["阶段一 · 止血（M1–M3）", ["SLA 分级体系", "On-call 轮值", "技术债台账"], "RI ≤ 35%"],
    ["阶段二 · 稳定（M4–M6）", ["需求门控 SOP", "CI/CD 覆盖核心链路", "TOP5 技术债偿还"], "RI ≤ 25%"],
    ["阶段三 · 主动（M7–M9）", ["技术治理专项", "参与业务规划", "团队能力矩阵"], "RI ≤ 15%"],
    ["阶段四 · 跨越（M10–M12）", ["年度技术回顾", "下一年技术战略", "≥1 项创新落地"], "RI ≤ 15%"],
  ];
  const cw2 = (CW - 0.66) / 4, ch2 = 2.4;
  stages.forEach((st, i) => {
    const x = LAYOUT.M + i * (cw2 + 0.22);
    const y = y0 + 0.15;
    panel(s, x, y, cw2, ch2, { fill: T.surface, line: i === 3 ? T.accent : T.hairline });
    s.addShape("rect", { x, y, w: cw2, h: 0.44, fill: { color: i === 3 ? T.accentDark : T.accentSoft }, line: { type: "none" } });
    s.addText(st[0], { x: x + 0.1, y, w: cw2 - 0.2, h: 0.44, fontFace: F.zh, fontSize: 10.5, bold: true, color: i === 3 ? "FFFFFF" : T.accentDark, margin: 0, valign: "middle", align: "center" });
    bullets(s, st[1], x + 0.16, y + 0.58, cw2 - 0.32, 1.35, { size: 9.5, gap: 6, line: 1.3, marker: T.accent });
    token(s, st[2], { x: x + 0.16, y: y + ch2 - 0.42, w: cw2 - 0.32, h: 0.3, fontSize: 12, bold: true, color: T.amber });
    if (i < 3) s.addShape("rightArrow", { x: x + cw2 + 0.01, y: y + ch2 / 2 - 0.08, w: 0.2, h: 0.16, fill: { color: T.hairline }, line: { type: "none" } });
  });

  const ry = y0 + 0.15 + ch2 + 0.32;
  panel(s, LAYOUT.M, ry, CW, 1.75, { fill: T.surface2 });
  sectionLabel(s, "三维同步推进", LAYOUT.M + 0.22, ry + 0.14, { color: T.accentDark });
  const dims = [
    ["业务理解", "L1 执行者 → L3 对等对话者 → L5 业务伙伴"],
    ["技术架构", "L1 救火队员 → L3 架构把控者 → L5 技术领导者"],
    ["团队管理", "L1 个人英雄 → L3 团队建设者 → L5 组织领导者"],
  ];
  dims.forEach((d, i) => {
    const y = ry + 0.5 + i * 0.38;
    s.addText([
      { text: d[0], options: { bold: true, color: T.accent, fontSize: 10.5 } },
      { text: `　${d[1]}`, options: { color: T.ink, fontSize: 10.5 } },
    ], { x: LAYOUT.M + 0.22, y, w: CW - 0.5, h: 0.3, fontFace: F.zh, margin: 0, valign: "middle" });
  });
  s.addNotes("RI = 被动响应占比（Reactive Index）。");
}

// ============================================================
// Slide 23 技术认知升级路径
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[5], label: "技术认知升级", page: 23 });
  const y0 = claim(s, "从「排障能手」到「架构决策者」的认知升级", { sub: "转变路径：经验驱动 → 原理驱动 → 决策驱动" });

  const nodes = [
    ["现在 → 3 个月", "排障能手", "经验驱动 · 碎片知识", "「重启就好了」"],
    ["6 个月", "原理达人", "原理驱动 · 系统知识", "「因为内存碎片率…」"],
    ["12 个月", "架构决策者", "决策驱动 · 逻辑闭环", "「基于 CAP 权衡…」"],
  ];
  const nw = 3.5, nh = 1.7;
  nodes.forEach((n, i) => {
    const x = LAYOUT.M + i * (nw + 0.65);
    panel(s, x, y0 + 0.2, nw, nh, { fill: i === 2 ? T.accent : T.surface, line: i === 2 ? null : T.hairline });
    s.addText(n[0], { x: x + 0.15, y: y0 + 0.32, w: nw - 0.3, h: 0.28, fontFace: F.zh, fontSize: 9.5, bold: true, color: i === 2 ? "DCE9F5" : T.faint, margin: 0 });
    s.addText(n[1], { x: x + 0.15, y: y0 + 0.62, w: nw - 0.3, h: 0.4, fontFace: F.zh, fontSize: 16, bold: true, color: i === 2 ? "FFFFFF" : T.ink, margin: 0 });
    s.addText(n[2], { x: x + 0.15, y: y0 + 1.06, w: nw - 0.3, h: 0.28, fontFace: F.zh, fontSize: 10, color: i === 2 ? "FFFFFF" : T.muted, margin: 0 });
    s.addText(n[3], { x: x + 0.15, y: y0 + 1.38, w: nw - 0.3, h: 0.3, fontFace: F.zh, fontSize: 9.5, italic: true, color: i === 2 ? "DCE9F5" : T.accent, margin: 0 });
    if (i < 2) {
      s.addShape("rightArrow", { x: x + nw + 0.12, y: y0 + 0.2 + nh / 2 - 0.1, w: 0.42, h: 0.2, fill: { color: T.amber }, line: { type: "none" } });
      s.addText(i === 0 ? "建立知识树\n+ 深度主题" : "深度训练\n+ PEARL", { x: x + nw + 0.02, y: y0 + 0.2 + nh / 2 + 0.16, w: 0.62, h: 0.6, fontFace: F.zh, fontSize: 7.5, color: T.muted, margin: 0, align: "center", lineSpacingMultiple: 1.15 });
    }
  });

  const my = y0 + 0.2 + nh + 0.35;
  panel(s, LAYOUT.M, my, CW, 2.35, { fill: T.surface });
  sectionLabel(s, "方法论", LAYOUT.M + 0.22, my + 0.14, { color: T.amber });
  const meth = [
    ["「事故 → 原理」提炼法", "每个问题追问 5 个 Why，沉淀成排查手册"],
    ["「三层知识树」", "6 大主干 → 分支 → 叶子，碎片知识系统化"],
    ["「PEARL」表达法", "Problem → Evidence → Alternative → Reasoning → Lesson"],
    ["「T 型 + π 型」学习", "先扎 1 个深度方向，再横向扩展第二深度"],
  ];
  meth.forEach((m, i) => {
    const x = LAYOUT.M + 0.22 + (i % 2) * ((CW - 0.5) / 2);
    const y = my + 0.55 + Math.floor(i / 2) * 0.88;
    s.addText([
      { text: m[0], options: { bold: true, fontSize: 11.5, color: T.accentDark, breakLine: true } },
      { text: m[1], options: { fontSize: 9.5, color: T.muted } },
    ], { x, y, w: (CW - 0.5) / 2 - 0.3, h: 0.7, fontFace: F.zh, margin: 0, lineSpacingMultiple: 1.25 });
  });
  s.addNotes("展示学习能力和自我要求。");
}

// ============================================================
// Slide 24 总结
// ============================================================
{
  const s = slide();
  chrome(s, { part: PART[5], label: "总结", page: 24 });
  const y0 = claim(s, "我的三个核心差异化", { sub: "收尾用一句话，留下印象，然后说「谢谢，有什么问题可以交流」" });

  const diffs = [
    ["1", "驾驭异构架构的能力", "C 撮合 + Java 业务 + Vue 前端——能讲清「为什么这么设计、怎么让它别崩」", "远比「只会 Spring Boot」稀缺"],
    ["2", "技术与业务的深度交叉", "懂撮合引擎也懂大宗贸易全链路——用业务语言讲技术，用技术语言讲业务", "B2B 行业最稀缺的复合型人才"],
    ["3", "从执行者到领导者的转型", "建立 On-call / 技术债台账 / 契约治理三件套——把团队从救火拉到主动建设", "用机制替代亲力亲为"],
  ];
  diffs.forEach((d, i) => {
    const y = y0 + 0.12 + i * 1.18;
    panel(s, LAYOUT.M, y, CW, 1.02, { fill: T.surface, line: T.hairline });
    s.addShape("rect", { x: LAYOUT.M, y, w: 0.07, h: 1.02, fill: { color: T.accent }, line: { type: "none" } });
    token(s, d[0], { x: LAYOUT.M + 0.25, y: y + 0.31, w: 0.5, h: 0.4, fontSize: 22, bold: true, color: T.amber, align: "center" });
    s.addText([
      { text: d[1], options: { bold: true, fontSize: 14, color: T.ink, breakLine: true } },
      { text: d[2], options: { fontSize: 10.5, color: T.muted } },
    ], { x: LAYOUT.M + 0.9, y: y + 0.1, w: CW - 3.6, h: 0.85, fontFace: F.zh, margin: 0, lineSpacingMultiple: 1.25, valign: "middle" });
    s.addText("→ " + d[3], { x: LAYOUT.M + CW - 2.7, y, w: 2.5, h: 1.02, fontFace: F.zh, fontSize: 10.5, bold: true, color: T.accent, margin: 0, valign: "middle", align: "right" });
  });

  const qy = y0 + 0.12 + 3 * 1.18 + 0.25;
  s.addShape("line", { x: LAYOUT.M + 2.5, y: qy, w: CW - 5, h: 0, line: { color: T.amber, width: 1.5 } });
  s.addText("技术经理的价值不是自己写最多的代码，\n而是让对的决策在正确的框架下发生。", {
    x: LAYOUT.M, y: qy + 0.12, w: CW, h: 0.95, fontFace: F.zh, fontSize: 17, bold: true, color: T.accentDark, align: "center", margin: 0, lineSpacingMultiple: 1.35,
  });
  s.addText([
    { text: NAME, options: { bold: true, color: T.ink, fontSize: 13 } },
    { text: `　${CONTACT}`, options: { color: T.muted, fontSize: 11 } },
  ], { x: LAYOUT.M, y: qy + 1.15, w: CW, h: 0.35, fontFace: F.zh, align: "center", margin: 0 });
  s.addNotes("谢谢，有什么问题可以交流。");
}

// ============================================================
pptx.writeFile({ fileName: "个人简历介绍-24页.pptx" }).then(f => console.log("OK:", f));
