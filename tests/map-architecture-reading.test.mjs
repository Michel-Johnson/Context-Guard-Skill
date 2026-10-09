import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { projectArchitecture, layoutGraph, routeGraph, placeGraphLabel, readPresentation, focusGraph, renderGraph, readComposition, reviewGraphLayout, relationChoices, makeRelation, routeKey, readRouteEdit, nearestGraphPort, manualGraphRoute, readingRelations, readingViewport, portraitComposition } from '../prototype/map-graph-view.mjs';
import { createOpenclawMap, createOpenclawDisplayTranslations } from './helpers/openclaw-map.mjs';

test('OpenClaw display translations cover every level without modifying canonical records',()=>{
  const map=createOpenclawMap(),before=JSON.stringify(map),catalog=createOpenclawDisplayTranslations(),visited=[];
  const visit=node=>{visited.push(node.id);for(const field of ['title','purpose']){
    assert.equal(catalog.nodes[node.id][field].source,node[field]);
    assert.ok(catalog.nodes[node.id][field].en.trim());
  }node.children.forEach(visit);};visit(map.root);
  assert.equal(visited.length,32);assert.equal(Object.keys(catalog.nodes).length,32);
  assert.equal(catalog.projectTitle,map.project);assert.equal(JSON.stringify(map),before);
});
test('localized Map display respects project and original text, with singular and plural complete messages',async()=>{
  const source=await fs.readFile(new URL('../prototype/workbench-app.js',import.meta.url),'utf8');
  const catalog=createOpenclawDisplayTranslations(),map=createOpenclawMap(),before=JSON.stringify(map);
  const ctx=vm.createContext({mapBetaEnabled:true,window:{__CG_MAP_I18N:catalog},data:{title:map.project},uiLang:'en',I18N:{
    en:{graphCurrent:'Current module',graphRelated:'Related module',graphLeaf:'Leaf node',graphCount_one:'{n} internal node',graphCount_other:'{n} internal nodes'},
    zh:{graphCurrent:'当前模块',graphRelated:'关联模块',graphLeaf:'叶子节点',graphCount_other:'{n} 个内部节点'}}});
  vm.runInContext(source.slice(source.indexOf('function t(key){'),source.indexOf('function applyStaticI18n(){')),ctx);
  const clients=map.root.children[0];assert.equal(ctx.nodeDisplayField(clients,'title'),'Client interfaces');
  assert.equal(ctx.nodeDisplayField(clients,'purpose'),'Control UI, CLI and device entry points');
  assert.equal(ctx.graphGroupCaption({count:1}),'1 internal node');assert.equal(ctx.graphGroupCaption({count:5}),'5 internal nodes');
  for(const [group,text] of [[{scope:true},'Current module'],[{context:true},'Related module'],[{count:0},'Leaf node']])assert.equal(ctx.graphGroupCaption(group),text);
  assert.equal(ctx.nodeDisplayField({...clients,title:'用户改名'},'title'),'用户改名');
  assert.equal(ctx.nodeDisplayField({id:'custom',title:'用户模块'},'title'),'用户模块');
  ctx.data.title='another project';assert.equal(ctx.nodeDisplayField(clients,'title'),clients.title);
  ctx.data.title=map.project;ctx.uiLang='zh';assert.equal(ctx.nodeDisplayField(clients,'title'),clients.title);
  assert.equal(ctx.graphGroupCaption({count:5}),'5 个内部节点');assert.equal(JSON.stringify(map),before);
});
test('retained OpenClaw preview translates newly added regression nodes without using generated IDs or rewriting source',async()=>{
  const map=createOpenclawMap();
  const titles=['本地回归：新增模块','回归模块：拖动后添加','回归节点：拖动后添加','回归模块：自动定位','回归节点：自动定位','本地测试模块','本地测试节点','刷新验证模块','刷新验证节点','Enter 新增验证','同级新增验证'];
  const extras=titles.map((title,index)=>({id:`retained-${index}`,title,purpose:'',children:[]}));
  map.root.children.push(...extras,{id:'unknown',title:'用户新需求',purpose:'用户说明',children:[]});
  const before=JSON.stringify(map),catalog=createOpenclawDisplayTranslations(map);
  assert.equal(catalog.nodes['retained-10'].title.en,'Add at current level');
  for(const node of extras){assert.equal(catalog.nodes[node.id].title.source,node.title);assert.doesNotMatch(catalog.nodes[node.id].title.en,/\p{Script=Han}/u);}
  assert.equal(catalog.nodes.unknown,undefined);assert.equal(JSON.stringify(map),before);
  const source=await fs.readFile(new URL('../prototype/workbench-app.js',import.meta.url),'utf8');
  const ctx=vm.createContext({mapBetaEnabled:true,window:{__CG_MAP_I18N:catalog},data:{title:map.project},uiLang:'en'});
  vm.runInContext(source.slice(source.indexOf('function nodeDisplayField('),source.indexOf('function graphGroupCaption(')),ctx);
  assert.equal(ctx.nodeDisplayField(extras[10],'title'),'Add at current level');
  ctx.uiLang='zh';assert.equal(ctx.nodeDisplayField(extras[10],'title'),'同级新增验证');
});

const find = (root, id) => root.id === id ? root : root.children.map(node => find(node, id)).find(Boolean);
test('wheel zoom never changes hierarchy, even past the old return threshold; retains bounds, cursor anchor and transition guard',async()=>{
  const source=await fs.readFile(new URL('../prototype/workbench-app.js',import.meta.url),'utf8'),listeners={};
  const timers=new Map();let sequence=0,applied=0,prevented=0;const navigated=[];
  const ctx=vm.createContext({mapBetaEnabled:true,view:{x:20,y:30,k:1},viewRootId:'child',data:{id:'root'},mapTransitioning:false,drillReturnAt:.72,wheelReturnTimer:null,
    vp:{getBoundingClientRect:()=>({left:10,top:10}),addEventListener:(name,fn)=>listeners[name]=fn},
    findPath:()=>[{id:'root'},{id:'child'}],enterView:id=>{navigated.push(id);ctx.viewRootId=id;},applyView:()=>applied++,
    setTimeout:fn=>{const id=++sequence;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)});
  const helperStart=source.indexOf('function armDrillReturn(){'),helperEnd=source.indexOf('\nif(worldEl &&',helperStart);
  assert.ok(helperStart>=0&&helperEnd>helperStart);vm.runInContext(source.slice(helperStart,helperEnd),ctx);
  const start=source.indexOf('vp.addEventListener("wheel", e=>{'),end=source.indexOf('\nfunction renderAll',start);assert.ok(start>=0&&end>start);
  vm.runInContext(source.slice(start,end),ctx);
  const wheel=deltaY=>listeners.wheel({deltaY,clientX:130,clientY:150,preventDefault(){prevented++;}});
  const anchor={x:(120-ctx.view.x)/ctx.view.k,y:(140-ctx.view.y)/ctx.view.k};
  for(let i=0;i<40;i++)wheel(100);
  for(const fn of timers.values())fn();
  assert.deepEqual(navigated,[],'zooming out cannot navigate to a parent, even after delayed work');assert.equal(ctx.viewRootId,'child');assert.equal(ctx.view.k,.2);
  assert.ok(Math.abs(ctx.view.x+anchor.x*ctx.view.k-120)<1e-9);assert.ok(Math.abs(ctx.view.y+anchor.y*ctx.view.k-140)<1e-9);
  for(let i=0;i<70;i++)wheel(-100);assert.equal(ctx.view.k,2.2);
  ctx.viewRootId='root';for(let i=0;i<70;i++)wheel(100);assert.equal(ctx.view.k,.35);assert.deepEqual(navigated,[]);
  const previous=structuredClone(ctx.view),before=applied;ctx.mapTransitioning=true;wheel(100);
  assert.deepEqual({...ctx.view},previous);assert.equal(applied,before);assert.equal(prevented,181);
});
test('ending a pan or pinch cannot schedule navigation or mutate the reading root',async()=>{
  const source=await fs.readFile(new URL('../prototype/workbench-app.js',import.meta.url),'utf8'),start=source.indexOf('function endPointer(e){'),end=source.indexOf('vp.addEventListener("pointerdown"',start);
  assert.ok(start>=0&&end>start);let returned=0;const removed=[];
  const ctx=vm.createContext({mapBetaEnabled:true,mapTransitioning:false,drillReturnAt:.72,wheelReturnTimer:null,pointers:new Map([[1,{x:50,y:60}],[2,{x:90,y:100}]]),pinch:{d:60,k:1},panning:false,view:{x:10,y:20,k:.2},viewRootId:'child',sx:0,sy:0,
    vp:{classList:{remove:kind=>removed.push(kind)}},setTimeout:()=>{returned++;return 1;},clearTimeout(){},findPath:()=>[{id:'root'},{id:'child'}],enterView:()=>assert.fail('Beta pointer release must not navigate')});
  const helperStart=source.indexOf('function armDrillReturn(){'),helperEnd=source.indexOf('\nif(worldEl &&',helperStart);assert.ok(helperStart>=0&&helperEnd>helperStart);
  vm.runInContext(source.slice(helperStart,helperEnd)+source.slice(start,end),ctx);ctx.endPointer({pointerId:2});assert.equal(ctx.pinch,null);assert.equal(ctx.panning,true);assert.equal(ctx.sx,40);assert.equal(ctx.sy,40);
  ctx.endPointer({pointerId:1});assert.equal(ctx.panning,false);assert.equal(ctx.pointers.size,0);assert.deepEqual(removed,['grabbing']);
  assert.equal(returned,0,'pointerup and pointercancel must not infer hierarchy navigation');assert.equal(ctx.viewRootId,'child');assert.equal(ctx.view.k,.2);
});
test('compact Map editing lives in the inspector and low-frequency controls live in bounded settings, never the canvas',async()=>{
  const html=await fs.readFile(new URL('../prototype/workbench.html',import.meta.url),'utf8'),css=await fs.readFile(new URL('../prototype/workbench.css',import.meta.url),'utf8');
  const inspector=html.slice(html.indexOf('<aside class="drawer"'),html.indexOf('<script src="./workbench-data'));
  for(const id of ['btn-map-add-module','btn-map-add-relation']){
    assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1);
    assert.match(inspector,new RegExp(`<button[^>]*id="${id}"[^>]*aria-label="[^"]+"[^>]*>[\\s\\S]*?<svg[^>]*aria-hidden="true"`));
    assert.equal(html.slice(html.indexOf('<div id="viewport">'),html.indexOf('<dialog id="device-approvals"')).includes(`id="${id}"`),false);
  }
  assert.match(html,/<details[^>]*id="workbench-tools"/,'stable toolbar remains in the same product HTML');assert.doesNotMatch(html,/id="btn-map-all-relations"/);
  const settings=html.slice(html.indexOf('<div class="settings-menu"'),html.indexOf('<div class="first-use"'));
  for(const id of ['map-view-toggle','btn-auth','btn-bugs','btn-todos','btn-device-approvals'])assert.ok(settings.includes(`id="${id}"`));
  assert.doesNotMatch(html,/id="(?:btn-map-fit|btn-map-reset|btn-detail-toggle)"/);assert.match(html,/id="btn-link-repo"/,'stable repository linking is retained outside Beta');
  assert.match(css,/\.settings-menu\{[^}]*position:fixed[^}]*width:min\(280px,calc\(100vw - 24px\)\)[^}]*box-sizing:border-box/);
  assert.match(css,/\.map-icon-button\{[^}]*width:40px;[^}]*height:40px/);
});
test('relation state updates the accessible name without replacing its SVG and keeps permission guards',async()=>{
  const source=await fs.readFile(new URL('../prototype/workbench-app.js',import.meta.url),'utf8');
  const start=source.indexOf('function syncRelationControls(){'),end=source.indexOf('\nfunction bindRelationForm',start);
  const button={innerHTML:'<svg>relation icon</svg>',setAttribute(k,v){this[k]=v;}},overlay={replaceChildren(){this.cleared=true;}},hint={};
  let active=true,writable=true;const ctx=vm.createContext({relationDraft:null,authMode:false,mapTransitioning:false,graphViewActive:()=>active,canMutate:()=>writable,
    getNode:()=>({}),inTree:()=>true,isCancelled:()=>false,isProposed:()=>false,relationScopeValid:()=>true,
    document:{getElementById:id=>id==='btn-map-add-relation'?button:id==='graph-relation-overlay'?overlay:hint,body:{classList:{toggle(){}}}}});
  vm.runInContext(source.slice(start,end),ctx);vm.runInContext('syncRelationControls()',ctx);
  assert.equal(button['aria-label'],'建立关系');assert.equal(button.disabled,false);assert.equal(overlay.cleared,true);
  ctx.relationDraft={node:'a'};vm.runInContext('syncRelationControls()',ctx);assert.equal(button['aria-label'],'取消连线');assert.equal(button['aria-pressed'],'true');
  assert.equal(button.innerHTML,'<svg>relation icon</svg>');
  for(const patch of [{authMode:true},{authMode:false,mapTransitioning:true}]){Object.assign(ctx,patch);vm.runInContext('syncRelationControls()',ctx);assert.equal(button.disabled,true);}
  ctx.authMode=false;ctx.mapTransitioning=false;writable=false;vm.runInContext('syncRelationControls()',ctx);assert.equal(button.disabled,true);
  active=false;vm.runInContext('syncRelationControls()',ctx);assert.equal(button.hidden,true);
});

