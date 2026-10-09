// Presentation only: canonical nodes, permissions and work-item files stay in
// the existing Map. Flows never grant access or imply an executable workflow.
const compare = (a, b) => String(a.id).localeCompare(String(b.id), 'en');
// Human-authored relations reference canonical nodes, never presentation bundles
// or pending inbox proposals. Reading a relation does not authorize its endpoint.
export function relationChoices(root) {
  const result = [], seen = new Set(), stack = root ? [[root, []]] : [];
  while (stack.length) {
    const [node, parents] = stack.pop();
    if (!node || seen.has(node.id) || ['cancelled', 'proposed'].includes(node.proposal)) continue;
    seen.add(node.id);
    const path = [...parents, node.title || node.id];
    result.push({ id: node.id, path: path.join(' / ') });
    for (const child of [...(node.children || [])].reverse()) stack.push([child, path]);
  }
  return result;
}
export function makeRelation(root, flows, { from, to, label, id }) {
  const ids = new Set(relationChoices(root).map(node => node.id));
  if (!ids.has(from) || !ids.has(to)) throw new Error('RELATION_ENDPOINT');
  if (typeof label !== 'string' || label.trim().length > 160 || typeof id !== 'string' || !id) throw new Error('RELATION_INPUT');
  const meaning = label.trim();
  if (flows.some(flow => flow?.from === from && flow?.to === to && String(flow.label || '').trim() === meaning)) throw new Error('RELATION_DUPLICATE');
  if (flows.some(flow => flow?.id === id)) throw new Error('RELATION_ID');
  return { id, from, to, label: meaning };
}
export function projectGraph(root, flows = []) {
  const byId = new Map(), stack = root ? [root] : [];
  while (stack.length) {
    const node = stack.pop();
    if (!node || node.proposal === 'cancelled' || byId.has(node.id)) continue;
    byId.set(node.id, node);
    stack.push(...(node.children || []), ...(node._inbox || []));
  }
  // The project/group title remains in navigation, not a mandatory hub.
  if (byId.size > 1 && !flows.some(edge => edge?.from === root.id || edge?.to === root.id)) byId.delete(root.id);
  const nodes = [...byId.values()].sort(compare);
  const edges = flows.filter(edge => edge && byId.has(edge.from) && byId.has(edge.to));
  return { nodes, edges };
}

// A reading slice, not a new ownership model. All cards remain the original
// objects; bundled edges retain their exact source relations for inspection.
export function projectArchitecture(root, flows = [], scope = root) {
  if (!root || !scope) return { nodes: [], edges: [], groups: new Map(), context: new Set() };
  const byId = new Map(), paths = new Map(), stack = [[root, []]];
  while (stack.length) {
    const [node, parents] = stack.pop();
    if (!node || node.proposal === 'cancelled' || byId.has(node.id)) continue;
    byId.set(node.id, node); paths.set(node.id, [...parents, node.id]);
    for (const child of [...(node.children || []), ...(node._inbox || [])].reverse()) stack.push([child, paths.get(node.id)]);
  }
  if (!byId.has(scope.id)) return { nodes: [], edges: [], groups: new Map(), context: new Set() };
  const scopePath = paths.get(scope.id), inside = id => paths.get(id)?.includes(scope.id);
  const children = [...(scope.children || []), ...(scope._inbox || [])].filter(node => byId.has(node.id));
  const visible = new Map(children.map(node => [node.id, node])), groups = new Map(), context = new Set();
  if (!children.length) visible.set(scope.id, scope);
  function representative(id) {
    const path = paths.get(id);
    if (inside(id)) return id === scope.id || !children.length ? scope.id : path[scopePath.length];
    let common = 0;
    while (path[common] === scopePath[common] && common < Math.min(path.length, scopePath.length)) common++;
    return path[Math.min(common, path.length - 1)];
  }
  const bundles = new Map();
  for (const source of flows) {
    if (!source || !byId.has(source.from) || !byId.has(source.to) || (!inside(source.from) && !inside(source.to))) continue;
    const from = representative(source.from), to = representative(source.to);
    // A collapsed internal relation is not a fabricated self-loop.
    if (from === to && !(source.from === from && source.to === to)) continue;
    for (const id of [from, to]) { visible.set(id, byId.get(id)); if (!inside(id)) context.add(id); }
    const key = JSON.stringify([from, to]);
    if (!bundles.has(key)) bundles.set(key, { from, to, sources: [] });
    bundles.get(key).sources.push(source);
  }
  for (const id of visible.keys()) {
    const descendants = [...byId.values()].filter(node => node.id !== id && paths.get(node.id).includes(id));
    groups.set(id, { count: descendants.length, context: context.has(id), scope: id === scope.id });
  }
  const edges = [...bundles.values()].map(edge => ({ ...edge,
    label: [...new Set(edge.sources.map(source => typeof source.label === 'string' ? source.label.trim() : '').filter(Boolean))].join(' · '),
    detail: edge.sources.map(source => `${byId.get(source.from).title} → ${byId.get(source.to).title}${source.label ? '：' + source.label : ''}`).join('\n'),
  }));
  return { nodes: [...visible.values()], edges, groups, context };
}

// Remove DFS back-edges only from the layout's DAG; render every original edge.
// Iterative traversal handles cycles, self-loops and large disconnected graphs.
export function flowRanks(nodes, edges) {
  const ids = nodes.map(node => node.id), outgoing = new Map(ids.map(id => [id, []]));
  const incoming = new Map(ids.map(id => [id, 0]));
  edges.forEach((edge, index) => {
    if (!outgoing.has(edge.from) || !outgoing.has(edge.to)) return;
    outgoing.get(edge.from).push({ id: edge.to, index });
    incoming.set(edge.to, incoming.get(edge.to) + 1);
  });
  const colors = new Map(), back = new Set();
  for (const start of [...ids.filter(id => !incoming.get(id)), ...ids]) {
    if (colors.has(start)) continue;
    colors.set(start, 1);
    const stack = [{ id: start, index: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1], next = outgoing.get(frame.id)[frame.index++];
      if (!next) { colors.set(frame.id, 2); stack.pop(); continue; }
      if (colors.get(next.id) === 1) back.add(next.index);
      else if (!colors.has(next.id)) { colors.set(next.id, 1); stack.push({ id: next.id, index: 0 }); }
    }
  }
  const degrees = new Map(ids.map(id => [id, 0])), ranks = new Map(ids.map(id => [id, 0]));
  edges.forEach((edge, index) => { if (!back.has(index) && degrees.has(edge.to) && degrees.has(edge.from)) degrees.set(edge.to, degrees.get(edge.to) + 1); });
  const queue = ids.filter(id => !degrees.get(id));
  for (let i = 0; i < queue.length; i++) for (const next of outgoing.get(queue[i])) {
    if (back.has(next.index)) continue;
    ranks.set(next.id, Math.max(ranks.get(next.id), ranks.get(queue[i]) + 1));
    degrees.set(next.id, degrees.get(next.id) - 1);
    if (!degrees.get(next.id)) queue.push(next.id);
  }
  return ranks;
}

