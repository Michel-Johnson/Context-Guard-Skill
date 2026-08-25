# 怎么找到该读的那一段

人改图仍写 `map.json`。Agent 不要把整份 map 读进上下文。先打开小文件，再按上面的指针跳。

1. **改某个源码**：打开 `owns-index.json`，找到卡号，再打开 `cards/卡号.md`。需要上面几层的规矩：看卡片里的 `chain`，按需打开那些 `cards/`。
2. **修某个坏例**：打开 `bugs/B20.md`（里面写了挂在哪张卡），再打开那张 `cards/`。链上的记忆按 `chain` 往上走。牵到别的模块：看卡片上的 `related`，再打开那些卡。related 是能往返的邻居，不必分谁指向谁。
3. **图改过之后**：`python3 scripts/map_owns.py cards` 重新写出 `cards/` 和 `owns-index.json`。
