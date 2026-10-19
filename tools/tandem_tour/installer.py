#!/usr/bin/env python3
"""Strict snapshot-bound Orgo security overlay. No network, database or service operations."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
PAYLOAD = HERE / 'payload'
MANIFEST = json.loads((HERE / 'manifest.json').read_text(encoding='utf-8'))
FILES = MANIFEST['files']
BACKUP_ROOT = ROOT.parent / 'Tandem_Local' / 'orgo_tour_p1' / 'backups'
LAST = BACKUP_ROOT.parent / 'last_backup.json'


def digest(p: Path) -> str | None:
    if not p.is_file():
        return None
    return hashlib.sha256(p.read_bytes()).hexdigest()


def status(rel: str, spec: dict) -> str:
    current = digest(ROOT / rel)
    if current == spec['after']:
        return 'ALREADY_UPDATED'
    if current == spec['before']:
        return 'READY'
    return 'CONFLICT'


def check(strict: bool = True) -> dict[str, str]:
    print('=== ORGO / TANDEM / TOUR 2 SUR 8 / P1 ===')
    print(f'[REPO] {ROOT}')
    print('[PORTEE] Code local uniquement. Aucun Docker, DB, VPS ou tenant modifie.')
    if not (ROOT / 'AGENTS.md').is_file() or not (ROOT / 'apps/api/prisma/schema.prisma').is_file():
        raise RuntimeError('Racine Orgo incorrecte; extraire dans C:\\mycode\\Orgo\\Orgo')
    states = {}
    for rel, spec in FILES.items():
        if digest(PAYLOAD / rel) != spec['after']:
            raise RuntimeError(f'Payload altere : {rel}')
        name = status(rel, spec)
        states[rel] = name
        print(f'[{name}] {rel}')
    if strict and 'CONFLICT' in states.values():
        raise RuntimeError('Conflit de fichiers : rien ne sera ecrase')
    return states


def tests(root: Path) -> None:
    target = root / 'tools/tandem_tour/tests/verify-orgo-tour.mjs'
    print('[TEST] 12 controles autonomes Node/TypeScript, sans DB ni Docker ...')
    cp = subprocess.run(['node', '--no-warnings', '--experimental-strip-types', '--test', str(target)], cwd=root, text=True, capture_output=True, timeout=45, check=False)
    print(cp.stdout.rstrip()[-6000:])
    if cp.returncode:
        print(cp.stderr.rstrip()[-1500:])
        raise RuntimeError(f'Tests autonomes echoues (code={cp.returncode})')
    if '# pass 12' not in cp.stdout or '# fail 0' not in cp.stdout:
        raise RuntimeError('Resultat des tests incomplet')


def atomic_write(dst: Path, source: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(dst.name + '.tandem_p1_tmp')
    try:
        shutil.copy2(source, tmp)
        os.replace(tmp, dst)
    finally:
        if tmp.exists():
            tmp.unlink()


def snapshot_test() -> None:
    with tempfile.TemporaryDirectory(prefix='orgo-tandem-p1-') as tmp:
        stage = Path(tmp) / 'Orgo'
        shutil.copytree(ROOT, stage, ignore=shutil.ignore_patterns('.git', 'node_modules', '.next', 'dist', '.turbo'))
        for rel in FILES:
            target = stage / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(PAYLOAD / rel, target)
        tests(stage)


def do_install() -> None:
    states = check()
    if all(v == 'ALREADY_UPDATED' for v in states.values()):
        print('[OK] Installation deja presente; aucun fichier modifie.')
        tests(ROOT)
        return
    snapshot_test()
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = BACKUP_ROOT / stamp
    backup.mkdir(parents=True, exist_ok=False)
    updates = [rel for rel, v in states.items() if v == 'READY']
    record = {'backup': str(backup), 'repository': str(ROOT), 'files': {}}
    for rel in updates:
        existing = ROOT / rel
        has_old = existing.is_file()
        if has_old:
            copy = backup / rel
            copy.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(existing, copy)
        record['files'][rel] = {'before': FILES[rel]['before'], 'after': FILES[rel]['after'], 'existing': has_old}
    (backup / 'manifest.json').write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
    written = []
    try:
        if any(status(rel, FILES[rel]) != 'READY' for rel in updates):
            raise RuntimeError('Derive locale pendant la preverification')
        for rel in updates:
            atomic_write(ROOT / rel, PAYLOAD / rel)
            written.append(rel)
        if any(digest(ROOT / rel) != FILES[rel]['after'] for rel in updates):
            raise RuntimeError('Empreinte post-copie divergente')
        tests(ROOT)
    except BaseException:
        for rel in reversed(written):
            info = record['files'][rel]
            if info['existing']:
                atomic_write(ROOT / rel, backup / rel)
            else:
                (ROOT / rel).unlink(missing_ok=True)
        print('[ROLLBACK AUTOMATIQUE] Installation interrompue, fichiers retablis.')
        raise
    BACKUP_ROOT.parent.mkdir(parents=True, exist_ok=True)
    LAST.write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding='utf8')
    print(f'[OK] Orgo Tour P1 installe; sauvegarde : {backup}')
    print('[INFO] Services Orgo/Docker et bases non touches, aucune migration executee.')


def do_rollback() -> None:
    if not LAST.is_file():
        raise RuntimeError('Aucune sauvegarde enregistree')
    record = json.loads(LAST.read_text(encoding='utf8'))
    if record['repository'] != str(ROOT):
        raise RuntimeError('Sauvegarde associee a un autre depot')
    backup = Path(record['backup'])
    if not backup.is_dir() or backup.parent != BACKUP_ROOT:
        raise RuntimeError('Chemin de sauvegarde non conforme')
    for rel, info in record['files'].items():
        if rel not in FILES or digest(ROOT / rel) != info['after']:
            raise RuntimeError(f'Derive depuis installation, retour arriere refuse : {rel}')
        if info['existing'] and digest(backup / rel) != info['before']:
            raise RuntimeError(f'Sauvegarde modifiee : {rel}')
    for rel, info in record['files'].items():
        if info['existing']:
            atomic_write(ROOT / rel, backup / rel)
        else:
            (ROOT / rel).unlink(missing_ok=True)
    LAST.unlink()
    print('[OK] Restauration locale des fichiers modifications; aucun runtime touche.')


def main() -> int:
    try:
        mode = sys.argv[1] if len(sys.argv) > 1 else ''
        if mode == 'preview':
            check()
            print('[OK] Apercu favorable, lecture seule.')
        elif mode == 'install':
            do_install()
        elif mode == 'verify':
            states = check()
            if not all(v == 'ALREADY_UPDATED' for v in states.values()):
                raise RuntimeError('Correctif partiel ou non installe')
            tests(ROOT)
            print('[OK] Orgo P1 : fichiers et tests autonomes conformes.')
        elif mode == 'rollback':
            do_rollback()
        else:
            raise RuntimeError('Usage : installer.py preview|install|verify|rollback')
        return 0
    except (OSError, RuntimeError, ValueError, subprocess.TimeoutExpired) as exc:
        print(f'[ECHEC] {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
