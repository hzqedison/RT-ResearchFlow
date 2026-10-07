import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Publish immutable, already-tested artifacts; do not build or access user data.
const release = {
  "repository": "hzqedison/RT-ResearchFlow",
  "version": "0.1.0-beta.9",
  "sourceSha": "4c6431bd9a39a459b68cac62d702ad93fe20357c",
  "runId": 37645883721,
  "tag": "v0.1.0-beta.9",
  "title": "RT-ResearchFlow v0.1.0-beta.9（多选数据源 / Windows 与 Mac 同步）",
  "artifacts": [
    {
      "arch": "arm64",
      "id": 11494323781,
      "digest": "sha256:01f820273704b7bf4b96a0e31f0f63ae11679c145fb1efcf86cef94997e4367b"
    },
    {
      "arch": "x64",
      "id": 11494329333,
      "digest": "sha256:014430be80384e17f471812c3c0b196e73abf24d7f0dc03a4b7fbe5a37bfd467"
    }
  ],
  "windows": {
    "runId": 37645883786,
    "id": 11493964218,
    "digest": "sha256:17d624cae2fe0e997c4b11fc9242b72f17a138dabe756761527c8c4f1cfa50ef"
  },
  "notes": "# RT-ResearchFlow v0.1.0-beta.9\n\n## 多选数据源，一体化桌面版本\n\n- Windows x64、Mac Apple 芯片和 Intel 使用同一份源码和 beta.9 版本号，保留原有投研、AI 与量化模块，不拆分产品。\n- 个股日线可多选 Tushare、腾讯财经、东方财富、新浪、通达信、AKShare，按优先级尝试；腾讯、东财、新浪不要求购买 Tushare Token。\n- 新增东财/AKShare 研报索引与 PDF 原文入口，i问财提供实验性条件选股查询。本版不自动提取或总结研报 PDF 全文。\n- 通达信、AKShare、i问财的 Python 扩展按需安装到应用数据目录。Windows 沿用 K 盘安装时，扩展环境、缓存和临时目录也放在 K 盘；不自动改系统 Python。\n- 旧 Tushare Token 留空时保留，i问财 Cookie 仅本人本机填写并加密保存。不附带、读取浏览器或上传用户凭据。\n- 个股新增、刷新、图表和 AI 二轮缺失日线补齐接入统一路由。全市场、板块、分钟、筹码、财务和特殊 Tushare 接口不在本轮全部替换，不能宣称专业能力已全部免费。\n\n## 安装和使用\n\nWindows 下载 RT-ResearchFlow-Setup-0.1.0-beta.9-x64.exe，升级前备份并沿用旧安装目录，可选择 K、D 等非系统盘。Mac Apple 芯片选择 arm64.dmg，Intel 选择 x64.dmg，替换应用但不要删除用户数据目录。\n\n打开“配置中心 > 数据源”，选择来源并保存。建议先用腾讯、东财、新浪测试日线和东财研报；需要通达信、AKShare 时再安装 Python 3.10+，点击“安装所选扩展”。i问财还需本人登录 Cookie 和 Node.js 16+。每项“检测”必须取得有效样本才算成功，不把空结果或依赖安装成功当作数据可用。\n\n[完整多源接入说明](https://github.com/hzqedison/RT-ResearchFlow/blob/4c6431bd9a39a459b68cac62d702ad93fe20357c/docs/data-sources.md)\n\n## 检查和边界\n\nWindows 已从 NSIS 实际安装并检查启动、SQLite、AI 设置保存、版本号及 Windows 交易禁用；Mac 两种架构分别经过本机依赖编译、源码与隔离测试、DMG 安装和应用运行检查。新版另有多源配置、Cookie 加密保存、数据单位、交易日截止及研报链接过滤的离线测试。\n\n上述检查不使用用户 Key、Cookie 或券商账户，不提交买卖或撤单，也不能证明每个公开接口在她的网络中仍可用。mootdx 0.11.7 和 pywencai 0.13.1 发布较旧，明确标注实验；遇到空响应、登录策略变更或限流会报告失败，不绕过验证码、付费或访问权限。\n\n交易边界未变：Mac 同花顺桥接需要本人逐笔确认；Windows 不能执行同花顺实盘。尚未验证测试者的具体同花顺版本及中信账户，不承诺实际受理、成交、自动交易或投资收益。\n\n测试包未配置商业代码签名或 Apple 公证，请核对本发布来源，不全局关闭系统安全保护。保留原作者署名与 AGPL-3.0-only 许可；移除赞赏入口不改变许可，引用项目版权保留。\n\n## 可追溯构建\n\n[Windows 安装与检查记录](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37645883786)\n\n[Mac 两种架构构建与检查](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37645883721)\n\n[本轮完整源码](https://github.com/hzqedison/RT-ResearchFlow/tree/4c6431bd9a39a459b68cac62d702ad93fe20357c)\n\nSHA256SUMS.txt 包含 Windows EXE 和两个 Mac DMG 的校验值。\n\n<!-- tested-source:4c6431bd9a39a459b68cac62d702ad93fe20357c publisher-schema:2 -->\n"
};
assert.match(release.version, /^\d+\.\d+\.\d+(?:-beta\.\d+)?$/);
assert.equal(release.tag, `v${release.version}`, 'Release tag must match the application version');
assert.deepEqual(release.artifacts.map(item => item.arch).sort(), ['arm64', 'x64']);

