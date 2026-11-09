import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, Problem, type Database, type Queryable } from "./db";
import { completionDate, departments, phase, reportingProgramme, visibleStudies } from "./studies";
import { feedbackTotals } from "./feedback";
import { date, editable, isDone, long, metricKeys, optionalId, phases, scoped, short, today, uid, type Actor, type Metric, type Milestone, type Programme, type StudyData } from "./model";

export const reportInput = z.object({
  from: date, to: date, lead: optionalId, collaborator: optionalId, pi: short, wave: short, method: short, cycle: short,
});
export type ReportFilter = z.infer<typeof reportInput>;
export const blankReportFilter = { lead: "", collaborator: "", pi: "", wave: "", method: "", cycle: "" };
const numberOfDays = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
export function addDays(day: string, count: number) {
  return new Date(Date.parse(day) + count * 86_400_000).toISOString().slice(0, 10);
}
function addMonths(day: string, count: number) {
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + count, 1));
  const max = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(dayOfMonth, max));
  return first.toISOString().slice(0, 10);
}

export function reportPeriod(settings: Programme, end: string, months: 3 | 6 | 12) {
  const start = settings.alignment === "Calendar" || !settings.start ? end.slice(0, 4) + "-01-01" : settings.start;
  const [y, m] = end.split("-").map(Number);
  const [startY, startM] = start.split("-").map(Number);
  let offset = Math.max(0, Math.floor(((y - startY) * 12 + m - startM) / months)) * months;
  if (offset > 0 && addMonths(start, offset) > end) offset -= months;
  return { from: addMonths(start, offset), to: addDays(addMonths(start, offset + months), -1) };
}

export function matchesStudy(study: StudyData, f: Omit<ReportFilter, "from" | "to">) {
  const d = study.fields;
  const has = (value: string, search: string) => value.toLowerCase().includes(search.toLowerCase());
  const methods = [...d.methods, ...study.records.flatMap(record => record.type === "lab" ? [record.method] : [])];
  return (!f.lead || d.lead === f.lead) && (!f.collaborator || d.collaborators.includes(f.collaborator)) &&
    (!f.pi || has(d.pi, f.pi)) && (!f.wave || d.wave === f.wave) &&
    (!f.method || methods.some(method => has(method, f.method))) && (!f.cycle || d.cycle === f.cycle);
}

const pair = (numerator: number, denominator: number) => ({ numerator, denominator, rate: denominator ? numerator / denominator : null });
function median(values: number[]) {
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return { count: values.length, days: !values.length ? null : values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2 };
}
const done = (m?: Milestone) => isDone(m) ? m?.completed || "" : "";
const confirmed = (m?: Milestone) => m?.confirmedBy ? done(m) : "";
const atCutoff = (data: StudyData, to: string): StudyData => ({
  ...data, milestones: Object.fromEntries(Object.entries(data.milestones).filter(([, m]) => !m.completed || m.completed <= to)),
});

