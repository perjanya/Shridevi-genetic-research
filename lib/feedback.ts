import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, Problem, type Database, type Queryable } from "./db";
import { actionStatuses, date, feedbackRoles, long, optionalId, questions, required, studyId, today, uid, version, type Actor } from "./model";
import { getStudy } from "./studies";

const questionKeys = Object.keys(questions) as [keyof typeof questions, ...(keyof typeof questions)[]];
export const campaignInput = z.object({ title: required, opens: date, closes: date, anonymous: z.boolean(), projectFeedback: z.boolean() });
type CampaignData = z.infer<typeof campaignInput>;
export type Campaign = { id: string; data: CampaignData };
const responseInput = z.object({
  campaign: uid, study: z.union([studyId, z.literal("")]), anonymous: z.boolean(),
  perspective: z.enum(feedbackRoles), ratings: z.partialRecord(z.enum(questionKeys), z.union([z.number().int().min(1).max(5), z.literal("NA")])),
  comments: long, improvement: long,
});
export type FeedbackInput = z.infer<typeof responseInput>;
export const correctionInput = z.object({
  id: optionalId, campaign: uid, response: optionalId, expected: z.number().int().min(0),
  finding: required, owner: required, due: date, status: z.enum(actionStatuses), resolution: long,
});
type CorrectionData = Omit<z.infer<typeof correctionInput>, "id" | "campaign" | "response" | "expected"> & { opened: string; resolved: string };
export type Correction = { id: string; campaign_id: string; response_id: string | null; revision: number; data: CorrectionData };

export function feedbackReviewer(actor: Actor) { return actor.role === "feedback"; }
export function feedbackLeadership(actor: Actor) { return ["admin", "management", "feedback"].includes(actor.role); }

export async function listCampaigns(db: Queryable) {
  return (await db.query<Campaign>("SELECT id,data FROM campaigns ORDER BY data->>'opens' DESC,id")).rows;
}
export async function createCampaign(db: Database, actor: Actor, raw: unknown) {
  if (actor.role !== "admin") throw new Problem("Administrator access required.", 403);
  const data = campaignInput.parse(raw);
  if (data.closes < data.opens) throw new Problem("The campaign closing date must follow its opening date.");
  const id = randomUUID();
  await db.transaction(async tx => {
    await tx.query("INSERT INTO campaigns(id,data) VALUES($1,$2)", [id, JSON.stringify(data)]);
    await audit(tx, "feedback", id, actor.id, "Campaign created", data);
  });
}

export async function submitFeedback(db: Database, actor: Actor, raw: unknown) {
  const { campaign, study, anonymous, perspective, ratings, comments, improvement } = responseInput.parse(raw);
  const day = today();
  await db.transaction(async tx => {
    const found = (await tx.query<Campaign>("SELECT id,data FROM campaigns WHERE id=$1", [campaign])).rows[0];
    if (!found || day < found.data.opens || day > found.data.closes) throw new Problem("This campaign is closed.");
    if (anonymous && !found.data.anonymous) throw new Problem("Anonymous feedback is disabled for this campaign.");
    if (study) {
      if (!found.data.projectFeedback) throw new Problem("Project feedback is disabled for this campaign.");
      if (actor.role === "management") {
        if (!(await tx.query("SELECT id FROM studies WHERE id=$1", [study])).rows.length) throw new Problem("Study was not found.", 404);
      } else await getStudy(tx, actor, study);
    }
    if (!Object.keys(ratings).length && !comments && !improvement) throw new Problem("Enter at least one rating or comment.");
    const redemption = await tx.query("INSERT INTO feedback_redemptions(campaign_id,account_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING campaign_id", [campaign, actor.id]);
    if (!redemption.rows.length) throw new Problem("You already submitted feedback for this campaign.", 409);
    await tx.query("INSERT INTO feedback_responses(id,campaign_id,study_id,named_account,submitted_day,data) VALUES($1,$2,$3,$4,$5,$6)",
      [randomUUID(), campaign, study || null, anonymous ? null : actor.id, day, JSON.stringify({ ...(anonymous ? {} : { perspective }), ratings, comments, improvement })]);
  });
}

export type FeedbackRow = { id: string; campaign_id: string; study_id: string | null; named_account: string | null; name: string | null; day: string;
  data: { perspective?: string; ratings: FeedbackInput["ratings"]; comments: string; improvement: string } };

