#!/usr/bin/env python3
"""Build a fake OpenClaw Context Guard store for jump-speed tests.

Writes fixtures/openclaw/.codex/context/ then runs map_owns.py cards.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "fixtures" / "openclaw"
CTX = FIX / ".codex" / "context"


def node(
    nid: str,
    title: str,
    purpose: str,
    *,
    kind: str = "work",
    owns: list[str] | None = None,
    children: list | None = None,
    memories: list[str] | None = None,
    bugs: list[dict] | None = None,
) -> dict:
    return {
        "id": nid,
        "title": title,
        "kind": kind,
        "purpose": purpose,
        "state": "dirty",
        "owns": owns or [],
        "files": [],
        "dormant": [],
        "memories": [{"text": t, "state": "success"} for t in (memories or [])],
        "bugs": bugs or [],
        "children": children or [],
    }


def bug_stub(bid: str, title: str, status: str = "open") -> dict:
    return {
        "id": bid,
        "title": title,
        "status": status,
        "record": f".codex/context/bugs/{bid}.md",
    }


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def bug_files(bid: str, title: str, node_id: str, keys: str, 现象: str, 根因: str, 怎么修: str, 怎么防: str, code: str, status: str) -> None:
    write(
        CTX / "bugs" / f"{bid}.md",
        f"# {bid} {title}\n\n"
        f"- node: {node_id}\n"
        f"- status: {status}\n"
        f"- 现象: {现象}\n"
        f"- keys: {keys}\n"
        f"- fix: .codex/context/fixes/{bid}.md\n"
        f"- card: .codex/context/cards/{node_id}.md\n",
    )
    write(
        CTX / "fixes" / f"{bid}.md",
        f"# {bid} 怎么修\n\n"
        f"- bug: .codex/context/bugs/{bid}.md\n"
        f"- node: {node_id}\n"
        f"- card: .codex/context/cards/{node_id}.md\n"
        f"- status: {status}\n\n"
        f"## 根因\n\n{根因}\n\n"
        f"## 怎么修\n\n{怎么修}\n\n"
        f"## 怎么防\n\n{怎么防}\n\n"
        f"## 代码\n\n- {code}\n\n"
        f"## 证据\n\n- docs/shots/{bid.lower()}.png\n",
    )


def task_file(jid: str, title: str, keys: str, chain: str, card: str, what: str, cmds: list[str], code: list[str]) -> None:
    cmd_lines = "\n".join(f"- `{c}`" for c in cmds)
    code_lines = "\n".join(f"- {p}" for p in code)
    write(
        CTX / "tasks" / f"{jid}.md",
        f"# {jid} {title}\n\n"
        f"- keys: {keys}\n"
        f"- chain: {chain}\n"
        f"- card: .codex/context/cards/{card}.md\n\n"
        f"## 这是哪类活\n\n{what}\n\n"
        f"## 命令\n\n{cmd_lines}\n\n"
        f"## 代码\n\n{code_lines}\n",
    )


def build_map() -> dict:
    b10 = bug_stub("B10", "非 loopback 误开 auth.mode=none")
    b11 = bug_stub("B11", "关闭时 active session 排空竞态")
    b12 = bug_stub("B12", "connect 不是首帧仍保持连接")
    b20 = bug_stub("B20", "长会话上下文膨胀")
    b21 = bug_stub("B21", "未沙箱时工具等同本机权限")
    b22 = bug_stub("B22", "tool JSON 损坏直接炸 run", "fixed")
    b23 = bug_stub("B23", "两种 memory 实现同时写入")
    b30 = bug_stub("B30", "DM 渠道默认配对提示易被忽略")
    b31 = bug_stub("B31", "第二台 Gateway 踢掉 Baileys 会话", "fixed")
    b32 = bug_stub("B32", "pairing CLI 与 Control UI 改两份队列")
    b40 = bug_stub("B40", "新 skill 被合进 core")
    b41 = bug_stub("B41", "MCP 工具复制了一套 agent 路径")
    b50 = bug_stub("B50", "模型扫描把密钥打进日志")
    b60 = bug_stub("B60", "Android node caps 策略来源不一致")
    b61 = bug_stub("B61", "Linux exec 取消杀不到子进程")
    b62 = bug_stub("B62", "Swift 协议模型手写后和 schema 分叉")
    b70 = bug_stub("B70", "远程 Control UI 必须与 Gateway 同隧道")
    b71 = bug_stub("B71", "TUI --local 误当成第二个 Gateway")
    b72 = bug_stub("B72", "doctor --fix 被当成可选项跳过")
    b80 = bug_stub("B80", "allowlist 空时私聊直进 agent")
    b81 = bug_stub("B81", "healthz 在非 loopback 也 200")
    b82 = bug_stub("B82", "event 缺口客户端不刷新导致气泡乱序")
    b83 = bug_stub("B83", "cron 任务在 Gateway 停掉后仍打本机")
    b84 = bug_stub("B84", "插件 dispose 不跑导致热更新泄漏")
    b85 = bug_stub("B85", "iMessage 桥多开抢同一身份")

    root = node(
        "T0",
        "OpenClaw",
        "自己设备上的个人助手：Gateway 管会话、工具、渠道",
        kind="module",
        memories=[
            "跑在自己设备上，在已有聊天渠道里见面",
            "一台主机一个 Gateway",
        ],
        children=[
            node(
                "M1",
                "Gateway",
                "本机长驻进程：协议、会话、工具、渠道的唯一入口",
                kind="module",
                owns=["src/gateway/"],
                memories=["每台主机一个 Gateway；渠道会话只由它打开"],
                children=[
                    node(
                        "M11",
                        "进程与绑定",
                        "绑 127.0.0.1:18789；healthz 与 loopback 校验",
                        kind="module",
                        owns=["src/gateway/server.ts"],
                        children=[
                            node(
                                "N11",
                                "src/gateway/server.ts",
                                "默认绑 127.0.0.1:18789",
                                owns=["src/gateway/server.ts"],
                                bugs=[b10, b81],
                            ),
                            node(
                                "N11b",
                                "src/gateway/healthz.ts",
                                "守护进程探活",
                                owns=["src/gateway/healthz.ts"],
                            ),
                        ],
                    ),
                    node(
                        "M12",
                        "WebSocket 协议",
                        "connect 首帧、req/res/event",
                        kind="module",
                        owns=["src/gateway/protocol/"],
                        children=[
                            node(
                                "N12",
                                "src/gateway/protocol/connect.ts",
                                "首帧必须是 connect",
                                owns=["src/gateway/protocol/connect.ts"],
                                bugs=[b12],
                                memories=["非 JSON 或非 connect 直接断开"],
                            ),
                            node(
                                "N13",
                                "src/gateway/protocol/frames.ts",
                                "副作用方法要求幂等键",
                                owns=["src/gateway/protocol/frames.ts"],
                                bugs=[b82],
                            ),
                            node(
                                "N14",
                                "packages/gateway-protocol",
                                "TypeBox schema，生成 Swift 模型",
                                owns=["packages/gateway-protocol/"],
                            ),
                        ],
                    ),
                    node(
                        "M13",
                        "会话与调度",
                        "agent-runner、sessionKey、每会话队列",
                        kind="module",
                        owns=["src/auto-reply/"],
                        children=[
                            node(
                                "N15",
                                "src/auto-reply/agent-runner.ts",
                                "一轮 turn：accepted → stream → final",
                                owns=["src/auto-reply/agent-runner.ts"],
                                bugs=[b11],
                            ),
                            node(
                                "N16",
                                "src/routing/session-key.ts",
                                "会话键是一等公民",
                                owns=["src/routing/session-key.ts"],
                            ),
                            node(
                                "N17",
                                "src/gateway/queue.ts",
                                "同会话串行，跨会话有上限",
                                owns=["src/gateway/queue.ts"],
                            ),
                        ],
                    ),
                ],
            ),
            node(
                "M2",
                "Agent Runtime",
                "取上下文、选模型、跑工具、写记忆",
                kind="module",
                owns=["packages/agent-core/"],
                bugs=[b20, b21],
                children=[
                    node(
                        "M21",
                        "循环与裁剪",
                        "loop 和进 prompt 前的压缩/截断",
                        kind="module",
                        owns=["packages/agent-core/loop.ts"],
                        children=[
                            node(
                                "N21",
                                "packages/agent-core/loop.ts",
                                "一轮 tool-call 循环",
                                owns=["packages/agent-core/loop.ts"],
                                bugs=[b22],
                            ),
                            node(
                                "N23",
                                "packages/agent-core/compress.ts",
                                "会话卡片压缩",
                                owns=["packages/agent-core/compress.ts"],
                            ),
                            node(
                                "N24",
                                "packages/agent-core/truncate.ts",
                                "长 tool 输出必须切",
                                owns=["packages/agent-core/truncate.ts"],
                            ),
                        ],
                    ),
                    node(
                        "M22",
                        "Memory 槽",
                        "同时只能激活一个 memory 实现",
                        kind="module",
                        owns=["packages/memory-host-sdk/"],
                        children=[
                            node(
                                "N27",
                                "packages/memory-host-sdk/index.ts",
                                "load / search / write",
                                owns=["packages/memory-host-sdk/index.ts"],
                                bugs=[b23],
                            )
                        ],
                    ),
                    node(
                        "M23",
                        "工具与沙箱",
                        "host 派发、sandbox",
                        kind="module",
                        owns=["packages/tools/"],
                        children=[
                            node(
                                "N29",
                                "packages/tools/host.ts",
                                "主会话工具默认在宿主机跑",
                                owns=["packages/tools/host.ts"],
                            ),
                            node(
                                "N2a",
                                "packages/tools/sandbox.ts",
                                "暴露之前必须先开沙箱",
                                owns=["packages/tools/sandbox.ts"],
                            ),
                        ],
                    ),
                ],
            ),
            node(
                "M3",
                "Channels",
                "接到已有聊天渠道",
                kind="module",
                owns=["src/channels/"],
                memories=["能私聊的渠道默认要配对未知发送者"],
                bugs=[b30],
                children=[
                    node(
                        "N31",
                        "src/channels/whatsapp/baileys.ts",
                        "每台主机一个 Baileys 会话",
                        owns=["src/channels/whatsapp/baileys.ts"],
                        bugs=[b31],
                    ),
                    node(
                        "N32",
                        "src/channels/telegram/grammy.ts",
                        "webhook 或 long-poll",
                        owns=["src/channels/telegram/grammy.ts"],
                    ),
                    node(
                        "N38",
                        "src/channels/allowlist.ts",
                        "未知发送者先卡住",
                        owns=["src/channels/allowlist.ts"],
                        bugs=[b80],
                    ),
                    node(
                        "N39",
                        "src/channels/pairing-queue.ts",
                        "配对队列",
                        owns=["src/channels/pairing-queue.ts"],
                    ),
                    node(
                        "N3a",
                        "src/commands/pairing.ts",
                        "CLI 和 Control UI 改同一份队列",
                        owns=["src/commands/pairing.ts"],
                        bugs=[b32],
                    ),
                    node(
                        "N37",
                        "src/channels/imessage.ts",
                        "iMessage 桥",
                        owns=["src/channels/imessage.ts"],
                        bugs=[b85],
                    ),
                ],
            ),
            node(
                "M5",
                "Plugins · Skills · MCP",
                "core 保持瘦；能力默认做插件",
                kind="module",
                owns=["packages/plugin-sdk/", "skills/"],
                memories=["新技能先上 ClawHub，不默认合进 core"],
                children=[
                    node(
                        "N51",
                        "packages/plugin-sdk/lifecycle.ts",
                        "load / register / dispose",
                        owns=["packages/plugin-sdk/lifecycle.ts"],
                        bugs=[b84],
                    ),
                    node(
                        "N56",
                        "packages/mcp/server.ts",
                        "自己当 MCP server",
                        owns=["packages/mcp/server.ts"],
                        bugs=[b41],
                    ),
                    node(
                        "N59",
                        "skills/",
                        "只留基线 UX；新技能不进 core",
                        owns=["skills/"],
                        bugs=[b40],
                    ),
                ],
            ),
            node(
                "M4",
                "模型与供应商",
                "默认模型、扫描供应商，密钥不能进日志",
                kind="module",
                owns=["src/models/"],
                children=[
                    node(
                        "N43",
                        "src/models/catalog.ts",
                        "模型列表与默认模型",
                        owns=["src/models/catalog.ts"],
                    ),
                    node(
                        "N44",
                        "src/models/scan.ts",
                        "扫描供应商",
                        owns=["src/models/scan.ts"],
                        bugs=[b50],
                    ),
                ],
            ),
            node(
                "M6",
                "Nodes",
                "macOS / iOS / Android / Linux 以 role:node 连上",
                kind="module",
                owns=["apps/"],
                memories=["配对按设备而不是按用户会话"],
                bugs=[b60],
                children=[
                    node(
                        "N61",
                        "apps/macos/GatewayClient.swift",
                        "菜单栏连本机 Gateway",
                        owns=["apps/macos/GatewayClient.swift"],
                    ),
                    node(
                        "N62",
                        "apps/macos/ProtocolModels.swift",
                        "从 schema 生成，禁止手写",
                        owns=["apps/macos/ProtocolModels.swift"],
                        bugs=[b62],
                    ),
                    node(
                        "N65",
                        "apps/android/Node.kt",
                        "caps 与 iOS 对齐",
                        owns=["apps/android/Node.kt"],
                    ),
                    node(
                        "N67",
                        "apps/android/Policy.kt",
                        "policy-config 与 policy-source 必须同判",
                        owns=["apps/android/Policy.kt"],
                    ),
                    node(
                        "N68",
                        "apps/linux/headless.ts",
                        "无 GUI node host",
                        owns=["apps/linux/headless.ts"],
                    ),
                    node(
                        "N69",
                        "apps/linux/exec.ts",
                        "远程命令跑在 Linux node 上",
                        owns=["apps/linux/exec.ts"],
                        bugs=[b61],
                    ),
                ],
            ),
            node(
                "M7",
                "控制面 UI",
                "人操作 Gateway：CLI / TUI / Control UI",
                kind="module",
                owns=["src/commands/", "src/tui/", "apps/control/"],
                children=[
                    node(
                        "N72",
                        "src/commands/onboard.ts",
                        "第一次安装：模型、工作区、daemon",
                        owns=["src/commands/onboard.ts"],
                    ),
                    node(
                        "N78",
                        "src/commands/doctor.ts",
                        "doctor --fix 是配置迁移主路径",
                        owns=["src/commands/doctor.ts"],
                        bugs=[b72],
                    ),
                    node(
                        "N7i",
                        "src/tui/tui.ts",
                        "终端会话主循环",
                        owns=["src/tui/tui.ts"],
                        bugs=[b71],
                    ),
                    node(
                        "N7p",
                        "apps/control/webchat.ts",
                        "Control UI 走同一条隧道",
                        owns=["apps/control/webchat.ts"],
                        bugs=[b70],
                    ),
                    node(
                        "N7e",
                        "src/commands/cron.ts",
                        "定时任务走 Gateway scheduler",
                        owns=["src/commands/cron.ts"],
                        bugs=[b83],
                    ),
                ],
            ),
            node(
                "M8",
                "安全与暴露",
                "握手、allowlist、远程同隧道",
                kind="module",
                owns=["src/security/"],
                memories=["私有入口的 none 模式不能暴露到公网"],
                children=[
                    node(
                        "N81",
                        "src/security/auth.ts",
                        "auth.mode 与 loopback 绑定",
                        owns=["src/security/auth.ts"],
                    ),
                    node(
                        "N82",
                        "src/security/tunnel.ts",
                        "远程 Control UI 与 Gateway 同隧道",
                        owns=["src/security/tunnel.ts"],
                    ),
                ],
            ),
        ],
    )
    return {
        "v": 1,
        "project": "openclaw",
        "root": root,
        "flows": [
            {"from": "M3", "to": "M1", "label": "入站消息"},
            {"from": "M1", "to": "M2", "label": "调度 agent"},
            {"from": "M2", "to": "M1", "label": "stream / final"},
            {"from": "M6", "to": "M1", "label": "node caps"},
            {"from": "M7", "to": "M1", "label": "人操作 Gateway"},
            {"from": "M8", "to": "M7", "label": "远程同隧道"},
        ],
    }


BUGS = [
    ("B10", "非 loopback 误开 auth.mode=none", "N11", "loopback, auth, none, 公网", "把 Gateway 绑到非 loopback 且 auth.mode=none 时，共享密钥校验被整段关掉。", "none 模式只允许 loopback。", "绑定前校验；非 loopback 拒绝 none。", "非 loopback 禁止 auth.mode=none。", "src/gateway/server.ts", "open"),
    ("B11", "关闭时 active session 排空竞态", "N15", "drain, shutdown, session, 竞态", "关掉 Gateway 时新 agent 请求交错，偶发丢 final。", "drain 与入站 agent 没有同一把锁。", "shutdown 先停入站再排空。", "关闭时先拒绝新 run。", "src/auto-reply/agent-runner.ts", "open"),
    ("B12", "connect 不是首帧仍保持连接", "N12", "connect, 握手, 断开", "客户端先发 send，连接还活着。", "协议门卫只记日志。", "非 connect 直接断开。", "首帧必须是 connect。", "src/gateway/protocol/connect.ts", "open"),
    ("B20", "长会话上下文膨胀", "M2", "transcript, 超时, 裁剪, 上下文", "transcripts 未裁剪时单次 agent 调用超时。", "进 loop 前没有按预算裁剪。", "compress + truncate 在 admitted 之前。", "进 tool loop 前必须裁剪。", "packages/agent-core/compress.ts", "open"),
    ("B21", "未沙箱时工具等同本机权限", "M2", "sandbox, 权限, 暴露", "Gateway 一暴露，shell 工具就是本机权限。", "默认 host 执行。", "暴露或多人连入前强制开 sandbox。", "先读沙箱指南再暴露。", "packages/tools/sandbox.ts", "open"),
    ("B22", "tool JSON 损坏直接炸 run", "N21", "tool, JSON, 重试", "模型吐出坏 JSON，整轮 run 退出。", "解析失败当致命错误。", "坏 JSON 重试或当 tool error 回写。", "坏 JSON 不能直接炸 run。", "packages/agent-core/loop.ts", "fixed"),
    ("B23", "两种 memory 实现同时写入", "N27", "memory, 单槽, 互斥", "文件 memory 和插件 memory 各写各的。", "单槽互斥没enforce。", "激活第二个时卸掉第一个。", "同时只能激活一个 memory。", "packages/memory-host-sdk/index.ts", "open"),
    ("B30", "DM 渠道默认配对提示易被忽略", "M3", "pairing, DM, 配对, 队列", "操作者以为渠道一连上就能聊，消息卡在配对队列。", "默认配对提示不够显眼。", "卡住时渠道回一条「等待批准」。", "能私聊的渠道默认配对未知发送者。", "src/channels/pairing-queue.ts", "open"),
    ("B31", "第二台 Gateway 踢掉 Baileys 会话", "N31", "whatsapp, baileys, 多实例", "两台 Gateway 抢同一 WhatsApp session 互踢。", "每主机必须单 Gateway。", "第二实例拒绝打开 Baileys。", "每台主机一个 Baileys 会话，只由 Gateway 打开。", "src/channels/whatsapp/baileys.ts", "fixed"),
    ("B32", "pairing CLI 与 Control UI 改两份队列", "N3a", "pairing, CLI, 队列", "命令行批准了，Control UI 还显示待批准。", "两套存储。", "读写同一份 pairing 队列。", "CLI 和 Control UI 改同一份队列。", "src/commands/pairing.ts", "open"),
    ("B40", "新 skill 被合进 core", "N59", "skill, core, ClawHub", "常用 skill 被推进 core 仓库。", "没守 ClawHub 边界。", "从 core 挪回 ClawHub。", "新技能先上 ClawHub，不默认合进 core。", "skills/", "open"),
    ("B41", "MCP 工具复制了一套 agent 路径", "N56", "MCP, tool, 合流", "外部 MCP 工具另走一套 dispatch。", "没并进 host 工具表。", "MCP client 只往同一 tool 表挂。", "MCP 与 runtime tool 路径合流。", "packages/mcp/server.ts", "open"),
    ("B50", "模型扫描把密钥打进日志", "N44", "密钥, 日志, scan, 模型", "scan 供应商时 token 出现在文件日志。", "错误对象整段序列化。", "日志红acted。", "密钥不进日志。", "src/models/scan.ts", "open"),
    ("B60", "Android node caps 策略来源不一致", "M6", "android, policy, caps", "policy-config 与 policy-source 对 required-commands 判断分叉。", "两份策略各算各的。", "单一来源。", "required-commands 不能分叉。", "apps/android/Policy.kt", "open"),
    ("B61", "Linux exec 取消杀不到子进程", "N69", "linux, exec, abort, 取消", "Gateway abort 后 Linux 上命令还在跑。", "取消没传到 node。", "abort 必须杀掉 node 子进程。", "取消时杀子进程。", "apps/linux/exec.ts", "open"),
    ("B62", "Swift 协议模型手写后和 schema 分叉", "N62", "swift, schema, 协议", "iOS 字段和 TypeBox 对不上。", "手写了对等类型。", "只从 schema 生成。", "macOS/iOS 不手写对等类型。", "apps/macos/ProtocolModels.swift", "open"),
    ("B70", "远程 Control UI 必须与 Gateway 同隧道", "N7p", "隧道, Control UI, 远程, ssh", "WebChat 远程连错端口。", "UI 和 Gateway 走了两条隧道。", "同隧道同端口。", "远程 Control UI 与 Gateway 同隧道。", "apps/control/webchat.ts", "open"),
    ("B71", "TUI --local 误当成第二个 Gateway", "N7i", "tui, local, Gateway", "--local 又拉起一套会话存储。", "嵌入式模式没复用已有 Gateway。", "默认连已有 Gateway。", "--local 才嵌入式，不是第二个 Gateway。", "src/tui/tui.ts", "open"),
    ("B72", "doctor --fix 被当成可选项跳过", "N78", "doctor, 迁移, config", "配置迁移没跑，旧键继续生效。", "向导把 doctor 当可选。", "失败回 doctor --fix。", "doctor --fix 是配置迁移主路径。", "src/commands/doctor.ts", "open"),
    ("B80", "allowlist 空时私聊直进 agent", "N38", "allowlist, 私聊, 配对", "空名单被当成「谁都能聊」。", "空值当放行。", "空名单仍要求配对。", "能私聊的渠道默认配对未知发送者。", "src/channels/allowlist.ts", "open"),
    ("B81", "healthz 在非 loopback 也 200", "N11", "healthz, 探活, 暴露", "公网探活成功被当成可以关 auth。", "healthz 不鉴权且暴露过多。", "非 loopback 只返回存活，不含配置。", "探活不能代替鉴权。", "src/gateway/healthz.ts", "open"),
    ("B82", "event 缺口客户端不刷新导致气泡乱序", "N13", "event, 序号, 刷新", "掉包后 UI 气泡顺序乱。", "客户端发现缺口没有刷新。", "缺口必须自己补。", "event 不重放，缺口客户端补。", "src/gateway/protocol/frames.ts", "open"),
    ("B83", "cron 任务在 Gateway 停掉后仍打本机", "N7e", "cron, scheduler, Gateway", "停掉 Gateway 后 cron 还在本机执行。", "cron 没走 Gateway scheduler。", "定时任务只挂 Gateway。", "定时任务走 Gateway scheduler。", "src/commands/cron.ts", "open"),
    ("B84", "插件 dispose 不跑导致热更新泄漏", "N51", "插件, dispose, 热更新", "重载插件后旧 hook 还在。", "更新路径没调 dispose。", "先 dispose 再 load。", "hook：load / register / dispose。", "packages/plugin-sdk/lifecycle.ts", "open"),
    ("B85", "iMessage 桥多开抢同一身份", "N37", "imessage, 多开, 身份", "两个桥进程互踢。", "本机身份渠道不能多开。", "第二实例退出。", "本机身份渠道不能多开。", "src/channels/imessage.ts", "open"),
]


def main() -> int:
    if CTX.exists():
        import shutil

        shutil.rmtree(CTX)
    CTX.mkdir(parents=True)

    doc = build_map()
    write(CTX / "map.json", json.dumps(doc, ensure_ascii=False, indent=2) + "\n")

    for row in BUGS:
        bug_files(*row)

    task_file(
        "J1",
        "本机第一次 onboard",
        "onboard, 安装, daemon, 工作区",
        "T0 > M7 > N72",
        "N72",
        "新机器把助手装上：模型、工作区、可选常驻。",
        ["openclaw onboard --install-daemon", "openclaw doctor --fix"],
        ["src/commands/onboard.ts", "src/commands/doctor.ts"],
    )
    task_file(
        "J2",
        "批准未知发送者",
        "pairing, 批准, DM, 队列",
        "T0 > M3 > N3a",
        "N3a",
        "消息卡在配对队列时，命令行或 Control UI 放行。",
        ["openclaw pairing list", "openclaw pairing approve <id>"],
        ["src/commands/pairing.ts", "src/channels/pairing-queue.ts"],
    )
    task_file(
        "J3",
        "暴露前打开沙箱",
        "sandbox, 暴露, 权限",
        "T0 > M2 > M23 > N2a",
        "N2a",
        "要把 Gateway 给别人连或绑到非 loopback 之前，先开沙箱。",
        ["openclaw config set tools.sandbox true"],
        ["packages/tools/sandbox.ts"],
    )
    task_file(
        "J4",
        "Linux node 常驻",
        "linux, node, systemd, 常驻",
        "T0 > M6 > N68",
        "N68",
        "无桌面机器以 role:node 连上并常驻。",
        ["openclaw node install", "systemctl --user enable --now openclaw-node"],
        ["apps/linux/headless.ts"],
    )
    task_file(
        "J5",
        "远程 Control UI 同隧道",
        "隧道, ssh, Control UI, 远程",
        "T0 > M8 > N82",
        "N82",
        "远程看 WebChat 必须和 Gateway 走同一条隧道。",
        ["ssh -L 18789:127.0.0.1:18789 user@host"],
        ["apps/control/webchat.ts", "src/security/tunnel.ts"],
    )
    task_file(
        "J6",
        "裁剪长会话后再跑 agent",
        "裁剪, transcript, 超时",
        "T0 > M2 > M21 > N23",
        "N23",
        "长聊天超时先查裁剪，不要先加模型窗口。",
        ["openclaw sessions show --id <sid>"],
        ["packages/agent-core/compress.ts", "packages/agent-core/truncate.ts"],
    )
    task_file(
        "J7",
        "从 schema 再生 Swift 模型",
        "swift, schema, 协议",
        "T0 > M1 > M12 > N14",
        "N14",
        "改协议只动 TypeBox，再生成客户端。",
        ["pnpm gen:swift"],
        ["packages/gateway-protocol/", "apps/macos/ProtocolModels.swift"],
    )
    task_file(
        "J8",
        "热更新插件",
        "插件, dispose, 热更新",
        "T0 > M5 > N51",
        "N51",
        "重装插件必须先 dispose。",
        ["openclaw plugins update <id>"],
        ["packages/plugin-sdk/lifecycle.ts"],
    )
    task_file(
        "J9",
        "扫模型供应商且不泄密",
        "模型, scan, 密钥",
        "T0 > M4 > N44",
        "N44",
        "扫描供应商列表，日志不得出现 token。",
        ["openclaw models scan"],
        ["src/models/scan.ts"],
    )
    task_file(
        "J10",
        "WhatsApp 只开一个会话",
        "whatsapp, baileys, 单实例",
        "T0 > M3 > N31",
        "N31",
        "不要第二台 Gateway 再开 Baileys。",
        ["openclaw channels status"],
        ["src/channels/whatsapp/baileys.ts"],
    )
    task_file(
        "J11",
        "doctor 迁移旧配置",
        "doctor, 迁移, config",
        "T0 > M7 > N78",
        "N78",
        "升级后键对不上就跑 doctor --fix，不要手改一份平行配置。",
        ["openclaw doctor --fix"],
        ["src/commands/doctor.ts"],
    )
    task_file(
        "J12",
        "取消 Linux 远程命令",
        "linux, abort, exec",
        "T0 > M6 > N69",
        "N69",
        "人点取消时，node 上的子进程必须退出。",
        ["openclaw agent abort --run <id>"],
        ["apps/linux/exec.ts"],
    )

    sessions = []
    samples = [
        ("装机", "写了 onboard 向导", ["src/commands/onboard.ts"], [], ["J1"]),
        ("私聊没反应", "标了配对队列", ["src/channels/pairing-queue.ts"], ["B30"], ["J2"]),
        ("Gateway 要给同事连", "提醒先开沙箱", ["packages/tools/sandbox.ts"], ["B21"], ["J3"]),
        ("Linux 盒子挂上", "写了 node install", ["apps/linux/headless.ts"], [], ["J4"]),
        ("远程 WebChat 连错", "记下同隧道", ["apps/control/webchat.ts"], ["B70"], ["J5"]),
        ("长聊天超时", "去看裁剪", ["packages/agent-core/compress.ts"], ["B20"], ["J6"]),
        ("iOS 字段对不上", "禁止手写 Swift 模型", ["apps/macos/ProtocolModels.swift"], ["B62"], ["J7"]),
        ("插件重载还在跑旧代码", "补 dispose", ["packages/plugin-sdk/lifecycle.ts"], ["B84"], ["J8"]),
        ("日志里看到 token", "scan 红acted", ["src/models/scan.ts"], ["B50"], ["J9"]),
        ("两台电脑抢 WhatsApp", "锁单实例", ["src/channels/whatsapp/baileys.ts"], ["B31"], ["J10"]),
        ("升级后配置失效", "走 doctor --fix", ["src/commands/doctor.ts"], ["B72"], ["J11"]),
        ("取消远程命令没用", "abort 传到 exec", ["apps/linux/exec.ts"], ["B61"], ["J12"]),
        ("公网误关 auth", "绑定时拒绝 none", ["src/gateway/server.ts"], ["B10"], []),
        ("关掉还丢 final", "drain 加锁", ["src/auto-reply/agent-runner.ts"], ["B11"], []),
        ("空 allowlist 放行", "空名单仍配对", ["src/channels/allowlist.ts"], ["B80"], []),
        ("MCP 两套工具表", "合流进 host", ["packages/mcp/server.ts"], ["B41"], []),
        ("cron 在 Gateway 停后还跑", "定时只挂 scheduler", ["src/commands/cron.ts"], ["B83"], []),
        ("healthz 被当成鉴权", "探活不含配置", ["src/gateway/healthz.ts"], ["B81"], []),
        ("TUI 又起一套存储", "--local 才嵌入", ["src/tui/tui.ts"], ["B71"], []),
        ("skill 推进 core", "改回 ClawHub", ["skills/"], ["B40"], []),
        ("气泡乱序", "缺口刷新", ["src/gateway/protocol/frames.ts"], ["B82"], []),
        ("Android 策略分叉", "单一来源", ["apps/android/Policy.kt"], ["B60"], []),
        ("iMessage 双开", "本机身份不能多开", ["src/channels/imessage.ts"], ["B85"], []),
        ("两种 memory 对写", "单槽互斥", ["packages/memory-host-sdk/index.ts"], ["B23"], []),
        ("坏 JSON 炸 run", "当 tool error", ["packages/agent-core/loop.ts"], ["B22"], []),
        ("pairing UI 和 CLI 不一致", "同一份队列", ["src/commands/pairing.ts"], ["B32"], ["J2"]),
        ("非 connect 还连着", "直接断开", ["src/gateway/protocol/connect.ts"], ["B12"], []),
        ("远程命令 cwd 越界", "caps 根目录", ["apps/linux/exec.ts"], ["B61"], ["J12"]),
        ("Control UI 静态资源和 WS 分端口", "同端口托管", ["src/gateway/server.ts"], [], []),
        ("models 列表不含默认", "catalog 写回默认", ["src/models/catalog.ts"], [], ["J9"]),
    ]
    for i, (human, agent, files, bugs, tasks) in enumerate(samples):
        letter = chr(ord("a") + (i % 26))
        day = 1 + (i // 26)
        sessions.append(
            json.dumps(
                {
                    "id": f"2026-08-{day:02d}-{letter}",
                    "human": human,
                    "agent": agent,
                    "files": files,
                    "bugs": bugs,
                    "tasks": tasks,
                },
                ensure_ascii=False,
            )
        )
    write(CTX / "sessions.jsonl", "\n".join(sessions) + "\n")

    write(
        FIX / "README.md",
        "# OpenClaw 底层夹具（测 jump 速度）\n\n"
        "假的 OpenClaw 项目记忆，格式跟第一版一样：会话、坏例、任务、地图。\n"
        "用来测检索：连跑多次 jump、一次 `--json`。`jump-index.json` 给脚本用，不要整份读进对话。\n\n"
        "重新生成：`python3 scripts/openclaw_fixture.py`\n"
        "计时：`python3 scripts/bench_jump.py`\n",
    )

    sys.path.insert(0, str(ROOT / "scripts"))
    import map_owns

    map_owns.write_cards(FIX)
    write(
        CTX / "FIND.md",
        "# OpenClaw 夹具怎么跳\n\n"
        "这是假的 OpenClaw 记忆，用来测检索速度。不要把整份 map 读进来。\n\n"
        "同时查很多东西时，一次 `--json`，不要连跑 N 次 jump，也不要把 `jump-index.json` 整份读进对话。\n\n"
        "```\n"
        "python3 scripts/map_owns.py jump --root fixtures/openclaw --json "
        '\'{"path":["src/gateway/server.ts"],"bug":["配对"],"task":["隧道"],"last":true}\'\n'
        "python3 scripts/map_owns.py jump --root fixtures/openclaw --path src/gateway/server.ts\n"
        "python3 scripts/map_owns.py jump --root fixtures/openclaw --bug 配对\n"
        "python3 scripts/map_owns.py jump --root fixtures/openclaw --task 隧道\n"
        "python3 scripts/map_owns.py jump --root fixtures/openclaw --last\n"
        "```\n\n"
        "耗时见 `JUMP-SPEED.md`。重新生成：`python3 scripts/openclaw_fixture.py`\n",
    )
    print(FIX)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
