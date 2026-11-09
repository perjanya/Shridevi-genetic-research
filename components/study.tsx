import Link from "next/link";
import { ArrowLeft, Download, FileText, Lock, ShieldAlert } from "lucide-react";
import { ActionForm } from "./forms";
import { Area, Badge, Check, Empty, Heading, Hidden, inr, Select, Text } from "./ui";
import { blankMilestone, canMilestone, committeeKeys, decisions, editable, fundingStatuses, isDone, lifecycle, roles, today, tracks, type Actor, type Department, type MilestoneKey, type Operational, type Programme, type Study } from "@/lib/model";
import { activationBlockers, phase } from "@/lib/studies";
import { addDays } from "@/lib/reports";
import type { listDocuments } from "@/lib/documents";

export type Member = { id: string; name: string; role: Actor["role"]; email: string; active: boolean; department_id: string | null };
export type StudyEvent = { id: string; kind: string; actor_name: string | null; happened: string; data: { change?: unknown; reason?: string; slot?: string; version?: number; filename?: string } };
const tabs = [
  { id: "", name: "Overview" }, { id: "edit", name: "Study details" }, { id: "milestones", name: "Milestones" },
  { id: "delivery", name: "Delivery & outputs" }, { id: "documents", name: "Documents" }, { id: "history", name: "History" },
];
const numberProps = { type: "number", min: 0 };
const moneyProps = { ...numberProps, step: "0.01" };

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt>{label}</dt><dd>{children || "—"}</dd></div>;
}

function Overview({ study, directory, settings, lakh }: { study: Study; directory: Department[]; settings: Programme; lakh: boolean }) {
  const { fields: d, milestones: m } = study.data;
  const names = new Map(directory.map(item => [item.id, item.name]));
  const blockers = activationBlockers(study.data, settings, today());
  const display = (n: number | null) => inr(n, lakh);
  return <>
    <div className="detail-grid">
      <section className="card padded"><p className="eyebrow">Project team</p><h2>Ownership</h2><dl className="info-grid">
        <Info label="Lead department">{names.get(d.lead) || (d.proposedLead ? d.proposedLead + " · proposed" : "")}</Info>
        <Info label="Collaborating departments">{d.collaborators.length ? d.collaborators.map(id => names.get(id)).join(", ") : d.proposedCollaborators ? d.proposedCollaborators + " · proposed" : ""}</Info>
        <Info label="Principal Investigator">{d.pi}</Info><Info label="PG guide">{d.guide}</Info><Info label="PG scholar">{d.scholar}</Info>
        <Info label="Programme cycle">{d.cycle}</Info><Info label="Action owner">{d.owner}</Info><Info label="Next action due">{d.due}</Info>
      </dl>{d.nextAction && <div className="inline-note"><strong>Next action</strong><br />{d.nextAction}</div>}</section>
      <section className="card padded"><div className="heading-row"><div><p className="eyebrow">Funding plan</p><h2>Budget and expenditure</h2></div><Link className="btn small" href={"/portfolio/" + study.id + (lakh ? "" : "?units=lakh")}>{lakh ? "Show INR" : "Show lakh"}</Link></div>
        <dl className="info-grid"><Info label="Estimated direct study cost">{d.estimateMin === d.estimateMax ? display(d.estimateMin) : display(d.estimateMin) + " – " + display(d.estimateMax)}</Info>
          <Info label="Approved budget">{display(d.approvedBudget)}</Info><Info label="Funds committed">{display(d.committed)}</Info><Info label="Actual spend">{display(d.spent)}</Info>
          <Info label="Estimated PI contribution or PI-managed cost (₹)">{display(d.piContribution)}</Info><Info label="Expected payer">{d.piCostBearer}</Info>
        </dl>{d.piCostDescription && <p className="muted">{d.piCostDescription}</p>}<p className="muted fine">PI contribution is a funding component. The direct estimate is shown separately.</p></section>
    </div>
    <section className="card padded"><div className="heading-row"><div><p className="eyebrow">Workflow readiness</p><h2>Activation requirements</h2></div><Badge value={blockers.length ? "Blocked" : "Approved"} /></div>
      {blockers.length ? <ul className="blocker-list">{blockers.map(item => <li key={item}><ShieldAlert size={16} />{item}</li>)}</ul> : <p>Documented prerequisites are valid for today.</p>}
      {m.start?.completed && <p className="muted">Recorded start authorization · {m.start.completed}</p>}
    </section>
    <section className="card padded"><p className="eyebrow">Research design</p><h2>Concept and feasibility</h2><dl className="info-grid">
      <Info label="Study type">{d.studyType}</Info><Info label="Research question">{d.question}</Info><Info label="Rationale">{d.rationale}</Info><Info label="Objectives">{d.objectives}</Info>
      <Info label="Laboratory methods">{d.methods.join(" · ")}</Info><Info label="Expected output and outcomes">{d.output}</Info><Info label="Feasibility notes">{d.feasibility}</Info><Info label="Proposed start">{d.proposedStart}</Info>
    </dl></section>
  </>;
}

