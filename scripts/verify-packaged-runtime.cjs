'use strict'
const cp = require('node:child_process')
const path = require('node:path')

// Construct a real, bounded PDF with valid object offsets and a text layer.
function fixturePdf() {
  const text = 'PACKAGED_PDF_RUNTIME_OK Native PDF parsing must work in the installed application.'
  const stream = `BT /F1 12 Tf 30 100 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ]
  let raw = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((value, i) => { offsets.push(Buffer.byteLength(raw)); raw += `${i + 1} 0 obj\n${value}\nendobj\n` })
  const xref = Buffer.byteLength(raw)
  raw += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(raw).toString('base64')
}

function verify(executable) {
  const script = `
const path=require('node:path'); const {createRequire}=require('node:module');
const resources=process.platform==='darwin'?path.resolve(path.dirname(process.execPath),'../Resources'):path.join(path.dirname(process.execPath),'resources');
const r=createRequire(path.join(resources,'app.asar/package.json'));
(async()=>{
const canvas=r('@napi-rs/canvas');if(typeof canvas.DOMMatrix!=='function')throw Error('PACKAGED_CANVAS_MISSING');
const D=r('better-sqlite3');const db=new D(':memory:');if(db.prepare('SELECT 42 AS value').get().value!==42)throw Error('PACKAGED_SQLITE_FAILED');db.close();
const {PDFParse}=r('pdf-parse');const parser=new PDFParse({data:Buffer.from(${JSON.stringify(fixturePdf())},'base64')});
try{const result=await parser.getText({first:24});if(!result.text.includes('PACKAGED_PDF_RUNTIME_OK'))throw Error('PACKAGED_PDF_TEXT_MISSING');}finally{await parser.destroy();}
console.log(JSON.stringify({kind:'packaged-runtime-verified',version:r('./package.json').version,pdf:true,canvas:true,sqlite:true,electron:process.versions.electron,arch:process.arch}));
})().catch(e=>{console.error(e.stack);process.exitCode=1});`
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  // Never allow the source/developer dependencies to hide a missing packaged library.
  delete env.NODE_PATH
  delete env.NODE_OPTIONS
  const result = cp.spawnSync(path.resolve(executable), ['-e', script], {
    cwd: path.dirname(path.resolve(executable)), env, encoding: 'utf8', windowsHide: true, timeout: 60000,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.status !== 0) throw new Error(`PACKAGED_RUNTIME_FAILED: ${result.error?.message || result.status}`)
}
if (require.main === module) {
  if (!process.argv[2]) throw new Error('Pass the real packaged executable path')
  verify(process.argv[2])
}
module.exports = { verify, fixturePdf }
