const pptxgen = require("C:/Users/qq940/.workbuddy/binaries/node/workspace/node_modules/pptxgenjs");

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5
pres.author = "B2B 平台交付团队";
pres.title = "B2B 大宗商品交易供应链平台 · 服务客户案例集";

// ---- palette ----
const C = {
  navy: "0F2A43",
  teal: "1C7293",
  amber: "F5A623",
  light: "F4F6F8",
  card: "FFFFFF",
  ink: "1F2A33",
  mute: "6B7785",
  link: "0E7C9B",
  white: "FFFFFF",
};

const W = 13.33;
const H = 7.5;

function shadow() {
  return { type: "outer", color: "000000", blur: 9, offset: 3, angle: 90, opacity: 0.13 };
}

// ---- customer data ----
const groups = [
  {
    name: "能源与化工",
    items: [
      { name: "上海石油天然气交易中心", tag: "能源 · 石油化工", link: "https://www.shpgx.com/html/", desc: "石化能源现货挂牌与竞价交易" },
      { name: "陕西煤炭交易中心", tag: "煤炭 · 能源", link: "https://www.westcoal.com.cn/", desc: "煤炭产运需在线交易与供应链" },
      { name: "昆明电力交易中心", tag: "电力 · 能源", link: "https://www.kmpex.com/portal/#/home", desc: "电力市场化交易与绿电绿证" },
      { name: "新疆汇宗大宗", tag: "大宗商品", link: "https://www.xjhzjyw.com/", desc: "疆煤外运与大宗现货交易" },
    ],
  },
  {
    name: "煤炭与矿产",
    items: [
      { name: "河南煤炭交易中心（豫煤交易）", tag: "煤炭", link: "https://e.hncitc.com/", desc: "河南省属煤炭统一上线交易" },
      { name: "贵州清镇 · 富矿精开（清铝集采）", tag: "矿产 · 铝", link: "https://www.alcqz.com/", desc: "铝土矿集采与内销备案管理" },
      { name: "河南国龙 · 中原云商 / 数字产业链", tag: "煤炭 · 供应链", link: "http://119.3.239.91:9191/", desc: "中原地区大宗商品供应链协同平台" },
    ],
  },
  {
    name: "金属与综合大宗",
    items: [
      { name: "广州商品交易所", tag: "综合 · 金属", link: "https://www.gzcmex.com/", desc: "工业金属与化工品现货交易" },
      { name: "郑州商品交易所 · 场外业务", tag: "农产品 · 综合", link: "https://otc.czce.com.cn/#/home", desc: "场外衍生品与仓单交易" },
      { name: "郑州航空港 · 大宗商品物流贸易服务平台", tag: "物流 · 贸易", link: "http://1.95.89.254:7370/", desc: "空港型大宗商品物流贸易一体化" },
    ],
  },
  {
    name: "农产品 · 食品 · 林产品",
    items: [
      { name: "中国林产品交易中心（广西林控）", tag: "林产品", link: "https://www.zgdmly.com/home", desc: "木材木制品现货与供应链" },
      { name: "福建东盟", tag: "农产品 · 进出口", link: "https://campe.cn/", desc: "东盟农产品跨境大宗交易" },
      { name: "广西晔龙 · 粕力科技", tag: "农产品 · 饲料", link: "https://www.cnpoli.com/", desc: "豆粕菜粕等饲料原料交易" },
      { name: "天津肉安网", tag: "食品 · 安全", link: "http://1.95.189.122:9390/", desc: "肉类食品安全溯源供应链平台" },
    ],
  },
  {
    name: "港务与供应链服务",
    items: [
      { name: "广西北部湾大宗商品交易中心", tag: "港务 · 大宗", link: "https://www.bbwcec.com/", desc: "北部湾港口大宗现货与数据大屏" },
      { name: "深圳虹点", tag: "供应链服务", link: "https://hongdian168.com/", desc: "电子元器件供应链协同服务" },
    ],
  },
];

