# 1.23 批量修复验收记录

应用源码固定为 `40936bd9d41d92c5ffa3aaef370bf29ca505dd71`。测试和归档修正提交不改变安装包；不修改个人数据、数据库结构或交易逻辑。

## 本轮覆盖

- Node/Web 类型检查通过，5 个定向文件共 49 项测试通过。
- [三端原生安装包运行 38295084489](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/38295084489)通过；新增研报、日线、问财界面隔离检查分别使用 3、2、2 次合成只读响应，验证等待、独立保存反馈、旧结果清理和安全失败说明。
- [Windows 生命周期运行 38296573769](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/38296573769)通过；同目录安装保留测试数据、默认非系统盘路径、卸载数据保留和共享 Python 不变。
- [三端跨版本升级运行 38297277030](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/38297277030)通过；实际 1.22 安装包先保存非金融合成偏好，再以已验收 1.23 包在同路径替换，核对数据路径、来源顺序和 4 个哨兵文件。每端 seed/verify 两份回执，退出正常、渲染错误为 0。
- [首轮归档失败 38296188144](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/38296188144)保留：六个实际升级测试通过，Windows 上传回执失败。仅拆分不同平台上传路径，未重编应用或降低断言。

## 不应扩大解释的边界

本轮合成查询不是真实 Tushare Key、i问财 Cookie、实时市场服务或券商交易验证。跨版本合成偏好保留不代表所有用户旧数据库及真实凭证迁移已验证。未证明 Apple 公证、全应用后台资源或全部功能可用，也不是全日志脱敏审计。

完整 OpenSpec 4.2、4.4、5.x、6.2 继续保持原范围，不用本轮局部绿灯扩大完成状态。正式发布必须复用上述原生包并核对 SHA256，不能重编后沿用旧回执。

机器回执见 [release-1.23-acceptance.json](release-1.23-acceptance.json)。

