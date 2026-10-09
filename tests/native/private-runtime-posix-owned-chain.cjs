'use strict'

// Test-only OS primitive evidence. Never product/license/provider approval.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { performance } = require('node:perf_hooks')
const { runOwnedPrivatePython, posixLaunchArgs } = require('../../scripts/private-runtime-owned-supervisor.cjs')
const REPO = path.resolve(__dirname, '../..')
const FLAGS = ['-X', 'utf8', '-I', '-S', '-B']
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const SCOPE = Object.freeze({ releaseEligible: false, productApproval: false, productRuntimeTested: false,
  productionReporterTested: false, providerBundleTested: false, licensingReviewed: false, installerTested: false })

const COMMON = String.raw`
import argparse, datetime, hashlib, json, os, pathlib, runpy, subprocess, sys, time
def check(value):
    if not value: raise RuntimeError('OWNED_CHAIN_PROBE_INVALID')
def stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds')
def atomic(name, value):
    name=pathlib.Path(name); tmp=name.with_name(name.name+'.writing')
    tmp.write_text(json.dumps(value,allow_nan=False),encoding='utf-8'); os.replace(tmp,name)
def read_json(name):
    raw=pathlib.Path(name).read_bytes(); check(0<len(raw)<=65536); return json.loads(raw)
def fingerprint(name):
    digest=hashlib.sha256()
    with pathlib.Path(name).open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''): digest.update(block)
    return digest.hexdigest()
def identity(role,root):
    return {'role':role,'pid':os.getpid(),'parentPid':os.getppid(),'pgid':os.getpgrp(),
            'sid':os.getsid(0),'rootPid':root,'startedAt':stamp(),'nonce':cfg['nonce']}
def wait_ack(role,seconds=8):
    end=time.monotonic()+seconds; filename=base/(role+'.ack')
    while not filename.exists():
        check(time.monotonic()<end); time.sleep(.01)
    check(filename.read_text(encoding='ascii')==cfg['nonce'])
def loaded_sources():
    for name,pin in cfg['sourcePins'].items(): check(fingerprint(pin['path'])==pin['sha256'])
    return (runpy.run_path(cfg['sourcePins']['bootstrap']['path'],run_name='owned_chain_test_bootstrap'),
            runpy.run_path(cfg['sourcePins']['adapter']['path'],run_name='owned_chain_test_adapter'))
check(sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode and sys.flags.utf8_mode==1)
`

const ROOT_PROBE = COMMON + String.raw`
parser=argparse.ArgumentParser()
parser.add_argument('--pre-seal-bootstrap-contract',required=True)
parser.add_argument('--pre-seal-owned-posix-root')
args=parser.parse_args(); cfg=read_json(args.pre_seal_bootstrap_contract); base=pathlib.Path(cfg['caseRoot'])
check(cfg['kind']=='rt-private-posix-owned-chain-fixture-v1' and cfg['releaseEligible'] is False)
check(cfg['productApproval'] is False and sys.platform=='darwin')
if cfg['scenario']=='default-disabled':
    check(args.pre_seal_owned_posix_root is None)
    print(json.dumps({'kind':'rt-posix-default-disabled-probe-v1','releaseEligible':False,
                      'pid':os.getpid(),'pgid':os.getpgrp(),'sid':os.getsid(0),'argv':sys.argv[1:]}))
    raise SystemExit(0)
bootstrap,adapter=loaded_sources()
root=bootstrap['validate_pre_seal_owned_posix_root'](args.pre_seal_owned_posix_root)
check(root==os.getpid()==os.getpgrp()==os.getsid(0))
record=identity('root',root); record['argv']=sys.argv[1:]; record['pythonExecutable']=sys.executable
record['scriptPath']=str(pathlib.Path(__file__).resolve())
record['isolationFlags']={'isolated':sys.flags.isolated,'noSite':sys.flags.no_site,
                          'dontWriteBytecode':sys.flags.dont_write_bytecode,'utf8Mode':sys.flags.utf8_mode}
atomic(base/'root.json',record); wait_ack('root')
worker=subprocess.Popen([sys.executable,'-X','utf8','-I','-S','-B',cfg['workerPath'],
                         '--config',args.pre_seal_bootstrap_contract,'--pre-seal-owned-posix-root',str(root)],
                        shell=False,start_new_session=False,env=dict(os.environ),stdin=subprocess.DEVNULL,
                        stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,close_fds=True)
check(os.getpgid(worker.pid)==root and os.getsid(worker.pid)==root)
if cfg['scenario']=='root-first':
    wait_ack('node'); node=read_json(base/'node.json')
    os.kill(node['pid'],0); os.kill(worker.pid,0)
    atomic(base/'root-exit-intent.json',{'rootPid':root,'workerPid':worker.pid,'nodePid':node['pid'],
                                      'nodeAliveObservedAt':stamp(),'nonce':cfg['nonce']})
    os._exit(0)
raise SystemExit(worker.wait(timeout=18))
`

