import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SupportFeedbackPanel } from '../../src/components/Diagnostics/SupportFeedbackPanel'

afterEach(() => vi.unstubAllGlobals())

describe('support feedback initial interface', () => {
  it('shows the content scope and safe actions even without health or database facts', () => {
    vi.stubGlobal('React', React)
    const html = renderToStaticMarkup(React.createElement(SupportFeedbackPanel))
    expect(html).toContain('生成反馈预览')
    expect(html).toContain('保存反馈文件')
    expect(html).toContain('不会自动上传')
    expect(html).toContain('密钥、账户、资金、持仓')
    expect(html).toContain('构建标识 unknown')
    expect(html).toMatch(/data-testid="support-save-file"[^>]*disabled/)
    expect(html).not.toContain('C:\\')
  })
})
