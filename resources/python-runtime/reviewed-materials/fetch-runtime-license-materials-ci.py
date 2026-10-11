"""Collect/retain exact reviewed public license materials; never prepare providers."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import tarfile
import time
import urllib.parse
import urllib.request

MANIFEST_SHA256 = '9d06e71d8a8a62fe7da79111ebedbfaa9290f0a27c10ea850bf4ee28274c1609'
TARGETS = ('win32-x64', 'darwin-arm64', 'darwin-x64')
ALLOWED_HOSTS = {'ftp.gnu.org','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com','conda.anaconda.org'}

def digest(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda:f.read(131072),b''): h.update(block)
    return h.hexdigest()

def manifest():
    path=Path(__file__).resolve().with_name('runtime-license-materials.json')
    if digest(path)!=MANIFEST_SHA256: raise ValueError('Material manifest pin mismatch')
    value=json.loads(path.read_text('utf-8'))
    if value['kind']!='astra-exact-reviewed-public-materials-v1': raise ValueError('Wrong material kind')
    return value

def relative(value):
    p=PurePosixPath(value)
    if p.is_absolute() or not p.parts or any(x in ('..','.') or ':' in x for x in p.parts) or chr(92) in value or chr(0) in value:
        raise ValueError('Unsafe relative material path')
    return p

def hosted_path(value,fresh=False):
    if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('RUNNER_ENVIRONMENT')!='github-hosted':
        raise ValueError('Disposable GitHub-hosted runner only')
    temp=Path(os.environ['RUNNER_TEMP']).resolve(strict=True)
    p=Path(value)
    if not p.is_absolute() or p==temp: raise ValueError('Absolute runner child path required')
    resolved=p.resolve(strict=not fresh)
    if not resolved.is_relative_to(temp) or resolved==temp: raise ValueError('Path escaped runner temp')
    q=p
    while q!=temp:
        if q.is_symlink() or (hasattr(q,'is_junction') and q.is_junction()): raise ValueError('Input/output links refused')
        if q.parent==q: raise ValueError('Path escaped runner root')
        q=q.parent
    if fresh and p.exists(): raise ValueError('Exclusive output required')
    if not fresh and not p.is_dir(): raise ValueError('Input directory required')
    return p

def checked_url(value):
    p=urllib.parse.urlsplit(value)
    if p.scheme!='https' or p.hostname not in ALLOWED_HOSTS or p.username or p.password or p.port not in (None,443) or p.fragment:
        raise ValueError('Public publisher HTTPS host required')
    return value

class Redirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        checked_url(newurl)
        return super().redirect_request(req,fp,code,msg,headers,newurl)

def download(asset,path):
    checked_url(asset['url']);size=asset['size']
    if not isinstance(size,int) or isinstance(size,bool) or not 0<size<160_000_000: raise ValueError('Asset size budget exceeded')
    deadline=time.monotonic()+240;total=0;h=hashlib.sha256()
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),Redirects())
    req=urllib.request.Request(asset['url'],headers={'User-Agent':'RT-ResearchFlow-reviewed-license-materials/1.7'})
    with opener.open(req,timeout=40) as response,path.open('xb') as output:
        checked_url(response.geturl())
        while True:
            if time.monotonic()>deadline: raise TimeoutError('Source material download deadline')
            block=response.read(min(131072,size-total+1))
            if not block: break
            total+=len(block)
            if total>size: raise ValueError('Download exceeded exact publisher size')
            h.update(block);output.write(block)
    if total!=size or h.hexdigest()!=asset['sha256']: raise ValueError('Original source artifact pin mismatch')

def checked_material(root,m):
    path=root/'materials'/m['id']
    if path.is_symlink() or not path.is_file() or path.stat().st_size!=m['size'] or digest(path)!=m['sha256']:
        raise ValueError('Material bytes do not match review')
    return path

def collect(output_dir,input_cache=None):
    v=manifest();out=hosted_path(output_dir,fresh=True);out.mkdir(parents=True)
    # Raw upstream binary archives remain outside the uploaded materials directory.
    cache=hosted_path(input_cache) if input_cache else None
    raw=out.parent/(out.name+'-raw-inputs');hosted_path(raw,fresh=True);raw.mkdir()
    (out/'materials').mkdir();downloaded={}
    for asset in v['assets']:
        dst=raw/asset['filename']
        cached=cache/asset['filename'] if cache else None
        if cached is not None and cached.is_file():
            if cached.is_symlink() or cached.stat().st_size!=asset['size'] or digest(cached)!=asset['sha256']: raise ValueError('Cached original pin mismatch')
            with cached.open('rb') as a,dst.open('xb') as b: shutil.copyfileobj(a,b)
        else: download(asset,dst)
        downloaded[asset['id']]=dst
    archive_members={}
    for m in v['materials']:
        if m['kind']=='archive-member': archive_members.setdefault(m['asset'],[]).append(m)
    for asset_id,wanted in archive_members.items():
        with tarfile.open(downloaded[asset_id]) as archive:
            all_members=archive.getmembers()
            if len(all_members)>100000: raise ValueError('Archive member budget')
            for m in wanted:
                relative(m['member']);matches=[x for x in all_members if x.name==m['member']]
                if len(matches)!=1 or not matches[0].isfile() or matches[0].size!=m['size']: raise ValueError('Exact source member mismatch')
                data=archive.extractfile(matches[0]).read(m['size']+1)
                if len(data)!=m['size'] or hashlib.sha256(data).hexdigest()!=m['sha256']: raise ValueError('Original member SHA mismatch')
                with (out/'materials'/m['id']).open('xb') as f:f.write(data)
    for m in v['materials']:
        dst=out/'materials'/m['id']
        if m['kind']=='download-asset':
            with downloaded[m['asset']].open('rb') as a,dst.open('xb') as b:shutil.copyfileobj(a,b)
        elif m['kind']=='inline-original-or-review-authored':
            data=base64.b64decode(m['utf8Base64'],validate=True)
            if len(data)!=m['size'] or hashlib.sha256(data).hexdigest()!=m['sha256']: raise ValueError('Inline original pin mismatch')
            with dst.open('xb') as f:f.write(data)
        checked_material(out,m)
    receipt={'kind':'astra-reviewed-public-material-collection-v1','manifestSha256':MANIFEST_SHA256,
             'assets':[{'id':x['id'],'url':x['url'],'sha256':x['sha256'],'size':x['size']} for x in v['assets']],
             'materials':[{'id':m['id'],'sha256':m['sha256'],'size':m['size']} for m in v['materials']],
             'rawBinaryInputArchivesIncluded':False,'sourceArchivesIncluded':True,'sourcesExecuted':False,'releaseEligible':False}
    with (out/'material-receipt.json').open('x',encoding='utf-8',newline='\n') as f:json.dump(receipt,f,indent=2);f.write('\n')
    return receipt

def retain_materials(materials_root,tree,target,selected_wheel_sha256):
    """Owner calls during materialize BEFORE license/inventory/fragment creation.

    Returns material evidence, not approvals or a complete runtime manifest.
    `selected_wheel_sha256` must come from actual candidate resolver assets.
    """
    if target not in TARGETS:raise ValueError('Unsupported target')
    materials_root=hosted_path(materials_root);tree=hosted_path(tree);v=manifest()
    if materials_root==tree or materials_root.is_relative_to(tree) or tree.is_relative_to(materials_root):raise ValueError('Materials and provider output must be distinct')
    selected=set(selected_wheel_sha256)
    if any(not isinstance(h,str) or len(h)!=64 or any(c not in '0123456789abcdef' for c in h) for h in selected):raise ValueError('Actual wheel digest set required')
    mids={m['id']:m for m in v['materials']};plan={};bindings=[]
    for row in v['copies']:
        if row['target']!=target or row['artifactSha256'] not in selected:continue
        rel=relative(row['destinationRelativePath']);m=mids[row['material']];source=checked_material(materials_root,m);dest=tree.joinpath(*rel.parts)
        hosted_path(dest.parent if dest.parent.exists() else tree)
        if str(rel) in plan and plan[str(rel)][2]['sha256']!=m['sha256']:raise ValueError('Destination material conflict')
        plan[str(rel)]=(source,dest,m);bindings.append({**row,'sha256':m['sha256'],'size':m['size']})
    for source,dest,m in plan.values():
        current=dest.parent
        while current!=tree:
            if current.is_symlink() or (hasattr(current,'is_junction') and current.is_junction()):raise ValueError('Runtime destination link refused')
            current=current.parent
        if dest.exists() or dest.is_symlink():
            if dest.is_symlink() or not dest.is_file() or dest.stat().st_size!=m['size'] or digest(dest)!=m['sha256']:raise ValueError('Existing notice/source differs from reviewed bytes')
        else:
            dest.parent.mkdir(parents=True,exist_ok=True)
            with source.open('rb') as a,dest.open('xb') as b:shutil.copyfileobj(a,b)
            dest.chmod(0o644)
        if digest(dest)!=m['sha256']:raise ValueError('Retained source byte mismatch')
    return {'kind':'astra-reviewed-license-material-retention-v1','target':target,'materialManifestSha256':MANIFEST_SHA256,
            'wheelBindings':bindings,'materialFiles':len(plan),'approvalAutomaticallyApplied':False,'releaseEligible':False,
            'requirements':['Include paths/digests/modes in final inventory','License/source obligations remain part of formal seal','No post-hoc candidate/manifest mutation']}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output-dir',required=True);p.add_argument('--input-cache');a=p.parse_args()
    r=collect(a.output_dir,a.input_cache);print(json.dumps({'materials':len(r['materials']),'manifestSha256':MANIFEST_SHA256,'releaseEligible':False}))

if __name__=='__main__':main()
