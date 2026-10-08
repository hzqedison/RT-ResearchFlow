import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { Payload, IntentRecord, HumanObservation, intentRecoveryCodec } from './macThsIntentStore'
import { verifyLegacyQuiescence, readLegacyRetirement, LEGACY_SUPERVISION_FILE, LEGACY_RETIREMENT_FILE, type LegacyQuiescenceCapability } from './macThsRecoveryCoordinator'

export type RecoveryReason = 'ACTIVE_OWNER' | 'LEGACY_WRITER_UNFENCED' | 'IMPORT_REQUIRED' |
  'INTERRUPTED_SESSION' | 'EVIDENCE_CONFLICT' | 'STORAGE_IO' | 'CORRUPT_STORE' | 'ABI_UNAVAILABLE'
export interface RecoveryRequired {
  code: 'RECOVERY_REQUIRED'; reason: RecoveryReason; recoveryId: string | null
  evidence: 'unavailable' | 'verified' | 'partial' | 'conflicting'; manifestHash: string | null
  ownerProof: 'none' | 'sqlite_exclusive' | 'sqlite_and_legacy_quiesced'
  canInspect: boolean; canApply: boolean; canSubmit: false
  nextAction: 'switch_or_close_instance' | 'controlled_restart' | 'inspect_and_recover' | 'retry_storage' | 'repair_environment'
}
export class RecoveryRequiredError extends Error {
  readonly code = 'RECOVERY_REQUIRED'
  readonly recovery: RecoveryRequired
  constructor(readonly reason: RecoveryReason, readonly storageCode: string | null = null) {
    super('RECOVERY_REQUIRED:' + reason)
    this.name = 'RecoveryRequiredError'
    this.recovery = { code: 'RECOVERY_REQUIRED', reason, recoveryId: null, manifestHash: null,
      evidence: 'unavailable', ownerProof: 'none', canInspect: false, canApply: false, canSubmit: false,
      nextAction: reason === 'ACTIVE_OWNER' ? 'switch_or_close_instance' :
        reason === 'LEGACY_WRITER_UNFENCED' ? 'controlled_restart' :
        reason === 'ABI_UNAVAILABLE' ? 'repair_environment' :
        reason === 'STORAGE_IO' ? 'retry_storage' : 'inspect_and_recover' }
  }
  static from(error: unknown, fallback: RecoveryReason): RecoveryRequiredError {
    if (error instanceof RecoveryRequiredError) return error
    const code = (error as {code?: string})?.code ?? null
    return new RecoveryRequiredError(code?.startsWith('SQLITE_BUSY') || code === 'SQLITE_LOCKED' ? 'ACTIVE_OWNER'
      : code?.startsWith('SQLITE_IOERR') || code === 'SQLITE_FULL' || code === 'EIO' || code === 'ENOSPC' ? 'STORAGE_IO'
      : fallback, code)
  }
}
export type RecoveryCheckpoint = 'recovery_audits_written' | 'recovery_tombstones_written' |
  'recovery_projections_written' | 'recovery_receipt_written' | 'recovery_before_commit' |
  'recovery_after_commit' | 'review_before_commit' | 'review_after_commit'
