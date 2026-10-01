const pptxgen = require("pptxgenjs");
const path = require("path");

// ─── Color Palette (Navy Executive) ───
const C = {
  navy:    "152C42",
  teal:    "1A7F8C",
  gold:    "D4940B",
  white:   "FFFFFF",
  offWhite:"F2F4F7",
  lightGray:"E3E8EE",
  midGray: "8899AA",
  darkText:"1B2A3B",
  cardBg:  "F8F9FB",
};

function makeShadow() { return { type: "outer", blur: 4, offset: 2, angle: 135, color: "000000", opacity: 0.10 }; }

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.author = "B2B Tech Manager";
pres.title = "产品全业务链条 · 运营思路 · 技术经理价值";

// ─── reusable helpers ───
function bg(s, color) { s.background = { color: color || C.navy }; }
function topBar(s) { s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.gold } }); }
function title(s, t, sub, accent) {
  s.addText(t, { x: 0.5, y: 0.28, w: 9, h: 0.55, fontSize: 24, fontFace: "Arial Black", color: C.white, bold: true, margin: 0 });
  s.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 0.92, w: 0.55, h: 0.045, fill: { color: accent || C.teal } });
  if (sub) s.addText(sub, { x: 0.5, y: 1.0, w: 9, h: 0.35, fontSize: 12, fontFace: "Arial", color: C.midGray, margin: 0 });
}
function card(s, x, y, w, h, fillColor, accent) {
  s.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: fillColor || C.cardBg }, shadow: makeShadow() });
  if (accent) s.addShape(pres.shapes.RECTANGLE, { x, y, w: 0.07, h, fill: { color: accent } });
}
function lightTitle(s, t, sub) {
  s.addText(t, { x: 0.5, y: 0.28, w: 9, h: 0.55, fontSize: 24, fontFace: "Arial Black", color: C.navy, bold: true, margin: 0 });
  s.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 0.92, w: 0.55, h: 0.045, fill: { color: C.gold } });
  if (sub) s.addText(sub, { x: 0.5, y: 1.0, w: 9, h: 0.35, fontSize: 12, fontFace: "Arial", color: C.midGray, margin: 0 });
}

// ============================================================
// SLIDE 1 — 封面
// ============================================================
{
  const s = pres.addSlide(); bg(s);
  topBar(s);
  s.addText("产品全业务链条 · 运营思路", { x: 0.8, y: 1.15, w: 8.4, h: 0.9, fontSize: 38, fontFace: "Arial Black", color: C.white, bold: true, margin: 0 });
  s.addText("B2B 大宗贸易供应链平台", { x: 0.8, y: 2.05, w: 8.4, h: 0.55, fontSize: 21, fontFace: "Arial", color: C.gold, margin: 0 });
  s.addShape(pres.shapes.RECTANGLE, { x: 0.8, y: 2.75, w: 2.2, h: 0.04, fill: { color: C.teal } });
  s.addText([
    { text: "业务闭环  |  数据飞轮  |  技术驱动", options: { breakLine: true } },
    { text: "技术经理视角：我从哪些环节切入、解决了什么问题", options: {} }
  ], { x: 0.8, y: 3.1, w: 8.4, h: 1.0, fontSize: 14, fontFace: "Arial", color: C.midGray, lineSpacingMultiple: 1.6, margin: 0 });
  s.addText("汇报人：【您的姓名】  ·  B2B 平台技术经理", { x: 0.8, y: 4.6, w: 8.4, h: 0.4, fontSize: 12, fontFace: "Arial", color: C.teal, margin: 0 });
}

