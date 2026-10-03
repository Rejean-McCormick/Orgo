#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote, urlparse

import httpx
from cryptography.fernet import Fernet

ORGO_ROOT = Path(__file__).resolve().parents[2]
TARGET_TASK_TITLE = 'Documenter les deux sources et la chronologie'
TARGET_CASE_ID = 'CASE-DANCE-RED-001'


def iso_now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def orgo_request(client, method, path, *, token=None, body=None, idem=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    if idem:
        headers['Idempotency-Key'] = idem
    response = client.request(method, path, headers=headers, json=body)
    try:
        payload = response.json()
    except Exception:
        payload = {'raw': response.text}
    if response.status_code >= 400 or payload.get('ok') is False:
        raise RuntimeError(f'{method} {path} -> HTTP {response.status_code}: {json.dumps(payload, ensure_ascii=False)}')
    return payload['data'] if payload.get('ok') is True else payload


def build_and_apply_seed(args):
    source = args.konvergence_root / 'orgo' / 'examples' / 'cases.json'
    if not source.exists():
        raise RuntimeError(f'Konvergence cases file not found: {source}')
    scenario = ORGO_ROOT / 'validation' / 'kor-orgo-konvergence' / 'konvergence.scenario.json'
    report = ORGO_ROOT / 'validation' / 'kor-orgo-konvergence' / 'konvergence.import-report.json'
    subprocess.run([
        'node', str(ORGO_ROOT / 'tools/konvergence-seed/build-scenario.mjs'), str(source), str(scenario)
    ], check=True, cwd=ORGO_ROOT)
    env = os.environ.copy()
    env.update({
        'ORGO_SCENARIO_API_URL': args.orgo_url.rstrip('/') + '/api/v3',
        'ORGO_SCENARIO_ORGANIZATION': args.orgo_organization,
        'ORGO_SCENARIO_EMAIL': args.orgo_email,
        'ORGO_SCENARIO_PASSWORD': args.orgo_password,
    })
    subprocess.run([
        'node', str(ORGO_ROOT / 'tools/scenario-injector/cli.mjs'), 'inject', str(scenario), '--apply', '--report', str(report)
    ], check=True, cwd=ORGO_ROOT, env=env)
    return report


def main():
    parser = argparse.ArgumentParser(description='Konvergence seed -> Orgo -> Kor -> Orgo E2E qualification')
    parser.add_argument('--kor-root', type=Path, required=True)
    parser.add_argument('--konvergence-root', type=Path, required=True)
    parser.add_argument('--orgo-url', default=os.getenv('ORGO_E2E_URL', 'http://127.0.0.1:4000'))
    parser.add_argument('--orgo-organization', default=os.getenv('ORGO_E2E_ORGANIZATION', 'orgo'))
    parser.add_argument('--orgo-email', default=os.getenv('ORGO_E2E_EMAIL', 'admin@example.test'))
    parser.add_argument('--orgo-password', default=os.getenv('ORGO_E2E_PASSWORD'))
    parser.add_argument('--skip-seed', action='store_true')
    args = parser.parse_args()
    args.kor_root = args.kor_root.resolve()
    args.konvergence_root = args.konvergence_root.resolve()
    if not args.orgo_password:
        raise SystemExit('ORGO_E2E_PASSWORD or --orgo-password is required')

    if not args.skip_seed:
        build_and_apply_seed(args)

    kor_src = args.kor_root / 'src'
    lock = args.kor_root / 'deployments' / 'orgo' / 'ik.lock.json'
    if not kor_src.exists() or not lock.exists():
        raise RuntimeError('Patched Kor source/deployments/orgo lock not found')
    sys.path.insert(0, str(kor_src))
    from fastapi.testclient import TestClient
    from kor_service.app import create_app
    from kor_service.config import Settings

    base = args.orgo_url.rstrip('/')
    with httpx.Client(base_url=base, timeout=15) as orgo:
        login = orgo_request(orgo, 'POST', '/api/v3/auth/login', body={
            'organization': args.orgo_organization,
            'email': args.orgo_email,
            'password': args.orgo_password,
        })
        admin_token = login['token']
        organization_id = login['context']['organizationId']

        tasks = orgo_request(orgo, 'GET', f'/api/v3/tasks?search={quote(TARGET_TASK_TITLE, safe="")}&limit=100', token=admin_token)
        matches = [
            row for row in tasks.get('items', [])
            if row.get('title') == TARGET_TASK_TITLE
            and isinstance(row.get('metadata'), dict)
            and row['metadata'].get('source_case_id') == TARGET_CASE_ID
        ]
        if len(matches) != 1:
            raise RuntimeError(f'Expected exactly one seeded target task, found {len(matches)}')
        task = matches[0]
        task_id = task['task_id']

        expires = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat().replace('+00:00', 'Z')
        issued = orgo_request(orgo, 'POST', '/api/v3/identity/tokens', token=admin_token, idem=str(uuid.uuid4()), body={
            'name': f'kor-e2e-{uuid.uuid4().hex[:10]}',
            'scopes': ['work:read', 'work:comment'],
            'expires_at': expires,
        })
        service_token = issued['token']
        service_token_id = issued['id']
        if not service_token:
            raise RuntimeError('Orgo token issuance did not return the one-time token secret')

        try:
            os.environ['ORGO_BASE_URL'] = base
            os.environ['ORGO_KOR_TOKEN'] = service_token
            os.environ['ORGO_ORGANIZATION_ID'] = organization_id
            parsed = urlparse(base)
            if parsed.scheme == 'http' and parsed.hostname in {'127.0.0.1', 'localhost', 'host.docker.internal'}:
                os.environ['KOR_ALLOW_INSECURE_LOCAL_ORGO'] = 'true'

            with tempfile.TemporaryDirectory(prefix='kor-orgo-e2e-') as td:
                tmp = Path(td)
                kor_token = 'kor-e2e-local-token'
                auth = tmp / 'auth.json'
                auth.write_text(json.dumps({
                    'mode': 'local',
                    'tokens': [{
                        'sha256': hashlib.sha256(kor_token.encode()).hexdigest(),
                        'tenant': 'e2e',
                        'subject': 'alice',
                        'scopes': ['interactions:submit', 'interactions:read'],
                    }],
                }), encoding='utf-8')
                key = tmp / 'data.key'
                key.write_bytes(Fernet.generate_key())
                settings = Settings(
                    database=tmp / 'kor.sqlite3',
                    contracts=args.kor_root,
                    auth_file=auth,
                    encryption_key_file=key,
                    ik_lock=lock,
                )
                app = create_app(settings)
                headers = {'Authorization': f'Bearer {kor_token}'}
                interaction_id = str(uuid.uuid4())
                idem = f'kor:konvergence:{TARGET_CASE_ID}:{task_id}:checkpoint-1'
                envelope = {
                    'specversion': 'ik/1.1',
                    'id': interaction_id,
                    'class': 'command',
                    'time': iso_now(),
                    'profile': {'id': 'orgo.work.status.submit', 'version': '1.1.0'},
                    'source': {'system': 'kor', 'instance': 'konvergence-e2e'},
                    'target': {'system': 'orgo', 'organization': organization_id},
                    'subject': {'type': 'task', 'id': task_id},
                    'correlation_id': f'konvergence:{TARGET_CASE_ID}',
                    'idempotency_key': idem,
                    'authority': {'kind': 'kor-user-action', 'context': {'subject_ref': 'alice'}},
                    'data': {
                        'schema_version': '1.1.0',
                        'work_ref': task_id,
                        'checkpoint_ref': 'konvergence-e2e',
                        'reported_at': iso_now(),
                        'report': 'E2E Kor → Orgo sur le seed Konvergence.',
                    },
                    'artifact_refs': [],
                    'response': {'acceptance_receipt': True, 'final_receipt': True},
                }
                with TestClient(app) as kor:
                    accepted = kor.post('/v1/interactions', json=envelope, headers=headers)
                    if accepted.status_code != 202:
                        raise RuntimeError(f'Kor admission failed: {accepted.status_code} {accepted.text}')
                    if not app.state.worker.once():
                        raise RuntimeError('Kor worker did not claim the queued interaction')
                    status = kor.get(f'/v1/interactions/{interaction_id}/status', headers=headers)
                    status.raise_for_status()
                    state = status.json()
                    if state['admission_state'] != 'accepted' or state['outcome_state'] != 'succeeded':
                        raise RuntimeError(f'Kor did not observe Orgo success: {state}')

                    replay = {**envelope, 'id': str(uuid.uuid4()), 'time': iso_now()}
                    replay_response = kor.post('/v1/interactions', json=replay, headers=headers)
                    if replay_response.status_code != 202 or replay_response.json()['outcome_state'] != 'succeeded':
                        raise RuntimeError(f'Semantic replay was not deduplicated: {replay_response.text}')

                    conflict = json.loads(json.dumps(envelope))
                    conflict['id'] = str(uuid.uuid4())
                    conflict['time'] = iso_now()
                    conflict['data']['report'] = 'Contenu divergent avec la même clé.'
                    conflict_response = kor.post('/v1/interactions', json=conflict, headers=headers)
                    if conflict_response.status_code != 409:
                        raise RuntimeError(f'Expected Kor idempotency conflict, got {conflict_response.status_code}: {conflict_response.text}')

                task_after = orgo_request(orgo, 'GET', f'/api/v3/tasks/{task_id}', token=service_token)
                bodies = [row.get('body', '') for row in task_after.get('comments', [])]
                marker = 'E2E Kor → Orgo sur le seed Konvergence.'
                if sum(marker in body for body in bodies) != 1:
                    raise RuntimeError('Expected exactly one Orgo Task comment from Kor after replay')

                print(json.dumps({
                    'ok': True,
                    'seed_case_id': TARGET_CASE_ID,
                    'task_id': task_id,
                    'kor_interaction_id': interaction_id,
                    'kor_transport_state': state['transport_state'],
                    'kor_admission_state': state['admission_state'],
                    'kor_outcome_state': state['outcome_state'],
                    'orgo_receipt_status': (state.get('ik_receipt') or {}).get('status'),
                    'replay_deduplicated': True,
                    'divergent_reuse_rejected': True,
                    'orgo_comment_count_for_marker': 1,
                }, indent=2, ensure_ascii=False))
        finally:
            try:
                orgo_request(orgo, 'DELETE', f'/api/v3/identity/tokens/{service_token_id}', token=admin_token, idem=str(uuid.uuid4()))
            except Exception as cleanup_error:
                print(f'warning: could not revoke temporary Kor token: {cleanup_error}', file=sys.stderr)


if __name__ == '__main__':
    main()