function EditStudy({ study, directory, accounts }: { study: Study; directory: Department[]; accounts: Member[] }) {
  const d = study.data.fields;
  const eligible = (selected: string, allowed: Actor["role"][] = []) => accounts.filter(account => account.id === selected || account.active && (!allowed.length || allowed.includes(account.role)))
    .map(account => ({ id: account.id, name: account.name + " · " + roles[account.role] + (account.active ? "" : " (inactive)") }));
  return <ActionForm command="update" className="card padded edit-study">
    <Hidden values={{ study: study.id, expected: study.version }} />
    <section className="form-section"><h2>Research design</h2>
      <Text name="title" label="Study title" value={d.title} required />
      <div className="form-grid triple"><Text name="studyType" label="Study type" value={d.studyType} /><Select name="wave" label="Planning wave" value={d.wave} choices={["1","2","3","Future"]} empty="Unassigned" />
        <Select name="priority" label="Priority" value={d.priority} choices={["Routine","High","Urgent"]} /><Text name="cycle" label="Programme cycle" value={d.cycle} /><Text name="proposedStart" label="Proposed start" type="date" value={d.proposedStart} /></div>
      <div className="form-grid"><Area name="question" label="Research question" value={d.question} /><Area name="rationale" label="Rationale" value={d.rationale} />
        <Area name="objectives" label="Objectives" value={d.objectives} /><Area name="methods" label="Required laboratory methods (one per line)" value={d.methods.join("\n")} />
        <Area name="output" label="Expected output and outcomes" value={d.output} /><Area name="feasibility" label="Feasibility notes" value={d.feasibility} /></div>
    </section>
    <section className="form-section"><h2>Ownership and departments</h2>
      <div className="form-grid"><Text name="proposedLead" label="Proposed lead from planning" value={d.proposedLead} /><Area name="proposedCollaborators" label="Potential collaborators from planning" value={d.proposedCollaborators} rows={2} />
        <Select name="lead" label="Confirmed lead department" value={d.lead} choices={directory} empty="Unassigned" />
      </div>
      <details className="sub-details"><summary>Choose collaborating departments ({d.collaborators.length} assigned)</summary><div className="checkbox-grid">{directory.length ? directory.map(dept =>
        <label className="check" key={dept.id}><input type="checkbox" name="collaborators" value={dept.id} defaultChecked={d.collaborators.includes(dept.id)} />{dept.name}</label>) : <p className="muted">Add departments in Settings.</p>}</div></details>
      <p className="muted fine">Names document assignments. Select a separately authorized account to grant scoped access.</p>
      <div className="form-grid">
        <Text name="pi" label="Principal Investigator" value={d.pi} /><Select name="piAccount" label="PI access account" value={d.piAccount} choices={eligible(d.piAccount, ["pi", "guide"])} empty="None" />
        <Text name="guide" label="PG Guide" value={d.guide} /><Select name="guideAccount" label="Guide access account" value={d.guideAccount} choices={eligible(d.guideAccount, ["pi", "guide"])} empty="None" />
        <Text name="scholar" label="PG scholar" value={d.scholar} /><Select name="scholarAccount" label="Scholar access account" value={d.scholarAccount} choices={eligible(d.scholarAccount, ["scholar"])} empty="None" />
      </div>
    </section>
    <section className="form-section"><h2>Budget and funding</h2><div className="form-grid triple">
      <Text name="estimateMin" label="Estimated direct cost, low (₹)" value={d.estimateMin} {...moneyProps} />
      <Text name="estimateMax" label="Estimated direct cost, high (₹)" value={d.estimateMax} {...moneyProps} />
      <Text name="approvedBudget" label="Approved budget (₹)" value={d.approvedBudget} {...moneyProps} />
      <Text name="committed" label="Funds committed (₹)" value={d.committed} {...moneyProps} />
      <Text name="spent" label="Actual spend (₹)" value={d.spent} {...moneyProps} />
      <Text name="piContribution" label="Estimated PI contribution or PI-managed cost (₹)" value={d.piContribution} {...moneyProps} />
      <Text name="piCostBearer" label="Expected payer" value={d.piCostBearer} />
      <Select name="funding" label="Funding status" choices={fundingStatuses} value={d.funding} />
    </div><Area name="piCostDescription" label="PI cost description" value={d.piCostDescription} rows={2} /></section>
    <section className="form-section"><h2>Delivery targets</h2><div className="form-grid"><Text name="recruitmentTarget" label="Overall recruitment target" value={d.recruitmentTarget} {...numberProps} />
      <Text name="samplesTarget" label="Overall sample target" value={d.samplesTarget} {...numberProps} />
      {([30,60,90] as const).flatMap(day => [<Text key={day + "r"} name={`check${day}Recruitment`} label={day + "-day recruitment target"} value={d[`check${day}Recruitment`]} {...numberProps} />,
        <Text key={day + "s"} name={`check${day}Samples`} label={day + "-day sample target"} value={d[`check${day}Samples`]} {...numberProps} />])}
    </div></section>
    <section className="form-section"><h2>Next steps and study status</h2><div className="form-grid">
      <Text name="nextAction" label="Next action" value={d.nextAction} /><Text name="due" label="Due date" type="date" value={d.due} />
      <Text name="owner" label="Action owner" value={d.owner} /><Select name="ownerAccount" label="Owner account" choices={eligible(d.ownerAccount)} value={d.ownerAccount} empty="None" />
      <Select name="lifecycle" label="Study status" choices={lifecycle} value={d.lifecycle} /><Area name="lifecycleReason" label="Status reason" value={d.lifecycleReason} rows={2} />
    </div><Area name="reason" label="Change reason, approved target-change reference or duplicate-title rationale" rows={2} /></section>
    <button className="btn primary">Save study details</button>
  </ActionForm>;
}