// ============================================================
// SLIDE 2 — 平台为什么存在（商业逻辑）
// ============================================================
{
  const s = pres.addSlide(); bg(s, C.white);
  lightTitle(s, "平台为什么存在：钻进线下的缝隙", "不是“数字化”三个字，而是线下做不了、做不好、做不快的事");
  const items = [
    { h: "信任中介", c: C.teal,
      b: "线下新客户“货到付款 vs 先付全款”互相怕。平台把个人信任变成系统信任——履约率、交易量、客户评价一目了然。",
      v: "让客户把生意做到人脉圈之外" },
    { h: "交易效率", c: C.gold,
      b: "线下询价 1 天、合同邮寄 3 天、对账 Excel 到崩溃。平台把整条链路数字化：5 天 → 1.5 天。",
      v: "客户月交易笔数 20 → 50" },
    { h: "供应链金融", c: C.navy,
      b: "贸易商看到好货却缺钱，银行看不懂大宗不敢放款。平台用真实交易数据做风控，把交易信用变成可用资金。",
      v: "线下完全做不到的壁垒" },
  ];
  const w = 2.9, gap = 0.25, x0 = 0.55, y0 = 1.5, h = 2.7;
  items.forEach((it, i) => {
    const x = x0 + i * (w + gap);
    card(s, x, y0, w, h, C.cardBg, it.c);
    s.addText(it.h, { x: x + 0.15, y: y0 + 0.22, w: w - 0.3, h: 0.5, fontSize: 17, bold: true, fontFace: "Arial Black", color: it.c, margin: 0 });
    s.addText(it.b, { x: x + 0.15, y: y0 + 0.8, w: w - 0.3, h: 1.35, fontSize: 11.5, fontFace: "Arial", color: C.darkText, lineSpacingMultiple: 1.35, margin: 0 });
    s.addShape(pres.shapes.RECTANGLE, { x: x + 0.15, y: y0 + 2.2, w: w - 0.3, h: 0.38, fill: { color: it.c } });
    s.addText(it.v, { x: x + 0.15, y: y0 + 2.2, w: w - 0.3, h: 0.38, fontSize: 10.5, bold: true, fontFace: "Arial", color: C.white, align: "center", valign: "middle", margin: 0 });
  });
  s.addText("结论：平台的价值不在“替代线下关系”，而在“放大关系”——让老客户做大、让新客户敢来。", { x: 0.55, y: 4.45, w: 9, h: 0.5, fontSize: 12.5, italic: true, fontFace: "Arial", color: C.navy, margin: 0 });
}

// ============================================================
// SLIDE 3 — 业务全链条总览（一笔交易生命周期）
// ============================================================
{
  const s = pres.addSlide(); bg(s, C.navy);
  title(s, "业务全链条：一笔交易的生命周期", "从挂牌到复购，平台覆盖了 8 个环节——每个环节都对应一个可被技术解决的痛点", C.teal);
  const steps = [
    "① 挂牌报价", "② 询价比价", "③ 合同签约", "④ 支付履约",
    "⑤ 仓储物流", "⑥ 收货验收", "⑦ 结算开票", "⑧ 售后复购"
  ];
  const w = 2.05, gap = 0.18, x0 = 0.42, y0 = 1.6, h = 1.05;
  // row 1
  steps.slice(0, 4).forEach((t, i) => {
    const x = x0 + i * (w + gap);
    s.addShape(pres.shapes.RECTANGLE, { x, y: y0, w, h, fill: { color: C.teal }, shadow: makeShadow() });
    s.addText(t, { x, y: y0, w, h, fontSize: 13, bold: true, fontFace: "Arial", color: C.white, align: "center", valign: "middle", margin: 0 });
    if (i < 3) s.addText("→", { x: x + w, y: y0, w: gap, h, fontSize: 16, bold: true, color: C.gold, align: "center", valign: "middle", margin: 0 });
  });
  // row 2
  steps.slice(4).forEach((t, i) => {
    const x = x0 + i * (w + gap);
    s.addShape(pres.shapes.RECTANGLE, { x, y: y0 + 1.35, w, h, fill: { color: C.gold }, shadow: makeShadow() });
    s.addText(t, { x, y: y0 + 1.35, w, h, fontSize: 13, bold: true, fontFace: "Arial", color: C.white, align: "center", valign: "middle", margin: 0 });
    if (i < 3) s.addText("→", { x: x + w, y: y0 + 1.35, w: gap, h, fontSize: 16, bold: true, color: C.teal, align: "center", valign: "middle", margin: 0 });
  });
  s.addText("↑ 环节 ④⑤ 衔接处是资金与货权的风险高地，也是技术投入最重的地方", { x: 0.42, y: 4.35, w: 9.2, h: 0.4, fontSize: 11.5, italic: true, fontFace: "Arial", color: C.midGray, margin: 0 });
}

