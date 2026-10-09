import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const appSource=()=>fs.readFile(new URL('../prototype/workbench-app.js',import.meta.url),'utf8');
function extract(source,startMarker,endMarker){const start=source.indexOf(startMarker),end=source.indexOf(endMarker,start);assert.ok(start>=0&&end>start,`actual implementation ${startMarker}`);return source.slice(start,end);}
function chrome(){
  const elements={},bodyClasses=new Set();
  const get=id=>elements[id] ||= {id,attrs:{},classes:new Set(),children:[],hidden:false,onclick:null,focus(){this.focused=true;},setAttribute(k,v){this.attrs[k]=v;},append(...nodes){for(const node of nodes){if(node.parent)node.parent.children.splice(node.parent.children.indexOf(node),1);this.children.push(node);node.parent=this;}}};
  for(const id of ['btn-beta-map','workbench-tools','beta-map-settings','lens-toggle','workbench-tools-menu','settings-tools','dir-toggle','beta-direction-slot','rel-toggle','rel-hint','beta-relation-slot','btn-auth','btn-bugs','btn-todos','btn-device-approvals']){
    const element=get(id);element.classList={toggle:(name,on)=>on?element.classes.add(name):element.classes.delete(name)};
  }
  const authLabel={hidden:false};return {elements,get,authLabel,bodyClasses,document:{getElementById:get,querySelector:()=>authLabel,body:{classList:{toggle:(name,on)=>on?bodyClasses.add(name):bodyClasses.delete(name)}},activeElement:null}};
}

test('Map Beta defaults off and storage denial or old presentation state cannot opt a browser in',async()=>{
  const source=await appSource(),code=extract(source,'function readStoredMapBeta(){','function syncMapBetaChrome(){');
  for(const value of [null,undefined,'','0','true','architecture','{"mode":"architecture"}','1']){
    const calls=[],ctx=vm.createContext({MAP_UI_BETA_KEY:'cg-workbench-map-beta-v1',localStorage:{getItem:key=>{calls.push(key);return value;}},location:{search:'?mapView=architecture&beta=1'}});vm.runInContext(code,ctx);
    assert.equal(ctx.readStoredMapBeta(),value==='1');assert.deepEqual(calls,['cg-workbench-map-beta-v1'],'old mapView URL and graph preference keys are not opt-in authority');
  }
  const ctx=vm.createContext({MAP_UI_BETA_KEY:'cg-workbench-map-beta-v1',localStorage:{getItem(){throw Error('storage blocked');}}});vm.runInContext(code,ctx);assert.equal(ctx.readStoredMapBeta(),false);
});

test('Beta graph cannot be enabled by old mapView URL or saved graph mode while stable mode is selected',async()=>{
  const source=await appSource(),code=extract(source,'function graphViewActive(){','function restoreGraphReadingRoot(){');let reads=0;
  const ctx=vm.createContext({mapBetaEnabled:false,graphViewApi:{},graphPresentation:()=>{reads++;return {mode:'architecture',offsets:{saved:{a:{x:1,y:2}}}};},lensMode:false,bugPathMode:false,window:{__CG_SERVER:{root:'cloud:project'}},location:{search:'?mapView=architecture'}});vm.runInContext(code,ctx);
  assert.equal(ctx.graphViewActive(),false);assert.equal(reads,0,'disabled Beta does not even read mutable graph preferences');
  ctx.mapBetaEnabled=true;assert.equal(ctx.graphViewActive(),true);assert.equal(reads,1);
  for(const patch of [{lensMode:true},{lensMode:false,bugPathMode:true}]){Object.assign(ctx,patch);assert.equal(ctx.graphViewActive(),false);}
  ctx.bugPathMode=false;ctx.window.__CG_SERVER.root='cloud:overview';assert.equal(ctx.graphViewActive(),false);ctx.window.__CG_SERVER.root='cloud:project';ctx.graphViewApi=null;assert.equal(ctx.graphViewActive(),false);
});

