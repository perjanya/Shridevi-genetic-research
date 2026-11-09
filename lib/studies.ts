import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, Problem, type Database, type Queryable } from "./db";
import {
  authorityKeys, blankMilestone, blankProject, canMilestone, committeeKeys, defaultProgramme, editable, isDone,
  keys, milestones, milestoneFields, projectDetails, projectFields, recordInput, scoped, today, long, version,
  type Actor, type Department, type Milestone, type MilestoneKey, type Programme, type ProjectFields, type Study, type StudyData,
} from "./model";

export async function programme(db: Queryable, lock = false) {
  if (lock) await db.query("SELECT pg_advisory_xact_lock_shared(518219)");
  const { rows } = await db.query<{ data: Programme; version: number }>("SELECT data,version FROM settings WHERE key='programme'");
  return rows[0] ?? { data: defaultProgramme, version: 0 };
}

export async function reportingProgramme(db: Queryable, cycle: string) {
  if (!cycle) return programme(db);
  const { rows } = await db.query<{ data: Programme; version: number }>("SELECT data,version FROM settings WHERE key=$1", ["cycle:" + cycle]);
  return rows[0] ?? programme(db);
}

export async function departments(db: Queryable) {
  return (await db.query<Department>("SELECT id,name FROM departments ORDER BY name")).rows;
}

export async function visibleStudies(db: Queryable, actor: Actor) {
  const { rows } = await db.query<Study>("SELECT id,title,version,data FROM studies ORDER BY id");
  return rows.filter(study => scoped(actor, study.data.fields));
}

export async function getStudy(db: Queryable, actor: Actor, id: string, write = false) {
  const study = (await db.query<Study>("SELECT id,title,version,data FROM studies WHERE id=$1" + (write ? " FOR UPDATE" : ""), [id])).rows[0];
  if (!study || !projectDetails(actor, study.data.fields)) throw new Problem("Study was not found.", 404);
  return study;
}

export function completionDate(data: StudyData) {
  const { lock, final, closeout } = data.milestones;
  if (!isDone(lock) || !isDone(final) || !final?.confirmedBy || !(isDone(closeout) || (closeout?.status === "Not applicable" && closeout.confirmedBy))) return "";
  return [lock?.completed ?? "", final.completed, closeout?.completed ?? ""].sort().at(-1) ?? "";
}

export function phase(data: StudyData) {
  const { fields, milestones: m } = data;
  if (fields.lifecycle !== "Open") return fields.lifecycle;
  if (completionDate(data)) return "Completed";
  if (["recruitOpen", "collect", "assays", "collectData"].some(key => isDone(m[key as MilestoneKey]))) return "Execution";
  if (isDone(m.start) && m.start?.confirmedBy) return "Activated";
  if (m.endorsement?.confirmedBy && ["srcDecision", "iecDecision"].every(key => {
    const decision = m[key as MilestoneKey];
    return decision?.confirmedBy && ["Approved", "Exempt"].includes(decision.decision);
  })) return "Funding";
  if (isDone(m.endorsement) || isDone(m.srcSubmit) || isDone(m.iecSubmit)) return "Review";
  if (isDone(m.feasibility) || isDone(m.protocol)) return "Preparation";
  return "Concept";
}

function applicableApproval(data: StudyData, committee: "src" | "iec", day: string, allowExemptions: boolean) {
  const candidates = (["Decision", "Amend", "Renew"] as const)
    .map((suffix, precedence) => ({ entry: data.milestones[committee + suffix as MilestoneKey], precedence }))
    .filter(({ entry }) => entry?.confirmedBy && isDone(entry) && entry.completed <= day)
    .sort((a, b) => b.entry!.completed.localeCompare(a.entry!.completed) || b.precedence - a.precedence);
  const decision = candidates[0]?.entry;
  if (!decision || !decision.evidence || !(decision.decision === "Approved" || (allowExemptions && decision.decision === "Exempt")))
    return committee.toUpperCase() + " decision";
  const expiry = decision.expires || (candidates[0].precedence === 1
    ? candidates.slice(1).find(({ entry, precedence }) => precedence !== 1 && entry?.decision === "Approved")?.entry?.expires
    : "");
  return expiry && expiry < day ? committee.toUpperCase() + " approval expired" : "";
}

