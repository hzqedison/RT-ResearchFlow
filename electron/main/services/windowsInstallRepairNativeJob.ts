import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import type { WindowsRepairCollectorInvocation } from './windowsInstallRepairCollector'
export interface WindowsRepairReviewedJobHost { executable: string; sha256: string; privateCache: string }
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
function fail(): never { throw new Error('WINDOWS_REPAIR_NATIVE_JOB_REJECTED') }
// SHA is from independently verified producer roots, never an echo of this file.
export function runWindowsRepairNativeJob(spec: WindowsRepairCollectorInvocation, reviewed: WindowsRepairReviewedJobHost): Promise<Uint8Array> {
  if (process.platform !== 'win32' || !/^[a-f0-9]{64}$/.test(reviewed.sha256) || sha(readFileSync(reviewed.executable)) !== reviewed.sha256 ||
      spec.shell !== false || spec.args.length !== 5 || spec.args[3] !== '-EncodedCommand' || !/^[A-Za-z0-9+/=]+$/.test(spec.args[4]) ||
      spec.input.byteLength > 4 * 1024 * 1024) fail()
  return new Promise((resolve, reject) => {
    const child = spawn(reviewed.executable, [spec.args[4], reviewed.privateCache, String(spec.timeoutMs)],
      { shell: false, windowsHide: true, cwd: reviewed.privateCache, env: {}, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = 0, stderr = 0, failed = false; const chunks: Buffer[] = []
    const stop = () => { failed = true; child.kill() } // Host death closes its non-inherited KILL_ON_JOB_CLOSE Job.
    const timer = setTimeout(stop, spec.timeoutMs + 10000)
    child.stdout.on('data', (bytes: Buffer) => { stdout += bytes.length; if (stdout > spec.stdoutCap) stop(); else chunks.push(bytes) })
    child.stderr.on('data', (bytes: Buffer) => { stderr += bytes.length; if (stderr > spec.stderrCap) stop() })
    child.on('error', stop); child.stdin.on('error', stop)
    child.once('close', code => { clearTimeout(timer); if (failed || code !== 0) reject(new Error('WINDOWS_REPAIR_NATIVE_JOB_FAILED')); else resolve(Buffer.concat(chunks)) })
    child.stdin.end(spec.input)
  })
}
