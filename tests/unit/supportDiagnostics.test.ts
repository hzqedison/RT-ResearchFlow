import { describe, expect, it } from 'vitest'
import {
  createPublicOperationError, createSupportDiagnosticPackage, isValidCorrelationId,
  SUPPORT_ERROR_CODES, SUPPORT_DIAGNOSTIC_LIMITS,
  type SupportErrorCode
} from '../../electron/shared/supportDiagnostics'

const id = '5932b684-7ee4-4c98-a05d-405ccd0e1104'
const time = '2026-10-08T00:45:51.000Z'
const event = () => ({ code: 'DATA_MISSING', id, timestamp: time, module: 'data' })
const capability = () => ({
  provider: 'tushare', feature: 'trading-calendar', support: 'requires-setup',
  availability: 'unavailable', observedAt: time, asOf: null as string | null
})
const valid = () => ({
  app: { version: '1.0.0-beta.9', buildId: '41f8429149f646c7dec7f1610082702e7d9cce48' },
  platform: 'darwin', arch: 'arm64', errorEvents: [event()], capabilities: [capability()]
})

describe('public operation errors', () => {
  it('defines stable, immutable public errors for every supported code', () => {
    for (const code of SUPPORT_ERROR_CODES) {
      const result = createPublicOperationError(code, id)
      expect(result.code).toBe(code)
      expect(result.correlationId).toBe(id)
      expect(result.message.length).toBeGreaterThan(0)
      expect(result.action.length).toBeGreaterThan(0)
      expect(result.message).toMatch(/[\u4e00-\u9fff]/)
      expect(result.action).toMatch(/[\u4e00-\u9fff]/)
      expect(Object.isFrozen(result)).toBe(true)
      expect(Object.keys(result).sort()).toEqual(['action', 'code', 'correlationId', 'message', 'retryable'])
    }
  })

  it('does not read or expose raw exceptions and safely handles unknown runtime codes', () => {
    let reads = 0
    const raw = new Error('sk-secret /Users/private account balance=9000')
    Object.defineProperty(raw, 'message', { get: () => { reads++; throw new Error('secret') } })
    const error = createPublicOperationError(raw as unknown as SupportErrorCode, id)
    expect(error.code).toBe('INTERNAL_ERROR')
    expect(reads).toBe(0)
    expect(JSON.stringify(error)).not.toContain('secret')
    expect(createPublicOperationError('__proto__' as SupportErrorCode, id).code).toBe('INTERNAL_ERROR')
  })

  it('never proposes retrying an unknown trade submission', () => {
    const error = createPublicOperationError('TRADE_RESULT_UNKNOWN', id)
    expect(error.retryable).toBe(false)
    expect(error.action).toContain('查询委托')
    expect(error.action).toContain('核对账户记录')
    expect(error.action).toContain('不要重复提交')
  })

  it.each(['', 'x'.repeat(100000), 'https://a.test/?key=secret', 'C:\\Users\\secret', '5932b684-7ee4-1c98-a05d-405ccd0e1104', undefined, {}, null])(
    'rejects unsafe or missing correlation identifiers: %s', input => {
      expect(isValidCorrelationId(input)).toBe(false)
      expect(() => createPublicOperationError('INVALID_INPUT', input as string)).toThrow(TypeError)
    }
  )

  it('accepts uppercase UUID v4 without adding a generator dependency', () => {
    expect(isValidCorrelationId(id.toUpperCase())).toBe(true)
  })
})

