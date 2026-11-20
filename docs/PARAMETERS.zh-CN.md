# 参数手册

[English](PARAMETERS.md) | [简体中文](PARAMETERS.zh-CN.md) | [返回首页](../README.zh-CN.md)

执行 `node launcher.mjs options PROFILE` 获取实际允许值、风险说明、当前有效值和继承来源。编辑器参考 [schema](../conf/launcher.schema.json)，运行时另有校验。下文 `my-model` 是示例 profile ID。

## 保存与继承

`set PROFILE 分区.字段 值` 接受枚举字符串或 JSON 数值/布尔/数组，先校验选中模型档，再备份原配置并保存。不会修改运行中的模型，不自动清除配置锁，也不改原始 Strata 模型档。

高级参数的 `default` 是继承模型档、进程环境或引擎默认，**不是关闭**。高级覆盖项适配声明的引擎 0.1.59、0.1.60、0.1.62；`options.reference` 为 162 项（0.1.60 基线），非精选控制项只读，不允许任意传入环境变量或命令参数。兼容性和性能仍要实测。

## 基础设置

以下使用 `settings.字段`。数值范围是启动器默认校验范围，不是硬件容量；未覆盖的初值读取原模型档。

| 字段 | 范围/选项 | 解释 |
|---|---|---|
| `context` | 32768-262144 tokens | 总上下文上限，不等于全部驻留显存 |
| `output` | 1024-32768 tokens | 总输出上限，包含思考 |
| `thinking` | 0-24576 tokens | 思考预算，必须小于 output |
| `effort` | off / low / medium / high | 思考强度，与温度不同 |
| `kv` | int8 / k8v4 | KV 格式，k8v4 为 K INT8、V INT4 |
| `kvResident` | 4096-262144 tokens | 请求的 GPU KV 驻留量，不得超过 context；引擎可能按块向上取整 |
| `expertGiB` | 8-50 GiB | 专家 RAM 预算，不是进程总内存 |
| `headroomGiB` | 6-24 GiB | 引擎预算时留出的 RAM 余量，不是必须吃满的目标 |
| `vramMiB` | 0-4096 MiB | 用户显存预留；0 不消除 WDDM、驱动或引擎内部占用 |
| `workers` | 1-12 | CPU 专家 worker 数，越多不一定越快 |
| `spec` | 0-8 | MTP 推测窗口控制；0 时不要求 MTP 资产 |
| `specMinP` | 0-1 | MTP 概率阈值，不是 DFlash2 置信度 |
| `drafting` | mtp / dflash2 | 草稿模式，必须有真实兼容的资产 |
| `port` | 1024-65535 | 本机 loopback API 端口 |
| `visionThreads` | 1-12 | 已有视觉头的 CPU 线程数 |
| `imageTokens` | 64-1024 | 图像 token 设置，不是文字上下文 |

output + 4096 必须严格小于 context。调视觉参数不会凭空增加视觉头。模型档里的 `minimumFreeGiB` 是启动前空闲 RAM 门槛，不是专家预算，也不是运行时内存上限。

有明确需要时，可调整已知数值的校验范围：

```powershell
node launcher.mjs set my-model limits.expertGiB '[8,54]'
node launcher.mjs set my-model settings.expertGiB 52
```

这不证明机器内存足够，也不保证引擎最终分配到这个数字。专家、KV、native 权重、会话缓存、系统和其他应用共同竞争内存，不应只为填满占用图而放宽门槛。

## 采样、DFlash2 与学习

先设置 `sampling.mode=custom` 再修改采样值；`model` 表示不覆盖模型采样设置。

| 采样字段 | 范围 |
|---|---|
| `temperature` | 0-2 |
| `top_p` | 0.01-1 |
| `top_k` | 整数 1-64 |
| `min_p` | 0-1，0 关闭该过滤 |
| `repetition_penalty` | 0.1-2，1 为中性 |
| `presence_penalty`、`frequency_penalty` | 0-2，0 为中性 |
| `penalty_last_n` | 整数 1-131072 |
| `seed` | null 为随机，或整数 1-2147483647 |

温度高不等于思考更多：采样决定选 token，思考预算/强度控制另一部分行为。API 客户端可能覆盖默认值，判断效果前还要核对实际请求。

`draftOptions`：`mode=auto|manual`，`pack=stock|tuned`，`window=2..6`，`confidence=0.05..1`。auto 将窗口和置信度交给引擎，manual 显式传入。tuned 需要 `dflash2.pack`、`model` 及实际验证过的量化/引擎兼容记录和文件，不能拿其他模型的草稿包套用。auto 不保证更快，应在相同任务上比较 TTFT、PP、TG、接受率。

`learning`：默认 `enabled=false`、`reuse=true`、`scope=general|video|coding`、`saveEveryMinutes=1..60`（默认 5）。保存的是专家路由/放置学习，**不是训练模型权重，也不是对话记忆**。复用有身份校验；学习要求缓存自适应有效，`adaptEvery=0` 或 `adaptSwaps=0` 会被拒绝。是否真正保存要看日志，明确停止本次模型时会给它一次有界的保存机会。

## 全部 42 项引擎控制

使用 `engineOptions.键名`。完整枚举、单位、提示和风险见 `options.engineOptions` 与 [生成的 schema](../conf/engine-options.schema.json)。以下列出每项对应位置和重点；没有明确目的时保留 `default`。