export function activationBlockers(data: StudyData, settings: Programme, day: string, includeStart = true) {
  const issues: string[] = [];
  const m = data.milestones;
  const confirmed = (key: MilestoneKey) => !!(isDone(m[key]) && m[key]?.confirmedBy && m[key]?.evidence && m[key]!.completed <= day);
  if (data.fields.lifecycle !== "Open") issues.push("Study is " + data.fields.lifecycle.toLowerCase());
  if (!confirmed("endorsement")) issues.push("PI endorsement");
  for (const committee of ["src", "iec"] as const) {
    const issue = applicableApproval(data, committee, day, settings.allowExemptions);
    if (issue) issues.push(issue);
  }
  if (!confirmed("piCommit")) issues.push("Written PI funding commitment");
  if (!confirmed("coverage")) issues.push("Confirmed cost coverage");
  if (includeStart && !confirmed("start")) issues.push("Documented start authorization");
  return issues;
}

async function save(db: Queryable, actor: Actor, study: Study, data: StudyData, kind: string, change: unknown) {
  await db.query("UPDATE studies SET title=$2,version=version+1,data=$3 WHERE id=$1", [study.id, data.fields.title, JSON.stringify(data)]);
  await audit(db, "study", study.id, actor.id, kind, { change, snapshot: data });
}

export async function insertConcept(db: Queryable, id: string, fields: ProjectFields, actor: Actor | null) {
  const entered = today();
  const data: StudyData = { fields, entered, records: [], milestones: { concept: { ...blankMilestone, status: "Completed", completed: entered, version: 1 } } };
  const inserted = await db.query("INSERT INTO studies(id,title,data) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING RETURNING id", [id, fields.title, JSON.stringify(data)]);
  if (!inserted.rows.length) return false;
  await audit(db, "study", id, actor?.id ?? null, "Concept entered", { snapshot: data });
  return true;
}

async function duplicate(db: Queryable, title: string, id: string, reason: string) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext(lower($1)))", [title]);
  const found = await db.query("SELECT id FROM studies WHERE lower(title)=lower($1) AND id<>$2 LIMIT 1", [title, id]);
  if (found.rows.length && !reason) throw new Problem("A study already uses this title. Enter a duplicate-title reason if these are distinct studies.", 409);
  return !!found.rows.length;
}

export async function createStudy(db: Database, actor: Actor, title: string, reason: string) {
  if (!editable(actor)) throw new Problem("Study editing access required.", 403);
  const fields = projectFields.parse(blankProject(title));
  return db.transaction(async tx => {
    const duplicateFound = await duplicate(tx, fields.title, "", long.parse(reason));
    const settings = await programme(tx);
    fields.cycle = settings.data.name;
    let id: string;
    do {
      const { rows } = await tx.query<{ n: string }>("SELECT nextval('study_number')::text AS n");
      id = "GL-" + String(1000 + Number(rows[0].n));
    } while (!await insertConcept(tx, id, fields, actor));
    if (duplicateFound) await audit(tx, "study", id, actor.id, "Duplicate title retained", { reason });
    return id;
  });
}