// flatten for overview
const all = groups.flatMap((g) => g.items.map((it) => ({ ...it, group: g.name })));

// ---------- helpers ----------
function footer(slide, idx) {
  slide.addText("B2B 大宗商品交易供应链平台 · 服务客户案例集", {
    x: 0.6, y: H - 0.42, w: 8, h: 0.3, fontSize: 9, color: C.mute, align: "left", margin: 0,
  });
  slide.addText(String(idx), {
    x: W - 1.1, y: H - 0.42, w: 0.5, h: 0.3, fontSize: 9, color: C.mute, align: "right", margin: 0,
  });
}

function card(slide, it, x, y, w, h) {
  // white card
  slide.addShape(pres.shapes.RECTANGLE, {
    x, y, w, h, fill: { color: C.card }, line: { color: "E3E8EE", width: 1 }, shadow: shadow(),
  });
  // amber accent bar on left
  slide.addShape(pres.shapes.RECTANGLE, {
    x, y, w: 0.13, h, fill: { color: C.amber },
  });
  const ix = x + 0.35;
  const iw = w - 0.6;
  // name (clickable)
  slide.addText(
    [{ text: it.name, options: { hyperlink: { url: it.link }, color: C.navy, bold: true } }],
    { x: ix, y: y + 0.18, w: iw, h: 0.55, fontSize: 14.5, fontFace: "Microsoft YaHei", align: "left", valign: "top", margin: 0 }
  );
  // tag
  slide.addText(it.tag, {
    x: ix, y: y + 0.74, w: iw, h: 0.3, fontSize: 10.5, color: C.teal, bold: true, align: "left", margin: 0,
  });
  // desc
  slide.addText(it.desc, {
    x: ix, y: y + 1.06, w: iw, h: 0.5, fontSize: 11, color: C.ink, align: "left", valign: "top", margin: 0,
  });
  // link (clickable, wrapped)
  slide.addText(
    [{ text: it.link, options: { hyperlink: { url: it.link }, color: C.link, italic: true } }],
    { x: ix, y: y + h - 0.52, w: iw, h: 0.4, fontSize: 9.5, fontFace: "Consolas", align: "left", valign: "middle", margin: 0 }
  );
}

// ============ Slide 1: Cover ============
(function () {
  const s = pres.addSlide();
  s.background = { color: C.navy };
  // decorative amber square (bottom-right, partially off)
  s.addShape(pres.shapes.RECTANGLE, { x: W - 2.4, y: H - 2.4, w: 3.4, h: 3.4, fill: { color: C.amber }, rotate: 18 });
  // teal vertical accent
  s.addShape(pres.shapes.RECTANGLE, { x: 0.9, y: 2.0, w: 0.16, h: 2.6, fill: { color: C.amber } });
  s.addText("B2B 大宗商品交易供应链平台", {
    x: 1.3, y: 1.85, w: 10.5, h: 1.0, fontSize: 40, bold: true, color: C.white, fontFace: "Microsoft YaHei", align: "left", margin: 0,
  });
  s.addText("服务客户案例集 · 正式环境访问入口", {
    x: 1.32, y: 2.95, w: 10.5, h: 0.6, fontSize: 20, color: C.amber, fontFace: "Microsoft YaHei", align: "left", margin: 0,
  });
  s.addText("面向能源、煤炭、金属、农产品、港务等大宗商品行业的交易撮合与供应链协同平台", {
    x: 1.32, y: 3.75, w: 10.2, h: 0.6, fontSize: 13, color: "C7D3DE", align: "left", margin: 0,
  });
  s.addText("内部资料 · 2026.07 · 仅含正式生产环境", {
    x: 1.32, y: H - 0.85, w: 10, h: 0.4, fontSize: 11, color: "8FA3B5", align: "left", margin: 0,
  });
})();

