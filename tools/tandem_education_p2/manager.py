"""Stdlib-only, snapshot-hash-pinned, no-network Tandem education P2 installer.

No app/backend/data store is read or written except the manifest-selected source files.
"""
from __future__ import annotations
import hashlib, json, os, shutil, subprocess, sys, tempfile
from datetime import datetime, timezone
from pathlib import Path
PKG=Path(__file__).resolve().parent
ROOT=PKG.parents[1]
MANIFEST=json.loads((PKG/'manifest.json').read_text(encoding='utf-8'))

def sha(path):
    if not path.is_file(): return None
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b''):h.update(chunk)
    return h.hexdigest()

def reject(message):raise RuntimeError(message)

def safe_rel(raw):
    if not isinstance(raw,str) or not raw or raw.startswith('/') or ':' in raw or '\\' in raw or any(x in ('','.', '..') for x in raw.split('/')): reject('Unsafe manifest path: '+str(raw))
    return Path(*raw.split('/'))

def secure(root,rel):
    root=root.resolve(strict=True)
    target=root/safe_rel(rel)
    p=target
    while p!=root:
        if p.is_symlink(): reject('Symbolic link denied: '+rel)
        if p==p.parent:reject('Path outside root')
        p=p.parent
    return target

def check_integrity():
    if not (ROOT/MANIFEST['sentinel']).is_file():reject('Expected repository root not found: '+str(ROOT))
    seen=set()
    for rel,old in MANIFEST['anchors'].items():
        src=secure(ROOT,rel)
        if sha(src)!=old:reject('Anchor SHA-256 mismatch (updated source differs): '+rel)
    for spec in MANIFEST['files']:
        rel=spec['path']
        if rel in seen:reject('Duplicate source path')
        seen.add(rel)
        candidate=secure(PKG,'payload/'+rel)
        if sha(candidate)!=spec['new']:reject('Payload SHA-256 mismatch: '+rel)

def scan():
    checked=[]
    for spec in MANIFEST['files']:
        rel=spec['path']; dest=secure(ROOT,rel)
        if dest.exists() and not dest.is_file():status='CONFLICT'
        else:
            old=sha(dest)
            if old==spec['new']:status='ALREADY_UPDATED'
            elif old==spec['old']:status='READY'
            else:status='CONFLICT'
        print(f'[{status}] {rel}')
        checked.append((spec,status))
    if any(s=='CONFLICT' for _,s in checked):reject('Snapshot SHA-256 divergence; no source overwritten')
    return checked

def atomic(dst,body):
    dst.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='wb',delete=False,dir=dst.parent,prefix='.tandem-p2-') as output:
        tmp=Path(output.name);output.write(body)
    try:os.replace(tmp,dst)
    finally:tmp.unlink(missing_ok=True)

def copy_to_temp(root,patched):
    temp=root/'repo';temp.mkdir()
    for raw in MANIFEST['test_copy']:
        src=secure(ROOT,raw);dst=temp/safe_rel(raw)
        if not src.exists():
            if patched and (raw in {e['path'] for e in MANIFEST['files']} or any(e['path'].startswith(raw+'/') for e in MANIFEST['files'])):continue
            reject('Missing test source: '+raw)
        if src.is_dir():shutil.copytree(src,dst,ignore=shutil.ignore_patterns('__pycache__','.pytest_cache','*.pyc','node_modules','dist','.git'),symlinks=False)
        elif src.is_file():dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst)
        else:reject('Nonregular test source: '+raw)
    if patched:
        for spec in MANIFEST['files']:
            rel=spec['path'];dst=temp/safe_rel(rel)
            dst.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(PKG/'payload'/safe_rel(rel),dst)
    return temp

