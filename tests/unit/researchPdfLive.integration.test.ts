import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve, isAbsolute } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runMigrations } from '../../electron/main/database/db'
import { getSelectedResearchReports } from '../../electron/main/services/multiSourceResearchService'
import { createResearchAgentNetworkClient, RESEARCH_AGENT_NETWORK_LIMITS } from '../../electron/main/services/researchAgentNetworkPolicy'
import { extractResearchPdfText } from '../../electron/main/services/researchPdfParser'

vi.mock('electron', () => ({
  app: { getPath: () => 'ISOLATED_UNUSED_DATA_ROOT' },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}))

describe.skipIf(process.env.RT_REAL_PUBLIC_PDF_LIVE !== '1')('existing native PDF pipeline with an actual public report', () => {
  it('downloads through the production safe client and extracts bounded text without model calls', async () => {
    const proofInput = process.env.RT_REAL_PUBLIC_PDF_PROOF_ROOT
    if (!proofInput || !isAbsolute(proofInput)) throw new Error('EXPLICIT_OWNED_PROOF_ROOT_REQUIRED')
    const root = resolve(proofInput)
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      const reports = await getSelectedResearchReports(db, '000333', 'eastmoney')
      expect(reports.statuses).toEqual([expect.objectContaining({ provider: 'eastmoney', state: 'ready' })])
      expect(reports.reports.length).toBeGreaterThan(0)
      const selected = reports.reports.find(report => {
        if (!report.pdfUrl) return false
        const url = new URL(report.pdfUrl)
        return url.protocol === 'https:' && url.hostname === 'pdf.dfcfw.com' && !url.username && !url.password &&
          !url.search && /^\/pdf\/H3_AP\d+_1\.pdf$/.test(url.pathname)
      })
      if (!selected?.pdfUrl) throw new Error('PUBLIC_REPORT_PDF_REFERENCE_NOT_AVAILABLE')
      const network = createResearchAgentNetworkClient()
      const response = await network({ url: selected.pdfUrl, method: 'GET', acceptedMimeKinds: ['pdf'] })
      expect(response.envelope.response.statusCode).toBe(200)
      expect(response.envelope.response.mimeKind).toBe('pdf')
      expect(response.body.subarray(0, 5).toString('ascii')).toBe('%PDF-')
      expect(response.body.length).toBeGreaterThan(0)
      const bodySha256 = createHash('sha256').update(response.body).digest('hex')
      expect(bodySha256).toBe(response.envelope.response.bodySha256)
      const text = await extractResearchPdfText(response.body)
      expect(text.trim().length).toBeGreaterThanOrEqual(80)
      const receipt = {
        kind: 'native-real-public-pdf-pipeline-acceptance', platform: process.platform, arch: process.arch,
        productionSourceCommit: process.env.RT_REAL_PUBLIC_PDF_SOURCE ?? null,
        stockCode: selected.stockCode, publishedAt: selected.publishedAt,
        sourceDomain: 'pdf.dfcfw.com', finalDomain: new URL(response.envelope.response.finalUrl).hostname,
        networkPolicyVersion: response.envelope.version, productionNetworkLimitsUnchanged: true,
        compressedLimitBytes: RESEARCH_AGENT_NETWORK_LIMITS.maxCompressedResponseBytes,
        decodedLimitBytes: RESEARCH_AGENT_NETWORK_LIMITS.maxDecodedResponseBytes,
        bodyBytes: response.body.length, rawBodySha256: bodySha256, extractedTextLength: text.length,
        extractedTextSha256: createHash('sha256').update(text, 'utf8').digest('hex'),
        parserPageLimit: 24, reportBodyMocked: false, searchProviderUsed: false, modelCalls: 0,
        actualPackagedUiVerified: false, completeResearchWorkflowVerified: false,
        reportBodyUploaded: false, reportTextUploaded: false, productionUserDataTouched: false, brokerOrdersSubmitted: false,
      }
      mkdirSync(root, { recursive: true })
      writeFileSync(join(root, 'native-real-public-pdf-receipt.json'), JSON.stringify(receipt, null, 2))
      console.log(JSON.stringify(receipt))
    } finally { db.close() }
  }, 120_000)
})
