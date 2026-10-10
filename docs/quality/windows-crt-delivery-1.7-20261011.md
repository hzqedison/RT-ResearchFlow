# Windows CRT 1.7 精确分发材料与合规入口

日期：2026-10-11。范围：未发布 1.7 的 CRT 证据补充，不是法律授权签发、政策批准或最终发布放行。用户为个人、非收费开源学习测试；不假定已有 Visual Studio 授权，不要求无依据的 commercial letter。

## 结论

已补齐三个精确 DLL 的版本、签名观察、formal-lock 路径、原 archive/wheel 哈希与许可可用性，并收集微软原始许可 DOCX、官方分发入口及本机 Build Tools 对应事实。原始来源身份已经建立，但对外封装分发许可与终端保护条件仍未全部闭合，不能把此材料包或通用 MSVC 文档冒充精确授权。formal-lock 保持原有 releaseEligible=false、structuralOnly=true；本任务不修改它。

## 精确 DLL 对照

| 文件 | 版本 | SHA-256 | 来源与精确对应 |
|---|---|---|---|
| vcruntime140.dll | 14.44.35211.0 | `d5e4d9a3e835fa679450145d6a7d94e36573a509317111904d9b3712c30d9066` | Python install_only archive；本机 Build Tools x64 CRT 同 SHA |
| vcruntime140_1.dll | 14.44.35211.0 | `1f2d41c4aa5db0bc33ebf7b66d72943a817d7ce6cbe880502a9403823633093f` | Python install_only archive；本机 Build Tools x64 CRT 同 SHA |
| msvcp140.dll | 14.40.33810.0 | `a4c2229bdc2a2a630acdc095b4d86008e5c3e3bc7773174354f3da4f5beb9cde` | NumPy 与 Pandas 原 wheel，三个 provider 各自一份，共六份；本机 14.44 不同 SHA |

三个代表文件 Get-AuthenticodeSignature 均为 Valid，签名主体为 Microsoft Windows Software Compatibility Publisher / Microsoft Corporation。有效签名仅证明真实性，不证明当前分发人的许可资格。所有命中路径与大小见材料 evidence.json；MSVCP 改名后哈希不变，不能改名成 BSD/MIT 许可。

## 原 archive 是否提供原 terms

Python 原包：

