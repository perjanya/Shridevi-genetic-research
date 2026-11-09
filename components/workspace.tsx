import Link from "next/link";
import { Activity, ArrowDownRight, ArrowUpRight, CalendarClock, CircleCheck, ClipboardList, FlaskConical, FolderKanban, LayoutGrid, ListTodo, LogOut, MessageSquare, Settings, ShieldCheck } from "lucide-react";
import { signOut } from "@/app/actions";
import { AddTopic } from "./forms";
import { Badge, Brand, Check, Empty, Heading, inr, SectionLink, Select, Text, valueFrom } from "./ui";
import { blankReportFilter, matchesStudy } from "@/lib/reports";
import { editable, fundingStatuses, isDone, milestones, phases, roles, today, type Actor, type Department, type Programme, type Study, type MilestoneKey } from "@/lib/model";
import { activationBlockers, completionDate, phase } from "@/lib/studies";

export type Params = Record<string, string | string[] | undefined>;
const nav = [
  { href: "/portfolio", title: "Portfolio", icon: LayoutGrid },
  { href: "/actions", title: "My Actions", icon: ListTodo },
  { href: "/reviews", title: "Reviews", icon: ClipboardList },
  { href: "/feedback", title: "Feedback", icon: MessageSquare },
  { href: "/settings", title: "Settings", icon: Settings },
];

export function Workspace({ actor, current, children }: { actor: Actor; current: string; children: React.ReactNode }) {
  const items = nav.filter(item => (item.href !== "/reviews" || ["admin", "coordinator", "management"].includes(actor.role)) &&
    (item.href !== "/settings" || actor.role === "admin") && (item.href !== "/actions" || actor.role !== "management"));
  return <div className="app-shell">
    <a className="skip" href="#workspace-content">Skip to workspace</a>
    <aside className="sidebar">
      <Link className="brand-link" href="/portfolio"><Brand /></Link>
      <p className="eyebrow nav-caption">Workspace</p>
      <nav aria-label="Main navigation">{items.map(({ href, title, icon: Icon }) =>
        <Link key={href} href={href} className={href === "/" + current ? "active" : ""} aria-current={href === "/" + current ? "page" : undefined}>
          <Icon size={18} />{title}
        </Link>)}</nav>
      <div className="sidebar-bottom"><div className="secure-label"><ShieldCheck size={16} /> Private workspace</div><small>SIMS &amp; RH, Tumakuru</small></div>
    </aside>
    <div className="app-main">
      <div className="topbar"><span>Genetics Laboratory <i /> <strong>{nav.find(item => item.href === "/" + current)?.title || "Workspace"}</strong></span>
        <div className="profile"><span className="avatar">{actor.name.split(" ").slice(0, 2).map(p => p[0]).join("").toUpperCase()}</span>
          <div><strong>{actor.name}</strong><small>{roles[actor.role]}</small></div>
          <form action={signOut}><button type="submit" className="icon-btn" aria-label="Sign out" title="Sign out"><LogOut size={17} /></button></form>
        </div>
      </div>
      <main className="content" id="workspace-content">{children}</main>
      <footer className="app-footer"><span>Shridevi Institute of Medical Sciences and Research Hospital</span><span>Asia/Kolkata · INR</span></footer>
    </div>
  </div>;
}

function Stat({ icon, label, count, hint, tone }: { icon: React.ReactNode; label: string; count: number; hint: string; tone: string }) {
  return <div className="card stat"><div className="stat-head"><span className={"icon-tile " + tone}>{icon}</span><span>{label}</span></div><strong>{count}</strong><p>{hint}</p></div>;
}
function displayDepartment(departments: Department[], id: string, proposed = "") {
  const found = departments.find(dept => dept.id === id);
  return found?.name ?? (proposed ? proposed + " · proposed" : "Unassigned");
}
export function actionItems(studies: Study[], settings: Programme, actor: Actor) {
  const day = today();
  const items = [];
  for (const study of studies) {
    const { fields: d, milestones: m } = study.data;
    if (d.lifecycle !== "Open") continue;
    if (d.nextAction && (!d.ownerAccount || d.ownerAccount === actor.id || editable(actor)))
      items.push({ id: study.id, title: d.nextAction, topic: d.title, owner: d.owner || "Unassigned", due: d.due, status: d.due && d.due < day ? "Overdue" : "Pending" });
    for (const [key, item] of Object.entries(m)) {
      if (item.status === "Not applicable" || item.status === "Frozen" || (isDone(item) && item.confirmedBy) || !item.due) continue;
      items.push({ id: study.id, title: milestones[key as MilestoneKey] + (isDone(item) ? " · awaiting confirmation" : ""), topic: d.title,
        owner: item.responsible || "Unassigned", due: item.due, status: item.due < day ? "Overdue" : "Pending" });
    }
    if (m.start?.confirmedBy || isDone(m.start)) {
      const blockers = activationBlockers(study.data, settings, day);
      if (blockers.length) items.push({ id: study.id, title: "Resolve activation requirements", topic: blockers.join(" · "), owner: d.owner || d.pi || "Unassigned", due: "", status: "Blocked" });
    }
  }
  return items.sort((a, b) => {
    const rank = (s: string) => s === "Blocked" ? 0 : s === "Overdue" ? 1 : 2;
    return rank(a.status) - rank(b.status) || (a.due || "9999").localeCompare(b.due || "9999");
  });
}