// Authored display geometry is separate from canonical nodes and relations.
// Unplaced nodes remain visible; invalid compositions fall back to normal layout.
export function readComposition(value) {
  if (!value || typeof value.id !== 'string' || !value.id || !value.positions || typeof value.positions !== 'object' || Array.isArray(value.positions)) return null;
  const positions = Object.create(null), occupied = new Set();
  for (const [id, point] of Object.entries(value.positions)) {
    if (!point || ![point.col, point.row].every(n => Number.isFinite(n) && n >= 0 && n <= 100)) return null;
    const key=JSON.stringify([point.col,point.row]);if(occupied.has(key))return null;
    occupied.add(key);positions[id]={col:point.col,row:point.row};
  }
  const routes=Object.create(null), sides=['left','right','top','bottom'];
  for(const [key,hint] of Object.entries(value.routes||{})){
    if(!hint || typeof hint!=='object')continue;
    routes[key]={};
    for(const field of ['fromSide','toSide'])if(sides.includes(hint[field]))routes[key][field]=hint[field];
    if(['above','below'].includes(hint.corridor))routes[key].corridor=hint.corridor;
  }
  const labels=Object.create(null);
  for(const [key,label] of Object.entries(value.labels||{}))if(typeof label==='string' && label.trim() && label.trim().length<=80)labels[key]=label.trim();
  const reading={};
  for(const field of ['overview','primary'])if(Array.isArray(value.reading?.[field]))reading[field]=value.reading[field].slice(0,10000).filter(pair=>Array.isArray(pair)&&pair.length===2&&pair.every(id=>typeof id==='string'&&id.length>0&&id.length<=200)).map(pair=>[...pair]);
  reading.labels=Object.fromEntries(Object.entries(value.reading?.labels||{}).filter(([,label])=>typeof label==='string'&&label.trim()&&label.trim().length<=80).map(([key,label])=>[key,label.trim()]));
  return {id:value.id.slice(0,100),positions,routes,labels,reading,
    gapX:Number.isFinite(value.gapX)?Math.max(110,Math.min(400,value.gapX)):150,
    gapY:Number.isFinite(value.gapY)?Math.max(88,Math.min(400,value.gapY)):110};
}

export function readingViewport({width, height} = {}) {
  const portrait=Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0&&(width<620||height>=width*.9);
  const columns=portrait?(width>=720?2:1):3;
  return {portrait,columns,key:portrait?`portrait-${columns}`:'landscape'};
}

// A responsive reading arrangement, never a rewrite of ownership or authored geometry.
export function portraitComposition(graph, base, {columns=1} = {}) {
  columns=columns===2?2:1;
  const reading=readingRelations(graph,base),edges=graph.edges.filter(edge=>{const meta=reading.get(routeKey(edge));return meta?.overview&&meta.representative;});
  const connected=new Set(edges.flatMap(edge=>[edge.from,edge.to]));
  const ranks=flowRanks(graph.nodes,edges),levels=new Map(),positions=Object.create(null);
  for(const node of graph.nodes)if(connected.has(node.id)){
    const rank=ranks.get(node.id);if(!levels.has(rank))levels.set(rank,[]);levels.get(rank).push(node);
  }
  const groups=[...[...levels].sort((a,b)=>a[0]-b[0]).map(([,nodes])=>nodes),graph.nodes.filter(node=>!connected.has(node.id))];
  let row=0;
  for(const nodes of groups)for(let i=0;i<nodes.length;i+=columns){
    const peers=nodes.slice(i,i+columns);
    peers.forEach((node,index)=>positions[node.id]={col:index+(columns-peers.length)/2,row});row++;
  }
  // Large slices retain the normal layout fallback instead of emitting invalid geometry.
  if(row>101)return null;
  return readComposition({id:`${(base?.id||'graph').slice(0,65)}-portrait-v1-${columns}`,positions,routes:{},labels:base?.labels,
    reading:base?.reading,gapX:110,gapY:88});
}

export function layoutGraph(graph, sizes, { mode = 'architecture', direction = 'lr', phone = false, offsets = {}, columns, compact = phone, composition } = {}) {
  const positions = new Map(), nodes = graph.nodes;
  if (!nodes.length) return positions;
  const width = Math.max(...nodes.map(node => sizes.get(node.id).w));
  const height = Math.max(...nodes.map(node => sizes.get(node.id).h));
  const compactReading = graph.groups && compact;
  const padding = compactReading ? graph.edges.some(edge => edge.from === edge.to) ? 110 : 40 : 110;
  const authored=mode==='architecture'?readComposition(composition):null;
  const gapX = authored?.gapX || (compactReading ? 100 : 150), gapY = authored?.gapY || (compactReading ? 88 : 120);
  if (mode === 'sop') {
    const ranks = flowRanks(nodes, graph.edges), groups = new Map();
    for (const node of nodes) { const rank = ranks.get(node.id); if (!groups.has(rank)) groups.set(rank, []); groups.get(rank).push(node); }
    const maxPeers = Math.max(...[...groups.values()].map(group => group.length));
    for (const [rank, group] of groups) group.forEach((node, index) => {
      const peer = index + (maxPeers - group.length) / 2;
      positions.set(node.id, direction === 'tb'
        ? { x: padding + peer * (width + gapX), y: padding + rank * (height + gapY) }
        : { x: padding + rank * (width + gapX), y: padding + peer * (height + gapY) });
    });
  } else if(authored){
    let nextRow=Math.max(-1,...nodes.map(node=>authored.positions[node.id]?.row??-1))+1;
    for(const node of nodes){
      const point=authored.positions[node.id] || {col:0,row:nextRow++};
      positions.set(node.id,{x:padding+point.col*(width+gapX),y:padding+point.row*(height+gapY)});
    }
  } else {
    // Preserve authored grouping order, but place connected peers together.
    // Ranks affect reading order only: no relation is made primary or hidden.
    const ranks = flowRanks(nodes, graph.edges);
    const order = graph.groups ? [...nodes].sort((a, b) => ranks.get(a.id) - ranks.get(b.id)) : nodes;
    const cols = phone ? 1 : Math.max(1, Math.min(columns || 3, Math.ceil(Math.sqrt(nodes.length))));
    order.forEach((node, index) => positions.set(node.id, { x: padding + (index % cols) * (width + gapX), y: padding + Math.floor(index / cols) * (height + gapY) }));
  }
  for (const [id, point] of positions) {
    const offset = Object.hasOwn(offsets, id) ? offsets[id] : null;
    if (validOffset(offset) && validOffset({x:point.x+offset.x,y:point.y+offset.y})) { point.x += offset.x; point.y += offset.y; }
  }
  return positions;
}

