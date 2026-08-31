import assert from "node:assert/strict";
import { test } from "node:test";
import { clients, getClients, installCommand, invocationPrompt } from "../src/clients.ts";
import { conversationTiming, typedText, getUsages } from "../src/app-usage.ts";
import { getFirstUseStory } from "../src/first-use-story.ts";

test("四客户端安装映射有效，Codex的两个入口使用同一平台", () => {
  assert.deepEqual(clients.map(c => c.label), ["Codex App", "Codex CLI", "Cursor", "Claude Code"]);
  for (const client of clients) assert.match(installCommand(client.id), /--platform (codex|cursor|claude)$/);
  assert.equal(installCommand("codex-app"), installCommand("codex-cli"));
});

test("中英文四客户端在发送前打完命令和正文，反馈在章末前完整", () => {
  for (const language of ["zh", "en"]) for (const client of getClients(language)) {
    for (const usage of [...getUsages(language), ...getFirstUseStory(language).turns]) {
      const t = conversationTiming(usage, client);
      const at = t.sent - 1;
      const text = usage.continuation ? typedText(usage.request, at, t.typing, t.textInterval)
        : typedText(client.invocation, at, t.command, t.commandInterval)
          + typedText(invocationPrompt(client, usage.request).slice(client.invocation.length), at, t.typing, t.textInterval);
      assert.equal(text, usage.continuation ? usage.request : invocationPrompt(client, usage.request), client.id);
      assert.equal(typedText(usage.response, t.result, t.response, t.textInterval), usage.response);
      assert.ok(t.end - t.result >= 600);
      assert.ok(t.selected < t.typing && t.typing < t.sent && t.sent < t.response && t.result < t.end);
    }
  }
});

test("英文流程完整翻译并在示例用户确认后设置英语，不改变中文剧本", () => {
  const english = getFirstUseStory("en");
  const chinese = getFirstUseStory("zh");
  assert.doesNotMatch(JSON.stringify([getClients("en"), getUsages("en"), english]), /\p{Script=Han}/u);
  assert.match(english.turns[0].response, /English or Chinese/);
  assert.equal(english.turns[1].request, "Use English for the records.");
  assert.match(english.turns[1].activity[0].text, /--language en$/);
  assert.match(chinese.turns[1].activity[0].text, /--language zh$/);
  assert.equal(chinese.turns[1].request, "用中文记录。");
  assert.deepEqual(english.chapters.map(c => c.id), chinese.chapters.map(c => c.id));
});

test("文字逐字增长，不产生半个Unicode字符", () => {
  const text = "A中文😀B";
  for (let i = 0; i <= 5; i++) assert.equal(typedText(text, i * 24, 0), Array.from(text).slice(0, i).join(""));
});
