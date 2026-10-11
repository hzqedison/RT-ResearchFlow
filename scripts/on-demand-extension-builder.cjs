'use strict'
const fs = require('node:fs')
const path = require('node:path')

function withOnDemandExtensions(base) {
  return {
    ...base,
    extraResources: [...(base.extraResources || []), {
      from: path.join(__dirname, '../resources/data-extension-delivery.json'),
      to: 'data-extension-delivery.json',
    }],
    async afterPack(context) {
      if (base.afterPack) await base.afterPack(context)
      const resources = context.electronPlatformName === 'darwin'
        ? path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app', 'Contents/Resources')
        : path.join(context.appOutDir, 'resources')
      const raw = fs.readFileSync(path.join(resources, 'data-extension-delivery.json'), 'utf8')
      const marker = JSON.parse(raw)
      if (marker.schemaVersion !== 1 || marker.mode !== 'on-demand') throw Error('PUBLIC_EXTENSION_DESCRIPTOR_INVALID')
      if (fs.existsSync(path.join(resources, 'private-python-runtime'))) throw Error('PUBLIC_PACKAGE_CONTAINS_PRIVATE_RUNTIME')
    },
  }
}
module.exports = { withOnDemandExtensions }
