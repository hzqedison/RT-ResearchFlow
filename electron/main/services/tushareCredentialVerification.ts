export type TushareVerificationState = 'verified' | 'permission-limited' | 'auth-failed' | 'network-error' | 'invalid-response' | 'unbound'

export interface TushareVerification {
  valid: boolean
  state: TushareVerificationState
  checkedAt: number
  checkedApi: 'trade_cal'
  message: string
}

/** Only a returned calendar fact counts as verification; upstream text is never echoed. */
export async function verifyTushareCredential(token: unknown, fetcher: typeof fetch = fetch): Promise<TushareVerification> {
  const result = (state: TushareVerificationState, message: string): TushareVerification => ({
    valid: state === 'verified', state, checkedAt: Date.now(), checkedApi: 'trade_cal', message,
  })
  if (typeof token !== 'string' || !token.trim() || token.trim().length > 512 || /\s/.test(token.trim())) {
    return result('unbound', '请输入有效的 Tushare Token；它不是大模型 API Key。')
  }
  try {
    const response = await fetcher('https://api.tushare.pro', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_name: 'trade_cal', token: token.trim(),
        params: { exchange: 'SSE', start_date: '20240101', end_date: '20240101' }, fields: 'cal_date' }),
    })
    if (!response.ok) return result('network-error', 'Tushare 服务暂不可用，请检查网络后重试；原绑定不会被清除。')
    const reader = response.body?.getReader()
    if (!reader) return result('invalid-response', '服务没有返回可验证的数据。')
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const item = await reader.read()
      if (item.done) break
      size += item.value.byteLength
      if (size > 65536) { await reader.cancel(); return result('invalid-response', '服务返回格式异常，请稍后重试。') }
      chunks.push(item.value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (json.code === 2002) return result('permission-limited', '交易日历接口权限受限。请在 Tushare 账户核对积分、接口权限和调用频率；这不等同于 Key 无效。')
    if (json.code !== 0) return result('auth-failed', 'Tushare 未接受本次请求。请核对 Token、账户状态和调用频率；未验证通过。')
    const fields = json.data?.fields
    const rows = json.data?.items
    const index = Array.isArray(fields) ? fields.indexOf('cal_date') : -1
    if (index < 0 || !Array.isArray(rows) || !rows.some(row => Array.isArray(row) && row[index] === '20240101')) {
      return result('invalid-response', '请求成功，但没有返回指定日期的交易日历事实，不能标记为验证通过。')
    }
    return result('verified', '交易日历接口验证通过。竞价、分钟线、筹码等接口仍需各自权限，未在本次验证中测试。')
  } catch {
    return result('network-error', '验证未完成：网络超时或响应无法解析。请重试；不展示或记录包含密钥的上游错误。')
  }
}
