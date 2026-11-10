# Strata 启动器

用一份 JSON 配置启动、检查、停止 Windows 上的本地 [Strata](https://github.com/Niko1221/Strata) 推理服务。一个模型档对应一个 profile：安装位置、端口、内存门槛、量化标签、采样、草稿模型、路由学习。

所有输入输出都是 JSON，AI agent 可以不靠人工操作直接对接，机器可读的操作手册见 [AGENTS.md](AGENTS.md)。

## 前置条件

- Windows，Node.js 22 或更新。
- 已安装的 Strata **Control** 目录（`components/control/<版本>`），它的 `python/python.exe` 必须能导入 `psutil`。
- 已安装的 Strata **引擎**目录，里面有 `strata.exe`（多模态模型还需要 `strata-vision.exe`）。
- 每个模型一个 Strata 模型档 JSON，就是那个带 `args` 数组、写明 GGUF 分片、pack、专家路由表、tokenizer 和可选视觉头的文件。启动器不复制也不修改它，只读取并按它启动。

权重和模型自己保管。配置文件和模型 JSON 放在任何目录都行，本仓库不需要它们。

## 快速开始

```powershell
.\Strata-Launcher.cmd doctor
```

`doctor` 输出一个 JSON 对象，有任何东西挡住启动时退出码就是 `3`。每一条阻塞都是 `problems[]` 里的一项，带 `section` 和 `error`；对象其余部分是探测到的事实（Node 版本、解析后的运行时路径、`psutil` 探测结果、正在运行的引擎、活动运行、每个模型档的端口）。它不会创建运行目录。

还没有 `conf/launcher.json` 时，用 `detect` 指向安装目录和模型目录：

```powershell
.\Strata-Launcher.cmd detect C:/Strata D:/Models
```

它遍历这些目录（跳过 `.git`、`node_modules`、`AppData`、`Windows` 等），只认真正的东西——带版本号的 Control 目录、里面有 `strata.exe` 的引擎目录、带 Strata `args` 数组且权重能找到的 JSON——然后输出一份候选配置，每个模型猜一个量化标签、分配不重复的端口。它猜不出来的字段留 `null`（一般是 `minimumFreeGiB`）。把输出里的 `config` 拷成 `conf/launcher.json`，填掉 null，再跑一次 `doctor`。

之后：

```powershell
node launcher.mjs list
node launcher.mjs check my-model
node launcher.mjs start my-model      # 前台运行，打印 RUN_ID、日志路径和 API 地址
node launcher.mjs status <RUN_ID>     # 另开一个终端
node launcher.mjs stop <RUN_ID>
```

`check` 完全离线：设置、运行时文件、模型资产和 GGUF 分片完整性。`prepare <id>` 只写运行目录（配置、校验值、日志位置），不启动任何进程，供检查。`start` 在前台运行并持有该进程；`stop` 写入带所有权令牌的停止请求，由 runner 执行。服务地址 `http://127.0.0.1:<port>/v1`。实际加载状态以 `status` 返回的快照为准。

退出码：`0` 正常，`2` 用法或配置错误，`3` doctor 判定未就绪，其余情况沿用引擎自身的退出码。

## 配置

复制 `conf/launcher.example.json` 为 `conf/launcher.json`，里面的相对路径按该文件所在目录解析。`conf/launcher.schema.json` 给编辑器用；启动器自己也会逐字段校验，遇到不认识的字段直接拒绝。

`deployment` 写明 Control 目录、引擎目录和引擎版本。`profiles` 每个模型一条：

| 字段 | 含义 |
|---|---|
| `id` | 你调用这个 profile 用的名字，小写 |
| `quant` | 只用于拼模型名的标签，任意文本，如 `q4_k_xl`、`iq4_xs_v31` |
| `slug` | 可选的模型名前缀，默认取模型档的 `model_name` 或文件名 |
| `profile` | Strata 模型档 JSON |
| `minimumFreeGiB` | 放行引擎前要求的可用内存下限 |

`settings` 可覆盖 `port`、`context`、`output`、`thinking`、`effort`、`kv`、`kvResident`、`expertGiB`、`headroomGiB`、`vramMiB`、`workers`、`spec`、`specMinP`、`drafting`、`visionThreads` 和 `imageTokens`，其余设置继承模型档。某个数值默认范围不适合你的模型时，用 `limits` 换掉它，例如 `{ "context": [8192, 262144] }`；写了启动器不认识的设置名会被拒绝。

`sampling`、`engineOptions`、`draftOptions`、`learning` 都是可选的，范围见 schema。路由学习默认关闭；学到的路由只在模型、模态、引擎版本、基础模型档和工作负载全部一致时才复用，过期或损坏的自动退回基础文件。

### 调优草稿模型

`draftOptions` 校验模式，并且不把 MTP 概率当成草稿置信度。**调优版**草稿 pack 绝不从模型名猜：必须在 `dflash2` 里写清 pack 文件、它是为哪个模型做的、那个模型的量化、以及验证过的引擎版本。不写就用自带草稿。示例配置里的版本是占位符，换成你实际用的那套。

## 测试

```powershell
npm test
python -m pip install psutil==7.2.2
npm run test:python
```

测试用临时模型档和模拟进程，不需要 GPU、模型和网络。覆盖配置校验、运行隔离、所有权停止、分片与身份识别、学习档兼容性、采样和选项校验、安装探测。

发布状态：启动器目前只在这些测试里启动、检查和停止过 Strata。要真正依赖它，请先在目标机器上跑 `doctor` 和 `check`，并确认从上游面板实现复用部分的权利归属。上游 Strata 许可证单独适用（[Strata v0.2.13 许可证](https://github.com/Niko1221/Strata/blob/v0.2.13/LICENSE)）；启动器本身是 MIT，见 `LICENSE`。
