import { notFound, redirect } from "next/navigation";
import { Actions, Portfolio, Workspace, type Params } from "@/components/workspace";
import { StudyView, type Member, type StudyEvent } from "@/components/study";
import { Reviews } from "@/components/reviews";
import { Feedback } from "@/components/feedback";
import { Settings } from "@/components/settings";
import { valueFrom } from "@/components/ui";
import { postgres, Problem } from "@/lib/db";
import { listDocuments } from "@/lib/documents";
import { corrections, feedbackComments, feedbackLeadership, feedbackReviewer, feedbackTotals, listCampaigns } from "@/lib/feedback";
import { editable, studyId, today, uid } from "@/lib/model";
import { blankReportFilter, calculateReport, listReviews, reportInput, reportPeriod, type Results } from "@/lib/reports";
import { departments, getStudy, programme, reportingProgramme, visibleStudies } from "@/lib/studies";
import { requireActor } from "@/lib/web-auth";

export const dynamic = "force-dynamic";

function guarded<T>(result: Promise<T>) {
  return result.catch(error => {
    if (error instanceof Problem && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  });
}

export default async function Page({ params, searchParams }: { params: Promise<{ view?: string[] }>; searchParams: Promise<Params> }) {
  const [actor, route, search] = await Promise.all([requireActor(), params, searchParams]);
  const [view, id, tab = "", ...extra] = route.view ?? [];
  if (!view) redirect("/portfolio");
  if (extra.length) notFound();
  const db = postgres();
  const val = (key: string) => valueFrom(search, key);
  const accountDirectory = async (full = false) => (await db.query<Member>(
    "SELECT id,name,role,active,department_id," + (full ? "email" : "''::text AS email") + " FROM accounts ORDER BY name")).rows;
  let page: React.ReactNode;
  switch (view) {
      case "portfolio": {
        if (!id) {
          const [studies, directory, settings] = await Promise.all([visibleStudies(db, actor), departments(db), programme(db)]);
          page = <Portfolio studies={studies} departments={directory} settings={settings.data} actor={actor} params={search} />;
          break;
        }
        if (!studyId.safeParse(id).success || !["", "edit", "milestones", "delivery", "documents", "history"].includes(tab) || tab === "edit" && !editable(actor)) notFound();
        const study = await guarded(getStudy(db, actor, id));
        const [directory, settings, docs, events, accounts] = await Promise.all([
          departments(db), programme(db), tab === "documents" ? guarded(listDocuments(db, actor, id)) : [],
          tab === "history" ? db.query<StudyEvent>("SELECT e.id::text,e.kind,a.name AS actor_name,to_char(e.occurred_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD HH24:MI') AS happened,e.data-'snapshot' AS data FROM events e LEFT JOIN accounts a ON a.id=e.actor WHERE e.scope='study' AND e.subject=$1 ORDER BY e.id DESC", [id]).then(x => x.rows) : [],
          tab === "edit" ? accountDirectory() : [],
        ]);
        page = <StudyView study={study} tab={tab} actor={actor} departments={directory} settings={settings.data} documents={docs} events={events} accounts={accounts} lakh={val("units") === "lakh"} />;
        break;
      }
      case "actions": {
        if (id || actor.role === "management") notFound();
        const [studies, settings] = await Promise.all([visibleStudies(db, actor), programme(db)]);
        page = <Actions studies={studies} settings={settings.data} actor={actor} />;
        break;
      }
      case "reviews": {
        if (tab || !["admin", "coordinator", "management"].includes(actor.role) || id && !uid.safeParse(id).success) notFound();
        const [list, directory, settings] = await Promise.all([listReviews(db, actor, id), departments(db), reportingProgramme(db, val("cycle").slice(0, 240))]);
        const review = id ? list[0] : undefined;
        if (id && !review) notFound();
        const period = ["Quarterly","Half-yearly","Annual","Custom"].includes(val("period")) ? val("period") : "Quarterly";
        const anchor = /^\d{4}-\d{2}-\d{2}$/.test(val("to")) && !Number.isNaN(Date.parse(val("to"))) ? val("to") : today();
        const periodDates = period === "Custom" ? { from: val("from") || anchor, to: anchor } :
          reportPeriod(settings.data, anchor, period === "Half-yearly" ? 6 : period === "Annual" ? 12 : 3);
        const filter = review?.data.filter ?? { ...Object.fromEntries(Object.keys(blankReportFilter).map(key => [key, val(key)])), ...periodDates } as ReturnType<typeof reportInput.parse>;
        let error: string | undefined;
        let results: Results | undefined;
        const parsed = reportInput.safeParse(filter);
        if (!parsed.success) error = "Choose valid dates and reporting filters.";
        else if (actor.role !== "management" || review?.data.results) {
          try { results = review?.data.results ?? await calculateReport(db, actor, parsed.data); }
          catch (e) { if (e instanceof Problem) error = e.message; else throw e; }
        }
        page = <Reviews actor={actor} review={review} list={list} departments={directory} filter={filter} period={period} results={results} error={error} />;
        break;
      }
      case "feedback": {
        if (id) notFound();
        const [campaigns, studies, responses, actions, aggregate] = await Promise.all([
          listCampaigns(db), visibleStudies(db, actor), feedbackReviewer(actor) ? feedbackComments(db, actor) : [],
          feedbackReviewer(actor) ? corrections(db, actor) : [], feedbackLeadership(actor) ? feedbackTotals(db, actor) : null,
        ]);
        page = <Feedback actor={actor} campaigns={campaigns} studies={studies} responses={responses} actions={actions} aggregate={aggregate} />;
        break;
      }
      case "settings": {
        if (id || actor.role !== "admin") notFound();
        const [settings, directory, accounts] = await Promise.all([programme(db), departments(db), accountDirectory(true)]);
        page = <Settings actor={actor} programme={settings} departments={directory} accounts={accounts} />;
        break;
      }
      default: notFound();
  }
  return <Workspace actor={actor} current={view}>{page}</Workspace>;
}
