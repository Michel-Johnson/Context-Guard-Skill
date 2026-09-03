# CI TODO

- [ ] `sync serve/ensure` 长驻进程、断线重连和 SSE 游标恢复
- [ ] `sync checkpoint` 独立行为
- [x] 显式 `plan-start` / 工具观察 / Map 归档 / `plan-finish` / Stop 流程；Cloud 成功与完成后本地回执丢失重试（`tests/hook-lifecycle.test.mjs`）
- [ ] 工作台 Cloud 状态图标：同步中、已同步、冲突
- [ ] 首次连接冲突时的 `connect --pull` / `connect --push`
- [x] 多意图 signal 拆分、TODO/坏例幂等、分类冲突不写 Map、未分类信号保留（`tests/hook-lifecycle.test.mjs`）
- [x] 归档缺文件、缺验证/评估/范围复核/子 Agent 复核、归档后文件变化均不能完成；已有脏文件再次修改可识别（同上）
- [x] 跨 session inbox 通知、CLI 路径别名入口、空响应及同步失败/冲突拒绝；Windows 不再跳过跨 session 断言（同上）
- [ ] 真实 Codex/Claude/Cursor 完整对话的原生 Hook 触发与交互验收；脚本模拟不等同于客户端验收
- [ ] 同一 session 并行 Hook/CLI 写运行时状态的进程级竞争与崩溃恢复；当前原子文件替换不等于事务锁
- [ ] 任意脚本越出声明目录的实际修改追踪；当前明确标记范围未知并要求 Agent 复核，不声称已自动校验
- [ ] 模型提供的分类、测试证据、节点评估的语义真实性：当前校验必填信息和成功回执，不能证明模型判断正确
