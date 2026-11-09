import { randomUUID } from "node:crypto";
import { audit, Problem, type Database, type Queryable } from "../lib/db";
import { blankProject, projectFields, studyId } from "../lib/model";
import { insertConcept, programme } from "../lib/studies";
import { readSheet } from "./read-workbook";

const columns = {
  id: "Study ID", title: "Proposed study", lead: "Proposed lead", wave: "Wave",
  minimum: "Low ₹ lakh", maximum: "High ₹ lakh", next: "Next action", owner: "Action owner", due: "Action due",
  collaborators: "Potential collaborators", methods: "Lab methods",
  outcome: "Design and main outcome", feasibility: "Feasibility condition",
};

async function department(tx: Queryable, name: string) {
  const inserted = (await tx.query<{ id: string }>("INSERT INTO departments(id,name) VALUES($1,$2) ON CONFLICT(name) DO NOTHING RETURNING id", [randomUUID(), name])).rows[0];
  if (inserted) {
    await audit(tx, "department", inserted.id, null, "Workbook department added", { name });
    return inserted.id;
  }
  return (await tx.query<{ id: string }>("SELECT id FROM departments WHERE name=$1", [name])).rows[0].id;
}

export async function importWorkbook(db: Database, file: string) {
  const { rows, date1904 } = await readSheet(file, "Dashboard");
  const header = rows.get(19);
  const positions = new Map<string, string>();
  for (const [column, value] of header ?? []) positions.set(String(value).trim(), column);
  for (const label of Object.values(columns)) if (!positions.has(label)) throw new Problem("Missing workbook column " + label + ".");
  const concepts: { id: string; fields: ReturnType<typeof blankProject> }[] = [];
  const ids = new Set<string>();
  for (const [index, row] of rows) {
    if (index <= 19) continue;
    const cell = (key: keyof typeof columns) => row.get(positions.get(columns[key])!) ?? null;
    const get = (key: keyof typeof columns) => String(cell(key) ?? "").trim();
    if (!get("id") && !get("title")) continue;
    const id = studyId.parse(get("id"));
    if (ids.has(id)) throw new Problem("Duplicate workbook study ID " + id + ".");
    ids.add(id);
    const toRupees = (key: "minimum" | "maximum") => {
      const value = cell(key);
      if (value === null) return null;
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Problem("Invalid estimate for " + id + ".");
      return Math.round(value * 10_000_000) / 100;
    };
    const due = cell("due");
    const dueDate = typeof due === "number"
      ? new Date(Date.parse(date1904 ? "1904-01-01" : "1899-12-30") + Math.floor(due) * 86_400_000).toISOString().slice(0, 10)
      : get("due");
    const fields = projectFields.parse({
      ...blankProject(get("title")), wave: get("wave"), proposedLead: get("lead"), proposedCollaborators: get("collaborators"),
      methods: get("methods").split(/,\s*/).filter(Boolean), output: get("outcome"), feasibility: get("feasibility"),
      studyType: get("outcome").split(". ")[0], nextAction: get("next"), owner: get("owner"),
      due: dueDate,
      estimateMin: toRupees("minimum"), estimateMax: toRupees("maximum"),
    });
    concepts.push({ id, fields });
  }
  if (!concepts.length) throw new Problem("No study concepts were found.");
  return db.transaction(async tx => {
    await tx.query("SELECT pg_advisory_xact_lock(518217)");
    const { data: settings } = await programme(tx);
    let inserted = 0;
    for (const { id, fields } of concepts) {
      if ((await tx.query("SELECT id FROM studies WHERE id=$1", [id])).rows.length) continue;
      // The source names are proposed affiliations. Populate directory options for later confirmation.
      const names = [fields.proposedLead, ...fields.proposedCollaborators.split(",").map(name => name.trim())].filter(Boolean);
      for (const name of new Set(names)) await department(tx, name);
      fields.cycle = settings.name;
      if (await insertConcept(tx, id, fields, null)) inserted++;
    }
    return { received: concepts.length, inserted, existing: concepts.length - inserted };
  });
}
