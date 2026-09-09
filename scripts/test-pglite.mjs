import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
// Disposable test-only PostgreSQL WASM engine. CI also exercises native PostgreSQL.
const db = await PGlite.create();
const migrations = path.join(root, "apps/api/prisma/migrations");
for (const name of (await readdir(migrations)).sort()) {
  if (!/^\d/.test(name)) continue;
  await db.exec(
    await readFile(path.join(migrations, name, "migration.sql"), "utf8"),
  );
}
const server = new PGLiteSocketServer({
  db,
  host: "127.0.0.1",
  port: 55432,
  maxConnections: 8,
});
await server.start();
const files = (await readdir(path.join(root, "apps/api/test/integration")))
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => `test/integration/${f}`);
const child = spawn(
  process.execPath,
  ["--import", "tsx", "--test", "--test-concurrency=1", ...files],
  {
    cwd: path.join(root, "apps/api"),
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL:
        "postgresql://postgres:postgres@127.0.0.1:55432/postgres?connection_limit=1",
      ORGO_TEST_ENGINE: "pglite",
    },
  },
);
const code = await new Promise((resolve) => child.once("exit", resolve));
await server.stop();
await db.close();
process.exitCode = code ?? 1;
