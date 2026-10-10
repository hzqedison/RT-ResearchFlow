# 1.7 运行库分发材料有界核对（2026-10-11）

## 结论与边界

- 精确当前 policy 的 `licenseApprovals` 有 **14 条 pending：10 条属于实际选用 Mac Python 资产，4 条属于历史未选 Windows lxml 资产**。不是 14 个当前二进制组件都缺许可。
- 10 条活动 policy 元组是 5 种原文 × 2 个资产；原文存在不等于对应代码一定存在，也不等于分发履约通过。不能据此新增批准记录。
- 当前三平台 lxml 的精确 wheel/对应源码材料已有后续有界审核；旧审核中的两条 Mac 源码材料缺口不应继续套用新 SHA。最终随包/随发布交付仍未证明。
- Node 原归档的 398 个嵌套 notice 路径不在当前锁的 Node 树内，不能直接列为当前选中树的 398 个漏交文件；组件适用性及最终裁剪交付证明仍待补。
- 指定结构输入目录没有 `obligations-proof.json`。结构锁及 receipt 均为 `structuralOnly=true`、`releaseEligible=false`；本报告不改变该状态。
- 这是已有本地材料的工程差距核对，不是法律保证、商业许可承诺、发布批准或安装验收。

## 输入身份与证据层级

- 项目根：`K:/AI/person/money/RT-ResearchFlow`；结构输入目录：`D:/RT-ResearchFlow-BuildCache/windows-1.7-formal-inputs-current`。
- 当前 `resources/python-runtime/preparation.policy.json` 字节 SHA256：`d7cb20a0894c245ce2f942c5932cc550128003a8d2eab61dd8e9e477ac42b264`。
- 当前 `formal-lock.json` 字节 SHA256：`c20a1a327b91d4022746d2fc18b4a8045c31767134b14fdfae866ba2f06cd6ea`；锁与 receipt 的 policy/lock pin 一致。
- `origin-evidence.json` 记录 prepare run `38031520327`、源 `b91f91ce65fe8bc20e150b770128b62a5fccb98d`，merge 源 `9c371c71484b373fb0457c58e164c63b781b956b`。merge run `38031988597` 成功为用户已确认事实，本轮未联网重新查询。
- receipt 记录 `structuralValidationPassed=true`、`missingLicenseComponents=[]`，但 `sourceVerified=false`、`nativeBootstrapVerified=false`。这些字段不证明最终许可义务完成；源码/封装验收交由主代理。
- 本轮实际读取 policy、结构锁、binding receipt、origin、小型 Mac 三份 review、许可材料索引、lxml 后续 review、notice census。资产 SHA 来自这些记录，未重新读取归档或最终安装包字节。
- 大型 `license-review.md` 只一次读取结尾 180 行，含 U/V/Final eight 标题；未全文读取。policy 首次输出截断造成读取失败，仅为恢复失败重新解析一次，此后均用内存对象，不再回读。
- `mac-runtime-applicability-side-evidence-20261010/source-content.json` 仅查看大小（108358 bytes），未读正文、未当作新证明；原始 notice 不在本轮重新作法律文本审查。

## 实际选用资产

以下 Python/Node/lxml 身份在当前 policy 与结构锁一致；所有 SHA 均为 SHA256。

| 标识 | 目标与资产 | 精确资产 SHA |
|---|---|---|
| P-A | darwin-arm64 / CPython 3.13.16 install_only | `d8975d7df4f08f7b1c7aafcdfacbddcec3d366415f2c1a72b2466b6850815933` |
| P-X | darwin-x64 / CPython 3.13.16 install_only | `8e9cb087305bfb8969f68a905f79f41469d4aa5220c1aa71ada7fc9953bdba0f` |
| P-W | win32-x64 / CPython 3.13.16 install_only | `5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778` |
| N-A | darwin-arm64 / node-v22.23.3-darwin-arm64.tar.gz | `23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53` |
| N-X | darwin-x64 / node-v22.23.3-darwin-x64.tar.gz | `8a677b0219178efd6eb0e475457c4afb452b521a92f6e67845a73bd85727f2a8` |
| N-W | win32-x64 / node-v22.23.3-win-x64.zip | `2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71` |
| L-A | darwin-arm64 / lxml 6.1.3+rt.redistribution.1 universal2 wheel | `3be8dfec49d3f81162ba3b63ead0638e2cebe65921de28ea0b58ba587aa19f6d` |
| L-X | darwin-x64 / lxml 6.1.3+rt.redistribution.1 x86_64 wheel | `11a9a6fcc74a18e120ef36fcd4d1652c0e7684bb46025616d5af99de8f98cdf8` |
| L-W | win32-x64 / lxml 6.1.3+rt.redistribution.1 win_amd64 wheel | `6d7435ecd2edf1f184dd661b57153412e51b1af8a0ef657cf5f01e60d853b221` |

