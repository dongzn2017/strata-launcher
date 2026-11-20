## 1.3.0：网页可调参，原生面板更新

- **网页版**：在模型卡片点「调参」，可改上下文、KV、RAM/显存、CPU、思考/采样、MTP/DFlash2、路由学习和 42 项高级引擎选项。保存时整批校验并备份原配置；只在下次启动生效。旧标签页不能覆盖新配置。
- **原生 Windows 版**：模型和状态区重新分组，高级引擎首次打开就能正常显示，无需手动调整窗口大小。继续支持 Pi、显存扫描和终端监控。
- 网页控制台只绑定 `127.0.0.1`。模型 API 和可选的 LAN 推理转发是独立端口，没有开放网页管理页面或修改防火墙。

### 下载与启动

1. 从 Assets 下载 **strata-launcher-v1.3.0-windows.zip**，对照 **SHA256SUMS.txt** 校验后完整解压。
2. 要求 Windows、Node.js 22+、已安装的 Strata、匹配的引擎和已准备好的模型。按[中文 README](https://github.com/dongzn2017/strata-launcher/blob/v1.3.0/README.zh-CN.md)填写 `conf/launcher.json`。从 1.2.0 升级可复用原配置，注意核对相对路径。
3. 原生版双击 `Strata-Panel.cmd`（需要 Git for Windows）。网页版执行 `node launcher.mjs webpanel`，打开 `http://127.0.0.1:8444/`。

## English

Version 1.3.0 adds browser-based tuning and a refreshed native Windows panel. Web changes are validated together, backed up and applied on the next model start. The advanced native tab no longer needs a resize to lay out correctly. The web console stays loopback-only; optional private LAN inference remains separate.

Download and extract the Windows ZIP, then follow the [English README](https://github.com/dongzn2017/strata-launcher/blob/v1.3.0/README.md). Use `Strata-Panel.cmd` for the native panel or `node launcher.mjs webpanel` for the browser console. Packages do not include model weights, Strata engines, private settings, or credentials.
