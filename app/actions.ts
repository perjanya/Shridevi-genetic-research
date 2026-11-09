"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { accountInput, addAccount, authenticate, endSession, sessionCookie } from "@/lib/accounts";
import { postgres, Problem } from "@/lib/db";
import { attachDocument } from "@/lib/documents";
import { campaignInput, correctionInput, createCampaign, saveCorrection, submitFeedback } from "@/lib/feedback";
import { editable, questions, keys, metricKeys, milestoneFields, programmeInput, projectFields, studyId, uid, type MilestoneKey } from "@/lib/model";
import { reportInput, saveReview } from "@/lib/reports";
import { deactivateAccount, saveDepartment, saveProgramme } from "@/lib/settings";
import { changeMilestone, createStudy, updateStudy, upsertRecord, type MilestoneCommand } from "@/lib/studies";
import { currentActor, verifyOrigin } from "@/lib/web-auth";

export type FormState = { error?: string; message?: string };
const get = (f: FormData, key: string) => typeof f.get(key) === "string" ? String(f.get(key)).trim() : "";
const entries = (f: FormData) => Object.fromEntries([...f].filter((entry): entry is [string, string] => typeof entry[1] === "string"));
const num = (f: FormData, key: string) => get(f, key) ? Number(get(f, key)) : null;
const checked = (f: FormData, key: string) => f.get(key) === "on";
const split = (value: string) => value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
const numberFields = ["estimateMin", "estimateMax", "approvedBudget", "committed", "spent", "piContribution", "recruitmentTarget", "samplesTarget",
  "check30Recruitment", "check60Recruitment", "check90Recruitment", "check30Samples", "check60Samples", "check90Samples"] as const;

function errorState(error: unknown): FormState {
  if (error instanceof Problem) return { error: error.message };
  if (error instanceof ZodError) return { error: error.issues.map(issue => [issue.path.join(" · "), issue.message].filter(Boolean).join(" — ")).join(" • ") };
  const code = (error as { code?: string } | null)?.code;
  if (code === "23505") return { error: "That value is already in use." };
  if (code === "23503") return { error: "The referenced record no longer exists." };
  if (code === "40001" || code === "40P01") return { error: "Another user updated these records. Reload and try again." };
  console.error("Dashboard action failed", code || (error instanceof Error && error.name));
  return { error: "The action could not be saved. Contact the dashboard administrator if it persists." };
}

export async function signIn(_state: FormState, f: FormData): Promise<FormState> {
  try {
    await verifyOrigin();
    const password = f.get("password");
    const { token, lifetime } = await authenticate(postgres(), get(f, "email"), typeof password === "string" ? password : "");
    (await cookies()).set(sessionCookie, token, { httpOnly: true, secure: process.env.APP_ORIGIN?.startsWith("https:"), sameSite: "lax", path: "/", maxAge: lifetime });
  } catch (error) { return errorState(error); }
  redirect("/portfolio");
}

export async function signOut() {
  await verifyOrigin();
  const jar = await cookies();
  const token = jar.get(sessionCookie)?.value;
  if (token) await endSession(postgres(), token);
  jar.delete(sessionCookie);
  redirect("/sign-in");
}

export async function mutate(_state: FormState, f: FormData): Promise<FormState> {
  let destination: string | undefined;
  try {
    await verifyOrigin();
    const actor = await currentActor();
    if (!actor) throw new Problem("Your session expired. Sign in again.", 401);
    const db = postgres();
    const v = entries(f);
    const reason = get(f, "reason");
    const expected = Number(get(f, "expected"));
    const project = () => studyId.parse(get(f, "study"));
    const command = get(f, "command");
    switch (command) {
      case "create": {
        const id = await createStudy(db, actor, get(f, "title"), reason);
        destination = "/portfolio/" + id;
        break;
      }
      case "update": {
        const fields = projectFields.parse({ ...v, ...Object.fromEntries(numberFields.map(key => [key, num(f, key)])), methods: split(get(f, "methods")), collaborators: f.getAll("collaborators") });
        await updateStudy(db, actor, project(), expected, fields, reason);
        break;
      }
      case "milestone": {
        const action = get(f, "action") as MilestoneCommand["action"];
        await changeMilestone(db, actor, project(), { key: get(f, "key") as MilestoneKey, expected, reason, action,
          fields: action === "record" ? milestoneFields.parse(v) : undefined });
        break;
      }
      case "record":
        await upsertRecord(db, actor, project(), expected, { ...v, id: v.id || undefined, approved: checked(f, "approved"),
          indexed: checked(f, "indexed"), ...Object.fromEntries(["amount", "processed", "rejected", "repeated", "recruited", "samples"].map(key => [key, num(f, key)])) });
        break;
      case "document": {
        const file = f.get("file");
        await attachDocument(db, actor, project(), get(f, "slot"), file instanceof File && file.size > 0 ? file : null, get(f, "link"));
        break;
      }
      case "programme": {
        const settings = programmeInput.parse({ ...v, planned: num(f, "planned"), allowExemptions: checked(f, "allowExemptions"),
          targetsApproved: checked(f, "targetsApproved"), targets: Object.fromEntries(metricKeys.map(key => [key, [1, 2, 3].map(y => num(f, key + y))])),
          permissions: Object.fromEntries(keys.filter(key => checked(f, key + "-enabled")).map(key => [key,
            Object.fromEntries(["record", "confirm", "freeze", "reopen"].map(step => [step, f.getAll(key + "-" + step)]))])) });
        await saveProgramme(db, actor, settings, expected);
        break;
      }
      case "department": await saveDepartment(db, actor, get(f, "id"), get(f, "name")); break;
      case "account": await db.transaction(tx => addAccount(tx, accountInput.parse({ ...v, password: f.get("password") }), actor)); break;
      case "deactivate": await deactivateAccount(db, actor, get(f, "id")); break;
      case "review": {
        if (!editable(actor)) throw new Problem("Review editing access required.", 403);
        const action = get(f, "action");
        const rawFollowups = f.getAll("finding").map((finding, i) => ({ finding, owner: f.getAll("followupOwner")[i], due: f.getAll("followupDue")[i] }));
        const followups = rawFollowups.filter(item => item.finding || item.owner || item.due);
        const id = await saveReview(db, actor, { id: v.id, revision: expected, command: action, notes: v.notes || "", reason, filter: reportInput.parse(v), followups });
        destination = "/reviews/" + id;
        break;
      }
      case "campaign":
        await createCampaign(db, actor, campaignInput.parse({ ...v, anonymous: checked(f, "anonymous"), projectFeedback: checked(f, "projectFeedback") }));
        break;
      case "feedback": {
        const ratings = Object.fromEntries(Object.keys(questions).filter(key => get(f, key)).map(key => [key, get(f, key) === "NA" ? "NA" : num(f, key)]));
        await submitFeedback(db, actor, { ...v, anonymous: checked(f, "anonymous"), ratings });
        break;
      }
      case "corrective":
        await saveCorrection(db, actor, correctionInput.parse({ ...v, expected, campaign: uid.parse(v.campaign) }));
        break;
      default: throw new Problem("Unknown action.", 404);
    }
    revalidatePath("/", "layout");
  } catch (error) { return errorState(error); }
  if (destination) redirect(destination);
  return { message: "Saved." };
}
