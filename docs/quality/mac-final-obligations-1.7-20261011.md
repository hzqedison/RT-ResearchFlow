# Mac Python 五项分发材料收束（未发布 1.7.0）

日期：2026-10-11。结论：可补的原文、源码和 acknowledgment 已生成；不是人审、法律批准、实际安装运行报告或最终 seal。未改 policy approved、vars、workflow、上游代码、用户 DB 或生产安装，未连接券商或下单，未派子 agent、下载或编译。

## 当前输入与历史证据边界

现行 formal-lock：`D:/RT-ResearchFlow-BuildCache/windows-1.7-formal-inputs-current/formal-lock.json`。SHA256：`c20a1a327b91d4022746d2fc18b4a8045c31767134b14fdfae866ba2f06cd6ea`；status=locked，structuralOnly=true，releaseEligible=false。当前 receipt 的 formalLockSha256 完全相符；origin 和 receipt 都指向 prepare run **38031520327**、source commit `b91f91ce65fe8bc20e150b770128b62a5fccb98d`、source snapshot SHA256 `6b8bad51b91bd8bd811e8e4b6701fe3b3438e530fba5c6f2b345619d5441be5f`。receipt 的 sourceVerified=false、nativeBootstrapVerified=false 原样记录。旧原文审查来自 run 37960129695，只复用它的原档事实，不把旧 merge 或本次本地解析改称最新 seal。

本次只读解析 D 盘四份既存 Python 原档，均核对 SHA256 与现行输入一致。每个目标发现 **10 个 Mach-O**，全部成员与现行 lock 的路径、大小及 SHA256 一致。原档普通文件中每目标 1167 个匹配，479 个没有同名 runtime 路径，0 个内容冲突；缺少同名路径不是最终丢文件结论，其中已安装 pip 被剥离、notice 另投影到 licenses。ensurepip wheel 仍在两目标 lock 中，不能因 pip site-packages 被剥离就说 vendor 不再分发。

## 五项具体成果

| 项目 | 已补材料与真实结论 | 不能冒充完成的最小项 |
|---|---|---|
| pip/vendor certifi | pip **26.2.1**；vendor.txt=**2026.6.17**，init=2026.06.17。直接从随包 ensurepip wheel 提取全部 **6 个原始源码/数据文件**，两架构和原档安装副本逐字节一致；完整 MPL、pip license/authors/metadata/vendor.txt、收件人 README 一并交付。 | 把整套源码与 README 放进最终收件人可读的交付，并记录实际交付 manifest。 |
| BDB | 完整 **7293 字节**复合 notice；两份实际 _dbm 的九个 dbm_* 导入均以 ordinal 1 指向系统 **/usr/lib/libSystem.B.dylib**，唯一 dylib 依赖也是它；USE_NDBM、无额外 _dbm links。没有观察到 Oracle DB 库路径或指定 DB 符号候选。 | 最终包应保持此系统 NDBM 路由；若新增 bundled Oracle DB，再补准确 DB 及使用它的 accompanying software 源码/获取信息。不能用 _dbm 名字强制推定 Oracle，也不作全产品 absence 批准。 |
| X11 | 完整 **47018 字节** libX11 composite notice，另保留 libXau/libxcb 原文。无外部 libX11/Xext/xcb load，但两份 Tk 各有 **158 条 X 风格定义符号记录**，所以不宣称 X11 代码不存在。 | 实际分发完整原文并保留宣传/背书名称限制。符号无法单独确定代码所有权；若最终新增组件，复核其材料，不删减 notice 为一段 MIT。 |
| OpenSSL legacy | _ssl/_hashlib metadata 都明确关联两份许可；完整保留 legacy（含 SSLeay）和 Apache-2.0 原文，新增 OpenSSL 两种原文 acknowledgment、Eric Young、Tim Hudson attribution。 | 实际包可读交付两许可与 acknowledgment；提及功能/用途的宣传材料也要保留对应 acknowledgment，核对命名/背书限制。不能因 OpenSSL 3 名字删 legacy。 |
| Tix | 完整 **2826 字节** Tix notice 和 Tcl 原文。两目标 inventory 无 Tix 组件路径，全部 10 个 Mach-O 无 Tix 符号、全部 5 个 pkgIndex 无 Tix 注册；限定源码文本扫描无 tix 命中。不是只看 _tkinter 名字。 | 原档确实没有 **docs/license.tcltk**、**docs/license.html_lib**。若最终有 Tix，补准确两原文或源码级不适用记录；若最终组件清单确认本次无 Tix 范围，记录该限定适用性结论。Tcl 原文不能冒充前者，HTML notice 不编造。 |

### certifi 为什么现在可以交付

现成 `certifi-2026.7.22-source.tar.gz` 的 SHA256 为 `741e2c3b351ddf169a738da9f2c048608ff7f2c5cc02f1ebc6b118bb090d5d55`，**不是** pip/vendor 的对应源码：__init__.py、__main__.py、core.py 和 cacert.pem 均不同；其许可相同不代表源码相同。两架构仍分发的 ensurepip wheel SHA256 都是 `71138adf1f4ca900cdb7d289c21b7494329f2332b6d85f0e1c42108c0384ed3e`，大小 1816632 字节，与现行 lock 一致。