test('actual Beta chrome moves the same stable controls without replacing their handlers, with accurate switch ARIA',async()=>{
  const source=await appSource(),code=extract(source,'function syncMapBetaChrome(){','function setMapBeta(enabled){'),dom=chrome(),before={};
  for(const id of ['dir-toggle','rel-toggle','btn-auth','btn-bugs','btn-todos','btn-device-approvals']){before[id]=dom.get(id);before[id].onclick=()=>id;}
  const ctx=vm.createContext({document:dom.document,mapBetaEnabled:false});vm.runInContext(code,ctx);ctx.syncMapBetaChrome();
  assert.equal(dom.elements['workbench-tools'].hidden,false);assert.equal(dom.elements['beta-map-settings'].hidden,true);assert.equal(dom.elements['lens-toggle'].hidden,false);assert.equal(dom.elements['btn-beta-map'].attrs['aria-checked'],'false');
  for(const id of Object.keys(before))assert.equal(dom.elements[id].parent,dom.elements['workbench-tools-menu']);
  ctx.mapBetaEnabled=true;ctx.syncMapBetaChrome();assert.equal(dom.elements['workbench-tools'].hidden,true);assert.equal(dom.elements['beta-map-settings'].hidden,false);assert.equal(dom.elements['lens-toggle'].hidden,true);assert.equal(dom.elements['btn-beta-map'].attrs['aria-checked'],'true');assert.equal(dom.bodyClasses.has('map-beta'),true);
  assert.equal(dom.elements['dir-toggle'].parent,dom.elements['beta-direction-slot']);assert.equal(dom.elements['rel-toggle'].parent,dom.elements['beta-relation-slot']);
  for(const id of ['btn-auth','btn-bugs','btn-todos','btn-device-approvals'])assert.equal(dom.elements[id].parent,dom.elements['settings-tools']);
  ctx.mapBetaEnabled=false;ctx.syncMapBetaChrome();for(const [id,control]of Object.entries(before)){assert.equal(dom.elements[id],control);assert.equal(control.onclick(),id);assert.equal(control.parent,dom.elements['workbench-tools-menu']);}assert.equal(dom.authLabel.hidden,true);
});

test('native bilingual Beta switch saves only its own presentation opt-in and returns keyboard focus without Map or permission writes',async()=>{
  const source=await appSource(),html=await fs.readFile(new URL('../prototype/workbench.html',import.meta.url),'utf8'),dom=chrome(),stored=[],draws=[],map={id:'root',owns:['owned'],flows:[],permissions:{role:'human'}},before=structuredClone(map);
  const ctx=vm.createContext({mapBetaEnabled:false,MAP_UI_BETA_KEY:'cg-workbench-map-beta-v1',relationDraft:null,composingId:null,workbenchSync:{composing:false},lensMode:false,selectedRouteKey:'old',document:dom.document,
    localStorage:{setItem:(key,value)=>stored.push([key,value])},syncMapBetaChrome:()=>draws.push('chrome'),refreshMapTranslationDisplay:()=>draws.push('translation-display'),renderAll:()=>draws.push('render'),fitView:()=>draws.push('fit'),clearRelationMode:()=>draws.push('clear-relation'),exitLensMode:()=>assert.fail('inactive lens must not change'),
    persist:()=>assert.fail('Beta toggle is not a Map write'),scheduleMapWrite:()=>assert.fail('Beta toggle is not a Map write')});
  vm.runInContext(extract(source,'function setMapBeta(enabled){','const THEME_IDS'),ctx);const binding=source.split('\n').find(line=>line.includes("document.getElementById('btn-beta-map').onclick="));assert.ok(binding);vm.runInContext(binding,ctx);
  dom.elements['btn-beta-map'].onclick();assert.equal(ctx.mapBetaEnabled,true);assert.equal(ctx.selectedRouteKey,null);assert.equal(dom.elements['btn-beta-map'].focused,true);dom.elements['btn-beta-map'].onclick();assert.equal(ctx.mapBetaEnabled,false);assert.deepEqual(stored,[['cg-workbench-map-beta-v1','1'],['cg-workbench-map-beta-v1','0']]);assert.deepEqual(map,before);
  assert.match(html,/<button type="button"[^>]*id="btn-beta-map"[^>]*role="switch"[^>]*aria-checked="false"/,'native button supplies Enter/Space rather than bespoke keyboard handlers');
  assert.match(source,/betaMap:"新版 Map（Beta）"/);assert.match(source,/betaMap:"New Map \(Beta\)"/);assert.equal((html.match(/id="btn-beta-map"/g)||[]).length,1);
});

