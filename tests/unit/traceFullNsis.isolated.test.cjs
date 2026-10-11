'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
test('diagnostic instrumentation preserves UTF-8 and literal NSIS macros without touching dependencies', () => {
  const script = path.resolve('scripts/trace-full-nsis.cjs')
  const writes = new Map()
  const mockFs = { readFileSync: () => '\uFEFFSystem::Call "kernel32::GetDriveTypeW(w r0) i.r1"\n# fixture\n',
    writeFileSync: (file, bytes) => writes.set(file, bytes) }
  const mockRequire = name => name === 'node:fs' ? mockFs : require(name)
  mockRequire.resolve = () => path.resolve('virtual-native-package/package.json')
  vm.runInNewContext(fs.readFileSync(script, 'utf8'), { require: mockRequire, __dirname: path.dirname(script) })
  assert.equal(writes.size, 2)
  for (const bytes of writes.values()) {
    assert.ok(bytes.startsWith('\uFEFF'))
    assert.equal((bytes.match(/\uFEFF/g) || []).length, 1)
    assert.ok(bytes.includes('-returned'))
  }
  const resource = [...writes.values()].find(bytes => bytes.includes('defineRTNativeTrace'))
  assert.ok(resource.includes('Function ${PREFIX}rtNativeTrace'))
  assert.ok(resource.includes('Push "${LABEL}"'))
})