const WORKER_PROBE = COMMON + String.raw`
parser=argparse.ArgumentParser(); parser.add_argument('--config',required=True)
parser.add_argument('--pre-seal-owned-posix-root',required=True)
args=parser.parse_args(); cfg=read_json(args.config); base=pathlib.Path(cfg['caseRoot'])
check(cfg['releaseEligible'] is False and cfg['productApproval'] is False)
bootstrap,adapter=loaded_sources()
root=bootstrap['validate_pre_seal_owned_posix_root'](args.pre_seal_owned_posix_root)
adapter['validate_pre_seal_owned_posix_root'](root)
check(os.getpid()!=root and os.getppid()==root)
atomic(base/'worker.json',identity('worker',root)); wait_ack('worker')
original=subprocess.Popen
expected=cfg['auditNodeExecutable'] if cfg['api']=='bootstrap.check_dependency_audits' else cfg['runnerNodeExecutable']
observations=[]
class ObservedPopen(original):
    def __init__(self,*arguments,**keywords):
        command=arguments[0] if arguments else keywords.get('args')
        check(isinstance(command,list) and command[0]==expected)
        check(keywords.get('start_new_session') is False and keywords.get('shell') is False)
        started=stamp(); super().__init__(*arguments,**keywords)
        check(os.getpgid(self.pid)==root and os.getsid(self.pid)==root)
        self.record={'role':'node','pid':self.pid,'parentPid':os.getpid(),'pgid':os.getpgid(self.pid),
                     'sid':os.getsid(self.pid),'rootPid':root,'startedAt':started,'nonce':cfg['nonce'],
                     'executable':command[0],'binarySha256':fingerprint(command[0]),'actualArgs':command,
                     'startNewSession':keywords['start_new_session'],'calledApi':cfg['api']}
        observations.append(self.record); check(len(observations)==1)
        atomic(base/'node.json',self.record)
    def observed(self,code):
        if code is not None and 'exitedAt' not in self.record:
            self.record.update(exitCode=code,exitedAt=stamp())
            atomic(base/'node-popen-exit.json',self.record)
        return code
    def poll(self): return self.observed(super().poll())
    def wait(self,*args,**kwargs): return self.observed(super().wait(*args,**kwargs))
try:
    # Dedicated owned test worker only. Every Popen argument is forwarded unchanged.
    subprocess.Popen=ObservedPopen
    if cfg['api']=='bootstrap.check_dependency_audits':
        manifest=read_json(base/'manifest.json'); index={row['path']:row for row in manifest['files']}
        result=bootstrap['check_dependency_audits'](base,manifest,index,pre_seal_owned_posix_root=root)
        observed={'returnedProviders':[row['provider'] for row in result]}
    else:
        # In-memory fixture JS pin ONLY; no production source or wheel is modified.
        adapter['SOURCE_HASHES']['hexin-v.bundle.js']=cfg['fixtureTokenJsSha256']
        result=adapter['run_token'](pathlib.Path(cfg['runnerNodeExecutable']),cfg['runnerNodeSha256'],
                                    base/'fixture-token.js',base,time.monotonic()+30,
                                    pre_seal_owned_posix_root=root)
        observed={'returnedFixtureTokenLength':len(result)}
    check(len(observations)==1)
    atomic(base/'api-result.json',{'calledApi':cfg['api'],'observed':observed,'completedAt':stamp(),
                                 'releaseEligible':False,'productApproval':False,'nonce':cfg['nonce']})
finally:
    subprocess.Popen=original
`

