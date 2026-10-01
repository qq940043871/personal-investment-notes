const pptxgen = require("pptxgenjs");
const path = require("path");

// ─── Color Palette (Navy Executive) ───
const C = {
  navy:    "152C42",  // primary dark
  teal:    "1A7F8C",  // secondary accent
  gold:    "D4940B",  // highlight accent
  white:   "FFFFFF",
  offWhite:"F2F4F7",
  lightGray:"E3E8EE",
  midGray: "8899AA",
  darkText:"1B2A3B",
  cardBg:  "F8F9FB",
};

// ─── Helpers ───
function makeShadow() {
  return { type: "outer", blur: 4, offset: 2, angle: 135, color: "000000", opacity: 0.10 };
}

// ─── Presentation ───
const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.author = "B2B Tech Manager";
pres.title = "B2B大宗贸易供应链 — 技术经理能力介绍";

// ================================================================
// SLIDE 1: 封面
// ================================================================
{
  const s = pres.addSlide();
  s.background = { color: C.navy };
  
  // Accent bar top
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.gold } });
  
  // Name
  s.addText("技术经理 · 能力全景", {
    x: 0.8, y: 1.2, w: 8.4, h: 1.0,
    fontSize: 40, fontFace: "Arial Black", color: C.white, bold: true, margin: 0
  });
  
  // Subtitle
  s.addText("B2B大宗贸易供应链平台", {
    x: 0.8, y: 2.15, w: 8.4, h: 0.55,
    fontSize: 20, fontFace: "Arial", color: C.gold, margin: 0
  });
  
  // Divider
  s.addShape(pres.shapes.RECTANGLE, { x: 0.8, y: 2.85, w: 2.2, h: 0.04, fill: { color: C.teal } });
  
  // Tags
  s.addText([
    { text: "Java + Vue 全栈", options: { breakLine: true } },
    { text: "C+Java 异构架构治理  |  12+微服务集群  |  9+生态接口", options: { breakLine: true } },
    { text: "交易系统  ·  供应链金融  ·  平台化建设", options: {} }
  ], {
    x: 0.8, y: 3.15, w: 8.4, h: 1.2,
    fontSize: 14, fontFace: "Arial", color: C.midGray, lineSpacingMultiple: 1.6, margin: 0
  });
  
  // Bottom accent
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 5.565, w: 10, h: 0.06, fill: { color: C.gold } });
}

// ================================================================
// SLIDE 2: 一句话定位
// ================================================================
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  
  // Top bar
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.gold } });
  
  // Section tag
  s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: 0.4, w: 0.06, h: 0.5, fill: { color: C.teal } });
  s.addText("我的定位", { x: 0.95, y: 0.35, w: 4, h: 0.55, fontSize: 22, fontFace: "Arial Black", color: C.navy, margin: 0 });
  
  // Statement
  s.addText("负责大宗商品B2B交易平台的业务中台，\n管理交易撮合、履约保证、数据服务、规则配置和生态对接五大核心模块，\n带技术团队，对接 9+ 外部系统。", {
    x: 0.7, y: 1.25, w: 8.6, h: 1.2,
    fontSize: 17, fontFace: "Arial", color: C.darkText, lineSpacingMultiple: 1.5, margin: 0
  });
  
  // Three differentiation cards
  const cards = [
    { title: "驾驭异构架构", desc: "C 语言撮合引擎 + Java 业务中台\n+ Vue 前端，市场上稀缺的\n异构系统治理能力", color: C.teal },
    { title: "技术+业务双修", desc: "既懂撮合引擎的延迟确定性，\n也懂大宗贸易全链路——\n从挂牌到交收、从仓储到税务", color: C.navy },
    { title: "金融级可靠性", desc: "三年零资金差错记录，\n99.5%+ 系统可用率，\n冬储流量暴增零 P0 事故", color: C.gold },
  ];
  
  cards.forEach((card, i) => {
    const cx = 0.7 + i * 3.05;
    const cy = 2.8;
    // Card bg
    s.addShape(pres.shapes.RECTANGLE, {
      x: cx, y: cy, w: 2.8, h: 2.45,
      fill: { color: C.cardBg }, shadow: makeShadow()
    });
    // Color bar top
    s.addShape(pres.shapes.RECTANGLE, {
      x: cx, y: cy, w: 2.8, h: 0.06, fill: { color: card.color }
    });
    s.addText(card.title, {
      x: cx + 0.2, y: cy + 0.3, w: 2.4, h: 0.5,
      fontSize: 15, fontFace: "Arial Black", color: card.color, margin: 0
    });
    s.addText(card.desc, {
      x: cx + 0.2, y: cy + 0.9, w: 2.4, h: 1.3,
      fontSize: 11, fontFace: "Arial", color: C.darkText, lineSpacingMultiple: 1.4, margin: 0
    });
  });
}

