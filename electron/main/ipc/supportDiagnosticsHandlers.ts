import {
  registerTrustedIpcHandler, type TrustedWindowGetter
} from '../security/trustedIpc'
import {
  generateSupportFeedbackPreview, saveSupportFeedbackFile
} from '../services/supportDiagnosticsService'

export function registerSupportDiagnosticsHandlers(getWindow: TrustedWindowGetter): void {
  registerTrustedIpcHandler('supportDiagnostics:generatePreview', getWindow, () => generateSupportFeedbackPreview())
  registerTrustedIpcHandler('supportDiagnostics:savePreview', getWindow, (_event, previewId: unknown) => saveSupportFeedbackFile(previewId))
}
