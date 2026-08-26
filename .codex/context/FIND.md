# 怎么找到该读的那一段

人改图仍写 `map.json`。Agent 不要把整份 map 读进上下文。先打开小文件，再按上面的指针跳。

1. **改某个源码**：打开 `owns-index.json`，找到卡号，再打开 `cards/卡号.md`。需要上面几层的规矩：看卡片里的 `chain`，按需打开那些 `cards/`。
2. **修某个坏例**：打开 `bugs/B20.md`。正文只有一份：`node` 是主卡（点 Bug 面板走这条链），`also` 是其他相关卡。每张相关 `cards/` 上都有同一条链接。链上的记忆按 `chain` 往上走。牵到别的模块：看 `related`，或看坏例/记忆上的 `also`。
一条规矩不要复制成两份。整层的事挂共同上级，具体开工卡写在 also 里。
3. **图改过之后**：`python3 scripts/map_owns.py cards` 重新写出 `cards/` 和 `owns-index.json`。