assert.equal(process.env.GITHUB_REPOSITORY, release.repository);
assert.equal(process.env.GITHUB_REF, 'refs/heads/codex/macos-preview-release');
assert.ok(process.env.GH_TOKEN, 'A scoped workflow token is required');
const root = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'mac-preview-'));
const endpoint = `repos/${release.repository}`;
const outputs = [];
const checksums = [];
function command(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 300000
  });
}
function api(path) { return JSON.parse(command(['api', path])); }
function mutate(path, method, data) {
  const input = join(root, 'request.json');
  writeFileSync(input, JSON.stringify(data));
  return JSON.parse(command(['api', path, '--method', method, '--input', input]));
}
function capture(program, args, destination) {
  const fd = openSync(destination, 'wx');
  try {
    execFileSync(program, args, { stdio: ['ignore', fd, 'inherit'], timeout: 300000 });
  } finally { closeSync(fd); }
}
async function hash(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

const run = api(`${endpoint}/actions/runs/${release.runId}`);
assert.equal(run.repository.full_name, release.repository);
assert.equal(run.head_repository.full_name, release.repository);
assert.equal(run.head_sha, release.sourceSha);
assert.equal(run.status, 'completed');
assert.equal(run.conclusion, 'success');
const jobs = api(`${endpoint}/actions/runs/${release.runId}/jobs?per_page=100`).jobs;
assert.ok(jobs.length >= 2 && jobs.every(job =>
  job.status === 'completed' && job.conclusion === 'success'
), 'The native Mac jobs must have succeeded');

for (const pin of release.artifacts) {
  const artifact = api(`${endpoint}/actions/artifacts/${pin.id}`);
  assert.equal(artifact.expired, false);
  assert.equal(artifact.workflow_run.id, release.runId);
  assert.equal(artifact.workflow_run.head_sha, release.sourceSha);
  assert.equal(artifact.name, `RT-ResearchFlow-macOS-${pin.arch}-${release.sourceSha}`);
  assert.equal(artifact.digest, pin.digest);
  const directory = join(root, pin.arch);
  mkdirSync(directory);
  const archive = join(directory, 'artifact.zip');
  capture('gh', ['api', `${endpoint}/actions/artifacts/${pin.id}/zip`], archive);
  assert.equal(`sha256:${await hash(archive)}`, pin.digest, 'Artifact archive digest mismatch');
  const dmg = `RT-ResearchFlow-macOS-${release.version}-${pin.arch}.dmg`;
  const zip = `RT-ResearchFlow-macOS-${release.version}-${pin.arch}.zip`;
  const names = execFileSync('unzip', ['-Z1', archive], {
    encoding: 'utf8', timeout: 30000
  }).trim().split(/\r?\n/);
  // Extract only explicitly allowed root files, never arbitrary archive paths.
  assert.deepEqual([...names].sort(), [dmg, zip, 'SHA256SUMS.txt'].sort());
  for (const name of names) {
    capture('unzip', ['-p', archive, name], join(directory, name));
  }
  const expected = new Map();
  for (const line of readFileSync(join(directory, 'SHA256SUMS.txt'), 'utf8').trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64}) [ *](?:release\/)?([^/\\]+)$/.exec(line);
    assert.ok(match && [dmg, zip].includes(match[2]), 'Unexpected checksum entry');
    assert.ok(!expected.has(match[2]), 'Duplicate checksum entry');
    expected.set(match[2], match[1]);
  }
  assert.equal(expected.size, 2);
  for (const name of [dmg, zip]) {
    assert.equal(await hash(join(directory, name)), expected.get(name), 'Package checksum mismatch');
  }
  outputs.push({ name: dmg, path: join(directory, dmg), digest: expected.get(dmg) });
  checksums.push(`${expected.get(dmg)}  ${dmg}`);
}
// The Windows installer must come from the same immutable source and a successful installed-app run.
const windowsRun = api(`${endpoint}/actions/runs/${release.windows.runId}`);
assert.equal(windowsRun.repository.full_name, release.repository);
assert.equal(windowsRun.head_repository.full_name, release.repository);
assert.equal(windowsRun.head_sha, release.sourceSha);
assert.equal(windowsRun.status, 'completed');
assert.equal(windowsRun.conclusion, 'success');
const windowsJobs = api(`${endpoint}/actions/runs/${release.windows.runId}/jobs?per_page=100`).jobs;
assert.ok(windowsJobs.length > 0 && windowsJobs.every(job =>
  job.status === 'completed' && job.conclusion === 'success'
), 'The Windows build and installed-app checks must have succeeded');
const windowsArtifact = api(`${endpoint}/actions/artifacts/${release.windows.id}`);
assert.equal(windowsArtifact.expired, false);
assert.equal(windowsArtifact.workflow_run.id, release.windows.runId);
assert.equal(windowsArtifact.workflow_run.head_sha, release.sourceSha);
assert.equal(windowsArtifact.name, `RT-ResearchFlow-Windows-x64-${release.sourceSha}`);
assert.equal(windowsArtifact.digest, release.windows.digest);
const windowsDirectory = join(root, 'windows-x64');
mkdirSync(windowsDirectory);
const windowsArchive = join(windowsDirectory, 'artifact.zip');
capture('gh', ['api', `${endpoint}/actions/artifacts/${release.windows.id}/zip`], windowsArchive);
assert.equal(`sha256:${await hash(windowsArchive)}`, release.windows.digest, 'Windows artifact archive digest mismatch');
const exe = `RT-ResearchFlow-Setup-${release.version}-x64.exe`;
const windowsNames = execFileSync('unzip', ['-Z1', windowsArchive], {
  encoding: 'utf8', timeout: 30000
}).trim().split(/\r?\n/);
assert.deepEqual([...windowsNames].sort(), [exe, 'SHA256SUMS.txt'].sort());
for (const name of windowsNames) capture('unzip', ['-p', windowsArchive, name], join(windowsDirectory, name));
const checksumLine = readFileSync(join(windowsDirectory, 'SHA256SUMS.txt'), 'utf8').trim();
const windowsChecksum = /^([a-f0-9]{64}) [ *]([^/\\]+)$/.exec(checksumLine);
assert.ok(windowsChecksum && windowsChecksum[2] === exe, 'Unexpected Windows checksum entry');
assert.equal(await hash(join(windowsDirectory, exe)), windowsChecksum[1], 'Windows installer checksum mismatch');
outputs.push({ name: exe, path: join(windowsDirectory, exe), digest: windowsChecksum[1] });
checksums.push(`${windowsChecksum[1]}  ${exe}`);