## 10 条活动 pending：精确元组与缺失材料

每条均有当前 `licenseRequirements` 引用；下面的 G 编号对应紧随其后的具体材料缺口。

| policy approvalId | 精确选用资产 SHA | 精确 notice SHA | 缺口 |
|---|---|---|---|
| astra-mac-notice-d8975d7df4f0-e93716da6b9c | `d8975d7df4f08f7b1c7aafcdfacbddcec3d366415f2c1a72b2466b6850815933` | `e93716da6b9c0d5a4a1df60fe695b370f0695603d21f6f83f053e42cfc10caf7` | G1 |
| astra-mac-notice-d8975d7df4f0-3bdff06e6999 | `d8975d7df4f08f7b1c7aafcdfacbddcec3d366415f2c1a72b2466b6850815933` | `3bdff06e69991c94664f2ef5c5f8096f60b7dbec071756ea6cc26b445e06ec5b` | G2 |
| astra-mac-notice-d8975d7df4f0-2daec087a88e | `d8975d7df4f08f7b1c7aafcdfacbddcec3d366415f2c1a72b2466b6850815933` | `2daec087a88e7c9b8082557cdeebad5bbb8155a4137472f0b22e269cd99d0c1e` | G3 |
| astra-mac-notice-d8975d7df4f0-9c04cce50c49 | `d8975d7df4f08f7b1c7aafcdfacbddcec3d366415f2c1a72b2466b6850815933` | `9c04cce50c4989d5601dd8b07f6ab922c40388b66ac736c9007cb1ed9d9dd560` | G4 |
| astra-mac-notice-d8975d7df4f0-3ac5cdd0bef6 | `d8975d7df4f08f7b1c7aafcdfacbddcec3d366415f2c1a72b2466b6850815933` | `3ac5cdd0bef6c43ce34c6a7ced452081d9e5a0bf94082b9f9147d23ec9e214f5` | G5 |
| astra-mac-notice-8e9cb087305b-e93716da6b9c | `8e9cb087305bfb8969f68a905f79f41469d4aa5220c1aa71ada7fc9953bdba0f` | `e93716da6b9c0d5a4a1df60fe695b370f0695603d21f6f83f053e42cfc10caf7` | G1 |
| astra-mac-notice-8e9cb087305b-3bdff06e6999 | `8e9cb087305bfb8969f68a905f79f41469d4aa5220c1aa71ada7fc9953bdba0f` | `3bdff06e69991c94664f2ef5c5f8096f60b7dbec071756ea6cc26b445e06ec5b` | G2 |
| astra-mac-notice-8e9cb087305b-2daec087a88e | `8e9cb087305bfb8969f68a905f79f41469d4aa5220c1aa71ada7fc9953bdba0f` | `2daec087a88e7c9b8082557cdeebad5bbb8155a4137472f0b22e269cd99d0c1e` | G3 |
| astra-mac-notice-8e9cb087305b-9c04cce50c49 | `8e9cb087305bfb8969f68a905f79f41469d4aa5220c1aa71ada7fc9953bdba0f` | `9c04cce50c4989d5601dd8b07f6ab922c40388b66ac736c9007cb1ed9d9dd560` | G4 |
| astra-mac-notice-8e9cb087305b-3ac5cdd0bef6 | `8e9cb087305bfb8969f68a905f79f41469d4aa5220c1aa71ada7fc9953bdba0f` | `3ac5cdd0bef6c43ce34c6a7ced452081d9e5a0bf94082b9f9147d23ec9e214f5` | G5 |

