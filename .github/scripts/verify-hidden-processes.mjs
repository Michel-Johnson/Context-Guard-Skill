#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

function filesBelow(directory, extensions) {
  const base = path.join(root, directory);
  if (!fs.existsSync(base)) return [];
  const found = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...filesBelow(relative, extensions));
    else if (extensions.has(path.extname(entry.name))) found.push(relative);
  }
  return found;
}

function callText(source, open) {
  let depth = 0, quote = '', lineComment = false, blockComment = false;
  for (let i = open; i < source.length; i++) {
    const char = source[i], next = source[i + 1];
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockComment) { if (char === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (char === '\\') { i++; continue; }
      if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; i++; continue; }
    if (char === '/' && next === '*') { blockComment = true; i++; continue; }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === '(') depth++;
    if (char === ')' && --depth === 0) return source.slice(open, i + 1);
  }
  return null;
}

function lineAt(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function checkJavaScript(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  if (!/(?:node:)?child_process/.test(source)) return;
  const bindings = new Set();
  const childMethods = /^(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)$/;
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](?:node:)?child_process['"]/g)) {
    for (const item of match[1].split(',')) {
      const [original, alias = original] = item.trim().split(/\s+as\s+/);
      if (childMethods.test(original)) bindings.add(alias);
    }
  }
  for (const match of source.matchAll(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\(['"](?:node:)?child_process['"]\)/g)) {
    for (const item of match[1].split(',')) {
      const [original, alias = original] = item.trim().split(/\s*:\s*/);
      if (childMethods.test(original)) bindings.add(alias);
    }
  }
  const originalBindings = [...bindings];
  if (originalBindings.length) {
    const names = originalBindings.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    for (const match of source.matchAll(new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*promisify\\(\\s*(?:${names})\\s*\\)`, 'g'))) bindings.add(match[1]);
  }
  for (const name of bindings) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const match of source.matchAll(new RegExp(`(^|[^\\w$.])${escaped}\\s*\\(`, 'gm'))) {
      const open = match.index + match[0].lastIndexOf('(');
      const call = callText(source, open);
      if (!call) failures.push(`${file}:${lineAt(source, open)} cannot parse ${name} call`);
      else if (source.slice(open + call.length).trimStart().startsWith('{')) continue;
      else if (!/\bwindowsHide\s*:\s*true\b/.test(call)) failures.push(`${file}:${lineAt(source, open)} ${name} must set windowsHide: true`);
    }
  }
  const namespaces = [
    ...source.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"](?:node:)?child_process['"]/g),
    ...source.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(['"](?:node:)?child_process['"]\)/g),
  ].map(match => match[1]);
  for (const namespace of namespaces) {
    const escaped = namespace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const match of source.matchAll(new RegExp(`\\b${escaped}\\.(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\\s*\\(`, 'g'))) {
      const open = match.index + match[0].lastIndexOf('(');
      const call = callText(source, open);
      if (!call) failures.push(`${file}:${lineAt(source, open)} cannot parse child-process call`);
      else if (!/\bwindowsHide\s*:\s*true\b/.test(call)) failures.push(`${file}:${lineAt(source, open)} child-process call must set windowsHide: true`);
    }
  }
}

function checkPython(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  if (!/^\s*import\s+subprocess\b/m.test(source)) return;
  for (const match of source.matchAll(/\bsubprocess\.(?:run|call|check_call|check_output|Popen)\s*\(/g)) {
    const open = match.index + match[0].lastIndexOf('(');
    const call = callText(source, open);
    if (!call) failures.push(`${file}:${lineAt(source, open)} cannot parse subprocess call`);
    else if (!/\bcreationflags\s*=\s*WINDOWS_NO_WINDOW\b/.test(call)) failures.push(`${file}:${lineAt(source, open)} subprocess call must set creationflags=WINDOWS_NO_WINDOW`);
  }
}

const sourceDirectories = ['.github/scripts', 'bin', 'scripts', 'tests'];
for (const file of sourceDirectories.flatMap(directory => filesBelow(directory, new Set(['.js', '.mjs', '.cjs'])))) checkJavaScript(file);
for (const file of sourceDirectories.flatMap(directory => filesBelow(directory, new Set(['.py'])))) checkPython(file);

if (failures.length) throw new Error(`Windows child-process policy failed:\n${failures.join('\n')}`);
console.log('Verified Windows child processes cannot create visible console windows.');
