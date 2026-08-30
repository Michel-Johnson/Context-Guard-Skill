#!/usr/bin/env python3
"""Keep temporary tests/fake repos off main while retaining approved CI/CD checks."""
from __future__ import annotations

import subprocess
import sys

TEST_MARK = "test-layout"
PRODUCT_TESTS = {"tests/ci-smoke.mjs"}
PRODUCT_FORBIDDEN = (
    "tests/",
    "fixtures/",
)
EVAL_SCRIPTS = {
    "scripts/bench_jump.py",
    "scripts/harbor_recall.py",
    "scripts/openclaw_fixture.py",
    "scripts/score_openclaw_agent.py",
    "scripts/summarize_openclaw_eval.py",
}


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True).strip()


def staged_paths() -> list[str]:
    raw = subprocess.check_output(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR"],
        text=True,
    )
    return [line.strip() for line in raw.splitlines() if line.strip()]


def main() -> int:
    try:
        branch = git("rev-parse", "--abbrev-ref", "HEAD")
    except subprocess.CalledProcessError:
        return 0
    paths = staged_paths()
    if not paths:
        return 0

    if TEST_MARK in branch:
        bad = [p for p in paths if not p.startswith("tests/")]
        if bad:
            print(
                "测试分支只能改 tests/。产品问题回到产品分支修。\n  "
                + "\n  ".join(bad),
                file=sys.stderr,
            )
            return 1
        return 0

    bad = [
        p
        for p in paths
        if (p.startswith(PRODUCT_FORBIDDEN) and p not in PRODUCT_TESTS) or p in EVAL_SCRIPTS
    ]
    if bad:
        print(
            "产品/main 只保留已批准的 CI/CD 测试；临时测试或假仓去 cursor/test-layout-f54e。\n  "
            + "\n  ".join(bad),
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