const overlap = (a, b, gap = 0) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
const pointIn = (p, box, gap = 0) => p.x > box.x - gap && p.x < box.x + box.w + gap && p.y > box.y - gap && p.y < box.y + box.h + gap;
function segmentHits(a, b, box, gap = 0) {
  if (Math.abs(a.x - b.x) < .01) return a.x > box.x - gap && a.x < box.x + box.w + gap && Math.max(a.y, b.y) > box.y - gap && Math.min(a.y, b.y) < box.y + box.h + gap;
  if (Math.abs(a.y - b.y) < .01) return a.y > box.y - gap && a.y < box.y + box.h + gap && Math.max(a.x, b.x) > box.x - gap && Math.min(a.x, b.x) < box.x + box.w + gap;
  // Conservative sampling for the original soft quadratic curve.
  for (let i = 0; i <= 24; i++) if (pointIn({ x: a.x + (b.x - a.x) * i / 24, y: a.y + (b.y - a.y) * i / 24 }, box, gap)) return true;
  return false;
}
function roundedRoute(points) {
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    const before = Math.hypot(b.x - a.x, b.y - a.y), after = Math.hypot(c.x - b.x, c.y - b.y);
    const radius = Math.min(26, before / 2, after / 2);
    const p = { x: b.x + (a.x - b.x) / before * radius, y: b.y + (a.y - b.y) / before * radius };
    const q = { x: b.x + (c.x - b.x) / after * radius, y: b.y + (c.y - b.y) / after * radius };
    d += ` L${p.x},${p.y} Q${b.x},${b.y} ${q.x},${q.y}`;
  }
  return d + ` L${points.at(-1).x},${points.at(-1).y}`;
}
// Fixed boxes are authoritative. Search empty corridors; never move cards to
// conceal a routing failure. A bounded visibility grid is enough for a slice.
function corridor(start, end, boxes) {
  const xs = [...new Set([start.x, end.x, 40, ...boxes.flatMap(b => [b.x - 36, b.x + b.w + 36])])].sort((a, b) => a - b);
  const ys = [...new Set([start.y, end.y, 40, ...boxes.flatMap(b => [b.y - 36, b.y + b.h + 36])])].sort((a, b) => a - b);
  if (xs.length * ys.length > 16000) return null;
  const width = xs.length, id = (x, y) => y * width + x;
  const first = id(xs.indexOf(start.x), ys.indexOf(start.y)), last = id(xs.indexOf(end.x), ys.indexOf(end.y));
  const points = ys.flatMap(y => xs.map(x => ({ x, y })));
  const valid = points.map(p => !boxes.some(b => pointIn(p, b, 14)));
  const distance = new Map([[first, 0]]), previous = new Map(), pending = new Set([first]);
  while (pending.size) {
    let current = null, best = Infinity;
    for (const candidate of pending) { const cost = distance.get(candidate) + Math.abs(points[candidate].x - end.x) + Math.abs(points[candidate].y - end.y); if (cost < best) { best = cost; current = candidate; } }
    pending.delete(current);
    if (current === last) {
      const route = [points[last]]; let cursor = last;
      while (previous.has(cursor)) { cursor = previous.get(cursor); route.unshift(points[cursor]); }
      return route.filter((p, i) => i === 0 || i === route.length - 1 || !((route[i - 1].x === p.x && route[i + 1].x === p.x) || (route[i - 1].y === p.y && route[i + 1].y === p.y)));
    }
    const x = current % width, y = Math.floor(current / width);
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= ys.length) continue;
      const next = id(nx, ny);
      if (!valid[next] || boxes.some(b => segmentHits(points[current], points[next], b, 14))) continue;
      const cost = distance.get(current) + Math.abs(points[current].x - points[next].x) + Math.abs(points[current].y - points[next].y);
      if (cost < (distance.get(next) ?? Infinity)) { distance.set(next, cost); previous.set(next, current); pending.add(next); }
    }
  }
  return null;
}
export function routeGraph(rectangles, edges, hints = {}) {
  const boxes = [...rectangles.values()], counts = new Map(), usage = new Map();
  const side = (a, b) => Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? b.x > a.x ? 'right' : 'left' : b.y > a.y ? 'bottom' : 'top';
  const descriptors = edges.map(edge => {
    const a = rectangles.get(edge.from), b = rectangles.get(edge.to);
    if (!a || !b) return null;
    const hint=hints[JSON.stringify([edge.from,edge.to])]||{},sides=['left','right','top','bottom'];
    const from = sides.includes(hint.fromSide)?hint.fromSide:side(a, b), to = sides.includes(hint.toSide)?hint.toSide:side(b, a);
    for (const [id, s] of [[edge.from, from], [edge.to, to]]) { const key = JSON.stringify([id, s]); counts.set(key, (counts.get(key) || 0) + 1); }
    return { edge, a, b, from, to, hint };
  });
  function port(id, box, s) {
    const key = JSON.stringify([id, s]), index = usage.get(key) || 0; usage.set(key, index + 1);
    const fraction = (index + 1) / (counts.get(key) + 1), horizontal = s === 'top' || s === 'bottom';
    const p = horizontal ? { x: box.x + box.w * fraction, y: s === 'top' ? box.y : box.y + box.h } : { x: s === 'left' ? box.x : box.x + box.w, y: box.y + box.h * fraction };
    const stub = { x: p.x + (s === 'left' ? -28 : s === 'right' ? 28 : 0), y: p.y + (s === 'top' ? -28 : s === 'bottom' ? 28 : 0) };
    return [p, stub];
  }
  return descriptors.map((descriptor, index) => {
    if (!descriptor) return null;
    const { edge, a, b, from, to, hint } = descriptor;
    if (edge.from === edge.to) {
      const curve = graphCurve(a, a, index);
      const x = a.x + a.w / 2, reach = 60 + index % 3 * 14;
      return { ...curve, points: [{ x: x - 24, y: a.y }, { x: x - 54, y: a.y - reach }, { x: x + 54, y: a.y - reach }, { x: x + 24, y: a.y }], candidates: [curve.label] };
    }
    const [p, start] = port(edge.from, a, from), [q, end] = port(edge.to, b, to);
    let inner;
    if(['above','below'].includes(hint.corridor)){
      const y=hint.corridor==='above'?Math.min(a.y,b.y)-72:Math.max(a.y+a.h,b.y+b.h)+72;
      const candidate=[start,{x:start.x,y},{x:end.x,y},end].filter((p,i,all)=>!i||p.x!==all[i-1].x||p.y!==all[i-1].y);
      if(!candidate.slice(1).some((p,i)=>boxes.some(box=>segmentHits(candidate[i],p,box,14))))inner=candidate;
    }
    inner ||= corridor(start, end, boxes);
    if (!inner) return { ...graphCurve(a, b, index), points: [p, q], candidates: [], unresolved: true };
    const points = [p, ...inner, q].filter((point, i, all) => !i || point.x !== all[i - 1].x || point.y !== all[i - 1].y);
    const candidates = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < 56) continue;
      for (const fraction of [.5, .35, .65, .2, .8]) candidates.push({ x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction - 14, length, vertical: a.x === b.x });
    }
    candidates.sort((a, b) => b.length - a.length);
    return { d: roundedRoute(points), points, candidates, label: candidates[0] || { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } };
  });
}

