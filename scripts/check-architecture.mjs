import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../apps/api/src/orgo");
function files(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? files(path.join(dir, e.name))
        : e.name.endsWith(".ts")
          ? [path.join(dir, e.name)]
          : [],
    );
}
const failures = [];
for (const file of files(root)) {
  const rel = path.relative(root, file).replaceAll("\\", "/"),
    source = fs.readFileSync(file, "utf8");
  if (
    /modules\/domains\//.test(rel) &&
    /\.(task|case)\.(create|update|upsert|delete)|\$executeRaw|\$queryRaw/.test(
      source,
    )
  )
    failures.push(`${rel}: domain bypasses Work owner`);
  if (
    /modules\/insights\//.test(rel) &&
    /\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(|\$executeRaw/.test(
      source,
    )
  )
    failures.push(`${rel}: Insights mutates state`);
  if (
    /^integrations\//.test(rel) &&
    /@prisma\/client|platform\/database|PrismaClient/.test(source)
  )
    failures.push(`${rel}: adapter accesses persistence`);
  if (
    /modules\/work\//.test(rel) &&
    /from ['"].*(domains|integrations|intake|orchestration)/.test(source)
  )
    failures.push(`${rel}: Work imports downstream context`);
  if (
    rel.endsWith("/evaluator.ts") &&
    /Date\.|Math.random|fetch\(|@nestjs|database|readFile|writeFile/.test(
      source,
    )
  )
    failures.push(`${rel}: evaluator is not pure`);
  if (
    /modules\/domains\//.test(rel) &&
    /from ['"].*work\/(?!public)/.test(source)
  )
    failures.push(`${rel}: domain imports private Work implementation`);
  for (const match of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const target = path.resolve(path.dirname(file), match[1]);
    if (
      ![".ts", ".tsx", "/index.ts"].some((ext) => fs.existsSync(target + ext))
    )
      failures.push(`${rel}: unresolved import ${match[1]}`);
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else console.log("Architecture checks passed.");
