'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const helper = require('../../scripts/mac-distribution-materials.cjs')

function ownedFixture(action) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rt-mac-material-test-'))
 try { return action(root) } finally {
  const absolute=fs.realpathSync(root), parent=fs.realpathSync(os.tmpdir())
  assert.equal(path.dirname(absolute),parent); assert.ok(path.basename(absolute).startsWith('rt-mac-material-test-'))
  fs.rmSync(absolute,{recursive:true,force:true})
 }
}
function fixtureManifest() { return {kind:'mac-final-obligation-material-delivery-manifest-v1',files:helper.REQUIRED.map(name=>
 ({path:helper.SOURCE+'/'+name,size:0,sha256:'0'.repeat(64)}))} }
function copyMaterials(root,plan) { for(const row of plan.files){ const to=path.join(root,row.path);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(plan.sourceRoot,row.path),to,fs.constants.COPYFILE_EXCL) } }
function appFixture(root,arch='arm64') {
 const context={electronPlatformName:'darwin',arch,appOutDir:root,packager:{appInfo:{productFilename:'Fixture'}}}
 const resources=path.join(root,'Fixture.app','Contents','Resources'),destination=path.join(resources,helper.DESTINATION)
 const plan=helper.loadPlan();copyMaterials(destination,plan)
 fs.mkdirSync(path.join(resources,'private-python-runtime'),{recursive:true})
 fs.writeFileSync(path.join(resources,'private-python-runtime','manifest.json'),JSON.stringify({platform:'darwin',arch,
 sourceLockSha256:helper.FORMAL_LOCK_SHA256,python:{asset:{sha256:helper.PYTHON_ASSETS[arch]}}}))
 return {context,destination,resources,plan}
}
test('actual reviewed materials include all 21 required recipient files and six exact certifi sources',()=>{
 const plan=helper.loadPlan();assert.equal(plan.files.length,21)
 assert.equal(plan.files.filter(row=>row.path.startsWith('source/pip-vendored-certifi-2026.6.17/')).length,6)
 assert.ok(plan.files.some(row=>row.path.endsWith('py.typed')&&row.size===0))
 assert.ok(plan.files.some(row=>row.path==='notices/LICENSE.libX11.txt'&&row.size===47018))
})
test('actual source bytes survive an owned isolated copy',()=>ownedFixture(root=>{
 const plan=helper.loadPlan();copyMaterials(root,plan);helper.verifyCopiedMaterials(root,plan.files)
 fs.appendFileSync(path.join(root,'README.txt'),'changed')
 assert.throws(()=>helper.verifyCopiedMaterials(root,plan.files),/MAC_MATERIAL_BYTES_MISMATCH/)
}))
for(const name of ['../outside','C:/private','notices\\file','/absolute','notices/../file']){
 test('rejects unsafe material path '+name,()=>assert.throws(()=>helper.relative(name),/MAC_MATERIAL_PATH_INVALID/))
}
test('missing and duplicate manifest members are rejected',()=>{
 const missing=fixtureManifest();missing.files.pop();assert.throws(()=>helper.planFromManifest(missing),/MAC_MATERIAL_COVERAGE_INCOMPLETE/)
 const duplicate=fixtureManifest();duplicate.files.push(duplicate.files[0]);assert.throws(()=>helper.planFromManifest(duplicate),/MAC_MATERIAL_MANIFEST_INVALID/)
})
for(const arch of ['arm64','x64']){
 test('synthetic app layout records exact material copy without claiming a Mac installer: '+arch,()=>ownedFixture(root=>{
  const f=appFixture(root,arch),r=helper.checkDelivery(f.context,true)
  assert.equal(r.files.length,21);assert.equal(r.copyVerified,true);assert.equal(r.licenseApprovalGranted,false);assert.equal(r.releaseEligible,false)
  helper.checkDelivery(f.context)
  const index=fs.readFileSync(path.join(f.destination,'START-HERE.txt'),'utf8')
  for(const row of r.files)assert.ok(index.includes(row.path))
  fs.appendFileSync(path.join(f.destination,'DELIVERY.json'),'changed');assert.throws(()=>helper.checkDelivery(f.context),/MAC_MATERIAL_DELIVERY_CHANGED/)
 }))
}
test('material delivery rejects a different runtime asset',()=>ownedFixture(root=>{
 const f=appFixture(root)
 fs.writeFileSync(path.join(f.resources,'private-python-runtime','manifest.json'),JSON.stringify({platform:'darwin',arch:'arm64',sourceLockSha256:helper.FORMAL_LOCK_SHA256,python:{asset:{sha256:'0'.repeat(64)}}}))
 assert.throws(()=>helper.checkDelivery(f.context,true),/MAC_MATERIAL_RUNTIME_BINDING_INVALID/)
}))
test('Windows hook chain remains intact and does not run Mac material hooks',async()=>{
 const calls=[],base={extraResources:[{from:'existing',to:'existing'}],win:{target:'nsis'},beforePack:async()=>calls.push('before'),afterPack:async()=>calls.push('pack'),afterSign:async()=>calls.push('sign')}
 const wrapped=helper.withMacDistributionMaterials(base),context={electronPlatformName:'win32'}
 await wrapped.beforePack(context);await wrapped.afterPack(context);await wrapped.afterSign(context)
 assert.deepEqual(calls,['before','pack','sign']);assert.equal(wrapped.extraResources,base.extraResources);assert.equal(wrapped.win,base.win)
 assert.equal(wrapped.mac.extraResources[0].to,helper.DESTINATION)
})