// ================================================================
// SLIDE 3: 核心数据看板
// ================================================================
{
  const s = pres.addSlide();
  s.background = { color: C.navy };
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.gold } });
  
  s.addText("核心数据看板", {
    x: 0.7, y: 0.35, w: 4, h: 0.6, fontSize: 24, fontFace: "Arial Black", color: C.white, margin: 0
  });
  
  // 2x3 grid of stats
  const stats = [
    { value: "12+", label: "微服务集群", sub: "Java Spring Cloud 生态" },
    { value: "9+", label: "外部生态接口", sub: "银行/物流/CTRM/税务等" },
    { value: "5天→1.5天", label: "交易周期缩短", sub: "全链路在线化" },
    { value: "3年", label: "零资金差错", sub: "金融级数据精确性" },
    { value: "3天→2小时", label: "财务对账效率", sub: "自动化对账系统" },
    { value: "5-10x", label: "冬储流量承载", sub: "弹性伸缩零 P0" },
  ];
  
  stats.forEach((st, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const cx = 0.7 + col * 3.05;
    const cy = 1.3 + row * 2.0;
    
    s.addShape(pres.shapes.RECTANGLE, {
      x: cx, y: cy, w: 2.8, h: 1.7,
      fill: { color: C.white, transparency: 92 }
    });
    s.addText(st.value, {
      x: cx + 0.15, y: cy + 0.15, w: 2.5, h: 0.7,
      fontSize: 28, fontFace: "Arial Black", color: C.gold, margin: 0
    });
    s.addText(st.label, {
      x: cx + 0.15, y: cy + 0.8, w: 2.5, h: 0.35,
      fontSize: 13, fontFace: "Arial Black", color: C.white, margin: 0
    });
    s.addText(st.sub, {
      x: cx + 0.15, y: cy + 1.15, w: 2.5, h: 0.35,
      fontSize: 10, fontFace: "Arial", color: C.midGray, margin: 0
    });
  });
}

// ================================================================
// SLIDE 4: 系统架构全景 (dark bg)
// ================================================================
{
  const s = pres.addSlide();
  s.background = { color: C.navy };
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.gold } });
  
  s.addText("系统架构全景", {
    x: 0.7, y: 0.25, w: 6, h: 0.5, fontSize: 22, fontFace: "Arial Black", color: C.white, margin: 0
  });
  s.addText("异构四层架构 · C+Java+Vue", {
    x: 0.7, y: 0.7, w: 6, h: 0.3, fontSize: 12, fontFace: "Arial", color: C.gold, margin: 0
  });
  
  const layers = [
    { y: 1.25, label: "接入层", items: "外部大屏  |  普通客户 PC+移动  |  机构客户 PC+移动", color: "5B7FA5" },
    { y: 2.05, label: "网关层", items: "midservice 1/2/3 (Java 自研)  +  midmon 监控面板", color: "3A6B8C" },
    { y: 2.85, label: "业务中台", items: "管理系统(10+模块)  |  DS 数据中心  |  交易核心(C)  |  12+业务微服务", color: C.teal },
    { y: 3.65, label: "数据层", items: "MySQL x2 (主从)  |  MinIO 对象存储  |  Kafka 消息队列  |  缓存服务(Redis)", color: "2A5A5A" },
    { y: 4.45, label: "生态接口", items: "银行  ·  物流  ·  CTRM  ·  税务  ·  仓储  ·  短信  ·  证书  ·  企查查  ·  供应链金融", color: C.gold },
  ];
  
  layers.forEach((ly) => {
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.55, y: ly.y, w: 0.06, h: 0.62, fill: { color: ly.color }
    });
    s.addText(ly.label, {
      x: 0.8, y: ly.y, w: 1.2, h: 0.3,
      fontSize: 11, fontFace: "Arial Black", color: ly.color, margin: 0
    });
    s.addText(ly.items, {
      x: 0.8, y: ly.y + 0.28, w: 8.6, h: 0.3,
      fontSize: 11, fontFace: "Arial", color: C.white, margin: 0
    });
    
    if (ly.y < 4.4) {
      // Arrow between layers
      s.addText("▾", {
        x: 4.5, y: ly.y + 0.65, w: 1, h: 0.2,
        fontSize: 12, color: C.midGray, align: "center", margin: 0
      });
    }
  });
}

