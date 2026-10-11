import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { dataExtensionDeliveryMode } from '../../electron/main/services/dataExtensionDelivery'

const require = createRequire(import.meta.url)
const { withOnDemandExtensions } = require('../../scripts/on-demand-extension-builder.cjs')

describe('installer-owned extension delivery contract', () => {
  it('never uses a missing bundle as permission to download', () => {
    const root = mkdtempSync(join(tmpdir(), 'rt-mode-test-'))
    try { expect(dataExtensionDeliveryMode(true, root)).toBe('bundled') }
    finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('requires an explicit exact marker and fails closed on corruption', () => {
    const root = mkdtempSync(join(tmpdir(), 'rt-mode-test-'))
    try {
      writeFileSync(join(root, 'data-extension-delivery.json'), '{"schemaVersion":1,"mode":"on-demand"}')
      expect(dataExtensionDeliveryMode(true, root)).toBe('on-demand')
      expect(dataExtensionDeliveryMode(false, root)).toBe('bundled')
      writeFileSync(join(root, 'data-extension-delivery.json'), '{"schemaVersion":1,"mode":"on-demand","extra":true}')
      expect(() => dataExtensionDeliveryMode(true, root)).toThrow('EXTENSION_DELIVERY_INVALID')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('checks the actual packaged resources and rejects an accidentally included bundle', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rt-mode-test-'))
    const resources = join(root, 'resources')
    mkdirSync(resources)
    writeFileSync(join(resources, 'data-extension-delivery.json'), '{"schemaVersion":1,"mode":"on-demand"}')
    const builder = withOnDemandExtensions({ extraResources: [] })
    const context = { electronPlatformName: 'win32', appOutDir: root }
    try {
      expect(builder.extraResources.map((item: { to: string }) => item.to)).toEqual(['data-extension-delivery.json'])
      await expect(builder.afterPack(context)).resolves.toBeUndefined()
      mkdirSync(join(resources, 'private-python-runtime'))
      await expect(builder.afterPack(context)).rejects.toThrow('PUBLIC_PACKAGE_CONTAINS_PRIVATE_RUNTIME')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