function MilestoneTrack({ study, settings, actor }: { study: Study; settings: Programme; actor: Actor }) {
  return <div className="stack">{Object.entries(tracks).map(([track, items]) => <section className="card padded" key={track}>
    <p className="eyebrow">Workflow track</p><h2>{track}</h2>
    <div className="milestone-list">{Object.entries(items).map(([raw, label]) => {
      const key = raw as MilestoneKey;
      const item = study.data.milestones[key] ?? blankMilestone;
      const values = { study: study.id, expected: item.version, key };
      const can = (action: "record" | "confirm" | "freeze" | "reopen") => canMilestone(actor, settings, key, action);
      const frozen = item.status === "Frozen";
      const confirming = !frozen && (isDone(item) || item.status === "Not applicable") && !!item.evidence && !!item.completed;
      return <details key={key} className="milestone">
        <summary><span>{frozen && <Lock size={15} />}{label}</span><span>{item.due && <small>Due {item.due}</small>}<Badge value={item.status} />{item.decision && <Badge value={item.decision} />}</span></summary>
        <div className="milestone-body"><dl className="info-grid"><Info label="Effective date">{item.completed}</Info><Info label="Responsible">{item.responsible}</Info>
          <Info label="Approver or authority">{item.approver}</Info><Info label="Evidence reference">{item.evidence}</Info>
          <Info label="Expiry">{item.expires}</Info><Info label="Evidence confirmed">{item.confirmedBy ? "Yes" : "Awaiting confirmation"}</Info>
        </dl>
        {!frozen && can("record") && key !== "concept" && <ActionForm command="milestone">
          <Hidden values={{ ...values, action: "record" }} />
          <div className="form-grid triple">
            <Select name="status" label="Progress" value={item.status} choices={["Pending","In progress","Completed","Not applicable"]} />
            <Text name="due" label="Due date" type="date" value={item.due} /><Text name="completed" label="Effective completion date" type="date" value={item.completed} />
            <Text name="responsible" label="Responsible person" value={item.responsible} /><Text name="approver" label="Applicable approver" value={item.approver} />
            <Select name="wait" label="Wait category" choices={["External decision","Coordinator follow-up"]} empty="Unspecified" value={item.wait} />
            {committeeKeys.includes(key) ? <><Select name="decision" label="Committee decision" choices={decisions} empty="No decision recorded" value={item.decision} />
              <Text name="expires" label="Approval expiry" type="date" value={item.expires} /></> : <Hidden values={{ decision: "", expires: "" }} />}
          </div>
          <Area name="evidence" label="Evidence reference" value={item.evidence} rows={2} />
          <Text name="reason" label="Change reason or deadline note" />
          <button className="btn small primary">Save and submit for review</button>
        </ActionForm>}
        {confirming && !item.confirmedBy && can("confirm") && <ActionForm command="milestone" className="inline-action"><Hidden values={{ ...values, action: "confirm" }} /><button className="btn small">Confirm documented evidence</button></ActionForm>}
        {confirming && item.confirmedBy && item.status !== "Not applicable" && can("freeze") && <ActionForm command="milestone" className="inline-action"><Hidden values={{ ...values, action: "freeze" }} /><button className="btn small"><Lock size={14} /> Freeze milestone</button></ActionForm>}
        {frozen && can("reopen") && <ActionForm command="milestone" className="inline-action"><Hidden values={{ ...values, action: "reopen" }} /><Text name="reason" label="Reopening reason" required /><button className="btn small">Reopen for correction</button></ActionForm>}
        </div>
      </details>;
    })}</div>
  </section>)}</div>;
}