// ================================================================
// SLIDE 5: 双核驱动 — 异构架构核心设计 (light)
// ================================================================
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.gold } });
  
  s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: 0.4, w: 0.06, h: 0.5, fill: { color: C.teal } });
  s.addText("双核驱动：DS 数据中心 + 交易核心", {
    x: 0.95, y: 0.35, w: 7, h: 0.55, fontSize: 22, fontFace: "Arial Black", color: C.navy, margin: 0
  });
  
  // Left: C Engine
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.7, y: 1.25, w: 3.5, h: 3.95,
    fill: { color: C.cardBg }, shadow: makeShadow()
  });
  s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: 1.25, w: 3.5, h: 0.06, fill: { color: C.navy } });
  s.addText("交易核心（C 语言）", {
    x: 0.9, y: 1.5, w: 3.1, h: 0.4, fontSize: 15, fontFace: "Arial Black", color: C.navy, margin: 0
  });
  s.addText([
    { text: "▸ 单线程内存撮合引擎", options: { breakLine: true } },
    { text: "▸ 纳秒级延迟确定性", options: { breakLine: true } },
    { text: "▸ 无 GC 停顿（vs Java）", options: { breakLine: true } },
    { text: "▸ 价格优先 / 时间优先", options: { breakLine: true } },
    { text: "▸ 异步落库，不阻塞撮合", options: { breakLine: true } },
    { text: "▸ 金融级确定性输出", options: {} }
  ], {
    x: 0.9, y: 2.1, w: 3.1, h: 2.8,
    fontSize: 11, fontFace: "Arial", color: C.darkText, lineSpacingMultiple: 1.7, margin: 0
  });
  
  // Middle: DS Bridge
  s.addShape(pres.shapes.RECTANGLE, {
    x: 4.5, y: 2.7, w: 1.0, h: 0.7,
    fill: { color: C.teal }
  });
  s.addText("DS\n桥接", {
    x: 4.5, y: 2.7, w: 1.0, h: 0.7,
    fontSize: 13, fontFace: "Arial Black", color: C.white, align: "center", valign: "middle", margin: 0
  });
  
  // Right: Java
  s.addShape(pres.shapes.RECTANGLE, {
    x: 5.8, y: 1.25, w: 3.5, h: 3.95,
    fill: { color: C.cardBg }, shadow: makeShadow()
  });
  s.addShape(pres.shapes.RECTANGLE, { x: 5.8, y: 1.25, w: 3.5, h: 0.06, fill: { color: C.teal } });
  s.addText("业务中台（Java 生态）", {
    x: 6.0, y: 1.5, w: 3.1, h: 0.4, fontSize: 15, fontFace: "Arial Black", color: C.teal, margin: 0
  });
  s.addText([
    { text: "▸ DS 数据中心 — Java 防腐层", options: { breakLine: true, bold: true } },
    { text: "   TCP 自定义报文 ↔ C 撮合引擎", options: { breakLine: true, fontSize: 10 } },
    { text: "   Hessian ↔ 上游 Java 微服务", options: { breakLine: true, fontSize: 10 } },
    { text: "▸ 12+ 微服务集群", options: { breakLine: true } },
    { text: "▸ Spring Cloud / Nacos / Sentinel", options: { breakLine: true } },
    { text: "▸ Saga 分布式事务 + 状态机", options: { breakLine: true } },
    { text: "▸ Drools 规则引擎热更新", options: {} }
  ], {
    x: 6.0, y: 2.1, w: 3.1, h: 2.8,
    fontSize: 11, fontFace: "Arial", color: C.darkText, lineSpacingMultiple: 1.55, margin: 0
  });
  
  // Protocol labels
  s.addText("TCP 自定义报文", {
    x: 3.1, y: 3.05, w: 1.5, h: 0.35,
    fontSize: 10, fontFace: "Arial", color: C.midGray, align: "center", margin: 0
  });
  s.addText("Hessian", {
    x: 4.2, y: 1.85, w: 1.5, h: 0.35,
    fontSize: 10, fontFace: "Arial", color: C.midGray, align: "center", margin: 0
  });
}