type HistoryRow = { subject: string; data: { snapshot: StudyData }; };
export async function calculateReport(db: Queryable, actor: Actor, raw: ReportFilter) {
  const f = reportInput.parse(raw);
  if (f.to < f.from || numberOfDays(f.from, f.to) > 3652) throw new Problem("Choose a valid reporting interval of ten years or less.");
  const cutoff = f.to > today() ? today() : f.to;
  const within = (day: string) => !!day && day >= f.from && day <= cutoff;
  const through = (day: string) => !!day && day <= cutoff;
  const settings = await reportingProgramme(db, f.cycle);
  const current = await visibleStudies(db, actor);
  const directory = await departments(db);
  const history = await db.query<HistoryRow>(
    "SELECT DISTINCT ON(subject) subject,data FROM events WHERE scope='study' AND data ? 'snapshot' AND occurred_at < (($1::date+1)::timestamp AT TIME ZONE 'Asia/Kolkata') ORDER BY subject,id DESC", [cutoff]);
  const nameOf = (id: string) => directory.find(dept => dept.id === id)?.name ?? id;
  const permitted = new Set(current.map(study => study.id));
  const studies = history.rows.filter(row => permitted.has(row.subject) && scoped(actor, row.data.snapshot.fields) &&
    matchesStudy(row.data.snapshot, f)).map(row => atCutoff(row.data.snapshot, cutoff));
  const { data: config, version: targetVersion } = settings;
  const programmeStart = config.start || f.from;
  const year = [3, 2, 1].find(y => addMonths(programmeStart, (y - 1) * 12) <= f.to) ?? 1;
  const annualStart = addMonths(programmeStart, (year - 1) * 12);
  const annualEnd = addDays(addMonths(programmeStart, year * 12), -1);
  const stage = Object.fromEntries(phases.map(phase => [phase, 0]));
  const occurrences: Record<Metric, string[]> = { screened: [], endorsed: [], activated: [], completed: [], applications: [], awards: [], manuscripts: [], indexed: [], labMonths: [] };
  const labCalendar = new Map<string, { month: string; method: string; approved: number; zero: number; unreviewed: number }>();
  const timings: Record<string, number[]> = { "Concept to PI endorsement": [], "SRC submission to decision": [], "IEC submission to decision": [], "Activation to closeout": [], "Lab accession to report": [], "Awaiting external decision": [], "Coordinator follow-up": [] };
  let due = 0, onTime = 0, overdue = 0, overdueActions = 0, recruited = 0, plannedRecruitment = 0, collected = 0, plannedSamples = 0;
  let budget = 0, spent = 0, pairedBudgets = 0, pending = 0, decided = 0, awarded = 0, rejected = 0, rejectedDenom = 0, repeats = 0, repeatDenom = 0;
  let recordedBudget = 0, budgetCount = 0, recordedSpend = 0, spendCount = 0;
  const addInterval = (label: string, from: string, to: string) => { if (from && within(to) && to >= from) timings[label].push(numberOfDays(from, to)); };
  for (const study of studies) {
    stage[phase(study)]++;
    const m = study.milestones;
    occurrences.screened.push(done(m.feasibility));
    occurrences.endorsed.push(confirmed(m.endorsement));
    occurrences.activated.push(confirmed(m.start));
    occurrences.completed.push(completionDate(study));
    addInterval("Concept to PI endorsement", study.entered, confirmed(m.endorsement));
    addInterval("Activation to closeout", confirmed(m.start), completionDate(study));
    for (const committee of ["src", "iec"] as const) {
      const submission = done(m[`${committee}Submit`]);
      const decision = confirmed(m[`${committee}Decision`]);
      addInterval(committee.toUpperCase() + " submission to decision", submission, decision);
      const wait = m[`${committee}Decision`]?.wait;
      if (wait) addInterval(wait === "External decision" ? "Awaiting external decision" : "Coordinator follow-up", submission, decision);
    }
    for (const milestone of Object.values(m)) {
      const effective = done(milestone);
      const deadline = effective ? milestone.deadlineAtCompletion ?? milestone.due : milestone.due;
      if (!within(deadline) || milestone.status === "Not applicable") continue;
      due++;
      if (effective && effective <= deadline) onTime++;
      if (!effective && deadline < cutoff) overdue++;
    }
    const d = study.fields;
    if (d.lifecycle === "Open" && d.nextAction && d.due && d.due < cutoff) overdueActions++;
    if (d.approvedBudget !== null) { recordedBudget += d.approvedBudget; budgetCount++; }
    if (d.spent !== null) { recordedSpend += d.spent; spendCount++; }
    if (d.approvedBudget !== null && d.spent !== null) {
      budget += d.approvedBudget; spent += d.spent; pairedBudgets++;
    }
    if (d.recruitmentTarget !== null) plannedRecruitment += d.recruitmentTarget;
    if (d.samplesTarget !== null) plannedSamples += d.samplesTarget;
    for (const r of study.records) {
      if (r.type === "grant") {
        if (through(r.submitted)) {
          occurrences.applications.push(r.submitted);
          if (r.decision === "Pending" || !through(r.decisionDate)) pending++;
          else if (r.decision === "Awarded" || r.decision === "Declined") {
            decided++;
            if (r.decision === "Awarded") { awarded++; occurrences.awards.push(r.decisionDate); }
          }
        }
      } else if (r.type === "manuscript") {
        occurrences.manuscripts.push(r.submitted);
        if (r.indexed) occurrences.indexed.push([r.accepted, r.published].filter(Boolean).sort()[0] ?? "");
      } else if (r.type === "delivery" && through(r.day)) {
        if (d.recruitmentTarget !== null) recruited += r.recruited;
        if (d.samplesTarget !== null) collected += r.samples;
      } else if (r.type === "lab" && through(r.day) && (!f.method || r.method.toLowerCase().includes(f.method.toLowerCase()))) {
        if (r.approved && r.activity !== "Confirmed zero") occurrences.labMonths.push(r.day);
        if (within(r.day)) {
          const month = r.day.slice(0, 7);
          const key = JSON.stringify([month, r.method]);
          const entry = labCalendar.get(key) ?? { month, method: r.method, approved: 0, zero: 0, unreviewed: 0 };
          if (!r.approved) entry.unreviewed++;
          else if (r.activity === "Confirmed zero") entry.zero++;
          else entry.approved++;
          labCalendar.set(key, entry);
          if (r.processed !== null && r.rejected !== null) { rejected += r.rejected; rejectedDenom += r.processed; }
          if (r.processed !== null && r.repeated !== null) { repeats += r.repeated; repeatDenom += r.processed; }
        }
        addInterval("Lab accession to report", r.accession, r.report);
      }
    }
  }
  const uniqueMonths = (days: string[]) => new Set(days.map(day => day.slice(0, 7))).size;
  const measures = metricKeys.map(key => ({
    key,
    events: key === "labMonths" ? uniqueMonths(occurrences[key].filter(within)) : occurrences[key].filter(within).length,
    cumulative: key === "labMonths"
      ? uniqueMonths(occurrences[key].filter(day => day >= annualStart && day <= annualEnd && through(day)))
      : occurrences[key].filter(day => through(day) && (!config.start || day >= config.start)).length,
    target: config.targets[key][year - 1],
  }));
  const feedbackScope = Object.values({ lead: f.lead, collaborator: f.collaborator, pi: f.pi, wave: f.wave, method: f.method, cycle: f.cycle }).some(Boolean);
  const stakeholder = !feedbackScope && ["admin", "management"].includes(actor.role) ? await feedbackTotals(db, actor, f.from, f.to) : null;
  const correctionRows = stakeholder ? (await db.query<{ opened: string; due: string; resolved: string }>(
    "SELECT DISTINCT ON(subject) data->'snapshot'->>'opened' AS opened,data->'snapshot'->>'due' AS due,data->'snapshot'->>'resolved' AS resolved FROM events WHERE scope='correction' AND occurred_at < (($1::date+1)::timestamp AT TIME ZONE 'Asia/Kolkata') ORDER BY subject,id DESC", [cutoff])).rows : null;
  const actions = correctionRows ? {
    opened: correctionRows.filter(row => within(row.opened)).length,
    due: correctionRows.filter(row => within(row.due)).length,
    resolved: correctionRows.filter(row => within(row.resolved)).length,
  } : null;
  const labMethods = [...new Set([...studies.flatMap(study => study.records.flatMap(record => record.type === "lab" && through(record.day) ? [record.method] : [])),
    ...studies.flatMap(study => study.fields.methods)])].filter(method => !f.method || method.toLowerCase().includes(f.method.toLowerCase()));
  const labMonths: string[] = [];
  for (let offset = 0, month = f.from.slice(0, 7) + "-01"; month <= cutoff; month = addMonths(f.from.slice(0, 7) + "-01", ++offset)) labMonths.push(month.slice(0, 7));
  return {
    filter: f, departmentLabels: { lead: nameOf(f.lead), collaborator: nameOf(f.collaborator) },
    cutoff, year, stage, total: studies.length, targetVersion, targetsApproved: config.targetsApproved,
    planned: config.planned, measures, overdue, overdueActions, timeliness: pair(onTime, due), turnaround: Object.entries(timings).map(([label, values]) => ({ label, ...median(values) })),
    recruitment: pair(recruited, plannedRecruitment), samples: pair(collected, plannedSamples),
    rejection: pair(rejected, rejectedDenom), repeats: pair(repeats, repeatDenom),
    funding: { budget, spent, pairedBudgets, recordedBudget, budgetCount, recordedSpend, spendCount, pending, awards: pair(awarded, decided) },
    laboratory: [...labCalendar.values()].sort((a, b) => a.month.localeCompare(b.month) || a.method.localeCompare(b.method)),
    labMethods, labMonths, stakeholder, actions,
  };
}