// ============================================================
// SLIDE 4 — 链条前半段：信息流与交易达成
// ============================================================
{
  const s = pres.addSlide(); bg(s, C.white);
  lightTitle(s, "链条前半段：让“找货—谈价—签约”不再靠腿", "信息流与交易达成 · 技术把不确定性变成确定性");
  const rows = [
    { h: "挂牌报价", c: C.teal,
      biz: "价格随期货实时波动，库存必须真实，报价要可比",
      tech: "期交所行情→Redis毫秒推送；WMS库存实时校验防超卖；标准化编码支持一键比价" },
    { h: "合同签约", c: C.gold,
      biz: "大宗合同十几页、金额千万级，审批链条长",
      tech: "智能模板 80% 自动生成 + 审批流引擎 + e签宝/法大大电子签章 + 归档 ES" },
    { h: "信用评估", c: C.navy,
      biz: "新客户敢不敢做、给多少额度，不能靠“感觉”",
      tech: "工商数据 + 历史交易→评级模型；Drools 规则引擎热更新，改规则不用发版" },
  ];
  const y0 = 1.55, rh = 1.05, gap = 0.12;
  rows.forEach((r, i) => {
    const y = y0 + i * (rh + gap);
    card(s, 0.55, y, 9.0, rh, C.cardBg, r.c);
    s.addText(r.h, { x: 0.75, y: y + 0.13, w: 1.7, h: 0.8, fontSize: 15, bold: true, fontFace: "Arial Black", color: r.c, valign: "middle", margin: 0 });
    s.addText([{ text: "业务痛点  ", options: { bold: true, color: r.c } }, { text: r.biz, options: { color: C.darkText } }],
      { x: 2.55, y: y + 0.12, w: 6.85, h: 0.4, fontSize: 10.5, fontFace: "Arial", margin: 0 });
    s.addText([{ text: "技术解决  ", options: { bold: true, color: r.c } }, { text: r.tech, options: { color: C.darkText } }],
      { x: 2.55, y: y + 0.55, w: 6.85, h: 0.42, fontSize: 10.5, fontFace: "Arial", margin: 0 });
  });
}

// ============================================================
// SLIDE 5 — 链条后半段：履约与资金
// ============================================================
{
  const s = pres.addSlide(); bg(s, C.white);
  lightTitle(s, "链条后半段：让“钱、货、票”三单一致", "履约与资金 · 这是金融级精确性的主战场");
  const rows = [
    { h: "支付结算", c: C.teal,
      biz: "保证金/进度款/尾款分多次付，金额巨大，账务复杂",
      tech: "支付计划引擎自动生成；银企直连统一网关适配多银行；Kafka 通知风控/财务/仓储，保证三系统一致" },
    { h: "仓储物流", c: C.gold,
      biz: "一货多押、库存不准、物流不透明",
      tech: "WMS 实时同步库存；电子仓单+区块链存证防重复质押；GPS/物联网实时可查" },
    { h: "质检异议", c: C.navy,
      biz: "证据分散、处理周期长（2-4 周）、赔付无标准",
      tech: "异议工单系统（自动分派+24h超时升级）；历史案例库 ES 全文检索，赔付有据可依" },
  ];
  const y0 = 1.55, rh = 1.05, gap = 0.12;
  rows.forEach((r, i) => {
    const y = y0 + i * (rh + gap);
    card(s, 0.55, y, 9.0, rh, C.cardBg, r.c);
    s.addText(r.h, { x: 0.75, y: y + 0.13, w: 1.7, h: 0.8, fontSize: 15, bold: true, fontFace: "Arial Black", color: r.c, valign: "middle", margin: 0 });
    s.addText([{ text: "业务痛点  ", options: { bold: true, color: r.c } }, { text: r.biz, options: { color: C.darkText } }],
      { x: 2.55, y: y + 0.12, w: 6.85, h: 0.4, fontSize: 10.5, fontFace: "Arial", margin: 0 });
    s.addText([{ text: "技术解决  ", options: { bold: true, color: r.c } }, { text: r.tech, options: { color: C.darkText } }],
      { x: 2.55, y: y + 0.55, w: 6.85, h: 0.42, fontSize: 10.5, fontFace: "Arial", margin: 0 });
  });
}

