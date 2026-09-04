// Derived from Portless 0.15.6 src/routes.ts, Copyright 2025 Vercel Inc.
// SPDX-License-Identifier: Apache-2.0
// Modified for Context Guard: HTTP-only route schema, single daemon writer,
// atomic private storage, strict validation; no force/kill, tunnels or PID pruning.
// See THIRD_PARTY_NOTICES.md and licenses/Portless-Apache-2.0.txt.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function validRoute(r) {
  return r && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.localhost$/.test(r.hostname)
    && Number.isInteger(r.port) && r.port > 0 && r.port < 65536
    && typeof r.root === 'string' && path.isAbsolute(r.root)
    && /^[a-f0-9]{24}$/.test(r.projectId) && typeof r.instance === 'string' && r.instance.length >= 20
    && (r.runtimeSchema === undefined || Number.isInteger(r.runtimeSchema) && r.runtimeSchema > 0)
    && typeof r.proxyToken === 'string' && r.proxyToken.length >= 32
    && (r.projectKey === undefined || /^(?:git|folder)-[a-f0-9]{20}$/.test(r.projectKey));
}

function sameIdentity(left, right) {
  return left && right && left.hostname === right.hostname && left.root === right.root
    && left.projectId === right.projectId && left.instance === right.instance;
}
export class RouteStore {
  constructor(dir) { this.routesPath = path.join(dir, 'routes.json'); }
  loadRoutes() {
    let text;
    try { text = fs.readFileSync(this.routesPath, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    const routes = JSON.parse(text);
    if (!Array.isArray(routes) || !routes.every(validRoute) || new Set(routes.map(r => r.hostname)).size !== routes.length) throw new Error('Invalid named-workbench route store; restore the file before registering routes');
    return routes;
  }
  saveRoutes(routes) {
    const temp = `${this.routesPath}.${randomUUID()}.tmp`;
    try {
      const fd = fs.openSync(temp, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(routes)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temp, this.routesPath);
    } finally { try { fs.unlinkSync(temp); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  }
  addRoute(route, { replace = null } = {}) {
    if (!validRoute(route)) throw new Error('Invalid named-workbench route');
    const routes = this.loadRoutes(), previous = routes.find(r => r.hostname === route.hostname);
    // Project identity, not PID reuse, controls name ownership. Never kill an owner.
    const sameProject = previous?.projectKey && route.projectKey && previous.projectKey === route.projectKey;
    if (previous && (previous.projectId !== route.projectId || previous.root !== route.root) && !sameProject && !sameIdentity(previous, replace)) {
      throw new Error('Name belongs to another project; choose a different --name');
    }
    this.saveRoutes([...routes.filter(r => r.hostname !== route.hostname), route]);
  }
}