export function reviewGraphLayout(rectangles, routes) {
  const boxes=[...rectangles],issues={cardOverlaps:[],routeBlockers:[],crossings:[]};
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)if(overlap(boxes[i][1],boxes[j][1]))issues.cardOverlaps.push([boxes[i][0],boxes[j][0]]);
  routes.forEach((route,index)=>{
    if(!route)return;
    for(const [id,box] of boxes)if(route.points.slice(1).some((point,i)=>segmentHits(route.points[i],point,box)))issues.routeBlockers.push({route:index,node:id});
  });
  for(let i=0;i<routes.length;i++)for(let j=i+1;j<routes.length;j++){
    const a=routes[i]?.points||[],b=routes[j]?.points||[];
    for(let u=1;u<a.length;u++)for(let v=1;v<b.length;v++){
      const p=a[u-1],q=a[u],r=b[v-1],s=b[v];
      const vertical=p.x===q.x&&r.y===s.y,horizontal=p.y===q.y&&r.x===s.x;
      const x=vertical?p.x:r.x,y=vertical?r.y:p.y;
      if((vertical||horizontal)&&x>=Math.min(horizontal?p.x:r.x,horizontal?q.x:s.x)&&x<=Math.max(horizontal?p.x:r.x,horizontal?q.x:s.x)&&y>=Math.min(vertical?p.y:r.y,vertical?q.y:s.y)&&y<=Math.max(vertical?p.y:r.y,vertical?q.y:s.y)){
        const endpoint=points=>[points[0],points.at(-1)].some(p=>p.x===x&&p.y===y);
        if(!endpoint(a)&&!endpoint(b)&&!issues.crossings.some(issue=>issue.routes[0]===i&&issue.routes[1]===j&&issue.x===x&&issue.y===y))issues.crossings.push({routes:[i,j],x,y});
      }
    }
  }
  return issues;
}

