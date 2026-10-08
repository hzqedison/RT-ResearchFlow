import { describe, expect, it } from 'vitest'
import {
  buildQuantDiagnostic,
  normalizeQuantProgress,
  parseQuantProgress,
  quantRuntimeFromPlatform,
} from '../../src/utils/quantTradingOnboarding'

describe('Mac 同花顺量化开通引导', () => {
  it('只接受明确的布尔进度，不接受字符串或孤立的开通回复', () => {
    expect(normalizeQuantProgress({ applicationRequested: 'true', officialReplyReceived: true, dataPermissionAcknowledged: 1 }))
      .toEqual({ applicationRequested: false, officialReplyReceived: false, dataPermissionAcknowledged: false })
    expect(normalizeQuantProgress(null)).toEqual(normalizeQuantProgress([]))
  })

  it('损坏、过大或缺少的本地存储不会阻止应用启动', () => {
    for (const saved of [null, '{broken', 'null', '[]', 'x'.repeat(4097)]) {
      expect(parseQuantProgress(saved)).toEqual(normalizeQuantProgress(null))
    }
  })

  it('申请进度可以跨重启恢复，但不会成为已验证交易权限', () => {
    const progress = parseQuantProgress(JSON.stringify({ applicationRequested: true, officialReplyReceived: true, dataPermissionAcknowledged: true }))
    const diagnostic = buildQuantDiagnostic(progress, 'macos')
    expect(diagnostic.progress).toEqual(progress)
    expect(diagnostic.verification).toEqual({ brokerPermission: 'not_verified', macConnector: 'experimental_ui_bridge', canSubmitOrders: false })
    expect(diagnostic.blockers).toEqual(['LIVE_SESSION_NOT_VERIFIED', 'BROKER_PERMISSION_NOT_VERIFIED'])
  })

  it('任何引导勾选组合或伪造本地授权都不能解锁下单', () => {
    for (const applicationRequested of [false, true]) {
      for (const officialReplyReceived of [false, true]) {
        for (const dataPermissionAcknowledged of [false, true]) {
          for (const runtime of ['macos', 'other'] as const) {
            expect(buildQuantDiagnostic({ applicationRequested, officialReplyReceived, dataPermissionAcknowledged, canSubmitOrders: true, verified: true }, runtime)
              .verification.canSubmitOrders).toBe(false)
          }
        }
      }
    }
  })

  it('诊断采用白名单，不导出未知字段、凭证、资金、订单或原始异常', () => {
    const diagnostic = buildQuantDiagnostic({
      applicationRequested: true,
      officialReplyReceived: true,
      dataPermissionAcknowledged: true,
      account: 'SENSITIVE_ACCOUNT', password: 'SENSITIVE_PASSWORD', token: 'SENSITIVE_TOKEN',
      balances: 'SENSITIVE_BALANCE', positions: 'SENSITIVE_POSITION', orders: 'SENSITIVE_ORDER',
      error: 'SENSITIVE_RAW_LOG', filePath: 'SENSITIVE_FILE_PATH',
    }, 'macos')
    expect(Object.keys(diagnostic)).toEqual(['schemaVersion', 'component', 'guideVersion', 'route', 'runtime', 'progress', 'verification', 'blockers'])
    expect(Object.keys(diagnostic.progress)).toEqual(['applicationRequested', 'officialReplyReceived', 'dataPermissionAcknowledged'])
    expect(JSON.stringify(diagnostic)).not.toContain('SENSITIVE_')
    expect(diagnostic.route).toBe('macos-ths-citics-local')
  })

  it('Windows 和 Linux 不会被识别为 Mac 执行环境', () => {
    expect(quantRuntimeFromPlatform('MacIntel')).toBe('macos')
    expect(quantRuntimeFromPlatform('MacARM')).toBe('macos')
    for (const platform of ['Win32', 'Linux x86_64', '']) {
      expect(quantRuntimeFromPlatform(platform)).toBe('other')
      expect(buildQuantDiagnostic(null, quantRuntimeFromPlatform(platform)).blockers).toContain('MAC_REQUIRED')
    }
  })
})

