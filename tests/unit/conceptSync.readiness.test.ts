import { describe, expect, it, vi } from 'vitest'
import { syncConceptFacts, type ConceptSyncDependencies } from '../../electron/main/services/conceptMembersReadinessService'
import { offsetYmd } from '../../electron/main/services/marketSettlementPolicy'

const NOW = Date.parse('2026-10-08T10:00:00+08:00')
function dependencies(): ConceptSyncDependencies {
  const days = new Map<string, number>()
  for (let date = '20260929'; date <= '20261008'; date = offsetYmd(date, 1)) days.set(date, date >= '20261001' && date <= '20261007' ? 0 : 1)
  return {
    token: () => 'fixture-token', calendar: date => days.has(date) ? { isOpen: days.get(date)! } : undefined,
    kpl: vi.fn().mockResolvedValue([{ tsCode: '000111.KP', conCode: '600001.SH', conName: 'stock', name: 'theme', hotNum: null, desc: null, fetchedAt: NOW }]),
    dc: vi.fn().mockResolvedValue([{ tsCode: '600001.SH', tradeDate: '20260930', name: 'stock', themeCode: 'theme-1', themeName: 'theme', industryCode: null, industry: null }]),
    thsIndex: vi.fn().mockResolvedValue([{ tsCode: '885001.TI', name: 'theme', count: 1 }]),
    thsMembers: vi.fn().mockImplementation(async (_token, code) => [{ tsCode: '600001.SH', conCode: code, conName: 'stock' }]),
    writeKpl: vi.fn(), writeDc: vi.fn(), writeThs: vi.fn(), pause: vi.fn().mockResolvedValue(undefined),
  }
}
describe('current-source concept result contract', () => {
  it.each(['kpl', 'dc'])('%s chooses the known completed session across a holiday without limitList', async source => {
    const deps = dependencies(); const result = await syncConceptFacts(source, deps, NOW)
    expect(result).toMatchObject({ outcome: 'success', source, targetDate: '20260930', insertedRows: 1 })
    expect(source === 'kpl' ? deps.kpl : deps.dc).toHaveBeenCalledWith('fixture-token', '20260930')
    expect(deps.thsIndex).not.toHaveBeenCalled()
  })
  it('unknown calendar makes zero KPL requests/writes', async () => {
    const deps = dependencies(); deps.calendar = () => undefined
    expect(await syncConceptFacts('kpl', deps, NOW)).toMatchObject({ outcome: 'blocked', reasonCode: 'CALENDAR_UNAVAILABLE' })
    expect(deps.kpl).not.toHaveBeenCalled(); expect(deps.writeKpl).not.toHaveBeenCalled()
  })
  it('invalid source and missing Token never become completed success', async () => {
    const deps = dependencies()
    expect(await syncConceptFacts('other', deps, NOW)).toMatchObject({ reasonCode: 'INVALID_SOURCE' })
    deps.token = () => null
    expect(await syncConceptFacts('ths', deps, NOW)).toMatchObject({ outcome: 'blocked', reasonCode: 'TUSHARE_DISABLED' })
    expect(deps.thsIndex).not.toHaveBeenCalled()
  })
  it.each(['UPSTREAM_EMPTY', 'TUSHARE_QUOTA_INSUFFICIENT', 'TUSHARE_AUTH_FAILED', 'TUSHARE_RATE_LIMITED', 'TUSHARE_REQUEST_TIMEOUT', 'UPSTREAM_FAILED'])('KPL returns %s rather than swallowed void success', async code => {
    const deps = dependencies()
    if (code === 'UPSTREAM_EMPTY') vi.mocked(deps.kpl).mockResolvedValue([])
    else vi.mocked(deps.kpl).mockRejectedValue(new Error(code))
    expect(await syncConceptFacts('kpl', deps, NOW)).toMatchObject({ source: 'kpl', reasonCode: code, insertedRows: 0 })
    expect(deps.writeKpl).not.toHaveBeenCalled()
  })
  it('THS keeps original table on any rejected member batch', async () => {
    const deps = dependencies()
    vi.mocked(deps.thsIndex).mockResolvedValue([{ tsCode: '885001.TI', name: 'one', count: 1 }, { tsCode: '885002.TI', name: 'two', count: 1 }])
    vi.mocked(deps.thsMembers).mockImplementation(async (_token, code) => { if (code === '885002.TI') throw new Error('TUSHARE_QUOTA_INSUFFICIENT'); return [{ tsCode: '600001.SH', conCode: code, conName: null }] })
    expect(await syncConceptFacts('ths', deps, NOW)).toMatchObject({ outcome: 'partial', reasonCode: 'TUSHARE_QUOTA_INSUFFICIENT', insertedRows: 0 })
    expect(deps.writeThs).not.toHaveBeenCalled()
  })
  it('THS empty or mismatched known member count is partial and cannot replace', async () => {
    const deps = dependencies(); vi.mocked(deps.thsMembers).mockResolvedValue([])
    expect(await syncConceptFacts('ths', deps, NOW)).toMatchObject({ outcome: 'partial' }); expect(deps.writeThs).not.toHaveBeenCalled()
    vi.mocked(deps.thsMembers).mockResolvedValue([{ tsCode: '600001.SH', conCode: '885001.TI', conName: null }])
    vi.mocked(deps.thsIndex).mockResolvedValue([{ tsCode: '885001.TI', name: 'theme', count: 2 }])
    expect(await syncConceptFacts('ths', deps, NOW)).toMatchObject({ outcome: 'partial' }); expect(deps.writeThs).not.toHaveBeenCalled()
  })
  it('THS commits only after all members succeed, retaining source semantics', async () => {
    const deps = dependencies()
    expect(await syncConceptFacts('ths', deps, NOW)).toMatchObject({ outcome: 'success', source: 'ths', targetDate: null, insertedRows: 1 })
    expect(deps.writeThs).toHaveBeenCalledWith(expect.any(Array), [{ tsCode: '600001.SH', conCode: '885001.TI', conName: 'theme' }])
    expect(deps.writeKpl).not.toHaveBeenCalled(); expect(deps.writeDc).not.toHaveBeenCalled()
  })
  it('write exceptions are failures and do not claim inserted rows', async () => {
    const deps = dependencies(); vi.mocked(deps.writeThs).mockImplementation(() => { throw new Error('fixture rollback') })
    expect(await syncConceptFacts('ths', deps, NOW)).toMatchObject({ outcome: 'failed', reasonCode: 'WRITE_FAILED', insertedRows: 0 })
  })
})
