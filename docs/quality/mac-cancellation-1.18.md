# 1.18 Mac 取消链路原生诊断

状态：验证工作流已定义，尚未执行，不是发布验收完成。目标为 Apple 芯片与 Intel 的实际原生应用目录、系统密钥存储及公共/Tushare 合成请求的退出取消。

工作流 `.github/workflows/verify-macos-cancellation.yml` 仅有 contents:read，只手动或在该工作流文件变更时执行。构建 on-demand 实际应用目录，不制作 DMG，不安装可选 Python 扩展，不上传应用。只保存两份白名单退出证明和包含源码/平台/架构的摘要，明确 `installerVerified:false`、`realTushareAuthentication:false`、`releaseEligible:false`。

这个诊断不是规避正式门槛：1.18 已知滚动恢复缺陷仍保留，完整原生安装、升级、全部界面及发布证明仍必须另行通过。即使本工作流全绿，也不能作为 publish-tested 的正式构建来源，不产生正式安装包或发布摘要。

测试使用已存在的诊断入口、真实 Electron/SQLite 和系统安全存储，但 Tushare 为明确的合成凭证与受控网络响应，不能声称真实线上权限或交易成交。Mac 使用独立 CLI 用户目录，不读取客户配置、持仓、资金或账户。
