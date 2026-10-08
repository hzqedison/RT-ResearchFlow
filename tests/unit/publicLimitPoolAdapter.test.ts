import { describe, expect, it, vi } from 'vitest'
import { fetchPublicLimitUpPool, normalizePublicLimitUpPool } from '../../electron/main/services/publicLimitPoolAdapter'
import { callPythonDataSource } from '../../electron/main/services/pythonDataSourceBridge'

vi.mock('electron', () => ({ app: { getPath: () => 'ISOLATED_UNUSED_DATA_ROOT' } }))
vi.mock('../../electron/main/services/pythonDataSourceBridge', () => ({ callPythonDataSource: vi.fn() }))

function completeRow() {
  return {
    '代码': '000001', '名称': '虚构样本', '最新价': 11.25, '涨跌幅': 10.02,
    '成交额': 1000000, '流通市值': 50000000, '总市值': 70000000,
    '换手率': 2.5, '封板资金': 2200000,
    '首次封板时间': '092501', '最后封板时间': '14:52:30',
    '炸板次数': 0, '涨停统计': '2/2', '连板数': 2, '所属行业': '测试行业',
  }
}

describe('public limit-up pool normalization', () => {
  it('preserves the source currency unit and actual seal evidence', () => {
    const result = normalizePublicLimitUpPool('20261008', [completeRow()])
    expect(result.state).toBe('available')
    expect(result.rejectedRows).toBe(0)
    expect(result).toMatchObject({ dateBasis: 'request-only', verifiedAt: null, rowmissingFields: { '000001.SZ': [] } })
    expect(result.rows[0]).toMatchObject({
      tsCode: '000001.SZ', tradeDate: '20261008', close: 11.25,
      fdAmountYuan: 2200000, amountYuan: 1000000,
      firstTime: '09:25:01', lastTime: '14:52:30',
      openTimes: 0, limitTimes: 2, source: 'akshare_eastmoney',
    })
  })

  it('marks missing evidence unknown instead of inventing a zero', () => {
    const row = completeRow() as Record<string, unknown>
    delete row['封板资金']
    delete row['炸板次数']
    const result = normalizePublicLimitUpPool('20261008', [row])
    expect(result.state).toBe('partial')
    expect(result.rows[0].fdAmountYuan).toBeNull()
    expect(result.rows[0].openTimes).toBeNull()
    expect(result.missingFields).toEqual(['fdAmountYuan', 'openTimes'])
  })

  it('rejects malformed and duplicate stocks without silently counting them twice', () => {
    const invalid = { ...completeRow(), '代码': 'bad-code' }
    const result = normalizePublicLimitUpPool('20261008', [completeRow(), completeRow(), invalid])
    expect(result.state).toBe('partial')
    expect(result.rows).toHaveLength(1)
    expect(result.rejectedRows).toBe(2)
  })

  it('does not turn an empty or malformed response into a valid trading day', () => {
    expect(normalizePublicLimitUpPool('20261008', []).state).toBe('unavailable')
    expect(() => normalizePublicLimitUpPool('2026-10-08', [])).toThrow('INVALID_TRADE_DATE')
    expect(() => normalizePublicLimitUpPool('20261008', {})).toThrow('INVALID_LIMIT_POOL_RESPONSE')
  })

  const invalidNumbers: unknown[] = [true, false, [], [0], [11.25], {}, { valueOf: () => 11.25 }, '', ' ', '\t\n', null, undefined, NaN, Infinity, -Infinity, 'NaN', 'Infinity', '0x10', '1,000', 'bad']

  it.each(invalidNumbers.map((value, index) => ({ value, index })))('rejects invalid required close #$index', ({ value }) => {
    const result = normalizePublicLimitUpPool('20261008', [{ ...completeRow(), '最新价': value }])
    expect(result.rows).toEqual([])
    expect(result.rejectedRows).toBe(1)
    expect(result.state).toBe('unavailable')
  })

  it.each(invalidNumbers.map((value, index) => ({ value, index })))('keeps invalid optional numbers null with row evidence #$index', ({ value }) => {
    const row = { ...completeRow(), '涨跌幅': value, '成交额': value, '流通市值': value,
      '总市值': value, '换手率': value, '封板资金': value, '炸板次数': value, '连板数': value }
    const result = normalizePublicLimitUpPool('20261008', [row])
    const missing = ['amountYuan', 'fdAmountYuan', 'floatMvYuan', 'limitTimes', 'openTimes', 'pctChg', 'totalMvYuan', 'turnoverRatio']
    expect(result.state).toBe('partial')
    expect(result.missingFields).toEqual(missing)
    expect(result.rows[0].missingFields).toEqual(missing)
    for (const field of missing) expect(result.rows[0][field as keyof typeof result.rows[0]]).toBeNull()
    expect(result.rowmissingFields?.['000001.SZ']).toEqual(['pctChg', 'fdAmountYuan', 'openTimes', 'limitTimes'])
  })

  it('accepts decimal numeric strings and preserves lawful yuan zeros', () => {
    const result = normalizePublicLimitUpPool('20261008', [{ ...completeRow(), '最新价': ' 11.25 ',
      '涨跌幅': '+1.002e1', '成交额': '0', '流通市值': 0, '总市值': '0.0', '封板资金': 0,
      '换手率': '.5', '炸板次数': '0', '连板数': '1' }])
    expect(result.state).toBe('available')
    expect(result.rows[0]).toMatchObject({ close: 11.25, pctChg: 10.02, amountYuan: 0,
      floatMvYuan: 0, totalMvYuan: 0, fdAmountYuan: 0, turnoverRatio: 0.5, openTimes: 0, limitTimes: 1 })
  })

  it.each([0, -1, '-1'])('rejects nonpositive close %s', close => {
    expect(normalizePublicLimitUpPool('20261008', [{ ...completeRow(), '最新价': close }]).rejectedRows).toBe(1)
  })

  it.each([-1, -0.5, 1.5, '2.5'])('rejects noninteger or negative openTimes %s', value => {
    const row = normalizePublicLimitUpPool('20261008', [{ ...completeRow(), '炸板次数': value }]).rows[0]
    expect(row.openTimes).toBeNull()
    expect(row.missingFields).toEqual(['openTimes'])
  })

  it.each([0, -1, 1.5, '0', '2.5'])('rejects nonpositive or fractional limitTimes %s', value => {
    const row = normalizePublicLimitUpPool('20261008', [{ ...completeRow(), '连板数': value }]).rows[0]
    expect(row.limitTimes).toBeNull()
    expect(row.missingFields).toEqual(['limitTimes'])
  })

  it('marks negative optional amounts unknown without changing other rows', () => {
    const result = normalizePublicLimitUpPool('20261008', [completeRow(), { ...completeRow(), '代码': '000002',
      '成交额': -1, '流通市值': -1, '总市值': -1, '封板资金': -1, '换手率': -1 }])
    expect(result.state).toBe('partial')
    expect(result.rows[0]).toMatchObject({ quality: 'available', missingFields: [] })
    expect(result.rows[1]).toMatchObject({ quality: 'partial', missingFields: ['amountYuan', 'fdAmountYuan', 'floatMvYuan', 'totalMvYuan', 'turnoverRatio'] })
  })

  it.each(['20260229', '20260431', '20261301', '20260010', '20261000', '20261032', '00000101', '2026-10-08'])('rejects impossible date %s before requesting data', async date => {
    vi.mocked(callPythonDataSource).mockClear()
    expect(() => normalizePublicLimitUpPool(date, [])).toThrow('INVALID_TRADE_DATE')
    await expect(fetchPublicLimitUpPool({ dailyProviders: ['akshare'], reportProviders: [], wencaiEnabled: false, pythonPath: '' }, date)).rejects.toThrow('INVALID_TRADE_DATE')
    expect(callPythonDataSource).not.toHaveBeenCalled()
  })

  it.each(['20240229', '20000229', '20261008'])('accepts actual Gregorian date %s without claiming source provenance', date => {
    expect(normalizePublicLimitUpPool(date, [completeRow()]).dateBasis).toBe('request-only')
  })

  it('reuses market code rules including Beijing and normalized duplicate suffixes', () => {
    const result = normalizePublicLimitUpPool('20261008', ['600001', '300001', '920001', '430001', ' 000001.sz ', '000001', '100001', '200001', '500001', '700001', true, ['000003']]
      .map(code => ({ ...completeRow(), '代码': code })))
    expect(result.rows.map(row => row.tsCode)).toEqual(['600001.SH', '300001.SZ', '920001.BJ', '430001.BJ', '000001.SZ'])
    expect(result.rejectedRows).toBe(7)
    expect(result.rows.every(row => row.quality === 'available')).toBe(true)
    expect(result.state).toBe('partial')
  })

  it.each(['000001.SH', '000001.bj', '600001.SZ', '600001.bj', '920001.SH', '920001.sz', '430001.SZ', '300001.SH'])('rejects explicit market suffix conflicts instead of rewriting %s', code => {
    const result = normalizePublicLimitUpPool('20261008', [{ ...completeRow(), '代码': code }])
    expect(result.rows).toEqual([])
    expect(result.rejectedRows).toBe(1)
    expect(result.state).toBe('unavailable')
  })

  it('keeps legitimate mixed-case suffixes and rejects canonical duplicates across suffix forms', () => {
    const result = normalizePublicLimitUpPool('20261008', ['000001', '000001.sZ', ' 600001.sh ', '600001',
      '920001.bj', '920001', '430001.bj', '430001'].map(code => ({ ...completeRow(), '代码': code })))
    expect(result.rows.map(row => row.tsCode)).toEqual(['000001.SZ', '600001.SH', '920001.BJ', '430001.BJ'])
    expect(result.rejectedRows).toBe(4)
    expect(result.state).toBe('partial')
    expect(result.rows.every(row => row.quality === 'available')).toBe(true)
  })

  it.each([true, [], ['092501'], {}, '24:00:00', '09:60:00', '09:25:60', '09::25:01', ' '])('rejects malformed optional seal time %j', value => {
    const result = normalizePublicLimitUpPool('20261008', [{ ...completeRow(), '首次封板时间': value }])
    expect(result.rows[0].firstTime).toBeNull()
    expect(result.rows[0].missingFields).toEqual(['firstTime'])
  })
})
