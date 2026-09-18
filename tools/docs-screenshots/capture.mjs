import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

function parseDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const raw of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

const dotEnv = parseDotEnv(path.join(repoRoot, ".env"));
const env = { ...dotEnv, ...process.env };

const baseURL = (env.ORGO_DOCS_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const parsedBase = new URL(baseURL);
const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
if (!localHosts.has(parsedBase.hostname) && env.ORGO_DOCS_ALLOW_REMOTE !== "1") {
  throw new Error(
    "Documentation screenshots are restricted to localhost by default. " +
      "Set ORGO_DOCS_ALLOW_REMOTE=1 only if you intentionally want to capture a remote instance."
  );
}

const date = env.ORGO_DOCS_DATE || new Date().toISOString().slice(0, 10);
const outputDir = env.ORGO_DOCS_OUTPUT
  ? path.resolve(repoRoot, env.ORGO_DOCS_OUTPUT)
  : path.join(repoRoot, "docs", "screenshots", date);

const width = Number(env.ORGO_DOCS_VIEWPORT_WIDTH || 1440);
const height = Number(env.ORGO_DOCS_VIEWPORT_HEIGHT || 1000);
const fullPage = env.ORGO_DOCS_FULL_PAGE === "1";

fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: 1,
  colorScheme: "light",
  reducedMotion: "reduce",
  locale: "en-CA",
});
const page = await context.newPage();

const captured = [];
const skipped = [];

function route(pathname) {
  return `${baseURL}/${String(pathname).replace(/^\/+/, "")}`;
}