const WATCHER_PROBE = COMMON + String.raw`
import select
parser=argparse.ArgumentParser(); parser.add_argument('--config',required=True)
args=parser.parse_args(); cfg=read_json(args.config); base=pathlib.Path(cfg['caseRoot'])
check(sys.platform=='darwin' and cfg['releaseEligible'] is False and cfg['productApproval'] is False)
queue=select.kqueue(); registered={}; exits={}; root=None; end=time.monotonic()+25
try:
    while len(exits)<3:
        check(time.monotonic()<end)
        for role in ('root','worker','node'):
            filename=base/(role+'.json')
            if role in registered or not filename.exists(): continue
            record=read_json(filename); pid=record['pid']; check(type(pid) is int and pid>1)
            check(record['nonce']==cfg['nonce'] and record['role']==role and pid not in registered.values())
            if role=='root': root=pid
            check(root is not None and record['rootPid']==root and record['pgid']==record['sid']==root)
            check(os.getpgrp()!=root and os.getsid(0)!=root)
            check(os.getpgid(pid)==root and os.getsid(pid)==root)
            if role=='worker': check(record['parentPid']==root)
            if role=='node': check(record['parentPid']==registered['worker'])
            queue.control([select.kevent(pid,filter=select.KQ_FILTER_PROC,
                          flags=select.KQ_EV_ADD|select.KQ_EV_ENABLE|select.KQ_EV_ONESHOT,
                          fflags=select.KQ_NOTE_EXIT)],0,0)
            os.kill(pid,0)
            registered[role]=pid
            atomic(base/(role+'-registered.json'),{'pid':pid,'registeredAt':stamp(),
                    'aliveObservedAt':stamp(),'nonce':cfg['nonce'],'watcherPid':os.getpid()})
            (base/(role+'.ack')).write_text(cfg['nonce'],encoding='ascii')
        for event in queue.control(None,8,.01):
            if not event.fflags & select.KQ_NOTE_EXIT: continue
            roles=[role for role,pid in registered.items() if pid==event.ident]; check(len(roles)==1)
            role=roles[0]; check(role not in exits)
            exits[role]={'role':role,'pid':event.ident,'exitObservedAt':stamp(),
                         'observationMethod':'darwin-kqueue-NOTE_EXIT','kernelEventData':event.data,
                         'kernelEventFlags':event.fflags}
        if cfg['scenario']=='outer-timeout' and len(registered)==3 and not (base/'timeout-live.json').exists():
            start_file=base/'outer-start.json'
            if start_file.exists():
                launch=read_json(start_file)
                if time.time()*1000>=launch['unixMs']+launch['deadlineMs']-1000:
                    check(not exits)
                    for pid in registered.values():
                        os.kill(pid,0); check(os.getpgid(pid)==root and os.getsid(pid)==root)
                    atomic(base/'timeout-live.json',{'rootPid':root,'workerPid':registered['worker'],
                           'nodePid':registered['node'],'aliveObservedAt':stamp(),'nonce':cfg['nonce']})
    # Root may already be gone: probe the known group, never root liveness.
    limit=time.monotonic()+5
    while True:
        try: os.killpg(root,0)
        except ProcessLookupError: break
        check(time.monotonic()<limit); time.sleep(.02)
    evidence={'kind':'rt-posix-owned-chain-kernel-observation-v1','releaseEligible':False,'productApproval':False,
              'nonce':cfg['nonce'],'rootPid':root,'watcherPid':os.getpid(),'watcherPgid':os.getpgrp(),
              'watcherSid':os.getsid(0),'processes':[exits[role] for role in ('root','worker','node')],
              'knownGroupAbsentObservedAt':stamp()}
    atomic(base/'kernel-evidence.json',evidence); print(json.dumps(evidence,allow_nan=False))
except BaseException as error:
    import traceback
    atomic(base/'watcher-python-failure.json',{'exceptionType':type(error).__name__,
           'message':str(error),'traceback':traceback.format_exc()[-8192:],
           'registered':registered,'exits':exits,'observedAt':stamp(),'nonce':cfg['nonce']})
    raise
finally:
    queue.close()
`

