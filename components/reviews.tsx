import Link from "next/link";
import { ArrowLeft, Download, Lock } from "lucide-react";
import { ActionForm, Followups, Print } from "./forms";
import { Area, Badge, Empty, Heading, Hidden, inr, Select, Text } from "./ui";
import { editable, metrics, questions, type Actor, type Department } from "@/lib/model";
import type { ReportFilter, Results, Review } from "@/lib/reports";

export function ReportFields({ f, departments }: { f: ReportFilter; departments: Department[] }) {
  return <div className="form-grid triple">
    <Text name="from" label="Period start" type="date" value={f.from} required /><Text name="to" label="Period end" type="date" value={f.to} required />
    <Select name="lead" label="Lead department" choices={departments} value={f.lead} empty="All departments" />
    <Select name="collaborator" label="Collaborating department" choices={departments} value={f.collaborator} empty="All departments" />
    <Text name="pi" label="PI" value={f.pi} /><Select name="wave" label="Wave" choices={["1","2","3","Future"]} value={f.wave} empty="All waves" />
    <Text name="method" label="Laboratory method" value={f.method} /><Text name="cycle" label="Programme cycle" value={f.cycle} />
  </div>;
}

function Rate({ result }: { result: Results["timeliness"] }) {
  return <>{result.rate === null ? "Insufficient data" : new Intl.NumberFormat("en-IN", { style: "percent", maximumFractionDigits: 1 }).format(result.rate)} <small>{result.numerator} / {result.denominator}</small></>;
}

export function FeedbackDistribution({ data }: { data: NonNullable<Results["stakeholder"]> }) {
  return <>
    <p className="muted">{data.count} reportable {data.count === 1 ? "response" : "responses"}. {data.suppressed && "Small anonymous groups are suppressed."}</p>
    <div className="table-scroll"><table><thead><tr><th>Question</th><th>Rated responses</th>{[1,2,3,4,5].map(n => <th key={n}>{n}</th>)}</tr></thead>
      <tbody>{data.ratings.map(row => <tr key={row.key}><td>{questions[row.key]}</td><td>{row.count}</td>{row.distribution.map((n, i) => <td key={i}>{n}</td>)}</tr>)}</tbody></table></div>
  </>;
}

