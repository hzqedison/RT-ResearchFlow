# 原生升级验收工具独立预检

日期：2026-10-08。角色：Astra 独立最终验收控制。

## 结论

**BLOCKED_PRECHECK：当前版本不具备 READY_TO_RUN 条件。**

需先由 Sol 修复下列两项确定的验收工具错误，再由 Astra 复核改动与针对性回归，才能冻结 harness commit 并由主任务同步专用分支。它们不是正式 1.1 产品 bug，不需要修改产品、重打包或移动 tag。

本轮已独立阅读请求列明的 workflow、下载器、固定 manifest 及 13 个独立工具文件，复跑已有 9 项离线测试，并补做哈希错误的无副作用复现。未运行安装器、产品应用、原生 workflow、系统 Keychain 或防火墙操作；未改动任何待审实现文件。

## 阻断项 1：Windows 必经路径将结构化值直接交给字节哈希函数

严重性：**P1，Windows 验收启动前必现阻断**。

- [evidence.mjs:23](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/evidence.mjs:23) 的 `hash(value)` 直接调用 `createHash('sha256').update(value)`，没有对象/数组序列化。
- [harness.ts:334](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/harness.ts:334) 在 Windows 系统隔离 setup 成功后调用 `hash(setup.programs)`；[windows.ps1:93](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/platform/windows.ps1:93) 明确返回数组。因此执行在 `install(0)` 前就会抛 `ERR_INVALID_ARG_TYPE`，原生应用尚未安装。
- 即使修复首处，[harness.ts:88](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/harness.ts:88) 还会调用 `hash({ key, location })`，同样抛错。
- 原错误会被 [harness.ts:357](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/harness.ts:357) 转成泛化的 `BLOCKED_ENVIRONMENT / NATIVE_CONTRACT_OR_UI_UNAVAILABLE`，容易被误判成 runner 或产品安装故障。

本轮亲自复现：直接导入待审 `hash`，分别传入合成的 `setup.programs` 数组和注册身份对象，两者均得到 `ERR_INVALID_ARG_TYPE`；使用断言验证错误码，执行退出码 0。没有执行 Windows setup，也没有修改系统防火墙。

修复契约：明确区分字节哈希和结构化对象哈希。可在两个调用点对固定结构作确定性 JSON 序列化，或提供独立的结构化哈希 helper；不能把所有对象隐式转为 `[object Object]`。保留现有文件/Buffer 哈希语义。新增回归覆盖两个实际调用形态、内容变化影响摘要及相同输入摘要稳定。

精确修复范围：`tools/native-acceptance/harness.ts`、必要时 `tools/native-acceptance/evidence.mjs`、`tools/native-acceptance/offline.test.mjs`。不修改 Windows 产品或安装包。

## 阻断项 2：首轮建夹具对普通按钮使用 checkbox 操作

严重性：**P1，三个原生平台的 A 阶段 UI 夹具阻断**。

[harness.ts:252](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/harness.ts:252) 与 [harness.ts:253](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/harness.ts:253) 对 `quant-application-reported`、`quant-official-reply-reported` 调用 `.check()`。它们是 `<button type="button">`，不是 checkbox/radio；checkbox 操作不会执行预期登记，测试不能到达正常退出、跨版升级和 Keychain 跨重启断言。

本轮不只依据当前工作区：独立通过 GitHub 公共内容 API 定位两个固定正式 source 中的同一组件。两版返回相同 blob `ac12f98165d614c77177e264b87d48a470ae1bba`，第 117、121 行均为普通按钮，第二个按钮在申请登记前 disabled。