export function placeGraphLabel(route, size, boxes, placed, routes) {
  const candidates = route.candidates?.length ? route.candidates : [route.label];
  for (const p of candidates) for (const dx of p.vertical ? [-(size.w / 2 + 12), size.w / 2 + 12, 0] : [0]) for (const offset of [0, -16, 32]) {
    const box = { x: p.x + dx - size.w / 2, y: p.y + offset - size.h / 2, ...size };
    if ([...boxes, ...placed].some(b => overlap(box, b, 8))) continue;
    if (routes.some(other => other !== route && other?.points.slice(1).some((end, i) => segmentHits(other.points[i], end, box, 3)))) continue;
    return box;
  }
  // Remain beside the authored route and make failure inspectable, rather than
  // drifting below unrelated cards or silently reducing the font size.
  return { x: route.label.x - size.w / 2, y: route.label.y - size.h / 2, ...size, unresolved: true };
}
// Reject corrupt magnitudes beyond JS coordinate precision, not a canvas wall.
// Normal signed coordinates (including positions past 50000) remain untouched.
function validOffset(point) { return point && Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x)<=Number.MAX_SAFE_INTEGER && Math.abs(point.y)<=Number.MAX_SAFE_INTEGER; }
export function routeKey(edge){
  return JSON.stringify([edge.from,edge.to,edge.sources?'bundle':edge.id || edge.label || '']);
}
export function readRouteEdit(edit){
  const port=value=>value && ['left','right','top','bottom'].includes(value.side) && Number.isFinite(value.ratio) && value.ratio>=0 && value.ratio<=1;
  if(!edit || !port(edit.from) || !port(edit.to) || !Array.isArray(edit.bends) || edit.bends.length>32 || !edit.bends.every(validOffset))return null;
  return {from:{side:edit.from.side,ratio:edit.from.ratio},to:{side:edit.to.side,ratio:edit.to.ratio},bends:edit.bends.map(p=>({x:p.x,y:p.y}))};
}
export function nearestGraphPort(box,point){
  const candidates=[{side:'left',distance:Math.abs(point.x-box.x),ratio:(point.y-box.y)/box.h},
    {side:'right',distance:Math.abs(point.x-box.x-box.w),ratio:(point.y-box.y)/box.h},
    {side:'top',distance:Math.abs(point.y-box.y),ratio:(point.x-box.x)/box.w},
    {side:'bottom',distance:Math.abs(point.y-box.y-box.h),ratio:(point.x-box.x)/box.w}];
  const nearest=candidates.sort((a,b)=>a.distance-b.distance)[0];
  return {side:nearest.side,ratio:Math.max(0,Math.min(1,nearest.ratio))};
}
export function manualGraphRoute(a,b,edit){
  edit=readRouteEdit(edit);if(!edit)return null;
  const port=(box,p)=>({x:p.side==='left'?box.x:p.side==='right'?box.x+box.w:box.x+box.w*p.ratio,
    y:p.side==='top'?box.y:p.side==='bottom'?box.y+box.h:box.y+box.h*p.ratio});
  const stub=(p,side)=>({x:p.x+(side==='left'?-28:side==='right'?28:0),y:p.y+(side==='top'?-28:side==='bottom'?28:0)});
  const first=port(a,edit.from),last=port(b,edit.to);
  const points=[first,stub(first,edit.from.side),...edit.bends,stub(last,edit.to.side),last].filter((p,i,all)=>!i||p.x!==all[i-1].x||p.y!==all[i-1].y);
  if(!points.every(validOffset))return null;
  const candidates=points.slice(1).map((p,i)=>({x:(points[i].x+p.x)/2,y:(points[i].y+p.y)/2-14,length:Math.hypot(p.x-points[i].x,p.y-points[i].y),vertical:p.x===points[i].x})).sort((a,b)=>b.length-a.length);
  return {d:roundedRoute(points),points,candidates,label:candidates[0]||first,manual:true};
}
export function readPresentation(storage, key, fallback = 'tree') {
  const state = { v: 1, mode: ['tree', 'architecture', 'sop'].includes(fallback) ? fallback : 'tree', offsets: Object.create(null) };
  try {
    const saved = JSON.parse(storage.getItem(key));
    if (saved?.v !== 1) return state;
    if (['tree', 'architecture', 'sop'].includes(saved.mode)) state.mode = saved.mode;
    if (typeof saved.readingRootId === 'string' && saved.readingRootId.length <= 200) state.readingRootId = saved.readingRootId;
    for (const [view, offsets] of Object.entries(saved.offsets || {}).slice(0, 24)) {
      state.offsets[view] = Object.fromEntries(Object.entries(offsets || {}).slice(0, 10000).filter(([, point]) => validOffset(point)));
    }
    state.routes=Object.create(null);
    for(const [view,routes] of Object.entries(saved.routes||{}).slice(0,24)){
      state.routes[view]=Object.fromEntries(Object.entries(routes||{}).slice(0,10000).map(([key,edit])=>[key,readRouteEdit(edit)]).filter(([,edit])=>edit));
    }
  } catch { /* Storage denial/corruption must not block rendering. */ }
  return state;
}

export function graphCurve(a, b, index = 0) {
  if (a === b) {
    const x = a.x + a.w / 2, y = a.y, reach = 60 + index % 3 * 14;
    return { d: `M${x - 24},${y} C${x - 90},${y - reach} ${x + 90},${y - reach} ${x + 24},${y}`, label: { x, y: y - reach * .75 - 12 } };
  }
  const port = (p, q) => {
    const dx = q.x + q.w / 2 - p.x - p.w / 2, dy = q.y + q.h / 2 - p.y - p.h / 2;
    return Math.abs(dx) > Math.abs(dy) ? { x: dx > 0 ? p.x + p.w : p.x, y: p.y + p.h / 2 }
      : { x: p.x + p.w / 2, y: dy > 0 ? p.y + p.h : p.y };
  };
  const start = port(a, b), end = port(b, a), dx = end.x - start.x, dy = end.y - start.y, distance = Math.hypot(dx, dy) || 1;
  const bulge = Math.min(110, Math.max(32, distance * .18)) + index * 16;
  const control = { x: (start.x + end.x) / 2 - dy / distance * bulge, y: (start.y + end.y) / 2 + dx / distance * bulge };
  return { d: `M${start.x},${start.y} Q${control.x},${control.y} ${end.x},${end.y}`,
    label: { x: (start.x + 2 * control.x + end.x) / 4, y: (start.y + 2 * control.y + end.y) / 4 - 14 } };
}

