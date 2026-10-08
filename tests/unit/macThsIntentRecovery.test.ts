import { nativeTestBinding, nativeTestTempRoot } from '../fixtures/macThsNativeTestRuntime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID, createHash } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import Database from 'better-sqlite3'
import { MacThsIntentStore, intentRecoveryCodec, type IntentSnapshot, type Payload, type IntentRecord } from '../../electron/main/services/macThsIntentStore'
import { MacThsRecoveryCoordinator, type LegacyQuiescenceCapability } from '../../electron/main/services/macThsRecoveryCoordinator'
import type { RecoveryCheckpoint } from '../../electron/main/services/macThsIntentRecovery'

const root=resolve(nativeTestTempRoot, 'mac-ths-f3-recovery-tests')
const nativeBinding=nativeTestBinding
const account='a'.repeat(64)
let directory:string
const stores=new Map<MacThsIntentStore,Database.Database>()
const children:ChildProcess[]=[]
beforeEach(()=>{mkdirSync(root,{recursive:true});directory=mkdtempSync(join(root,'case-'))})
afterEach(async({task})=>{
  for(const child of children.splice(0))if(child.exitCode===null && child.signalCode===null){child.kill('SIGKILL');await new Promise(done=>child.once('close',done))}
  for(const [store,db]of stores){if(db.open){try{store.close()}catch(error){
    // Do not close an owner behind an unobserved executor. These cases use killable child owners.
    writeFileSync(join(directory,'close-failure.json'),JSON.stringify({message:String(error)}));throw error
  }}}
  stores.clear()
  writeFileSync(join(directory,'test-result.json'),JSON.stringify({test:task.name,result:task.result,node:process.version,modules:process.versions.modules},null,2))
})
function open(capability?:LegacyQuiescenceCapability,checkpoint?:(stage:string)=>void) {
  let db!:Database.Database
  const store=MacThsIntentStore.open({directory,initialize:true,legacyQuiescence:capability,
    testHooks:{nativeBinding,checkpoint,onDatabaseOpen:value=>{db=value}}})
  stores.set(store,db);return store
}
function snapshot():IntentSnapshot {
  const now=Date.now();return {schemaVersion:1,executor:'mac-local-ths',mode:'live',action:'submit',symbol:'600000',market:'SH',side:'buy',
    priceCents:1000,quantity:100,maxNotionalCents:100000,cancelTarget:null,accountContext:{digest:account,label:'**1234',
      distinguishable:true,capturedAt:now,clientVersion:'1',adapterVersion:'3'},
    input:{source:'manual',capturedAt:now},createdAt:now,expiresAt:now+120000}
}
function confirm(store:MacThsIntentStore,r:IntentRecord) {
  return store.confirmIntent(r.intentId,r.snapshotHash!,r.revision,{method:'native_dialog',sessionId:store.sessionId,
    confirmedAt:Date.now(),expiresAt:r.snapshot!.expiresAt,additionalOrderAcknowledged:Boolean(r.additionalOrder)})
}
function claim(store:MacThsIntentStore,r:IntentRecord) {
  return store.claimExecution(r.intentId,r.snapshotHash!,r.revision,r.originalRequestId!,{accountDigest:account,observedAt:Date.now()})
}
function unknown(store:MacThsIntentStore) {
  store.enableLiveSession({accountDigest:account,observedAt:Date.now()})
  return claim(store,confirm(store,store.createIntent(randomUUID(),snapshot()))).intent
}
function payload(store:MacThsIntentStore):Payload {
  return JSON.parse((stores.get(store)!.prepare('SELECT payload FROM meta').get() as {payload:string}).payload)
}
function envelope(value:Payload) {return JSON.stringify({schemaVersion:1,checksum:intentRecoveryCodec.digest(value),payload:value})}
function compile() {
  const out=join(directory,'compiled');mkdirSync(out)
  for(const name of ['macThsIntentStore','macThsIntentRecovery','macThsRecoveryCoordinator']) {
    writeFileSync(join(out,name+'.js'),ts.transpileModule(readFileSync(resolve('electron/main/services/'+name+'.ts'),'utf8'),{
      compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}
    }).outputText.replace('require("better-sqlite3")','require('+JSON.stringify(resolve('node_modules/better-sqlite3'))+')'))
  }
  return out
}
async function sealed(files:Record<string,string>) {
  directory=join(directory,'controlled-source')
  const coordinator=MacThsRecoveryCoordinator.createLegacySource(directory)
  const source="const fs=require('node:fs');for(const [name,raw]of Object.entries("+JSON.stringify(files)+"))fs.writeFileSync(name,raw);"
  const writer=join(directory,'legacy-fixture-writer.cjs')
  writeFileSync(writer,source)
  const instance=coordinator.launchLegacy(process.execPath,[writer])
  await instance.exited
  return coordinator.retireLegacyEntry()
}
function recover(store:MacThsIntentStore) {
  const plan=store.inspectRecovery();expect(plan.canApply).toBe(true)
  return store.applyRecovery(plan.recoveryId!,plan.manifestHash!,plan.revision)
}
function review(store:MacThsIntentStore,r:IntentRecord,reviewRequestId=randomUUID(),releaseGate=true) {
  return store.recordHumanReview(r.intentId,r.snapshotHash,{source:'human_reported',method:'native_dialog',
    statement:'still_uncertain',scope:['orders','deals','confirmation'],accountDigest:r.snapshot?account:null,contractNo:null,releaseGate},
    Date.now(),r.revision,{recoveryId:r.recoveryId!,reviewRequestId})
}
async function message(child:ChildProcess):Promise<Record<string,unknown>> {
  return new Promise((done,reject)=>{
    child.once('message',value=>done(value as Record<string,unknown>));child.once('error',reject)
    child.once('exit',code=>reject(new Error('Child exited before checkpoint: '+code)))
  })
}
async function killed(child:ChildProcess) {
  const closed=new Promise<void>(done=>child.once('close',()=>done()))
  expect(child.kill('SIGKILL')).toBe(true);await closed
}

