# Private runtime 1.7 许可证审查记录

日期：2026-10-09。审查者：Astra。范围：指定 Windows PBS/Node 缓存，以及指定三个 provider 候选 site 的许可证证据。本文是工程分发合规审查记录，不是法律意见，也不是自动审批 policy。

## 结论与状态

- PBS full、install-only、Node ZIP 的本地完整 SHA256 与本轮读取的官方校验和一致；19 份 full 许可证和 PYTHON.json 的本地提取件与归档成员逐字节匹配，Node LICENSE 也匹配 ZIP 成员。这一来源/字节证据闭环已完成。
- 许可文本支持按各自条件随应用再分发的路径，不要求终端用户手装 Python/Node；但不能把所有组件统称 MIT、也不能以有19份文件代替适用性审查。
- 仅对 Node 未修改 node.exe 加完整 LICENSE 的有界分发路线提出“保留全部 notices 后可继续准备”的工程建议。此建议不是正式 policy 的 approved，也不涵盖重新构建、删改 LICENSE、npm 一并交付或第三方商标授权。
- PBS 还需落实 Windows Microsoft Distributable Code 的终端条款/来源材料，以及 Tix 引用 notices 的适用性与材料完整性。Berkeley DB 不能自动批准，不能仅凭文件名判断其代码随包。
- provider 仅完成候选许可证索引及重点风险摘录，未完成全部二进制 vendoring 的法律/来源闭环。所有未有明确批准记录的项目保持 pending，允许 resolve/materialize，阻 seal。
- 本轮没有修改 preparation.policy.json、源码、安装目录或生产数据，没有安装依赖、运行 provider、请求行情、交易或创建发布。唯一工作区写入是本文件。读取的是上游许可文本，不是本机凭据、证书私钥或数据库。
- Windows 的结论不外推到 Mac arm64/x64。签名后哈希、实际随包 notices、SBOM 和安装包分发条款仍是独立门禁。

## 来源与完整资产 pin

官方来源：
- [PBS 20261003 校验和](https://github.com/astral-sh/python-build-standalone/releases/download/20261003/SHA256SUMS)
- [Node 22.23.3 校验和](https://nodejs.org/dist/v22.23.3/SHASUMS256.txt)

上述纯校验和文本在本轮通过官方 HTTPS 读取；未重新下载产品归档。校验和匹配不是独立签名验证，本轮未验证发行签名。

| 资产 | 字节 | 本地与官方一致的 SHA256 |
| --- | --- | --- |
| cpython-3.13.16+20261003-x86_64-pc-windows-msvc-pgo-full.tar.zst | 45844362 | `cb3b6dcfcf179110486403204e4f5e507e8980d0ca50bb0d8c72e8c76b41b869` |
| cpython-3.13.16+20261003-x86_64-pc-windows-msvc-install_only.tar.gz | 47421192 | `5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778` |
| node-v22.23.3-win-x64.zip | 35574076 | `2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71` |

- [PBS full archive](https://github.com/astral-sh/python-build-standalone/releases/download/20261003/cpython-3.13.16%2B20261003-x86_64-pc-windows-msvc-pgo-full.tar.zst)
- [PBS install-only archive](https://github.com/astral-sh/python-build-standalone/releases/download/20261003/cpython-3.13.16%2B20261003-x86_64-pc-windows-msvc-install_only.tar.gz)
- [Node ZIP](https://nodejs.org/dist/v22.23.3/node-v22.23.3-win-x64.zip)

本地根：`D:/RT-ResearchFlow-BuildCache/private-runtime-1.7`。PBS 提取证据在 `pbs-windows-provenance/python`；Node 提取证据在 `node-windows-x64/node-v22.23.3-win-x64/LICENSE`。full 归档只在内存解压用于成员对照，不向文件系统提取。首次系统 tar 缺少 zstd 解码器，随后使用现有 Node zlib 的内存解码完成；大输出截断后仅重取必要索引，没有安装解码工具。哈希均针对原始完整字节，不经文本换行转换。

## PBS full 的19份文本

下表文件均位于 full 归档 `python/licenses/`，每项的本地提取件均匹配对应归档成员。保留整个集合是保守的 notices 保存策略，不意味着19个组件均链接进 Windows Python，也不意味着19个组件均已批准。

| 文件 | 字节 | 完整 SHA256 | 实际条款与关注 |
| --- | --- | --- | --- |
| LICENSE.bdb.txt | 7419 | `8f2d533ab34899499d5b07f209854b101b17dba2c69f3251860aecf3e4005faa` | Sleepycat / BSD notices；第3条源码提供义务，不能按一般 BSD 批准；Windows 适用性另列。 |
| LICENSE.bzip2.txt | 1780 | `bd5628cc76fb0ebf9c657d1dd4d1a240a1a7b216c31663e7bbf1131c0b70a910` | bzip2-1.0.6；保留版权/免责、不冒充原作者、修改标识、不得借作者名背书。 |
| LICENSE.cpython.txt | 36935 | `8fe98bf9822926d854f56ffd8d97877d8b942617aa44eb7ea77fd99e22f2537e` | PSF/BeOpen/CNRI/CWI 与内含第三方条款；保留全文、修改摘要及不背书限制；不能替代 install-only LICENSE.txt。 |
| LICENSE.expat.txt | 1165 | `8a9cfe4b5924f4b25881aa0c9f5e4561c5f31065d0c4a13cdcdbcf917edf39aa` | MIT；保留版权和许可全文。 |
| LICENSE.libedit.txt | 1643 | `d9932ccdd42eccf6cdded7bcb35b088e64cfc7c24d355af2cc0d02edb6b637d3` | BSD-3-Clause；源码/二进制 notices 与不背书。 |
| LICENSE.libffi.txt | 1153 | `9afb8970cd29fc1031fa647278e4bef613399e2e3468a1e3a397f4d158c6101c` | MIT；保留版权和许可全文。 |
| LICENSE.liblzma.txt | 673 | `d87d218dd908b3243ec4cbc72af400e5b7437513ea9d9229291d0812b8464fec` | 0BSD 文本；允许有偿/无偿使用、修改、分发；仍按项目规则保留原文。 |
| LICENSE.libuuid.txt | 1459 | `cbccaa3efe07a9a602751375085be572d4410a250b996716fbe8c5255c7ec6f2` | BSD-3-Clause；二进制附版权、条件与免责，不借作者名背书。 |
| LICENSE.libX11.txt | 47960 | `f353accfe2976df31ea297a77d1d454bd51ef6be8c3df39bd6aca95901579357` | 多份 X11/MIT/历史许可，不得简化一个 MIT 标签；含 TekHVC 标识条件及商标说明。 |
| LICENSE.libXau.txt | 1169 | `cec808cd2163fccdc8de4a91d526490777afbaeea060e1168c40a804694b7444` | X11 类许可；保留 supporting documentation notices，不借 The Open Group 背书。 |
| LICENSE.libxcb.txt | 1367 | `29a9539190e6de1af5fd06a9139c7103137cd1f9290b08c7b11bce89c01c14d2` | MIT 类许可及作者/机构广告使用限制；保留全文。 |
| LICENSE.mpdecimal.txt | 1308 | `f094277cd46e1f6e4d87916cc4b51e22f613d45eb81f48231c3cb7caf8fc8a6a` | BSD-2-Clause；二进制随文档保留版权、条件、免责。 |
| LICENSE.ncurses.txt | 1476 | `4f571cad3ea6c888bf0a7092e5b215dddb3142e9e3f1857fd5fac6cf13d345d7` | MIT 类许可并限制权利人姓名用于推广；非因 FSF 名称就判成 GPL。 |
| LICENSE.openssl-1.1.txt | 6244 | `ad89e3fed746413af1d34d5353978ee1520cedd361c853f8022e7bb210ac6b31` | 旧 OpenSSL AND SSLeay 条款；广告/署名/命名限制，不能替代 OpenSSL 3 Apache 条款。 |
| LICENSE.openssl-3.txt | 10352 | `ed72ce2b51ee58f117e5a021e2e04af158857f40269fbc03491f0b2a99dbcc96` | Apache-2.0；附许可、保留适用 NOTICE、修改标识、专利终止及不授商标权。 |
| LICENSE.sqlite.txt | 1504 | `d8eb9aba7ef6b5ed06cb3ec19a7242316af2e5933c638eb67fb781c13884e01d` | 交付代码 public-domain 声明；构建脚本许可另论，不将所有源码一概视作 public domain。 |
| LICENSE.tcl.txt | 2295 | `41613eabfc08921a7da9c4bfd7f3ce5d5406f55214b253d89f392ed86eebeb8f` | TCL；任何用途许可，现版权与本 notice 原样随包；含政府使用条款。 |
| LICENSE.tix.txt | 2880 | `8cdff3addb9e9eb108c78e2cf5e05f26b216c098304945733bbec382b2eaef66` | TCL 类许可及附属 Tcl/Tk、HTML Library notices 引用；补证事项见正文。 |
| LICENSE.zlib.txt | 1016 | `365e36720db366054863235aea5d6f440142ab968834bfaf81fa9d187c99b9b8` | Zlib；不冒充来源，修改源码须标识，源码分发不得删除 notice。 |

### PYTHON.json 与实际平台适用性

`python/PYTHON.json`：63788 字节，SHA256 `c2bd7a699f18cd48dbf701b55a1229dcecec3e2ac74b59fba350fe52d4153e98`，本地/归档一致。字段显示 CPython 3.13.16、`x86_64-pc-windows-msvc`、PGO、共享 libpython、`vcruntime:140`。这是来源元数据，不是另外一份许可授权；保留原始字节和同批 full pin。

- 构建元数据明确引用 bzip2、libffi、liblzma、OpenSSL-3、SQLite、Tcl/Tix、libuuid 等许可；core/extension objects 另可见 zlib、mpdecimal、expat，不能只看 license_paths 数组。
- 未见 Berkeley DB 扩展/链接声明。install-only 归档没有 bsddb/Berkeley DLL 名称；`python/Lib/bdb.py` 是 Python 调试器模块名，不能当作 Berkeley DB。此为有限构建/成员证据，不是穷尽式二进制链接证明。
- `LICENSE.bdb.txt` 第3条实际要求提供如何取得 DB 及使用它的配套软件完整源码的信息。若正式 tree/链接审计证实含该实现，需要专门履约或权利澄清；仅保留该文本不能替代履约。本 Windows 候选不应仅因保存该通用文本就把整个应用宣称为受该条款覆盖。
- OpenSSL 的元数据 licenses 指向 Apache-2.0，但 links 仍出现历史 `libcrypto-1_1-x64` 名称；实际 install-only 成员为 `libcrypto-3-x64.dll`、`libssl-3-x64.dll`。不得把元数据旧文件名当作 OpenSSL 1.1 实际版本证明；保留两份 notice，正式 SBOM 以实际二进制/来源核验为准。
- X11/旧 OpenSSL 文本中的附加要求按实际交付组件判断，不能因通用目录收录就随意删除，也不能扩大成全应用许可义务。

## install-only 的原生与 vendor notices

关键差异：install-only `python/LICENSE.txt` 为 22055 字节，SHA256 `76900732e5f075b725f754000ad5cab1b2cf89e355c1570138476956b6413cd3`；它不是 full 的 `LICENSE.cpython.txt`。原样保留两者，不能互相覆盖或统一换行后沿用旧 SHA。

### Windows 额外条款

实际 `python/LICENSE.txt` 的 “Additional Conditions for this Windows binary build” 说明 .exe/.dll/.pyd 链接了 Microsoft Distributable Code，要求进一步分发遵守 Microsoft 条件，并要求分销方/外部终端用户同意具有相应保护的条款；还列出不改权利声明、不暗示微软背书、不用于非微软平台、不用于恶意/欺骗/非法程序。

工程门禁：目前未读取或确认项目安装器/EULA已落实该要求，因此不能在本记录中关闭。需负责人确认相应 Microsoft 上游分发材料及终端条款安排；不可只把 Python 标为 PSF-2.0 就认为覆盖了这些二进制条件。归档内确有 `vcruntime140.dll`、`vcruntime140_1.dll`。

### Vendor 完整性与保留方式

- install-only 自带 pip 26.2.1 和 vendor 许可。20 个 vendor notice 相对路径分别在 pip 的 dist-info/licenses/src/pip/_vendor 与 pip/_vendor 内存在，逐项 SHA 相等。附录列出全部实际文本成员，排除仅名字含 licenses 的 .py/.pyc 代码文件。
- pip 顶层是 MIT；vendored distlib 保留 Python 历史许可；packaging 提供 Apache/BSD 双选；cachecontrol、distro、msgpack、requests 涉及 Apache 条件；certifi CA bundle 为 MPL-2.0 声明；其余分别保留实际 MIT/BSD/ISC 类原文，不以 pip 的 MIT 代替。
- certifi 的989字节文件是 MPL 声明和上游位置，不是 MPL 全文。正式分发需保存声明、相应完整许可与源码可获取安排。源码提供义务范围不可直接扩张到整个应用，也不可忽略。
- Tcl/Tk 的 install-only notices 与 full 文本均保留。实际 Tix 二进制 `python/tcl/tix8.4.3/tix84.dll` 存在，而 full 的 Tix notice 引用 `docs/license.tcltk`、`docs/license.html_lib`；install-only 成员扫描未找到这两个引用名。需按对应 Tix 源版本取得并判断适用的附属 notice，不能仅文件数19就批准。
- 是否移除构建时 pip/测试工具不在本轮修改范围。若后续按明确配方排除不需要的构建工具，必须记录排除清单并重新生成 tree/SBOM；不能以不运行工具为由删除仍随包代码的许可。
- full 19份与下述 install-only 成员只能证明已识别的 notices 保存基线，不是所有静态 vendoring 原始源码的穷尽法律审计。

| install-only 归档成员 | 字节 | 完整 SHA256 |
| --- | --- | --- |
| python/LICENSE.txt | 22055 | `76900732e5f075b725f754000ad5cab1b2cf89e355c1570138476956b6413cd3` |
| python/Lib/site-packages/pip-26.2.1.dist-info/licenses/AUTHORS.txt | 12139 | `4eb1fb1705e2def898e81bcba19c3aac80620d27ba3569d6a6df7b4629d1b5c2` |
| python/Lib/site-packages/pip-26.2.1.dist-info/licenses/LICENSE.txt | 1093 | `634300a669d49aeae65b12c6c48c924c51a4cdf3d1ff086dc3456dc8bcaa2104` |
| python/Lib/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/cachecontrol/LICENSE.txt | 558 | `86eeee87be2a43f3ff1f56496f451f69243926f025fedbb033666c304c4c161b` |
| python/Lib/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/certifi/LICENSE | 989 | `e93716da6b9c0d5a4a1df60fe695b370f0695603d21f6f83f053e42cfc10caf7` |
| python/Lib/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/distlib/LICENSE.txt | 14531 | `808e10c8a6ab8deb149ff9b3fb19f447a808094606d712a9ca57fead3552599d` |
| python/Lib/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/distro/LICENSE | 11325 | `cb5e8e7e5f4a3988e1063c142c60dc2df75605f4c46515e776e3aca6df976e14` |
| python/Lib/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/idna/LICENSE.md | 1541 | `1a9a4f0e3d479a27240ddd59a9137a66ab4a0f9dfdc8ca6188cc0bfd85187f04` |
| python/Lib/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/msgpack/COPYING | 614 | `492dedba85da5872f78e6091bcd1fea474d660d35acb4dee964b8aab3f007427` |
| python/Lib/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/packaging/LICENSE | 197 | `cad1ef5bd340d73e074ba614d26f7deaca5c7940c3d8c34852e65c4909686c48` |
| python/Lib/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/packaging/LICENSE.APACHE | 10174 | `0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594` |
| python/Lib/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/packaging/LICENSE.BSD | 1344 | `b70e7e9b742f1cc6f948b34c16aa39ffece94196364bc88ff0d2180f0028fac5` |
| python/Lib/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/pkg_resources/LICENSE | 1023 | `86da0f01aeae46348a3c3d465195dc1ceccde79f79e87769a64b8da04b2a4741` |
| python/Lib/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/platformdirs/LICENSE | 1089 | `29e0fd62e929850e86eb28c3fdccf0cefdf4fa94879011cffb3d0d4bed6d4db6` |
| python/Lib/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/pygments/LICENSE | 1331 | `a9d66f1d526df02e29dce73436d34e56e8632f46c275bbdffc70569e882f9f17` |
| python/Lib/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/pyproject_hooks/LICENSE | 1081 | `1b22b049b5267d6dfc23a67bf4a84d8ec04b9fdfb1a51d360e42b4342c8b4154` |
| python/Lib/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/requests/LICENSE | 10142 | `09e8a9bcec8067104652c168685ab0931e7868f9c8284b66f5ae6edae5f1130b` |
| python/Lib/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/resolvelib/LICENSE | 751 | `f388fd38cad13112c1dc0f669bbe80e7f84541edbafb72f3030d2ca7642c3c9d` |
| python/Lib/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/rich/LICENSE | 1056 | `deed7c17a4318158190a3ea239cc879a5a50271cebb98ae7025f48fbe58dca15` |
| python/Lib/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/tomli/LICENSE | 1072 | `b80816b0d530b8accb4c2211783790984a6e3b61922c2b5ee92f3372ab2742fe` |
| python/Lib/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/tomli_w/LICENSE | 1072 | `b80816b0d530b8accb4c2211783790984a6e3b61922c2b5ee92f3372ab2742fe` |
| python/Lib/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/truststore/LICENSE | 1086 | `33be7b7e8fa4fd19b1760e1a8ed8a668bdab852c91b692dd41424bcb725a9fca` |
| python/Lib/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/urllib3/LICENSE.txt | 1093 | `130e3a64d5fdd5d096a752694634a7d9df284469de86e5732100268041e3d686` |
| python/Lib/site-packages/pip/_vendor/cachecontrol/LICENSE.txt | 558 | `86eeee87be2a43f3ff1f56496f451f69243926f025fedbb033666c304c4c161b` |
| python/Lib/site-packages/pip/_vendor/certifi/LICENSE | 989 | `e93716da6b9c0d5a4a1df60fe695b370f0695603d21f6f83f053e42cfc10caf7` |
| python/Lib/site-packages/pip/_vendor/distlib/LICENSE.txt | 14531 | `808e10c8a6ab8deb149ff9b3fb19f447a808094606d712a9ca57fead3552599d` |
| python/Lib/site-packages/pip/_vendor/distro/LICENSE | 11325 | `cb5e8e7e5f4a3988e1063c142c60dc2df75605f4c46515e776e3aca6df976e14` |
| python/Lib/site-packages/pip/_vendor/idna/LICENSE.md | 1541 | `1a9a4f0e3d479a27240ddd59a9137a66ab4a0f9dfdc8ca6188cc0bfd85187f04` |
| python/Lib/site-packages/pip/_vendor/msgpack/COPYING | 614 | `492dedba85da5872f78e6091bcd1fea474d660d35acb4dee964b8aab3f007427` |
| python/Lib/site-packages/pip/_vendor/packaging/LICENSE | 197 | `cad1ef5bd340d73e074ba614d26f7deaca5c7940c3d8c34852e65c4909686c48` |
| python/Lib/site-packages/pip/_vendor/packaging/LICENSE.APACHE | 10174 | `0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594` |
| python/Lib/site-packages/pip/_vendor/packaging/LICENSE.BSD | 1344 | `b70e7e9b742f1cc6f948b34c16aa39ffece94196364bc88ff0d2180f0028fac5` |
| python/Lib/site-packages/pip/_vendor/pkg_resources/LICENSE | 1023 | `86da0f01aeae46348a3c3d465195dc1ceccde79f79e87769a64b8da04b2a4741` |
| python/Lib/site-packages/pip/_vendor/platformdirs/LICENSE | 1089 | `29e0fd62e929850e86eb28c3fdccf0cefdf4fa94879011cffb3d0d4bed6d4db6` |
| python/Lib/site-packages/pip/_vendor/pygments/LICENSE | 1331 | `a9d66f1d526df02e29dce73436d34e56e8632f46c275bbdffc70569e882f9f17` |
| python/Lib/site-packages/pip/_vendor/pyproject_hooks/LICENSE | 1081 | `1b22b049b5267d6dfc23a67bf4a84d8ec04b9fdfb1a51d360e42b4342c8b4154` |
| python/Lib/site-packages/pip/_vendor/requests/LICENSE | 10142 | `09e8a9bcec8067104652c168685ab0931e7868f9c8284b66f5ae6edae5f1130b` |
| python/Lib/site-packages/pip/_vendor/resolvelib/LICENSE | 751 | `f388fd38cad13112c1dc0f669bbe80e7f84541edbafb72f3030d2ca7642c3c9d` |
| python/Lib/site-packages/pip/_vendor/rich/LICENSE | 1056 | `deed7c17a4318158190a3ea239cc879a5a50271cebb98ae7025f48fbe58dca15` |
| python/Lib/site-packages/pip/_vendor/tomli/LICENSE | 1072 | `b80816b0d530b8accb4c2211783790984a6e3b61922c2b5ee92f3372ab2742fe` |
| python/Lib/site-packages/pip/_vendor/tomli_w/LICENSE | 1072 | `b80816b0d530b8accb4c2211783790984a6e3b61922c2b5ee92f3372ab2742fe` |
| python/Lib/site-packages/pip/_vendor/truststore/LICENSE | 1086 | `33be7b7e8fa4fd19b1760e1a8ed8a668bdab852c91b692dd41424bcb725a9fca` |
| python/Lib/site-packages/pip/_vendor/urllib3/LICENSE.txt | 1093 | `130e3a64d5fdd5d096a752694634a7d9df284469de86e5732100268041e3d686` |
| python/tcl/tk8.6/demos/license.terms | 2307 | `0d1e4405f6273f091732764ed89b57066be63ce64869be6c71ea337dc4f2f9b5` |
| python/tcl/tk8.6/license.terms | 2307 | `0d1e4405f6273f091732764ed89b57066be63ce64869be6c71ea337dc4f2f9b5` |

## Node 22.23.3 完整 LICENSE

归档成员：`node-v22.23.3-win-x64/LICENSE`。本地与 ZIP 成员一致：148217 字节，SHA256 `8cc9bb466b19fc7e7cc99d03e9df1132021fda8b01eea2624c58bb372dbef576`。

- 顶层 Node/历史 Joyent 部分为 MIT；实际文本明确将外部维护库单列。完整文件包含43个顶级外部库条目，必须整体保留，不能只截取首段 MIT。
- V8 为 BSD 类许可并列出其外部代码；ICU 含 Unicode-3.0、历史 ICU 许可、字典数据、时区数据与其他 notices；Apache 部分包括 OpenSSL、swc、simdjson 等。BSD 的二进制版权/免责与不背书要求、Apache 的许可/适用 NOTICE/修改说明/专利条款均不可省略。
- ICU 明确列出构建脚本的 GPL 与 Autoconf 例外，不能仅检索到 GPL 单词就把 node.exe 判为 GPL，也不能删除这些原文。其字典数据另有版权及条件。
- npm 部分是 Artistic-2.0 及其自己的依赖条款；当前指定 Node 提取目录只有 node.exe 与 LICENSE，不把 npm 的分发范围混同于 node.exe。若后续增加 npm/corepack/其他文件，须重新核对实际交付范围。
- HdrHistogram 文本提供 public-domain/CC0 与 BSD-2-Clause 选择；建议记录实际选择并保留完整文本，不重新概括成 Node MIT。
- 允许继续准备的有界路线：官方未改动 node.exe、完整原字节 LICENSE、来源 SHA/SBOM、无商标背书声明。没有基于这些已读段落确认一个禁止所有商业分发的总条款；这不构成对所有用途、专利、数据服务或未知第三方权利的保证。
- 本轮不替 Windows 以外的 Node 资产做许可成员等价性推断，不将整份复合 LICENSE 强标为单一 MIT 的审批表达式。可用受审的 LicenseRef 绑定完整组合文本，而非丢弃子许可。

## Provider 候选摘要

实际读取的目录：
- `D:/RT-ResearchFlow-BuildCache/private-runtime-1.7/providers/akshare`
- `D:/RT-ResearchFlow-BuildCache/private-runtime-1.7/providers/pywencai`
- `D:/RT-ResearchFlow-BuildCache/runtime-mootdx-feasibility-1.7`

实际 dist-info 数：AKShare 29、pywencai 40、mootdx 22。这些是当前候选目录观测，不是最终 resolver 锁定闭包或批准数量。pywencai 当前40项与先前“39依赖”口径不可直接混用；正式 prep 必须以本次锁定结果和新建安装集合核对，不能预填历史数量。

### 三个主包原文

| Provider | 版本 | 实际许可路径（相对各 site） | 字节 | 完整 SHA256 |
| --- | --- | --- | --- | --- |
| akshare | 1.19.1 | akshare-1.19.1.dist-info/licenses/LICENSE | 1073 | `d1c84fbaccd5fdbc75cd12ab9a05f4f791d89ee266569bc976c8b0befafc2d65` |
| pywencai | 0.13.1 | pywencai-0.13.1.dist-info/licenses/LICENSE | 1062 | `f619e8a9798a5fd5be106923ab8a02f17aa0f3820195aa310cdf62b154724368` |
| mootdx | 0.11.7+rt.1 | mootdx-0.11.7+rt.1.dist-info/LICENSE | 1065 | `ee03a051e103766e566b0a3ac0532daa665bb063cf8f30de46fd7c7ac9d00ec6` |

- AKShare 主包 MIT，版权 Albert King 2019-2026；pywencai 实际 LICENSE 为 MIT，版权 beima 2022，metadata 未声明不能误说无许可证。保留版权/许可/免责。软件许可不授予问财/行情数据使用权或绕过访问限制的权利。
- mootdx 实际 LICENSE 为 MIT，但此前原始 README 非商业描述的冲突关注仍未关闭，本轮不重新解释成无条件商业授权。修改版必须保留原说明、上游来源和变更记录。
- mootdx 正式分发路径：优先取得权利人对当前版本、派生修改和预期分发用途的书面澄清；否则保持该 profile 的 seal 阻断。如不能取得，可另行评估权利清楚的等价 TDX 实现/干净实现，但须显式产品决策、功能与协议回归，不默默删支持、不改名掩盖原库、不要求用户自行安装来规避限制。

### 候选主包来源证据

以下来自本轮只读的既有 pip resolution 报告，不等同于本轮重新下载并核对 wheel 与已安装每个文件。许可证全文 SHA 已对 site 实际字节计算；正式 prep 仍需建立 artifact SHA 到 tree 的完整链。

| Provider | 报告中的上游 URL | 报告中的 wheel SHA256 | 报告本身 SHA256 |
| --- | --- | --- | --- |
| akshare | https://files.pythonhosted.org/packages/fa/b5/1b5e3bde55427d3a165390b973ed2d3aefd56ba7a78732c635b700b9bf9c/akshare-1.19.1-py3-none-any.whl | 8ab82d4a468d2c384df02de470df3a44e8b899fd8cfe116bceff52dd7b804df9 | 4054538e2c21760b406d1f5c9b1af2d2d8b017406b63236ccdbe6b15ef3b6257 |
| pywencai | https://files.pythonhosted.org/packages/c7/71/6fa9606a3c042e59f8020914e59d4d4919100e0cd53697d7e2a677f70835/pywencai-0.13.1-py3-none-any.whl | 6786a014baed92cef25d855f8f175c5265868552dfacd7e37c098f92e4e038ff | 180663cf77d67d1a0f2029f5cb8c4c816d55345e77733be9948e4b980645180d |

mootdx 派生产物的既有审计来源 pin：
- 上游 `eab475f1d08b1c71ea51212c8b1b1038c4739798f7d95ad1a6fb7bb26e348ef2`。
- 派生 `35f282624ed7a2a6908b4b847fba9119e7fb376cd00797606ee5ee97b6139f77`，413852字节。
本轮未重新下载 mootdx wheel；这些是此前已核验上下文，不能拿它们自动批准 README 冲突。

### 不能默默放行的传递依赖事项

- lxml 6.1.3 的实际 `licenses/LICENSES.txt`（6348字节，SHA `df682c668de65321677b5e4861dca4128a8bad8067f230956e9da3f985b3d398`）明确说 binary wheels 包含 iconv，标 LGPL-2.1；并列出其他资源及部分标为 unlicensed 的 XSL。顶层 BSD 不足。需核对当前 wheel 实际链接和交付成员，确认相应源码/替换或重链接等合规安排及资源权利，必要时请合格法律人员审查；本轮不判定整个应用需开源。
- pyzmq 27.2.0 的 ZeroMQ 许可全文是 MPL-2.0，libsodium 为 ISC；certifi 和 tqdm 也不能仅按顶层 MIT/BSD 处理。分别确认适用文件、源代码取得渠道、修改记录及随包 notices。
- MiniRacer dist-info 的 ISC 不独自证明 V8/ICU 原生资源的许可闭包；curl_cffi 顶层 MIT 不独自证明 vendored curl/TLS 等闭包；NumPy 组合许可和 native BLAS/运行库也需按实际 binary 分发核对。此处未审完的 native-vendor 范围保留 pending。
- 旧 AKShare 候选 jsonpath 0.82.2 的 dist-info 中本轮未找到 LICENSE/NOTICE 类文件。不能据 metadata MIT 放行，也不能由此推断已审源码 wheel 丢失许可；该旧 site 不是新配方正式重装输出。后续使用已审派生 wheel 的完整源码许可/审计目录核验。
- 原始声明 License-File 中 lxml LICENSES.txt、NumPy dragon4_LICENSE.txt 不是普通 LICENSE 前缀，已补充按声明精确路径读取及计 hash，避免只按文件名正则遗漏。
- 本附录是候选证据索引而非逐包 approved 清单。正式审批还须绑定最终各平台实际 artifact SHA、适用许可全文 SHA、reviewer/reference 与用途；unknown/pending 不得 seal。

## 给 prep 的明确交接条件

1. 原样保存 full 19份、PYTHON.json、install-only 原 LICENSE 与所有实际随包 vendor notices，保持路径映射、来源成员及完整 hash；不要用本文摘要替换许可原文。
2. Node 原 LICENSE 整份随包。官方原包、派生 wheel 原包/配方/产物、许可文本分别绑定，不能将摘要文字或元数据许可证标签当全文证据。
3. 本记录不直接生成 preparation.policy.json 的 approved。只有负责方明确接受适用条件且关闭上述材料/履约缺口后，才逐项写带 artifactSha256、licenseSha256、reviewedBy、reviewReference 的批准记录。
4. BDB、Tix、Windows Distributable Code、mootdx README、lxml/原生 vendoring 及 MPL 范围的未决事项分别记录，不把一个包的批准传递给所有依赖。
5. 真正最终 tree、SBOM、安装包包含 notices 的校验仍待正式 prep/build/install；不以本轮缓存文本审核替代。

## 附录：候选 dist-info 许可全文哈希索引

以下为实际本地读取的许可/NOTICE/AUTHORS 文本，重复 site 的相同路径和 SHA 合并标注。保留完整嵌套路径；作者清单也是 notices 材料，不等于独立许可授权。未列的包内嵌源码/原生资源 notices 不表示不存在，本轮不宣称 vendor 穷尽覆盖。

| Site | 相对路径 | 字节 | 完整 SHA256 |
| --- | --- | --- | --- |
| akshare | akshare-1.19.1.dist-info/licenses/LICENSE | 1073 | `d1c84fbaccd5fdbc75cd12ab9a05f4f791d89ee266569bc976c8b0befafc2d65` |
| akshare | beautifulsoup4-4.15.0.dist-info/licenses/AUTHORS | 2201 | `b989238918e1fdac1e46717cb405b63e92497a272413af0d989c1df6c8abcb6f` |
| akshare | beautifulsoup4-4.15.0.dist-info/licenses/LICENSE | 1441 | `55b4d8d4b1e5bc86d10efac91b74c87bcb77526b0f5b9edaf8b9cd2adc7397b2` |
| akshare,pywencai,mootdx | certifi-2026.7.22.dist-info/licenses/LICENSE | 989 | `e93716da6b9c0d5a4a1df60fe695b370f0695603d21f6f83f053e42cfc10caf7` |
| akshare | cffi-2.1.1.dist-info/licenses/LICENSE | 1123 | `5ba24ddc57067f9249add644c3afc41a5d6dc37e23433ef759d95df370b0af63` |
| akshare,pywencai | charset_normalizer-3.5.2.dist-info/licenses/LICENSE | 1092 | `18577485d3704f1a479ded8e573c0976cfed315fd2fd17983fa988da4c2f70d1` |
| akshare,pywencai,mootdx | colorama-0.4.6.dist-info/licenses/LICENSE.txt | 1491 | `cac35c02686e5d04a5a7140bfb3b36e73aed496656e891102e428886d7930318` |
| akshare | curl_cffi-0.16.3.dist-info/licenses/LICENSE | 1129 | `47e6ce96c02170758c16164e66f920620db614523d642eba5000ba0c7aa2be6e` |
| akshare | decorator-5.3.1.dist-info/licenses/LICENSE.txt | 1308 | `bd12cc51405c10872497c10ca21601f1d4abc50496595cc89e89ab5dad24fb62` |
| akshare | et_xmlfile-2.0.0.dist-info/AUTHORS.txt | 82 | `7f038029ea5463605dd2278d300099a381bce9e90dda83ccab2042346b6c8107` |
| akshare | et_xmlfile-2.0.0.dist-info/LICENCE.python | 14688 | `4ccdaaebc0f44b83720ec0399bb7ab329adce067dd62f73c5535a2dc05628ab2` |
| akshare | et_xmlfile-2.0.0.dist-info/LICENCE.rst | 1131 | `0c84bb42f5d367e5ebf9fc2dde35b16141df5ee0fdc189250858bc6c5560f69e` |
| akshare | html5lib-1.1.dist-info/AUTHORS.rst | 983 | `0eb3403227e80e9b90c899fe296f87e8af13b766b9aca9d5d94178f8346b1942` |
| akshare | html5lib-1.1.dist-info/LICENSE | 1084 | `16a39991619e92f18680932da2a9199fdf7d95df3ecaedc52ea06218aabafd6f` |
| akshare,pywencai,mootdx | idna-3.20.dist-info/licenses/LICENSE.md | 1541 | `1a9a4f0e3d479a27240ddd59a9137a66ab4a0f9dfdc8ca6188cc0bfd85187f04` |
| akshare | lxml-6.1.3.dist-info/licenses/LICENSE.txt | 1538 | `e7c3ce8d76331b0101cc46790ab43958ea90a364bcf962ed8763d5a818340e69` |
| akshare,mootdx | mini_racer-0.12.4.dist-info/licenses/AUTHORS.md | 320 | `48ca3140561c2fea05f5d8b10c8a7bd5a1229241eaeee80c53d5b80d823abada` |
| akshare,mootdx | mini_racer-0.12.4.dist-info/licenses/LICENSE | 760 | `554401102688806b6a517f6aa80c8eca6b52ec409f555c8f4e9e4e3789b5d235` |
| akshare,pywencai,mootdx | numpy-2.5.3.dist-info/licenses/LICENSE.txt | 45831 | `a804dff0ead9fadc5293456410bcbfc32bf024be9c4513459663fb7b442d2341` |
| akshare,pywencai,mootdx | numpy-2.5.3.dist-info/licenses/numpy/fft/pocketfft/LICENSE.md | 1523 | `8db000e158c162e7249787852d8c69764706502ccee725c06641b31c1e95c8af` |
| akshare,pywencai,mootdx | numpy-2.5.3.dist-info/licenses/numpy/linalg/lapack_lite/LICENSE.txt | 2314 | `19060ef465e1797d682ee0fc3081bd25ab1395e995e43d25c9d13c95d9a3cd6b` |
| akshare,pywencai,mootdx | numpy-2.5.3.dist-info/licenses/numpy/ma/LICENSE | 1616 | `d78dbb208b80d92b4d333e41a4baae50d12444f46e53199fa7726a91de6e2da7` |
| akshare,pywencai,mootdx | numpy-2.5.3.dist-info/licenses/numpy/random/LICENSE.md | 3582 | `b4bc2f4fa1c95778f1ed3dd8f14706bece399475b978f9f34b5d3cd72521b48a` |
| akshare,pywencai,mootdx | numpy-2.5.3.dist-info/licenses/numpy/random/src/distributions/LICENSE.md | 2805 | `cf5619f25b112d5ce7c896efffc8e610bcb345dfadcc19f2c1460aa48fff2c9e` |
| akshare,pywencai,mootdx | numpy-2.5.3.dist-info/licenses/numpy/random/src/mt19937/LICENSE.md | 2986 | `92c10699884321f1c2947fe2a70ab23b0fbf1507f756d89dd08f38c61fc3d4fa` |
| akshare,pywencai,mootdx | numpy-2.5.3.dist-info/licenses/numpy/random/src/pcg64/LICENSE.md | 1176 | `41190663b77bee5302386495a07b7eabfbfa571aa0ae2f11da6764162062fc4f` |
| akshare,pywencai,mootdx | numpy-2.5.3.dist-info/licenses/numpy/random/src/philox/LICENSE.md | 1540 | `322ac46d870c8aeead6c53adcccc839296fb3c8e456eae155081297daf7f8013` |
| akshare,pywencai,mootdx | numpy-2.5.3.dist-info/licenses/numpy/random/src/sfc64/LICENSE.md | 1253 | `28cad82ce1379dc529df30da78ec012d7d0d1d576b03ddcb93388aee53659f59` |
| akshare,pywencai,mootdx | numpy-2.5.3.dist-info/licenses/numpy/random/src/splitmix64/LICENSE.md | 340 | `454ec7350e478e037061850b67395753b425b1cb0a34bbc26290b020bf89d763` |
| akshare,pywencai,mootdx | numpy-2.5.3.dist-info/licenses/numpy/_core/include/numpy/libdivide/LICENSE.txt | 1039 | `d544761558b510866c21f7e8a2d5716fca76e0b98117e3b6b86314db7244d150` |
| akshare,pywencai,mootdx | numpy-2.5.3.dist-info/licenses/numpy/_core/src/common/pythoncapi-compat/COPYING | 704 | `aea41976c720f91bd19725c16916a1ace40eb1ea42620d340e587a5de4bbcea0` |
| akshare,pywencai,mootdx | numpy-2.5.3.dist-info/licenses/numpy/_core/src/highway/LICENSE | 21155 | `d208152e2777ffd0126eacc1bd21c0320d69e4e6b622d21a2a12a47e8ef73763` |
| akshare,pywencai,mootdx | numpy-2.5.3.dist-info/licenses/numpy/_core/src/npysort/x86-simd-sort/LICENSE.md | 1542 | `a732977853530066790c42817087f4829b518dd98d340c916acbfd227e39d3cb` |
| akshare,pywencai,mootdx | numpy-2.5.3.dist-info/licenses/numpy/_core/src/umath/svml/LICENSE | 1573 | `585483905b13d4b42f800c55ba99e89d6e2e33ccd5f503e201c07531d148ff41` |
| akshare | openpyxl-3.1.5.dist-info/LICENCE.rst | 1131 | `0c84bb42f5d367e5ebf9fc2dde35b16141df5ee0fdc189250858bc6c5560f69e` |
| akshare,pywencai,mootdx | pandas-3.0.6.dist-info/LICENSE | 1634 | `9850f6b5bdef7346503065807b878deb8058b976c5c329f4c4d23bf4796ce9ae` |
| akshare | pycparser-3.1.dist-info/licenses/LICENSE | 1543 | `0a9e78156ae8b96caf1b4f11ac2df424b83de29736f9e757630548a6272fdf90` |
| akshare,pywencai,mootdx | python_dateutil-2.9.0.post0.dist-info/LICENSE | 2889 | `ba00f51a0d92823b5a1cde27d8b5b9d2321e67ed8da9bc163eff96d5e17e577e` |
| akshare,pywencai | requests-2.34.2.dist-info/licenses/LICENSE | 10142 | `09e8a9bcec8067104652c168685ab0931e7868f9c8284b66f5ae6edae5f1130b` |
| akshare,pywencai | requests-2.34.2.dist-info/licenses/NOTICE | 38 | `f5110972dedad2b4e9d314518daf3b7d72d6e02e499acd802181de6f74571dcc` |
| akshare,pywencai,mootdx | six-1.17.0.dist-info/LICENSE | 1066 | `4375ba20e2b9c6c4e7cad2940a628fd90e95cc3d50ee92aae755715d8ba1fbd0` |
| akshare | soupsieve-2.10.dist-info/licenses/LICENSE.md | 1096 | `76a0acdb98c3a63681e20b6f096699ef8cad5fb35d56eef8387e0fa71d797a9a` |
| akshare | tabulate-0.10.0.dist-info/licenses/LICENSE | 1080 | `cdfab50d37d8ead06468fb76a3abafcd05c16749ec8a18eebfa50fd48c7cb2d2` |
| akshare,mootdx | tqdm-4.70.1.dist-info/licenses/LICENCE | 1985 | `fcff87c3a47ce8028a8512aa182d4fcf0ad1c90544ee75cf9b343684cac194de` |
| akshare,pywencai,mootdx | typing_extensions-4.16.0.dist-info/licenses/LICENSE | 13936 | `3b2f81fe21d181c499c59a256c8e1968455d6689d269aa85373bfb6af41da3bf` |
| akshare,pywencai,mootdx | tzdata-2026.5.dist-info/licenses/LICENSE | 625 | `df58f69ea88683035d720b5375bcef0cf5aeaa98a1d098d572e0992c378deb46` |
| akshare,pywencai,mootdx | tzdata-2026.5.dist-info/licenses/licenses/LICENSE_APACHE | 11357 | `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4` |
| akshare,pywencai | urllib3-2.8.0.dist-info/licenses/LICENSE.txt | 1093 | `130e3a64d5fdd5d096a752694634a7d9df284469de86e5732100268041e3d686` |
| akshare | webencodings-0.6.1.dist-info/licenses/LICENSE | 1519 | `e06ef33485e7498ad592887c41fa79cc8a7fecde576c7210e11bfdddef58040e` |
| akshare | xlrd-2.0.2.dist-info/LICENSE | 3771 | `b5a5dbce60265e305a815a6cb83ed07f24519d8ba644f2a307994488bced8815` |
| pywencai | asttokens-3.0.2.dist-info/licenses/LICENSE | 11359 | `62fb8a3a9621dc2388174caaabe9c2317b694bb9a1d46c98bcf5655b68f51be3` |
| pywencai | comm-0.2.3.dist-info/licenses/LICENSE | 1515 | `97a7e0a142b7c1dcd26461b20fc13980988b4449b7446ed776928826fd2ca9c4` |
| pywencai | debugpy-1.8.22.dist-info/licenses/LICENSE | 1200 | `649844f60da138e54b9bcc13338c62c5f97be8612cb6249ac10f84bbb97ffc88` |
| pywencai | executing-2.2.1.dist-info/LICENSE.txt | 1066 | `a476a2cb0ef4c41450340a577a28b91ac4c7f669136b2ee148047fabd5fc4181` |
| pywencai | fake_useragent-1.5.1.dist-info/AUTHORS | 409 | `aaf1d49d3b941a098bde959939cbe357b589cd96acd4b05acc121cb8565bf009` |
| pywencai | fake_useragent-1.5.1.dist-info/LICENSE | 11350 | `fd9b6273f22b7c29dbc5160b800f8824b74cf048f89e39a11b5c23c10f46d692` |
| pywencai | ipykernel-7.4.0.dist-info/licenses/LICENSE | 1533 | `36ec29c871f7a382cde301cba47698191cf327c3f95ff5c240065e95dde80bfd` |
| pywencai | ipython-9.17.1.dist-info/licenses/COPYING.rst | 1637 | `8387aac32433e5b121c355aa9e6ce2b9a399da7edd59ab94b19d4f5326b1ced0` |
| pywencai | ipython-9.17.1.dist-info/licenses/LICENSE | 1720 | `e0e390748ed440ab893ca1f135a88a920aaf5409dbb90a5b427c75c5e51268fb` |
| pywencai | ipython_pygments_lexers-1.1.1.dist-info/LICENSE | 1535 | `b1d0dbc0fa79774d34b8e2d0aec91d50d8caf05f7b40fc22c3010a4bd9ad2bf9` |
| pywencai | jedi-0.20.0.dist-info/AUTHORS.txt | 2661 | `d0b472b36617b4af87481671338dd649139e5c619090937ba317c98bed2bbff2` |
| pywencai | jedi-0.20.0.dist-info/LICENSE.txt | 1241 | `78e60cd0b8f28694f30195482c33d76908d846b0d15278deb7332aa22ba8e412` |
| pywencai | jupyter_client-8.10.0.dist-info/licenses/LICENSE | 1588 | `5ca74e4d2eeb9330b0d129c25f874d3544a13413bc62ae8d367819100d095072` |
| pywencai | jupyter_core-5.9.1.dist-info/licenses/LICENSE | 1536 | `448f1835f5fa08dd075088e46f76f73eb9ac9c2aef0a6c8816be06d30ef592c7` |
| pywencai | matplotlib_inline-0.2.2.dist-info/licenses/LICENSE | 1538 | `8521b036c6448e0e0aa7213d4713b6fdee0f4c64c9f320450f77346bf5c0e8e4` |
| pywencai | nest_asyncio2-1.7.4.dist-info/licenses/LICENSE | 1347 | `cec819c02a99e78449d64f3c0217d415c3a210f2a6abfcd827c6b1cb76954e78` |
| pywencai | packaging-26.3.dist-info/licenses/LICENSE | 197 | `cad1ef5bd340d73e074ba614d26f7deaca5c7940c3d8c34852e65c4909686c48` |
| pywencai | packaging-26.3.dist-info/licenses/LICENSE.APACHE | 10174 | `0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594` |
| pywencai | packaging-26.3.dist-info/licenses/LICENSE.BSD | 1344 | `b70e7e9b742f1cc6f948b34c16aa39ffece94196364bc88ff0d2180f0028fac5` |
| pywencai | parso-0.8.7.dist-info/AUTHORS.txt | 2029 | `4830a0bbc85794105c8cf3f2513f92296db4fc83363315bef7984a15a448ab22` |
| pywencai | parso-0.8.7.dist-info/LICENSE.txt | 4176 | `fa67973073753d17624caf8684d5ee816d70c89d912c5bca7ca0f08e7b150edb` |
| pywencai | platformdirs-4.12.4.dist-info/licenses/LICENSE | 1089 | `29e0fd62e929850e86eb28c3fdccf0cefdf4fa94879011cffb3d0d4bed6d4db6` |
| pywencai | prompt_toolkit-3.0.53.dist-info/licenses/AUTHORS.rst | 148 | `d3dc62c6bc8436658495ab89aea37511e7fa9391d282657239c9cfb80dbd42e5` |
| pywencai | prompt_toolkit-3.0.53.dist-info/licenses/LICENSE | 1493 | `303574d9bdd85c757d6025017942bf17baeedf2778f62bd7f425d07d880f4c4a` |
| pywencai | psutil-7.2.2.dist-info/LICENSE | 1577 | `c7adc4d5d1337a548b967421f1fbe258b93033a0417708fd6f4e38f8ecbceb80` |
| pywencai | pure_eval-0.2.4.dist-info/licenses/LICENSE.txt | 1066 | `a476a2cb0ef4c41450340a577a28b91ac4c7f669136b2ee148047fabd5fc4181` |
| pywencai | pydash-7.0.7.dist-info/AUTHORS.rst | 1396 | `6f61fcb95e6a64d2c2cf519d01165348d2d833eaaa7dbd0f1cf3dca1795e24c8` |
| pywencai | pydash-7.0.7.dist-info/LICENSE.rst | 1072 | `1bba57c33cce44a00d2edf0794e14bd0c6dc1569a4e78d834c8f4103b8e9623f` |
| pywencai | pyexecjs-1.5.1.dist-info/licenses/LICENSE | 1118 | `b78c9017c899272226bb1cbd8ffe79f43630699bf2ba1fdae3d4e7b41d85ae04` |
| pywencai | pygments-2.21.0.dist-info/licenses/AUTHORS | 11048 | `71a83872ad82f57be692cf827e048e2cd51d45169cfa1ea3f28706d97a872c0f` |
| pywencai | pygments-2.21.0.dist-info/licenses/LICENSE | 1331 | `a9d66f1d526df02e29dce73436d34e56e8632f46c275bbdffc70569e882f9f17` |
| pywencai | pywencai-0.13.1.dist-info/licenses/LICENSE | 1062 | `f619e8a9798a5fd5be106923ab8a02f17aa0f3820195aa310cdf62b154724368` |
| pywencai | pyzmq-27.2.0.dist-info/licenses/LICENSE.md | 1575 | `947ffe0146e8b3c23a759ddff8eccb8b0d2b201ccbc0a5750db4ac3cfc034e2a` |
| pywencai | pyzmq-27.2.0.dist-info/licenses/licenses/LICENSE.libsodium.txt | 823 | `508a76d186356c0dd807a670ef510964f8724557024796a2c426c6c0e19ab683` |
| pywencai | pyzmq-27.2.0.dist-info/licenses/licenses/LICENSE.tornado.txt | 11560 | `3ddf9be5c28fe27dad143a5dc76eea25222ad1dd68934a047064e56ed2fa40c5` |
| pywencai | pyzmq-27.2.0.dist-info/licenses/licenses/LICENSE.zeromq.txt | 16725 | `1f256ecad192880510e84ad60474eab7589218784b9a50bc7ceee34c2b91f1d5` |
| pywencai | stack_data-0.6.3.dist-info/LICENSE.txt | 1066 | `a476a2cb0ef4c41450340a577a28b91ac4c7f669136b2ee148047fabd5fc4181` |
| pywencai | tornado-6.5.10.dist-info/licenses/LICENSE | 11560 | `3ddf9be5c28fe27dad143a5dc76eea25222ad1dd68934a047064e56ed2fa40c5` |
| pywencai | traitlets-5.16.1.dist-info/licenses/LICENSE | 1536 | `2f51727d9063b54856773cb51388bdb79f2936ee4a1b692ef553d8c4201311ab` |
| pywencai,mootdx | wcwidth-0.9.2.dist-info/licenses/LICENSE | 1349 | `dff08668b8cfca00ec90011eb318e450c3719fcd40893bf375781a6beef7143a` |
| mootdx | anyio-4.15.1.dist-info/licenses/LICENSE | 1081 | `5361ac9dc58f2ef5fd2e9b09c68297c17f04950909bbc8023bdb82eacf22c2b0` |
| mootdx | click-8.5.0.dist-info/licenses/LICENSE.txt | 1475 | `9a8ad106a394e853bfe21f42f4e72d592819a22805d991b5f3275029292b658d` |
| mootdx | h11-0.16.0.dist-info/licenses/LICENSE.txt | 1124 | `37db5bb85926db28a427a25867f10b1232003aea1be69ccb851138adb8e6f361` |
| mootdx | httpcore-1.0.9.dist-info/licenses/LICENSE.md | 1518 | `fdcb59154c74cbaba16a11242f7740bea9f23d6feb5547917d8c5f94a80392a5` |
| mootdx | httpx-0.25.2.dist-info/licenses/LICENSE.md | 1508 | `4ec59d544f12b5f539a3a716fd321ac58ccd8030b465221f2c880200cdf28d8d` |
| mootdx | mootdx-0.11.7+rt.1.dist-info/AUTHORS.rst | 86 | `6e7b7bde9bf124e306122b8aabe46eb81e12a37ea74777d708b79c958aab051c` |
| mootdx | mootdx-0.11.7+rt.1.dist-info/LICENSE | 1065 | `ee03a051e103766e566b0a3ac0532daa665bb063cf8f30de46fd7c7ac9d00ec6` |
| mootdx | prettytable-3.18.0.dist-info/licenses/LICENSE | 1612 | `0c8adcc204c8af6cdfdf7887dfd1f99c29901f6c1d505a78bba96efa4fb2cb05` |
| mootdx | sniffio-1.3.1.dist-info/LICENSE | 185 | `652c878488d1456361e08c3f8607fd7ba59892a14103d15cce4ff93c85b5cc8b` |
| mootdx | sniffio-1.3.1.dist-info/LICENSE.APACHE2 | 11358 | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` |
| mootdx | sniffio-1.3.1.dist-info/LICENSE.MIT | 1046 | `3e6dae555eb92787fc82d1d48355677f454c7f65aeb38d3f9e72bf9a3daf034b` |
| mootdx | tdxpy-0.2.7.dist-info/LICENSE | 1064 | `fd2d2d610584198f900995e2d3ce121a2fd50c61416a74bb3de40cc88dffa2dd` |
| mootdx | tenacity-8.5.0.dist-info/LICENSE | 11357 | `58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd` |
| akshare | lxml-6.1.3.dist-info/licenses/LICENSES.txt | 6348 | `df682c668de65321677b5e4861dca4128a8bad8067f230956e9da3f985b3d398` |
| akshare,pywencai,mootdx | numpy-2.5.3.dist-info/licenses/numpy/_core/src/multiarray/dragon4_LICENSE.txt | 1441 | `b0fd592d4ead563148e3977e7b589169d46a5ef2ff133c755a81af880a3fc919` |


## 2026-10-09 补充：可实施的 notices / LGPL / Windows CRT 闭环

本节补充前述 pending 的实施路径，不覆盖原始证据，也不修改 preparation.policy.json 的 decision。所有网络证据来自官方项目、其固定源码仓库或官方软件分发方。下载只在内存中审阅/计算 SHA256；没有安装、更改 provider 或运行联网行情。另以指定 PBS 隔离解释器读取了一次 lxml 编译版本常量，禁 socket/DNS、清空继承环境、禁写 pyc，exit 0；这不是 provider 功能测试或完整依赖验收。

### A. Tix：缺失附属 notices 已找到，可直接补齐

PBS 固定版本 [downloads.json](https://github.com/astral-sh/python-build-standalone/blob/20261003/pythonbuild/downloads.json) 将 Tix 源码指向 CPython 官方 source-deps 的 8.4.3.6，而不是仅凭安装目录 tix8.4.3 猜测源版本。实际获取的源码包与 PBS pin 完全一致：

| 资产 | bytes | SHA256 |
| --- | ---: | --- |
| [cpython-source-deps tix-8.4.3.6.tar.gz](https://github.com/python/cpython-source-deps/archive/tix-8.4.3.6.tar.gz) | 1836451 | f7b21d115867a41ae5fd7c635a4c234d3ca25126c3661eb36028c6e25601f85e |
| cpython-source-deps-tix-8.4.3.6/license.terms | 2828 | 91ff35309038fcfab853c8634b7b743a179c211d8ff3cb174b579c8af3c3072d |
| cpython-source-deps-tix-8.4.3.6/docs/license.tcltk | 2107 | def74f610b8682dd12a772954ee8ad07d304cdf106abb6e030f71ee489419d1a |
| cpython-source-deps-tix-8.4.3.6/docs/license.html_lib | 2022 | 9149f81c6efd1c3cef68742b67dc6f1b6211f32f425f3b6d24cf5279668cfd27 |

这三份原文均允许按其条件使用、复制、修改、分发和许可；关键义务是保留版权及原文 notices，修改部分的不同条款须明确标记，保留免责及政府使用条款。HTML Library notice 明确只覆盖 HTML Library，不覆盖整个 Tix。不能只留一个笼统 Tcl 标签。

最小交付：在正式 runtime notices 中新增以下三个成员，原始字节提取，不改换行、不以中文摘要替代；仍保留 full 的 LICENSE.tix.txt，不能用源包 license.terms 覆盖它（两者字节及大小不同）。

- licenses/tix-8.4.3.6/license.terms
- licenses/tix-8.4.3.6/docs/license.tcltk
- licenses/tix-8.4.3.6/docs/license.html_lib

来源记录至少绑定以上源码资产 URL/size/SHA、成员路径/size/SHA、PBS 资产 SHA。PBS Windows 的 Tcl/Tk 8.6.15 二进制来源另有明确 pin：[cpython-bin-deps c807be2b19bafc06767b2ed8afec4d5f9a9553b2.tar.gz](https://github.com/python/cpython-bin-deps/archive/c807be2b19bafc06767b2ed8afec4d5f9a9553b2.tar.gz)，声明 size 10421420、SHA256 3c661a23751be04d901ce96611c325f88e970273dcbf5394982c1745100a6d8c；此二进制源包本节未重新下载，不能把声明 pin 写成新增实测。补 notices 不声称已重编 Tix 或证明二进制可重复构建。

关闭条件：Franklin 按上述固定源包补入三份全文，assembler 校验成员原始 hash、安装产物保留且可访问，经具名 reviewer 记录后才可改变对应 policy decision。无须等待不明作者补授权，也不需要移除 Tk/Tix 或修改其库代码。

### B. lxml 的实际 LGPL 组件与对应源资产

当前 akshare 候选的 wheel 证据：
[lxml-6.1.3-cp313-cp313-win_amd64.whl](https://files.pythonhosted.org/packages/c0/28/e46a7702bd95e9043291f7c3539b6184cba66f96cea9936f20939b284eeb/lxml-6.1.3-cp313-cp313-win_amd64.whl)，pip report SHA256 e477aca0bc0d19f3b4ae9e4f2a1cfd687c31bf772d78734910658186b40b2477。

实际本机隔离元数据读取结果：

| 常量 | 实际值 |
| --- | --- |
| LXML_VERSION | 6.1.3.0 |
| LIBXML_VERSION / LIBXML_COMPILED_VERSION | 2.11.9 / 2.11.9 |
| LIBXSLT_VERSION / LIBXSLT_COMPILED_VERSION | 1.1.45 / 1.1.45 |
| ICONV_COMPILED_VERSION | 1.17 |

etree.cp313-win_amd64.pyd 为 4033024 bytes、SHA256 743cd66d1caee61baae5e19f9bb1bf373edcb778562fa17eea969ad4dc712f7c；objectify.cp313-win_amd64.pyd 为 1744384 bytes、SHA256 0589acb808a4cc0b96b12cd30d582969b7ca9b403a2b61c0b79f5886cd6d463e。两者常规 PE imports 未列独立 iconv/libxml2/libxslt DLL；结合上游构建脚本明确静态库构建，应按静态重链接路径准备，不能以“Python import 是动态的”免除嵌入 iconv 的材料义务。未做全部 delay-import 或完整二进制链接还原，不把单一 import 表当形式化证明。

[lxml 官方 Windows native 构建 2026.05.17](https://github.com/lxml/libxml2-win-binaries/tree/2026.05.17) 的 tag 对象 6ec8c3f328787ac1e92493c24eb660a2ca026072 指向 commit 4e8ae01f61145dc823ce2ae1d79f06241b7b46de，gitlink 固定四个 winlibs 源码。其 build.ps1 将 GNU libiconv 1.17 的 Windows 包命名为 iconv-1.17.1；这不是已证明存在一个 GNU 官方 1.17.1 release。该 release 在当前 lxml wheel 2026-09-02 发布前，版本组合吻合；2026-10-05 release 的 iconv 1.19 在 wheel 发布之后，不可倒填为当前源码。

以下六个源包已实际下载到内存、逐个计算 size/SHA，供 prep 的来源下载资产使用。GitHub 自动归档不包含 git submodule 内容，因此不能只拿最后一行构建仓库包代替四个子模块。

| 源资产（精确 URL） | bytes | SHA256 |
| --- | ---: | --- |
| [lxml-6.1.3.tar.gz](https://files.pythonhosted.org/packages/23/ad/28ecd7cb894d172f3c9c80a075eeeb2017ac62e3632cee05a5f9493547eb/lxml-6.1.3.tar.gz) | 4211198 | 45222d94ddd511536f3b2f7d9deae3b2339b4ce0f075f1ca25703b07cad9dd21 |
| [winlibs/libiconv 880a1fa8b5581e37e136a7b051947d3ea39097b6](https://github.com/winlibs/libiconv/archive/880a1fa8b5581e37e136a7b051947d3ea39097b6.tar.gz) | 5313881 | 89dd45d7f074ddae04dcd25cc4ceace3432c04b72dc36a6508854aac713f3eb6 |
| [winlibs/libxml2 bb84678855e3407fc88180295c992f9c984e28e0](https://github.com/winlibs/libxml2/archive/bb84678855e3407fc88180295c992f9c984e28e0.tar.gz) | 4225102 | 5182396205f97b183d34ab8dadd7693523c7d4e2137394aec02514a5a9a9dcf0 |
| [winlibs/libxslt c0076eaa6e0d1f99e01107e8db225a308eb1e543](https://github.com/winlibs/libxslt/archive/c0076eaa6e0d1f99e01107e8db225a308eb1e543.tar.gz) | 2705214 | d687aaf48527e042d942dccbc74fbcd150588522305e63d3e91785d9b6590677 |
| [winlibs/zlib 0089522e62e6b5d4950e62bd20f0cb06a9288413](https://github.com/winlibs/zlib/archive/0089522e62e6b5d4950e62bd20f0cb06a9288413.tar.gz) | 1559272 | e2af9f28fcdf723e464b40af73fdeed07ce3e581a9ea110702c1ba733983f8a0 |
| [lxml/libxml2-win-binaries 4e8ae01f61145dc823ce2ae1d79f06241b7b46de](https://github.com/lxml/libxml2-win-binaries/archive/4e8ae01f61145dc823ce2ae1d79f06241b7b46de.tar.gz) | 4262 | cd155987f5269d04acb549d8664b50b1ea0bf3580e1ab709587a03e4bda4396e |

来源边界：以上是有源码提交、版本和时序佐证的具体候选对应源，不是当前 PyPI wheel 的完整 producer attestation。上游 lxml buildlibxml.py 动态挑选 Windows native release，版本相同不足以证明所有补丁/构建参数完全相同。关闭这个窄缺口有两条可操作路线：取得该 wheel 原始 build provenance；或者用以上固定源码、显式配方和完整日志重建一个有独立派生身份的 lxml wheel，再正常 resolver/hashlock/materialize。后者需用户现有实施分工批准后实施，本轮未更换依赖，不允许给现有 wheel 杜撰 source attestation。

实际许可文本：
[source/include/iconv.h](https://github.com/winlibs/libiconv/blob/880a1fa8b5581e37e136a7b051947d3ea39097b6/source/include/iconv.h) 为 9553 bytes、SHA256 212dec8135b542f78dc34a6cddb59ad0665125b2c6ace6ce631778a07cb1d5be，标识 GNU Library GPL v2-or-later；[source/COPYING.LIB](https://github.com/winlibs/libiconv/blob/880a1fa8b5581e37e136a7b051947d3ea39097b6/source/COPYING.LIB) 为 LGPL 2.1 全文，26530 bytes、SHA256 dc626520dcd53a22f727af3ee42c770e56c97a64fe3adb063799d8ab032fe551。保留逐文件标识，本方案按 LGPL 2.1 第4/6节准备材料，不把库改标 MIT 或 2.1-only。source/COPYING 另为 GPL 许可，适用于该源码内相应程序；不得将命令行 iconv.exe 的许可与 libiconv 库混淆，亦不要为图省事把 GPL utility 放进 runtime。

建议实际文件交付清单（Franklin 可先收集材料，不改现有 policy 为 approved）：

- notices/native/libiconv/COPYING.LIB、完整 lxml LICENSES.txt、四个 native 源码内适用的 LICENSE/COPYING/NOTICE/AUTHORS；原版权与嵌入资源声明保留，不只给 SPDX。
- compliance/sources/source-assets.json：六份包的精确 URL/size/SHA、gitlink、所对应 wheel/PYD 哈希与架构；字段按既有 DownloadAsset 结构，不造 derived URL。
- compliance/sources/archives/：随发布提供以上完整源码包和所有本项目补丁；官方外链失效不应使接收者拿不到对应源。
- compliance/relink/windows-x64/README.md：源码布局、编译器/SDK/架构、命令、固定依赖及工具来源、输出位置和如何替换个人构建产物；不能只指向会选 latest 的上游脚本。
- compliance/relink/windows-x64/patches/、可运行构建/链接脚本及工具版本锁：包括实际采用的 winlibs/libiconv.patch（如采用，文件 SHA256 bcdef004ed4e1d2bf7569e2ba16236dd6b9e37b2658647626b9f7aba40a5b4bb）及完整上游 build.ps1（SHA256 bca4e9486154340e6ebd285dc4aac12835d212aba7cfb1766f6ef72b0d136e53）；存在 patch 不等于已证明原 producer 应用了它。
- 完整可重编译 lxml 源码/Cython 或生成 C、接口/头文件、libxml2/libxslt/zlib 源码及必需的生成/安装脚本；若选择 object-code 交付路线，再提供非 iconv 部分的 .obj/.lib 和实际链接命令，而非只交已经不可分离的 .pyd。
- SOURCE-AVAILABILITY.md：说明哪个二进制内含何版本 LGPL 库，并指向同一分发位置的材料；优先随包或同处等效下载，不默认选择需要维持至少三年的书面 offer。
- REBUILD-AND-RELINK.md：允许用户为自用修改、调试及重链接的实际路径，不能用应用 EULA 禁止这些行为。发布版哈希 fail-closed 保持；为用户重建整套应用/manifest 留下公开可操作流程，生成明确非官方的新身份，不要求厂商私钥，也不让正常产品静默信任任意篡改库。

LGPL 第6(a)允许提供完整可重链接的 source 和/或 object code，因此不必机械要求原 producer 的所有 .obj；但必须实际足以重新链接。验收应由后续已授权 isolated native job 使用交付材料更换一个可识别的兼容 libiconv 构建、重链接并运行 lxml 编码解析，确认无隐含私有输入。这里未运行该验收。Mac 两架构须分别记录其实际 native 版本/链接和源对应关系，不能继承 Windows 1.17 的结论。

### C. Microsoft CRT：有条件可完成的分发路线，不是仅附一份 EULA

已读取 PBS 安装树的 vcruntime140.dll、vcruntime140_1.dll FileVersion/ProductVersion 均为 14.44.35211.0。本节没有替换或安装 CRT。实际 python/LICENSE.txt 的原文已在前节固定哈希：22055 bytes、SHA256 76900732e5f075b725f754000ad5cab1b2cf89e355c1570138476956b6413cd3；其中 Windows 附加条款明确还涉及链接进 exe/dll/pyd 的 Microsoft Distributable Code，而不只两个旁置 DLL。

原文落实位置：保留整个 python/LICENSE.txt，在应用的第三方许可入口指向该文件的 Microsoft 附加段，另备份以下官方文档用于具名审核。不要用本段中文摘要替代实际条款。

| 官方许可原件 | bytes | SHA256 |
| --- | ---: | --- |
| [Visual C++ Runtime 2015-2022 EULA](https://visualstudio.microsoft.com/wp-content/uploads/2021/09/Visual-C-Runtime-2015-2022-License-1.docx) | 39644 | f1e3d56ceb2ad68aae0711b910375009e651ac5530fa0760f0dea6e81e54fae1 |
| [VS 2022 Build Tools 等许可，2024-03](https://visualstudio.microsoft.com/wp-content/uploads/2024/03/Visual-Studio-2022-Diagnostic-Build-Tools-Agent-License_Update-March-2024_EN.docx) | 34395 | 2f66b86a00e8d9833789897ce23d05a4a2dbea370cf39c8c1098dbc17d0e7bdc |
| [VS Community 2022 许可](https://visualstudio.microsoft.com/wp-content/uploads/2021/11/Visual-Studio-2022-Community-License-EN.docx) | 62859 | 41a207b10c8ab91d0d2f10a854715f73dca54509581692d2fe179aa3ffcb8540 |

[Microsoft REDIST 清单](https://learn.microsoft.com/en-us/visualstudio/releases/2022/redistribution) 的 Visual C++ Runtime Files 部分允许在有效 VS 许可及相关条件下分发指定 VC/redist 非 debug 文件，必须保持未修改；debug_nonredist 不可随产品分发。[官方再分发说明](https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files?view=msvc-170) 明确下载到 runtime 不等于取得再分发资格。

Runtime EULA 提供终端使用许可，本身不是向别人随应用分发的充分授权。2024 Build Tools 协议允许满足条件的 OSI 开源依赖编译，但不应仅凭“免费 Build Tools 已装”推定所有 CRT 分发权。VS Community 2022 第4节有明确 Distributable Code 授权和第三方分发路径；个人为自己的应用（包括销售）开发可适用其个人条款，组织须匹配其自身适用条件。没有证据证明本项目发行主体已经取得并履行这些权利，不能由 agent 代签或读取账户来推定。

本 Windows 应用的最小可实施路线：

1. 由实际发行主体确认并记录有效 VS Community/Professional/Enterprise 的适用资格及授权来源，或记录上游许可允许的下游分发链；生成合规记录，不收集密钥、账号或许可证 token。Community 并不当然要求付费，亦不能把私有仓库自动算成 OSI 开源发布。
2. 形成 microsoft-redist-inventory.json，列交付的 DLL 与嵌入 Microsoft code 的相关 PE 来源、版本、架构、hash，以及适用 REDIST 项；确认不是 debug/preview，保留原始文件和版权。不能把两个 DLL 的检查当所有 PE 完备审计。
3. 随安装包保留原 python/LICENSE.txt；在 licenses/microsoft/ 保存上述适用官方条款原件及 REDIST 证据版本，准备 THIRD-PARTY-MICROSOFT-TERMS 的终端展示/同意机制。需要终端和下游同意保护 Microsoft code 的适用条款，不能仅在不可见目录放文本就声称完成。
4. 条款作用域仅限明确标记的 Microsoft code：不去除版权、不借商标背书、不用于违法/欺骗程序、不将 Windows MSVC runtime 放进 Mac 包；RT-ResearchFlow 提供独立主要功能，不作为无功能的 CRT 转售壳。
5. 保留应用 AGPL 的源码、修改、再分发和适用网络源码提供义务；Microsoft 不适用于 Python 本体或在其上运行的全部程序，亦不能把 Microsoft code 重新许可为 AGPL。将 CRT 的单独许可/系统库或聚合边界交具名 reviewer 核准，不用泛化禁止反编译条款覆盖 LGPL 修改调试与应用 AGPL 权利。
6. 对无 UI 的 silent 安装和下游再分发，落实可证明的事先同意/分发条款路径；保留安装器现有安全边界，不在本轮擅自增加 CLI 开关或修改安装器。正式 seal 要求相关证据存在，而 resolve/materialize/native 研发可继续。

这是有明确官方授予条款的工程可行路线，不是要求 Microsoft 为整款金融数据应用另开特许。若发行主体不能证实所依赖授权，就先取得符合资格的正式 VS 许可/许可分发链，或由授权主体提供符合条款的分发；换一个仍含 MSVC 的 Python ZIP、静态链接、改扩展名、只附 runtime EULA 均不消除义务。用户不需要因此手装 Python 或上网 pip。

### D. Franklin 的最小实施顺序及边界

1. 现在即可 materialize Tix 三份精确 notices、现有 PBS 19全文/PYTHON.json、安装树自身完整 LICENSE 与 vendored notices、Node 完整 LICENSE；licenses 索引映射到对应资产哈希，保留原 AGPL/上游 notices。Node 原 LICENSE 继续完整保留，不因主项目 MIT 而删 ICU/V8/第三方条款。
2. 将本节六份 native 对应源候选作为独立下载资产锁定、生成来源及重新链接清单；先做材料收集和 recipe 可执行性准备，不冒充原 PyPI wheel 的 producer 证明。不调用生产环境、不缩成只有 AKShare、不使用 --no-deps。
3. 把 Microsoft 的发行资格记录、终端条款可达/同意证据、REDIST inventory 设为明确的人工审核输入；文本 hash 匹配只是事实检查，不自动写 approved。
4. 只有具体组件的封装/发布 gate 等待其证据，其他完整闭包解析、离线候选生成、三架构技术验证继续。正式完整 manifest 仍不得绕过任何未批准项，也不改成 fake-complete。
5. mootdx 原 MIT LICENSE 与 README 非商业表述仍需针对固定版本及随包再分发的范围澄清，保留二者，不得由本记录覆盖。已有 tdxpy 0.2.7 的实际 MIT 文本可作为自主维护适配器的授权底座候选，但它不等于现成完整替代 mootdx。此次 PyPI 指向的官方 GitHub 仓库 API 返回 404，因此不声称其上游持续维护。若权利澄清失败，替代应是明确由本项目维护、仅基于已核实 MIT 底座且独立实现 Reader/Quotes/holiday 所需功能的适配器，先完成能力矩阵和三端回归；这属于后续独立授权实现范围，不偷偷删除 TDX 能力或复制有争议实现。
6. 本节不对 LGPL、Microsoft/AGPL 组合给法律保证。需要具名法律/发行责任人签核的内容被缩小到授权适用事实、组件边界与实际交付义务，而不是把所有准备工作无限期标 pending。正式 approval 仍由授权 reviewer 在匹配 artifact/license hash 的 policy 记录中作出。

本次唯一工作区写入是此文档；没有增加其他 notices 文件、源包文件或修改 policy/code，没有安装、账户/生产数据访问、交易、commit、push、ref/tag/release 操作。

## E. 2026-10-09 逐资产审查决策，Astra 第一批收敛

reviewer：`Astra / engineering redistribution review / 2026-10-09`。reviewReference：`resources/python-runtime/license-review.md#e-2026-10-09-逐资产审查决策astra-第一批收敛`。本节是用户授权的具名工程审批建议，不是律师法律意见；Franklin 仍须在其独占 policy 中逐项采用准确匹配的 artifact/licenseHash，不能把同 SPDX、同包名或同版本的其他资产自动批准。

### E.1 实际执行证据和批准含义

本轮 Astra 实际只读核对了 `franklin-prep-resolve-20261009-87478042` 三个 normal resolver 报告及其实际 wheel 字节，并与 `franklin-prep-materialize-20261009-87478042/tree` 对照。下列 35 个 wheel 均逐一计算实际 SHA256、核对报告 pin，读取完整 license/notice，并将 wheel 每个安装 payload 成员（不含 pip 重写的 RECORD）与各对应 provider 候选副本逐字节哈希比较；这 35 个资产没有 unmapped 或不一致。许可判断来自实际全文，不来自元数据标签或测试计数。原始 METADATA、AUTHORS、NOTICE 与源码同样保留；不能用重写后的 SPDX 摘要替换它们。未重新执行安装、provider 或单测。

建议 `approved` 的含义限于下列精确未修改 wheel 的软件再分发许可及已实际保留的随包 notices。MIT 的复制/分发/销售授权与版权/许可保留条件、BSD 的源码/二进制 notices 条件已分别审阅；BSD-3 及类似 no-endorsement 条件不授予宣传背书权。Apache 三项已读第 2/3/4/6 条：保留全文及适用 NOTICE、原版权，未修改源码所以不虚构修改标记；后续修改必须重新审阅修改声明。不得对上游代作保证或使用商标背书。本轮没有声明市场数据、网站访问、反爬资源或账户凭据的另行使用授权。AKShare/pywencai 主 wheel 的批准不批准它们尚 pending 的传递依赖，也不构成联网可用性或整个 provider 发布批准。

下表和每项 notice 清单共同构成审批键。METADATA SHA 是来源/版权保留证据，不是另一份许可授予；若 policy 将其列为 licenseSource，可在同一资产及本项完整许可范围内标记 retained-notice approved，不能脱离主 LICENSE 单独授权。后续 materialize 目录变化不改变字节许可结论，但必须重新绑定实际路径和 inventory；正式 seal 仍验证全部资产 hash、dependencyAudit、批准身份和未满足义务。

#### E.1.1 akshare 1.19.1: approved 建议

- artifact：`akshare-1.19.1-py3-none-any.whl`；1265064 bytes；SHA256 `8ab82d4a468d2c384df02de470df3a44e8b899fd8cfe116bceff52dd7b804df9`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/fa/b5/1b5e3bde55427d3a165390b973ed2d3aefd56ba7a78732c635b700b9bf9c/akshare-1.19.1-py3-none-any.whl)。本项适用许可：`MIT`；reviewer 为本节 Astra。
- 已核对 provider：`akshare`；payload 对照 419 项，差异 0。
- 原文/附属 notice：`akshare-1.19.1.dist-info/licenses/LICENSE`；1073 bytes；licenseHash `d1c84fbaccd5fdbc75cd12ab9a05f4f791d89ee266569bc976c8b0befafc2d65`，原字节已随候选保留。
- METADATA 保留 SHA256：`62eeb65899303550636c2fee622e00350e2e6ca9baeb08889c8e2669f7d1d440`。
- 决策依据：全文明确允许复制、修改、分发及销售，所要求的版权与许可全文均已保留。

#### E.1.2 anyio 4.15.1: approved 建议

- artifact：`anyio-4.15.1-py3-none-any.whl`；132079 bytes；SHA256 `6152fdbbf9a77fdec97731721bebf7c4c44f7c29b424b0065826173efc7ed101`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/12/b8/4bd346e22b28902df4d651910f5242c28d84e4a5c2435ca5c3f797ed7e2e/anyio-4.15.1-py3-none-any.whl)。本项适用许可：`MIT`；reviewer 为本节 Astra。
- 已核对 provider：`mootdx`；payload 对照 52 项，差异 0。
- 原文/附属 notice：`anyio-4.15.1.dist-info/licenses/LICENSE`；1081 bytes；licenseHash `5361ac9dc58f2ef5fd2e9b09c68297c17f04950909bbc8023bdb82eacf22c2b0`，原字节已随候选保留。
- METADATA 保留 SHA256：`043aecb571af7189e8a6c528f5d8e32545f1b2cdfaaf761d51e6d5b67ea3ca81`。
- 决策依据：全文明确允许复制、修改、分发及销售，所要求的版权与许可全文均已保留。

#### E.1.3 beautifulsoup4 4.15.0: approved 建议

- artifact：`beautifulsoup4-4.15.0-py3-none-any.whl`；109924 bytes；SHA256 `d6f88de62e1d4e38ecb1077eb9724cd0eff29d2a08ca16a401e9b9e93f117cf9`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/88/c6/92fcd42f1ba33e1184263f25bfabf3d27c383410470f169e4b8163bf9c17/beautifulsoup4-4.15.0-py3-none-any.whl)。本项适用许可：`MIT`；reviewer 为本节 Astra。
- 已核对 provider：`akshare`；payload 对照 20 项，差异 0。
- 原文/附属 notice：`beautifulsoup4-4.15.0.dist-info/licenses/AUTHORS`；2201 bytes；licenseHash `b989238918e1fdac1e46717cb405b63e92497a272413af0d989c1df6c8abcb6f`，原字节已随候选保留。
- 原文/附属 notice：`beautifulsoup4-4.15.0.dist-info/licenses/LICENSE`；1441 bytes；licenseHash `55b4d8d4b1e5bc86d10efac91b74c87bcb77526b0f5b9edaf8b9cd2adc7397b2`，原字节已随候选保留。
- METADATA 保留 SHA256：`b2f888103259f1607c85f3b1163be1bc49fc9941a3243c3b89a21075bfc6d4fb`。
- 决策依据：全文明确允许复制、修改、分发及销售，所要求的版权与许可全文均已保留。

#### E.1.4 click 8.5.0: approved 建议

- artifact：`click-8.5.0-py3-none-any.whl`；125251 bytes；SHA256 `255bc9599cf7748b4b1a446ccc735421bd08a2ae529a8b88597d3de5664ee360`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/58/50/6c0d534c5f134586a8e1ba4e330569e32f057e33372ae556463212fb4cd3/click-8.5.0-py3-none-any.whl)。本项适用许可：`BSD-3-Clause`；reviewer 为本节 Astra。
- 已核对 provider：`mootdx`；payload 对照 21 项，差异 0。
- 原文/附属 notice：`click-8.5.0.dist-info/licenses/LICENSE.txt`；1475 bytes；licenseHash `9a8ad106a394e853bfe21f42f4e72d592819a22805d991b5f3275029292b658d`，原字节已随候选保留。
- METADATA 保留 SHA256：`e87bce0bd194de70dfb8e708e0a6b0483009f25611804eaf87bfeb63e6c20501`。
- 决策依据：源码与二进制分发许可明确；版权、三项条件及免责声明均已保留，不取得作者/机构背书许可。

#### E.1.5 colorama 0.4.6: approved 建议

- artifact：`colorama-0.4.6-py2.py3-none-any.whl`；25335 bytes；SHA256 `4f1d9991f5acc0ca119f9d443620b77f9d6b33703e51011c16baf57afb285fc6`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/d1/d6/3965ed04c63042e047cb6a3e6ed1a63a35087b6a609aa3a15ed8ac56c221/colorama-0.4.6-py2.py3-none-any.whl)。本项适用许可：`BSD-3-Clause`；reviewer 为本节 Astra。
- 已核对 provider：`akshare`、`mootdx`、`pywencai`；payload 对照 48 项，差异 0。
- 原文/附属 notice：`colorama-0.4.6.dist-info/licenses/LICENSE.txt`；1491 bytes；licenseHash `cac35c02686e5d04a5a7140bfb3b36e73aed496656e891102e428886d7930318`，原字节已随候选保留。
- METADATA 保留 SHA256：`7baed29eb50c3b29bdb33ff84e3177bf1bc05784f7685ecdcaa4471c7dd810cc`。
- 决策依据：源码与二进制分发许可明确；版权、三项条件及免责声明均已保留，不取得作者/机构背书许可。

#### E.1.6 comm 0.2.3: approved 建议

- artifact：`comm-0.2.3-py3-none-any.whl`；7294 bytes；SHA256 `c615d91d75f7f04f095b30d1c1711babd43bdc6419c1be9886a85f2f4e489417`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/60/97/891a0971e1e4a8c5d2b20bbe0e524dc04548d2307fee33cdeba148fd4fc7/comm-0.2.3-py3-none-any.whl)。本项适用许可：`BSD-3-Clause`；reviewer 为本节 Astra。
- 已核对 provider：`pywencai`；payload 对照 6 项，差异 0。
- 原文/附属 notice：`comm-0.2.3.dist-info/licenses/LICENSE`；1515 bytes；licenseHash `97a7e0a142b7c1dcd26461b20fc13980988b4449b7446ed776928826fd2ca9c4`，原字节已随候选保留。
- METADATA 保留 SHA256：`e475291f8fdedbecbbfd788a2c5de9c912424d23574aba7b9fc51985d7158878`。
- 决策依据：源码与二进制分发许可明确；版权、三项条件及免责声明均已保留，不取得作者/机构背书许可。

#### E.1.7 decorator 5.3.1: approved 建议

- artifact：`decorator-5.3.1-py3-none-any.whl`；10365 bytes；SHA256 `f47fe6fdbd2edd623ecfe36875d37aba411624e2670dd395dddae1358689bb3c`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/05/7f/798705f5296a58ca505d600456748d1be48078eac8a7050d8a98bc9edb89/decorator-5.3.1-py3-none-any.whl)。本项适用许可：`BSD-2-Clause`；reviewer 为本节 Astra。
- 已核对 provider：`akshare`；payload 对照 7 项，差异 0。
- 原文/附属 notice：`decorator-5.3.1.dist-info/licenses/LICENSE.txt`；1308 bytes；licenseHash `bd12cc51405c10872497c10ca21601f1d4abc50496595cc89e89ab5dad24fb62`，原字节已随候选保留。
- METADATA 保留 SHA256：`2133792485403bbd739e1db5960228bedbcde6d00c0acc052b27f39dbae5b5c4`。
- 决策依据：源码与二进制分发许可明确；版权、两项条件及免责声明均已随候选保留。

#### E.1.8 executing 2.2.1: approved 建议

- artifact：`executing-2.2.1-py2.py3-none-any.whl`；28317 bytes；SHA256 `760643d3452b4d777d295bb167ccc74c64a81df23fb5e08eff250c425a4b2017`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/c1/ea/53f2148663b321f21b5a606bd5f191517cf40b7072c0497d3c92c4a13b1e/executing-2.2.1-py2.py3-none-any.whl)。本项适用许可：`MIT`；reviewer 为本节 Astra。
- 已核对 provider：`pywencai`；payload 对照 12 项，差异 0。
- 原文/附属 notice：`executing-2.2.1.dist-info/LICENSE.txt`；1066 bytes；licenseHash `a476a2cb0ef4c41450340a577a28b91ac4c7f669136b2ee148047fabd5fc4181`，原字节已随候选保留。
- METADATA 保留 SHA256：`d7586d1ae225bee126c4237eb0c4d7699a8580b81eb558cc500c263d29a633ff`。
- 决策依据：全文明确允许复制、修改、分发及销售，所要求的版权与许可全文均已保留。

#### E.1.9 h11 0.16.0: approved 建议

- artifact：`h11-0.16.0-py3-none-any.whl`；37515 bytes；SHA256 `63cf8bbe7522de3bf65932fda1d9c2772064ffb3dae62d55932da54b31cb6c86`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/04/4b/29cac41a4d98d144bf5f6d33995617b185d14b22401f75ca86f384e87ff1/h11-0.16.0-py3-none-any.whl)。本项适用许可：`MIT`；reviewer 为本节 Astra。
- 已核对 provider：`mootdx`；payload 对照 16 项，差异 0。
- 原文/附属 notice：`h11-0.16.0.dist-info/licenses/LICENSE.txt`；1124 bytes；licenseHash `37db5bb85926db28a427a25867f10b1232003aea1be69ccb851138adb8e6f361`，原字节已随候选保留。
- METADATA 保留 SHA256：`28f326098ac09fcba79b8f180f96087c841fe2456215cb7b872a9c7d5cd19d64`。
- 决策依据：全文明确允许复制、修改、分发及销售，所要求的版权与许可全文均已保留。

#### E.1.10 html5lib 1.1: approved 建议

- artifact：`html5lib-1.1-py2.py3-none-any.whl`；112173 bytes；SHA256 `0d78f8fde1c230e99fe37986a60526d7049ed4bf8a9fadbad5f00e22e58e041d`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/6c/dd/a834df6482147d48e225a49515aabc28974ad5a4ca3215c18a882565b028/html5lib-1.1-py2.py3-none-any.whl)。本项适用许可：`MIT`；reviewer 为本节 Astra。
- 已核对 provider：`akshare`；payload 对照 38 项，差异 0。
- 原文/附属 notice：`html5lib-1.1.dist-info/AUTHORS.rst`；983 bytes；licenseHash `0eb3403227e80e9b90c899fe296f87e8af13b766b9aca9d5d94178f8346b1942`，原字节已随候选保留。
- 原文/附属 notice：`html5lib-1.1.dist-info/LICENSE`；1084 bytes；licenseHash `16a39991619e92f18680932da2a9199fdf7d95df3ecaedc52ea06218aabafd6f`，原字节已随候选保留。
- METADATA 保留 SHA256：`637c3e9ddff6d87427411cb7cb2a55b15fe47b6145f78b940f8faf1a97360e72`。
- 决策依据：全文明确允许复制、修改、分发及销售，所要求的版权与许可全文均已保留。

#### E.1.11 httpcore 1.0.9: approved 建议

- artifact：`httpcore-1.0.9-py3-none-any.whl`；78784 bytes；SHA256 `2d400746a40668fc9dec9810239072b40b4484b640a8c38fd654a024c7a1bf55`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/7e/f5/f66802a942d491edb555dd61e3a9961140fd64c90bce1eafd741609d334d/httpcore-1.0.9-py3-none-any.whl)。本项适用许可：`BSD-3-Clause`；reviewer 为本节 Astra。
- 已核对 provider：`mootdx`；payload 对照 35 项，差异 0。
- 原文/附属 notice：`httpcore-1.0.9.dist-info/licenses/LICENSE.md`；1518 bytes；licenseHash `fdcb59154c74cbaba16a11242f7740bea9f23d6feb5547917d8c5f94a80392a5`，原字节已随候选保留。
- METADATA 保留 SHA256：`fe2d4fda6199128978779e0cf27f3c045c531863fcdd987eacc74f3a18d41c21`。
- 决策依据：源码与二进制分发许可明确；版权、三项条件及免责声明均已保留，不取得作者/机构背书许可。

#### E.1.12 httpx 0.25.2: approved 建议

- artifact：`httpx-0.25.2-py3-none-any.whl`；74980 bytes；SHA256 `a05d3d052d9b2dfce0e3896636467f8a5342fb2b902c819428e1ac65413ca118`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/a2/65/6940eeb21dcb2953778a6895281c179efd9100463ff08cb6232bb6480da7/httpx-0.25.2-py3-none-any.whl)。本项适用许可：`BSD-3-Clause`；reviewer 为本节 Astra。
- 已核对 provider：`mootdx`；payload 对照 29 项，差异 0。
- 原文/附属 notice：`httpx-0.25.2.dist-info/licenses/LICENSE.md`；1508 bytes；licenseHash `4ec59d544f12b5f539a3a716fd321ac58ccd8030b465221f2c880200cdf28d8d`，原字节已随候选保留。
- METADATA 保留 SHA256：`759d9e9cd5e6bc68a2ba42c622dbaa038599401ca964f29047d623cc240a58f5`。
- 决策依据：源码与二进制分发许可明确；版权、三项条件及免责声明均已保留，不取得作者/机构背书许可。

#### E.1.13 idna 3.20: approved 建议

- artifact：`idna-3.20-py3-none-any.whl`；69583 bytes；SHA256 `ab7ae7122974553370f0bdb919e1a960b2cd1bc1ef0276416d896db81c14582c`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/58/a2/bb081bab032533a855d44de1d56f8e8426114ff1ba5d1f07a438a0a654f8/idna-3.20-py3-none-any.whl)。本项适用许可：`BSD-3-Clause`；reviewer 为本节 Astra。
- 已核对 provider：`akshare`、`mootdx`、`pywencai`；payload 对照 45 项，差异 0。
- 原文/附属 notice：`idna-3.20.dist-info/licenses/LICENSE.md`；1541 bytes；licenseHash `1a9a4f0e3d479a27240ddd59a9137a66ab4a0f9dfdc8ca6188cc0bfd85187f04`，原字节已随候选保留。
- METADATA 保留 SHA256：`dbd8c14c1e4ca1e0c9824a6dbc7cbbf78884f38eb52d91148cd3025f671e4b85`。
- 决策依据：源码与二进制分发许可明确；版权、三项条件及免责声明均已保留，不取得作者/机构背书许可。

#### E.1.14 ipython_pygments_lexers 1.1.1: approved 建议

- artifact：`ipython_pygments_lexers-1.1.1-py3-none-any.whl`；8074 bytes；SHA256 `a9462224a505ade19a605f71f8fa63c2048833ce50abc86768a0d81d876dc81c`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/d9/33/1f075bf72b0b747cb3288d011319aaf64083cf2efef8354174e3ed4540e2/ipython_pygments_lexers-1.1.1-py3-none-any.whl)。本项适用许可：`BSD-3-Clause`；reviewer 为本节 Astra。
- 已核对 provider：`pywencai`；payload 对照 5 项，差异 0。
- 原文/附属 notice：`ipython_pygments_lexers-1.1.1.dist-info/LICENSE`；1535 bytes；licenseHash `b1d0dbc0fa79774d34b8e2d0aec91d50d8caf05f7b40fc22c3010a4bd9ad2bf9`，原字节已随候选保留。
- METADATA 保留 SHA256：`6b38c0946bdbc4778f4e38e2298547cbd7d13aeba9979ec4e4a412eabfbdfadb`。
- 决策依据：源码与二进制分发许可明确；版权、三项条件及免责声明均已保留，不取得作者/机构背书许可。

#### E.1.15 jupyter_client 8.10.0: approved 建议

- artifact：`jupyter_client-8.10.0-py3-none-any.whl`；110184 bytes；SHA256 `5f73f24f22fa25192cfff6b23c051932a2473a797b05734aff495b392103e14e`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/0f/88/7c548de1f6c2ade7c931a3282da73f9274fa6a1531091be682f89c85efb9/jupyter_client-8.10.0-py3-none-any.whl)。本项适用许可：`BSD-3-Clause`；reviewer 为本节 Astra。
- 已核对 provider：`pywencai`；payload 对照 43 项，差异 0。
- 原文/附属 notice：`jupyter_client-8.10.0.dist-info/licenses/LICENSE`；1588 bytes；licenseHash `5ca74e4d2eeb9330b0d129c25f874d3544a13413bc62ae8d367819100d095072`，原字节已随候选保留。
- METADATA 保留 SHA256：`95ec04e32a2decceb7325efa691e6e160201e4e8184db1b1e36a239f9170f560`。
- 决策依据：源码与二进制分发许可明确；版权、三项条件及免责声明均已保留，不取得作者/机构背书许可。

#### E.1.16 jupyter_core 5.9.1: approved 建议

- artifact：`jupyter_core-5.9.1-py3-none-any.whl`；29032 bytes；SHA256 `ebf87fdc6073d142e114c72c9e29a9d7ca03fad818c5d300ce2adc1fb0743407`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/e7/e7/80988e32bf6f73919a113473a604f5a8f09094de312b9d52b79c2df7612b/jupyter_core-5.9.1-py3-none-any.whl)。本项适用许可：`BSD-3-Clause`；reviewer 为本节 Astra。
- 已核对 provider：`pywencai`；payload 对照 15 项，差异 0。
- 原文/附属 notice：`jupyter_core-5.9.1.dist-info/licenses/LICENSE`；1536 bytes；licenseHash `448f1835f5fa08dd075088e46f76f73eb9ac9c2aef0a6c8816be06d30ef592c7`，原字节已随候选保留。
- METADATA 保留 SHA256：`68a656d7e2ebe45d40becf6032998192790d8a7536942f72167d79b8559e5ded`。
- 决策依据：源码与二进制分发许可明确；版权、三项条件及免责声明均已保留，不取得作者/机构背书许可。

#### E.1.17 matplotlib-inline 0.2.2: approved 建议

- artifact：`matplotlib_inline-0.2.2-py3-none-any.whl`；9534 bytes；SHA256 `3c821cf1c209f59fb2d2d64abbf5b23b67bcb2210d663f9918dd851c6da1fcf6`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/41/09/5b161152e2d90f7b87f781c2e1267494aef9c32498df793f73ad0a0a494a/matplotlib_inline-0.2.2-py3-none-any.whl)。本项适用许可：`BSD-3-Clause`；reviewer 为本节 Astra。
- 已核对 provider：`pywencai`；payload 对照 8 项，差异 0。
- 原文/附属 notice：`matplotlib_inline-0.2.2.dist-info/licenses/LICENSE`；1538 bytes；licenseHash `8521b036c6448e0e0aa7213d4713b6fdee0f4c64c9f320450f77346bf5c0e8e4`，原字节已随候选保留。
- METADATA 保留 SHA256：`fedb3d587ec2d3fa4b0a81fd5353df697d2534c8ee714dbf050009afc60bcab7`。
- 决策依据：源码与二进制分发许可明确；版权、三项条件及免责声明均已保留，不取得作者/机构背书许可。

#### E.1.18 nest-asyncio2 1.7.4: approved 建议

- artifact：`nest_asyncio2-1.7.4-py3-none-any.whl`；8543 bytes；SHA256 `86e77b52c3d1496b294af3c944b44213b9b82a12a5ee590c0acc4ca4692ef6c7`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/09/ed/559d2915dce85794bc0c36064043da170da50cd98746dcbddd85d5932017/nest_asyncio2-1.7.4-py3-none-any.whl)。本项适用许可：`BSD-2-Clause`；reviewer 为本节 Astra。
- 已核对 provider：`pywencai`；payload 对照 5 项，差异 0。
- 原文/附属 notice：`nest_asyncio2-1.7.4.dist-info/licenses/LICENSE`；1347 bytes；licenseHash `cec819c02a99e78449d64f3c0217d415c3a210f2a6abfcd827c6b1cb76954e78`，原字节已随候选保留。
- METADATA 保留 SHA256：`5aa5b09a2e2d3f6f51a54498c96a77b94097eba06e194c136a9ec87707d758b0`。
- 决策依据：源码与二进制分发许可明确；版权、两项条件及免责声明均已随候选保留。

#### E.1.19 openpyxl 3.1.5: approved 建议

- artifact：`openpyxl-3.1.5-py2.py3-none-any.whl`；250910 bytes；SHA256 `5282c12b107bffeef825f4617dc029afaf41d0ea60823bbb665ef3079dc79de2`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/c0/da/977ded879c29cbd04de313843e76868e6e13408a94ed6b987245dc7c8506/openpyxl-3.1.5-py2.py3-none-any.whl)。本项适用许可：`MIT`；reviewer 为本节 Astra。
- 已核对 provider：`akshare`；payload 对照 194 项，差异 0。
- 原文/附属 notice：`openpyxl-3.1.5.dist-info/LICENCE.rst`；1131 bytes；licenseHash `0c84bb42f5d367e5ebf9fc2dde35b16141df5ee0fdc189250858bc6c5560f69e`，原字节已随候选保留。
- METADATA 保留 SHA256：`23f80ca9830dd89435da1710f26deda8f81e5409287e74540210c72627a4ad96`。
- 决策依据：全文明确允许复制、修改、分发及销售，所要求的版权与许可全文均已保留。

#### E.1.20 platformdirs 4.12.4: approved 建议

- artifact：`platformdirs-4.12.4-py3-none-any.whl`；32596 bytes；SHA256 `78bfb9db2a8471ed7eebe3c3c932da413911042994e699b384fbb4493fa872d7`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/f4/ba/223e00b885e960edd5d4b4d178c88acce019bd5b83786093681b8c393492/platformdirs-4.12.4-py3-none-any.whl)。本项适用许可：`MIT`；reviewer 为本节 Astra。
- 已核对 provider：`pywencai`；payload 对照 17 项，差异 0。
- 原文/附属 notice：`platformdirs-4.12.4.dist-info/licenses/LICENSE`；1089 bytes；licenseHash `29e0fd62e929850e86eb28c3fdccf0cefdf4fa94879011cffb3d0d4bed6d4db6`，原字节已随候选保留。
- METADATA 保留 SHA256：`2418b715af2d19c99d62ebf721c2e02075f20479ac9c0557a06e119fdbe14a3f`。
- 决策依据：全文明确允许复制、修改、分发及销售，所要求的版权与许可全文均已保留。

#### E.1.21 prettytable 3.18.0: approved 建议

- artifact：`prettytable-3.18.0-py3-none-any.whl`；37357 bytes；SHA256 `b3346e0e6f79180833aebaac088ae926340586cf6d7d991b9eb125b65f72313a`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/fe/be/2e6798ace5cc036f5d05d36b7b2fd85346f1a708c87060890b070d0ec607/prettytable-3.18.0-py3-none-any.whl)。本项适用许可：`BSD-3-Clause`；reviewer 为本节 Astra。
- 已核对 provider：`mootdx`；payload 对照 9 项，差异 0。
- 原文/附属 notice：`prettytable-3.18.0.dist-info/licenses/LICENSE`；1612 bytes；licenseHash `0c8adcc204c8af6cdfdf7887dfd1f99c29901f6c1d505a78bba96efa4fb2cb05`，原字节已随候选保留。
- METADATA 保留 SHA256：`271a5357524f01c8ce05af4ecd0d9fb8ea969e774f80aa2dcaa1d39005255558`。
- 决策依据：源码与二进制分发许可明确；版权、三项条件及免责声明均已保留，不取得作者/机构背书许可。

#### E.1.22 prompt_toolkit 3.0.53: approved 建议

- artifact：`prompt_toolkit-3.0.53-py3-none-any.whl`；392288 bytes；SHA256 `01c0891d7f9237d5e339f7d3e42cdae80b7534abb1c7c0e3352efba6231492f2`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/54/6f/84908cad2d6aa5144abcf7b42709fe4fdb459bc640ec7ac5786e7693dabc/prompt_toolkit-3.0.53-py3-none-any.whl)。本项适用许可：`BSD-3-Clause`；reviewer 为本节 Astra。
- 已核对 provider：`pywencai`；payload 对照 151 项，差异 0。
- 原文/附属 notice：`prompt_toolkit-3.0.53.dist-info/licenses/AUTHORS.rst`；148 bytes；licenseHash `d3dc62c6bc8436658495ab89aea37511e7fa9391d282657239c9cfb80dbd42e5`，原字节已随候选保留。
- 原文/附属 notice：`prompt_toolkit-3.0.53.dist-info/licenses/LICENSE`；1493 bytes；licenseHash `303574d9bdd85c757d6025017942bf17baeedf2778f62bd7f425d07d880f4c4a`，原字节已随候选保留。
- METADATA 保留 SHA256：`d04994e4401b88abf884ca54fb3b85e50a8b4fb1fde1ed7eb3ece9d8bf5459a9`。
- 决策依据：源码与二进制分发许可明确；版权、三项条件及免责声明均已保留，不取得作者/机构背书许可。

#### E.1.23 pure_eval 0.2.4: approved 建议

- artifact：`pure_eval-0.2.4-py3-none-any.whl`；11893 bytes；SHA256 `96cae060a313cfaad51bb761278bfb0e62dc0248d9315a81173752dc546cd37a`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/6d/18/83376915176eb058cb86470eb7396388a13350b09a8f233a79303bbcbc5b/pure_eval-0.2.4-py3-none-any.whl)。本项适用许可：`MIT`；reviewer 为本节 Astra。
- 已核对 provider：`pywencai`；payload 对照 10 项，差异 0。
- 原文/附属 notice：`pure_eval-0.2.4.dist-info/licenses/LICENSE.txt`；1066 bytes；licenseHash `a476a2cb0ef4c41450340a577a28b91ac4c7f669136b2ee148047fabd5fc4181`，原字节已随候选保留。
- METADATA 保留 SHA256：`4fe70f69411b9963d7275084210743afa819c2350899a29150bc43b1abf105d0`。
- 决策依据：全文明确允许复制、修改、分发及销售，所要求的版权与许可全文均已保留。

#### E.1.24 pycparser 3.1: approved 建议

- artifact：`pycparser-3.1-py3-none-any.whl`；48709 bytes；SHA256 `f09d358c840bd147b79e55f2bc494f18ea869dc897f5852a8f5766b74f787882`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/99/ce/b3ae9ee0324d991c860187be2a6ee436d27a3d02397eaddbb101ec901f3d/pycparser-3.1-py3-none-any.whl)。本项适用许可：`BSD-3-Clause`；reviewer 为本节 Astra。
- 已核对 provider：`akshare`；payload 对照 12 项，差异 0。
- 原文/附属 notice：`pycparser-3.1.dist-info/licenses/LICENSE`；1543 bytes；licenseHash `0a9e78156ae8b96caf1b4f11ac2df424b83de29736f9e757630548a6272fdf90`，原字节已随候选保留。
- METADATA 保留 SHA256：`f4a14c8bb8bcb1139830e9722da8725fc36c8e22ee0d13e5d094b5b354f80a9d`。
- 决策依据：源码与二进制分发许可明确；版权、三项条件及免责声明均已保留，不取得作者/机构背书许可。

#### E.1.25 pydash 7.0.7: approved 建议

- artifact：`pydash-7.0.7-py3-none-any.whl`；110286 bytes；SHA256 `c3c5b54eec0a562e0080d6f82a14ad4d5090229847b7e554235b5c1558c745e1`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/ad/bf/7f7413f9f2aad4c1167cb05a231903fe65847fc91b7115a4dd9d9ebd4f1f/pydash-7.0.7-py3-none-any.whl)。本项适用许可：`MIT`；reviewer 为本节 Astra。
- 已核对 provider：`pywencai`；payload 对照 22 项，差异 0。
- 原文/附属 notice：`pydash-7.0.7.dist-info/AUTHORS.rst`；1396 bytes；licenseHash `6f61fcb95e6a64d2c2cf519d01165348d2d833eaaa7dbd0f1cf3dca1795e24c8`，原字节已随候选保留。
- 原文/附属 notice：`pydash-7.0.7.dist-info/LICENSE.rst`；1072 bytes；licenseHash `1bba57c33cce44a00d2edf0794e14bd0c6dc1569a4e78d834c8f4103b8e9623f`，原字节已随候选保留。
- METADATA 保留 SHA256：`312f4f59d7073acecbb94e9bbca53f97ae1047976ec24c4a6d4710cdedbe5efe`。
- 决策依据：全文明确允许复制、修改、分发及销售，所要求的版权与许可全文均已保留。

#### E.1.26 pywencai 0.13.1: approved 建议

- artifact：`pywencai-0.13.1-py3-none-any.whl`；911600 bytes；SHA256 `6786a014baed92cef25d855f8f175c5265868552dfacd7e37c098f92e4e038ff`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/c7/71/6fa9606a3c042e59f8020914e59d4d4919100e0cd53697d7e2a677f70835/pywencai-0.13.1-py3-none-any.whl)。本项适用许可：`MIT`；reviewer 为本节 Astra。
- 已核对 provider：`pywencai`；payload 对照 12 项，差异 0。
- 原文/附属 notice：`pywencai-0.13.1.dist-info/licenses/LICENSE`；1062 bytes；licenseHash `f619e8a9798a5fd5be106923ab8a02f17aa0f3820195aa310cdf62b154724368`，原字节已随候选保留。
- METADATA 保留 SHA256：`45b93f2bf5eac8cd5d89f1bc51d026639adf2a0343ee9d6f71bb4a3135a9878d`。
- 决策依据：全文明确允许复制、修改、分发及销售，所要求的版权与许可全文均已保留。

#### E.1.27 six 1.17.0: approved 建议

- artifact：`six-1.17.0-py2.py3-none-any.whl`；11050 bytes；SHA256 `4721f391ed90541fddacab5acf947aa0d3dc7d27b2e1e8eda2be8970586c3274`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/b7/ce/149a00dd41f10bc29e5921b496af8b574d8413afcd5e30dfa0ed46c2cc5e/six-1.17.0-py2.py3-none-any.whl)。本项适用许可：`MIT`；reviewer 为本节 Astra。
- 已核对 provider：`akshare`、`mootdx`、`pywencai`；payload 对照 15 项，差异 0。
- 原文/附属 notice：`six-1.17.0.dist-info/LICENSE`；1066 bytes；licenseHash `4375ba20e2b9c6c4e7cad2940a628fd90e95cc3d50ee92aae755715d8ba1fbd0`，原字节已随候选保留。
- METADATA 保留 SHA256：`562042078c2752549f6d8a7c86dbc5dd708088a7be6d80672ec7b07100b72468`。
- 决策依据：全文明确允许复制、修改、分发及销售，所要求的版权与许可全文均已保留。

#### E.1.28 soupsieve 2.10: approved 建议

- artifact：`soupsieve-2.10-py3-none-any.whl`；38019 bytes；SHA256 `8596eb8967d744174820280fa62b4542a2e955bfaccca73ed8a13c6eb8e9b502`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/66/87/5ed59e1d0290564e2027ed066c52b059892c4637741337fc0967183c8d4d/soupsieve-2.10-py3-none-any.whl)。本项适用许可：`MIT`；reviewer 为本节 Astra。
- 已核对 provider：`akshare`；payload 对照 11 项，差异 0。
- 原文/附属 notice：`soupsieve-2.10.dist-info/licenses/LICENSE.md`；1096 bytes；licenseHash `76a0acdb98c3a63681e20b6f096699ef8cad5fb35d56eef8387e0fa71d797a9a`，原字节已随候选保留。
- METADATA 保留 SHA256：`02ecd6c72d2fa0911bedfd99d53b2198e1bbf556f4606108819e8c19fdf32880`。
- 决策依据：全文明确允许复制、修改、分发及销售，所要求的版权与许可全文均已保留。

#### E.1.29 stack-data 0.6.3: approved 建议

- artifact：`stack_data-0.6.3-py3-none-any.whl`；24521 bytes；SHA256 `d5558e0c25a4cb0853cddad3d77da9891a08cb85dd9f9f91b9f8cd66e511e695`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/f1/7b/ce1eafaf1a76852e2ec9b22edecf1daa58175c090266e9f6c64afcd81d91/stack_data-0.6.3-py3-none-any.whl)。本项适用许可：`MIT`；reviewer 为本节 Astra。
- 已核对 provider：`pywencai`；payload 对照 11 项，差异 0。
- 原文/附属 notice：`stack_data-0.6.3.dist-info/LICENSE.txt`；1066 bytes；licenseHash `a476a2cb0ef4c41450340a577a28b91ac4c7f669136b2ee148047fabd5fc4181`，原字节已随候选保留。
- METADATA 保留 SHA256：`f28a66f2adde54e7031355e09a166e437bc0d023a31c10c973ac494288ca4c6f`。
- 决策依据：全文明确允许复制、修改、分发及销售，所要求的版权与许可全文均已保留。

#### E.1.30 tabulate 0.10.0: approved 建议

- artifact：`tabulate-0.10.0-py3-none-any.whl`；39814 bytes；SHA256 `f0b0622e567335c8fabaaa659f1b33bcb6ddfe2e496071b743aa113f8774f2d3`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/99/55/db07de81b5c630da5cbf5c7df646580ca26dfaefa593667fc6f2fe016d2e/tabulate-0.10.0-py3-none-any.whl)。本项适用许可：`MIT`；reviewer 为本节 Astra。
- 已核对 provider：`akshare`；payload 对照 6 项，差异 0。
- 原文/附属 notice：`tabulate-0.10.0.dist-info/licenses/LICENSE`；1080 bytes；licenseHash `cdfab50d37d8ead06468fb76a3abafcd05c16749ec8a18eebfa50fd48c7cb2d2`，原字节已随候选保留。
- METADATA 保留 SHA256：`38dfc6db689745ff4c3890b3c30ef7e5d0b156fdbeeb765b9027fd917043d84b`。
- 决策依据：全文明确允许复制、修改、分发及销售，所要求的版权与许可全文均已保留。

#### E.1.31 urllib3 2.8.0: approved 建议

- artifact：`urllib3-2.8.0-py3-none-any.whl`；135717 bytes；SHA256 `0cf3cae568d36aa9576b28dfb35f11328f1cb974ca7647d9475ebb86c75ac6e3`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/92/9d/c4e665119135114480843e7ab388fa94d8480650450e6f8e26b70d323a4c/urllib3-2.8.0-py3-none-any.whl)。本项适用许可：`MIT`；reviewer 为本节 Astra。
- 已核对 provider：`akshare`、`pywencai`；payload 对照 82 项，差异 0。
- 原文/附属 notice：`urllib3-2.8.0.dist-info/licenses/LICENSE.txt`；1093 bytes；licenseHash `130e3a64d5fdd5d096a752694634a7d9df284469de86e5732100268041e3d686`，原字节已随候选保留。
- METADATA 保留 SHA256：`10898c620e8007c030e07fa5622b68358a43010025dfbd78a1cb797699de2bb4`。
- 决策依据：全文明确允许复制、修改、分发及销售，所要求的版权与许可全文均已保留。

#### E.1.32 webencodings 0.6.1: approved 建议

- artifact：`webencodings-0.6.1-py3-none-any.whl`；8745 bytes；SHA256 `7fab6269c8bf237c657876b52058ccb182e861518d1c695c1a9aaa8c1c105d5b`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/77/c6/040cbc72480d789a5f40d63fb484d3106554c4dfa2d2b70ad5022057750f/webencodings-0.6.1-py3-none-any.whl)。本项适用许可：`BSD-3-Clause`；reviewer 为本节 Astra。
- 已核对 provider：`akshare`；payload 对照 6 项，差异 0。
- 原文/附属 notice：`webencodings-0.6.1.dist-info/licenses/LICENSE`；1519 bytes；licenseHash `e06ef33485e7498ad592887c41fa79cc8a7fecde576c7210e11bfdddef58040e`，原字节已随候选保留。
- METADATA 保留 SHA256：`3d9819d1209e5b56d4c6315efca7d5ca452ba7e55d4c3617ec63555c099bfb70`。
- 决策依据：源码与二进制分发许可明确；版权、三项条件及免责声明均已保留，不取得作者/机构背书许可。

#### E.1.33 requests 2.34.2: approved 建议

- artifact：`requests-2.34.2-py3-none-any.whl`；73075 bytes；SHA256 `2a0d60c172f83ac6ab31e4554906c0f3b3588d37b5cb939b1c061f4907e278e0`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/a0/f4/c67b0b3f1b9245e8d266f0f112c500d50e5b4e83cb6f3b71b6528104182a/requests-2.34.2-py3-none-any.whl)。本项适用许可：`Apache-2.0`；reviewer 为本节 Astra。
- 已核对 provider：`akshare`、`pywencai`；payload 对照 50 项，差异 0。
- 原文/附属 notice：`requests-2.34.2.dist-info/licenses/LICENSE`；10142 bytes；licenseHash `09e8a9bcec8067104652c168685ab0931e7868f9c8284b66f5ae6edae5f1130b`，原字节已随候选保留。
- 原文/附属 notice：`requests-2.34.2.dist-info/licenses/NOTICE`；38 bytes；licenseHash `f5110972dedad2b4e9d314518daf3b7d72d6e02e499acd802181de6f74571dcc`，原字节已随候选保留。
- METADATA 保留 SHA256：`8c384ba3e979480faae2859d3c5e6c1276dd2c3616e322e124d52c8cfc556f27`。
- 决策依据：Apache-2.0 全文及 Requests/Kenneth Reitz 的 NOTICE 均已保留，候选源码未修改。

#### E.1.34 asttokens 3.0.2: approved 建议

- artifact：`asttokens-3.0.2-py3-none-any.whl`；28702 bytes；SHA256 `9da13157f5b28becde0bd374fc677dcd3c290614264eff096f167c469cd9f933`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/d4/2b/04b8a15f3a1c77bc79ddf5c73875327f34b4fa75982df2b76e45e402d364/asttokens-3.0.2-py3-none-any.whl)。本项适用许可：`Apache-2.0`；reviewer 为本节 Astra。
- 已核对 provider：`pywencai`；payload 对照 14 项，差异 0。
- 原文/附属 notice：`asttokens-3.0.2.dist-info/licenses/LICENSE`；11359 bytes；licenseHash `62fb8a3a9621dc2388174caaabe9c2317b694bb9a1d46c98bcf5655b68f51be3`，原字节已随候选保留。
- METADATA 保留 SHA256：`8b3567b29654e6e9a60ab50fde2c317899152790acadaab7868a708bf931c3d3`。
- 决策依据：Apache-2.0 全文与原始源码版权保留，候选源码未修改；本 wheel 的 notice 清单无额外 NOTICE 文件。

#### E.1.35 tenacity 8.5.0: approved 建议

- artifact：`tenacity-8.5.0-py3-none-any.whl`；28165 bytes；SHA256 `b594c2a5945830c267ce6b79a166228323ed52718f30302c1359836112346687`。
- 主源：[官方 PyPI wheel](https://files.pythonhosted.org/packages/d2/3f/8ba87d9e287b9d385a02a7114ddcef61b26f86411e121c9003eb509a1773/tenacity-8.5.0-py3-none-any.whl)。本项适用许可：`Apache-2.0`；reviewer 为本节 Astra。
- 已核对 provider：`mootdx`；payload 对照 17 项，差异 0。
- 原文/附属 notice：`tenacity-8.5.0.dist-info/LICENSE`；11357 bytes；licenseHash `58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd`，原字节已随候选保留。
- METADATA 保留 SHA256：`f02051f69607a22dd857ae82902404e700cb365991e984b215ece3584f4e408a`。
- 决策依据：Apache-2.0 全文与原始源码版权保留，候选源码未修改；本 wheel 的 notice 清单无额外 NOTICE 文件。

### E.2 PBS 19 份全文：逐 notice 结论，不批准整个 PBS 资产

本节主源为此前实际核验的 [PBS full 原包](https://github.com/astral-sh/python-build-standalone/releases/download/20261003/cpython-3.13.16%2B20261003-x86_64-pc-windows-msvc-pgo-full.tar.zst)，artifact SHA256 `cb3b6dcfcf179110486403204e4f5e507e8980d0ca50bb0d8c72e8c76b41b869`；对应 [install_only 原包](https://github.com/astral-sh/python-build-standalone/releases/download/20261003/cpython-3.13.16%2B20261003-x86_64-pc-windows-msvc-install_only.tar.gz) 的执行资产 SHA256 `5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778` 必须独立保留。两包不能互相替代 pin。

本轮已实际核对候选 `licenses/python-full/python/licenses/` 的全部 19 份文本哈希与已审原件一致，`PYTHON.json` 为 `c2bd7a699f18cd48dbf701b55a1229dcecec3e2ac74b59fba350fe52d4153e98`。下表 approved 仅是该精确来源 notice 所覆盖组件的许可建议，不是整包批准。若现 policy 不能表达组件范围，保留 PBS asset pending，不得用 13 个 approved 覆盖 CRT/其他 pending。PYTHON.json 是来源元数据，不是授权文本。full 中有某 notice 也不证明对应库实际链接到 Windows，实际组件映射沿用 PYTHON.json，不造组件版本。

| notice | licenseHash (SHA256) | 建议状态 | 依据/最小补件 |
|---|---|---|---|
| `LICENSE.bdb.txt` | `8f2d533ab34899499d5b07f209854b101b17dba2c69f3251860aecf3e4005faa` | pending | Sleepycat 义务不能当 BSD。依据实际链接/交付清单确定是否仅为未适用保留 notice；若交付该代码，补对应源码及条款要求。 |
| `LICENSE.bzip2.txt` | `bd5628cc76fb0ebf9c657d1dd4d1a240a1a7b216c31663e7bbf1131c0b70a910` | approved (component notice) | 原文允许源码/二进制分发；完整版权及免责已保留，未改源码、不冒认来源、不背书。 |
| `LICENSE.cpython.txt` | `8fe98bf9822926d854f56ffd8d97877d8b942617aa44eb7ea77fd99e22f2537e` | pending (aggregate) | PSF/历史条款保留已确认，但 Windows 安装树 LICENSE.txt 另含 Microsoft 条款。不得用 full 文本批准整个 PBS/CRT。 |
| `LICENSE.expat.txt` | `8a9cfe4b5924f4b25881aa0c9f5e4561c5f31065d0c4a13cdcdbcf917edf39aa` | approved (component notice) | MIT 原文明确分发/销售授权，完整版权及许可已保留。 |
| `LICENSE.libedit.txt` | `d9932ccdd42eccf6cdded7bcb35b088e64cfc7c24d355af2cc0d02edb6b637d3` | approved (component notice) | BSD-3 源码/二进制 notices 已保留，禁止背书条件仍有效。 |
| `LICENSE.libffi.txt` | `9afb8970cd29fc1031fa647278e4bef613399e2e3468a1e3a397f4d158c6101c` | approved (component notice) | MIT 原文完整保留；不删源文件内部版权，不扩展到未知独立 native wheel。 |
| `LICENSE.liblzma.txt` | `d87d218dd908b3243ec4cbc72af400e5b7437513ea9d9229291d0812b8464fec` | approved (component notice) | 实际宽松许可允许为任何目的复制/修改/分发，完整版权和免责仍保留；不据此授权整个 XZ 工具集合。 |
| `LICENSE.libuuid.txt` | `cbccaa3efe07a9a602751375085be572d4410a250b996716fbe8c5255c7ec6f2` | approved (component notice) | 三条版权、二进制文档保留及不背书条件有对应完整 notice。 |
| `LICENSE.libX11.txt` | `f353accfe2976df31ea297a77d1d454bd51ef6be8c3df39bd6aca95901579357` | pending | 47,960 字节复合条款不能以 MIT 批量覆盖；按实际包含的 X11/TekHVC 子组件映射广告/标识条款，或证实该 Windows 产物不含此代码。 |
| `LICENSE.libXau.txt` | `cec808cd2163fccdc8de4a91d526490777afbaeea060e1168c40a804694b7444` | approved (component notice) | 复制/销售许可明确，版权与许可全文作为支持材料随包保留；不使用 The Open Group 名称推广。 |
| `LICENSE.libxcb.txt` | `29a9539190e6de1af5fd06a9139c7103137cd1f9290b08c7b11bce89c01c14d2` | approved (component notice) | MIT 类授予和完整 notice 已保留；额外作者/机构广告限制仍有效。 |
| `LICENSE.mpdecimal.txt` | `f094277cd46e1f6e4d87916cc4b51e22f613d45eb81f48231c3cb7caf8fc8a6a` | approved (component notice) | BSD-2 源码/二进制 notices 与免责完整保留。 |
| `LICENSE.ncurses.txt` | `4f571cad3ea6c888bf0a7092e5b215dddb3142e9e3f1857fd5fac6cf13d345d7` | approved (component notice) | MIT 类授予全文保留；附加名称宣传限制仍有效，不因含 FSF 名称误标 GPL。 |
| `LICENSE.openssl-1.1.txt` | `ad89e3fed746413af1d34d5353978ee1520cedd361c853f8022e7bb210ac6b31` | pending | 旧 OpenSSL/SSLeay 有额外广告/署名条件；先按实际版本证明不适用或落实该版本声明，不能换成 OpenSSL 3 批准。 |
| `LICENSE.openssl-3.txt` | `ed72ce2b51ee58f117e5a021e2e04af158857f40269fbc03491f0b2a99dbcc96` | pending | Apache 全文已保留；还需绑定实际 OpenSSL 3 构建版本和其适用 NOTICE 交付清单后关闭。 |
| `LICENSE.sqlite.txt` | `d8eb9aba7ef6b5ed06cb3ec19a7242316af2e5933c638eb67fb781c13884e01d` | approved (component notice) | 实际文本明确交付库代码/文档公有领域及任意商业/非商业分发；不扩展到未随库交付的构建脚本。 |
| `LICENSE.tcl.txt` | `41613eabfc08921a7da9c4bfd7f3ce5d5406f55214b253d89f392ed86eebeb8f` | approved (component notice) | 原文允许任何目的使用/分发，现有版权及全文 verbatim 已保留；个别文件明确另行许可仍不能被总条款覆盖。 |
| `LICENSE.tix.txt` | `8cdff3addb9e9eb108c78e2cf5e05f26b216c098304945733bbec382b2eaef66` | pending | 应补源包固定版本的 license.terms、docs/license.tcltk、docs/license.html_lib 三件实际交付；精确 URL/SHA 见前文 A 节，不仅记在报告里。 |
| `LICENSE.zlib.txt` | `365e36720db366054863235aea5d6f440142ab968834bfaf81fa9d187c99b9b8` | approved (component notice) | 原文允许商业分发，保留全文、不冒认原作者、未来修改须标明。 |

Microsoft CRT 独立保持 pending：需要发行主体适用 VS/合法再分发链的资格记录、固定 DLL inventory、官方 REDIST 授予适用性、接收者条款与可证明的同意路径。前文 C 节已给官方主源和条件；runtime EULA、静态链接或更换另一个 MSVC Python 包都不是替代。不能用应用总 EULA 剥夺 AGPL/LGPL 赋予的权利。此处不作发行资格已具备的推断。

### E.3 Node 22.23.3：精确未修改 node.exe 范围的 approved 建议

- reviewer：本节 Astra；主源：[官方 Windows x64 ZIP](https://nodejs.org/dist/v22.23.3/node-v22.23.3-win-x64.zip)。artifact 35,574,076 bytes，SHA256 `2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71`。
- 完整 `LICENSE` 为 148,217 bytes，licenseHash `8cc9bb466b19fc7e7cc99d03e9df1132021fda8b01eea2624c58bb372dbef576`；本轮已核对候选 `node/LICENSE` 与此前官方 ZIP 原件一致。
- 根据此前已审完整 43 个外部库条目及顶层文本，建议对官方未修改 `node.exe` 加该完整 LICENSE 的有界再分发许可采用 approved；表达式用受审 `LicenseRef-Node-22.23.3-Bundled-Notices`，不把整个资产误标单一 MIT。完整文件保留 V8/ICU/OpenSSL/Unicode 数据及其他条款；HdrHistogram 在本项目记录选择 BSD-2-Clause 路径，原双许可文本仍不删。
- 本批准不涵盖 npm/corepack 扩展交付、重新构建/删改原件、任何独立 CRT DLL，也不替 Windows 之外资产做成员等价推断。官方 Node 原件的执行 hash/架构验证仍属于独立运行资产 gate；此项不会改变 PBS CRT pending，也不推断发行主体 Microsoft 资格。

### E.4 尚未关闭的 wheel，逐项最小工作

以下 pending 不是认定禁止分发。已确定的权利冲突优先取权利澄清；仅复核/材料映射缺口由 reviewer 利用现有原文继续关闭，不要求不必要的上游另行许可。所有这些项仍可参与隔离 resolve/materialize/offline 技术验证，但不得因测试 green 自动 seal。

| wheel | 精确 artifact SHA256 | 最小后续 |
|---|---|---|
| certifi 2026.7.22 | `62f22742b58a1a33014a2b6b706588a8d7e2a88ae7bd1a6ebe8c992928483775` | MPL-2.0：补完整许可、精确对应源码及接收者取得源码的通知/交付位置；短 notice 不代替这些交付义务。 |
| cffi 2.1.1 | `1aa5645c30469b09530c4ebca77ebf8f17618293c58f8549cb1a543a50236e7d` | 复核该原生 wheel 的完整 MIT/vendor libffi notices 与实际分发 DLL 清单；不由包名推断所有原生代码许可。 |
| charset-normalizer 3.5.2 | `78456a747de8dc58360ffa581f30a002baf5aa28cb262536545e91f113ed7639` | 复核实际原生 wheel 的 MIT 文本、编译模块及 vendor notices，并做该资产候选树保留对照。 |
| curl_cffi 0.16.3 | `fe87b66e324ed7318166698e02169f3208dbda32b872a27d2bc61a9c19b335eb` | 落实实际 libcurl/SSL 等 vendor 组件版本、所有 notices 与适用源码义务，不以顶层 MIT 覆盖整个二进制。 |
| debugpy 1.8.22 | `f49b1d6cecf326b63c06d7f517e4a6642777f758c58cb799e7bc5a6dd74721c2` | 逐项核对 vendored pydevd/第三方组件 notices 和对应源码范围，保留全部版权；顶层许可不替代 vendor 审查。 |
| et_xmlfile 2.0.0 | `7a91720bc756843502c3b7504c77b8fe44217c85c537d85037f0f536151b2caa` | 全文复核 LICENCE.python 与其他两个 notice 的组合和适用范围后才能关闭，不仅使用 MIT 标签。 |
| fake-useragent 1.5.1 | `57415096557c8a4e23b62a375c21c55af5fd4ba30549227f562d2c4f5b60e3b3` | 复核 Apache LICENSE/NOTICE 以及随 wheel 数据集来源授权；两个 notice 均已有哈希材料。 |
| ipykernel 7.4.0 | `a6757f790ddc5a6006b813d82da1a9dbb65b3a00f2b6607df776418c6566ec1c` | BSD 文本材料已有；补 .data/data 下 kernel.json 与三个 logo 的安装目标/字节映射及 logo 权利范围。当前 unmapped 是审计覆盖缺口，不是已证文件丢失。 |
| ipython 9.17.1 | `6d1645743cfd1a07eb695d85aa2b5fa66721f8cbae9431d4049f7084bbf06509` | 补 .data/data/share/man/man1/ipython.1 目标映射；逐项复核 LICENSE/COPYING 复合条款与商标边界。 |
| jedi 0.20.0 | `7bdd9c2634f56713299976f4cbd59cb3fa92165cc5e05ea811fb253480728b67` | 完整复核四份 notice，包含 bundled stubs/typeshed；不得仅审 dist-info 主 LICENSE。 |
| jsonpath 0.82.2 | `f0cef8d52734c71e1c06a2da87940a72c8840d7f3e64cbb123b6b3b29f0db117` | 对派生 wheel 闭合原 sdist 授权文本、recipe/provenance SHA 与产物 hash 的审批关联；本轮不把 local file URI 伪造为官方 URL。 |
| lxml 6.1.3 | `e477aca0bc0d19f3b4ae9e4f2a1cfd687c31bf772d78734910658186b40b2477` | 按本记录 A 节绑定实际 libiconv/libxml2/libxslt/zlib producer/源码/补丁/重新链接材料；LGPL 源码与可重新链接交付尚未落地。 |
| mini-racer 0.12.4 | `9446e3bd6a4eb9fbedf1861326f7476080995a31c9b69308acef17e5b7ecaa1b` | 逐项复核 wheel 的 V8/ICU 等复合 notices、native 资源与派生/adapter 边界；顶层 MIT 不覆盖未审 vendor。 |
| mootdx 0.11.7+rt.1 | `35f282624ed7a2a6908b4b847fba9119e7fb376cd00797606ee5ee97b6139f77` | MIT 与原 README/METADATA 非商业声明冲突需固定版本书面范围澄清；保留两者，不因派生 +rt.1 就清除限制。 |
| numpy 2.5.3 | `71cad2b2a7451ab79d8f5e71b453485b6775963d5cf794179144a7463fe6e8ec` | 核对实际 wheel 中 BLAS/LAPACK、编译器 runtime 等完整 vendor notices/版本与对应源码义务；不得仅以 NumPy BSD 批准。 |
| packaging 26.3 | `d7193f7c8e4e93f444fde0262bf90af30e16fa0ad0ad44cb553c87339b23cd1c` | 完整复核 LICENSE、LICENSE.APACHE、LICENSE.BSD，记录实际选择的许可分支且保留三文件。 |
| pandas 3.0.6 | `f3ce8a6968045481e91a3990e797e348ce13db45ee164a7095bbc824e26c09dd` | 复核实际 wheel LICENSE 内全部第三方条款、native/vendor 内容及候选树保留；不得只使用顶层 BSD。 |
| parso 0.8.7 | `a8926eb2a1b915486941fdbd31e86a4baf88fe8c210f25f2f35ecec5b574ca1c` | 复核 Python 派生条款与第二份 notice 的适用范围、完整保留和修改说明。 |
| psutil 7.2.2 | `eb7e81434c8d223ec4a219b5fc1c47d0417b12be7ea866e24fb5ad6e84b3d988` | 核对实际原生 wheel 的 BSD/Windows 原生组件内容及完整 notices 保留。 |
| PyExecJS 1.5.1 | `de51fa4692182d14c6005396e2dafa45368090dc64526e7fea9fde7a856fce28` | 对派生 wheel 闭合原 sdist MIT/LICENSE、six 元数据、recipe/provenance 和产物 SHA；与 jsonpath 相同，不虚构官方派生下载 URL。 |
| Pygments 2.21.0 | `2363c69b61c4a97c838da3b130dcd6468f4848992b21a82f2a63ec34377137d9` | 完整复核 LICENSE/AUTHORS 与随包 lexer 数据/第三方许可，保留二者；当前字节材料已齐，无需重新下载。 |
| python-dateutil 2.9.0.post0 | `a8b2bc7bffae282281c8140a97d3aa9c14da0b136dfe83f850eea9a5f7470427` | 全文确认 Apache/BSD 的历史代码范围与组合表达式，保留完整 LICENSE；不凭元数据任择一项。 |
| pyzmq 27.2.0 | `2c218c6ab8bc447ba62054b581fd30209689d199c6ecb253f79615ca74a38e12` | 核对实际 libzmq/libsodium 等 native vendor 许可证和静态链接适用义务、版本来源。 |
| sniffio 1.3.1 | `2f6da418d1f1e0fddd844478f41680e794e6051915791a034ff65e5f100525a2` | 完整复核双许可选择文件和 MIT/Apache 两全文，记录选定分支，不省略其他 notice。 |
| tdxpy 0.2.7 | `5514d35608fac2c7b2acf693de6f41ba7ccda58207b65a3f374c89887560737c` | 实际 METADATA 含不得用于任何商业目的，撤回前文将其视作已澄清 MIT 替代底座的建议；先取固定版本及分发范围权利澄清。 |
| tornado 6.5.10 | `37ae8f150cecfdbf747fc4e12f5e9a97ecd8cf1d4cdb3f119e2de84b11196918` | 复核此原生 wheel 的 Apache/LICENSE/NOTICE 与编译模块/vendor 内容，绑定实际 wheel 而非纯 Python 同名资产。 |
| tqdm 4.70.1 | `c293e525e6fef9c20e8728fd4612df02a0aa31bb5fe91ecd93e123b1b7bffa73` | MPL-2.0 AND MIT 分组件处理；明确 MPL 文件、对应源码与接收者通知，保留完整许可而非混成全 MIT。 |
| traitlets 5.16.1 | `f775618166caa0396c8e337099240f2bd3e5e917d203b2e6fbe21a58d3cb1f6b` | 补最后一项 BSD 全文人工复核及 notice 审批记录；实际原文/安装字节证据已齐，非外部授权 blocker。 |
| typing_extensions 4.16.0 | `481caa481374e813c1b176ada14e97f1f67a4539ce9cfeb3f350d78d6370c2e8` | 全文复核 PSF/历史许可组合、版权与修改条款；已有完整文本，不需要权利人另授 MIT。 |
| tzdata 2026.5 | `b683bd1b6659ddcd810ff02ad09ba821d4bf1065072805063eb35c49617905ac` | 复核两个 notice 及 IANA 数据/public-domain 与打包代码许可范围，保留适用原文。 |
| wcwidth 0.9.2 | `2a9746de704242bd4fdaabb31dd46b82f694a56a8d21081ad89b679a89da9fec` | 复核此 wheel 的 Unicode 数据许可及 native 内容/notice，不以主包 MIT 替代 Unicode 条款。 |
| xlrd 2.0.2 | `ea762c3d29f4cca48d82df517b6d89fbce4db3107f9d78713e48cd321d5c9aa9` | 补 .data/scripts/runxlrd.py 的实际目标映射及版权保留；当前 unmapped 仅表示本轮覆盖不足。 |

**更正 D.5：tdxpy 0.2.7 不是已澄清的替代授权底座。** 本轮实际 wheel METADATA 中也读到“本项目只作学习交流, 不得用于任何商业目的.”；MIT 主 LICENSE 不能由本审查擅自消除此冲突。mootdx 和 tdxpy 都需对精确版本、改造及随应用分发范围作书面澄清；如无法取得，替代路线应为独立授权、独立实现并由项目明确维护的协议/Reader/Quotes/holiday 适配器，先作能力矩阵与完整跨端回归，不能复制争议实现或静默删去 TDX。

该更正原始 METADATA SHA256：`e2763ae0262af4f042ea0e817f9c4252cd291caa589d0586b818e002f0ca8100`；主源：[实际 tdxpy wheel](https://files.pythonhosted.org/packages/e2/db/6513418e77e3635148d251eb15e6fbd32bad7ee4842b81bda8be7d2fbd0a/tdxpy-0.2.7-py3-none-any.whl)。

lxml 不以“有 LGPL 字样”永久挂起：Franklin 可按前文已固定的六份 source/build 资产收集对应源码、补丁、可重新链接对象或充分重建输入、构建/链接说明、精确 native 清单与 LGPL 文本，提供与二进制同位置的源码取得路径并实际验证重链接。当前缺的是实际 producer 对应关系与这些交付件，而不是再次重复下载主 LICENSE；如原 wheel 无法提供可核验对应关系，另立明确派生重建产物及 hash 审核，不能给原 wheel 虚写 producer。

### E.5 交给 Franklin 的 policy 落地边界

1. 仅 E.1 明确列出的 35 个 wheel 和 E.3 精确 Node 范围可采用本次 approved 建议，复制本节 reviewer/reviewReference 并保持原 artifact/licenseHash。E.2 的 13 个 approved 是组件 notice 范围，整包 PBS 仍 pending。
2. policy 若以每个 notice 为审批单位，LICENSE/NOTICE/AUTHORS/METADATA 的角色须保留；METADATA 只是同资产保留证据，不将其 SPDX 标签当授权。任何缺失/变更的原文、未知新 notice 或新 artifact 都重新审，不按名字或哈希前缀继承。
3. 本次只收敛许可决定。执行来源 pin、上游/recipe/产物字节、实际 installed closure、Requires-Dist/marker/extras、dependencyAudit SHA、三端真实离线导入及 owned worker 退出证明继续独立门禁；license approved 不能代替这些验收。
4. 保留应用 AGPL 和全部上游 notices。没有发布许可证文件以外的用户资料，不上传私有路径中的数据/账户。此次唯一工作区修改为本审查文档，未修改 Franklin policy，也未安装、联网请求 provider 或操作 ref/tag/release。

<a id="astra-license-decisions-20261009"></a>

## F. 第二批实际全文审阅与精确 policy 交接记录

日期 2026-10-09；reviewIdentity / reviewedBy：`Astra / engineering redistribution review / 2026-10-09`；reference / reviewReference：`resources/python-runtime/license-review.md#astra-license-decisions-20261009`。

本节新增11个精确wheel的 approved 工程建议，覆盖并关闭 E.4 对这些精确资产的 pending；其余条目不变。累计46个wheel，不是自动扫描许可证标签批量批准。审阅依据为此前一次只读取证缓存中的实际原始全文、本轮逐条人工审阅及已完成的原wheel/候选payload哈希对照；本轮未重新安装或执行recipe，亦未重读实现者正在修改的prep/policy。脚本只排版本人已明确选择的审批记录，不作许可判断。

### F.1 traitlets 5.16.1

- component：`traitlets`；version：`5.16.1`；decision：`approved`；spdx：`BSD-3-Clause`。
- artifact：`traitlets-5.16.1-py3-none-any.whl`；86211 bytes；artifactSHA256：`f775618166caa0396c8e337099240f2bd3e5e917d203b2e6fbe21a58d3cb1f6b`。
- 主源：[官方 wheel 原件](https://files.pythonhosted.org/packages/ad/66/0d785f0bc5e4315a96c989bb476d0fc07ea4f85132550c7b156ca2035d52/traitlets-5.16.1-py3-none-any.whl)。
- 实际保留：pywencai，payload 哈希对照 28 项，差异0。METADATA保留 SHA256 `e42b503240c058625ffb30c390818d72933117840cb25060614cb24f0be9e587`。
- license/notice：`traitlets-5.16.1.dist-info/licenses/LICENSE`；1536 bytes；licenseSHA256 `2f51727d9063b54856773cb51388bdb79f2936ee4a1b692ef553d8c4201311ab`。
- 实际审阅结论：主 LICENSE 三条 BSD 原文已全文审阅；版权、二进制 notices、免责保留，禁止上游背书。

### F.1 Pygments 2.21.0

- component：`Pygments`；version：`2.21.0`；decision：`approved`；spdx：`BSD-2-Clause`。
- artifact：`pygments-2.21.0-py3-none-any.whl`；1250147 bytes；artifactSHA256：`2363c69b61c4a97c838da3b130dcd6468f4848992b21a82f2a63ec34377137d9`。
- 主源：[官方 wheel 原件](https://files.pythonhosted.org/packages/71/46/17f022dd3e953bf20a04a028a21ec746d942f8d2af30fa0f124fa0e6a684/pygments-2.21.0-py3-none-any.whl)。
- 实际保留：pywencai，payload 哈希对照 348 项，差异0。METADATA保留 SHA256 `1dde075570136774c706bf0009183a793fe0ee262e4a5590cc6eff8453eedd43`。
- license/notice：`pygments-2.21.0.dist-info/licenses/AUTHORS`；11048 bytes；licenseSHA256 `71a83872ad82f57be692cf827e048e2cd51d45169cfa1ea3f28706d97a872c0f`。
- license/notice：`pygments-2.21.0.dist-info/licenses/LICENSE`；1331 bytes；licenseSHA256 `a9d66f1d526df02e29dce73436d34e56e8632f46c275bbdffc70569e882f9f17`。
- 实际审阅结论：主 LICENSE 明确两条 BSD，并引用 AUTHORS；11,048 bytes AUTHORS 全文和源码保持原字节，全部对应版权材料随候选保留。

### F.1 packaging 26.3

- component：`packaging`；version：`26.3`；decision：`approved`；spdx：`BSD-2-Clause`。
- artifact：`packaging-26.3-py3-none-any.whl`；129956 bytes；artifactSHA256：`d7193f7c8e4e93f444fde0262bf90af30e16fa0ad0ad44cb553c87339b23cd1c`。
- 主源：[官方 wheel 原件](https://files.pythonhosted.org/packages/63/34/ba1c580383c9eada3711951fef0795c80b829a078d72188184bcab9dd527/packaging-26.3-py3-none-any.whl)。
- 实际保留：pywencai，payload 哈希对照 28 项，差异0。METADATA保留 SHA256 `70fdb89fc4d4a9a043bf7372b8972bcc883fddff34ab55e9cf80d73875384763`。
- license/notice：`packaging-26.3.dist-info/licenses/LICENSE`；197 bytes；licenseSHA256 `cad1ef5bd340d73e074ba614d26f7deaca5c7940c3d8c34852e65c4909686c48`。
- license/notice：`packaging-26.3.dist-info/licenses/LICENSE.APACHE`；10174 bytes；licenseSHA256 `0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594`。
- license/notice：`packaging-26.3.dist-info/licenses/LICENSE.BSD`；1344 bytes；licenseSHA256 `b70e7e9b742f1cc6f948b34c16aa39ffece94196364bc88ff0d2180f0028fac5`。
- 实际审阅结论：LICENSE 明确 either，现明确选择 LICENSE.BSD 的 BSD-2-Clause 分支；同时保留选择声明、BSD 与 Apache 三份文件，不把双许可误写 AND。

### F.1 sniffio 1.3.1

- component：`sniffio`；version：`1.3.1`；decision：`approved`；spdx：`MIT`。
- artifact：`sniffio-1.3.1-py3-none-any.whl`；10235 bytes；artifactSHA256：`2f6da418d1f1e0fddd844478f41680e794e6051915791a034ff65e5f100525a2`。
- 主源：[官方 wheel 原件](https://files.pythonhosted.org/packages/e9/44/75a9c9421471a6c4805dbf2356f7c181a29c1879239abab1ea2cc8f38b40/sniffio-1.3.1-py3-none-any.whl)。
- 实际保留：mootdx，payload 哈希对照 12 项，差异0。METADATA保留 SHA256 `0b318b57098edeccf585e60a889a6b6a7b5c4086f3a9aa62eff76a1d3cee12d9`。
- license/notice：`sniffio-1.3.1.dist-info/LICENSE`；185 bytes；licenseSHA256 `652c878488d1456361e08c3f8607fd7ba59892a14103d15cce4ff93c85b5cc8b`。
- license/notice：`sniffio-1.3.1.dist-info/LICENSE.APACHE2`；11358 bytes；licenseSHA256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`。
- license/notice：`sniffio-1.3.1.dist-info/LICENSE.MIT`；1046 bytes；licenseSHA256 `3e6dae555eb92787fc82d1d48355677f454c7f65aeb38d3f9e72bf9a3daf034b`。
- 实际审阅结论：LICENSE 明确 either，现选择 LICENSE.MIT；原始 MIT/Apache/选择声明三份仍全部保留，不因选择 MIT 删除替代许可。

### F.1 python-dateutil 2.9.0.post0

- component：`python-dateutil`；version：`2.9.0.post0`；decision：`approved`；spdx：`BSD-3-Clause`。
- artifact：`python_dateutil-2.9.0.post0-py2.py3-none-any.whl`；229892 bytes；artifactSHA256：`a8b2bc7bffae282281c8140a97d3aa9c14da0b136dfe83f850eea9a5f7470427`。
- 主源：[官方 wheel 原件](https://files.pythonhosted.org/packages/ec/57/56b9bcc3c9c6a792fcbaf139543cee77261f3651ca9da0c93f5c1221264b/python_dateutil-2.9.0.post0-py2.py3-none-any.whl)。
- 实际保留：akshare、mootdx、pywencai，payload 哈希对照 72 项，差异0。METADATA保留 SHA256 `a9d436da322be808332f98d88325998e87cb693a678a9969feb4cfad729a6e93`。
- license/notice：`python_dateutil-2.9.0.post0.dist-info/LICENSE`；2889 bytes；licenseSHA256 `ba00f51a0d92823b5a1cde27d8b5b9d2321e67ed8da9bc163eff96d5e17e577e`。
- 实际审阅结论：实际 LICENSE 最后一段明确 BSD 适用于全部代码，包括同时由 Apache 覆盖的代码；据此选择 BSD-3-Clause，保留整份含 Apache 历史声明的原文。

### F.1 parso 0.8.7

- component：`parso`；version：`0.8.7`；decision：`approved`；spdx：`MIT AND PSF-2.0`。
- artifact：`parso-0.8.7-py2.py3-none-any.whl`；107025 bytes；artifactSHA256：`a8926eb2a1b915486941fdbd31e86a4baf88fe8c210f25f2f35ecec5b574ca1c`。
- 主源：[官方 wheel 原件](https://files.pythonhosted.org/packages/99/5d/8268b644392ee874ee82a635cd0df1773de230bde356c38de28e298392cc/parso-0.8.7-py2.py3-none-any.whl)。
- 实际保留：pywencai，payload 哈希对照 36 项，差异0。METADATA保留 SHA256 `2fd8c9f8209218163a6c086ba8075d177122430645fea770cc02c53cd426119d`。
- license/notice：`parso-0.8.7.dist-info/AUTHORS.txt`；2029 bytes；licenseSHA256 `4830a0bbc85794105c8cf3f2513f92296db4fc83363315bef7984a15a448ab22`。
- license/notice：`parso-0.8.7.dist-info/LICENSE.txt`；4176 bytes；licenseSHA256 `fa67973073753d17624caf8684d5ee816d70c89d912c5bca7ca0f08e7b150edb`。
- 实际审阅结论：MIT 授予覆盖贡献，实际 LICENSE 另列 pgen2/tokenize/token 等 Python 派生文件并附 PSF-2.0；完整 LICENSE/AUTHORS 和现有上游说明已保留，本候选没有修改这些文件。后续修改须按 PSF 条款附变化摘要。

### F.1 jedi 0.20.0

- component：`jedi`；version：`0.20.0`；decision：`approved`；spdx：`MIT AND Apache-2.0`。
- artifact：`jedi-0.20.0-py2.py3-none-any.whl`；4884812 bytes；artifactSHA256：`7bdd9c2634f56713299976f4cbd59cb3fa92165cc5e05ea811fb253480728b67`。
- 主源：[官方 wheel 原件](https://files.pythonhosted.org/packages/9a/93/242e2eab5fe682ffcb8b0084bde703a41d51e17ee0f3a31ff0d9d813620a/jedi-0.20.0-py2.py3-none-any.whl)。
- 实际保留：pywencai，payload 哈希对照 5625 项，差异0。METADATA保留 SHA256 `436bd0fb249b82dee15e85e2fb91d08d8e797481a16af48a725b8e4fb5340478`。
- license/notice：`jedi/third_party/django-stubs/LICENSE.txt`；1075 bytes；licenseSHA256 `235e993965d399a25e7d493d25c8622f78718510884b9c051f1f1866b6f34e9d`。
- license/notice：`jedi/third_party/typeshed/LICENSE`；12657 bytes；licenseSHA256 `295f8538c94ae5c3043301cf7cff1c852dab6a786a8ddee471e061b40d5ecabe`。
- license/notice：`jedi-0.20.0.dist-info/AUTHORS.txt`；2661 bytes；licenseSHA256 `d0b472b36617b4af87481671338dd649139e5c619090937ba317c98bed2bbff2`。
- license/notice：`jedi-0.20.0.dist-info/LICENSE.txt`；1241 bytes；licenseSHA256 `78e60cd0b8f28694f30195482c33d76908d846b0d15278deb7332aa22ba8e412`。
- 实际审阅结论：主项目和 django-stubs 的 MIT、typeshed 的完整 Apache-2.0 及其另列 MIT 全文均已审阅。四份 notices 含源码子目录两份，不仅 dist-info；实际5,625次payload对照一致，不重新授权为全 MIT。

### F.1 et_xmlfile 2.0.0

- component：`et_xmlfile`；version：`2.0.0`；decision：`approved`；spdx：`MIT AND LicenseRef-et-xmlfile-2.0.0-Python-Notices`。
- artifact：`et_xmlfile-2.0.0-py3-none-any.whl`；18059 bytes；artifactSHA256：`7a91720bc756843502c3b7504c77b8fe44217c85c537d85037f0f536151b2caa`。
- 主源：[官方 wheel 原件](https://files.pythonhosted.org/packages/c1/8b/5fe2cc11fee489817272089c4203e679c63b570a5aaeb18d852ae3cbba6a/et_xmlfile-2.0.0-py3-none-any.whl)。
- 实际保留：akshare，payload 哈希对照 9 项，差异0。METADATA保留 SHA256 `0e97d7ea909ed0fbe03d88bc8b6f58677cee1b07bd3353ce361cd2405915204e`。
- license/notice：`et_xmlfile-2.0.0.dist-info/AUTHORS.txt`；82 bytes；licenseSHA256 `7f038029ea5463605dd2278d300099a381bce9e90dda83ccab2042346b6c8107`。
- license/notice：`et_xmlfile-2.0.0.dist-info/LICENCE.python`；14688 bytes；licenseSHA256 `4ccdaaebc0f44b83720ec0399bb7ab329adce067dd62f73c5535a2dc05628ab2`。
- license/notice：`et_xmlfile-2.0.0.dist-info/LICENCE.rst`；1131 bytes；licenseSHA256 `0c84bb42f5d367e5ebf9fc2dde35b16141df5ee0fdc189250858bc6c5560f69e`。
- 实际审阅结论：LICENCE.rst 为 MIT；LICENCE.python 含完整 PSF/BeOpen/CNRI/CWI/文档0BSD历史条款以及包作者对命名空间等修改的具体摘要，AUTHORS 亦保留。三文件及当前源码均未改。LicenseRef 精确表示本项已读复合全文，不是未知许可兜底。

### F.1 typing_extensions 4.16.0

- component：`typing_extensions`；version：`4.16.0`；decision：`approved`；spdx：`LicenseRef-typing-extensions-4.16.0-Python-Notices`。
- artifact：`typing_extensions-4.16.0-py3-none-any.whl`；45571 bytes；artifactSHA256：`481caa481374e813c1b176ada14e97f1f67a4539ce9cfeb3f350d78d6370c2e8`。
- 主源：[官方 wheel 原件](https://files.pythonhosted.org/packages/49/d3/b8441a820a491ddfc024b0b0cf0393375b75ea13866d9c66727e54c2fc80/typing_extensions-4.16.0-py3-none-any.whl)。
- 实际保留：akshare、mootdx、pywencai，payload 哈希对照 12 项，差异0。METADATA保留 SHA256 `b05084ca1d50879865178d9fff9fabeab61bdfb1f361bfbde95421ffc8f9be46`。
- license/notice：`typing_extensions-4.16.0.dist-info/licenses/LICENSE`；13936 bytes；licenseSHA256 `3b2f81fe21d181c499c59a256c8e1968455d6689d269aa85373bfb6af41da3bf`。
- 实际审阅结论：完整13,936 bytes文本含 PSF-2.0 和历史 BeOpen/CNRI/CWI/文档0BSD条款；原版权、分发条件、免责声明与不背书条件保留，当前wheel payload未经本项目修改。LicenseRef绑定这一确切全文，不更改原METADATA的PSF-2.0声明。

### F.1 jsonpath 0.82.2

- component：`jsonpath`；version：`0.82.2`；decision：`approved`；spdx：`MIT`。
- artifact：`jsonpath-0.82.2-py2.py3-none-any.whl`；45640 bytes；artifactSHA256：`f0cef8d52734c71e1c06a2da87940a72c8840d7f3e64cbb123b6b3b29f0db117`。
- 主源为[官方原始 sdist](https://files.pythonhosted.org/packages/cf/a1/693351acd0a9edca4de9153372a65e75398898ea7f8a5c722ab00f464929/jsonpath-0.82.2.tar.gz)，原包 SHA256 `d87ef2bcbcded68ee96bc34c1809b69457ecec9b0c4dd471658a12bd391002d1`。派生wheel没有官方下载URL，不使用本机 file URI 作为来源授权。
- 已审候选报告关联 recipe `scripts/build-provider-source-wheels.py`，SHA256 `3d53de6ca20346ef6b284976d7ebd95c6a29ff9f6fe37b6b995127571ca801da`；这是既有报告身份，不声明本轮重新执行或审批未来改动的配方。许可批准不免除上游/recipe/派生artifact实际字节校验。
- 实际保留：akshare，payload 哈希对照 9 项，差异0。METADATA保留 SHA256 `9e957e97d407ef4c031f23f56b930594b08b856d90251daf4f93efebc9ec57e5`。
- license/notice：`jsonpath-0.82.2.dist-info/licenses/embedded-license-jsonpath.py.txt`；11891 bytes；licenseSHA256 `41a1d195649383e13efd72b8dbedebf66c68865a690a2aa3c6c62da52ee369fb`。
- 实际审阅结论：实际派生wheel中的完整 jsonpath.py 同时作为embedded notice，含 Goessner/Rhodes/Budne 版权及 MIT 全文；许可证允许重打包，实际派生artifact及候选字节一致。配方/原sdist身份仍为单独供应链门禁，不把许可审批当作已重跑recipe。

### F.1 PyExecJS 1.5.1

- component：`PyExecJS`；version：`1.5.1`；decision：`approved`；spdx：`MIT`。
- artifact：`pyexecjs-1.5.1-py2.py3-none-any.whl`；73259 bytes；artifactSHA256：`de51fa4692182d14c6005396e2dafa45368090dc64526e7fea9fde7a856fce28`。
- 主源为[官方原始 sdist](https://files.pythonhosted.org/packages/ba/8e/aedef81641c8dca6fd0fb7294de5bed9c45f3397d67fddf755c1042c2642/PyExecJS-1.5.1.tar.gz)，原包 SHA256 `34cc1d070976918183ff7bdc0ad71f8157a891c92708c00c5fbbff7a769f505c`。派生wheel没有官方下载URL，不使用本机 file URI 作为来源授权。
- 已审候选报告关联 recipe `scripts/build-provider-source-wheels.py`，SHA256 `3d53de6ca20346ef6b284976d7ebd95c6a29ff9f6fe37b6b995127571ca801da`；这是既有报告身份，不声明本轮重新执行或审批未来改动的配方。许可批准不免除上游/recipe/派生artifact实际字节校验。
- 实际保留：pywencai，payload 哈希对照 20 项，差异0。METADATA保留 SHA256 `b56844d9ab2f9ddcd2719476c9a11a2f08cd1f9d10a9b770acfd82fea12a1f00`。
- license/notice：`pyexecjs-1.5.1.dist-info/licenses/LICENSE`；1118 bytes；licenseSHA256 `b78c9017c899272226bb1cbd8ffe79f43630699bf2ba1fdae3d4e7b41d85ae04`。
- 实际审阅结论：实际派生wheel完整保留 Omoto Kenji/Sam Stephenson/Josh Peek 三项版权与 MIT 授予；许可证允许重打包，候选payload及notice相同。six依赖和Node安全行为不由本许可记录批准。

### F.2 可由 Franklin 逐项纳入的现有 policy 字段

下面是精确白名单，不是生成规则。字段直接对齐已读现有 policy 的 `id/component/version/artifactSha256/licenseSha256/spdx/decision/reviewedBy/reviewReference`。用户要求的 reviewIdentity/reference 分别落在 reviewedBy/reviewReference；不得额外臆造用户姓名或律师身份。component 保留实际已审METADATA/报告名称；若新的实现已统一PEP503规范名，仅可按同一明确规范映射名称，须保留版本及两项完整hash，不能以通配符、前缀或缺省version代替。

一个资产的不同 license/NOTICE/AUTHORS/METADATA SHA 分别列键，后两者只表示该已审资产的原始版权/来源材料保留，不是单独授予软件权利。spdx是本次选择的组件分发条件，不要求每个AUTHORS文件文本自身重印许可证；主 LICENSE 和全部适用附属 notices 必须一起交付。源代码内部版权同样保留。下列三项 LicenseRef 的定义分别是 E.3 Node整份组合文本、F.1 et_xmlfile 的精确 LICENCE.python、F.1 typing_extensions 的精确完整 LICENSE；不可转用至其他artifact或其他文本。

这些记录只授权原文和当前未改payload的有界软件再分发，保留不背书/不授商标/未来修改说明等持续条件。不授市场数据或网站服务访问权，不替代下载源和recipe审核，不代表整个provider闭包、三个平台安装包或生产运行时已完成。纯wheel如Mac解析得到完全相同artifact及notice字节，可复用精确许可决定；Mac不同wheel/Node/PBS资产必须另行绑定，不能按同名版本继承。

```json
[
  {
    "id": "astra-20261009-akshare-1.19.1-1",
    "component": "akshare",
    "version": "1.19.1",
    "artifactSha256": "8ab82d4a468d2c384df02de470df3a44e8b899fd8cfe116bceff52dd7b804df9",
    "licenseSha256": "d1c84fbaccd5fdbc75cd12ab9a05f4f791d89ee266569bc976c8b0befafc2d65",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-akshare-1.19.1-2",
    "component": "akshare",
    "version": "1.19.1",
    "artifactSha256": "8ab82d4a468d2c384df02de470df3a44e8b899fd8cfe116bceff52dd7b804df9",
    "licenseSha256": "62eeb65899303550636c2fee622e00350e2e6ca9baeb08889c8e2669f7d1d440",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-anyio-4.15.1-1",
    "component": "anyio",
    "version": "4.15.1",
    "artifactSha256": "6152fdbbf9a77fdec97731721bebf7c4c44f7c29b424b0065826173efc7ed101",
    "licenseSha256": "5361ac9dc58f2ef5fd2e9b09c68297c17f04950909bbc8023bdb82eacf22c2b0",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-anyio-4.15.1-2",
    "component": "anyio",
    "version": "4.15.1",
    "artifactSha256": "6152fdbbf9a77fdec97731721bebf7c4c44f7c29b424b0065826173efc7ed101",
    "licenseSha256": "043aecb571af7189e8a6c528f5d8e32545f1b2cdfaaf761d51e6d5b67ea3ca81",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-beautifulsoup4-4.15.0-1",
    "component": "beautifulsoup4",
    "version": "4.15.0",
    "artifactSha256": "d6f88de62e1d4e38ecb1077eb9724cd0eff29d2a08ca16a401e9b9e93f117cf9",
    "licenseSha256": "b989238918e1fdac1e46717cb405b63e92497a272413af0d989c1df6c8abcb6f",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-beautifulsoup4-4.15.0-2",
    "component": "beautifulsoup4",
    "version": "4.15.0",
    "artifactSha256": "d6f88de62e1d4e38ecb1077eb9724cd0eff29d2a08ca16a401e9b9e93f117cf9",
    "licenseSha256": "55b4d8d4b1e5bc86d10efac91b74c87bcb77526b0f5b9edaf8b9cd2adc7397b2",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-beautifulsoup4-4.15.0-3",
    "component": "beautifulsoup4",
    "version": "4.15.0",
    "artifactSha256": "d6f88de62e1d4e38ecb1077eb9724cd0eff29d2a08ca16a401e9b9e93f117cf9",
    "licenseSha256": "b2f888103259f1607c85f3b1163be1bc49fc9941a3243c3b89a21075bfc6d4fb",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-click-8.5.0-1",
    "component": "click",
    "version": "8.5.0",
    "artifactSha256": "255bc9599cf7748b4b1a446ccc735421bd08a2ae529a8b88597d3de5664ee360",
    "licenseSha256": "9a8ad106a394e853bfe21f42f4e72d592819a22805d991b5f3275029292b658d",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-click-8.5.0-2",
    "component": "click",
    "version": "8.5.0",
    "artifactSha256": "255bc9599cf7748b4b1a446ccc735421bd08a2ae529a8b88597d3de5664ee360",
    "licenseSha256": "e87bce0bd194de70dfb8e708e0a6b0483009f25611804eaf87bfeb63e6c20501",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-colorama-0.4.6-1",
    "component": "colorama",
    "version": "0.4.6",
    "artifactSha256": "4f1d9991f5acc0ca119f9d443620b77f9d6b33703e51011c16baf57afb285fc6",
    "licenseSha256": "cac35c02686e5d04a5a7140bfb3b36e73aed496656e891102e428886d7930318",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-colorama-0.4.6-2",
    "component": "colorama",
    "version": "0.4.6",
    "artifactSha256": "4f1d9991f5acc0ca119f9d443620b77f9d6b33703e51011c16baf57afb285fc6",
    "licenseSha256": "7baed29eb50c3b29bdb33ff84e3177bf1bc05784f7685ecdcaa4471c7dd810cc",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-comm-0.2.3-1",
    "component": "comm",
    "version": "0.2.3",
    "artifactSha256": "c615d91d75f7f04f095b30d1c1711babd43bdc6419c1be9886a85f2f4e489417",
    "licenseSha256": "97a7e0a142b7c1dcd26461b20fc13980988b4449b7446ed776928826fd2ca9c4",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-comm-0.2.3-2",
    "component": "comm",
    "version": "0.2.3",
    "artifactSha256": "c615d91d75f7f04f095b30d1c1711babd43bdc6419c1be9886a85f2f4e489417",
    "licenseSha256": "e475291f8fdedbecbbfd788a2c5de9c912424d23574aba7b9fc51985d7158878",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-decorator-5.3.1-1",
    "component": "decorator",
    "version": "5.3.1",
    "artifactSha256": "f47fe6fdbd2edd623ecfe36875d37aba411624e2670dd395dddae1358689bb3c",
    "licenseSha256": "bd12cc51405c10872497c10ca21601f1d4abc50496595cc89e89ab5dad24fb62",
    "spdx": "BSD-2-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-decorator-5.3.1-2",
    "component": "decorator",
    "version": "5.3.1",
    "artifactSha256": "f47fe6fdbd2edd623ecfe36875d37aba411624e2670dd395dddae1358689bb3c",
    "licenseSha256": "2133792485403bbd739e1db5960228bedbcde6d00c0acc052b27f39dbae5b5c4",
    "spdx": "BSD-2-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-executing-2.2.1-1",
    "component": "executing",
    "version": "2.2.1",
    "artifactSha256": "760643d3452b4d777d295bb167ccc74c64a81df23fb5e08eff250c425a4b2017",
    "licenseSha256": "a476a2cb0ef4c41450340a577a28b91ac4c7f669136b2ee148047fabd5fc4181",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-executing-2.2.1-2",
    "component": "executing",
    "version": "2.2.1",
    "artifactSha256": "760643d3452b4d777d295bb167ccc74c64a81df23fb5e08eff250c425a4b2017",
    "licenseSha256": "d7586d1ae225bee126c4237eb0c4d7699a8580b81eb558cc500c263d29a633ff",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-h11-0.16.0-1",
    "component": "h11",
    "version": "0.16.0",
    "artifactSha256": "63cf8bbe7522de3bf65932fda1d9c2772064ffb3dae62d55932da54b31cb6c86",
    "licenseSha256": "37db5bb85926db28a427a25867f10b1232003aea1be69ccb851138adb8e6f361",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-h11-0.16.0-2",
    "component": "h11",
    "version": "0.16.0",
    "artifactSha256": "63cf8bbe7522de3bf65932fda1d9c2772064ffb3dae62d55932da54b31cb6c86",
    "licenseSha256": "28f326098ac09fcba79b8f180f96087c841fe2456215cb7b872a9c7d5cd19d64",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-html5lib-1.1-1",
    "component": "html5lib",
    "version": "1.1",
    "artifactSha256": "0d78f8fde1c230e99fe37986a60526d7049ed4bf8a9fadbad5f00e22e58e041d",
    "licenseSha256": "0eb3403227e80e9b90c899fe296f87e8af13b766b9aca9d5d94178f8346b1942",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-html5lib-1.1-2",
    "component": "html5lib",
    "version": "1.1",
    "artifactSha256": "0d78f8fde1c230e99fe37986a60526d7049ed4bf8a9fadbad5f00e22e58e041d",
    "licenseSha256": "16a39991619e92f18680932da2a9199fdf7d95df3ecaedc52ea06218aabafd6f",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-html5lib-1.1-3",
    "component": "html5lib",
    "version": "1.1",
    "artifactSha256": "0d78f8fde1c230e99fe37986a60526d7049ed4bf8a9fadbad5f00e22e58e041d",
    "licenseSha256": "637c3e9ddff6d87427411cb7cb2a55b15fe47b6145f78b940f8faf1a97360e72",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-httpcore-1.0.9-1",
    "component": "httpcore",
    "version": "1.0.9",
    "artifactSha256": "2d400746a40668fc9dec9810239072b40b4484b640a8c38fd654a024c7a1bf55",
    "licenseSha256": "fdcb59154c74cbaba16a11242f7740bea9f23d6feb5547917d8c5f94a80392a5",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-httpcore-1.0.9-2",
    "component": "httpcore",
    "version": "1.0.9",
    "artifactSha256": "2d400746a40668fc9dec9810239072b40b4484b640a8c38fd654a024c7a1bf55",
    "licenseSha256": "fe2d4fda6199128978779e0cf27f3c045c531863fcdd987eacc74f3a18d41c21",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-httpx-0.25.2-1",
    "component": "httpx",
    "version": "0.25.2",
    "artifactSha256": "a05d3d052d9b2dfce0e3896636467f8a5342fb2b902c819428e1ac65413ca118",
    "licenseSha256": "4ec59d544f12b5f539a3a716fd321ac58ccd8030b465221f2c880200cdf28d8d",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-httpx-0.25.2-2",
    "component": "httpx",
    "version": "0.25.2",
    "artifactSha256": "a05d3d052d9b2dfce0e3896636467f8a5342fb2b902c819428e1ac65413ca118",
    "licenseSha256": "759d9e9cd5e6bc68a2ba42c622dbaa038599401ca964f29047d623cc240a58f5",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-idna-3.20-1",
    "component": "idna",
    "version": "3.20",
    "artifactSha256": "ab7ae7122974553370f0bdb919e1a960b2cd1bc1ef0276416d896db81c14582c",
    "licenseSha256": "1a9a4f0e3d479a27240ddd59a9137a66ab4a0f9dfdc8ca6188cc0bfd85187f04",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-idna-3.20-2",
    "component": "idna",
    "version": "3.20",
    "artifactSha256": "ab7ae7122974553370f0bdb919e1a960b2cd1bc1ef0276416d896db81c14582c",
    "licenseSha256": "dbd8c14c1e4ca1e0c9824a6dbc7cbbf78884f38eb52d91148cd3025f671e4b85",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-ipython-pygments-lexers-1.1.1-1",
    "component": "ipython_pygments_lexers",
    "version": "1.1.1",
    "artifactSha256": "a9462224a505ade19a605f71f8fa63c2048833ce50abc86768a0d81d876dc81c",
    "licenseSha256": "b1d0dbc0fa79774d34b8e2d0aec91d50d8caf05f7b40fc22c3010a4bd9ad2bf9",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-ipython-pygments-lexers-1.1.1-2",
    "component": "ipython_pygments_lexers",
    "version": "1.1.1",
    "artifactSha256": "a9462224a505ade19a605f71f8fa63c2048833ce50abc86768a0d81d876dc81c",
    "licenseSha256": "6b38c0946bdbc4778f4e38e2298547cbd7d13aeba9979ec4e4a412eabfbdfadb",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-jupyter-client-8.10.0-1",
    "component": "jupyter_client",
    "version": "8.10.0",
    "artifactSha256": "5f73f24f22fa25192cfff6b23c051932a2473a797b05734aff495b392103e14e",
    "licenseSha256": "5ca74e4d2eeb9330b0d129c25f874d3544a13413bc62ae8d367819100d095072",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-jupyter-client-8.10.0-2",
    "component": "jupyter_client",
    "version": "8.10.0",
    "artifactSha256": "5f73f24f22fa25192cfff6b23c051932a2473a797b05734aff495b392103e14e",
    "licenseSha256": "95ec04e32a2decceb7325efa691e6e160201e4e8184db1b1e36a239f9170f560",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-jupyter-core-5.9.1-1",
    "component": "jupyter_core",
    "version": "5.9.1",
    "artifactSha256": "ebf87fdc6073d142e114c72c9e29a9d7ca03fad818c5d300ce2adc1fb0743407",
    "licenseSha256": "448f1835f5fa08dd075088e46f76f73eb9ac9c2aef0a6c8816be06d30ef592c7",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-jupyter-core-5.9.1-2",
    "component": "jupyter_core",
    "version": "5.9.1",
    "artifactSha256": "ebf87fdc6073d142e114c72c9e29a9d7ca03fad818c5d300ce2adc1fb0743407",
    "licenseSha256": "68a656d7e2ebe45d40becf6032998192790d8a7536942f72167d79b8559e5ded",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-matplotlib-inline-0.2.2-1",
    "component": "matplotlib-inline",
    "version": "0.2.2",
    "artifactSha256": "3c821cf1c209f59fb2d2d64abbf5b23b67bcb2210d663f9918dd851c6da1fcf6",
    "licenseSha256": "8521b036c6448e0e0aa7213d4713b6fdee0f4c64c9f320450f77346bf5c0e8e4",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-matplotlib-inline-0.2.2-2",
    "component": "matplotlib-inline",
    "version": "0.2.2",
    "artifactSha256": "3c821cf1c209f59fb2d2d64abbf5b23b67bcb2210d663f9918dd851c6da1fcf6",
    "licenseSha256": "fedb3d587ec2d3fa4b0a81fd5353df697d2534c8ee714dbf050009afc60bcab7",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-nest-asyncio2-1.7.4-1",
    "component": "nest-asyncio2",
    "version": "1.7.4",
    "artifactSha256": "86e77b52c3d1496b294af3c944b44213b9b82a12a5ee590c0acc4ca4692ef6c7",
    "licenseSha256": "cec819c02a99e78449d64f3c0217d415c3a210f2a6abfcd827c6b1cb76954e78",
    "spdx": "BSD-2-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-nest-asyncio2-1.7.4-2",
    "component": "nest-asyncio2",
    "version": "1.7.4",
    "artifactSha256": "86e77b52c3d1496b294af3c944b44213b9b82a12a5ee590c0acc4ca4692ef6c7",
    "licenseSha256": "5aa5b09a2e2d3f6f51a54498c96a77b94097eba06e194c136a9ec87707d758b0",
    "spdx": "BSD-2-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-openpyxl-3.1.5-1",
    "component": "openpyxl",
    "version": "3.1.5",
    "artifactSha256": "5282c12b107bffeef825f4617dc029afaf41d0ea60823bbb665ef3079dc79de2",
    "licenseSha256": "0c84bb42f5d367e5ebf9fc2dde35b16141df5ee0fdc189250858bc6c5560f69e",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-openpyxl-3.1.5-2",
    "component": "openpyxl",
    "version": "3.1.5",
    "artifactSha256": "5282c12b107bffeef825f4617dc029afaf41d0ea60823bbb665ef3079dc79de2",
    "licenseSha256": "23f80ca9830dd89435da1710f26deda8f81e5409287e74540210c72627a4ad96",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-platformdirs-4.12.4-1",
    "component": "platformdirs",
    "version": "4.12.4",
    "artifactSha256": "78bfb9db2a8471ed7eebe3c3c932da413911042994e699b384fbb4493fa872d7",
    "licenseSha256": "29e0fd62e929850e86eb28c3fdccf0cefdf4fa94879011cffb3d0d4bed6d4db6",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-platformdirs-4.12.4-2",
    "component": "platformdirs",
    "version": "4.12.4",
    "artifactSha256": "78bfb9db2a8471ed7eebe3c3c932da413911042994e699b384fbb4493fa872d7",
    "licenseSha256": "2418b715af2d19c99d62ebf721c2e02075f20479ac9c0557a06e119fdbe14a3f",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-prettytable-3.18.0-1",
    "component": "prettytable",
    "version": "3.18.0",
    "artifactSha256": "b3346e0e6f79180833aebaac088ae926340586cf6d7d991b9eb125b65f72313a",
    "licenseSha256": "0c8adcc204c8af6cdfdf7887dfd1f99c29901f6c1d505a78bba96efa4fb2cb05",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-prettytable-3.18.0-2",
    "component": "prettytable",
    "version": "3.18.0",
    "artifactSha256": "b3346e0e6f79180833aebaac088ae926340586cf6d7d991b9eb125b65f72313a",
    "licenseSha256": "271a5357524f01c8ce05af4ecd0d9fb8ea969e774f80aa2dcaa1d39005255558",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-prompt-toolkit-3.0.53-1",
    "component": "prompt_toolkit",
    "version": "3.0.53",
    "artifactSha256": "01c0891d7f9237d5e339f7d3e42cdae80b7534abb1c7c0e3352efba6231492f2",
    "licenseSha256": "d3dc62c6bc8436658495ab89aea37511e7fa9391d282657239c9cfb80dbd42e5",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-prompt-toolkit-3.0.53-2",
    "component": "prompt_toolkit",
    "version": "3.0.53",
    "artifactSha256": "01c0891d7f9237d5e339f7d3e42cdae80b7534abb1c7c0e3352efba6231492f2",
    "licenseSha256": "303574d9bdd85c757d6025017942bf17baeedf2778f62bd7f425d07d880f4c4a",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-prompt-toolkit-3.0.53-3",
    "component": "prompt_toolkit",
    "version": "3.0.53",
    "artifactSha256": "01c0891d7f9237d5e339f7d3e42cdae80b7534abb1c7c0e3352efba6231492f2",
    "licenseSha256": "d04994e4401b88abf884ca54fb3b85e50a8b4fb1fde1ed7eb3ece9d8bf5459a9",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-pure-eval-0.2.4-1",
    "component": "pure_eval",
    "version": "0.2.4",
    "artifactSha256": "96cae060a313cfaad51bb761278bfb0e62dc0248d9315a81173752dc546cd37a",
    "licenseSha256": "a476a2cb0ef4c41450340a577a28b91ac4c7f669136b2ee148047fabd5fc4181",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-pure-eval-0.2.4-2",
    "component": "pure_eval",
    "version": "0.2.4",
    "artifactSha256": "96cae060a313cfaad51bb761278bfb0e62dc0248d9315a81173752dc546cd37a",
    "licenseSha256": "4fe70f69411b9963d7275084210743afa819c2350899a29150bc43b1abf105d0",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-pycparser-3.1-1",
    "component": "pycparser",
    "version": "3.1",
    "artifactSha256": "f09d358c840bd147b79e55f2bc494f18ea869dc897f5852a8f5766b74f787882",
    "licenseSha256": "0a9e78156ae8b96caf1b4f11ac2df424b83de29736f9e757630548a6272fdf90",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-pycparser-3.1-2",
    "component": "pycparser",
    "version": "3.1",
    "artifactSha256": "f09d358c840bd147b79e55f2bc494f18ea869dc897f5852a8f5766b74f787882",
    "licenseSha256": "f4a14c8bb8bcb1139830e9722da8725fc36c8e22ee0d13e5d094b5b354f80a9d",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-pydash-7.0.7-1",
    "component": "pydash",
    "version": "7.0.7",
    "artifactSha256": "c3c5b54eec0a562e0080d6f82a14ad4d5090229847b7e554235b5c1558c745e1",
    "licenseSha256": "6f61fcb95e6a64d2c2cf519d01165348d2d833eaaa7dbd0f1cf3dca1795e24c8",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-pydash-7.0.7-2",
    "component": "pydash",
    "version": "7.0.7",
    "artifactSha256": "c3c5b54eec0a562e0080d6f82a14ad4d5090229847b7e554235b5c1558c745e1",
    "licenseSha256": "1bba57c33cce44a00d2edf0794e14bd0c6dc1569a4e78d834c8f4103b8e9623f",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-pydash-7.0.7-3",
    "component": "pydash",
    "version": "7.0.7",
    "artifactSha256": "c3c5b54eec0a562e0080d6f82a14ad4d5090229847b7e554235b5c1558c745e1",
    "licenseSha256": "312f4f59d7073acecbb94e9bbca53f97ae1047976ec24c4a6d4710cdedbe5efe",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-pywencai-0.13.1-1",
    "component": "pywencai",
    "version": "0.13.1",
    "artifactSha256": "6786a014baed92cef25d855f8f175c5265868552dfacd7e37c098f92e4e038ff",
    "licenseSha256": "f619e8a9798a5fd5be106923ab8a02f17aa0f3820195aa310cdf62b154724368",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-pywencai-0.13.1-2",
    "component": "pywencai",
    "version": "0.13.1",
    "artifactSha256": "6786a014baed92cef25d855f8f175c5265868552dfacd7e37c098f92e4e038ff",
    "licenseSha256": "45b93f2bf5eac8cd5d89f1bc51d026639adf2a0343ee9d6f71bb4a3135a9878d",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-six-1.17.0-1",
    "component": "six",
    "version": "1.17.0",
    "artifactSha256": "4721f391ed90541fddacab5acf947aa0d3dc7d27b2e1e8eda2be8970586c3274",
    "licenseSha256": "4375ba20e2b9c6c4e7cad2940a628fd90e95cc3d50ee92aae755715d8ba1fbd0",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-six-1.17.0-2",
    "component": "six",
    "version": "1.17.0",
    "artifactSha256": "4721f391ed90541fddacab5acf947aa0d3dc7d27b2e1e8eda2be8970586c3274",
    "licenseSha256": "562042078c2752549f6d8a7c86dbc5dd708088a7be6d80672ec7b07100b72468",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-soupsieve-2.10-1",
    "component": "soupsieve",
    "version": "2.10",
    "artifactSha256": "8596eb8967d744174820280fa62b4542a2e955bfaccca73ed8a13c6eb8e9b502",
    "licenseSha256": "76a0acdb98c3a63681e20b6f096699ef8cad5fb35d56eef8387e0fa71d797a9a",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-soupsieve-2.10-2",
    "component": "soupsieve",
    "version": "2.10",
    "artifactSha256": "8596eb8967d744174820280fa62b4542a2e955bfaccca73ed8a13c6eb8e9b502",
    "licenseSha256": "02ecd6c72d2fa0911bedfd99d53b2198e1bbf556f4606108819e8c19fdf32880",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-stack-data-0.6.3-1",
    "component": "stack-data",
    "version": "0.6.3",
    "artifactSha256": "d5558e0c25a4cb0853cddad3d77da9891a08cb85dd9f9f91b9f8cd66e511e695",
    "licenseSha256": "a476a2cb0ef4c41450340a577a28b91ac4c7f669136b2ee148047fabd5fc4181",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-stack-data-0.6.3-2",
    "component": "stack-data",
    "version": "0.6.3",
    "artifactSha256": "d5558e0c25a4cb0853cddad3d77da9891a08cb85dd9f9f91b9f8cd66e511e695",
    "licenseSha256": "f28a66f2adde54e7031355e09a166e437bc0d023a31c10c973ac494288ca4c6f",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-tabulate-0.10.0-1",
    "component": "tabulate",
    "version": "0.10.0",
    "artifactSha256": "f0b0622e567335c8fabaaa659f1b33bcb6ddfe2e496071b743aa113f8774f2d3",
    "licenseSha256": "cdfab50d37d8ead06468fb76a3abafcd05c16749ec8a18eebfa50fd48c7cb2d2",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-tabulate-0.10.0-2",
    "component": "tabulate",
    "version": "0.10.0",
    "artifactSha256": "f0b0622e567335c8fabaaa659f1b33bcb6ddfe2e496071b743aa113f8774f2d3",
    "licenseSha256": "38dfc6db689745ff4c3890b3c30ef7e5d0b156fdbeeb765b9027fd917043d84b",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-urllib3-2.8.0-1",
    "component": "urllib3",
    "version": "2.8.0",
    "artifactSha256": "0cf3cae568d36aa9576b28dfb35f11328f1cb974ca7647d9475ebb86c75ac6e3",
    "licenseSha256": "130e3a64d5fdd5d096a752694634a7d9df284469de86e5732100268041e3d686",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-urllib3-2.8.0-2",
    "component": "urllib3",
    "version": "2.8.0",
    "artifactSha256": "0cf3cae568d36aa9576b28dfb35f11328f1cb974ca7647d9475ebb86c75ac6e3",
    "licenseSha256": "10898c620e8007c030e07fa5622b68358a43010025dfbd78a1cb797699de2bb4",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-webencodings-0.6.1-1",
    "component": "webencodings",
    "version": "0.6.1",
    "artifactSha256": "7fab6269c8bf237c657876b52058ccb182e861518d1c695c1a9aaa8c1c105d5b",
    "licenseSha256": "e06ef33485e7498ad592887c41fa79cc8a7fecde576c7210e11bfdddef58040e",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-webencodings-0.6.1-2",
    "component": "webencodings",
    "version": "0.6.1",
    "artifactSha256": "7fab6269c8bf237c657876b52058ccb182e861518d1c695c1a9aaa8c1c105d5b",
    "licenseSha256": "3d9819d1209e5b56d4c6315efca7d5ca452ba7e55d4c3617ec63555c099bfb70",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-requests-2.34.2-1",
    "component": "requests",
    "version": "2.34.2",
    "artifactSha256": "2a0d60c172f83ac6ab31e4554906c0f3b3588d37b5cb939b1c061f4907e278e0",
    "licenseSha256": "09e8a9bcec8067104652c168685ab0931e7868f9c8284b66f5ae6edae5f1130b",
    "spdx": "Apache-2.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-requests-2.34.2-2",
    "component": "requests",
    "version": "2.34.2",
    "artifactSha256": "2a0d60c172f83ac6ab31e4554906c0f3b3588d37b5cb939b1c061f4907e278e0",
    "licenseSha256": "f5110972dedad2b4e9d314518daf3b7d72d6e02e499acd802181de6f74571dcc",
    "spdx": "Apache-2.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-requests-2.34.2-3",
    "component": "requests",
    "version": "2.34.2",
    "artifactSha256": "2a0d60c172f83ac6ab31e4554906c0f3b3588d37b5cb939b1c061f4907e278e0",
    "licenseSha256": "8c384ba3e979480faae2859d3c5e6c1276dd2c3616e322e124d52c8cfc556f27",
    "spdx": "Apache-2.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-asttokens-3.0.2-1",
    "component": "asttokens",
    "version": "3.0.2",
    "artifactSha256": "9da13157f5b28becde0bd374fc677dcd3c290614264eff096f167c469cd9f933",
    "licenseSha256": "62fb8a3a9621dc2388174caaabe9c2317b694bb9a1d46c98bcf5655b68f51be3",
    "spdx": "Apache-2.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-asttokens-3.0.2-2",
    "component": "asttokens",
    "version": "3.0.2",
    "artifactSha256": "9da13157f5b28becde0bd374fc677dcd3c290614264eff096f167c469cd9f933",
    "licenseSha256": "8b3567b29654e6e9a60ab50fde2c317899152790acadaab7868a708bf931c3d3",
    "spdx": "Apache-2.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-tenacity-8.5.0-1",
    "component": "tenacity",
    "version": "8.5.0",
    "artifactSha256": "b594c2a5945830c267ce6b79a166228323ed52718f30302c1359836112346687",
    "licenseSha256": "58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd",
    "spdx": "Apache-2.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-tenacity-8.5.0-2",
    "component": "tenacity",
    "version": "8.5.0",
    "artifactSha256": "b594c2a5945830c267ce6b79a166228323ed52718f30302c1359836112346687",
    "licenseSha256": "f02051f69607a22dd857ae82902404e700cb365991e984b215ece3584f4e408a",
    "spdx": "Apache-2.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-traitlets-5.16.1-1",
    "component": "traitlets",
    "version": "5.16.1",
    "artifactSha256": "f775618166caa0396c8e337099240f2bd3e5e917d203b2e6fbe21a58d3cb1f6b",
    "licenseSha256": "2f51727d9063b54856773cb51388bdb79f2936ee4a1b692ef553d8c4201311ab",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-traitlets-5.16.1-2",
    "component": "traitlets",
    "version": "5.16.1",
    "artifactSha256": "f775618166caa0396c8e337099240f2bd3e5e917d203b2e6fbe21a58d3cb1f6b",
    "licenseSha256": "e42b503240c058625ffb30c390818d72933117840cb25060614cb24f0be9e587",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-pygments-2.21.0-1",
    "component": "Pygments",
    "version": "2.21.0",
    "artifactSha256": "2363c69b61c4a97c838da3b130dcd6468f4848992b21a82f2a63ec34377137d9",
    "licenseSha256": "71a83872ad82f57be692cf827e048e2cd51d45169cfa1ea3f28706d97a872c0f",
    "spdx": "BSD-2-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-pygments-2.21.0-2",
    "component": "Pygments",
    "version": "2.21.0",
    "artifactSha256": "2363c69b61c4a97c838da3b130dcd6468f4848992b21a82f2a63ec34377137d9",
    "licenseSha256": "a9d66f1d526df02e29dce73436d34e56e8632f46c275bbdffc70569e882f9f17",
    "spdx": "BSD-2-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-pygments-2.21.0-3",
    "component": "Pygments",
    "version": "2.21.0",
    "artifactSha256": "2363c69b61c4a97c838da3b130dcd6468f4848992b21a82f2a63ec34377137d9",
    "licenseSha256": "1dde075570136774c706bf0009183a793fe0ee262e4a5590cc6eff8453eedd43",
    "spdx": "BSD-2-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-packaging-26.3-1",
    "component": "packaging",
    "version": "26.3",
    "artifactSha256": "d7193f7c8e4e93f444fde0262bf90af30e16fa0ad0ad44cb553c87339b23cd1c",
    "licenseSha256": "cad1ef5bd340d73e074ba614d26f7deaca5c7940c3d8c34852e65c4909686c48",
    "spdx": "BSD-2-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-packaging-26.3-2",
    "component": "packaging",
    "version": "26.3",
    "artifactSha256": "d7193f7c8e4e93f444fde0262bf90af30e16fa0ad0ad44cb553c87339b23cd1c",
    "licenseSha256": "0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594",
    "spdx": "BSD-2-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-packaging-26.3-3",
    "component": "packaging",
    "version": "26.3",
    "artifactSha256": "d7193f7c8e4e93f444fde0262bf90af30e16fa0ad0ad44cb553c87339b23cd1c",
    "licenseSha256": "b70e7e9b742f1cc6f948b34c16aa39ffece94196364bc88ff0d2180f0028fac5",
    "spdx": "BSD-2-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-packaging-26.3-4",
    "component": "packaging",
    "version": "26.3",
    "artifactSha256": "d7193f7c8e4e93f444fde0262bf90af30e16fa0ad0ad44cb553c87339b23cd1c",
    "licenseSha256": "70fdb89fc4d4a9a043bf7372b8972bcc883fddff34ab55e9cf80d73875384763",
    "spdx": "BSD-2-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-sniffio-1.3.1-1",
    "component": "sniffio",
    "version": "1.3.1",
    "artifactSha256": "2f6da418d1f1e0fddd844478f41680e794e6051915791a034ff65e5f100525a2",
    "licenseSha256": "652c878488d1456361e08c3f8607fd7ba59892a14103d15cce4ff93c85b5cc8b",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-sniffio-1.3.1-2",
    "component": "sniffio",
    "version": "1.3.1",
    "artifactSha256": "2f6da418d1f1e0fddd844478f41680e794e6051915791a034ff65e5f100525a2",
    "licenseSha256": "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-sniffio-1.3.1-3",
    "component": "sniffio",
    "version": "1.3.1",
    "artifactSha256": "2f6da418d1f1e0fddd844478f41680e794e6051915791a034ff65e5f100525a2",
    "licenseSha256": "3e6dae555eb92787fc82d1d48355677f454c7f65aeb38d3f9e72bf9a3daf034b",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-sniffio-1.3.1-4",
    "component": "sniffio",
    "version": "1.3.1",
    "artifactSha256": "2f6da418d1f1e0fddd844478f41680e794e6051915791a034ff65e5f100525a2",
    "licenseSha256": "0b318b57098edeccf585e60a889a6b6a7b5c4086f3a9aa62eff76a1d3cee12d9",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-python-dateutil-2.9.0.post0-1",
    "component": "python-dateutil",
    "version": "2.9.0.post0",
    "artifactSha256": "a8b2bc7bffae282281c8140a97d3aa9c14da0b136dfe83f850eea9a5f7470427",
    "licenseSha256": "ba00f51a0d92823b5a1cde27d8b5b9d2321e67ed8da9bc163eff96d5e17e577e",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-python-dateutil-2.9.0.post0-2",
    "component": "python-dateutil",
    "version": "2.9.0.post0",
    "artifactSha256": "a8b2bc7bffae282281c8140a97d3aa9c14da0b136dfe83f850eea9a5f7470427",
    "licenseSha256": "a9d436da322be808332f98d88325998e87cb693a678a9969feb4cfad729a6e93",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-parso-0.8.7-1",
    "component": "parso",
    "version": "0.8.7",
    "artifactSha256": "a8926eb2a1b915486941fdbd31e86a4baf88fe8c210f25f2f35ecec5b574ca1c",
    "licenseSha256": "4830a0bbc85794105c8cf3f2513f92296db4fc83363315bef7984a15a448ab22",
    "spdx": "MIT AND PSF-2.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-parso-0.8.7-2",
    "component": "parso",
    "version": "0.8.7",
    "artifactSha256": "a8926eb2a1b915486941fdbd31e86a4baf88fe8c210f25f2f35ecec5b574ca1c",
    "licenseSha256": "fa67973073753d17624caf8684d5ee816d70c89d912c5bca7ca0f08e7b150edb",
    "spdx": "MIT AND PSF-2.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-parso-0.8.7-3",
    "component": "parso",
    "version": "0.8.7",
    "artifactSha256": "a8926eb2a1b915486941fdbd31e86a4baf88fe8c210f25f2f35ecec5b574ca1c",
    "licenseSha256": "2fd8c9f8209218163a6c086ba8075d177122430645fea770cc02c53cd426119d",
    "spdx": "MIT AND PSF-2.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-jedi-0.20.0-1",
    "component": "jedi",
    "version": "0.20.0",
    "artifactSha256": "7bdd9c2634f56713299976f4cbd59cb3fa92165cc5e05ea811fb253480728b67",
    "licenseSha256": "235e993965d399a25e7d493d25c8622f78718510884b9c051f1f1866b6f34e9d",
    "spdx": "MIT AND Apache-2.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-jedi-0.20.0-2",
    "component": "jedi",
    "version": "0.20.0",
    "artifactSha256": "7bdd9c2634f56713299976f4cbd59cb3fa92165cc5e05ea811fb253480728b67",
    "licenseSha256": "295f8538c94ae5c3043301cf7cff1c852dab6a786a8ddee471e061b40d5ecabe",
    "spdx": "MIT AND Apache-2.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-jedi-0.20.0-3",
    "component": "jedi",
    "version": "0.20.0",
    "artifactSha256": "7bdd9c2634f56713299976f4cbd59cb3fa92165cc5e05ea811fb253480728b67",
    "licenseSha256": "d0b472b36617b4af87481671338dd649139e5c619090937ba317c98bed2bbff2",
    "spdx": "MIT AND Apache-2.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-jedi-0.20.0-4",
    "component": "jedi",
    "version": "0.20.0",
    "artifactSha256": "7bdd9c2634f56713299976f4cbd59cb3fa92165cc5e05ea811fb253480728b67",
    "licenseSha256": "78e60cd0b8f28694f30195482c33d76908d846b0d15278deb7332aa22ba8e412",
    "spdx": "MIT AND Apache-2.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-jedi-0.20.0-5",
    "component": "jedi",
    "version": "0.20.0",
    "artifactSha256": "7bdd9c2634f56713299976f4cbd59cb3fa92165cc5e05ea811fb253480728b67",
    "licenseSha256": "436bd0fb249b82dee15e85e2fb91d08d8e797481a16af48a725b8e4fb5340478",
    "spdx": "MIT AND Apache-2.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-et-xmlfile-2.0.0-1",
    "component": "et_xmlfile",
    "version": "2.0.0",
    "artifactSha256": "7a91720bc756843502c3b7504c77b8fe44217c85c537d85037f0f536151b2caa",
    "licenseSha256": "7f038029ea5463605dd2278d300099a381bce9e90dda83ccab2042346b6c8107",
    "spdx": "MIT AND LicenseRef-et-xmlfile-2.0.0-Python-Notices",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-et-xmlfile-2.0.0-2",
    "component": "et_xmlfile",
    "version": "2.0.0",
    "artifactSha256": "7a91720bc756843502c3b7504c77b8fe44217c85c537d85037f0f536151b2caa",
    "licenseSha256": "4ccdaaebc0f44b83720ec0399bb7ab329adce067dd62f73c5535a2dc05628ab2",
    "spdx": "MIT AND LicenseRef-et-xmlfile-2.0.0-Python-Notices",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-et-xmlfile-2.0.0-3",
    "component": "et_xmlfile",
    "version": "2.0.0",
    "artifactSha256": "7a91720bc756843502c3b7504c77b8fe44217c85c537d85037f0f536151b2caa",
    "licenseSha256": "0c84bb42f5d367e5ebf9fc2dde35b16141df5ee0fdc189250858bc6c5560f69e",
    "spdx": "MIT AND LicenseRef-et-xmlfile-2.0.0-Python-Notices",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-et-xmlfile-2.0.0-4",
    "component": "et_xmlfile",
    "version": "2.0.0",
    "artifactSha256": "7a91720bc756843502c3b7504c77b8fe44217c85c537d85037f0f536151b2caa",
    "licenseSha256": "0e97d7ea909ed0fbe03d88bc8b6f58677cee1b07bd3353ce361cd2405915204e",
    "spdx": "MIT AND LicenseRef-et-xmlfile-2.0.0-Python-Notices",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-typing-extensions-4.16.0-1",
    "component": "typing_extensions",
    "version": "4.16.0",
    "artifactSha256": "481caa481374e813c1b176ada14e97f1f67a4539ce9cfeb3f350d78d6370c2e8",
    "licenseSha256": "3b2f81fe21d181c499c59a256c8e1968455d6689d269aa85373bfb6af41da3bf",
    "spdx": "LicenseRef-typing-extensions-4.16.0-Python-Notices",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-typing-extensions-4.16.0-2",
    "component": "typing_extensions",
    "version": "4.16.0",
    "artifactSha256": "481caa481374e813c1b176ada14e97f1f67a4539ce9cfeb3f350d78d6370c2e8",
    "licenseSha256": "b05084ca1d50879865178d9fff9fabeab61bdfb1f361bfbde95421ffc8f9be46",
    "spdx": "LicenseRef-typing-extensions-4.16.0-Python-Notices",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-jsonpath-0.82.2-1",
    "component": "jsonpath",
    "version": "0.82.2",
    "artifactSha256": "f0cef8d52734c71e1c06a2da87940a72c8840d7f3e64cbb123b6b3b29f0db117",
    "licenseSha256": "41a1d195649383e13efd72b8dbedebf66c68865a690a2aa3c6c62da52ee369fb",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-jsonpath-0.82.2-2",
    "component": "jsonpath",
    "version": "0.82.2",
    "artifactSha256": "f0cef8d52734c71e1c06a2da87940a72c8840d7f3e64cbb123b6b3b29f0db117",
    "licenseSha256": "9e957e97d407ef4c031f23f56b930594b08b856d90251daf4f93efebc9ec57e5",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-pyexecjs-1.5.1-1",
    "component": "PyExecJS",
    "version": "1.5.1",
    "artifactSha256": "de51fa4692182d14c6005396e2dafa45368090dc64526e7fea9fde7a856fce28",
    "licenseSha256": "b78c9017c899272226bb1cbd8ffe79f43630699bf2ba1fdae3d4e7b41d85ae04",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-pyexecjs-1.5.1-2",
    "component": "PyExecJS",
    "version": "1.5.1",
    "artifactSha256": "de51fa4692182d14c6005396e2dafa45368090dc64526e7fea9fde7a856fce28",
    "licenseSha256": "b56844d9ab2f9ddcd2719476c9a11a2f08cd1f9d10a9b770acfd82fea12a1f00",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  },
  {
    "id": "astra-20261009-node-22.23.3-win-x64-notices",
    "component": "node",
    "version": "22.23.3",
    "artifactSha256": "2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71",
    "licenseSha256": "8cc9bb466b19fc7e7cc99d03e9df1132021fda8b01eea2624c58bb372dbef576",
    "spdx": "LicenseRef-Node-22.23.3-Bundled-Notices",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-decisions-20261009"
  }
]
```

### F.3 不混入本次精确白名单的关键门禁

| 项目 | 状态 | 最小补件及真实限制 |
|---|---|---|
| Microsoft CRT / PBS Windows aggregate | pending | 发行主体许可资格或合法再分发链、适用 REDIST DLL清单、下游许可/同意证据；PSF/MIT文本不能授予Microsoft发行资格。 |
| BDB | pending | 以实际链接与交付清单确定是否适用；若交付Sleepycat代码，落实其对应源码/再分发条件。不能只因full包带notice就假定Windows链接BDB，也不能标BSD。 |
| Tix | pending | 从既已固定来源/哈希的8.4.3.6源包实际保留license.terms、docs/license.tcltk、docs/license.html_lib并进入inventory；报告列出URL不等于文件已经交付。 |
| lxml / libiconv | pending | 对应producer/源版本、已固定源资产、补丁及充分重建/重新链接输入与说明、LGPL全文、接收者取得源码的位置；未满足前不以顶层BSD批准原生组合。 |
| mootdx / tdxpy | pending | 固定版本MIT与非商业文字的分发范围书面澄清；不能删掉原文、仅改版本号、或把TDX功能静默替换掉来过门禁。 |
| 其他未在F.2列出的资产 | pending | 沿E.4的逐项补件继续，特别原生vendor、MPL对应源、未映射.data文件；不是一律禁止候选技术工作。 |

本次将确切审批键直接交 Franklin，而不是要求他凭包名/许可证字符串自行推导批准。PBS13项组件notice仍按E.2范围处理，本次没有为整包PBS生成approved记录。Franklin修改独占policy前应保留原pending项，公共policy字节变化需重新绑定候选证据，但无需为尚pending的其他组件推迟这些已确认记录。没有修改policy、源码、HTTP修复、生产数据或远程引用。

## G. 新 Windows 候选 html5lib 未匹配项的独立取证

日期：2026-10-09；reviewer：Astra。此节是限定实际字节审查，不是整份新候选、70项测试或三端运行的独立复验。

1. 实际读取 `franklin-prep-20261009-final-1791504310.verification.json` 原字节：81,109 bytes，SHA256 `1328a25710501ab7266df129a3bb401f10cd2ffcd5f23bafcafbae17e5793efc`。
2. 实际读取同批 `.fragment.json`：SHA256 `8f9c1f1219e06c3b9c186d7f587226b63202e3fea22a4510e5d77b9d01dbd73f`；其 preparationPolicySha256 为 `2cdf932ea5307bcc5ac7a9cd2c437c74f5a2e0f970b65e0c57510576836452d5`，sourceCommit 为 null，pending 列表保留许可、来源与正式bootstrap门禁。本文没有独立核对其全部 policy 审批或 inventory。
3. 未匹配 `astra-20261009-html5lib-1.1-1` 对应 `html5lib-1.1.dist-info/AUTHORS.rst`，不是主 LICENSE。直接读取新 tree 的 `providers/akshare/site/html5lib-1.1.dist-info/AUTHORS.rst`：983 bytes，SHA256 `0eb3403227e80e9b90c899fe296f87e8af13b766b9aca9d5d94178f8346b1942`，与 F.2 的既有批准精确一致。
4. 新 fragment 的 html5lib licenseRequirements 实际只列 LICENSE 与 METADATA，并分别绑定 F.2 的 id2、id3。故 id1 未匹配是附属 notice 未进入该许可索引，不是实际文件丢失、字节变化或审批失效；也不能据此宣称全部 inventory 已独立核实。
5. 已直接要求 Franklin 对齐附属 notice 枚举/索引范围。若原契约要求 AUTHORS 进入许可索引，则补索引与相关负例，并正常生成新证据；若明确作为仅 file inventory 约束的署名材料，须给实际 inventory 对照，并诚实保留“108条usage匹配、1条已保留但未列许可索引”的口径。两条路线均不得改审批hash、伪造usage或为了计数而自动批准新文本。

F.2 原109条审批建议不变。当前确认的是这一份新候选的 AUTHORS 实物保留及两个实际usage；Windows整体真实性、CJS新增内核、Mac原生执行和正式封装仍各按自身验收门禁办理。此次仍只写本审查文档，没有改policy、prep或生产文件。


<a id="astra-license-batch-h-20261009"></a>
## H. 243 pending usages 的第一批实际原文审查与精确建议

审查日期：2026-10-09。身份：Astra / engineering redistribution review。以下是工程分发合规建议，不是律师意见、整包法律保证、正式封包或三端安装验收。本节不修改 Franklin 的 policy。

### H.1 实物、计数与批准范围

本批直接取证于 `D:/RT-ResearchFlow-BuildCache/股票日线 prep-utf8-1791505394.fragment.json`，原字节 SHA256：`916f8fb234a1cef3c6680f671208d635ab9f2ab9707d0c7a4702ca7f8c21b4e1`；对应 tree 为 `D:/RT-ResearchFlow-BuildCache/股票日线 prep-utf8-1791505394-materialize/tree`。243 是 pending 使用记录数，去重后为108个 component/version/artifactSHA/licenseSHA 四键，不是243份 unique 许可；其中33条使用记录是 METADATA。

实际读取并核对了 PBS 的109条候选 notice 使用记录原字节。Provider 取证第一次输出被截断，未把截断结果当作完整证据；保留完整可解析记录，对丢失的唯一文本补读并核对 SHA。NumPy另对18份唯一文本（含顶层许可和METADATA）读原字节、核对SHA；本批仅批准其中16份明确子组件notice。重复使用同一四键的其他路径仍由 materializer/inventory 逐文件验证，本节不冒称本轮独立核对了每个重复payload文件。

明确逐项选定的建议共 **67四键：PBS notice 33、Provider notice 18、NumPy子组件notice 16**。它们在上述已读快照中精确覆盖 **179 pending usages**；应用建议后的该快照算术余量是64 usages/41四键。此计数不是新候选的实际 policy 执行结果。Franklin报告的新 `prep-authors-1791506440` 为244 pending usages/109四键，此处没有独立重读或冒用其计数。

审批单位是下面明确的“该资产中的该份许可/署名文本及其覆盖部分”。尤其 PBS 的 CRT/BDB/Tix、NumPy顶层原生组合、pyzmq的libzmq仍有各自未关闭项，**不能将一个子组件notice批准解释为整个复合资产获批**。同一文本出现在另一平台/另一artifact SHA中也不能自动迁移批准。

### H.2 共同交付条件与本批具体判断

- 已读MIT/BSD/ISC类原件允许源及二进制再分发。原版权、条件、免责声明已在候选保留；发布时须继续带入可读取的随包第三方许可目录，不删作者署名，不作未经许可的作者/商标背书。不可因本身是原生扩展就要求其必然开源，也不可因顶层MIT就推定所有vendor都已覆盖。
- Apache条目保留全文、适用copyright/NOTICE；如未来修改源码须标记修改。cachecontrol/msgpack仅有短声明，但**同一PBS实际已保留** distro的完整Apache2文本，SHA `cb5e8e7e5f4a3988e1063c142c60dc2df75605f4c46515e776e3aca6df976e14`。交付索引须明确该全文同时供两者取得，不是仅留网络URL替代Apache复制义务。
- distlib保留的是完整PSF/BeOpen/CNRI/CWI历史文本，不能简写为裸MIT；本批没有修改其代码，之后若产生受相关条款约束的派生修改须附变更摘要。
- packaging选择其明示“either”中的BSD分支；highway选择明示可选BSD并同时保留单独CC0组件条件；原未选的Apache全文也不删除。对应JSON中的spdx是此次选择的适用许可，不是把名为LICENSE.APACHE的文件内容改称BSD。
- NumPy dragon4原件明确载明作者允许NumPy以MIT代替其最初Zlib许可，且保留移植/修改说明；不用因历史Zlib来源再人为阻断。
- certifi及tqdm的原件含MPL Exhibit A和取得MPL的URL。MPL原文3.1要求告知源码适用条款及如何取得许可证，**不能一律推导为“必须另附完整MPL文本，否则不可分发”**。此前同artifact真实纯wheel比对中，certifi33项、tqdm76项payload比较无差异；候选保留Python/PEM源码及原notice。本批认可这种未删减源码交付的notice履约路径；tqdm为MPL与MIT共同适用，不是二选一。后续若只交付编译物、删源码、改CA内容或改变接收者权利，须另按MPL3.2重新评估；本结论不扩展到pyzmq的原生libzmq二进制。
- ipykernel/ipython旧payload审计的.data安装映射未匹配，是交付映射证据问题，不等于BSD授权缺失；本批可关闭其已保留许可文本，映射完整性仍交正常inventory/安装检查，不能伪称已独立全payload验证。

### H.3 逐条依据（序号与H.5 JSON严格对应）

| id尾号 | component/version | 文本位置 | 适用许可 | 审查结论/保留条件 |
|---|---|---|---|---|
| 001 | python-build-standalone 3.13.16 | `licenses/python-full/python/install/Lib/site-packages/pip-26.2.1.dist-info/licenses/AUTHORS.txt` | MIT | approved建议：pip AUTHORS；与实际保留的pip MIT全文配套，不是独立授权。 |
| 002 | python-build-standalone 3.13.16 | `licenses/python-full/python/install/Lib/site-packages/pip-26.2.1.dist-info/licenses/LICENSE.txt` | MIT | approved建议：pip copyright、全文及AUTHORS均已保留。 |
| 003 | python-build-standalone 3.13.16 | `licenses/python-full/python/install/Lib/site-packages/pip/_vendor/cachecontrol/LICENSE.txt` | Apache-2.0 | approved建议：cachecontrol版权/Apache声明已保留；同PBS实际保留distro完整Apache全文（cb5e8e7e...）配套提供。 |
| 004 | python-build-standalone 3.13.16 | `licenses/python-full/python/install/Lib/site-packages/pip/_vendor/distlib/LICENSE.txt` | LicenseRef-distlib-Python-Notices | approved建议：distlib原PSF/BeOpen/CNRI/CWI整份历史许可保留；本次不修改该代码，后续修改须附变更摘要，不借用PSF商标。 |
| 005 | python-build-standalone 3.13.16 | `licenses/python-full/python/install/Lib/site-packages/pip/_vendor/distro/LICENSE` | Apache-2.0 | approved建议：distro完整Apache全文及版权保留；不授予商标背书。 |
| 006 | python-build-standalone 3.13.16 | `licenses/python-full/python/install/Lib/site-packages/pip/_vendor/idna/LICENSE.md` | BSD-3-Clause | approved建议：idna版权、三条条件、免责声明保留。 |
| 007 | python-build-standalone 3.13.16 | `licenses/python-full/python/install/Lib/site-packages/pip/_vendor/msgpack/COPYING` | Apache-2.0 | approved建议：msgpack版权/Apache声明已保留；配套同PBS实际distro完整Apache全文。 |
| 008 | python-build-standalone 3.13.16 | `licenses/python-full/python/install/Lib/site-packages/pip/_vendor/packaging/LICENSE` | BSD-2-Clause | approved建议：packaging明确允许二选一；选BSD，保留选择声明与两份全文。 |
| 009 | python-build-standalone 3.13.16 | `licenses/python-full/python/install/Lib/site-packages/pip/_vendor/packaging/LICENSE.APACHE` | BSD-2-Clause | approved建议：packaging未选Apache原文也保留；此记录表示附属文本保留，不把它误标为BSD原文。 |
| 010 | python-build-standalone 3.13.16 | `licenses/python-full/python/install/Lib/site-packages/pip/_vendor/packaging/LICENSE.BSD` | BSD-2-Clause | approved建议：packaging选择BSD分支，其完整授权文本已保留。 |
| 011 | python-build-standalone 3.13.16 | `licenses/python-full/python/install/Lib/site-packages/pip/_vendor/pkg_resources/LICENSE` | MIT | approved建议：pkg_resources原MIT许可全文保留，原源码版权不得删减。 |
| 012 | python-build-standalone 3.13.16 | `licenses/python-full/python/install/Lib/site-packages/pip/_vendor/platformdirs/LICENSE` | MIT | approved建议：platformdirs原MIT版权和许可全文保留。 |
| 013 | python-build-standalone 3.13.16 | `licenses/python-full/python/install/Lib/site-packages/pip/_vendor/pyproject_hooks/LICENSE` | MIT | approved建议：pyproject_hooks原MIT版权和许可全文保留。 |
| 014 | python-build-standalone 3.13.16 | `licenses/python-full/python/install/Lib/site-packages/pip/_vendor/requests/LICENSE` | Apache-2.0 | approved建议：requests完整Apache全文保留；如修改源码须标记。 |
| 015 | python-build-standalone 3.13.16 | `licenses/python-full/python/install/Lib/site-packages/pip/_vendor/resolvelib/LICENSE` | ISC | approved建议：resolvelib实际是ISC，保留版权及许可，非MIT推断。 |
| 016 | python-build-standalone 3.13.16 | `licenses/python-full/python/install/Lib/site-packages/pip/_vendor/rich/LICENSE` | MIT | approved建议：rich原MIT版权和许可全文保留。 |
| 017 | python-build-standalone 3.13.16 | `licenses/python-full/python/install/Lib/site-packages/pip/_vendor/tomli/LICENSE` | MIT | approved建议：tomli/tomli_w该相同原文哈希保留；不据此批准其他版本。 |
| 018 | python-build-standalone 3.13.16 | `licenses/python-full/python/install/Lib/site-packages/pip/_vendor/truststore/LICENSE` | MIT | approved建议：truststore原MIT版权和许可全文保留。 |
| 019 | python-build-standalone 3.13.16 | `licenses/python-full/python/install/Lib/site-packages/pip/_vendor/urllib3/LICENSE.txt` | MIT | approved建议：urllib3原MIT版权和许可全文保留。 |
| 020 | python-build-standalone 3.13.16 | `licenses/python-full/python/install/tcl/tk8.6/license.terms` | TCL | approved建议：Tk原版权和许可逐字保留；不与尚缺附属条款的Tix混同。 |
| 021 | python-build-standalone 3.13.16 | `licenses/python-full/python/licenses/LICENSE.bzip2.txt` | bzip2-1.0.6 | approved建议：bzip2原版权、来源及修改标识条款保留；不冒充作者、不背书。 |
| 022 | python-build-standalone 3.13.16 | `licenses/python-full/python/licenses/LICENSE.expat.txt` | MIT | approved建议：Expat原版权及全文保留。 |
| 023 | python-build-standalone 3.13.16 | `licenses/python-full/python/licenses/LICENSE.libedit.txt` | BSD-3-Clause | approved建议：libedit原版权、贡献者、三条条件保留。 |
| 024 | python-build-standalone 3.13.16 | `licenses/python-full/python/licenses/LICENSE.libffi.txt` | MIT | approved建议：libffi原版权及全文保留。 |
| 025 | python-build-standalone 3.13.16 | `licenses/python-full/python/licenses/LICENSE.liblzma.txt` | 0BSD | approved建议：liblzma原文无署名条件，是0BSD式授权；仍保留原文。 |
| 026 | python-build-standalone 3.13.16 | `licenses/python-full/python/licenses/LICENSE.libuuid.txt` | BSD-3-Clause | approved建议：libuuid原版权、条件及免责声明保留。 |
| 027 | python-build-standalone 3.13.16 | `licenses/python-full/python/licenses/LICENSE.libXau.txt` | MIT-open-group | approved建议：libXau支持文档版权/许可和禁止使用Open Group名义促销条款保留。 |
| 028 | python-build-standalone 3.13.16 | `licenses/python-full/python/licenses/LICENSE.libxcb.txt` | LicenseRef-PBS-libxcb-Permission | approved建议：libxcb完整MIT及禁止用作者/机构名义推广附加条款保留；不按裸MIT截断。 |
| 029 | python-build-standalone 3.13.16 | `licenses/python-full/python/licenses/LICENSE.mpdecimal.txt` | BSD-2-Clause | approved建议：mpdecimal两条保留条件已满足。 |
| 030 | python-build-standalone 3.13.16 | `licenses/python-full/python/licenses/LICENSE.ncurses.txt` | LicenseRef-PBS-ncurses-Permission | approved建议：ncurses完整许可含禁止未经许可使用版权人名称推广；原文保留。 |
| 031 | python-build-standalone 3.13.16 | `licenses/python-full/python/licenses/LICENSE.sqlite.txt` | LicenseRef-SQLite-Public-Domain | approved建议：SQLite实际原文明确代码/文档公共领域及商业分发；不把构建脚本也概括为公共领域。 |
| 032 | python-build-standalone 3.13.16 | `licenses/python-full/python/licenses/LICENSE.tcl.txt` | TCL | approved建议：Tcl原版权/逐字许可保留；政府使用段不等于禁止一般商业分发。 |
| 033 | python-build-standalone 3.13.16 | `licenses/python-full/python/licenses/LICENSE.zlib.txt` | Zlib | approved建议：zlib来源不误述、修改须标识、不得删notice；实际原文保留。 |
| 034 | cffi 2.1.1 | `providers/akshare/site/cffi-2.1.1.dist-info/licenses/LICENSE` | MIT-0 | approved建议：实际原版权/许可已保留；许可范围限该文本覆盖代码。本记录不代替原生vendor归属/执行资产审计。 |
| 035 | charset-normalizer 3.5.2 | `providers/akshare/site/charset_normalizer-3.5.2.dist-info/licenses/LICENSE` | MIT | approved建议：实际原版权/许可已保留；许可范围限该文本覆盖代码。本记录不代替原生vendor归属/执行资产审计。 |
| 036 | pandas 3.0.6 | `providers/akshare/site/pandas-3.0.6.dist-info/LICENSE` | BSD-3-Clause | approved建议：实际原版权/许可已保留；许可范围限该文本覆盖代码。本记录不代替原生vendor归属/执行资产审计。 |
| 037 | wcwidth 0.9.2 | `providers/mootdx/site/wcwidth-0.9.2.dist-info/licenses/LICENSE` | MIT AND LicenseRef-Markus-Kuhn-Permission | approved建议：MIT全文及Markus Kuhn任意用途复制/修改/分发附属授权均保留。 |
| 038 | fake-useragent 1.5.1 | `providers/pywencai/site/fake_useragent-1.5.1.dist-info/AUTHORS` | Apache-2.0 | approved建议：实际原版权/许可及AUTHORS已保留；许可范围限该文本覆盖代码。 |
| 039 | fake-useragent 1.5.1 | `providers/pywencai/site/fake_useragent-1.5.1.dist-info/LICENSE` | Apache-2.0 | approved建议：实际原版权/许可及AUTHORS已保留；许可范围限该文本覆盖代码。 |
| 040 | ipykernel 7.4.0 | `providers/pywencai/site/ipykernel-7.4.0.dist-info/licenses/LICENSE` | BSD-3-Clause | approved建议：实际原版权/许可已保留；许可范围限该文本覆盖代码。 |
| 041 | ipython 9.17.1 | `providers/pywencai/site/ipython-9.17.1.dist-info/licenses/COPYING.rst` | BSD-3-Clause | approved建议：实际原版权/许可及COPYING共享版权说明已保留；许可范围限该文本覆盖代码。 |
| 042 | ipython 9.17.1 | `providers/pywencai/site/ipython-9.17.1.dist-info/licenses/LICENSE` | BSD-3-Clause | approved建议：实际原版权/许可及COPYING共享版权说明已保留；许可范围限该文本覆盖代码。 |
| 043 | psutil 7.2.2 | `providers/pywencai/site/psutil-7.2.2.dist-info/LICENSE` | BSD-3-Clause | approved建议：实际原版权/许可已保留；许可范围限该文本覆盖代码。本记录不代替原生vendor归属/执行资产审计。 |
| 044 | tornado 6.5.10 | `providers/pywencai/site/tornado-6.5.10.dist-info/licenses/LICENSE` | Apache-2.0 | approved建议：实际原版权/许可已保留；许可范围限该文本覆盖代码。本记录不代替原生vendor归属/执行资产审计。 |
| 045 | tzdata 2026.5 | `providers/pywencai/site/tzdata-2026.5.dist-info/licenses/LICENSE` | Apache-2.0 | approved建议：实际原版权/许可已保留；许可范围限该文本覆盖代码。 |
| 046 | tzdata 2026.5 | `providers/pywencai/site/tzdata-2026.5.dist-info/licenses/licenses/LICENSE_APACHE` | Apache-2.0 | approved建议：实际原版权/许可已保留；许可范围限该文本覆盖代码。 |
| 047 | certifi 2026.7.22 | `providers/akshare/site/certifi-2026.7.22.dist-info/licenses/LICENSE` | MPL-2.0 | approved建议：原文将PEM标为Source Code Form并保留MPL Exhibit A及取得许可URL；此前同artifact完整纯wheel payload比较无差异。保留Python/PEM源码及接收者权利，不把缺单独MPL全文文件本身当阻断。 |
| 048 | tqdm 4.70.1 | `providers/akshare/site/tqdm-4.70.1.dist-info/licenses/LICENCE` | MPL-2.0 AND MIT | approved建议：保留MIT全文+MPL Exhibit A/URL、真实未删减Python源码；此前同artifact76项payload比较无差异。MPL不是MIT二选一，须同时保留。 |
| 049 | pyzmq 27.2.0 | `providers/pywencai/site/pyzmq-27.2.0.dist-info/licenses/LICENSE.md` | BSD-3-Clause | approved建议：仅关闭pyzmq/其libsodium或Tornado这一明确文本项；libzmq MPL对应源交付仍单独pending，不是整个wheel批准。 |
| 050 | pyzmq 27.2.0 | `providers/pywencai/site/pyzmq-27.2.0.dist-info/licenses/licenses/LICENSE.libsodium.txt` | ISC | approved建议：仅关闭pyzmq/其libsodium或Tornado这一明确文本项；libzmq MPL对应源交付仍单独pending，不是整个wheel批准。 |
| 051 | pyzmq 27.2.0 | `providers/pywencai/site/pyzmq-27.2.0.dist-info/licenses/licenses/LICENSE.tornado.txt` | Apache-2.0 | approved建议：仅关闭pyzmq/其libsodium或Tornado这一明确文本项；libzmq MPL对应源交付仍单独pending，不是整个wheel批准。 |
| 052 | numpy 2.5.3 | `providers/akshare/site/numpy-2.5.3.dist-info/licenses/numpy/_core/include/numpy/libdivide/LICENSE.txt` | Zlib | approved建议：该子组件全文、版权和适用条件已保留；不代替NumPy顶层OpenBLAS/GCC运行库组合审查。 |
| 053 | numpy 2.5.3 | `providers/akshare/site/numpy-2.5.3.dist-info/licenses/numpy/_core/src/common/pythoncapi-compat/COPYING` | 0BSD | approved建议：该子组件全文、版权和适用条件已保留；不代替NumPy顶层OpenBLAS/GCC运行库组合审查。 |
| 054 | numpy 2.5.3 | `providers/akshare/site/numpy-2.5.3.dist-info/licenses/numpy/_core/src/highway/LICENSE` | BSD-3-Clause AND CC0-1.0 | approved建议：选择原文明确允许的BSD分支，同时遵守random-inl.h的CC0；三份全文均保留。 |
| 055 | numpy 2.5.3 | `providers/akshare/site/numpy-2.5.3.dist-info/licenses/numpy/_core/src/multiarray/dragon4_LICENSE.txt` | MIT | approved建议：原件明确记载Ryan Juckett允许NumPy改用MIT，保留授权说明及移植/修改声明。 |
| 056 | numpy 2.5.3 | `providers/akshare/site/numpy-2.5.3.dist-info/licenses/numpy/_core/src/npysort/x86-simd-sort/LICENSE.md` | BSD-3-Clause | approved建议：该子组件全文、版权和适用条件已保留；不代替NumPy顶层OpenBLAS/GCC运行库组合审查。 |
| 057 | numpy 2.5.3 | `providers/akshare/site/numpy-2.5.3.dist-info/licenses/numpy/_core/src/umath/svml/LICENSE` | BSD-3-Clause | approved建议：该子组件全文、版权和适用条件已保留；不代替NumPy顶层OpenBLAS/GCC运行库组合审查。 |
| 058 | numpy 2.5.3 | `providers/akshare/site/numpy-2.5.3.dist-info/licenses/numpy/fft/pocketfft/LICENSE.md` | BSD-3-Clause | approved建议：该子组件全文、版权和适用条件已保留；不代替NumPy顶层OpenBLAS/GCC运行库组合审查。 |
| 059 | numpy 2.5.3 | `providers/akshare/site/numpy-2.5.3.dist-info/licenses/numpy/linalg/lapack_lite/LICENSE.txt` | BSD-3-Clause-Open-MPI | approved建议：该子组件全文、版权和适用条件已保留；不代替NumPy顶层OpenBLAS/GCC运行库组合审查。 |
| 060 | numpy 2.5.3 | `providers/akshare/site/numpy-2.5.3.dist-info/licenses/numpy/ma/LICENSE` | BSD-3-Clause | approved建议：该子组件全文、版权和适用条件已保留；不代替NumPy顶层OpenBLAS/GCC运行库组合审查。 |
| 061 | numpy 2.5.3 | `providers/akshare/site/numpy-2.5.3.dist-info/licenses/numpy/random/LICENSE.md` | BSD-3-Clause | approved建议：选择明确dual-license的BSD分支；原NCSA/BSD全文均保留，子组件另逐项审核。 |
| 062 | numpy 2.5.3 | `providers/akshare/site/numpy-2.5.3.dist-info/licenses/numpy/random/src/distributions/LICENSE.md` | BSD-3-Clause AND MIT | approved建议：该子组件全文、版权和适用条件已保留；不代替NumPy顶层OpenBLAS/GCC运行库组合审查。 |
| 063 | numpy 2.5.3 | `providers/akshare/site/numpy-2.5.3.dist-info/licenses/numpy/random/src/mt19937/LICENSE.md` | BSD-3-Clause AND MIT | approved建议：该子组件全文、版权和适用条件已保留；不代替NumPy顶层OpenBLAS/GCC运行库组合审查。 |
| 064 | numpy 2.5.3 | `providers/akshare/site/numpy-2.5.3.dist-info/licenses/numpy/random/src/pcg64/LICENSE.md` | MIT | approved建议：该子组件全文、版权和适用条件已保留；不代替NumPy顶层OpenBLAS/GCC运行库组合审查。 |
| 065 | numpy 2.5.3 | `providers/akshare/site/numpy-2.5.3.dist-info/licenses/numpy/random/src/philox/LICENSE.md` | BSD-3-Clause | approved建议：该子组件全文、版权和适用条件已保留；不代替NumPy顶层OpenBLAS/GCC运行库组合审查。 |
| 066 | numpy 2.5.3 | `providers/akshare/site/numpy-2.5.3.dist-info/licenses/numpy/random/src/sfc64/LICENSE.md` | MIT | approved建议：该子组件全文、版权和适用条件已保留；不代替NumPy顶层OpenBLAS/GCC运行库组合审查。 |
| 067 | numpy 2.5.3 | `providers/akshare/site/numpy-2.5.3.dist-info/licenses/numpy/random/src/splitmix64/LICENSE.md` | CC0-1.0 | approved建议：该子组件全文、版权和适用条件已保留；不代替NumPy顶层OpenBLAS/GCC运行库组合审查。 |

### H.4 资产主源与原字节绑定

下表URL来自此前已读取并固定的实际下载证据，不是根据包名拼接下载地址。精确artifactSHA及每份licenseSHA在H.5，不以源URL或SPDX名称替代执行资产校验。

| 资产 | artifact SHA256 | 已固定主源 |
|---|---|---|
| PBS Windows install_only 3.13.16 | 5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778 | https://github.com/astral-sh/python-build-standalone/releases/download/20261003/cpython-3.13.16%2B20261003-x86_64-pc-windows-msvc-install_only.tar.gz |
| PBS对应full原notice来源 | cb3b6dcfcf179110486403204e4f5e507e8980d0ca50bb0d8c72e8c76b41b869 | https://github.com/astral-sh/python-build-standalone/releases/download/20261003/cpython-3.13.16%2B20261003-x86_64-pc-windows-msvc-pgo-full.tar.zst |
| cffi 2.1.1 | 1aa5645c30469b09530c4ebca77ebf8f17618293c58f8549cb1a543a50236e7d | https://files.pythonhosted.org/packages/60/a6/8b149b2c3f2e11aaa1618ef64500b45f50f22c57a977a4dff1aff1f91042/cffi-2.1.1-cp313-cp313-win_amd64.whl |
| charset-normalizer 3.5.2 | 78456a747de8dc58360ffa581f30a002baf5aa28cb262536545e91f113ed7639 | https://files.pythonhosted.org/packages/9c/76/b8ec57f4e9ee3253541abf95e4a462c0175fe8032dcd070f1f2421240942/charset_normalizer-3.5.2-cp313-cp313-win_amd64.whl |
| pandas 3.0.6 | f3ce8a6968045481e91a3990e797e348ce13db45ee164a7095bbc824e26c09dd | https://files.pythonhosted.org/packages/c0/bd/63cb67e6903ef6d9c2871916dbcbc09d254da0fe8b870cf62e16b21945f2/pandas-3.0.6-cp313-cp313-win_amd64.whl |
| wcwidth 0.9.2 | 2a9746de704242bd4fdaabb31dd46b82f694a56a8d21081ad89b679a89da9fec | https://files.pythonhosted.org/packages/5a/d6/b0690f55ea0483530a18bac917fbadbf54f35122510446fc370f5f1c2453/wcwidth-0.9.2-cp310-abi3-win_amd64.whl |
| fake-useragent 1.5.1 | 57415096557c8a4e23b62a375c21c55af5fd4ba30549227f562d2c4f5b60e3b3 | https://files.pythonhosted.org/packages/e4/99/60d8cf1b26938c2e0a57e232f7f15641dfcd6f8deda454d73e4145910ff6/fake_useragent-1.5.1-py3-none-any.whl |
| ipykernel 7.4.0 | a6757f790ddc5a6006b813d82da1a9dbb65b3a00f2b6607df776418c6566ec1c | https://files.pythonhosted.org/packages/a5/f8/8b5c10c7f36ab5a3b5c4703669e5b14e44e98782b58e535dd30670e8799a/ipykernel-7.4.0-py3-none-any.whl |
| ipython 9.17.1 | 6d1645743cfd1a07eb695d85aa2b5fa66721f8cbae9431d4049f7084bbf06509 | https://files.pythonhosted.org/packages/2d/1e/65b59cf518c106aa755e7f7da3099027738687a862ec785060702a481320/ipython-9.17.1-py3-none-any.whl |
| psutil 7.2.2 | eb7e81434c8d223ec4a219b5fc1c47d0417b12be7ea866e24fb5ad6e84b3d988 | https://files.pythonhosted.org/packages/b4/90/e2159492b5426be0c1fef7acba807a03511f97c5f86b3caeda6ad92351a7/psutil-7.2.2-cp37-abi3-win_amd64.whl |
| tornado 6.5.10 | 37ae8f150cecfdbf747fc4e12f5e9a97ecd8cf1d4cdb3f119e2de84b11196918 | https://files.pythonhosted.org/packages/d8/d4/5901517f05affd752490f6a654ba31b7474664e8dd80bd045a00c220bd88/tornado-6.5.10-cp39-abi3-win_amd64.whl |
| tzdata 2026.5 | b683bd1b6659ddcd810ff02ad09ba821d4bf1065072805063eb35c49617905ac | https://files.pythonhosted.org/packages/94/21/1e5995a1c920cce14e4bffae20c665ec10e7ed03ab25e006cd741092b718/tzdata-2026.5-py2.py3-none-any.whl |
| certifi 2026.7.22 | 62f22742b58a1a33014a2b6b706588a8d7e2a88ae7bd1a6ebe8c992928483775 | https://files.pythonhosted.org/packages/0b/a7/71ac2cff56fec219ed242bb11b8efb69fcc4bec75db06fb7bfe35de520e6/certifi-2026.7.22-py3-none-any.whl |
| tqdm 4.70.1 | c293e525e6fef9c20e8728fd4612df02a0aa31bb5fe91ecd93e123b1b7bffa73 | https://files.pythonhosted.org/packages/a7/03/921a3d3c75785aca9ebfbfcabfbc3a1be12e2ab5265deb026d55a5a3f83e/tqdm-4.70.1-py3-none-any.whl |
| pyzmq 27.2.0 | 2c218c6ab8bc447ba62054b581fd30209689d199c6ecb253f79615ca74a38e12 | https://files.pythonhosted.org/packages/02/8b/b83f7780dad22e0878e4c7bd9158ebd24ed12bc3d5e3a471cd0576f77ded/pyzmq-27.2.0-cp312-abi3-win_amd64.whl |
| numpy 2.5.3 | 71cad2b2a7451ab79d8f5e71b453485b6775963d5cf794179144a7463fe6e8ec | https://files.pythonhosted.org/packages/f3/ec/100f2b1794ede74a9b3d7ec6b9736927f56713414c1dfe19ab6c383494bf/numpy-2.5.3-cp313-cp313-win_amd64.whl |

PBS full中提取的notice虽来自另一个已固定full archive，H.5审批artifact绑定的是实际交付install_only资产，不能拿full archive SHA替换执行包SHA。两种来源的映射和PYTHON.json原文仍保留；PYTHON.json SHA为 `c2bd7a699f18cd48dbf701b55a1229dcecec3e2ac74b59fba350fe52d4153e98`。

### H.5 可由Franklin逐项合入的精确审批建议

此数组只有人工明确选定的67条。不是扫描所有MIT/文件名后自动批准，不包含新的METADATA批准，旧F.2的109条不变。Franklin应对新候选逐四键匹配、原文复核保留，不改hash迎合审批；其余pending仍保留。未形成可执行的复合资产/vendor义务门禁前，不得通过移走METADATA使复合资产意外seal。

<!-- ASTRA_LICENSE_BATCH_H_JSON_BEGIN -->
```json
[
  {
    "id": "astra-20261009-h-001",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "4eb1fb1705e2def898e81bcba19c3aac80620d27ba3569d6a6df7b4629d1b5c2",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-002",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "634300a669d49aeae65b12c6c48c924c51a4cdf3d1ff086dc3456dc8bcaa2104",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-003",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "86eeee87be2a43f3ff1f56496f451f69243926f025fedbb033666c304c4c161b",
    "spdx": "Apache-2.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-004",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "808e10c8a6ab8deb149ff9b3fb19f447a808094606d712a9ca57fead3552599d",
    "spdx": "LicenseRef-distlib-Python-Notices",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-005",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "cb5e8e7e5f4a3988e1063c142c60dc2df75605f4c46515e776e3aca6df976e14",
    "spdx": "Apache-2.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-006",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "1a9a4f0e3d479a27240ddd59a9137a66ab4a0f9dfdc8ca6188cc0bfd85187f04",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-007",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "492dedba85da5872f78e6091bcd1fea474d660d35acb4dee964b8aab3f007427",
    "spdx": "Apache-2.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-008",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "cad1ef5bd340d73e074ba614d26f7deaca5c7940c3d8c34852e65c4909686c48",
    "spdx": "BSD-2-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-009",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594",
    "spdx": "BSD-2-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-010",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "b70e7e9b742f1cc6f948b34c16aa39ffece94196364bc88ff0d2180f0028fac5",
    "spdx": "BSD-2-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-011",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "86da0f01aeae46348a3c3d465195dc1ceccde79f79e87769a64b8da04b2a4741",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-012",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "29e0fd62e929850e86eb28c3fdccf0cefdf4fa94879011cffb3d0d4bed6d4db6",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-013",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "1b22b049b5267d6dfc23a67bf4a84d8ec04b9fdfb1a51d360e42b4342c8b4154",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-014",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "09e8a9bcec8067104652c168685ab0931e7868f9c8284b66f5ae6edae5f1130b",
    "spdx": "Apache-2.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-015",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "f388fd38cad13112c1dc0f669bbe80e7f84541edbafb72f3030d2ca7642c3c9d",
    "spdx": "ISC",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-016",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "deed7c17a4318158190a3ea239cc879a5a50271cebb98ae7025f48fbe58dca15",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-017",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "b80816b0d530b8accb4c2211783790984a6e3b61922c2b5ee92f3372ab2742fe",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-018",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "33be7b7e8fa4fd19b1760e1a8ed8a668bdab852c91b692dd41424bcb725a9fca",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-019",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "130e3a64d5fdd5d096a752694634a7d9df284469de86e5732100268041e3d686",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-020",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "0d1e4405f6273f091732764ed89b57066be63ce64869be6c71ea337dc4f2f9b5",
    "spdx": "TCL",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-021",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "bd5628cc76fb0ebf9c657d1dd4d1a240a1a7b216c31663e7bbf1131c0b70a910",
    "spdx": "bzip2-1.0.6",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-022",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "8a9cfe4b5924f4b25881aa0c9f5e4561c5f31065d0c4a13cdcdbcf917edf39aa",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-023",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "d9932ccdd42eccf6cdded7bcb35b088e64cfc7c24d355af2cc0d02edb6b637d3",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-024",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "9afb8970cd29fc1031fa647278e4bef613399e2e3468a1e3a397f4d158c6101c",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-025",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "d87d218dd908b3243ec4cbc72af400e5b7437513ea9d9229291d0812b8464fec",
    "spdx": "0BSD",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-026",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "cbccaa3efe07a9a602751375085be572d4410a250b996716fbe8c5255c7ec6f2",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-027",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "cec808cd2163fccdc8de4a91d526490777afbaeea060e1168c40a804694b7444",
    "spdx": "MIT-open-group",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-028",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "29a9539190e6de1af5fd06a9139c7103137cd1f9290b08c7b11bce89c01c14d2",
    "spdx": "LicenseRef-PBS-libxcb-Permission",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-029",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "f094277cd46e1f6e4d87916cc4b51e22f613d45eb81f48231c3cb7caf8fc8a6a",
    "spdx": "BSD-2-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-030",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "4f571cad3ea6c888bf0a7092e5b215dddb3142e9e3f1857fd5fac6cf13d345d7",
    "spdx": "LicenseRef-PBS-ncurses-Permission",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-031",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "d8eb9aba7ef6b5ed06cb3ec19a7242316af2e5933c638eb67fb781c13884e01d",
    "spdx": "LicenseRef-SQLite-Public-Domain",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-032",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "41613eabfc08921a7da9c4bfd7f3ce5d5406f55214b253d89f392ed86eebeb8f",
    "spdx": "TCL",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-033",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "365e36720db366054863235aea5d6f440142ab968834bfaf81fa9d187c99b9b8",
    "spdx": "Zlib",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-034",
    "component": "cffi",
    "version": "2.1.1",
    "artifactSha256": "1aa5645c30469b09530c4ebca77ebf8f17618293c58f8549cb1a543a50236e7d",
    "licenseSha256": "5ba24ddc57067f9249add644c3afc41a5d6dc37e23433ef759d95df370b0af63",
    "spdx": "MIT-0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-035",
    "component": "charset-normalizer",
    "version": "3.5.2",
    "artifactSha256": "78456a747de8dc58360ffa581f30a002baf5aa28cb262536545e91f113ed7639",
    "licenseSha256": "18577485d3704f1a479ded8e573c0976cfed315fd2fd17983fa988da4c2f70d1",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-036",
    "component": "pandas",
    "version": "3.0.6",
    "artifactSha256": "f3ce8a6968045481e91a3990e797e348ce13db45ee164a7095bbc824e26c09dd",
    "licenseSha256": "9850f6b5bdef7346503065807b878deb8058b976c5c329f4c4d23bf4796ce9ae",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-037",
    "component": "wcwidth",
    "version": "0.9.2",
    "artifactSha256": "2a9746de704242bd4fdaabb31dd46b82f694a56a8d21081ad89b679a89da9fec",
    "licenseSha256": "dff08668b8cfca00ec90011eb318e450c3719fcd40893bf375781a6beef7143a",
    "spdx": "MIT AND LicenseRef-Markus-Kuhn-Permission",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-038",
    "component": "fake-useragent",
    "version": "1.5.1",
    "artifactSha256": "57415096557c8a4e23b62a375c21c55af5fd4ba30549227f562d2c4f5b60e3b3",
    "licenseSha256": "aaf1d49d3b941a098bde959939cbe357b589cd96acd4b05acc121cb8565bf009",
    "spdx": "Apache-2.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-039",
    "component": "fake-useragent",
    "version": "1.5.1",
    "artifactSha256": "57415096557c8a4e23b62a375c21c55af5fd4ba30549227f562d2c4f5b60e3b3",
    "licenseSha256": "fd9b6273f22b7c29dbc5160b800f8824b74cf048f89e39a11b5c23c10f46d692",
    "spdx": "Apache-2.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-040",
    "component": "ipykernel",
    "version": "7.4.0",
    "artifactSha256": "a6757f790ddc5a6006b813d82da1a9dbb65b3a00f2b6607df776418c6566ec1c",
    "licenseSha256": "36ec29c871f7a382cde301cba47698191cf327c3f95ff5c240065e95dde80bfd",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-041",
    "component": "ipython",
    "version": "9.17.1",
    "artifactSha256": "6d1645743cfd1a07eb695d85aa2b5fa66721f8cbae9431d4049f7084bbf06509",
    "licenseSha256": "8387aac32433e5b121c355aa9e6ce2b9a399da7edd59ab94b19d4f5326b1ced0",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-042",
    "component": "ipython",
    "version": "9.17.1",
    "artifactSha256": "6d1645743cfd1a07eb695d85aa2b5fa66721f8cbae9431d4049f7084bbf06509",
    "licenseSha256": "e0e390748ed440ab893ca1f135a88a920aaf5409dbb90a5b427c75c5e51268fb",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-043",
    "component": "psutil",
    "version": "7.2.2",
    "artifactSha256": "eb7e81434c8d223ec4a219b5fc1c47d0417b12be7ea866e24fb5ad6e84b3d988",
    "licenseSha256": "c7adc4d5d1337a548b967421f1fbe258b93033a0417708fd6f4e38f8ecbceb80",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-044",
    "component": "tornado",
    "version": "6.5.10",
    "artifactSha256": "37ae8f150cecfdbf747fc4e12f5e9a97ecd8cf1d4cdb3f119e2de84b11196918",
    "licenseSha256": "3ddf9be5c28fe27dad143a5dc76eea25222ad1dd68934a047064e56ed2fa40c5",
    "spdx": "Apache-2.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-045",
    "component": "tzdata",
    "version": "2026.5",
    "artifactSha256": "b683bd1b6659ddcd810ff02ad09ba821d4bf1065072805063eb35c49617905ac",
    "licenseSha256": "df58f69ea88683035d720b5375bcef0cf5aeaa98a1d098d572e0992c378deb46",
    "spdx": "Apache-2.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-046",
    "component": "tzdata",
    "version": "2026.5",
    "artifactSha256": "b683bd1b6659ddcd810ff02ad09ba821d4bf1065072805063eb35c49617905ac",
    "licenseSha256": "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4",
    "spdx": "Apache-2.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-047",
    "component": "certifi",
    "version": "2026.7.22",
    "artifactSha256": "62f22742b58a1a33014a2b6b706588a8d7e2a88ae7bd1a6ebe8c992928483775",
    "licenseSha256": "e93716da6b9c0d5a4a1df60fe695b370f0695603d21f6f83f053e42cfc10caf7",
    "spdx": "MPL-2.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-048",
    "component": "tqdm",
    "version": "4.70.1",
    "artifactSha256": "c293e525e6fef9c20e8728fd4612df02a0aa31bb5fe91ecd93e123b1b7bffa73",
    "licenseSha256": "fcff87c3a47ce8028a8512aa182d4fcf0ad1c90544ee75cf9b343684cac194de",
    "spdx": "MPL-2.0 AND MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-049",
    "component": "pyzmq",
    "version": "27.2.0",
    "artifactSha256": "2c218c6ab8bc447ba62054b581fd30209689d199c6ecb253f79615ca74a38e12",
    "licenseSha256": "947ffe0146e8b3c23a759ddff8eccb8b0d2b201ccbc0a5750db4ac3cfc034e2a",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-050",
    "component": "pyzmq",
    "version": "27.2.0",
    "artifactSha256": "2c218c6ab8bc447ba62054b581fd30209689d199c6ecb253f79615ca74a38e12",
    "licenseSha256": "508a76d186356c0dd807a670ef510964f8724557024796a2c426c6c0e19ab683",
    "spdx": "ISC",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-051",
    "component": "pyzmq",
    "version": "27.2.0",
    "artifactSha256": "2c218c6ab8bc447ba62054b581fd30209689d199c6ecb253f79615ca74a38e12",
    "licenseSha256": "3ddf9be5c28fe27dad143a5dc76eea25222ad1dd68934a047064e56ed2fa40c5",
    "spdx": "Apache-2.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-052",
    "component": "numpy",
    "version": "2.5.3",
    "artifactSha256": "71cad2b2a7451ab79d8f5e71b453485b6775963d5cf794179144a7463fe6e8ec",
    "licenseSha256": "d544761558b510866c21f7e8a2d5716fca76e0b98117e3b6b86314db7244d150",
    "spdx": "Zlib",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-053",
    "component": "numpy",
    "version": "2.5.3",
    "artifactSha256": "71cad2b2a7451ab79d8f5e71b453485b6775963d5cf794179144a7463fe6e8ec",
    "licenseSha256": "aea41976c720f91bd19725c16916a1ace40eb1ea42620d340e587a5de4bbcea0",
    "spdx": "0BSD",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-054",
    "component": "numpy",
    "version": "2.5.3",
    "artifactSha256": "71cad2b2a7451ab79d8f5e71b453485b6775963d5cf794179144a7463fe6e8ec",
    "licenseSha256": "d208152e2777ffd0126eacc1bd21c0320d69e4e6b622d21a2a12a47e8ef73763",
    "spdx": "BSD-3-Clause AND CC0-1.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-055",
    "component": "numpy",
    "version": "2.5.3",
    "artifactSha256": "71cad2b2a7451ab79d8f5e71b453485b6775963d5cf794179144a7463fe6e8ec",
    "licenseSha256": "b0fd592d4ead563148e3977e7b589169d46a5ef2ff133c755a81af880a3fc919",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-056",
    "component": "numpy",
    "version": "2.5.3",
    "artifactSha256": "71cad2b2a7451ab79d8f5e71b453485b6775963d5cf794179144a7463fe6e8ec",
    "licenseSha256": "a732977853530066790c42817087f4829b518dd98d340c916acbfd227e39d3cb",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-057",
    "component": "numpy",
    "version": "2.5.3",
    "artifactSha256": "71cad2b2a7451ab79d8f5e71b453485b6775963d5cf794179144a7463fe6e8ec",
    "licenseSha256": "585483905b13d4b42f800c55ba99e89d6e2e33ccd5f503e201c07531d148ff41",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-058",
    "component": "numpy",
    "version": "2.5.3",
    "artifactSha256": "71cad2b2a7451ab79d8f5e71b453485b6775963d5cf794179144a7463fe6e8ec",
    "licenseSha256": "8db000e158c162e7249787852d8c69764706502ccee725c06641b31c1e95c8af",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-059",
    "component": "numpy",
    "version": "2.5.3",
    "artifactSha256": "71cad2b2a7451ab79d8f5e71b453485b6775963d5cf794179144a7463fe6e8ec",
    "licenseSha256": "19060ef465e1797d682ee0fc3081bd25ab1395e995e43d25c9d13c95d9a3cd6b",
    "spdx": "BSD-3-Clause-Open-MPI",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-060",
    "component": "numpy",
    "version": "2.5.3",
    "artifactSha256": "71cad2b2a7451ab79d8f5e71b453485b6775963d5cf794179144a7463fe6e8ec",
    "licenseSha256": "d78dbb208b80d92b4d333e41a4baae50d12444f46e53199fa7726a91de6e2da7",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-061",
    "component": "numpy",
    "version": "2.5.3",
    "artifactSha256": "71cad2b2a7451ab79d8f5e71b453485b6775963d5cf794179144a7463fe6e8ec",
    "licenseSha256": "b4bc2f4fa1c95778f1ed3dd8f14706bece399475b978f9f34b5d3cd72521b48a",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-062",
    "component": "numpy",
    "version": "2.5.3",
    "artifactSha256": "71cad2b2a7451ab79d8f5e71b453485b6775963d5cf794179144a7463fe6e8ec",
    "licenseSha256": "cf5619f25b112d5ce7c896efffc8e610bcb345dfadcc19f2c1460aa48fff2c9e",
    "spdx": "BSD-3-Clause AND MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-063",
    "component": "numpy",
    "version": "2.5.3",
    "artifactSha256": "71cad2b2a7451ab79d8f5e71b453485b6775963d5cf794179144a7463fe6e8ec",
    "licenseSha256": "92c10699884321f1c2947fe2a70ab23b0fbf1507f756d89dd08f38c61fc3d4fa",
    "spdx": "BSD-3-Clause AND MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-064",
    "component": "numpy",
    "version": "2.5.3",
    "artifactSha256": "71cad2b2a7451ab79d8f5e71b453485b6775963d5cf794179144a7463fe6e8ec",
    "licenseSha256": "41190663b77bee5302386495a07b7eabfbfa571aa0ae2f11da6764162062fc4f",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-065",
    "component": "numpy",
    "version": "2.5.3",
    "artifactSha256": "71cad2b2a7451ab79d8f5e71b453485b6775963d5cf794179144a7463fe6e8ec",
    "licenseSha256": "322ac46d870c8aeead6c53adcccc839296fb3c8e456eae155081297daf7f8013",
    "spdx": "BSD-3-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-066",
    "component": "numpy",
    "version": "2.5.3",
    "artifactSha256": "71cad2b2a7451ab79d8f5e71b453485b6775963d5cf794179144a7463fe6e8ec",
    "licenseSha256": "28cad82ce1379dc529df30da78ec012d7d0d1d576b03ddcb93388aee53659f59",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  },
  {
    "id": "astra-20261009-h-067",
    "component": "numpy",
    "version": "2.5.3",
    "artifactSha256": "71cad2b2a7451ab79d8f5e71b453485b6775963d5cf794179144a7463fe6e8ec",
    "licenseSha256": "454ec7350e478e037061850b67395753b425b1cb0a34bbc26290b020bf89d763",
    "spdx": "CC0-1.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-h-20261009"
  }
]
```
<!-- ASTRA_LICENSE_BATCH_H_JSON_END -->

### H.6 METADATA角色：修正无依据门禁，不抹掉实质条款

对下列10个确切METADATA，所含License/Classifier/License-File或文档指向是包元数据/许可引用；并非额外、独立的一份授权文本。保留整个原文件、SHA、完整Requires-Dist/markers/extras及dependencyAudit绑定。可将其role显式记为 provenance-and-license-reference，而不是要求再取得一份不存在的独立“许可批准”。**本节是角色结论，不是approved许可数组，不授权按所有METADATA文件名批量归类**。实际license/notices及资产级未满足义务不得随之删掉；例如cffi vendor、debugpy vendored代码、pyzmq对应源仍须独立闭合。普通文档“项目不支持修改CA”的支持政策，不应自动升级为对MPL修改权的另一个禁止授权。

```json
[
  {
    "component": "certifi",
    "version": "2026.7.22",
    "artifactSha256": "62f22742b58a1a33014a2b6b706588a8d7e2a88ae7bd1a6ebe8c992928483775",
    "metadataSha256": "ef5af1638fbb23676ac3c5777dfcfc2cd9c348fe4172ed5ba3d277655b248090",
    "role": "provenance-and-license-reference",
    "decision": "not-an-independent-license-grant",
    "path": "providers/akshare/site/certifi-2026.7.22.dist-info/METADATA"
  },
  {
    "component": "cffi",
    "version": "2.1.1",
    "artifactSha256": "1aa5645c30469b09530c4ebca77ebf8f17618293c58f8549cb1a543a50236e7d",
    "metadataSha256": "67b6a7595df7ede2195016a05d285faa7d362a8f57c238984edb8bb674b5770d",
    "role": "provenance-and-license-reference",
    "decision": "not-an-independent-license-grant",
    "path": "providers/akshare/site/cffi-2.1.1.dist-info/METADATA"
  },
  {
    "component": "tqdm",
    "version": "4.70.1",
    "artifactSha256": "c293e525e6fef9c20e8728fd4612df02a0aa31bb5fe91ecd93e123b1b7bffa73",
    "metadataSha256": "a5da70b966afea3a759716041bad7187f2ece02c22348cf9e7c0a512bbf15f57",
    "role": "provenance-and-license-reference",
    "decision": "not-an-independent-license-grant",
    "path": "providers/akshare/site/tqdm-4.70.1.dist-info/METADATA"
  },
  {
    "component": "tzdata",
    "version": "2026.5",
    "artifactSha256": "b683bd1b6659ddcd810ff02ad09ba821d4bf1065072805063eb35c49617905ac",
    "metadataSha256": "e0780e8b6dc8882ce87e871a9d4589d59cb05a0c2d64f58b1ba62cde1ee91f6a",
    "role": "provenance-and-license-reference",
    "decision": "not-an-independent-license-grant",
    "path": "providers/akshare/site/tzdata-2026.5.dist-info/METADATA"
  },
  {
    "component": "debugpy",
    "version": "1.8.22",
    "artifactSha256": "f49b1d6cecf326b63c06d7f517e4a6642777f758c58cb799e7bc5a6dd74721c2",
    "metadataSha256": "dad0ffa81756bcf79a9ef2961c532e411545c608159378446f087e6a2f2ea41a",
    "role": "provenance-and-license-reference",
    "decision": "not-an-independent-license-grant",
    "path": "providers/pywencai/site/debugpy-1.8.22.dist-info/METADATA"
  },
  {
    "component": "fake-useragent",
    "version": "1.5.1",
    "artifactSha256": "57415096557c8a4e23b62a375c21c55af5fd4ba30549227f562d2c4f5b60e3b3",
    "metadataSha256": "a838f4b3cc6736d2e8470af28dcbfb89f171c2b4e2b2444570738a242292b524",
    "role": "provenance-and-license-reference",
    "decision": "not-an-independent-license-grant",
    "path": "providers/pywencai/site/fake_useragent-1.5.1.dist-info/METADATA"
  },
  {
    "component": "ipython",
    "version": "9.17.1",
    "artifactSha256": "6d1645743cfd1a07eb695d85aa2b5fa66721f8cbae9431d4049f7084bbf06509",
    "metadataSha256": "e78cb2a71fde4012b32de9b2db8d3c50ba618a1bb1975acc1bf107453365a1be",
    "role": "provenance-and-license-reference",
    "decision": "not-an-independent-license-grant",
    "path": "providers/pywencai/site/ipython-9.17.1.dist-info/METADATA"
  },
  {
    "component": "psutil",
    "version": "7.2.2",
    "artifactSha256": "eb7e81434c8d223ec4a219b5fc1c47d0417b12be7ea866e24fb5ad6e84b3d988",
    "metadataSha256": "a263a40220d921d9cb963fc636d34f817aa2eb72c2696e3e3465d088cdb1976b",
    "role": "provenance-and-license-reference",
    "decision": "not-an-independent-license-grant",
    "path": "providers/pywencai/site/psutil-7.2.2.dist-info/METADATA"
  },
  {
    "component": "pyzmq",
    "version": "27.2.0",
    "artifactSha256": "2c218c6ab8bc447ba62054b581fd30209689d199c6ecb253f79615ca74a38e12",
    "metadataSha256": "efca840a7cf3173e6ffce4c77e50b5b449a6c44388abc272bc3e82bb27e97043",
    "role": "provenance-and-license-reference",
    "decision": "not-an-independent-license-grant",
    "path": "providers/pywencai/site/pyzmq-27.2.0.dist-info/METADATA"
  },
  {
    "component": "tornado",
    "version": "6.5.10",
    "artifactSha256": "37ae8f150cecfdbf747fc4e12f5e9a97ecd8cf1d4cdb3f119e2de84b11196918",
    "metadataSha256": "03bcc8559e97f43334405cdeee921ce39dfde8e09397c48c7f41ff044a48d839",
    "role": "provenance-and-license-reference",
    "decision": "not-an-independent-license-grant",
    "path": "providers/pywencai/site/tornado-6.5.10.dist-info/METADATA"
  }
]
```

其他已确认特殊类型：

- charset-normalizer正文重复完整MIT以及作者说明，应保留并关联其实际MIT原文；关于别的项目Chardet许可证的评论，不是本包引入LGPL/0BSD的证据。
- ipykernel正文含共同版权说明，属于署名/版权材料而非新的使用禁令；pandas头部含完整BSD授权，不能只因文件名METADATA就丢弃实质许可文本。本批未把这些META简单批为provenance。
- mootdx和tdxpy明确的“不得用于任何商业目的”仍在METADATA正文，与顶层MIT之间的解释问题保持pending，不能靠删METADATA、只看classifier或派生版本号解除。
- dependency metadata不等于法律授权缺口；.data文件映射、hash/完整安装集合不是许可证条款，也不能以“许可已过”为由忽略真实交付完整性。

### H.7 剩余真实补件与下批边界

本批未批准下列复合/歧义项，也不把它们的状态传染到上面已明确的67项：

- NumPy顶层文本真实列出OpenBLAS/LAPACK与 **GPL-3.0-or-later WITH GCC-exception-3.1**，不能简写成BSD，也不能仅看到GPL就断言整个应用须换GPL。最小补件是对这一精确wheel的producer/构建来源与Eligible Compilation Process证据定位，保留实际完整GPL+Exception及对应组件归属；本轮没有据空白猜测不合规，更未把16个子notice继续挂起。
- pyzmq libzmq为MPL原生组合，需要实际对应版本源码取得位置/交付路径与可读许可，不能把Python源码的MPL交付结论直接移用；BSD主binding、ISC libsodium、Apache Tornado的文本已分别关闭。
- xlrd原文不仅BSD3，还含David Giffin广告确认和任意再分发必须保留的acknowledgment。最小动作是把该确认句实际加入随包可读notice/相关宣传材料，并评估与本项目AGPL组合方式，不能仅凭METADATA“BSD”自动批；这不是所有BSD库的一般要求。
- CRT发行资格、Tix附属原文、BDB实际适用性、lxml/libiconv源码/重链接路径及mootdx/tdxpy范围沿此前具体补件推进。本批没有把这些项改为approved。
- mini-racer/V8/ICU、curl_cffi底层curl/TLS等、debugpy vendor及PBS其余复合notice按实际绑定继续逐项审。顶层宽松许可不自动覆盖缺失vendor材料，但未核定vendor问题也不能伪装成普通METADATA“无许可证”。

本轮仅新增本节文档。没有修改policy、产品源文件、原始许可、测试、安装器、Git引用；没有联网行情/账户/生产DB操作。许可建议可独立合入候选流程，仍不代表complete release manifest或正式整包可发布。


<a id="astra-license-supplements-i-20261009"></a>
## I. 精确原生资产对应源、GCC例外与可直接交付的notice补件

日期：2026-10-09。Reviewer：Astra / engineering redistribution review。此节不追改H批次67条冻结JSON，也不修改Franklin的policy。本轮仅公开官方来源读取、内存下载/归档成员读取及候选指定文件读取；没有运行下载代码、provider网络、账户、数据库或安装操作。以下把“授权条款已明确”“来源已定位”“实际已进最终payload”分开记录。

### I.1 NumPy exact Windows wheel：GCC Runtime Exception 路径已得到具体证据支持

目标：
`numpy-2.5.3-cp313-cp313-win_amd64.whl`，12,560,965 bytes，SHA256
`71cad2b2a7451ab79d8f5e71b453485b6775963d5cf794179144a7463fe6e8ec`。
本轮官方[PyPI版本索引](https://pypi.org/pypi/numpy/2.5.3/json)返回的文件URL/大小/摘要与此前固定候选一致。

**实际来源链，不是按相同版本号猜测：**

1. [该wheel PyPI provenance](https://pypi.org/integrity/numpy/2.5.3/numpy-2.5.3-cp313-cp313-win_amd64.whl/provenance)响应SHA256 `af23f9c286a558fd069efdf7dea014379644ed14f3a8de14dae7a5cf83e93843`；其publish statement的subject为上述精确文件及SHA。publisher为 `numpy/numpy-release` / `wheels.yml` / environment `pypi`。
2. 证书字段指向producer提交 `a1cc2f4a9705f4171d480263fde93fa01ba816d6`、[run34041209038/attempt1](https://github.com/numpy/numpy-release/actions/runs/34041209038/attempts/1)。本轮独立GitHub run API读取确认相同head SHA、completed/success。此处是官方响应及声明内容核对，**未声称已执行完整Sigstore签名、透明日志和证书链密码学验证，也未声称逐job日志已核完**。
3. 已读固定producer [wheels.yml](https://raw.githubusercontent.com/numpy/numpy-release/a1cc2f4a9705f4171d480263fde93fa01ba816d6/.github/workflows/wheels.yml)，SHA `c1f5af4e8656c5da96adbaa56564647ad324da371c7b57e6268d201f338bf8af`；以及 [cibuildwheel.toml](https://raw.githubusercontent.com/numpy/numpy-release/a1cc2f4a9705f4171d480263fde93fa01ba816d6/cibuildwheel.toml)，SHA `f810e084df8267177e374b58b770ccd69f85ab136240efe7d5f68cc48a39f37a`。该producer源码ref用maintenance branch，因此不能把release仓库SHA冒称NumPy源码SHA；下面实际DLL的逐字节比较补上二进制归属。
4. 候选实际 `providers/akshare/site/numpy/__config__.py` SHA `04e8f8a22df4a8849a6f45f6b1efea14f986524bbfee3fccd69c3744d237432d`，静态原文记录MSVC19.44.35228及 `scipy-openblas 0.3.34.106.0`。没有执行或import该文件。
5. NumPy [v2.5.3 ci_requirements](https://raw.githubusercontent.com/numpy/numpy/v2.5.3/requirements/ci_requirements.txt) SHA `2beb0be80b3281447f2f7edc3b38e5e3c8e8087059f509dac4e09cd9b466c8ac`明确pin `scipy-openblas64==0.3.34.106.0`；[before_build](https://raw.githubusercontent.com/numpy/numpy/v2.5.3/tools/wheels/cibw_before_build.sh) SHA `80d0c477bd73a9c6ec47489c4f74a4d3917ddb6068b213846e57ecd5a3abc28a`复制其DLL；[repair_windows](https://raw.githubusercontent.com/numpy/numpy/v2.5.3/tools/wheels/repair_windows.sh) SHA `544ecd335d0c2601d20502fa4dac5bea4a36b77b7d05486cc11aac3e7c483086`调用delvewheel。Tag源码作为解释路径，不用它取代实际字节比对。

**关键原生字节闭环：**

实际内存下载并校验 [scipy_openblas64-0.3.34.106.0-py3-none-win_amd64.whl](https://files.pythonhosted.org/packages/0c/17/ffc91653b566011d7c790116759266ec0a588fdd0e2f839d0343f3f79e0e/scipy_openblas64-0.3.34.106.0-py3-none-win_amd64.whl)：
7,027,050 bytes，SHA `ea34bf76b8427ac2eca7a99334cbd8937a040303fa8364f9ed8e667d7c8e2c7d`，与官方PyPI索引一致。

| 位置 | bytes | SHA256 |
|---|---:|---|
| 上游wheel `scipy_openblas64/lib/libscipy_openblas64_.dll` | 20589056 | ed4f167a5330424524f45258e7ca2c8d7f03c0cba1f30ee4985553ac1f88ecf8 |
| 实际候选 `providers/akshare/site/numpy.libs/libscipy_openblas64_-ed4f167a5330424524f45258e7ca2c8d.dll` | 20589056 | ed4f167a5330424524f45258e7ca2c8d7f03c0cba1f30ee4985553ac1f88ecf8 |

这里不仅版本相同，而且DLL内容SHA完全相同；不同文件名不等于内容被改写。上游wheel许可证成员46,462 bytes / SHA `7317b3a9eb806cc83a0cc6b1c7c2fbe6018eed556daa9996e6e3a727a2a5bfbe`本轮仅取到成员哈希，不冒称已再次全文审查；当前NumPy随包完整LICENSE已在H轮读取，SHA `a804dff0ead9fadc5293456410bcbfc32bf024be9c4513459663fb7b442d2341`，其中实际包含OpenBLAS/LAPACK、GPL全文及GCC Runtime Library Exception3.1。

该OpenBLAS wheel [PyPI provenance](https://pypi.org/integrity/scipy-openblas64/0.3.34.106.0/scipy_openblas64-0.3.34.106.0-py3-none-win_amd64.whl/provenance)响应SHA `dce90e54776caffadc3a6b5a35fedc81958be41edd15c07d2c5a30497d6bf5ed`，subject匹配上述wheel SHA；producer是 `MacPython/openblas-libs`，提交 `78fc0eaf6de71d92fd98f74f7e5bfa356a2f83e3`，[run31317225529](https://github.com/MacPython/openblas-libs/actions/runs/31317225529)已实际API核对同SHA/completed/success。

已实际读的固定构建文件：

| 原件 | SHA256 | 已确认内容 |
|---|---|---|
| [.github/workflows/windows.yml](https://raw.githubusercontent.com/MacPython/openblas-libs/78fc0eaf6de71d92fd98f74f7e5bfa356a2f83e3/.github/workflows/windows.yml) | 58b3d71461aef220a8f653336659dd361929a12122ee4643a973926418bbbe0c | Rtools4.0、x64 UCRT64、static-libgcc，实际调用以下脚本 |
| [tools/build_steps_windows.sh](https://raw.githubusercontent.com/MacPython/openblas-libs/78fc0eaf6de71d92fd98f74f7e5bfa356a2f83e3/tools/build_steps_windows.sh) | 4a6220eaf499d5b401c0d6bd9d881b7566cbf81c3d2903e247daff6db97f454f | 明确gcc/make编译源文件，保留Fortran编译flags；不是未知私有GCC IR优化流程 |
| [openblas_commit.txt](https://raw.githubusercontent.com/MacPython/openblas-libs/78fc0eaf6de71d92fd98f74f7e5bfa356a2f83e3/openblas_commit.txt) | a5377571f2180894f34f420543843936db89ae666b41b4fc23d2d4dd8fd42081 | 原文 `v0.3.34-106-g446c436e` |
| [patches-windows/openblas-make-libs.patch](https://raw.githubusercontent.com/MacPython/openblas-libs/78fc0eaf6de71d92fd98f74f7e5bfa356a2f83e3/patches-windows/openblas-make-libs.patch) | d77d006b8f58267c2b416738fbd31e1a9e4ff629e82cccf8ca8565de182ecc17 | 链接map/GC-sections及dlltool导出库处理，非闭源GCC IR插件 |

**工程审查结论：该精确DLL的正常GCC编译与例外适用路径已有充分具体主源支持，I.1关闭“仅因GPL字样而悬置的GCC运行库组合授权疑问”。** [GCC官方例外原文](https://gcc.gnu.org/onlinedocs/libstdc++/manual/license.html)允许符合条件的独立模块与运行库Target Code组合按相应模块条件分发；不能据此要求本应用仅因为这个DLL而改为GPL，也不能扩大为所有GCC代码、单独运行库或其他平台的统一豁免。这是基于实际producer/字节匹配的工程判断，不是法律保证；未独立重建二进制。

**另一个实际、不同的义务不能被掩盖：**本轮候选 `numpy.libs/msvcp140-a4c2229bdc2a2a630acdc095b4d86008.dll` 为575,056 bytes，SHA `a4c2229bdc2a2a630acdc095b4d86008e5c3e3bc7773174354f3da4f5beb9cde`。这是独立Microsoft CRT交付件，不在GCC例外里。Franklin应将其明确加入已有CRT issuer/REDIST/license证据映射；不是重新发明一项禁止NumPy的规则。NumPy顶层license审批若会让此未覆盖原生件隐身，则先补资产义务记录再合，不用伪装成GPL问题。

### I.2 pyzmq27.2.0：精确producer、libzmq源码及交付补件已定位

目标wheel `pyzmq-27.2.0-cp312-abi3-win_amd64.whl`，628,633 bytes，SHA
`2c218c6ab8bc447ba62054b581fd30209689d199c6ecb253f79615ca74a38e12`。

[PyPI provenance](https://pypi.org/integrity/pyzmq/27.2.0/pyzmq-27.2.0-cp312-abi3-win_amd64.whl/provenance)原响应SHA `11b4dadf9976393342ed889eb62435eff12d9504efa6f327e1fb47a384e51b9a`；subject为上述wheel/SHA；publisher为zeromq/pyzmq、wheels.yml、release环境；producer提交 `c6bc8f20d47f9e779d17137201939a31fcd457cc`，[run32404236887/attempt1](https://github.com/zeromq/pyzmq/actions/runs/32404236887/attempts/1)。实际run API同SHA、completed/success；不是完整密码学验签声明。

| 已读固定原件 | SHA256 | 内容 |
|---|---|---|
| [pyproject.toml](https://raw.githubusercontent.com/zeromq/pyzmq/c6bc8f20d47f9e779d17137201939a31fcd457cc/pyproject.toml) | 12a797e0ad91c869986653e0e10e2fbcc337da6f5407fea75fcd4ffbeab92e83 | Windows明确ZMQ_PREFIX=bundled，cp312 abi3构建；静态MSVCP配置也须纳入既有CRT审查 |
| [CMakeLists.txt](https://raw.githubusercontent.com/zeromq/pyzmq/c6bc8f20d47f9e779d17137201939a31fcd457cc/CMakeLists.txt) | bdfd02dea8ef09d1f3a8d980ecffc7ed58c656c8b2b61398d3cae18c440bd3d1 | libzmq4.3.5；官方release tar地址；静态link；复制原LICENSE；Windows使用select配置 |
| [buildutils/bundle.py](https://raw.githubusercontent.com/zeromq/pyzmq/c6bc8f20d47f9e779d17137201939a31fcd457cc/buildutils/bundle.py) | 4c53412f6e559fe540139b29b97bf20806c2f2fb669d62c235e2f87c10be9fc2 | bundled_version4.3.5，license来源与CMake一致 |

实际下载到内存并读取原成员的源码：
[zeromq-4.3.5.tar.gz](https://github.com/zeromq/libzmq/releases/download/v4.3.5/zeromq-4.3.5.tar.gz)，**2,530,237 bytes，SHA256 `6653ef5910f17954861fe72332e68b03ca6e4d9c7160eb3a8de5a5a913bfab43`**。来源为producer自己指向的官方release，归档895项；未执行、未提取到运行目录。归档LICENSE为16,725 bytes，SHA
`1f256ecad192880510e84ad60474eab7589218784b9a50bc7ceee34c2b91f1d5`，与候选pyzmq随包LICENSE.zeromq.txt逐哈希一致。

**具体闭合路线，不要求把整个应用改成MPL或提供应用重链接对象：**

1. Franklin把上述精确源归档作为只读分发补件加入 `licenses/sources/zeromq-4.3.5.tar.gz`，先核下载SHA再写候选inventory；原LICENSE仍原样保留。这是建议的新payload相对路径，本轮尚未创建，不能预填已存在。
2. 将固定producer CMake/pyproject与wheel归属记入provenance；本轮确认的是官方源码与构建链，未独立复现该wheel，因此不能把发布声明叫成reproducible build证明。
3. 在随包可读NOTICE加入下面说明。发布时保证所写相对源路径实际可访问；如果选择外部来源取得方案，必须有明确可用的对应版本URL/原notice及接收者权利说明，而不是仅列项目首页。推荐同包2.53MB源归档，减少上游链接长期可用性风险。
4. 这是MPL3.1/3.2的对应源码及告知路径。[Mozilla官方FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)并不要求所有静态链接软件整体改成MPL。保持未改源码及其许可/取得位置，不能把LGPL重链接对象要求不加区分地套给MPL。

待源归档、NOTICE、实际inventory全部进入下一候选，即可关闭此对应源交付缺口，不需要再寻求笼统“商业授权”。当前结论是 **source归属已定位、MPL履约方案明确，payload补件待落地**，不是仍然未知源版本。

以下NOTICE段落可使用，但须在实际源归档入包后启用：

```text
PyZMQ 27.2.0 includes libzmq (ZeroMQ) 4.3.5.
The libzmq source code is available under the Mozilla Public License 2.0.
A copy of the corresponding upstream source archive is provided at:
licenses/sources/zeromq-4.3.5.tar.gz

Source archive SHA-256:
6653ef5910f17954861fe72332e68b03ca6e4d9c7160eb3a8de5a5a913bfab43
Upstream source:
https://github.com/zeromq/libzmq/releases/download/v4.3.5/zeromq-4.3.5.tar.gz
License:
https://www.mozilla.org/MPL/2.0/

The original libzmq license notice is retained with PyZMQ.
The source-code rights granted by the MPL are not restricted by
the license terms applicable to other parts of this application.
```

另已由官方PyPI索引定位PyZMQ自身sdist（本轮未下载）：
[pyzmq-27.2.0.tar.gz](https://files.pythonhosted.org/packages/e7/8d/5b3d5631c2f4b4b8862f64cd0c9eb777b5710eeb5125b4be8dd0a200a4c0/pyzmq-27.2.0.tar.gz)，292,316 bytes，SHA `54d4259d1bfae24ecdb5ca79f7acc2eac6c286a02d6a0ae617797cb45f0726d3`。它可作为producer构建文件的归档便利材料，但不能代替libzmq对应源。

### I.3 xlrd2.0.2：必须实际保留的完整确认句及放置规则

精确wheel SHA `ea762c3d29f4cca48d82df517b6d89fbce4db3107f9d78713e48cd321d5c9aa9`。
已读原LICENSE SHA `b5a5dbce60265e305a815a6cb83ed07f24519d8ba644f2a307994488bced8815`。其第二部分同时要求在有关功能/使用的广告材料中出现确认句，以及任意形式再分发保留确认句。不能用泛称“包含第三方开源软件”替代以下原句：

```text
This product includes software developed by
David Giffin <david@giffin.org>.
```

可直接交给Franklin的完整可读NOTICE段落：

```text
Third-party acknowledgement: xlrd 2.0.2

This product includes software developed by
David Giffin <david@giffin.org>.

xlrd also contains work by Stephen John Machin / Lingfo Pty Ltd and
earlier work based on the Java version by Andrew Khan.
The complete, unmodified xlrd LICENSE accompanies this acknowledgement.
This acknowledgement does not replace that LICENSE or change its terms.
```

最小实现：候选增加一个可读 `licenses/third-party/runtime-NOTICES.txt` 条目并纳入file inventory SHA；原 `xlrd-2.0.2.dist-info/LICENSE` 一字不改继续保留。发行包的第三方许可入口或README指向该文件。今后宣传材料若提到受该条款涵盖的软件功能/使用，发布清单也保留完整确认句；仅在不可见缓存写入不算告知。

这能实际满足确认句/原文保留这一可执行部分；**不擅自宣称已解决所有AGPL组合兼容问题**。应保留xlrd自身条款，不把它整体重许可为本应用AGPL。是否构成单一受AGPL约束的派生组合须按真实分发结构评估，不能只因为有IPC就自动认定mere aggregation。若确需不同授权或替换，选择明确覆盖实际Excel读取功能的合法方案并评估格式兼容，不静默删现有依赖来过门禁。

### I.4 Tix附属原文：已实际取得，缺口不再是找不到许可

实际内存下载[固定8.4.3.6源包](https://github.com/python/cpython-source-deps/archive/tix-8.4.3.6.tar.gz)，1,836,451 bytes，SHA
`f7b21d115867a41ae5fd7c635a4c234d3ca25126c3661eb36028c6e25601f85e`，与此前pin严格一致；逐份读取了这三件原文：

| source成员 | bytes | SHA256 | 文本审查结论 |
|---|---:|---|---|
| `cpython-source-deps-tix-8.4.3.6/docs/license.html_lib` | 2022 | 9149f81c6efd1c3cef68742b67dc6f1b6211f32f425f3b6d24cf5279668cfd27 | 明确任意用途使用/复制/修改/分发许可；保留copyright、逐字条款、免责声明和政府使用段。 |
| `cpython-source-deps-tix-8.4.3.6/docs/license.tcltk` | 2107 | def74f610b8682dd12a772954ee8ad07d304cdf106abb6e030f71ee489419d1a | 明确任意用途使用/复制/修改/分发许可；保留copyright、逐字条款、免责声明和政府使用段。 |
| `cpython-source-deps-tix-8.4.3.6/license.terms` | 2828 | 91ff35309038fcfab853c8634b7b743a179c211d8ff3cb174b579c8af3c3072d | 明确任意用途使用/复制/修改/分发许可；保留copyright、逐字条款、免责声明和政府使用段。 |

三件文本不能互相代替：docs/license.tcltk明确仅覆盖Tcl/Tk，docs/license.html_lib仅覆盖HTML Library；license.terms才覆盖Tix并引用二者。原PBS `LICENSE.tix.txt` SHA `8cdff3addb9e9eb108c78e2cf5e05f26b216c098304945733bbec382b2eaef66`与源license.terms不是原字节同一文件（换行/尾空格表现不同），**不替换其hash、不规范化旧原文来伪造一致**。本轮对缓存原件逐行比较，非空差异为两行尾空格；双方版权/条款保留。

Franklin最小补件：从此固定归档安全读取三条白名单成员，原字节加入候选 `licenses/tix-8.4.3.6/` 对应文件；原PBS notice继续保留。以上三份文本的分发授权已可给明确肯定审查结论，不需再因“未知许可”永久挂起；只有 **实际保留/归档映射与inventory未完成** 暂不转成可seal审批。原CRT资格、BDB实际适用性、lxml对应源/重链接门禁不因Tix补件进展而被覆盖。

### I.5 本轮交接与证据边界

- 新增真实成果：NumPy精确OpenBLAS DLL字节归属与GCC构建路径、pyzmq固定producer到libzmq4.3.5源归档/hash、xlrd完整确认句及放置设计、Tix三个实际附属原文/hash。
- 不制造新门禁：GCC例外组合不是看到GPL就拒绝；MPL源码告知不是LGPL重链接要求；BSD/MIT metadata不是独立授权。也不消失实际问题：额外MSVCP、旧xlrd广告条件、源码/notice尚未进入payload仍明确记录。
- H数组不变；下一轮policy/source binding按新候选正常生成，不回填旧receipt，不假称新补件已落盘或三端已通过。
- 本轮直接消息工具向Franklin交接时两次返回 `thread not found`，即使read_thread仍可读该历史线程；因此不宣称本轮消息已送达。所有可执行材料完整写在本节，母线程可据此接续现有代理协作，不新建任务、不触发任何远程写入。

## J. H67 preparation implementation review (2026-10-09)

本节为源码只读独立审查，不是新增平台执行或最终分发放行。实际读得三文件SHA：

- scripts/prepare-private-python-runtime.py: `9caf8e877375e617c6bf1d30bf3c7f344aabab47e39fc0573ec7dba8a316d94a`
- tests/python/test_prepare_private_python_runtime.py: `63d6d7594516ecd48de5ef17d4f55785f2d74845f7997765d9d33f1acf1ebdf7`
- resources/python-runtime/preparation.policy.json: `c416526f0d8f1313d3c23a4e528d1e28a73210c8953f82f62f6617a9c86e9c5c`

逐字段对比确认：原109条审批记录未变，新增67条与H.5完全一致；10条metadataProvenance与H.6完全一致。实际materialize先核验安装后METADATA/闭包，再生成dependencyAudit，且逐条比较安装notice SHA后才分流元数据；未匹配条目仍进入licenseRequirements。未发现本增量制造可发布状态的P1。82/82仅为worker报告，本轮未执行测试。

### J.1 P2: reviewed metadata identity is unnecessarily scoped to one provider

位置：`scripts/prepare-private-python-runtime.py:572`（五维匹配）及`:1057`（传入实际完整安装路径）；测试`tests/python/test_prepare_private_python_runtime.py:1075`目前固定要求另一安装路径不匹配。

H.6原路径同时定位原件，但同一精确wheel与相同METADATA原字节已在旧候选中有以下5处重复使用。本轮对已缓存、实际哈希核验过的旧fragment记录逐项关联，确认component/version/artifactSha256/metadataSha256均与对应H.6记录一致：

| component | additional exact installed path | reuse H.6 identity |
|---|---|---|
| certifi 2026.7.22 | providers/mootdx/site/certifi-2026.7.22.dist-info/METADATA | certifi artifact/metadata SHA unchanged |
| tqdm 4.70.1 | providers/mootdx/site/tqdm-4.70.1.dist-info/METADATA | tqdm artifact/metadata SHA unchanged |
| tzdata 2026.5 | providers/mootdx/site/tzdata-2026.5.dist-info/METADATA | tzdata artifact/metadata SHA unchanged |
| certifi 2026.7.22 | providers/pywencai/site/certifi-2026.7.22.dist-info/METADATA | certifi artifact/metadata SHA unchanged |
| tzdata 2026.5 | providers/pywencai/site/tzdata-2026.5.dist-info/METADATA | tzdata artifact/metadata SHA unchanged |

最小修复建议交Franklin：复制对应H.6记录并仅替换上述5个path，保留全部精确资产/原文SHA与`not-an-independent-license-grant`决定；五维严格匹配可保持不动。此处明确同意这5条作为相同证据的附加使用路径，不是新增分发许可审批，不允许任意路径/其他wheel/hash通配。验收应覆盖5处命中及错误资产SHA、METADATA SHA、未知路径仍不命中。可继续候选准备，不需要以此阻断真实离线验证；不要让这5项继续冒充实质许可缺口。

### J.2 Seal boundary, not a new release approval

`seal:1699-1703`只核对metadata角色和布尔值，尚不重新读取dependencyAudit或安装树；但`:1713`无条件保留formal integration pending，因此现阶段不是可利用的发布放行漏洞。后续接正式assembler时必须复核实际audit SHA/内容、安装METADATA与inventory，不能把`installedMetadataVerified=true`当自证。复合组件的vendor/source/CRT义务不能由METADATA分流消除。

Mac12及原生host拒绝位于`:404-424`、`:990-993`。本轮检查的是源实现与测试断言，不宣称新的Mac实际运行通过。许可实际补件继续按I节处理：GCC例外适用性证据、libzmq对应源、xlrd可读确认句、Tix原字节notices，不因本批审批匹配成功而被代替。

## K. H.6 five-path fix: independent source acceptance (2026-10-09)

结论：J.1的保守漏项P2在本次精确源码范围关闭；不等于候选重新materialize、Mac原生闭包、正式bootstrap或发布批准。

本轮独立读取三文件与freeze原始字节，实际SHA：
- preparation.policy.json: `08e8821f69b0665a14e3c1b296b258981c0adef772fe865fde53a8e05f326e70`
- prepare-private-python-runtime.py: `76e1ae3fc3d9f7cef479927d85db7c4202dcf1acf1c7688e55b554aff974560d`
- test_prepare_private_python_runtime.py: `a5fe3a1e3ab28c44be84b5dea4013368fad9d6918410949421827f6a6f53e39b`
- `股票日线 prep-h6-source-freeze-1791510840.json`: `7d36c0e9e71bf4dbb04bbc78cba3108c85c66a5f00618c49e875ef0325d1529c`

与已审缓存逐字段对照：policy原176条licenseApprovals完全未变，原10条metadata角色保留，新增恰为J.1五条路径；各自component/version/artifactSha256/metadataSha256/role/decision与对应原件一致，policy其他键值未变。角色决定仍是not-an-independent-license-grant，不是泛批METADATA或新增许可授权。

脚本相对9caf版本仅增加子命令帮助中的operation-input参数声明，以及seal拒绝携带operation-input。原有预解析逻辑已支持提取该参数；旧prepare帮助缺项不能单独推出执行命令不接受参数。metadata_role、安装后原字节SHA验证、dependencyAudit生成和Mac原生前置拒绝逻辑未改变。测试源码覆盖五条路径、错误版本/资产SHA/metadataSHA/未知路径不命中，并新增子命令帮助断言。本轮未执行测试；83/83、wrong-host探针及help执行结果仅记录为freeze内实现者证据。

freeze中sourceSha256 `cac1e3c194d4ec62a79625d0cf21f91edd30125cd7298bbe68810ec0ccaee462`为回执声明；本轮未重新读取其余六个源文件，也不把这项当作独立checkout commit证明。回执明确sourceVerified=false、releaseEligible=false、nativeMacExecuted=false，以上边界保持。

CRT发行资格/对应清单及接收者条款、lxml对应源与充分重链接材料、BDB实际适用性、相关mootdx声明、I节实际notice/source补件进入payload等义务均未由本次修复豁免。允许继续隔离候选准备，不允许以此变更把整包seal改为通过。

<a id="astra-license-batch-l-20261009"></a>
## L. Current Windows candidate: exact-byte convergence and payload supplements (2026-10-09)

### L.1 Actual current input, not old-version approval reuse

本轮独立读取：
- root: `D:/RT-ResearchFlow-BuildCache/股票日线 prep-release17-nativefix-01`
- candidate-lock SHA256: `9c654a4199b4b01c029e4dd7ebda8aa676ccb0bd55a802487bd445b388fabc94`
- candidate-fragment SHA256: `24f7d959d1ba73b8d7a1faa075a9d979d3e2f85a11caf4c38e0738dc66f18bb0`
- 两份记录的sourceSha256: `1320bb9349a1c871cc7b1c6b679438df1b7f32b29815dc97fe28769b6aedfecd`
- policy: `08e8821f69b0665a14e3c1b296b258981c0adef772fe865fde53a8e05f326e70`

这是当前报告内来源绑定的核对，不是重新读取全部sourceSnapshot证明commit。363条licenseRequirements中313条有approvalId，逐条component/version/artifactSHA/licenseSHA/spdx/decision与已审policy精确匹配，覆盖全部176个不同approvalId。余50个usage/32个唯一(component,version,artifactSHA,licenseSHA)组合；metadataProvenance已15条。报告仍candidate且releaseEligible=false。

实际pandas为3.0.6，wheel SHA `f3ce8a6968045481e91a3990e797e348ce13db45ee164a7095bbc824e26c09dd`，LICENSE SHA `9850f6b5bdef7346503065807b878deb8058b976c5c329f4c4d23bf4796ce9ae`，匹配h-036而非旧3.0.3资产。实际urllib3为2.8.0，wheel SHA `0cf3cae568d36aa9576b28dfb35f11328f1cb974ca7647d9475ebb86c75ac6e3`，LICENSE SHA `130e3a64d5fdd5d096a752694634a7d9df284469de86e5732100268041e3d686`，匹配既有该版本精确记录，不借用2.7。

### L.2 Eight exact metadata roles, no new license grant

charset-normalizer3.5.2、pandas3.0.6、wcwidth0.9.2、ipykernel7.4.0的原件文本已审，独立LICENSE分别由h-035/036/037/040覆盖；其METADATA为包身份、依赖、项目描述及许可引用，不新制造一项独立许可。保留全部METADATA及dependencyAudit，wcwidth的Markus Kuhn原条款不能被元数据MIT分类标签覆盖。本轮在新tree实际读取上述四包各使用路径的METADATA及LICENSE共18份原字节，另核2份Pygments notice，20/20原文SHA匹配报告；未重跑provider或访问行情网站。

下列8条可由policy owner精确加入metadataProvenance；不得推广到其他版本、平台wheel或未知path：

<!-- ASTRA_LICENSE_BATCH_L_METADATA_JSON_BEGIN -->
```json
[
  {
    "component": "charset-normalizer",
    "version": "3.5.2",
    "artifactSha256": "78456a747de8dc58360ffa581f30a002baf5aa28cb262536545e91f113ed7639",
    "metadataSha256": "49e955a09e1a159e0846872798006e8db7d518d8d70c637066fefdb08d3d9f7b",
    "path": "providers/akshare/site/charset_normalizer-3.5.2.dist-info/METADATA",
    "role": "provenance-and-license-reference",
    "decision": "not-an-independent-license-grant"
  },
  {
    "component": "pandas",
    "version": "3.0.6",
    "artifactSha256": "f3ce8a6968045481e91a3990e797e348ce13db45ee164a7095bbc824e26c09dd",
    "metadataSha256": "9eb4d20fc21b7851d6f782bd5186ded152fce80a48ac93120bf88e03c89ebc39",
    "path": "providers/akshare/site/pandas-3.0.6.dist-info/METADATA",
    "role": "provenance-and-license-reference",
    "decision": "not-an-independent-license-grant"
  },
  {
    "component": "pandas",
    "version": "3.0.6",
    "artifactSha256": "f3ce8a6968045481e91a3990e797e348ce13db45ee164a7095bbc824e26c09dd",
    "metadataSha256": "9eb4d20fc21b7851d6f782bd5186ded152fce80a48ac93120bf88e03c89ebc39",
    "path": "providers/mootdx/site/pandas-3.0.6.dist-info/METADATA",
    "role": "provenance-and-license-reference",
    "decision": "not-an-independent-license-grant"
  },
  {
    "component": "wcwidth",
    "version": "0.9.2",
    "artifactSha256": "2a9746de704242bd4fdaabb31dd46b82f694a56a8d21081ad89b679a89da9fec",
    "metadataSha256": "6dc0797cb9f62b83fb85c792bcf3800d350c83368d00a2e03a5d2fde3739907e",
    "path": "providers/mootdx/site/wcwidth-0.9.2.dist-info/METADATA",
    "role": "provenance-and-license-reference",
    "decision": "not-an-independent-license-grant"
  },
  {
    "component": "charset-normalizer",
    "version": "3.5.2",
    "artifactSha256": "78456a747de8dc58360ffa581f30a002baf5aa28cb262536545e91f113ed7639",
    "metadataSha256": "49e955a09e1a159e0846872798006e8db7d518d8d70c637066fefdb08d3d9f7b",
    "path": "providers/pywencai/site/charset_normalizer-3.5.2.dist-info/METADATA",
    "role": "provenance-and-license-reference",
    "decision": "not-an-independent-license-grant"
  },
  {
    "component": "ipykernel",
    "version": "7.4.0",
    "artifactSha256": "a6757f790ddc5a6006b813d82da1a9dbb65b3a00f2b6607df776418c6566ec1c",
    "metadataSha256": "39f6a0cbe6a0d0b404880684902f085c1c6c93947d218b317b0d8a9c3ee1a137",
    "path": "providers/pywencai/site/ipykernel-7.4.0.dist-info/METADATA",
    "role": "provenance-and-license-reference",
    "decision": "not-an-independent-license-grant"
  },
  {
    "component": "pandas",
    "version": "3.0.6",
    "artifactSha256": "f3ce8a6968045481e91a3990e797e348ce13db45ee164a7095bbc824e26c09dd",
    "metadataSha256": "9eb4d20fc21b7851d6f782bd5186ded152fce80a48ac93120bf88e03c89ebc39",
    "path": "providers/pywencai/site/pandas-3.0.6.dist-info/METADATA",
    "role": "provenance-and-license-reference",
    "decision": "not-an-independent-license-grant"
  },
  {
    "component": "wcwidth",
    "version": "0.9.2",
    "artifactSha256": "2a9746de704242bd4fdaabb31dd46b82f694a56a8d21081ad89b679a89da9fec",
    "metadataSha256": "6dc0797cb9f62b83fb85c792bcf3800d350c83368d00a2e03a5d2fde3739907e",
    "path": "providers/pywencai/site/wcwidth-0.9.2.dist-info/METADATA",
    "role": "provenance-and-license-reference",
    "decision": "not-an-independent-license-grant"
  }
]
```
<!-- ASTRA_LICENSE_BATCH_L_METADATA_JSON_END -->

### L.3 Two affirmative notice-scope recommendations

L-001：PBS资产内Pygments原始1331字节BSD-2-Clause文本，许可SHA `a9d66f1d526df02e29dce73436d34e56e8632f46c275bbdffc70569e882f9f17`。原许可全文已读并保留，包含版权、两条保留条件及完整免责；它已经作为notice随候选交付，无须把这种普通文本永远标NOASSERTION。覆盖的是PBS实际包含/归档保留的此notice，不批准整个pip工具链或其他资产。

L-002：PBS当前两个实际DLL的PE版本均3.5.9：
- `python/DLLs/libcrypto-3-x64.dll`: `83dd6eb8bf549a02f1cf260edb2e37956d55070d4e1b31f6b45d0f67cd1b284a`
- `python/DLLs/libssl-3-x64.dll`: `a54d16a8f7f366417a7e90cef934e2e12d9731a819d6b8132211320955ce3221`

原PBS `LICENSE.openssl-3.txt`本轮实际读取10352字节，SHA `ed72ce2b51ee58f117e5a021e2e04af158857f40269fbc03491f0b2a99dbcc96`，完整Apache-2.0保留。[官方3.5.9 LICENSE](https://raw.githubusercontent.com/openssl/openssl/openssl-3.5.9/LICENSE.txt)确认版本许可；[官方对应源码文件树](https://api.github.com/repos/openssl/openssl/git/trees/openssl-3.5.9?recursive=1)实际响应6144项、truncated=false、tree SHA `45e844fa2a14ec92d146bd8f5778ac130b6625fb`，未列NOTICE文件；有LICENSE.txt、AUTHORS.md、ACKNOWLEDGEMENTS.md及external/perl构建依赖LICENSE。不得仅凭“Apache可能需要NOTICE”无限悬置；本具体上游版本未发现该附加文件，现有完整许可保留可关闭这项notice义务。此处不对PBS构建过程做可重复构建或签名验证声明，也不批准未交付的Perl工具链。Microsoft code继续独立审查，OpenSSL3许可不覆盖它。

以下记录不覆盖PBS内CRT/BDB/Tix等其他scope，不是整包批准；原始资产的执行pin仍独立。它们覆盖当前5个pending usage，具体路径由原fragment保留：

<!-- ASTRA_LICENSE_BATCH_L_JSON_BEGIN -->
```json
[
  {
    "id": "astra-20261009-l-001",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "a9d66f1d526df02e29dce73436d34e56e8632f46c275bbdffc70569e882f9f17",
    "spdx": "BSD-2-Clause",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-l-20261009"
  },
  {
    "id": "astra-20261009-l-002",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "ed72ce2b51ee58f117e5a021e2e04af158857f40269fbc03491f0b2a99dbcc96",
    "spdx": "Apache-2.0",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-l-20261009"
  }
]
```
<!-- ASTRA_LICENSE_BATCH_L_JSON_END -->

若policy owner采纳本节8角色+2记录，当前50 pending usages可精确减少13至37，唯一组合32减少6至26。**这是当前记录的静态投影，不是已更新policy/重跑候选的实际新结果**。当前审批实际仍176、角色15；不回填旧fragment。

### L.4 Minimum payload implementation, not universal human placeholders

Franklin可独立实现下列公开补件，不读取账户、用户目录或broker数据；新增每个文件都纳入inventory SHA并在可读第三方许可入口关联，原条款不替换、不规范化换行：

| item | exact source / minimal files | closure condition |
|---|---|---|
| libzmq4.3.5 | I.2固定官方tar，SHA `6653ef5910f17954861fe72332e68b03ca6e4d9c7160eb3a8de5a5a913bfab43`，存`licenses/sources/zeromq-4.3.5.tar.gz`；保留wheel MPL原文 | 来源pin校验后入payload；可读说明给出相对源码位置与原官方URL；不要求为MPL库提供LGPL式重链接对象 |
| Tix8.4.3.6 | I.4固定官方tar，SHA `f7b21d115867a41ae5fd7c635a4c234d3ca25126c3661eb36028c6e25601f85e`；按已列成员SHA加入`licenses/tix-8.4.3.6/docs/license.html_lib`、`docs/license.tcltk`、`license.terms` | 三份原字节与PBS原notice同存；不需重新向版权方申请已明确授予的普通再分发权 |
| xlrd2.0.2 | 保留实际wheel LICENSE；把I.3精确确认句放入`licenses/third-party/runtime-NOTICES.txt` | 安装包内可读、第三方入口可找到；涉及受条款覆盖的宣传材料也带确认句；原AGPL组合范围不能用notice假解决 |
| OpenSSL3.5.9 | 保留当前`licenses/python-full/python/licenses/LICENSE.openssl-3.txt`；下方说明段可加入runtime-NOTICES | 本节已肯定Apache notice-scope，无需杜撰一个不存在的上游NOTICE或强制附完整源包 |
| NumPy2.5.3原生库 | 保留原BSD/OpenBLAS/GCC runtime exception全文；将I.1 producer及精确DLL关联写入public source ledger | GCC例外归属已收敛，不再笼统作为GPL阻断；实际MSVCP140文件加入现有CRT清单 |
| lxml6.1.3 | 前文B节固定六份source/build资产、原LGPL2.1全文、构建/链接说明；使用固定源实现可重建/重新链接交付 | 真正欠的是现wheel producer对应证明及充分链接输入；可从已固定候选源做明确派生重建，真实隔离替换libiconv验证后关闭，不以一句“待法务”替代 |
| BDB/libX11/旧OpenSSL1.1 notice | 原PBS full notice继续保存；生成精确target的component-applicability记录，引用PYTHON.json、实际文件及链接清单 | Windows元数据未列BDB/X11扩展，但不能只凭名称缺失证明全部二进制；只读实际binary依赖/交付检查证明无代码后应归档notice-only，而非要求不存在组件的源码；本结论不能继承到Mac |
| Microsoft CRT | 现有精确PE/DLL清单加NumPy附带MSVCP；原Python附加条款、适用官方REDIST条款快照、接收者展示与同意记录 | 授权主体的许可/合法分发链资格是仍需其提供的事实输入；其余清单与文档都能工程落地。不得替主体代签、读取账户或把CRT条款泛用于AGPL/LGPL代码 |

可合入runtime-NOTICES的OpenSSL说明（与原LICENSE共同交付，非替代条款）：

```text
OpenSSL 3.5.9
This distribution includes OpenSSL through the bundled Python runtime.
OpenSSL is licensed under the Apache License, Version 2.0.
The complete license is retained at:
licenses/python-full/python/licenses/LICENSE.openssl-3.txt

This attribution does not replace the original license, grant trademark
rights, or change the separate terms applicable to Microsoft runtime code.
```

libzmq和xlrd的完整可读段落沿用I.2/I.3；添加前核相对路径与实际payload一致。公开补件只含公开源码、许可证、构建证明与组件hash，不上传缓存绝对路径、用户数据、凭据或本地报告中的私有信息。此节没有新建payload、改policy、运行测试、打包或发布；只改本审查记录。

## M. New seal bridge review: production acceptance blocked (2026-10-09)

只读审查新增两文件，未执行测试或真实GitHub producer/assembly：
- scripts/seal-private-python-runtime.cjs SHA `83c7300a2630d070064385b830a777e8e5b84e5eee374ba4d422fcc5499243e0`
- tests/unit/privateRuntimeSealBridge.contract.test.ts SHA `9fb88282e457a5865354a97bbaeb35a778d96325356773700c6f7cbf6e7c46fb`

实现者37/38及LFS fixture失败仅为其报告，不写成Astra测试通过。最小发现已直接交Archimedes：

1. **P1，seal:263/266/289：核验目录与执行目录未绑定。** source验证repositoryRoot，但实际require按当前bridge的__dirname装载foundation/assembler/validator；两个checkout可以不同。需强制真实根与当前实现相同并校验实际加载代码，不能验证A执行B。
2. **P1，seal:273-278、verifyProducers:175-177：成功fragment不等于当前装配输入受测。** fragment身份/两个Boolean及artifact成员SHA已验，但未把其inputLock、inventory、sourceSnapshot、provider audit/native报告绑定到实际formal lock/tree。缺强制正式native/bootstrap verifier，许可notice-only成功路径也没有独立执行证据门禁。需实现这条字节/producer/target链，或缺任一项保持PENDING；REQUIRED_SOURCE还须强制实际prepare脚本。
3. **P1，seal:285-287：任意dischargedIntegrationCodes可消除未知或未执行的门禁。** trusted host不是删所有pending的授权；改为代码内固定、由本轮实际检查结果派生的可消解集合。bootstrap缺报告时不得因caller列入placeholder而关闭，assembly未执行前也不得当已完成。
4. **P2接口兼容风险，seal:276：要求candidate fragment携带resolutionComplete。** 已审materialize schema仅treeComplete，resolutionComplete在prepare handoff；当前测试只有分解helper成功和无context seal拒绝，没有忠实真实schema的seal正例。需以实际601d数据确认接口，按inputLock/closure/handoff真实证明解析完成，不能手工伪补true。本轮未重读601d prep全源码，不把旧schema缓存冒称其最新实现。

以上不是要求永久hardcoded pending；生产artifact-member验证器、protected-host调用绑定和native证据verifier可以按分工实现，缺失时需阻止accepted。它们齐全且上述具体绑定修复后，允许真实成功路径。签后语义比较/身份/账本及安装验收仍独立，不以pre-sign accepted作为releaseEligible。

<a id="astra-license-batch-n-20261009"></a>
## N. Further actual Windows notice audit and bounded source-delivery actions (2026-10-09)

### N.1 Input and newly inspected evidence

继续以L节独立读得的lock `9c654a4199b4b01c029e4dd7ebda8aa676ccb0bd55a802487bd445b388fabc94`、fragment `24f7d959d1ba73b8d7a1faa075a9d979d3e2f85a11caf4c38e0738dc66f18bb0`为准。本轮首次读取该candidate的实际`materialize/inventory.json`，SHA `6c7835d4d4c543a0f9fcd2652b71bd3da22129f585373490736f876bdd4dcc19`，21396条成员；不把它冒称新source commit验收，也没有重跑prepare。

独立读取当前tree中mini-racer、curl_cffi、debugpy的6份主许可/署名使用原字节，均与下列精确wheel/notice SHA一致；已有全文只复用缓存，不重读上次已审文件。另首次完整读debugpy/ThirdPartyNotices.txt：34844 bytes，SHA `e3baaa532b9e2303b187b18e05dfed48961d6d16c82d0ae47978b2fd2ce47084`。它实际在inventory，但**不在该fragment的licenseRequirements**。

### N.2 Four affirmative, strictly scoped notice records

以下每条均仅批准被点名许可文本及其覆盖的wrapper/署名部分；**不是将该wheel全部原生依赖标为ISC/MIT**。mini-racer AUTHORS为随该ISC代码保留的署名，不是独立授权文件。现policy owner可记录这些肯定结论，但正式义务规则必须将三项复合资产标为additional-obligations并保留N.3的原生/第三方义务；不能因本表主文本批准而把整资产归notice-only。若当前规则尚不能保留该范围，应先接好范围门禁再合入可seal输入，不篡改本审查结论为整个资产无条件批准。

- mini-racer0.12.4：760字节ISC主许可与320字节AUTHORS均已实际保留，任意目的有/无费用使用及分发授权明确，版权/许可/免责不能删；不覆盖V8/ICU自身条款。
- curl_cffi0.16.3：1129字节MIT主许可已保留，覆盖该Python binding自身；不覆盖实际libcurl-impersonate原生DLL的全部依赖。
- debugpy1.8.22：1200字节Microsoft MIT主许可已保留，不因版权主体是Microsoft就套CRT发行资格要求；其自带PyDev.Debugger为另一个明确scope，见N.3。

主源是本次normal resolver实际锁定的官方wheel，不使用旧artifact：
- [mini-racer0.12.4 Win wheel](https://files.pythonhosted.org/packages/5c/0e/a9943f90b4a8a6d3849b81a00a00d2db128d876365385af382a0e2caf191/mini_racer-0.12.4-py3-none-win_amd64.whl)
- [curl_cffi0.16.3 Win wheel](https://files.pythonhosted.org/packages/9b/72/1732a24ef4a2aeba994b80ec163debe8deda403c07e4abbc0443bca078b8/curl_cffi-0.16.3-cp310-abi3-win_amd64.whl)
- [debugpy1.8.22 Win wheel](https://files.pythonhosted.org/packages/d0/f5/c2b3e8260388d7b76bc4e5a3a29648a0ca47dca6a2721d6549ff2d944eee/debugpy-1.8.22-cp313-cp313-win_amd64.whl)

<!-- ASTRA_LICENSE_BATCH_N_JSON_BEGIN -->
```json
[
  {
    "id": "astra-20261009-n-001",
    "component": "mini-racer",
    "version": "0.12.4",
    "artifactSha256": "9446e3bd6a4eb9fbedf1861326f7476080995a31c9b69308acef17e5b7ecaa1b",
    "licenseSha256": "554401102688806b6a517f6aa80c8eca6b52ec409f555c8f4e9e4e3789b5d235",
    "spdx": "ISC",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-n-20261009"
  },
  {
    "id": "astra-20261009-n-002",
    "component": "mini-racer",
    "version": "0.12.4",
    "artifactSha256": "9446e3bd6a4eb9fbedf1861326f7476080995a31c9b69308acef17e5b7ecaa1b",
    "licenseSha256": "48ca3140561c2fea05f5d8b10c8a7bd5a1229241eaeee80c53d5b80d823abada",
    "spdx": "ISC",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-n-20261009"
  },
  {
    "id": "astra-20261009-n-003",
    "component": "curl_cffi",
    "version": "0.16.3",
    "artifactSha256": "fe87b66e324ed7318166698e02169f3208dbda32b872a27d2bc61a9c19b335eb",
    "licenseSha256": "47e6ce96c02170758c16164e66f920620db614523d642eba5000ba0c7aa2be6e",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-n-20261009"
  },
  {
    "id": "astra-20261009-n-004",
    "component": "debugpy",
    "version": "1.8.22",
    "artifactSha256": "f49b1d6cecf326b63c06d7f517e4a6642777f758c58cb799e7bc5a6dd74721c2",
    "licenseSha256": "649844f60da138e54b9bcc13338c62c5f97be8612cb6249ac10f84bbb97ffc88",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-n-20261009"
  }
]
```
<!-- ASTRA_LICENSE_BATCH_N_JSON_END -->

这4项覆盖当前6个pending usage；未修改policy，未声称pending实际数量已经减少。也不能仅做减法掩盖下面新定位的未纳入许可清单的真实notice。

### N.3 Concrete missing scopes and exact source / payload actions

**debugpy/PyDev.Debugger，已有本地材料，不是找不到授权。**

完整ThirdPartyNotices明确包含EPL-1.0、PSF及历史Python许可、Apache2、MIT/BSD等，并明确源代码随debugpy提供；EPL含源取得说明、免责声明与商业分发责任等条件。原文中的Microsoft邮寄$5源代码路径是上游自己的安排，不可改写成我们已提供的邮寄承诺。该EPL范围不自动扩张为整个应用，但也不能把组合兼容性按IPC自动认定已解决。

当前inventory中有263个PyDev.Debugger相关成员，含生成C、Cython和Windows原生源码，例：
- `debugpy/_vendored/pydevd/_pydevd_bundle/pydevd_cython.c`: `e5cdcf5b54006888b0edd409f6be4f551b23ce8c36092253b52566e8e66fa1d6`
- `debugpy/_vendored/pydevd/_pydevd_bundle/pydevd_cython.pyx`: `be7452ebda9ca3280ea08c4075c07541850378d332d03389a69dd53f34f04786`
- `debugpy/_vendored/pydevd/_pydevd_sys_monitoring/_pydevd_sys_monitoring_cython.c`: `612fecb49fc746d832943c20fe9f533feef582d8c885a8ece35358d88320c401`
- `debugpy/_vendored/pydevd/pydevd_attach_to_process/windows/attach.cpp`: `a7fdd07bc0ea9ac49f0cc20893b1f0b08ae4115f6ee5af5293cc4fe5c5ab0081`

这些为本轮实际读取的inventory记录，未逐一重读源文件或声称已验证可重建。它们是可立即复用的源码交付材料，不必先重写此依赖。为完整源归档补件，[官方PyPI1.8.22索引](https://pypi.org/pypi/debugpy/1.8.22/json)本轮实际返回：
[debugpy-1.8.22.tar.gz](https://files.pythonhosted.org/packages/44/9d/3cb6693342acf96802dba89934a5b8da43c201d764ebd1f2c0514a3d42bd/debugpy-1.8.22.tar.gz)，1710877 bytes，SHA `e489c7268e1c7b41e13b438d9c533d2a7af73fb59bf8cd30fead8286c1c39c4e`。本轮只查实官方pin，**未下载/逐成员比较该sdist**，不能写成已验证对应源归档。

最小下一步明确为：保留并把已在tree的`providers/pywencai/site/debugpy/ThirdPartyNotices.txt`纳入许可要求与可读索引；按上述SHA获取sdist到候选`licenses/sources/debugpy-1.8.22.tar.gz`，与实际wheel的vendored源码逐成员绑定，保留其构建材料/版权，生成源码取得说明。不是泛删debugpy依赖，也不把“EPL”三个字当永久否决。

可加入runtime-NOTICES的当前已成立说明（归档未落盘前不写已附归档）：
```text
debugpy 1.8.22 and PyDev.Debugger
debugpy's own code is licensed under the MIT License.
Its bundled PyDev.Debugger and other third-party material retain their
separate terms. The complete unmodified notice is available at:
providers/pywencai/site/debugpy/ThirdPartyNotices.txt

Bundled PyDev.Debugger source files are available at:
providers/pywencai/site/debugpy/_vendored/pydevd/
The applicable license and disclaimer terms are retained with these files.
Any additional terms offered by this application are offered by its
distributor alone, not by the upstream contributors.
```

**mini-racer/V8/ICU，定位到实际原生件，不是泛称native pending。**

当前akshare与mootdx两个site均包含：
- `py_mini_racer/mini_racer.dll` 23592448 bytes，SHA `3499601d1aa08a5ea7e097c4fa936af6cf1c4e23b6228fbaf04bd73c917b9e49`
- `py_mini_racer/icudtl.dat` 10468208 bytes，SHA `9ae98c06cbb0ea43c5cd6b5725310c008c65e46072421a1118cb88e1de9a8b92`
- `py_mini_racer/snapshot_blob.bin` 310230 bytes，SHA `991c81cbd36d9a9c35ede97409d18bca577cdbfb516bd25a466d1e045ddf463c`

当前这两个包目录的inventory按LICENSE/NOTICE/COPYING/AUTHORS等检索只列主ISC/LICENSE与AUTHORS，不能拿Node22的不同V8/ICU通知替代。最小补件应来自精确0.12.4官方producer/配方指定的V8提交、其DEPS指定的ICU及实际编入第三方组件原notice；固定来源原字节后加入`licenses/mini-racer-0.12.4/`并关联上述DLL/资源hash。本轮官方PyMiniRacer tree查询25秒超时，另一个版本文件路径未取得有效正文；因此没有编造V8/ICU精确版本、源码SHA或“补件已齐”。这是一个有限的producer-to-notices定位任务，不要求重写V8或联网运行行情。

**curl_cffi/libcurl-impersonate，明确单个DLL的notice闭包。**

实际`providers/akshare/site/curl_cffi.libs/libcurl-impersonate-1172405423dc93b7aeed557f2a2ca325.dll`为3885056 bytes，SHA `1172405423dc93b7aeed557f2a2ca325f73d89c4593640a4b775cee3cc1ea048`。当前对应目录许可清单只含binding MIT，尚未把该native producer/静态TLS、压缩等组件的原notice闭包明确归属；不猜其版本或把常见依赖当作实际已链接。最小任务是从精确curl_cffi0.16.3 wheel的官方构建配置/producer找到这份DLL固定上游资产，核对相同DLL SHA、读取该资产的实际license/notice，加入`licenses/curl-cffi-0.16.3/native/`并写组件映射。该DLL与MiniRacer的缺口应是义务规则中的additional-obligations，不是把wrapper的MIT/ISC判为未知许可。

### N.4 PBS archive material versus actually shipped code

本次实际inventory没有`python/Lib/site-packages/pip/`、setuptools/wheel运行包或ensurepip包的匹配路径；归档notice则被保留在`licenses/python-full/`和`licenses/python-install-only/`。因此“归档pip certifi的MPL notice还在”本身不证明该pip certifi证书库代码随执行树分发。可由policy owner建立精确scope的archived-notice-only适用性记录，绑定本inventory、prep排除规则和实际执行树核验，继续保留原文本；不用给不存在的pip certifi执行资产补一个虚构源码包。此记录不同于metadataProvenance，不能塞入仅允许METADATA路径的字段，更不能移除实际provider里的certifi要求。

BDB/libX11同理需要binary/组件适用性证据，不能仅凭文件名作整体不存在断言。本轮未进行PE imports/静态组件归属扫描，所以不将其自动approved/not-applicable。实际OpenSSL DLL仍为L节已证3.5.9；旧1.1 notice保留不等于当前代码用了1.1。Tix实际tix84.dll存在，不能通过归档角色绕过其三份notice补件。

### N.5 Smallest remaining work, not blanket human approval

可直接工程实施：将I/L的libzmq源包、Tix三原文、xlrd确认句落进payload；将本节debugpy实际第三方notice纳入要求并补精确sdist/取得说明；为上面两个精确native DLL补producer-notice闭包；对归档PBS材料给受证的适用性记录。普通顶层ISC/MIT许可已给肯定结论，不重新索要版权所有者为这些原授权另开特许。

仍需实际证明而非口头批准的窄项：lxml对应源与充分重链接材料；CRT发行主体许可链/REDIST和接收者安排；mootdx/tdxpy原MIT与非商业README陈述的真实范围澄清。没有把所有事情推给human，也没有代理代签或把原文冲突消除。本轮仅修改本文件，没有改其他agent源码/policy、打包、安装、真实provider请求或生产数据。

## O. Minimal actionable delta against the actual 176-record policy (2026-10-09)

本节仅汇总已完成的实际字节审查，不制造新批准、不重新读取/执行其他agent源码。基线为`08e8821f69b0665a14e3c1b296b258981c0adef772fe865fde53a8e05f326e70`：176个licenseApprovals、15个metadataProvenance。对象为L/N所列当前Windows lock9c654/fragment24f7及inventory6c7835；没有将Mac失败或未审平台写成通过。

### O.1 No version-hash transfer

实际pandas3.0.6 wheel `f3ce8a6968045481e91a3990e797e348ce13db45ee164a7095bbc824e26c09dd`、LICENSE `9850f6b5bdef7346503065807b878deb8058b976c5c329f4c4d23bf4796ce9ae`已匹配`astra-20261009-h-036`。

实际urllib3 2.8.0 wheel `0cf3cae568d36aa9576b28dfb35f11328f1cb974ca7647d9475ebb86c75ac6e3`已匹配`astra-20261009-urllib3-2.8.0-1`与`-2`，对应LICENSE `130e3a64d5fdd5d096a752694634a7d9df284469de86e5732100268041e3d686`和METADATA `10898c620e8007c030e07fa5622b68358a43010025dfbd78a1cb797699de2bb4`。这些已经属于176基线，不从pandas3.0.3/urllib3 2.7旧资产转移，也不要重复新增。

### O.2 First minimal merge: +2 notice approvals, +8 exact metadata roles

由policy owner读取本文件L节唯一标记块：
- `ASTRA_LICENSE_BATCH_L_JSON_BEGIN/END`：2条精确审批记录，id l-001、l-002；分别为PBS中的Pygments BSD2 notice和实际OpenSSL3.5.9 Apache2 notice，覆盖当前4+1 usage。
- `ASTRA_LICENSE_BATCH_L_METADATA_JSON_BEGIN/END`：8条精确METADATA角色；charset-normalizer2处、pandas3处、wcwidth2处、ipykernel1处。不是许可grant，不删除原件/依赖audit。

本轮对缓存的实际policy逐字段确认：这2条及N节4条与原176条没有id或(component,version,artifactSHA,licenseSHA)冲突；8角色也不与原15条五维键重复。先合本步骤后计数应为178审批、23角色；基于旧fragment的静态投影pending50->37。**尚未修改policy或重新materialize，该37不是新的实跑报告。** PBS其他CRT等scope继续保持其原门禁，不能把PBS整体归notice-only。

### O.3 Second bounded merge: +4 wrapper/attribution records with composite obligations retained

取`ASTRA_LICENSE_BATCH_N_JSON_BEGIN/END`现有4条，不重命名reviewer、不更换asset/license SHA。精确覆盖：

| id suffix | component/version | covered notice SHA | old pending usages | retained additional scope |
|---|---|---|---:|---|
| n-001 | mini-racer0.12.4 | 554401102688806b6a517f6aa80c8eca6b52ec409f555c8f4e9e4e3789b5d235 | 2 | V8/ICU及实际编入native components |
| n-002 | mini-racer0.12.4 | 48ca3140561c2fea05f5d8b10c8a7bd5a1229241eaeee80c53d5b80d823abada | 2 | 署名随ISC保留，不是native许可闭包 |
| n-003 | curl_cffi0.16.3 | 47e6ce96c02170758c16164e66f920620db614523d642eba5000ba0c7aa2be6e | 1 | 实际libcurl-impersonate DLL及静态依赖 |
| n-004 | debugpy1.8.22 | 649844f60da138e54b9bcc13338c62c5f97be8612cb6249ac10f84bbb97ffc88 | 1 | 已实际发现的ThirdPartyNotices/PyDev.Debugger EPL范围 |

各artifactSHA、SPDX、reviewReference在N节完整JSON原样保留。本步骤若采纳，应178->182审批；不增加metadata角色。其6个usage在既有清单中的投影可消解，但debugpy遗漏notice补入后必须重新计算，**不可宣传“剩31即全部实际义务”**。

只有能把上述复合scope留在正式规则及要求清单中时，才把4条接入可seal输入；这不是推翻已经明确的ISC/MIT文本结论，而是防止旧清单不完整导致整资产被误批。最小实施是增加实际notice要求/asset obligations，不需要重写provider代码或更换依赖。

### O.4 Concrete next artifacts, not a generic stop

1. debugpy：将已在tree的`providers/pywencai/site/debugpy/ThirdPartyNotices.txt`（SHA `e3baaa532b9e2303b187b18e05dfed48961d6d16c82d0ae47978b2fd2ce47084`）纳入要求和可读索引。按N节官方sdist pin取得对应源码补件，与现有vendored源及实际wheel对应；不另造版权所有者批准。
2. Tix/libzmq/xlrd：按I/L现有固定源资产/原件SHA/完整确认句入payload并纳入inventory；材料方案已齐，不再重复全文审查，也不以“全待human”挂起。
3. MiniRacer与curl_cffi：只补N节明确点名的两个实际DLL的producer-to-native-notices闭包；没有证据时不借其他版本V8/ICU或常见libcurl依赖猜测。
4. lxml、CRT、mootdx/tdxpy：继续各自具体源/重链接、发行资格/条款、权利范围的窄缺口；不将这些问题扩展到已肯定的普通MIT/BSD条目。

新增记录合入后正常生成新policy SHA/source receipt和候选报告，不修改旧lock/fragment、旧成功次数或原下载pin。本轮只改本审查文档，下一次Arch源码复验仍待其明确最终交付，不把86/87消息当新的独立审查结果。

<a id="astra-debugpy188-license-delta-20261009"></a>
## P. Actual debugpy 1.8.8 universal-wheel license delta (2026-10-09)

### P.1 Independent exact artifact evidence

本轮独立只读、内存打开母线程提供的原始wheel，无安装/解包写入/运行代码：
`D:/RT-ResearchFlow-BuildCache/mac-wheel-minos-probe-ef8df66db0d1/debugpy-1.8.8-py2.py3-none-any.whl`。

- 实测5157124 bytes、309个ZIP成员。
- 实测artifact SHA256 `ec684553aba5b4066d4de510859922419febc710df7bba04fe9e7ef3de15d34f`。
- [官方PyPI1.8.8 JSON](https://pypi.org/pypi/debugpy/1.8.8/json)本轮实际返回同一filename/size/SHA；原件官方URL为[debugpy-1.8.8-py2.py3-none-any.whl](https://files.pythonhosted.org/packages/03/99/ec2190d03df5dbd610418919bd1c3d8e6f61d0a97894e11ade6d3260cfb8/debugpy-1.8.8-py2.py3-none-any.whl)。
- 顶层METADATA实测1120 bytes、SHA `331e35d868b289efd107aa991640ee2753465e95c8655e0bb5a68c7962e32034`，Name=debugpy，Version=1.8.8，Requires-Python >=3.8，License=MIT，License-File=LICENSE。
- WHEEL实测109 bytes、SHA `3a95d6111976c4b3d11d3bddd995e8fe296e3c441df2e49b624279dcd00447f6`，声明Root-Is-Purelib=true、py2-none-any/py3-none-any。这是上游标签，不是“没有二进制”或Python3.13实际兼容证明。

没有将1.8.22 artifact的approvalId或source zip复用为1.8.8批准。相同许可原文SHA仅允许复用已读全文的条款分析；新wheel的身份及其原件成员本轮独立核验。

### P.2 Actual original notices and vendored source

| exact wheel member | bytes | SHA256 | engineering conclusion |
|---|---:|---|---|
| debugpy-1.8.8.dist-info/LICENSE | 1200 | 649844f60da138e54b9bcc13338c62c5f97be8612cb6249ac10f84bbb97ffc88 | Microsoft MIT主许可，与已审原文完全同字节；允许保留版权/许可/免责条件下分发debugpy自身覆盖代码，不等于CRT许可证或全vendor MIT |
| debugpy/ThirdPartyNotices.txt | 34844 | e3baaa532b9e2303b187b18e05dfed48961d6d16c82d0ae47978b2fd2ce47084 | 完整原件确在此新wheel，字节与N节已全文审的复合notice一致；保留EPL1.0/Python历史许可/Apache/MIT/BSD等原文，不删除或改写上游源代码取得承诺 |
| debugpy/_vendored/pydevd/_pydevd_frame_eval/vendored/bytecode-0.13.0.dev0.dist-info/COPYING | 1095 | 9cf513576dc0703e5465c73d12d55306df88828ca3ec8211c3def1b8e19582af | 本轮读完整Red Hat MIT原文，版权/许可/免责均明确，可对该嵌入文本及其覆盖代码给肯定结论 |
| debugpy/_vendored/pydevd/_pydevd_frame_eval/vendored/bytecode-0.13.0.dev0.dist-info/METADATA | 3006 | 41d8f2cebf1d74c6c6221c4989a0ed0c2b8f6f012cf6780556b7633b88b1dc6d | 嵌入bytecode元数据，不是另一个经pip解析安装的顶层distribution，也不是独立许可grant |

原件实际包含PyDev.Debugger的`pydevd_cython.c/.pyx/.pxd`、`pydevd_frame_evaluator.c/.pyx/.pxd`、`_pydevd_sys_monitoring_cython.c/.pyx/.pxd`、Windows attach/inject/run-code C++与headers、`setup_pydevd_cython.py`、`compile_windows.bat`、`compile_mac.sh`、`compile_linux.sh`等。该结论来自本wheel成员内容读取/目录，不是把1.8.22源码目录当成1.8.8源交付；本轮未执行构建或逐一证明原二进制可重建。

实际有8个.exe/.dll/.pyd成员，其中两个cp39-win_amd64扩展、两个inject_dll EXE及四个attach/run-code DLL。保留原全部payload不等于这些PE的分发义务消失。母线程提供的0 Mach-O及最低macOS问题定位为其原生检测证据，本轮不冒称重跑该检测；也不把cp39扩展解释成已通过Python3.13导入。

### P.3 Exact new engineering approval records, not whole-wheel approval

本节仅新增以下两个精确artifact+license文本范围建议。第三方复合scope必须继续存在于requirement/obligation registry；不得把debugpy1.8.8整个资产标为notice-only。尤其ThirdPartyNotices的存在不能只落inventory而漏掉许可要求，上一版本已发现的遗漏必须在新资产上一起修正。

<!-- ASTRA_DEBUGPY188_LICENSE_DELTA_JSON_BEGIN -->
```json
[
  {
    "id": "astra-20261009-p-001",
    "component": "debugpy",
    "version": "1.8.8",
    "artifactSha256": "ec684553aba5b4066d4de510859922419febc710df7bba04fe9e7ef3de15d34f",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-debugpy188-license-delta-20261009",
    "licenseSha256": "649844f60da138e54b9bcc13338c62c5f97be8612cb6249ac10f84bbb97ffc88"
  },
  {
    "id": "astra-20261009-p-002",
    "component": "debugpy",
    "version": "1.8.8",
    "artifactSha256": "ec684553aba5b4066d4de510859922419febc710df7bba04fe9e7ef3de15d34f",
    "spdx": "MIT",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-debugpy188-license-delta-20261009",
    "licenseSha256": "9cf513576dc0703e5465c73d12d55306df88828ca3ec8211c3def1b8e19582af"
  }
]
```
<!-- ASTRA_DEBUGPY188_LICENSE_DELTA_JSON_END -->

p-002的component/version仍为持有该成员的debugpy1.8.8、artifact仍为原wheel，SPDX=MIT只描述其嵌入bytecode许可文本；不伪造单独下载的bytecode wheel。原top METADATA只宜作来源/许可引用角色；本轮未见最终三端新fragment实际site路径，所以不提前编造安装后路径或usage成功匹配数量。

### P.4 Exact remaining obligations and minimal payload, no generic halt

1. **原notice及源码交付落盘核验**：新candidate必须实际保留上述三份许可/notice和原vendored source/build members，纳入file inventory与许可要求。完整ThirdPartyNotices SHA已明确，不能只批准主MIT后跳过EPL等条款。
2. **EPL具体源取得说明/范围**：可读第三方入口指向新版本实际`debugpy/ThirdPartyNotices.txt`及`debugpy/_vendored/pydevd/`，说明这些源以原条款提供；不把上游Microsoft的$5邮寄安排冒称我们的承诺。原源已在wheel，不要求先人工重写依赖或因为EPL名字就拒绝分发；但不能把不同条款的组合重许可为整体MIT/AGPL，或只凭IPC断定组合范围。接收者条款须保留上游免责及本分发方额外承诺不归上游承担的边界。
3. **可实施完整源归档补件**：同一官方PyPI查询已返回[debugpy-1.8.8.zip](https://files.pythonhosted.org/packages/e4/5e/7667b95c9d7ddb25c047143a3a47685f9be2a5d3d177a85a730b22dc6e5c/debugpy-1.8.8.zip)，4928684 bytes，SHA `e6355385db85cbd666be703a96ab7351bc9e6c61d694893206f8001e22aee091`。本轮未下载该sdist，不能预填对应源成员核验通过。需要独立完整归档时，按pin加入`licenses/sources/debugpy-1.8.8.zip`，与本wheel原vendored源码对应，并写取得说明；禁止用1.8.22 tar代替。随原wheel源分发本身是可行路线，不把额外sdist当EPL当然要求。
4. **8个PE的实际适用性**：未装载不等于未分发。若这些PE包含Microsoft Distributable Code，须按实际链接/来源纳入现有CRT资格、平台条件与REDIST映射；不只凭.exe后缀认定一定含CRT，也不凭Mac不会加载就宣称条件不适用。若最终分发条件要求排除某些PE，必须另立明确派生配方、版本/hash与完整审查，不能静默删成员后继续声称原wheel SHA。此处没有执行删减。
5. **运行与许可证据分离**：Mac原生resolver/闭包、Python3.13实际fallback/import与正式bootstrap、安装签名仍归平台验收；本许可审查不假装这些已通过，也不因未运行它们否定已明确的MIT文本结论。

以下可读说明可交payload owner，须在实际保留对应源/notice后合入：
```text
debugpy 1.8.8
The debugpy wrapper is licensed under the MIT License.
The bundled PyDev.Debugger, bytecode and other third-party material
retain their respective original licenses and notices.

Complete third-party terms:
providers/pywencai/site/debugpy/ThirdPartyNotices.txt
Bundled PyDev.Debugger source and build scripts:
providers/pywencai/site/debugpy/_vendored/pydevd/
Bundled bytecode license:
providers/pywencai/site/debugpy/_vendored/pydevd/_pydevd_frame_eval/vendored/bytecode-0.13.0.dev0.dist-info/COPYING

The source files remain available under their applicable original terms.
Any additional commitments made by this application's distributor are
its own, not commitments made by upstream contributors.
```

上述示例providers/pywencai/site路径需以最终manifest实际路径核准，不把未materialize的路径写成验收事实。本轮仅写license-review.md；没有修改原wheel、policy、源码、Mac门禁或生产环境。

## Q. 冻结 seal/executor 增量独立源码复审（2026-10-09）

Reviewer: Astra。范围仅本节五文件冻结版本及提供的实际日志；本轮没有重新执行测试、安装器、注册表操作或Git操作。新增原生host/NSIS consumer和九场景CI不在本冻结版本验收内。

### Q.1 实际证据与版本边界

实际读取的owner freeze报告SHA为 `1d66a5b690f5b1dcac60940b5867ba9c9a6e0f1a1e91ad616ae8e88c27576cb9`。以下五文件实际读取并计算SHA，与报告逐项相符：

| 文件 | SHA256 |
| --- | --- |
| scripts/seal-private-python-runtime.cjs | cf65fbb29bfe7b854ee709444e6101600946695e31d02360ddf261c660a66930 |
| tests/unit/privateRuntimeSealBridge.contract.test.ts | 59a9a1d3c7cd3d15d1241b03f4d094307446d965f9df5ce704c4395be67f2082 |
| tests/unit/fixtures/privateRuntimeSealFixture.cjs | 4980a0051a472e63345d09eccd301d83c92949233885882658c72121f5077e99 |
| electron/main/services/windowsInstallRepairExecutor.ts | a9b45ffd7fc3b145d7c7b7bf31e13ae6b8d041c3a34bde60ee157d45115520a3 |
| tests/unit/windowsInstallRepairExecutor.test.ts | 0512ce065cc3d8daf02f943bfdaac6fd45c433c06a46a92ee0ef42f7fa7d3c3f |

实际日志 `seal-repair-bound-assembly.log` SHA `ea73ccbca08519f9a133b68492a222bb3870ee4f7b6caa02415aaa71411036d2` 记录50 seal、22 executor、16 collector，共88通过，3文件，4.58秒。本审查核读日志，不冒称Astra独立重跑。正向fixture确实调用实际assembler/validator，但producer、许可分类和native verifier为显式synthetic；executor使用模拟host。它们证明校验与编排分支，不证明真实三端bootstrap或Windows安装效果。

另读取seven-source observation报告SHA `5fddecf6399140abce4a8d3e0620660c28c0b6d061255ddee6779969d0e0c425`。该报告记载prep `f3d612830d0e4b14ba90d808b791574efe75ddb93692ff2eda1326ea929de78e`、policy `fc6b8f20c872f1ff0685c1906fefdbaae52a2f5a4c14aff3f612cf183c05b48a`；本轮没有重新核读七个实际源，故不把观察报告等同这些源的独立验收，也不将L/N节基于旧policy的匹配数量转用此policy。

### Q.2 原M节发现的源码关闭

- 执行来源：seal第39-66行锁定当前执行模块根，并由已校验字节装载本地模块，拒绝核验checkout A却执行checkout B。
- 准备证据：第271-362行比对candidate lock、handoff、七源snapshot、inventory、provider/wheel METADATA与dependencyAudit投影；第251-258行从真实archive bytes解析四成员；第483-490行强制native verifier并绑定报告和manifest identity，不以imports-only布尔值放行。
- pending：第364-382及494-506行仅以实现过的校验阶段消解精确已知代码，未知项继续pending；调用方dischargedIntegrationCodes不再产生效果。
- schema：第279-282行在candidate/handoff检查resolutionComplete，不再要求fragment虚构此字段。正向fixture保持fragment无该字段。

以上是这四项在冻结源码及针对性现有测试上的关闭，不是formal发行批准。当前仅在本机原生target执行assemble；其余两端是经producer/native authority绑定的报告及字节复核，不宣称在Windows执行Mac。

### Q.3 新P2：正向fixture依赖未声明的本机D盘

定位：`tests/unit/fixtures/privateRuntimeSealFixture.cjs:25`、30-31行；调用点contract第231、239、260行。

fixture无条件读取 `D:/RT-ResearchFlow-BuildCache/股票日线 prep-release17-nativefix-01/resolve/assets` 两个mootdx wheel。干净Windows runner和Mac不存在此私有目录，十个正常测试case在进入被测校验前即ENOENT。当前本机88通过不能证明这组测试可跨平台执行。

最小修复交Arch：提供明确可移植、隔离的fixture资产输入。CI准备步骤按固定官方upstream SHA取得wheel，再用已审recipe生成并核对固定derived SHA；测试本体只读该输入，不偷偷联网、不上传本机cache、不skip这十项、不放松产品固定hash。三平台干净runner应实际执行正向assemble及九个负例，缺资产时给明确准备失败。此P2已直接消息交接Arch，未修改其源码。

### Q.4 继续推进范围与发布限制

本冻结版本未发现新增P1；可继续隔离host/consumer及CI实现，不能宣布正式bundle/安装修复/发布通过。跨平台复用这组unit前须修Q.3。

executor第48行仍将双键提交描述为Atomic；未来宿主应以持久journal、预期旧typed values比较、失败条件补偿和恢复证据履约，不能把两个普通注册表写入视为原子事务。第147-148行步骤及零旧卸载/零外路径变更值是编排约束的填充值，不是进程监测计数；返回nativeEffectsIndependentlyAccepted=false正确保留边界。下一阶段必须由真实host/九场景审计补齐，不以这组模拟测试清除此门禁。当前没有新授权执行修复。

P节debugpy1.8.8两条新增精确文本审批建议仍独立有效；不因本节源码通过扩大为整wheel、其8个PE或完整许可义务放行。

## R. rootmeta-final 实际32键逐项收敛（2026-10-09）
<a id="astra-license-batch-r-20261009"></a>

Reviewer: Astra / engineering redistribution review。本节仅当前Windows候选的精确资产与notice工程审查，不是法律保证、Mac同名wheel审批或完整发行资格确认。只修改本文件，未改policy、候选payload、源码、安装器或远程引用。

### R.1 新实物与原字节核对

实际新fragment：`D:/RT-ResearchFlow-BuildCache/股票日线 prep-release17-rootmeta-final/candidate-fragment.json`。
SHA256 `b4962bb679552c9cbebb34b29b4e9ad115f82b504bff0cd5b0af307e5777a833`；sourceSha256 `35cf374f7016a89f7337e8f2c44fddb694aef155bc5f3d249de1c9bddf1f86ba`；policySHA `fc6b8f20c872f1ff0685c1906fefdbaae52a2f5a4c14aff3f612cf183c05b48a`。首次读取输出超限，随后仅恢复许可字段投影，没有dump依赖闭包。报告的source/policy字段不是本轮重读全部源后的验签结论。

实际363 usages、50 pending、32唯一(component,version,artifactSHA,licenseSHA)键，metadataProvenance 15。本轮按这50个许可路径读取原字节并核对：**50/50 SHA匹配**。32键集合与L/N所审旧候选完全相同；这允许精确同资产/同文本记录继续引用，不是版本哈希转移。当前Windows依然debugpy1.8.22，P节1.8.8的两条新资产记录不适用于本fragment。

新`materialize/inventory.json` SHA `a47de9bc777253bd5540ee7ae87fa8d619108fe6c7d0ca8c94404c1e87c1dbe6`，21396成员。仅对许可相关路径作过滤；没有读取用户/账户/DB。它在约定的sources/Tix/third-party目录没有所需补件记录；无python/Lib/site-packages/pip、setuptools、wheel和Lib/ensurepip匹配路径；debugpy ThirdPartyNotices仍在，SHA `e3baaa532b9e2303b187b18e05dfed48961d6d16c82d0ae47978b2fd2ce47084`。这是inventory事实，不是本轮对全执行树做独立缺失/链接证明。

六处NumPy/pandas MSVCP140库存均为 `a4c2229bdc2a2a630acdc095b4d86008e5c3e3bc7773174354f3da4f5beb9cde`。不得仅为NumPy建CRT义务而漏掉pandas的同字节使用路径。

### R.2 可执行最小policy增量，不需要重审全部176

先沿用L-001/002、N-001/002/003/004六条精确notice建议，覆盖11 pending usages；再采用L.2八条精确metadata路径，覆盖8 usages。这两组在新实物仍匹配。不是把50项都要求重新取得授权。许可及native生产门禁独立：测试green不授权许可证，文本建议也不证明native green。

本轮新增两项明确notice范围判断：

- **R-001 CPython复合原文**：当前实际36935字节原文含PSF2、BeOpen、CNRI、CWI、文档0BSD及其列出的第三方保留/不背书条款，完整原文SHA匹配。其复制/分发授予明确；PSF和CNRI要求变更摘要，完整原文及版权不得删改。本记录批准此文本/明确组件notice保留范围，不给Windows install LICENSE内Microsoft附加条款授权，也不替代变更摘要交付。之前E.2把此全文与整个PBS的CRT悬置混在一起，现明确拆开：CPython notice可肯定，CRT仍独立阻seal。
- **R-002 NumPy复合原文**：当前三份实际原文SHA一致，I.1已完成此精确wheel内OpenBLAS DLL与官方构建产物逐字节归属、正常GCC构建和运行库例外路径审查。BSD/OpenBLAS/LAPACK及GCC例外不是整包GPL障碍；这些原文已保留。本记录批准该复合notice范围，不覆盖其附带Microsoft CRT，不把未审平台wheel套进来，也不声称独立复现编译。

只有在policy/obligation实现仍逐asset保留上述CRT、变更摘要及其他additional-obligations时，owner才可采纳这些范围记录；若目前实现只会凭licenseApprovals全满足自动seal，则**先不合入，不能用文本审批吞掉资产义务**。这不是自动审批或授权主体代签。

<!-- ASTRA_LICENSE_BATCH_R_JSON_BEGIN -->
```json
[
  {
    "id": "astra-20261009-r-001",
    "component": "python-build-standalone",
    "version": "3.13.16",
    "artifactSha256": "5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778",
    "licenseSha256": "8fe98bf9822926d854f56ffd8d97877d8b942617aa44eb7ea77fd99e22f2537e",
    "spdx": "LicenseRef-CPython-Historical-Bundled-Notices",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-r-20261009"
  },
  {
    "id": "astra-20261009-r-002",
    "component": "numpy",
    "version": "2.5.3",
    "artifactSha256": "71cad2b2a7451ab79d8f5e71b453485b6775963d5cf794179144a7463fe6e8ec",
    "licenseSha256": "a804dff0ead9fadc5293456410bcbfc32bf024be9c4513459663fb7b442d2341",
    "spdx": "LicenseRef-NumPy-Bundled-Notices",
    "decision": "approved",
    "reviewedBy": "Astra / engineering redistribution review / 2026-10-09",
    "reviewReference": "resources/python-runtime/license-review.md#astra-license-batch-r-20261009"
  }
]
```
<!-- ASTRA_LICENSE_BATCH_R_JSON_END -->

L/N六条加本节两条、L八角色均采纳时，对**当前这份静态清单**预计减少23 usages/12唯一键，50到27、32到20。没有修改policy或重跑，实际当前仍50/32。补充vendor/源文件时也可能新增真实要求，不能用该投影承诺最终pending归零。

### R.3 全部32实际键与明确处理

下表的approved仅在R.2声明范围内；元数据角色不是许可授予。每行保留精确artifact和license SHA，不按包名批量归类。

| # | component/version | artifact SHA256 | license/METADATA SHA256 | usages | 结论与实际义务 |
| --- | --- | --- | --- | ---: | --- |
| 01 | charset-normalizer 3.5.2 | `78456a747de8dc58360ffa581f30a002baf5aa28cb262536545e91f113ed7639` | `49e955a09e1a159e0846872798006e8db7d518d8d70c637066fefdb08d3d9f7b` | 2 | metadata角色已审，待落policy。L.2精确metadata角色，2路径；主MIT已审，不重复授予。 |
| 02 | curl_cffi 0.16.3 | `fe87b66e324ed7318166698e02169f3208dbda32b872a27d2bc61a9c19b335eb` | `47e6ce96c02170758c16164e66f920620db614523d642eba5000ba0c7aa2be6e` | 1 | notice-approved建议 astra-20261009-n-003。binding MIT已审；METADATA不作为libcurl/TLS许可闭包。补N.3精确DLL的producer及静态依赖notices映射。 |
| 03 | curl_cffi 0.16.3 | `fe87b66e324ed7318166698e02169f3208dbda32b872a27d2bc61a9c19b335eb` | `d9194718d88bef3b8a798962115010edf0c4582d2f5fd70d2a360a80e236d309` | 1 | 义务待履约/适用性待证。binding MIT已审；METADATA不作为libcurl/TLS许可闭包。补N.3精确DLL的producer及静态依赖notices映射。 |
| 04 | debugpy 1.8.22 | `f49b1d6cecf326b63c06d7f517e4a6642777f758c58cb799e7bc5a6dd74721c2` | `649844f60da138e54b9bcc13338c62c5f97be8612cb6249ac10f84bbb97ffc88` | 1 | notice-approved建议 astra-20261009-n-004。Windows当前1.8.22：主MIT用N-004；ThirdPartyNotices须纳入要求和可读源取得入口。不得借用P节1.8.8记录。 |
| 05 | ipykernel 7.4.0 | `a6757f790ddc5a6006b813d82da1a9dbb65b3a00f2b6607df776418c6566ec1c` | `39f6a0cbe6a0d0b404880684902f085c1c6c93947d218b317b0d8a9c3ee1a137` | 1 | metadata角色已审，待落policy。L.2精确metadata角色，1路径；主BSD已审。 |
| 06 | lxml 6.1.3 | `e477aca0bc0d19f3b4ae9e4f2a1cfd687c31bf772d78734910658186b40b2477` | `4038f4e4decac1c15eb5fd883abf1370f2df9b176b53bd172dd709d4542e2a48` | 1 | 义务待履约/适用性待证。原BSD与复合原文保留；B节六份固定source/build材料、LGPL2.1文本和可重链接输入必须实际纳入并验证。metadata不能消解此义务。 |
| 07 | lxml 6.1.3 | `e477aca0bc0d19f3b4ae9e4f2a1cfd687c31bf772d78734910658186b40b2477` | `df682c668de65321677b5e4861dca4128a8bad8067f230956e9da3f985b3d398` | 1 | 义务待履约/适用性待证。原BSD与复合原文保留；B节六份固定source/build材料、LGPL2.1文本和可重链接输入必须实际纳入并验证。metadata不能消解此义务。 |
| 08 | lxml 6.1.3 | `e477aca0bc0d19f3b4ae9e4f2a1cfd687c31bf772d78734910658186b40b2477` | `e7c3ce8d76331b0101cc46790ab43958ea90a364bcf962ed8763d5a818340e69` | 1 | 义务待履约/适用性待证。原BSD与复合原文保留；B节六份固定source/build材料、LGPL2.1文本和可重链接输入必须实际纳入并验证。metadata不能消解此义务。 |
| 09 | mini-racer 0.12.4 | `9446e3bd6a4eb9fbedf1861326f7476080995a31c9b69308acef17e5b7ecaa1b` | `48ca3140561c2fea05f5d8b10c8a7bd5a1229241eaeee80c53d5b80d823abada` | 2 | notice-approved建议 astra-20261009-n-002。ISC主文/AUTHORS用N-001/002；METADATA不能代替实际V8/ICU及编入组件notices，按N.3精确DLL/resources绑定补件。 |
| 10 | mini-racer 0.12.4 | `9446e3bd6a4eb9fbedf1861326f7476080995a31c9b69308acef17e5b7ecaa1b` | `554401102688806b6a517f6aa80c8eca6b52ec409f555c8f4e9e4e3789b5d235` | 2 | notice-approved建议 astra-20261009-n-001。ISC主文/AUTHORS用N-001/002；METADATA不能代替实际V8/ICU及编入组件notices，按N.3精确DLL/resources绑定补件。 |
| 11 | mini-racer 0.12.4 | `9446e3bd6a4eb9fbedf1861326f7476080995a31c9b69308acef17e5b7ecaa1b` | `5d9a67548f4c86b6b6900db11e7c0c94fd09747db2372cd75d476a84df0f1617` | 2 | 义务待履约/适用性待证。ISC主文/AUTHORS用N-001/002；METADATA不能代替实际V8/ICU及编入组件notices，按N.3精确DLL/resources绑定补件。 |
| 12 | mootdx 0.11.7+rt.1 | `35f282624ed7a2a6908b4b847fba9119e7fb376cd00797606ee5ee97b6139f77` | `2396fc7f7d0ef66a10131945db5bac5e42243df2aa2efad87f6d26770b400521` | 1 | 义务待履约/适用性待证。MIT原文/AUTHORS明确保留；METADATA有非商业陈述，不擅自改成全MIT批准。精确0.11.7+rt.1修改/再分发范围需澄清，或独立授权实现替换后重新锁闭包。 |
| 13 | mootdx 0.11.7+rt.1 | `35f282624ed7a2a6908b4b847fba9119e7fb376cd00797606ee5ee97b6139f77` | `6e7b7bde9bf124e306122b8aabe46eb81e12a37ea74777d708b79c958aab051c` | 1 | 义务待履约/适用性待证。MIT原文/AUTHORS明确保留；METADATA有非商业陈述，不擅自改成全MIT批准。精确0.11.7+rt.1修改/再分发范围需澄清，或独立授权实现替换后重新锁闭包。 |
| 14 | mootdx 0.11.7+rt.1 | `35f282624ed7a2a6908b4b847fba9119e7fb376cd00797606ee5ee97b6139f77` | `ee03a051e103766e566b0a3ac0532daa665bb063cf8f30de46fd7c7ac9d00ec6` | 1 | 义务待履约/适用性待证。MIT原文/AUTHORS明确保留；METADATA有非商业陈述，不擅自改成全MIT批准。精确0.11.7+rt.1修改/再分发范围需澄清，或独立授权实现替换后重新锁闭包。 |
| 15 | numpy 2.5.3 | `71cad2b2a7451ab79d8f5e71b453485b6775963d5cf794179144a7463fe6e8ec` | `451a9b8028000588e66b0b415587b6aef0bbc51a96d8e8a0cba0dc23acf64f99` | 3 | 义务待履约/适用性待证。原复合条款已审，GCC例外实际producer/同字节DLL依据I.1；METADATA不代替对应LICENSE，随包MSVCP独立列入CRT义务。 |
| 16 | numpy 2.5.3 | `71cad2b2a7451ab79d8f5e71b453485b6775963d5cf794179144a7463fe6e8ec` | `a804dff0ead9fadc5293456410bcbfc32bf024be9c4513459663fb7b442d2341` | 3 | notice-approved建议 astra-20261009-r-002。原复合条款已审，GCC例外实际producer/同字节DLL依据I.1；METADATA不代替对应LICENSE，随包MSVCP独立列入CRT义务。 |
| 17 | pandas 3.0.6 | `f3ce8a6968045481e91a3990e797e348ce13db45ee164a7095bbc824e26c09dd` | `9eb4d20fc21b7851d6f782bd5186ded152fce80a48ac93120bf88e03c89ebc39` | 3 | metadata角色已审，待落policy。L.2精确metadata角色，3路径；仅3.0.6此wheel，不转用3.0.3；实际MSVCP独立保持CRT义务。 |
| 18 | python-build-standalone 3.13.16 | `5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778` | `76900732e5f075b725f754000ad5cab1b2cf89e355c1570138476956b6413cd3` | 2 | 义务待履约/适用性待证。Windows附加Microsoft条款：发行资格/合法分发链、实际REDIST映射与接收者条款仍缺，不能由PSF记录覆盖。 |
| 19 | python-build-standalone 3.13.16 | `5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778` | `8cdff3addb9e9eb108c78e2cf5e05f26b216c098304945733bbec382b2eaef66` | 1 | 义务待履约/适用性待证。Tix许可明确；I.4三份固定原文及SHA必须实际入payload，当前约定目录无记录。 |
| 20 | python-build-standalone 3.13.16 | `5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778` | `8f2d533ab34899499d5b07f209854b101b17dba2c69f3251860aecf3e4005faa` | 1 | 义务待履约/适用性待证。Sleepycat条款：做精确Windows组件适用性证明；仅notice不等于运行代码存在，也不能未经验证声明不存在。 |
| 21 | python-build-standalone 3.13.16 | `5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778` | `8fe98bf9822926d854f56ffd8d97877d8b942617aa44eb7ea77fd99e22f2537e` | 1 | notice-approved建议 astra-20261009-r-001。新R-001，CPython复合notice文本肯定；PSF/CNRI修改摘要及独立CRT条件仍需履约。 |
| 22 | python-build-standalone 3.13.16 | `5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778` | `a9d66f1d526df02e29dce73436d34e56e8632f46c275bbdffc70569e882f9f17` | 4 | notice-approved建议 astra-20261009-l-001。沿用L-001，4处实际相同BSD-2-Clause原文。 |
| 23 | python-build-standalone 3.13.16 | `5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778` | `ad89e3fed746413af1d34d5353978ee1520cedd361c853f8022e7bb210ac6b31` | 1 | 义务待履约/适用性待证。旧OpenSSL/SSLeay广告/署名条款；实际3.5.9不是1.1。保留原notice，并以组件适用性记录证明未分发旧实现，不以改标签消除。 |
| 24 | python-build-standalone 3.13.16 | `5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778` | `e93716da6b9c0d5a4a1df60fe695b370f0695603d21f6f83f053e42cfc10caf7` | 4 | 义务待履约/适用性待证。归档pip certifi声明；新inventory无pip/ensurepip运行路径。可作archive-notice-only范围证据，但须由最终树校验绑定，不能套用provider certifi审批或虚构源码。 |
| 25 | python-build-standalone 3.13.16 | `5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778` | `ed72ce2b51ee58f117e5a021e2e04af158857f40269fbc03491f0b2a99dbcc96` | 1 | notice-approved建议 astra-20261009-l-002。沿用L-002，Apache-2.0；新inventory OpenSSL3 DLL哈希仍与L.3相同。 |
| 26 | python-build-standalone 3.13.16 | `5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778` | `f353accfe2976df31ea297a77d1d454bd51ef6be8c3df39bd6aca95901579357` | 1 | 义务待履约/适用性待证。X11/TekHVC复合条件：保留全文，明确实际包含范围和相应宣传/标识条件；无组件证明时不自动not-applicable。 |
| 27 | pyzmq 27.2.0 | `2c218c6ab8bc447ba62054b581fd30209689d199c6ecb253f79615ca74a38e12` | `1f256ecad192880510e84ad60474eab7589218784b9a50bc7ceee34c2b91f1d5` | 1 | 义务待履约/适用性待证。libzmq4.3.5源归属及MPL路径已明确：补I.2固定tar与可读取得说明，不要求LGPL式重链接，不永久索要笼统商业许可。 |
| 28 | tdxpy 0.2.7 | `5514d35608fac2c7b2acf693de6f41ba7ccda58207b65a3f374c89887560737c` | `e2763ae0262af4f042ea0e817f9c4252cd291caa589d0586b818e002f0ca8100` | 1 | 义务待履约/适用性待证。精确METADATA含不得用于商业目的；与MIT并存，不能将其降为普通metadata删除。固定版本分发范围需书面澄清或合法替代。 |
| 29 | tdxpy 0.2.7 | `5514d35608fac2c7b2acf693de6f41ba7ccda58207b65a3f374c89887560737c` | `fd2d2d610584198f900995e2d3ce121a2fd50c61416a74bb3de40cc88dffa2dd` | 1 | 义务待履约/适用性待证。精确METADATA含不得用于商业目的；与MIT并存，不能将其降为普通metadata删除。固定版本分发范围需书面澄清或合法替代。 |
| 30 | wcwidth 0.9.2 | `2a9746de704242bd4fdaabb31dd46b82f694a56a8d21081ad89b679a89da9fec` | `6dc0797cb9f62b83fb85c792bcf3800d350c83368d00a2e03a5d2fde3739907e` | 2 | metadata角色已审，待落policy。L.2精确metadata角色，2路径；保留实际Unicode/作者条款。 |
| 31 | xlrd 2.0.2 | `ea762c3d29f4cca48d82df517b6d89fbce4db3107f9d78713e48cd321d5c9aa9` | `ae263dba4d616210bb2d709cd091ba453984314f79f8f50f44af864352656dec` | 1 | 义务待履约/适用性待证。I.3完整David Giffin确认句+原LICENSE进入可读runtime-NOTICES及适用宣传材料；保留AGPL组合范围判断，不用BSD标签覆盖广告条款。 |
| 32 | xlrd 2.0.2 | `ea762c3d29f4cca48d82df517b6d89fbce4db3107f9d78713e48cd321d5c9aa9` | `b5a5dbce60265e305a815a6cb83ed07f24519d8ba644f2a307994488bced8815` | 1 | 义务待履约/适用性待证。I.3完整David Giffin确认句+原LICENSE进入可读runtime-NOTICES及适用宣传材料；保留AGPL组合范围判断，不用BSD标签覆盖广告条款。 |

### R.4 给payload owner的最短可实施补件

1. **Tix**：从I.4固定官方源包 `f7b21d115867a41ae5fd7c635a4c234d3ca25126c3661eb36028c6e25601f85e` 安全取三原件；目标 `licenses/tix-8.4.3.6/docs/license.html_lib` SHA `9149f81c6efd1c3cef68742b67dc6f1b6211f32f425f3b6d24cf5279668cfd27`、`docs/license.tcltk` SHA `def74f610b8682dd12a772954ee8ad07d304cdf106abb6e030f71ee489419d1a`、`license.terms` SHA `91ff35309038fcfab853c8634b7b743a179c211d8ff3cb174b579c8af3c3072d`。来源已审、授权明确，不再等泛化许可咨询；要补的是实际文件和inventory。
2. **libzmq**：将I.2官方 `zeromq-4.3.5.tar.gz`（2530237 bytes，SHA `6653ef5910f17954861fe72332e68b03ca6e4d9c7160eb3a8de5a5a913bfab43`）加入 `licenses/sources/zeromq-4.3.5.tar.gz`，保留已在tree的MPL原文，加入I.2可读取得说明并核对路径。MPL不要求把整个应用改成MPL，也不要求LGPL式链接对象。
3. **可读runtime-NOTICES**：合入I.3完整xlrd确认句、N.3当前debugpy1.8.22的源取得路径，以及下面CPython说明。保留原条款和不背书条件；涉及xlrd的适用宣传材料仍应保留确认句。不能用我们文档中的模板当作它已经进入产品payload。
4. **CPython变更摘要**：不凭空宣称解释器源码未变。由producer以实际prep操作记录填写“源资产及构建身份、分发裁剪、重定位、外置bootstrap/adapter的增补、任何实际源码/二进制修改”；把摘要加入可读notice并纳入inventory。无需向PSF另外申请普通分发许可。
5. **有具体范围的未闭合项**：lxml用B节六份固定来源闭合实际对应源/链接输入；mini-racer和curl_cffi用N.3固定DLL/资源hash建立producer到vendor notice闭包；BDB/X11/旧OpenSSL/PBS pip-certifi用目标资产适用性证明，不把仅存档的文本自动当执行代码；CRT发行资格、REDIST和接收者安排仍需实际证据；mootdx/tdxpy需解决精确非商业陈述范围。以上不能被新增notice-approved记录绕过。

可交payload owner的CPython可读段落（变更清单须实际填写，不留占位符发布）：
```text
CPython 3.13.16, distributed through python-build-standalone
The original Python and incorporated-software license terms are retained at:
licenses/python-full/python/licenses/LICENSE.cpython.txt
The Windows binary build has additional terms retained at:
licenses/python-install-only/LICENSE.txt

These files preserve the original copyright notices and disclaimers.
No endorsement by the Python Software Foundation or other upstream
contributors is claimed. Separate Microsoft runtime conditions are not
replaced by the Python license.

The accompanying runtime provenance and modification summary identify
the upstream build and the packaging changes made by this distributor.
```

权利判断来源沿E.2/I/L/N的固定官方资产、原文和producer记录；本轮没有新网络查询，也没有转用Mac资产审批。三平台原生通过、formal source绑定、安装签名/包验收继续独立；本节不改变candidate/releaseEligible状态。

## S. R批次可机读交付及分发条件分层（2026-10-09）
<a id="astra-license-r-policy-delivery-20261009"></a>

交付文件：`D:/RT-ResearchFlow-BuildCache/astra-license-r-policy-delta-20261009-01.json`，kind `rt-astra-license-policy-delta-v1`。此为Astra自己的内部缓存交付，不是产品payload，不上传其中的本机路径，不修改Socrates policy。包含：

- `licenseApprovals`：L/N/R合计8条精确component/version/artifactSha256/licenseSha256/spdx/decision/reviewedBy/reviewReference记录；reference统一指向R节现有明确anchor，同时在approvalScopes保留原审查reference。
- `metadataProvenance`：L节8条精确路径/metadata SHA角色；不是8条新许可。
- `approvalScopes`：每个审批ID的实际原件路径、批准范围及必须保留的其他义务。它是交接信息，不凭空扩展现policy schema；owner只把现有schema接受的数组字段合入，资产义务应由现有obligation机制持续执行。
- `remainingEvidence`：当前静态余27 usages/20键，每键全asset/license SHA、所有路径、类别、具体最小行动与reviewReference。
- `supplements`：Tix固定源与三成员的URL/hash/目标路径，libzmq源的URL/hash/目标路径，以及可读NOTICE模板索引。
- `mergeInstructions`：四元键匹配、重复ID冲突拒绝、跨平台不可继承、原文批准不得吞掉资产义务、重算policy/inventory/source证据等规则。

这份delta的独立实物基线仍为R节fragment `b4962bb679552c9cbebb34b29b4e9ad115f82b504bff0cd5b0af307e5777a833`，非未经读取的新8337许可清单。母线程已独立接受8337三端完整prepare/source（用户告知），本记录不重复否定该技术验收；但应用本delta须按新实物精确键匹配，不把原Windows结果转为Mac wheel授权。当前Windows debugpy1.8.22与P节1.8.8审批完全分开；同ThirdPartyNotices SHA只证明文本同字节，不证明资产相同。

### S.1 不能把pending翻译成禁止分发

**目前没有确证某个条目在所有用途、所有合规分发方式下都一律禁止分发。** 有条件授权、用途范围不明、材料未交付是不同情形：

| 类别 | 当前实际范围 | 最小处理，非笼统human占位 |
| --- | --- | --- |
| 明确存在用途限制文字，适用范围需澄清 | mootdx0.11.7+rt.1和tdxpy0.2.7共5键/5 usages | 实际METADATA有不得商业用途的陈述，主LICENSE是MIT。不能擅自抹去限制，也不能只凭两段文字裁定所有免费再分发都违法。确认精确版本、修改、随应用分发及用户用途是否属于该声明；商业用途不能按已获授权放行。确需超出范围时取得授权或采用合法独立实现。只加NOTICE不解决用途限制。 |
| 有条件的发行资格，尚未证明，不是已证无资格 | Windows PBS附加Microsoft条款1键/2 usages；另需覆盖NumPy/pandas及其他实际PE内Microsoft code | 提供适用许可或合法分发链、REDIST映射及接收者保护安排。不要求Microsoft为金融应用另开特许；不能把“拿到了DLL”当主体资格，也不把资格缺证说成法律当然禁止。 |
| 可通过对应源及重链接材料履约 | lxml3键/3 usages | GNU libiconv适用条件可履行。B节六份source/build是明确候选，需实际producer归属或透明派生重建；交付完整条款及足够重新链接的source和/或objects、脚本和说明。无需机械坚持必须取得原producer每个obj，但只有源码URL或原.pyd也不充分。 |
| 普通来源/原文补齐，无已证禁止 | Tix1键、pyzmq1键 | Tix三件固定原文；libzmq对应源与可读取得说明。两者材料来源已审，按SHA实际纳入即可推进，不需要再申请普通商业特许。 |
| 署名交付及组合范围 | xlrd2键/2 usages | 完整保留原LICENSE与David Giffin确认句，适用宣传材料亦带句；这关闭确认句缺口，但不能擅自替代其与AGPL的实际组合判断。不得给一份广告条件文本贴BSD标签后忽略额外条件。 |
| vendor原文归属待补，并非主许可未知 | mini-racer1键/2 usages、curl_cffi1键/1 usage | wrapper ISC/MIT已明确；定位N.3精确DLL/资源的producer和V8/ICU/TLS/压缩实际组件，补其原notice及需要的源，不凭常见依赖猜版本。 |
| 内部角色/适用性证据，不是法律禁令 | NumPy METADATA1键/3 usages；PBS BDB/X11/旧OpenSSL/pip-certifi4键/7 usages | NumPy元数据关联到原复合LICENSE，保留内容；PBS按实际代码/链接范围区分运行组件与存档notice。不存在的运行组件不必虚构源码包，存在的必须按真实条款履约。不能只凭notice文件存在或不存在判断链接事实。 |

以上合计20键/27 usages。debugpy vendor、CPython变更摘要、NumPy/pandas CRT是跨条目义务，不因计数减少消失。

### S.2 最短发布补充路径

1. policy owner先按四元键合入JSON内8+8，保留scope及资产义务。若相同ID已存在且全部字段一致则去重；不把现有approved覆盖为另一资产，也不按版本号给新Mac wheel自动放行。
2. 同一材料补齐阶段，把Tix三原件、libzmq固定源、xlrd确认句、debugpy实际第三方全文及随包源路径、CPython实际变更摘要纳入可读许可证入口、inventory和SBOM。源/notice原件已定位的项目不再等待泛化法律批准。模板不可冒称未落盘的源归档已经交付。
3. 并行处理四个有限事项：CRT发行资格及REDIST；mootdx/tdxpy精确用途范围；lxml对应源/重链接；mini-racer/curl_cffi精确native notices。归档类条目做受证适用性记录，不无限保留NOASSERTION，也不假装not-applicable。
4. 重新生成受新policy和补件inventory绑定的candidate/handoff，再走formal seal、签名和安装产物门禁。无需请求行情、账户或交易来验证许可证；已接受的技术证据只在其SHA绑定仍成立时沿用，不能回填旧receipt。

本轮只有内部JSON及本文件写入，没有下载、执行或安装provider，没有读取主体账户或替任何主体签署法律文件。法律争议范围仍作工程风险边界记录，不给法律保证。

<a id="astra-license-applicability-t-20261009"></a>

## T. Target applicability and non-commercial test distribution (2026-10-09)

本节按用户明确的本轮非收费、开源、学习测试分发用途，收窄前文B/D/E/N/R/S的过宽表述。不改变实际资产pin，不替换原许可证，不把尚未生成的目标缺席证明写为已完成；不直接修改policy。审批对象是实际交付代码和使用/分发方式，不是历史复合notice中每个名字。

### T.1 lxml: exact Windows libiconv scope, not blanket LGPL

已审Windows wheel为lxml-6.1.3-cp313-cp313-win_amd64.whl，SHA256 `e477aca0bc0d19f3b4ae9e4f2a1cfd687c31bf772d78734910658186b40b2477`。lxml主库BSD、libxml2/libxslt的MIT类许可不因复合LICENSES出现LGPL而整体变为LGPL。

B节已有实际候选观测，不是本轮重跑：
- `lxml/etree.cp313-win_amd64.pyd`：4033024 bytes，SHA `743cd66d1caee61baae5e19f9bb1bf373edcb778562fa17eea969ad4dc712f7c`。
- `lxml/objectify.cp313-win_amd64.pyd`：1744384 bytes，SHA `0589acb808a4cc0b96b12cd30d582969b7ca9b403a2b61c0b79f5886cd6d463e`。
- 实际模块报告 `ICONV_COMPILED_VERSION=1.17`，libxml2 2.11.9、libxslt 1.1.45；常规PE imports没有独立iconv/libxml2/libxslt DLL。B节固定上游Windows构建配方采用静态库；当前wheel的LICENSES明确声明binary wheels中的iconv。
- 因此有依据把GNU libiconv 1.17列为该Windows二进制集合的实际合规对象，而不是凭LGPL字符串制造义务。但编译常量和无DLL import不是每个PYD所有静态链接对象的完整证明；精确哪个PYD保留了哪些iconv对象及原producer补丁归属，仍须链接map/producer构建记录或受审固定重建确认。不能把这里写成已逐对象完成审计，更不能外推不同Mac wheel。

实际源候选 `winlibs/libiconv@880a1fa8b5581e37e136a7b051947d3ea39097b6` 的COPYING.LIB为LGPL2.1，原SHA `dc626520dcd53a22f727af3ee42c770e56c97a64fe3adb063799d8ab032fe551`；逐文件v2-or-later标识继续保留。该源的命令行iconv.exe另有GPL范围，不自动归到未交付的runtime utility。

适用条款是LGPL2.1第4节与第6节，静态包含时可走6(a)/6(d)：交付对应libiconv源码及修改、足以重链接相应组合二进制的源码和/或对象及构建材料，随包或与二进制同处等效取得；保留全文、归属说明和自用修改/调试权利。无需机械索要原producer全部obj，不要求Electron业务全部改LGPL，也不要求额外商业特许。若实际采用符合6(b)的可替换共享库机制，按该路径履约，而不是继续强制静态对象方案。
原文：[COPYING.LIB第4/6节](https://raw.githubusercontent.com/winlibs/libiconv/880a1fa8b5581e37e136a7b051947d3ea39097b6/source/COPYING.LIB)。

target-absence可关闭的精确条件：绑定目标wheel/PYD SHA的producer组件清单与链接输入，证明GNU libiconv未进入任何交付代码（例如实际禁用或明确使用非GNU系统实现），并与最终tree的动态依赖/成员相符。只有无iconv.dll、grep未找到字符串、metadata标签BSD或某次未调用编码功能都不足。若证实不存在GNU实现，本项标为`not-applicable-to-target`，保留历史notice，无需为不存在的库提供LGPL重链接材料。当前Windows已有相反的编译/构建证据，不可直接按absence关闭；Mac按各自实物判定。

### T.2 PBS: Berkeley DB absence versus actual Tix payload

固定Windows PBS artifact SHA `5e100ee3d592ff500f4408a624f054d202e32d9dba8a12b2226bef81083fd778`；full PYTHON.json SHA `c2bd7a699f18cd48dbf701b55a1229dcecec3e2ac74b59fba350fe52d4153e98`。已读元数据未见Berkeley DB扩展/链接声明，原install-only成员未见bsddb/Berkeley DB库。CPython历史移除bsddb与此相符，但Python版本号本身不证明PBS及所有provider没有另行vendoring。标准库`bdb.py`是调试器，不能作为Berkeley DB命中。
主源历史：[PEP3108](https://peps.python.org/pep-3108/)。

**BDB最小关闭证明，不要求无限制逆向：**
1. 精确PBS源资产及其构建组件/extension/object/link清单，记录无Berkeley DB及_bsddb；使用已有完整PYTHON.json和对应构建输入即可，不凭仅有一个空搜索结果。
2. 绑定最终目标inventory/root hash，核对未分发bsddb/bsddb3/berkeleydb模块、libdb/相关BDB二进制/静态对象或源码实现；provider闭包也作组件归属核对。若全树可由受审输入和确定裁剪映射覆盖，不另要求穷尽机器码扫描。
3. 剩余仅LICENSE.bdb及历史文档时，记录`archived-notice-only / not-applicable-to-target-code`；保留原文，从执行代码的Sleepycat源码义务门禁中排除，不伪造MIT批准。报告绑定asset SHA、target、inventory SHA、build-metadata SHA、检查范围/结果、reviewRef。
既有证据支持优先走此关闭路线，而非先购买BDB商业许可或要求应用源码履约。当前尚未独立读取最终8337的该项完整报告，因此没有声称它已经落盘通过。

**Tix与BDB不同：** 既有install-only实物含`python/tcl/tix8.4.3/tix84.dll`，full元数据也引用Tix。这是实际交付证据，不是历史notice推断。即使程序不调用Tk/Tix，DLL与Tcl脚本随包仍是分发。最短路径是R/S已固定的三原始notice加入payload，不需另申请普通分发许可。
若由owner明确采用裁剪方案，target-absence报告必须证明整个Tix DLL、Tcl实现/scripts/pkgIndex/相关实质代码均未随包，并绑定裁剪配方及最终inventory；只删DLL或仅禁用import不够。留存原始许可证档案不妨碍absence关闭。此处不指示删库，也未修改runtime。

### T.3 mootdx / tdxpy: executable limited-purpose conclusion

本轮已明确用途为非收费开源学习测试；不是商业收费授权，也不涉及真实行情访问许可。已审精确资产：
- mootdx0.11.7+rt.1：`35f282624ed7a2a6908b4b847fba9119e7fb376cd00797606ee5ee97b6139f77`，MIT原LICENSE SHA `ee03a051e103766e566b0a3ac0532daa665bb063cf8f30de46fd7c7ac9d00ec6`。
- tdxpy0.2.7：`5514d35608fac2c7b2acf693de6f41ba7ccda58207b65a3f374c89887560737c`，MIT原LICENSE SHA `fd2d2d610584198f900995e2d3ce121a2fd50c61416a74bb3de40cc88dffa2dd`。
原README/METADATA非商业表述继续原样保留；MIT正文提供复制、修改和分发授权。无需在本次用途内先裁决这些文字对所有未来商业场景的法律效力。

**工程结论：本轮限定用途可以有条件推进分发，不再要求先取得额外商业授权函。** 前文“一律须书面澄清否则阻seal”对本轮用途过宽，以本节为准。可执行条件：
1. 真实用途为学习/研究测试，不只是价格为零；不得将这份结论用于收费打包、商业服务或商业运营。是否出现此类新用途再单独处理，不要求证明所有未来使用者永不商业使用。
2. 原MIT全文、作者/README或METADATA中的声明完整随包，可读入口保留；派生mootdx的原来源、补丁、0.11.7+rt.1身份和对应源码/变更说明一并提供，不删争议文字，也不宣称上游担保或授权行情数据。
3. 将发布说明中的“本次非收费开源学习测试，未评估商业使用”作为本项目当前分发范围说明；不要擅自重写上游MIT为新NC许可证，或向整个AGPL项目追加非商业限制。该结论不是MIT与限制性条款一切组合均兼容的保证，也不能仅因子进程隔离便宣称必然属于纯聚合。
4. policy若支持用途/义务的受约束审批，将上述asset/license原字节、用途、notice/源码delivery proof、reviewRef共同绑定；若仅支持无范围的approved，不用该布尔值冒充无条件商业批准，应沿既有obligations机制约束本轮发布。

可直接采用的发布范围说明：
> 本次提供非收费的开源学习与测试版本。随包mootdx/tdxpy保留其原始MIT许可、作者信息及上游学习交流/非商业用途说明；派生修改另有标识。本次分发不主张已取得商业使用或第三方行情数据授权，未变更其他组件的许可证。

以上为基于实际原文和明确用途的有界工程审查，不是法律保证。lxml/BDB/Tix按上述精确target证据分别关闭或履约；本节不把候选许可适用性判断替代最终tree、bootstrap、签名或安装验收。

<a id="astra-lxml-relink-u-20261009"></a>

## U. Windows lxml source material delivery and source-based relink plan (2026-10-09)

本轮实际把六份固定源码归档下载到独占缓存 `D:/RT-ResearchFlow-BuildCache/astra-lxml-relink-20261009-01`；各包写入前实际字节数/SHA全部符合B节旧pin，没有执行上游代码或重新构建wheel。

机器交付：[source-relink-delta.json](D:/RT-ResearchFlow-BuildCache/astra-lxml-relink-20261009-01/source-relink-delta.json)，9316 bytes，写入字节SHA256 `0d4154519b7eae84197bb2f92440037715870ceefb6809eb7e7108cc4b24dfa5`。
构建/重链接交接：[RELINK.md](D:/RT-ResearchFlow-BuildCache/astra-lxml-relink-20261009-01/RELINK.md)。

| 源码对象 | 固定原始来源 | bytes | SHA256 |
| --- | --- | ---: | --- |
| lxml | [lxml-6.1.3.tar.gz](https://files.pythonhosted.org/packages/23/ad/28ecd7cb894d172f3c9c80a075eeeb2017ac62e3632cee05a5f9493547eb/lxml-6.1.3.tar.gz) | 4211198 | `45222d94ddd511536f3b2f7d9deae3b2339b4ce0f075f1ca25703b07cad9dd21` |
| libiconv | [libiconv-880a1fa8.tar.gz](https://github.com/winlibs/libiconv/archive/880a1fa8b5581e37e136a7b051947d3ea39097b6.tar.gz) | 5313881 | `89dd45d7f074ddae04dcd25cc4ceace3432c04b72dc36a6508854aac713f3eb6` |
| libxml2 | [libxml2-bb846788.tar.gz](https://github.com/winlibs/libxml2/archive/bb84678855e3407fc88180295c992f9c984e28e0.tar.gz) | 4225102 | `5182396205f97b183d34ab8dadd7693523c7d4e2137394aec02514a5a9a9dcf0` |
| libxslt | [libxslt-c0076eaa.tar.gz](https://github.com/winlibs/libxslt/archive/c0076eaa6e0d1f99e01107e8db225a308eb1e543.tar.gz) | 2705214 | `d687aaf48527e042d942dccbc74fbcd150588522305e63d3e91785d9b6590677` |
| zlib | [zlib-0089522e.tar.gz](https://github.com/winlibs/zlib/archive/0089522e62e6b5d4950e62bd20f0cb06a9288413.tar.gz) | 1559272 | `e2af9f28fcdf723e464b40af73fdeed07ce3e581a9ea110702c1ba733983f8a0` |
| build-recipe | [libxml2-win-binaries-4e8ae01f.tar.gz](https://github.com/lxml/libxml2-win-binaries/archive/4e8ae01f61145dc823ce2ae1d79f06241b7b46de.tar.gz) | 4262 | `cd155987f5269d04acb549d8664b50b1ea0bf3580e1ab709587a03e4bda4396e` |

实际旧Windows wheel/PYD与LIBXML/LIBXSLT/ICONV版本对应T.1及JSON：wheel `e477aca0bc0d19f3b4ae9e4f2a1cfd687c31bf772d78734910658186b40b2477`，lxml6.1.3.0/libxml2 2.11.9/libxslt1.1.45/iconv1.17。原生配方把iconv命名为1.17.1 Windows包，不据此虚构GNU版本。zlib1.3.2是配方标识，不冒称来自实际模块版本常量。

### U.1 本轮新增实际源码检查及最小可实现路线

已对固定归档进行只读成员检查：lxml的etree/objectify/builder/_elementpath/html.diff/html._difflib/sax七个生成C原件均存在。libiconv MSVC17项目有Release/x64、v143、Windows SDK10.0.20348.0及MultiThreadedDLL；需把实际工具链固定，不能把PBS运行时当完整开发SDK。上游build.ps1使用Pscx、隐式msbuild平台、假定输出目录及未全面校验的外部进程退出码，不能直接当已验封闭配方；Release/x64项目输出目录与脚本预设x64/lib不一致应由受控wrapper解析实际TargetPath，而不是猜路径。

实施owner可基于原配方按顺序构建iconv静态库、zlib、libxml2、libxslt，固定本地include/library输入，逐步检查退出码/架构/输出hash。保留原脚本及所有透明适配diff，不依赖用户MSBuild property sheets。对lxml使用现有生成C及`--static --without-cython`本地库模式，显式提供INCLUDE/LIBRARY和LIBXML_STATIC/LIBXSLT_STATIC/LIBEXSLT_STATIC宏，清除STATICBUILD/STATIC_DEPS。**不要使用--static-deps**：实际上游Windows buildlibxml.py会查询最新release，旧缓存不能阻止漂移。此处给的是源码支持的实施路线，尚未声称该命令已实际编译成功。
主源：[固定build.ps1](https://raw.githubusercontent.com/lxml/libxml2-win-binaries/4e8ae01f61145dc823ce2ae1d79f06241b7b46de/build.ps1)、[setupinfo.py](https://raw.githubusercontent.com/lxml/lxml/lxml-6.1.3/setupinfo.py)、[buildlibxml.py](https://raw.githubusercontent.com/lxml/lxml/lxml-6.1.3/buildlibxml.py)。最终实施优先使用已固定sdist中的原字节，而非运行时访问tag URL。

### U.2 完整源码路线与剩余窄事实

LGPL6(a)允许足够的组合源码而非强求旧producer全部.obj。六源包连同所有实际patch、开发工具锁、完整构建/链接步骤、适用许可和源码取得说明，可构成待验证的材料基础；用新隔离build替换一个可识别但接口兼容的libiconv，再重链接并实际运行编码/XPath/XSLT与中文路径用例，证明材料足以使用。源码可作为同release位置的独立归档等效提供，不要求塞进主安装器。

仍缺四项具体事实：旧wheel全部producer补丁/工具/链接输入对应关系；新受控wrapper及工具链锁；真实重建及修改后重链接成功记录；最终可读源下载位置与inventory/用户自建manifest路径。不能把六包下载成功写成这四项通过。

优先自动推进路线是：以本批固定源建立透明派生wheel并记录新版本/哈希/配方，经过正常resolver/hashlock/materialize，而不是泛泛等待联系作者。若必须保留旧wheel字节，则先自动搜集其原构建记录/材料补齐对应性，不给它回填新构建的provenance。无需逐位复刻旧编译器输出才能满足有意义的重链接，但实际交付的修改源码不能缺失。标准编译器/SDK不机械要求把专有工具复制进源码包；应明确可获取工具版本和所需输入。

本轮未编译、未安装、未执行provider/行情/账户操作，未修改producer/main/policy；Windows结论不外推Mac。

<a id="astra-prep96-qa-v-20261009"></a>

## V. Independent QA of frozen preparation sources and P/R/T/U implementation (2026-10-09)

Version scope: 1.7 source preparation; no source commit or installer acceptance is inferred from local byte hashes. No prepare/native reconstruction was started. Tests execute isolated fixture APIs and child processes only; full provider/native bootstrap and packaging remain outside this acceptance.

Actual before/after/final SHA256:
- prep: `6da3b185c699a0b3592cbd56cfa0c48fe8bd69669c18a768286560305a989c6f`.
- direct test: `a7a061344f063cf97f43c324d77af01a898bd6662c32ba36507f59c85784708d`.
- policy: `f27410a7043870883fbc82872873959d220b021a3367615cd87465b06435134c`.
- seven-source snapshot: `7ff877cadb0010ef885def7995bddc40855ee65cfe78476e76454cdda4f7fd75`, unchanged through both test runs.

Astra independently executed the exact existing suite: **96/96 passed, 0 skipped, 0 errors, 18.22 seconds, exit 0**. The runner was local CPython3.13.13; relevant child tests used the pinned PBS3.13.16 and asserted its version. This is not an assertion that Mac native tests or full application bootstrap ran. The suite includes real owned-child timeout/cleanup, isolated offline pip with synthetic wheels, cached audited source-wheel reproduction and bounded source/metadata checks; it does not execute full prepare or rebuild native lxml.

Exact policy correspondence checked: P's two debugpy1.8.8 approvals; R's eight approvals and eight metadata roles; all match their reviewed asset/license keys. ThirdPartyNotices is indexed from original RECORD-bound bytes and is not granted the wrapper MIT approval. Tix archive/three-member pins match the reviewed originals. Limited-purpose mootdx/tdxpy originals/source/change records retain the no-commercial-authorization boundary. All six U source pins match; Windows-only source material handling preserves explicit rebuild/relink pending and does not transfer that approval to Mac.

### V.1 P2: core Berkeley DB linkage is omitted from absence proof

At `scripts/prepare-private-python-runtime.py:1978`, the build-reference check includes extensions and extension loading, but not core link inputs. An independently executed isolated fixture containing `build_info.core.links=[{"name":"libdb"}]` is incorrectly classified as `archived-notice-only-not-applicable-to-target-code`. That status can feed the downstream disposition.

Minimal fix: examine actual core and extension linkage/static-component evidence, not arbitrary historical license/test-package text. Keep `bdb.py` and an old `bsddb.test` name excluded. Add the actual failing boundary test; core linkage must remain present/pending. This does not assert current PBS contains BDB.

### V.2 P2: Tix absence assumes only one directory spelling

At `scripts/prepare-private-python-runtime.py:1982`, implementation detection only checks `/tix8.4.3/`. An independently executed darwin fixture containing `python/lib/libtix8.4.3.dylib` is incorrectly classified as `target-code-absent-original-terms-retained`.

Minimal fix: cover actual Tix native identities and Tcl package/script layouts with target component evidence, rather than a single directory substring. Retain the three original notices. Presence outside that directory must not close as absence. This does not assert an uninspected Mac release currently includes that binary.

### V.3 Results and conclusion

Four additional isolated boundary cases: **2 passed, 2 failed**, exactly V.1/V.2; no test harness error. Both positive controls passed (debugger/history-only BDB absence, known Windows Tix presence). No new license-obligation category was introduced.

Freeze byte identity and the existing96 suite are accepted. **Automatic target-absence closure is not accepted until V.1/V.2 are repaired.** Product source and policy were not modified; only independent D-cache QA scripts/logs/reports and this review document were written.

Evidence: [QA report](D:/RT-ResearchFlow-BuildCache/astra-prep96-20261009-01/qa-review.json), [96-test log](D:/RT-ResearchFlow-BuildCache/astra-prep96-20261009-01/unit-tests.log), [targeted log](D:/RT-ResearchFlow-BuildCache/astra-prep96-20261009-01/targeted-tests.log), [failing fixtures](D:/RT-ResearchFlow-BuildCache/astra-prep96-20261009-01/targeted_qa.py).



<a id="astra-lxml-final-eight-20261009"></a>
## Final eight lxml records: exact sanitized assets (2026-10-09)

Reviewer: Astra / engineering redistribution review. This is an evidence-bound
engineering decision, not a new license grant, legal guarantee, whole-product
approval or native runtime acceptance.

Base mapped policy SHA256:
ffa8dddfd1f31ae5168661ce6456bc8268ed8290ba8c70485e10f0952c5f2dbc

Exact four-source handoff SHA256:
e532042137da78bd283da82131800f4966ce7e8c42fe57a9228fb2fe979b80a7

Previously independently checked final asset sizes/hashes and public wrapper
entry remain the basis. This increment read the actual eight wheel notice
members (four distinct notice hashes), and inspected Mach-O load commands.
No test suite, prepare, native build, network/provider operation or installation
was run. Parent-reported native Windows job 113773696817 is not claimed as an
independently retrieved CI result. Mac consumer execution is not claimed.

### Exact decisions

- lxml-redistribution-win32-x64-0: approved; BSD-3-Clause; artifact 445653b6f07f2cab913065e5ebc946e69f485839e038d4056b27c403fc1da1c7; notice 8fc2b568133516e46845d2147917adeee1648e70ae9ab5ed6c5417afef4ce855.
- lxml-redistribution-win32-x64-1: approved; LicenseRef-lxml-6.1.3-Composite-Notices; artifact 445653b6f07f2cab913065e5ebc946e69f485839e038d4056b27c403fc1da1c7; notice 388fa99f3bde4447cd5a4cbb114037be026854db6cfe89e112691c1d8abdcf3c.
- lxml-redistribution-win32-x64-2: approved; LGPL-2.1-only; artifact 445653b6f07f2cab913065e5ebc946e69f485839e038d4056b27c403fc1da1c7; notice dc626520dcd53a22f727af3ee42c770e56c97a64fe3adb063799d8ab032fe551.
- lxml-redistribution-win32-x64-3: approved; LicenseRef-RT-lxml-Source-Notice; artifact 445653b6f07f2cab913065e5ebc946e69f485839e038d4056b27c403fc1da1c7; notice 488386eca8e74f8c83d09837394f1970f8cbb31d3d3b629dad91f8de5696ae19.
- lxml-redistribution-darwin-arm64-0: approved; BSD-3-Clause; artifact 15c6b6ae73b7a1624293c8498bc3e6df813e21301eba649a97f10e7072e6aa15; notice 8fc2b568133516e46845d2147917adeee1648e70ae9ab5ed6c5417afef4ce855.
- lxml-redistribution-darwin-arm64-1: pending; LicenseRef-lxml-6.1.3-Composite-Notices; artifact 15c6b6ae73b7a1624293c8498bc3e6df813e21301eba649a97f10e7072e6aa15; notice 388fa99f3bde4447cd5a4cbb114037be026854db6cfe89e112691c1d8abdcf3c.
- lxml-redistribution-darwin-x64-0: approved; BSD-3-Clause; artifact 0dab34eae6ec3423c326f1fe5c90f01c9ddc172f1380f03ba963e150ace73278; notice 8fc2b568133516e46845d2147917adeee1648e70ae9ab5ed6c5417afef4ce855.
- lxml-redistribution-darwin-x64-1: pending; LicenseRef-lxml-6.1.3-Composite-Notices; artifact 0dab34eae6ec3423c326f1fe5c90f01c9ddc172f1380f03ba963e150ace73278; notice 388fa99f3bde4447cd5a4cbb114037be026854db6cfe89e112691c1d8abdcf3c.

### Interpretation and required retained material

- BSD-3-Clause applies to the actual LICENSE.txt, not blanket relicensing of
  LICENSES.txt or native dependencies. Copyright, conditions and disclaimer
  remain in each selected wheel. No endorsement permission is asserted.
- LicenseRef-lxml-6.1.3-Composite-Notices denotes the unmodified LICENSES.txt
  SHA256 388fa99f3bde4447cd5a4cbb114037be026854db6cfe89e112691c1d8abdcf3c.
  It records BSD, ElementTree, PSF, source-test GPL and bundled-library terms.
  It is not a newly invented grant. Historical isoschematron paragraphs are
  retained verbatim, but the full excluded implementation/resources are absent
  from both wheel and sanitized lxml source. No permission is inferred for
  the two excluded unlicensed XSL files.
- Windows approval applies to exact wheel
  445653b6f07f2cab913065e5ebc946e69f485839e038d4056b27c403fc1da1c7
  WITH the reviewed matching public source ZIP
  bb11d4eac221254d7ab23d40775b58e5e5861f2c6bef951ef6db5a5691b045e0.
  The ZIP contains sanitized lxml C/source, the five unchanged dependency/
  recipe archives, tools, full notices, and the fixed offline public wrapper.
  The public wrapper SHA256 is
  1ff054f990cc43176dd99a2081ec5430116c676b1e7ac1a7456c2fb53ddb167a.
  It maps only sanitized lxml SHA/size and the manifest pin; original toolchain,
  dependency and build/link logic are retained. This satisfies the reviewed
  source-material/reconstruction-entry scope, not proof of identical binaries.
- LGPL-2.1-only describes the supplied version-2.1 license text. This does not
  infer a later-version option merely from the license template. Preserve this
  text and corresponding sources/relink materials. Release delivery must still
  provide matching sources with the binaries and permit user modification and
  reverse engineering for debugging those modifications. No final public
  availability or product-term compatibility is asserted by this cache review.
- LicenseRef-RT-lxml-Source-Notice denotes the exact 312-byte informational
  RT_SOURCE_NOTICE.txt, not an independent license. Its source-materials.zip
  wording is historical; the exact distribution companion is now
  lxml-6.1.3+rt.redistribution.1-win32-x64-public-sources.zip with SHA above.
  Keep the notice and supply the companion plus PUBLIC-REBUILD.md together.

### Two precise unresolved records (not a prohibition on distribution)

The arm64 and x64 composite-notice records remain pending. Both actual Mac
wheels' seven Mach-O members (both slices for universal2) list only
/usr/lib/libSystem.B.dylib in inspected dylib-load commands. This neither
proves GNU libiconv absence nor demonstrates a separately replaceable system
libiconv link. Do not use generic upstream notices alone to assert that a
specific GNU component is linked; likewise do not use these load commands
alone to assert it is absent.

The reviewed Mac public-source ZIPs
2901bf8751ae2a25ac483f6233040e931cd8d7f7fda8321a1fd7ee1faf3eef98
and 3b590453ff2b63388e2ced2f20d7affc79626b13d3d19a7281f0cedc4155ac58
contain sanitized lxml source, not the Windows dependency/relink bundle.
The shortest closure is either:
1. exact-wheel producer/link evidence establishing that no bundled LGPL
   iconv implementation is present (and identifying the actual conversion
   implementation), allowing the inapplicable LGPL paragraph to remain a
   historical notice; or
2. exact bundled iconv version/source pin, original LGPL notice, and the
   matching Mac build/link inputs or equivalent relinkable material sufficient
   to rebuild/replace that component, delivered beside the two Mac wheels.

The existing Windows materials cannot be silently credited to different Mac
native binaries. Native import/consumer success alone does not answer this
source/link attribution question. No additional whole-repository legal review
is requested. Historical unselected lxml approvals are unchanged.
