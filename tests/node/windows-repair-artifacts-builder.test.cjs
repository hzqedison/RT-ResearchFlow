'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { prepare, seal, validInventoryName } = require('../../scripts/build-windows-repair-artifacts.cjs');
const root = path.resolve('K:/AI/person/money/RT-ResearchFlow');
function temp() {
  const base = path.join('D:/RT-ResearchFlow-BuildCache', 'repair-producer-test-' + crypto.randomUUID());
  fs.mkdirSync(base, { recursive: true });
  return base;
}
test('fresh CI key compiles immutable trust and signs only final file digests', () => {
  const base = temp();
  try {
    const ports = path.join(root, 'tests/node/windows-repair-test-ports-' + crypto.randomUUID() + '.cjs');
    fs.writeFileSync(ports, 'exports.trustedWindowsRepairConsumerPorts = {};\n', { flag: 'wx' });
    try {
      const config = path.join(base, 'config.json');
      fs.writeFileSync(config, JSON.stringify({ appId: 'com.tradewatcher.app',
        appGuid: '11111111-2222-3333-4444-555555555555', version: '1.7.0', channel: 'stable',
        registryInstallKey: 'Software\\RT-ResearchFlow',
        registryUninstallKey: 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RT-ResearchFlow',
        allowedScopeViews: ['per-user:64', 'all-users:64'] }));
      const stage = prepare(['--config', config, '--ports', ports, '--out', path.join(base, 'public'),
        '--private-root', path.join(base, 'private')]);
      const tree = path.join(base, 'tree'); fs.mkdirSync(tree);
      const files = { installer: path.join(base, 'final.exe'), consumer: stage.consumerFile,
        'private-node': path.join(tree, 'node.exe'), 'native-host': path.join(tree, 'host.ps1'),
        'job-host': path.join(tree, 'job.exe'), 'runtime-seal': path.join(tree, 'seal.json') };
      for (const [name, file] of Object.entries(files)) if (name !== 'consumer') fs.writeFileSync(file, name);
      fs.writeFileSync(path.join(tree, 'Uninstall RT-ResearchFlow.exe'), 'uninstaller');
      fs.copyFileSync(stage.consumerFile, path.join(tree, 'consumer.cjs'));
      const receiptFile = path.join(base, 'receipt.json'), signatureFile = path.join(base, 'receipt.sig');
      seal(['--state', stage.stateFile, ...Object.entries(files).flatMap(([k, v]) => ['--' + k, v]),
        '--program-tree', tree, '--registered-uninstaller', 'Uninstall RT-ResearchFlow.exe',
        '--source-commit', 'a'.repeat(40), '--source-tree', 'b'.repeat(40), '--producer-workflow', 'trusted-ci',
        '--producer-run-id', '123', '--producer-run-attempt', '1', '--receipt-out', receiptFile,
        '--signature-out', signatureFile]);
      const raw = fs.readFileSync(receiptFile), receipt = JSON.parse(raw), state = JSON.parse(fs.readFileSync(stage.stateFile));
      const key = crypto.createPublicKey(fs.readFileSync(state.privateFile));
      assert.equal(crypto.verify(null, raw, key, fs.readFileSync(signatureFile)), true);
      assert.equal(receipt.installer.sha256, crypto.createHash('sha256').update('installer').digest('hex'));
      assert.equal(Object.hasOwn(receipt, 'policy'), false);
      assert.equal(Object.hasOwn(receipt, 'nonce'), false);
      assert.equal(Object.hasOwn(receipt, 'registryInstallKey'), false);
      assert.throws(() => seal(['--state', stage.stateFile]), /arguments/);
      fs.appendFileSync(files.installer, 'tamper');
      assert.notEqual(receipt.installer.sha256, crypto.createHash('sha256').update(fs.readFileSync(files.installer)).digest('hex'));
    } finally { fs.unlinkSync(ports); }
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
test('producer admits only names that the consumer can verify', () => {
  for (const accepted of ['RT-ResearchFlow.exe', 'resources/runtime/node.exe', 'a'.repeat(240)]) {
    assert.equal(validInventoryName(accepted), true, accepted);
  }
  for (const rejected of ['a'.repeat(241), 'CON.txt', 'x/NUL', 'Data/user.db',
    'userdata', 'Backups/old.db', 'x/../escape', 'x/name.', 'x\\wrong']) {
    assert.equal(validInventoryName(rejected), false, rejected);
  }
});