- 文件：`cpython-3.13.16+20261003-x86_64-pc-windows-msvc-install_only.tar.gz`。
- SHA-256：`5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778`；保留原包实际计算值一致。
- [原始下载入口](https://github.com/astral-sh/python-build-standalone/releases/download/20261003/cpython-3.13.16%2B20261003-x86_64-pc-windows-msvc-install_only.tar.gz)。
- 实际枚举 3350 个成员，两个 DLL 成员哈希均命中。
- 原 `python/LICENSE.txt` 已按原 bytes 保存；SHA-256 为 `76900732e5f075b725f754000ad5cab1b2cf89e355c1570138476956b6413cd3`。
- 原文确有 Additional Conditions for this Windows binary build，不能说“完全没有微软条款”。但定义聚焦链接器嵌入每个 exe/dll/pyd 的 Distributable Code，并要求外部分发人和终端用户保护条款；不是给这两个独立运行库颁发的逐 DLL Microsoft EULA。随包附加条件可作为分发审查证据，不能未经适用性判断扩展为独立 CRT 完整许可。
- retained full archive 许可副本原 provenance 曾记录 `cpython-3.13.16+20261003-x86_64-pc-windows-msvc-pgo-full.tar.zst`，SHA-256 `cb3b6dcfcf179110486403204e4f5e507e8980d0ca50bb0d8c72e8c76b41b869`；它与实际执行来源 install_only 不同，不混用为同一原包。

NumPy/Pandas：

- `numpy-2.5.3-cp313-cp313-win_amd64.whl`，原 wheel SHA-256 `71cad2b2a7451ab79d8f5e71b453485b6775963d5cf794179144a7463fe6e8ec`；[精确原包](https://files.pythonhosted.org/packages/f3/ec/100f2b1794ede74a9b3d7ec6b9736927f56713414c1dfe19ab6c383494bf/numpy-2.5.3-cp313-cp313-win_amd64.whl)。逐成员读取证实目标 MSVCP SHA 相同；许可成员 Microsoft/Visual Studio/MSVC/msvcp140 文本检索结果：`not_found`。
- `pandas-3.0.6-cp313-cp313-win_amd64.whl`，原 wheel SHA-256 `f3ce8a6968045481e91a3990e797e348ce13db45ee164a7095bbc824e26c09dd`；[精确原包](https://files.pythonhosted.org/packages/c0/bd/63cb67e6903ef6d9c2871916dbcbc09d254da0fe8b870cf62e16b21945f2/pandas-3.0.6-cp313-cp313-win_amd64.whl)。逐成员读取证实目标 MSVCP SHA 相同；许可成员 Microsoft/Visual Studio/MSVC/msvcp140 文本检索结果：`not_found`。

已保存原 wheel 的主要 LICENSE，并在 evidence.json 中保存全部许可成员清单与哈希。BSD/NumPy/Pandas 自身许可不能覆盖微软 DLL。上述未找到结论限定于这两个精确原 wheel 的实际枚举及许可文本，不是“微软没有可用许可”。Wheel 仅在内存读取，未安装、未替换 native runtime。

## 真实已装 Build Tools 对应条件

本机 `Microsoft.VisualStudio.Product.BuildTools`，instance `d5d3b1c4`，安装版本 `17.14.37516.0` / `17.14.37 (July 2026)`，安装日期 `2026-08-08T05:49:05Z`。vswhere 观察为 complete、非 prerelease。

安装目录 `C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools`，catalog `C:/ProgramData/Microsoft/VisualStudio/Packages/_Instances/d5d3b1c4/catalog.json` 中 BuildTools 产品 localizedResources.license 指向 [安装材料原许可入口](https://go.microsoft.com/fwlink/?LinkId=2179911)。该入口实际跳转到 [Build Tools 2022 许可页](https://visualstudio.microsoft.com/license-terms/vs2022-ga-diagnosticbuildtools/)，嵌入 [2024 年 3 月原 DOCX](https://visualstudio.microsoft.com/wp-content/uploads/2024/03/Visual-Studio-2022-Diagnostic-Build-Tools-Agent-License_Update-March-2024_EN.docx)。EULAID：`VS_2022_Tools_2024Mar_ENU.1033`。

- 两个 VCRUNTIME 在 `VC/Redist/MSVC/14.44.35112/x64/Microsoft.VC143.CRT` 与目标 SHA 完全相同。版本目录名 14.44.35112 与 PE 版本 14.44.35211.0 不矛盾。onecore 和 x86 的不同哈希不作为对应证据。
- 本机同目录 MSVCP 的版本是 14.44.35211.0，SHA `0f885b509a685d2bbfa652fed26b5fb31d88fbdab0a978c641d1c7b8aa460aa9`，不等于目标 14.40.33810.0，不可替代。
- Build Tools 原许可允许没有 VS Product 许可者编译构建第三方已发布、OSI 许可且应用合理需要的开源依赖，只有限于可构建所需的微小修改例外；不是任意开发测试本项目的无限授权，更不是对外分发 CRT 的授权。
- Build Tools 条款要求或例外下允许的是工具使用；Scope of License 的公开分享/独立提供限制不能省略。本机安装事实不生成 licensed-user 记录。

## 官方通用条件和免费个人合规入口

[MSVC 分发指南](https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files?view=msvc-170) 对 runtime package、merge module 与独立二进制提出 licensed Visual Studio user 和适用 Microsoft terms 条件。这是通用条件，不是三项精确 DLL 的原许可。

[VS 2022 REDIST 清单](https://learn.microsoft.com/en-us/visualstudio/releases/2022/redistribution) 条件化列出 VC/redist 文件，须具有有效适用 VS 产品许可、遵守条款且文件不修改。不能从清单页面倒推出当前个人已取得资格，也不能将 Build Tools 免费安装自动等同于 Community 授权。

个人可走 [Visual Studio Community 官方入口](https://visualstudio.microsoft.com/vs/community/) 与 [Community 2022 原许可](https://visualstudio.microsoft.com/license-terms/vs2022-ga-community/)；已收集 [原 DOCX](https://visualstudio.microsoft.com/wp-content/uploads/2021/11/Visual-Studio-2022-Community-License-EN.docx)，EULAID `VS_Comm_2022_ENU.1033`。Individual License 对个人自己的应用覆盖出售或其他目的，故当前非收费学习场景不需要凭空增加付费商业授权函要求。这里只证明可用入口与条件，不宣称用户已经接受或取得许可。新的产品年份不能自动代替已收集的 2022 原文，使用其他版本时应取得对应版本条款。

Community 的 Distributable Code 条款需要应用有显著主要功能，并要求分发人/外部终端用户同意至少同等保护的条款；不分发 Preview/Pre-release/Beta、不暗示微软背书、不移除声明、不让 CRT 本身受要求公开源码或赋予修改权的 Excluded License 约束。工具用于开发的适用性同样要真实记录，不追溯编造历史工具使用。

## 最小尚不能自主完成的条件

1. 真实适用资格：由用户真实取得/接受相应微软许可并保留可证明记录，或取得精确原 DLL 的下游分发授权依据；不能由代理编造、代签或将“免费资格”记为“已获授权”。已有 Build Tools 的开源依赖编译例外只能按其范围使用，不要求无谓 commercial letter。
2. 对保持不变的 MSVCP 14.40.33810.0，补足该版本来源/适用分发条款与授权产品/REDIST 的对应依据；如果走许可产品渠道，真实取得对应版本材料后再审查，不能用本机 14.44 替换证据。也可由原包维护方提供其实际微软来源及允许下游分发的条款，但本任务不联系任何外部主体。
3. 封装交付：实际包含适用微软原文、原声明及 CRT 第三方例外，实际建立终端用户/分发人同意至少同等保护条款的机制。附带一个 NOTICE 或此报告不等于已同意；项目开源许可不得给微软 CRT 授予未经允许的修改/源码权。此任务仅提供入口与要求，不修改 workflow、批准字段或保护 vars。

若只保持个人隔离学习测试，不对外提供含 CRT 的包，不应误记为已完成公开分发审核。若未来选择不捆绑 CRT、让用户从微软自行取得运行库，这是单独设计变更；需处理 wheel 内 DLL 及动态加载依赖，不在本任务偷偷删除替换。

## 最终封装材料接入方式

指定 evidence.json 按 exact SHA 对三个组件映射，而不是仅按 DLL 名称；原文材料哈希和入口在 README/evidence 内。以后授权审查人员应以实际原文、真实主体资格和交付条件作适用性判断，不把本报告当作 policy approval，不直接修改 releaseEligible。若准予封装，接入者再将适用 LICENSE/EULA/第三方声明放入最终交付物并建立实际同意机制，本次未宣称最终包已经包含这些文件。

## 操作边界与收集完整性

仅指定 reviewed-materials/windows-crt-* 与本报告发生写入。无安装器下载、无系统升级、无 GitHub 设备认证、无子 agent、无券商/订单/用户数据访问。通过 web-access 先做依赖检查，浏览器 CDP 未开启，公开官方页面与小型许可/精确 wheel 使用静态 curl + process proxy 127.0.0.1:30071。中途内存收集超时重置，最终有界收集单阶段写入；未做已写文件回读或应用测试。

最终收集错误：无。全部 material receipts、原文哈希与原包身份见 `resources/python-runtime/reviewed-materials/windows-crt-1.7-20261011-evidence.json`。

## 改变文件清单

- `resources/python-runtime/reviewed-materials/windows-crt-1.7-20261011-buildtools-license-page.html`
- `resources/python-runtime/reviewed-materials/windows-crt-1.7-20261011-buildtools-terms.docx`
- `resources/python-runtime/reviewed-materials/windows-crt-1.7-20261011-community-license-page.html`
- `resources/python-runtime/reviewed-materials/windows-crt-1.7-20261011-community-terms.docx`
- `resources/python-runtime/reviewed-materials/windows-crt-1.7-20261011-msvc-redistribution.md`
- `resources/python-runtime/reviewed-materials/windows-crt-1.7-20261011-vs2022-redist-list.md`
- `resources/python-runtime/reviewed-materials/windows-crt-1.7-20261011-buildtools-terms.txt`
- `resources/python-runtime/reviewed-materials/windows-crt-1.7-20261011-community-terms.txt`
- `resources/python-runtime/reviewed-materials/windows-crt-1.7-20261011-python-original-LICENSE.txt`
- `resources/python-runtime/reviewed-materials/windows-crt-1.7-20261011-numpy-original-LICENSE.txt`
- `resources/python-runtime/reviewed-materials/windows-crt-1.7-20261011-pandas-original-LICENSE.txt`
- `resources/python-runtime/reviewed-materials/windows-crt-1.7-20261011-evidence.json`
- `resources/python-runtime/reviewed-materials/windows-crt-1.7-20261011-README.md`
- `docs/quality/windows-crt-delivery-1.7-20261011.md`
