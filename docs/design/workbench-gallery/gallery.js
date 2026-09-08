// Archived design exploration; no production Map or Session integration.
const q = new URLSearchParams(location.search);
const value = q.get('gallery') || /[?&#]gallery=([^&]*)/.exec(location.href)?.[1] || '';
window.__CG_GALLERY_KIND = /^(add|insp|actions)$/i.test(value) ? 'add'
  : /^(trash|bin|icon|del)$/i.test(value) ? 'trash'
  : /^(chip|tag|badge|state)$/i.test(value) ? 'chip' : 'bar';
function bootChipGallery(){
  document.title = "状态标签 · 50 版";
  document.documentElement.classList.add("g-kind-chip");
  const bar = document.querySelector("#design-gallery .g-bar");
  if(bar){
    bar.querySelector("b").textContent = "状态标签 · 50 版";
    bar.querySelector(".hint").textContent = "往下滑动。字是黑体、正的；颜色是荧光笔涂在字上，不是胶囊。标题行跟现在检查器一样，只换这一笔。下面三粒是已做未测 / 测试未过 / 未开发。看中了把编号发我，例如「标签 11」。不用点。";
  }
  const trash = `<span class="trash" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><g class="lid"><rect x="9" y="3.2" width="6" height="1.7" rx=".7" fill="currentColor" stroke="none"/><path d="M4.5 7.1h15"/></g><g class="can"><path d="M7 7.1v12.3a1.7 1.7 0 0 0 1.7 1.7h6.6a1.7 1.7 0 0 0 1.7-1.7V7.1"/></g><g class="rib"><path d="M10 11.2v6"/><path d="M14 11.2v6"/></g></svg></span>`;
  const names = [
    ["01","腰涂微斜"],["02","更斜"],["03","不斜"],["04","只涂字腰"],["05","整格涂满"],
    ["06","带对勾"],["07","淡涂"],["08","很浓"],["09","左右冒头"],["10","贴字"],
    ["11","圆头笔"],["12","方头笔"],["13","上扬"],["14","下压"],["15","两笔叠"],
    ["16","尾淡"],["17","字距松"],["18","字距紧"],["19","稍大"],["20","稍小"],
    ["21","偏下划"],["22","偏上划"],["23","荧光绿"],["24","更宽"],["25","更窄"],
    ["26","更厚"],["27","更薄"],["28","毛边"],["29","勾加字"],["30","半透明"],
    ["31","大圆角"],["32","短涂"],["33","过冲"],["34","歪圆头"],["35","左侧重"],
    ["36","右侧重"],["37","中间亮"],["38","竖向更满"],["39","底三分一"],["40","斜切角"],
    ["41","加粗字"],["42","细字"],["43","黄绿"],["44","薄荷"],["45","柠檬"],
    ["46","青柠"],["47","笔触纹理"],["48","三笔"],["49","纸上微影"],["50","最荧光"]
  ];
  const okOf = id => (id==="06"||id==="29") ? `<b>✓</b>测试通过` : "测试通过";
  const uOf = () => "已做未测";
  const fOf = () => "测试未过";
  const dOf = () => "未开发";
  document.getElementById("g-scroll").innerHTML = names.map(([id, name]) => {
    const chip = `<span class="chip">${okOf(id)}</span>`;
    const alts = `<div class="alts"><span class="chip u">${uOf()}</span><span class="chip f">${fOf()}</span><span class="chip d">${dOf()}</span></div>`;
    return `<article class="g-item" id="v${id}"><div class="g-num">${id} · ${name}</div><aside class="g-mock g-ch-mock g-ch-${id}"><div class="who"><h2>冷启动</h2>${chip}<span class="sp"></span>${trash}</div><p class="lead">skill 怎么进机器、第一次怎么建图：安装、init、语言、层对层商量</p>${alts}</aside></article>`;
  }).join("");
}
function bootTrashIconGallery(){
  document.title = "垃圾桶图标 · 50 版";
  document.documentElement.classList.add("g-kind-trash");
  const bar = document.querySelector("#design-gallery .g-bar");
  if(bar){
    bar.querySelector("b").textContent = "垃圾桶图标 · 50 版";
    bar.querySelector(".hint").textContent = "往下滑动，指针放上图标看动效。标题行跟现在检查器一样，只换垃圾桶。看中了把编号发我，例如「垃圾桶 12」。";
  }
  const s = (inner, sw) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw||1.8}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const f = inner =>
    `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${inner}</svg>`;
  const lidH = `<g class="lid"><rect x="9" y="3.2" width="6" height="1.7" rx=".7" fill="currentColor" stroke="none"/><path d="M4.5 7.1h15"/></g>`;
  const lidLine = `<g class="lid"><path d="M4.5 7.1h15"/></g>`;
  const canR = `<g class="can"><path d="M7 7.1v12.3a1.7 1.7 0 0 0 1.7 1.7h6.6a1.7 1.7 0 0 0 1.7-1.7V7.1"/></g>`;
  const ribs2 = `<g class="rib"><path d="M10 11.2v6"/><path d="M14 11.2v6"/></g>`;
  const ribs3 = `<g class="rib"><path d="M9.5 11.2v6"/><path d="M12 11.2v6"/><path d="M14.5 11.2v6"/></g>`;
  const ring = `<circle class="ring" cx="12" cy="13" r="10" stroke-width="1.2" fill="none"/>`;
  const L = [];
  const add = (id, name, icon) => L.push({id, name, icon});
  add("01", "盖子弹起", s(lidH+canR+ribs2));
  add("02", "盖子掀开", s(lidH+canR+ribs2, 2));
  add("03", "整桶轻晃", s(lidH+canR+ribs2, 2.2));
  add("04", "轻轻放大", s(lidLine+canR+ribs2, 1.4));
  add("05", "盖子拍下", s(lidH+canR));
  add("06", "纸屑掉进", s(lidH+canR+`<g class="paper"><path d="M10 4v3M13.5 4.5v2.6"/></g>`+ribs2));
  add("07", "桶身一歪", s(`<g class="lid"><path d="M5 7h14"/></g><g class="can"><path d="M7.2 7l.6 13h8.4l.6-13"/></g>`+ribs2));
  add("08", "线条走一圈", s(lidH+canR+ribs2, 1.6));
  add("09", "空心变实心", s(lidH+`<g class="can"><path d="M7 8h10l-.9 11.2H7.9z"/></g>`+ribs2));
  add("10", "呼吸放大", s(lidH+canR+ribs3));
  add("11", "盖子飞走", s(lidH+`<g class="can"><path d="M7.4 7.1v12.2a1.4 1.4 0 0 0 1.4 1.4h6.4a1.4 1.4 0 0 0 1.4-1.4V7.1"/></g>`+ribs2));
  add("12", "弹一下", s(lidH+`<g class="can"><rect x="7" y="7.2" width="10" height="13" rx="2"/></g>`+ribs2));
  add("13", "压扁", s(lidH+canR+ribs2, 2.4));
  add("14", "拧一点", s(`<g class="lid"><rect x="10" y="2.8" width="4" height="2" rx="1" fill="currentColor" stroke="none"/><path d="M4 7h16"/></g>`+canR+ribs2));
  add("15", "纸张滑入", s(lidLine+canR+`<g class="paper"><path d="M12 3.2v5"/></g>`+ribs2));
  add("16", "竖线收起", s(lidH+canR+ribs3, 1.7));
  add("17", "圆圈围住", s(lidH+canR+ribs2+ring));
  add("18", "盖子点头", s(`<g class="lid"><rect x="8.8" y="3" width="6.4" height="2" rx="1" fill="currentColor" stroke="none"/><path d="M4 7.2h16"/></g>`+canR+ribs2));
  add("19", "轻轻闪", s(lidLine+`<g class="can"><path d="M8 7.2h8v12.4H8z"/></g>`+ribs2, 1.5));
  add("20", "左右晃", s(lidH+`<g class="can"><path d="M6.8 7.2h10.4l-1.1 12.6H7.9z"/></g>`+ribs2));
  add("21", "盖子滑开", s(`<g class="lid"><rect x="9" y="3.2" width="6" height="1.7" rx=".7" fill="currentColor" stroke="none"/><path d="M3.5 7.1h17"/></g>`+canR+ribs2));
  add("22", "桶口张开", s(lidLine+`<g class="can"><path d="M6.5 7.4l1.2 12.4h8.6l1.2-12.4"/></g>`+ribs2));
  add("23", "小块散开", s(lidH+canR+`<g class="paper"><rect class="bit" x="9" y="4" width="1.4" height="1.4" fill="currentColor" stroke="none"/><rect class="bit" x="12" y="3.2" width="1.4" height="1.4" fill="currentColor" stroke="none"/><rect class="bit" x="14.6" y="4.2" width="1.4" height="1.4" fill="currentColor" stroke="none"/></g>`+ribs2));
  add("24", "往下顿一下", s(lidH+canR+ribs2, 2.1));
  add("25", "橡皮筋", s(lidH+`<g class="can"><path d="M7 7.2h10v12.5a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z"/></g>`+ribs2));
  add("26", "盖子隐去", s(lidLine+canR+ribs2, 1.9));
  add("27", "斜切", s(lidH+canR+`<g class="rib"><path d="M12 10.8v6.4"/></g>`));
  add("28", "盖子竖起", s(lidH+canR+`<g class="rib"><path d="M10.2 11v6M13.8 11v6"/></g>`, 1.85));
  add("29", "墨水填满", s(lidH+canR+`<rect class="ink" x="8.2" y="10.4" width="7.6" height="8.4" rx="1" fill="currentColor" stroke="none" opacity=".35"/>`+ribs2));
  add("30", "小纸飞入", s(lidLine+canR+`<g class="paper"><path d="M11 3.4h2v4h-2z" fill="currentColor" stroke="none" opacity=".85"/></g>`+ribs2));
  add("31", "提手一晃", s(`<g class="lid"><path d="M9.2 4.2h5.6"/><path d="M4.5 7h15"/></g>`+canR+ribs2, 2));
  add("32", "线变粗", s(lidH+canR+ribs2, 1.3));
  add("33", "桶缩小", s(lidH+`<g class="can"><path d="M8 7.1v12.3a1.5 1.5 0 0 0 1.5 1.5h5a1.5 1.5 0 0 0 1.5-1.5V7.1"/></g>`+ribs2));
  add("34", "弹出", f(`<g class="lid"><rect x="8.5" y="3" width="7" height="2" rx="1"/><rect x="4" y="5.2" width="16" height="2.2" rx="1"/></g><g class="can"><path d="M7 8h10l-.9 12.2a1.6 1.6 0 0 1-1.6 1.4H9.5a1.6 1.6 0 0 1-1.6-1.4z"/></g>`));
  add("35", "盖子跳", s(lidH+canR+`<path d="M8 20.8h8"/>`+ribs2));
  add("36", "涟漪", s(lidH+canR+ribs2+`<circle class="ring" cx="12" cy="13" r="9" fill="none" stroke-width="1.3"/>`));
  add("37", "虚线绕", s(lidH+canR+ribs2+`<circle class="ring" cx="12" cy="13" r="10" fill="none" stroke-width="1.2" stroke-dasharray="3 3"/>`));
  add("38", "折一下", s(lidH+`<g class="can"><path d="M7.5 7.2h9v12.6h-9z"/></g>`+ribs2, 1.9));
  add("39", "盖章", f(`<g class="lid"><path d="M9 3h6l1 2h4v2H4V5h4z"/></g><g class="can"><path d="M7 8h10v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z"/><rect class="rib" x="10" y="10.5" width="1.4" height="7" rx=".4" fill="#fffdf8"/><rect class="rib" x="12.8" y="10.5" width="1.4" height="7" rx=".4" fill="#fffdf8"/></g>`));
  add("40", "融化", s(lidH+`<g class="can"><path d="M6.8 7.2h10.4c.2 4 .6 8.2.2 12.6H7.2c-.5-4.2-.2-8.4-.4-12.6z"/></g>`+ribs2));
  add("41", "眨一下", s(lidH+canR+`<g class="eye"><circle cx="10.2" cy="13.4" r=".9" fill="currentColor" stroke="none"/><circle cx="13.8" cy="13.4" r=".9" fill="currentColor" stroke="none"/></g>`));
  add("42", "拍盖", s(lidH+canR+ribs2, 2.3));
  add("43", "纸团进去", s(lidLine+canR+`<g class="paper"><path d="M11.2 4.2l.4 2.2 1.6-.6-.8 2.4 1.4 1.1-2.2.2-.6 2-1-1.8-2 .4 1.4-1.8z" fill="currentColor" stroke="none"/></g>`));
  add("44", "往上抽", s(lidH+canR+`<g class="rib"><path d="M10 11.6v5.2M14 11.6v5.2"/></g>`, 1.75));
  add("45", "从中裂开", s(lidH+canR+`<g class="rib"><path d="M10 11v6"/><path d="M14 11v6"/></g>`));
  add("46", "颜色加深", s(lidH+canR+ribs3, 2));
  add("47", "敲两下", s(lidH+canR+ribs2+`<path d="M9 20.9h6"/>`));
  add("48", "先抬再落", s(lidH+canR+`<g class="paper"><path d="M12 3.6v4.2"/></g>`+ribs2));
  add("49", "微微浮起", s(lidH+`<g class="can"><path d="M7 7.2h10l-1 12.6H8z"/></g>`+ribs2, 1.6));
  add("50", "圆盖探头", s(`<g class="lid"><rect x="8.4" y="3" width="7.2" height="2.2" rx="1.1" fill="currentColor" stroke="none"/><path d="M4.2 7.2h15.6"/></g>`+`<g class="can"><rect x="7" y="7.2" width="10" height="12.6" rx="3"/></g>`+ribs2));

  const card = icon => `<div class="who"><h2>冷启动</h2><span class="st">已做未测</span><span class="sp"></span><button type="button" class="ico" aria-label="删除">${icon}</button></div>
    <p class="lead">skill 怎么进机器、第一次怎么建图：安装、init、语言、层对层商量</p>
    <p class="hint">指针放上去看动效。这里只换图标。</p>`;
  document.getElementById("g-scroll").innerHTML = L.map(v =>
    `<article class="g-item" id="v${v.id}"><div class="g-num">${v.id} · ${v.name}</div><aside class="g-mock g-tr-mock g-tr-${v.id}">${card(v.icon)}</aside></article>`
  ).join("");
}
function bootAddActionGallery(){
  document.title = "新增这一行 · 50 版";
  const bar = document.querySelector("#design-gallery .g-bar");
  if(bar){
    bar.querySelector("b").textContent = "新增这一行 · 50 版";
    bar.querySelector(".hint").textContent = "往下滑动。标题、用途、记忆卡跟现在检查器一样，只有「新增 / 删除」这一行在换。看中了把编号发我，例如「新增 03」。不用点。";
  }
  const frozen = slot => `<h2>冷启动 <span class="st">已做未测</span></h2>
    <p class="lead">skill 怎么进机器、第一次怎么建图：安装、init、语言、层对层商量</p>
    <div class="slot">${slot}</div>
    <div class="note"><span class="add">记忆 ＋</span><p>npx/init/set-language 属于冷启动，不是 hook。</p></div>
    <div class="note"><span class="add">Idea ＋</span><p class="empty">还没有</p></div>
    <div class="note"><span class="add">Bug ＋</span><p class="empty">还没有</p></div>
    <div class="inh">继承的 5</div>`;
  const L = [];
  const add = (id, name, slot) => L.push({id, name, html: frozen(slot)});
  add("01", "现况双钮", `<div class="row"><span class="b">＋ 模块</span><span class="b">＋ 子节点</span><span class="q">删除</span></div>`);
  add("02", "一钮再选", `<span class="b">＋ 新增 ▾</span><div class="menu"><i class="on">模块</i><i>节点</i></div>`);
  add("03", "图上那个＋", `<span class="plus">＋</span><div class="pop"><i>模块</i><i>节点</i></div>`);
  add("04", "三个字链", `<a>模块</a><a>节点</a><a class="del">删除</a>`);
  add("05", "先说再选", `<p class="hint">在这个节点下面加：</p><a>模块</a><a>节点</a>`);
  add("06", "一个主按钮", `<div class="row"><span class="b">＋ 新增</span><span class="q">删除</span></div>`);
  add("07", "分段再添加", `<div class="row"><span class="seg"><i class="on">模块</i><i>节点</i></span><span class="b">添加</span></div>`);
  add("08", "标题旁小＋", `<span class="hint">加号在标题右边，这一行空着。</span>`);
  add("09", "让图上的＋干", `<p class="hint">要加模块或节点，去图上点 ＋。这里不放按钮。</p>`);
  add("10", "全宽一条", `<span class="b wide">＋ 新增模块或节点</span>`);
  add("11", "两张小卡", `<div class="cards"><i>模块<u>一块开工面</u></i><i>节点<u>一件具体的事</u></i></div>`);
  add("12", "两个图标", `<div class="row"><span class="ico">▣</span><span class="ico">○</span><span class="q">删除</span></div>`);
  add("13", "从底升起", `<div class="sheet"><i>新增模块</i><i>新增节点</i><i class="x">取消</i></div>`);
  add("14", "下拉选择", `<div class="sel"><span>新增…</span><span>▾</span></div>`);
  add("15", "两粒芯片", `<div class="row"><span class="chip">模块</span><span class="chip">节点</span><span class="chip x">删除</span></div>`);
  add("16", "检查器只删", `<span class="q">删除</span>`);
  add("17", "收进三点", `<span class="more">···</span>`);
  add("18", "滑块选种类", `<div class="row"><span class="slide"><b></b><i>模块</i><i>节点</i></span><span class="b">添加</span></div>`);
  add("19", "开关当模块", `<div class="row"><span class="b">＋ 添加</span><span class="tog">作为模块 <u></u></span></div>`);
  add("20", "虚线投放", `<div class="drop">＋ 放到这里<span>模块或节点，点了再选</span></div>`);
  add("21", "像记忆卡那样", `<div class="fake">新增 ＋</div>`);
  add("22", "两步", `<div class="step">① 选种类</div><div class="row"><span class="b">模块</span><span class="b">节点</span></div>`);
  add("23", "先起名", `<div class="ph">名称，回车后再选模块或节点</div>`);
  add("24", "一粒黄胶囊", `<span class="pill">＋ 新增</span>`);
  add("25", "无阴影双钮", `<div class="row"><span class="flat">＋ 模块</span><span class="flat">＋ 节点</span><span class="q">删除</span></div>`);
  add("26", "跟地图同一套", `<div class="row"><span class="b">＋</span><span class="hint">点开后选模块或节点</span></div>`);
  add("27", "底栏三格", `<div class="dock"><i>模块</i><i>节点</i><i>删除</i></div>`);
  add("28", "模块为主", `<div class="row"><span class="b">＋ 模块</span><span class="q">＋ 节点</span><span class="q">删除</span></div>`);
  add("29", "节点为主", `<div class="row"><span class="b">＋ 节点</span><span class="q">＋ 模块</span><span class="q">删除</span></div>`);
  add("30", "三等分", `<div class="tri"><i>模块</i><i>节点</i><i>删除</i></div>`);
  add("31", "小字新增", `<p class="hint">新增 · 模块 / 节点</p>`);
  add("32", "手写", `<div class="hand">加模块 / 加节点</div>`);
  add("33", "命令行", `<div class="term">$ add [--module|--node]</div>`);
  add("34", "报纸栏", `<div class="paper"><b>新增</b> 模块 · 节点 &nbsp;&nbsp; <b>删</b></div>`);
  add("35", "瑞士两个词", `<span class="swiss">模块</span><span class="swiss">节点</span>`);
  add("36", "右下圆钮", `<span class="fab">＋</span>`);
  add("37", "蓝字无框", `<a>＋ 模块</a> <a>＋ 节点</a> <a class="del">删除</a>`);
  add("38", "删除离远点", `<div class="row"><span class="b">＋ 新增</span></div><div class="row" style="margin-top:18px"><span class="q">删除这个节点</span></div>`);
  add("39", "先问一句", `<p class="ask">加模块，还是加节点？</p><div class="row"><span class="b">模块</span><span class="b">节点</span></div>`);
  add("40", "单选再确认", `<div class="rad"><i class="on">模块</i><i>节点</i></div>`);
  add("41", "页签", `<div class="tabs"><i class="on">模块</i><i>节点</i></div>`);
  add("42", "长句子", `<span class="b long">在「冷启动」下面加一个模块或节点</span>`);
  add("43", "极简", `<div class="row"><span class="dotplus">＋</span><span class="q">删除</span></div>`);
  add("44", "不分种类", `<span class="b">＋ 子项</span>`);
  add("45", "删前再问", `<div class="row"><span class="b">＋ 新增</span></div><div class="confirm">删除？ <span class="q">取消</span> <span class="q">删</span></div>`);
  add("46", "说清楚孩子", `<p class="kid">冷启动的孩子</p><div class="row"><span class="b">＋ 模块</span><span class="b">＋ 节点</span></div>`);
  add("47", "左右两栏", `<div class="cols"><i>模块</i><i>节点</i></div>`);
  add("48", "折叠新增", `<div class="fold">新增 ▾<span>模块 · 节点</span></div>`);
  add("49", "现况但合成", `<div class="row"><span class="b">＋ 模块或节点</span><span class="q">删除</span></div>`);
  add("50", "一个＋收掉删除", `<span class="b">＋</span>`);

  /* 08 把小加号画在标题上，slot 仍占位。 */
  const htmlFor = v => {
    let inner = v.html;
    if(v.id==="08") inner = inner.replace("<h2>冷启动", "<h2>冷启动 <span class=\"tiny\">＋</span>");
    return inner;
  };
  document.getElementById("g-scroll").innerHTML = L.map(v =>
    `<article class="g-item" id="v${v.id}"><div class="g-num">${v.id} · ${v.name}</div><aside class="g-mock g-add-mock g-add-${v.id}">${htmlFor(v)}</aside></article>`
  ).join("");
}
function bootDesignGallery(){
  if(window.__CG_GALLERY_KIND==="add"){
    bootAddActionGallery();
    return;
  }
  if(window.__CG_GALLERY_KIND==="trash"){
    bootTrashIconGallery();
    return;
  }
  if(window.__CG_GALLERY_KIND==="chip"){
    bootChipGallery();
    return;
  }
  document.title = "工作台风格 · 50 版";
  const barEl = document.querySelector("#design-gallery .g-bar");
  if(barEl){
    barEl.querySelector("b").textContent = "工作台风格 · 50 版";
    barEl.querySelector(".hint").textContent = "往下滑动。画布和右侧栏跟现在工作台一样，只有顶栏换风格。看中了把编号发我，例如「风格 17」。不用点。";
  }
  const card = `<span class="here">Context Guard <i class="caret">▾</i></span>`;
  const stage = `<div class="stage"><div class="map"><div class="root"><b>Context Guard</b><span>人与 Agent 共用的项目记忆，活在仓库里</span></div><div class="kids"><div class="mod"><b>工作台</b><span>人在浏览器看图、改记忆、确认提议</span></div><div class="mod"><b>冷启动</b><span>skill 怎么进机器、第一次怎么建图</span></div><div class="mod"><b>底层文件系统</b><span>会话、坏例、任务怎么写、怎么跳</span></div><div class="mod"><b>hook</b><span>当前开发进程的生命周期提醒</span></div><div class="mod"><b>CI/CD</b><span>以后怎么自动验；夹具挂在这里</span></div></div></div><aside class="insp"><div class="who"><h2>Context Guard</h2><span class="st">已做未测</span><span class="sp"></span><span class="trash" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><g class="lid"><rect x="9" y="3.2" width="6" height="1.7" rx=".7" fill="currentColor" stroke="none"/><path d="M4.5 7.1h15"/></g><g class="can"><path d="M7 7.1v12.3a1.7 1.7 0 0 0 1.7 1.7h6.6a1.7 1.7 0 0 0 1.7-1.7V7.1"/></g><g class="rib"><path d="M10 11.2v6"/><path d="M14 11.2v6"/></g></svg></span></div><p class="add-hint">要加模块或节点，去图上点 ＋。这里不放按钮。</p><div class="note"><span class="add">记忆 ＋</span><p>第一层由人锁定：工作台、冷启动、底层文件系统、hook、CI/CD。</p><p>SKILL.md 合同挂在根上。</p></div><div class="note"><span class="add">Idea ＋</span><p class="empty">还没有</p></div><div class="note"><span class="add">Bug ＋</span><p class="empty">还没有</p></div></aside></div>`;
  const shell = bar => `<div class="bar">${bar}</div>${stage}`;
  const L = [];
  const add = (id, name, bar) => L.push({id, name, html: shell(bar)});

  add("01", "现况粗框",
    `${card}<span class="sp"></span><div class="tools"><span class="box dir"><i></i><span>左右</span><span>上下</span></span><span class="box">关系</span><span class="box sq">🔑</span><span class="box">🐞 Bug (1)</span><span class="box sq">⚙</span></div>`);
  add("02", "细线字钮",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("03", "纯文字",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span class="bug">Bug <b>1</b></span><span>设置</span></div>`);
  add("04", "静音圆标",
    `${card}<span class="sp"></span><div class="tools"><span class="ico">↕</span><span class="ico">⇄</span><span class="ico">🔑</span><span class="ico bug">1</span><span class="ico">⚙</span></div>`);
  add("05", "浮岛",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>🔑</span><span>Bug 1</span><span>⚙</span></div>`);
  add("06", "左右两岛",
    `<div class="island">${card}</div><div class="island r"><span>上下</span><span>关系</span><span>🔑</span><span>Bug 1</span><span>⚙</span></div>`);
  add("07", "两行",
    `<div class="r1">项目</div><div class="r2">${card}<div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div></div>`);
  add("08", "路径",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("09", "刊头",
    `${card}<div class="tools"><span>上下</span><span>关系</span><span>🔑</span><span>Bug</span><span>⚙</span></div>`);
  add("10", "IDE",
    `<span class="dots"><i></i><i></i><i></i></span>${card}<div class="tools"><span>TB</span><span>Rel</span><span>Auth</span><span>Bug</span><span>⚙</span></div>`);
  add("11", "报纸报头",
    `<div class="kicker">Project memory · Thursday</div>${card}<div class="row"><span>上下</span><span>关系 · 授权 · Bug 1 · 设置</span></div>`);
  add("12", "深色墨条",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span class="bug">Bug 1</span><span>设置</span></div>`);
  add("13", "浅托盘",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>🔑</span><span>Bug 1</span><span>⚙</span></div>`);
  add("14", "左边色签",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("15", "分段一条",
    `${card}<span class="sp"></span><div class="seg"><span>上下</span><span>关系</span><span>授权</span><span class="on">Bug 1</span><span>设置</span></div>`);
  add("16", "瑞士留白",
    `${card}<span class="sp"></span><div class="tools"><span>LAYOUT</span><span>REL</span><span>KEY</span><span>BUG</span><span>SET</span></div>`);
  add("17", "和纸红印",
    `<span class="seal">守</span>${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>虫 1</span><span>设</span></div>`);
  add("18", "毛玻璃",
    `${card}<span class="sp"></span><div class="tools"><span>↕</span><span>⇄</span><span>🔑</span><span>1</span><span>⚙</span></div>`);
  add("19", "线圈本",
    `<div class="rings"><i></i><i></i></div>${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("20", "地图图例",
    `<span class="leg">LEGEND</span>${card}<span class="sp"></span><div class="tools"><span class="sym"><i></i>上下</span><span>关系</span><span>🔑</span><span>Bug 1</span><span>⚙</span></div>`);
  add("21", "印章题名",
    `<span class="chop">守</span>${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("22", "终端条",
    `${card}<span class="sp"></span><div class="tools"><span>--tb</span><span>rel</span><span>auth</span><span>bug:1</span><span>cfg</span></div>`);
  add("23", "大标题导航",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug</span><span>设置</span></div>`);
  add("24", "文件名居中",
    `<span class="side">☰</span>${card}<div class="tools"><span>↕</span><span>⇄</span><span>🔑</span><span>1</span><span>⚙</span></div>`);
  add("25", "无边框",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("26", "深色紧凑",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span class="bug">Bug 1</span><span>设置</span></div>`);
  add("27", "衬线刊头",
    `${card}<span class="sp"></span><div class="tools"><span>Layout</span><span>Edges</span><span>Key</span><span>Bugs</span><span>More</span></div>`);
  add("28", "图标带小字",
    `${card}<span class="sp"></span><div class="tools"><span class="ic"><b>↕</b><u>上下</u></span><span class="ic"><b>⇄</b><u>关系</u></span><span class="ic"><b>🔑</b><u>授权</u></span><span class="ic"><b>🐞</b><u>Bug</u></span><span class="ic"><b>⚙</b><u>设置</u></span></div>`);
  add("29", "单胶囊",
    `${card}<span class="sp"></span><div class="cap"><span>上下</span><span>关系</span><span>授权</span><span class="on">Bug 1</span><span>设置</span></div>`);
  add("30", "顶上一根黄线",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>🔑</span><span>Bug 1</span><span>⚙</span></div>`);
  add("31", "折角纸",
    `<span class="fold"></span>${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("32", "蓝图",
    `${card}<span class="sp"></span><div class="tools"><span>TB</span><span>REL</span><span>KEY</span><span>BUG</span><span>SET</span></div>`);
  add("33", "展签",
    `<div><div class="k">Node map</div>${card}</div><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("34", "票根",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span></div><span class="sn">No. 0823</span>`);
  add("35", "中间跳转槽",
    `${card}<div class="jump">跳到模块…</div><div class="tools"><span>上下</span><span>关系</span><span>🔑</span><span>1</span><span>⚙</span></div>`);
  add("36", "状态当一句",
    `${card}<span class="sent">上下布局 · <span class="bad">1 个 Bug</span></span><div class="tools"><span>关系</span><span>授权</span><span>设置</span></div>`);
  add("37", "底下贴页签",
    `<div class="r1">${card}<span class="sp"></span><span>🔑</span><span>⚙</span></div><div class="tabs"><span>上下</span><span>关系</span><span class="on">Bug 1</span></div>`);
  add("38", "双细线古典",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("39", "软色片",
    `${card}<span class="sp"></span><div class="tools"><span class="chip">上下</span><span class="chip">关系</span><span class="chip">授权</span><span class="chip bug">Bug 1</span><span class="chip">设置</span></div>`);
  add("40", "几何小标",
    `<i class="mark"></i>${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("41", "罗盘布局",
    `<span class="comp">北<br>南</span>${card}<span class="sp"></span><div class="tools"><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("42", "微字大气",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("43", "巨大标题",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug</span><span>设置</span></div>`);
  add("44", "几乎空白",
    `${card}<span class="more">···</span>`);
  add("45", "左边书脊",
    `<span class="spine">CG</span>${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("46", "比例尺",
    `${card}<div class="rule"><span>左右</span><span class="on">上下</span></div><div class="tools"><span>关系</span><span>🔑</span><span>Bug 1</span><span>⚙</span></div>`);
  add("47", "手写题头",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("48", "淡彩分层",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);
  add("49", "工具收进菜单",
    `${card}<span class="sp"></span><div class="tools"><span class="menu">···</span></div>`);
  add("50", "一条金线",
    `${card}<span class="sp"></span><div class="tools"><span>上下</span><span>关系</span><span>授权</span><span>Bug 1</span><span>设置</span></div>`);

  document.getElementById("g-scroll").innerHTML = L.map(v =>
    `<article class="g-item" id="v${v.id}"><div class="g-num">${v.id} · ${v.name}</div><aside class="g-mock g-chrome g-lay-${v.id}">${v.html}</aside></article>`
  ).join("");
}

bootDesignGallery();