export type Results = Awaited<ReturnType<typeof calculateReport>>;
const followup = z.object({ finding: short.min(1), owner: short.min(1), due: date });
export const reviewInput = z.object({
  id: optionalId, revision: z.number().int().min(0), command: z.enum(["draft", "freeze", "correct"]),
  filter: reportInput, notes: long, followups: z.array(followup).max(30), reason: long,
});
type ReviewData = { filter: ReportFilter; notes: string; followups: z.infer<typeof followup>[]; reason: string; results?: Results };
export type Review = { id: string; series_id: string; version: number; revision: number; data: ReviewData; frozen_at: Date | null };

export async function listReviews(db: Queryable, actor: Actor, id?: string) {
  if (!["admin", "coordinator", "management"].includes(actor.role)) throw new Problem("Review access required.", 403);
  return (await db.query<Review>("SELECT id,series_id,version,revision,data,frozen_at FROM reviews WHERE ($1::uuid IS NULL OR id=$1) AND ($2 OR frozen_at IS NOT NULL) ORDER BY data->'filter'->>'to' DESC,version DESC", [id ? uid.parse(id) : null, actor.role !== "management"])).rows;
}

export async function saveReview(db: Database, actor: Actor, raw: unknown) {
  if (!editable(actor)) throw new Problem("Review editing access required.", 403);
  const { id, revision, command, filter, notes, followups, reason } = reviewInput.parse(raw);
  if (command !== "draft" && actor.role !== "admin") throw new Problem("R&D review authority required.", 403);
  return db.transaction(async tx => {
    if (command === "freeze") await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    const prior = id ? (await tx.query<Review>("SELECT id,series_id,version,revision,data,frozen_at FROM reviews WHERE id=$1 FOR UPDATE", [id])).rows[0] : null;
    if (id && (!prior || prior.revision !== revision)) throw new Problem("The review changed. Reload before saving.", 409);
    if (filter.to < filter.from) throw new Problem("The end date must follow the start date.");
    if (command === "correct") {
      if (!prior?.frozen_at || !reason) throw new Problem("Choose a frozen review and enter a correction reason.");
      const latest = (await tx.query<{ version: number }>("SELECT max(version)::int AS version FROM reviews WHERE series_id=$1", [prior.series_id])).rows[0].version;
      if (latest !== prior.version) throw new Problem("Start the correction from the latest version.", 409);
      const nextId = randomUUID();
      const data = { filter: prior.data.filter, notes: prior.data.notes, followups: prior.data.followups, reason };
      await tx.query("INSERT INTO reviews(id,series_id,version,actor,data) VALUES($1,$2,$3,$4,$5)", [nextId, prior.series_id, latest + 1, actor.id, JSON.stringify(data)]);
      await audit(tx, "review", nextId, actor.id, "Review correction drafted", { reason, previous: prior.id });
      return nextId;
    }
    if (prior?.frozen_at) throw new Problem("Frozen reviews are read-only.", 409);
    if (command === "freeze" && !prior) throw new Problem("Save a draft before freezing.");
    if (command === "freeze" && filter.to > today()) throw new Problem("The reporting period must end before it can be frozen.");
    const data: ReviewData = { filter, notes, followups, reason: prior?.data.reason ?? "" };
    if (command === "freeze") data.results = await calculateReport(tx, actor, filter);
    const key = id || randomUUID();
    if (prior) await tx.query("UPDATE reviews SET data=$2,revision=revision+1,frozen_at=CASE WHEN $3 THEN now() ELSE NULL END WHERE id=$1", [id, JSON.stringify(data), command === "freeze"]);
    else await tx.query("INSERT INTO reviews(id,series_id,version,actor,data) VALUES($1,$1,1,$2,$3)", [key, actor.id, JSON.stringify(data)]);
    await audit(tx, "review", key, actor.id, command === "freeze" ? "Review frozen" : "Review draft saved", { snapshot: data });
    return key;
  });
}

