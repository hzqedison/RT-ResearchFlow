# 多源接入：0.1.0-beta.9

本轮源码版本为 0.1.0-beta.9。各平台安装包及编译、安装、隔离检查记录见 [beta.9 发布页](https://github.com/hzqedison/RT-ResearchFlow/releases/tag/v0.1.0-beta.9)，以实际附件为准。公开接口仍需本人实际联网样本验证，不能用隔离检查代替上游兼容性检测。

## 已实现的连接路径

| 来源 | 接入方式 | 本版能力 | 需要什么 |
| --- | --- | --- | --- |
| Tushare | 保留原有服务 | 个股日线、原有增值能力 | 本人 Token；各接口积分权限独立 |
| 腾讯财经 | Node 公共 HTTP，复用现有规范化器与限流器 | 个股已收盘不复权日线，最多480日 | 不需要 Key |
| 东方财富 | 原有日线服务 + 新研报 HTTP | 个股日线、50条近期研报索引与PDF链接 | 不需要 Key；遵守来源条款 |
| 新浪 | 保留原有公共服务 | 个股已收盘不复权日线回退 | 不需要 Key |
| 通达信 | 本机 mootdx Python 调用 | 实验性沪深个股日K；空响应不算成功 | Python 扩展；公共服务器可用性 |
| AKShare | 本机 Python 调用 | stock_zh_a_hist、stock_research_report_em | Python 扩展；实际仍依赖公开上游 |
| i问财 | 本机 pywencai 调用 | 条件查询，首50条/12列表格 | 本人登录 Cookie、Python扩展、Node.js 16+ |

“通信达”按常用股票软件“通达信”接入；“腾讯财”按腾讯财经接入。i问财是选股来源，不包装成券商研报库。

## 使用步骤

1. 在配置中心的“数据源”中多选日线来源，使用上移/下移设置请求优先级。
2. 腾讯、东财可直接使用，不要求购买 Tushare。保留的 Tushare Token 输入框留空不会删除旧值。
3. 选择通达信、AKShare 或 i问财后，安装 Python 3.10+，必要时选择本机解释器，再点击“安装所选扩展”。
4. 扩展虚拟环境、pip缓存和临时目录放在 app.getPath('userData')/data-source-cache。Windows安装版数据目录随EXE所在目录，沿用K盘安装时不会默认安装进系统Python或C盘。
5. i问财还需要 Node.js 16+ 和本人问财网站的登录 Cookie。Cookie仅在本机密码输入框填写，加密保存在SQLite，通过stdin送入本地子进程，不进入命令参数、日志、配置返回或报告。清除按钮可单独删除。
6. “检测”必须取得实际有效日线/研报/问财行才显示样本成功，TCP连通、Python包可导入或空结果均不能证明上游可用。
7. 输入股票代码可读取日线和查询研报；研报PDF链接交由系统浏览器打开。本版没有自动解析、总结PDF全文。
8. 连接检测会缓存公开样本，不操作券商账户、不启用真实交易、不提交订单。

## 能力边界

- 多选路由已用于个股新增、刷新，以及AI二轮缺失OHLC时补齐。已有足够真实OHLC且无Tushare主动刷新时仍保留本地优先行为，输出明确截止日期。
- 全市场证券池/盘后截面后台同步、板块、分钟线、筹码、财务及策略特有Tushare接口没有在本轮全部改造成跨源路由。不要宣称免费接口已经完全覆盖所有投研功能。
- 日线使用不复权口径；成交量规范为手、成交额规范为千元。通达信/AKShare新写入全市场日线时标记真实来源，原有高优先级事实不会被低优先级覆盖。
- 腾讯/新浪复用持久化限流与冷却。研报缓存15分钟、每来源最多50条、按原文链接去重。东财与AKShare研报可能是同一上游，不视作两份独立证据。
- 问财查询间隔至少10秒，单次25秒子进程上限，失败不自动反复请求、不读取浏览器凭据、不绕过验证码或付费权限。
- Tushare的AI Key、Tushare Token、问财 Cookie、券商交易权限互不替代。数据源配置不启用订单功能。
- 所有适配仍需实际联网样本验证，不能用编译或隔离测试证明上游长期可用。

## 可复现扩展依赖与参考

- AKShare 1.19.1（PyPI：2026-09-30）：https://pypi.org/project/akshare/1.19.1/
- mootdx 0.11.7（PyPI：2024-05-04）：https://pypi.org/project/mootdx/0.11.7/
- pywencai 0.13.1（PyPI：2025-05-06）：https://pypi.org/project/pywencai/0.13.1/
- AKShare官方源码及接口文档：https://github.com/akfamily/akshare ，https://akshare.akfamily.xyz/data/stock/stock.html
- AKTools（官方HTTP部署路线，当前未启用外部HTTP服务）：https://github.com/akfamily/aktools
- mootdx文档与源码：https://github.com/mootdx/mootdx
- pywencai登录策略与运行时说明：https://github.com/zsrl/pywencai
- 可后续评估的更新问财分支：https://github.com/HeRiki/pywencai-enhanced

mootdx和pywencai发行较旧，因此标注实验，不能保证2026年的每个上游接口仍可用；遇到实际失败再基于样本定向替换。依赖固定为明确版本，不从不明第三方镜像装包。AKShare/AKTools、mootdx、pywencai代码采用MIT，原项目版权由相应作者保留；本产品继续保留AGPL-3.0-only及原作者署名。代码开源不代表网站数据授权，按个人学习测试用途和平台条款使用。
