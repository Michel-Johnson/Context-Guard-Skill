import path from 'node:path';
import { atomicWrite, encode, hash, readJSON, withFileLock } from './io.mjs';
import { canonical, fail, MAX_MESSAGE_BYTES } from './protocol.mjs';
import { entries } from '../../prototype/map-model.mjs';
import { nodeProjection, relationProjection } from './protocol-map.mjs';

// Snapshots are private, immutable read projections, never a second Map authority.
export class WorkbenchSnapshots {
  constructor(directory) { this.directory = directory; }
  async read(principal, message, { load, grants, capture }) {
    const p = message.payload;
    if (p.recovery && !capture) fail('UNAVAILABLE', 'Recovery capture is not configured');
    const captured = p.recovery && !p.cursor ? await capture() : null;
    const allowed = [...new Set(await grants())].sort();
    const scope = { repositoryId: principal.repositoryId, agentId: principal.agentId, deviceId: principal.deviceId,
      session: message.session, scope: p.scope, nodeIds: [...(p.nodeIds || [])].sort(), recovery: !!p.recovery };
    const owner = hash(canonical(scope)), acl = hash(canonical(allowed));
    let saved, offset = 0;
    if (p.cursor) {
      if (!/^[a-f0-9]{64}:\d+$/.test(p.cursor) || !p.version) fail('INVALID_ARGUMENT', 'Continuation requires its snapshot version and cursor');
      const [snapshotId, index] = p.cursor.split(':'); offset = Number(index);
      if (!Number.isSafeInteger(offset)) fail('INVALID_ARGUMENT', 'Invalid cursor offset');
      saved = await readJSON(path.join(this.directory, `${snapshotId}.json`), null);
      if (!saved) fail('NOT_FOUND', 'Snapshot is unavailable; restart the read');
      if (saved.owner !== owner || saved.version !== p.version || saved.acl !== acl) fail('FORBIDDEN', 'Snapshot scope or authorization changed');
    } else if (p.version && (saved = await readJSON(path.join(this.directory, `${hash(canonical([owner, acl, p.version]))}.json`), null))) {
      // A caller explicitly pinned this verified version; network availability
      // does not change its contents or relax the current authorization check.
    } else {
      const source = captured || await load();
      if (p.version && p.version !== source.version) {
        const snapshotId = hash(canonical([owner, acl, p.version]));
        saved = await readJSON(path.join(this.directory, `${snapshotId}.json`), null);
        if (!saved) fail('NOT_FOUND', 'Requested version is not retained');
      } else {
        const nodes = source.doc.root ? entries(source.doc.root) : new Map(), selected = [...(p.nodeIds || allowed)].sort();
        for (const id of selected) if (!allowed.includes(id)) fail('FORBIDDEN', 'Node is outside the current grant');
        const items = [];
        for (const id of selected) {
          const entry = nodes.get(id);
          if (!entry) { if (p.nodeIds) fail('NOT_FOUND', 'Requested node is missing'); continue; }
          const node = nodeProjection(entry.node, source.mapVersion || source.version);
          // Keep legacy/user fields in each node; flatten only the tree topology.
          items.push({ node, parentId: entry.parent?.id || null, bucket: entry.bucket || 'root' });
        }
        const { root: _root, ...metadata } = source.doc;
        // Relations and project metadata can contain references outside the grant.
        saved = { owner, acl, version: source.version, items,
          ...(source.recovery ? { mapVersion: source.mapVersion, recovery: source.recovery } : {}),
          metadata: { v: metadata.v, project: metadata.project, bootstrap: metadata.bootstrap,
            flows: relationProjection(metadata.flows, source.mapVersion || source.version).filter(flow => selected.includes(flow.from) && selected.includes(flow.to)) } };
        saved = JSON.parse(JSON.stringify(saved));
        const snapshotId = hash(canonical([owner, acl, saved.version]));
        await withFileLock(path.join(this.directory, `${snapshotId}.lock`), async () => {
          const file = path.join(this.directory, `${snapshotId}.json`), prior = await readJSON(file, null);
          if (prior && canonical(prior) !== canonical(saved)) fail('CONFLICT', 'Snapshot version was reused for different content');
          if (!prior) await atomicWrite(file, encode(saved));
        });
      }
    }
    if (saved.owner !== owner || saved.acl !== acl || hash(canonical([...new Set(await grants())].sort())) !== acl) fail('FORBIDDEN', 'Snapshot authorization changed');
    const pending = saved.recovery?.pendingMessages || [], total = saved.items.length + pending.length;
    if (offset > total) fail('INVALID_ARGUMENT', 'Cursor is outside the snapshot');
    const items = []; let size = Buffer.byteLength(JSON.stringify(saved.metadata)) + 8192;
    const pendingMessages = [];
    if (size > MAX_MESSAGE_BYTES) fail('TOO_LARGE', 'Snapshot metadata exceeds the page budget');
    const combined = [...saved.items, ...pending];
    for (let index = offset; index < Math.min(total, offset + p.limit); index++) {
      const item = combined[index];
      const bytes = Buffer.byteLength(JSON.stringify(item)) + 1;
      if (size + bytes > MAX_MESSAGE_BYTES) {
        if (!items.length && !pendingMessages.length) fail('TOO_LARGE', 'An item exceeds the page budget; move large content to an attachment');
        break;
      }
      (index < saved.items.length ? items : pendingMessages).push(item); size += bytes;
    }
    const next = offset + items.length + pendingMessages.length, snapshotId = hash(canonical([owner, acl, saved.version]));
    return { scope: p.scope, version: saved.version, metadata: saved.metadata, items,
      ...(saved.recovery ? { mapVersion: saved.mapVersion, recovery: { resumeAfterSeq: saved.recovery.resumeAfterSeq, pendingMessages } } : {}),
      nextCursor: next < total ? `${snapshotId}:${next}` : '' };
  }
}
