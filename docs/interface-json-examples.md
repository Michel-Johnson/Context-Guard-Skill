# 接口 JSON 示例（draft-1）

> 历史示例，已被 [v2 消息清单](interface-contract-v2.json) 替代；保留供比较，不作为新规范。

以下 24 个示例对应工作台的独立接口节点，仅用于审核数据格式，不是已上线 API。仓库 ID、Session、SHA、hash 与引用均为虚构占位值；hash 实际需要计算，不能照抄。消息之间是独立示例，不是一条完整执行轨迹。

请求与异步通知使用同一消息信封。响应中的 accepted 仅表示持久接收，业务通过/失败另看 decision、verdict 等字段。拒绝响应的具体消息类型映射仍待定。HTTP 地址、鉴权头、完整 JSON Schema 尚待制定。workbench.changed.operations 的 op/set 结构也是待审核提案，不代表当前工作台现有协议。

## sync.heartbeat

```json
{
  "schemaVersion": "draft-1",
  "messageId": "message-sync.heartbeat-demo",
  "type": "sync.heartbeat",
  "repository": {
    "host": "github.com",
    "id": "123456789"
  },
  "payload": {
    "connectionId": "connection-demo",
    "sessions": [
      {
        "sessionId": "session-demo",
        "generation": 1,
        "settledSeq": 10
      }
    ]
  }
}
```

## sync.heartbeat.result

```json
{
  "schemaVersion": "draft-1",
  "messageId": "message-sync.heartbeat.result-demo",
  "type": "sync.heartbeat.result",
  "repository": {
    "host": "github.com",
    "id": "123456789"
  },
  "correlationId": "message-request-demo",
  "payload": {
    "status": "accepted",
    "sessions": [
      {
        "sessionId": "session-demo",
        "generation": 1,
        "latestSeq": 11,
        "ackedSeq": 10,
        "hasPending": true
      }
    ]
  }
}
```

## sync.available

```json
{
  "schemaVersion": "draft-1",
  "messageId": "message-sync.available-demo",
  "type": "sync.available",
  "repository": {
    "host": "github.com",
    "id": "123456789"
  },
  "sessionId": "session-demo",
  "generation": 1,
  "payload": {
    "latestSeq": 11
  }
}
```

## sync.read

```json
{
  "schemaVersion": "draft-1",
  "messageId": "message-sync.read-demo",
  "type": "sync.read",
  "repository": {
    "host": "github.com",
    "id": "123456789"
  },
  "sessionId": "session-demo",
  "generation": 1,
  "payload": {
    "afterSeq": 10,
    "limit": 50,
    "maxBytes": 262144
  }
}
```

## sync.batch

```json
{
  "schemaVersion": "draft-1",
  "messageId": "message-sync.batch-demo",
  "type": "sync.batch",
  "repository": {
    "host": "github.com",
    "id": "123456789"
  },
  "sessionId": "session-demo",
  "generation": 1,
  "correlationId": "message-request-demo",
  "payload": {
    "status": "accepted",
    "commands": [],
    "nextAfterSeq": 10,
    "hasMore": false
  }
}
```

## sync.ack

```json
{
  "schemaVersion": "draft-1",
  "messageId": "message-sync.ack-demo",
  "type": "sync.ack",
  "repository": {
    "host": "github.com",
    "id": "123456789"
  },
  "sessionId": "session-demo",
  "generation": 1,
  "payload": {
    "results": [
      {
        "seq": 11,
        "messageId": "message-command-demo",
        "outcome": "applied",
        "receiptId": "receipt-demo"
      }
    ]
  }
}
```

## sync.ack.result

```json
{
  "schemaVersion": "draft-1",
  "messageId": "message-sync.ack.result-demo",
  "type": "sync.ack.result",
  "repository": {
    "host": "github.com",
    "id": "123456789"
  },
  "sessionId": "session-demo",
  "generation": 1,
  "correlationId": "message-request-demo",
  "payload": {
    "status": "accepted",
    "ackedSeq": 11
  }
}
```

## workbench.changed

```json
{
  "schemaVersion": "draft-1",
  "messageId": "message-workbench.changed-demo",
  "type": "workbench.changed",
  "repository": {
    "host": "github.com",
    "id": "123456789"
  },
  "sessionId": "session-demo",
  "generation": 1,
  "payload": {
    "eventId": "event-demo",
    "baseVersion": "version-10",
    "version": "version-11",
    "operations": [
      {
        "op": "set",
        "nodeId": "node-demo",
        "field": "title",
        "value": "接口设计"
      }
    ]
  }
}
```