const recordTitles = { delivery: "Recruitment and samples", lab: "Laboratory activity", grant: "External grant application", manuscript: "Manuscript and publication" } as const;
function RecordForm({ study, type, record, canApprove }: { study: Study; type: Operational["type"]; record?: Operational; canApprove: boolean }) {
  const r = record;
  return <ActionForm command="record" className="record-form">
    <Hidden values={{ study: study.id, expected: study.version, type, id: r?.id || "" }} />
    <div className="form-grid">
      <Text name="label" label="Record title or reference" value={r?.label} required /><Text name="evidence" label="Evidence reference" value={r?.evidence} required />
      {type === "delivery" && <><Text name="day" label="Activity date" type="date" value={r?.type === "delivery" ? r.day : today()} required />
        <Text name="recruited" label="New recruits in this entry" value={r?.type === "delivery" ? r.recruited : 0} {...numberProps} required />
        <Text name="samples" label="New samples in this entry" value={r?.type === "delivery" ? r.samples : 0} {...numberProps} required /></>}
      {type === "lab" && <><Text name="day" label="Activity date" type="date" value={r?.type === "lab" ? r.day : today()} required />
        <Text name="method" label="Laboratory method" value={r?.type === "lab" ? r.method : ""} required />
        <Select name="activity" label="Activity" value={r?.type === "lab" ? r.activity : "Assay"} choices={["Assay","Quality control","Confirmed zero"]} />
        <Text name="processed" label="Processed" value={r?.type === "lab" ? r.processed : null} {...numberProps} />
        <Text name="rejected" label="Rejected" value={r?.type === "lab" ? r.rejected : null} {...numberProps} />
        <Text name="repeated" label="Repeated" value={r?.type === "lab" ? r.repeated : null} {...numberProps} />
        <Text name="accession" label="Accession date (aggregate record)" type="date" value={r?.type === "lab" ? r.accession : ""} />
        <Text name="report" label="Report date" type="date" value={r?.type === "lab" ? r.report : ""} />
        {canApprove && <Check name="approved" label="Confirm activity from documented evidence" checked={r?.type === "lab" && r.approved} />}</>}
      {type === "grant" && <>
        <Text name="submitted" label="Submission date" type="date" value={r?.type === "grant" ? r.submitted : ""} />
        <Select name="decision" label="Funder decision" value={r?.type === "grant" ? r.decision : "Pending"} choices={["Pending","Awarded","Declined","Withdrawn"]} />
        <Text name="decisionDate" label="Decision date" type="date" value={r?.type === "grant" ? r.decisionDate : ""} />
        <Text name="amount" label="Grant amount (₹)" value={r?.type === "grant" ? r.amount : null} {...moneyProps} /></>}
      {type === "manuscript" && <>
        <Text name="submitted" label="Submission date" type="date" value={r?.type === "manuscript" ? r.submitted : ""} />
        <Text name="accepted" label="Acceptance date" type="date" value={r?.type === "manuscript" ? r.accepted : ""} />
        <Text name="published" label="Publication date" type="date" value={r?.type === "manuscript" ? r.published : ""} />
        <Check name="indexed" label="Indexing verified" checked={r?.type === "manuscript" && r.indexed} /></>}
    </div><button className="btn primary small">Save record</button>
  </ActionForm>;
}