function ReportResults({ r }: { r: Results }) {
  const scope = [
    r.filter.lead && "Lead " + (r.departmentLabels?.lead ?? r.filter.lead),
    r.filter.collaborator && "Collaborator " + (r.departmentLabels?.collaborator ?? r.filter.collaborator),
    r.filter.pi && "PI " + r.filter.pi, r.filter.wave && "Wave " + r.filter.wave, r.filter.method && "Method " + r.filter.method,
    r.filter.cycle && "Cycle " + r.filter.cycle,
  ].filter(Boolean).join(" · ");
  return <div className="stack">
    <section className="card padded"><div className="heading-row"><div><p className="eyebrow">Programme outcomes</p><h2>Actuals and targets</h2></div><Badge value={r.targetsApproved ? "Approved" : "Planning"} /></div>
      <p className="muted">Selected period {r.filter.from} to {r.filter.to} · As of {r.cutoff} · Target version {r.targetVersion || "default"}</p>
      <p className="muted fine">{scope || "All studies in reporting scope"}</p>
      <div className="table-scroll"><table><thead><tr><th>Measure</th><th>Within period</th><th>Through cutoff*</th><th>Year {r.year} target</th></tr></thead>
        <tbody>{r.measures.map(row => <tr key={row.key}><td>{metrics[row.key]}</td><td>{row.events}</td><td>{row.cumulative}</td><td>{row.target}</td></tr>)}</tbody></table></div>
      <p className="muted fine">*Laboratory months restart each programme year. The planned denominator is {r.planned} proposals.</p>
    </section>
    <section className="card padded"><p className="eyebrow">Dated project history</p><h2>Stages at the cutoff</h2><div className="phase-chips">
      {Object.entries(r.stage).map(([stage, count]) => <span key={stage}><Badge value={stage} /><strong>{count}</strong></span>)}
    </div><p className="muted fine">{r.total} distinct studies in scope.</p></section>
    <div className="detail-grid">
      <section className="card padded"><p className="eyebrow">Programme efficiency</p><h2>Timeliness and delivery</h2>
        <dl className="scorecard"><div><dt>Milestone timeliness</dt><dd><Rate result={r.timeliness} /></dd></div>
          <div><dt>Overdue milestones in period</dt><dd>{r.overdue}</dd></div><div><dt>Overdue project actions at cutoff</dt><dd>{r.overdueActions}</dd></div>
          <div><dt>Recruited vs planned</dt><dd><Rate result={r.recruitment} /></dd></div><div><dt>Samples vs planned</dt><dd><Rate result={r.samples} /></dd></div>
          <div><dt>Lab rejection</dt><dd><Rate result={r.rejection} /></dd></div><div><dt>Lab repeats</dt><dd><Rate result={r.repeats} /></dd></div></dl>
      </section>
      <section className="card padded"><p className="eyebrow">Programme efficiency</p><h2>Funding and expenditure</h2>
        <dl className="scorecard"><div><dt>Approved budget · comparable scope</dt><dd>{r.funding.pairedBudgets ? inr(r.funding.budget) : "Insufficient data"}</dd></div>
          <div><dt>Actual spend · comparable scope</dt><dd>{r.funding.pairedBudgets ? inr(r.funding.spent) : "Insufficient data"}</dd></div>
          <div><dt>Comparable studies</dt><dd>{r.funding.pairedBudgets}</dd></div><div><dt>Grants awarded vs decided</dt><dd><Rate result={r.funding.awards} /></dd></div>
          <div><dt>All known approved budgets</dt><dd>{r.funding.budgetCount ? inr(r.funding.recordedBudget) : "Insufficient data"}<small>{r.funding.budgetCount ?? 0} studies</small></dd></div>
          <div><dt>All known recorded spend</dt><dd>{r.funding.spendCount ? inr(r.funding.recordedSpend) : "Insufficient data"}<small>{r.funding.spendCount ?? 0} studies</small></dd></div>
          <div><dt>Grant applications pending</dt><dd>{r.funding.pending}</dd></div></dl>
      </section>
    </div>
    <section className="card padded"><p className="eyebrow">Programme efficiency</p><h2>Stage turnaround</h2><div className="table-scroll"><table><thead><tr><th>Interval</th><th>Median days</th><th>Completed intervals</th></tr></thead>
      <tbody>{r.turnaround.map(item => <tr key={item.label}><td>{item.label}</td><td>{item.days ?? "Insufficient data"}</td><td>{item.count}</td></tr>)}</tbody></table></div>
    </section>
    <section className="card padded"><h2>Laboratory activity by month and method</h2>
      {r.labMonths.length ? <div className="table-scroll"><table><thead><tr><th>Month</th><th>Laboratory method</th><th>Review status</th></tr></thead>
        <tbody>{r.labMonths.flatMap(month => {
          const rows = r.laboratory.filter(row => row.month === month);
          return rows.length ? rows.map(row => <tr key={month + row.method}><td>{month}</td><td>{row.method}</td><td>
            {[row.approved ? row.approved + " approved" : "", row.zero ? row.zero + " confirmed zero" : "", row.unreviewed ? row.unreviewed + " unreviewed" : ""].filter(Boolean).join(" · ")}
          </td></tr>) : [<tr key={month}><td>{month}</td><td>—</td><td>Unreviewed</td></tr>];
        })}</tbody></table></div> : <p className="muted">No elapsed months in the selected period.</p>}
    </section>
    {r.stakeholder && <section className="card padded"><h2>Stakeholder experience and action closure</h2><FeedbackDistribution data={r.stakeholder} />
      {r.actions && <p className="muted">Corrective actions · {r.actions.opened} opened · {r.actions.due} due · {r.actions.resolved} resolved</p>}
    </section>}
  </div>;
}