// Selection updates only presentation, keeping cards and their positions stable.
export function readingRelations(graph,composition,edits={}){
  const pairKey=(from,to)=>JSON.stringify([from,to].sort()),pairs=new Map(),ids=new Set(graph.nodes.map(node=>node.id));
  for(const edge of graph.edges){
    if(!ids.has(edge.from)||!ids.has(edge.to))continue;
    const key=pairKey(edge.from,edge.to);if(!pairs.has(key))pairs.set(key,[]);pairs.get(key).push(edge);
  }
  const reading=composition?.reading||{},overview=new Set(),parents=new Map([...ids].map(id=>[id,id]));
  const find=id=>{let parent=id;while(parents.get(parent)!==parent)parent=parents.get(parent);return parent;};
  // Explicit reading priorities describe this view only, not canonical ownership.
  // Without authored priorities, use a deterministic connectivity skeleton.
  const ordered=[...(reading.overview||[]).map(([a,b])=>pairKey(a,b)),...[...pairs.keys()].sort()];
  for(const key of ordered){
    const edge=pairs.get(key)?.[0];if(!edge || edge.from===edge.to)continue;
    const a=find(edge.from),b=find(edge.to);if(a===b)continue;
    parents.set(a,b);overview.add(key);
  }
  const primary=Array.isArray(reading.primary)?new Set(reading.primary.map(([a,b])=>pairKey(a,b))):new Set([...overview,...[...pairs.keys()].filter(key=>{const edge=pairs.get(key)[0];return edge.from===edge.to;})]);
  const result=new Map();
  for(const [key,edges] of pairs){
    const preferred=[...(reading.overview||[]),...(reading.primary||[])].find(([from,to])=>pairKey(from,to)===key);
    const representative=edges.find(edge=>readRouteEdit(edits[routeKey(edge)])) || edges.find(edge=>preferred&&edge.from===preferred[0]&&edge.to===preferred[1]) || edges[0];
    const labels=[...new Set(edges.map(edge=>composition?.labels?.[JSON.stringify([edge.from,edge.to])]||edge.label).filter(Boolean))];
    for(const edge of edges)result.set(routeKey(edge),{representative:edge===representative,overview:overview.has(key),primary:primary.has(key),
      reverse:edges.some(other=>other.from===edge.to&&other.to===edge.from&&other.from!==other.to),label:reading.labels?.[key]||labels.join(' · '),
      detail:edges.map(other=>other.detail||`${other.from} → ${other.to}${other.label?'：'+other.label:''}`).join('\n')});
  }
  return result;
}
export function focusGraph({ nodes, links, labels }, selected) {
  for (const el of nodes) el.classList.toggle('selected', el.dataset.id === selected && !el.classList.contains('drilled-root'));
  const related = el => !selected || el.dataset.from === selected || el.dataset.to === selected;
  const all=links.dataset?.relationDisplay==='all';
  const visible=el=>el.dataset.readingRepresentative===undefined?related(el):all || el.dataset.readingRepresentative==='true' && (selected?el.dataset.readingPrimary==='true'&&related(el):el.dataset.readingOverview==='true');
  for (const path of links.querySelectorAll('.graph-flow')) {
    const sparse=path.dataset.readingRepresentative!==undefined,show=visible(path);
    path.classList.toggle('hot', sparse?show&&!!selected:related(path)); path.classList.toggle('dim', sparse?false:!related(path));
    if(sparse){path.style.display=show?'':'none';path.setAttribute('aria-hidden',String(!show));
      path.setAttribute('marker-end',all||selected?'url(#graph-flow-arrow)':'none');
      path.setAttribute('marker-start',!all&&selected&&path.dataset.readingReverse==='true'?'url(#graph-flow-arrow)':'none');}
  }
  for(const hit of links.querySelectorAll('.graph-route-hit'))if(hit.dataset.readingRepresentative!==undefined){const show=visible(hit);hit.style.display=show?'':'none';hit.setAttribute('tabindex',show?'0':'-1');hit.setAttribute('aria-hidden',String(!show));}
  for (const label of labels.querySelectorAll('.graph-flow-label')){
    const sparse=label.dataset.readingRepresentative!==undefined;
    label.hidden=sparse?!(visible(label)&&(all||selected)):!related(label);
    if(sparse)label.textContent=all?label.dataset.fullLabel:label.dataset.readingLabel;
  }
}