export async function feedbackTotals(db: Queryable, actor: Actor, from = "0001-01-01", to = "9999-12-31") {
  if (!feedbackLeadership(actor)) throw new Problem("Feedback summaries are restricted.", 403);
  const { rows } = await db.query<Pick<FeedbackRow, "named_account" | "campaign_id" | "data">>(
    "SELECT named_account,campaign_id,jsonb_build_object('ratings',data->'ratings') AS data FROM feedback_responses WHERE submitted_day BETWEEN $1 AND $2", [from, to]);
  const anonymousCounts = new Map<string, number>();
  for (const row of rows) if (!row.named_account) anonymousCounts.set(row.campaign_id, (anonymousCounts.get(row.campaign_id) ?? 0) + 1);
  const visible = rows.filter(row => row.named_account || (anonymousCounts.get(row.campaign_id) ?? 0) >= 5);
  return {
    count: visible.length, suppressed: visible.length !== rows.length,
    ratings: questionKeys.map(key => {
      const anonymousRated = new Map<string, number>();
      for (const row of visible) if (!row.named_account && typeof row.data.ratings[key] === "number")
        anonymousRated.set(row.campaign_id, (anonymousRated.get(row.campaign_id) ?? 0) + 1);
      const values = visible.filter(row => row.named_account || (anonymousRated.get(row.campaign_id) ?? 0) >= 5)
        .map(row => row.data.ratings[key]).filter((value): value is number => typeof value === "number");
      return { key, count: values.length, distribution: [1, 2, 3, 4, 5].map(score => values.filter(value => value === score).length) };
    }),
  };
}

export async function feedbackComments(db: Queryable, actor: Actor) {
  if (!feedbackReviewer(actor)) throw new Problem("Designated reviewer access required.", 403);
  return (await db.query<FeedbackRow>(
    "SELECT f.id,f.campaign_id,CASE WHEN f.named_account IS NOT NULL THEN f.study_id END AS study_id,f.named_account,a.name,CASE WHEN f.named_account IS NOT NULL THEN f.submitted_day::text ELSE '' END AS day,f.data FROM feedback_responses f LEFT JOIN accounts a ON a.id=f.named_account WHERE f.named_account IS NOT NULL OR (SELECT count(*) FROM feedback_responses r WHERE r.campaign_id=f.campaign_id AND r.named_account IS NULL)>=5 ORDER BY day DESC,f.id")).rows;
}

export async function corrections(db: Queryable, actor: Actor) {
  if (!feedbackReviewer(actor)) throw new Problem("Designated reviewer access required.", 403);
  return (await db.query<Correction>("SELECT id,campaign_id,response_id,revision,data FROM corrective_actions ORDER BY data->>'due'")).rows;
}

export async function saveCorrection(db: Database, actor: Actor, raw: unknown) {
  if (!feedbackReviewer(actor)) throw new Problem("Designated reviewer access required.", 403);
  const { id, campaign, response, expected, ...input } = correctionInput.parse(raw);
  if (input.status === "Resolved" && !input.resolution) throw new Problem("Record how the action was resolved.");
  await db.transaction(async tx => {
    const prior = id ? (await tx.query<Correction>("SELECT id,campaign_id,response_id,revision,data FROM corrective_actions WHERE id=$1 FOR UPDATE", [id])).rows[0] : null;
    if (id && (!prior || prior.revision !== version.parse(expected))) throw new Problem("This action changed. Reload before saving.", 409);
    if (response && !prior) {
      const eligible = (await tx.query("SELECT f.id FROM feedback_responses f WHERE f.id=$1 AND f.campaign_id=$2 AND (f.named_account IS NOT NULL OR (SELECT count(*) FROM feedback_responses r WHERE r.campaign_id=$2 AND r.named_account IS NULL)>=5)", [response, campaign])).rows.length;
      if (!eligible) throw new Problem("This response is unavailable.", 404);
    }
    const data: CorrectionData = { ...input, opened: prior?.data.opened ?? today(), resolved: input.status === "Resolved" ? prior?.data.resolved || today() : "" };
    const key = id || randomUUID();
    if (prior) await tx.query("UPDATE corrective_actions SET data=$2,revision=revision+1 WHERE id=$1", [key, JSON.stringify(data)]);
    else await tx.query("INSERT INTO corrective_actions(id,campaign_id,response_id,data) VALUES($1,$2,$3,$4)", [key, campaign, response || null, JSON.stringify(data)]);
    await audit(tx, "correction", key, actor.id, prior ? "Corrective action updated" : "Corrective action opened", { snapshot: data });
  });
}