// ============================================================
// SLIDE 6 — 运营思路①：客户运营飞轮
// ============================================================
{
  const s = pres.addSlide(); bg(s, C.navy);
  title(s, "运营思路①：让数据越用越值钱", "客户运营飞轮 —— 核心驱动力不是流量，是每笔交易沉淀的数据", C.gold);
  const ring = [
    { t: "更多买方来平台找货", d: "比价方便 + 信用保障", c: C.teal },
    { t: "卖方获更多订单\n买方得更好价格", d: "超出人脉圈 / 多家竞争", c: C.teal },
    { t: "平台积累数据", d: "交易·履约·仓单流转", c: C.gold },
    { t: "数据产生金融&增值", d: "供应链金融 / 价格预测 / 采购建议", c: C.gold },
    { t: "更多客户愿意留下来", d: "粘性更强，离开成本更高", c: C.white },
  ];
  // center
  s.addShape(pres.shapes.OVAL, { x: 3.75, y: 1.7, w: 2.5, h: 2.5, fill: { color: C.teal }, shadow: makeShadow() });
  s.addText("数据\n飞轮", { x: 3.75, y: 1.7, w: 2.5, h: 2.5, fontSize: 22, bold: true, fontFace: "Arial Black", color: C.white, align: "center", valign: "middle", margin: 0 });
  const pts = [[0.6,1.55],[6.9,1.55],[0.6,3.6],[6.9,3.6],[3.75,4.35]];
  ring.forEach((r, i) => {
    const [x, y] = pts[i];
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: 2.55, h: 1.15, fill: { color: C.navy }, line: { color: r.c, width: 1.5 }, shadow: makeShadow() });
    s.addText(r.t, { x: x + 0.08, y: y + 0.06, w: 2.4, h: 0.62, fontSize: 10.5, bold: true, fontFace: "Arial", color: r.c, align: "center", valign: "middle", lineSpacingMultiple: 0.95, margin: 0 });
    s.addText(r.d, { x: x + 0.08, y: y + 0.62, w: 2.4, h: 0.45, fontSize: 8.5, fontFace: "Arial", color: C.midGray, align: "center", valign: "middle", margin: 0 });
  });
}