function parseArguments(argv) {
  const result = {}
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--python', '--cache-root', '--out'].includes(argv[i]) || !argv[i + 1] || result[argv[i]]) throw new Error('PROBE_ARGUMENTS')
    result[argv[i]] = argv[i + 1]
  }
  for (const name of ['--python', '--cache-root']) if (!path.isAbsolute(result[name] || '')) throw new Error('PROBE_EXPLICIT_PATHS_REQUIRED')
  if (result['--out'] && !path.isAbsolute(result['--out'])) throw new Error('PROBE_OUTPUT_PATH')
  return { python: result['--python'], cacheRoot: result['--cache-root'], output: result['--out'] }
}

function environment(root, node) {
  return { PATH: path.dirname(node), HOME: root, USERPROFILE: root, TEMP: root, TMP: root, TMPDIR: root,
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1',
    NODE_OPTIONS: '', NODE_PATH: '', PYTHONPATH: '' }
}

function captureWatcher(python, filename, config, cwd, env) {
  const child = spawn(python, [...FLAGS, filename, '--config', config],
    { cwd, env, shell: false, detached: false, stdio: ['ignore', 'pipe', 'pipe'] })
  let bytes = 0
  const stdout = [], stderr = []
  let failed
  const completion = new Promise((resolve, reject) => {
    const stop = error => { failed = error; child.kill('SIGKILL') }
    const timer = setTimeout(() => stop(new Error('KQUEUE_WATCHER_DEADLINE')), 35000)
    for (const [stream, buffers] of [[child.stdout, stdout], [child.stderr, stderr]]) {
      stream.on('data', block => { bytes += block.length; if (bytes > 65536) stop(new Error('KQUEUE_WATCHER_OUTPUT_CAP')); else buffers.push(block) })
    }
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      fs.writeFileSync(path.join(cwd, 'watcher-exit.json'), JSON.stringify({ pid: child.pid,
        exitCode: code, signal, observedAt: new Date().toISOString(),
        reason: failed ? failed.message : null, stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8') }), { flag: 'wx' })
      if (failed || code !== 0 || signal || stderr.length) reject(failed || new Error('KQUEUE_WATCHER_FAILED'))
      else resolve(JSON.parse(Buffer.concat(stdout).toString('utf8')))
    })
  })
  // The handler is installed before starting the inner supervisor.
  completion.catch(() => {})
  return { completion, stop: () => child.kill('SIGKILL') }
}

function nodeFixture(root, scenario) {
  return `const fs=require('node:fs'),crypto=require('node:crypto');
const root=${JSON.stringify(root)},nonce=JSON.parse(fs.readFileSync(root+'/contract.json')).nonce;
fs.writeFileSync(root+'/node-runtime.json',JSON.stringify({pid:process.pid,version:process.versions.node,executable:process.execPath,binarySha256:crypto.createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex')}));
const end=Date.now()+8000;while(!fs.existsSync(root+'/node.ack')){if(Date.now()>end)throw Error('FIXTURE_ACK_TIMEOUT');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10)};
if(fs.readFileSync(root+'/node.ack','ascii')!==nonce)throw Error('FIXTURE_ACK_INVALID');
${scenario === 'positive' ? '' : 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000);'}
`
}

function sourcePins() {
  return Object.fromEntries([['bootstrap', 'resources/python-runtime/bootstrap.py'],
    ['adapter', 'resources/python-runtime/pywencai_adapter.py'], ['supervisor', 'scripts/private-runtime-owned-supervisor.cjs'],
    ['reporter', 'scripts/report-private-runtime-native-bootstrap.py']]
    .map(([name, file]) => { const filename = path.join(REPO, file); return [name, { path: filename, sha256: sha(fs.readFileSync(filename)) }] }))
}

function prepareCase(base, api, scenario, node, pins) {
  const root = fs.mkdtempSync(path.join(base, 'case-'))
  const reporter = path.join(root, 'owned-chain-probe.py')
  const worker = path.join(root, 'worker-probe.py'), watcher = path.join(root, 'kernel-watcher.py')
  for (const [name, source] of [[reporter, ROOT_PROBE], [worker, WORKER_PROBE], [watcher, WATCHER_PROBE]]) fs.writeFileSync(name, source, { flag: 'wx' })
  const auditNode = path.join(root, 'node', 'node')
  fs.mkdirSync(path.dirname(auditNode)); fs.copyFileSync(node, auditNode); fs.chmodSync(auditNode, fs.statSync(node).mode & 0o777)
  const runnerSha = sha(fs.readFileSync(node)); assert.equal(sha(fs.readFileSync(auditNode)), runnerSha)
  const token = nodeFixture(root, scenario) + "process.stdout.write('FixtureToken0123456789abcdef');\n"
  const validator = "exports.validateDependencyAudits=function(){\n" + nodeFixture(root, scenario) +
    "return ['akshare','mootdx','pywencai'].map(provider=>({provider}));};\n"
  fs.writeFileSync(path.join(root, 'fixture-token.js'), token, { flag: 'wx' })
  fs.writeFileSync(path.join(root, 'private_runtime_manifest.cjs'), validator, { flag: 'wx' })
  const files = ['node/node', 'private_runtime_manifest.cjs'].map(name => {
    const data = fs.readFileSync(path.join(root, name)); return { path: name, kind: 'file', size: data.length, sha256: sha(data) }
  })
  const manifest = { kind: 'owned-os-primitive-fixture-not-product', releaseEligible: false,
    node: { executable: 'node/node', version: process.versions.node }, files,
    dependencyAuditValidator: { path: 'private_runtime_manifest.cjs', sha256: files[1].sha256 } }
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest), { flag: 'wx' })
  const config = { kind: 'rt-private-posix-owned-chain-fixture-v1', ...SCOPE, api, scenario,
    nonce: crypto.randomBytes(32).toString('hex'), caseRoot: root, workerPath: worker,
    runnerNodeExecutable: node, runnerNodeSha256: runnerSha, auditNodeExecutable: auditNode,
    fixtureTokenJsSha256: sha(Buffer.from(token)), sourcePins: pins }
  const configPath = path.join(root, 'contract.json')
  fs.writeFileSync(configPath, JSON.stringify(config), { flag: 'wx' })
  return { root, reporter, worker, watcher, config, configPath }
}