const checksumPath = join(root, 'SHA256SUMS.txt');
writeFileSync(checksumPath, checksums.join('\n') + '\n');
outputs.push({ name: 'SHA256SUMS.txt', path: checksumPath, digest: await hash(checksumPath) });

const matches = api(`${endpoint}/releases?per_page=100`).filter(item => item.tag_name === release.tag);
assert.ok(matches.length <= 1, 'Ambiguous release tag');
let published = matches[0];
if (!published) {
  published = mutate(`${endpoint}/releases`, 'POST', {
    tag_name: release.tag, target_commitish: release.sourceSha,
    name: release.title, body: release.notes, draft: true, prerelease: true, make_latest: 'false'
  });
}
assert.equal(published.target_commitish, release.sourceSha);
assert.equal(published.name, release.title);
assert.equal(published.body, release.notes);
assert.equal(published.prerelease, true);

async function checkAsset(asset, output) {
  assert.equal(asset.state, 'uploaded');
  assert.equal(asset.size, statSync(output.path).size);
  if (asset.digest) {
    assert.equal(asset.digest, `sha256:${output.digest}`);
  } else {
    const copy = join(root, `existing-asset-${asset.id}`);
    capture('gh', ['api', '-H', 'Accept: application/octet-stream',
      `${endpoint}/releases/assets/${asset.id}`], copy);
    assert.equal(await hash(copy), output.digest, 'Existing release asset differs');
  }
}
const existingNames = new Set();
for (const asset of published.assets) {
  const output = outputs.find(item => item.name === asset.name);
  assert.ok(output && !existingNames.has(asset.name), 'Unexpected release asset; refusing to overwrite');
  existingNames.add(asset.name);
  await checkAsset(asset, output);
}
const missing = outputs.filter(output => !existingNames.has(output.name));
assert.ok(published.draft || missing.length === 0, 'Refusing to modify an incomplete published release');
if (missing.length) {
  command(['release', 'upload', release.tag, ...missing.map(output => output.path),
    '--repo', release.repository]);
}
published = api(`${endpoint}/releases/${published.id}`);
assert.equal(published.assets.length, outputs.length);
for (const output of outputs) {
  const asset = published.assets.find(item => item.name === output.name);
  assert.ok(asset, 'Missing release asset');
  await checkAsset(asset, output);
}
if (published.draft) {
  published = mutate(`${endpoint}/releases/${published.id}`, 'PATCH', {
    draft: false, prerelease: true, make_latest: 'false'
  });
}
assert.equal(published.draft, false);
assert.equal(published.prerelease, true);
assert.equal(published.tag_name, release.tag);
writeFileSync(process.env.GITHUB_STEP_SUMMARY, [
  '# Tested Windows and Mac preview published',
  '',
  `Release: ${published.html_url}`,
  `Tested source: ${release.sourceSha}`,
  'Windows includes the AI fixes and onboarding but no Windows trading execution. Mac live orders require per-order human confirmation; unattended trading is disabled. No user account or private data is included.',
  ...published.assets.map(asset => `- [${asset.name}](${asset.browser_download_url})`),
  ''
].join('\n'));
console.log(`Published ${published.html_url}`);
