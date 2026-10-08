import { nativeTestBinding, nativeTestTempRoot } from '../fixtures/macThsNativeTestRuntime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { performance } from 'node:perf_hooks'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import ts from 'typescript'
import type Database from 'better-sqlite3'
import { MacThsRecoveryCoordinator, verifyLegacyQuiescence, verifyExecutorExit, type LegacyQuiescenceCapability,
  type ExecutorExitCapability } from '../../electron/main/services/macThsRecoveryCoordinator'
import { MacThsIntentStore, type IntentSnapshot } from '../../electron/main/services/macThsIntentStore'

const root=resolve(nativeTestTempRoot, 'mac-ths-f3-coordinator-tests')
const nativeBinding=nativeTestBinding
let directory:string
const ownedChildren:ChildProcess[]=[]
beforeEach(()=>{mkdirSync(root,{recursive:true});directory=mkdtempSync(join(root,'case-'))})
afterEach(async({task})=>{
  vi.restoreAllMocks()
  for(const child of ownedChildren.splice(0))if(child.exitCode===null && child.signalCode===null) {
    const closed=new Promise(done=>child.once('close',done));child.kill('SIGKILL');await closed
  }
  writeFileSync(join(directory,'test-result.json'),JSON.stringify({test:task.name,result:task.result,node:process.version}))
})
function snapshot():IntentSnapshot{
 const now=Date.now();return {schemaVersion:1,executor:'mac-local-ths',mode:'live',action:'submit',symbol:'600000',market:'SH',side:'buy',
 priceCents:1000,quantity:100,maxNotionalCents:100000,cancelTarget:null,accountContext:{digest:'a'.repeat(64),label:'**1234',
 distinguishable:true,capturedAt:now,clientVersion:'1',adapterVersion:'3'},input:{source:'manual',capturedAt:now},createdAt:now,expiresAt:now+120000}
}
function source(entry?:string) {
  directory=join(directory,'owned-source')
  return MacThsRecoveryCoordinator.createLegacySource(directory,entry)
}
function message(child:ChildProcess):Promise<Record<string,unknown>> {
  return new Promise((done,reject)=>{
    child.once('message',value=>done(value as Record<string,unknown>))
    child.once('error',reject);child.once('exit',code=>reject(new Error('Exited before message: '+code)))
  })
}
function compileCoordinator() {
  const out=join(directory,'coordinator.cjs')
  writeFileSync(out,ts.transpileModule(readFileSync(resolve('electron/main/services/macThsRecoveryCoordinator.ts'),'utf8'),{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}
  }).outputText)
  return out
}
function launchCase(kind:'quote'|'confirmation'|'manual'='manual',ttl=120000) {
  let db!:Database.Database
  const coordinator=new MacThsRecoveryCoordinator(directory)
  const store=MacThsIntentStore.open({directory,initialize:true,testHooks:{nativeBinding,onDatabaseOpen:value=>{db=value}}})
  const raw=snapshot()
  if(kind==='quote')raw.input={source:'quote',capturedAt:raw.createdAt,quoteSource:'fixture',maxAgeMs:ttl}
  store.enableLiveSession({accountDigest:raw.accountContext.digest,observedAt:Date.now()})
  const p=store.createIntent(randomUUID(),raw),confirmedAt=Date.now()
  const expiresAt=kind==='confirmation'?confirmedAt+ttl:p.snapshot!.expiresAt
  const confirmed=store.confirmIntent(p.intentId,p.snapshotHash!,p.revision,{method:'native_dialog',sessionId:store.sessionId,
    confirmedAt,expiresAt,additionalOrderAcknowledged:false})
  const permit=store.claimExecution(confirmed.intentId,confirmed.snapshotHash!,confirmed.revision,confirmed.originalRequestId!,
    {accountDigest:raw.accountContext.digest,observedAt:Date.now()})
  expect(permit.claimed).toBe(true)
  return {store,db,coordinator,raw,permit,confirmedAt,expiresAt}
}
function delayPending(db:Database.Database,work:()=>void) {
  db.function('hold_launch',()=>{work();return 1})
  db.exec("CREATE TEMP TRIGGER slow_launch BEFORE UPDATE OF executor_state ON attempts WHEN NEW.executor_state='launch_pending' BEGIN SELECT hold_launch(); END")
}
function holdUntil(time:number) {
  const remaining=time-Date.now()
  if(remaining>0)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,remaining)
}
describe('controlled process capabilities, not renderer assertions',()=>{
  it('waits for the specific live child, retires its entry before waiting, and preserves an existing original lock',async()=>{
    const c=source()
    const child=c.launchLegacy(process.execPath,['-e',"require('node:fs').writeFileSync('mac-ths-intents.lock','original-owner-raw');process.send({ready:true});process.stdin.resume();process.stdin.once('data',()=>process.exit(0))"],{stdio:['pipe','ignore','ignore','ipc']})
    ownedChildren.push(child.child);await message(child.child)
    let resolved=false
    const pending=c.retireLegacyEntry().then(proof=>{resolved=true;return proof})
    await new Promise(done=>setTimeout(done,100))
    expect(resolved).toBe(false);expect(()=>c.launchLegacy(process.execPath,['-e',''])).toThrow('LEGACY_ENTRY_RETIRED')
    child.child.stdin!.end('exit')
    const proof=await pending
    expect(verifyLegacyQuiescence(proof,directory).instances[0].pid).toBe(child.child.pid)
    expect(readFileSync(join(directory,'mac-ths-intents.lock'),'utf8')).toBe('original-owner-raw')
    expect(()=>verifyLegacyQuiescence(JSON.parse(JSON.stringify(proof)) as LegacyQuiescenceCapability,directory)).toThrow('LEGACY_WRITER_UNFENCED')
  })
  it('requires a supervised actual process instance, refuses a bool/JSON proof and never treats an empty registry as quiescence',async()=>{
    const c=new MacThsRecoveryCoordinator(directory)
    await expect(c.retireLegacyEntry()).rejects.toThrow('LEGACY_WRITER_UNFENCED')
    expect(()=>verifyLegacyQuiescence({kind:'legacy_quiescence'} as LegacyQuiescenceCapability,directory)).toThrow('LEGACY_WRITER_UNFENCED')
  })
  it('creates a permanent wx retirement fence only after wait, and a modified fence invalidates its capability',async()=>{
    const c=source()
    const child=c.launchLegacy(process.execPath,['-e','process.exit(0)']);await child.exited
    const proof=await c.retireLegacyEntry()
    const fence=join(directory,'mac-ths-intents.lock')
    expect(JSON.parse(readFileSync(fence,'utf8')).format).toBe('mac-ths-retired-v1')
    expect(()=>new MacThsRecoveryCoordinator(directory).launchLegacy(process.execPath,['-e',''])).toThrow('LEGACY_ENTRY_RETIRED')
    expect(verifyLegacyQuiescence(proof,directory).retiredEntry).toBe('controlled-legacy-fixture')
    writeFileSync(fence,'different-owner')
    expect(()=>verifyLegacyQuiescence(proof,directory)).toThrow('LEGACY_WRITER_UNFENCED')
  })
  it('binds source directory and exact executor instance; close does not release a live executor owner',async()=>{
    const c=new MacThsRecoveryCoordinator(directory)
    const store=MacThsIntentStore.open({directory,initialize:true,testHooks:{nativeBinding}})
    const raw=snapshot();store.enableLiveSession({accountDigest:raw.accountContext.digest,observedAt:Date.now()})
    const p=store.createIntent(randomUUID(),raw)
    const r=store.confirmIntent(p.intentId,p.snapshotHash!,p.revision,{method:'native_dialog',sessionId:store.sessionId,
      confirmedAt:Date.now(),expiresAt:p.snapshot!.expiresAt,additionalOrderAcknowledged:false})
    const permit=store.claimExecution(r.intentId,r.snapshotHash!,r.revision,r.originalRequestId!,
      {accountDigest:raw.accountContext.digest,observedAt:Date.now()})
    const child=store.launchExecutor(permit.attemptId!,c,process.execPath,['-e','setInterval(()=>{},1000)'])
    try{
      expect(()=>store.close()).toThrow('EXECUTOR_EXIT_UNPROVEN')
      expect(()=>MacThsIntentStore.open({directory,testHooks:{nativeBinding}})).toThrow('ACTIVE_OWNER')
      expect(()=>store.recordExecutorExit(permit.attemptId!,{kind:'executor_exit'} as ExecutorExitCapability)).toThrow('EXECUTOR_EXIT_UNPROVEN')
      const proof=await c.stopExecutor(child.instanceId)
      expect(()=>verifyExecutorExit(proof,randomUUID())).toThrow('EXECUTOR_EXIT_UNPROVEN')
      store.recordExecutorExit(permit.attemptId!,proof)
      // Process exit is not broker reconciliation and does not change UNKNOWN.
      expect(store.inspect().unknownPending).toBe(true)
      expect(store.getIntent(r.intentId)!.state).toBe('UNKNOWN')
    }finally{await c.stopExecutor(child.instanceId);store.close()}
  },10000)
  it('a native spawn failure does not mint a legacy proof',async()=>{
    const c=source()
    const instance=c.launchLegacy(join(directory,'missing.exe'),[])
    await expect(instance.exited).rejects.toThrow()
    await expect(c.retireLegacyEntry()).rejects.toThrow()
  })
  it('does not turn a durably consumed but expired claim into a launch via its stored attempt ID',()=>{
    let mono=1000,armed=false
    vi.spyOn(performance,'now').mockImplementation(()=>mono)
    const store=MacThsIntentStore.open({directory,initialize:true,testHooks:{nativeBinding,
      checkpoint:stage=>{if(armed && stage==='after_commit')mono+=200000}}})
    try {
      const raw=snapshot();store.enableLiveSession({accountDigest:raw.accountContext.digest,observedAt:Date.now()})
      const p=store.createIntent(randomUUID(),raw)
      const r=store.confirmIntent(p.intentId,p.snapshotHash!,p.revision,{method:'native_dialog',sessionId:store.sessionId,
        confirmedAt:Date.now(),expiresAt:p.snapshot!.expiresAt,additionalOrderAcknowledged:false})
      armed=true
      const result=store.claimExecution(r.intentId,r.snapshotHash!,r.revision,r.originalRequestId!,{accountDigest:raw.accountContext.digest,observedAt:Date.now()})
      expect(result.claimed).toBe(false);expect(result.intent.state).toBe('UNKNOWN')
      expect(()=>store.launchExecutor(result.intent.attempt!.attemptId,new MacThsRecoveryCoordinator(directory),process.execPath,['-e',''])).toThrow('EXECUTION_PERMISSION_EXPIRED')
    } finally {vi.restoreAllMocks();store.close()}
  })
  it('human review burns an outstanding launch permit instead of letting an old UNKNOWN start afterward',()=>{
    const store=MacThsIntentStore.open({directory,initialize:true,testHooks:{nativeBinding}})
    try {
      const raw=snapshot();store.enableLiveSession({accountDigest:raw.accountContext.digest,observedAt:Date.now()})
      const p=store.createIntent(randomUUID(),raw)
      const r=store.confirmIntent(p.intentId,p.snapshotHash!,p.revision,{method:'native_dialog',sessionId:store.sessionId,
        confirmedAt:Date.now(),expiresAt:p.snapshot!.expiresAt,additionalOrderAcknowledged:false})
      const permit=store.claimExecution(r.intentId,r.snapshotHash!,r.revision,r.originalRequestId!,{accountDigest:raw.accountContext.digest,observedAt:Date.now()})
      store.recordHumanReview(r.intentId,r.snapshotHash,{source:'human_reported',method:'native_dialog',statement:'still_uncertain',
        scope:['orders','deals','confirmation'],accountDigest:raw.accountContext.digest,contractNo:null,releaseGate:true},Date.now(),permit.intent.revision)
      expect(()=>store.launchExecutor(permit.attemptId!,new MacThsRecoveryCoordinator(directory),process.execPath,['-e',''])).toThrow('EXECUTION_PERMISSION_EXPIRED')
    } finally {store.close()}
  })
  it('shutdown revokes execution first, waits on its actual child and only then closes the owner',async()=>{
    const coordinator=new MacThsRecoveryCoordinator(directory)
    const store=MacThsIntentStore.open({directory,initialize:true,testHooks:{nativeBinding}})
    const raw=snapshot();store.enableLiveSession({accountDigest:raw.accountContext.digest,observedAt:Date.now()})
    const p=store.createIntent(randomUUID(),raw)
    const r=store.confirmIntent(p.intentId,p.snapshotHash!,p.revision,{method:'native_dialog',sessionId:store.sessionId,
      confirmedAt:Date.now(),expiresAt:p.snapshot!.expiresAt,additionalOrderAcknowledged:false})
    const permit=store.claimExecution(r.intentId,r.snapshotHash!,r.revision,r.originalRequestId!,{accountDigest:raw.accountContext.digest,observedAt:Date.now()})
    const instance=store.launchExecutor(permit.attemptId!,coordinator,process.execPath,['-e','setInterval(()=>{},1000)'])
    const stopping=store.shutdown(coordinator)
    expect(()=>store.enableLiveSession({accountDigest:raw.accountContext.digest,observedAt:Date.now()})).toThrow('SESSION_STOPPING')
    await stopping;expect(instance.child.exitCode!==null || instance.child.signalCode!==null).toBe(true)
    const next=MacThsIntentStore.open({directory,testHooks:{nativeBinding}})
    expect(next.inspectRecovery().reason).toBe('INTERRUPTED_SESSION');next.close()
  })
  it('A1: unrelated coordinator cannot seal a source while its actual writer is alive, and actual cold exit remains usable',async()=>{
    const a=source('actual-old-entry'),first=randomUUID(),late=randomUUID()
    const code=`const fs=require('node:fs');const ids=[${JSON.stringify(first)}];const write=()=>fs.writeFileSync('mac-ths-experiment-journal.json',JSON.stringify({unknownPending:true,usedRequests:ids}));
fs.writeFileSync('mac-ths-intents.lock','original-live-writer');write();process.send({ready:true});
process.on('message',msg=>{if(msg.add){ids.push(msg.add);write();process.send({ids});}else if(msg.exit)process.exit(0)});`
    const actual=a.launchLegacy(process.execPath,['-e',code],{stdio:['ignore','pipe','pipe','ipc']})
    ownedChildren.push(actual.child);await message(actual.child)
    const b=new MacThsRecoveryCoordinator(directory,'unrelated-entry')
    expect(()=>b.launchLegacy(process.execPath,['-e','process.exit(0)'])).toThrow('LEGACY_WRITER_UNFENCED')
    await expect(b.retireLegacyEntry()).rejects.toThrow('LEGACY_WRITER_UNFENCED')
    expect(()=>MacThsRecoveryCoordinator.createLegacySource(directory)).toThrow('LEGACY_WRITER_UNFENCED')
    expect(()=>MacThsRecoveryCoordinator.restoreLegacyQuiescence(directory)).toThrow('LEGACY_WRITER_UNFENCED')
    const blocked=MacThsIntentStore.open({directory,initialize:true,testHooks:{nativeBinding}})
    try {
      expect(blocked.inspectRecovery()).toMatchObject({reason:'LEGACY_WRITER_UNFENCED',canApply:false})
      expect(actual.child.exitCode).toBeNull();expect(actual.child.signalCode).toBeNull()
      const added=message(actual.child);actual.child.send!({add:late});expect((await added).ids).toEqual([first,late])
      expect(()=>blocked.createIntent(late,snapshot())).toThrow('LEGACY_WRITER_UNFENCED')
    }finally{blocked.close()}
    const retiring=a.retireLegacyEntry()
    actual.child.send!({exit:true});await actual.exited
    const proof=await retiring
    expect(verifyLegacyQuiescence(proof,directory).instances.map(i=>i.pid)).toEqual([actual.child.pid])
    const store=MacThsIntentStore.open({directory,legacyQuiescence:proof,testHooks:{nativeBinding}})
    try {
      const plan=store.inspectRecovery();expect(plan.canApply).toBe(true)
      store.applyRecovery(plan.recoveryId!,plan.manifestHash!,plan.revision)
      expect(store.inspect().requestCount).toBe(2)
      for(const id of [first,late])expect(()=>store.createIntent(id,snapshot())).toThrow('REQUEST_CONFLICT')
      const old=store.inspect().intents[0]
      store.recordHumanReview(old.intentId,null,{source:'human_reported',method:'native_dialog',statement:'still_uncertain',
        scope:['orders','deals','confirmation'],accountDigest:null,contractNo:null,releaseGate:true},Date.now(),old.revision,
        {recoveryId:old.recoveryId!,reviewRequestId:randomUUID()})
      const raw=snapshot(),p=store.createIntent(randomUUID(),raw)
      const r=store.confirmIntent(p.intentId,p.snapshotHash!,p.revision,{method:'native_dialog',sessionId:store.sessionId,
        confirmedAt:Date.now(),expiresAt:raw.expiresAt,additionalOrderAcknowledged:false})
      store.enableLiveSession({accountDigest:raw.accountContext.digest,observedAt:Date.now()})
      expect(store.claimExecution(r.intentId,r.snapshotHash!,r.revision,r.originalRequestId!,
        {accountDigest:raw.accountContext.digest,observedAt:Date.now()}).claimed).toBe(true)
      expect(store.getIntent(old.intentId)!.executionForbidden).toBe(true)
      expect(readFileSync(join(directory,'mac-ths-intents.lock'),'utf8')).toBe('original-live-writer')
    }finally{store.close()}
  },15000)
  it('A2: preserved ordinary lock cannot reopen a retired entry across objects or a real process restart',async()=>{
    const c=source('controlled-source')
    const child=c.launchLegacy(process.execPath,['-e',"require('node:fs').writeFileSync('mac-ths-intents.lock','retained-original-lock');require('node:fs').writeFileSync('mac-ths-experiment-journal.json',JSON.stringify({unknownPending:false,usedRequests:[]}))"])
    await child.exited;await c.retireLegacyEntry()
    expect(()=>new MacThsRecoveryCoordinator(directory,'other-name').launchLegacy(process.execPath,['-e',''])).toThrow('LEGACY_ENTRY_RETIRED')
    const compiled=compileCoordinator()
    const code=`const {MacThsRecoveryCoordinator:C}=require(${JSON.stringify(compiled)});const dir=${JSON.stringify(directory)};let rejection=null;
try{new C(dir,'other-name').launchLegacy(process.execPath,['-e',"require('node:fs').writeFileSync('reopened-entry','bad')"])}catch(e){rejection=e.code}
const proof=C.restoreLegacyQuiescence(dir);process.send({rejection,kind:proof.kind});`
    const probe=spawn(process.execPath,['-e',code],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']})
    ownedChildren.push(probe)
    const closed=new Promise(done=>probe.once('close',done))
    expect(await message(probe)).toEqual({rejection:'LEGACY_ENTRY_RETIRED',kind:'legacy_quiescence'})
    await closed;expect(probe.exitCode).toBe(0)
    expect(existsSync(join(directory,'reopened-entry'))).toBe(false)
    expect(readFileSync(join(directory,'mac-ths-intents.lock'),'utf8')).toBe('retained-original-lock')
  },10000)
  it('never launders a pre-existing unknown source through a new supervised no-op, nor adopts even an empty existing directory',()=>{
    writeFileSync(join(directory,'mac-ths-experiment-journal.json'),JSON.stringify({unknownPending:true,usedRequests:[randomUUID()]}))
    const raw=readFileSync(join(directory,'mac-ths-experiment-journal.json'))
    expect(()=>MacThsRecoveryCoordinator.createLegacySource(directory)).toThrow('LEGACY_WRITER_UNFENCED')
    expect(()=>new MacThsRecoveryCoordinator(directory).launchLegacy(process.execPath,['-e','process.exit(0)'])).toThrow('LEGACY_WRITER_UNFENCED')
    const empty=join(directory,'empty');mkdirSync(empty)
    expect(()=>MacThsRecoveryCoordinator.createLegacySource(empty)).toThrow('LEGACY_WRITER_UNFENCED')
    expect(readFileSync(join(directory,'mac-ths-experiment-journal.json'))).toEqual(raw)
  })
  it('a supervisor process death before retirement cannot be adopted by a new no-op writer',async()=>{
    const compiled=compileCoordinator(),target=join(directory,'abandoned-source')
    const worker=spawn(process.execPath,['-e',`const {MacThsRecoveryCoordinator:C}=require(${JSON.stringify(compiled)});
const c=C.createLegacySource(${JSON.stringify(target)});const p=c.launchLegacy(process.execPath,['-e',"require('node:fs').writeFileSync('mac-ths-experiment-journal.json',JSON.stringify({unknownPending:true,usedRequests:[]}))"]);
p.exited.then(()=>{process.send({ready:true});setInterval(()=>{},1000)});`],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']})
    ownedChildren.push(worker);await message(worker)
    const closed=new Promise(done=>worker.once('close',done));worker.kill('SIGKILL');await closed
    expect(()=>MacThsRecoveryCoordinator.restoreLegacyQuiescence(target)).toThrow('LEGACY_WRITER_UNFENCED')
    expect(()=>new MacThsRecoveryCoordinator(target).launchLegacy(process.execPath,['-e','process.exit(0)'])).toThrow('LEGACY_WRITER_UNFENCED')
    expect(()=>MacThsRecoveryCoordinator.createLegacySource(target)).toThrow('LEGACY_WRITER_UNFENCED')
  },10000)
  it.each(['quote','confirmation'] as const)('B: actual slow SQLite launch_pending crossing %s expiry cannot spawn; UNKNOWN stays consumed with proven not_started',kind=>{
    const {store,db,coordinator,raw,permit,expiresAt}=launchCase(kind,1800)
    const deadline=kind==='quote'?raw.input.capturedAt+1800:expiresAt
    delayPending(db,()=>holdUntil(deadline+100))
    try {
      expect(()=>store.launchExecutor(permit.attemptId!,coordinator,process.execPath,
        ['-e',"require('node:fs').writeFileSync('expired-launch','bad')"])).toThrow('EXECUTION_PERMISSION_EXPIRED')
      expect(existsSync(join(directory,'expired-launch'))).toBe(false)
      expect(store.getIntent(permit.intent.intentId)!.state).toBe('UNKNOWN')
      expect(store.inspect().requestCount).toBe(1)
      expect(db.prepare('SELECT executor_state,executor_instance FROM attempts').all()).toEqual([{executor_state:'not_started',executor_instance:null}])
      expect(()=>store.launchExecutor(permit.attemptId!,coordinator,process.execPath,['-e',''])).toThrow('EXECUTION_PERMISSION_EXPIRED')
      expect(store.claimExecution(permit.intent.intentId,permit.intent.snapshotHash!,permit.intent.revision,
        permit.intent.originalRequestId!,{accountDigest:raw.accountContext.digest,observedAt:Date.now()}).claimed).toBe(false)
    }finally{store.close()}
    const reopened=MacThsIntentStore.open({directory,testHooks:{nativeBinding}})
    try {
      const p=reopened.inspectRecovery();reopened.applyRecovery(p.recoveryId!,p.manifestHash!,p.revision)
      expect(reopened.getIntent(permit.intent.intentId)).toMatchObject({state:'UNKNOWN',executionForbidden:true})
    }finally{reopened.close()}
  },10000)
  it.each(['monotonic','wall-rollback'] as const)('B: real pending SQL boundary rechecks %s without extending the original permit',clock=>{
    let mono=1000
    if(clock==='monotonic')vi.spyOn(performance,'now').mockImplementation(()=>mono)
    const {store,db,coordinator,permit,confirmedAt}=launchCase('quote',10000)
    let wall=Date.now()+100
    if(clock==='wall-rollback')vi.spyOn(Date,'now').mockImplementation(()=>wall)
    delayPending(db,()=>{if(clock==='monotonic')mono+=20000;else wall-=50})
    try {
      expect(()=>store.launchExecutor(permit.attemptId!,coordinator,process.execPath,['-e',''])).toThrow('EXECUTION_PERMISSION_EXPIRED')
      if(clock==='wall-rollback')expect(wall).toBeGreaterThan(confirmedAt)
      expect(db.prepare('SELECT executor_state FROM attempts').get()).toEqual({executor_state:'not_started'})
      expect(store.getIntent(permit.intent.intentId)!.state).toBe('UNKNOWN')
    }finally{vi.restoreAllMocks();store.close()}
  })
  it('the final coordinator boundary follows argument preparation, not merely the store SQL call',()=>{
    const {store,db,coordinator,raw,permit}=launchCase('quote',1800)
    const args=['-e','process.exit(0)']
    Object.defineProperty(args,1,{enumerable:true,get(){holdUntil(raw.input.capturedAt+1900);return "require('node:fs').writeFileSync('late-argument-launch','bad')"}})
    try {
      expect(()=>store.launchExecutor(permit.attemptId!,coordinator,process.execPath,args)).toThrow('EXECUTION_PERMISSION_EXPIRED')
      expect(existsSync(join(directory,'late-argument-launch'))).toBe(false)
      expect(db.prepare('SELECT executor_state FROM attempts').get()).toEqual({executor_state:'not_started'})
    }finally{store.close()}
  },10000)
  it('a legitimate fresh permit still starts a real owned child after slow SQL and only real exit closes its association',async()=>{
    const {store,db,coordinator,raw,permit}=launchCase('quote',10000)
    delayPending(db,()=>holdUntil(Date.now()+60))
    let instance:ReturnType<MacThsRecoveryCoordinator['launchExecutor']>|undefined
    try {
      instance=store.launchExecutor(permit.attemptId!,coordinator,process.execPath,
        ['-e',"require('node:fs').writeFileSync('valid-launch.json',JSON.stringify({pid:process.pid,at:Date.now()}))"])
      ownedChildren.push(instance.child)
      const proof=await coordinator.waitExecutor(instance.instanceId);store.recordExecutorExit(permit.attemptId!,proof)
      const observed=JSON.parse(readFileSync(join(directory,'valid-launch.json'),'utf8'))
      expect(observed.pid).toBe(instance.child.pid);expect(observed.at).toBeLessThan(raw.input.capturedAt+10000)
      expect(db.prepare('SELECT executor_state FROM attempts').get()).toEqual({executor_state:'exited'})
      expect(store.getIntent(permit.intent.intentId)!.state).toBe('UNKNOWN')
    }finally{
      if(instance)store.recordExecutorExit(permit.attemptId!,await coordinator.stopExecutor(instance.instanceId))
      store.close()
    }
  },15000)

})