function ReviewEditor({ actor, review, f, departments }: { actor: Actor; review?: Review; f: ReportFilter; departments: Department[] }) {
  if (!editable(actor) || review?.frozen_at) return null;
  return <section className="card padded no-print"><p className="eyebrow">Coordinator review</p><h2>{review ? "Review draft" : "Draft a review"}</h2>
    <ActionForm command="review">
      <Hidden values={{ id: review?.id ?? "", expected: review?.revision ?? 0 }} />
      {review ? <ReportFields f={f} departments={departments} /> : <Hidden values={f} />}
      <Area name="notes" label="Findings and review notes" value={review?.data.notes} />
      <Followups values={review?.data.followups ?? []} />
      <div className="form-actions left"><button className="btn primary" name="action" value="draft">Save draft</button>
        {review && actor.role === "admin" && <button className="btn" name="action" value="freeze"><Lock size={15} /> Freeze review</button>}</div>
    </ActionForm>
  </section>;
}

export function Reviews({ actor, review, list, departments, filter, results, period, error }: {
  actor: Actor; review?: Review; list: Review[]; departments: Department[]; filter: ReportFilter; results?: Results;
  period: string; error?: string;
}) {
  const leadership = actor.role === "management";
  const liveAllowed = !leadership || !!review;
  const href = "/api/reports?" + new URLSearchParams(review?.frozen_at ? { review: review.id } : filter).toString();
  return <>
    {review && <Link href="/reviews" className="back no-print"><ArrowLeft size={16} /> Reviews</Link>}
    <Heading kicker="Programme reporting" title={review ? "Review · Version " + review.version : "Reviews and Reports"}
      description={review ? filter.from + " to " + filter.to + (review.frozen_at ? " · Frozen snapshot" : " · Working draft") : "Compare programme results, document findings and prepare leadership reviews."}>
      {results && <><Print /><a href={href} className="btn"><Download size={16} /> Export CSV</a></>}
    </Heading>
    <div className="stack">
      {!review && !leadership && <section className="card padded no-print"><h2>Reporting period</h2>
        <form action="/reviews"><Select name="period" label="Period type" value={period} choices={["Quarterly","Half-yearly","Annual","Custom"]} />
          <p className="muted fine">Scheduled periods use the selected end date as their anchor. Choose Custom to enter both boundaries.</p>
          <ReportFields f={filter} departments={departments} /><button className="btn primary">Apply reporting filters</button></form>
      </section>}
      {error && <p className="form-message error" role="alert">{error}</p>}
      {review?.frozen_at && <section className="card padded"><div className="heading-row"><h2>Findings and follow-up</h2><Badge value="Frozen" /></div>
        <p className="preserve-lines">{review.data.notes || "No findings added."}</p>
        {review.data.reason && <p className="muted">Correction reason · {review.data.reason}</p>}
        {review.data.followups.length > 0 && <ul className="review-followups">{review.data.followups.map((action, i) => <li key={i}><strong>{action.finding}</strong><span>{action.owner} · {action.due}</span></li>)}</ul>}
      </section>}
      {results && liveAllowed && <ReportResults r={results} />}
      {liveAllowed && !error && <ReviewEditor actor={actor} review={review} f={filter} departments={departments} />}
      {review?.frozen_at && actor.role === "admin" && <section className="card padded no-print"><h2>Draft a correction</h2><ActionForm command="review">
        <Hidden values={{ ...filter, id: review.id, expected: review.revision, action: "correct" }} /><Area name="reason" label="Correction reason" rows={2} /><button className="btn">Start new version</button>
      </ActionForm></section>}
      {!review && <section className="card padded no-print"><h2>{leadership ? "Approved reviews" : "Saved reviews"}</h2>
        {list.length ? <div className="document-list">{list.map(item => <Link className="doc-row" href={"/reviews/" + item.id} key={item.id}>
          <span><strong>{item.data.filter.from} to {item.data.filter.to}</strong><small>Version {item.version}</small></span><Badge value={item.frozen_at ? "Frozen" : "Draft"} />
        </Link>)}</div> : <Empty title="No saved reviews" detail="Reports will appear here once a review is saved and available to your role." />}
      </section>}
    </div>
  </>;
}
