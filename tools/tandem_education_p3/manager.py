"""Offline, SHA256 pinned, reversible Tandem Education P3 overlay manager."""
from __future__ import annotations
import hashlib, json, os, shutil, subprocess, sys, tempfile
from datetime import datetime, timezone
from pathlib import Path
PKG=Path(__file__).resolve().parent
ROOT=PKG.parents[1]
M=json.loads((PKG/'manifest.json').read_text(encoding='utf-8'))
def err(m): raise RuntimeError(m)
def digest(p):
    if not p.is_file() or p.is_symlink(): return None
    h=hashlib.sha256()
    with p.open('rb') as inp:
        for b in iter(lambda:inp.read(1048576),b''): h.update(b)
    return h.hexdigest()
def relpath(s):
    if not isinstance(s,str) or not s or s.startswith('/') or '\\' in s or ':' in s or any(part in ('','.','..') for part in s.split('/')):err('Untrusted path '+repr(s))
    return Path(*s.split('/'))
def safe(base,s):
    base=base.resolve(strict=True); p=base/relpath(s)
    t=p
    while t!=base:
        if t.is_symlink(): err('Symlink denied '+s)
        if t==t.parent: err('Path escape')
        t=t.parent
    return p
def atomic(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='wb',delete=False,dir=path.parent,prefix='.tandem-p3-') as out:
        tmp=Path(out.name);out.write(data)
    try:os.replace(tmp,path)
    finally:tmp.unlink(missing_ok=True)
def integrity():
    if not safe(ROOT,M['sentinel']).is_file():err('Wrong repository root')
    for k,v in M['anchors'].items():
        if digest(safe(ROOT,k))!=v:err('Anchor hash differs: '+k)
    for e in M['files']:
        if digest(safe(PKG,'payload/'+e['path']))!=e['new']:err('Payload hash differs: '+e['path'])
def scan():
    report=[]
    for e in M['files']:
        p=safe(ROOT,e['path']);value=digest(p)
        s='ALREADY_UPDATED' if value==e['new'] else 'READY' if value==e['old'] else 'CONFLICT'
        print(f'[{s}] {e["path"]}',flush=True); report.append((e,s))
    if any(s=='CONFLICT' for _,s in report):err('Unrecognized local sources: no writes')
    return report
def stage(root,patched):
    repo=root/'repo';repo.mkdir()
    for f in M['copy']:
        src=safe(ROOT,f);dst=repo/relpath(f)
        if not src.exists():
            if patched and any(e['path']==f or e['path'].startswith(f+'/') for e in M['files']): continue
            err('Missing test source: '+f)
        if src.is_dir():
            shutil.copytree(src,dst,symlinks=False,ignore=shutil.ignore_patterns('__pycache__','*.pyc','node_modules','.git','dist','.pytest_cache'))
        elif src.is_file(): dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst)
        else:err('Unsafe test source: '+f)
    if patched:
        for e in M['files']:
            dst=repo/relpath(e['path']);dst.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(safe(PKG,'payload/'+e['path']),dst)
    return repo
def tests(patched):
    with tempfile.TemporaryDirectory(prefix='tandem-edu-p3-') as td:
        r=stage(Path(td),patched)
        env=dict(os.environ,PYTHONIOENCODING='utf-8',PYTHONUTF8='1',PYTHONPATH=str(r/'src'),NO_COLOR='1')
        for argv in M['tests']:
            args=[sys.executable if x=='{PYTHON}' else x for x in argv]
            print('[TEST]',' '.join(args),flush=True)
            proc=subprocess.run(args,cwd=r,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,encoding='utf-8',errors='replace',timeout=120,check=False)
            print(proc.stdout[-7200:],flush=True)
            if proc.returncode:err('Isolated test failed with exit '+str(proc.returncode))
    print('[PASS] All selected offline tests on isolated repository',flush=True)
def statehome():return ROOT.parent/'Tandem_Local'/M['id']
def rollback():
    current=statehome()/'current.json'
    if not current.is_file():err('No rollback state')
    state=json.loads(current.read_text(encoding='utf-8'))
    back=statehome()/'backups'/state['stamp'];
    if not back.is_dir():err('Backup missing')
    for e in state['changed']:
        if digest(safe(ROOT,e['path']))!=e['new']:err('Rollback denied: installed file changed')
        if e['old'] is not None and digest(safe(back,e['path']))!=e['old']:err('Backup modified')
    for e in state['changed']:
        p=safe(ROOT,e['path'])
        if e['old'] is None:p.unlink()
        else:atomic(p,safe(back,e['path']).read_bytes())
        print('[RESTORED]',e['path'])
    current.unlink();print('[OK] Rollback complete')
def install(report):
    changes=[e for e,s in report if s=='READY']
    if not changes:print('[OK] Already installed');return
    tests(True)
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    back=statehome()/'backups'/stamp;back.mkdir(parents=True,exist_ok=False)
    for e in changes:
        if e['old'] is not None:
            src=safe(ROOT,e['path']);dst=safe(back,e['path']);dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst)
            if digest(dst)!=e['old']:err('Backup changed')
    written=[]
    try:
        for e in changes:
            dst=safe(ROOT,e['path'])
            if digest(dst)!=e['old']:err('Concurrent source edit: '+e['path'])
            atomic(dst,safe(PKG,'payload/'+e['path']).read_bytes());written.append(e)
        scan();tests(False)
    except BaseException:
        for e in reversed(written):
            dst=safe(ROOT,e['path'])
            if e['old'] is None and digest(dst)==e['new']:dst.unlink()
            elif e['old'] is not None:atomic(dst,safe(back,e['path']).read_bytes())
        print('[AUTO ROLLBACK] Restored installed sources')
        raise
    atomic(statehome()/'current.json',(json.dumps({'stamp':stamp,'changed':changes},indent=2)+'\n').encode())
    print('[OK] Installed, backup:',back)
def main():
    mode=sys.argv[1].upper() if len(sys.argv)>1 else 'PREVIEW'
    print('===',M['title'],'/',mode,'===',flush=True)
    print('[REPO]',ROOT,'\n[SCOPE] P3 authority preflight ONLY; no runtime authorization/DB/network/children/VPS',flush=True)
    integrity()
    if mode=='ROLLBACK':rollback();return
    report=scan()
    if mode=='PREVIEW':print('[OK] Read-only SHA-256 PREVIEW');return
    if mode=='INSTALL':install(report);return
    if mode=='VERIFY':
        if any(s!='ALREADY_UPDATED' for _,s in report):err('Patch incomplete')
        tests(False);print('[OK] P3 offline source and tests verified; runtime authorities NOT CONNECTED');return
    err('Unknown mode')
if __name__=='__main__':
    try:main()
    except Exception as e: print('[FAIL]',e,file=sys.stderr);sys.exit(1)