## task.interrupted

```json
{
  "schemaVersion": "draft-1",
  "messageId": "message-task.interrupted-demo",
  "type": "task.interrupted",
  "repository": {
    "host": "github.com",
    "id": "123456789"
  },
  "sessionId": "session-demo",
  "generation": 1,
  "taskId": "task-demo",
  "payload": {
    "eventId": "event-interrupt-demo",
    "runId": "run-demo",
    "stage": "implementing",
    "reason": "用户在本地点击停止",
    "occurredAt": "2026-09-05T08:00:00Z"
  }
}
```

## brief.submit

```json
{
  "schemaVersion": "draft-1",
  "messageId": "message-brief.submit-demo",
  "type": "brief.submit",
  "repository": {
    "host": "github.com",
    "id": "123456789"
  },
  "sessionId": "session-demo",
  "generation": 1,
  "taskId": "task-demo",
  "payload": {
    "briefId": "brief-demo",
    "revision": 1,
    "text": "用户安装 Skill 后，可以自动打开工作台。",
    "contentHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
}
```

## brief.decision

```json
{
  "schemaVersion": "draft-1",
  "messageId": "message-brief.decision-demo",
  "type": "brief.decision",
  "repository": {
    "host": "github.com",
    "id": "123456789"
  },
  "sessionId": "session-demo",
  "generation": 1,
  "taskId": "task-demo",
  "correlationId": "message-request-demo",
  "payload": {
    "status": "accepted",
    "briefId": "brief-demo",
    "revision": 1,
    "contentHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "decision": "approved"
  }
}
```

## task.dispatch

```json
{
  "schemaVersion": "draft-1",
  "messageId": "message-task.dispatch-demo",
  "type": "task.dispatch",
  "repository": {
    "host": "github.com",
    "id": "123456789"
  },
  "sessionId": "session-demo",
  "generation": 1,
  "taskId": "task-demo",
  "payload": {
    "briefId": "brief-demo",
    "briefRevision": 1,
    "briefHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "approvalId": "approval-demo",
    "targetSessionId": "session-demo"
  }
}
```

## plan.review.request

```json
{
  "schemaVersion": "draft-1",
  "messageId": "message-plan.review.request-demo",
  "type": "plan.review.request",
  "repository": {
    "host": "github.com",
    "id": "123456789"
  },
  "sessionId": "session-demo",
  "generation": 1,
  "taskId": "task-demo",
  "payload": {
    "planId": "plan-demo",
    "planRevision": 1,
    "planHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "briefRevision": 1,
    "planRef": "plan-demo",
    "rulesVersion": "rules-draft-1"
  }
}
```

## plan.review.result

```json
{
  "schemaVersion": "draft-1",
  "messageId": "message-plan.review.result-demo",
  "type": "plan.review.result",
  "repository": {
    "host": "github.com",
    "id": "123456789"
  },
  "sessionId": "session-demo",
  "generation": 1,
  "taskId": "task-demo",
  "correlationId": "message-request-demo",
  "payload": {
    "status": "accepted",
    "planId": "plan-demo",
    "planRevision": 1,
    "planHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "decision": "approved",
    "issues": []
  }
}
```

## ci.handoff

```json
{
  "schemaVersion": "draft-1",
  "messageId": "message-ci.handoff-demo",
  "type": "ci.handoff",
  "repository": {
    "host": "github.com",
    "id": "123456789"
  },
  "sessionId": "session-demo",
  "generation": 1,
  "taskId": "task-demo",
  "payload": {
    "runId": "run-demo",
    "sourceSha": "cccccccccccccccccccccccccccccccccccccccc",
    "briefRevision": 1,
    "planRevision": 1,
    "ciTodoRef": "ci-todo-demo",
    "unitTestEvidenceRefs": [
      "evidence-unit-demo"
    ]
  }
}
```

## ci.result

```json
{
  "schemaVersion": "draft-1",
  "messageId": "message-ci.result-demo",
  "type": "ci.result",
  "repository": {
    "host": "github.com",
    "id": "123456789"
  },
  "sessionId": "session-demo",
  "generation": 1,
  "taskId": "task-demo",
  "correlationId": "message-request-demo",
  "payload": {
    "status": "accepted",
    "runId": "run-demo",
    "sourceSha": "cccccccccccccccccccccccccccccccccccccccc",
    "verdict": "failed",
    "checks": [
      {
        "testId": "CI-001",
        "ciTodoId": "CI-TODO-001",
        "status": "failed",
        "evidenceRef": "evidence-ci-demo",
        "reproductionRef": "reproduction-demo"
      }
    ]
  }
}
```