def tests(patched):
    with tempfile.TemporaryDirectory(prefix='tandem-edu-p2-') as name:
        work=copy_to_temp(Path(name),patched)
        env=dict(os.environ, PYTHONUTF8='1',PYTHONIOENCODING='utf-8',PYTHONPATH=str(work/'src'),NO_COLOR='1')
        for argv in MANIFEST['tests']:
            command=[sys.executable if x=='{PYTHON}' else x for x in argv]
            print('[TEST]', ' '.join(command),flush=True)
            run=subprocess.run(command,cwd=work,env=env,stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,stderr=subprocess.STDOUT,encoding='utf-8',errors='replace',timeout=100,check=False)
            print(run.stdout[-5500:],flush=True)
            if run.returncode:reject('Isolated tests failed (exit '+str(run.returncode)+'): '+' '.join(argv))
    print('[PASS] Isolated test suite, no services or database')

def local():return ROOT.parent/'Tandem_Local'/MANIFEST['id']

def rollback():
    current=local()/'current.json'
    if not current.is_file():reject('No current backup available')
    state=json.loads(current.read_text(encoding='utf-8'))
    backup=local()/'backups'/state['stamp']
    if not backup.is_dir():reject('Backup directory missing')
    for e in state['files']:
        dest=secure(ROOT,e['path'])
        if sha(dest)!=e['new']:reject('Rollback refused: installed source changed: '+e['path'])
        if e['old'] is not None and sha(secure(backup,e['path']))!=e['old']:reject('Backup SHA-256 differs: '+e['path'])
    for e in state['files']:
        dst=secure(ROOT,e['path'])
        if e['old'] is None:dst.unlink()
        else:atomic(dst,secure(backup,e['path']).read_bytes())
        print('[RESTORED]',e['path'])
    current.unlink()
    print('[OK] Rollback completed')

def install(checked):
    changed=[e for e,s in checked if s=='READY']
    if not changed:print('[OK] Already installed; no files modified');return
    tests(True)
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup=local()/'backups'/stamp
    backup.mkdir(parents=True,exist_ok=False)
    for e in changed:
        if e['old'] is not None:
            dst=secure(backup,e['path']);dst.parent.mkdir(parents=True,exist_ok=True)
            src=secure(ROOT,e['path']);shutil.copy2(src,dst)
            if sha(dst)!=e['old']:reject('Backup validation failed')
    written=[]
    try:
        for e in changed:
            dst=secure(ROOT,e['path'])
            if sha(dst)!=e['old']:reject('Concurrent source changed')
            atomic(dst,secure(PKG,'payload/'+e['path']).read_bytes());written.append(e)
        scan();tests(False)
    except BaseException:
        for e in reversed(written):
            dst=secure(ROOT,e['path'])
            if e['old'] is None:
                if sha(dst)==e['new']:dst.unlink()
            else:atomic(dst,secure(backup,e['path']).read_bytes())
        print('[ROLLBACK AUTO] Restored sources after installer failure')
        raise
    state={'stamp':stamp,'files':changed}
    atomic(local()/'current.json',(json.dumps(state,indent=2)+'\n').encode('utf-8'))
    print('[OK] Installed. Backup:',backup)

def main():
    mode=sys.argv[1].upper() if len(sys.argv)>1 else 'PREVIEW'
    print('===',MANIFEST['title'],'/',mode,'===',flush=True)
    print('[REPO]',ROOT)
    print('[SCOPE] Local source/fixtures only; NO DB, network, Docker, VPS, child account or Orgo apply')
    check_integrity()
    if mode=='ROLLBACK':rollback();return
    checked=scan()
    if mode=='PREVIEW':print('[OK] Read-only preview; source hashes match');return
    if mode=='INSTALL':install(checked);return
    if mode=='VERIFY':
        if any(s!='ALREADY_UPDATED' for _,s in checked):reject('Patch missing or incomplete')
        tests(False)
        print('[OK] Installed sources and offline tests verified; runtime Orgo not qualified');return
    reject('Unknown command')
if __name__=='__main__':
    try:main()
    except Exception as exc:
        print('[FAIL]',exc,file=sys.stderr)
        sys.exit(1)