| 缺口 | notice 原成员 / 已有事实 | 仍缺的材料，不等同重新下载原文 |
|---|---|---|
| G1 MPL/certifi | `python/lib/python3.13/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/certifi/LICENSE`；锁保留归档 notice，且三个 provider 的 certifi 仍存在 | 实际覆盖证书束/source form、修改轨迹、完整 MPL 条款及接收者源码获取/交付证据。剔除 pip 不会消除 provider certifi 义务 |
| G2 BDB | `python/licenses/LICENSE.bdb.txt`；receipt 声明 `bdbBuildReferencePresent=false`、`archived-notice-only-not-applicable-to-target-code` | 绑定精确目标的 core、扩展、静态组件及后端完整证据，或适用时 DB/随附软件源码获取材料。不能把 `_dbm` 可导入、元数据未列 BDB 或自动状态当独立缺席批准 |
| G3 X11 | `python/licenses/LICENSE.libX11.txt`；多权利人复合原文保留 | 精确 Tk/图形后端与静态/动态链接适用性图；适用时全部保留/免责/名称及 TekHVC 条件的实际履约，或有界不适用证明 |
| G4 legacy OpenSSL | `python/licenses/LICENSE.openssl-1.1.txt`；现有审核指出 `_ssl/_hashlib` 元数据同时列 legacy 与 Apache notice | 精确实现/版本及 Python、相关 Node 组件图；适用时 OpenSSL/SSLeay 致谢、广告、命名等条件交付；不适用时绑定代码/链接证据。不能以 OpenSSL 3 notice 或 import 成功代替 |
| G5 Tix | `python/licenses/LICENSE.tix.txt`；receipt 声明 Mac `target-code-absent-original-terms-retained` | 覆盖原生库身份、Tcl package/script 布局及链接图的缺席证明，或存在时引用原文与条件对应证明。补充原文已列入当前锁，不能继续笼统声称三份原文均未取得 |

Mac `licenses/applicability.json` 的 receipt pin：arm64 `4a3d586b00f75d0198335b9fa238eb94f9b07c650d9a1f668afd75151383bbb1`；x64 `692960258ac6d50eebf8444b047fc59c26a9eb381d9d2576ef578ff0766b0951`。本轮未读取这些目标文件正文或检查生成器实现，不能独立认可其缺席判断。旧 V 节曾报告 BDB core/Tix 路径检测边界问题；未确认当前实现是否修复，不将旧发现冒称当前源码缺陷。

这 5 种 pending 原文均出现在两个 Mac 锁的 `files` 中；pending 元组并未出现在投影后的 `python.licenses`。因此 projected receipt 的 `missingLicenseComponents=[]` 不能替代 policy 元组/履约核对，也不说明这些原文或适用性已最终通过。

Tix 已有三份补充原文：`licenses/tix-8.4.3.6/docs/license.html_lib` SHA `9149f81c6efd1c3cef68742b67dc6f1b6211f32f425f3b6d24cf5279668cfd27`；`docs/license.tcltk` SHA `def74f610b8682dd12a772954ee8ad07d304cdf106abb6e030f71ee489419d1a`；`license.terms` SHA `91ff35309038fcfab853c8634b7b743a179c211d8ff3cb174b579c8af3c3072d`。三平台锁均列入；存在/引用适用性与最终交付仍须证明。

## 4 条历史未选 pending，不作当前阻断

共同旧 artifact SHA：`8c50ef43d7d3e4c66078e700aef7cfeacdbe9e7635ce9897da375252f9ec5157`，version `6.1.3`；当前选 L-W，version `6.1.3+rt.redistribution.1`。

| 历史 approvalId | 原 notice 对应 | notice SHA |
|---|---|---|
| lxml-derived-win32-x64-8c50-1 | LICENSE.txt | `8fc2b568133516e46845d2147917adeee1648e70ae9ab5ed6c5417afef4ce855` |
| lxml-derived-win32-x64-8c50-2 | LICENSES.txt | `388fa99f3bde4447cd5a4cbb114037be026854db6cfe89e112691c1d8abdcf3c` |
| lxml-derived-win32-x64-8c50-3 | RT_LIBICONV_COPYING.LIB | `dc626520dcd53a22f727af3ee42c770e56c97a64fe3adb063799d8ab032fe551` |
| lxml-derived-win32-x64-8c50-4 | RT_SOURCE_NOTICE.txt | `488386eca8e74f8c83d09837394f1970f8cbb31d3d3b629dad91f8de5696ae19` |