export function Portfolio({ studies, departments, settings, actor, params }: { studies: Study[]; departments: Department[]; settings: Programme; actor: Actor; params: Params }) {
  const val = (name: string) => valueFrom(params, name);
  const day = today();
  const query = val("q").toLowerCase();
  const view = val("units") === "lakh";
  const management = actor.role === "management";
  const filter = { ...blankReportFilter, lead: val("lead"), collaborator: val("collaborator"), pi: val("pi"), wave: val("wave"), method: val("method"), cycle: val("cycle") };
  const filtered = studies.filter(study => {
    const d = study.data.fields;
    return matchesStudy(study.data, filter) && (!query || [study.id, study.title, d.proposedLead, d.proposedCollaborators, d.pi, d.guide, displayDepartment(departments, d.lead)].join(" ").toLowerCase().includes(query)) &&
      (!val("guide") || d.guide.toLowerCase().includes(val("guide").toLowerCase())) &&
      (!val("phase") || phase(study.data) === val("phase")) && (!val("funding") || d.funding === val("funding")) &&
      (!val("overdue") || !!(d.nextAction && d.due && d.due < day && d.lifecycle === "Open"));
  });
  const items = management ? [] : actionItems(studies, settings, actor);
  const overdue = items.filter(item => item.status === "Overdue").length;
  const completed = studies.filter(study => completionDate(study.data)).length;
  const started = studies.filter(study => study.data.milestones.start?.confirmedBy && isDone(study.data.milestones.start)).length;
  const distribution = phases.map(name => ({ name, count: studies.filter(study => phase(study.data) === name).length })).filter(row => row.count);
  const filteredAdvanced = ["lead","collaborator","pi","guide","wave","method","cycle","funding","overdue"].some(key => val(key));
  return <>
    <Heading kicker="Research operations" title="Portfolio overview" description="Track studies from concept through closeout, and see what needs your attention.">
      {editable(actor) && <AddTopic />}
    </Heading>
    <div className="stat-grid">
      <Stat icon={<FolderKanban size={19} />} label="Study concepts" count={studies.length} hint="Studies in your portfolio scope" tone="blue" />
      <Stat icon={<FlaskConical size={19} />} label="Activated studies" count={started} hint="Documented start authorization" tone="mint" />
      <Stat icon={<CircleCheck size={19} />} label="Completed studies" count={completed} hint="Dataset, final report and closeout" tone="violet" />
      {management ? <Stat icon={<Activity size={19} />} label="Planned proposals" count={settings.planned} hint="Three-year programme denominator" tone="amber" />
        : <Stat icon={<CalendarClock size={19} />} label="Overdue items" count={overdue} hint="Open actions and milestones" tone="amber" />}
    </div>
    <div className="overview-grid">
      <section className="card overview-panel"><div className="heading-row"><div><p className="eyebrow">Programme status</p><h2>Study phases</h2></div><Activity size={20} className="muted" /></div>
        {distribution.length ? <div className="bar-list">{distribution.map(row => <div key={row.name} className="bar-row"><span>{row.name}</span><div className="bar-track"><div style={{ width: (row.count / studies.length * 100) + "%" }} /></div><strong>{row.count}</strong></div>)}</div>
          : <Empty title="No phases to show" detail="Study phases will appear when a concept is added or assigned." />}
        <p className="panel-foot">Year 3 completion goal · {settings.targets.completed[2]} of {settings.planned} planned proposals ({Math.round(settings.targets.completed[2] / settings.planned * 100)}%)</p>
      </section>
      <section className="card overview-panel"><div className="heading-row"><div><p className="eyebrow">Follow-up</p><h2>{management ? "Programme reviews" : "Needs attention"}</h2></div>{!management && <Link href="/actions"><SectionLink>My Actions</SectionLink></Link>}</div>
        {management ? <><p className="muted">Open the Reviews workspace for frozen programme summaries and printable reports.</p><Link href="/reviews" className="btn">View approved reviews <ArrowUpRight size={16} /></Link></> :
          items.length ? <div className="action-preview">{items.slice(0, 3).map((item, index) => <Link href={"/portfolio/" + item.id} key={item.id + index}><div><strong>{item.title}</strong><small>{item.id} · {item.owner}</small></div><Badge value={item.status} /></Link>)}</div>
            : <Empty title="You’re caught up" detail="Open tasks and workflow blockers will appear here." />}
      </section>
    </div>
    <section className="card register" id="register">
      <div className="section-top heading-row"><div><p className="eyebrow">Project register</p><h2>Research studies <span className="count">{filtered.length}</span></h2></div></div>
      <form className="filter-bar" action="/portfolio">
        <div className="filter-main"><Text name="q" label="Search studies" value={val("q")} placeholder="Study title, ID or department" /><Select name="phase" label="Phase" value={val("phase")} choices={phases} empty="All phases" /><Select name="units" label="Cost display" choices={[{ id: "inr", name: "INR" }, { id: "lakh", name: "Lakh" }]} value={view ? "lakh" : "inr"} /><button className="btn primary">Apply filters</button></div>
        <details open={filteredAdvanced || undefined}><summary>More filters <ArrowDownRight size={14} /></summary><div className="form-grid triple">
          <Select name="lead" label="Lead department" value={val("lead")} empty="All departments" choices={departments} />
          <Select name="collaborator" label="Collaborating department" value={val("collaborator")} empty="All departments" choices={departments} />
          <Text name="pi" label="PI" value={val("pi")} /><Text name="guide" label="PG guide" value={val("guide")} />
          <Select name="wave" label="Wave" value={val("wave")} empty="All waves" choices={["1","2","3","Future"]} />
          <Select name="funding" label="Funding status" value={val("funding")} empty="All statuses" choices={fundingStatuses} />
          <Text name="method" label="Laboratory method" value={val("method")} />
          <Select name="cycle" label="Programme cycle" value={val("cycle")} empty="All cycles" choices={[...new Set(studies.map(study => study.data.fields.cycle).filter(Boolean))]} />
          <Check name="overdue" label="Only overdue actions" checked={!!val("overdue")} />
        </div></details>
      </form>
      {filtered.length ? <div className="table-scroll"><table><thead><tr><th>Study</th><th>Lead department</th><th>Wave</th><th>Phase</th><th>Direct estimate</th><th>Funding</th></tr></thead>
        <tbody>{filtered.map(study => { const d = study.data.fields; return <tr key={study.id}>
          <td><small className="study-id">{study.id}</small>{management ? <strong>{study.title}</strong> : <Link href={"/portfolio/" + study.id}>{study.title}</Link>}</td>
          <td>{displayDepartment(departments, d.lead, d.proposedLead)}</td><td>{d.wave || "—"}</td><td><Badge value={phase(study.data)} /></td>
          <td>{d.estimateMin === d.estimateMax ? inr(d.estimateMin, view) : inr(d.estimateMin, view) + " – " + inr(d.estimateMax, view)}</td><td><Badge value={d.funding} /></td>
        </tr>; })}</tbody></table></div> : <Empty title="No studies match" detail="Clear your filters or add a research topic to begin." />}
    </section>
  </>;
}

export function Actions({ studies, settings, actor }: { studies: Study[]; settings: Programme; actor: Actor }) {
  const items = actionItems(studies, settings, actor);
  return <><Heading kicker="Research operations" title="My Actions" description="Follow up on deadlines, milestone confirmations and activation blockers." />
    <section className="card"><div className="section-top"><h2>Open follow-up <span className="count">{items.length}</span></h2></div>
      {items.length ? <div className="table-scroll"><table><thead><tr><th>Action</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead><tbody>{items.map((item, i) => <tr key={item.id + i}>
        <td><Link href={"/portfolio/" + item.id}>{item.title}</Link><small>{item.id} · {item.topic}</small></td><td>{item.owner}</td><td>{item.due || "—"}</td><td><Badge value={item.status} /></td>
      </tr>)}</tbody></table></div> : <Empty title="No open follow-up" detail="Actions appear when a due milestone, next step or blocker is recorded." />}
    </section>
  </>;
}
