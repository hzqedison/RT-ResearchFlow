import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { renderToStaticMarkup } from 'react-dom/server'
import TushareCredentialPanel from '../../src/components/DataSource/TushareCredentialPanel'
import { verifyTushareCredential } from '../../electron/main/services/tushareCredentialVerification'
import { getTushareVerification, saveTushareVerification } from '../../electron/main/database/dataSourceRepository'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s) } }))
const accepted = { code: 0, data: { fields: ['cal_date'], items: [['20240101']] } }
const key = 'test-only-key-never-real'
function response(json: unknown) { return vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(json))) }
function database() {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE data_source_config(id INTEGER PRIMARY KEY,tushareTokenEncrypted BLOB,tushareEnabled INTEGER); INSERT INTO data_source_config VALUES(1,NULL,0)')
  return db
}
describe('Tushare verification evidence', () => {
  it('uses bounded HTTPS POST, checks actual calendar facts, not token presence', async () => {
    const fetcher = response(accepted)
    const result = await verifyTushareCredential(' '+key+' ', fetcher)
    expect(result.valid).toBe(true)
    expect(result.checkedApi).toBe('trade_cal')
    expect(result.message).toContain('仍需各自权限')
    const [url, request] = fetcher.mock.calls[0]
    expect(url).toBe('https://api.tushare.pro')
    expect(request?.redirect).toBe('error')
    expect(request?.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(String(request?.body)).token).toBe(key)
  })
  it.each([null, '', 'a b', 'x'.repeat(513), {}, 123])('rejects malformed credentials before network: %s', async input => {
    const fetcher=response(accepted)
    expect((await verifyTushareCredential(input,fetcher)).state).toBe('unbound')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('distinguishes documented permission failure without exposing upstream text', async () => {
    const result=await verifyTushareCredential(key,response({ code:2002,msg:key }))
    expect(result.state).toBe('permission-limited')
    expect(result.valid).toBe(false)
    expect(JSON.stringify(result)).not.toContain(key)
  })
  it.each([{}, {code:0}, {code:0,data:{fields:['cal_date'],items:[]}},
    {code:0,data:{fields:['other'],items:[['20240101']]}},
    {code:0,data:{fields:['cal_date'],items:[['20240102']]}}])('never accepts unverified success payload %s', async json => {
    expect((await verifyTushareCredential(key,response(json))).state).not.toBe('verified')
  })
  it('sanitizes network exceptions and authentication failures', async () => {
    const fetcher=vi.fn<typeof fetch>().mockRejectedValue(new Error(key))
    expect(JSON.stringify(await verifyTushareCredential(key,fetcher))).not.toContain(key)
    const rejected=await verifyTushareCredential(key,response({code:2001,msg:key}))
    expect(rejected.state).toBe('auth-failed')
    expect(JSON.stringify(rejected)).not.toContain(key)
  })
  it('rejects HTTP failure and oversized responses', async () => {
    const http=vi.fn<typeof fetch>().mockResolvedValue(new Response('bad',{status:503}))
    expect((await verifyTushareCredential(key,http)).state).toBe('network-error')
    const huge=vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(65537)))
    expect((await verifyTushareCredential(key,huge)).state).toBe('invalid-response')
  })
  it('persists verification only for exactly the encrypted credential that was tested', async () => {
    const db=database(), cipher=Buffer.from('encrypted-test-fixture')
    const proof=await verifyTushareCredential(key,response(accepted))
    db.prepare('UPDATE data_source_config SET tushareTokenEncrypted=? WHERE id=1').run(cipher)
    saveTushareVerification(db,cipher,proof)
    expect(getTushareVerification(db)).toEqual(proof)
    db.prepare('UPDATE data_source_config SET tushareTokenEncrypted=? WHERE id=1').run(Buffer.from('replacement'))
    expect(getTushareVerification(db)).toBeNull()
    db.close()
  })
  it('renders both explicit binding and saved-key recheck without any provider toggle', () => {
    const html=renderToStaticMarkup(React.createElement(TushareCredentialPanel))
    expect(html).toContain('绑定并验证新 Key')
    expect(html).toContain('复查已绑定 Key')
    expect(html).toContain('尚未验证')
    expect(html).toContain('type="password"')
    expect(html).toContain('https://tushare.pro/user/token')
  })
})

function actualHandler(deps: Record<string,unknown>) {
  const source=readFileSync('electron/main/ipc/aiHandlers.ts','utf8')
  const ast=ts.createSourceFile('aiHandlers.ts',source,ts.ScriptTarget.Latest,true)
  let expression=''
  function visit(node: ts.Node) {
    if(ts.isCallExpression(node) && node.expression.getText(ast)==='registerTrustedIpcHandler' &&
      node.arguments[0]?.getText(ast)==="'datasource:validateTushare'") expression=node.arguments[2].getText(ast)
    ts.forEachChild(node,visit)
  }
  visit(ast)
  if(!expression)throw new Error('Trusted binding handler missing')
  const js=ts.transpileModule('exports.handler = '+expression,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
  const exports: { handler?: (...args: unknown[])=>Promise<unknown> }={}
  new Function('exports',...Object.keys(deps),js)(exports,...Object.values(deps))
  return exports.handler!
}
describe('actual trusted binding handler',()=>{
  function setup(valid=true) {
    const db=database(), old=Buffer.from('old-encrypted-key')
    db.prepare('UPDATE data_source_config SET tushareTokenEncrypted=? WHERE id=1').run(old)
    const validate=vi.fn(async()=>({valid,state:valid?'verified':'auth-failed',checkedAt:Date.now(),checkedApi:'trade_cal',message:'safe'}))
    const encrypt=vi.fn(()=>Buffer.from('new-encrypted-key'))
    const update=vi.fn((_db,values)=>db.prepare('UPDATE data_source_config SET tushareTokenEncrypted=? WHERE id=1').run(values.tushareTokenEncrypted))
    const handler=actualHandler({getDb:()=>db,getDataSourceConfig:()=>db.prepare('SELECT * FROM data_source_config').get(),
      decryptApiKey:()=>key,validateTushareToken:validate,encryptRequiredApiKey:encrypt,updateDataSourceConfig:update,saveTushareVerification})
    return {db,old,validate,encrypt,update,handler}
  }
  it('verifies a saved credential without exposing it or enabling a provider',async()=>{
    const s=setup()
    const result=await s.handler(null,{token:''})
    expect(s.validate).toHaveBeenCalledWith(key)
    expect(s.encrypt).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain(key)
    expect(getTushareVerification(s.db)?.state).toBe('verified')
    expect(s.db.prepare('SELECT tushareEnabled FROM data_source_config').get()).toEqual({tushareEnabled:0})
    s.db.close()
  })
  it('does not replace the original credential when validation fails',async()=>{
    const s=setup(false)
    await s.handler(null,{token:'replacement',bind:true})
    expect(s.update).not.toHaveBeenCalled()
    expect(s.encrypt).not.toHaveBeenCalled()
    s.db.close()
  })
  it('binds only the new key and evidence atomically, without changing provider choices',async()=>{
    const s=setup()
    await s.handler(null,{token:'replacement',bind:true})
    expect(s.encrypt).toHaveBeenCalledWith('replacement')
    expect(getTushareVerification(s.db)?.state).toBe('verified')
    expect(s.db.prepare('SELECT tushareEnabled FROM data_source_config').get()).toEqual({tushareEnabled:0})
    s.db.close()
  })
})