// ================================================================
// SLIDE 6: 一笔交易全链路 (dark)
// ================================================================
{
  const s = pres.addSlide();
  s.background = { color: C.navy };
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.gold } });
  
  s.addText("一笔交易全链路：从挂牌到交收", {
    x: 0.7, y: 0.25, w: 8, h: 0.55, fontSize: 22, fontFace: "Arial Black", color: C.white, margin: 0
  });
  
  const steps = [
    { n: "01", title: "挂牌下单", desc: "Vue 前端 →\nmidservice 网关\n鉴权/限流/路由" },
    { n: "02", title: "防重校验", desc: "Redis SETNX\n防重复提交\n分布式锁防超卖" },
    { n: "03", title: "撮合执行", desc: "DS 数据中心 →\nTCP 自定义报文 →\nC 撮合引擎" },
    { n: "04", title: "结果通知", desc: "撮合结果异步回推\n→ Kafka 通知\n→ 仓储/财务/风控" },
    { n: "05", title: "履约编排", desc: "Saga 分布式事务\n→ 状态机驱动\n→ 仓单/质检/交收" },
    { n: "06", title: "缓存同步", desc: "Canal binlog →\n缓存服务(Redis)\n→ 前端加速" },
  ];
  
  steps.forEach((st, i) => {
    const cx = 0.3 + i * 1.55;
    const cy = 1.1;
    
    s.addShape(pres.shapes.RECTANGLE, {
      x: cx, y: cy, w: 1.4, h: 2.4,
      fill: { color: C.white, transparency: 92 }
    });
    s.addText(st.n, {
      x: cx + 0.1, y: cy + 0.15, w: 1.2, h: 0.4,
      fontSize: 22, fontFace: "Arial Black", color: C.gold, margin: 0
    });
    s.addText(st.title, {
      x: cx + 0.1, y: cy + 0.55, w: 1.2, h: 0.35,
      fontSize: 12, fontFace: "Arial Black", color: C.white, margin: 0
    });
    s.addText(st.desc, {
      x: cx + 0.1, y: cy + 1.0, w: 1.2, h: 1.2,
      fontSize: 9, fontFace: "Arial", color: C.midGray, lineSpacingMultiple: 1.4, margin: 0
    });
    
    // Arrow
    if (i < 5) {
      s.addText("→", {
        x: cx + 1.35, y: cy + 0.9, w: 0.3, h: 0.4,
        fontSize: 16, color: C.teal, align: "center", margin: 0
      });
    }
  });
  
  // Footer stats
  s.addShape(pres.shapes.RECTANGLE, { x: 0.35, y: 3.8, w: 9.3, h: 0.02, fill: { color: C.teal } });
  
  const footStats = [
    { val: "< 500ms", label: "端到端延迟" },
    { val: "零丢失", label: "消息可靠性" },
    { val: "最终一致", label: "数据一致性" },
  ];
  footStats.forEach((fs, i) => {
    s.addText(fs.val, {
      x: 0.7 + i * 3.15, y: 4.0, w: 2.8, h: 0.5,
      fontSize: 22, fontFace: "Arial Black", color: C.gold, align: "center", margin: 0
    });
    s.addText(fs.label, {
      x: 0.7 + i * 3.15, y: 4.5, w: 2.8, h: 0.3,
      fontSize: 11, fontFace: "Arial", color: C.midGray, align: "center", margin: 0
    });
  });
}

// ================================================================
// SLIDE 7: 技术决策力 (light)
// ================================================================
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.gold } });
  
  s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: 0.4, w: 0.06, h: 0.5, fill: { color: C.teal } });
  s.addText("核心技术决策", {
    x: 0.95, y: 0.35, w: 4, h: 0.55, fontSize: 22, fontFace: "Arial Black", color: C.navy, margin: 0
  });
  
  const decisions = [
    { title: "撮合引擎：C 语言", sub: "单线程内存撮合", reason: "延迟确定性，无 GC 停顿。Java 做撮合可能因 GC 产生不可预测的延迟抖动，金融交易不可接受。", color: C.navy },
    { title: "异构通信：TCP 自定义报文", sub: "DS 数据中心 ↔ C 引擎", reason: "自研二进制协议，极简高效，一个字节都不浪费。上游 Java 服务走 Hessian，生态友好可调试。", color: C.teal },
    { title: "微服务拆分：按业务域", sub: "12+ 服务，非按技术层", reason: "交易/风控/资金独立部署独立扩容。强一致性要求的用模块化代替服务化，避免分布式事务泛滥。", color: C.navy },
    { title: "缓存双保险", sub: "Cache-Aside + Canal 兜底", reason: "先更新 DB 再删缓存。Canal 监听 binlog 做异步兜底——缓存删除失败的最终防线。", color: C.teal },
    { title: "分布式事务：Saga", sub: "不用 2PC，锁太久", reason: "大宗交易跨月，2PC 锁资源不可行。Saga + 状态机 + 补偿表 + 对账兜底 = 四层防线。", color: C.navy },
    { title: "规则引擎：Drools", sub: "计费/风控/促销热更新", reason: "100 个客户 100 套规则，硬编码是死路。Drools 规则改完 5 分钟生效，年省 200+ 发布窗口。", color: C.teal },
  ];
  
  decisions.forEach((d, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = 0.7 + col * 4.5;
    const cy = 1.15 + row * 1.55;
    
    s.addShape(pres.shapes.RECTANGLE, {
      x: cx, y: cy, w: 4.2, h: 1.35,
      fill: { color: C.cardBg }, shadow: makeShadow()
    });
    s.addShape(pres.shapes.RECTANGLE, { x: cx, y: cy, w: 0.06, h: 1.35, fill: { color: d.color } });
    
    s.addText(d.title, {
      x: cx + 0.2, y: cy + 0.08, w: 3.8, h: 0.28,
      fontSize: 13, fontFace: "Arial Black", color: d.color, margin: 0
    });
    s.addText(d.sub, {
      x: cx + 0.2, y: cy + 0.35, w: 3.8, h: 0.22,
      fontSize: 10, fontFace: "Arial", color: C.midGray, italic: true, margin: 0
    });
    s.addText(d.reason, {
      x: cx + 0.2, y: cy + 0.58, w: 3.8, h: 0.52,
      fontSize: 9.5, fontFace: "Arial", color: C.darkText, lineSpacingMultiple: 1.3, margin: 0
    });
  });
}

