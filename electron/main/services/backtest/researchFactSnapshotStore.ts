import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { capitalDate, isResearchSnapshotReference, type CapitalRequest, type ResearchSnapshotReference } from '../../../shared/capitalSimulation'
import { CapitalError } from './capitalSimulationError'
import { readCapitalMarketFacts, windowCapitalFacts, type CapitalMarketFacts } from './capitalMarketFacts'

interface SnapshotBody { schema: 1; source: CapitalRequest['source']; dateStart: string; dateEnd: string; facts: CapitalMarketFacts }
const MAX_BYTES = 64 * 1024 * 1024, TOTAL_BYTES = 512 * 1024 * 1024
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
function schema(db: Database.Database) { db.exec('CREATE TABLE IF NOT EXISTS rf_research_fact_snapshots(id TEXT PRIMARY KEY,body_json TEXT NOT NULL,digest TEXT NOT NULL,created_at INTEGER NOT NULL)') }
function reference(id: string, body: SnapshotBody, createdAt: number): ResearchSnapshotReference {
  return { id, digest: digest(body), createdAt, dateStart: body.dateStart, dateEnd: body.dateEnd,
    signalCount: body.facts.rows.length, barCount: body.facts.barRows.length }
}
export function sameResearchSnapshot(a: ResearchSnapshotReference | undefined, b: ResearchSnapshotReference): boolean {
  return isResearchSnapshotReference(a) && a.id === b.id && a.digest === b.digest && a.createdAt === b.createdAt
    && a.dateStart === b.dateStart && a.dateEnd === b.dateEnd && a.signalCount === b.signalCount && a.barCount === b.barCount
}
/** Called inside protocol creation's transaction. No update/upsert or automatic replacement. */
export function captureResearchSnapshot(db: Database.Database, request: CapitalRequest, now: number): ResearchSnapshotReference {
  schema(db)
  if (request.funding.kind !== 'manual' || !Number.isSafeInteger(now) || now < 0) throw new CapitalError('INVALID_INPUT')
  if (db.prepare('SELECT id FROM rf_research_fact_snapshots WHERE id=?').get(request.id)) throw new CapitalError('SNAPSHOT_CONFLICT')
  const occupied = db.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(length(CAST(body_json AS BLOB))),0) AS bytes FROM rf_research_fact_snapshots').get() as { n: number; bytes: number }
  if (occupied.n >= 100 || occupied.bytes >= TOTAL_BYTES) throw new CapitalError('FACT_LIMIT')
  const body: SnapshotBody = { schema: 1, source: request.source, dateStart: request.dateStart, dateEnd: request.dateEnd, facts: readCapitalMarketFacts(db, request) }
  const json = JSON.stringify(body), bytes = Buffer.byteLength(json)
  if (bytes > MAX_BYTES || occupied.bytes + bytes > TOTAL_BYTES) throw new CapitalError('FACT_LIMIT')
  const ref = reference(request.id, body, now)
  db.prepare('INSERT INTO rf_research_fact_snapshots(id,body_json,digest,created_at) VALUES(?,?,?,?)').run(ref.id, json, ref.digest, now)
  return ref
}
export function getResearchSnapshot(db: Database.Database, ref: ResearchSnapshotReference): SnapshotBody {
  try {
    if (!isResearchSnapshotReference(ref)) throw new CapitalError('SNAPSHOT_UNAVAILABLE')
    const row = db.prepare('SELECT body_json,digest,created_at FROM rf_research_fact_snapshots WHERE id=?').get(ref.id) as { body_json: string; digest: string; created_at: number } | undefined
    if (!row || row.digest !== ref.digest || row.created_at !== ref.createdAt || Buffer.byteLength(row.body_json) > MAX_BYTES) throw new CapitalError('SNAPSHOT_UNAVAILABLE')
    const body = JSON.parse(row.body_json) as SnapshotBody
    if (body?.schema !== 1 || !capitalDate(body.dateStart) || !capitalDate(body.dateEnd) || body.dateStart > body.dateEnd
      || !body.facts || !Array.isArray(body.facts.calendar) || !Array.isArray(body.facts.rows) || !Array.isArray(body.facts.barRows)
      || body.facts.rows.length > 5000 || body.facts.barRows.length > 300000 || body.facts.calendar.length > 1096
      || !sameResearchSnapshot(reference(ref.id, body, row.created_at), ref)) throw new CapitalError('SNAPSHOT_UNAVAILABLE')
    return body
  } catch (error) {
    if (error instanceof CapitalError) throw error
    throw new CapitalError('SNAPSHOT_UNAVAILABLE')
  }
}
export function researchWindowFacts(db: Database.Database, ref: ResearchSnapshotReference, request: CapitalRequest): CapitalMarketFacts {
  const body = getResearchSnapshot(db, ref)
  if (request.funding.kind !== 'manual' || body.dateStart > request.dateStart || body.dateEnd < request.dateEnd || digest(body.source) !== digest(request.source)) throw new CapitalError('SNAPSHOT_CONFLICT')
  return windowCapitalFacts(body.facts, request)
}
