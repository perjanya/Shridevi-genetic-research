import { z } from "zod";

export const roles = {
  admin: "R&D administrator", coordinator: "Research coordinator", pi: "Principal investigator",
  guide: "PG guide", department: "Departmental lead", lab: "Laboratory lead",
  management: "Management viewer", feedback: "Feedback reviewer", scholar: "PG scholar",
} as const;
export type Role = keyof typeof roles;
export type Actor = { id: string; name: string; role: Role; department_id: string | null };
export const roleNames = Object.keys(roles) as [Role, ...Role[]];

export const tracks = {
  Preparation: { concept: "Concept entered", feasibility: "Feasibility screened", protocol: "Protocol drafted", endorsement: "PI endorsement" },
  Review: { srcSubmit: "SRC submitted", srcRevision: "SRC revision requested", srcDecision: "SRC decision", srcAmend: "SRC amendment", srcRenew: "SRC renewal", iecSubmit: "IEC submitted", iecRevision: "IEC revision requested", iecDecision: "IEC decision", iecAmend: "IEC amendment", iecRenew: "IEC renewal" },
  "Funding and activation": { piCommit: "PI funding commitment", coverage: "Cost coverage confirmed", sponsor: "Sponsor application", agreement: "Sponsor agreement", start: "Study start authorized" },
  "Study execution": { recruitOpen: "Recruitment opened", recruitDone: "Recruitment completed", collect: "Research sample collection", reconcile: "Samples reconciled", assays: "Assays completed", qc: "Quality checks", collectData: "Data collected", clean: "Data cleaned" },
  "Closeout and dissemination": { lock: "Dataset locked", analysis: "Analysis completed", final: "PI-approved final report", closeout: "Required closeout submitted", manuscript: "Manuscript submitted", accepted: "Manuscript accepted", published: "Manuscript published", impact: "Impact follow-up" },
} as const;
export const milestones = { ...tracks.Preparation, ...tracks.Review, ...tracks["Funding and activation"], ...tracks["Study execution"], ...tracks["Closeout and dissemination"] };
export type MilestoneKey = keyof typeof milestones;
export const keys = Object.keys(milestones) as [MilestoneKey, ...MilestoneKey[]];
export const committeeKeys: MilestoneKey[] = ["srcDecision", "srcAmend", "srcRenew", "iecDecision", "iecAmend", "iecRenew"];
export const authorityKeys: MilestoneKey[] = [...committeeKeys, "endorsement", "piCommit", "coverage", "start", "final"];
export const statuses = ["Pending", "In progress", "Completed", "Frozen", "Not applicable"] as const;
export const decisions = ["Approved", "Rejected", "Revision requested", "Exempt"] as const;
export const lifecycle = ["Open", "On hold", "Withdrawn", "Archived"] as const;
export const phases = ["Concept", "Preparation", "Review", "Funding", "Activated", "Execution", "Completed", "On hold", "Withdrawn", "Archived"] as const;
export const fundingStatuses = ["Unconfirmed", "Seeking funding", "Commitment recorded", "Coverage confirmed"] as const;
export const metrics = {
  screened: "Candidate concepts screened", endorsed: "PI-endorsed proposals", activated: "Studies activated",
  completed: "Studies completed", applications: "External grant applications submitted",
  awards: "External awards received (target sought)", manuscripts: "Manuscripts submitted",
  indexed: "Indexed papers accepted or published", labMonths: "Months with approved research lab activity",
} as const;
export type Metric = keyof typeof metrics;
export const metricKeys = Object.keys(metrics) as [Metric, ...Metric[]];
export const defaults: Record<Metric, [number, number, number]> = {
  screened: [25,25,25], endorsed: [8,17,25], activated: [4,11,18], completed: [1,6,15],
  applications: [2,5,8], awards: [0,1,2], manuscripts: [0,3,8], indexed: [0,1,4], labMonths: [8,10,11],
};
export const questions = {
  clarity: "Clarity of the research workflow", responsiveness: "Responsiveness of coordination",
  protocol: "Usefulness of protocol support", recruitment: "Recruitment coordination",
  samples: "Sample coordination", feasibility: "Feasibility of programme support",
} as const;
export const feedbackRoles = ["PI", "PG guide", "PG scholar", "Department lead", "Laboratory staff", "R&D or management"] as const;
export const actionStatuses = ["Open", "In progress", "Resolved"] as const;

