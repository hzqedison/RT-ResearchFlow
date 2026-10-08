# Astra 1.3 交易 UI 新接线独立验收

## 结论：FAIL，1 项 UI 契约阻断

仅验 Zeno 冻结的 4 个 UI 文件，不代签正在修复的 core/native/service/store。源提交未读取，以原字节 SHA256 绑定；版本 1.3.0；未构建或测试安装包、未发布。

### UI-F1（P2）：买卖确认缺少持久意图绑定，仍能进入第二阶段 execute

- 根因：`src/components/macThsProductState.ts:151-155` 的匹配函数以 `!b || ...` 接受空绑定。这对会话授权可以成立，但组件没有按 submitLive/cancelLive 区分。
- 接线：`src/components/MacTradingPanel.tsx:143-146` 展示该确认；`:239-243` 再次接受，并在绑定为空时省略 intentBinding 后仍执行请求。
- 实际 DOM 反例 DOM9：合法订单首次 submitLive，fake API 返回同 session、未过期票、AWAITING_CONFIRMATION 和 PREPARED 意图，但 confirmation.intentBinding=null。本人点击“继续本笔”，预期 submitLive 调用数仍为 1，实际为 **2**。第二次走的是真实组件事件处理函数，不是 AST 或复制出的业务实现。
- 日志：`K:/AI/person/money/.tmp/astra-trading-ui-13-1791457946318/dom-run.log`；断言与堆栈：`K:/AI/person/money/.tmp/astra-trading-ui-13-1791457946318/dom-results.json`。无 renderer 异常，故不是探针配置失败。
- 边界：这是 UI 绑定缺失的已证反例，**没有证明主进程能被绕过或真实订单可送出**。cancelLive 使用同一分支，但本轮未为其单独执行 DOM 反例，不冒称已实测。
- 最小修复交 Zeno：仅 panel/model 及专属测试。对交易请求必须存在可匹配的 intentBinding；在展示、状态变更撤销、最终点击三个位置使用同一按操作区分的规则。不得以取消本人确认、自动续票或全禁用代替；authorizeLive 的合法 null binding 必须继续可用，完整绑定的正向提交保留。补测 submitLive/cancelLive 空绑定拒绝及会话授权正控。

## 独立执行与已证行为

现有测试文件由 Node20.20.2 独立运行：**87/87，退出 0，1.36 秒**。它包括纯模型、SSR 和手写 hook 宿主；不能称为 DOM 或原生通过。日志 `K:/AI/person/money/.tmp/astra-trading-ui-13-1791457946318/model-results.log`。

另用已安装 Playwright/Electron 41.1.0 与真实 React/AppConfirmDialog，加载冻结源到全新 K 盘临时 profile，执行实际 DOM 点击/输入/焦点/通知：**8 PASS / 1 FAIL，退出 1，renderer errors=0**。不下载依赖，不加载产品主进程/安装版数据；fake window.api，Windows 宿主的 navigator.platform 仅模拟 MacIntel。文件加载以外上游网络被阻止。不是目标 Mac/THS 原生验收。

| DOM 项 | 结果 |
| --- | --- |
| DOM1 首次状态未完成、focus 读取失败 | 禁提交、无自动 execute；失败不降级为 probe |
| DOM2 execute 掉回报 | 原 top/order ID 保留，不重发；允许本人查看委托，新单仍禁；实际导出 Blob 无合成订单/ID/账户标签 |
| DOM3 迟到 READY、退休 session | 旧回报不能覆盖 UNKNOWN，新读取不可信时保持禁用 |
| DOM4 完整确认正控 | 本人两次操作，同一 requestId/order，第二阶段原 snapshotHash/revision 绑定不变 |
| DOM5 确认期间状态变化 | 原确认撤下，执行调用停在一次 |
| DOM6 可信旧来源 provisionLegacy | 首次本人确认只 provision；另一次本人确认才 apply；不自动 initialize/enable/execute |
| DOM7 未封存旧源及 fresh 初始化 | 旧源无导入捷径；新域初始化仍显式独立 |
| DOM8 逐条人审 | 实际命令绑定 intent/snapshot/revision/recovery；still_uncertain 不允许 releaseGate，新单保持禁止 |
| DOM9 空持久绑定交易确认 | **FAIL**，详见 UI-F1 |

导出代码另经源审与现有注入敏感字段用例检查：白名单重建状态/类别/计数，不串行化订单摘要、恢复计划、ID/hash、路径、账户 digest、token 或原始异常。DOM 实际捕获 export Blob 验证合成订单/ID/标签不出现；未测试真实敏感数据。恢复与人审 revision/snapshot/recovery 匹配及过期点击的其他分支，由源审和现有非 DOM 测试覆盖，不一概称全做了 DOM。

## 冻结字节与范围