test('settings layout groups existing controls in source reading order, keeps every handler target and allows long labels to wrap',async()=>{
  const html=await fs.readFile(new URL('../prototype/workbench.html',import.meta.url),'utf8'),css=await fs.readFile(new URL('../prototype/workbench.css',import.meta.url),'utf8');
  const controls=html.slice(html.indexOf('<div class="settings-map-controls">'),html.indexOf('<div class="rel-toggle" id="rel-toggle"'));
  assert.ok(controls.includes('id="map-view-toggle"')&&controls.includes('id="dir-toggle"'));
  const tools=html.slice(html.indexOf('<div class="set-tools"'),html.indexOf('<div class="set-label" data-i18n="betaLabel"'));
  const expected=['btn-lens','btn-bugs','btn-todos','btn-auth','btn-tray','btn-link-repo','btn-device-approvals'];
  assert.deepEqual([...tools.matchAll(/id="(btn-[^"]+)"/g)].map(match=>match[1]),expected);
  for(const id of [...expected,'map-view-toggle','dir-toggle'])assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1);
  assert.match(tools,/<button[^>]*class="[^"]*settings-wide"[^>]*id="btn-device-approvals"/);
  assert.match(html,/id="lens-toggle"/);assert.match(html,/id="btn-lens"/,'stable first-layer entry is retained, not duplicated');
  const app=await fs.readFile(new URL('../prototype/workbench-app.js',import.meta.url),'utf8');
  assert.match(app,/getElementById\('btn-lens'\)\.onclick=\(\)=>\{\s*if\(mapBetaEnabled\)return;/,'legacy lens handler is blocked only while Beta is enabled');
  assert.match(app,/document\.getElementById\("first-use-go"\)\.onclick = \(\)=>enterLensMode\(\)/);
  assert.equal((html.match(/class="theme-pick" data-theme=/g)||[]).length,4);
  assert.match(css,/body\.map-beta \.settings-menu \.settings-map-controls,body\.map-beta \.settings-menu \.set-tools,body\.map-beta \.settings-menu \.theme-picks\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:8px\}/,'two-column Beta geometry cannot restyle the stable settings');
  assert.match(css,/\.settings-menu \.settings-wide\{grid-column:1 \/ -1\}/);
  assert.match(css,/\.settings-menu \.set-tools button\{[^}]*white-space:normal;overflow-wrap:anywhere/);
});
test('one native item menu retains Idea TODO Bug paths and is absent in readonly or unavailable node states',async()=>{
  const source=await fs.readFile(new URL('../prototype/workbench-app.js',import.meta.url),'utf8'),start=source.indexOf('function itemAddMenuHtml(node){'),end=source.indexOf('\nfunction renderDetail',start);
  let writable=true;const ctx=vm.createContext({authMode:false,canMutate:()=>writable,isCancelled:n=>!!n.cancelled,isProposed:n=>!!n.proposed,t:k=>k,esc:x=>x});
  vm.runInContext(source.slice(start,end),ctx);const render=node=>ctx.itemAddMenuHtml(node);
  const before={id:'root',ideas:[],todos:[],bugs:[]},copy=structuredClone(before),html=render(before);
  assert.equal((html.match(/<summary>/g)||[]).length,1);for(const kind of ['idea','todo','bug'])assert.match(html,new RegExp(`<button type="button" data-act="add-${kind}"`));
  assert.deepEqual(before,copy);assert.equal(render({...before,cancelled:true}),'');assert.equal(render({...before,proposed:true}),'');
  ctx.authMode=true;assert.equal(render(before),'');ctx.authMode=false;writable=false;assert.equal(render(before),'');
});
test('OpenClaw overview keeps four necessary pair connections; module focus keeps only explicitly prioritized neighbours',()=>{
  const map=createOpenclawMap(),graph=projectArchitecture(map.root,map.flows),before=structuredClone(map);
  const composition={reading:{overview:[['CLIENTS','GATEWAY'],['GATEWAY','AGENTS'],['AGENTS','CHANNELS'],['AGENTS','STATE']],primary:[['CLIENTS','GATEWAY'],['GATEWAY','AGENTS'],['AGENTS','CHANNELS'],['AGENTS','STATE'],['CHANNELS','GATEWAY']]}};
  const meta=readingRelations(graph,composition);
  const overview=graph.edges.filter(edge=>{const flags=meta.get(routeKey(edge));return flags.representative&&flags.overview;});
  assert.equal(overview.length,4);assert.equal(new Set(overview.map(edge=>JSON.stringify([edge.from,edge.to].sort()))).size,4);
  assert.ok(overview.some(edge=>edge.from==='AGENTS'&&edge.to==='STATE'));
  const gateway=graph.edges.filter(edge=>{const flags=meta.get(routeKey(edge));return flags.representative&&flags.primary&&(edge.from==='GATEWAY'||edge.to==='GATEWAY');});
  assert.equal(gateway.length,3);assert.deepEqual(map,before,'reading priorities must never rewrite canonical flows or ownership');
});
test('connectivity fallback terminates on cycles, preserves components and prefers saved manual reverse route without deleting alternatives',()=>{
  const graph={nodes:['a','b','c','d','isolated'].map(id=>({id})),edges:[{id:'ab',from:'a',to:'b',label:'请求'},{id:'ba',from:'b',to:'a',label:'返回'},{id:'bc',from:'b',to:'c'},{id:'ca',from:'c',to:'a'},{id:'dd',from:'d',to:'d'}]},before=structuredClone(graph);
  const edits={[routeKey(graph.edges[1])]:{from:{side:'top',ratio:.5},to:{side:'bottom',ratio:.5},bends:[{x:-100,y:0}]}};
  const meta=readingRelations(graph,null,edits),visible=graph.edges.filter(edge=>{const m=meta.get(routeKey(edge));return m.representative&&m.overview;});
  assert.equal(visible.length,2);assert.equal(meta.get(routeKey(graph.edges[1])).representative,true);assert.equal(meta.get(routeKey(graph.edges[0])).representative,false);
  assert.match(meta.get(routeKey(graph.edges[1])).label,/请求.*返回/);assert.equal(meta.get(routeKey(graph.edges[4])).overview,false);assert.equal(meta.get(routeKey(graph.edges[4])).primary,true);
  const reversed={...graph,edges:[...graph.edges].reverse()},other=readingRelations(reversed,null,edits);
  assert.deepEqual([...new Set(visible.map(e=>JSON.stringify([e.from,e.to].sort())))].sort(),[...new Set(reversed.edges.filter(e=>other.get(routeKey(e)).representative&&other.get(routeKey(e)).overview).map(e=>JSON.stringify([e.from,e.to].sort())))].sort());
  assert.deepEqual(graph,before);assert.equal(readingRelations({nodes:[],edges:[]}).size,0);
});
test('sparse focus hides non-primary lines and hit targets entirely; full view recovers every direction without dimming cards',()=>{
  const nodes=[domElement({id:'a'}),domElement({id:'b'}),domElement({id:'c'})],flags=(from,to,rep,overview,primary)=>({from,to,readingRepresentative:String(rep),readingOverview:String(overview),readingPrimary:String(primary),readingReverse:'true'});
  const ab=domElement(flags('a','b',true,true,true)),ba=domElement(flags('b','a',false,true,true)),bc=domElement(flags('b','c',true,false,true)),aux=domElement(flags('a','c',true,false,false));
  const paths=[ab,ba,bc,aux],hits=paths.map(p=>domElement({...p.dataset})),labs=paths.map(p=>domElement({...p.dataset,fullLabel:'单向原文',readingLabel:'双向摘要'}));
  const links={dataset:{relationDisplay:'primary'},querySelectorAll:s=>s==='.graph-flow'?paths:hits},labels={querySelectorAll:()=>labs};
  focusGraph({nodes,links,labels},null);assert.equal(ab.style.display,'');assert.ok([ba,bc,aux].every(p=>p.style.display==='none'));assert.ok(labs.every(l=>l.hidden));
  focusGraph({nodes,links,labels},'b');assert.ok([ab,bc].every(p=>p.style.display===''));assert.ok([ba,aux].every(p=>p.style.display==='none'));assert.equal(labs[0].textContent,'双向摘要');assert.equal(labs[0].hidden,false);
  assert.ok([ba,aux].every(p=>!p.classList.contains('dim')),'unrelated lines must be removed, not faint spaghetti');
  links.dataset.relationDisplay='all';focusGraph({nodes,links,labels},'b');assert.ok(paths.every(p=>p.style.display===''));assert.ok(hits.every(p=>p.style.display===''));assert.ok(labs.every(l=>!l.hidden&&l.textContent==='单向原文'));
  assert.ok(nodes.every(n=>n.style.display===undefined&&!n.classList.contains('dimmed')),'card brightness must not change');
});
test('manual routing preserves signed bends and attaches ports to moving boxes, never canonical nodes',()=>{
  const a={x:100,y:200,w:200,h:100},b={x:600,y:200,w:200,h:100};
  const edit={from:{side:'top',ratio:.25},to:{side:'left',ratio:.75},bends:[{x:150,y:-100},{x:500,y:-100}]},before=structuredClone(edit);
  const route=manualGraphRoute(a,b,edit);
  assert.deepEqual(route.points[0],{x:150,y:200});assert.deepEqual(route.points.at(-1),{x:600,y:275});
  assert.ok(route.points.some(p=>p.x===150&&p.y===-100));assert.doesNotMatch(route.d,/NaN|Infinity/);
  const moved=manualGraphRoute({...a,x:-100,y:0},b,edit);
  assert.deepEqual(moved.points[0],{x:-50,y:0});assert.deepEqual(moved.points[2],{x:150,y:-100});assert.deepEqual(edit,before);
  assert.deepEqual(nearestGraphPort(a,{x:205,y:201}),{side:'top',ratio:.525});
});
test('manual routing recovery scopes edits and rejects corrupt geometry while keeping existing node preferences',()=>{
  const valid={from:{side:'bottom',ratio:0},to:{side:'right',ratio:1},bends:[{x:-61000,y:71000}]};
  for(const patch of [{from:{side:'center',ratio:.5}},{to:{side:'right',ratio:2}},{bends:[{x:Number.MAX_VALUE,y:1}]},{bends:[{x:null,y:1}]},{bends:Array(33).fill({x:0,y:0})}])assert.equal(readRouteEdit({...valid,...patch}),null);
  const saved={v:1,mode:'architecture',offsets:{scope:{a:{x:-100,y:50}}},routes:{scope:{route:valid,bad:{...valid,bends:[{x:null,y:0}]}},other:{route:{...valid,bends:[]}}}};
  const state=readPresentation({getItem:()=>JSON.stringify(saved)},'scope');
  assert.deepEqual(state.routes.scope.route,valid);assert.equal(state.routes.scope.bad,undefined);assert.deepEqual(state.routes.other.route.bends,[]);assert.equal(state.offsets.scope.a.x,-100);
  const first={from:'a',to:'b',sources:[{id:'2'},{id:'1'}]},reordered={...first,sources:[...first.sources].reverse()};
  assert.equal(routeKey(first),routeKey(reordered));assert.notEqual(routeKey(first),routeKey({...first,to:'c'}));
  assert.equal(routeKey(first),routeKey({...first,sources:[...first.sources,{id:'new'}]}),'adding a relation to a collapsed bundle must not discard its existing manual route');
});
test('canvas relation picking captures ordered endpoints without entering modules or writing flows',async()=>{
  const source=await fs.readFile(new URL('../prototype/workbench-app.js',import.meta.url),'utf8');
  const start=source.indexOf('function relationScopeValid(draft){'),end=source.indexOf('\nfunction syncRelationControls',start);
  const a={id:'a'},b={id:'b'},draft={repo:'p',viewId:'main',scope:'root',node:'',target:'',direction:'outgoing',label:''};
  let active=true,writable=true,redraws=0,focus=0;
  const ctx=vm.createContext({authMode:false,mapTransitioning:false,repoId:'p',viewRootId:'root',selectedId:'root',relationDraft:draft,workbenchSync:{viewId:'main'},
    graphViewActive:()=>active,canMutate:()=>writable,inTree:n=>[a,b].includes(n),isCancelled:n=>!!n.cancelled,isProposed:n=>!!n.proposed,
    document:{querySelector:()=>({focus(){focus++;}}),getElementById:()=>({focus(){}})},renderAll(){redraws++;},a,b});
  vm.runInContext(source.slice(start,end),ctx);
  vm.runInContext('pickRelationNode(a)',ctx);assert.equal(draft.node,'a');assert.equal(draft.target,'');assert.equal(ctx.selectedId,'a');
  vm.runInContext('pickRelationNode(a)',ctx);assert.equal(draft.target,'');assert.match(draft.error,/另一个/);
  vm.runInContext('pickRelationNode(b)',ctx);assert.equal(draft.target,'b');assert.equal(ctx.selectedId,'a');assert.equal(focus,1);assert.equal(redraws,3);
  ctx.workbenchSync.viewId='session:new';vm.runInContext('pickRelationNode(b)',ctx);assert.equal(ctx.relationDraft,null,'stale Main draft must be discarded');
  for(const invalid of ['readonly','tree','scope','project']){
    ctx.relationDraft={...draft};writable=invalid!=='readonly';active=invalid!=='tree';ctx.viewRootId=invalid==='scope'?'other':'root';ctx.repoId=invalid==='project'?'other':'p';ctx.workbenchSync.viewId='main';
    vm.runInContext('pickRelationNode(b)',ctx);assert.equal(ctx.relationDraft,null);
  }
});
test('relation mode intercepts ordinary card clicks before selected-module navigation',async()=>{
  const source=await fs.readFile(new URL('../prototype/workbench-app.js',import.meta.url),'utf8');
  const start=source.indexOf('function onNodeClick(e, n){'),end=source.indexOf('\nfunction acceptProposal',start);let picks=0;
  const node={id:'a',kind:'module'};
  const ctx=vm.createContext({node,event:{stopPropagation(){},target:{closest:()=>null}},mapTransitioning:false,document:{getElementById:()=>null},window:{},
    lensMode:false,authMode:false,bugPathMode:false,relationMode:false,relationDraft:{node:'a'},selectedId:'a',closeAddPick(){},graphViewActive:()=>true,
    pickRelationNode:n=>{assert.equal(n,node);picks++;},enterView:()=>assert.fail('relation click must not enter'),isProposed:()=>false});
  vm.runInContext(source.slice(start,end),ctx);vm.runInContext('onNodeClick(event,node);onNodeClick(event,node)',ctx);assert.equal(picks,2);
});
test('current-level module entry uses the reading root, never the selected peer or its descendants',async()=>{
  const source=await fs.readFile(new URL('../prototype/workbench-app.js',import.meta.url),'utf8');
  const start=source.indexOf('function addModuleAtCurrentLevel(){'),end=source.indexOf('\nfunction inTree',start);
  assert.ok(start>=0 && end>start,'current-level addition must have an explicit entry');
  const calls=[];let writable=true,active=true,cancelled=false,proposed=false,present=true;
  const root={id:'root'},peer={id:'selected-peer'};
  const ctx=vm.createContext({selectedId:peer.id,liveViewRoot:()=>root,graphViewActive:()=>active,canMutate:()=>writable,
    inTree:()=>present,isCancelled:()=>cancelled,isProposed:()=>proposed,startCompose:(node,kind)=>calls.push({node,kind}),
    workbenchSync:{setStatus(){}}});
  vm.runInContext(source.slice(start,end),ctx);
  vm.runInContext('addModuleAtCurrentLevel()',ctx);assert.deepEqual(calls,[{node:root,kind:'module'}]);
  root.id='nested-scope';vm.runInContext('addModuleAtCurrentLevel()',ctx);assert.equal(calls[1].node,root);assert.equal(calls[1].kind,'module');
  for(const mode of ['readonly','tree','cancelled','proposed','stale']){
    writable=mode!=='readonly';active=mode!=='tree';cancelled=mode==='cancelled';proposed=mode==='proposed';present=mode!=='stale';
    vm.runInContext('addModuleAtCurrentLevel()',ctx);assert.equal(calls.length,2);
  }
  present=true;root.children=[];ctx.selectedId=root.id;
  vm.runInContext('addModuleAtCurrentLevel()',ctx);assert.equal(calls.length,3);assert.equal(calls[2].node,root,'an empty accepted scope can receive its first module even when the root is selected');
  ctx.liveViewRoot=()=>null;
  vm.runInContext('addModuleAtCurrentLevel()',ctx);assert.equal(calls.length,3,'missing scope cannot start a compose operation');
});
test('current-level add control is visible in graph modes, disabled when unavailable and never begins canvas panning',async()=>{
  const source=await fs.readFile(new URL('../prototype/workbench-app.js',import.meta.url),'utf8'),html=await fs.readFile(new URL('../prototype/workbench.html',import.meta.url),'utf8'),css=await fs.readFile(new URL('../prototype/workbench.css',import.meta.url),'utf8');
  assert.match(html,/<button type="button" id="btn-map-add-module"[^>]*hidden[^>]*data-i18n-title="addModuleAtLevelTitle"[^>]*aria-label="添加模块"/,'native named icon button supplies keyboard activation without form submission');
  assert.match(css,/#btn-map-add-module\[hidden\]\{display:none\}/,'graph-only visibility must survive global button display styles');
  const elements={};for(const id of ['map-view-hint','btn-map-add-module'])elements[id]={};
  elements['map-view-toggle']={dataset:{},classList:{toggle(){}},setAttribute(k,v){this[k]=v;},getAttribute(k){return this[k];}};
  let active=true,writable=true,proposed=false,cancelled=false,mode='architecture';
  const ctx=vm.createContext({mapBetaEnabled:true,graphViewApi:{},graphPresentation:()=>({mode}),graphViewActive:()=>active,canMutate:()=>writable,
    liveViewRoot:()=>({id:'root'}),isProposed:()=>proposed,isCancelled:()=>cancelled,syncDetailChrome:()=>{},
    document:{querySelectorAll:()=>[],getElementById:id=>elements[id],body:{classList:{toggle(){}}}}});
  const start=source.indexOf('function syncGraphControls(){'),end=source.indexOf('\nfunction setMapView',start);
  vm.runInContext(source.slice(start,end),ctx);vm.runInContext('syncGraphControls()',ctx);
  assert.equal(elements['btn-map-add-module'].hidden,false);assert.equal(elements['btn-map-add-module'].disabled,false);
  mode='sop';vm.runInContext('syncGraphControls()',ctx);
  assert.equal(elements['btn-map-add-module'].hidden,false);assert.equal(elements['btn-map-add-module'].disabled,false,'SOP retains the same current-level entry');
  for(const mode of ['readonly','proposed','cancelled']){writable=mode!=='readonly';proposed=mode==='proposed';cancelled=mode==='cancelled';vm.runInContext('syncGraphControls()',ctx);assert.equal(elements['btn-map-add-module'].disabled,true);}
  active=false;vm.runInContext('syncGraphControls()',ctx);assert.equal(elements['btn-map-add-module'].hidden,true);
  const panStart=source.indexOf('function panIgnore(el){'),panEnd=source.indexOf('\nfunction endPointer',panStart);
  ctx.mapTransitioning=false;ctx.control={closest:selector=>selector==='#btn-map-add-module'?{}:null};
  vm.runInContext(source.slice(panStart,panEnd),ctx);assert.equal(vm.runInContext('panIgnore(control)',ctx),true);
  const clickLine=source.split('\n').find(line=>line.includes("document.getElementById('btn-map-add-module').onclick="));
  assert.ok(clickLine);let clicks=0;ctx.addModuleAtCurrentLevel=()=>clicks++;
  vm.runInContext(clickLine,ctx);elements['btn-map-add-module'].onclick();assert.equal(clicks,1,'native click uses exactly the guarded current-level entry');
});
test('relation targets use full canonical paths and exclude cancelled/proposed subtrees and inbox',()=>{
  const root={id:'root',title:'Project',children:[{id:'a',title:'Domain',children:[{id:'leaf',title:'Leaf'}]},{id:'cancelled',proposal:'cancelled',children:[{id:'hidden'}]},{id:'proposed',proposal:'proposed'}],_inbox:[{id:'inbox'}]};
  const before=structuredClone(root);
  assert.deepEqual(relationChoices(root),[{id:'root',path:'Project'},{id:'a',path:'Project / Domain'},{id:'leaf',path:'Project / Domain / Leaf'}]);
  assert.deepEqual(root,before);assert.deepEqual(relationChoices(null),[]);
});
test('manual relations retain exact cross-layer endpoints, direction, meaning and canonical ownership',()=>{
  const map=createOpenclawMap(),before=structuredClone(map);
  const forward=makeRelation(map.root,map.flows,{from:'GATEWAY',to:'STATE',label:'  更新会话  ',id:'F-new'});
  assert.deepEqual(forward,{id:'F-new',from:'GATEWAY',to:'STATE',label:'更新会话'});
  const backward=makeRelation(map.root,[forward],{from:'STATE',to:'GATEWAY',label:'返回状态',id:'F-back'});
  assert.equal(backward.from,'STATE');assert.equal(backward.to,'GATEWAY');
  const self=makeRelation(map.root,[],{from:'STATE',to:'STATE',label:'',id:'F-self'});assert.equal(self.from,self.to);
  const graph=projectArchitecture(map.root,[...map.flows,forward]);
  assert.ok(graph.edges.some(edge=>edge.sources.includes(forward)));assert.deepEqual(map,before);
});
test('manual relations reject duplicate, unavailable endpoints and invalid input without mutating flows',()=>{
  const root={id:'root',children:[{id:'a'},{id:'b'},{id:'hidden',proposal:'cancelled'}]},flows=[{id:'existing',from:'a',to:'b',label:'调用'}];
  const before=structuredClone(flows),fields={from:'a',to:'b',label:'其他',id:'new'};
  for(const patch of [{from:'missing'},{to:'hidden'},{label:' 调用 '},{label:'x'.repeat(161)},{label:null},{id:'existing'},{id:''}])assert.throws(()=>makeRelation(root,flows,{...fields,...patch}),/RELATION_/);
  assert.deepEqual(flows,before);
  assert.equal(makeRelation(root,flows,{...fields,label:'x'.repeat(160)}).label.length,160);
});
test('relation submit saves through normal redraw, preserves scope/permissions and rejects readonly or stale nodes',async()=>{
  const source=await fs.readFile(new URL('../prototype/workbench-app.js',import.meta.url),'utf8');
  const start=source.indexOf('function submitRelation(node, draft){'),end=source.indexOf('\n/* ================= 抽屉',start);
  const node={id:'a',children:[]},data={id:'root',children:[node,{id:'b'}],flows:[]},draft={repo:'repo',node:'a',viewId:'main',target:'b',direction:'incoming',label:'读取结果'};
  let writable=true,present=true,redraws=0;
  const ctx=vm.createContext({data,node,draft,repoId:'repo',workbenchSync:{viewId:'main'},canMutate:()=>writable,inTree:()=>present,isCancelled:()=>false,isProposed:()=>false,crypto:{randomUUID:()=> 'test'},graphViewApi:{makeRelation},relationDraft:draft,renderAll:()=>redraws++,viewRootId:'root',sessionAuth:new Set(['a'])});
  vm.runInContext(source.slice(start,end),ctx);
  assert.equal(vm.runInContext('submitRelation(node,draft)',ctx),'');
  assert.equal(data.flows[0].from,'b');assert.equal(data.flows[0].to,'a');assert.equal(redraws,1);assert.equal(ctx.relationDraft,null);
  assert.equal(ctx.viewRootId,'root');assert.deepEqual([...ctx.sessionAuth],['a']);assert.equal(node.children.length,0);
  for(const mode of ['duplicate','readonly','stale','direction']){
    writable=mode!=='readonly';present=mode!=='stale';ctx.draft={...draft,direction:mode==='direction'?'bad':'incoming'};
    assert.notEqual(vm.runInContext('submitRelation(node,draft)',ctx),'');assert.equal(data.flows.length,1);assert.equal(redraws,1);
  }
});
test('compose Enter consumes keyboard activation, commits once and never commits IME candidate selection',async()=>{
  const source=await fs.readFile(new URL('../prototype/workbench-app.js',import.meta.url),'utf8');
  const start=source.indexOf('  if(composeEl){\n    composeEl.addEventListener("keydown"'),end=source.indexOf('\n  bindFileUi(el, node);',start);
  let handler,commits=0,cleared=0;
  const ctx=vm.createContext({composeEl:{addEventListener:(type,fn)=>handler=fn,focus(){}},workbenchSync:{composing:false},doCommit:()=>commits++,clearCompose:()=>cleared++,renderAll(){}});
  vm.runInContext(source.slice(start,end),ctx);
  for(const event of [{isComposing:true},{keyCode:229}])handler({key:'Enter',preventDefault(){},stopImmediatePropagation(){},...event});
  ctx.workbenchSync.composing=true;handler({key:'Enter',preventDefault(){},stopImmediatePropagation(){}});assert.equal(commits,0);
  ctx.workbenchSync.composing=false;let stopped=0;handler({key:'Enter',preventDefault(){},stopImmediatePropagation(){stopped++;}});
  assert.equal(commits,1);assert.equal(stopped,1);assert.equal(cleared,0);
  handler({key:'Escape',preventDefault(){},stopImmediatePropagation(){}});assert.equal(cleared,1);
});
test('overview exposes five original domains, with exact bundled source edges and no fictional self-loops', () => {
  const map = createOpenclawMap(), before = structuredClone(map), graph = projectArchitecture(map.root, map.flows);
  assert.deepEqual(graph.nodes.map(node => node.id).sort(), ['AGENTS', 'CHANNELS', 'CLIENTS', 'GATEWAY', 'STATE']);
  assert.equal(graph.nodes.find(node => node.id === 'CLIENTS'), map.root.children[0]);
  const input = graph.edges.find(edge => edge.from === 'CLIENTS' && edge.to === 'GATEWAY');
  assert.equal(input.sources.length, 3); assert.equal(input.label, 'WebSocket 请求 · 命令请求 · 设备连接');
  assert.match(input.detail, /界面接口 → WebSocket 连接：WebSocket 请求/);
  assert.ok(graph.edges.every(edge => edge.from !== edge.to));
  assert.equal(graph.groups.get('CLIENTS').count, 5); assert.equal(graph.context.size, 0);
  assert.deepEqual(map, before);
});
test('bundled labels preserve distinct meanings without counts or invented labels', () => {
  const root={id:'root',children:[{id:'a',title:'A',children:[{id:'a1',title:'A1'},{id:'a2',title:'A2'}]},{id:'b',title:'B'}]};
  const flows=[{from:'a1',to:'b',label:'读取状态'},{from:'a2',to:'b',label:'读取状态'},{from:'a1',to:'b',label:'  更新状态  '},{from:'a2',to:'b'}];
  const before=structuredClone(flows),edge=projectArchitecture(root,flows).edges[0];
  assert.equal(edge.label,'读取状态 · 更新状态');assert.equal(edge.sources.length,4);
  assert.deepEqual(flows,before);
  assert.equal(projectArchitecture(root,[{from:'a1',to:'b'},{from:'a2',to:'b'}]).edges[0].label,'');
});
test('a drilled domain shows direct peers plus only related external domains', () => {
  const map = createOpenclawMap(), graph = projectArchitecture(map.root, map.flows, find(map.root, 'GATEWAY'));
  assert.deepEqual(graph.nodes.map(node => node.id).sort(), ['AGENTS', 'CHANNELS', 'CLIENTS', 'CONNECTION', 'GATEWAY', 'HEALTH', 'RPC']);
  assert.deepEqual([...graph.context].sort(), ['AGENTS', 'CHANNELS', 'CLIENTS']);
  assert.ok(!graph.nodes.some(node => node.id === 'STATE'));
  assert.equal(graph.edges.find(edge => edge.from === 'CONNECTION' && edge.to === 'RPC').sources[0].from, 'RECEIVER');
});
test('the next slice restores internal facts, self-loop and neighbouring sibling endpoints', () => {
  const map = createOpenclawMap(), graph = projectArchitecture(map.root, map.flows, find(map.root, 'CONNECTION'));
  assert.deepEqual(graph.nodes.map(node => node.id).sort(), ['CLIENTS', 'CONNECTION', 'GATEWAY', 'HEALTH', 'ORIGIN-POLICY', 'RECEIVER', 'RPC', 'WEBSOCKET']);
  assert.equal(graph.edges.find(edge => edge.from === 'WEBSOCKET' && edge.to === 'WEBSOCKET').sources.length, 1);
  assert.equal(graph.nodes.find(node => node.id === 'RECEIVER').todos[0].title, '示例：补充消息校验测试');
});
test('null, cancelled, dangling and inbox nodes never introduce new or hidden relation endpoints', () => {
  assert.equal(projectArchitecture(null).nodes.length, 0);
  const root = { id: 'root', children: [{ id: 'hidden', proposal: 'cancelled', children: [{ id: 'secret' }] }], _inbox: [{ id: 'inbox', children: [] }] };
  const graph = projectArchitecture(root, [{ from: 'secret', to: 'inbox' }, { from: 'inbox', to: 'missing' }]);
  assert.deepEqual(graph.nodes.map(node => node.id), ['inbox']); assert.equal(graph.edges.length, 0);
});
test('all original valid relations are recoverable across reading slices without rewriting the Map', () => {
  const map = createOpenclawMap(), originals = new Set();
  const visit = node => { for (const edge of projectArchitecture(map.root, map.flows, node).edges) for (const source of edge.sources) originals.add(source); node.children.forEach(visit); };
  visit(map.root); assert.equal(originals.size, 29);
});
test('small screens reflow rather than shrink the hierarchy into a single giant graph', () => {
  const map = createOpenclawMap(), graph = projectArchitecture(map.root, map.flows);
  const sizes = new Map(graph.nodes.map(node => [node.id, { w:252, h:140 }]));
  const phone = layoutGraph(graph, sizes, { phone:true });
  assert.equal(phone.size, 5); assert.equal(new Set([...phone.values()].map(p => p.x)).size, 1);
  const desktop = layoutGraph(graph, sizes, { columns:2 });
  assert.equal(new Set([...desktop.values()].map(p => p.x)).size, 2);
  const shifted=layoutGraph(graph,sizes,{phone:true,offsets:{CLIENTS:{x:8,y:0}}});
  assert.equal(shifted.get('CLIENTS').x,phone.get('CLIENTS').x+8,'Compact offsets do not jump to the old 90px boundary');
  assert.equal(shifted.get('CLIENTS').y,phone.get('CLIENTS').y);
});
test('routes spread same-side ports and avoid an intervening card while preserving direction', () => {
  const boxes = new Map([['a',{x:110,y:110,w:200,h:100}], ['obstacle',{x:460,y:80,w:200,h:180}], ['b',{x:810,y:110,w:200,h:100}]]);
  const routes = routeGraph(boxes, [{from:'a',to:'b'}, {from:'a',to:'b'}, {from:'b',to:'a'}]);
  assert.notEqual(routes[0].d, routes[1].d); assert.notEqual(routes[0].d, routes[2].d);
  for (const route of routes) {
    assert.equal(route.unresolved, undefined); assert.ok(!/NaN|Infinity/.test(route.d));
    // Independent sample oracle against the actual card, not router helpers.
    for (let i=1;i<route.points.length;i++) for(let t=0;t<=100;t++) {
      const a=route.points[i-1],b=route.points[i],x=a.x+(b.x-a.x)*t/100,y=a.y+(b.y-a.y)*t/100;
      assert.ok(!(x>460&&x<660&&y>80&&y<260), 'route crosses the intervening card');
    }
  }
});
test('label placement searches its own corridor without overlapping cards or another label', () => {
  const route = { label:{x:300,y:150}, candidates:[{x:300,y:150},{x:450,y:150}], points:[{x:100,y:170},{x:600,y:170}] };
  const boxes=[{x:250,y:120,w:100,h:100}], placed=[{x:410,y:100,w:80,h:20}];
  const result=placeGraphLabel(route,{w:80,h:20},boxes,placed,[route]);
  assert.equal(result.unresolved,undefined); assert.equal(result.x,410); assert.equal(result.y,140);
});
test('graph navigation forces read-only inbox handling through every enterView caller', async () => {
  const source = await fs.readFile(new URL('../prototype/workbench-app.js', import.meta.url), 'utf8');
  const start = source.indexOf('function enterView(id, opts){'), end = source.indexOf('\nfunction runMapViewChain', start);
  let received;
  const context = vm.createContext({ mapTransitioning:false, viewRootId:'root', graphViewActive:()=>true,
    closeAddPick(){}, deleteAskId:null, bugPathMode:false, mapMotionBetaEnabled:false,
    commitViewRoot:(id,opts)=>{received={id,opts};}, fitView(){} });
  vm.runInContext(source.slice(start,end), context);
  for(const opts of [undefined,{direction:'up'},{unpack:true}]) {
    context.input=opts; vm.runInContext("enterView('group',input)",context);
    assert.equal(received.opts.unpack,false); assert.equal(received.id,'group');
  }
});
test('reading root restores from the same presentation key and rejects malformed values', () => {
  const state=readPresentation({getItem:()=>JSON.stringify({v:1,mode:'architecture',readingRootId:'CONNECTION'})},'scope');
  assert.equal(state.readingRootId,'CONNECTION');
  assert.equal(readPresentation({getItem:()=>JSON.stringify({v:1,readingRootId:{bad:true}})},'scope').readingRootId,undefined);
});

function domElement(dataset = {}, initial = []) {
  const classes = new Set(initial), children = [];
  return { dataset, style:{}, children, offsetWidth:200, offsetHeight:100,
    classList:{contains:name=>classes.has(name),toggle:(name,on)=>on?classes.add(name):classes.delete(name)},
    setAttribute(){}, append(...items){children.push(...items);}, replaceChildren(){children.length=0;},
    querySelectorAll:()=>children, addEventListener(){}, click(){this.clicks=(this.clicks||0)+1;}
  };
}
test('manual offsets may cross zero and the former 50000 ceiling without changing canonical nodes',()=>{
  const graph={nodes:[{id:'a',title:'A'}],edges:[]},before=structuredClone(graph),sizes=new Map([['a',{w:200,h:100}]]);
  for(const mode of ['architecture','sop']){
    assert.deepEqual(layoutGraph(graph,sizes,{mode,offsets:{a:{x:-510,y:-710}}}).get('a'),{x:-400,y:-600});
    assert.deepEqual(layoutGraph(graph,sizes,{mode,offsets:{a:{x:60100,y:70100}}}).get('a'),{x:60210,y:70210});
    assert.deepEqual(layoutGraph(graph,sizes,{mode,offsets:{a:{x:100000,y:-100000}}}).get('a'),{x:100110,y:-99890},'numerical safety must not restore the former canvas ceiling');
  }
  const saved=readPresentation({getItem:()=>JSON.stringify({v:1,offsets:{view:{a:{x:-61000,y:71000}}}})},'local');
  assert.deepEqual(saved.offsets.view.a,{x:-61000,y:71000});assert.deepEqual(graph,before);
});
test('actual drag keeps signed coordinates, persisted offsets and signed graph bounds across redraw',()=>{
  const original=globalThis.document;globalThis.document={createElement:()=>domElement(),createElementNS:()=>domElement()};
  try{
    const handlers={},card=domElement();card.addEventListener=(name,handler)=>{handlers[name]=handler;};card.setPointerCapture=()=>{};
    const graph={nodes:[{id:'a',title:'A'}],edges:[]},moves=[],bounds=[];
    renderGraph({graph,mount:()=>card,links:domElement(),labels:domElement(),options:{},selected:null,scale:()=>.5,moved:(id,offset)=>moves.push({id,offset}),boundsChanged:bound=>bounds.push(bound)});
    handlers.pointerdown({button:0,pointerId:1,clientX:100,clientY:100,target:{closest:()=>null},stopPropagation(){}});
    handlers.pointermove({pointerId:1,clientX:-150,clientY:-200});
    assert.equal(card.style.left,'-390px');assert.equal(card.style.top,'-490px');
    handlers.pointerup({pointerId:1});assert.deepEqual(moves,[{id:'a',offset:{x:-500,y:-600}}]);
    assert.ok(bounds.at(-1).minX<=-390&&bounds.at(-1).minY<=-490);
    renderGraph({graph,mount:()=>card,links:domElement(),labels:domElement(),options:{offsets:{a:moves[0].offset}},selected:null,scale:()=>1,moved(){}});
    assert.equal(card.style.left,'-390px');assert.equal(card.style.top,'-490px');
  }finally{if(original===undefined)delete globalThis.document;else globalThis.document=original;}
});
test('fitting a graph accounts for negative origin without altering legacy positive-origin fitting',async()=>{
  const source=await fs.readFile(new URL('../prototype/workbench-app.js',import.meta.url),'utf8');
  const start=source.indexOf('function fittedView(){'),end=source.indexOf('\nfunction fitView',start);
  const ctx=vm.createContext({document:{body:{classList:{contains:()=>false}}},isPhoneLayout:()=>false,bugPanelWidthPx:()=>0,drawerWidthPx:()=>0,
    drawerHeightPx:()=>0,window:{innerWidth:800,innerHeight:600},chromeTop:()=>58,graphViewActive:()=>true,graphPresentation:()=>({mode:'architecture'}),extents:{w:300,h:200,minX:-400,minY:-600}});
  vm.runInContext(source.slice(start,end),ctx);const view=vm.runInContext('fittedView()',ctx);
  assert.equal(view.k,1.35);assert.ok(-400*view.k+view.x>=36);assert.ok(-600*view.k+view.y>=24);
  ctx.extents={w:300,h:200};const legacy=vm.runInContext('fittedView()',ctx);
  assert.equal(legacy.x,197.5);assert.equal(legacy.y,142);
});
test('relation routes and labels follow negative-coordinate cards without a positive-origin floor',()=>{
  const boxes=new Map([['a',{x:-600,y:-300,w:200,h:100}],['b',{x:-100,y:-300,w:200,h:100}]]);
  const route=routeGraph(boxes,[{from:'a',to:'b'}],{'["a","b"]':{fromSide:'top',toSide:'top',corridor:'above'}})[0];
  assert.ok(route.points.some(point=>point.y===-372));assert.equal(route.unresolved,undefined);
  const label=placeGraphLabel(route,{w:80,h:20},[...boxes.values()],[],[route]);
  assert.equal(label.unresolved,undefined);assert.ok(label.x<0&&label.y<0);
});
test('finite but overflow-prone recovered offsets cannot crash route rendering or poison bounds',()=>{
  const original=globalThis.document;globalThis.document={createElement:()=>domElement(),createElementNS:()=>domElement()};
  try{
    const cards=new Map([['a',domElement()],['b',domElement()]]),links=domElement(),labels=domElement(),attributes=[];
    links.setAttribute=(key,value)=>attributes.push([key,value]);
    const graph={nodes:[{id:'a',title:'A'},{id:'b',title:'B'}],edges:[{from:'a',to:'b',label:'关系'}]},before=structuredClone(graph);
    const recovered=readPresentation({getItem:()=>JSON.stringify({v:1,offsets:{view:{a:{x:-Number.MAX_VALUE,y:0},b:{x:Number.MAX_VALUE,y:0}}}})},'unit');
    let bounds;
    assert.doesNotThrow(()=>{bounds=renderGraph({graph,mount:node=>cards.get(node.id),links,labels,options:{offsets:recovered.offsets.view},selected:null,scale:()=>1,moved(){}});},'untrusted finite presentation offsets must not stop the Map from rendering');
    assert.ok(Object.values(bounds).every(Number.isFinite),'fit bounds must remain finite');
    assert.equal(cards.get('a').style.left,'110px');assert.equal(cards.get('b').style.left,'460px','corrupt numerical offsets fall back, not clamp to a canvas edge');
    for(const card of cards.values())assert.ok([card.style.left,card.style.top].every(value=>!/(NaN|Infinity)/.test(value)));
    for(const [,value] of attributes)assert.doesNotMatch(String(value),/NaN|Infinity/);
    assert.deepEqual(graph,before);
  }finally{if(original===undefined)delete globalThis.document;else globalThis.document=original;}
});
test('invalid drag scales never persist a position, and cancellation or lost capture restores the start only',()=>{
  const original=globalThis.document;globalThis.document={createElement:()=>domElement(),createElementNS:()=>domElement()};
  try{
    for(const zoom of [NaN,Infinity,0,-1]){
      const handlers={},card=domElement(),moves=[];card.addEventListener=(name,handler)=>{handlers[name]=handler;};card.setPointerCapture=()=>{};
      renderGraph({graph:{nodes:[{id:'a',title:'A'}],edges:[]},mount:()=>card,links:domElement(),labels:domElement(),options:{},selected:null,scale:()=>zoom,moved:(...args)=>moves.push(args)});
      handlers.pointerdown({button:0,pointerId:1,clientX:0,clientY:0,target:{closest:()=>null},stopPropagation(){}});
      handlers.pointermove({pointerId:1,clientX:100,clientY:100});handlers.pointerup({pointerId:1});
      assert.equal(card.style.left,'110px');assert.equal(card.style.top,'110px');assert.deepEqual(moves,[],`invalid scale ${zoom} must not write drag preferences`);
    }
    for(const event of ['pointercancel','lostpointercapture']){
      const handlers={},card=domElement(),moves=[];card.addEventListener=(name,handler)=>{handlers[name]=handler;};card.setPointerCapture=()=>{};
      renderGraph({graph:{nodes:[{id:'a',title:'A'}],edges:[]},mount:()=>card,links:domElement(),labels:domElement(),options:{offsets:{a:{x:-500,y:-600}}},selected:null,scale:()=>1,moved:(...args)=>moves.push(args)});
      handlers.pointerdown({button:0,pointerId:1,clientX:0,clientY:0,target:{closest:()=>null},stopPropagation(){}});
      handlers.pointermove({pointerId:1,clientX:-700,clientY:-900});handlers[event]({pointerId:1});handlers.pointerup({pointerId:1});
      assert.equal(card.style.left,'-390px');assert.equal(card.style.top,'-490px');assert.equal(card._graphDragged,false);assert.deepEqual(moves,[],'cancellation restores the signed start, not an artificial origin');
    }
  }finally{if(original===undefined)delete globalThis.document;else globalThis.document=original;}
});
test('authored concise labels affect display only and retain full source relation titles', () => {
  const pair=JSON.stringify(['a','b']),input={id:'scene',positions:{a:{col:0,row:0},b:{col:1,row:0}},labels:{[pair]:'  连接网关  ',invalid:42,empty:' ',oversize:'x'.repeat(81)}};
  const normalized=readComposition(input);assert.equal(normalized.labels[pair],'连接网关');
  assert.deepEqual(Object.keys(normalized.labels),[pair]);assert.equal(input.labels[pair],'  连接网关  ');
  const original=globalThis.document;globalThis.document={createElement:()=>domElement(),createElementNS:()=>domElement()};
  try {
    const edge={from:'a',to:'b',label:'WebSocket 请求 · 命令请求',detail:'完整原始端点与关系',sources:[{},{}]};
    const graph={nodes:[{id:'a',title:'A'},{id:'b',title:'B'}],edges:[edge]},before=structuredClone(graph);
    const links=domElement(),labels=domElement();
    renderGraph({graph,mount:()=>domElement(),links,labels,options:{composition:input},selected:null,scale:()=>1,moved(){}});
    assert.equal(labels.children[0].textContent,'连接网关');
    assert.equal(links.children[0].children[0].textContent,'完整原始端点与关系');assert.deepEqual(graph,before);
    renderGraph({graph,mount:()=>domElement(),links,labels,options:{mode:'sop',composition:input},selected:null,scale:()=>1,moved(){}});
    assert.equal(labels.children[0].textContent,'WebSocket 请求 · 命令请求','SOP ignores architecture display labels');
  } finally {if(original===undefined)delete globalThis.document;else globalThis.document=original;}
});
test('selection updates existing cards and relation labels without dimming cards or changing their identity', () => {
  const a=domElement({id:'a'}), b=domElement({id:'b'}), root=domElement({id:'root'},['drilled-root']);
  const ab=domElement({from:'a',to:'b'}), br=domElement({from:'b',to:'root'});
  const abLabel=domElement({from:'a',to:'b'}), brLabel=domElement({from:'b',to:'root'});
  const nodes=[a,b,root], links={querySelectorAll:()=>[ab,br]}, labels={querySelectorAll:()=>[abLabel,brLabel]};
  focusGraph({nodes,links,labels},'a');
  assert.equal(nodes[0],a); assert.equal(a.classList.contains('selected'),true);
  assert.equal(b.classList.contains('selected'),false); assert.deepEqual(b.style,{});
  assert.equal(ab.classList.contains('hot'),true); assert.equal(br.classList.contains('dim'),true);
  assert.equal(abLabel.hidden,false); assert.equal(brLabel.hidden,true);
  focusGraph({nodes,links,labels},'b');
  assert.equal(a.classList.contains('selected'),false); assert.equal(b.classList.contains('selected'),true);
  assert.equal(brLabel.hidden,false);
  focusGraph({nodes,links,labels},null);
  assert.ok([ab,br].every(edge=>edge.classList.contains('hot')&&!edge.classList.contains('dim')));
  assert.ok([abLabel,brLabel].every(label=>!label.hidden));
});
test('first click presents relations; a later click on the same selected module enters without a double-click event', async () => {
  const source=await fs.readFile(new URL('../prototype/workbench-app.js',import.meta.url),'utf8');
  const start=source.indexOf('function onNodeClick(e, n){'),end=source.indexOf('\nfunction acceptProposal',start);
  const calls=[];
  const context=vm.createContext({ mapTransitioning:false,document:{getElementById:id=>id==='btn-map-route-auto'?{}:null},window:{},
    lensMode:false,authMode:false,bugPathMode:false,relationMode:false,relationDraft:null,viewRootId:'root',selectedId:'root',relAnchorId:null,
    closeAddPick(){},graphViewActive:()=>true,isProposed:()=>false,isCancelled:()=>false,canEnter:node=>node.kind==='module'&&node.id!=='root',
    nodesEl:{querySelectorAll:()=>[]},linksEl:{querySelectorAll:()=>[]},flowLabsEl:{},
    graphViewApi:{focusGraph:(dom,id)=>calls.push(['focus',id])},renderDetail:()=>calls.push(['detail']),persist:()=>calls.push(['persist']),
    renderAll:()=>assert.fail('single click must preserve card DOM'),enterView:(id,opts)=>calls.push(['enter',id,opts.unpack])
  });
  vm.runInContext(source.slice(start,end),context);
  context.event={stopPropagation(){},target:{closest:()=>null}};context.node={id:'group',kind:'module'};
  vm.runInContext('onNodeClick(event,node)',context);
  assert.equal(context.selectedId,'group');assert.equal(context.relAnchorId,'group');
  assert.deepEqual(calls,[['focus','group'],['detail'],['persist']]);
  vm.runInContext('onNodeClick(event,node)',context);
  assert.deepEqual(calls.at(-1),['enter','group',false]);
  const entered=calls.filter(call=>call[0]==='enter').length;
  context.node={id:'other',kind:'module'};
  vm.runInContext('onNodeClick(event,node)',context);
  assert.equal(context.selectedId,'other');assert.equal(calls.filter(call=>call[0]==='enter').length,entered);
  context.node={id:'group',kind:'module'};
  vm.runInContext('onNodeClick(event,node)',context);
  assert.equal(calls.filter(call=>call[0]==='enter').length,entered,'switching selection starts with relations again');
  context.node={id:'leaf',kind:'work'};
  vm.runInContext('onNodeClick(event,node);onNodeClick(event,node)',context);
  assert.equal(calls.filter(call=>call[0]==='enter').length,entered,'non-enterable leaves only select');
  context.node={id:'root',kind:'module'};
  vm.runInContext('onNodeClick(event,node);onNodeClick(event,node)',context);
  assert.equal(calls.filter(call=>call[0]==='enter').length,entered,'current reading root never enters itself');
});
test('rendered cards have no expand button or double-click handler, and keyboard activation follows ordinary clicks', () => {
  const original=globalThis.document;
  globalThis.document={createElement:()=>domElement(),createElementNS:()=>domElement()};
  try {
    const card=domElement({id:'a'});
    renderGraph({graph:{nodes:[{id:'a',title:'Module'}],edges:[],groups:new Map([['a',{count:3}]])},
      mount:()=>card,links:domElement(),labels:domElement(),options:{},selected:null,scale:()=>1,moved(){}});
    assert.equal(card.children.length,1);assert.equal(card.children[0].children.length,1,'only the node-count caption remains');
    const event={target:{closest:()=>null},preventDefault(){},stopPropagation(){}};
    assert.equal(card.ondblclick,undefined);
    card.onkeydown({...event,target:card,key:' '});assert.equal(card.clicks,1);
    card.onkeydown({...event,target:card,key:'Enter'});assert.equal(card.clicks,2);
    card.onkeydown({...event,key:'Enter'});assert.equal(card.clicks,2,'child controls do not activate the card');
  } finally { if(original===undefined)delete globalThis.document;else globalThis.document=original; }
});
test('the post-drag click wrapper suppresses selection and entry', async () => {
  const source=await fs.readFile(new URL('../prototype/workbench-app.js',import.meta.url),'utf8');
  const listener=source.split('\n').find(line=>line.includes('div.addEventListener("click", e=>{if(div._graphDragged'));
  assert.ok(listener);
  let handler,stopped=false;
  const div={_graphDragged:true,addEventListener:(type,callback)=>{assert.equal(type,'click');handler=callback;}};
  vm.runInNewContext(listener,{div,n:{id:'a'},onNodeClick:()=>assert.fail('drag click must not select or enter')});
  handler({target:{closest:()=>null},stopPropagation:()=>{stopped=true;}});
  assert.equal(stopped,true);assert.equal(div._graphDragged,true,'post-drag click remains suppressed');
});
test('post-drag protection never blocks explicit add-module or add-node controls', async () => {
  const source=await fs.readFile(new URL('../prototype/workbench-app.js',import.meta.url),'utf8');
  const listener=source.split('\n').find(line=>line.includes('div.addEventListener("click", e=>{if(div._graphDragged'));
  for(const control of ['.add-child','.add-pick']) {
    let handler,called=0;
    const div={_graphDragged:true,addEventListener:(type,callback)=>{handler=callback;}};
    vm.runInNewContext(listener,{div,n:{id:'a'},onNodeClick:()=>{called++;}});
    handler({target:{closest:selector=>selector.split(',').includes(control)?{}:null},stopPropagation:()=>assert.fail('explicit add control must not be swallowed')});
    assert.equal(called,1);assert.equal(div._graphDragged,true,'body drag protection is not disabled for unrelated clicks');
  }
});
test('graph creation opens its owning scope and reveals the new module or node without fabricating relations', async () => {
  const source=await fs.readFile(new URL('../prototype/workbench-app.js',import.meta.url),'utf8');
  const start=source.indexOf('function commitChild(node, title){'),end=source.indexOf('\n/* ================= 抽屉',start);
  for(const kind of ['module','work']) {
    const parent={id:'parent',kind:'module',children:[]},flows=[{from:'a',to:'b',label:'original'}],calls=[],reading={readingRootId:'overview'};
    const context=vm.createContext({workbenchSync:{ready:true},composeParent:parent,composingKind:kind,
      inTree:()=>true,isCancelled:()=>false,clearCompose(){},nextNodeId:()=> 'created',sessionAuth:new Set(),
      findPath:()=>[parent],promoteFatWork(){},viewRootId:'overview',selectedId:'overview',
      graphViewActive:()=>true,visibleChildren:()=>[...parent.children],
      graphPresentation:()=>reading,saveGraphPresentation:()=>calls.push(['save-reading']),
      renderAll:()=>calls.push(['render']),fitView:()=>calls.push(['fit']),revealGraphNode:id=>calls.push(['reveal',id]),flows});
    vm.runInContext(source.slice(start,end),context);context.parent=parent;
    vm.runInContext("commitChild(parent,' New title ')",context);
    assert.equal(context.viewRootId,'parent');assert.equal(context.selectedId,'created');
    assert.equal(parent.children[0].title,'New title');assert.equal(parent.children[0].kind,kind);
    assert.equal(reading.readingRootId,'parent');assert.deepEqual(calls,[['save-reading'],['render'],['fit'],['reveal','created']]);assert.deepEqual(flows,[{from:'a',to:'b',label:'original'}]);
  }
});
test('new off-screen card is centered at readable zoom; visible, missing and invalid geometry remain unchanged', async () => {
  const source=await fs.readFile(new URL('../prototype/workbench-app.js',import.meta.url),'utf8');
  const start=source.indexOf('function revealGraphNode(id){'),end=source.indexOf('\nfunction onChromeResize',start);
  let rect={left:100,top:900,width:200,height:100},bounds={left:0,top:58,width:940,height:662},applied=0;
  const card={dataset:{id:'new'},getBoundingClientRect:()=>rect};
  const context=vm.createContext({nodesEl:{querySelectorAll:()=>[card]},document:{getElementById:()=>({getBoundingClientRect:()=>bounds})},view:{x:36,y:24,k:.85},applyView:()=>{applied++;},armDrillReturn(){}});
  vm.runInContext(source.slice(start,end),context);vm.runInContext("revealGraphNode('new')",context);
  assert.equal(context.view.x,306);assert.equal(context.view.y,-537);assert.equal(context.view.k,.85);assert.equal(applied,1);
  context.view={x:36,y:24,k:.85};rect={left:100,top:100,width:200,height:100};
  vm.runInContext("revealGraphNode('new');revealGraphNode('missing')",context);assert.equal(applied,1);assert.equal(context.view.x,36);
  bounds={left:0,top:0,width:0,height:0};vm.runInContext("revealGraphNode('new')",context);assert.equal(applied,1);
  bounds={left:0,top:0,width:940,height:662};rect={left:NaN,top:900,width:200,height:100};vm.runInContext("revealGraphNode('new')",context);assert.equal(applied,1);
  for(const size of [{width:0,height:0},{width:-1,height:100},{width:200,height:-1}]){
    rect={left:0,top:0,...size};vm.runInContext("revealGraphNode('new')",context);assert.equal(applied,1,'hidden or invalid card dimensions do not move the view');
  }
});
test('authored positions preserve semantic placement and manual offsets without altering canonical data', () => {
  const graph={nodes:[{id:'entry'},{id:'worker'},{id:'store'}],edges:[{from:'entry',to:'worker'},{from:'worker',to:'store'}]};
  const before=structuredClone(graph),sizes=new Map(graph.nodes.map(n=>[n.id,{w:200,h:100}]));
  const composition={id:'reading',positions:{entry:{col:0,row:0},worker:{col:1,row:0},store:{col:1,row:1}},gapX:160,gapY:110};
  const p=layoutGraph(graph,sizes,{composition});
  assert.equal(p.get('worker').y,p.get('entry').y);assert.equal(p.get('store').x,p.get('worker').x);
  const moved=layoutGraph(graph,sizes,{composition,offsets:{worker:{x:20,y:10}}});
  assert.equal(moved.get('worker').x,p.get('worker').x+20);assert.equal(moved.get('worker').y,p.get('worker').y+10);
  assert.deepEqual(graph,before);assert.equal(composition.positions.worker.col,1);
});
test('unplaced new nodes stay visible without moving existing authored placements', () => {
  const nodes=[{id:'a'},{id:'b'},{id:'new'}],sizes=new Map(nodes.map(n=>[n.id,{w:200,h:100}]));
  const composition={id:'reading',positions:{a:{col:0,row:0},b:{col:1,row:0}}};
  const old=layoutGraph({nodes:nodes.slice(0,2),edges:[]},sizes,{composition});
  const p=layoutGraph({nodes,edges:[]},sizes,{composition});
  assert.equal(p.size,3);assert.deepEqual(p.get('a'),old.get('a'));assert.deepEqual(p.get('b'),old.get('b'));
  assert.ok(p.get('new').y>=p.get('a').y+100);
});
test('invalid authored geometry falls back and does not inject non-finite coordinates or routes', () => {
  for(const positions of [{a:{col:NaN,row:0}},{a:{col:-1,row:0}},{a:{col:0,row:0},b:{col:0,row:0}}])assert.equal(readComposition({id:'bad',positions}),null);
  const graph={nodes:[{id:'a'},{id:'b'}],edges:[]},sizes=new Map(graph.nodes.map(n=>[n.id,{w:200,h:100}]));
  assert.deepEqual(layoutGraph(graph,sizes,{composition:{id:'bad',positions:{a:{col:Infinity,row:0}}}}),layoutGraph(graph,sizes));
  const clean=readComposition({id:'valid',positions:{a:{col:0,row:0}},routes:{edge:{fromSide:'invalid',toSide:'top',corridor:'above',script:'no'}}});
  assert.deepEqual(clean.routes.edge,{toSide:'top',corridor:'above'});
});
test('return corridor hints preserve directions and avoid the main-path card', () => {
  const boxes=new Map([['a',{x:110,y:110,w:200,h:100}],['middle',{x:470,y:110,w:200,h:100}],['b',{x:830,y:110,w:200,h:100}]]);
  const routes=routeGraph(boxes,[{from:'b',to:'a'}],{'["b","a"]':{fromSide:'top',toSide:'top',corridor:'above'}});
  assert.deepEqual(routes[0].points[0],{x:930,y:110});assert.deepEqual(routes[0].points.at(-1),{x:210,y:110});
  assert.ok(routes[0].points.some(p=>p.y===38));assert.deepEqual(reviewGraphLayout(boxes,routes).routeBlockers,[]);
});
test('layout review catches card overlap, route obstruction and bends touching another route', () => {
  const boxes=new Map([['a',{x:20,y:20,w:100,h:100}],['b',{x:80,y:80,w:100,h:100}]]);
  const routes=[{points:[{x:0,y:60},{x:200,y:60}]},{points:[{x:150,y:0},{x:150,y:60},{x:170,y:60}]}];
  const issues=reviewGraphLayout(boxes,routes);
  assert.deepEqual(issues.cardOverlaps,[['a','b']]);assert.ok(issues.routeBlockers.some(item=>item.route===0&&item.node==='a'));
  assert.ok(issues.crossings.some(item=>item.x===150&&item.y===60));
});
test('composition-scoped drag preferences do not invalidate existing automatic or SOP keys', async () => {
  const source=await fs.readFile(new URL('../prototype/workbench-app.js',import.meta.url),'utf8');
  const start=source.indexOf('function graphPositionKey(){'),end=source.indexOf('\nfunction syncGraphControls',start);
  const context=vm.createContext({viewRootId:'root',layoutDir:'lr',isPhoneLayout:()=>false,graphPresentation:()=>({mode:'sop'}),graphComposition:()=>null,graphReadingProfile:()=>({portrait:false})});
  vm.runInContext(source.slice(start,end),context);
  assert.equal(vm.runInContext('graphPositionKey()',context),JSON.stringify(['reading-slice-v2','root','sop','lr',false]));
  context.graphPresentation=()=>({mode:'architecture'});context.graphComposition=()=>({id:'authored-v1'});
  assert.equal(vm.runInContext('graphPositionKey()',context),JSON.stringify(['reading-slice-v2','root','architecture','lr',false,'authored-v1']));
});

test('portrait reading follows necessary directed relations, wraps peers and leaves canonical and authored geometry intact',()=>{
  const graph={nodes:['entry','gateway','agent','channel','state','isolated'].map(id=>({id})),edges:[['entry','gateway'],['gateway','agent'],['agent','channel'],['agent','state']].map(([from,to])=>({from,to}))};
  const base=readComposition({id:'wide',positions:{entry:{col:3,row:0}},reading:{overview:graph.edges.map(e=>[e.from,e.to])},routes:{}}),before=JSON.stringify({graph,base});
  const two=portraitComposition(graph,base,{columns:2});
  assert.ok(two.positions.entry.row<two.positions.gateway.row&&two.positions.gateway.row<two.positions.agent.row);
  assert.equal(two.positions.channel.row,two.positions.state.row);assert.notEqual(two.positions.channel.col,two.positions.state.col);
  assert.ok(two.positions.isolated.row>two.positions.state.row);assert.deepEqual(Object.keys(two.routes),[]);
  const one=portraitComposition(graph,base,{columns:1});assert.equal(new Set(Object.values(one.positions).map(p=>p.row)).size,6);
  assert.equal(JSON.stringify({graph,base}),before);
});
test('responsive reading uses the available canvas shape with bounded columns, including invalid and wide inputs',()=>{
  assert.deepEqual(readingViewport({width:390,height:662}),{portrait:true,columns:1,key:'portrait-1'});
  assert.deepEqual(readingViewport({width:828,height:1096}),{portrait:true,columns:2,key:'portrait-2'});
  assert.equal(readingViewport({width:1208,height:796}).portrait,false);
  assert.equal(readingViewport({width:0,height:900}).portrait,false);assert.equal(readingViewport({width:NaN,height:900}).portrait,false);
});
