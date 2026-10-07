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
  "sourceSha": "50d366530d5259ac1bcfdc7f6da69050a4e5d017",
  "runId": 37618380797,
  "tag": "mac-ths-experiment-2026-10-07-50d3665",
  "title": "Mac \u540c\u82b1\u987a\u4ea4\u6613\u5b9e\u9a8c\u7248\uff08\u6a21\u62df\u4ea4\u6613 / Apple \u82af\u7247\u4e0e Intel\uff09",
  "notes": "# Mac \u540c\u82b1\u987a\u4ea4\u6613\u5b9e\u9a8c\u7248\n\n\u672c\u7248\u52a0\u5165\u771f\u6b63\u8fd0\u884c\u5728 Mac \u672c\u673a\u7684\u540c\u82b1\u987a AppleScript \u6865\u63a5\uff0c\u4e0d\u4f7f\u7528 Windows \u540e\u53f0\uff0c\u4e5f\u4e0d\u662f\u5238\u5546\u5b98\u65b9\u4ea4\u6613 API\u3002\u539f\u6295\u7814\u3001\u8d44\u8baf\u3001\u884c\u60c5\u3001AI\u3001\u7b56\u7565\u9a8c\u8bc1\u3001\u590d\u76d8\u4e0e\u8bbe\u7f6e\u529f\u80fd\u7ee7\u7eed\u4fdd\u7559\uff0c\u6240\u9700\u5927\u6a21\u578b Key \u548c\u6570\u636e\u6e90\u4ecd\u7531\u672c\u4eba\u914d\u7f6e\u3002\n\n## \u672c\u7248\u80fd\u6d4b\u8bd5\u4ec0\u4e48\n- \u68c0\u67e5\u540c\u82b1\u987a\u4ea4\u6613\u9875\u9762\u53ca\u7cfb\u7edf\u6743\u9650\uff0c\u586b\u5199\u4ee3\u7801\u3001\u9650\u4ef7\u3001\u6570\u91cf\u5e76\u56de\u8bfb\u3002\n- \u660e\u786e\u786e\u8ba4\u540e\uff0c\u5c1d\u8bd5\u5411\u540c\u82b1\u987a\u6a21\u62df\u8d26\u6237\u63d0\u4ea4\u4e00\u7b14\u4e70\u5165\u6216\u5356\u51fa\u59d4\u6258\uff1b\u8bc6\u522b\u65b0\u589e\u59d4\u6258\u7f16\u53f7\uff0c\u4e0d\u628a\u53d7\u7406\u5f53\u4f5c\u6210\u4ea4\u3002\n- \u6253\u5f00\u540c\u82b1\u987a\u59d4\u6258\u3001\u6210\u4ea4\u9875\u9762\u4f9b\u672c\u4eba\u6838\u5bf9\uff0c\u4e0d\u91c7\u96c6\u6216\u5bfc\u51fa\u8d26\u6237\u8868\u683c\u3002\n- \u5c1d\u8bd5\u64a4\u9500\u6307\u5b9a\u6a21\u62df\u59d4\u6258\uff1b\u672a\u8bc6\u522b\u5355\u7b14\u64a4\u5355\u63a7\u4ef6\u65f6\u505c\u6b62\uff0c\u4e0d\u4f7f\u7528\u5168\u64a4\u3002\u64a4\u5355\u56de\u62a5\u76ee\u524d\u4ecd\u9700\u4eba\u5de5\u6838\u5bf9\u3002\n- \u4e2d\u4fe1\u8bc1\u5238\u5b9e\u76d8\u4ec5\u505a\u8868\u5355\u586b\u5199\u53ca\u56de\u8bfb\uff0c\u4e0d\u70b9\u51fb\u5b9e\u76d8\u63d0\u4ea4\u6216\u81ea\u52a8\u786e\u8ba4\uff0c\u4e0d\u8fdb\u884c\u65e0\u4eba\u503c\u5b88\u4ea4\u6613\u3002\n- \u53c2\u6570\u6821\u9a8c\u3001\u5355\u7b14\u91d1\u989d\u4e0a\u9650\u3001\u4e00\u6b21\u6027\u786e\u8ba4\u3001\u91cd\u590d\u8bf7\u6c42\u963b\u6b62\u53ca\u7ed3\u679c\u4e0d\u660e\u4fdd\u62a4\uff1b\u6ca1\u6709\u81ea\u52a8\u91cd\u8bd5\u3002\n\n## \u4e0b\u8f7d\u4e0e\u5b89\u88c5\n1. Apple M \u7cfb\u5217\u4e0b\u8f7d arm64.dmg\uff0cIntel \u4e0b\u8f7d x64.dmg\u3002\u6253\u5f00 DMG\uff0c\u5c06\u5e94\u7528\u62d6\u5165 Applications\u3002\n2. \u4e2a\u4eba\u6d4b\u8bd5\u7248\u672c\u4e3a\u4e34\u65f6\u7b7e\u540d\uff0c\u672a\u7ecf\u8fc7 Apple Developer ID \u7b7e\u540d\u6216\u516c\u8bc1\u3002\u9047\u5230\u7cfb\u7edf\u62e6\u622a\uff0c\u786e\u8ba4\u6765\u6e90\u540e\uff0c\u4ec5\u901a\u8fc7\u7cfb\u7edf\u8bbe\u7f6e\u4e2d\u7684\u5355\u4e2a\u5e94\u7528\u6253\u5f00\u6388\u6743\u5904\u7406\uff1b\u4e0d\u8981\u5173\u95ed\u7cfb\u7edf\u5b89\u5168\u68c0\u67e5\u3002\n3. \u65e0\u9700\u53e6\u88c5 Node.js\u3001Go\u3001Python \u6216\u7f16\u8bd1\u5de5\u5177\u3002\u5e94\u7528\u4f7f\u7528 macOS \u81ea\u5e26 AppleScript\u3002\n\n## \u5efa\u8bae\u5979\u8fd9\u6837\u6d4b\u8bd5\n1. \u672c\u4eba\u624b\u52a8\u542f\u52a8\u5e76\u767b\u5f55\u540c\u82b1\u987a\uff0c\u6253\u5f00\u4ea4\u6613\u9875\u9762\uff1b\u4e0d\u8981\u63d0\u4f9b\u767b\u5f55\u8d44\u6599\u3002\n2. \u5728 RT-ResearchFlow \u7684\u91cf\u5316\u5f15\u5bfc\u4e2d\u6253\u5f00\u201c\u4ea4\u6613\u5b9e\u9a8c\u201d\uff0c\u5148\u7533\u8bf7\u7cfb\u7edf\u63a7\u5236\u6743\u9650\u3002\u7cfb\u7edf\u8bbe\u7f6e\u4e2d\u53ea\u5141\u8bb8\u672c\u5e94\u7528\u6240\u9700\u7684\u8f85\u52a9\u529f\u80fd\u548c\u81ea\u52a8\u5316\u6743\u9650\uff0c\u4e0d\u9700\u8981\u5b8c\u5168\u78c1\u76d8\u8bbf\u95ee\u6743\u9650\u3002\n3. \u9009\u62e9\u201c\u540c\u82b1\u987a\u6a21\u62df\u8d26\u6237\u201d\uff0c\u68c0\u67e5\u8fde\u63a5\uff0c\u81ea\u884c\u586b\u5199\u6d4b\u8bd5\u4ee3\u7801\u3001\u9650\u4ef7\u3001\u6570\u91cf\u53ca\u672c\u6b21\u91d1\u989d\u4e0a\u9650\u3002\n4. \u5148\u6d4b\u8bd5\u201c\u586b\u5199\u8868\u5355\u5e76\u56de\u8bfb\uff08\u4e0d\u63d0\u4ea4\uff09\u201d\uff0c\u786e\u8ba4\u6a21\u62df\u6a21\u5f0f\u548c\u53c2\u6570\uff0c\u518d\u5c1d\u8bd5\u4e00\u7b14\u6a21\u62df\u59d4\u6258\u3002\n5. \u5728\u540c\u82b1\u987a\u672c\u673a\u6838\u5bf9\u59d4\u6258\u548c\u6210\u4ea4\u3002\u82e5\u7ed3\u679c\u4e0d\u660e\uff0c\u4e0d\u8981\u91cd\u590d\u63d0\u4ea4\uff0c\u5148\u6838\u5bf9\u518d\u89e3\u9664\u4fdd\u62a4\u3002\n6. \u5bfc\u51fa\u53bb\u654f\u6d4b\u8bd5\u7ed3\u679c\u53d1\u9001\u7ed9\u6211\u4eec\uff0c\u540e\u7eed\u6309\u72b6\u6001\u7801\u9002\u914d\u5979\u7684\u7248\u672c\u3002\n\n## \u9002\u914d\u4e0e\u9690\u79c1\u8fb9\u754c\n\u540c\u82b1\u987a\u5b98\u65b9\u5728 2026-10-07 \u67e5\u8be2\u65f6\u5217\u51fa\u7684 Mac \u7248\u672c\u4e3a 5.3.5\uff082026-09-11 \u66f4\u65b0\uff09\uff0c\u89c1 [\u5b98\u7f51\u4e0b\u8f7d\u4e2d\u5fc3](https://download.10jqka.com.cn/index/list?id=1)\u3002\u672c\u7248\u5c1a\u672a\u5728\u8be5\u7248\u672c\u4e0e\u5979\u7684\u4e2d\u4fe1\u8d26\u6237\u4e0a\u9a8c\u8bc1\u771f\u5b9e\u59d4\u6258\u3002\u53c2\u8003\u9879\u76ee\u7684\u4ea4\u6613\u811a\u672c\u5728 2026-06-01 \u968f Python \u8f6c Go \u8fc1\u79fb\uff0c8 \u6708\u66f4\u65b0\u53ea\u662f README\uff0c\u4e0d\u662f\u6700\u65b0\u7248\u5ba2\u6237\u7aef\u517c\u5bb9\u6027\u4fdd\u8bc1\u3002\n\n\u53c2\u8003 [zetatez/evolving](https://github.com/zetatez/evolving) \u7684 Mac \u540c\u82b1\u987a\u811a\u672c\u53ca\u63a7\u4ef6\u5e03\u5c40\uff0c\u53c2\u8003\u6e90\u7801\u56fa\u5b9a\u4e8e c6119456fb035d3f3348da675bb1b6a68ee79391\uff1bMIT \u8bb8\u53ef\u53ca\u7f72\u540d\u4fdd\u7559\u5728\u6865\u63a5\u6e90\u7801\u4e2d\u3002\u5f00\u6e90\u9879\u76ee\u7684\u652f\u6301\u63cf\u8ff0\u4e0d\u7b49\u4e8e\u5df2\u7ecf\u9a8c\u8bc1\u5979\u7684\u540c\u82b1\u987a\u7248\u672c\u6216\u4e2d\u4fe1\u8d26\u6237\u3002\n\n\u6b64\u7248\u53ea\u652f\u6301\u666e\u901a A \u80a1\u4e3b\u677f\u4ee3\u7801\uff0c\u4e0d\u652f\u6301\u79d1\u521b\u677f\u3001\u521b\u4e1a\u677f\u3001ETF\u3001\u8f6c\u503a\u3001\u8d44\u91d1\u8f6c\u8d26\u6216\u81ea\u52a8\u767b\u5f55\u3002\u6a21\u5f0f\u3001\u63a7\u4ef6\u3001\u5238\u5546\u6807\u8bb0\u3001\u786e\u8ba4\u5185\u5bb9\u6216\u59d4\u6258\u56de\u62a5\u65e0\u6cd5\u53ef\u9760\u8bc6\u522b\u65f6\u505c\u6b62\uff0c\u4e0d\u80fd\u76f2\u76ee\u7ed5\u8fc7\u3002\n\n\u5bfc\u51fa\u6587\u4ef6\u4ec5\u5305\u542b\u5e73\u53f0\u3001\u67b6\u6784\u3001\u52a8\u4f5c\u3001\u6a21\u5f0f\u3001\u7ed3\u679c\u72b6\u6001\u53ca\u4fdd\u62a4\u6807\u8bb0\uff0c\u4e0d\u5305\u542b\u8d26\u53f7\u3001\u5bc6\u7801\u3001Key\u3001\u8d44\u91d1\u3001\u6301\u4ed3\u3001\u59d4\u6258\u7f16\u53f7\u3001\u8ba2\u5355\u53c2\u6570\u3001\u786e\u8ba4\u51ed\u636e\u6216\u539f\u59cb\u65e5\u5fd7\uff0c\u4e5f\u4e0d\u81ea\u52a8\u4e0a\u4f20\u3002\u5b89\u88c5\u5305\u4e0d\u5305\u542b\u4efb\u4f55\u4e2a\u4eba\u8d26\u6237\u8d44\u6599\u3002\n\n## \u68c0\u67e5\u8303\u56f4\n\u4e24\u79cd Mac \u67b6\u6784\u7684\u6e90\u7801\u68c0\u67e5\u3001AppleScript \u7f16\u8bd1\u3001\u5b89\u88c5\u540e\u542f\u52a8\u4e0e\u672c\u5730\u6570\u636e\u5e93\uff0c\u4ee5\u53ca\u5b9e\u9a8c\u9762\u677f\u3001\u786e\u8ba4\u53d6\u6d88\u548c\u53bb\u654f\u5b57\u6bb5\u68c0\u67e5\uff0c\u5747\u4ee5\u94fe\u63a5\u7684\u6784\u5efa\u7ed3\u679c\u4e3a\u51c6\u3002\u6784\u5efa\u73af\u5883\u6ca1\u6709\u5979\u7684\u540c\u82b1\u987a\u4e0e\u8d26\u6237\uff0c\u4e0d\u80fd\u8bc1\u660e\u5b9e\u9645\u59d4\u6258\u6216\u64a4\u5355\u5df2\u7ecf\u6210\u529f\uff1b\u8fd9\u6b63\u662f\u672c\u7248\u9700\u8981\u672c\u673a\u53cd\u9988\u7684\u90e8\u5206\u3002\n\n\u5b89\u88c5\u5305\u6765\u81ea\u6210\u529f\u7684\u53cc\u67b6\u6784 Mac \u6784\u5efa\uff1a[\u6784\u5efa\u4e0e\u68c0\u67e5\u8bb0\u5f55](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37618380797)\u3002\n\u5bf9\u5e94\u5b8c\u6574\u6e90\u7801\uff1a[\u4ea4\u6613\u5b9e\u9a8c\u7248\u6e90\u7801](https://github.com/hzqedison/RT-ResearchFlow/tree/50d366530d5259ac1bcfdc7f6da69050a4e5d017)\u3002SHA256SUMS.txt \u63d0\u4f9b\u672c\u9875\u4e24\u4e2a DMG \u7684\u6821\u9a8c\u503c\u3002\n\n<!-- tested-source:50d366530d5259ac1bcfdc7f6da69050a4e5d017 publisher-schema:1 -->",
  "artifacts": [
    {
      "arch": "arm64",
      "id": 11481400843,
      "digest": "sha256:d93ce622bdd598f206f128e822a37f17f28d1701613dde78129f7280fc7cf9d4"
    },
    {
      "arch": "x64",
      "id": 11481436430,
      "digest": "sha256:30b9af8a702be39eb6d2c1e5204bb56af0d44a9f2980e4b340bb2172889fe312"
    }
  ]
};

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
  const dmg = `RT-ResearchFlow-macOS-0.1.0-beta.4-${pin.arch}.dmg`;
  const zip = `RT-ResearchFlow-macOS-0.1.0-beta.4-${pin.arch}.zip`;
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
  '# Tested Mac preview published',
  '',
  `Release: ${published.html_url}`,
  `Tested source: ${release.sourceSha}`,
  'Live trading remains disabled. No user account or private data is included.',
  ...published.assets.map(asset => `- [${asset.name}](${asset.browser_download_url})`),
  ''
].join('\n'));
console.log(`Published ${published.html_url}`);