- [1.0 固定源码中的申请按钮](https://github.com/hzqedison/RT-ResearchFlow/blob/41f8429149f646c7dec7f1610082702e7d9cce48/src/components/QuantTradingOnboarding.tsx#L117)
- [1.1 固定源码中的回复按钮](https://github.com/hzqedison/RT-ResearchFlow/blob/ec1fe73e5f3c80edb1f3e7b0a989a03cf66b18ad/src/components/QuantTradingOnboarding.tsx#L121)

修复契约：对这两个真实按钮使用 `.click()`，按申请登记、回复登记顺序操作，并保留后续持久化状态断言。数据权限确认项仍按其真实 checkbox 语义操作，不能把所有 `.check()` 机械替换。新增独立工具回归防止对这两个冻结的按钮契约再次使用 checkbox 操作；不能把 UI 阶段跳过或直接写 localStorage 伪造开通进度。

精确修复范围：`tools/native-acceptance/harness.ts`、`tools/native-acceptance/offline.test.mjs`；如采用显式控件契约表，可仅增补 `tools/native-acceptance/fixtures/version-contract.json` 的测试元数据。不修改产品组件。

## 亲自执行与复核的证据范围

| 项目 | 本轮实际行为 | 结果 |
| --- | --- | --- |
| 独立工具已有离线测试 | 在 K 盘工作区亲自运行 `node --test tools/native-acceptance/offline.test.mjs`，TEMP/TMP 指向既有 K 盘 `.cache` | 9 passed，0 failed，0 skipped；退出码 0；约 139 毫秒。 |
| 哈希调用形态复现 | 导入真实 helper，使用无敏感数据的数组及对象，断言抛错码 | 两个调用形态均确认 `ERR_INVALID_ARG_TYPE`，证明现有 9 项测试未覆盖该必经分支。 |
| 有限网络证据 schema | 对现有网络证据白名单执行无 OS 操作的 helper 断言 | 可以表达显式拒绝自检与 loopback 观测，不要求人为填造 OS 全量计数。 |
| 控件契约 | 阅读当前组件的最小匹配片段，并定向取得两正式 source 的对应组件片段 | 两个固定版本均为普通按钮，blob 相同；没有在本机启动应用重现 UI 异常。 |
| Sol 的 TypeScript/Node/PowerShell/workflow 自检 | 作为实现方历史说明，不冒充本轮亲测 | 本轮未重新执行这些自检，不记入通过数量。 |
| 真正的跨版原生安装、Mac Keychain、正常退出与跨进程解密 | 尚未执行 | 无通过结论；等待修复后进入原生 runner。 |

上述 **9 项**是本次独立工具离线测试，不能与此前产品的 54 项隔离测试合并，也不代表 9 项原生产品验收。

## 对已知网络观测缺口的裁定

**缺少后台外连逐阶段完整 OS 拒绝计数，不单独阻断本轮原生验收。** 当前验收目标是证明公开包的真实数据保留和系统加解密，同时确保测试密钥不外发，并非统计所有后台请求总量。

实际代码已有必要的硬门禁：应用启动前设置系统外连限制；每次 A/B/C/D 启动分别要求 Node、Electron 网络接口、子进程的 loopback 成功和明确外连拒绝；Windows 使用归属 PID/目标匹配的 WFP 5157 记录，Mac 要求继承 sandbox 的权限拒绝结果；密钥只在 A 的三项探测均成功后写入；loopback 检出测试凭证请求会失败。它们仍须在原生 runner 真正成立，不能仅靠这次源码复核签字。

需要保持以下表述边界：

- [harness.ts:363](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/harness.ts:363) 目前只有结束时的一条累计 loopback 记录，`phase` 是结束阶段，而不是完整的逐阶段请求统计。不得把它解读成 D 阶段独有次数或所有 OS 拒绝次数。
- `controls` 的 12 项是四次启动的运输通道探测，不是 12 次后台外连事件；没有计数的数据是“未收集”，不是 0。
- 建议使用现有白名单 `verification`/`scope` 字段或 README 明确“启动时显式拒绝自检 + loopback 累计观测，非完整 OS 事件计数”。如补各阶段 loopback 差值，只是增强取证，不降低真实 crypto/升级断言，也不要求凑数通过。
- 若原生环境不能证明系统隔离、不能启动真实 Keychain 或探测只超时而没有明确拒绝，仍必须 BLOCKED，不可退化为 mock、关闭隔离或通过 `hasKey` 自证。

该项若补充，精确写范围仅 `tools/native-acceptance/harness.ts` 的证据描述和/或 `tools/native-acceptance/README.md`，必要的离线断言可放入 `offline.test.mjs`；不是修改正式产品的理由。

## 修复后进入原生运行的门槛

1. Sol 仅提交上述有界修复及针对性回归，保持六个正式安装包哈希与版本契约、真实 saveConfig/safeStorage/只读 SQLite、A/B/C/D 生命周期断言不变。
2. Astra 复核这次变更文件及新增回归，确认两个阻断消失；当前报告保留失败记录，不改写为“首次预检通过”。
3. 达到 `READY_TO_RUN` 后再冻结 harness SHA，由主任务原子同步 `codex/acceptance-1.0-to-1.1` 并触发独立 workflow。不能触发 release workflow 或重建安装包。
4. `READY_TO_RUN` 只代表允许进行原生实验，不等于最终 PASS。Mac sandbox/Keychain 的真实兼容性、Windows NSIS 覆盖安装和跨进程持久化仍必须以该运行的原生证据裁定。

本轮交付到此：**请先修复两项 P1 验收工具阻断，再请求复验。**

## 复验追加记录：2026-10-08，修复后冻结

### 最新阶段结论

**READY_TO_RUN：本轮两个已知预检阻断已解除，允许将下述冻结字节提交到专用验收分支后运行原生实验。**

上文 `BLOCKED_PRECHECK` 是首次预检的真实历史，保留不覆盖。本次不是正式产品放行，不代表已证明 Windows 跨版安装、Mac Keychain 或四阶段原生进程行为成功，也不改变既有正式 1.1 的有限验收结论。

### 修复复核及本轮亲自执行的证据

1. **结构化值哈希阻断解除。** 本次读取的 `tools/native-acceptance/harness.ts:91` 对登记身份按固定字段顺序构造对象后调用 `JSON.stringify` 再哈希；第 336 行对程序数组先 `JSON.stringify` 再哈希。未把底层字节哈希函数改为隐式对象强制转换，因此原有字符串、Buffer、Uint8Array 的语义保留。新增回归实际调用转译后的 harness 安装/setup 方法，覆盖同值稳定、数组内容变化、登记 key/location 各自变化，而非仅测试一个仿写的修复表达式。
2. **登记控件操作阻断解除。** `harness.ts:254`、第 255 行依次 await 两个登记按钮的 `click()`；第 257 行仍对真实权限 checkbox 执行 `check()`。与首次预检已核对的两个正式版本同一 UI blob 契约一致。本轮实际调用 harness 的 seed 方法，控件替身区分按钮与 checkbox，并要求第一项异步登记完成后才能操作第二项；不是通过跳过引导、直接写登记进度或删除断言过关。
3. **观测口径已明确。** `harness.ts:40` 起显式标注仅含传输自检与累计 loopback 观测；第 365 行起的最终记录说明 phase 是采集结束阶段，不是每条请求所属阶段。未伪造完整后台 OS 拒绝计数，也未以自检数量冒充后台外连次数。该有限口径可以进入原生试验，不能据此声称完整网络事件审计已通过。
4. **本人独立执行：** 在 K 盘工作区设置 TEMP/TMP 为仓库 `.cache` 后运行 `node --test tools/native-acceptance/offline.test.mjs`。退出码 **0**；**14 passed / 0 failed / 0 cancelled / 0 skipped / 0 todo**，测试程序报告耗时 **468.5012 ms**。其中 9 项为原有离线防护回归，5 项为本次修复新增回归。该结果与此前产品的 54 项检查、首次预检的 9 项结果分别记账，不相加冒充新的产品覆盖率。

新增回归以内存转译后的实际 harness 方法为被测对象，以明确的替身隔离平台命令、Electron 启动、网络和文件写入。它们能证明已知脚本路径/控件选择错误已修复，**不能证明真实 NSIS、真实 UI、safeStorage、Keychain 或操作系统隔离已成功**。本机未运行安装包、未启动已安装产品、未修改 Keychain/防火墙/生产数据，也未安装依赖。

### 仅复核或沿用的既有证据

- 两个正式版本登记 UI 的按钮/checkbox 类型及先后依赖，沿用首次预检对固定正式 source 的读取证据；本轮未重复联网取证。
- 六个正式安装包、版本/应用身份、真实 saveConfig/safeStorage/只读数据库和 A/B/C/D 生命周期契约，沿用此前有界预检设计与代码审查；本轮不重做全产品审计。
- Sol 的独立 TS 类型检查、Node 语法检查等仍仅列为开发证据。本轮本人执行的是上述 14 项离线测试，包括其内存 TypeScript 转译，不把它记作单独的完整类型检查。
- 主任务报告已准备未挂分支候选提交 `df888e46c22c75b5e058337f05cfe83bdca7208e`。本次没有自行回读该远端对象，**因此不宣称已证明该提交与本清单一致**；远端逐文件字节核对是更新 ref 前的硬门槛。

### 冻结清单与主任务交接门槛

以下是本轮预检取样读取的 **16 个文件的原始字节 SHA-256**，不是按解析后 JSON、归一化文本或格式化源码计算。排除本报告、产品源码、安装包和本机数据。各文件按 POSIX 相对路径的字典序排序。

组合算法：逐文件生成 `<小写SHA256><两个ASCII空格><POSIX相对路径><LF>`；最后一行也带 LF。将全部行以 UTF-8 编码串联后计算 SHA-256。不转换源文件自身的换行、BOM 或其他原始字节。

**组合 SHA-256：`4b453553ff58cef16568a3dcaa223a3845cd11517f921f105b7e4a27d6753bdc`**

```text
8cb2214fdb9a972de2433cebbc7e4a6a67f20b69c5496f7a6a52f3c114645a06  .github/scripts/fetch-upgrade-installers.cjs
1c480a8019fa880cd2fa99f7d9e34f0f339e9bdb526d7dce64147fec273981b8  .github/workflows/native-upgrade-acceptance.yml
b65be09318ab5dbba790909a6024cd6df83ccdf5671c66b55669ecea3a3c6b7f  tests/fixtures/releases/native-upgrade-1.0-1.1.json
97d8aa6d9d04950f795d640800ee58d3867d1d42a45293176b91a95711bdfeba  tools/native-acceptance/README.md
d80fd871c4f1e3faaec9a1735a514f5726f20aac3647cd88163dbc7a1a006ae7  tools/native-acceptance/evidence.mjs
b9634472a2d3805c9396811c1b075d4c6a61ef837a22e7fc6af12dc06492e7a7  tools/native-acceptance/fixtures/version-contract.json
0de90a5ec143fbeaf078817e8bacfb3f5678daa9cb5ac86fc19c78f602002320  tools/native-acceptance/harness.ts
9cea700696681cae41a1a7cd3479d8f511d382c4d0e245bb13b4ba68c9df93e5  tools/native-acceptance/native-upgrade.spec.ts
2cfa0982343918343d843e315b07028ed7f7dbb536650a74f35d82d436b7cbe0  tools/native-acceptance/offline.test.mjs
ad9c6e47c663b4aadd9c5181c0b0ee713cc5b9f7046370104784797909581298  tools/native-acceptance/package.json
0d4cd7edeabd1bab839bb8a864c2aa11e57ce6ce0c693f4b96688a5d14eb0a90  tools/native-acceptance/platform/macos.mjs
f952ebfeccaaaeb875af61568edf7319ee02a2e76b9f1c652cafe620f337e06c  tools/native-acceptance/platform/macos.sh
fc5a2ceb1d608eef6fb15f4ffe780253015d0c37d0736bea85e24a75b3a1c778  tools/native-acceptance/platform/windows.ps1
7f23244a40deecbab076fb39d7e5e4d8bd13d960836f65e14fa6af61eed13c81  tools/native-acceptance/playwright.config.ts
7009ed801624686eff210f907b2312ce368f5f04ab2ac09f6465c1b9151fe70d  tools/native-acceptance/pnpm-lock.yaml
671af518c48fde83548d51fc3a27bf2d85d9fd3ff326b1ff04a08dafaa067945  tools/native-acceptance/snapshot.cjs
```

1. 主任务将候选对象中的上述 16 份原始字节分别与此清单比对。任一缺失或不符，停止更新 ref，不运行未审 harness；保持报告和正式产品/tag/公开资产不变，交回差异后再冻结。
2. 全部匹配后方可更新 `codex/acceptance-1.0-to-1.1`，触发独立原生验收 workflow；不得借此触发 release 重打包或重新发布安装包。运行证据必须记录实际 harness commit、run/attempt、平台架构及固定旧新安装包哈希。
3. 此次 READY 仅解除明确的离线工具阻断。云端必须原生证明旧版 1.0.0 与新版 1.1.0、同身份同目录/同 profile、四个独立进程及正常退出、升级保留数据，并在 Mac 真正解密非真实测试密钥且完成完整重启。不得将同版本重装、同进程重开窗口、hasApiKey 或 mock 结果替代上述断言。
4. 仍要求启动和写入测试密钥之前的真实 OS 隔离及各阶段显式拒绝/loopback 自检成立。完整后台 OS 拒绝计数未采集是已披露的覆盖限制，不要求人为补零；无法证明必要隔离、仅超时、清理失败或原生契约不符时应保留 BLOCKED/FAIL，而不是降级为通过。
5. 原生运行结束后，再由 Astra 独立读取原生证据和失败日志签署最终结果；现阶段不对未知原生兼容性或产品零缺陷作保证。
