# Cloud Coordinator 对话压缩（第一版）

Cloud Coordinator 使用模型实际返回的输入 token 用量；达到 **500,000 tokens** 后，在完整轮次结束时异步整理旧历史。DeepSeek-V4-Flash 官方公布的窗口为 1M tokens，但此触发值不是请求体大小，也不保证其他模型有同样窗口。缺少可信用量时不按字节推算 token。8 MiB 请求体限制是独立的传输安全边界。

压缩遵循“旧历史摘要 + 最近轮次原样保留”的模式。只整理已完成的旧轮次，至少保留最新人类轮次；不拆开工具调用与结果，不在待执行工具调用或未完成轮次上压缩。已有摘要会同新增旧轮次一起再次整理。摘要最多请求 4096 输出 token，必须完整结束、非空且比源内容短。

`conversation.json` 的原始 `messages`、工具回执、问题答案和审批记录不会删除或改写。`compaction` 仅是发给模型的可验证视图：记录被摘要覆盖的消息边界、原文哈希和摘要；前端仍读取完整对话。模型使用摘要时会被告知它不是新的用户指令，涉及授权或当前 Map 状态必须重新读取权威数据。

压缩结果以原文前缀和原有摘要为条件，在会话空闲时原子提交；若没有安全的旧轮次边界、模型失败或摘要不合格，保留旧视图与原文并记录错误码，不静默裁切。新轮次已开始时丢弃过期摘要，待下一次完整轮次结束后重试。压缩不是对话授权或 Map 发布动作。

设计参考：[Anthropic 按需压缩](https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand)、[Anthropic 后台压缩](https://platform.claude.com/docs/en/build-with-claude/compaction-background)、[DeepSeek token 用量](https://api-docs.deepseek.com/quick_start/token_usage/) 与 [DeepSeek V4 官方介绍](https://deepseek.com/en/news/v4-preview/)。DeepSeek Anthropic 兼容接口未文档化原生 compaction 参数，因此这里是服务端自行生成、验证和保存摘要。