function deriveTestLaunchArgs(validFixedReporterSpec, testSuccessor) {
  // Invoke the CURRENT exported production gate only with its legal fixed
  // eight-argument input. Never loosen it or authorize a fixture reporter.
  const fixedPath = path.join(REPO, 'scripts/report-private-runtime-native-bootstrap.py')
  assert.equal(validFixedReporterSpec.preSealPosixInherited, true)
  assert.equal(validFixedReporterSpec.args.length, 8)
  assert.deepEqual(validFixedReporterSpec.args.slice(0, 6), [...FLAGS, fixedPath])
  assert.equal(validFixedReporterSpec.args[6], '--pre-seal-bootstrap-contract')
  assert.ok(path.isAbsolute(validFixedReporterSpec.args[7]))
  assert.ok(path.isAbsolute(testSuccessor) && testSuccessor !== fixedPath)
  const actual = posixLaunchArgs(validFixedReporterSpec)
  assert.equal(actual.length, 15)
  assert.deepEqual(actual.slice(0, 6), [...FLAGS, '-c'])
  assert.equal(typeof actual[6], 'string')
  assert.ok(actual[6].length > 0)
  assert.deepEqual(actual.slice(7), validFixedReporterSpec.args)
  const args = [...actual]
  args[12] = testSuccessor
  // Only the post-gate script operand changes; flags and gate bytes stay exact.
  for (let index = 0; index < actual.length; index++) {
    if (index !== 12) assert.equal(args[index], actual[index])
  }
  return { args, observation: {
    kind: 'rt-posix-exported-gate-test-derivation-v1', productionReporterAuthorityUsed: false,
    authorizedFixedArgv: [...validFixedReporterSpec.args], exactGatePrefix: actual.slice(0, 6),
    gateSourceSha256: sha(Buffer.from(actual[6], 'utf8')),
    gateSourceBase64: Buffer.from(actual[6], 'utf8').toString('base64'),
    originalSuccessor: fixedPath, testSuccessor, actualTestLaunchArgs: args,
  } }
}

