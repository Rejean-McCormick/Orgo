import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const database = process.env.TEST_DATABASE_URL;
if (!database)
  throw new Error(
    "Set TEST_DATABASE_URL to an isolated PostgreSQL database; production databases are not accepted.",
  );
const url = new URL(database);
if (!/test|validation/i.test(url.pathname))
  throw new Error(
    "Use a dedicated database whose name includes test or validation.",
  );
const env = {
  ...process.env,
  DATABASE_URL: database,
  NEXT_TELEMETRY_DISABLED: "1",
};
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = path.join(root, "validation", `local-${stamp}`);
mkdirSync(destination, { recursive: true });
const steps = [
  "db:generate",
  "db:migrate",
  "check:architecture",
  "typecheck",
  "test",
  "test:integration",
  "build",
];
const results = [];
for (const step of steps) {
  console.log(`Running ${step}…`);
  const result = spawnSync("npm", ["run", step], {
    cwd: root,
    env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  writeFileSync(
    path.join(destination, step.replaceAll(":", "-") + ".log"),
    (result.stdout ?? "") +
      (result.stderr ?? "") +
      (result.error?.message ?? ""),
  );
  results.push({ step, status: result.status ?? 1 });
  writeFileSync(
    path.join(destination, "results.json"),
    JSON.stringify({ created_at: stamp, results }, null, 2),
  );
  if (result.status !== 0) {
    console.error(`Failed: ${step}. Read ${destination}`);
    process.exitCode = 1;
    break;
  }
}
if (!process.exitCode)
  console.log(
    `Automated validation finished. Browser, external-provider and restore checks remain: ${destination}`,
  );
