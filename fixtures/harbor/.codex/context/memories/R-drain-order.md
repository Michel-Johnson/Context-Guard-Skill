# R-drain-order

- node: N122

Gateway 关闭顺序：先拒绝新的 agent 请求，再排空 active session 的 tool 事件，最后才停 WS。drain 窗口内到达的 pairing 批准必须进队列而不是丢弃。不要在 drain 里同步读磁盘上的整份 transcript；只送已经在内存里的 final 事件。排空超时默认 8s，超时后记 B-drain-race 而不是再延长窗口。Linux node 的 systemd stop 必须走同一条 drain，不要 kill -9 Gateway。
