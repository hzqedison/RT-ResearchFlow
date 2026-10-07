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
  "version": "0.1.0-beta.7",
  "sourceSha": "a3966822c3ee061091be0b8461a2b44138095d6b",
  "runId": 37629732509,
  "tag": "v0.1.0-beta.7",
  "title": "RT-ResearchFlow v0.1.0-beta.7\uff08Mac / \u4e2d\u4fe1\u771f\u5b9e\u4ea4\u6613\u4e0e AI \u914d\u7f6e\u4fee\u590d\uff09",
  "artifacts": [
    {
      "arch": "arm64",
      "id": 11486047379,
      "digest": "sha256:752a73a37ce1f4f028f8976ff363c1d2b87d9fd5315a9eb7683eac5bad680a70"
    },
    {
      "arch": "x64",
      "id": 11486063760,
      "digest": "sha256:9f6aa4504a5118e4f1526355a82b0e48f8173b2fe75fd75dbb48ba76025be6a8"
    }
  ],
  "notes": "# RT-ResearchFlow v0.1.0-beta.7\n\n\u8fd9\u662f\u5728\u539f RT-ResearchFlow \u57fa\u7840\u4e0a\u4e8c\u6b21\u8fed\u4ee3\u7684\u540c\u4e00\u6b3e\u4ea7\u54c1\uff0c\u6295\u7814\u3001\u8d44\u8baf\u3001AI\u3001\u7b56\u7565\u9a8c\u8bc1\u3001\u590d\u76d8\u4e0e\u91cf\u5316\u4ea4\u6613\u6a21\u5757\u90fd\u5728\u540c\u4e00\u4e2a\u5b89\u88c5\u5305\u4e2d\u3002Apple \u82af\u7247\u4e0e Intel \u4e0b\u8f7d\u9879\u53ea\u662f\u4e0d\u540c\u67b6\u6784\uff0c\u4e0d\u662f\u4e24\u4e2a\u529f\u80fd\u7248\u672c\u3002\n\n## \u672c\u6b21\u66f4\u65b0\n- \u4fee\u590d\u4fdd\u5b58 AI \u5382\u5546\u8bbe\u7f6e\u65f6 `provider_configs.apiKeyEncrypted` \u7684\u6570\u636e\u5e93\u975e\u7a7a\u9519\u8bef\uff1b\u65e0\u5bc6\u94a5\u8bbe\u7f6e\u53ef\u4fdd\u5b58\uff0c\u4f46\u4e0d\u4f1a\u6807\u8bb0\u4e3a\u53ef\u7528\u6a21\u578b\u3002\u65e7\u6570\u636e\u53ca\u65e2\u6709\u52a0\u5bc6\u5bc6\u94a5\u4fdd\u7559\uff0c\u4e0d\u4fdd\u5b58\u660e\u6587\u3002\n- \u7cfb\u7edf\u5bc6\u94a5\u52a0\u5bc6\u4e0d\u53ef\u7528\u65f6\u505c\u6b62\u4fdd\u5b58\u5e76\u7ed9\u51fa\u660e\u786e\u63d0\u793a\uff1b\u5382\u5546\u884c\u7684\u201c\u4fdd\u5b58\u201d\u6309\u94ae\u56fa\u5b9a\u5728\u53f3\u4fa7\uff0c\u5e95\u90e8\u6309\u94ae\u53ea\u4fdd\u5b58\u5168\u5c40\u53c2\u6570\u3002\n- DeepSeek \u5b98\u65b9\u6a21\u578b\u5217\u8868\u66f4\u65b0\u4e3a `deepseek-flash`\u3001`deepseek-v4-pro`\uff1b\u65e7\u914d\u7f6e\u4e0d\u4f1a\u88ab\u9759\u9ed8\u66ff\u6362\uff0c\u7528\u6237\u9700\u91cd\u65b0\u9009\u62e9\u540e\u4fdd\u5b58\u3002\u5f53\u524d\u5b98\u65b9\u6a21\u578b\u6309\u975e\u601d\u8003\u6a21\u5f0f\u4e0e\u5df2\u6709\u8f93\u51fa\u4e0a\u9650\u8c03\u7528\u3002[\u5b98\u65b9\u63a5\u53e3\u8bf4\u660e](https://api-docs.deepseek.com/api/create-chat-completion/)\n- \u7248\u672c\u6309\u5f00\u53d1\u8fed\u4ee3\u4ece 0.1.0-beta.6 \u9012\u8fdb\u5230 0.1.0-beta.7\uff1b\u4e0a\u4e00\u4e2a\u516c\u5f00\u5b89\u88c5\u5305\u4e3a 0.1.0-beta.4\uff0c\u5e94\u7528\u663e\u793a\u3001\u5b89\u88c5\u5305\u6587\u4ef6\u540d\u4e0e\u53d1\u5e03\u6807\u7b7e\u4fdd\u6301\u4e00\u81f4\u3002\n- \u65b0\u589e\u672c\u4eba\u786e\u8ba4\u7684\u4e2d\u4fe1\u771f\u5b9e\u8d26\u6237\u4e70\u5165\u3001\u5356\u51fa\u4e0e\u6307\u5b9a\u5355\u7b14\u64a4\u5355\u8def\u5f84\uff0c\u4ea4\u6613\u5165\u53e3\u4e0d\u518d\u4f7f\u7528\u6a21\u62df\u8d26\u6237\u4ee3\u66ff\u3002\n- \u771f\u5b9e\u4ea4\u6613\u9ed8\u8ba4\u5173\u95ed\uff0c\u53ea\u80fd\u663e\u5f0f\u542f\u7528\u672c\u6b21\u4f1a\u8bdd\uff1b\u91cd\u542f\u540e\u91cd\u65b0\u542f\u7528\u3002\u6bcf\u7b14\u64cd\u4f5c\u9700\u8981\u5e94\u7528\u6838\u5bf9\u53ca\u4e3b\u8fdb\u7a0b\u7cfb\u7edf\u786e\u8ba4\uff0c\u7cfb\u7edf\u9ed8\u8ba4\u53d6\u6d88\u3002\n- \u540c\u82b1\u987a\u81ea\u5df1\u7684\u786e\u8ba4\u5f39\u7a97\u7559\u7ed9\u672c\u4eba\u6838\u5bf9\u540e\u786e\u8ba4\u6216\u53d6\u6d88\uff0c\u672c\u5e94\u7528\u4e0d\u81ea\u52a8\u70b9\u51fb\u3002\u5f39\u7a97\u3001\u8d85\u65f6\u6216\u672a\u77e5\u56de\u62a5\u51fa\u73b0\u65f6\u9501\u4f4f\u91cd\u590d\u8bf7\u6c42\uff0c\u5fc5\u987b\u672c\u4eba\u6838\u5bf9\u540e\u663e\u5f0f\u89e3\u9664\uff0c\u4e0d\u81ea\u52a8\u91cd\u53d1\u3002\n- \u59d4\u6258/\u6210\u4ea4\u6309\u94ae\u6253\u5f00\u540c\u82b1\u987a\u672c\u673a\u9875\u9762\u4f9b\u672c\u4eba\u67e5\u770b\uff0c\u4e0d\u91c7\u96c6\u6216\u5bfc\u51fa\u7ed3\u6784\u5316\u8d26\u6237\u8868\u683c\u3002\u552f\u4e00\u65b0\u589e\u4e14\u4ee3\u7801\u3001\u4ef7\u683c\u3001\u6570\u91cf\u548c\u65b9\u5411\u5339\u914d\u7684\u7f16\u53f7\u624d\u6807\u8bb0\u53d7\u7406\uff1b\u53d7\u7406\u4e0d\u7b49\u4e8e\u6210\u4ea4\u3002\n- \u66f4\u65b0\u6574\u5408\u540e\u7684\u4ea7\u54c1\u4ecb\u7ecd\uff0c\u79fb\u9664\u8d5e\u8d4f\u677f\u5757\uff1b\u539f\u4f5c\u8005\u7f72\u540d\u4e0e\u5f00\u6e90\u8bb8\u53ef\u4fdd\u7559\u3002\n\n## \u5b89\u88c5\n1. Apple M \u7cfb\u5217\u9009\u62e9 arm64.dmg\uff0cIntel \u9009\u62e9 x64.dmg\uff1b\u6253\u5f00 DMG\uff0c\u5c06\u5e94\u7528\u62d6\u5165 Applications\u3002\n2. \u4e2a\u4eba\u6d4b\u8bd5\u5305\u4f7f\u7528\u4e34\u65f6\u7b7e\u540d\uff0c\u672a\u7ecf\u8fc7 Apple Developer ID \u7b7e\u540d\u6216\u516c\u8bc1\u3002\u88ab\u7cfb\u7edf\u62e6\u622a\u65f6\u4ec5\u9488\u5bf9\u786e\u8ba4\u6765\u6e90\u7684\u672c\u5e94\u7528\u6388\u6743\u6253\u5f00\uff0c\u4e0d\u5173\u95ed\u6574\u4f53\u5b89\u5168\u68c0\u67e5\u3002\n3. \u65e0\u9700\u5355\u72ec\u5b89\u88c5 Node.js\u3001Go\u3001Python \u6216 Windows \u6267\u884c\u7aef\u3002\u66f4\u65b0\u524d\u5efa\u8bae\u5907\u4efd\u672c\u673a\u7814\u7a76\u6570\u636e\uff1b\u66ff\u6362\u5e94\u7528\u4e0d\u5220\u9664\u6570\u636e\u76ee\u5f55\u3002\n\n## \u4f7f\u7528\u771f\u5b9e\u4ea4\u6613\u6a21\u5757\n1. \u672c\u4eba\u6838\u5b9e\u4e2d\u4fe1\u53ca\u540c\u82b1\u987a\u7684\u8d26\u6237\u4e0e\u8f6f\u4ef6\u63a5\u5165\u8981\u6c42\uff0c\u624b\u52a8\u767b\u5f55\u540c\u82b1\u987a\u5e76\u9009\u62e9\u6b63\u786e\u4e2d\u4fe1\u8d26\u6237\uff0c\u4e0d\u63d0\u4f9b\u5bc6\u7801\u6216\u8d26\u6237\u8d44\u6599\u3002\n2. \u8fdb\u5165\u540c\u4e00\u5e94\u7528\u201c\u91cf\u5316\u5f00\u901a > \u771f\u5b9e\u4ea4\u6613\u201d\uff0c\u7533\u8bf7\u5fc5\u8981\u8f85\u52a9\u529f\u80fd/\u81ea\u52a8\u5316\u6743\u9650\uff0c\u4e0d\u9700\u8981\u5b8c\u5168\u78c1\u76d8\u8bbf\u95ee\u6743\u9650\uff1b\u5148\u68c0\u67e5\u8fde\u63a5\u3002\n3. \u81ea\u884c\u586b\u5199\u666e\u901a A \u80a1\u4e3b\u677f\u4ee3\u7801\u3001\u9650\u4ef7\u3001\u6570\u91cf\u4e0e\u59d4\u6258\u91d1\u989d\u4e0a\u9650\uff0c\u5148\u586b\u5199\u5e76\u56de\u8bfb\uff0c\u4e0d\u63d0\u4ea4\u3002\n4. \u786e\u8ba4\u98ce\u9669\u5e76\u542f\u7528\u672c\u6b21\u4f1a\u8bdd\uff1b\u53d1\u8d77\u771f\u5b9e\u4e70\u5356\u6216\u6307\u5b9a\u5355\u7b14\u64a4\u5355\u65f6\u672c\u4eba\u9010\u9879\u6838\u5bf9\u5e76\u786e\u8ba4\u3002\u64cd\u4f5c\u671f\u95f4\u4e0d\u8981\u5207\u6362\u8d26\u6237\u3001\u7a97\u53e3\u6216\u540c\u65f6\u624b\u52a8\u4e0b\u5355\u3002\n5. \u82e5\u540c\u82b1\u987a\u5f39\u51fa\u786e\u8ba4\uff0c\u8bf7\u672c\u4eba\u6838\u5bf9\u5e76\u5728\u540c\u82b1\u987a\u786e\u8ba4\u6216\u53d6\u6d88\u3002\u82e5\u56de\u62a5\u4e0d\u660e\uff0c\u5148\u6838\u5bf9\u59d4\u6258/\u6210\u4ea4\uff0c\u4e0d\u91cd\u590d\u63d0\u4ea4\u3002\n6. \u53ea\u53cd\u9988\u201c\u5bfc\u51fa\u53bb\u654f\u8fd0\u884c\u7ed3\u679c\u201d\u7684\u6587\u4ef6\uff0c\u4e0d\u53d1\u9001\u8d26\u53f7\u3001\u8d44\u91d1\u3001\u6301\u4ed3\u3001\u8ba2\u5355\u7f16\u53f7\u3001\u8ba2\u5355\u53c2\u6570\u3001Key\u3001\u786e\u8ba4\u51ed\u636e\u6216\u539f\u59cb\u65e5\u5fd7\u3002\n\n## \u5fc5\u987b\u77e5\u9053\u7684\u8fb9\u754c\n\u672c\u7248\u662f\u771f\u5b9e\u4ea4\u6613\u63a5\u5165\u4ee3\u7801\uff0c\u4e0d\u662f\u5047\u94b1\u5305\uff0c\u4e5f\u4e0d\u662f\u5238\u5546\u5b98\u65b9 API\uff1b\u5c1a\u672a\u5728\u5979\u7684\u5f53\u524d\u540c\u82b1\u987a\u7248\u672c\u4e0e\u4e2d\u4fe1\u8d26\u6237\u4e0a\u9a8c\u8bc1\u771f\u5b9e\u59d4\u6258\u3001\u6210\u4ea4\u6216\u64a4\u5355\u6210\u529f\u3002\u6784\u5efa\u73af\u5883\u6ca1\u6709\u771f\u5b9e\u8d26\u6237\uff0c\u9694\u79bb\u6d4b\u8bd5\u53ca\u811a\u672c\u7f16\u8bd1\u4e0d\u63d0\u4f9b\u5b9e\u76d8\u517c\u5bb9\u6027\u4fdd\u8bc1\u3002\u6a21\u5f0f\u3001\u5238\u5546\u3001\u5e03\u5c40\u3001\u8f93\u5165\u3001\u8868\u5934\u6216\u56de\u62a5\u4e0d\u53ef\u9760\u65f6\u505c\u6b62\uff0c\u9700\u8981\u6309\u53bb\u654f\u72b6\u6001\u8fed\u4ee3\u3002\n\n\u76ee\u524d\u53ea\u652f\u6301\u666e\u901a A \u80a1\u4e3b\u677f\u9650\u4ef7\uff0c\u4e0d\u652f\u6301\u79d1\u521b\u677f\u3001\u521b\u4e1a\u677f\u3001ETF\u3001\u8f6c\u503a\u3001\u8d44\u91d1\u8f6c\u8d26\u3001\u81ea\u52a8\u767b\u5f55\u3001\u81ea\u52a8\u8c03\u4ed3\u3001\u7b56\u7565\u81ea\u52a8\u89e6\u53d1\u6216\u65e0\u4eba\u503c\u5b88\u3002\u5df2\u6210\u4ea4\u90e8\u5206\u4e0d\u80fd\u64a4\u9500\uff1b\u64a4\u5355\u56de\u62a5\u4e0d\u660e\u4ecd\u9700\u4eba\u5de5\u6838\u5bf9\u3002\n\n\u73b0\u6709\u6295\u7814\u4e0e AI \u529f\u80fd\u7ee7\u7eed\u4fdd\u7559\uff0c\u5404\u81ea\u7684\u6570\u636e\u6743\u9650\u548c\u5927\u6a21\u578b Key \u4ecd\u9700\u672c\u4eba\u914d\u7f6e\u3002AKShare\u3001BaoStock \u7b49\u66ff\u4ee3\u6570\u636e\u6e90\u5c1a\u672a\u96c6\u6210\uff0c\u4e0d\u8981\u628a\u4ea4\u6613\u6a21\u5757\u5f53\u6210\u514d\u8d39\u5b8c\u6574\u6570\u636e\u670d\u52a1\u3002\n\n\u53c2\u8003 [zetatez/evolving](https://github.com/zetatez/evolving) \u7684 Mac A \u80a1\u5b9e\u76d8\u811a\u672c\u4e0e\u63a7\u4ef6\u5e03\u5c40\uff0c\u9501\u5b9a\u53c2\u8003\u63d0\u4ea4 c6119456fb035d3f3348da675bb1b6a68ee79391\uff0cMIT \u7248\u6743\u4e0e\u8bb8\u53ef\u4fdd\u7559\u3002\u5176\u6e90\u7801\u66f4\u65b0\u4e0d\u8bc1\u660e\u5f53\u524d\u5ba2\u6237\u7aef\u5df2\u7ecf\u517c\u5bb9\u3002\n\n## \u5df2\u5b8c\u6210\u7684\u9694\u79bb\u68c0\u67e5\n\u4e24\u79cd Mac \u67b6\u6784\u5747\u5df2\u901a\u8fc7\u6e90\u7801\u68c0\u67e5\u3001AppleScript \u7f16\u8bd1\u3001\u5b89\u88c5\u5305\u751f\u6210\uff0c\u4ee5\u53ca\u4ece DMG \u5b89\u88c5\u540e\u7684\u542f\u52a8\u3001\u672c\u5730\u6570\u636e\u5e93\u3001\u8bbe\u7f6e\u3001Dock \u91cd\u5f00\u3001\u9000\u51fa\u3001\u5f00\u901a\u5f15\u5bfc\u548c\u4ea4\u6613\u9762\u677f\u68c0\u67e5\u3002\u901a\u7528\u9a8c\u8bc1\u4e5f\u5df2\u901a\u8fc7\uff1b\u6ca1\u6709\u8fde\u63a5\u7528\u6237\u8d26\u6237\u3001\u4f7f\u7528\u7528\u6237 Key \u6216\u63d0\u4ea4\u771f\u5b9e\u8ba2\u5355\u3002\u9694\u79bb\u73af\u5883\u7684\u6210\u529f\u4e0d\u4ee3\u8868\u5979\u7684\u5ba2\u6237\u7aef\u5df2\u5b8c\u6210\u5b9e\u76d8\u9a8c\u8bc1\u3002\n\n## \u6784\u5efa\u6765\u6e90\n[\u53cc\u67b6\u6784\u6784\u5efa\u4e0e\u9694\u79bb\u68c0\u67e5\u8bb0\u5f55](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37629732509)\n[\u5b8c\u6574\u6e90\u7801](https://github.com/hzqedison/RT-ResearchFlow/tree/a3966822c3ee061091be0b8461a2b44138095d6b)\nSHA256SUMS.txt \u63d0\u4f9b\u672c\u9875\u4e24\u4e2a DMG \u7684\u6821\u9a8c\u503c\u3002\n\n<!-- tested-source:a3966822c3ee061091be0b8461a2b44138095d6b publisher-schema:1 -->\n"
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
  'Live orders require native per-order human confirmation; unattended trading is disabled. No user account or private data is included.',
  ...published.assets.map(asset => `- [${asset.name}](${asset.browser_download_url})`),
  ''
].join('\n'));
console.log(`Published ${published.html_url}`);