- `src/components/MacTradingPanel.tsx`：`1508849806adbccfd32ae94f5a082de7989742377d454158d652b3e443edab1e`
- `src/components/macThsProductState.ts`：`3628354c9c3eb6d11dca0d8e977d2ef5f55da9a72971a29ee77d81a896a494d6`
- `tests/unit/macThsProductState.test.ts`：`559a2fec12bfbfcc54a104c5ff10af098039fe9b44c40ec69967415ee9fb8693`
- `src/components/MacTradingPanel.css`：`7e134fb173d86f59d156621111b2435875a8b6bd2a9efe426d1b82cb47da9cfd`

完整源/依赖清单与 model/DOM 实际加载哈希：`K:/AI/person/money/.tmp/astra-trading-ui-13-1791457946318/source-manifest.json`。依赖 DTO `electron/shared/macThsTypes.ts` 为 `c1b550506bf9da63fc2e80e2742c394bf89c686bb8d29c7acb5dc96ec4da7ddb`；AppConfirmDialog 为 `65284307f95d0f204094af1ebaf8698c4b3f4ee24f92a85e8a186d5de2a8ec74`。后续依赖变化不得自动沿用结论。

产品文件未修改。没有 THS、osascript、券商、真实账户/订单、安装版 data、NSIS、跨版本或发布验证，也没有 core/native 放行结论。本轮最短待办仅 UI-F1，交父代理转 Zeno 后按修复哈希定向补验。

## UI-F1 最小真实 DOM 复验：限定 PASS

仅替换正式交接的 panel/model/test 三个新版本，CSS 沿用同哈希原字节，原 8 PASS / 1 FAIL 日志及源 manifest 完整保留。本节关闭 UI-F1，不抹去旧版本失败。

- `src/components/MacTradingPanel.tsx`：`b36fc915df8d2e980d80dd839a962f6d3d965bb87a7effd9e15889bcbbfa72bd`
- `src/components/macThsProductState.ts`：`ad838d107f6e8faecaa41b41413a23bc8792710040c5cb98b4a935d9c974e03d`
- `tests/unit/macThsProductState.test.ts`：`3809a252fe5f89f921373dcea318f732927c90c819063c1a67fc938235d0aa64`
- `src/components/MacTradingPanel.css`：`7e134fb173d86f59d156621111b2435875a8b6bd2a9efe426d1b82cb47da9cfd`

复用原隔离 Electron 实际组件/对话框 harness，**4 个必要用例全部有效通过**：

1. submitLive 的 intentBinding=null：首次 execute 后不显示可继续的交易确认，submitLive 调用保持 1 次，新单仍禁用。
2. submitLive 缺失 intentBinding 属性：同样不发第二次 execute，原 top/order requestId 相同。
3. authorizeLive 的合法 null binding：仍须本人点击应用确认，第二次调用保留同一 requestId 和确认票，不附造 intentBinding，会话正控成功。
4. 合法交易绑定：沿用原 DOM4 断言，两阶段保持同一 requestId/order、原 snapshotHash/revision，不靠全禁用通过。

前三个交易相关有效用例日志：`K:/AI/person/money/.tmp/astra-trading-ui-13-1791457946318/f1-fixed/dom-run.log`（该轮合计 3 PASS）。授权用例该轮因隔离 fixture 重挂载尚未完成，在旧风险勾选框上操作后等待新按钮超时，未进入 authorizeLive 接口；这是探针同步错误，不计产品通过或失败。原失败日志未覆盖。仅为 fixture 外层增加 mount epoch，并等待当前挂载与只读同步完成，保持产品断言不变，单独补跑授权 **1/1，退出 0**：`K:/AI/person/money/.tmp/astra-trading-ui-13-1791457946318/f1-auth-recheck/dom-run.log`。两轮 renderer errors 均为 0，未重跑已有效通过的三个用例或原87项。

源审确认：panel 在展示确认、状态变化撤销、最终点击三个位置均传原 operation.request；model 对 submitLive/cancelLive/兼容 mutations 强制合法绑定、requestId 一致及意图匹配，同时保留授权 null binding。本轮实际 DOM 只覆盖上述 4 项，不声称单独执行了 cancelLive 或兼容 mutations 的 DOM 分支。新版专属测试仅捕获源哈希，未把 Zeno 开发26/web typecheck 算作独立执行。

新源与两轮实际加载哈希 manifest：`K:/AI/person/money/.tmp/astra-trading-ui-13-1791457946318/f1-fixed/source-manifest-final.json`。实际运行仍为 Windows 上隔离 Electron/真实 React DOM、MacIntel 平台夹具与 fake API，不是用户真实 Mac。DTO/AppConfirmDialog 沿用前次已冻结依赖，边界不变。

**结论：UI-F1 已关闭，本次四文件 UI 切片限定 PASS。** 原发现及本次证明都只到 UI 是否发出二次 execute，不表示后端真实放行、主进程/存储/native 已验收，更不表示发生或完成实盘交易。未改产品源码、未访问真实账户/网络、未运行安装或发布。