四个 id 在当前 `licenseRequirements` 的引用数均为 0。当前 L-W 的同文本 SHA 有独立精确批准元组；相同 notice 字节不允许把旧资产状态移植到新资产。无需修改/删除历史记录来推进本次材料交付。

## 当前 lxml 材料已经具备，余项是交付

依据 `D:/RT-ResearchFlow-BuildCache/astra-lxml-complete-review-20261009-01/review.md`，本轮读取的 review SHA：`2c979f3e4c79ce8d490faa2dab6f63b00321639a8d95b6fded9bf1a19177bb34`。其明确绑定当前 8 条 wheel/notice 元组，覆盖对应源码、原 notice 与重建/替换入口；未宣称实际 C 重编译或替换重链接执行。

| 选用 wheel | 锁列入的 `licenses/sources/lxml-redistribution/` 对应源码 ZIP | SHA |
|---|---|---|
| L-A | lxml-6.1.3+rt.redistribution.1-darwin-arm64-public-sources.zip | `05151c1e93f922b8d30dc5d7007ee906437c2b66560f39fdbb6e708b46361b84` |
| L-X | lxml-6.1.3+rt.redistribution.1-darwin-x64-public-sources.zip | `7defad97b795547e04b436553cbfe903cde96c40242523bc5c9f9e3064ea1e25` |
| L-W | lxml-6.1.3+rt.redistribution.1-win32-x64-public-sources.zip | `50569086381ddf5bb8ca35ed01bd6c480dad33b0bc18384182d59e51903db60d` |

应直接交付这些精确配对包及其完整原文/重建说明，并证明接收者可获取、产品条款保留适用的修改与调试逆向权利。**不新增“必须再编译才能补批这 8 条”的门槛**；已有审核材料门槛与最终履约门槛分开。泛化 policy pending 文案中的 Windows lxml 材料不足不能推翻此精确后续审核，但也不能凭后续审核跳过最终交付。

## 其他活动履约边界：不计入 14 条文本 pending