function validateKernelEvidence(evidence, fixture, runtime) {
  assert.equal(evidence.kind, 'rt-posix-owned-chain-kernel-observation-v1')
  assert.equal(evidence.releaseEligible, false); assert.equal(evidence.productApproval, false)
  assert.equal(evidence.nonce, fixture.config.nonce)
  const records = ['root', 'worker', 'node'].map(role => JSON.parse(fs.readFileSync(path.join(fixture.root, role + '.json'))))
  assert.equal(new Set(records.map(row => row.pid)).size, 3)
  for (const record of records) {
    assert.ok(Number.isSafeInteger(record.pid) && record.pid > 1)
    assert.equal(record.pgid, evidence.rootPid); assert.equal(record.sid, evidence.rootPid)
    const event = evidence.processes.find(row => row.role === record.role)
    assert.ok(event); assert.equal(event.pid, record.pid); assert.equal(event.observationMethod, 'darwin-kqueue-NOTE_EXIT')
    assert.ok(Date.parse(event.exitObservedAt) >= Date.parse(record.startedAt))
  }
  assert.notEqual(evidence.watcherPgid, evidence.rootPid); assert.notEqual(evidence.watcherSid, evidence.rootPid)
  assert.equal(records[0].pid, evidence.rootPid)
  assert.deepEqual(records[0].argv.slice(-2), ['--pre-seal-owned-posix-root', String(evidence.rootPid)])
  assert.deepEqual(records[0].argv, ['--pre-seal-bootstrap-contract', fixture.configPath,
    '--pre-seal-owned-posix-root', String(evidence.rootPid)])
  assert.equal(records[0].scriptPath, fixture.reporter)
  assert.equal(records[0].pythonExecutable, fixture.config.pythonExecutable)
  assert.deepEqual(records[0].isolationFlags, { isolated: 1, noSite: 1, dontWriteBytecode: 1, utf8Mode: 1 })
  assert.equal(records[2].startNewSession, false)
  assert.equal(records[2].calledApi, fixture.config.api)
  assert.equal(records[2].binarySha256, fixture.config.runnerNodeSha256)
  assert.equal(runtime.pid, records[2].pid); assert.equal(runtime.binarySha256, fixture.config.runnerNodeSha256)
  assert.equal(runtime.version, process.versions.node)
  assert.ok(Number.isFinite(Date.parse(evidence.knownGroupAbsentObservedAt)))
  return records
}