describe('allowlisted diagnostic package', () => {
  it('allows only the explicit unknown build identifier when no build fact is embedded', () => {
    const base = valid()
    expect(createSupportDiagnosticPackage({ ...base, app: { ...base.app, buildId: 'unknown' } }, id).ok).toBe(true)
    for (const buildId of ['UNKNOWN', 'unknown-sha', '', 'unknown/path', 'sk-secret']) {
      expect(createSupportDiagnosticPackage({ ...base, app: { ...base.app, buildId } }, id).ok).toBe(false)
    }
  })

  it('retains valid facts with schema version 1 and reconstructs immutable records', () => {
    const input = valid()
    const result = createSupportDiagnosticPackage(input, id)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected valid package')
    expect(result.value).toEqual({ schemaVersion: 1, ...input })
    expect(result.value.app).not.toBe(input.app)
    expect(result.value.errorEvents[0]).not.toBe(input.errorEvents[0])
    expect(Object.isFrozen(result.value)).toBe(true)
    expect(Object.isFrozen(result.value.app)).toBe(true)
    expect(Object.isFrozen(result.value.errorEvents)).toBe(true)
    input.app.version = '9.0.0'
    expect(result.value.app.version).toBe('1.0.0-beta.9')
  })

  it('omits nested secrets, funds, holdings, paths, query URLs and every unknown field', () => {
    const secrets = {
      apiKey: 'sk-hidden-key', funds: 123456.78, holdings: [{ account: 'broker-secret' }],
      path: 'C:\\Users\\Alice\\private.sqlite', url: 'https://host.test/?token=hidden',
      nested: { credentials: { password: 'nested-secret' } }
    }
    const base = valid()
    const input = {
      ...base, ...secrets, schemaVersion: 999, description: 'free-user-text',
      app: { ...base.app, ...secrets },
      errorEvents: [{ ...event(), ...secrets, message: 'raw-exception-secret', stack: 'private-stack' }],
      capabilities: [{ ...capability(), ...secrets, status: 'ready' }]
    }
    const result = createSupportDiagnosticPackage(input, id)
    expect(result).toEqual({ ok: true, value: { schemaVersion: 1, ...base } })
    const serialized = JSON.stringify(result)
    for (const forbidden of ['sk-hidden', '123456.78', 'broker-secret', 'Alice', 'token=', 'nested-secret', 'raw-exception', 'private-stack', 'free-user-text']) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('does not invoke unknown getters, toJSON, or getters on allowed fields', () => {
    let reads = 0
    const input = valid()
    Object.defineProperty(input, 'apiKey', { get: () => { reads++; throw new Error('secret') } })
    Object.defineProperty(input.app, 'toJSON', { get: () => { reads++; throw new Error('secret') } })
    expect(createSupportDiagnosticPackage(input, id).ok).toBe(true)
    Object.defineProperty(input.app, 'version', { get: () => { reads++; return '1.0.0' } })
    expect(createSupportDiagnosticPackage(input, id).ok).toBe(false)
    expect(reads).toBe(0)
  })

  it('does not invoke nested event, capability or array index getters', () => {
    let reads = 0
    for (const target of ['event', 'capability', 'index', 'support', 'availability', 'observedAt', 'asOf']) {
      const input = valid()
      const object = target === 'event' ? input.errorEvents[0] : target === 'index' ? input.errorEvents : input.capabilities[0]
      const key = target === 'event' ? 'timestamp' : target === 'capability' ? 'provider' : target === 'index' ? '0' : target
      Object.defineProperty(object, key, { get: () => { reads++; throw new Error('secret') } })
      expect(createSupportDiagnosticPackage(input, id).ok).toBe(false)
    }
    expect(reads).toBe(0)
  })

  it('ignores unknown cycles and rejects cycles in allowlisted structures without crashing', () => {
    const input = valid() as ReturnType<typeof valid> & { unknown?: unknown }
    input.unknown = input
    expect(createSupportDiagnosticPackage(input, id).ok).toBe(true)
    const cycle: Record<string, unknown> = { ...valid() }
    cycle.app = cycle
    expect(createSupportDiagnosticPackage(cycle, id).ok).toBe(false)
    cycle.app = valid().app
    cycle.errorEvents = [cycle]
    expect(createSupportDiagnosticPackage(cycle, id).ok).toBe(false)
  })

  it('rejects oversized lists before accessing any element', () => {
    let reads = 0
    for (const key of ['errorEvents', 'capabilities'] as const) {
      const list = new Array(1000000)
      Object.defineProperty(list, '0', { get: () => { reads++; throw new Error('secret') } })
      const result = createSupportDiagnosticPackage({ ...valid(), [key]: list }, id)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT')
    }
    expect(reads).toBe(0)
  })

  it('accepts the documented exact list limits and empty lists', () => {
    expect(createSupportDiagnosticPackage({
      ...valid(), errorEvents: Array.from({ length: SUPPORT_DIAGNOSTIC_LIMITS.errorEvents }, event),
      capabilities: Array.from({ length: SUPPORT_DIAGNOSTIC_LIMITS.capabilities }, capability)
    }, id).ok).toBe(true)
    expect(createSupportDiagnosticPackage({ ...valid(), errorEvents: [], capabilities: [] }, id).ok).toBe(true)
  })

  it.each(['2026-02-30T00:00:00.000Z', '2026-13-08T00:45:51.000Z', '2026-10-08T24:00:00.000Z',
    '2026-10-08T00:45:60.000Z', '2026-10-08', '2026-10-08T08:45:51+08:00', 'not-a-time', 'x'.repeat(100000)])(
    'rejects invalid or noncanonical timestamps in events and capabilities: %s', badTime => {
      expect(createSupportDiagnosticPackage({ ...valid(), errorEvents: [{ ...event(), timestamp: badTime }] }, id).ok).toBe(false)
      expect(createSupportDiagnosticPackage({ ...valid(), capabilities: [{ ...capability(), asOf: badTime }] }, id).ok).toBe(false)
      expect(createSupportDiagnosticPackage({ ...valid(), capabilities: [{ ...capability(), observedAt: badTime }] }, id).ok).toBe(false)
    }
  )

  it('accepts real leap days and UTC timestamps with or without milliseconds', () => {
    for (const timestamp of ['2024-02-29T00:00:00.000Z', '2026-10-08T00:45:51Z']) {
      expect(createSupportDiagnosticPackage({ ...valid(), errorEvents: [{ ...event(), timestamp }] }, id).ok).toBe(true)
    }
  })

  it('rejects arbitrary text hidden in every formatted or enumerated field', () => {
    const cases = [
      { ...valid(), app: { ...valid().app, version: '1.0.0-secret' } },
      { ...valid(), app: { ...valid().app, buildId: 'https://host/?key=secret' } },
      { ...valid(), app: { ...valid().app, version: 'x'.repeat(100000) } },
      { ...valid(), app: { ...valid().app, buildId: 'a'.repeat(100000) } },
      { ...valid(), platform: 'Alice-Mac' }, { ...valid(), arch: 'private-machine' },
      ...['code', 'id', 'module'].map(key => ({ ...valid(), errorEvents: [{ ...event(), [key]: 'private-secret' }] })),
      ...['provider', 'feature', 'support', 'availability'].map(key => ({ ...valid(), capabilities: [{ ...capability(), [key]: 'private-secret' }] }))
    ]
    for (const input of cases) {
      const result = createSupportDiagnosticPackage(input, id)
      expect(result.ok).toBe(false)
      expect(JSON.stringify(result)).not.toContain('private-secret')
    }
  })

  it('requires plain objects and dense ordinary arrays, accepting null-prototype records', () => {
    for (const input of [null, undefined, [], new Date(), new Error('secret'), Object.create(valid())]) {
      expect(createSupportDiagnosticPackage(input, id).ok).toBe(false)
    }
    const input = valid()
    const record = Object.assign(Object.create(null), input)
    expect(createSupportDiagnosticPackage(record, id).ok).toBe(true)
    expect(createSupportDiagnosticPackage({ ...input, errorEvents: new Array(1) }, id).ok).toBe(false)
    expect(createSupportDiagnosticPackage({ ...input, capabilities: {} }, id).ok).toBe(false)
  })

  it('contains throwing or revoked proxy failures without exposing exception text', () => {
    const proxy = new Proxy({}, { getPrototypeOf: () => { throw new Error('private-path-secret') } })
    const revoked = Proxy.revocable([], {})
    revoked.revoke()
    expect(createSupportDiagnosticPackage(proxy, id).ok).toBe(false)
    const result = createSupportDiagnosticPackage({ ...valid(), errorEvents: revoked.proxy }, id)
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain('private-path-secret')
  })

  it('validates the caller identifier before inspecting the input', () => {
    let inspected = false
    const input = new Proxy({}, { getPrototypeOf: () => { inspected = true; return Object.prototype } })
    expect(() => createSupportDiagnosticPackage(input, 'unsafe')).toThrow(TypeError)
    expect(inspected).toBe(false)
  })

  it.each([
    { scenario: 'supported source unavailable after a network failure', support: 'supported', availability: 'unavailable', asOf: time },
    { scenario: 'capability not yet authorized', support: 'requires-setup', availability: 'unavailable', asOf: null },
    { scenario: 'supported source with no observed data facts', support: 'supported', availability: 'unknown', asOf: null }
  ])('preserves separate facts for $scenario', ({ support, availability, asOf }) => {
    const fact = { ...capability(), support, availability, observedAt: time, asOf }
    const result = createSupportDiagnosticPackage({ ...valid(), capabilities: [fact] }, id)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected valid capability facts')
    expect(result.value.capabilities).toEqual([fact])
    expect(result.value.capabilities[0]).not.toHaveProperty('status')
    expect(result.value.capabilities[0].asOf).toBe(asOf)
  })

  it.each([
    ['unsupported', 'ready'], ['unsupported', 'partial'],
    ['requires-setup', 'ready'], ['requires-setup', 'partial']
  ])('rejects contradictory support=%s and availability=%s', (support, availability) => {
    const result = createSupportDiagnosticPackage({
      ...valid(), capabilities: [{ ...capability(), support, availability }]
    }, id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT')
  })

  it('requires explicit nullable asOf and observedAt, rejecting the former single-status contract', () => {
    const oldFact = { provider: 'tushare', feature: 'trading-calendar', status: 'ready', asOf: time }
    expect(createSupportDiagnosticPackage({ ...valid(), capabilities: [oldFact] }, id).ok).toBe(false)
    for (const key of ['observedAt', 'asOf']) {
      const fact: Record<string, unknown> = { ...capability() }
      delete fact[key]
      expect(createSupportDiagnosticPackage({ ...valid(), capabilities: [fact] }, id).ok).toBe(false)
      fact[key] = undefined
      expect(createSupportDiagnosticPackage({ ...valid(), capabilities: [fact] }, id).ok).toBe(false)
    }
  })

  it('keeps data cutoff distinct from inspection time without inventing or replacing timestamps', () => {
    const cutoff = '2026-09-30T07:00:00.000Z'
    const fact = { ...capability(), support: 'supported', availability: 'ready', observedAt: time, asOf: cutoff }
    const result = createSupportDiagnosticPackage({ ...valid(), capabilities: [fact] }, id)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected distinct times')
    expect(result.value.capabilities[0].observedAt).toBe(time)
    expect(result.value.capabilities[0].asOf).toBe(cutoff)
  })

  it('rejects null event and inspection timestamps while accepting a null data cutoff', () => {
    expect(createSupportDiagnosticPackage({ ...valid(), errorEvents: [{ ...event(), timestamp: null }] }, id).ok).toBe(false)
    expect(createSupportDiagnosticPackage({ ...valid(), capabilities: [{ ...capability(), observedAt: null }] }, id).ok).toBe(false)
    expect(createSupportDiagnosticPackage(valid(), id).ok).toBe(true)
  })
})