export function renderGraph({ graph, mount, links, labels, options, selected, scale, moved, boundsChanged, routeSelected, routeSelect, routeChanged, canEditRoute }) {
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const elements = new Map(graph.nodes.map(node => [node.id, mount(node, false)]));
  for (const [id, el] of elements) {
    const group = graph.groups?.get(id);
    if (!group) continue;
    const meta = document.createElement('div'); meta.className = 'graph-group-meta';
    const caption = document.createElement('span');
    caption.textContent = options.groupCaption ? options.groupCaption(group) : group.scope ? '当前模块' : group.context ? '关联模块' : group.count ? `${group.count} 个内部节点` : '叶子节点';
    meta.append(caption);
    el.append(meta); el.dataset.graphContext = String(group.context);
  }
  const sizes = new Map([...elements].map(([id, el]) => [id, { w: el.offsetWidth, h: el.offsetHeight }]));
  const positions = layoutGraph(graph, sizes, options), origins = layoutGraph(graph, sizes, { ...options, offsets: {} });
  const boxes = () => new Map([...positions].map(([id, point]) => [id, { ...point, ...sizes.get(id) }]));
  const ns = 'http://www.w3.org/2000/svg';
  const edits={...options.routeEdits};let routeModels=new Map(),routeDrag=null,currentReading=null;
  const routeVisible=key=>{
    const model=routeModels.get(key);if(!model)return false;
    const meta=currentReading?.get(key),focus=typeof selected==='function'?selected():selected;
    return !meta || options.showAllRelations || meta.representative && (focus?meta.primary&&(model.edge.from===focus||model.edge.to===focus):meta.overview);
  };
  const draw = () => {
    const rectangles = boxes(); let w = 0, h = 0, minX = 0, minY = 0;
    for (const [id, box] of rectangles) {
      const el = elements.get(id); el.style.left = box.x + 'px'; el.style.top = box.y + 'px'; el.style.visibility = '';
      w = Math.max(w, box.x + box.w); h = Math.max(h, box.y + box.h);
      minX = Math.min(minX,box.x); minY = Math.min(minY,box.y);
    }
    links.innerHTML = '<defs><marker id="graph-flow-arrow" markerWidth="8" markerHeight="8" refX="6.4" refY="3" orient="auto-start-reverse"><path d="M0,0 L7,3 L0,6" fill="none" stroke="#5a7a62" stroke-width="1.2"/></marker></defs>';
    labels.replaceChildren(); const placed = [], bundles = new Map();
    const composition=options.mode==='sop'?null:readComposition(options.composition);
      const reading=options.mode==='architecture'?readingRelations(graph,composition,edits):null;
    currentReading=reading;
    links.dataset.relationDisplay=options.showAllRelations?'all':'primary';
    const readingData=(el,edge)=>{const meta=reading?.get(routeKey(edge));if(!meta)return;for(const field of ['representative','overview','primary','reverse'])el.dataset['reading'+field[0].toUpperCase()+field.slice(1)]=String(meta[field]);el.dataset.readingLabel=meta.label;};
    routeModels=new Map();
    const routes = routeGraph(rectangles, graph.edges, composition?.routes).map((curve,index)=>{
      const edge=graph.edges[index];return manualGraphRoute(rectangles.get(edge.from),rectangles.get(edge.to),edits[routeKey(edge)]) || curve;
    });
    const issues=reviewGraphLayout(rectangles,routes);
    links.dataset.layoutReview=JSON.stringify(issues);
    graph.edges.forEach((edge, index) => {
      const pair=JSON.stringify([edge.from,edge.to]), lane=bundles.get(pair)||0;bundles.set(pair,lane+1);
      const a = rectangles.get(edge.from), b = rectangles.get(edge.to), curve = routes[index] || graphCurve(a, edge.from === edge.to ? a : b, lane);
      const editKey=routeKey(edge);routeModels.set(editKey,{edge,a,b,curve});
      for (const point of curve.points || []) { w = Math.max(w, point.x); h = Math.max(h, point.y); minX = Math.min(minX,point.x); minY = Math.min(minY,point.y); }
      const path = document.createElementNS(ns, 'path'); path.setAttribute('d', curve.d); path.setAttribute('class', 'flow graph-flow');
      path.dataset.from = edge.from; path.dataset.to = edge.to;
      path.dataset.routeKey=editKey;
      readingData(path,edge);
      path.setAttribute('marker-end', 'url(#graph-flow-arrow)');
      path.dataset.relationCount = String(edge.sources?.length || 1);
      path.dataset.route = curve.unresolved ? 'needs-space' : 'clear';
      const title = document.createElementNS(ns, 'title'); title.textContent = reading?.get(editKey)?.representative?reading.get(editKey).detail:edge.detail || `${byId.get(edge.from).title} → ${byId.get(edge.to).title}${edge.label ? '：' + edge.label : ''}`;
      path.append(title); links.append(path);
      if(routeSelect){
        const hit=document.createElementNS(ns,'path');hit.setAttribute('d',curve.d);hit.setAttribute('class','graph-route-hit');hit.dataset.routeKey=editKey;
        hit.dataset.from=edge.from;hit.dataset.to=edge.to;readingData(hit,edge);
        hit.setAttribute('tabindex','0');hit.setAttribute('role','button');hit.setAttribute('aria-label','编辑连线：'+title.textContent);links.append(hit);
      }
      const displayLabel=composition?.labels[pair] || edge.label || reading?.get(editKey)?.label;
      if (displayLabel) {
        const label = document.createElement('span'); label.className = 'flow-lab graph-flow-label'; label.textContent = String(displayLabel);
        label.dataset.from = edge.from; label.dataset.to = edge.to;
        label.dataset.fullLabel=String(displayLabel);readingData(label,edge);
        if(options.labelText){label.dataset.fullLabel=options.labelText(String(displayLabel));if(label.dataset.readingLabel)label.dataset.readingLabel=options.labelText(label.dataset.readingLabel);label.textContent=options.labelText(String(displayLabel));}
        labels.append(label); const lw = label.offsetWidth, lh = label.offsetHeight;
        const box = placeGraphLabel(curve, { w: lw, h: lh }, [...rectangles.values()], placed, routes);
        const x = box.x + lw / 2, y = box.y + lh / 2;
        label.dataset.placement = box.unresolved ? 'needs-space' : 'clear';
        label.style.left = x + 'px'; label.style.top = y + 'px'; placed.push(box);
        w = Math.max(w, x + lw / 2); h = Math.max(h, y + lh / 2);
        minX = Math.min(minX,box.x); minY = Math.min(minY,box.y);
      }
    });
    focusGraph({ nodes: elements.values(), links, labels }, typeof selected === 'function' ? selected() : selected);
    const active=routeModels.get(routeSelected?.());
    if(active && routeVisible(routeSelected()) && canEditRoute?.()){
      const edit=readRouteEdit(edits[routeSelected()]) || initialRouteEdit(active);
      const curve=manualGraphRoute(active.a,active.b,edit);
      if(curve){
      const first=curve.points[0],last=curve.points.at(-1);
      const control=(point,kind,index)=>{
        const circle=document.createElementNS(ns,'circle');circle.setAttribute('cx',point.x);circle.setAttribute('cy',point.y);circle.setAttribute('r',kind==='insert'?4:7);
        circle.setAttribute('class','graph-route-control '+kind);circle.dataset.routeKey=routeSelected();circle.dataset.kind=kind;circle.dataset.index=String(index);
        circle.setAttribute('tabindex','0');circle.setAttribute('role','button');circle.setAttribute('aria-label',kind==='from'?'调整来源接入点':kind==='to'?'调整目标接入点':kind==='insert'?'添加折点':'移动折点 '+(index+1));links.append(circle);
      };
      control(first,'from',0);control(last,'to',0);edit.bends.forEach((p,i)=>control(p,'bend',i));
      if(edit.bends.length<32){const inner=[curve.points[1],...edit.bends,curve.points.at(-2)];inner.slice(1).forEach((p,i)=>control({x:(inner[i].x+p.x)/2,y:(inner[i].y+p.y)/2},'insert',i));}
      }
    }
    links.setAttribute('width', w + 140); links.setAttribute('height', h + 140);
    labels.style.width = w + 140 + 'px'; labels.style.height = h + 140 + 'px';
    if(minX<0)minX-=70;if(minY<0)minY-=70;
    const result = { minX, minY, w: w + 70 - minX, h: h + 70 - minY };
    if(options.fitCards&&rectangles.size){
      const cards=[...rectangles.values()],left=Math.min(...cards.map(box=>box.x)),top=Math.min(...cards.map(box=>box.y));
      result.minX=left-24;result.minY=top-24;
      result.w=Math.max(...cards.map(box=>box.x+box.w))-left+48;
      result.h=Math.max(...cards.map(box=>box.y+box.h))-top+48;
    }
    boundsChanged?.(result); return result;
  };
  function initialRouteEdit(model){
    const points=model.curve.points||[],first=points[0]||{x:model.a.x+model.a.w,y:model.a.y+model.a.h/2},last=points.at(-1)||{x:model.b.x,y:model.b.y+model.b.h/2};
    let bends=points.slice(2,-2);if(!bends.length)bends=[{x:(first.x+last.x)/2,y:(first.y+last.y)/2}];
    return {from:nearestGraphPort(model.a,first),to:nearestGraphPort(model.b,last),bends:bends.slice(0,32).map(p=>({...p}))};
  }
  links.onclick=event=>{
    const hit=event.target.closest?.('.graph-route-hit');if(!hit || !routeVisible(hit.dataset.routeKey) || !canEditRoute?.() || routeDrag)return;
    event.stopPropagation();routeSelect(hit.dataset.routeKey);draw();
  };
  links.onpointerdown=event=>{
    const control=event.target.closest?.('.graph-route-control');if(!control || !routeVisible(control.dataset.routeKey) || control.dataset.routeKey!==routeSelected?.() || event.button!==0 || !canEditRoute?.())return;
    const key=control.dataset.routeKey,model=routeModels.get(key);if(!model)return;
    const zoom=scale();if(!Number.isFinite(zoom)||zoom<=0)return;
    const before=readRouteEdit(edits[key]),edit=readRouteEdit(before)||initialRouteEdit(model),kind=control.dataset.kind,index=Number(control.dataset.index);
    const fromScreen=p=>{const bounds=links.getBoundingClientRect();return {x:(p.clientX-bounds.left)/zoom,y:(p.clientY-bounds.top)/zoom};};
    const initial=fromScreen(event);if(!validOffset(initial))return;
    if(kind==='insert')edit.bends.splice(index,0,initial);
    routeDrag={key,model,edit,before,kind:kind==='insert'?'bend':kind,index,start:initial,changed:kind==='insert',pointer:event.pointerId,fromScreen};
    if(kind==='insert')edits[key]=edit;
    links.setPointerCapture(event.pointerId);event.preventDefault();event.stopPropagation();
    if(kind==='insert')draw();
  };
  links.onpointermove=event=>{
    if(!routeDrag || event.pointerId!==routeDrag.pointer || !routeVisible(routeDrag.key) || routeSelected?.()!==routeDrag.key || !canEditRoute?.())return;
    const point=routeDrag.fromScreen(event);if(!validOffset(point))return;
    const {edit,kind,index,model}=routeDrag;
    if(kind==='bend')edit.bends[index]=point;else edit[kind]=nearestGraphPort(kind==='from'?model.a:model.b,point);
    routeDrag.changed=true;edits[routeDrag.key]=edit;draw();event.stopPropagation();
  };
  const endRoute=(event,cancelled=false)=>{
    if(!routeDrag || event.pointerId!==routeDrag.pointer)return;
    const drag=routeDrag;routeDrag=null;
    if(cancelled || !routeVisible(drag.key) || routeSelected?.()!==drag.key || !canEditRoute?.()){if(drag.before)edits[drag.key]=drag.before;else delete edits[drag.key];draw();}
    else if(drag.changed)routeChanged(drag.key,readRouteEdit(drag.edit));
  };
  links.onpointerup=endRoute;links.onpointercancel=event=>endRoute(event,true);links.onlostpointercapture=event=>endRoute(event,true);
  links.onkeydown=event=>{
    const hit=event.target.closest?.('.graph-route-hit'),control=event.target.closest?.('.graph-route-control');
    if(!canEditRoute?.())return;
    if((hit&&!routeVisible(hit.dataset.routeKey)) || (control&&(!routeVisible(control.dataset.routeKey)||control.dataset.routeKey!==routeSelected?.())))return;
    if(hit && ['Enter',' '].includes(event.key)){event.preventDefault();event.stopPropagation();routeSelect(hit.dataset.routeKey);draw();return;}
    if(!control || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Delete','Backspace','Enter',' '].includes(event.key))return;
    event.preventDefault();event.stopPropagation();
    const key=control.dataset.routeKey,model=routeModels.get(key),edit=readRouteEdit(edits[key])||initialRouteEdit(model),kind=control.dataset.kind,index=Number(control.dataset.index),step=event.shiftKey?20:5;
    if(kind==='insert'){
      if(!['Enter',' '].includes(event.key))return;edit.bends.splice(index,0,{x:Number(control.getAttribute('cx')),y:Number(control.getAttribute('cy'))});
    }else if(kind==='bend'){
      if(['Delete','Backspace'].includes(event.key))edit.bends.splice(index,1);
      else if(event.key.startsWith('Arrow')){edit.bends[index].x+=event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0;edit.bends[index].y+=event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0;}
      else return;
    }else if(event.key.startsWith('Arrow'))edit[kind].ratio=Math.max(0,Math.min(1,edit[kind].ratio+(['ArrowLeft','ArrowUp'].includes(event.key)?-.05:.05)));else return;
    const valid=readRouteEdit(edit);if(!valid)return;edits[key]=valid;routeChanged(key,valid);draw();
    [...links.querySelectorAll('.graph-route-control')].find(el=>el.dataset.kind===kind && el.dataset.index===String(index))?.focus();
  };
  for (const [id, el] of elements) {
    el.tabIndex = 0; el.setAttribute('role', 'button'); el.setAttribute('aria-label', options.nodeName ? options.nodeName(byId.get(id)) : byId.get(id).title);
    el.setAttribute('aria-description', '单击呈现关系；再次单击同一模块进入');
    el.onkeydown = event => {
      if (event.target !== el || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault(); el._graphDragged = false;
      el.click();
    };
    let drag = null;
    el.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button, input, textarea, .add-child, .add-pick, .dot')) return;
      drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, start: { ...positions.get(id) }, changed: false };
      el._graphDragged = false;
      el.setPointerCapture(event.pointerId); event.stopPropagation();
    });
    el.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.pointer) return;
      const zoom=scale();if(!Number.isFinite(zoom)||zoom<=0)return;
      const dx = (event.clientX - drag.x) / zoom, dy = (event.clientY - drag.y) / zoom;
      if (!drag.changed && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
      const point={x:drag.start.x+dx,y:drag.start.y+dy};
      if(!validOffset(point))return;
      drag.changed = true; el._graphDragged = true;
      positions.set(id,point);draw();
    });
    const end = (event, cancelled = false) => {
      if (!drag || event.pointerId !== drag.pointer) return;
      const previous = drag; drag = null;
      if (cancelled) { el._graphDragged = false; positions.set(id, previous.start); draw(); }
      else if (previous.changed) { const point = positions.get(id), origin = origins.get(id); moved(id, { x: point.x - origin.x, y: point.y - origin.y }); }
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', event => end(event, true));
    el.addEventListener('lostpointercapture', event => end(event, true));
  }
  return draw();
}