// ============================================================
// SLIDE 7 — 运营思路②：四方价值网络
// ============================================================
{
  const s = pres.addSlide(); bg(s, C.white);
  lightTitle(s, "运营思路②：四方价值网络", "平台不是单边工具，而是一个让四方都“算得过来账”的协作网络");
  const items = [
    { h: "买方", c: C.teal, b: "找到货、比到价、放心买。采购团队 5 人干的活，3 人就干完，省下的人去开新客户。" },
    { h: "卖方", c: C.gold, b: "货卖得快、卖得安全。第一个月上线客户平均交易量涨 30%，触达原人脉圈外的买家。" },
    { h: "资方", c: C.navy, b: "看懂大宗、敢放款。基于不可篡改交易与仓单数据，不良率比传统模式低 60%。" },
    { h: "平台", c: C.teal, b: "沉淀数据资产、强化飞轮。离开成本越高，客户越离不开，形成时间壁垒。" },
  ];
  const w = 4.4, h = 1.45, gx = 0.2, gy = 0.2, x0 = 0.55, y0 = 1.55;
  items.forEach((it, i) => {
    const x = x0 + (i % 2) * (w + gx);
    const y = y0 + Math.floor(i / 2) * (h + gy);
    card(s, x, y, w, h, C.cardBg, it.c);
    s.addText(it.h, { x: x + 0.2, y: y + 0.15, w: 1.5, h: 0.45, fontSize: 16, bold: true, fontFace: "Arial Black", color: it.c, margin: 0 });
    s.addText(it.b, { x: x + 0.2, y: y + 0.62, w: w - 0.4, h: 0.75, fontSize: 11, fontFace: "Arial", color: C.darkText, lineSpacingMultiple: 1.3, margin: 0 });
  });
}

// ============================================================
// SLIDE 8 — 运营思路③：客户成功机制
// ============================================================
{
  const s = pres.addSlide(); bg(s, C.white);
  lightTitle(s, "运营思路③：在客户说“不续了”之前介入", "客户成功机制 —— 用健康度模型把“感觉”变成“指标”");
  // left: 4-dimension health model
  s.addText("客户健康度模型（四维加权）", { x: 0.55, y: 1.5, w: 4.2, h: 0.4, fontSize: 13, bold: true, fontFace: "Arial", color: C.navy, margin: 0 });
  const dims = [
    ["登录频率", "× 0.2"],
    ["核心功能使用率", "× 0.4"],
    ["交易完成率", "× 0.3"],
    ["问题响应满意度", "× 0.1"],
  ];
  dims.forEach((d, i) => {
    const y = 1.95 + i * 0.5;
    s.addShape(pres.shapes.RECTANGLE, { x: 0.55, y, w: 4.0, h: 0.42, fill: { color: C.cardBg }, line: { color: C.lightGray, width: 1 } });
    s.addShape(pres.shapes.RECTANGLE, { x: 0.55, y, w: 0.07, h: 0.42, fill: { color: C.teal } });
    s.addText(d[0], { x: 0.75, y, w: 2.8, h: 0.42, fontSize: 11, fontFace: "Arial", color: C.darkText, valign: "middle", margin: 0 });
    s.addText(d[1], { x: 3.5, y, w: 1.0, h: 0.42, fontSize: 11, bold: true, fontFace: "Arial", color: C.gold, align: "right", valign: "middle", margin: 0 });
  });
  s.addShape(pres.shapes.RECTANGLE, { x: 0.55, y: 4.05, w: 4.0, h: 0.5, fill: { color: C.gold } });
  s.addText("综合分 < 60 → 自动触发客户成功经理介入", { x: 0.55, y: 4.05, w: 4.0, h: 0.5, fontSize: 10.5, bold: true, fontFace: "Arial", color: C.white, align: "center", valign: "middle", margin: 0 });
  // right: lifecycle + import tools
  s.addText("全生命周期 & 提效工具", { x: 5.0, y: 1.5, w: 4.5, h: 0.4, fontSize: 13, bold: true, fontFace: "Arial", color: C.navy, margin: 0 });
  const lc = [
    ["售前", "需求调研 / Demo / ROI 测算"],
    ["售中", "培训 / 数据迁移 / 灰度上线"],
    ["售后", "健康度监控 / 流失预警 / 续费增购"],
  ];
  lc.forEach((r, i) => {
    const y = 1.95 + i * 0.6;
    s.addShape(pres.shapes.RECTANGLE, { x: 5.0, y, w: 1.2, h: 0.48, fill: { color: C.navy } });
    s.addText(r[0], { x: 5.0, y, w: 1.2, h: 0.48, fontSize: 11, bold: true, fontFace: "Arial", color: C.white, align: "center", valign: "middle", margin: 0 });
    s.addText(r[1], { x: 6.35, y, w: 3.2, h: 0.48, fontSize: 10.5, fontFace: "Arial", color: C.darkText, valign: "middle", margin: 0 });
  });
  s.addShape(pres.shapes.RECTANGLE, { x: 5.0, y: 3.85, w: 4.55, h: 0.7, fill: { color: C.cardBg }, line: { color: C.lightGray, width: 1 } });
  s.addText("数据导入工具：模板批量导入 + 自动校验，新客户从签约到用起来的时间压缩一半", { x: 5.15, y: 3.85, w: 4.3, h: 0.7, fontSize: 10.5, fontFace: "Arial", color: C.darkText, valign: "middle", lineSpacingMultiple: 1.25, margin: 0 });
}