// ============ Slide 2: Platform capabilities ============
(function () {
  const s = pres.addSlide();
  s.background = { color: C.light };
  s.addShape(pres.shapes.RECTANGLE, { x: 0.6, y: 0.55, w: 0.16, h: 0.7, fill: { color: C.amber } });
  s.addText("平台能力", {
    x: 0.95, y: 0.5, w: 11, h: 0.8, fontSize: 30, bold: true, color: C.navy, fontFace: "Microsoft YaHei", align: "left", margin: 0,
  });
  s.addText("为大宗商品交易场所与产业客户提供一站式数字化基础设施，覆盖从交易到履约的全链路。", {
    x: 0.95, y: 1.35, w: 11.5, h: 0.5, fontSize: 13, color: C.mute, align: "left", margin: 0,
  });

  const caps = [
    { n: "1", t: "交易撮合", d: "挂牌 / 竞价 / 撮合引擎，多品种大宗商品支持" },
    { n: "2", t: "供应链协同", d: "合同、物流、仓储、结算一体化管理" },
    { n: "3", t: "风控与结算", d: "履约保证、资金清算、风险监控" },
    { n: "4", t: "数据服务", d: "行情、指数、大屏可视化分析" },
    { n: "5", t: "生态对接", d: "银行 / 物流 / 税务 / CA 等外部系统" },
  ];
  const cw = 2.32, gap = 0.22, startX = 0.6, cy = 2.35, ch = 3.5;
  caps.forEach((c, i) => {
    const x = startX + i * (cw + gap);
    s.addShape(pres.shapes.RECTANGLE, { x, y: cy, w: cw, h: ch, fill: { color: C.card }, line: { color: "E3E8EE", width: 1 }, shadow: shadow() });
    // number circle
    s.addShape(pres.shapes.OVAL, { x: x + cw / 2 - 0.42, y: cy + 0.4, w: 0.84, h: 0.84, fill: { color: C.amber } });
    s.addText(c.n, { x: x + cw / 2 - 0.42, y: cy + 0.4, w: 0.84, h: 0.84, fontSize: 26, bold: true, color: C.navy, align: "center", valign: "middle", margin: 0 });
    s.addText(c.t, { x: x + 0.1, y: cy + 1.45, w: cw - 0.2, h: 0.5, fontSize: 16, bold: true, color: C.teal, align: "center", margin: 0, fontFace: "Microsoft YaHei" });
    s.addText(c.d, { x: x + 0.18, y: cy + 2.0, w: cw - 0.36, h: 1.2, fontSize: 11, color: C.ink, align: "center", valign: "top", margin: 0 });
  });
  footer(s, 2);
})();

// ============ Slide 3: Overview (all links) ============
(function () {
  const s = pres.addSlide();
  s.background = { color: C.light };
  s.addShape(pres.shapes.RECTANGLE, { x: 0.6, y: 0.5, w: 0.16, h: 0.7, fill: { color: C.amber } });
  s.addText("服务客户一览（正式环境）", {
    x: 0.95, y: 0.45, w: 11.5, h: 0.8, fontSize: 30, bold: true, color: C.navy, fontFace: "Microsoft YaHei", align: "left", margin: 0,
  });
  s.addText("以下为平台已服务的正式生产环境客户及其访问入口，点击链接可直接跳转。共 " + all.length + " 家。", {
    x: 0.95, y: 1.3, w: 11.8, h: 0.4, fontSize: 12.5, color: C.mute, align: "left", margin: 0,
  });

  const colX = [0.7, 6.95];
  const colW = 5.9;
  const rowH = 0.66;
  const startY = 1.95;
  const perCol = Math.ceil(all.length / 2);
  all.forEach((it, i) => {
    const col = i < perCol ? 0 : 1;
    const row = i < perCol ? i : i - perCol;
    const x = colX[col];
    const y = startY + row * rowH;
    // index dot
    s.addShape(pres.shapes.OVAL, { x: x, y: y + 0.1, w: 0.16, h: 0.16, fill: { color: C.amber } });
    s.addText(
      [{ text: it.name + "  ", options: { hyperlink: { url: it.link }, color: C.navy, bold: true } },
       { text: "（" + it.group + "）", options: { color: C.mute, fontSize: 9 } }],
      { x: x + 0.28, y: y - 0.04, w: colW - 0.3, h: 0.32, fontSize: 12.5, fontFace: "Microsoft YaHei", align: "left", valign: "middle", margin: 0 }
    );
    s.addText(
      [{ text: it.link, options: { hyperlink: { url: it.link }, color: C.link, italic: true } }],
      { x: x + 0.28, y: y + 0.28, w: colW - 0.3, h: 0.3, fontSize: 9.5, fontFace: "Consolas", align: "left", valign: "middle", margin: 0 }
    );
  });
  footer(s, 3);
})();

