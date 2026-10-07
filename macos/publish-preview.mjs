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
  "version": "0.1.0-beta.8",
  "sourceSha": "6f8becee303f856915ff959df0c082e5e1c4eb03",
  "runId": 37634485830,
  "tag": "v0.1.0-beta.8",
  "title": "RT-ResearchFlow v0.1.0-beta.8（Windows / Mac 一体化同步）",
  "artifacts": [
    {
      "arch": "arm64",
      "id": 11489330736,
      "digest": "sha256:2e7e98d30f0b1d0f38f552a16805cf3ce7ddeaf38ba361a5a262afe73138af85"
    },
    {
      "arch": "x64",
      "id": 11489584865,
      "digest": "sha256:5717abb0f662c9378e2b7ba0eff0164cb05482708bbeedcceca259e38ae58d9d"
    }
  ],
  "windows": {
    "runId": 37634485859,
    "id": 11487962928,
    "digest": "sha256:3f41e2204a0bd52d2ae2570cfe39a691b1e0f29d398572dc977d0fda4fedc887"
  },
  "notes": "# RT-ResearchFlow v0.1.0-beta.8\n\n## beta.8 Windows / Mac 同步\n\n- 同一源码与版本号提供 Windows x64 安装器、Mac Apple 芯片和 Intel 构建；投研、AI 与量化模块不拆成独立产品。\n- Windows 同步 beta.7 的 AI 配置保存修复、DeepSeek 官方模型与逐行保存入口；保留旧数据和加密密钥，不附带任何用户凭据。\n- Windows 可以查看量化开通引导和去敏兼容状态；当前同花顺执行桥接只支持 Mac，Windows 不启用买卖、撤单或系统控制权限，不能把同步界面当作 Windows 实盘支持。\n- Windows 安装器可选择非系统盘，升级默认保留安装目录下的 data；建议先备份并沿用旧安装目录。构建与安装检查在隔离 CI 执行，不操作用户账户。\n- 新包递增到 0.1.0-beta.8，不覆盖 beta.7。真实交易仍须本人逐笔确认，实际客户端与券商账户兼容性需要本人测试。\n\n\nWindows 下载 RT-ResearchFlow-Setup-0.1.0-beta.8-x64.exe。安装时选择 K、D 等有空间的非系统盘；更新前备份并沿用原安装目录。Mac Apple 芯片选择 arm64.dmg，Intel 选择 x64.dmg。\n\n安装包无需额外安装 Node.js 或数据库，研究数据和模型服务仍需各自合法权限。测试包未配置商业代码签名或 Apple 公证，请核对自己的发布来源，不要全局关闭系统安全保护。\n\n原作者署名和 AGPL-3.0-only 许可保留；去除赞赏入口不改变许可证。Mac 同花顺接入参考 zetatez/evolving 的 MIT 代码，版权保留。不承诺真实账户已验证、自动成交或投资收益。\n\n## 本轮隔离检查\n\nWindows x64 已从 NSIS 安装器实际安装并检查启动、沙箱、SQLite、无密钥 AI 厂商设置保存、版本号与 Mac 专用交易在 Windows 禁用。两种 Mac 架构分别进行本机依赖编译、源码检查、DMG 安装以及启动、设置、窗口重开、退出、量化引导和交易面板检查。\n\n所有检查使用隔离数据，不使用用户 Key，不连接用户券商账户，不提交真实买卖或撤单；检查通过不代表她的实际同花顺和中信账户已验证。\n\n## 构建来源\n\n[Windows 安装与检查记录](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37634485859)\n\n[两种 Mac 架构构建与检查](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37634485830)\n\n[本轮完整源码](https://github.com/hzqedison/RT-ResearchFlow/tree/6f8becee303f856915ff959df0c082e5e1c4eb03)\n\nSHA256SUMS.txt 包含本页 Windows EXE 与两个 Mac DMG 的校验值。\n\n<!-- tested-source:6f8becee303f856915ff959df0c082e5e1c4eb03 publisher-schema:2 -->\n"
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