// ============================================================
// SLIDE 9 — 技术经理解决的问题（总览）
// ============================================================
{
  const s = pres.addSlide(); bg(s, C.navy);
  title(s, "我作为技术经理，解决了什么问题", "从“救火队长”到“平台操盘手”——三个层面系统性破局", C.teal);
  const layers = [
    { h: "架构层", c: C.teal, t: "系统不崩、钱不错、货不丢",
      p: "驾驭 C+Java+Vue 异构架构，用 Saga 长事务与韧性设计守住金融级底线" },
    { h: "业务层", c: C.gold, t: "上线快、能做金融、可深度定制",
      p: "把行业 Know-how 沉淀为配置化引擎，让新客户一周上线、让数据长出金融能力" },
    { h: "管理层", c: C.white, t: "团队稳、债可控、风险有机制",
      p: "用台账管债、契约管接口、On-call 管稳定性，从个人扛雷到体系兜底" },
  ];
  const w = 2.9, gap = 0.25, x0 = 0.55, y0 = 1.55, h = 2.6;
  layers.forEach((l, i) => {
    const x = x0 + i * (w + gap);
    card(s, x, y0, w, h, C.cardBg, l.c);
    s.addText(l.h, { x: x + 0.15, y: y0 + 0.22, w: w - 0.3, h: 0.5, fontSize: 18, bold: true, fontFace: "Arial Black", color: l.c === C.white ? C.navy : l.c, margin: 0 });
    s.addText(l.t, { x: x + 0.15, y: y0 + 0.82, w: w - 0.3, h: 0.7, fontSize: 12.5, bold: true, fontFace: "Arial", color: C.navy, lineSpacingMultiple: 1.2, margin: 0 });
    s.addText(l.p, { x: x + 0.15, y: y0 + 1.55, w: w - 0.3, h: 0.95, fontSize: 10.5, fontFace: "Arial", color: C.darkText, lineSpacingMultiple: 1.3, margin: 0 });
  });
  s.addText("一句话定位：我做的不是“写代码”，是把一个高客单价、长链条、多方协作的 B2B 系统，收拾成“不出事、能长大”的平台。", { x: 0.55, y: 4.45, w: 9, h: 0.5, fontSize: 12, italic: true, fontFace: "Arial", color: C.gold, margin: 0 });
}