本次交付 LICENSE、__init__.py、__main__.py、core.py、cacert.pem、py.typed，即 wheel 中该目录所有非目录成员，既有 vendoring 的 pip 命名空间改写原样保留。本次未修改源码，也没有把 2026.7.22 伪装为 2026.6.17。PEM SHA256：`bbc7e9c01d7551bb8a159b5dedd989b8ee3ce105aff522b68eb1b01bf854cab0`，118 个证书。源码是可读 .py/PEM 原始形式，不是需要反编译的二进制；本套材料满足工程层面的准确源码提供、完整 MPL 和源码入口准备，但不冒充已被最终 installer 交付。

### 原文材料与可复核记录

材料根：`resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/`。

- `README.txt`：收件人源码获取入口、许可定位、条件性缺口与宣传要求。
- `source/pip-vendored-certifi-2026.6.17/pip/_vendor/certifi/`：六份原始源码/数据；`source/pip-context/`：四份原始 pip 上下文文件。
- `notices/`：BDB、libX11、Xau、xcb、legacy OpenSSL、OpenSSL 3、Tix、Tcl 八份原文，完整 MPL 和单独 acknowledgment。全部八份原文在两架构相同且与现行 lock 的投影原文哈希/大小吻合。
- `evidence/darwin-*-PYTHON.json`：full 原档 metadata 原始字节，不用重序列化版本替代。
- `evidence/current-input-binding.json`：当前/历史来源明确分离、现行 receipt snapshot、资产/notice/wheel/native 绑定。
- `evidence/pip-vendor-source.json`：六成员完整性、旧 certifi 对比、源码 SHA256。
- `evidence/native-dependencies.json`：所有原生文件哈希、load commands、library ordinals、导入/候选符号、完整 install_only inventory 和全部 pkgIndex 文本。不把 X 名字或阴性符号扫描当作完整静态代码溯源。
- `evidence/read-only-audit.cjs`：保存本次已用于内存解析的函数和只读复核入口；独立脚本入口未另行执行，不伪造测试通过。
- `delivery-manifest.json`：所有其他材料的大小、SHA256、来源。写前根据实际输出缓冲区计算，未进行写后重复读取；不是 installer 的交付 manifest。

## 精确剩余项

1. 将整套通知、准确源码与 README 纳入真实 Mac 交付；记录收件人能直接读取的路径和最终 artifact/member 哈希。现行 structural lock 不替代 final seal。
2. 对最终组件范围作真实适用性审查。Tix 两下级 notice 仅在确有 Tix 时补准确原文/源码级适用性说明；BDB 仅在确有 bundled Oracle DB 时补相应源码材料。X11 不再以“无外链”作为删除原文依据。
3. 由真实负责人员完成审查/受保护发布授权；本次没有改任何 approved 字段，也不生成虚构 reviewedBy 或 release-ready 状态。

## 改文件清单

- `resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/notices/LICENSE.bdb.txt`
- `resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/notices/LICENSE.libX11.txt`
- `resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/notices/LICENSE.libXau.txt`
- `resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/notices/LICENSE.libxcb.txt`
- `resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/notices/LICENSE.openssl-1.1.txt`
- `resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/notices/LICENSE.openssl-3.txt`
- `resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/notices/LICENSE.tix.txt`
- `resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/notices/LICENSE.tcl.txt`
- `resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/source/pip-vendored-certifi-2026.6.17/pip/_vendor/certifi/LICENSE`
- `resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/source/pip-vendored-certifi-2026.6.17/pip/_vendor/certifi/__init__.py`
- `resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/source/pip-vendored-certifi-2026.6.17/pip/_vendor/certifi/__main__.py`
- `resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/source/pip-vendored-certifi-2026.6.17/pip/_vendor/certifi/cacert.pem`
- `resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/source/pip-vendored-certifi-2026.6.17/pip/_vendor/certifi/core.py`
- `resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/source/pip-vendored-certifi-2026.6.17/pip/_vendor/certifi/py.typed`
- `resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/source/pip-context/pip/_vendor/vendor.txt`
- `resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/source/pip-context/pip-26.2.1.dist-info/METADATA`
- `resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/source/pip-context/pip-26.2.1.dist-info/licenses/LICENSE.txt`
- `resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/source/pip-context/pip-26.2.1.dist-info/licenses/AUTHORS.txt`
- `resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/notices/MPL-2.0.txt`
- `resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/evidence/darwin-arm64-PYTHON.json`
- `resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/evidence/darwin-x64-PYTHON.json`
- `resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/notices/OPENSSL-ACKNOWLEDGMENTS.txt`
- `resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/evidence/native-dependencies.json`
- `resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/evidence/current-input-binding.json`
- `resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/evidence/pip-vendor-source.json`
- `resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/README.txt`
- `resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/evidence/read-only-audit.cjs`
- `resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/delivery-manifest.json`
- `resources/python-runtime/reviewed-materials/mac-final-obligations-review-1.7-20261011.json`
- `docs/quality/mac-final-obligations-1.7-20261011.md`
