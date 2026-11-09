import { ActionForm } from "./forms";
import { Area, Badge, Check, Empty, Heading, Hidden, Select, Text } from "./ui";
import { FeedbackDistribution } from "./reviews";
import { feedbackLeadership, feedbackReviewer, type Campaign, type Correction, type FeedbackRow, type feedbackTotals } from "@/lib/feedback";
import { actionStatuses, feedbackRoles, questions, today, type Actor, type Study } from "@/lib/model";

function CorrectiveForm({ campaign, response = "", action }: { campaign: string; response?: string; action?: Correction }) {
  return <ActionForm command="corrective">
    <Hidden values={{ id: action?.id ?? "", campaign, response, expected: action?.revision ?? 0 }} />
    <div className="form-grid">
      <Text name="finding" label="Finding or corrective action" value={action?.data.finding} required />
      <Text name="owner" label="Owner" value={action?.data.owner} required />
      <Text name="due" label="Deadline" type="date" value={action?.data.due} required />
      <Select name="status" label="Status" value={action?.data.status} choices={actionStatuses} />
    </div>
    <Area name="resolution" label="Resolution notes" value={action?.data.resolution} rows={2} /><button className="btn small primary">Save corrective action</button>
  </ActionForm>;
}

export function Feedback({ actor, campaigns, studies, responses, actions, aggregate }: {
  actor: Actor; campaigns: Campaign[]; studies: Study[]; responses: FeedbackRow[]; actions: Correction[];
  aggregate: Awaited<ReturnType<typeof feedbackTotals>> | null;
}) {
  const day = today();
  const open = campaigns.filter(campaign => campaign.data.opens <= day && campaign.data.closes >= day);
  const names = new Map(campaigns.map(campaign => [campaign.id, campaign.data.title]));
  return <>
    <Heading kicker="Stakeholder experience" title="Feedback" description="Share programme feedback and track follow-up on issues raised." />
    <div className="stack">
      {actor.role === "admin" && <section className="card padded"><p className="eyebrow">Campaign administration</p><h2>New feedback campaign</h2>
        <ActionForm command="campaign"><div className="form-grid triple"><Text name="title" label="Campaign title" required />
          <Text name="opens" label="Opens" type="date" value={day} required /><Text name="closes" label="Closes" type="date" required /></div>
          <div className="form-grid"><Check name="anonymous" label="Offer anonymous responses" /><Check name="projectFeedback" label="Allow project-specific feedback" /></div>
          <button className="btn primary">Create campaign</button>
        </ActionForm>
      </section>}
      <section className="card padded"><p className="eyebrow">Your feedback</p><h2>Open campaigns</h2>
        {open.length ? open.map(campaign => <details key={campaign.id} className="sub-details"><summary>{campaign.data.title} <small>Closes {campaign.data.closes}</small></summary>
          <p className="muted fine">One response per account for this campaign. Use project-level information and omit patient or participant information.</p>
          <ActionForm command="feedback">
            <Hidden values={{ campaign: campaign.id, ...(campaign.data.projectFeedback ? {} : { study: "" }) }} />
            <div className="form-grid"><Select name="perspective" label="Your perspective" choices={feedbackRoles} empty="Select a perspective" required />
              {campaign.data.projectFeedback && <Select name="study" label="Project (optional)" choices={studies.map(study => ({ id: study.id, name: study.id + " · " + study.title }))} empty="Programme feedback" />}</div>
            {campaign.data.anonymous && <Check name="anonymous" label="Submit anonymously. Leave identifying details out of comments." />}
            <div className="form-grid">{Object.entries(questions).map(([key, label]) => <Select key={key} name={key} label={label} empty="Skip question"
              choices={[{ id:"1",name:"1 · Very poor" },"2","3","4",{ id:"5",name:"5 · Excellent" },{ id:"NA",name:"Not applicable" }]} />)}</div>
            <Area name="comments" label="Additional comments (optional)" /><Area name="improvement" label="Most important improvement (optional)" />
            <button className="btn primary">Submit feedback</button>
          </ActionForm>
        </details>) : <Empty title="No open feedback campaigns" detail="Available campaigns will appear here during their response windows." />}
      </section>
      {feedbackLeadership(actor) && aggregate && <section className="card padded"><h2>Programme ratings</h2><FeedbackDistribution data={aggregate} /></section>}
      {feedbackReviewer(actor) && <>
        <section className="card padded"><p className="eyebrow">Designated reviewers</p><h2>Response comments</h2>
          {responses.length ? responses.map(response => <details className="sub-details" key={response.id}><summary>{names.get(response.campaign_id)} <small>{response.name || "Anonymous"}</small></summary>
            <p className="muted">{response.day} {response.study_id && "· " + response.study_id} {response.data.perspective && "· " + response.data.perspective}</p>
            <p className="preserve-lines">{response.data.comments || "No comments."}</p>{response.data.improvement && <p className="preserve-lines"><strong>Suggested improvement</strong><br />{response.data.improvement}</p>}
            <h3>Log a corrective action</h3><CorrectiveForm campaign={response.campaign_id} response={response.id} />
          </details>) : <Empty title="No reportable comments" detail="Anonymous campaign comments become visible after five anonymous submissions." />}
        </section>
        <section className="card padded"><h2>Corrective actions</h2>
          {actions.length ? actions.map(action => <details className="sub-details" key={action.id}><summary>{action.data.finding} <Badge value={action.data.status !== "Resolved" && action.data.due < day ? "Overdue" : action.data.status} /></summary>
            <p className="muted">{action.data.owner} · Due {action.data.due}</p><CorrectiveForm campaign={action.campaign_id} response={action.response_id ?? ""} action={action} />
          </details>) : <Empty title="No corrective actions" detail="Log a follow-up from a feedback response to track its owner, deadline and resolution." />}
        </section>
      </>}
    </div>
  </>;
}