## executor.state

```json
{
  "schemaVersion": "draft-1",
  "messageId": "message-executor.state-demo",
  "type": "executor.state",
  "repository": {
    "host": "github.com",
    "id": "123456789"
  },
  "sessionId": "session-demo",
  "generation": 1,
  "payload": {
    "agentId": "agent-demo",
    "state": "busy",
    "activeTaskId": "task-demo"
  }
}
```

## task.deliver

```json
{
  "schemaVersion": "draft-1",
  "messageId": "message-task.deliver-demo",
  "type": "task.deliver",
  "repository": {
    "host": "github.com",
    "id": "123456789"
  },
  "sessionId": "session-demo",
  "generation": 1,
  "taskId": "task-demo",
  "payload": {
    "assignmentId": "assignment-demo",
    "briefId": "brief-demo",
    "briefRevision": 1,
    "briefHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "text": "用户安装 Skill 后，可以自动打开工作台。",
    "contextRefs": [
      "context-demo"
    ]
  }
}
```

## task.received

```json
{
  "schemaVersion": "draft-1",
  "messageId": "message-task.received-demo",
  "type": "task.received",
  "repository": {
    "host": "github.com",
    "id": "123456789"
  },
  "sessionId": "session-demo",
  "generation": 1,
  "taskId": "task-demo",
  "correlationId": "message-request-demo",
  "payload": {
    "status": "accepted",
    "assignmentId": "assignment-demo",
    "deliveryId": "delivery-demo"
  }
}
```

## plan.submit

```json
{
  "schemaVersion": "draft-1",
  "messageId": "message-plan.submit-demo",
  "type": "plan.submit",
  "repository": {
    "host": "github.com",
    "id": "123456789"
  },
  "sessionId": "session-demo",
  "generation": 1,
  "taskId": "task-demo",
  "payload": {
    "assignmentId": "assignment-demo",
    "planId": "plan-demo",
    "planRevision": 1,
    "briefRevision": 1,
    "sourceSha": "cccccccccccccccccccccccccccccccccccccccc",
    "planRef": "plan-demo",
    "planHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  }
}
```

## plan.decision

```json
{
  "schemaVersion": "draft-1",
  "messageId": "message-plan.decision-demo",
  "type": "plan.decision",
  "repository": {
    "host": "github.com",
    "id": "123456789"
  },
  "sessionId": "session-demo",
  "generation": 1,
  "taskId": "task-demo",
  "correlationId": "message-request-demo",
  "payload": {
    "status": "accepted",
    "planId": "plan-demo",
    "planRevision": 1,
    "planHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "decision": "approved",
    "reviewReceiptId": "review-receipt-demo"
  }
}
```

## task.progress

```json
{
  "schemaVersion": "draft-1",
  "messageId": "message-task.progress-demo",
  "type": "task.progress",
  "repository": {
    "host": "github.com",
    "id": "123456789"
  },
  "sessionId": "session-demo",
  "generation": 1,
  "taskId": "task-demo",
  "correlationId": "message-request-demo",
  "payload": {
    "runId": "run-demo",
    "progressSeq": 3,
    "stage": "implementing",
    "summary": "已完成启动入口，正在补单模块测试。"
  }
}
```

## task.handoff

```json
{
  "schemaVersion": "draft-1",
  "messageId": "message-task.handoff-demo",
  "type": "task.handoff",
  "repository": {
    "host": "github.com",
    "id": "123456789"
  },
  "sessionId": "session-demo",
  "generation": 1,
  "taskId": "task-demo",
  "payload": {
    "runId": "run-demo",
    "sourceSha": "cccccccccccccccccccccccccccccccccccccccc",
    "ciTodoRef": "ci-todo-demo",
    "unitTestEvidenceRefs": [
      "evidence-unit-demo"
    ],
    "experienceRefs": [
      "experience-demo"
    ]
  }
}
```

## task.rework

```json
{
  "schemaVersion": "draft-1",
  "messageId": "message-task.rework-demo",
  "type": "task.rework",
  "repository": {
    "host": "github.com",
    "id": "123456789"
  },
  "sessionId": "session-demo",
  "generation": 1,
  "taskId": "task-demo",
  "payload": {
    "runId": "run-demo",
    "sourceSha": "cccccccccccccccccccccccccccccccccccccccc",
    "ciResultRef": "ci-result-demo",
    "failedTestIds": [
      "CI-001"
    ]
  }
}
```
