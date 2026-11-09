import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { setTimeout } from "node:timers/promises";
import { test } from "node:test";
import { join, resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { chromium, type Page } from "playwright-core";
import { addAccount } from "../lib/accounts";
import { postgres, shutdown } from "../lib/db";
import { defaultProgramme, today, type Actor, type Role } from "../lib/model";
import { saveDepartment, saveProgramme } from "../lib/settings";
import { migrate } from "../scripts/migrate";

async function openPort() {
  const server = createServer();
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address !== "string") server.close(error => error ? reject(error) : resolve(address.port));
      else reject(new Error("Could not allocate a test port."));
    });
  });
}

async function login(page: Page, origin: string, role: string, password: string) {
  await page.goto(origin + "/sign-in");
  await page.getByLabel("Institutional email").fill(role + "@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portfolio");
}

test("Local production build through browser and direct routes", { timeout: 240_000 }, async () => {
  const folder = await mkdtemp(join(tmpdir(), "shridevi-browser-"));
  const dbPort = await openPort();
  const dbPassword = randomBytes(18).toString("hex");
  let log = "";
  const engine = new EmbeddedPostgres({
    databaseDir: join(folder, "postgres"), port: dbPort, user: "postgres", password: dbPassword,
    persistent: false, postgresFlags: ["-h", "127.0.0.1"], onLog: message => { log += message; },
  });
  const password = "synthetic-browser-password!";
  const databaseUrl = "postgresql://postgres:" + dbPassword + "@127.0.0.1:" + dbPort + "/postgres";
  process.env.DATABASE_URL = databaseUrl;
  process.env.DATABASE_POOL_MAX = "1";
  let child: ReturnType<typeof spawn> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let databaseStarted = false;
  try {
    await engine.initialise();
    await engine.start();
    databaseStarted = true;
    const db = postgres();
    await migrate(db);
    async function account(role: Role, actor: Actor | null) {
      const id = await db.transaction(tx => addAccount(tx, { name: role, email: role + "@example.invalid", password, role, department: "" }, actor));
      return { id, name: role, role, department_id: null } satisfies Actor;
    }
    const admin = await account("admin", null);
    for (const role of ["coordinator","pi","guide","management","feedback"] as const) await account(role, admin);
    for (const name of ["Genetics", "Paediatrics", "Pathology"]) await saveDepartment(db, admin, "", name);
    await saveProgramme(db, admin, { ...defaultProgramme, start: today().slice(0,4) + "-01-01", targetsApproved: true }, 0);
    await shutdown();

    const port = await openPort();
    const origin = "http://127.0.0.1:" + port;
    child = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
      env: { ...process.env, APP_ORIGIN: origin, DATABASE_URL: databaseUrl, DATABASE_POOL_MAX: "1", NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    child.stdout?.on("data", chunk => { log += chunk; });
    child.stderr?.on("data", chunk => { log += chunk; });
    let ready = false;
    for (let attempt = 0; attempt < 60 && child.exitCode === null; attempt++) {
      const response = await fetch(origin + "/sign-in").catch(() => null);
      if (response?.ok) { ready = true; break; }
      await setTimeout(300);
    }
    assert.ok(ready, "Next.js start did not become ready");
    browser = await chromium.launch(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: "msedge" });
    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    const consoleErrors: string[] = [];
    page.on("pageerror", error => consoleErrors.push(error.message));
    assert.equal((await page.request.get(origin + "/api/reports")).status(), 401);
    await login(page, origin, "coordinator", password);
    await page.getByRole("button", { name: "Add research topic" }).click();
    const modal = page.getByRole("dialog");
    await modal.getByLabel("Study title").fill("Browser concept");
    await modal.getByRole("button", { name: "Save concept" }).click();
    await page.waitForURL("**/portfolio/GL-*");
    const studyUrl = page.url();
    await page.getByRole("link", { name: "Study details", exact: true }).click();
    await page.getByLabel("Confirmed lead department").selectOption({ label: "Genetics" });
    await page.getByText("Choose collaborating departments").click();
    await page.getByLabel("Paediatrics", { exact: true }).check();
    await page.getByLabel("Pathology", { exact: true }).check();
    await page.getByLabel("Principal Investigator", { exact: true }).fill("Browser PI");
    await page.getByLabel("PG Guide", { exact: true }).fill("Browser guide");
    await page.getByLabel("PI access account").selectOption({ label: "pi · Principal investigator" });
    await page.getByLabel("Estimated direct cost, low").fill("120000");
    await page.getByLabel("Estimated direct cost, high").fill("175000");
    await page.getByLabel("Approved budget").fill("140000");
    await page.getByLabel("Actual spend").fill("0");
    await page.getByLabel("Estimated PI contribution").fill("12000");
    await page.getByRole("button", { name: "Save study details" }).click();
    await page.getByRole("status").filter({ hasText: "Saved." }).waitFor();
    await page.reload();
    assert.equal(await page.getByLabel("PG Guide", { exact: true }).inputValue(), "Browser guide");
    assert.equal(await page.getByLabel("Approved budget").inputValue(), "140000");
    assert.equal(await page.getByLabel("Actual spend").inputValue(), "0");

    await page.getByRole("link", { name: "Documents", exact: true }).click();
    await page.getByLabel("PDF or text file").setInputFiles({ name: "concept.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic concept note") });
    await page.getByRole("button", { name: "Save document version" }).click();
    const docLink = page.getByRole("link", { name: /concept\.txt/ });
    await docLink.waitFor();
    const direct = new URL((await docLink.getAttribute("href"))!, origin).href;
    const download = await page.request.get(direct);
    assert.equal(download.status(), 200);
    assert.equal(await download.text(), "Synthetic concept note");

    await page.getByRole("link", { name: "Milestones", exact: true }).click();
    const feasibility = page.locator("details.milestone").filter({ has: page.locator("summary").getByText("Feasibility screened", { exact: true }) });
    await feasibility.locator("summary").click();
    await feasibility.getByLabel("Progress").selectOption("Completed");
    await feasibility.getByLabel("Effective completion date").fill(today());
    await feasibility.getByLabel("Evidence reference").fill("Synthetic evidence");
    await feasibility.getByRole("button", { name: "Save and submit for review" }).click();
    await feasibility.getByRole("status").filter({ hasText: "Saved." }).waitFor();
    assert.equal(await feasibility.getByRole("button", { name: "Freeze milestone" }).count(), 0);

    const adminPage = await browser.newPage();
    await login(adminPage, origin, "admin", password);
    await adminPage.goto(studyUrl + "/milestones");
    const adminMilestone = adminPage.locator("details.milestone").filter({ has: adminPage.locator("summary").getByText("Feasibility screened", { exact: true }) });
    await adminMilestone.locator("summary").click();
    await adminMilestone.getByRole("button", { name: "Confirm documented evidence" }).click();
    await adminMilestone.getByRole("button", { name: "Freeze milestone" }).click();
    await adminMilestone.getByRole("button", { name: "Reopen for correction" }).waitFor();
    assert.equal(await adminMilestone.getByLabel("Progress").count(), 0);
    await adminMilestone.getByLabel("Reopening reason").fill("Correct the supporting reference");
    await adminMilestone.getByRole("button", { name: "Reopen for correction" }).click();
    await adminMilestone.getByRole("button", { name: "Save and submit for review" }).waitFor();
    await adminPage.getByRole("link", { name: "History", exact: true }).click();
    await adminPage.getByText("Feasibility screened · freeze", { exact: true }).waitFor();

    const outsider = await browser.newPage();
    await login(outsider, origin, "guide", password);
    assert.equal((await outsider.request.get(direct)).status(), 404);
    assert.equal((await outsider.request.get(origin + "/api/reports?from=" + today() + "&to=" + today())).status(), 403);
    assert.equal((await outsider.request.get(studyUrl)).status(), 404);
    const assigned = await browser.newPage();
    await login(assigned, origin, "pi", password);
    assert.equal((await assigned.request.get(direct)).status(), 200);

    await adminPage.goto(origin + "/reviews?period=Custom&from=" + today() + "&to=" + today());
    await adminPage.getByLabel("Findings and review notes").fill("=untrusted-text");
    await adminPage.getByRole("button", { name: "Save draft" }).click();
    await adminPage.waitForURL("**/reviews/*");
    const reviewUrl = adminPage.url();
    await adminPage.getByRole("button", { name: "Freeze review" }).click();
    await adminPage.getByRole("heading", { name: "Findings and follow-up" }).waitFor();
    const csvHref = (await adminPage.getByRole("link", { name: "Export CSV" }).getAttribute("href"))!;
    const csv = await adminPage.request.get(new URL(csvHref, origin).href);
    assert.equal(csv.status(), 200);
    assert.ok((await csv.text()).includes("'=untrusted-text"));
    const mgmt = await browser.newPage();
    await login(mgmt, origin, "management", password);
    assert.equal((await mgmt.request.get(reviewUrl)).status(), 200);
    assert.equal((await mgmt.request.get(new URL(csvHref, origin).href)).status(), 200);
    assert.equal((await mgmt.request.get(origin + "/api/reports?from=" + today() + "&to=" + today())).status(), 403);

    await adminPage.goto(origin + "/feedback");
    await adminPage.getByLabel("Campaign title").fill("Browser campaign");
    await adminPage.getByLabel("Closes", { exact: true }).fill(today());
    await adminPage.getByLabel("Offer anonymous responses").check();
    await adminPage.getByRole("button", { name: "Create campaign" }).click();
    await adminPage.locator("summary").filter({ hasText: "Browser campaign" }).waitFor();
    await assigned.goto(origin + "/feedback");
    await assigned.locator("summary").filter({ hasText: "Browser campaign" }).click();
    await assigned.getByLabel("Your perspective").selectOption("PI");
    await assigned.getByLabel("Submit anonymously").check();
    await assigned.getByLabel("Clarity of the research workflow").selectOption("5");
    await assigned.getByLabel("Additional comments").fill("Synthetic anonymous feedback");
    await assigned.getByRole("button", { name: "Submit feedback" }).click();
    await assigned.getByRole("status").filter({ hasText: "Saved." }).waitFor();
    await adminPage.reload();
    await adminPage.getByText("Small anonymous groups are suppressed.", { exact: false }).waitFor();

    await page.goto(origin + "/feedback");
    await page.locator("summary").filter({ hasText: "Browser campaign" }).click();
    await page.getByLabel("Your perspective").selectOption("R&D or management");
    await page.getByLabel("Most important improvement").fill("Standardize the referral handoff.");
    await page.getByRole("button", { name: "Submit feedback" }).click();
    await page.getByRole("status").filter({ hasText: "Saved." }).waitFor();
    const reviewer = await browser.newPage();
    await login(reviewer, origin, "feedback", password);
    await reviewer.goto(origin + "/feedback");
    const response = reviewer.locator("details").filter({ hasText: "Standardize the referral handoff." });
    await response.locator("summary").click();
    assert.equal(await reviewer.getByText("Synthetic anonymous feedback", { exact: true }).count(), 0);
    await response.getByLabel("Finding or corrective action").fill("Update referral checklist");
    await response.getByLabel("Owner", { exact: true }).fill("Quality lead");
    await response.getByLabel("Deadline").fill(today());
    await response.getByRole("button", { name: "Save corrective action" }).click();
    await reviewer.locator("summary").filter({ hasText: "Update referral checklist" }).waitFor();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(origin + "/portfolio");
    await page.getByRole("heading", { name: "Portfolio overview" }).waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false);
    assert.deepEqual(consoleErrors, []);
  } catch (error) {
    console.error(log);
    throw error;
  } finally {
    await browser?.close();
    if (child && child.exitCode === null) {
      const exited = new Promise<void>(resolve => child!.once("exit", () => resolve()));
      child.kill();
      await exited;
    }
    await shutdown();
    if (databaseStarted) await engine.stop();
    await rm(folder, { recursive: true, force: true });
  }
});
