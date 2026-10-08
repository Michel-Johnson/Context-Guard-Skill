# 第三方组件说明

本文说明组件来源、版本、用途和本仓库的修改。链接中的第三方许可证与版权声明保留原文，以原文为准。

## JSONParse

- 上游：https://github.com/creationix/jsonparse
- 内置版本：`jsonparse@1.3.1`，文件为 `scripts/shared/vendor/jsonparse.cjs`。
- 修改：将旧式 `Buffer()` 构造函数替换为 Node 18+ 的等价 `Buffer.alloc/from`，解析行为不变。
- MIT 许可证及上游版权声明：
  [licenses/JSONParse-MIT.txt](licenses/JSONParse-MIT.txt).
- 用途：增量解析生产规模的 Cloud 记忆 JSON，避免把整个文件转成一个 JavaScript 字符串。

## Marked

- 上游：https://github.com/markedjs/marked
- 固定版本：npm `marked@15.0.12`，兼容 Node 18；完整性信息记录在 package-lock.json。
- 分发的浏览器模块：`prototype/vendor/marked.mjs`，从 `lib/marked.esm.js` 复制，未改变行为。
- MIT 许可证及上游版权声明：[licenses/Marked-MIT.txt](licenses/Marked-MIT.txt)。
- 用途：仅作 Markdown 词法分析器。Context Guard 构建受限的 DOM 节点，不直接插入生成的 HTML，也不获取远程图片。

## 基于 Ready 的加载动画

- 来源： `Michel-Johnson/Ready@d0771a1c8dc8086f49fbe924c2b5cbb621d0fd8b`,
  `platform/frontend/src/components/WorkingBlot.tsx` 及其图集资源。
- 分发文件： `prototype/coordinator-working-blot.mjs` and
  `prototype/working-blot-atlas.png`，由固定 Cloud UI 包生成。
- 项目维护者已明确授权公开再分发；范围归属与授权声明随共享 UI 包提供，见 [prototype/LICENSES/Ready-redistribution.txt](prototype/LICENSES/Ready-redistribution.txt).

## Portless

- 上游：https://github.com/vercel-labs/portless
- 参考版本：npm `portless@0.15.6`，源码模块 `src/routes.ts`。
- 原始版权声明：Copyright 2025 Vercel Inc.
- 许可证：Apache License 2.0；随包分发的全文见
  [licenses/Portless-Apache-2.0.txt](licenses/Portless-Apache-2.0.txt).
- 派生文件：`scripts/workbench/portless-routes.mjs`。
- 修改：仅保留本地 HTTP 路由存储和名称归属；改用私有文件的原子替换；增加严格的项目与实例校验；移除强制终止、隧道元数据、过期 PID 清理及路由文件锁。写入由单个 Context Guard 代理进程串行处理。

工作台代理、启动适配器和项目绑定代码由 Context Guard 实现，并非完整的 Portless CLI；不包含 TLS、证书安装、局域网访问、隧道或框架启动功能。本文仅说明代码来源，不代表 Vercel 为本项目背书。
