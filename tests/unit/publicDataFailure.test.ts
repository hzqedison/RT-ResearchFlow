import { describe, expect, it } from 'vitest'
import { describePublicDataFailure } from '../../electron/main/utils/publicDataFailure'

describe('bounded public data failure descriptions', () => {
  it.each([
    ['UND_ERR_SOCKET', '连接中断'], ['ECONNRESET', '连接中断'], ['ENOTFOUND', '域名解析失败'],
    ['EAI_AGAIN', '域名解析失败'], ['ETIMEDOUT', '超时'], ['UND_ERR_HEADERS_TIMEOUT', '超时'],
    ['ECONNREFUSED', '无法建立'], ['CERT_HAS_EXPIRED', '安全连接验证失败'],
    ['PUBLIC_PROVIDER_COOLDOWN', '正在冷却'],
  ])('describes %s without copying the upstream error', (code, expected) => {
    const result = describePublicDataFailure({ message: 'Token=PRIVATE_SECRET Cookie=PRIVATE_COOKIE C:/Users/private', cause: { code } })
    expect(result).toContain(expected)
    expect(result).not.toMatch(/PRIVATE|Cookie|C:\//)
  })
  it.each([[401, '未接受授权'], [403, '拒绝访问'], [429, '限流'], [503, '服务暂时异常'], [404, '异常 HTTP']])(
    'preserves only the numeric HTTP %s status', (status, expected) => {
      const result = describePublicDataFailure(undefined, status as number)
      expect(result).toContain(expected as string)
      expect(result).toContain('HTTP ' + status)
      expect(describePublicDataFailure(new Error(result))).toBe(result)
    })
  it('retains missing-credential and empty-data explanations as fixed local messages', () => {
    expect(describePublicDataFailure(new Error('Tushare 未配置 Token 或未启用'))).toContain('绑定并验证')
    expect(describePublicDataFailure(new Error('未返回新的有效行情'))).toContain('有效已收盘日线')
    expect(describePublicDataFailure(new Error('Tushare 未配置 Token 或未启用 SECRET'))).toContain('原因尚未确定')
  })
  it('distinguishes cancellation, timeout and malformed responses', () => {
    expect(describePublicDataFailure({ name: 'AbortError' })).toContain('已取消')
    expect(describePublicDataFailure({ name: 'TimeoutError' })).toContain('超时')
    expect(describePublicDataFailure(new SyntaxError('SECRET'))).toContain('解析')
  })
  it('bounds cycles, unknown codes, getters and oversized messages', () => {
    const cycle: { cause?: unknown; message: string } = { message: 'SECRET' }; cycle.cause = cycle
    for (const value of [cycle, null, 'SECRET', { code: '__proto__', message: 'SECRET' }, { message: 'SECRET'.repeat(1_000) },
      Object.defineProperty({}, 'code', { get() { throw new Error('SECRET') } })]) {
      expect(describePublicDataFailure(value)).toContain('原因尚未确定')
      expect(describePublicDataFailure(value)).not.toContain('SECRET')
    }
    expect(describePublicDataFailure({ status: 1_000, message: 'SECRET' })).toContain('原因尚未确定')
  })
})
