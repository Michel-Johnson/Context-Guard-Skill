# tests/

仓库里所有测试都放这里。产品代码不进这一夹。

合并到命令分支（`main`）时，可以：

- **整夹不交** — 命令分支只发 skill，不带测试
- **只交上手测试** — 留 `hands-on/`，丢掉 `eval/` 和 `local/`

| 夹 | 干什么 | 交 git 吗 | 进 npm 包吗 |
| --- | --- | --- | --- |
| `hands-on/` | 别人 clone / 装完就能跑的上手测试 | 建议交 | 交（现在 `npm test` 只跑这里） |
| `eval/` | 假仓、检索对照、计时，给我们自己看检索好不好 | 本分支交；命令分支可丢掉 | 不进 |
| `local/` | 你机器上截的图、临时 dump | **永不交**（已 gitignore） | 不进 |

## `hands-on/` — 上手测试

现在就一件：`npm-install-smoke.sh`。检查装 skill、装 hook、`init` 一个项目。

```bash
npm test
```

## `eval/` — 评测夹具

假仓，不是产品。

```bash
python3 tests/eval/openclaw_fixture.py
python3 tests/eval/bench_jump.py
python3 tests/eval/harbor_recall.py project
python3 tests/eval/harbor_recall.py eval
```

## `local/` — 本地测试

只留在你电脑上。截图、手点工作台的记录、一次性脚本，都丢这里。不要 `git add`。
