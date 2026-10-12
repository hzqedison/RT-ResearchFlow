const messages = {
  interrupted: '行情连接中断，请稍后重试或切换日线来源。',
  timeout: '行情请求超时，请稍后重试或切换日线来源。',
  dns: '行情服务器域名解析失败，请检查网络或切换来源。',
  connection: '无法建立行情连接，请检查网络或切换来源。',
  tls: '行情安全连接验证失败，请检查系统时间与网络；不要关闭证书校验。',
  cooldown: '行情来源正在冷却，请稍后再试或切换其他已选来源。',
  credential: 'Tushare 未配置 Token 或未启用；请到配置中心绑定并验证。',
  empty: '未返回有效已收盘日线，请核查交易日或切换来源。',
  cancelled: '行情请求已取消，请按需重新同步。',
  parsing: '行情响应无法按预期解析，请稍后重试或切换来源。',
  unauthorized: '行情接口未接受授权，请核查凭证与接口权限。',
  denied: '行情接口拒绝访问，请稍后再试或切换来源。',
  limited: '行情接口触发限流，请稍后再试或切换来源。',
  unavailable: '行情服务暂时异常，请稍后再试或切换来源。',
  http: '行情接口返回异常 HTTP 状态，请稍后再试或切换来源。',
  unknown: '行情取数未完成，原因尚未确定；请检查数据源状态或切换来源。',
} as const

const codeMessages = new Map<string, string>([
  ['UND_ERR_SOCKET', messages.interrupted], ['ECONNRESET', messages.interrupted],
  ['ETIMEDOUT', messages.timeout], ['UND_ERR_CONNECT_TIMEOUT', messages.timeout],
  ['UND_ERR_HEADERS_TIMEOUT', messages.timeout], ['UND_ERR_BODY_TIMEOUT', messages.timeout],
  ['ENOTFOUND', messages.dns], ['EAI_AGAIN', messages.dns],
  ['ECONNREFUSED', messages.connection], ['ENETUNREACH', messages.connection], ['EHOSTUNREACH', messages.connection],
  ['ERR_TLS_CERT_ALTNAME_INVALID', messages.tls], ['CERT_HAS_EXPIRED', messages.tls],
  ['DEPTH_ZERO_SELF_SIGNED_CERT', messages.tls], ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', messages.tls],
  ['ERR_SSL_WRONG_VERSION_NUMBER', messages.tls], ['PUBLIC_PROVIDER_COOLDOWN', messages.cooldown],
])
const legacyMessages = new Map<string, string>([
  ['Tushare 未配置 Token 或未启用', messages.credential],
  ['未返回有效已收盘日线', messages.empty], ['未返回新的有效行情', messages.empty],
])
const trustedMessages = new Set<string>(Object.values(messages))

function field(value: object, key: string): unknown {
  try { return Reflect.get(value, key) } catch { return undefined }
}

/** Only fixed local messages and bounded HTTP numbers may leave the adapter. */
export function describePublicDataFailure(error: unknown, httpStatus?: number): string {
  if (typeof httpStatus === 'number' && Number.isInteger(httpStatus) && httpStatus >= 300 && httpStatus <= 599) {
    const message = httpStatus === 401 ? messages.unauthorized : httpStatus === 403 ? messages.denied
      : httpStatus === 429 ? messages.limited : httpStatus >= 500 ? messages.unavailable : messages.http
    return message + ' (HTTP ' + httpStatus + ')'
  }
  let current = error
  let safeMessage: string | undefined
  const seen = new Set<object>()
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null && !seen.has(current); depth += 1) {
    seen.add(current)
    const code = field(current, 'code')
    if (typeof code === 'string' && codeMessages.has(code)) return codeMessages.get(code)!
    const name = field(current, 'name')
    if (name === 'TimeoutError') return messages.timeout
    if (name === 'AbortError') return messages.cancelled
    if (name === 'SyntaxError') return messages.parsing
    const status = field(current, 'status')
    if (typeof status === 'number' && Number.isInteger(status) && status >= 300 && status <= 599) {
      return describePublicDataFailure(undefined, status)
    }
    const message = field(current, 'message')
    if (!safeMessage && typeof message === 'string' && message.length <= 256) {
      if (trustedMessages.has(message)) safeMessage = message
      else if (legacyMessages.has(message)) safeMessage = legacyMessages.get(message)
      else {
        const match = /^(.*) \(HTTP (\d{3})\)$/.exec(message)
        if (match && describePublicDataFailure(undefined, Number(match[2])) === message) safeMessage = message
      }
    }
    current = field(current, 'cause')
  }
  return safeMessage ?? messages.unknown
}