| 键名 | 引擎参数/环境变量 | 重点 |
|---|---|---|
| `routePrior` | `STRATA_ROUTE_PRIOR` | off=0、on=1.5；偏向缓存专家，会影响路由和质量 |
| `kva` | `STRATA_KVA` | 注意力近似加速，不是 KV 精度；可能影响长文细节 |
| `vramFree` | `STRATA_VRAM_FREE` | device 请求设备/NVML 预算，实际回退及分配看日志 |
| `tailSkip` | `STRATA_ROUTE_TAIL_SKIP` | 0 关闭、1-9 排名阈值；跳过贡献，不是无损提速 |
| `tailSkipMaxCached` | `STRATA_TAIL_SKIP_MAX_CACHED` | 按缓存专家占比控制默认跳过，不是命中率 |
| `prefillCpuShare` | `STRATA_PREFILL_CPU_SHARE` | 0 / auto / 1，短提示专家工作分给 CPU |
| `pcieFrac` | `--pcie-frac` | 缓存未命中专家中，复制到 GPU 计算的比例 |
| `pcieDefault` | `STRATA_PCIE_FRAC_DEFAULT` | old / auto 规则；显式比例优先 |
| `pcieKRule` | `STRATA_PCIE_K_RULE` | 自动分配路径的自适应 K 规则 |
| `pcieShareMax` | `STRATA_PCIE_SHARE_MAX` | 自动 PCIe 分担比例上限 |
| `hostCore` | `--host-core` | 主线程放置；混合 P/E 核不适合 last |
| `poolAffinity` | `--pool-affinity` | all / auto / p-cores / measure，专家线程亲和性 |
| `poolTasks` | `--pool-tasks` | 任务批数，过多增加调度开销 |
| `auxCpus` | `--aux-cpus` | 辅助线程分配，不会增加核心 |
| `noHostWorker` | `--no-host-worker` | 主线程不加入专家计算 |
| `adaptEvery` | `--adapt-every` | 缓存适应间隔，0 与学习冲突 |
| `adaptSwaps` | `--adapt-swaps` | 每轮交换专家数，0 与学习冲突 |
| `adaptDecay` | `--adapt-decay` | 专家热度衰减，不是重复惩罚 |
| `adaptMinGain` | `--adapt-min-gain` | 新旧专家热度比门槛 |
| `adaptAsync` | `--adapt-async` | 异步适应，不保证不同运行逐位一致 |
| `adaptOverlap` | `STRATA_ADAPT_OVERLAP` | 支持的单卡全 RAM 路径重叠复制；不能与 async/pipeline/lag/nowait/DMA 模式混用 |
| `prefillChunk` | `--prefill` | auto 或精选分块大小；大块更占缓冲，不一定更快 |
| `kvGrow` | `--kv-grow` | KV 按达到的位置增长，不是增大总上下文 |
| `shortRead` | `--short-read` | 短增量走解码窗口的阈值 |
| `prefillHeadAlias` | `--prefill-head-alias` | prefill 暂时卸载再重载 native 输出头 |
| `promptCache` | `--prompt-cache` | RAM 检查点数量，0 关闭 |
| `promptCacheEvery` | `--prompt-cache-every` | 检查点 token 间隔，0 关闭中间检查点 |
| `promptCacheTail` | `--prompt-cache-tail` | 尾部检查点，需要检查点及间隔启用 |
| `promptCacheSpread` | `--prompt-cache-spread` | 检查点分散覆盖历史，而不只留最近部分 |
| `conversationMiB` | `--conversation-cache-mib` | 停放会话的 RAM 预算，与专家/KV 竞争 |
| `conversationSlots` | `--conversation-cache-slots` | 停放槽位，**不是并发解码数** |
| `conversationFloor` | `--conversation-cache-min-free-mib` | 会话缓存操作的空闲 RAM 底线 |
| `conversationMinTokens` | `--conversation-cache-min-tokens` | 可停放会话的最短长度 |
| `conversationParkGain` | `--conversation-cache-park-gain` | 重存会话快照前要求增长的 token 数 |
| `pleIo` | `--ple-io` | direct / mmap / ram；特定模型整张码表可达约 29 GB |
| `pleRowCache` | `--ple-row-cache` | 已读码表行缓存，还包括索引等内存开销 |
| `pleInflight` | `--ple-inflight` | 未完成 SSD 读取数，更多不保证更快 |
| `pleAutoMmap` | `STRATA_PLE_AUTO_MMAP` | 是否允许 direct 慢时在启动探测中改 mmap |
| `suffixDraft` | `--suffix-draft` | 上下文重复查找最短匹配，0 不代表关闭全部草稿 |
| `lookupMaxT` | `--lookup-max-t` | Lookup 扩展窗口，可能额外占图显存 |
| `lookupChain` | `--lookup-chain` | MTP 后追加 lookup，实验性 |
| `lookupChainMin` | `--lookup-chain-min` | 链式 lookup 的最短匹配 |

PLE RAM 防护按约 29 GiB 码表加专家预算/余量与物理 RAM 比较，只拦明显超额，**不是完整峰值核算**。Overlap、KV 增长等开关仍有上游单 GPU/特定 profile 的适用条件，通过语法校验不等于实际任务一定支持。

## 监控与发现的含义

- TG 为解码速度，PP 为提示处理；上次请求数据单独标记，不能冒充当前速度。
- 磁盘吞吐是**整机**流量；显存总占用不等于专家缓存。没有缓存容量数据时不凭专家数量编造 GiB。
- `/capabilities` 的模型身份、上下文、视觉能力来自实时端点交叉核验；思考默认值还需匹配生成配置的哈希。Pi 建议不代表已经安装配置好了 Pi。
- LAN 在顶层可选 `lan` 中单独设置，不通过模型 `set` 修改；改变绑定地址/白名单后明确重启转发才生效。不自动安装防火墙规则或 Windows 服务。
