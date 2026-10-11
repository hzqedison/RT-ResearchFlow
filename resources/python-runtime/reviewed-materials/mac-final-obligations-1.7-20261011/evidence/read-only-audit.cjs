'use strict';
// Read-only original archive audit. Does not execute Mac Python or write files.
// Requires Node with zstdDecompressSync (the current local Node REPL has it).
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const sha = b=>crypto.createHash('sha256').update(b).digest('hex');
const tarParse = function(b){var rows=[],pos=0,longName=null,pax={}; var str=(s,e)=>b.subarray(s,e).toString('utf8').replace(/\0.*$/s,''); while(pos+512<=b.length){if(b.subarray(pos,pos+512).every(v=>v===0))break; var n=str(pos,pos+100),size=parseInt(str(pos+124,pos+136).trim(),8)||0,ty=str(pos+156,pos+157),prefix=str(pos+345,pos+500); if(prefix)n=prefix+'/'+n; var data=b.subarray(pos+512,pos+512+size); if(ty==='L')longName=data.toString().replace(/\0.*$/s,''); else if(ty==='x'||ty==='g'){for(var line of data.toString().split('\n')){var match=line.match(/^\d+ ([^=]+)=(.*)$/);if(match)pax[match[1]]=match[2];}}else{rows.push({name:pax.path||longName||n,type:ty,link:pax.linkpath||str(pos+157,pos+257),data});longName=null;pax={};}pos+=512+Math.ceil(size/512)*512;}return rows;};
const nativeParse = function(b){if(b.length<32||b.readUInt32LE(0)!==0xfeedfacf)return null;var n=b.readUInt32LE(16),limit=32+b.readUInt32LE(20),p=32,libs=[],rpaths=[],symtab; if(limit>b.length)throw Error('MachO command bounds'); for(var i=0;i<n;i++){var cmd=b.readUInt32LE(p),sz=b.readUInt32LE(p+4);if(sz<8||p+sz>limit)throw Error('MachO invalid command');if([12,0x80000018,0x8000001f,0x80000023,32].includes(cmd)){var off=b.readUInt32LE(p+8);libs.push({command:cmd,path:b.subarray(p+off,p+sz).toString().split('\0')[0]});} if(cmd===0x8000001c){var off=b.readUInt32LE(p+8);rpaths.push(b.subarray(p+off,p+sz).toString().split('\0')[0]);} if(cmd===2)symtab={offset:b.readUInt32LE(p+8),count:b.readUInt32LE(p+12),strings:b.readUInt32LE(p+16),size:b.readUInt32LE(p+20)};p+=sz;}var imports=[],signals=[];if(symtab){if(symtab.offset+16*symtab.count>b.length||symtab.strings+symtab.size>b.length)throw Error('symbol bounds');for(var i=0;i<symtab.count;i++){var q=symtab.offset+16*i,idx=b.readUInt32LE(q),type=b[q+4],desc=b.readUInt16LE(q+6);if(idx>=symtab.size)continue;var start=symtab.strings+idx,end=b.indexOf(0,start);var name=b.subarray(start,end<0?symtab.strings+symtab.size:end).toString();var undef=(type&0xe)===0&&(type&1)===1,ordinal=desc>>>8;var row={name,type,undefinedExternal:undef,libraryOrdinal:ordinal,library:ordinal>0&&ordinal<=libs.length?libs[ordinal-1].path:null};if(undef)imports.push(row);if(/^_?(dbm_|db_create|db_env_create|__db|Tix|tix|X[A-Z]|xcb_)/.test(name))signals.push(row);}}return {cpu:b.readUInt32LE(4),filetype:b.readUInt32LE(12),dependencies:libs,rpaths,symbolTableCount:symtab?.count??0,imports,signals};};
const zipParse = function(b){var end=b.length-22;while(end>=Math.max(0,b.length-65557)&&b.readUInt32LE(end)!==0x06054b50)end--;if(end<0)throw Error('zip EOCD');var count=b.readUInt16LE(end+10),p=b.readUInt32LE(end+16),rows=[];for(var i=0;i<count;i++){if(b.readUInt32LE(p)!==0x02014b50)throw Error('zip central header');var flags=b.readUInt16LE(p+8),method=b.readUInt16LE(p+10),size=b.readUInt32LE(p+20),usize=b.readUInt32LE(p+24),nl=b.readUInt16LE(p+28),el=b.readUInt16LE(p+30),cl=b.readUInt16LE(p+32),off=b.readUInt32LE(p+42),name=b.subarray(p+46,p+46+nl).toString();if(flags&1)throw Error('encrypted zip');var start=off+30+b.readUInt16LE(off+26)+b.readUInt16LE(off+28);var compressed=b.subarray(start,start+size);var data=method===0?compressed:method===8?zlib.inflateRawSync(compressed):null;if(!data||data.length!==usize)throw Error('zip method/length');rows.push({name,data});p+=46+nl+el+cl;}return rows;};
const inputs = [
  {
    "target": "darwin-arm64",
    "role": "python",
    "path": "D:\\RT-ResearchFlow-BuildCache\\franklin-mac-inputs-20261009-p2-48590894\\assets\\cpython-3.13.16+20261003-aarch64-apple-darwin-install_only.tar.gz",
    "sha256": "d8975d7df4f08f7b1c7aafcdfacbddcec3d366415f2c1a72b2466b6850815933"
  },
  {
    "target": "darwin-arm64",
    "role": "full",
    "path": "D:\\RT-ResearchFlow-BuildCache\\franklin-mac-inputs-20261009-p2-48590894\\assets\\cpython-3.13.16+20261003-aarch64-apple-darwin-pgo+lto-full.tar.zst",
    "sha256": "ca3eb5bf8110eaed1c3e516be4bd4d52bcf636f8e888359353f274288406bae7"
  },
  {
    "target": "darwin-x64",
    "role": "python",
    "path": "D:\\RT-ResearchFlow-BuildCache\\franklin-mac-inputs-20261009-p2-48590894\\assets\\cpython-3.13.16+20261003-x86_64-apple-darwin-install_only.tar.gz",
    "sha256": "8e9cb087305bfb8969f68a905f79f41469d4aa5220c1aa71ada7fc9953bdba0f"
  },
  {
    "target": "darwin-x64",
    "role": "full",
    "path": "D:\\RT-ResearchFlow-BuildCache\\franklin-mac-inputs-20261009-p2-48590894\\assets\\cpython-3.13.16+20261003-x86_64-apple-darwin-pgo+lto-full.tar.zst",
    "sha256": "57030cb11a1e823903b13ada440f64e7a06fcaeaabe1051559ef8c34890c277a"
  }
];
(async () => {
  const lockBytes = await fs.readFile("D:/RT-ResearchFlow-BuildCache/windows-1.7-formal-inputs-current/formal-lock.json");
  const lock = JSON.parse(lockBytes);
  const results = [];
  for (const input of inputs) {
    const raw = await fs.readFile(input.path);
    if (sha(raw) !== input.sha256) throw new Error('Original archive SHA256 mismatch');
    const rows = tarParse(input.role === 'python' ? zlib.gunzipSync(raw) : zlib.zstdDecompressSync(raw));
    const index = new Map(lock.platforms[input.target].files.map(f => [f.path,f]));
    const result = {input, memberCount:rows.length, native:[], certifi:[]};
    if (input.role === 'python') {
      for (const row of rows) {
        const parsed = nativeParse(row.data);
        if (parsed) result.native.push({member:row.name,sha256:sha(row.data),lockMatch:index.get(row.name)?.sha256===sha(row.data),...parsed});
      }
      const member = "python/lib/python3.13/ensurepip/_bundled/pip-26.2.1-py3-none-any.whl";
      const wheel = rows.find(r => r.name === member);
      result.wheel = {member, sha256:sha(wheel.data), lockMatch:index.get(member)?.sha256===sha(wheel.data)};
      result.certifi = zipParse(wheel.data).filter(r => r.name.startsWith('pip/_vendor/certifi/')).map(r => ({member:r.name,size:r.data.length,sha256:sha(r.data)}));
    }
    results.push(result);
  }
  process.stdout.write(JSON.stringify({formalLockSha256:sha(lockBytes),results},null,2)+'\n');
})().catch(error => { console.error(error); process.exitCode=1; });
