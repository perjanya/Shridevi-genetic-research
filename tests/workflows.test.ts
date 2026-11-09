import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import JSZip from "jszip";
import { addAccount, authenticate, endSession, sessionActor } from "../lib/accounts";
import { Problem, type Database, type Queryable } from "../lib/db";
import { attachDocument, loadDocument } from "../lib/documents";
import { corrections, createCampaign, feedbackComments, feedbackTotals, listCampaigns, saveCorrection, submitFeedback } from "../lib/feedback";
import { blankMilestone, blankProject, defaultProgramme, today, type Actor, type MilestoneKey, type Role, type StudyData } from "../lib/model";
import { addDays, blankReportFilter, calculateReport, listReviews, reportCsv, reportPeriod, saveReview } from "../lib/reports";
import { saveDepartment, saveProgramme } from "../lib/settings";
import { activationBlockers, changeMilestone, createStudy, departments, getStudy, updateStudy, upsertRecord, visibleStudies } from "../lib/studies";
import { importWorkbook } from "../scripts/import-workbook";
import { migrate } from "../scripts/migrate";

function embedded(engine: PGlite): Database {
  const wrap = (driver: Pick<PGlite, "query" | "exec">): Queryable => ({
    async query<T extends Record<string, unknown>>(sql: string, params?: unknown[]) {
      if (params?.length) return driver.query<T>(sql, params);
      const results = await driver.exec(sql);
      return { rows: (results.at(-1)?.rows ?? []) as T[] };
    },
  });
  return { ...wrap(engine), transaction: run => engine.transaction(tx => run(wrap(tx))) };
}