function Delivery({ study, actor }: { study: Study; actor: Actor }) {
  const { fields: d, milestones: m, records } = study.data;
  const entries = records.filter(r => r.type === "delivery");
  const total = (field: "recruited" | "samples", cutoff = today()) => entries.filter(row => row.day <= cutoff).reduce((n, row) => n + row[field], 0);
  const actual = (n: number, target: number | null) => target === null ? n + " recorded · target unset" : n + " / " + target;
  const allow = (type: Operational["type"]) => editable(actor) || (actor.role === "lab" && type === "lab");
  return <>
    <section className="card padded"><p className="eyebrow">Aggregate delivery</p><h2>Recruitment and sample checks</h2>
      <dl className="info-grid"><Info label="Participants recruited">{actual(total("recruited"), d.recruitmentTarget)}</Info><Info label="Samples collected">{actual(total("samples"), d.samplesTarget)}</Info></dl>
      {m.start?.confirmedBy && isDone(m.start) ? <div className="table-scroll"><table><thead><tr><th>Checkpoint</th><th>Date</th><th>Recruitment</th><th>Samples</th></tr></thead>
        <tbody>{([30,60,90] as const).map(day => {
          const cutoff = addDays(m.start!.completed, day);
          return <tr key={day}><td>{day} days</td><td>{cutoff}</td><td>{actual(total("recruited", cutoff), d[`check${day}Recruitment`])}</td><td>{actual(total("samples", cutoff), d[`check${day}Samples`])}</td></tr>;
        })}</tbody></table></div> : <p className="muted">Check dates are calculated from the confirmed activation date.</p>}
    </section>
    {Object.entries(recordTitles).map(([raw, label]) => {
      const type = raw as Operational["type"];
      const matching = records.filter(r => r.type === type);
      return <section className="card padded" key={type}><h2>{label} <span className="count">{matching.length}</span></h2>
        {allow(type) && <details className="sub-details"><summary>Add record</summary><RecordForm study={study} type={type} canApprove={["admin","lab"].includes(actor.role)} /></details>}
        {matching.map(record => <details className="sub-details" key={record.id}><summary>{record.label}</summary>
          <dl className="info-grid"><Info label="Evidence">{record.evidence}</Info>
            {"day" in record && <Info label="Date">{record.day}</Info>}
            {"submitted" in record && <Info label="Submitted">{record.submitted}</Info>}
            {record.type === "delivery" && <><Info label="Recruited">{String(record.recruited)}</Info><Info label="Samples">{String(record.samples)}</Info></>}
            {record.type === "lab" && <><Info label="Method and review">{record.method + " · " + (record.approved ? record.activity : "Unreviewed")}</Info>
              <Info label="Processed / rejected / repeated">{[record.processed,record.rejected,record.repeated].map(v => v ?? "—").join(" / ")}</Info></>}
            {record.type === "grant" && <><Info label="Decision">{record.decision}</Info><Info label="Decision date">{record.decisionDate}</Info><Info label="Amount">{inr(record.amount)}</Info></>}
            {record.type === "manuscript" && <><Info label="Accepted">{record.accepted}</Info><Info label="Published">{record.published}</Info><Info label="Indexing">{record.indexed ? "Verified" : "Unverified"}</Info></>}
          </dl>{allow(type) && (record.type !== "lab" || !record.approved || ["admin","lab"].includes(actor.role)) &&
            <RecordForm study={study} type={type} record={record} canApprove={["admin","lab"].includes(actor.role)} />}
        </details>)}
        {!matching.length && <p className="muted">No records added.</p>}
      </section>;
    })}
  </>;
}

