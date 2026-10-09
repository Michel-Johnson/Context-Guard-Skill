import { installedFiles } from './package-contract.mjs';

// 从精确安装白名单导出，不扫描整个工作目录或临时数据。
export function sharedMappings(kind) {
  if (kind === 'core') return [
    ...installedFiles.filter(file => file.startsWith('scripts/shared/') && !file.endsWith('/package.json')).map(file => [file, file.slice('scripts/shared/'.length)]),
    ...installedFiles.filter(file => file.startsWith('skill-reference/') && file !== 'skill-reference/interface-contract-v2.json').map(file => [file, file]),
    ...installedFiles.filter(file => file.startsWith('roles/')).map(file => [file, file]),
    ['skill-reference/interface-contract-v2.json', 'interface-contract-v2.json'],
    ['scripts/shared/package.json', 'package.json'],
  ];
  if (kind === 'workbench') return [
    ...installedFiles.filter(file => file.startsWith('prototype/') && !file.endsWith('/package.json')).map(file => [file, file.slice('prototype/'.length)]),
    ['prototype/package.json', 'package.json'],
  ];
  throw new Error('Unknown shared package kind');
}
export const sharedPackageFiles = kind => sharedMappings(kind).map(([, file]) => file).sort();
