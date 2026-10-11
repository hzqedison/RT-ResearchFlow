'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { nsisArguments, quoteWindowsArgument, expectedOldUninstallerExecutions } = require('../../scripts/run-windows-install-repair-fixtures.cjs')

test('NSIS terminal /D remains raw despite directory spaces', () => {
  assert.deepEqual(nsisArguments(['/S', '/RTRepair', '/currentuser', '/D=D:\\Program Files\\RT-ResearchFlow']),
    ['"/S"', '"/RTRepair"', '"/currentuser"', '/D=D:\\Program Files\\RT-ResearchFlow'])
})
test('NSIS without override uses ordinary escaped options', () => {
  assert.deepEqual(nsisArguments(['/S']), ['"/S"'])
})
test('NSIS target must be terminal, unquoted, single and on a fixture drive', () => {
  for (const args of [
    ['/D=D:\\Program Files\\RT-ResearchFlow', '/S'],
    ['/D=D:\\one', '/D=K:\\two'], ['/D'], ['/d=D:\\one'],
    ['/D="D:\\Program Files\\RT-ResearchFlow"'], ['/D=C:\\one'],
    ['/D=D:\\one\n'], ['/S\0'],
  ]) assert.throws(() => nsisArguments(args), /REJECTED/)
})
test('Windows argument escaping retains quotes and trailing backslashes', () => {
  assert.equal(quoteWindowsArgument('a"b'), '"a\\"b"')
  assert.equal(quoteWindowsArgument('D:\\space path\\'), '"D:\\space path\\\\"')
})
test('healthy upgrade declares its reviewed expected count, not a universal zero', () => {
  for (const count of [0, 1]) assert.equal(expectedOldUninstallerExecutions({ name: 'healthy-upgrade-same-directory', expectedOldUninstallerExecutions: count }), count)
  for (const count of [undefined, -1, 2, '1']) assert.throws(() => expectedOldUninstallerExecutions({ name: 'healthy-upgrade-same-directory', expectedOldUninstallerExecutions: count }))
})
test('repair and invalid-old-path cases always require no old uninstaller', () => {
  for (const name of ['invalid-old-file-no-repair', 'per-user-explicit-repair', 'all-users-explicit-repair']) {
    assert.equal(expectedOldUninstallerExecutions({ name }), 0)
    assert.throws(() => expectedOldUninstallerExecutions({ name, expectedOldUninstallerExecutions: 1 }))
  }
})