async function runCase(base, python, node, pins, api, scenario) {
  const fixture = prepareCase(base, api, scenario, node, pins)
  const env = environment(fixture.root, node)
  const fixedReporterCase = ['default-disabled', 'actual-reporter-gate'].includes(scenario)
  const fixedArgs = [...FLAGS, pins.reporter.path, '--pre-seal-bootstrap-contract', fixture.configPath]
  const spec = { executable: python, args: fixedArgs,
    cwd: fixture.root, env, input: Buffer.alloc(0), shell: false, ownershipMode: 'posix-owned-session',
    preSealPosixInherited: scenario === 'actual-reporter-gate', deadlineMs: scenario === 'outer-timeout' ? 12000 : 20000,
    stdoutByteCap: 65536, stderrByteCap: 8192 }
  let gateDerivation
  if (!fixedReporterCase) {
    gateDerivation = deriveTestLaunchArgs({ ...spec, preSealPosixInherited: true }, fixture.reporter)
    spec.args = gateDerivation.args
    // Ordinary ownership entry executes the exact generated -c gate. The
    // substituted test successor never enters production reporter authority.
    spec.preSealPosixInherited = false
    fixture.config.pythonExecutable = python
    fixture.config.gateDerivation = gateDerivation.observation
    fs.writeFileSync(fixture.configPath, JSON.stringify(fixture.config))
  }
  if (fixedReporterCase) {
    assert.equal(spec.args.length, 8)
    assert.equal(spec.args[5], pins.reporter.path)
    const execution = await runOwnedPrivatePython(spec)
    assert.equal(execution.exitObserved, true); assert.equal(execution.ownedTreeEmpty, true)
    let observation
    if (scenario === 'default-disabled') {
      assert.equal(execution.exitCode, 2)
      observation = JSON.parse(execution.stdout.toString('utf8'))
      assert.equal(observation.reason, 'NATIVE_POSIX_OWNERSHIP_PENDING')
      assert.equal(execution.stderr.length, 0)
    } else {
      assert.equal(execution.exitCode, 70)
      assert.equal(execution.stdout.length, 0)
      assert.equal(execution.stderr.toString('utf8'), 'NATIVE_BOOTSTRAP_EVIDENCE_INVALID\n')
      observation = { outcome: 'fixed-production-reporter-rejected-owned-fixture', positiveReportGenerated: false }
    }
    assert.ok(!fs.existsSync(path.join(fixture.root, 'node.json')))
    return { scenario, ...SCOPE, controlRoute: 'fixed-production-reporter', finalSpecArgs: spec.args,
      preSealPosixInherited: spec.preSealPosixInherited, observation,
      supervisorExit: { pid: execution.pid, exitCode: execution.exitCode, observedAt: new Date().toISOString() } }
  }
  const watcher = captureWatcher(python, fixture.watcher, fixture.configPath, fixture.root, env)
  const start = performance.now()
  const outerStartedAt = new Date().toISOString()
  fs.writeFileSync(path.join(fixture.root, 'outer-start.json'), JSON.stringify({ unixMs: Date.parse(outerStartedAt),
    startedAt: outerStartedAt, deadlineMs: spec.deadlineMs }), { flag: 'wx' })
  let execution, error, outerReturnObservedAt
  try {
    try { execution = await runOwnedPrivatePython(spec) } catch (failure) { error = failure.message }
    outerReturnObservedAt = new Date().toISOString()
    const elapsedMs = performance.now() - start
    const evidence = await watcher.completion
    const runtime = JSON.parse(fs.readFileSync(path.join(fixture.root, 'node-runtime.json')))
    const records = validateKernelEvidence(evidence, fixture, runtime)
    if (scenario === 'positive') {
      assert.ok(execution); assert.equal(execution.exitCode, 0); assert.equal(execution.exitObserved, true); assert.equal(execution.ownedTreeEmpty, true)
      assert.equal(execution.pid, evidence.rootPid)
      const popen = JSON.parse(fs.readFileSync(path.join(fixture.root, 'node-popen-exit.json')))
      assert.equal(popen.pid, runtime.pid); assert.equal(popen.exitCode, 0)
      const result = JSON.parse(fs.readFileSync(path.join(fixture.root, 'api-result.json')))
      assert.equal(result.calledApi, api)
    } else {
      assert.equal(error, 'OWNED_SUPERVISOR_GROUP_FAILED')
      if (scenario === 'outer-timeout') {
        assert.ok(elapsedMs >= spec.deadlineMs - 50)
        const live = JSON.parse(fs.readFileSync(path.join(fixture.root, 'timeout-live.json')))
        assert.equal(live.nonce, fixture.config.nonce)
        assert.equal(live.rootPid, evidence.rootPid); assert.equal(live.workerPid, records[1].pid)
        assert.equal(live.nodePid, runtime.pid)
        const aliveMs = Date.parse(live.aliveObservedAt)
        assert.ok(aliveMs >= Date.parse(outerStartedAt) + spec.deadlineMs - 1100)
        assert.ok(aliveMs <= Date.parse(outerStartedAt) + spec.deadlineMs)
        for (const event of evidence.processes) {
          assert.ok(Date.parse(event.exitObservedAt) >= Date.parse(outerStartedAt) + spec.deadlineMs - 50)
        }
        assert.ok(!fs.existsSync(path.join(fixture.root, 'api-result.json')))
      }
      if (scenario === 'root-first') {
        const intent = JSON.parse(fs.readFileSync(path.join(fixture.root, 'root-exit-intent.json')))
        assert.equal(intent.nodePid, runtime.pid); assert.equal(intent.rootPid, evidence.rootPid)
      }
    }
    return { api, scenario, ...SCOPE, fixtureRoot: fixture.root, rootPid: evidence.rootPid,
      controlRoute: 'ordinary-outer-supervisor-with-exact-exported-posix-gate-and-test-successor',
      productionReporterGateCoversThisApiCase: false,
      gateDerivation: gateDerivation.observation,
      outerDeadlineMs: spec.deadlineMs, outerStartedAt, outerElapsedMs: elapsedMs, outerReturnObservedAt, supervisorError: error || null,
      timeoutLiveObservation: scenario === 'outer-timeout'
        ? JSON.parse(fs.readFileSync(path.join(fixture.root, 'timeout-live.json'))) : null,
      node: { ...records[2], actualRuntime: runtime }, processes: records,
      kernelEvidence: evidence, fixtureTokenJsPinOverride: api === 'adapter.run_token',
      auditExecutableBinding: api === 'bootstrap.check_dependency_audits' ? 'owned-byte-identical-runner-copy-required-by-contained-root-API' : null }
  } finally { watcher.stop() }
}

