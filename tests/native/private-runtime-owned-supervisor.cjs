'use strict'
// Genuine process-ownership probes only. Not product bootstrap or installer QA.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { runOwnedPrivatePython } = require('../../scripts/private-runtime-owned-supervisor.cjs')
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
async function main() {
  if (process.platform !== 'win32') throw new Error('WINDOWS_PRIMITIVE_PROBE_ONLY')
  const python = process.env.RT_PRIVATE_PYTHON_PROBE, base = process.env.RT_OWNED_PROBE_ROOT
  if (!python || !path.isAbsolute(python) || !base || !/^[DK]:[\\/]/i.test(base) ||
      !fs.statSync(base).isDirectory()) throw new Error('EXPLICIT_ISOLATED_PROBE_PATHS_REQUIRED')
  const root = fs.mkdtempSync(path.join(fs.realpathSync(base), 'rt-owned-supervisor-probe-'))
  const hostPath = path.resolve(__dirname, '../../resources/private-runtime-owned-job-host.cs')
  const nativeHostSource = { path: hostPath, sha256: sha(fs.readFileSync(hostPath)) }
  const environment = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
    PATH: path.dirname(python), HOME: root, USERPROFILE: root, TEMP: root, TMP: root,
    PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', NODE_OPTIONS: '', NODE_PATH: '', PYTHONPATH: '' }
  const cases = []
  function invoke(filename, deadlineMs, args = []) {
    return runOwnedPrivatePython({ executable: python, args: ['-X', 'utf8', '-I', '-S', '-B', filename, ...args],
      cwd: root, env: environment, input: Buffer.alloc(0), shell: false, windowsHide: true,
      deadlineMs, stdoutByteCap: 1024 * 1024, stderrByteCap: 8192, ownershipMode: 'windows-job', nativeHostSource })
  }
  let successfulCleanup = false
  try {
    const positive = path.join(root, 'positive.py')
    fs.writeFileSync(positive, 'import json\nprint(json.dumps({"probe": "actual-owned-python", "product": False}))\n', { flag: 'wx' })
    const ok = await invoke(positive, 10000)
    assert.equal(ok.exitCode, 0); assert.equal(ok.exitObserved, true); assert.equal(ok.ownedTreeEmpty, true)
    assert.equal(ok.stderr.length, 0); assert.ok(ok.nativeRootPid > 0)
    assert.equal(JSON.parse(ok.stdout.toString('utf8')).product, false)
    cases.push({ case: 'real-private-python-positive', passed: true, nativeRootPid: ok.nativeRootPid,
      compilation: ok.compilation, kernelOwnedJobEmpty: true })

    const nonzero = path.join(root, 'nonzero.py')
    fs.writeFileSync(nonzero, 'import sys\nsys.exit(7)\n', { flag: 'wx' })
    await assert.rejects(invoke(nonzero, 10000), /OWNED_SUPERVISOR_NATIVE_FAILED/)
    cases.push({ case: 'real-nonzero-root-is-not-success', passed: true })

    const timeout = path.join(root, 'timeout.py'), identities = path.join(root, 'owned-pids.json')
    fs.writeFileSync(timeout, [
      'import json, os, subprocess, sys, time',
      'child = subprocess.Popen([sys.executable, "-X", "utf8", "-I", "-S", "-B", "-c", "import time; time.sleep(60)"])',
      'with open(sys.argv[1], "w", encoding="utf-8") as f: json.dump({"worker": os.getpid(), "child": child.pid}, f)',
      'time.sleep(60)', '',
    ].join('\n'), { flag: 'wx' })
    // Include cold PowerShell startup before the probe creates its real child.
    // The Python sleep remains much longer than this bounded supervisor deadline.
    await assert.rejects(invoke(timeout, 5000, [identities]), /OWNED_SUPERVISOR_NATIVE_FAILED|OWNED_SUPERVISOR_CHILD_FAILED/)
    const pids = JSON.parse(fs.readFileSync(identities, 'utf8'))
    for (const pid of [pids.worker, pids.child]) {
      assert.ok(Number.isSafeInteger(pid) && pid > 0)
      let alive = true
      const end = Date.now() + 5000
      while (alive && Date.now() < end) {
        try { process.kill(pid, 0) } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error }
        if (alive) await new Promise(resolve => setTimeout(resolve, 25))
      }
      assert.equal(alive, false, 'Actual owned timeout process remains alive')
    }
    cases.push({ case: 'real-timeout-kills-python-and-owned-descendant', passed: true, observedPids: pids })
    successfulCleanup = true
    console.log(JSON.stringify({ kind: 'rt-private-owned-job-primitive-probe-v1', platform: process.platform,
      arch: process.arch, productRuntimeTested: false, installerTested: false, cases }))
  } finally {
    // Keep failed native probe evidence rather than deleting a possibly live tree.
    if (successfulCleanup && root.startsWith(fs.realpathSync(base) + path.sep) &&
        path.basename(root).startsWith('rt-owned-supervisor-probe-')) fs.rmSync(root, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error.code || error.message); process.exitCode = 1 })
