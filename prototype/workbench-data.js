(function(global){
function inferOwnPath(title){
  const t = String(title||"").trim();
  const m = t.match(/((?:src|apps|packages|scripts|prototype|extensions|skills|\.codex|ui)\/[^\s，。；、]+)/);
  if(!m) return "";
  let p = m[1].replace(/[.,;:]+$/,"");
  if(!/\.[A-Za-z0-9]+$/.test(p) && !p.endsWith("/")) p += "/";
  return p;
}
function U(id, title, purpose, children, extra){
  extra = extra || {};
  const kind = extra.kind || (String(id).charAt(0)==="M" ? "module" : "work");
  const inferred = inferOwnPath(title);
  const node = {
    id, title, kind, purpose: purpose || "",
    state: extra.state || "dirty",
    memories: extra.memories || [],
    ideas: extra.ideas || [],
    todos: extra.todos || [],
    bugs: extra.bugs || [],
    dormant: extra.dormant || [],
    children: children || [],
    files: extra.files || [],
    owns: extra.owns ? extra.owns.slice() : (inferred ? [inferred] : [])
  };
  if(extra.origin) node.origin = extra.origin;
  if(extra.proposal) node.proposal = extra.proposal;
  if(extra.isNew) node.isNew = extra.isNew;
  return node;
}
const root = U("T0", "工作台", "", [], {kind:"module"});
global.__CG_WORKBENCH_DATA = { U, catalog: {"context-guard": {id:"context-guard",name:"工作台",heading:"工作台",source:"",blueprint:root,live:null,auth:null,bootstrap:"pending",firstUseOpen:false,notes:"",analyze:[],l1Cuts:[]}} };
})(window);