async function runNative(options) {
  if (process.platform !== 'darwin') throw new Error('NATIVE_DARWIN_REQUIRED')
  assert.ok(path.isAbsolute(options.python)); assert.ok(path.isAbsolute(options.cacheRoot))
  const python = fs.realpathSync(options.python), cache = fs.realpathSync(options.cacheRoot), node = fs.realpathSync(process.execPath)
  assert.ok(fs.statSync(python).isFile() && fs.statSync(cache).isDirectory())
  const root = fs.mkdtempSync(path.join(cache, 'rt-posix-owned-chain-'))
  const pins = sourcePins()
  const cases = []
  // Keep all bounded evidence, including failures, for native CI artifacts.
  try {
    cases.push(await runCase(root, python, node, pins, null, 'default-disabled'))
    cases.push(await runCase(root, python, node, pins, null, 'actual-reporter-gate'))
    for (const api of ['bootstrap.check_dependency_audits', 'adapter.run_token']) {
      for (const scenario of ['positive', 'outer-timeout', 'root-first']) cases.push(await runCase(root, python, node, pins, api, scenario))
    }
    for (const pin of Object.values(pins)) assert.equal(sha(fs.readFileSync(pin.path)), pin.sha256)
    const report = { kind: 'rt-private-posix-owned-chain-native-test-v1', ...SCOPE, platform: process.platform,
      arch: process.arch, fixtureRoot: root, observedAt: new Date().toISOString(), sources: pins,
      harnessSha256: sha(fs.readFileSync(__filename)), probeSources: { root: sha(Buffer.from(ROOT_PROBE)),
        worker: sha(Buffer.from(WORKER_PROBE)), watcher: sha(Buffer.from(WATCHER_PROBE)) },
      scopeLimitations: ['Dual-API cases execute the exact exported posixLaunchArgs gate with a test-only successor, not production reporter authority.',
        'Bootstrap audit executes a byte-identical runner Node copy because its contained-root API requires it.'],
      runnerNode: { executable: node, binarySha256: sha(fs.readFileSync(node)), version: process.versions.node },
      python: { executable: python, binarySha256: sha(fs.readFileSync(python)) }, cases }
    fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' })
    if (options.output) fs.writeFileSync(options.output, JSON.stringify(report, null, 2), { flag: 'wx' })
    return report
  } catch (error) {
    error.evidenceRoot = root
    throw error
  }
}

if (require.main === module) {
  Promise.resolve().then(() => runNative(parseArguments(process.argv.slice(2)))).then(report => {
    process.stdout.write(JSON.stringify(report) + '\n')
  }).catch(error => {
    process.stdout.write(JSON.stringify({ kind: 'rt-private-posix-owned-chain-native-test-failure-v1', ...SCOPE,
      reason: error.code || error.message, evidenceRoot: error.evidenceRoot || null }) + '\n')
    process.exitCode = 1
  })
}
module.exports = { runNative, parseArguments, environment, SCOPE, ROOT_PROBE, WORKER_PROBE, WATCHER_PROBE, deriveTestLaunchArgs }