export const short = z.string().trim().max(240);
export const long = z.string().trim().max(6000);
export const required = short.min(1);
export const date = z.iso.date();
export const optionalDate = z.union([date, z.literal("")]);
export const uid = z.uuid();
export const optionalId = z.union([uid, z.literal("")]);
export const studyId = z.string().regex(/^GL-\d{2,12}$/);
export const integer = z.number().int().min(0).max(1_000_000_000);
export const amount = z.number().nonnegative().max(1_000_000_000).multipleOf(0.01).nullable();
export const version = z.number().int().positive();
export const projectFields = z.object({
  title: required, question: long, rationale: long, objectives: long, studyType: short,
  wave: z.enum(["", "1", "2", "3", "Future"]), feasibility: long, methods: z.array(short).max(30),
  output: long, priority: z.enum(["Routine", "High", "Urgent"]), proposedStart: optionalDate,
  nextAction: short, owner: short, ownerAccount: optionalId, due: optionalDate,
  lead: optionalId, collaborators: z.array(uid).max(30),
  pi: short, guide: short, scholar: short, piAccount: optionalId, guideAccount: optionalId, scholarAccount: optionalId,
  estimateMin: amount, estimateMax: amount, approvedBudget: amount, committed: amount, spent: amount,
  piContribution: amount, piCostDescription: long, piCostBearer: short, funding: z.enum(fundingStatuses),
  lifecycle: z.enum(lifecycle), lifecycleReason: long,
  recruitmentTarget: integer.nullable(), samplesTarget: integer.nullable(),
  check30Recruitment: integer.nullable(), check60Recruitment: integer.nullable(), check90Recruitment: integer.nullable(),
  check30Samples: integer.nullable(), check60Samples: integer.nullable(), check90Samples: integer.nullable(),
  cycle: short, proposedLead: short, proposedCollaborators: long,
});
export type ProjectFields = z.infer<typeof projectFields>;

export function blankProject(title = ""): ProjectFields {
  return {
    title, question: "", rationale: "", objectives: "", studyType: "", wave: "", feasibility: "", methods: [],
    output: "", priority: "Routine", proposedStart: "", nextAction: "", owner: "", ownerAccount: "", due: "",
    lead: "", collaborators: [], pi: "", guide: "", scholar: "", piAccount: "", guideAccount: "", scholarAccount: "",
    estimateMin: null, estimateMax: null, approvedBudget: null, committed: null, spent: null,
    piContribution: null, piCostDescription: "", piCostBearer: "", funding: "Unconfirmed", lifecycle: "Open",
    lifecycleReason: "", recruitmentTarget: null, samplesTarget: null, check30Recruitment: null, check60Recruitment: null,
    check90Recruitment: null, check30Samples: null, check60Samples: null, check90Samples: null,
    cycle: "", proposedLead: "", proposedCollaborators: "",
  };
}

export const milestoneFields = z.object({
  status: z.enum(["Pending", "In progress", "Completed", "Not applicable"]),
  due: optionalDate, completed: optionalDate, responsible: short, approver: short,
  evidence: long, decision: z.enum(["", ...decisions]), expires: optionalDate,
  wait: z.enum(["", "External decision", "Coordinator follow-up"]),
});
export type Milestone = Omit<z.infer<typeof milestoneFields>, "status"> & {
  status: typeof statuses[number]; version: number; confirmedBy?: string; frozenBy?: string; frozenAt?: string; deadlineAtCompletion?: string;
};
export const blankMilestone: Milestone = {
  status: "Pending", due: "", completed: "", responsible: "", approver: "", evidence: "", decision: "", expires: "", wait: "", version: 0,
};