export async function updateStudy(db: Database, actor: Actor, id: string, expected: number, input: ProjectFields, reason: string) {
  if (!editable(actor)) throw new Problem("Study editing access required.", 403);
  const fields = projectFields.parse(input);
  reason = long.parse(reason);
  return db.transaction(async tx => {
    const study = await getStudy(tx, actor, id, true);
    if (study.version !== version.parse(expected)) throw new Problem("This study changed. Reload before saving.", 409);
    const before = study.data.fields;
    fields.collaborators = [...new Set(fields.collaborators)];
    if (fields.collaborators.includes(fields.lead)) throw new Problem("Choose collaborating departments different from the lead.");
    const departmentIds = [...fields.collaborators, ...(fields.lead ? [fields.lead] : [])];
    const valid = (await tx.query("SELECT id FROM departments WHERE id=ANY($1::uuid[])", [departmentIds])).rows;
    if (valid.length !== departmentIds.length) throw new Problem("Select departments from the directory.");
    for (const [key, allowed] of [["piAccount", ["pi", "guide"]], ["guideAccount", ["pi", "guide"]], ["scholarAccount", ["scholar"]], ["ownerAccount", []]] as const) {
      if (!fields[key] || fields[key] === before[key]) continue;
      const account = (await tx.query<{ role: string }>("SELECT role FROM accounts WHERE id=$1 AND active", [fields[key]])).rows[0];
      if (!account || (allowed.length && !(allowed as readonly string[]).includes(account.role))) throw new Problem("Select an authorized account for each access assignment.");
    }
    if (fields.estimateMin !== null && fields.estimateMax !== null && fields.estimateMin > fields.estimateMax) throw new Problem("The low estimate must be at or below the high estimate.");
    if (fields.lifecycle !== "Open" && !fields.lifecycleReason) throw new Problem("Record a reason for the study status.");
    const targetFields = ["recruitmentTarget", "samplesTarget", "check30Recruitment", "check60Recruitment", "check90Recruitment", "check30Samples", "check60Samples", "check90Samples"] as const;
    if (isDone(study.data.milestones.start) && targetFields.some(key => before[key] !== fields[key]) && !reason)
      throw new Problem("Provide the approved protocol change reference before editing targets.");
    if (before.title.toLowerCase() !== fields.title.toLowerCase()) await duplicate(tx, fields.title, id, reason);
    const changes = Object.fromEntries(Object.keys(fields).flatMap(raw => {
      const key = raw as keyof ProjectFields;
      return JSON.stringify(before[key]) !== JSON.stringify(fields[key]) ? [[key, { from: before[key], to: fields[key] }]] : [];
    }));
    if (!Object.keys(changes).length) return;
    await save(tx, actor, study, { ...study.data, fields }, "Study updated", { changes, reason });
  });
}

const milestoneCommand = z.object({ key: z.enum(keys), expected: z.number().int().min(0), action: z.enum(["record", "confirm", "freeze", "reopen"]), fields: milestoneFields.optional(), reason: long });
export type MilestoneCommand = z.infer<typeof milestoneCommand>;
export async function changeMilestone(db: Database, actor: Actor, id: string, raw: MilestoneCommand) {
  const { key, expected, action, fields, reason } = milestoneCommand.parse(raw);
  return db.transaction(async tx => {
    const settings = (await programme(tx, true)).data;
    const study = await getStudy(tx, actor, id, true);
    if (!canMilestone(actor, settings, key, action)) throw new Problem("You do not have permission for this milestone action.", 403);
    const before = study.data.milestones[key] ?? blankMilestone;
    if (actor.role === "pi" && ["endorsement", "piCommit", "final"].includes(key) && action === "confirm" &&
        study.data.fields.piAccount !== actor.id) throw new Problem("Only the assigned PI can confirm this evidence as PI.", 403);
    if (before.version !== expected) throw new Problem("The milestone changed. Reload before saving.", 409);
    if (before.status === "Frozen" && action !== "reopen") throw new Problem("This milestone is frozen.", 409);
    let next: Milestone = { ...before, version: before.version + 1 };
    if (action === "reopen") {
      if (before.status !== "Frozen" || !reason) throw new Problem("A frozen milestone and a reopening reason are required.");
      next = { ...next, status: "In progress", completed: "", confirmedBy: undefined, frozenBy: undefined, frozenAt: undefined, deadlineAtCompletion: undefined };
    } else if (action === "record") {
      if (!fields) throw new Problem("Enter milestone details.");
      if (key === "concept") throw new Problem("The concept entry date is assigned by the system.");
      next = { ...fields, version: next.version };
      const done = isDone(next);
      if (done) next.deadlineAtCompletion = before.deadlineAtCompletion ?? next.due;
      if ((done || next.status === "Not applicable") && (!next.completed || !next.evidence)) throw new Problem("Enter the effective date and evidence reference.");
      if (done && committeeKeys.includes(key) && !next.decision) throw new Problem("Record the committee decision separately.");
      if (next.status === "Not applicable" && authorityKeys.includes(key)) throw new Problem("Use a documented committee exemption where permitted.");
      if (next.decision === "Exempt" && !settings.allowExemptions) throw new Problem("Institutional exemptions are disabled.");
      if (next.completed && (next.completed > today() || next.completed < study.data.entered)) throw new Problem("Enter a completion date from concept entry through today.");
      if (next.expires && (!next.completed || next.expires < next.completed)) throw new Problem("Expiry must be on or after the effective date.");
      if ((done || next.status === "In progress") && ["recruitOpen", "collect", "recruitDone"].includes(key)) {
        const issues = [...new Set([...activationBlockers(study.data, settings, today()), ...(next.completed ? activationBlockers(study.data, settings, next.completed) : [])])];
        if (issues.length) throw new Problem("Study activity is blocked. " + issues.join(", ") + ".");
      }
    } else {
      if (!(isDone(before) || before.status === "Not applicable") || !before.completed || !before.evidence)
        throw new Problem("Record completion or applicability with a date and evidence first.");
      if (action === "confirm") {
        if (key === "start") {
          const issues = [...new Set([...activationBlockers(study.data, settings, before.completed, false), ...activationBlockers(study.data, settings, today(), false)])];
          if (issues.length) throw new Problem("Activation is blocked. " + issues.join(", ") + ".");
        }
        next.confirmedBy = actor.id;
      } else {
        if (!before.confirmedBy) throw new Problem("Confirm the evidence before freezing.");
        next = { ...next, status: "Frozen", frozenBy: actor.id, frozenAt: new Date().toISOString() };
        if (before.status === "Not applicable") throw new Problem("A confirmed not-applicable decision remains recorded in the history.");
      }
    }
    const data = { ...study.data, milestones: { ...study.data.milestones, [key]: next } };
    await save(tx, actor, study, data, milestones[key] + " · " + action, { key, before, after: next, reason });
  });
}