- **Node 裁剪/组件适用性**：N-A/N-X 根 `node/LICENSE` SHA `c738ae413cf561f174e34f6961f8ca458aae2369a73640dda6234c629b98bcc4` 已有精确文本审核。当前各 Node 树仅该 notice 与可执行文件；N-A `node/bin/node` SHA `68f4d07ca49e0500cc135c7e0a445093e228e42e126ac22306d045f0a8c2636b`，N-X 同路径 SHA `fdb8d4da9332c2c99c3b2ae4bad4672bfef225ecd603e656cd1378b3644583a2`。需绑定最终树证明 npm/其他未选成员不被重引入，逐项判断根复合原文中适用于实际二进制的 Artistic/ICU、字典、Apache NOTICE/变更等义务；不能将根 notice 视为全 Node 的 MIT 或 GPL 批准。
- **Node 原归档历史 census**：`D:/RT-ResearchFlow-BuildCache/astra-mac-runtime-license-review-20261010/notice-census.json` 本轮字节 SHA `b166a74f889387760be62f066c7b5772741017236a335476d9ed8e294f31fb1a`，绑定 N-A/N-X 各 200 个原成员。根之外各 199 个、合计 398 路径/旧审核称 99 字节组，不是当前树的已选文件。例 npm/LICENSE SHA `7610d223851f421d315df5e77974f1c68a04b97e02060e5bbbcf13d95e3ca257`：未选 npm 树不等于原文审核完成，也不应为未选树机械要求全部补批；若最终重新带 npm，须恢复精确 census 下逐文本审核及交付。
- **PBS zlib-ng 对账**：P-A/P-X 对应 full provenance 资产 SHA 分别 `ca3eb5bf8110eaed1c3e516be4bd4d52bcf636f8e888359353f274288406bae7`、`57030cb11a1e823903b13ada440f64e7a06fcaeaabe1051559ef8c34890c277a`。旧精确审核记录元数据引用 `LICENSE.zlib-ng.txt`、full 归档无该成员、相关 links 为 system z；当前锁也无该 notice 路径。缺对应二进制/元数据适用性对账，不是已证明 bundled zlib-ng 缺许可；没有可杜撰的该 notice SHA。
- **certifi 实际 provider**：三平台实际 wheel `certifi-2026.7.22-py3-none-any.whl` SHA `62f22742b58a1a33014a2b6b706588a8d7e2a88ae7bd1a6ebe8c992928483775`，notice SHA 同 G1。该 wheel 文本元组为 approved，不关闭 MPL source-form/完整条款/修改与取得证明；G1 的补证应覆盖它，不只处理 pip archived notice。
- **Windows CRT**：P-W 及实际 provider DLL 仍需精确 Distributable Code 来源/适用许可及条件交付证据。锁列 `python/vcruntime140.dll` SHA `d5e4d9a3e835fa679450145d6a7d94e36573a509317111904d9b3712c30d9066`，`python/vcruntime140_1.dll` SHA `1f2d41c4aa5db0bc33ebf7b66d72943a817d7ce6cbe880502a9403823633093f`；numpy/pandas 三 provider 的 msvcp140 DLL SHA `a4c2229bdc2a2a630acdc095b4d86008e5c3e3bc7773174354f3da4f5beb9cde`。本轮有界输入未给出可绑定这些 DLL 的 CRT 许可原文 SHA，不能填造或以微软通用授权推定通过。
- **限定用途交付**：mootdx 派生 wheel SHA `96217b04c7a0a9b9d1e350997de0922f0f8b9cb1f0b8a7c34a99540b32670109`，MIT notice SHA `ee03a051e103766e566b0a3ac0532daa665bb063cf8f30de46fd7c7ac9d00ec6`，AUTHORS SHA `6e7b7bde9bf124e306122b8aabe46eb81e12a37ea74777d708b79c958aab051c`；tdxpy wheel SHA `5514d35608fac2c7b2acf693de6f41ba7ccda58207b65a3f374c89887560737c`，MIT notice SHA `fd2d2d610584198f900995e2d3ce121a2fd50c61416a74bb3de40cc88dffa2dd`。需原声明/作者、派生源码/变更与“非收费开源学习测试、未评估商业使用”范围的最终交付。不是要求重新 GitHub 授权或额外商业授权函，也不修改整个产品许可证。
- **最终接收者材料与 proof**：锁列 `licenses/third-party/runtime-NOTICES.txt`，Mac SHA `67e0d449ba20cf7cc09c70038ab36f376066c83bec544033482b8adbca81429e`、Windows SHA `aad18668a83d771515cef9593b389c74ce9a45d114988e284024b6991a468a19`。缺最终分发树/附件的字节对应、可读入口、完整条款/致谢、源码取得及适用变更/NOTICE 条件的证明，不能以这些索引文件存在或 native import 成功填写全通过。

## 可直接推进的具体动作（交给材料/封装 owner，本轮不执行）

1. 以以上精确 policy/lock/资产 SHA 建立 10 行 G1-G5 证据任务；分别收集覆盖实际 target 的组件/链接/后端证据，适用则补履约，不适用则记录有界缺席依据。保留原文，不改批准记录。
2. 复用已审核的三份 lxml 配对源码 ZIP 和 Tix 三份原文，纳入正式交付清单及接收者入口；不要重新下载大归档或重新开启已关闭的 lxml 材料审核。
3. 对 Node 采用当前“二进制 + 根 notice”的明确裁剪范围出证，核对根复合条件适用性。先证明最终不含 npm；仅在正式包实际带入它时恢复嵌套原文逐项审核。
4. 补 certifi 覆盖源码/完整 MPL、Windows CRT 精确原文/来源与条件、PBS zlib-ng 适用性对账及限定用途声明交付记录。
5. 在主代理定位的正式封装输入中提供受既有合同约束的 `obligations-proof.json`：绑定实际源/政策/锁/最终树、各 notice/asset/source SHA、交付位置与适用性依据；缺项明确 pending，不伪造 proof schema、不把此报告当 proof 或批准。

## 本轮未做

仅新增本报告；未修改 policy、批准记录、源码或 Actions；未运行 Git、测试、安装、构建、真实交易或下载归档；未调查 GitHub 认证/流程代码/会话，未向其他线程发送消息。现有 GitHub 授权可继续使用，不需要用户重新授权。本轮未确认最终包实际字节、真实接收者访问或所有条款履约，因此不宣称发布就绪。