// ================================================================
// SLIDE 8: 技术栈全景 (dark)
// ================================================================
{
  const s = pres.addSlide();
  s.background = { color: C.navy };
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.gold } });
  
  s.addText("技术栈全景", {
    x: 0.7, y: 0.25, w: 6, h: 0.55, fontSize: 22, fontFace: "Arial Black", color: C.white, margin: 0
  });
  
  const stacks = [
    { cat: "前端", items: ["Vue 2/3", "Element UI", "三端适配", "大屏可视化"], color: "5B9BD5" },
    { cat: "网关", items: ["midservice(自研)", "midmon 监控", "鉴权/限流/路由", "多租户灰度"], color: "3A6B8C" },
    { cat: "业务层", items: ["Spring Cloud", "Nacos 注册/配置", "Sentinel 限流降级", "Redisson 分布式锁"], color: C.teal },
    { cat: "交易引擎", items: ["C 撮合引擎", "TCP 自定义报文", "DS 防腐层(Java)", "Hessian 序列化"], color: "D4940B" },
    { cat: "消息/数据", items: ["Kafka 消息队列", "MySQL 主从", "Redis 缓存集群", "MinIO 对象存储"], color: "2A7A5A" },
    { cat: "数据同步", items: ["Canal binlog", "ES 全文检索", "XXL-Job 调度", "Drools 规则引擎"], color: "6B4C9A" },
    { cat: "外部对接", items: ["银行/支付接口", "CTRM/物流对接", "电子签章 SDK", "企查查/税务"], color: "C0504D" },
    { cat: "运维监控", items: ["Docker + K8s", "Prometheus", "Grafana", "GitLab CI/CD"], color: "4A7080" },
  ];
  
  stacks.forEach((st, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const cx = 0.35 + col * 2.4;
    const cy = 1.05 + row * 2.15;
    
    s.addShape(pres.shapes.RECTANGLE, {
      x: cx, y: cy, w: 2.15, h: 1.85,
      fill: { color: C.white, transparency: 92 }
    });
    s.addText(st.cat, {
      x: cx + 0.1, y: cy + 0.08, w: 1.95, h: 0.3,
      fontSize: 13, fontFace: "Arial Black", color: st.color, margin: 0
    });
    s.addShape(pres.shapes.RECTANGLE, { x: cx + 0.1, y: cy + 0.42, w: 1.6, h: 0.015, fill: { color: st.color } });
    st.items.forEach((item, j) => {
      s.addText("· " + item, {
        x: cx + 0.1, y: cy + 0.5 + j * 0.3, w: 1.95, h: 0.25,
        fontSize: 9, fontFace: "Arial", color: C.white, margin: 0
      });
    });
  });
}

// ================================================================
// SLIDE 9: 业务深度 — 五大核心模块 (light)
// ================================================================
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.gold } });
  
  s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: 0.4, w: 0.06, h: 0.5, fill: { color: C.teal } });
  s.addText("业务深度：五大核心模块", {
    x: 0.95, y: 0.35, w: 6, h: 0.55, fontSize: 22, fontFace: "Arial Black", color: C.navy, margin: 0
  });
  
  const modules = [
    { title: "交易模式", items: "挂牌 / 竞价 / 询价\n代采 / 预售 / 远期\n策略模式 + 规则引擎\n新模式只需新增策略类", color: C.navy },
    { title: "履约保证", items: "电子仓单（MinIO）\n质检流程编排（工作流）\n保证金冻结/释放\n信用评级动态调整", color: C.teal },
    { title: "数据服务", items: "实时行情推送（Kafka）\n日报/月报自动生成\n财务自动对账\nCanal 缓存实时同步", color: C.navy },
    { title: "规则配置", items: "Drools 计费/风控/促销\n100+ 客户个性化规则\n5 分钟热更新生效\n审批流动态编排", color: C.teal },
    { title: "生态对接", items: "银行/仓储/物流/CTRM\n9+ 外部系统集成\n四层防护（超时/重试\n/熔断/降级）", color: C.navy },
  ];
  
  modules.forEach((m, i) => {
    const cx = 0.35 + i * 1.9;
    const cy = 1.2;
    
    s.addShape(pres.shapes.RECTANGLE, {
      x: cx, y: cy, w: 1.7, h: 3.0,
      fill: { color: C.cardBg }, shadow: makeShadow()
    });
    s.addShape(pres.shapes.RECTANGLE, { x: cx, y: cy, w: 1.7, h: 0.06, fill: { color: m.color } });
    
    // Number
    s.addText("0" + (i+1), {
      x: cx + 0.1, y: cy + 0.2, w: 1.5, h: 0.35,
      fontSize: 22, fontFace: "Arial Black", color: C.gold, margin: 0
    });
    s.addText(m.title, {
      x: cx + 0.1, y: cy + 0.6, w: 1.5, h: 0.35,
      fontSize: 14, fontFace: "Arial Black", color: m.color, margin: 0
    });
    s.addText(m.items, {
      x: cx + 0.1, y: cy + 1.05, w: 1.5, h: 1.7,
      fontSize: 9.5, fontFace: "Arial", color: C.darkText, lineSpacingMultiple: 1.5, margin: 0
    });
  });
  
  // Bottom quote
  s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: 4.5, w: 8.6, h: 0.02, fill: { color: C.teal } });
  s.addText("\"我管的不是代码，是大宗贸易的整个交易闭环——从线上挂牌到线下交收，从资金对账到税务开票。\"", {
    x: 0.7, y: 4.7, w: 8.6, h: 0.5,
    fontSize: 13, fontFace: "Arial", color: C.midGray, italic: true, align: "center", margin: 0
  });
}

