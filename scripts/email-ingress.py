#!/usr/bin/env python3
"""Bounded MIME/IMAP adapter. Tenant comes exclusively from ORGO_INGRESS_TOKEN.
Import one .eml, an mbox, or poll IMAP. IMAP is marked Seen only after durable acceptance.
Uses Python standard library; no application SDK or provider dependency.
"""
import argparse, base64, email.policy, hashlib, imaplib, json, mailbox, os, re, ssl, sys, time
from email.parser import BytesParser
from email.utils import getaddresses
from pathlib import Path
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.parse import urlparse
MAX_MESSAGE = 2 * 1024 * 1024
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def normalize(raw):
    if len(raw) > MAX_MESSAGE:
        raise ValueError('MIME message exceeds 2 MiB; quarantine it manually')
    message = BytesParser(policy=email.policy.default).parsebytes(raw)
    senders = getaddresses(message.get_all('from', []))
    recipients = getaddresses(message.get_all('to', []) + message.get_all('cc', []))
    if not senders or not recipients:
        raise ValueError('Missing sender or recipients')
    attachments, total = [], 0
    for part in message.walk():
        if part.is_multipart():
            continue
        if part.get_filename() or part.get_content_disposition() == 'attachment':
            content = part.get_payload(decode=True) or b''
            total += len(content)
            if total > 1048576 or len(attachments) >= 30:
                raise ValueError('Attachments exceed 1 MiB or 30 files')
            filename = re.sub(r'[/\\\x00-\x1f\x7f]', '_', part.get_filename() or 'attachment.bin')[:200]
            attachments.append({'filename': filename, 'media_type': part.get_content_type(), 'content_base64': base64.b64encode(content).decode('ascii')})
    body = message.get_body(preferencelist=('plain',))
    # HTML-only content is retained as text source; it is never rendered as trusted markup.
    if body is None:
        body = message.get_body(preferencelist=('html',))
    text = str(body.get_content()) if body else ''
    result = {'message_id': str(message.get('Message-ID') or 'sha256:' + hashlib.sha256(raw).hexdigest())[:500],
              'from': senders[0][1], 'to': [address for _, address in recipients][:100],
              'subject': str(message.get('Subject') or '(sans objet)')[:500], 'text': text[:100000],
              'label': os.environ['ORGO_EMAIL_LABEL'], 'attachments': attachments}
    for key, env in [('case_id', 'ORGO_EMAIL_CASE_ID'), ('workflow_version_id', 'ORGO_EMAIL_WORKFLOW_VERSION')]:
        if os.getenv(env):
            result[key] = os.environ[env]
    return result

def deliver(raw):
    data = normalize(raw)
    base = os.environ['ORGO_API_URL'].rstrip('/')
    url = urlparse(base)
    if url.scheme != 'https' and not (url.scheme == 'http' and url.hostname in ('localhost', '127.0.0.1', 'api')):
        raise ValueError('Use HTTPS or a local API URL')
    key = hashlib.sha256(data['message_id'].encode()).hexdigest()
    request = Request(base + '/api/v3/ingress/email', data=json.dumps(data).encode(),
                      headers={'Authorization': 'Bearer ' + os.environ['ORGO_INGRESS_TOKEN'], 'Content-Type': 'application/json', 'Idempotency-Key': key})
    with build_opener(NoRedirect()).open(request, timeout=30) as response:
        result = json.load(response)
        if not result.get('ok'):
            raise ValueError('Orgo rejected the message')
        print(json.dumps({'accepted': True, 'signal_id': result['data']['id']}), flush=True)

def poll_once():
    with imaplib.IMAP4_SSL(os.environ['IMAP_HOST'], int(os.getenv('IMAP_PORT', '993')), ssl_context=ssl.create_default_context()) as server:
        server.login(os.environ['IMAP_USER'], os.environ['IMAP_PASSWORD'])
        status, _ = server.select(os.getenv('IMAP_FOLDER', 'INBOX'))
        if status != 'OK':
            raise ValueError('Unable to select mailbox')
        status, results = server.uid('search', None, 'UNSEEN')
        if status != 'OK':
            raise ValueError('Unable to search mailbox')
        for uid in results[0].split()[:50]:
            status, size_result = server.uid('fetch', uid, '(RFC822.SIZE)')
            metadata = b' '.join(item for item in size_result if isinstance(item, bytes))
            match = re.search(rb'RFC822.SIZE (\d+)', metadata)
            if status != 'OK' or not match or int(match.group(1)) > MAX_MESSAGE:
                print('Message skipped: missing size or oversized', file=sys.stderr)
                continue
            status, parts = server.uid('fetch', uid, '(BODY.PEEK[])')
            raw = next((part[1] for part in parts if isinstance(part, tuple)), None)
            if status != 'OK' or raw is None:
                continue
            try:
                deliver(raw)
                server.uid('store', uid, '+FLAGS.SILENT', '(\\Seen)')
            except Exception as exc:
                # Leave unseen for a stable-id retry; don't emit message contents, tokens or URLs.
                print('Message not accepted: ' + type(exc).__name__, file=sys.stderr)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--eml', type=Path)
    source.add_argument('--mbox', type=Path)
    source.add_argument('--imap', action='store_true')
    parser.add_argument('--watch', action='store_true')
    args = parser.parse_args()
    if args.eml:
        with args.eml.open('rb') as file:
            deliver(file.read(MAX_MESSAGE + 1))
    elif args.mbox:
        box = mailbox.mbox(args.mbox, create=False)
        try:
            for key in box.iterkeys():
                with box.get_file(key) as file:
                    deliver(file.read(MAX_MESSAGE + 1))
        finally:
            box.close()
    else:
        while True:
            try:
                poll_once()
            except Exception as exc:
                print('Mailbox polling failed: ' + type(exc).__name__, file=sys.stderr)
                if not args.watch:
                    raise SystemExit(1)
            if not args.watch:
                break
            time.sleep(30)
