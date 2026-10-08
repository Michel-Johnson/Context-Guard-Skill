# Executor 按需读取与收工检查

文档版本：v1.0.0。方案已批准；上线状态以交付记录为准。

## 三个阶段

| 阶段 | Cloud | 本地 |
| --- | --- | --- |
| 开工 | 获取轻量导航、项目级说明与版本 | 保存索引；不复制完整 Map 正文 |
| 开发 | 新节点或明确刷新时按需读取 | 复用已读片段，读实际源码，过程写入现有 Session |
| 收工 | 获取最新索引，比较挂载子树、已读节点、直接关联及全局约束 | Executor 看变化名称，再读相关差异并处理；设计或需求冲突交 Coordinator |

`map read --context` 返回导航；加 `--node` 返回单个切片，不附子树正文。名称重名时使用完整模块路径；内部仍使用原节点键定位。导航默认每页 100 项，用 `--offset` 翻页。

```sh
context-guard map read --context --root <project> --session <session>
context-guard map read --context --node <模块名称或路径> --mount <模块名称或路径> --root <project> --session <session>
context-guard map context-check --root <project> --session <session>
context-guard map read --context --node <节点名称或路径> --diff --root <project> --session <session>
context-guard map context-check --accept-changes --root <project> --session <session>
```

已有正文直接使用缓存；`--refresh` 显式刷新，不抹去未处理变化。`--diff` 返回此前实际读过的正文与当前正文；未读过旧正文时明确说明无法还原，不编造历史。

## 检查输出与收尾

默认每页 20 项，只显示“名称 — 新增 / 删除 / 修改 / 移动 / 改名 / 结构变化 / 权限变化”；重名才加模块路径。无变化返回“无变化”，失败返回“无法检查：原因”并以非零退出。剩余项明确说明数量，用 `--offset` 翻页。不默认输出 ID、hash、版本、正文或 diff。

Executor 处理影响后重新检查，再用 `--accept-changes` 确认该次版本；确认前再次读取，版本又变则拒绝。交接、归档和结束 Plan 会再次检查；原有批准、文件校验、通知确认、CAS 和发布权限不替换。

挂载子树及直接关联之外，只提示结构变化，不读取所有正文。没有声明的隐含依赖仍靠测试与审核发现；hash 只提示变化，不能自动判定冲突。

## 实现与兼容边界

Skill 维护工具、FNV-1a 快速 hash 树、缓存和 Hook 流程。正文与子列表不变时复用 hash，变更重算相关分支；权限过滤在构建索引前执行。Cloud 只提供薄读取适配，不增加轮询或 Coordinator 查询流程。

| HTTP 读取入口 | 输入与返回 |
| --- | --- |
| `GET /v1/projects/<project>/context?session=<session>` | 项目与 Session 授权；返回当前 Main 的轻量树及版本，不含正文 |
| 同入口加 `node=<key>&version=<version>` | 只返回该节点及可见事项记录；版本已变返回 409 |
| 本机 `GET /api/context` | 已注册 Agent、实际 Session 授权及页面草稿门禁；未配置 Cloud 时读本地视图 |

Device 必须绑定请求中的 Session；节点权限、其他 Session 事项隔离及 Idea 排除都保留。缓存按项目、工作树和 Session 隔离，放在私有运行目录，可删除重建，不进入 Git 或包。切换来源须明确 `--restart`，不暗中更换基线；旧通知尚待确认时拒绝启动新流程。

未配置 Cloud 时用本地模式；已配置但断连时保留已读片段，收工失败而不是返回无变化。新 Hook 在开工建立索引，开发过程不自动拉全量记忆；兼容的 Session 同步仍在归档与收尾执行。

不改 fs-v2.1、事务 v2、Map、Markdown 模板或 Session 格式。现有 SHA-256 摘要、幂等键、认证和发布版本不变；新 hash 不用于安全判断。执行过程仍归档 Session，不追加到既有 Map 节点；结构提案与项目记忆更新仍走原审核流程。
