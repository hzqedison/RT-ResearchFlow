import { app, dialog, type SaveDialogOptions, type SaveDialogReturnValue } from 'electron'
import { randomUUID } from 'node:crypto'
import * as files from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  createPublicOperationError, createSupportDiagnosticPackage, isValidCorrelationId,
  SUPPORT_DIAGNOSTIC_LIMITS, SUPPORT_MODULES, SUPPORT_PREVIEW_TTL_MS,
  type PublicOperationError, type SupportDiagnosticPreview, type SupportErrorCode,
  type SupportErrorEvent, type SupportFeedbackResult, type SupportFeedbackSaveOutcome,
  type SupportModule
} from '../../shared/supportDiagnostics'

export interface SupportDiagnosticsDependencies {
  readonly app: { getVersion(): string; getPath(name: 'userData'): string }
  readonly platform: string
  readonly arch: string
  readonly now: () => number
  readonly showSaveDialog: (options: SaveDialogOptions) => Promise<SaveDialogReturnValue>
  readonly files: Pick<typeof files, 'open' | 'rename' | 'unlink'>
}

/** No configuration, database, accounts, raw errors or renderer paths enter this service. */
export function createSupportDiagnosticsService(dependencies: SupportDiagnosticsDependencies) {
  const events: SupportErrorEvent[] = []
  let preview: SupportDiagnosticPreview | null = null
  let saving = false

  function recordSupportFailure(code: SupportErrorCode, module: SupportModule): PublicOperationError {
    const error = createPublicOperationError(code, randomUUID())
    const safeModule = typeof module === 'string' && SUPPORT_MODULES.includes(module) ? module : 'runtime'
    events.push(Object.freeze({
      code: error.code, id: error.correlationId,
      timestamp: new Date(dependencies.now()).toISOString(), module: safeModule
    }))
    if (events.length > SUPPORT_DIAGNOSTIC_LIMITS.errorEvents) events.shift()
    return error
  }

  function failure<T>(
    status: 'expired' | 'busy' | 'invalid' | 'failed',
    code: SupportErrorCode = 'INVALID_INPUT'
  ): SupportFeedbackResult<T> {
    return Object.freeze({ ok: false, status, error: recordSupportFailure(code, 'runtime') })
  }

  function generatePreview(): SupportFeedbackResult<SupportDiagnosticPreview> {
    if (saving) return failure('busy')
    // Invalidate the previous identifier even when generation fails.
    preview = null
    try {
      const id = randomUUID()
      const result = createSupportDiagnosticPackage({
        app: { version: dependencies.app.getVersion(), buildId: 'unknown' },
        platform: dependencies.platform, arch: dependencies.arch,
        errorEvents: events, capabilities: []
      }, id)
      if (!result.ok) return failure('failed', 'INTERNAL_ERROR')
      preview = Object.freeze({
        previewId: id, expiresAt: dependencies.now() + SUPPORT_PREVIEW_TTL_MS,
        package: result.value, json: JSON.stringify(result.value, null, 2)
      })
      return Object.freeze({ ok: true, value: preview })
    } catch {
      return failure('failed', 'INTERNAL_ERROR')
    }
  }

  function current(id: string, snapshot: SupportDiagnosticPreview): boolean {
    return preview === snapshot && snapshot.previewId === id && dependencies.now() < snapshot.expiresAt
  }

  async function savePreview(previewId: unknown): Promise<SupportFeedbackResult<SupportFeedbackSaveOutcome>> {
    if (!isValidCorrelationId(previewId)) return failure('invalid')
    if (saving) return failure('busy')
    const snapshot = preview
    if (!snapshot || !current(previewId, snapshot)) return failure('expired')
    saving = true
    let temporaryPath: string | null = null
    let ownedTemporary = false
    try {
      const choice = await dependencies.showSaveDialog({
        title: '保存反馈文件',
        defaultPath: join(dependencies.app.getPath('userData'), 'RT-ResearchFlow-feedback.json'),
        filters: [{ name: '反馈文件 JSON', extensions: ['json'] }],
        properties: ['showOverwriteConfirmation']
      })
      if (choice.canceled) {
        return Object.freeze({ ok: true, value: Object.freeze({
          status: 'cancelled', message: '已取消保存，反馈文件未写入。'
        }) })
      }
      // A dialog can remain open beyond the preview lifetime.
      if (!current(previewId, snapshot)) return failure('expired')
      if (!choice.filePath) return failure('failed', 'INTERNAL_ERROR')
      // Same-directory rename commits only after all bytes have been flushed and closed.
      temporaryPath = join(dirname(choice.filePath), '.' + basename(choice.filePath) + '.' + randomUUID() + '.tmp')
      const handle = await dependencies.files.open(temporaryPath, 'wx', 0o600)
      ownedTemporary = true
      try {
        await handle.writeFile(snapshot.json, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      if (!current(previewId, snapshot)) return failure('expired')
      await dependencies.files.rename(temporaryPath, choice.filePath)
      ownedTemporary = false
      return Object.freeze({ ok: true, value: Object.freeze({
        status: 'saved', message: '反馈文件已保存，内容与本次预览完全一致。'
      }) })
    } catch {
      return failure('failed', 'INTERNAL_ERROR')
    } finally {
      if (ownedTemporary && temporaryPath) {
        try { await dependencies.files.unlink(temporaryPath) } catch { /* Only this operation's temporary file is eligible for cleanup. */ }
      }
      saving = false
    }
  }

  return Object.freeze({ recordSupportFailure, generatePreview, savePreview })
}

const service = createSupportDiagnosticsService({
  app, platform: process.platform, arch: process.arch, now: Date.now,
  showSaveDialog: options => dialog.showSaveDialog(options),
  files
})

export const recordSupportFailure = service.recordSupportFailure
export const generateSupportFeedbackPreview = service.generatePreview
export const saveSupportFeedbackFile = service.savePreview