export function StudyView({ study, tab, actor, departments, accounts, settings, documents, events, lakh }: {
  study: Study; tab: string; actor: Actor; departments: Department[]; accounts: Member[]; settings: Programme;
  documents: Awaited<ReturnType<typeof listDocuments>>; events: StudyEvent[]; lakh: boolean;
}) {
  const d = study.data.fields;
  return <>
    <Link className="back" href="/portfolio"><ArrowLeft size={16} /> Portfolio</Link>
    <Heading kicker={study.id + " · Study workspace"} title={study.title} description={"Wave " + (d.wave || "unassigned") + " · Added " + study.data.entered}><Badge value={phase(study.data)} /><Badge value={d.funding} /></Heading>
    <nav className="tabs" aria-label="Study sections">{tabs.filter(item => item.id !== "edit" || editable(actor)).map(item =>
      <Link className={tab === item.id ? "active" : ""} aria-current={tab === item.id ? "page" : undefined} href={"/portfolio/" + study.id + (item.id ? "/" + item.id : "")} key={item.id}>{item.name}</Link>)}</nav>
    <div className="stack">
      {tab === "" && <Overview study={study} directory={departments} settings={settings} lakh={lakh} />}
      {tab === "edit" && editable(actor) && <EditStudy study={study} directory={departments} accounts={accounts} />}
      {tab === "milestones" && <MilestoneTrack study={study} settings={settings} actor={actor} />}
      {tab === "delivery" && <Delivery study={study} actor={actor} />}
      {tab === "documents" && <section className="card padded"><p className="eyebrow">Private evidence</p><h2>Project documents</h2>
        <p className="muted">Upload approved project documents only. Keep participant records, individual specimen IDs and genomic results in their approved systems.</p>
        {editable(actor) && <ActionForm command="document" className="form-section">
          <Hidden values={{ study: study.id }} />
          <div className="form-grid"><Text name="slot" label="Document group (reuse for a new version)" value="Concept note" required />
            <label>PDF or text file, up to 3 MB<input name="file" type="file" accept=".pdf,.txt" /></label></div>
          <Text name="link" label="Or approved institutional storage link" type="url" /><button className="btn small primary">Save document version</button>
        </ActionForm>}
        {documents.length ? <div className="document-list">{documents.map(doc => <a className="doc-row" href={"/api/documents/" + study.id + "/" + doc.id} key={doc.id}>
          <FileText size={20} /><span><strong>{doc.filename}</strong><small>{doc.slot} · Version {doc.version}</small></span><Download size={17} />
        </a>)}</div> : <Empty title="No documents yet" detail="Concept notes, proposals and supporting evidence will appear here." />}
      </section>}
      {tab === "history" && <section className="card padded"><p className="eyebrow">Append-only log</p><h2>Activity history</h2>
        <div className="history-list">{events.map(event => <details className="sub-details" key={event.id}><summary><strong>{event.kind}</strong><small>{event.actor_name || "Workbook import"} · {event.happened}</small></summary>
          {event.data.change !== undefined ? <pre>{JSON.stringify(event.data.change, null, 2)}</pre> : event.data.reason ? <p>{event.data.reason}</p> :
            event.data.filename ? <p>{event.data.slot} · {event.data.filename} · Version {event.data.version}</p> : <p>Study entered as Concept.</p>}
        </details>)}</div></section>}
    </div>
  </>;
}
