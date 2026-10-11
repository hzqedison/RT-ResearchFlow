# Mac runtime applicability review

2026-10-10。总体仍 pending；五组仅原文保留层 approved，不改 policy 或既有审批。

依据：缓存完整原文重建 UTF-8 的哈希匹配；应逐字保留全部正文。旧产品两架构清单列载对应文件，但未核验真实产品字节或最终安装包。

- certifi：保留含 MPL 引用的原文；非完整 MPL。pip 剔除不等于 provider certifi 缺席；证书束、修改与源码可得性待证。下一步绑定现有文件清单及源代码交付。
- BDB：保留含第3条的完整复合文本；DB及使用它的软件源码获取义务未闭合。_dbm 不证明后端。下一步取后端及静态链接图。
- X11：保留多权利人全部正文；保留、免责、名称等条件及代码适用性未闭合。下一步映射 Tk 后端、链接图与条件。
- legacy OpenSSL：保留 OpenSSL/SSLeay 双条款；致谢、广告、命名及旧代码适用性未闭合。下一步取 Python/Node 组件图。
- Tix：逐字保留；两份引用许可未读，实现是否随包及条件未闭合。下一步取 Tix 链接图，存在时补引用原文。

NOASSERTION 不将复合/变体文本冒称单一 SPDX。census 未使用分组计数。本轮无文件回读、联网、构建或验收；仅内存修正路径并生成10条记录。

## Exact identities and narrow decisions

Scope for every row: `notice-retention-only`. Overall applicability status: `pending`.

| Notice | Original SHA256 | SPDX text label | Retention review |
|---|---|---|---|
| pip-vendored certifi(MPL) | `e93716da6b9c0d5a4a1df60fe695b370f0695603d21f6f83f053e42cfc10caf7` | `MPL-2.0` | approved |
| BDB | `3bdff06e69991c94664f2ef5c5f8096f60b7dbec071756ea6cc26b445e06ec5b` | `NOASSERTION` | approved |
| X11 | `2daec087a88e7c9b8082557cdeebad5bbb8155a4137472f0b22e269cd99d0c1e` | `NOASSERTION` | approved |
| legacy OpenSSL | `9c04cce50c4989d5601dd8b07f6ab922c40388b66ac736c9007cb1ed9d9dd560` | `OpenSSL` | approved |
| Tix | `3ac5cdd0bef6c43ce34c6a7ced452081d9e5a0bf94082b9f9147d23ec9e214f5` | `NOASSERTION` | approved |

Original runtime asset arm64: `d8975d7df4f08f7b1c7aafcdfacbddcec3d366415f2c1a72b2466b6850815933`

Original runtime asset x64: `8e9cb087305bfb8969f68a905f79f41469d4aa5220c1aa71ada7fc9953bdba0f`

Archive (user-verified, not rehashed): `0abf5e684111dcc4367a272bd57f80873f75d3652a8bc1ddd454ffe8b624ffe9`

formal-lock.json (member hash computed in previous turn): `9a1adbc06bc64078ee2999520d11302bd09c278c553ad10b91db0d7faeb86fd1`

Source commit (user-supplied): `95b41cf09e2218f93ab97aeffab5df5d168b1f5c`. Old unchanged-runtime inventory only; not a new commit or release approval.

Original evidence: `D:/RT-ResearchFlow-BuildCache/astra-mac-runtime-license-review-20261010/original-notice-evidence.json`.

Handoff: `D:/RT-ResearchFlow-BuildCache/mac-runtime-applicability-side-evidence-20261010/source-content.json`. Ten records bind five texts to two runtime identities; source archive provenance is separate from install-only assets.