export function safeCsv(rows: (string | number | null)[][]) {
  return rows.map(row => row.map(value => {
    const text = String(value ?? "");
    const safe = typeof value === "string" && /^\s*[=+\-@]|^[\t\r\n]/.test(text) ? "'" + text : text;
    return '"' + safe.replaceAll('"', '""') + '"';
  }).join(",")).join("\r\n");
}

export function reportCsv(r: Results) {
  return safeCsv([
    ["Period start", r.filter.from, "Period end", r.filter.to, "As-of cutoff", r.cutoff],
    ["Lead department ID", r.filter.lead, "Collaborating department ID", r.filter.collaborator, "PI", r.filter.pi],
    ["Lead department", r.departmentLabels?.lead ?? r.filter.lead, "Collaborating department", r.departmentLabels?.collaborator ?? r.filter.collaborator],
    ["Wave", r.filter.wave, "Method", r.filter.method, "Cycle", r.filter.cycle],
    ["Target version", r.targetVersion, "Target status", r.targetsApproved ? "Approved" : "Planning", "Planned denominator", r.planned],
    ["Measure", "Period", "Cumulative", "Year " + r.year + " target"],
    ...r.measures.map(m => [m.key, m.events, m.cumulative, m.target]),
    ["Stage at cutoff", "Study count"], ...Object.entries(r.stage),
    ["Rate", "Numerator", "Denominator", "Rate"],
    ...Object.entries({ timeliness: r.timeliness, recruitment: r.recruitment, samples: r.samples, rejection: r.rejection, repeats: r.repeats, awards: r.funding.awards })
      .map(([key, item]) => [key, item.numerator, item.denominator, item.rate ?? "Insufficient data"]),
    ["Turnaround", "Intervals", "Median days"], ...r.turnaround.map(item => [item.label, item.count, item.days ?? "Insufficient data"]),
    ["Budget (INR)", r.funding.budget, "Spend (INR)", r.funding.spent, "Comparable studies", r.funding.pairedBudgets],
    ["All known approved budgets (INR)", r.funding.recordedBudget ?? null, "Studies", r.funding.budgetCount ?? null],
    ["All known recorded spend (INR)", r.funding.recordedSpend ?? null, "Studies", r.funding.spendCount ?? null],
    ["Pending grants", r.funding.pending, "Overdue milestones", r.overdue, "Overdue actions", r.overdueActions],
    ["Lab month", "Method", "Approved activity records", "Confirmed-zero records", "Unreviewed records"],
    ...r.labMonths.flatMap(month => {
      const rows = r.laboratory.filter(item => item.month === month);
      return rows.length ? rows.map(item => [item.month, item.method, item.approved, item.zero, item.unreviewed])
        : [[month, "", "", "", "Unreviewed"]];
    }),
    ...(r.stakeholder ? [["Feedback responses", r.stakeholder.count, "Suppression applied", r.stakeholder.suppressed ? "Yes" : "No"],
      ["Question", "Responses", "1", "2", "3", "4", "5"], ...r.stakeholder.ratings.map(row => [row.key, row.count, ...row.distribution])] : []),
    ...(r.actions ? [["Corrective actions opened", r.actions.opened, "Due", r.actions.due, "Resolved", r.actions.resolved]] : []),
  ]);
}
