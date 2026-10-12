# 1.18 Mac 取消链路原生诊断

状态：首轮 Intel 原生诊断通过，Apple 芯片前置状态检查失败；正在修订诊断后再跑，不是完整发布验收完成。目标为实际原生应用目录、系统密钥存储及公共/Tushare 合成请求的退出取消。

工作流 `.github/workflows/verify-macos-cancellation.yml` 仅有 contents:read，只手动或在该工作流文件变更时执行。构建 on-demand 实际应用目录，不制作 DMG，不安装可选 Python 扩展，不上传应用。只保存两份白名单退出证明和包含源码/平台/架构的摘要，明确 `installerVerified:false`、`realTushareAuthentication:false`、`releaseEligible:false`。

这个诊断不是规避正式门槛：1.18 已知滚动恢复缺陷仍保留，完整原生安装、升级、全部界面及发布证明仍必须另行通过。即使本工作流全绿，也不能作为 publish-tested 的正式构建来源，不产生正式安装包或发布摘要。

测试使用已存在的诊断入口、真实 Electron/SQLite 和系统安全存储，但 Tushare 为明确的合成凭证与受控网络响应，不能声称真实线上权限或交易成交。Mac 使用独立 CLI 用户目录，不读取客户配置、持仓、资金或账户。

## 首轮实际证据

[运行 38185543096](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/38185543096)，源码 `8711f4da807346d7fe780d1ef7d2ed94b213ce2a`。Intel 成功，Apple 失败，整体失败；没有重新触发同一源码或把观察工具失败当作任务仍未结束。

Intel 下载的三份 JSON 已核对：公共请求与合成 Tushare 请求均发起一次并取消一次，退出时零新增价格；公共检查点 pending、批次 partial，Tushare 处理/失败/成功日期均 0。摘要为 darwin/x64，源码与运行编号匹配，明确不具备发布资格。没有正式安装包。

Apple 已完成原生编译，在实际检查阶段失败：公共用例读取主进程 userData 时上下文中断；Tushare 用例未取得 480 个已准备交易日。日志调用栈包含启动补漏，尚不能仅靠该栈判定产品崩溃或具体原因，不假称已解决。

修订只改测试：一次只读观察获取版本及目录，对同一仍存活进程的临时上下文失效进行有界重读，进程已退出或其他错误不吞掉；通过真实 `syncTradeCalendar` 入口准备官方日历，不伪造日期；捕获进程错误和页面异常，失败时输出诊断。修订后 Windows 两项实际用例通过（7.7 秒），并未修改产品运行代码或已知恢复缺陷。新的两种 Mac 结果尚待执行确认。