export async function upsertRecord(db: Database, actor: Actor, id: string, expected: number, raw: unknown) {
  const input = recordInput.parse(raw);
  if (!editable(actor) && !(actor.role === "lab" && input.type === "lab")) throw new Problem("Operational record editing access required.", 403);
  return db.transaction(async tx => {
    const settings = (await programme(tx, true)).data;
    const study = await getStudy(tx, actor, id, true);
    if (study.version !== version.parse(expected)) throw new Problem("The study changed. Reload before saving.", 409);
    const records = [...study.data.records];
    const index = records.findIndex(record => record.id === input.id);
    if (input.id && (index < 0 || records[index].type !== input.type)) throw new Problem("Record was not found.", 404);
    if ("day" in input && input.day > today()) throw new Problem("Activity dates cannot be in the future.");
    if (input.type === "delivery") {
      const old = index < 0 ? null : records[index];
      const increasing = !old || old.type !== "delivery" || old.day !== input.day || old.recruited < input.recruited || old.samples < input.samples;
      if (increasing && (input.recruited || input.samples)) {
        const issues = [...new Set([...activationBlockers(study.data, settings, today()), ...activationBlockers(study.data, settings, input.day)])];
        if (issues.length) throw new Problem("Recruitment and collection are blocked. " + issues.join(", ") + ".");
      }
    }
    if (input.type === "lab") {
      if (input.rejected !== null && (input.processed === null || input.rejected > input.processed)) throw new Problem("Rejections require a sufficient processed denominator.");
      if (input.repeated !== null && (input.processed === null || input.repeated > input.processed)) throw new Problem("Repeats require a sufficient processed denominator.");
      if (input.report && (!input.accession || input.report < input.accession || input.report > today())) throw new Problem("Use a valid accession-to-report interval.");
      if (input.approved && !["admin", "lab"].includes(actor.role)) throw new Problem("The laboratory lead or R&D must confirm activity.", 403);
      const previous = records[index];
      if (previous?.type === "lab" && previous.approved && !["admin", "lab"].includes(actor.role))
        throw new Problem("The laboratory lead or R&D must edit confirmed activity.", 403);
    }
    if (input.type === "grant" && input.decision !== "Pending" && (!input.submitted || !input.decisionDate || input.decisionDate < input.submitted || input.decisionDate > today())) throw new Problem("Record a valid submission and grant decision date.");
    if (input.type === "manuscript" && [input.accepted, input.published].some(day => day && (!input.submitted || day < input.submitted || day > today()))) throw new Problem("Record a valid submission date before acceptance or publication.");
    if ("submitted" in input && input.submitted > today()) throw new Problem("Submission dates cannot be in the future.");
    const after = { ...input, id: input.id ?? randomUUID() };
    const before = index < 0 ? null : records[index];
    if (index < 0) records.push(after);
    else records[index] = after;
    await save(tx, actor, study, { ...study.data, records }, "Updated " + input.type + " record", { before, after });
  });
}
