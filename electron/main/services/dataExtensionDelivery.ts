import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type DataExtensionDeliveryMode = 'bundled' | 'on-demand'

// Only an explicit installer-owned descriptor permits online installation.
// Missing or invalid bundles must not silently change the distribution model.
export function dataExtensionDeliveryMode(packaged: boolean, resources: string): DataExtensionDeliveryMode {
  if (!packaged) return 'bundled'
  const descriptor = join(resources, 'data-extension-delivery.json')
  if (!existsSync(descriptor)) return 'bundled'
  try {
    const bytes = readFileSync(descriptor)
    if (bytes.length > 1024) throw Error('INVALID_DESCRIPTOR')
    const value = JSON.parse(bytes.toString('utf8'))
    if (value.schemaVersion !== 1 || value.mode !== 'on-demand' || Object.keys(value).length !== 2) throw Error('INVALID_DESCRIPTOR')
    return 'on-demand'
  } catch { throw Error('EXTENSION_DELIVERY_INVALID') }
}
