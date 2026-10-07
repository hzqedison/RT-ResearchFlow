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
  "sourceSha": "f9efe4ea9cb893eb8e0204dfc6c9494fc8bff4a2",
  "runId": 37604392610,
  "tag": "mac-preview-2026-10-07-f9efe4e",
  "title": "Mac \u975e\u4ea4\u6613\u529f\u80fd\u6d4b\u8bd5\u7248\uff08Apple \u82af\u7247 / Intel\uff09",
  "notes": "# Mac \u975e\u4ea4\u6613\u529f\u80fd\u6d4b\u8bd5\u7248\n\n\u672c\u7248\u672c\u4fdd\u7559\u539f\u4ea7\u54c1\u7684\u6295\u7814\u3001\u8d44\u8baf\u3001\u884c\u60c5\u3001\u7b56\u7565\u9a8c\u8bc1\u3001\u590d\u76d8\u4e0e\u8bbe\u7f6e\u529f\u80fd\uff0c\u5e76\u63d0\u4f9b\u91cf\u5316\u5f00\u901a\u5f15\u5bfc\u3002\u771f\u5b9e\u81ea\u52a8\u4e0b\u5355\u5c1a\u672a\u63a5\u5165\uff0c\u4fdd\u6301\u5173\u95ed\u3002\n\n## \u4e0b\u8f7d\u4e0e\u5b89\u88c5\n1. \u5728 Mac \u7684\u201c\u5173\u4e8e\u672c\u673a\u201d\u67e5\u770b\u82af\u7247\uff1aApple M \u7cfb\u5217\u4e0b\u8f7d arm64.dmg\uff1bIntel \u4e0b\u8f7d x64.dmg\u3002\n2. \u6253\u5f00 DMG\uff0c\u5c06\u5e94\u7528\u62d6\u5165 Applications\uff0c\u7136\u540e\u542f\u52a8\u3002\u65e0\u9700\u5b89\u88c5\u7f16\u8bd1\u5de5\u5177\u3002\n3. \u8fd9\u662f\u4e2a\u4eba\u6d4b\u8bd5\u7528\u4e34\u65f6\u7b7e\u540d\u7248\u672c\uff0c\u672a\u7ecf\u8fc7 Apple Developer ID \u7b7e\u540d\u6216\u516c\u8bc1\u3002\u82e5\u7cfb\u7edf\u62e6\u622a\uff0c\u8bf7\u786e\u8ba4\u4e0b\u8f7d\u81ea\u672c\u53d1\u5e03\u9875\uff0c\u518d\u901a\u8fc7\u201c\u7cfb\u7edf\u8bbe\u7f6e > \u9690\u79c1\u4e0e\u5b89\u5168\u6027\u201d\u9488\u5bf9\u8be5\u5e94\u7528\u6388\u6743\u6253\u5f00\uff1b\u4e0d\u8981\u5168\u5c40\u5173\u95ed\u7cfb\u7edf\u5b89\u5168\u68c0\u67e5\u3002\n\n## \u529f\u80fd\u4e0e\u6d4b\u8bd5\u8303\u56f4\n- \u529f\u80fd\u4ee3\u7801\u4fdd\u7559\u4e0d\u4ee3\u8868\u5df2\u5305\u542b\u6240\u6709\u6570\u636e\u6743\u9650\uff1aAI \u9700\u8981\u81ea\u5df1\u7684\u5927\u6a21\u578b Key\uff0c\u884c\u60c5\u53ca\u5176\u4ed6\u6570\u636e\u4f9d\u8d56\u76f8\u5e94\u6570\u636e\u6e90\u3001\u7f51\u7edc\u4e0e\u6743\u9650\u914d\u7f6e\u3002\n- Apple \u82af\u7247\u4e0e Intel \u7684\u5b89\u88c5\u3001\u542f\u52a8\u3001\u672c\u5730\u6570\u636e\u5e93\u3001\u8bbe\u7f6e\u3001\u7a97\u53e3\u91cd\u5f00\u3001\u9000\u51fa\u53ca\u91cf\u5316\u5f15\u5bfc/\u8bca\u65ad\u5bfc\u51fa\u5df2\u901a\u8fc7\u6784\u5efa\u73af\u5883\u68c0\u67e5\uff1b\u6ca1\u6709\u4f7f\u7528\u5979\u7684\u771f\u5b9e\u8d26\u6237\u9a8c\u8bc1\u5168\u90e8\u6570\u636e\u63a5\u53e3\u6216 AI \u7ed3\u679c\u3002\n- \u6b64\u5b89\u88c5\u5305\u4e0d\u5305\u542b\u4e2a\u4eba\u6570\u636e\u5e93\u3001\u8d26\u6237\u8d44\u6599\u3001API Key\u3001\u6301\u4ed3\u6216\u4ea4\u6613\u8bb0\u5f55\u3002\n- \u6682\u4e0d\u652f\u6301\u771f\u5b9e\u81ea\u52a8\u4e0b\u5355\u3002\u5f15\u5bfc\u4e2d\u7684\u201c\u5df2\u7533\u8bf7/\u5df2\u6536\u5230\u7b54\u590d\u201d\u53ea\u662f\u4e2a\u4eba\u8fdb\u5ea6\uff0c\u4e0d\u662f\u7cfb\u7edf\u9a8c\u8bc1\u8fc7\u7684\u4ea4\u6613\u6388\u6743\u3002\n\n## \u79c1\u5bc6\u53cd\u9988\n\u5148\u6d4b\u8bd5\u5b89\u88c5\u3001\u542f\u52a8\u3001\u8bbe\u7f6e\u4fdd\u5b58\u3001\u9875\u9762\u64cd\u4f5c\u548c\u9000\u51fa\u3002\u91cf\u5316\u5f15\u5bfc\u9875\u53ef\u5bfc\u51fa\u53d7\u9650\u5b57\u6bb5\u7684\u8bca\u65ad\u7ed3\u679c\uff1b\u4ec5\u53cd\u9988\u7ed3\u679c\u4e0e\u53bb\u654f\u540e\u7684\u9519\u8bef\u63cf\u8ff0\uff0c\u4e0d\u53d1\u9001\u8d26\u53f7\u3001\u5bc6\u7801\u3001Key\u3001\u8d44\u91d1\u3001\u6301\u4ed3\u3001\u5b8c\u6574\u65e5\u5fd7\u6216\u4e2a\u4eba\u6570\u636e\u5e93\u3002\n\n\u5b89\u88c5\u5305\u6765\u81ea\u6210\u529f\u7684\u53cc\u67b6\u6784 Mac \u6784\u5efa\uff1ahttps://github.com/hzqedison/RT-ResearchFlow/actions/runs/37604392610\n\u5bf9\u5e94\u5b8c\u6574\u6e90\u7801\uff1ahttps://github.com/hzqedison/RT-ResearchFlow/tree/f9efe4ea9cb893eb8e0204dfc6c9494fc8bff4a2\n\u8bb8\u53ef\u8bc1\u53ca\u539f\u4f5c\u8005\u4fe1\u606f\u4fdd\u7559\u5728\u6e90\u7801\u4e2d\u3002SHA256SUMS.txt \u63d0\u4f9b\u672c\u9875\u4e24\u4e2a DMG \u7684\u6821\u9a8c\u503c\u3002\n\n<!-- tested-source:f9efe4ea9cb893eb8e0204dfc6c9494fc8bff4a2 publisher-schema:1 -->",
  "artifacts": [
    {
      "arch": "arm64",
      "id": 11474178792,
      "digest": "sha256:e13c99460e58eb0e3e6a497f4187f16c41001a0897b56962aa403d38a93c7b66"
    },
    {
      "arch": "x64",
      "id": 11474702083,
      "digest": "sha256:55068b050faed17dd67982e332c386ab0e92483ff3981692a13cc612cc1f8543"
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
