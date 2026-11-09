import { postgres, Problem } from "@/lib/db";
import { blankReportFilter, calculateReport, listReviews, reportCsv, reportInput, safeCsv } from "@/lib/reports";
import { uid } from "@/lib/model";
import { currentActor } from "@/lib/web-auth";

export async function GET(request: Request) {
  const actor = await currentActor();
  if (!actor) return new Response("Sign in required", { status: 401 });
  if (!["admin", "coordinator", "management"].includes(actor.role)) return new Response("Report access required", { status: 403 });
  const db = postgres();
  const params = new URL(request.url).searchParams;
  try {
    let output: string;
    const id = params.get("review");
    if (id) {
      if (!uid.safeParse(id).success) return new Response("Review was not found", { status: 404 });
      const [review] = await listReviews(db, actor, id);
      if (!review?.frozen_at || !review.data.results) return new Response("Frozen review was not found", { status: 404 });
      output = reportCsv(review.data.results) + "\r\n" + safeCsv([
        ["Frozen version", review.version, "Frozen at", new Date(review.frozen_at).toISOString()], ["Findings", review.data.notes], ["Correction reason", review.data.reason],
        ["Follow-up", "Owner", "Due"], ...review.data.followups.map(item => [item.finding, item.owner, item.due]),
      ]);
    } else {
      if (actor.role === "management") return new Response("Live reports are restricted", { status: 403 });
      const filter = reportInput.safeParse({ ...blankReportFilter, ...Object.fromEntries(params) });
      if (!filter.success) return new Response("Invalid report filters", { status: 400 });
      output = reportCsv(await calculateReport(db, actor, filter.data));
    }
    return new Response("\ufeff" + output, { headers: {
      "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=shridevi-review.csv", "Cache-Control": "private, no-store",
    } });
  } catch (error) {
    if (error instanceof Problem) return new Response(error.message, { status: error.status });
    throw error;
  }
}