test('closing Beta refuses relation, compose, IME and unsubmitted input drafts without clearing local text or saving opt-out',async()=>{
  const source=await appSource(),code=extract(source,'function setMapBeta(enabled){','const THEME_IDS');
  for(const kind of ['relation','compose','ime','input-draft']){
    const stored=[],draws=[],draft={text:'未提交原文'},sync={composing:kind==='ime',inputDraft:kind==='input-draft'?draft:null,status:'draft',setStatus:()=>draws.push('status')},ctx=vm.createContext({mapBetaEnabled:true,MAP_UI_BETA_KEY:'cg-workbench-map-beta-v1',relationDraft:kind==='relation'?{label:'未保存关系'}:null,composingId:kind==='compose'?'new-node':null,workbenchSync:sync,lensMode:false,selectedRouteKey:null,
      localStorage:{setItem:(key,value)=>stored.push([key,value])},t:key=>key,document:{activeElement:null,getElementById:()=>({focus(){}})},syncMapBetaChrome:()=>draws.push('chrome'),refreshMapTranslationDisplay:()=>draws.push('translation'),renderAll:()=>draws.push('render'),fitView:()=>draws.push('fit'),clearRelationMode:()=>draws.push('clear')});
    vm.runInContext(code,ctx);assert.equal(ctx.setMapBeta(false),false,`${kind} must not be replaced by stable layout before it is resolved`);assert.equal(ctx.mapBetaEnabled,true);assert.deepEqual(stored,[]);assert.deepEqual(draws,['status']);assert.equal(draft.text,'未提交原文');
  }
});

test('stable or disabled Beta view never requests translations, reads translation cache or redraws due to an old completion',async()=>{
  const source=await appSource(),tasks=[],notice={querySelector:selector=>selector==='span'?span:button},span={},button={},ctx=vm.createContext({mapBetaEnabled:false,uiLang:'en',mapTranslationRedraw:false,mapTranslationTexts:[],mapTranslationClient:{ensure:()=>assert.fail('stable view must not request translations'),read:()=>assert.fail('stable view must not read translated node fields'),status:()=> 'loading'},
    document:{getElementById:()=>notice,activeElement:null},window:{},data:{title:'Project'},queueMicrotask:fn=>tasks.push(fn),getNode:()=>assert.fail('stable view must not collect Map source'),findPath:()=>assert.fail('stable view must not collect Map source'),t:key=>key,
    renderMap:()=>assert.fail('old completion cannot replace stable Map'),renderNav:()=>assert.fail('old completion cannot replace stable nav'),renderDetail:()=>assert.fail('old completion cannot replace stable detail')});
  vm.runInContext(extract(source,'function nodeDisplayField(','function graphGroupCaption')+extract(source,'function refreshMapTranslationDisplay(){','let refreshDeviceApprovals'),ctx);
  ctx.ensureMapTranslations([{title:'原节点'}],['原关系']);assert.equal(ctx.nodeDisplayField({id:'n',title:'原节点'},'title'),'原节点');assert.equal(ctx.mapDisplayText('原关系'),'原关系');ctx.refreshMapTranslationDisplay();tasks.shift()();assert.equal(notice.hidden,true);assert.equal(button.hidden,true);
});