// ============ Slides 4-8: sector groups ============
groups.forEach((g, gi) => {
  const s = pres.addSlide();
  s.background = { color: C.light };
  // header
  s.addShape(pres.shapes.RECTANGLE, { x: 0.6, y: 0.5, w: 0.16, h: 0.7, fill: { color: C.amber } });
  s.addText(g.name + " · 服务客户", {
    x: 0.95, y: 0.45, w: 11.5, h: 0.8, fontSize: 28, bold: true, color: C.navy, fontFace: "Microsoft YaHei", align: "left", margin: 0,
  });
  s.addText("共 " + g.items.length + " 家 · 正式生产环境", {
    x: 0.95, y: 1.3, w: 11, h: 0.4, fontSize: 12, color: C.teal, bold: true, align: "left", margin: 0,
  });

  const n = g.items.length;
  if (n === 4) {
    const cw = 5.9, ch = 2.0, gx = 0.65, gy = 0.45;
    const xs = [0.6, 6.85], ys = [1.95, 4.2];
    g.items.forEach((it, i) => card(s, it, xs[i % 2], ys[Math.floor(i / 2)], cw, ch));
  } else if (n === 3) {
    const cw = 3.95, ch = 2.7, gap = 0.25, startX = 0.6, y = 2.1;
    g.items.forEach((it, i) => card(s, it, startX + i * (cw + gap), y, cw, ch));
  } else if (n === 2) {
    const cw = 5.9, ch = 2.7, xs = [0.6, 6.85], y = 2.3;
    g.items.forEach((it, i) => card(s, it, xs[i], y, cw, ch));
  }
  footer(s, 4 + gi);
});

// ============ Slide 9: Closing ============
(function () {
  const s = pres.addSlide();
  s.background = { color: C.navy };
  s.addShape(pres.shapes.RECTANGLE, { x: W - 2.6, y: -1.0, w: 3.4, h: 3.4, fill: { color: C.teal }, rotate: 18 });
  s.addShape(pres.shapes.RECTANGLE, { x: 0.9, y: 2.4, w: 0.16, h: 1.8, fill: { color: C.amber } });
  s.addText("携手共建大宗商品产业互联网", {
    x: 1.3, y: 2.3, w: 11, h: 1.0, fontSize: 34, bold: true, color: C.white, fontFace: "Microsoft YaHei", align: "left", margin: 0,
  });
  s.addText("以稳定、合规、可扩展的平台能力，支撑更多产业客户实现交易数字化与供应链协同。", {
    x: 1.32, y: 3.45, w: 10.5, h: 0.6, fontSize: 14, color: "C7D3DE", align: "left", margin: 0,
  });
  s.addText("B2B 大宗商品交易供应链平台 · 交付团队", {
    x: 1.32, y: H - 0.85, w: 10, h: 0.4, fontSize: 11, color: "8FA3B5", align: "left", margin: 0,
  });
})();

pres.writeFile({ fileName: "D:/ai_show/hello_my_boy/B2B产品服务客户案例.pptx" }).then((f) => {
  console.log("SAVED:", f);
});
