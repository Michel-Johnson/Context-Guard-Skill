import test from 'node:test';
import assert from 'node:assert/strict';
import { projectGraph, flowRanks, layoutGraph, graphCurve, readPresentation } from '../prototype/map-graph-view.mjs';
const node = (id, children=[]) => ({id,title:id,kind:'module',children});
const sizes = nodes => new Map(nodes.map(n=>[n.id,{w:200,h:80}]));
const edge = (from,to,label='') => ({from,to,label});
test('projection keeps canonical identity and explicit flows without fabricating parent links',()=>{
  const a=node('A',[node('B')]), hidden={...node('X'),proposal:'cancelled'}, doc=node('root',[a,hidden]);
  const flows=[edge('A','B'),edge('A','X'),edge('B','missing')], original=structuredClone({doc,flows});
  const graph=projectGraph(doc,flows);
  assert.deepEqual(graph.nodes.map(n=>n.id),['A','B']);assert.equal(graph.nodes[0],a);
  assert.deepEqual(graph.edges,[flows[0]]);assert.deepEqual({doc,flows},original);
});
test('root participating in an explicit relation is a peer, not silently removed',()=>{
  const root=node('root',[node('A')]);assert.equal(projectGraph(root,[edge('root','A')]).edges.length,1);
  assert.deepEqual(projectGraph(root,[]).nodes.map(n=>n.id),['A']);
});
test('empty project, inbox, duplicate references and cancelled subtree remain bounded',()=>{
  assert.deepEqual(projectGraph(null),{nodes:[],edges:[]});
  const a=node('A');const root={...node('root',[a,a,{...node('X',[node('Y')]),proposal:'cancelled'}]),_inbox:[node('B')]};
  assert.deepEqual(projectGraph(root).nodes.map(n=>n.id),['A','B']);
  assert.deepEqual(projectGraph(node('root')).nodes.map(n=>n.id),['root']);
});
test('architecture is independent of storage parent grouping and insertion order',()=>{
  const one=projectGraph(node('root',[node('A',[node('B')]),node('C')]));
  const two=projectGraph(node('root',[node('B'),node('C',[node('A')])]));
  assert.deepEqual(layoutGraph(one,sizes(one.nodes)),layoutGraph(two,sizes(two.nodes)));
});
test('SOP ranks follow explicit direction, branch in parallel and join after both branches',()=>{
  const nodes=['A','B','C','D','E'].map(id=>node(id));
  const ranks=flowRanks(nodes,[edge('A','B'),edge('B','C'),edge('B','D'),edge('C','E'),edge('D','E')]);
  assert.deepEqual([...ranks.values()],[0,1,2,2,3]);
});
test('cycles, self-loops, disconnected nodes and dangling inputs terminate without dropping edges',()=>{
  const nodes=['A','B','C','D'].map(id=>node(id));const edges=[edge('A','B'),edge('B','C'),edge('C','B'),edge('C','C'),edge('missing','A')];
  const ranks=flowRanks(nodes,edges);assert.deepEqual([...ranks.values()],[0,1,2,0]);assert.equal(edges.length,5);
});
for(const mode of ['architecture','sop']) for(const direction of ['lr','tb']) test(`${mode} ${direction} layout fits distinct measured boxes`,()=>{
  const nodes=['A','B','C','D','E'].map(id=>node(id));const graph={nodes,edges:[edge('A','B'),edge('B','C'),edge('B','D'),edge('C','E'),edge('D','E')]};
  const measured=sizes(nodes);measured.set('C',{w:300,h:160});const positions=layoutGraph(graph,measured,{mode,direction});
  for(const [id,p] of positions)for(const [other,q]of positions){if(id>=other)continue;const a=measured.get(id),b=measured.get(other);assert.ok(p.x+a.w<=q.x||q.x+b.w<=p.x||p.y+a.h<=q.y||q.y+b.h<=p.y,`${id}/${other} overlap`);}
});
test('phone architecture reflows into one readable column',()=>{
  const graph={nodes:['A','B','C'].map(id=>node(id)),edges:[]},positions=layoutGraph(graph,sizes(graph.nodes),{phone:true});
  assert.equal(new Set([...positions.values()].map(p=>p.x)).size,1);assert.equal(new Set([...positions.values()].map(p=>p.y)).size,3);
});
test('valid offsets affect presentation only; invalid/corrupt coordinates cannot poison layout',()=>{
  const graph={nodes:[node('A'),node('B')],edges:[]};const before=JSON.stringify(graph);
  const positions=layoutGraph(graph,sizes(graph.nodes),{offsets:{A:{x:20,y:40},B:{x:Infinity,y:0}}});
  assert.deepEqual(positions.get('A'),{x:130,y:150});assert.ok(Number.isFinite(positions.get('B').x));assert.equal(JSON.stringify(graph),before);
});
test('presentation preferences are scoped by supplied key and tolerate denied/corrupt storage',()=>{
  const saved=JSON.stringify({v:1,mode:'sop',offsets:{view:{A:{x:8,y:12},B:{x:'bad',y:0}}}}),storage={getItem:key=>key==='project/session-one'?saved:null};
  assert.equal(readPresentation(storage,'project/session-one').mode,'sop');assert.equal(readPresentation(storage,'project/session-two').mode,'tree');
  assert.deepEqual(readPresentation(storage,'project/session-one').offsets.view,{A:{x:8,y:12}});
  assert.equal(readPresentation({getItem:()=>'{broken'},'x','architecture').mode,'architecture');
  assert.equal(readPresentation({getItem:()=>{throw Error('denied');}},'x').mode,'tree');
});
test('self-loop, reverse direction and parallel edges have distinct finite curves',()=>{
  const a={x:110,y:110,w:200,h:80},b={x:480,y:110,w:200,h:80};
  assert.match(graphCurve(a,a).d,/ C/);assert.notEqual(graphCurve(a,b).d,graphCurve(b,a).d);
  assert.notEqual(graphCurve(a,b,0).d,graphCurve(a,b,1).d);
  for(const result of [graphCurve(a,a),graphCurve(a,b),graphCurve(b,a)])assert.ok(Number.isFinite(result.label.x)&&Number.isFinite(result.label.y));
});