// ================================================================
// SLIDE 10: 技术管理能力 (dark)
// ================================================================
{
  const s = pres.addSlide();
  s.background = { color: C.navy };
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.gold } });
  
  s.addText("技术管理能力", {
    x: 0.7, y: 0.25, w: 6, h: 0.55, fontSize: 22, fontFace: "Arial Black", color: C.white, margin: 0
  });
  s.addText("靠制度管人 · 靠台账管债 · 靠流程管风险", {
    x: 0.7, y: 0.72, w: 8, h: 0.3, fontSize: 12, fontFace: "Arial", color: C.gold, margin: 0
  });
  
  const mgmtAreas = [
    { title: "团队建设", items: ["梯队设计（骨干/中坚/新人）", "明确分工 + 备份机制", "定期 1-on-1 反馈", "挑战性任务驱动成长"], color: C.teal },
    { title: "技术债治理", items: ["技术债台账（记录/分级）", "每次迭代 20% 时间还债", "还债 ROI 评估机制", "制度预防（Code Review）"], color: C.gold },
    { title: "契约治理", items: ["跨团队接口 SLA", "决策权三档（做/建议/知晓）", "定期对齐会机制", "红线/蓝线边界清晰"], color: C.teal },
    { title: "稳定性保障", items: ["On-call 轮值机制", "事故复盘不追责文化", "从 On-call 到 No-call", "冬储零 P0 实战验证"], color: C.gold },
  ];
  
  mgmtAreas.forEach((area, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = 0.7 + col * 4.5;
    const cy = 1.25 + row * 2.0;
    
    s.addShape(pres.shapes.RECTANGLE, {
      x: cx, y: cy, w: 4.0, h: 1.7,
      fill: { color: C.white, transparency: 92 }
    });
    s.addShape(pres.shapes.RECTANGLE, { x: cx, y: cy, w: 4.0, h: 0.06, fill: { color: area.color } });
    
    s.addText(area.title, {
      x: cx + 0.2, y: cy + 0.15, w: 3.6, h: 0.35,
      fontSize: 15, fontFace: "Arial Black", color: area.color, margin: 0
    });
    area.items.forEach((item, j) => {
      s.addText("▸ " + item, {
        x: cx + 0.2, y: cy + 0.55 + j * 0.28, w: 3.6, h: 0.25,
        fontSize: 11, fontFace: "Arial", color: C.white, margin: 0
      });
    });
  });
}

