# Executor 按需读取与收工检查

文档 v1.0.0，方案已批准，上线以交付证据为准。

## 三个阶段

| 阶段 | 有 Cloud | 本地工作 |
| --- | --- | --- |
| 开工 | 轻量导航、项目说明、版本 | 存索引，不复制全 Map |
| 开发 | 新节点/明确刷新按需取 | 复用片段、读真实源码，笔记本地归档 |
| 收工 | 最新索引：挂载子树、已读、直接关联、全局约束 | 看名称，读差异、处理；需求/设计冲突交 Coordinator |

无 Cloud 时同流程读取最新本地 Map。导航默认每页 100 项，--offset 翻页；--node 单片段无子树正文，重名用完整路径，内部键不变。

```sh
context-guard map read --context --root <project> --session <session>
context-guard map read --context --node <模块名称或路径> --mount <模块名称或路径> --root <project> --session <session>
context-guard map context-check --root <project> --session <session>
context-guard map read --context --node <节点名称或路径> --diff --root <project> --session <session>
context-guard map context-check --accept-changes --root <project> --session <session>
```

已读正文用缓存，--refresh 不抹未处理变化；--diff 只比较实际读过的旧正文，未读不编历史。

## 检查输出与收尾

默认每页 20 项，--offset 翻页并报剩余数。仅“名称 — 新增/删除/修改/移动/改名/结构变化/权限变化”，重名加路径；无变化“无变化”，失败“无法检查：原因”且非零退出。不默认输出 ID/hash/版本/正文/diff。

无开工基线失败；旧流程未启用则标未启用，不临时建基线假报无变化。处理后重查，--accept-changes 再读版本，期间变化拒绝；交接/归档/plan-finish 再查，不代替 CAS、人审、文件/通知校验和发布。

范围外只提示结构变化，不读全部正文；隐含依赖仍靠测试/审核，hash 不自动判冲突。

## 实现与兼容边界

Skill 维护工具、FNV-1a 树、缓存及 Hook；内容/子列表不变复用 hash，改动重算相关分支，索引构建前过滤权限。Cloud 仅薄读取适配，不加轮询或 Coordinator 查询。

| HTTP | 输入/返回 |
| --- | --- |
| GET /v1/projects/`<project>`/context?session=`<session>` | 项目/Session 授权，轻量 Main 树及版本，无正文 |
| 同入口 node=`<key>`&version=`<version>` | 该节点/可见事项；版本变化 409 |
| GET /api/context | 注册 Agent、真实 Session 权限、页面草稿门禁，无 Cloud 用本地 |

Device 必须绑定请求 Session，保留节点/事项隔离、Idea 排除。缓存按项目/worktree/Session 隔离在私有运行目录，可重建但不入 Git/包；切源显式 --restart，旧通知待确认则拒新流程。

Cloud 断连保已读缓存但收工失败；Hook 开工建索引，不自动拉全图。会话笔记只本地，旧记录队列原样保留，Map 同步仍原入口。不改 fs-v2.1、事务 v2、Map/Markdown/Session 格式、SHA-256、安全认证/幂等/发布版本；快速 hash 不作安全依据，记忆/结构更新仍原审核。