// ============================================================
// SLIDE 10 — 解决了什么：架构与稳定性
// ============================================================
{
  const s = pres.addSlide(); bg(s, C.white);
  lightTitle(s, "解决的问题①：架构与稳定性", "让一个异构、长事务、强依赖外部的系统“平时稳、峰值不崩”");
  const rows = [
    ["异构架构治理", C.teal, "C 撮合引擎 + Java 中台 + Vue 三端协同， DS 数据中心用 TCP 自定义报文接 C、Hessian 接 Java"],
    ["长事务一致性", C.gold, "一笔交易跨 3 个月、十几个状态，用 Saga+状态机+事件溯源保证资金、货权、账务三方一致 —— 3 年零资金差错"],
    ["外部依赖韧性", C.navy, "银行/WMS/税务/物流任一故障都变成我的故障；超时/重试/熔断/降级四层防护，可用率 99.95%"],
    ["极端流量治理", C.teal, "冬储期流量 5-10 倍暴增，交易链路独立部署 + 核心查询强制走索引 + 冬储前全链路压测 —— 冬储零 P0"],
  ];
  const y0 = 1.5, rh = 0.82, gap = 0.12;
  rows.forEach((r, i) => {
    const y = y0 + i * (rh + gap);
    card(s, 0.55, y, 9.0, rh, C.cardBg, r[1]);
    s.addText(r[0], { x: 0.75, y, w: 2.2, h: rh, fontSize: 13.5, bold: true, fontFace: "Arial Black", color: r[1], valign: "middle", margin: 0 });
    s.addText(r[2], { x: 3.0, y, w: 6.4, h: rh, fontSize: 10.8, fontFace: "Arial", color: C.darkText, valign: "middle", lineSpacingMultiple: 1.25, margin: 0 });
  });
}

// ============================================================
// SLIDE 11 — 解决了什么：业务价值转化
// ============================================================
{
  const s = pres.addSlide(); bg(s, C.white);
  lightTitle(s, "解决的问题②：业务价值转化", "把技术能力翻译成客户听得懂、愿意付钱的“业务语言”");
  const rows = [
    ["多租户配置化引擎", C.teal, "每个大客户合同/结算/风控规则不同；用策略模式+规则引擎解耦，新客户 1 周上线 vs 竞品 2 个月"],
    ["金融级精确计算", C.gold, "金额强制 DECIMAL、扣款走数据库行锁、支付计划引擎自动生成 —— 财务对账无差异，告别“差几分钱”"],
    ["仓单区块链存证", C.navy, "电子仓单+区块链+IoT 三道防线防一货多押，资金方敢按应收 80% 放款，不良率显著低于传统模式"],
    ["数据飞轮驱动", C.teal, "交易/仓单/履约数据越积越厚，金融服务利率更低、客户离开成本更高 —— 钱买不来的时间壁垒"],
  ];
  const y0 = 1.5, rh = 0.82, gap = 0.12;
  rows.forEach((r, i) => {
    const y = y0 + i * (rh + gap);
    card(s, 0.55, y, 9.0, rh, C.cardBg, r[1]);
    s.addText(r[0], { x: 0.75, y, w: 2.2, h: rh, fontSize: 13.5, bold: true, fontFace: "Arial Black", color: r[1], valign: "middle", margin: 0 });
    s.addText(r[2], { x: 3.0, y, w: 6.4, h: rh, fontSize: 10.8, fontFace: "Arial", color: C.darkText, valign: "middle", lineSpacingMultiple: 1.25, margin: 0 });
  });
}