const recordBase = z.object({ id: uid.optional(), label: required, evidence: required });
export const recordInput = z.discriminatedUnion("type", [
  recordBase.extend({ type: z.literal("grant"), submitted: optionalDate, decisionDate: optionalDate, decision: z.enum(["Pending", "Awarded", "Declined", "Withdrawn"]), amount }),
  recordBase.extend({ type: z.literal("manuscript"), submitted: optionalDate, accepted: optionalDate, published: optionalDate, indexed: z.boolean() }),
  recordBase.extend({ type: z.literal("lab"), day: date, method: required, activity: z.enum(["Assay", "Quality control", "Confirmed zero"]), approved: z.boolean(), processed: integer.nullable(), rejected: integer.nullable(), repeated: integer.nullable(), accession: optionalDate, report: optionalDate }),
  recordBase.extend({ type: z.literal("delivery"), day: date, recruited: integer, samples: integer }),
]);
export type OperationalInput = z.infer<typeof recordInput>;
export type Operational = OperationalInput & { id: string };

export type StudyData = {
  fields: ProjectFields; milestones: Partial<Record<MilestoneKey, Milestone>>;
  records: Operational[]; entered: string;
};
export type Study = { id: string; title: string; version: number; data: StudyData };
export type Department = { id: string; name: string };

export const programmeInput = z.object({
  start: optionalDate, alignment: z.enum(["Programme", "Calendar"]), planned: integer.min(1),
  name: required, targetsApproved: z.boolean(),
  targets: z.record(z.enum(metricKeys), z.tuple([integer, integer, integer])),
  permissions: z.partialRecord(z.enum(keys), z.object({
    record: z.array(z.enum(roleNames)), confirm: z.array(z.enum(roleNames)),
    freeze: z.array(z.enum(roleNames)), reopen: z.array(z.enum(roleNames)),
  })),
  allowExemptions: z.boolean(),
});
export type Programme = z.infer<typeof programmeInput>;
export const defaultProgramme: Programme = {
  start: "", alignment: "Programme", planned: 25, name: "Three-year research programme", targetsApproved: false,
  targets: defaults, permissions: {}, allowExemptions: false,
};

export function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()); }
export function isDone(milestone?: Milestone) { return milestone?.status === "Completed" || milestone?.status === "Frozen"; }
export function broad(actor: Actor) { return ["admin", "coordinator", "management", "lab"].includes(actor.role); }
export function editable(actor: Actor) { return actor.role === "admin" || actor.role === "coordinator"; }
export function scoped(actor: Actor, fields: ProjectFields) {
  return broad(actor) ||
    (actor.role === "department" && !!actor.department_id && (fields.lead === actor.department_id || fields.collaborators.includes(actor.department_id))) ||
    (["pi", "guide"].includes(actor.role) && [fields.piAccount, fields.guideAccount].includes(actor.id)) ||
    (actor.role === "scholar" && fields.scholarAccount === actor.id);
}
export function projectDetails(actor: Actor, fields: ProjectFields) {
  return actor.role !== "management" && scoped(actor, fields);
}
export function canMilestone(actor: Actor, programme: Programme, key: MilestoneKey, action: "record" | "confirm" | "freeze" | "reopen") {
  if (["management", "feedback", "scholar"].includes(actor.role)) return false;
  const settings = programme.permissions[key]?.[action];
  if (settings) return settings.includes(actor.role);
  if (actor.role === "admin") return true;
  if (action === "record") return actor.role === "coordinator" ||
    (actor.role === "lab" && ["assays", "qc", "reconcile"].includes(key));
  return actor.role === "pi" && ["endorsement", "piCommit", "final"].includes(key) && action === "confirm";
}
