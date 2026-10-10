# 1.7 certifi 源码与许可证交付材料

日期：2026-10-11。范围：原始材料保存和精确字节核对，不是发布批准或法律保证。

## 已实际完成

- 官方 PyPI 的 certifi 2026.7.22 wheel 摘要与当前选用资产一致：62f22742b58a1a33014a2b6b706588a8d7e2a88ae7bd1a6ebe8c992928483775。
- 原始 source tar.gz：138112 bytes；SHA256 741e2c3b351ddf169a738da9f2c048608ff7f2c5cc02f1ebc6b118bb090d5d55。只读解析归档，没有执行或解包上游代码。
- 原 LICENSE 摘要 e93716da6b9c0d5a4a1df60fe695b370f0695603d21f6f83f053e42cfc10caf7 与原 notice 记录一致。
- Mozilla 官方 MPL 2.0 全文：16726 bytes；SHA256 3f3d9e0024b1921b067d6f7f88deb4a60cbe7a78e76c64e3f1d7fc3b779b9d04。
- cacert.pem、core.py、__init__.py 与旧 Windows 准备缓存的三个 provider 对应文件逐字节相等，未修改证书束。旧缓存不是最终运行库，此结论不外推到 Mac。
- 完整身份和成员核对记录见 [机器记录](../../resources/python-runtime/certifi-source-materials.json)。

## 原始材料与取得方式

- [原始源码](../../resources/python-runtime/certifi-2026.7.22-source.tar.gz)。
- [完整 MPL 文本](../../resources/python-runtime/MPL-2.0.txt)。
- [固定 PyPI 版本](https://pypi.org/project/certifi/2026.7.22/) 与 [Mozilla 原始许可](https://www.mozilla.org/media/MPL/2.0/index.txt)。
- 原始源码和 notices 保持各自许可；本项目不限制其适用的源码修改、取得或再分发权利，不用项目根许可证覆盖第三方原文。

## 尚未完成

1. 当前最终三平台运行库及 pip vendor 的版本、证书束和 notice 字节对应仍须核验。
2. 最终运行库须带有可读 notice、完整条款与固定源码入口，验证实际接收者可取得。本次保存源码不冒充安装包已经交付。
3. 其他组件适用性、protected source authorization、正式 obligations proof 与三平台 native seal 仍待完成。

未修改 policy、批准记录、生产数据库、用户凭证或券商配置；releaseEligible 保持 false。