test("PostgreSQL research workflows", async t => {
  const engine = await PGlite.create();
  const db = embedded(engine);
  t.after(() => engine.close());
  await migrate(db);
  await migrate(db);
  const pass = "local-test-long-password!";
  async function make(role: Role, actor: Actor | null, suffix = role as string) {
    const email = suffix + "@example.invalid";
    const id = await db.transaction(tx => addAccount(tx, { name: suffix, email, password: pass, role, department: "" }, actor));
    return { id, name: suffix, role, department_id: null } satisfies Actor;
  }
  const admin = await make("admin", null);
  const coordinator = await make("coordinator", admin);
  const pi = await make("pi", admin);
  const guide = await make("guide", admin);
  const reviewer = await make("feedback", admin);
  const management = await make("management", admin);
  const day = today();
  const settings = { ...defaultProgramme, start: day.slice(0, 4) + "-01-01", targetsApproved: true };
  await saveProgramme(db, admin, settings, 0);
  let id = "";
  let documentId = "";

  await t.test("accounts, title-only intake, independently scoped assignments and funding", async () => {
    await assert.rejects(authenticate(db, "coordinator@example.invalid", "incorrect"), /incorrect/);
    const session = await authenticate(db, "coordinator@example.invalid", pass);
    assert.equal((await sessionActor(db, session.token))?.id, coordinator.id);
    await endSession(db, session.token);
    assert.equal(await sessionActor(db, session.token), null);
    id = await createStudy(db, coordinator, "A project-level concept", "");
    await assert.rejects(createStudy(db, coordinator, "a project-level concept", ""), /duplicate-title reason/);
    assert.notEqual(await createStudy(db, coordinator, "A project-level concept", "Different population"), id);
    await assert.rejects(createStudy(db, guide, "Forbidden", ""), /editing access/);
    for (const name of ["Lead", "Partner A", "Partner B"]) await saveDepartment(db, admin, "", name);
    const directory = await departments(db);
    const study = await getStudy(db, coordinator, id);
    const fields = { ...study.data.fields, lead: directory[0].id, collaborators: directory.slice(1).map(item => item.id),
      pi: "Assigned PI", guide: "Assigned PG guide", piAccount: pi.id, guideAccount: guide.id,
      estimateMin: 120000, estimateMax: 170000, piContribution: 12000, approvedBudget: 140000, spent: 0 };
    await updateStudy(db, coordinator, id, study.version, fields, "");
    await assert.rejects(updateStudy(db, coordinator, id, study.version, fields, ""), /changed/);
    const actual = (await getStudy(db, pi, id)).data.fields;
    assert.equal(actual.collaborators.length, 2);
    assert.equal(actual.guide, "Assigned PG guide");
    assert.equal(actual.pi, "Assigned PI");
    assert.deepEqual([actual.piContribution, actual.estimateMin, actual.approvedBudget, actual.spent], [12000, 120000, 140000, 0]);
    const changes = await db.query<{ changes: Record<string, unknown> }>("SELECT data->'change'->'changes' AS changes FROM events WHERE subject=$1 AND kind='Study updated'", [id]);
    assert.ok(changes.rows[0].changes.pi && changes.rows[0].changes.guide && changes.rows[0].changes.collaborators);
    assert.equal((await visibleStudies(db, guide)).length, 1);
  });

  await t.test("private document versions and direct lookup restrictions", async () => {
    const file = new File(["Project concept only"], "concept.txt", { type: "text/plain" });
    documentId = await attachDocument(db, coordinator, id, "Concept note", file, "");
    const v2 = await attachDocument(db, coordinator, id, "Concept note", new File(["Revised"], "concept.txt"), "");
    assert.equal((await loadDocument(db, pi, id, documentId)).bytes?.toString(), "Project concept only");
    assert.equal((await loadDocument(db, pi, id, v2)).version, 2);
    for (const actor of [reviewer, management]) await assert.rejects(loadDocument(db, actor, id, documentId), /not found/);
    await assert.rejects(attachDocument(db, coordinator, id, "Concept note", new File(["hi"], "fake.pdf"), ""), /valid PDF/);
  });

  async function record(key: MilestoneKey, options: Partial<typeof blankMilestone> = {}, actor = coordinator) {
    const project = await getStudy(db, admin, id);
    const item = project.data.milestones[key] ?? blankMilestone;
    return changeMilestone(db, actor, id, { key, expected: item.version, action: "record", reason: "",
      fields: { ...blankMilestone, status: "Completed", completed: day, evidence: "Signed institutional reference", approver: "Institutional authority", ...options } as Parameters<typeof changeMilestone>[3]["fields"] });
  }
  async function milestone(key: MilestoneKey, action: "confirm" | "freeze" | "reopen", actor = admin, reason = "") {
    const expected = (await getStudy(db, admin, id)).data.milestones[key]?.version ?? 0;
    return changeMilestone(db, actor, id, { key, expected, action, reason });
  }

  await t.test("milestone concurrency, freeze and reasoned correction", async () => {
    const racing = await Promise.allSettled([record("feasibility", { due: day }), record("feasibility", { due: day })]);
    assert.equal(racing.filter(r => r.status === "fulfilled").length, 1);
    await assert.rejects(milestone("feasibility", "freeze", coordinator), /permission/);
    await milestone("feasibility", "confirm");
    await milestone("feasibility", "freeze");
    await assert.rejects(record("feasibility"), /frozen/);
    await assert.rejects(milestone("feasibility", "reopen"), /reason/);
    await milestone("feasibility", "reopen", admin, "Correct the screening date");
    const frozen = await db.query<{ status: string }>("SELECT data->'change'->'after'->>'status' AS status FROM events WHERE subject=$1 AND kind LIKE '% · freeze'", [id]);
    assert.equal(frozen.rows[0].status, "Frozen");
    await assert.rejects(db.query("UPDATE events SET kind='corrupted' WHERE subject=$1", [id]), /Immutable record/);
    await record("feasibility", { due: day });
  });

  await t.test("activation and recruitment require valid documented approvals and funding", async () => {
    await record("start");
    await record("iecSubmit");
    await assert.rejects(milestone("start", "confirm"), /IEC decision/);
    await assert.rejects(record("recruitOpen", { status: "In progress", completed: "" }), /blocked/);
    await record("endorsement");
    await milestone("endorsement", "confirm", pi);
    await record("srcDecision", { decision: "Approved" });
    await milestone("srcDecision", "confirm");
    await record("iecDecision", { decision: "Approved" });
    await milestone("iecDecision", "confirm");
    await record("piCommit");
    await milestone("piCommit", "confirm", pi);
    await assert.rejects(milestone("start", "confirm"), /Confirmed cost coverage/);
    await record("coverage");
    await milestone("coverage", "confirm");
    await milestone("start", "confirm");
    await record("recruitOpen");
    const study = await getStudy(db, admin, id);
    assert.ok(activationBlockers(study.data, settings, day).length === 0);
    const expired = structuredClone(study.data);
    expired.milestones.iecDecision!.expires = addDays(day, -1);
    assert.ok(activationBlockers(expired, settings, day).includes("IEC approval expired"));
    await db.query("UPDATE studies SET data=$2 WHERE id=$1", [id, JSON.stringify(expired)]);
    await assert.rejects(record("collect"), /approval expired/);
    await db.query("UPDATE studies SET data=$2 WHERE id=$1", [id, JSON.stringify(study.data)]);
    await record("collect");
    await record("lock");
    await record("final");
    await milestone("final", "confirm", pi);
    await record("closeout");
    let version = (await getStudy(db, admin, id)).version;
    await upsertRecord(db, coordinator, id, version, { type: "grant", label: "G1", evidence: "Receipt", submitted: day, decision: "Pending", decisionDate: "", amount: null });
    version = (await getStudy(db, admin, id)).version;
    await upsertRecord(db, coordinator, id, version, { type: "manuscript", label: "M1", evidence: "Receipt and DOI", submitted: day, accepted: day, published: day, indexed: true });
    version = (await getStudy(db, admin, id)).version;
    await upsertRecord(db, admin, id, version, { type: "lab", label: "Reviewed zero", evidence: "Lab log", day, method: "Karyotype", approved: true, activity: "Confirmed zero", processed: 0, rejected: null, repeated: null, accession: "", report: "" });
  });

  await t.test("IST period boundaries, historical stages, comparable totals and immutable review snapshots", async () => {
    const boundary = "2025-04-01";
    assert.deepEqual(reportPeriod({ ...settings, start: boundary }, "2025-06-30", 3), { from: boundary, to: "2025-06-30" });
    assert.deepEqual(reportPeriod({ ...settings, start: boundary }, "2025-07-01", 6), { from: boundary, to: "2025-09-30" });
    const historicId = "GL-90000";
    const base: StudyData = { fields: blankProject("Historic boundary fixture"), entered: boundary, milestones: {}, records: [] };
    await db.query("INSERT INTO studies(id,title,data) VALUES($1,$2,$3)", [historicId, base.fields.title, JSON.stringify(base)]);
    await db.query("INSERT INTO events(scope,subject,kind,data,occurred_at) VALUES('study',$1,'Concept',$2,'2025-03-31 18:30:00+00')", [historicId, JSON.stringify({ snapshot: base })]);
    base.milestones.feasibility = { ...blankMilestone, status: "Completed", completed: "2025-07-01", version: 1 };
    await db.query("INSERT INTO events(scope,subject,kind,data,occurred_at) VALUES('study',$1,'Screened',$2,'2025-06-30 18:30:00+00')", [historicId, JSON.stringify({ snapshot: base })]);
    const q = await calculateReport(db, admin, { ...blankReportFilter, from: boundary, to: "2025-06-30" });
    const h = await calculateReport(db, admin, { ...blankReportFilter, from: boundary, to: "2025-09-30" });
    assert.equal(q.stage.Concept, 1);
    assert.equal(h.stage.Preparation, 1);
    assert.equal(q.measures.find(m => m.key === "screened")?.events, 0);
    assert.equal(h.measures.find(m => m.key === "screened")?.events, 1);
    assert.equal(q.timeliness.rate, null);
    assert.equal(q.laboratory.length, 0);
    assert.equal(q.labMonths.length, 3);
    const f = { ...blankReportFilter, from: day, to: day };
    const r = await calculateReport(db, admin, f);
    assert.equal(r.funding.budget, 140000);
    assert.equal(r.funding.spent, 0);
    assert.equal(r.stage.Completed, 1);
    assert.equal(r.measures.find(m => m.key === "indexed")?.events, 1);
    assert.equal(r.measures.find(m => m.key === "labMonths")?.events, 0);
    assert.equal(r.laboratory[0].zero, 1);
    const input = { id: "", revision: 0, command: "draft", filter: f, notes: "=1+1", followups: [{ finding: "Review", owner: "R&D", due: day }], reason: "" };
    const reviewId = await saveReview(db, coordinator, input);
    assert.equal((await listReviews(db, management, reviewId)).length, 0);
    await assert.rejects(saveReview(db, coordinator, { ...input, id: reviewId, revision: 1, command: "freeze" }), /authority/);
    await saveReview(db, admin, { ...input, id: reviewId, revision: 1, command: "freeze" });
    const frozen = (await listReviews(db, management, reviewId))[0];
    await createStudy(db, coordinator, "Added after freeze", "");
    assert.equal((await listReviews(db, management, reviewId))[0].data.results?.total, frozen.data.results?.total);
    assert.ok(reportCsv(frozen.data.results!).includes("Insufficient data"));
    await assert.rejects(db.query("UPDATE reviews SET data='{}' WHERE id=$1", [reviewId]), /Frozen review/);
    const correctionId = await saveReview(db, admin, { ...input, id: reviewId, revision: 2, command: "correct", reason: "Add missing document reference" });
    assert.equal((await listReviews(db, admin, correctionId))[0].version, 2);
  });

  await t.test("anonymous redemption, small-group suppression and restricted corrective actions", async () => {
    await createCampaign(db, admin, { title: "Year 1", opens: day, closes: day, anonymous: true, projectFeedback: false });
    const [campaign] = await listCampaigns(db);
    const f = { campaign: campaign.id, study: "", anonymous: true, perspective: "PI", ratings: { clarity: 4, feasibility: "NA" }, comments: "Private comment", improvement: "" };
    for (const actor of [admin, coordinator, pi, guide]) await submitFeedback(db, actor, f);
    assert.equal((await feedbackTotals(db, admin)).suppressed, true);
    assert.equal((await feedbackTotals(db, admin)).count, 0);
    assert.equal((await feedbackComments(db, reviewer)).length, 0);
    await assert.rejects(feedbackComments(db, admin), /Designated reviewer/);
    await assert.rejects(submitFeedback(db, pi, f), /already submitted/);
    await submitFeedback(db, management, f);
    const total = await feedbackTotals(db, management);
    assert.equal(total.ratings.find(r => r.key === "clarity")?.count, 5);
    assert.equal(total.ratings.find(r => r.key === "feasibility")?.count, 0);
    const [response] = await feedbackComments(db, reviewer);
    assert.equal(response.named_account, null);
    assert.equal(response.data.perspective, undefined);
    assert.ok(!JSON.stringify(total).includes("Private comment"));
    const corrective = { id: "", campaign: campaign.id, response: response.id, expected: 0, finding: "Standardize handoff", owner: "R&D", due: day, status: "Open", resolution: "" };
    await assert.rejects(saveCorrection(db, admin, corrective), /Designated reviewer/);
    await saveCorrection(db, reviewer, corrective);
    assert.equal((await corrections(db, reviewer)).length, 1);
  });

  await t.test("workbook import is idempotent with 25 preserved Concept IDs", async () => {
    const source = "Shridevi_Genetics_Research_Dashboard.xlsx";
    const local = existsSync(source);
    const temp = await mkdtemp(join(tmpdir(), "shridevi-import-"));
    t.after(() => rm(temp, { force: true, recursive: true }));
    const workbookPath = local ? source : join(temp, "fixture.xlsx");
    if (!local) {
      const book = new JSZip();
      book.file("xl/workbook.xml", '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Dashboard" sheetId="1" r:id="rId1"/></sheets></workbook>');
      book.file("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
      const rows = [["Study ID","Proposed study","Proposed lead","Wave","Low ₹ lakh","High ₹ lakh","Next action","Action owner","Action due","Potential collaborators","Lab methods","Design and main outcome","Feasibility condition"]];
      const data: (string | number)[][] = [...rows];
      for (let n = 1; n <= 25; n++) data.push(["GL-" + String(n).padStart(2,"0"), "Concept " + n, "Genetics", n <= 8 ? 1 : n <= 17 ? 2 : 3, 1.2, 2, "Feasibility", "R&D", "", "Lab, Anatomy", "FISH", "Audit. Count outcomes.", "Check volume"]);
      const sheet = data.map((row, index) => "<row>" + row.map((value, col) => {
        const ref = String.fromCharCode(65 + col) + (19 + index);
        return typeof value === "number" ? '<c r="' + ref + '"><v>' + value + '</v></c>'
          : '<c r="' + ref + '" t="inlineStr"><is><t>' + value.replaceAll("&", "&amp;") + '</t></is></c>';
      }).join("") + "</row>").join("");
      book.file("xl/worksheets/sheet1.xml", "<worksheet><sheetData>" + sheet + "</sheetData></worksheet>");
      await writeFile(workbookPath, await book.generateAsync({ type: "nodebuffer" }));
    }
    assert.deepEqual(await importWorkbook(db, workbookPath), { received: 25, inserted: 25, existing: 0 });
    assert.deepEqual(await importWorkbook(db, workbookPath), { received: 25, inserted: 0, existing: 25 });
    const imported = (await visibleStudies(db, admin)).filter(project => /^GL-\d{2}$/.test(project.id));
    assert.equal(imported.length, 25);
    assert.deepEqual(["1","2","3"].map(wave => imported.filter(study => study.data.fields.wave === wave).length), [8,9,8]);
    assert.ok(imported.every(study => Object.keys(study.data.milestones).length === 1 && study.data.fields.approvedBudget === null && study.data.fields.lead === ""));
    assert.equal(imported[0].data.fields.estimateMin, local ? 700000 : 120000);
    assert.ok(imported[0].data.fields.proposedLead);
    await assert.rejects(getStudy(db, pi, imported[0].id), (error: unknown) => error instanceof Problem && error.status === 404);
  });
});