// ================================================================
// SLIDE 11: 客户价值量化 (light)
// ================================================================
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.gold } });
  
  s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: 0.4, w: 0.06, h: 0.5, fill: { color: C.teal } });
  s.addText("为客户创造的三层价值", {
    x: 0.95, y: 0.35, w: 6, h: 0.55, fontSize: 22, fontFace: "Arial Black", color: C.navy, margin: 0
  });
  
  const values = [
    { 
      title: "效率价值", tag: "效率", color: C.teal,
      metrics: ["交易周期", "5天 → 1.5天", "财务对账", "3天 → 2小时"],
      desc: "全链路在线化，挂牌→签约→支付→交收全流程在线，消除Excel和电话沟通的低效环节。"
    },
    {
      title: "风险价值", tag: "风险", color: C.navy,
      metrics: ["资金差错", "三年零差错", "一货多押", "电子仓单杜绝"],
      desc: "金融级数据精确性（Decimal 精度），电子仓单防伪，保证金冻结/释放自动执行，日终自动对账。"
    },
    {
      title: "增长价值", tag: "增长", color: C.gold,
      metrics: ["月交易量", "20笔 → 50笔", "供应链金融", "盘活应收账款"],
      desc: "平台交易数据积累 → 信用画像 → 供应链金融授信 → 客户资金周转加速 → 交易量增长，飞轮效应。"
    },
  ];
  
  values.forEach((v, i) => {
    const cx = 0.7 + i * 3.05;
    const cy = 1.2;
    
    s.addShape(pres.shapes.RECTANGLE, {
      x: cx, y: cy, w: 2.8, h: 3.9,
      fill: { color: C.cardBg }, shadow: makeShadow()
    });
    s.addShape(pres.shapes.RECTANGLE, { x: cx, y: cy, w: 2.8, h: 0.06, fill: { color: v.color } });
    
    // Tag
    s.addShape(pres.shapes.RECTANGLE, {
      x: cx + 0.15, y: cy + 0.2, w: 0.7, h: 0.3,
      fill: { color: v.color }
    });
    s.addText(v.tag, {
      x: cx + 0.15, y: cy + 0.2, w: 0.7, h: 0.3,
      fontSize: 10, fontFace: "Arial Black", color: C.white, align: "center", valign: "middle", margin: 0
    });
    
    s.addText(v.title, {
      x: cx + 0.15, y: cy + 0.65, w: 2.5, h: 0.35,
      fontSize: 16, fontFace: "Arial Black", color: v.color, margin: 0
    });
    
    // Metrics rows
    s.addText(v.metrics[0], {
      x: cx + 0.15, y: cy + 1.15, w: 1.1, h: 0.25,
      fontSize: 10, fontFace: "Arial", color: C.midGray, margin: 0
    });
    s.addText(v.metrics[1], {
      x: cx + 1.25, y: cy + 1.15, w: 1.4, h: 0.25,
      fontSize: 14, fontFace: "Arial Black", color: v.color, margin: 0
    });
    s.addText(v.metrics[2], {
      x: cx + 0.15, y: cy + 1.45, w: 1.1, h: 0.25,
      fontSize: 10, fontFace: "Arial", color: C.midGray, margin: 0
    });
    s.addText(v.metrics[3], {
      x: cx + 1.25, y: cy + 1.45, w: 1.4, h: 0.25,
      fontSize: 14, fontFace: "Arial Black", color: v.color, margin: 0
    });
    
    s.addShape(pres.shapes.RECTANGLE, { x: cx + 0.15, y: cy + 1.85, w: 2.5, h: 0.015, fill: { color: C.lightGray } });
    
    s.addText(v.desc, {
      x: cx + 0.15, y: cy + 2.0, w: 2.5, h: 1.6,
      fontSize: 10.5, fontFace: "Arial", color: C.darkText, lineSpacingMultiple: 1.4, margin: 0
    });
  });
}

// ================================================================
// SLIDE 12: 竞争壁垒 (dark)
// ================================================================
{
  const s = pres.addSlide();
  s.background = { color: C.navy };
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.gold } });
  
  s.addText("五大竞争壁垒", {
    x: 0.7, y: 0.25, w: 6, h: 0.55, fontSize: 22, fontFace: "Arial Black", color: C.white, margin: 0
  });
  s.addText("为什么对手难以复制？", {
    x: 0.7, y: 0.72, w: 6, h: 0.3, fontSize: 10, fontFace: "Arial", color: C.gold, margin: 0
  });
  
  const barriers = [
    { title: "数据飞轮", sub: "最难复制", desc: "5年+交易数据积累 → 定价模型 → 风控画像 → 更好的交易体验 → 更多数据。算法可以买，历史数据买不到。", color: C.gold },
    { title: "配置化引擎", sub: "100个客户喂出来的", desc: "多租户规则引擎是跟100+客户磨合出来的，不是设计出来的。新进入者要重复这段踩坑史。", color: C.teal },
    { title: "外部集成深度", sub: "9+系统对接", desc: "银行/CTRM/物流/税务/仓储，每个对接都有独特的技术适配和商务关系。对接越多壁垒越高。", color: C.gold },
    { title: "行业复合人才", sub: "极度稀缺", desc: "既懂C撮合引擎又懂大宗贸易全链路的人，市场上几乎找不到。团队就是壁垒。", color: C.teal },
    { title: "信任资产", sub: "时间×零事故", desc: "三年零资金差错 + 冬储零P0 = 客户信任。信任是N个零事故的一天一天累加，没有捷径。", color: C.gold },
  ];
  
  barriers.forEach((b, i) => {
    const cx = 0.35 + i * 1.9;
    const cy = 1.25;
    
    s.addShape(pres.shapes.RECTANGLE, {
      x: cx, y: cy, w: 1.72, h: 3.8,
      fill: { color: C.white, transparency: 92 }
    });
    s.addShape(pres.shapes.RECTANGLE, { x: cx, y: cy, w: 1.72, h: 0.06, fill: { color: b.color } });
    
    s.addShape(pres.shapes.RECTANGLE, {
      x: cx + 0.5, y: cy + 0.3, w: 0.7, h: 0.7,
      fill: { color: b.color, transparency: 80 }
    });
    s.addText("0" + (i+1), {
      x: cx + 0.5, y: cy + 0.3, w: 0.7, h: 0.7,
      fontSize: 24, fontFace: "Arial Black", color: b.color, align: "center", valign: "middle", margin: 0
    });
    
    s.addText(b.title, {
      x: cx + 0.1, y: cy + 1.15, w: 1.52, h: 0.35,
      fontSize: 13, fontFace: "Arial Black", color: b.color, align: "center", margin: 0
    });
    s.addText(b.sub, {
      x: cx + 0.1, y: cy + 1.5, w: 1.52, h: 0.25,
      fontSize: 10, fontFace: "Arial", color: C.midGray, align: "center", italic: true, margin: 0
    });
    s.addText(b.desc, {
      x: cx + 0.1, y: cy + 1.85, w: 1.52, h: 1.7,
      fontSize: 10, fontFace: "Arial", color: C.white, lineSpacingMultiple: 1.35, margin: 0
    });
  });
}

