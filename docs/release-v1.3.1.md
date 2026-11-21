## 1.3.1 · Native IQ 与 MTP 目录修复

- 修复网页和 CLI 预检把 `--mtp` 当成单文件的问题。现在接受 Strata 的 MTP 运行目录，并检查所需文件。
- 检查 native IQ pack 时保留原配置的正向推测窗口。窗口小于 2 会给出明确提示。
- 网页模型卡新增「模型资源」。CLI 新增模型和草稿头的查询、计划和显式下载命令，复用 Strata Control。模型下载使用 `--no-start`。

### 安装与升级

下载 **strata-launcher-v1.3.1-windows.zip**，按 **SHA256SUMS.txt** 校验后解压到新目录。可以复用自己的 `conf/launcher.json`，请核对相对路径，再运行 `node launcher.mjs assets PROFILE` 和 `node launcher.mjs check PROFILE`。 [中文说明](https://github.com/dongzn2017/strata-launcher/blob/v1.3.1/README.zh-CN.md)

本版通过离线回归测试与模拟下载测试。具体 SC117 权重的实际推理仍需在目标机器验证。

## English

Version 1.3.1 fixes Windows MTP runtime directory validation and reports the minimum speculation window for native IQ packs. The web console now shows local model assets. The CLI can plan and explicitly fetch official models and drafters through the installed Strata Control. Model acquisition runs with `--no-start`.

Download the Windows ZIP, verify it with **SHA256SUMS.txt**, and extract to a new folder. Reuse your private configuration and verify its paths. See the [English setup guide](https://github.com/dongzn2017/strata-launcher/blob/v1.3.1/README.md). Offline regression tests and simulated acquisition passed. SC117 inference on the target host remains to be verified.