export interface RecoveryReviewBinding { recoveryId: string; reviewRequestId: string }
export interface RecoveryReceipt {
  code: 'STORAGE_RECOVERED_REVIEW_REQUIRED'; recoveryId: string; manifestHash: string; baseRevision: number
  intentCount: number; requestCount: number; artifactCount: number; sourceComplete: boolean
  reviewIntentIds: string[]; executionForbiddenIntentIds: string[]
}
interface Artifact { name: string; role: string; sha256: string; size: number; validation: string; raw: Buffer }
interface Conflict { kind: string; entityId: string; evidence: string }
export interface RecoveryInspection {
  code: 'READY' | 'RECOVERY_REQUIRED'; reason: RecoveryReason | null; recoveryId: string | null
  manifestHash: string | null; revision: number; evidence: RecoveryRequired['evidence']
  ownerProof: RecoveryRequired['ownerProof']; canInspect: boolean; canApply: boolean; canSubmit: false
  nextAction: RecoveryRequired['nextAction']
  artifacts: Array<Omit<Artifact,'raw'>>
  intents: Array<{intentId:string; state:string; quarantine:boolean; executionForbidden:true}>
}
interface Plan extends RecoveryInspection {
  payload: Payload; rawArtifacts: Artifact[]; conflicts: Conflict[]; reservations: string[]
  sourceComplete: boolean; proof: unknown; oldIds: string[]; quarantineIds: string[]; potentialEffects: string[]
}
interface Backend {
  db: Database.Database; directory: string; sessionId: string; legacyJournalPath?: string
  legacyQuiescence?: LegacyQuiescenceCapability
  assertOwner(): void; load(): Payload; save(payload: Payload, previous: Payload): void
  checkpoint(stage: RecoveryCheckpoint): void; codec: typeof intentRecoveryCodec; poison(): void
}
const hashBytes = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const ID = /^[a-f0-9-]{36}$/
function assert(value: unknown, code: string): asserts value {
  if (!value) throw Object.assign(new Error(code), {code})
}
function legacyId(hash: string): string {
  return hash.slice(0,8)+'-'+hash.slice(8,12)+'-4'+hash.slice(13,16)+'-8'+hash.slice(17,20)+'-'+hash.slice(20,32)
}
/** No file cleanup, candidate winner election, timeout takeover or broker inference lives here. */
export class MacThsIntentRecovery {
  constructor(private readonly backend: Backend) {}
  private sources(): Array<{name:string;role:string}> {
    const b = this.backend
    if ((b.db.prepare('SELECT imported FROM meta WHERE id=1').get() as {imported:number}).imported) return []
    if (b.legacyJournalPath) assert(resolve(dirname(b.legacyJournalPath)) === resolve(b.directory), 'INVALID_LEGACY_DIRECTORY')
    const journal = b.legacyJournalPath ? basename(b.legacyJournalPath) : 'mac-ths-experiment-journal.json'
    const roles: Record<string,string> = {'mac-ths-intents.v1.json':'committed','mac-ths-intents.lock':'lock',
      'mac-ths-intents.pending':'pending','mac-ths-intents.enabled':'activated',[journal]:'experiment',
      [LEGACY_SUPERVISION_FILE]:'supervision',[LEGACY_RETIREMENT_FILE]:'retirement'}
    return readdirSync(b.directory).filter(name => roles[name] ||
      (name.startsWith('mac-ths-intents.v1.json.') && name.endsWith('.tmp')))
      .sort().map(name => ({name,role:roles[name] ?? 'candidate'}))
  }
  private plan(): Plan {
    const b=this.backend; b.assertOwner()
    const original=b.load(); const payload=b.codec.copy(original)
    const meta=b.db.prepare('SELECT source_complete FROM meta WHERE id=1').get() as {source_complete:number}
    const sources=this.sources()
    const old=b.db.prepare('SELECT intent_id FROM intents WHERE created_session<>? AND execution_forbidden=0 ORDER BY intent_id')
      .all(b.sessionId) as Array<{intent_id:string}>
    const result: Plan={code:'READY',reason:null,recoveryId:null,manifestHash:null,revision:original.revision,
      evidence:meta.source_complete ? 'verified':'partial',ownerProof:'sqlite_exclusive',canInspect:true,canApply:false,canSubmit:false,
      nextAction:'inspect_and_recover',artifacts:[],intents:[],payload,rawArtifacts:[],conflicts:[],reservations:[],
      sourceComplete:Boolean(meta.source_complete),proof:null,oldIds:old.map(row=>row.intent_id),quarantineIds:[],potentialEffects:[]}
    // Import does not make subsequent changes to the sealed source disappear.
    // Only completed supervised seals can be reopened; never mint proof from a new no-op child.
    try {
      const cases=b.db.prepare('SELECT plan FROM recovery_cases').all() as Array<{plan:string}>
      for(const saved of cases) {
        const proof=JSON.parse(saved.plan).proof
        if(proof && b.codec.canonical(readLegacyRetirement(b.directory))!==b.codec.canonical(proof))
          throw new Error('LEGACY_WRITER_UNFENCED')
      }
    } catch {
      result.code='RECOVERY_REQUIRED';result.reason='LEGACY_WRITER_UNFENCED'
      result.evidence='unavailable';result.canInspect=false;return result
    }
    if (!sources.length && !old.length) {
      if (!result.sourceComplete) { result.code='RECOVERY_REQUIRED'; result.reason='EVIDENCE_CONFLICT' }
      return result
    }
    result.code='RECOVERY_REQUIRED'; result.reason=sources.length ? 'IMPORT_REQUIRED':'INTERRUPTED_SESSION'
    if (sources.length) {
      try {
        const proof=verifyLegacyQuiescence(b.legacyQuiescence,b.directory)
        assert(sources.every(source=>[LEGACY_SUPERVISION_FILE,LEGACY_RETIREMENT_FILE].includes(source.name) ||
          proof.files.some(file=>file.name===source.name)),'LEGACY_WRITER_UNFENCED')
        result.proof=proof
      }
      catch { result.reason='LEGACY_WRITER_UNFENCED';result.evidence='unavailable';result.canInspect=false;return result }
      result.ownerProof='sqlite_and_legacy_quiesced'
    }
    const conflict=(kind:string,entityId:string,evidence:string) => {
      if (!result.conflicts.some(c=>c.kind===kind && c.entityId===entityId))
        result.conflicts.push({kind,entityId,evidence})
    }
    const valid: Array<{artifact:Artifact;payload:Payload}>=[]
    let marker: {storeId:string}|null=null
    let pending: {storeId:string;revision:number}|null=null
    for (const source of sources) {
      const path=join(b.directory,source.name); const stat=lstatSync(path)
      assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink===1,'UNSAFE_RECOVERY_ARTIFACT')
      const raw=readFileSync(path)
      const artifact:Artifact={...source,raw,size:raw.length,sha256:hashBytes(raw),validation:'opaque'}
      result.rawArtifacts.push(artifact)
      try {
        if (source.role==='committed' || source.role==='candidate') {
          const decoded=b.codec.decode(raw); valid.push({artifact,payload:decoded});artifact.validation='verified-v1'
        } else if (source.role==='activated') {
          const value=b.codec.copy(JSON.parse(raw.toString('utf8')))
          assert(Object.keys(value).sort().join(',')==='schemaVersion,storeId' && value.schemaVersion===1
            && typeof value.storeId==='string' && ID.test(value.storeId),'INVALID_MARKER')
          marker=value; artifact.validation='verified-v1'
        } else if (source.role==='pending') {
          const value=b.codec.copy(JSON.parse(raw.toString('utf8')))
          assert(Object.keys(value).sort().join(',')==='revision,storeId' && typeof value.storeId==='string'
            && ID.test(value.storeId) && Number.isSafeInteger(value.revision) && value.revision>0,'INVALID_PENDING')
          pending=value;artifact.validation='uncommitted-boundary'
        } else if (source.role==='experiment') {
          const value=b.codec.copy(JSON.parse(raw.toString('utf8')))
          assert(Object.keys(value).sort().join(',')==='unknownPending,usedRequests' &&
            typeof value.unknownPending==='boolean' && Array.isArray(value.usedRequests) &&
            value.usedRequests.every((id:unknown)=>typeof id==='string' && ID.test(id)),'INVALID_EXPERIMENT')
          const ids=[...new Set<string>(value.usedRequests)]
          const legacy:Payload={storeId:legacyId(artifact.sha256),revision:1,coverage:{
            kind:'legacy',since:original.coverage.since,legacyIds:ids.length,earlierIds:'unavailable'},
            requests:ids.map(requestId=>({requestId,intentId:null,snapshotHash:null,origin:'legacy'})),intents:[]}
          if(value.unknownPending) legacy.intents.push({intentId:legacyId(b.codec.digest({unknown:artifact.sha256})),
            originalRequestId:null,snapshot:null,snapshotHash:null,fingerprint:null,additionalOrder:null,
            events:[{sequence:1,at:original.coverage.since,kind:'legacy_unknown'}]})
          valid.push({artifact,payload:legacy});artifact.validation='verified-experiment'
        }
      } catch {
        artifact.validation='invalid'; result.sourceComplete=false
        conflict('invalid_artifact',source.name,artifact.sha256)
      }
    }
    const committed=valid.filter(v=>v.artifact.role==='committed')
    if (committed.length && !marker) {
      result.sourceComplete=false;conflict('missing_activation','all','committed_without_activation')
    }
    if (valid.some(v=>v.artifact.role==='candidate') && !committed.length) {
      result.sourceComplete=false;conflict('missing_committed','all','candidate_is_not_a_commit')
    }
    if (pending && !valid.some(v=>v.payload.storeId===pending!.storeId && v.payload.revision===pending!.revision)) {
      result.sourceComplete=false;conflict('unexplained_pending',pending.storeId,String(pending.revision))
    }
    if (marker && !committed.some(v=>v.payload.storeId===marker!.storeId)) {
      result.sourceComplete=false;conflict('missing_committed',marker.storeId,'activated_without_matching_committed')
    }
    // Formal JSON has committed status. Candidates never replace its snapshot or history.
    valid.sort((a,c)=>(a.artifact.role==='committed' ? -1:c.artifact.role==='committed' ? 1:0) ||
      a.artifact.name.localeCompare(c.artifact.name))
    const knownRequests=new Map(payload.requests.map(item=>[item.requestId,item]))
    const knownIntents=new Map(payload.intents.map(item=>[item.intentId,item]))
    let committedPayload=b.codec.copy(original)
    for(const item of valid) {
      if(item.artifact.role!=='experiment' && marker && item.payload.storeId!==marker.storeId) {
        result.sourceComplete=false;conflict('store_id',item.artifact.name,item.payload.storeId)
      }
      for(const record of item.payload.intents) {
        result.reservations.push(record.intentId);result.oldIds.push(record.intentId)
        const state=b.codec.view(record)
        if(state.attempt || state.state==='LEGACY_UNKNOWN') result.potentialEffects.push(record.intentId)
        const oldRecord=knownIntents.get(record.intentId)
        if(!oldRecord) { knownIntents.set(record.intentId,record);payload.intents.push(record) }
        else if(b.codec.canonical(oldRecord)!==b.codec.canonical(record)) {
          result.quarantineIds.push(record.intentId)
          conflict('intent_branch',record.intentId,item.artifact.sha256)
        }
        if(state.state==='UNKNOWN' || state.state==='LEGACY_UNKNOWN' || item.artifact.role==='candidate' || pending)
          result.quarantineIds.push(record.intentId)
      }
      for(const request of item.payload.requests) {
        const prior=knownRequests.get(request.requestId)
        if(!prior) {knownRequests.set(request.requestId,request);payload.requests.push(request)}
        else if(b.codec.canonical(prior)!==b.codec.canonical(request)) {
          result.sourceComplete=false;conflict('request_mapping',request.requestId,item.artifact.sha256)
          if(prior.intentId)result.quarantineIds.push(prior.intentId)
          if(request.intentId)result.quarantineIds.push(request.intentId)
        }
      }
      if(item.artifact.role==='committed' || item.artifact.role==='experiment') {
        const candidate=b.codec.copy(payload)
        candidate.coverage.legacyIds=candidate.requests.filter(r=>r.origin==='legacy').length
        try {b.codec.validatePayload(candidate);committedPayload=candidate}
        catch {result.sourceComplete=false;conflict('committed_conflict',item.artifact.name,item.artifact.sha256)}
      }
    }
    payload.coverage.legacyIds=payload.requests.filter(r=>r.origin==='legacy').length
    if(sources.length)payload.coverage.kind='legacy'
    // If relational branches cannot be reconciled, preserve all bytes and ID reservations,
    // keep the last valid local payload and reserve every other request as non-executable.
    try { b.codec.validatePayload(payload) }
    catch {
      result.sourceComplete=false;conflict('relational_branch','all','incompatible_verified_sources')
      payload.intents=committedPayload.intents
      payload.requests=[...committedPayload.requests]
      for(const requestId of knownRequests.keys()) if(!payload.requests.some(r=>r.requestId===requestId))
        payload.requests.push({requestId,intentId:null,snapshotHash:null,origin:'legacy'})
      payload.coverage.legacyIds=payload.requests.filter(r=>r.origin==='legacy').length
    }
    result.oldIds=[...new Set(result.oldIds)].sort()
    result.reservations=[...new Set(result.reservations)].sort()
    for(const record of payload.intents) if(result.oldIds.includes(record.intentId)) {
      const state=b.codec.view(record)
      if(state.state==='UNKNOWN' || state.state==='LEGACY_UNKNOWN')result.quarantineIds.push(record.intentId)
    }
    result.quarantineIds=[...new Set(result.quarantineIds)].sort()
    result.potentialEffects=[...new Set(result.potentialEffects)].sort()
    result.artifacts=result.rawArtifacts.map(({raw:_,...metadata})=>metadata)
    const manifest={algorithm:1,storeId:original.storeId,revision:original.revision,
      sources:valid.map(v=>({name:v.artifact.name,storeId:v.payload.storeId,revision:v.payload.revision})),
      artifacts:result.artifacts,oldIds:result.oldIds}
    result.manifestHash=b.codec.digest(manifest)
    result.recoveryId=b.codec.digest({recoveryAlgorithm:1,manifest})
    result.canApply=true
    result.evidence=!result.sourceComplete ? 'partial':result.conflicts.length ? 'conflicting':'verified'
    if(!result.sourceComplete || result.conflicts.length)result.reason='EVIDENCE_CONFLICT'
    result.intents=payload.intents.filter(r=>result.oldIds.includes(r.intentId)).map(record=>({
      intentId:record.intentId,state:b.codec.view(record).state,quarantine:result.quarantineIds.includes(record.intentId),
      executionForbidden:true}))
    return result
  }
  inspectRecovery(): RecoveryInspection {
    const {payload:_,rawArtifacts:__,conflicts:___,reservations:____,sourceComplete:_____,
      proof:______,oldIds:_______,quarantineIds:________,potentialEffects:_________,...inspection}=this.plan()
    return inspection
  }
  assertNormal(): void {
    const b=this.backend; b.assertOwner()
    const inspection=this.inspectRecovery()
    if(inspection.code==='RECOVERY_REQUIRED') throw new RecoveryRequiredError(inspection.reason!)
    const complete=(b.db.prepare('SELECT source_complete FROM meta WHERE id=1').get() as {source_complete:number}).source_complete
    if(!complete)throw new RecoveryRequiredError('EVIDENCE_CONFLICT')
    if(b.db.prepare("SELECT 1 FROM attempts WHERE executor_state IN ('launch_pending','running') LIMIT 1").get())
      throw Object.assign(new Error('EXECUTOR_EXIT_UNPROVEN'),{code:'EXECUTOR_EXIT_UNPROVEN'})
  }
  getRecoveryReceipt(recoveryId:string): RecoveryReceipt|null {
    this.backend.assertOwner()
    assert(typeof recoveryId==='string' && /^[a-f0-9]{64}$/.test(recoveryId),'INVALID_RECOVERY_ID')
    const row=this.backend.db.prepare('SELECT receipt FROM recovery_cases WHERE recovery_id=?').get(recoveryId) as {receipt:string}|undefined
    return row ? this.backend.codec.copy(JSON.parse(row.receipt)) : null
  }
  applyRecovery(recoveryId:string,manifestHash:string,expectedRevision:number): RecoveryReceipt {
    const b=this.backend;b.assertOwner()
    assert(typeof manifestHash==='string' && /^[a-f0-9]{64}$/.test(manifestHash) && Number.isSafeInteger(expectedRevision)
      && expectedRevision>0,'INVALID_RECOVERY_REQUEST')
    const prior=this.getRecoveryReceipt(recoveryId)
    if(prior) {
      assert(prior.manifestHash===manifestHash && prior.baseRevision===expectedRevision,'RECOVERY_CONFLICT')
      return prior
    }
    const plan=this.plan()
    assert(plan.canApply && plan.recoveryId===recoveryId && plan.manifestHash===manifestHash,'RECOVERY_PLAN_CHANGED')
    assert(plan.revision===expectedRevision,'CAS_CONFLICT')
    const previous=b.load()
    const receipt:RecoveryReceipt={code:'STORAGE_RECOVERED_REVIEW_REQUIRED',recoveryId,manifestHash,baseRevision:expectedRevision,
      intentCount:plan.payload.intents.length,requestCount:plan.payload.requests.length,artifactCount:plan.rawArtifacts.length,
      sourceComplete:plan.sourceComplete,reviewIntentIds:plan.quarantineIds,executionForbiddenIntentIds:plan.oldIds}
    try {
      b.db.exec('BEGIN EXCLUSIVE');b.assertOwner()
      // One synchronous transaction; no dialogs, process waits or post-commit file cleanup.
      b.db.prepare('INSERT INTO recovery_cases(recovery_id,manifest_hash,base_revision,plan,receipt) VALUES(?,?,?,?,?)')
        .run(recoveryId,manifestHash,expectedRevision,b.codec.canonical({inspection:this.inspectRecovery(),proof:plan.proof}),b.codec.canonical(receipt))
      for(const artifact of plan.rawArtifacts) b.db.prepare(
        'INSERT INTO recovery_artifacts(recovery_id,name,role,sha256,size,validation,raw) VALUES(?,?,?,?,?,?,?)')
        .run(recoveryId,artifact.name,artifact.role,artifact.sha256,artifact.size,artifact.validation,artifact.raw)
      b.checkpoint('recovery_audits_written')
      plan.payload.revision=previous.revision+1;b.save(plan.payload,previous)
      for(const intentId of plan.reservations)b.db.prepare('INSERT OR IGNORE INTO intent_reservations(intent_id) VALUES(?)').run(intentId)
      for(const conflict of plan.conflicts)b.db.prepare('INSERT INTO recovery_conflicts(recovery_id,kind,entity_id,evidence) VALUES(?,?,?,?)')
        .run(recoveryId,conflict.kind,conflict.entityId,conflict.evidence)
      b.checkpoint('recovery_tombstones_written')
      for(const intentId of plan.oldIds) b.db.prepare(
        'UPDATE intents SET execution_forbidden=1,recovery_quarantine=?,recovery_id=?,potential_effect=MAX(potential_effect,?) WHERE intent_id=?')
        .run(Number(plan.quarantineIds.includes(intentId)),recoveryId,Number(plan.potentialEffects.includes(intentId)),intentId)
      b.checkpoint('recovery_projections_written')
      b.db.prepare('UPDATE meta SET imported=1,source_complete=? WHERE id=1').run(Number(plan.sourceComplete))
      b.checkpoint('recovery_receipt_written');b.checkpoint('recovery_before_commit')
      b.db.exec('COMMIT');b.checkpoint('recovery_after_commit')
      return b.codec.copy(receipt)
    } catch(error) {
      b.poison()
      if(b.db.inTransaction)b.db.exec('ROLLBACK')
      if(typeof (error as {code?:string}).code==='string' && (error as {code:string}).code.startsWith('SQLITE_'))
        throw RecoveryRequiredError.from(error,'STORAGE_IO')
      throw error
    }
  }
  recordHumanReview(intentId:string,snapshotHash:string|null,observation:HumanObservation,reviewedAt:number,
    expectedRevision:number,binding:RecoveryReviewBinding):IntentRecord {
    const b=this.backend;b.assertOwner()
    assert(Object.keys(binding).sort().join(',')==='recoveryId,reviewRequestId' &&
      typeof binding.reviewRequestId==='string' && ID.test(binding.reviewRequestId) &&
      typeof binding.recoveryId==='string' && /^[a-f0-9]{64}$/.test(binding.recoveryId),'INVALID_RECOVERY_REVIEW')
    const inputHash=b.codec.digest({intentId,snapshotHash,observation,reviewedAt,expectedRevision,binding})
    const duplicate=b.db.prepare('SELECT input_hash,result FROM human_reviews WHERE review_request_id=?')
      .get(binding.reviewRequestId) as {input_hash:string;result:string}|undefined
    if(duplicate) {assert(duplicate.input_hash===inputHash,'REVIEW_REQUEST_CONFLICT');return b.codec.freeze(b.codec.copy(JSON.parse(duplicate.result)))}
    const previous=b.load();const payload=b.codec.copy(previous)
    const record=payload.intents.find(r=>r.intentId===intentId)
    assert(record && record.snapshotHash===snapshotHash,'SNAPSHOT_CONFLICT')
    assert(record.events.length===expectedRevision,'CAS_CONFLICT')
    const projection=b.db.prepare('SELECT execution_forbidden,recovery_id FROM intents WHERE intent_id=?').get(intentId) as {
      execution_forbidden:number;recovery_id:string|null}
    assert(projection.execution_forbidden && projection.recovery_id===binding.recoveryId,'RECOVERY_REVIEW_REQUIRED')
    record.events.push({kind:'recovery_review',sequence:expectedRevision+1,at:reviewedAt,reviewingSessionId:b.sessionId,
      observation,recoveryId:binding.recoveryId,reviewRequestId:binding.reviewRequestId,snapshotHash,expectedRevision})
    const viewed=b.codec.view(record)
    const result={...viewed,executionForbidden:true,recoveryQuarantine:!observation.releaseGate,recoveryId:binding.recoveryId}
    try {
      b.db.exec('BEGIN EXCLUSIVE');b.assertOwner()
      payload.revision++;b.save(payload,previous)
      b.db.prepare('UPDATE intents SET recovery_quarantine=? WHERE intent_id=?').run(Number(!observation.releaseGate),intentId)
      b.db.prepare('INSERT INTO human_reviews(review_request_id,intent_id,recovery_id,input_hash,result) VALUES(?,?,?,?,?)')
        .run(binding.reviewRequestId,intentId,binding.recoveryId,inputHash,b.codec.canonical(result))
      b.checkpoint('review_before_commit');b.db.exec('COMMIT');b.checkpoint('review_after_commit')
      return b.codec.freeze(b.codec.copy(result))
    } catch(error) {
      b.poison();if(b.db.inTransaction)b.db.exec('ROLLBACK')
      if(typeof (error as {code?:string}).code==='string' && (error as {code:string}).code.startsWith('SQLITE_'))
        throw RecoveryRequiredError.from(error,'STORAGE_IO')
      throw error
    }
  }
}
