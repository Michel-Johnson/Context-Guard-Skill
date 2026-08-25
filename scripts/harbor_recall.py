#!/usr/bin/env python3
"""Build the Harbor fixture repo and compare record layouts for agent recall.

Subcommands:
  project  write fixtures/harbor source + eval layouts
  eval     run retrieval queries and write REPORT.md

Layouts differ in where prose lives. owns stays on the map in every layout so
the variable is storage/index, not missing ownership.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARBOR = ROOT / "fixtures" / "harbor"
EVAL = ROOT / "fixtures" / "harbor-eval"
sys.path.insert(0, str(ROOT / "scripts"))
from map_owns import lookup, norm_repo_path, own_score, walk_nodes  # noqa: E402


def mem(mid: str, text: str, *, long: bool = False) -> dict:
    return {"id": mid, "text": text, "state": "success", "long": long}


def bug(bid: str, title: str, node: str, body: dict, *, status: str = "open", sessions=None, files=None) -> dict:
    return {
        "id": bid,
        "title": title,
        "status": status,
        "node": node,
        "sessions": sessions or [],
        "files": files or [],
        "body": body,
    }


def node(nid, title, purpose, *, kind=None, owns=None, memories=None, bugs=None, children=None, inbox=None):
    kind = kind or ("module" if str(nid)[:1] in "MT" else "work")
    return {
        "id": nid,
        "title": title,
        "kind": kind,
        "purpose": purpose,
        "state": "dirty",
        "owns": list(owns or []),
        "memories": list(memories or []),
        "bugs": list(bugs or []),
        "dormant": [],
        "files": [],
        "children": list(children or []),
        **({"_inbox": list(inbox or [])} if inbox else {}),
    }


LONG_DRAIN = (
    "Gateway 关闭顺序：先拒绝新的 agent 请求，再排空 active session 的 tool 事件，"
    "最后才停 WS。drain 窗口内到达的 pairing 批准必须进队列而不是丢弃。"
    "不要在 drain 里同步读磁盘上的整份 transcript；只送已经在内存里的 final 事件。"
    "排空超时默认 8s，超时后记 B-drain-race 而不是再延长窗口。"
    "Linux node 的 systemd stop 必须走同一条 drain，不要 kill -9 Gateway。"
)

BUGS = {
    "B-clip": bug(
        "B-clip",
        "长会话未裁剪导致超时",
        "N111",
        {
            "现象": "一次 agent 调用卡住，直到 Gateway 超时。",
            "触发": "同一渠道会话连续工具调用，transcripts 未裁剪。",
            "根因": "session.ts 在进入 tool loop 前没有按 token 预算切片。",
            "修复": "",
            "守卫": "超过预算的会话进入 tool loop 前必须先 clip；用超长 transcript 夹具可复现超时。",
            "证据": "docs/shots/session-timeout.png",
        },
        sessions=["S-h01"],
        files=[{"path": "docs/shots/session-timeout.png"}],
    ),
    "B-tool-orphan": bug(
        "B-tool-orphan",
        "工具事件找不到 session",
        "N112",
        {
            "现象": "工具已执行，渠道收不到 final。",
            "触发": "tools.ts 写回时 session id 被换成 run id。",
            "根因": "工具结果必须写回打开它的那条 session，不能另开 transcript。",
            "修复": "",
            "守卫": "工具事件的 session id 必须等于 inbound 消息的 session id。",
            "证据": "",
        },
    ),
    "B-auth-none": bug(
        "B-auth-none",
        "非 loopback 误开 auth.mode=none",
        "N121",
        {
            "现象": "把 Gateway 绑到局域网后，共享密钥整段被关掉。",
            "触发": "auth.mode=none 且监听地址不是 127.0.0.1。",
            "根因": "none 只允许 loopback；私有入口一旦非回环就必须校验。",
            "修复": "",
            "守卫": "非 loopback 启动时拒绝 none，或启动日志出现明确拒绝。",
            "证据": "",
        },
    ),
    "B-drain-race": bug(
        "B-drain-race",
        "关闭时 active session 排空竞态",
        "N122",
        {
            "现象": "重启 Gateway 后偶发丢 final 事件。",
            "触发": "shutdown drain 与新的 agent 请求交错。",
            "根因": "drain 未先拒绝新请求。",
            "修复": "",
            "守卫": "关闭期间新请求失败；已有 session 的 final 仍送达。",
            "证据": "",
        },
    ),
    "B-tunnel": bug(
        "B-tunnel",
        "远程 WebChat 必须与 Gateway 同隧道",
        "N222",
        {
            "现象": "远程打开 Control UI 后连错端口，聊天发不出去。",
            "触发": "SSH/Tailscale 只转了 dashboard，没转 Gateway WS。",
            "根因": "WebChat 与 Gateway 必须走同一条隧道。",
            "修复": "",
            "守卫": "远程 WebChat 的 WS 与 Gateway 同 host/隧道；漏配则明确报错。",
            "证据": "docs/shots/tunnel-mismatch.png",
        },
        files=[{"path": "docs/shots/tunnel-mismatch.png"}],
    ),
    "B-lines": bug(
        "B-lines",
        "根上铺开关系线会看不清",
        "N223",
        {
            "现象": "正常看图时生产/消费虚线把模块关系盖住。",
            "触发": "根目录默认画出全部 produce/consume。",
            "根因": "关系线和进入下一页画在同一视图。",
            "修复": "",
            "守卫": "正常视图不画生产/消费线；关系模式下点击只高亮对端。",
            "证据": "",
        },
    ),
    "B-caps": bug(
        "B-caps",
        "Android node caps 策略来源不一致",
        "N321",
        {
            "现象": "同一条 required-commands，policy-config 与 policy-source 一个过一个不过。",
            "触发": "Android node 配对后执行受限命令。",
            "根因": "两套策略文件对 required-commands 判断分叉。",
            "修复": "",
            "守卫": "同一 fixtures 命令在两套策略下结论相同。",
            "证据": "",
        },
    ),
    "B-dm": bug(
        "B-dm",
        "DM 渠道默认配对提示易被忽略",
        "N421",
        {
            "现象": "操作者以为渠道一连上就能聊，消息卡在 pairing 队列。",
            "触发": "Slack/Telegram 私聊，未知发送者。",
            "根因": "能私聊的渠道默认要配对未知发送者。",
            "修复": "",
            "守卫": "未知发送者的第一条消息进配对队列，不进 session。",
            "证据": "",
        },
    ),
    "B-escape": bug(
        "B-escape",
        "沙箱外的插件 shell 等同本机权限",
        "N512",
        {
            "现象": "未沙箱插件可以读到 vault 文件。",
            "触发": "permissions 未挂上就加载 shell 插件。",
            "根因": "插件 stdout 不可信；没有 sandbox 就不能碰身份目录。",
            "修复": "",
            "守卫": "无 sandbox 时拒绝加载 shell 类插件，或 vault 路径对插件不可见。",
            "证据": "",
        },
    ),
    "B-secret-log": bug(
        "B-secret-log",
        "失败日志打印了 vault 原文",
        "N73",
        {
            "现象": "排障日志里出现 token 明文。",
            "触发": "obs/logs 在插件失败分支 dump error.cause。",
            "根因": "身份材料只能在 vault，日志只留脱敏指针。",
            "修复": "",
            "守卫": "失败日志不得出现 vault 目录下的密钥形态字符串。",
            "证据": "",
        },
    ),
    "B-pair-cli": bug(
        "B-pair-cli",
        "CLI 与 Control UI 改的不是同一份配对队列",
        "N421",
        {
            "现象": "dashboard 批准后 CLI 仍显示 pending。",
            "触发": "一边写 packages/identity/pairing-queue.ts，一边写了渠道自己的队列副本。",
            "根因": "openclaw pairing approve 和 Control UI 必须改同一份队列。",
            "修复": "",
            "守卫": "两边读写 packages/identity/pairing-queue.ts，不存在第二份 pending 列表。",
            "证据": "",
        },
    ),
    "B-onboard": bug(
        "B-onboard",
        "onboard 装了 daemon 却没打开 dashboard",
        "N211",
        {
            "现象": "用户以为 CLI 装完就能在浏览器聊。",
            "触发": "cli onboard --install-daemon 成功后没有提示 dashboard URL。",
            "根因": "onboard 负责模型、工作区、Gateway；dashboard 是下一步。",
            "修复": "",
            "守卫": "onboard 成功输出里必须有 dashboard 打开方式。",
            "证据": "",
        },
    ),
}

PLUGINS = ["weather", "browser", "cron", "memory", "shell", "cdp", "tts", "image"]


def plugin_nodes():
    kids = []
    for name in PLUGINS:
        nid = f"N5-{name}"
        owns = [f"packages/plugins/slots/{name}.ts"]
        memories = [
            mem(f"R-{name}-untrusted", f"{name} 插件的 stdout 当不可信输入，不能直接拼进 prompt"),
        ]
        bugs = []
        if name == "shell":
            bugs = [BUGS["B-escape"]]
            # B-escape lives on sandbox node; shell slot only carries the untrusted memory.
            bugs = []
        kids.append(
            node(
                nid,
                f"packages/plugins/slots/{name}.ts",
                f"{name} 槽：加载、权限、stdout 回写",
                owns=owns,
                memories=memories,
            )
        )
    return kids


def harbor_tree():
    n223a = node(
        "N223a",
        "renderCard",
        "大方卡只露标题和一句用途，不印文件清单",
        memories=[mem("R-card", "模块卡不要印 owns 清单，那是检查器的事")],
        bugs=[BUGS["B-lines"]],
    )
    return node(
        "T0",
        "Harbor",
        "自己设备上的操作平台：Gateway 管会话，控制面给人看，节点在远端执行",
        kind="module",
        memories=[
            mem("R-root", "一个 Gateway 管会话、工具、事件和渠道连接"),
        ],
        children=[
            node(
                "M1",
                "Gateway 运行时",
                "会话、工具、鉴权、排空；入口是 apps/gateway/server.ts",
                owns=["apps/gateway/"],
                memories=[
                    mem("R-gw-only", "每台主机一个 Gateway；渠道会话只由它打开"),
                ],
                children=[
                    node(
                        "M11",
                        "会话与工具",
                        "session.ts 打开会话，tools.ts 把结果写回同一 session",
                        owns=["apps/gateway/session.ts", "apps/gateway/tools.ts"],
                        children=[
                            node(
                                "N111",
                                "apps/gateway/session.ts",
                                "打开渠道会话；进 tool loop 前裁剪 transcript",
                                owns=["apps/gateway/session.ts"],
                                memories=[
                                    mem("R-clip", "transcripts 必须在进入 tool loop 前按预算裁剪"),
                                ],
                                bugs=[BUGS["B-clip"]],
                            ),
                            node(
                                "N112",
                                "apps/gateway/tools.ts",
                                "工具调用与结果写回，不另开 transcript",
                                owns=["apps/gateway/tools.ts"],
                                memories=[
                                    mem("R-tool-same", "工具结果写回打开它的那条 session"),
                                ],
                                bugs=[BUGS["B-tool-orphan"]],
                            ),
                        ],
                    ),
                    node(
                        "M12",
                        "鉴权与排空",
                        "auth.ts 管 none/loopback，drain.ts 管关闭顺序",
                        children=[
                            node(
                                "N121",
                                "apps/gateway/auth.ts",
                                "监听地址与 auth.mode 的约束",
                                owns=["apps/gateway/auth.ts"],
                                memories=[
                                    mem("R-auth-none", "非 loopback 禁止 auth.mode=none"),
                                ],
                                bugs=[BUGS["B-auth-none"]],
                            ),
                            node(
                                "N122",
                                "apps/gateway/drain.ts",
                                "关闭时先拒绝新请求再排空 session",
                                owns=["apps/gateway/drain.ts"],
                                memories=[
                                    mem("R-drain-order", LONG_DRAIN, long=True),
                                ],
                                bugs=[BUGS["B-drain-race"]],
                            ),
                        ],
                    ),
                    node(
                        "N130",
                        "apps/gateway/server.ts",
                        "HTTP 与 WS 同端口；/healthz 在同进程",
                        owns=["apps/gateway/server.ts"],
                        memories=[mem("R-same-port", "HTTP 和 WS 必须同端口，不要另起 widget 服务")],
                    ),
                ],
            ),
            node(
                "M2",
                "控制面",
                "CLI / TUI / dashboard / 远程隧道，给人看和操作",
                owns=["apps/control/"],
                children=[
                    node(
                        "M21",
                        "本地入口",
                        "cli.ts 做 onboard，tui.ts 做终端会话",
                        children=[
                            node(
                                "N211",
                                "apps/control/cli.ts",
                                "onboard：模型、工作区、可选 daemon",
                                owns=["apps/control/cli.ts"],
                                memories=[
                                    mem("R-onboard", "onboard --install-daemon 做模型、工作区、Gateway；下一步才是 dashboard"),
                                ],
                                bugs=[BUGS["B-onboard"]],
                            ),
                            node(
                                "N212",
                                "apps/control/tui.ts",
                                "终端里的会话列表，不托管 WebChat",
                                owns=["apps/control/tui.ts"],
                            ),
                        ],
                    ),
                    node(
                        "M22",
                        "仪表盘",
                        "dashboard.ts 静态资源，webchat.ts 聊，canvas.ts 看图",
                        children=[
                            node(
                                "N221",
                                "apps/control/dashboard.ts",
                                "Control UI 静态入口",
                                owns=["apps/control/dashboard.ts"],
                            ),
                            node(
                                "N222",
                                "apps/control/webchat.ts",
                                "浏览器聊天；远程必须与 Gateway 同隧道",
                                owns=["apps/control/webchat.ts"],
                                memories=[
                                    mem("R-tunnel", "远程 WebChat 必须与 Gateway 同隧道（同一条 SSH/Tailscale）"),
                                ],
                                bugs=[BUGS["B-tunnel"]],
                            ),
                            node(
                                "N223",
                                "apps/control/canvas.ts",
                                "单文件画布；假数据，不弹原生对话框",
                                owns=["apps/control/canvas.ts"],
                                memories=[
                                    mem("R-canvas", "画布交互不使用 window.prompt / confirm"),
                                ],
                                inbox=[n223a],
                            ),
                        ],
                    ),
                    node(
                        "M23",
                        "远程",
                        "tunnel.ts 把 dashboard 和 Gateway WS 绑在同一条隧道",
                        children=[
                            node(
                                "N231",
                                "apps/control/tunnel.ts",
                                "SSH/Tailscale 端口对齐",
                                owns=["apps/control/tunnel.ts"],
                                memories=[
                                    mem("R-tunnel-impl", "漏转 WS 端口时要在 UI 报错，不要默默连 localhost"),
                                ],
                            ),
                        ],
                    ),
                ],
            ),
            node(
                "M3",
                "节点",
                "Linux / Android / macOS 远端执行面",
                owns=["apps/nodes/"],
                children=[
                    node(
                        "M31",
                        "Linux 节点",
                        "连接、远程命令、常驻 daemon",
                        owns=["apps/nodes/linux/"],
                        children=[
                            node("N311", "apps/nodes/linux/connect.ts", "配对与能力声明", owns=["apps/nodes/linux/connect.ts"]),
                            node("N312", "apps/nodes/linux/exec.ts", "远程命令；走 Gateway session", owns=["apps/nodes/linux/exec.ts"]),
                            node("N313", "apps/nodes/linux/daemon.ts", "systemd --user 常驻", owns=["apps/nodes/linux/daemon.ts"]),
                        ],
                    ),
                    node(
                        "M32",
                        "Android 节点",
                        "caps 与 policy 必须读同一来源",
                        owns=["apps/nodes/android/"],
                        children=[
                            node(
                                "N321",
                                "apps/nodes/android/caps.ts",
                                "required-commands 能力",
                                owns=["apps/nodes/android/caps.ts"],
                                bugs=[BUGS["B-caps"]],
                            ),
                            node(
                                "N322",
                                "apps/nodes/android/policy.ts",
                                "policy-config / policy-source",
                                owns=["apps/nodes/android/policy.ts"],
                                memories=[mem("R-caps-one", "policy-config 与 policy-source 对 required-commands 必须同结论")],
                            ),
                        ],
                    ),
                    node(
                        "M33",
                        "macOS 节点",
                        "桌面伴侣连接，不在此托管 Gateway",
                        children=[
                            node("N331", "apps/nodes/macos/connect.ts", "伴侣配对", owns=["apps/nodes/macos/connect.ts"]),
                        ],
                    ),
                ],
            ),
            node(
                "M4",
                "渠道",
                "入站消息当不可信输入；私聊默认配对",
                owns=["apps/channels/"],
                memories=[
                    mem("R-untrusted-in", "渠道把入站消息当不可信输入"),
                ],
                children=[
                    node(
                        "M41",
                        "入站",
                        "slack / telegram / webhook 适配",
                        children=[
                            node("N411", "apps/channels/slack.ts", "Slack 适配", owns=["apps/channels/slack.ts"]),
                            node("N412", "apps/channels/telegram.ts", "Telegram 适配", owns=["apps/channels/telegram.ts"]),
                            node("N413", "apps/channels/webhook.ts", "Webhook 入站", owns=["apps/channels/webhook.ts"]),
                        ],
                    ),
                    node(
                        "M42",
                        "配对",
                        "pairing.ts 与 identity 队列是同一份",
                        children=[
                            node(
                                "N421",
                                "apps/channels/pairing.ts",
                                "未知发送者进配对队列",
                                owns=["apps/channels/pairing.ts"],
                                memories=[
                                    mem("R-dm", "能私聊的渠道默认要配对未知发送者；第一条消息进配对队列，不进 session"),
                                ],
                                bugs=[BUGS["B-dm"], BUGS["B-pair-cli"]],
                            ),
                        ],
                    ),
                ],
            ),
            node(
                "M5",
                "插件",
                "注册、沙箱、权限，再挂各槽文件",
                owns=["packages/plugins/"],
                children=[
                    node(
                        "M51",
                        "运行时",
                        "registry / sandbox / permissions",
                        children=[
                            node(
                                "N511",
                                "packages/plugins/registry.ts",
                                "槽位加载表",
                                owns=["packages/plugins/registry.ts"],
                            ),
                            node(
                                "N512",
                                "packages/plugins/sandbox.ts",
                                "没有 sandbox 不能碰身份目录",
                                owns=["packages/plugins/sandbox.ts"],
                                memories=[mem("R-sandbox", "未沙箱时工具等同本机权限，不能加载 shell 类插件")],
                                bugs=[BUGS["B-escape"]],
                            ),
                            node(
                                "N513",
                                "packages/plugins/permissions.ts",
                                "插件能力与路径允许表",
                                owns=["packages/plugins/permissions.ts"],
                            ),
                        ],
                    ),
                    node("M52", "插件槽", "每个槽一份 ts，stdout 不可信", children=plugin_nodes()),
                ],
            ),
            node(
                "M6",
                "身份",
                "vault、allowlist、配对队列",
                owns=["packages/identity/"],
                children=[
                    node(
                        "N61",
                        "packages/identity/vault.ts",
                        "密钥只放 vault，公开 context 只留指针",
                        owns=["packages/identity/vault.ts"],
                        memories=[mem("R-vault", "密钥不进 map.json / 日志 / README")],
                    ),
                    node("N62", "packages/identity/allowlist.ts", "谁可以连 Gateway", owns=["packages/identity/allowlist.ts"]),
                    node(
                        "N63",
                        "packages/identity/pairing-queue.ts",
                        "CLI 与 Control UI 的同一份队列",
                        owns=["packages/identity/pairing-queue.ts"],
                    ),
                ],
            ),
            node(
                "M7",
                "可观测",
                "transcripts / metrics / logs",
                owns=["packages/obs/"],
                memories=[mem("R-obs-clean", "失败留证据，成功清临时文件")],
                children=[
                    node(
                        "N71",
                        "packages/obs/transcripts.ts",
                        "会话记录落地；不是裁剪预算本身",
                        owns=["packages/obs/transcripts.ts"],
                        memories=[mem("R-retain", "transcript 保留 7 天，裁剪预算在 session.ts")],
                    ),
                    node("N72", "packages/obs/metrics.ts", "tool 延迟与 drain 超时", owns=["packages/obs/metrics.ts"]),
                    node(
                        "N73",
                        "packages/obs/logs.ts",
                        "失败日志脱敏",
                        owns=["packages/obs/logs.ts"],
                        bugs=[BUGS["B-secret-log"]],
                    ),
                ],
            ),
        ],
    )


FLOWS = [
    {"from": "M1", "to": "M4", "label": "渠道入站进 Gateway session"},
    {"from": "M1", "to": "M5", "label": "工具经沙箱执行"},
    {"from": "M1", "to": "M3", "label": "远端节点执行"},
    {"from": "M2", "to": "M1", "label": "控制面连 Gateway WS"},
    {"from": "M4", "to": "M6", "label": "未知发送者进配对队列"},
    {"from": "M5", "to": "M6", "label": "插件不得读 vault"},
    {"from": "M1", "to": "M7", "label": "session 写 transcript"},
    {"from": "M23", "to": "M1", "label": "隧道同时转 dashboard 与 WS"},
    # 箭头指向挂坏例的那张卡：只许顺着箭头离开时会漏；当往返则能找到。
    {"from": "N231", "to": "N222", "label": "隧道把 WS 交给 WebChat"},
    {"from": "N61", "to": "N512", "label": "vault 被沙箱挡住"},
]


QUERIES = [
    {
        "id": "edit-session",
        "kind": "edit-file",
        "path": "apps/gateway/session.ts",
        "must_mem": ["R-clip", "R-gw-only"],
        "must_bug": ["B-clip"],
        "note": "文件编辑：要拿到本节点裁剪规则和祖先「会话只由 Gateway 打开」",
    },
    {
        "id": "edit-auth",
        "kind": "edit-file",
        "path": "apps/gateway/auth.ts",
        "must_mem": ["R-auth-none"],
        "must_bug": ["B-auth-none"],
        "note": "精确 owns 应打到 N121，不要停在 apps/gateway/ 目录主人 M1",
    },
    {
        "id": "edit-webchat",
        "kind": "edit-file",
        "path": "apps/control/webchat.ts",
        "must_mem": ["R-tunnel"],
        "must_bug": ["B-tunnel"],
        "note": "目录主人是 apps/control/，文件主人应赢",
    },
    {
        "id": "edit-linux-connect",
        "kind": "edit-file",
        "path": "apps/nodes/linux/connect.ts",
        "must_mem": [],
        "must_bug": [],
        "must_node": "N311",
        "note": "三层目录 owns：nodes/ vs linux/ vs 文件",
    },
    {
        "id": "edit-canvas",
        "kind": "edit-file",
        "path": "apps/control/canvas.ts",
        "must_mem": ["R-canvas"],
        "must_bug": [],
        "forbid_mem": ["R-card"],
        "note": "inbox 里的 renderCard 没有 owns；改 canvas.ts 不应自动灌入子函数记忆",
    },
    {
        "id": "edit-shell-slot",
        "kind": "edit-file",
        "path": "packages/plugins/slots/shell.ts",
        "must_mem": ["R-shell-untrusted"],
        "must_bug": [],
        "note": "槽文件有自己的卡；沙箱坏例在 N512，改槽不应默认打开 B-escape",
    },
    {
        "id": "edit-sandbox",
        "kind": "edit-file",
        "path": "packages/plugins/sandbox.ts",
        "must_mem": ["R-sandbox"],
        "must_bug": ["B-escape"],
        "note": "真正改沙箱时才加载逃逸坏例",
    },
    {
        "id": "edit-handbook",
        "kind": "edit-file",
        "path": "docs/handbook.md",
        "must_mem": [],
        "must_bug": [],
        "expect_miss": True,
        "note": "没有 owns 的文档：查找应失败，而不是退回根上把整仓记忆灌进来",
    },
    {
        "id": "edit-drain",
        "kind": "edit-file",
        "path": "apps/gateway/drain.ts",
        "must_mem": ["R-drain-order"],
        "must_bug": ["B-drain-race"],
        "note": "长记忆：切片加载只要这一段，整图加载会把所有节点散文一起读进来",
    },
    {
        "id": "symptom-none",
        "kind": "symptom",
        "needle": "auth.mode=none",
        "must_mem": ["R-auth-none"],
        "must_bug": ["B-auth-none"],
        "note": "按现象搜：owns 帮不上，要能扫坏例正文/短记忆",
    },
    {
        "id": "symptom-tunnel",
        "kind": "symptom",
        "needle": "同隧道",
        "must_mem": ["R-tunnel"],
        "must_bug": ["B-tunnel"],
        "note": "中文现象词应打到 webchat 卡，而不是整份登记册",
    },
    {
        "id": "symptom-pairing",
        "kind": "symptom",
        "needle": "配对队列",
        "must_bug": ["B-dm", "B-pair-cli"],
        "must_mem": ["R-dm"],
        "note": "一词多例：应拿到两条坏例，而不是整个渠道模块的入站适配器",
    },
]


GRAPH_QUERIES = [
    {
        "id": "fix-tunnel",
        "kind": "fix-bug",
        "path": "apps/control/webchat.ts",
        "must_mem": ["R-tunnel", "R-tunnel-impl"],
        "must_bug": ["B-tunnel"],
        "note": "坏例挂在 WebChat 上，漏转端口要报错写在隧道那张卡；箭头是隧道→WebChat",
    },
    {
        "id": "fix-sandbox",
        "kind": "fix-bug",
        "path": "packages/plugins/sandbox.ts",
        "must_mem": ["R-sandbox", "R-vault"],
        "must_bug": ["B-escape"],
        "note": "修沙箱逃逸需要身份卡上「密钥不进日志」；箭头是 vault→沙箱",
    },
    {
        "id": "fix-session",
        "kind": "fix-bug",
        "path": "apps/gateway/session.ts",
        "must_mem": ["R-clip", "R-gw-only"],
        "must_bug": ["B-clip"],
        "forbid_mem": [
            "R-weather-untrusted",
            "R-shell-untrusted",
            "R-vault",
            "R-untrusted-in",
        ],
        "note": "这条链上就够；若把 Gateway 每一层邻居都打开，会灌进插件和渠道",
    },
]


def collect(n, acc=None, parent=None):
    acc = acc if acc is not None else []
    acc.append((n, parent))
    for c in n.get("children") or []:
        collect(c, acc, n)
    for c in n.get("_inbox") or []:
        collect(c, acc, n)
    return acc


def source_paths(tree):
    paths = set()
    for n, _ in collect(tree):
        for o in n.get("owns") or []:
            if o.endswith("/"):
                continue
            paths.add(o)
    paths.add("docs/handbook.md")
    paths.add("docs/shots/session-timeout.png")
    paths.add("docs/shots/tunnel-mismatch.png")
    paths.add("README.md")
    return sorted(paths)


def bug_md(b: dict) -> str:
    body = b["body"]
    lines = [
        f"# {b['id']} {b['title']}",
        "",
        f"- node: {b['node']}",
        f"- status: {b['status']}",
        f"- 现象: {body.get('现象','')}",
        f"- 触发: {body.get('触发','')}",
        f"- 根因: {body.get('根因','')}",
        f"- 修复: {body.get('修复','')}",
        f"- 守卫: {body.get('守卫','')}",
        f"- 证据: {body.get('证据','')}",
        "",
    ]
    return "\n".join(lines)


def mem_md(m: dict, nid: str) -> str:
    return f"# {m['id']}\n\n- node: {nid}\n\n{m['text']}\n"


def stub_bug(b: dict) -> dict:
    return {
        "id": b["id"],
        "title": b["title"],
        "status": b["status"],
        "sessions": b.get("sessions") or [],
        "files": b.get("files") or [],
        "record": f".codex/context/bugs/{b['id']}.md",
    }


def clone_tree(n: dict, *, memories="short", bugs="stub") -> dict:
    """memories: short|full|none  bugs: stub|full|none"""
    out = {k: n[k] for k in n if k not in ("children", "_inbox", "memories", "bugs")}
    mems = []
    if memories != "none":
        for m in n.get("memories") or []:
            item = {"id": m["id"], "text": m["text"], "state": m["state"]}
            if m.get("long") and memories == "short":
                item["text"] = m["text"].split("。")[0] + "。"
                item["record"] = f".codex/context/memories/{m['id']}.md"
            mems.append(item)
    out["memories"] = mems
    if bugs == "none":
        out["bugs"] = []
    elif bugs == "stub":
        out["bugs"] = [stub_bug(b) for b in n.get("bugs") or []]
    else:
        out["bugs"] = [
            {**stub_bug(b), "body": b["body"], "desc": b["body"].get("现象", "")}
            for b in n.get("bugs") or []
        ]
    out["children"] = [clone_tree(c, memories=memories, bugs=bugs) for c in n.get("children") or []]
    if n.get("_inbox"):
        out["_inbox"] = [clone_tree(c, memories=memories, bugs=bugs) for c in n["_inbox"]]
    return out


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def iter_bugs(tree):
    for n, _ in collect(tree):
        for b in n.get("bugs") or []:
            yield n, b


def iter_mems(tree):
    for n, _ in collect(tree):
        for m in n.get("memories") or []:
            yield n, m


def owns_index(tree):
    rows = []
    for n, _ in collect(tree):
        for o in n.get("owns") or []:
            rows.append({"path": o, "node": n["id"], "kind": n["kind"], "title": n["title"]})
    return {"owns": rows}


def project_sources(tree) -> None:
    if HARBOR.exists():
        for p in HARBOR.rglob("*"):
            if p.is_file() and ".codex" not in p.parts:
                # keep going; we overwrite
                pass
    for rel in source_paths(tree):
        dest = HARBOR / rel
        if rel.endswith(".png"):
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(b"PNG fixture\n")
            continue
        if rel.endswith(".md"):
            write_text(dest, f"# {rel}\n\nHarbor fixture document. Not owned by a map node.\n")
            continue
        write_text(dest, f"// Harbor fixture: {rel}\nexport const path = {rel!r};\n")
    write_text(
        HARBOR / "README.md",
        "# Harbor fixture\n\n"
        "假仓，用来比较 Context Guard 记录怎么存、Agent 怎么找。"
        "活地图默认用 B 方案（桩 + `bugs/*.md`）。"
        "对照布局在 `fixtures/harbor-eval/layouts/`。\n",
    )


def project_layout_a(tree) -> Path:
    dest = EVAL / "layouts" / "A-monolith" / ".codex" / "context"
    doc = {
        "v": 1,
        "project": "harbor",
        "layout": "A-monolith",
        "root": clone_tree(tree, memories="full", bugs="full"),
        "flows": FLOWS,
    }
    write_json(dest / "map.json", doc)
    return dest


def project_layout_b(tree) -> Path:
    dest = EVAL / "layouts" / "B-stub-files" / ".codex" / "context"
    doc = {
        "v": 1,
        "project": "harbor",
        "layout": "B-stub-files",
        "root": clone_tree(tree, memories="short", bugs="stub"),
        "flows": FLOWS,
    }
    write_json(dest / "map.json", doc)
    for _, b in iter_bugs(tree):
        write_text(dest / "bugs" / f"{b['id']}.md", bug_md(b))
    for n, m in iter_mems(tree):
        if m.get("long"):
            write_text(dest / "memories" / f"{m['id']}.md", mem_md(m, n["id"]))
    write_json(dest / "owns-index.json", owns_index(tree))
    write_text(
        dest / "records.md",
        "Harbor B：map 是索引，短记忆在节点上，长记忆和坏例正文在文件里。\n",
    )
    return dest


def project_layout_c(tree) -> Path:
    dest = EVAL / "layouts" / "C-flat" / ".codex" / "context"
    doc = {
        "v": 1,
        "project": "harbor",
        "layout": "C-flat",
        "root": clone_tree(tree, memories="none", bugs="none"),
        "flows": FLOWS,
    }
    # keep owns on the tree for fair path lookup of *nodes*, but no record text
    owned = clone_tree(tree, memories="none", bugs="none")
    doc["root"] = owned
    write_json(dest / "map.json", doc)
    mem_lines = ["# Memories dump\n"]
    for n, m in iter_mems(tree):
        mem_lines.append(f"## {m['id']} ({n['id']})\n\n{m['text']}\n")
    write_text(dest / "memories.md", "\n".join(mem_lines))
    case_lines = ["# Bad Case Register\n", "## Active Cases\n"]
    for n, b in iter_bugs(tree):
        case_lines.append(f"### {b['id']}: {b['title']}\n")
        case_lines.append(f"- Roadmap nodes: {n['id']}")
        case_lines.append(f"- Scope: {', '.join(n.get('owns') or [])}")
        for k, v in b["body"].items():
            case_lines.append(f"- {k}: {v}")
        case_lines.append("")
    write_text(dest / "bad-cases.md", "\n".join(case_lines) + "\n")
    return dest


def node_md(n: dict) -> str:
    lines = [
        f"# {n['id']} {n['title']}",
        "",
        f"- kind: {n['kind']}",
        f"- purpose: {n['purpose']}",
        f"- owns: {', '.join(n.get('owns') or []) or '(none)'}",
        "",
        "## 记忆",
        "",
    ]
    if not n.get("memories"):
        lines.append("（无）\n")
    for m in n.get("memories") or []:
        lines.append(f"### {m['id']}\n\n{m['text']}\n")
    lines.append("## Bug\n")
    if not n.get("bugs"):
        lines.append("（无）\n")
    for b in n.get("bugs") or []:
        lines.append(bug_md(b))
    return "\n".join(lines)


def project_layout_d(tree) -> Path:
    dest = EVAL / "layouts" / "D-mirror" / ".codex" / "context"
    slim = clone_tree(tree, memories="none", bugs="none")
    write_json(dest / "map.json", {"v": 1, "project": "harbor", "layout": "D-mirror", "root": slim, "flows": FLOWS})
    for n, _ in collect(tree):
        write_text(dest / "nodes" / f"{n['id']}.md", node_md(n))
    write_json(dest / "owns-index.json", owns_index(tree))
    return dest


def project_layout_e(tree) -> Path:
    """Path index + per-node cards + record files. Agent should not open map.json."""
    dest = EVAL / "layouts" / "E-path-index" / ".codex" / "context"
    write_json(dest / "owns-index.json", owns_index(tree))
    for n, parent in collect(tree):
        card = {
            "id": n["id"],
            "parent": None if parent is None else parent["id"],
            "title": n["title"],
            "kind": n["kind"],
            "owns": n.get("owns") or [],
            "memories": [
                {
                    "id": m["id"],
                    "text": (m["text"].split("。")[0] + "。") if m.get("long") else m["text"],
                    "record": f".codex/context/memories/{m['id']}.md" if m.get("long") else None,
                }
                for m in n.get("memories") or []
            ],
            "bugs": [stub_bug(b) for b in n.get("bugs") or []],
        }
        write_json(dest / "nodes" / f"{n['id']}.json", card)
    for _, b in iter_bugs(tree):
        write_text(dest / "bugs" / f"{b['id']}.md", bug_md(b))
    for n, m in iter_mems(tree):
        if m.get("long"):
            write_text(dest / "memories" / f"{m['id']}.md", mem_md(m, n["id"]))
    slim = clone_tree(tree, memories="none", bugs="none")
    write_json(
        dest / "map.json",
        {
            "v": 1,
            "project": "harbor",
            "layout": "E-path-index",
            "root": slim,
            "flows": FLOWS,
            "note": "E lookup must use owns-index.json + nodes/*.json, not this map.",
        },
    )
    return dest


def live_harbor_context(tree) -> None:
    """Harbor fake repo uses B as its live context."""
    import shutil

    src = EVAL / "layouts" / "B-stub-files" / ".codex"
    dest = HARBOR / ".codex"
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(src, dest)


class ReadLog:
    """Index bytes are scanned to find the answer. Payload is what would enter the model."""

    def __init__(self):
        self.index_files: list[str] = []
        self.index_bytes = 0
        self.payload_files: list[str] = []
        self.payload_bytes = 0
        self.payload_parts: list[str] = []

    def read_index(self, path: Path) -> str:
        data = path.read_text(encoding="utf-8")
        self.index_files.append(path.name)
        self.index_bytes += len(data.encode("utf-8"))
        return data

    def add_payload(self, text: str, *, name: str = "slice") -> None:
        self.payload_files.append(name)
        self.payload_bytes += len(text.encode("utf-8"))
        self.payload_parts.append(text)

    def read_payload(self, path: Path) -> str:
        data = path.read_text(encoding="utf-8")
        self.add_payload(data, name=path.name)
        return data

    def blob(self) -> str:
        return "\n".join(self.payload_parts)


def parse_ids(text: str) -> tuple[set[str], set[str]]:
    mems = set(re.findall(r"\bR-[A-Za-z0-9_-]+\b", text))
    bugs = set(re.findall(r"\bB-[A-Za-z0-9_-]+\b", text))
    return mems, bugs


def slim_node(n: dict) -> dict:
    return {
        "id": n.get("id"),
        "title": n.get("title"),
        "kind": n.get("kind"),
        "purpose": n.get("purpose"),
        "owns": n.get("owns") or [],
        "memories": n.get("memories") or [],
        "bugs": n.get("bugs") or [],
    }


def emit_chain_nodes(log: ReadLog, doc: dict, hit: dict) -> None:
    root = doc.get("root") or doc
    for n, chain in walk_nodes(root):
        if n.get("id") != hit.get("node_id"):
            continue
        payload = {
            "node": slim_node(n),
            "ancestors": [slim_node(a) for a in chain[:-1]],
        }
        log.add_payload(json.dumps(payload, ensure_ascii=False), name="slice")
        return


def emit_hit(log: ReadLog, hit: dict, ctx: Path) -> None:
    log.add_payload(json.dumps(hit, ensure_ascii=False), name="hit")
    records = []
    for m in hit.get("memories") or []:
        if m.get("record"):
            records.append(m["record"])
    for b in hit.get("bugs") or []:
        records.append(b.get("record") or f".codex/context/bugs/{b.get('id')}.md")
    for a in hit.get("ancestors") or []:
        for m in a.get("memories") or []:
            if m.get("record"):
                records.append(m["record"])
        for b in a.get("bugs") or []:
            records.append(b.get("record") or f".codex/context/bugs/{b.get('id')}.md")
    seen = set()
    for rec in records:
        name = Path(rec).name
        folder = "memories" if "/memories/" in rec.replace("\\", "/") else "bugs"
        f = ctx / folder / name
        key = str(f)
        if key in seen or not f.exists():
            continue
        seen.add(key)
        log.read_payload(f)


def strategy_all_map(ctx: Path, _q: dict) -> ReadLog:
    log = ReadLog()
    log.read_payload(ctx / "map.json")
    return log


def strategy_owns_map_slice(ctx: Path, q: dict) -> ReadLog:
    log = ReadLog()
    doc = json.loads(log.read_index(ctx / "map.json"))
    if not q.get("path"):
        return log
    hit = lookup(doc, q["path"])
    if hit:
        emit_chain_nodes(log, doc, hit)
    return log


def strategy_b_owns(ctx: Path, q: dict) -> ReadLog:
    log = ReadLog()
    doc = json.loads(log.read_index(ctx / "map.json"))
    if not q.get("path"):
        return log
    hit = lookup(doc, q["path"])
    if hit:
        emit_hit(log, hit, ctx)
    return log


def pick_index_row(idx: dict, path: str) -> dict | None:
    best, score_v = None, 0
    for row in idx.get("owns") or []:
        s = own_score(row["path"], path)
        if s > score_v:
            score_v, best = s, row
        elif s == score_v and best and row.get("kind") == "work" and best.get("kind") != "work":
            best = row
    return best if score_v else None


def strategy_e_index(ctx: Path, q: dict) -> ReadLog:
    log = ReadLog()
    idx = json.loads(log.read_index(ctx / "owns-index.json"))
    path = norm_repo_path(q.get("path") or "")
    if not path:
        return log
    row = pick_index_row(idx, path)
    if not row:
        return log
    chain = []
    nid = row["node"]
    seen = set()
    while nid and nid not in seen:
        seen.add(nid)
        card_path = ctx / "nodes" / f"{nid}.json"
        if not card_path.exists():
            break
        card = json.loads(log.read_payload(card_path))
        chain.append(card)
        nid = card.get("parent")
    hit = {
        "node_id": row["node"],
        "memories": chain[0].get("memories") if chain else [],
        "bugs": chain[0].get("bugs") if chain else [],
        "ancestors": [
            {"id": c["id"], "memories": c.get("memories") or [], "bugs": c.get("bugs") or []}
            for c in chain[1:]
        ],
    }
    emit_hit(log, hit, ctx)
    return log


def strategy_c_all(ctx: Path, _q: dict) -> ReadLog:
    log = ReadLog()
    log.read_payload(ctx / "map.json")
    log.read_payload(ctx / "memories.md")
    log.read_payload(ctx / "bad-cases.md")
    return log


def strategy_grep_files(ctx: Path, q: dict, files: list[Path]) -> ReadLog:
    log = ReadLog()
    needle = q.get("needle") or (Path(q["path"]).stem if q.get("path") else "")
    if not needle:
        return log
    for f in files:
        if not f.exists():
            continue
        text = f.read_text(encoding="utf-8")
        log.index_files.append(f.name)
        log.index_bytes += len(text.encode("utf-8"))
        if needle in text:
            log.add_payload(text, name=f.name)
    return log


def strategy_d_owns(ctx: Path, q: dict) -> ReadLog:
    log = ReadLog()
    doc = json.loads(log.read_index(ctx / "map.json"))
    if not q.get("path"):
        return log
    hit = lookup(doc, q["path"])
    if not hit:
        return log
    for a in hit.get("ancestors") or []:
        f = ctx / "nodes" / f"{a['id']}.md"
        if f.exists():
            log.read_payload(f)
    f = ctx / "nodes" / f"{hit['node_id']}.md"
    if f.exists():
        log.read_payload(f)
    return log


def strategy_hybrid(ctx: Path, q: dict) -> ReadLog:
    if q.get("kind") != "symptom":
        return strategy_b_owns(ctx, q)
    log = ReadLog()
    needle = q.get("needle") or ""
    doc = json.loads(log.read_index(ctx / "map.json"))
    root = doc.get("root") or doc
    for n, _ in walk_nodes(root):
        for m in n.get("memories") or []:
            blob = json.dumps(m, ensure_ascii=False)
            rec = m.get("record")
            if rec:
                f = ctx / "memories" / Path(rec).name
                if f.exists():
                    blob += "\n" + f.read_text(encoding="utf-8")
            if needle and needle in blob:
                log.add_payload(blob, name=m.get("id") or "mem")
                if rec:
                    f = ctx / "memories" / Path(rec).name
                    if f.exists():
                        log.read_payload(f)
        for b in n.get("bugs") or []:
            f = ctx / "bugs" / f"{b.get('id')}.md"
            body = f.read_text(encoding="utf-8") if f.exists() else json.dumps(b, ensure_ascii=False)
            log.index_bytes += len(body.encode("utf-8"))
            if needle and needle in body:
                log.add_payload(body, name=b.get("id") or "bug")
    return log


STRATEGIES = [
    ("A-all", "A-monolith", strategy_all_map),
    ("A-owns-slice", "A-monolith", strategy_owns_map_slice),
    ("B-owns+files", "B-stub-files", strategy_b_owns),
    ("B-hybrid", "B-stub-files", strategy_hybrid),
    ("C-all", "C-flat", strategy_c_all),
    ("C-grep", "C-flat", lambda ctx, q: strategy_grep_files(ctx, q, [ctx / "memories.md", ctx / "bad-cases.md"])),
    ("D-owns+nodes", "D-mirror", strategy_d_owns),
    ("E-index+files", "E-path-index", strategy_e_index),
]


def find_node(doc: dict, nid: str):
    root = doc.get("root") or doc
    for n, chain in walk_nodes(root):
        if n.get("id") == nid:
            return n, chain
    return None, []


def flow_partners(doc: dict, nid: str, mode: str) -> set[str]:
    found: set[str] = set()
    for f in doc.get("flows") or []:
        a, b = f.get("from"), f.get("to")
        if mode == "out" and a == nid:
            found.add(b)
        elif mode == "in" and b == nid:
            found.add(a)
        elif mode == "undirected":
            if a == nid:
                found.add(b)
            if b == nid:
                found.add(a)
    found.discard(nid)
    return {x for x in found if x}


def emit_node_only(log: ReadLog, n: dict, ctx: Path) -> None:
    log.add_payload(json.dumps(slim_node(n), ensure_ascii=False), name=str(n.get("id")))
    for m in n.get("memories") or []:
        rec = m.get("record")
        if rec:
            f = ctx / "memories" / Path(rec).name
            if f.exists():
                log.read_payload(f)
    for b in n.get("bugs") or []:
        f = ctx / "bugs" / f"{b.get('id')}.md"
        if f.exists():
            log.read_payload(f)


def strategy_graph(ctx: Path, q: dict, *, hop: str) -> ReadLog:
    """hop: none | out | undirected | ancestor-undirected"""
    log = ReadLog()
    doc = json.loads(log.read_index(ctx / "map.json"))
    if not q.get("path"):
        return log
    hit = lookup(doc, q["path"])
    if not hit:
        return log
    emit_hit(log, hit, ctx)
    if hop == "none":
        return log
    seeds = [hit["node_id"]]
    if hop == "ancestor-undirected":
        seeds = [hit["node_id"]] + [a["id"] for a in (hit.get("ancestors") or [])]
        mode = "undirected"
    elif hop == "out":
        mode = "out"
    else:
        mode = "undirected"
    seen = {hit["node_id"], *(a["id"] for a in (hit.get("ancestors") or []))}
    for seed in seeds:
        for pid in flow_partners(doc, seed, mode):
            if pid in seen:
                continue
            seen.add(pid)
            n, _ = find_node(doc, pid)
            if n:
                emit_node_only(log, n, ctx)
    return log


GRAPH_STRATEGIES = [
    ("只读这条链", "none"),
    ("只顺着箭头离开这张卡", "out"),
    ("这张卡的往返一跳", "undirected"),
    ("链上每一层都打开邻居", "ancestor-undirected"),
]


def score(q: dict, log: ReadLog) -> dict:
    text = log.blob()
    mems, bugs = parse_ids(text)
    must_m = set(q.get("must_mem") or [])
    must_b = set(q.get("must_bug") or [])
    forbid = set(q.get("forbid_mem") or [])
    rec_m = len(must_m & mems) / len(must_m) if must_m else 1.0
    rec_b = len(must_b & bugs) / len(must_b) if must_b else 1.0
    leak = sorted(forbid & mems)
    miss = q.get("expect_miss")
    extra_m = sorted(m for m in mems - must_m - forbid if m.startswith("R-"))
    extra_b = sorted(b for b in bugs - must_b if b.startswith("B-"))
    must_n = q.get("must_node")
    node_recall = 1.0 if (not must_n or must_n in text) else 0.0
    if miss:
        if mems or bugs:
            rec_m = rec_b = 0.0
        else:
            rec_m = rec_b = 1.0
    return {
        "query": q["id"],
        "payload_files": len(log.payload_files),
        "payload_bytes": log.payload_bytes,
        "index_files": len(log.index_files),
        "index_bytes": log.index_bytes,
        "mem_recall": rec_m,
        "bug_recall": rec_b,
        "node_recall": node_recall,
        "got_mem": sorted(mems),
        "got_bug": sorted(bugs),
        "extra_mem": extra_m[:12],
        "extra_bug": extra_b[:12],
        "leak_inbox": leak,
    }


def layout_ctx(name: str) -> Path:
    return EVAL / "layouts" / name / ".codex" / "context"


def run_eval() -> dict:
    rows = []
    for strat_name, layout, fn in STRATEGIES:
        ctx = layout_ctx(layout)
        for q in QUERIES:
            log = fn(ctx, q)
            s = score(q, log)
            s["strategy"] = strat_name
            s["layout"] = layout
            s["kind"] = q["kind"]
            rows.append(s)
    return {"rows": rows}


def summarize(result: dict) -> str:
    rows = result["rows"]
    strats = []
    for name, *_ in STRATEGIES:
        if name not in strats:
            strats.append(name)
    lines = [
        "# Harbor 检索实验",
        "",
        "同一份 Harbor 地图和坏例，投影成不同落盘，用同一组问题模拟 Agent 读盘。",
        "`index` 是为了找到答案扫过的字节（例如整份 map.json）；`payload` 是会进模型上下文的切片。",
        "假仓在 `fixtures/harbor/`，布局在 `fixtures/harbor-eval/layouts/`。",
        "",
        "## 问法",
        "",
    ]
    for q in QUERIES:
        lines.append(f"- `{q['id']}`（{q['kind']}）{q['note']}")
    lines += [
        "",
        "## 汇总（平均 payload 字节 / 平均 index 字节 / 记忆召回 / 坏例召回 / inbox 泄漏）",
        "",
        "| 策略 | payload 字节 | index 字节 | payload 文件 | 记忆召回 | 坏例召回 | inbox 泄漏 |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for name in strats:
        subset = [r for r in rows if r["strategy"] == name]
        n = len(subset) or 1
        leaks = sum(1 for r in subset if r["leak_inbox"])
        lines.append(
            "| {name} | {pb:.0f} | {ib:.0f} | {pf:.1f} | {mr:.2f} | {br:.2f} | {leaks} |".format(
                name=name,
                pb=sum(r["payload_bytes"] for r in subset) / n,
                ib=sum(r["index_bytes"] for r in subset) / n,
                pf=sum(r["payload_files"] for r in subset) / n,
                mr=sum(r["mem_recall"] for r in subset) / n,
                br=sum(r["bug_recall"] for r in subset) / n,
                leaks=leaks,
            )
        )
    lines += ["", "## 分题", ""]
    by_q = {}
    for r in rows:
        by_q.setdefault(r["query"], []).append(r)
    for qid, items in by_q.items():
        q = next(x for x in QUERIES if x["id"] == qid)
        lines.append(f"### {qid}")
        lines.append(f"{q['note']}")
        lines.append("")
        lines.append("| 策略 | payload | index | 记忆召回 | 坏例召回 | 多出来的记忆 | 多出来的坏例 | 泄漏 |")
        lines.append("|---|---:|---:|---:|---:|---|---|---|")
        for r in items:
            lines.append(
                "| {strategy} | {payload_bytes} | {index_bytes} | {mem_recall:.2f} | {bug_recall:.2f} | {extra_m} | {extra_b} | {leak} |".format(
                    strategy=r["strategy"],
                    payload_bytes=r["payload_bytes"],
                    index_bytes=r["index_bytes"],
                    mem_recall=r["mem_recall"],
                    bug_recall=r["bug_recall"],
                    extra_m=", ".join(r["extra_mem"][:6]) or "—",
                    extra_b=", ".join(r["extra_bug"][:6]) or "—",
                    leak=", ".join(r["leak_inbox"]) or "—",
                )
            )
        lines.append("")
    lines += [
        "## 怎么读这张表",
        "",
        "- `A-all` / `C-all`：Agent 把整份索引当上下文。召回高，噪声也高；没有 owns 的文件（handbook）也会灌进全仓记忆。",
        "- `A-owns-slice` / `B-owns+files` / `D-owns+nodes`：按文件找卡。改代码这条路对；按现象搜（`symptom-*`）这条路空，因为 owns 不看中文症状。",
        "- `B-hybrid`：改文件走 owns，按现象扫 `bugs/` 和节点短记忆。这是推荐的 Agent 读法。",
        "- `C-grep`：扁平登记册能按词命中，但命中的是整份 `bad-cases.md`，多例会互相污染。",
        "- `E-index+files`：不打开整图，只打开 `owns-index.json` 和祖先卡片。index 字节应明显小于 B 的整份 map。",
        "",
        "可复现：",
        "",
        "```bash",
        "python3 scripts/harbor_recall.py project",
        "python3 scripts/harbor_recall.py eval",
        "```",
        "",
    ]
    return "\n".join(lines) + "\n"


def cmd_project() -> None:
    tree = harbor_tree()
    project_sources(tree)
    project_layout_a(tree)
    project_layout_b(tree)
    project_layout_c(tree)
    project_layout_d(tree)
    project_layout_e(tree)
    live_harbor_context(tree)
    write_json(EVAL / "queries.json", QUERIES)
    n_nodes = len(collect(tree))
    n_bugs = len(list(iter_bugs(tree)))
    n_mems = len(list(iter_mems(tree)))
    n_files = len(source_paths(tree))
    print(f"Harbor nodes={n_nodes} files={n_files} memories={n_mems} bugs={n_bugs}")


def cmd_eval() -> None:
    result = run_eval()
    write_json(EVAL / "last-run.json", result)
    report = summarize(result)
    write_text(EVAL / "REPORT.md", report)
    print(report)


def run_graph_eval() -> dict:
    ctx = layout_ctx("B-stub-files")
    rows = []
    for title, hop in GRAPH_STRATEGIES:
        for q in GRAPH_QUERIES:
            log = strategy_graph(ctx, q, hop=hop)
            s = score(q, log)
            s["strategy"] = title
            s["kind"] = q["kind"]
            rows.append(s)
    return {"rows": rows}


def summarize_graph(result: dict) -> str:
    rows = result["rows"]
    lines = [
        "# 修 bug 时顺着哪条线走",
        "",
        "还是 Harbor 假仓。三种修 bug 的情况，四种读法。",
        "「该拿到」= 这件事真正需要的规矩是否读到；「多读了」= 读进了无关模块。",
        "",
        "## 三种情况",
        "",
    ]
    for q in GRAPH_QUERIES:
        lines.append(f"- `{q['id']}`：{q['note']}")
    lines += ["", "## 结果", ""]
    by_q: dict = {}
    for r in rows:
        by_q.setdefault(r["query"], []).append(r)
    for qid, items in by_q.items():
        q = next(x for x in GRAPH_QUERIES if x["id"] == qid)
        lines.append(f"### {qid}")
        lines.append(q["note"])
        lines.append("")
        lines.append("| 读法 | 该拿的记忆 | 该拿的坏例 | 多读或灌进来的 |")
        lines.append("|---|---:|---:|---|")
        for r in items:
            dumped = r["extra_mem"] + r["leak_inbox"]
            lines.append(
                "| {strategy} | {mem_recall:.0%} | {bug_recall:.0%} | {extra} |".format(
                    strategy=r["strategy"],
                    mem_recall=r["mem_recall"],
                    bug_recall=r["bug_recall"],
                    extra=", ".join(dumped[:8]) or "没有",
                )
            )
        lines.append("")
    lines += [
        "## 人话",
        "",
        "- 只读上下级链：修 WebChat 隧道问题、修沙箱逃逸，会漏掉隔壁卡上的规矩。",
        "- 只许顺着箭头离开这张卡：箭头若指向这张卡，同样漏。给人看的「谁给谁」不能当成 Agent 只许往一个方向走。",
        "- 这张卡能往返找一跳邻居：上面两题能拿到，多读很少。",
        "- 把链上每一层的邻居都打开：修会话裁剪这种本链就够的事，会灌进插件、渠道、身份等无关规矩。",
        "",
        "和讨论稿一致：关系线可以保留「谁给谁」这句话；Agent 加载时当能往返的邻居，而且先只打开**这张卡**的一跳，不要把祖先每一层都铺开。真正「牵到别的模块」以后可以再走下一跳，这次实验还没做按需第二跳。",
        "",
        "```bash",
        "python3 scripts/harbor_recall.py project",
        "python3 scripts/harbor_recall.py eval-graph",
        "```",
        "",
    ]
    return "\n".join(lines) + "\n"


def cmd_eval_graph() -> None:
    result = run_graph_eval()
    write_json(EVAL / "graph-last-run.json", result)
    report = summarize_graph(result)
    write_text(EVAL / "GRAPH.md", report)
    print(report)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("command", choices=["project", "eval", "eval-graph"])
    args = p.parse_args()
    if args.command == "project":
        cmd_project()
        return 0
    if args.command == "eval-graph":
        cmd_eval_graph()
        return 0
    cmd_eval()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