describe('F3 real-file SQLite recovery and cold evidence import',()=>{
  it('imports all 300 legacy request IDs, preserves raw unknown without fabricated snapshot, and then permits reviewed NEW live intent',async()=>{
    const ids=Array.from({length:300},()=>randomUUID())
    const original=JSON.stringify({unknownPending:true,usedRequests:ids})
    const cap=await sealed({'mac-ths-experiment-journal.json':original})
    const store=open(cap);const plan=store.inspectRecovery();const receipt=recover(store)
    expect(receipt.requestCount).toBe(300);expect(receipt.artifactCount).toBe(4)
    expect(store.getRecoveryReceipt(plan.recoveryId!)).toEqual(receipt)
    expect(store.applyRecovery(plan.recoveryId!,plan.manifestHash!,plan.revision)).toEqual(receipt)
    expect(store.inspect().requestCount).toBe(300)
    const r=store.inspect().intents[0];expect(r.state).toBe('LEGACY_UNKNOWN');expect(r.snapshot).toBeNull()
    expect(r.executionForbidden).toBe(true);expect(store.inspect().unknownPending).toBe(true)
    expect(()=>store.createIntent(ids[0],snapshot())).toThrow('REQUEST_CONFLICT')
    expect(()=>store.enableLiveSession({accountDigest:account,observedAt:Date.now()})).toThrow('UNKNOWN_PENDING')
    const reviewed=review(store,r);expect(reviewed.state).toBe('LEGACY_UNKNOWN');expect(store.inspect().unknownPending).toBe(false)
    const fresh=confirm(store,store.createIntent(randomUUID(),snapshot()))
    expect(()=>claim(store,fresh)).toThrow('LIVE_SESSION_REQUIRED')
    store.enableLiveSession({accountDigest:account,observedAt:Date.now()})
    expect(claim(store,fresh).claimed).toBe(true)
    expect(readFileSync(join(directory,'mac-ths-experiment-journal.json'),'utf8')).toBe(original)
    const blob=stores.get(store)!.prepare("SELECT raw FROM recovery_artifacts WHERE role='experiment'").get() as {raw:Buffer}
    expect(blob.raw.equals(Buffer.from(original))).toBe(true)
  })
  it('unfenced JSON, pending, foreign lock or renderer boolean never authorize an import',()=>{
    writeFileSync(join(directory,'mac-ths-intents.lock'),'live-writer')
    const store=open({kind:'legacy_quiescence'} as LegacyQuiescenceCapability)
    expect(store.inspectRecovery()).toMatchObject({reason:'LEGACY_WRITER_UNFENCED',evidence:'unavailable',canApply:false,canSubmit:false})
    expect(()=>recover(store)).toThrow()
    expect((stores.get(store)!.prepare('SELECT count(*) AS n FROM recovery_cases').get() as {n:number}).n).toBe(0)
    expect(readFileSync(join(directory,'mac-ths-intents.lock'),'utf8')).toBe('live-writer')
  })
  it('archives committed JSON, activated, pending, foreign lock and ALL tmp branches without mtime winner or lost candidate IDs',async()=>{
    const source=open();const old=unknown(source);const formal=payload(source);source.close()
    // Use an independent fresh order DB directory as the controlled legacy destination.
    directory=mkdtempSync(join(root,'legacy-branches-'))
    const candidate=intentRecoveryCodec.copy(formal);const alias=randomUUID()
    candidate.revision++;candidate.requests.push({requestId:alias,intentId:old.intentId,snapshotHash:old.snapshotHash,origin:'intent'})
    const badCandidate='{interrupted write'
    const files={'mac-ths-intents.v1.json':envelope(formal),'mac-ths-intents.enabled':JSON.stringify({schemaVersion:1,storeId:formal.storeId}),
      'mac-ths-intents.pending':JSON.stringify({storeId:formal.storeId,revision:candidate.revision}),
      'mac-ths-intents.lock':'original-owner','mac-ths-intents.v1.json.one.tmp':envelope(candidate),
      'mac-ths-intents.v1.json.two.tmp':badCandidate}
    const cap=await sealed(files);const store=open(cap);const p=store.inspectRecovery()
    expect(p.reason).toBe('EVIDENCE_CONFLICT');const receipt=recover(store)
    expect(receipt.sourceComplete).toBe(false);expect(store.inspect().requestCount).toBe(2)
    const r=store.getIntent(old.intentId)!;expect(r.events).toEqual(old.events);expect(r.state).toBe('UNKNOWN')
    expect(r.executionForbidden).toBe(true);expect(r.recoveryQuarantine).toBe(true)
    const blobs=stores.get(store)!.prepare('SELECT name,raw FROM recovery_artifacts').all() as Array<{name:string;raw:Buffer}>
    expect(blobs).toHaveLength(8)
    for(const [name,raw]of Object.entries(files)){
      expect(readFileSync(join(directory,name)).equals(Buffer.from(raw))).toBe(true)
      expect(blobs.find(a=>a.name===name)!.raw.equals(Buffer.from(raw))).toBe(true)
    }
    review(store,r);expect(()=>store.enableLiveSession({accountDigest:account,observedAt:Date.now()})).toThrow('EVIDENCE_CONFLICT')
    expect(claim(store,r).claimed).toBe(false)
  })
  it('rejects a changed manifest without inserting any partial recovery rows',async()=>{
    const cap=await sealed({'mac-ths-experiment-journal.json':JSON.stringify({unknownPending:false,usedRequests:[randomUUID()]})})
    const store=open(cap);const p=store.inspectRecovery()
    writeFileSync(join(directory,'mac-ths-intents.v1.json.new.tmp'),'new uncertain evidence')
    expect(()=>store.applyRecovery(p.recoveryId!,p.manifestHash!,p.revision)).toThrow('RECOVERY_PLAN_CHANGED')
    expect((stores.get(store)!.prepare('SELECT count(*) AS n FROM recovery_cases').get() as {n:number}).n).toBe(0)
  })
  it('keeps different mappings of one request as conflicts, never overwriting a certain mapping or opening an empty store',async()=>{
    const original=open();const a=original.createIntent(randomUUID(),snapshot());const p1=payload(original)
    original.close();directory=mkdtempSync(join(root,'mapping-'))
    const p2=intentRecoveryCodec.copy(p1)
    p2.intents[0].intentId=randomUUID();p2.requests[0].intentId=p2.intents[0].intentId
    const cap=await sealed({'mac-ths-intents.v1.json':envelope(p1),'mac-ths-intents.enabled':JSON.stringify({schemaVersion:1,storeId:p1.storeId}),
      'mac-ths-intents.v1.json.branch.tmp':envelope(p2)})
    const store=open(cap);const receipt=recover(store)
    expect(receipt.sourceComplete).toBe(false)
    expect(store.getIntent(a.intentId)!.events).toEqual(a.events)
    expect((stores.get(store)!.prepare('SELECT count(*) AS n FROM intent_reservations').get() as {n:number}).n).toBe(2)
    expect(store.inspect().requestCount).toBe(1)
    expect(()=>store.createIntent(a.originalRequestId!,snapshot())).toThrow()
    expect(()=>store.enableLiveSession({accountDigest:account,observedAt:Date.now()})).toThrow('EVIDENCE_CONFLICT')
  })
  it('review request idempotency binds snapshot/revision/recovery and atomically clears only its gate, never old execution',()=>{
    const first=open();const old=unknown(first);first.close()
    const store=open();recover(store);const r=store.getIntent(old.intentId)!
    const request=randomUUID(),at=Date.now();const observation={source:'human_reported' as const,method:'native_dialog' as const,
      statement:'still_uncertain' as const,scope:['orders','deals','confirmation'] as Array<'orders'|'deals'|'confirmation'>,
      accountDigest:account,contractNo:null,releaseGate:true}
    const binding={recoveryId:r.recoveryId!,reviewRequestId:request}
    const result=store.recordHumanReview(r.intentId,r.snapshotHash,observation,at,r.revision,binding)
    expect(store.recordHumanReview(r.intentId,r.snapshotHash,observation,at,r.revision,binding)).toEqual(result)
    expect(()=>store.recordHumanReview(r.intentId,r.snapshotHash,{...observation,releaseGate:false},at,r.revision,binding)).toThrow('REVIEW_REQUEST_CONFLICT')
    expect(store.getIntent(r.intentId)!.events).toHaveLength(r.events.length+1)
    expect(result.state).toBe('UNKNOWN');expect(result.executionForbidden).toBe(true)
    expect(claim(store,result).claimed).toBe(false)
    const fresh=store.createIntent(randomUUID(),snapshot(),{previousIntentId:r.intentId,additionalOrderAcknowledged:true})
    const c=confirm(store,fresh)
    expect(()=>claim(store,c)).toThrow('LIVE_SESSION_REQUIRED')
    expect(()=>store.enableLiveSession({accountDigest:account,observedAt:1})).toThrow('ACCOUNT_CONTEXT_CONFLICT')
    store.enableLiveSession({accountDigest:account,observedAt:Date.now()})
    expect(()=>store.claimExecution(c.intentId,c.snapshotHash!,c.revision,c.originalRequestId!,{accountDigest:'b'.repeat(64),observedAt:Date.now()})).toThrow('ACCOUNT_CONTEXT_CONFLICT')
    expect(claim(store,c).claimed).toBe(true)
  })
  it.each(['recovery_audits_written','recovery_tombstones_written','recovery_projections_written','recovery_receipt_written',
    'recovery_before_commit','recovery_after_commit'] as RecoveryCheckpoint[])(
    'actual owned child killed at %s: same recoveryId, audit and IDs converge all-or-nothing',async stage=>{
      const id=randomUUID()
      await sealed({'mac-ths-experiment-journal.json':JSON.stringify({unknownPending:true,usedRequests:[id]})})
      const out=compile();const worker=join(directory,'recover-worker.cjs')
      writeFileSync(worker,`const {MacThsIntentStore}=require(${JSON.stringify(join(out,'macThsIntentStore.js'))});
const {MacThsRecoveryCoordinator}=require(${JSON.stringify(join(out,'macThsRecoveryCoordinator.js'))});
const proof=MacThsRecoveryCoordinator.restoreLegacyQuiescence(${JSON.stringify(directory)});let plan;
const store=MacThsIntentStore.open({directory:${JSON.stringify(directory)},initialize:true,legacyQuiescence:proof,
testHooks:{nativeBinding:${JSON.stringify(nativeBinding)},checkpoint:point=>{if(point===${JSON.stringify(stage)}){
process.send({stage:point,plan});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}}}});
plan=store.inspectRecovery();store.applyRecovery(plan.recoveryId,plan.manifestHash,plan.revision);`)
      const child=spawn(process.execPath,[worker],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']})
      children.push(child)
      const reached=await message(child);const plan=reached.plan as {recoveryId:string;manifestHash:string;revision:number}
      writeFileSync(join(directory,'kill-boundary.json'),JSON.stringify(reached))
      await killed(child)
      // No new legacy child is invented to authorize retry. Only the completed source seal is reopened.
      const proof=MacThsRecoveryCoordinator.restoreLegacyQuiescence(directory)
      const store=open(proof);const db=stores.get(store)!
      const committed=stage==='recovery_after_commit'
      expect(Boolean(store.getRecoveryReceipt(plan.recoveryId))).toBe(committed)
      expect((db.prepare('SELECT count(*) AS n FROM recovery_artifacts').get() as {n:number}).n).toBe(committed?4:0)
      expect(store.inspect().requestCount).toBe(committed?1:0)
      if(!committed)expect(store.inspectRecovery().recoveryId).toBe(plan.recoveryId)
      const receipt=store.applyRecovery(plan.recoveryId,plan.manifestHash,plan.revision)
      expect(receipt.requestCount).toBe(1);expect(receipt.artifactCount).toBe(4)
      expect(store.applyRecovery(plan.recoveryId,plan.manifestHash,plan.revision)).toEqual(receipt)
      const r=store.inspect().intents[0];expect(r.executionForbidden).toBe(true);expect(r.state).toBe('LEGACY_UNKNOWN')
      const bytes=readFileSync(join(directory,'mac-ths-experiment-journal.json'))
      const blob=db.prepare("SELECT raw FROM recovery_artifacts WHERE role='experiment'").get() as {raw:Buffer}
      expect(blob.raw.equals(bytes)).toBe(true)
    },20000)
  it('a live child owner stays exclusive after COMMIT; kernel releases ownership after kill and old state is recovered, not replayed',async()=>{
    const out=compile();const worker=join(directory,'live-owner.cjs')
    writeFileSync(worker,`const {MacThsIntentStore}=require(${JSON.stringify(join(out,'macThsIntentStore.js'))});const {randomUUID}=require('node:crypto');
const s=MacThsIntentStore.open({directory:${JSON.stringify(directory)},initialize:true,testHooks:{nativeBinding:${JSON.stringify(nativeBinding)}}});
const raw=${JSON.stringify(snapshot())};const now=Date.now();raw.createdAt=now;raw.expiresAt=now+120000;raw.accountContext.capturedAt=now;raw.input.capturedAt=now;
s.enableLiveSession({accountDigest:raw.accountContext.digest,observedAt:now});let r=s.createIntent(randomUUID(),raw);
r=s.confirmIntent(r.intentId,r.snapshotHash,r.revision,{method:'native_dialog',sessionId:s.sessionId,confirmedAt:Date.now(),expiresAt:r.snapshot.expiresAt,additionalOrderAcknowledged:false});
const result=s.claimExecution(r.intentId,r.snapshotHash,r.revision,r.originalRequestId,{accountDigest:raw.accountContext.digest,observedAt:Date.now()});
process.send({result});setInterval(()=>{},1000);`)
    const child=spawn(process.execPath,[worker],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});children.push(child)
    const ready=await message(child);expect((ready.result as {claimed:boolean}).claimed).toBe(true)
    expect(()=>open()).toThrow('ACTIVE_OWNER')
    await killed(child)
    const store=open();recover(store);const old=store.inspect().intents[0]
    expect(old.state).toBe('UNKNOWN');expect(old.executionForbidden).toBe(true)
    expect(claim(store,old).claimed).toBe(false)
    review(store,old);store.enableLiveSession({accountDigest:account,observedAt:Date.now()})
    const next=store.createIntent(randomUUID(),snapshot(),{previousIntentId:old.intentId,additionalOrderAcknowledged:true})
    expect(claim(store,confirm(store,next)).claimed).toBe(true)
  },15000)
  it.each(['review_before_commit','review_after_commit'] as RecoveryCheckpoint[])(
    'actual child kill at %s preserves atomic review event/gate and retry identity',async stage=>{
      const first=open();const old=unknown(first);first.close()
      const prepared=open();recover(prepared);const r=prepared.getIntent(old.intentId)!;prepared.close()
      const out=compile();const worker=join(directory,'review-worker.cjs')
      const reviewedAt=Date.now(),reviewRequestId=randomUUID()
      const observation={source:'human_reported',method:'native_dialog',statement:'still_uncertain',
        scope:['orders','deals','confirmation'],accountDigest:account,contractNo:null,releaseGate:true}
      writeFileSync(worker,`const {MacThsIntentStore}=require(${JSON.stringify(join(out,'macThsIntentStore.js'))});
const s=MacThsIntentStore.open({directory:${JSON.stringify(directory)},testHooks:{nativeBinding:${JSON.stringify(nativeBinding)},
checkpoint:point=>{if(point===${JSON.stringify(stage)}){process.send({point});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}}}});
s.recordHumanReview(${JSON.stringify(r.intentId)},${JSON.stringify(r.snapshotHash)},${JSON.stringify(observation)},${reviewedAt},${r.revision},
${JSON.stringify({recoveryId:r.recoveryId,reviewRequestId})});`)
      const child=spawn(process.execPath,[worker],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});children.push(child)
      await message(child);await killed(child)
      const store=open();const persisted=store.getIntent(r.intentId)!
      expect(persisted.events.length).toBe(r.events.length+(stage==='review_after_commit'?1:0))
      expect(store.inspect().unknownPending).toBe(stage!=='review_after_commit')
      const reviewed=store.recordHumanReview(r.intentId,r.snapshotHash,observation as never,reviewedAt,r.revision,
        {recoveryId:r.recoveryId!,reviewRequestId})
      expect(reviewed.events).toHaveLength(r.events.length+1);expect(reviewed.executionForbidden).toBe(true)
      expect(claim(store,reviewed).claimed).toBe(false)
    },15000)
  it('real SQLITE_FULL is propagated; no fallback database or execution permission is created',()=>{
    const store=open();const db=stores.get(store)!;const r=confirm(store,store.createIntent(randomUUID(),snapshot()))
    store.enableLiveSession({accountDigest:account,observedAt:Date.now()})
    db.exec('CREATE TABLE IF NOT EXISTS space_pressure (data BLOB)')
    // A test-only trigger forces actual pager allocation during the store's attempt INSERT.
    // The transaction is real; neither the driver nor COMMIT is mocked.
    db.exec('CREATE TRIGGER force_capacity BEFORE INSERT ON attempts BEGIN INSERT INTO space_pressure(data) VALUES(zeroblob(1000000)); END')
    const pages=Number(db.pragma('page_count',{simple:true}));db.pragma('max_page_count='+pages)
    let failure:unknown
    try { claim(store,r) } catch(error) { failure=error }
    expect(failure).toMatchObject({code:'RECOVERY_REQUIRED',reason:'STORAGE_IO',storageCode:'SQLITE_FULL'})
    expect((db.prepare('SELECT count(*) AS n FROM attempts').get() as {n:number}).n).toBe(0)
    expect(()=>claim(store,r)).toThrow('STORE_POISONED')
  })
  it.each(['before_commit','after_commit'] as const)('real claim kill at %s leaves confirmed-or-UNKNOWN, never a replayable old intent',async stage=>{
    const out=compile();const worker=join(directory,'claim-crash.cjs')
    writeFileSync(worker,`const {MacThsIntentStore}=require(${JSON.stringify(join(out,'macThsIntentStore.js'))});
const {randomUUID}=require('node:crypto');let armed=false;
const s=MacThsIntentStore.open({directory:${JSON.stringify(directory)},initialize:true,testHooks:{nativeBinding:${JSON.stringify(nativeBinding)},
checkpoint:point=>{if(armed && point===${JSON.stringify(stage)}){process.send({stage:point});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}}}});
const raw=${JSON.stringify(snapshot())};let r=s.createIntent(randomUUID(),raw);
r=s.confirmIntent(r.intentId,r.snapshotHash,r.revision,{method:'native_dialog',sessionId:s.sessionId,confirmedAt:Date.now(),expiresAt:r.snapshot.expiresAt,additionalOrderAcknowledged:false});
s.enableLiveSession({accountDigest:raw.accountContext.digest,observedAt:Date.now()});armed=true;
s.claimExecution(r.intentId,r.snapshotHash,r.revision,r.originalRequestId,{accountDigest:raw.accountContext.digest,observedAt:Date.now()});`)
    const child=spawn(process.execPath,[worker],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});children.push(child)
    await message(child);await killed(child)
    const store=open();recover(store);const r=store.inspect().intents[0]
    expect(r.state).toBe(stage==='before_commit'?'CONFIRMED':'UNKNOWN')
    expect(r.executionForbidden).toBe(true);expect(store.inspect().requestCount).toBe(1)
    if(r.attempt)expect(claim(store,r).claimed).toBe(false)
    else expect(()=>claim(store,r)).toThrow('EXECUTION_FORBIDDEN')
  },15000)
  it('review of one recovered UNKNOWN cannot release a second, including a previously reviewed UNKNOWN',()=>{
    const first=open();const a=unknown(first)
    first.recordHumanReview(a.intentId,a.snapshotHash,{source:'human_reported',method:'native_dialog',statement:'still_uncertain',
      scope:['orders','deals','confirmation'],accountDigest:account,contractNo:null,releaseGate:true},Date.now(),a.revision)
    const p=first.createIntent(randomUUID(),{...snapshot(),symbol:'600001'})
    const b=claim(first,confirm(first,p)).intent;first.close()
    const store=open();recover(store)
    review(store,store.getIntent(b.intentId)!)
    expect(store.inspect().unknownPending).toBe(true)
    expect(()=>store.enableLiveSession({accountDigest:account,observedAt:Date.now()})).toThrow('UNKNOWN_PENDING')
    review(store,store.getIntent(a.intentId)!)
    expect(store.inspect().unknownPending).toBe(false)
    expect(store.getIntent(a.intentId)!.state).toBe('UNKNOWN')
  })
  it('owner death is not executor exit: a real orphan remains blocked even after human review',async()=>{
    const out=compile();const ownerPath=join(directory,'orphan-owner.cjs'),readerPath=join(directory,'orphan-reopen.cjs')
    const stop=join(directory,'stop-orphan'),exited=join(directory,'orphan-exited'),heartbeat=join(directory,'orphan-heartbeat')
    const executorCode=`const fs=require('node:fs');process.on('uncaughtException',e=>{fs.writeFileSync('orphan-error.json',JSON.stringify({message:e.message,code:e.code,stack:e.stack}));process.exit(1)});let n=0;setInterval(()=>{if(fs.existsSync(${JSON.stringify(stop)})){
fs.writeFileSync(${JSON.stringify(exited)},'stopped');process.exit(0)}fs.writeFileSync(${JSON.stringify(heartbeat)},String(++n));},20)`
    writeFileSync(ownerPath,`const fs=require('node:fs');const {randomUUID}=require('node:crypto');
const {MacThsIntentStore}=require(${JSON.stringify(join(out,'macThsIntentStore.js'))});
const {MacThsRecoveryCoordinator}=require(${JSON.stringify(join(out,'macThsRecoveryCoordinator.js'))});
const directory=${JSON.stringify(directory)},s=MacThsIntentStore.open({directory,initialize:true,testHooks:{nativeBinding:${JSON.stringify(nativeBinding)}}});
const raw=${JSON.stringify(snapshot())};s.enableLiveSession({accountDigest:raw.accountContext.digest,observedAt:Date.now()});
let r=s.createIntent(randomUUID(),raw);r=s.confirmIntent(r.intentId,r.snapshotHash,r.revision,{method:'native_dialog',sessionId:s.sessionId,
confirmedAt:Date.now(),expiresAt:r.snapshot.expiresAt,additionalOrderAcknowledged:false});
const permit=s.claimExecution(r.intentId,r.snapshotHash,r.revision,r.originalRequestId,{accountDigest:raw.accountContext.digest,observedAt:Date.now()});
// A real detached child deliberately models an executor that outlives its owner.
const supervisor=new class extends MacThsRecoveryCoordinator {launchExecutor(executable,args){return super.launchExecutor(executable,args,{detached:true,stdio:'ignore'})}}(directory);
const executor=s.launchExecutor(permit.attemptId,supervisor,process.execPath,['-e',${JSON.stringify(executorCode)}]);
const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(heartbeat)})){clearInterval(timer);process.send({executorPid:executor.child.pid,instanceId:executor.instanceId});}},10);`)
    writeFileSync(readerPath,`const {randomUUID}=require('node:crypto');const {MacThsIntentStore}=require(${JSON.stringify(join(out,'macThsIntentStore.js'))});
const s=MacThsIntentStore.open({directory:${JSON.stringify(directory)},testHooks:{nativeBinding:${JSON.stringify(nativeBinding)}}});
const plan=s.inspectRecovery();s.applyRecovery(plan.recoveryId,plan.manifestHash,plan.revision);const r=s.inspect().intents[0];
s.recordHumanReview(r.intentId,r.snapshotHash,{source:'human_reported',method:'native_dialog',statement:'still_uncertain',scope:['orders','deals','confirmation'],
accountDigest:${JSON.stringify(account)},contractNo:null,releaseGate:true},Date.now(),r.revision,{recoveryId:r.recoveryId,reviewRequestId:randomUUID()});
let gate,close;try{s.enableLiveSession({accountDigest:${JSON.stringify(account)},observedAt:Date.now()})}catch(e){gate=e.code}
try{s.close()}catch(e){close=e.code}process.stdout.write(JSON.stringify({gate,close,record:s.getIntent(r.intentId)}));`)
    const child=spawn(process.execPath,[ownerPath],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});children.push(child)
    let primaryFailure:unknown
    try {
      const identity=await message(child);writeFileSync(join(directory,'orphan-instance.json'),JSON.stringify(identity))
      await killed(child)
      const before=Number(readFileSync(heartbeat,'utf8'));await new Promise(done=>setTimeout(done,100))
      expect(Number(readFileSync(heartbeat,'utf8'))).toBeGreaterThan(before)
      const probe=spawn(process.execPath,[readerPath],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe']});children.push(probe)
      let stdout='',stderr='';probe.stdout!.on('data',data=>stdout+=String(data));probe.stderr!.on('data',data=>stderr+=String(data))
      const code=await new Promise<number|null>(done=>probe.once('close',done))
      writeFileSync(join(directory,'orphan-reopen-result.json'),JSON.stringify({code,stdout,stderr}))
      expect(code,stderr).toBe(0);const result=JSON.parse(stdout)
      expect(result.gate).toBe('EXECUTOR_EXIT_UNPROVEN');expect(result.close).toBe('EXECUTOR_EXIT_UNPROVEN')
      expect(result.record.state).toBe('UNKNOWN');expect(result.record.executionForbidden).toBe(true)
    } catch(error) {
      primaryFailure=error;writeFileSync(join(directory,'orphan-primary-error.json'),JSON.stringify({message:String(error),stack:(error as Error).stack}));throw error
    } finally {
      // Controlled fixture stop channel is cleanup only, never supplied as a store exit capability.
      writeFileSync(stop,'stop')
      for(let i=0;i<200 && !existsSync(exited);i++)await new Promise(done=>setTimeout(done,10))
      if(!existsSync(exited))writeFileSync(join(directory,'orphan-cleanup-uncertain.json'),'No controlled-exit marker observed')
      if(!primaryFailure)expect(existsSync(exited)).toBe(true)
    }
  },20000)
  it('actual SQLITE_FULL during BLOB import rolls back the entire recovery and retries the identical plan',async()=>{
    const cap=await sealed({'mac-ths-experiment-journal.json':JSON.stringify({unknownPending:true,usedRequests:[randomUUID()]}),
      'mac-ths-intents.lock':'retained-original-owner-'.repeat(50000)})
    const store=open(cap),db=stores.get(store)!,plan=store.inspectRecovery()
    db.pragma('max_page_count='+Number(db.pragma('page_count',{simple:true})))
    expect(()=>store.applyRecovery(plan.recoveryId!,plan.manifestHash!,plan.revision)).toThrow('STORAGE_IO')
    expect((db.prepare('SELECT count(*) AS n FROM recovery_cases').get() as {n:number}).n).toBe(0)
    expect((db.prepare('SELECT count(*) AS n FROM recovery_artifacts').get() as {n:number}).n).toBe(0)
    expect((db.prepare('SELECT count(*) AS n FROM request_tombstones').get() as {n:number}).n).toBe(0)
    store.close()
    const reopened=open(cap)
    expect(reopened.inspectRecovery().recoveryId).toBe(plan.recoveryId)
    const result=reopened.applyRecovery(plan.recoveryId!,plan.manifestHash!,plan.revision)
    expect(result.requestCount).toBe(1);expect(result.sourceComplete).toBe(true)
  })
  it('recovery IDs and review binding reject coercion/getters before hashing or database binding',()=>{
    const first=open();const old=unknown(first);first.close();const store=open();recover(store)
    const r=store.getIntent(old.intentId)!;let called=0
    const bad={toString(){called++;return r.recoveryId!},get value(){called++;return 1}}
    expect(()=>store.getRecoveryReceipt(bad as never)).toThrow('INVALID_RECOVERY_ID')
    expect(()=>store.applyRecovery(r.recoveryId!,bad as never,1)).toThrow('INVALID_RECOVERY_REQUEST')
    const observation={source:'human_reported',method:'native_dialog',statement:'still_uncertain',scope:['orders','deals','confirmation'],
      accountDigest:account,contractNo:null,releaseGate:true}
    expect(()=>store.recordHumanReview(r.intentId,bad as never,observation as never,Date.now(),r.revision,
      {recoveryId:r.recoveryId!,reviewRequestId:randomUUID()})).toThrow('INVALID_ID')
    const binding=Object.defineProperty({reviewRequestId:randomUUID()},'recoveryId',{enumerable:true,get(){called++;return r.recoveryId}})
    expect(()=>store.recordHumanReview(r.intentId,r.snapshotHash,observation as never,Date.now(),r.revision,binding as never)).toThrow('INVALID_DATA')
    expect(called).toBe(0);expect(store.getIntent(r.intentId)!.events).toEqual(r.events);expect(store.inspect().unknownPending).toBe(true)
  })
  it('ABI failure is explicit and never falls back to JSON or simulation',()=>{
    expect(()=>MacThsIntentStore.open({directory,initialize:true,testHooks:{nativeBinding:join(directory,'missing.node')}})).toThrow('ABI_UNAVAILABLE')
    expect(existsSync(join(directory,'mac-ths-intents.v1.json'))).toBe(false)
  })
  it('does not ignore changed sealed legacy IDs after import or let a new no-op coordinator attest them',async()=>{
    const id=randomUUID(),late=randomUUID()
    const cap=await sealed({'mac-ths-experiment-journal.json':JSON.stringify({unknownPending:false,usedRequests:[id]})})
    const store=open(cap);recover(store)
    writeFileSync(join(directory,'mac-ths-experiment-journal.json'),JSON.stringify({unknownPending:false,usedRequests:[id,late]}))
    expect(store.inspectRecovery()).toMatchObject({reason:'LEGACY_WRITER_UNFENCED',canApply:false})
    expect(()=>store.createIntent(late,snapshot())).toThrow('LEGACY_WRITER_UNFENCED')
    expect(()=>new MacThsRecoveryCoordinator(directory).launchLegacy(process.execPath,['-e','process.exit(0)'])).toThrow('LEGACY_ENTRY_RETIRED')
    expect(()=>MacThsRecoveryCoordinator.restoreLegacyQuiescence(directory)).toThrow('LEGACY_WRITER_UNFENCED')
    expect(store.inspect().requestCount).toBe(1)
  })

})
