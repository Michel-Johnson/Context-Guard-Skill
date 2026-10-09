import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenclawMap, openclawSource } from './helpers/openclaw-map.mjs';
import { projectGraph, layoutGraph } from '../prototype/map-graph-view.mjs';
const allNodes=root=>[root,...root.children.flatMap(allNodes)];
test('OpenClaw mock has four real storage levels, five domains and explicit fictional work items',()=>{
  const map=createOpenclawMap(),nodes=allNodes(map.root);
  const depth=n=>1+Math.max(0,...n.children.map(depth));
  assert.equal(depth(map.root),4);assert.equal(nodes.length,32);assert.equal(map.root.children.length,5);
  assert.equal(new Set(nodes.map(n=>n.id)).size,32);assert.equal(map.flows.length,29);
  assert.match(map.root.memoryDocument,/人工抽象/);assert.match(map.root.memoryDocument,/所有 TODO\/Bug 均虚构/);
  assert.equal(openclawSource.commit,'594335a38e5acc60d75b44d98a3d2f5331958f66');
  for(const node of nodes){for(const item of [...node.todos,...node.bugs])assert.match(item.title,/^示例：/);assert.ok(node.memoryDocument.includes('这是 UI Mock'));}
  assert.equal(nodes.find(n=>n.id==='WEBSOCKET').owns[0],'src/gateway/server/ws-connection.ts');
});
test('OpenClaw cross-layer, join, return and self-loop flows project without rewriting the hierarchy',()=>{
  const map=createOpenclawMap(),before=structuredClone(map),graph=projectGraph(map.root,map.flows);
  assert.equal(graph.nodes.length,31);assert.equal(graph.edges.length,29);
  assert.ok(graph.edges.some(e=>e.from==='CONTROL-API'&&e.to==='WEBSOCKET'));
  assert.ok(graph.edges.some(e=>e.from==='RECOVERY'&&e.to==='RUNNER'));
  assert.ok(graph.edges.some(e=>e.from==='WEBSOCKET'&&e.to==='WEBSOCKET'));
  const sizes=new Map(graph.nodes.map(n=>[n.id,{w:230,h:110}]));
  for(const mode of ['architecture','sop'])for(const direction of ['lr','tb']){
    const positions=layoutGraph(graph,sizes,{mode,direction});assert.equal(positions.size,31);
    for(const p of positions.values())assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));
  }
  assert.deepEqual(map,before);
});
test('OpenClaw fixtures are fresh and do not leak edited nodes or work items across tests',()=>{
  const one=createOpenclawMap(),two=createOpenclawMap();
  one.root.children[1].children[0].children[0].bugs[0].title='changed';one.flows.pop();
  assert.equal(two.flows.length,29);assert.equal(allNodes(two.root).find(n=>n.id==='WEBSOCKET').bugs[0].title,'示例：断线后重复消息');
});
