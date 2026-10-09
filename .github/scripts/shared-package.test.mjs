import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sharedMappings, sharedPackageFiles } from './shared-package-contract.mjs';

test('共享包只从 Skill 唯一源码导出，核心不依赖具体后端', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  for (const deps of [pkg.dependencies, pkg.devDependencies]) {
    assert.ok(!Object.keys(deps || {}).some(name => name.startsWith('@michelj/context-guard')));
  }
  for (const kind of ['core', 'workbench']) {
    const files = sharedPackageFiles(kind);
    assert.equal(new Set(files).size, files.length);
    for (const [source, target] of sharedMappings(kind)) {
      assert.equal(fs.lstatSync(source).isFile(), true, source);
      assert.doesNotMatch(target, /(?:^|\/)(?:cloud|plugins|deploy|\.codex|tests|node_modules)(?:\/|$)/);
    }
  }
  assert.ok(sharedPackageFiles('core').includes('interface-contract-v2.json'));
  assert.ok(sharedPackageFiles('core').includes('roles/Coordinator.md'));
  assert.ok(sharedPackageFiles('workbench').includes('working-blot-atlas.png'));
  assert.ok(!sharedPackageFiles('core').some(file => /design-slack|design-cloud-attachments|design-coordinator-compaction/.test(file)));
  assert.throws(() => sharedPackageFiles('unknown'));
});

test('工作台只安装 Coordinator 入口，保留旧 Cursor 组件和后端历史兼容', () => {
  const html = fs.readFileSync('prototype/workbench.html', 'utf8');
  const app = fs.readFileSync('prototype/workbench-app.js', 'utf8');
  assert.match(html, /id="btn-coordinator"/);
  assert.match(app, /if\(connected\) installCoordinatorPanel\(workbenchSync\)/);
  assert.doesNotMatch(html, /id="btn-cursor"/);
  assert.doesNotMatch(app, /installCursorChat|import\(['"]\.\/cursor-chat\.mjs['"]\)/);
  // 历史兼容仍可由既有受限入口读取；不借退役 UI 删除数据或后端。
  assert.ok(sharedPackageFiles('workbench').includes('cursor-chat.mjs'));
  assert.match(fs.readFileSync('prototype/cursor-chat.mjs', 'utf8'), /export function installCursorChat/);
  assert.match(fs.readFileSync('scripts/workbench/server.mjs', 'utf8'), /\/api\/cursor-chat/);
});

function coordinatorProfiles() {
  const roleMapping = sharedMappings('core').filter(([, target]) => target === 'roles/Coordinator.md');
  assert.deepEqual(roleMapping, [['Coordinator.md', 'roles/Coordinator.md']]);
  const source = fs.readFileSync(roleMapping[0][0], 'utf8').replace(/\r\n/g, '\n');
  const marker = /^## 人工对话模式[ \t]*$/gm;
  const headings = [...source.matchAll(marker)];
  assert.equal(headings.length, 1);
  const heading = headings[0];
  return {
    automatic: source.slice(0, heading.index - 1),
    manual: `# Coordinator\n\n${source.slice(heading.index + heading[0].length).trim()}\n`,
  };
}

test('Coordinator 两种独立 profile 保留短概览规则且不增加静态上下文', () => {
  const profiles = coordinatorProfiles();
  assert.ok(profiles.manual.length < profiles.automatic.length / 2, 'manual must retain the existing compact profile boundary');
  // 只校验源分发合同与静态大小；文字匹配不能证明真实模型会遵守。
  for (const [mode, profile] of Object.entries(profiles)) {
    assert.match(profile, /50–100 字/);
    assert.match(profile, /通常不超 150 字/);
    assert.match(profile, /TODO 概览报总数与可识别短名称/);
    assert.match(profile, /同状态只报一次、不漏事项，不附未问 Bug/);
    assert.match(profile, /每轮一份最终答复/);
    assert.match(profile, /结论独立成段.*少量短列表.*段间空行/);
    assert.ok(profile.length <= (mode === 'automatic' ? 2700 : 1280), `${mode} profile must remain smaller than the previous source`);
  }
});

test('Coordinator 短回复不裁掉必要事实详细清单风险或真实技术值', () => {
  for (const profile of Object.values(coordinatorProfiles())) {
    assert.match(profile, /保留必要事实和不确定性/);
    assert.match(profile, /完整清单、详情或必要风险、确认/);
    assert.match(profile, /完整 brief 和执行提示不裁切/);
    const naming = profile.split('\n').filter(line => line.startsWith('对人用短名'));
    assert.equal(naming.length, 1, 'Replace the existing profile rule instead of layering another policy');
    assert.ok(naming[0].length <= 107, 'The naming preference must not enlarge either static profile');
    assert.match(naming[0], /只去测试标签及其编号\/日期、内部ID\/哈希/);
    assert.match(naming[0], /保留业务日期\/版本/);
    assert.doesNotMatch(naming[0], /去测试标签、ID、哈希、日期/);
    assert.doesNotMatch(naming[0], /前缀/);
    assert.match(naming[0], /用途不明不猜/);
    assert.match(naming[0], /同名加描述/);
    assert.match(naming[0], /索要技术编号再给/);
    assert.match(naming[0], /工具参数、链接\/URL、代码、命令、回执和执行提示用原值，不改定位/);
  }
});

test('Coordinator 精简只替换回复风格并保留两种模式的审核与结束门禁', () => {
  const { automatic, manual } = coordinatorProfiles();
  assert.match(automatic, /等待需求审批回执/);
  assert.match(automatic, /安排独立 Tester 验证同一提交/);
  assert.match(automatic, /收到匹配的宿主 `closed` 回报后/);
  assert.match(automatic, /若项目记忆尚未建立.*不得补造项目目标/);
  assert.match(manual, /没有待读写或核对时.*replyComplete=true，成功后结束本轮/);
  assert.match(manual, /进度说明不能设此标记/);
  assert.match(manual, /等待人对指定版本确认；确认回执后才保存 Main TODO\/Bug/);
  assert.match(manual, /不创建、派发或恢复执行 Session/);
  assert.match(manual, /细节、attempt、执行阶段、修改前的状态和版本不足时，读取相关节点或任务/);
});