// ============================================================
// SLIDE 12 — 解决了什么：技术管理
// ============================================================
{
  const s = pres.addSlide(); bg(s, C.white);
  lightTitle(s, "解决的问题③：技术管理", "从“我一个人扛”，到“体系兜底”——让团队不再依赖某个人");
  const items = [
    { h: "技术债台账治理", c: C.teal, b: "建立技术债台账，按风险/影响排序，迭代中强制消债；从被动救火到主动治理。" },
    { h: "契约治理", c: C.gold, b: "对外 9+ 接口建契约与监控，接口健康度看板；外部故障不再“背锅式”拖垮业务。" },
    { h: "稳定性机制", c: C.navy, b: "On-call 轮值 + 事故复盘不追责只追改进项；冬储预案、限流、降级成为制度而非临时抱佛脚。" },
    { h: "复合团队培养", c: C.teal, b: "既懂 C 撮合又懂大宗全链路的复合人才市场稀缺，用 2-3 年真实业务场景沉淀带队伍。" },
  ];
  const w = 4.4, h = 1.45, gx = 0.2, gy = 0.2, x0 = 0.55, y0 = 1.55;
  items.forEach((it, i) => {
    const x = x0 + (i % 2) * (w + gx);
    const y = y0 + Math.floor(i / 2) * (h + gy);
    card(s, x, y, w, h, C.cardBg, it.c);
    s.addText(it.h, { x: x + 0.2, y: y + 0.15, w: w - 0.4, h: 0.45, fontSize: 15, bold: true, fontFace: "Arial Black", color: it.c, margin: 0 });
    s.addText(it.b, { x: x + 0.2, y: y + 0.6, w: w - 0.4, h: 0.8, fontSize: 11, fontFace: "Arial", color: C.darkText, lineSpacingMultiple: 1.3, margin: 0 });
  });
}

// ============================================================
// SLIDE 13 — 核心成果数据看板
// ============================================================
{
  const s = pres.addSlide(); bg(s, C.navy);
  title(s, "核心成果：用数字说话", "技术投入最终都落在“业务结果”上", C.gold);
  const stats = [
    ["12+", "微服务集群", C.teal],
    ["5天→1.5天", "单笔交易周期", C.gold],
    ["3年", "零资金差错", C.white],
    ["99.95%", "系统可用率", C.teal],
    ["1周", "新客户上线", C.gold],
    ["0", "冬储期 P0 事故", C.white],
  ];
  const w = 2.85, gap = 0.2, x0 = 0.55, y0 = 1.7, h = 1.25;
  stats.forEach((st, i) => {
    const x = x0 + (i % 3) * (w + gap);
    const y = y0 + Math.floor(i / 3) * (h + 0.25);
    s.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: C.cardBg }, shadow: makeShadow() });
    s.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: C.navy }, line: { color: st[2], width: 1.5 } });
    s.addText(st[0], { x, y: y + 0.18, w, h: 0.6, fontSize: 27, bold: true, fontFace: "Arial Black", color: st[2], align: "center", valign: "middle", margin: 0 });
    s.addText(st[1], { x, y: y + 0.78, w, h: 0.4, fontSize: 12, fontFace: "Arial", color: C.midGray, align: "center", valign: "middle", margin: 0 });
  });
}

// ============================================================
// SLIDE 14 — 结束页
// ============================================================
{
  const s = pres.addSlide(); bg(s);
  topBar(s);
  s.addText("技术驱动业务增长", { x: 0.8, y: 1.6, w: 8.4, h: 0.9, fontSize: 34, fontFace: "Arial Black", color: C.white, bold: true, margin: 0 });
  s.addText("让“信任”成为系统的能力，让“数据”成为平台的资产", { x: 0.8, y: 2.6, w: 8.4, h: 0.5, fontSize: 16, fontFace: "Arial", color: C.gold, margin: 0 });
  s.addShape(pres.shapes.RECTANGLE, { x: 0.8, y: 3.3, w: 2.2, h: 0.04, fill: { color: C.teal } });
  s.addText("感谢聆听 · 欢迎就业务链条与技术方案深入交流", { x: 0.8, y: 3.7, w: 8.4, h: 0.4, fontSize: 13, fontFace: "Arial", color: C.midGray, margin: 0 });
  s.addText("汇报人：【您的姓名】  ·  B2B 平台技术经理", { x: 0.8, y: 4.3, w: 8.4, h: 0.4, fontSize: 12, fontFace: "Arial", color: C.teal, margin: 0 });
}

const outFile = path.join(__dirname, "产品全业务链条与运营思路.pptx");
pres.writeFile({ fileName: outFile }).then(f => {
  console.log("✅ PPT generated:", f);
}).catch(e => {
  console.error("❌ Error:", e);
  process.exit(1);
});
