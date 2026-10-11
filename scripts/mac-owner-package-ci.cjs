'use strict'
// Owner-only Mac packaging. No seal/approval mutation, GUI, account or broker use.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const https = require('node:https')
const { spawnSync } = require('node:child_process')
const { pipeline } = require('node:stream/promises')
const stage = require('./run-private-runtime-stage-ci.cjs')
const core = require('../electron/shared/privatePythonRuntimeManifest.cjs')
const assembler = require('./bundle-private-python-runtime.cjs')
const sourceDelivery = require('./mac-owner-source-delivery.cjs')
const materialDelivery = require('./mac-distribution-materials.cjs')
const ROOT = path.resolve(__dirname, '..')
const REPO = 'hzqedison/RT-ResearchFlow'
const REPO_ID = 1408465497
const BRANCH = 'refs/heads/codex/runtime-owner-cache-1.7'
const FORMAL_SHA = '030b7a5200052ecdf3cef0a2611b61e40f0dfa71adf1b018898f1cb137144cc2'
const DRAFT_ID = 409410566
const TAG = 'private-runtime-cache-1.7-38086414260'
const PINS = {
 'darwin-arm64': [11681947938,308565305,'f8b674eab4bcf7e49afc3f0830218c55f7e1e3453ec4b853982e30c3b436d30f',114313752669,
 11614678213,23320833,'de45e1d1b3ace494ad4d2dbbc38b3f56bc75bf208b56bc15caf49747812b61d8'],
 'darwin-x64': [11682448388,325921214,'996f5409d96d8b5fc73761a3afb91fb656043304db8646b2184e95c5835e3336',114313752546,
 11615285302,22013655,'59b3f578507e8074a58f66b9f23bd4ea2b0ac865c4240dcbf189074f0d7e5671'],
}
const hash = b => crypto.createHash('sha256').update(b).digest('hex')
function fail(s) { throw Error(s) }
function context() {
 const target = process.platform + '-' + process.arch
 if (!PINS[target] || process.env.GITHUB_REPOSITORY !== REPO || process.env.GITHUB_REF !== BRANCH ||
     process.env.RUNNER_ENVIRONMENT !== 'github-hosted' || !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA || '') ||
     !process.env.GITHUB_TOKEN || !path.isAbsolute(process.env.RUNNER_TEMP || '')) fail('OWNER_CONTEXT_INVALID')
 const temp = fs.realpathSync(process.env.RUNNER_TEMP)
 return { target, temp, work:path.join(temp,'rt-mac-owner-' + target), sha:process.env.GITHUB_SHA }
}
async function api(endpoint, method='GET', body) {
 const response = await fetch('https://api.github.com/repos/' + REPO + endpoint, {
  method, headers:{Authorization:'Bearer ' + process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json',
   'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'}, body:body ? JSON.stringify(body) : undefined,
 })
 if (!response.ok) fail('OWNER_API_' + response.status + ':' + endpoint)
 return response.json()
}
async function identity(filename) {
 const stat = fs.lstatSync(filename)
 if (!stat.isFile() || stat.isSymbolicLink()) fail('OWNER_FILE_KIND')
 const h=crypto.createHash('sha256'); let size=0
 for await (const b of fs.createReadStream(filename)) { h.update(b);size+=b.length }
 if (size!==stat.size) fail('OWNER_FILE_CHANGED')
 return {path:path.basename(filename),size,sha256:h.digest('hex')}
}
function responseFor(url, depth=0) {
 return new Promise((resolve,reject)=>{
  const u=new URL(url)
  const allowed=u.hostname==='api.github.com' || u.hostname==='codeload.github.com' ||
   u.hostname==='release-assets.githubusercontent.com' || u.hostname.endsWith('.blob.core.windows.net') ||
   u.hostname.endsWith('.actions.githubusercontent.com')
  if (u.protocol!=='https:' || u.username || u.password || !allowed || depth>5) return reject(Error('OWNER_DOWNLOAD_HOST'))
  const headers={'User-Agent':'rt-owner-package-1.7',Accept:'application/vnd.github+json'}
  if (u.hostname==='api.github.com') headers.Authorization='Bearer ' + process.env.GITHUB_TOKEN
  const req=https.get(u,{headers,agent:false},res=>{
   if ([301,302,303,307,308].includes(res.statusCode)) {
    res.resume();responseFor(new URL(res.headers.location,u).href,depth+1).then(resolve,reject)
   } else if (res.statusCode!==200) { res.resume();reject(Error('OWNER_DOWNLOAD_HTTP_' + res.statusCode)) }
   else resolve(res)
  });req.on('error',reject);req.setTimeout(120000,()=>req.destroy(Error('OWNER_DOWNLOAD_TIMEOUT')))
 })
}
async function downloadOnce(endpoint, filename, expectedSize, expectedSha, cap) {
 const response=await responseFor('https://api.github.com/repos/' + REPO + endpoint)
 let size=0;const h=crypto.createHash('sha256')
 response.on('data',b=>{size+=b.length;h.update(b);if(size>cap) response.destroy(Error('OWNER_DOWNLOAD_BUDGET'))})
 await pipeline(response,fs.createWriteStream(filename,{flags:'wx'}))
 const digest=h.digest('hex')
 if ((expectedSize!==null && size!==expectedSize) || (expectedSha && digest!==expectedSha)) fail('OWNER_DOWNLOAD_BYTES')
 return {path:path.basename(filename),size,sha256:digest}
}
async function download(endpoint, filename, expectedSize, expectedSha, cap) {
 for(let attempt=1;attempt<=5;attempt++) {
  const partial=filename+'.owner-download-'+attempt
  try {
   const value=await downloadOnce(endpoint,partial,expectedSize,expectedSha,cap)
   if(fs.existsSync(filename)) fail('OWNER_DOWNLOAD_DESTINATION_EXISTS')
   fs.renameSync(partial,filename)
   return {...value,path:path.basename(filename)}
  } catch(e) {
   if(fs.existsSync(partial)) fs.unlinkSync(partial)
   if(attempt===5 || /^OWNER_DOWNLOAD_(BYTES|BUDGET|HOST|DESTINATION)/.test(e.message)) throw e
   console.log('Owner download transport retry '+attempt+' for '+endpoint)
   await new Promise(r=>setTimeout(r,attempt*2000))
  }
 }
}
const UNZIP = String.raw`
import pathlib,stat,sys,zipfile
archive,out=map(pathlib.Path,sys.argv[1:]);seen=set();total=0
with zipfile.ZipFile(archive) as z:
 for m in z.infolist():
  name=m.filename.rstrip('/')
  if not name or name.startswith('/') or chr(92) in name or any(p in ('','.','..') or ':' in p for p in name.split('/')):raise ValueError('ZIP_PATH')
  if name.lower() in seen:raise ValueError('ZIP_DUPLICATE')
  seen.add(name.lower());total+=m.file_size
  if len(seen)>150000 or total>3*1024**3 or stat.S_ISLNK(m.external_attr>>16):raise ValueError('ZIP_BUDGET_OR_LINK')
 z.extractall(out)
`
function python(code,args,work) {
 const result=spawnSync(process.env.STAGE_PYTHON || 'python3',['-X','utf8','-I','-B','-c',code,...args],
  {cwd:work,env:stage.childEnvironment(process.env,work),stdio:'inherit',timeout:1200000})
 if (result.error || result.status!==0) fail('OWNER_PYTHON_INPUT_FAILURE')
}
function json(filename) { return JSON.parse(fs.readFileSync(filename,'utf8')) }
function write(filename,value) { fs.writeFileSync(filename,JSON.stringify(value,null,2)+'\n',{flag:'wx'}) }
async function artifact(work, label, pin, runId, headSha, workflow, name) {
 const run=await api('/actions/runs/' + runId), meta=await api('/actions/artifacts/' + pin[0])
 if (run.id!==runId || run.status!=='completed' || run.conclusion!=='success' ||
     (headSha && run.head_sha!==headSha) || (workflow && run.path!==workflow) ||
     run.repository?.id!==REPO_ID || run.head_repository?.id!==REPO_ID || meta.id!==pin[0] ||
     meta.expired || meta.size_in_bytes!==pin[1] || meta.digest!=='sha256:' + pin[2] ||
     meta.workflow_run?.id!==runId || meta.workflow_run?.head_sha!==run.head_sha || meta.name!==name) fail('OWNER_ARTIFACT_ORIGIN:' + label)
 const archive=path.join(work,label+'.zip'),output=path.join(work,label)
 await download('/actions/artifacts/' + pin[0] + '/zip',archive,pin[1],pin[2],1024**3)
 fs.mkdirSync(output);python(UNZIP,[archive,output],work)
 return {output,run,meta}
}
function findWheel(root,asset) {
 const found=[];let count=0
 function walk(dir) {
  for(const e of fs.readdirSync(dir,{withFileTypes:true})) {
   if (++count>10000 || e.isSymbolicLink()) fail('OWNER_DERIVED_CACHE')
   const p=path.join(dir,e.name)
   if(e.isDirectory()) walk(p)
   else if(e.isFile() && e.name===asset.filename && fs.statSync(p).size===asset.size && hash(fs.readFileSync(p))===asset.sha256) found.push(p)
  }
 }
 walk(root);if(found.length!==1) fail('OWNER_NATIVE_CACHE_MISSING:' + asset.filename)
 return found[0]
}
async function prepare() {
 const c=context(),pin=PINS[c.target]
 if(fs.existsSync(c.work)) fail('OWNER_FRESH_WORK_REQUIRED')
 fs.mkdirSync(c.work)
 const candidate=await artifact(c.work,'candidate',pin.slice(0,3),38086414260,'b3994908e75c8cec4a8bbc9b0ab7a230e39db35c',
  '.github/workflows/private-runtime-prepare-native.yml','private-runtime-prepare-' + c.target)
 const job=await api('/actions/jobs/' + pin[3])
 const runner=c.target==='darwin-arm64'?'macos-15':'macos-15-intel'
 if(job.id!==pin[3] || job.run_id!==38086414260 || job.head_sha!==candidate.run.head_sha ||
  job.run_attempt!==candidate.run.run_attempt || job.status!=='completed' || job.conclusion!=='success' ||
  job.name!=='native-prepare (' + c.target + ', ' + runner + ')') fail('OWNER_PREPARE_JOB')
 const formal=await artifact(c.work,'formal',[11682458673,15927505,'15f02b8bb69a083854e6edb24561bfbb0a40cd50a128a457b560bed5c4dcdb42'],
  38086904113,'4d7fe22bec940e20bc8308a3190ca5f45a89f2ca','.github/workflows/private-runtime-merge.yml','private-runtime-structural-merge')
 const derived=await artifact(c.work,'derived',[pin[4],pin[5],pin[6]],37927640327,null,null,'lxml-redistribution-' + c.target)
 const lockPath=path.join(formal.output,'formal-lock.json'),raw=stage.readFormalLock(lockPath)
 if(raw.length!==15332205 || hash(raw)!==FORMAL_SHA) fail('OWNER_FORMAL_LOCK_BYTES')
 const lock=core.validateLock(JSON.parse(raw)),summary=json(path.join(candidate.output,'summary.json'))
 const tar=path.join(candidate.output,'native-preparation-candidate.tar.gz'),tarPin=summary.unapprovedNativePayload
 const ti=await identity(tar)
 if(tarPin?.filename!==ti.path || tarPin.rawInputAssets!==false || tarPin.assetsRootIncluded!==false ||
  tarPin.size!==ti.size || tarPin.sha256!==ti.sha256 || ti.size>2*1024**3) fail('OWNER_CANDIDATE_TAR_BYTES')
 const retained=path.join(c.work,'retained');fs.mkdirSync(retained)
 python(stage.EXTRACT,[tar,retained],c.work)
 const preparedRoot=path.join(c.work,'prepared');fs.mkdirSync(preparedRoot)
 fs.renameSync(path.join(retained,'prepare/materialize/tree'),path.join(preparedRoot,c.target))
 const manifest=structuredClone(lock.platforms[c.target])
 const generatorSha=hash(fs.readFileSync(path.join(ROOT,'scripts/prepare-private-python-runtime.py')))
 const projection=core.projectDependencyGraphs(path.join(preparedRoot,c.target),manifest,generatorSha)
 for(const p of ['akshare','mootdx','pywencai']) manifest.providers[p].wheels=projection.providers[p].wheels
 const plan=stage.assetPlan(manifest,lock.preparationPolicySha256),assetsRoot=path.join(c.work,'assets')
 fs.mkdirSync(assetsRoot);plan.reproduce=[]
 for(const w of plan.derived) {
  if(w.nativeBuildInputs || w.derived.recipe.path==='scripts/build-lxml-redistribution-wheel.py')
   fs.copyFileSync(findWheel(derived.output,w.asset),path.join(assetsRoot,w.asset.filename),fs.constants.COPYFILE_EXCL)
  else if(['scripts/build-provider-source-wheels.py','scripts/build-mootdx-compat-wheel.py','scripts/build-akshare-node-wheel.py','scripts/build-private-node-js-runtime-wheel.py'].includes(w.derived.recipe.path)) plan.reproduce.push(w)
  else fail('OWNER_DERIVED_RECIPE_UNSUPPORTED')
 }
 for(const recipe of plan.recipes) {
  const input=path.join(ROOT,recipe.path)
  if(hash(fs.readFileSync(input))!==recipe.sha256) fail('OWNER_RECIPE_BYTES')
  const output=path.join(assetsRoot,'recipes',recipe.path);fs.mkdirSync(path.dirname(output),{recursive:true})
  fs.copyFileSync(input,output,fs.constants.COPYFILE_EXCL)
 }
 const planPath=path.join(c.work,'asset-plan.json');write(planPath,plan)
 python(stage.CACHE,[ROOT,planPath,assetsRoot,c.work],c.work)
 const outputRoot=path.join(ROOT,'resources/python-runtime/bundles')
 if(fs.existsSync(path.join(outputRoot,c.target))) fail('OWNER_BUNDLE_ALREADY_EXISTS')
 const result=assembler.assemble({lockPath,preparedRoot,assetsRoot,outputRoot,target:c.target})
 write(path.join(c.work,'ordinary-assembly-receipt.json'),{...result,formalLockSha256:FORMAL_SHA,
  sourceCommit:c.sha,purpose:'owner-draft-package',releaseEligible:false,finalReleaseAuthorized:false})
 console.log('ORDINARY_ASSEMBLY_OK ' + JSON.stringify(result))
 const sourceRoot=path.join(c.work,'source');fs.mkdirSync(sourceRoot)
 const archive=await download('/zipball/' + c.sha,path.join(sourceRoot,'application-source.zip'),null,null,128*1024**2)
 const developmentPath=path.join(ROOT,'resources/python-runtime/reviewed-materials/mac-final-obligations-1.7-20261011/DEVELOPMENT-RUNTIME.txt')
 const development=fs.readFileSync(developmentPath)
 if(development.length!==9907 || hash(development)!==sourceDelivery.development) fail('OWNER_DEVELOPMENT_BYTES')
 fs.writeFileSync(path.join(sourceRoot,'DEVELOPMENT-RUNTIME.txt'),development,{flag:'wx'})
 const notice='RT-ResearchFlow 1.7.0 owner draft corresponding source\nRepository: '+REPO+'\nSource commit: '+c.sha+
  '\nFull source included here: application-source.zip\nArchive bytes: '+archive.size+'\nArchive SHA256: '+archive.sha256+
  '\nOfficial immutable source endpoint: https://api.github.com/repos/'+REPO+'/zipball/'+c.sha+
  '\nSource contains the application and committed build scripts/lockfile used for this package.\n'+
  'Developer runtime replacement instructions: DEVELOPMENT-RUNTIME.txt\n'+
  'Retained runtime sources/recipes/notices: ../../private-python-runtime/licenses/\n'+
  'Mac supplemental notices/source: ../mac-final-obligations-1.7-20261011/\n'+
  'No publisher private key is needed for an owned source fork. Official protections remain unchanged.\n'+
  'Source delivery is not evidence that a recipient relink was executed or final release was authorized.\n'
 fs.writeFileSync(path.join(sourceRoot,'SOURCE-ACCESS.txt'),notice,{flag:'wx'})
 const files=[];for(const name of sourceDelivery.names) files.push(await identity(path.join(sourceRoot,name)))
 write(path.join(sourceRoot,'source-receipt.json'),{kind:'rt-mac-owner-source-plan-v1',version:'1.7.0',repository:REPO,
  sourceCommit:c.sha,formalLockSha256:FORMAL_SHA,releaseEligible:false,files})
 sourceDelivery.load(sourceRoot)
 fs.appendFileSync(process.env.GITHUB_ENV,'RT_MAC_OWNER_SOURCE_ROOT='+sourceRoot+'\nRT_MAC_OWNER_WORK_ROOT='+c.work+'\n')
 console.log(JSON.stringify({target:c.target,ordinaryAssembly:result,sourceRoot,sourceArchive:archive,releaseEligible:false}))
}
async function finish() {
 const c=context(),release=path.join(ROOT,'release')
 const dmgs=fs.readdirSync(release).filter(n=>n.endsWith('.dmg'))
 if(dmgs.length!==1 || !dmgs[0].includes('1.7.0-'+process.arch)) fail('OWNER_DMG_OUTPUT')
 const apps=[]
 for(const e of fs.readdirSync(release,{withFileTypes:true})) if(e.isDirectory())
  for(const a of fs.readdirSync(path.join(release,e.name),{withFileTypes:true})) if(a.isDirectory() && a.name.endsWith('.app')) apps.push(path.join(release,e.name,a.name))
 if(apps.length!==1) fail('OWNER_APP_OUTPUT')
 const app=apps[0],product=path.basename(app,'.app'),resources=path.join(app,'Contents/Resources')
 const manifest=core.readValidatedRuntime(path.join(resources,'private-python-runtime'),c.target)
 if(manifest.manifest.sourceLockSha256!==FORMAL_SHA) fail('OWNER_PACKAGED_FORMAL_BINDING')
 const source=sourceDelivery.load(path.join(resources,'third-party/application-source'))
 if(source.plan.sourceCommit!==c.sha || !source.raw.equals(sourceDelivery.load(process.env.RT_MAC_OWNER_SOURCE_ROOT).raw)) fail('OWNER_PACKAGED_SOURCE_BINDING')
 materialDelivery.checkDelivery({appOutDir:path.dirname(app),electronPlatformName:'darwin',arch:process.arch,packager:{appInfo:{productFilename:product}}})
 const verify=spawnSync('codesign',['--verify','--deep','--strict',app],{stdio:'inherit'})
 if(verify.error || verify.status!==0) fail('OWNER_SIGNATURE_VERIFY_FAILED')
 const smokeCode="const {createRequire}=require('node:module');const r=createRequire(process.argv[1]+'/package.json');const D=r('better-sqlite3');const db=new D(':memory:');if(db.prepare('SELECT 1 AS ok').get().ok!==1)throw Error('SQLITE_SMOKE');db.close();console.log(JSON.stringify({electron:process.versions.electron,modules:process.versions.modules,arch:process.arch,inMemory:true}));"
 const smoke=spawnSync(path.join(app,'Contents/MacOS',product),['-e',smokeCode,path.join(resources,'app.asar')],
  {env:{...stage.childEnvironment(process.env,c.work),ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',timeout:60000,maxBuffer:1024*1024})
 if(smoke.error || smoke.status!==0) { if(smoke.stderr) console.error(smoke.stderr);fail('OWNER_SQLITE_ABI_SMOKE_FAILED') }
 console.log(smoke.stdout)
 const abi=JSON.parse(smoke.stdout.trim())
 if(!abi.electron || abi.arch!==process.arch || abi.inMemory!==true) fail('OWNER_SQLITE_ABI_SMOKE_IDENTITY')
 const receipt={kind:'rt-mac-owner-package-receipt-v1',target:c.target,version:'1.7.0',sourceCommit:c.sha,
  formalLockSha256:FORMAL_SHA,runId:Number(process.env.GITHUB_RUN_ID),runAttempt:Number(process.env.GITHUB_RUN_ATTEMPT),
  actualCopyVerified:true,sourcePlan:source.plan,sqliteAbiSmoke:abi,signatureVerified:true,
  releaseEligible:false,finalReleaseAuthorized:false,files:[await identity(path.join(release,dmgs[0]))]}
 write(path.join(release,'mac-owner-package-receipt-'+c.target+'.json'),receipt)
 console.log(JSON.stringify(receipt))
}
async function upload(filename,name) {
 const stat=fs.statSync(filename)
 const u=new URL('https://uploads.github.com/repos/'+REPO+'/releases/'+DRAFT_ID+'/assets?name='+encodeURIComponent(name))
 await new Promise((resolve,reject)=>{
  const req=https.request(u,{method:'POST',headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,
   'User-Agent':'rt-owner-package-1.7','Content-Type':'application/octet-stream','Content-Length':stat.size}},res=>{
    let raw='';res.on('data',b=>{raw+=b;if(raw.length>1024*1024)res.destroy(Error('OWNER_UPLOAD_RESPONSE_BUDGET'))})
    res.on('error',reject);res.on('end',()=>{
     if(res.statusCode!==201)return reject(Error('OWNER_DRAFT_UPLOAD_'+res.statusCode))
     try{const a=JSON.parse(raw);if(a.name!==name || a.size!==stat.size)throw Error('OWNER_DRAFT_UPLOAD_BYTES');resolve()}catch(e){reject(e)}
    })
  });req.on('error',reject);fs.createReadStream(filename).on('error',e=>req.destroy(e)).pipe(req)
 })
}
async function publish() {
 const c=context(),release=path.join(ROOT,'release'),before=await api('/releases/'+DRAFT_ID)
 if(before.id!==DRAFT_ID || before.tag_name!==TAG || before.draft!==true) fail('OWNER_RELEASE_NOT_DRAFT')
 const receiptPath=path.join(release,'mac-owner-package-receipt-'+c.target+'.json'),receipt=json(receiptPath)
 if(receipt.sourceCommit!==c.sha || receipt.target!==c.target || receipt.actualCopyVerified!==true || receipt.finalReleaseAuthorized!==false) fail('OWNER_PUBLISH_RECEIPT')
 for(const row of [...receipt.files,await identity(receiptPath)]) {
  const filename=path.join(release,row.path),actual=await identity(filename)
  if(actual.sha256!==row.sha256 || actual.size!==row.size) fail('OWNER_PUBLISH_BYTES_CHANGED')
  const ext=path.extname(row.path),name=path.basename(row.path,ext)+'-owner-'+process.env.GITHUB_RUN_ID+'-'+process.env.GITHUB_RUN_ATTEMPT+ext
  if(before.assets.some(a=>a.name===name)) fail('OWNER_DRAFT_ASSET_ALREADY_EXISTS')
  await upload(filename,name)
 }
 const after=await api('/releases/'+DRAFT_ID)
 if(after.draft!==true || after.tag_name!==TAG) fail('OWNER_DRAFT_CHANGED')
 console.log(JSON.stringify({draftId:DRAFT_ID,draft:true,target:c.target,runId:process.env.GITHUB_RUN_ID,files:receipt.files,finalReleaseAuthorized:false}))
}
const commands={prepare,finish,publish}
if(require.main===module) {
 const cmd=process.argv[2]
 if(process.argv.length!==3 || !commands[cmd]) throw Error('Usage: node scripts/mac-owner-package-ci.cjs prepare|finish|publish')
 commands[cmd]().catch(e=>{console.error(e.stack || e.message);process.exitCode=1})
}