// ================================================================
// SLIDE 13: 技术难点攻克 (light)
// ================================================================
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.gold } });
  
  s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: 0.4, w: 0.06, h: 0.5, fill: { color: C.teal } });
  s.addText("关键难题攻克", {
    x: 0.95, y: 0.35, w: 6, h: 0.55, fontSize: 22, fontFace: "Arial Black", color: C.navy, margin: 0
  });
  
  const problems = [
    { title: "多租户深度定制", desc: "100+客户各有独特规则。方案：策略模式 + Drools 规则引擎 + 配置化。改规则 5 分钟生效，无需发版。避免 if-else 屎山和 100 个代码分支。" },
    { title: "跨月长事务一致性", desc: "交易从挂牌到交收跨月。方案：Saga + 状态机 + 补偿表 + 日终对账四层防线。不做 2PC，锁资源不可接受。补偿失败走人工介入。" },
    { title: "冬储流量 5-10 倍暴增", desc: "每年冬季交易量爆发。方案：五层保障 — CDN/静态分离 + Sentinel 分级限流 + 热点预热 + 读写分离 + K8s HPA 弹性伸缩。" },
    { title: "异构系统协议治理", desc: "C 撮合引擎 ↔ Java 业务层通信。方案：DS 数据中心做防腐层，TCP 自定义报文对 C，Hessian 对上游 Java。收敛异构复杂度到单一桥接点。" },
  ];
  
  problems.forEach((p, i) => {
    const cy = 1.15 + i * 1.1;
    
    // Card
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.7, y: cy, w: 8.6, h: 0.9,
      fill: { color: C.cardBg }, shadow: makeShadow()
    });
    s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: cy, w: 0.06, h: 0.9, fill: { color: i % 2 === 0 ? C.navy : C.teal } });
    
    // Number
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.95, y: cy + 0.15, w: 0.45, h: 0.45,
      fill: { color: i % 2 === 0 ? C.navy : C.teal }
    });
    s.addText("0" + (i+1), {
      x: 0.95, y: cy + 0.15, w: 0.45, h: 0.45,
      fontSize: 18, fontFace: "Arial Black", color: C.white, align: "center", valign: "middle", margin: 0
    });
    
    s.addText(p.title, {
      x: 1.6, y: cy + 0.08, w: 3, h: 0.32,
      fontSize: 14, fontFace: "Arial Black", color: C.darkText, margin: 0
    });
    s.addText(p.desc, {
      x: 1.6, y: cy + 0.38, w: 7.4, h: 0.45,
      fontSize: 10, fontFace: "Arial", color: C.darkText, lineSpacingMultiple: 1.3, margin: 0
    });
  });
}

// ================================================================
// SLIDE 14: 结束页 — 未来展望
// ================================================================
{
  const s = pres.addSlide();
  s.background = { color: C.navy };
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.gold } });
  
  s.addText("技术驱动 · 业务增长", {
    x: 0.8, y: 1.5, w: 8.4, h: 1.0,
    fontSize: 38, fontFace: "Arial Black", color: C.white, align: "center", margin: 0
  });
  
  s.addShape(pres.shapes.RECTANGLE, { x: 3.5, y: 2.6, w: 3.0, h: 0.04, fill: { color: C.gold } });
  
  s.addText([
    { text: "驾驭异构架构  ·  深度理解业务  ·  金融级可靠性", options: {} }
  ], {
    x: 0.8, y: 2.9, w: 8.4, h: 0.5,
    fontSize: 16, fontFace: "Arial", color: C.midGray, align: "center", margin: 0
  });
  
  s.addText([
    { text: "Java + Vue 全栈  |  C+Java 异构架构  |  12+微服务  |  9+生态接口", options: {} }
  ], {
    x: 0.8, y: 3.5, w: 8.4, h: 0.5,
    fontSize: 14, fontFace: "Arial", color: C.teal, align: "center", margin: 0
  });
  
  s.addText("感谢聆听  ·  期待交流", {
    x: 0.8, y: 4.3, w: 8.4, h: 0.5,
    fontSize: 18, fontFace: "Arial", color: C.gold, align: "center", margin: 0
  });
  
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 5.565, w: 10, h: 0.06, fill: { color: C.gold } });
}

// ================================================================
// WRITE
// ================================================================
const outPath = path.resolve(__dirname, "B2B技术经理-能力全景介绍.pptx");
pres.writeFile({ fileName: outPath }).then(() => {
  console.log("PPT generated: " + outPath);
}).catch(e => {
  console.error("Error:", e);
  process.exit(1);
});
