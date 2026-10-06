import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const root = path.resolve(import.meta.dirname, '..');
const apiPort = Number(process.env.KOALI_ORGO_BACKEND_PORT || process.env.PORT || 4303);
const dbPort = Number(process.env.KOALI_ORGO_DB_PORT || 55432);
if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) throw new Error('Invalid Orgo API port');
if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535) throw new Error('Invalid Orgo PGlite port');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres?connection_limit=4`;
const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  PORT: String(apiPort),
  ORGO_LOCAL_AUTO_LOGIN: 'true',
  ORGO_ORGANIZATION: process.env.ORGO_ORGANIZATION || 'orgo',
  ORGO_ADMIN_EMAIL: process.env.ORGO_ADMIN_EMAIL || 'admin@example.test',
  ORGO_ADMIN_PASSWORD: process.env.ORGO_ADMIN_PASSWORD || 'koali-local-dev-admin-password-01',
  NEXT_TELEMETRY_DISABLED: '1',
};

function runNpm(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(npm, args, { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`npm ${args.join(' ')} exited (${signal ?? code ?? 'unknown'})`));
    });
  });
}

const db = await PGlite.create();
const migrations = path.join(root, 'apps', 'api', 'prisma', 'migrations');
for (const name of (await readdir(migrations)).sort()) {
  if (!/^\d/.test(name)) continue;
  await db.exec(await readFile(path.join(migrations, name, 'migration.sql'), 'utf8'));
}
const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: dbPort, maxConnections: 16 });
await socket.start();
console.log(JSON.stringify({ event: 'orgo.koali.pglite.ready', port: dbPort }));

await runNpm(['run', 'db:seed']);

const children = [];
function start(label, args) {
  const child = spawn(npm, args, { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' });
  children.push({ label, child });
  child.once('error', (error) => {
    console.error(`[orgo:koali] ${label} failed: ${error.message}`);
    void shutdown(1);
  });
  child.once('exit', (code, signal) => {
    if (stopping) return;
    console.error(`[orgo:koali] ${label} exited (${signal ?? code ?? 'unknown'})`);
    void shutdown(code === 0 ? 1 : (code ?? 1));
  });
}

let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const { child } of children) {
    if (child.exitCode == null && child.signalCode == null) {
      try { child.kill('SIGTERM'); } catch {}
    }
  }
  await Promise.all(children.map(({ child }) => new Promise((resolve) => {
    if (child.exitCode != null || child.signalCode != null) return resolve();
    const timer = setTimeout(resolve, 2500);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  })));
  try { await socket.stop(); } catch {}
  try { await db.close(); } catch {}
  process.exit(code);
}

process.once('SIGINT', () => void shutdown(0));
process.once('SIGTERM', () => void shutdown(0));
start('api', ['run', 'dev:api']);
start('worker', ['run', 'worker']);