test('stable zoom-return helper retains its previous parent navigation but Beta cannot arm or enqueue that navigation',async()=>{
  const source=await appSource(),start=source.indexOf('function armDrillReturn(){'),end=source.indexOf('\nif(worldEl &&',start);assert.ok(start>=0&&end>start);
  const jobs=new Map(),navigated=[],ctx=vm.createContext({mapBetaEnabled:false,mapTransitioning:false,viewRootId:'child',view:{k:1},MAP_RETURN_RATIO:.72,drillReturnAt:null,wheelReturnTimer:null,findPath:()=>[{id:'root'},{id:'child'}],
    setTimeout:fn=>{jobs.set(1,fn);return 1;},clearTimeout:id=>jobs.delete(id),enterView:(id,options)=>navigated.push({id,unpack:options.unpack})});vm.runInContext(source.slice(start,end),ctx);ctx.armDrillReturn();assert.equal(ctx.drillReturnAt,.72);ctx.view.k=.2;ctx.scheduleZoomReturn();assert.equal(jobs.size,1);jobs.get(1)();assert.deepEqual(navigated,[{id:'root',unpack:false}]);
  ctx.mapBetaEnabled=true;ctx.armDrillReturn();assert.equal(ctx.drillReturnAt,null);assert.equal(jobs.size,0);ctx.scheduleZoomReturn();ctx.returnToParent();assert.equal(jobs.size,0);assert.equal(navigated.length,1,'Beta cannot execute even a legacy parent-return callback');
});

test('opening the actual device approval dialog closes the stable tools so it can be reopened after dismissal',async()=>{
  const source=await appSource(),start=source.indexOf('function installDeviceApprovals(sync){'),line=source.slice(start).split('\n').find(row=>row.trim().startsWith('trigger.onclick='));
  assert.ok(line);
  for(const enabled of [false,true]){
    const toolbar={open:true},trigger={setAttribute:(name,value)=>{trigger[name]=value;}},panel={showModal(){this.open=true;}},status={textContent:'old'},close={focus(){this.focused=true;}},closed=[];
    const ctx=vm.createContext({mapBetaEnabled:enabled,trigger,panel,status,document:{getElementById:id=>id==='workbench-tools'?toolbar:close},closeTray:()=>closed.push('tray'),closeSettings:()=>closed.push('settings'),refresh:()=>{},persist:()=>assert.fail('opening a dialog cannot mutate Map')});
    vm.runInContext(line,ctx);trigger.onclick();
    assert.equal(toolbar.open,false,'the next tools click must expand rather than hide the trigger');
    assert.equal(panel.open,true);assert.equal(close.focused,true);assert.equal(trigger['aria-expanded'],'true');assert.deepEqual(closed,['tray','settings']);
  }
});

test('actual Bug and TODO panel toggles close the stable disclosure without changing Map or stealing subsequent clicks',async()=>{
  const source=await appSource(),code=extract(source,'function toggleWorkPanel(kind){','function renderTray(){');
  for(const enabled of [false,true])for(const kind of ['bug','todo']){
    const toolbar={open:true,removeAttribute(name){if(name==='open')this.open=false;}},calls=[];
    const ctx=vm.createContext({mapBetaEnabled:enabled,document:{getElementById:()=>toolbar,body:{classList:{contains:()=>false}}},bugPathMode:false,activeWorkPanelKind:'bug',closeSettings:()=>calls.push('settings'),openBugPanel:(open,type)=>calls.push([open,type]),renderBugPanel:()=>{},fitView:()=>{},persist:()=>assert.fail('panel selection is presentation only')});
    vm.runInContext(code,ctx);ctx.toggleWorkPanel(kind);assert.equal(toolbar.open,false,'next disclosure click must reopen its tools');assert.deepEqual(calls,['settings',[true,kind]]);
  }
});

test('stable repository linking preserves its original picker-then-close order and Beta cannot invoke it',async()=>{
  const source=await appSource(),code=extract(source,'document.getElementById("btn-link-repo").onclick','document.getElementById("first-use-empty")'),button={},calls=[];
  const ctx=vm.createContext({mapBetaEnabled:false,document:{getElementById:()=>button},closeSettings:()=>calls.push('settings'),linkRepo:async()=>calls.push('picker')});
  vm.runInContext(code,ctx);await button.onclick();assert.deepEqual(calls,['picker','settings']);ctx.mapBetaEnabled=true;calls.length=0;await button.onclick();assert.deepEqual(calls,[],'Beta never invokes the obsolete linking flow');
});
