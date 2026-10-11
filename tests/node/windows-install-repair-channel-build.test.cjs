'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const child = require('node:child_process');
const { PINS, verifyPin, peMachine, peExports } = require('../../scripts/build-windows-install-repair-channel.cjs');

test('toolchain and Node ABI pins are exact and fail closed on altered bytes', () => {
  assert.match(PINS.zig.sha256, /^[a-f0-9]{64}$/);
  assert.match(PINS.headers.sha256, /^[a-f0-9]{64}$/);
  assert.match(PINS.library.sha256, /^[a-f0-9]{64}$/);
  assert.match(PINS.unpacker.sha256, /^[a-f0-9]{64}$/);
  const file = path.join('D:/RT-ResearchFlow-BuildCache', 'repair-channel-bad-pin-' + crypto.randomUUID());
  fs.writeFileSync(file, 'not an upstream tool', { flag: 'wx' });
  try { assert.throws(() => verifyPin(file, PINS.zig), /upstream-sha/); }
  finally { fs.unlinkSync(file); }
});

test('built binaries have x86 NSIS and x64 Node identities when provided', t => {
  const root = process.env.RT_REPAIR_CHANNEL_BUILD;
  if (!root) return t.skip('compiled binaries not provided');
  const channel = path.join(root, 'windows-install-repair-channel.dll');
  const binding = path.join(root, 'windows-install-repair-stdin-binding.node');
  assert.equal(peMachine(channel), 0x14c);
  assert.equal(peMachine(binding), 0x8664);
  assert.ok(peExports(channel).includes('Launch'));
});

test('C Downloads installer path is accepted without admitting C payload paths', t => {
  const root = process.env.RT_REPAIR_CHANNEL_BUILD;
  if (!root) return t.skip('compiled path probe not provided');
  const probe = path.join(root, 'installer-path-probe.node');
  assert.equal(peMachine(probe), 0x8664);
  const node = process.env.RT_REPAIR_PRIVATE_NODE;
  assert.ok(node && fs.existsSync(node));
  const result = child.spawnSync(node, ['-e', 'process.exitCode=require(process.argv[1]).check()', probe],
    { timeout: 20000, encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
});

test('Node binding reads exactly one inherited pipe frame, not caller strings', t => {
  const root = process.env.RT_REPAIR_CHANNEL_BUILD;
  if (!root) return t.skip('compiled binding not provided');
  const addon = path.join(root, 'windows-install-repair-stdin-binding.node');
  const node = process.env.RT_REPAIR_PRIVATE_NODE;
  assert.ok(node && fs.existsSync(node));
  const source = 'const a=require(process.argv[1]);try{const x=a.readInheritedAnonymousStdin();process.stdout.write(JSON.stringify({kind:x.kind,eof:x.eof,hex:x.packet.toString("hex")}))}catch{process.exitCode=23}';
  const good = Buffer.from([1, 1, ...Array.from({ length: 32 }, (_, index) => index + 1)]);
  const invoke = input => child.spawnSync(node, ['-e', source, addon], {
    input, encoding: 'utf8', timeout: 20000, env: { SystemRoot: process.env.SystemRoot || 'C:\\Windows' },
  });
  const accepted = invoke(good);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.deepEqual(JSON.parse(accepted.stdout), { kind: 'win32-inherited-anonymous-stdin-v1', eof: true, hex: good.toString('hex') });
  for (const invalid of [Buffer.alloc(0), Buffer.concat([good, Buffer.from([0])]),
    Buffer.from([1, 0, ...good.subarray(2)])]) {
    assert.equal(invoke(invalid).status, 23);
  }
});