async function settle() {
  await page.locator(".oim-loading").waitFor({ state: "detached", timeout: 8000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  }).catch(() => {});
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition: none !important;
        caret-color: transparent !important;
      }
      html { scroll-behavior: auto !important; }
    `,
  }).catch(() => {});
  await page.waitForTimeout(120);
}

async function ensureAuthenticated() {
  await page.goto(route("today"), { waitUntil: "domcontentloaded" });

  const app = page.locator(".app");
  const login = page.locator("form.login-form");

  await Promise.race([
    app.waitFor({ state: "visible", timeout: 15000 }).catch(() => null),
    login.waitFor({ state: "visible", timeout: 15000 }).catch(() => null),
  ]);

  if (await login.isVisible().catch(() => false)) {
    const organization =
      env.ORGO_DOCS_ORGANIZATION || env.ORGO_ORGANIZATION || "orgo";
    const email = env.ORGO_DOCS_EMAIL || env.ORGO_ADMIN_EMAIL;
    const password = env.ORGO_DOCS_PASSWORD || env.ORGO_ADMIN_PASSWORD;

    if (!email || !password) {
      throw new Error(
        "Orgo requires a login and no documentation credentials are available. " +
          "Either enable ORGO_LOCAL_AUTO_LOGIN=true for your local instance, " +
          "or provide ORGO_DOCS_EMAIL / ORGO_DOCS_PASSWORD (or the existing ORGO_ADMIN_* values) in .env."
      );
    }

    await page.locator('input[name="organization"]').fill(organization);
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await app.waitFor({ state: "visible", timeout: 20000 });
  }

  await settle();
}

async function openPath(pathname, expectedHeading) {
  await page.goto(route(pathname), { waitUntil: "domcontentloaded" });
  await page.locator(".app").waitFor({ state: "visible", timeout: 15000 });
  if (expectedHeading) {
    await page.getByRole("heading", { name: expectedHeading, exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 12000 })
      .catch(() => {});
  }
  await settle();
}

async function shot(file, title, sourcePath) {
  const target = path.join(outputDir, file);
  await page.screenshot({ path: target, fullPage });
  captured.push({ file, title, sourcePath });
  console.log(`Captured ${file}`);
}

async function captureRoute(file, title, pathname, heading = title) {
  await openPath(pathname, heading);
  await shot(file, title, pathname);
}

async function firstWorkroomPath(selector = ".workroom-card") {
  await openPath("workrooms", "Workrooms");
  const card = page.locator(selector).first();
  if (!(await card.count())) return null;
  await card.click();
  await page.locator(".workroom-page").waitFor({ state: "visible", timeout: 12000 });
  await settle();
  return new URL(page.url()).pathname.replace(/^\/+/, "");
}

try {
  await ensureAuthenticated();

  await captureRoute("01-today.png", "Today", "today", "Today");
  await captureRoute("02-my-work.png", "My Work", "my-work", "My Work");
  await captureRoute("03-workrooms.png", "Workrooms", "workrooms", "Workrooms");

  const workroomPath =
    env.ORGO_DOCS_WORKROOM_ID
      ? `workrooms/${encodeURIComponent(env.ORGO_DOCS_WORKROOM_ID)}`
      : await firstWorkroomPath();

  if (workroomPath) {
    const id = workroomPath.split("/")[1];
    const lenses = [
      ["04-workroom-overview.png", "Workroom — Overview", "overview"],
      ["05-workroom-actions.png", "Workroom — Actions", "actions"],
      ["06-workroom-plan.png", "Workroom — Plan", "plan"],
      ["07-workroom-decisions.png", "Workroom — Decisions", "decisions"],
      ["08-workroom-evidence.png", "Workroom — Evidence", "evidence"],
      ["09-workroom-people.png", "Workroom — People", "people"],
      ["10-workroom-timeline.png", "Workroom — Timeline", "timeline"],
      ["11-workroom-review.png", "Workroom — Review", "review"],
    ];
    for (const [file, title, lens] of lenses) {
      await openPath(`workrooms/${id}/${lens}`);
      await page.locator(".workroom-page").waitFor({ state: "visible", timeout: 12000 });
      await settle();
      await shot(file, title, `workrooms/${id}/${lens}`);
    }
  } else {
    skipped.push("Workroom detail lenses: no Workroom exists in the current local dataset.");
  }

  await captureRoute("12-intake.png", "Intake", "intake", "Intake");

  // Team and Situation are Supervisor-profile surfaces. Change profile in-app so
  // the selected presentation composition is retained without a page reload.
  await openPath("today", "Today");
  const profile = page.locator(".profile-label select");
  if (await profile.count()) {
    await profile.selectOption({ label: "Supervisor" });
    await page.getByRole("heading", { name: "Team", exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 12000 })
      .catch(() => {});
    await settle();
    await shot("13-team.png", "Team", "profile:Supervisor/team");

    const situationButton = page.getByRole("button", { name: "Situation", exact: true }).first();
    if (await situationButton.count()) {
      await situationButton.click();
      await page.getByRole("heading", { name: "Situation", exact: true })
        .first()
        .waitFor({ state: "visible", timeout: 12000 })
        .catch(() => {});
      await settle();
      await shot("14-situation.png", "Situation", "profile:Supervisor/situation");
    } else {
      skipped.push("Situation: Supervisor profile does not expose the Situation surface.");
    }

    await profile.selectOption({ label: "Full Control Panel" }).catch(() => {});
    const casesButton = page.getByRole("button", { name: "Cases", exact: true }).first();
    if (await casesButton.count()) {
      await casesButton.click();
      await page.getByRole("heading", { name: "Cases", exact: true })
        .first()
        .waitFor({ state: "visible", timeout: 12000 })
        .catch(() => {});
      await settle();
      await shot("15-full-control-panel.png", "Full Control Panel", "profile:Full Control Panel/cases");
    } else {
      skipped.push("Full Control Panel: Cases surface unavailable for this actor.");
    }
  } else {
    skipped.push("Team / Situation / Full Control Panel: profile selector unavailable.");
  }

  // Optional representative incident Workroom.
  if (!env.ORGO_DOCS_WORKROOM_ID) {
    const incidentPath = await firstWorkroomPath(".workroom-card.mode-incident");
    if (incidentPath) {
      await openPath(`${incidentPath}/overview`);
      await page.locator(".workroom-mode-incident").waitFor({ state: "visible", timeout: 12000 }).catch(() => {});
      await settle();
      await shot("16-incident-workroom.png", "Incident Workroom", `${incidentPath}/overview`);
    } else {
      skipped.push("Incident Workroom: no incident-mode Workroom exists in the current local dataset.");
    }
  }

  const generatedAt = new Date().toISOString();
  const manifest = {
    generatedAt,
    date,
    baseURL,
    viewport: { width, height },
    fullPage,
    captured,
    skipped,
    note: "Documentation screenshots only. This manifest is not functional or acceptance evidence.",
  };
  fs.writeFileSync(
    path.join(outputDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8"
  );

  const lines = [
    `# Orgo UI screenshots — ${date}`,
    "",
    "> Generated documentation screenshots. These images are visual documentation only; they are not functional, security, or acceptance evidence.",
    "",
    `Generated: \`${generatedAt}\``,
    "",
    `Viewport: \`${width} × ${height}\`${fullPage ? " · full-page capture" : ""}`,
    "",
  ];
  for (const item of captured) {
    lines.push(`## ${item.title}`, "", `![${item.title}](${item.file})`, "");
  }
  if (skipped.length) {
    lines.push("## Skipped", "");
    for (const item of skipped) lines.push(`- ${item}`);
    lines.push("");
  }
  fs.writeFileSync(path.join(outputDir, "README.md"), lines.join("\n"), "utf8");

  console.log("");
  console.log(`Documentation screenshots written to: ${outputDir}`);
  if (skipped.length) {
    console.log("Skipped:");
    for (const item of skipped) console.log(` - ${item}`);
  }
} finally {
  await browser.close();
}
