import { ActionForm } from "./forms";
import { Badge, Check, Heading, Hidden, Select, Text } from "./ui";
import { keys, metricKeys, metrics, milestones, roleNames, roles, type Actor, type Department, type Programme } from "@/lib/model";
import type { Member } from "./study";

export function Settings({ actor, programme, departments, accounts }: { actor: Actor; programme: { data: Programme; version: number }; departments: Department[]; accounts: Member[] }) {
  const { data: p, version } = programme;
  return <>
    <Heading kicker="R&D administration" title="Settings" description="Configure programme dates, targets, authorized accounts and approval roles." />
    <div className="stack">
      <section className="card padded"><h2>Programme configuration</h2>
        <ActionForm command="programme">
          <Hidden values={{ expected: version }} />
          <div className="form-grid triple"><Text name="name" label="Active programme cycle" value={p.name} required />
            <Text name="start" label="Programme start date" type="date" value={p.start} />
            <Select name="alignment" label="Scheduled reporting alignment" value={p.alignment} choices={["Programme","Calendar"]} />
            <Text name="planned" label="Planned study denominator" type="number" min={1} value={p.planned} required /></div>
          <Check name="targetsApproved" label="Targets approved by institutional leadership" checked={p.targetsApproved} />
          <Check name="allowExemptions" label="Institution permits documented committee exemptions" checked={p.allowExemptions} />
          <details className="sub-details"><summary>Three-year target values</summary>
            <div className="target-grid">{metricKeys.map(key => <div className="target-row" key={key}><strong>{metrics[key]}</strong>
              {([1,2,3] as const).map(y => <Text key={y} name={key + y} label={"Year " + y} type="number" min={0} value={p.targets[key][y-1]} required />)}
            </div>)}</div>
          </details>
          <details className="sub-details"><summary>Milestone permissions</summary>
            <p className="muted fine">Enable a custom role list for a milestone to override its defaults. Roles still require access to that study. An empty list disables the corresponding action.</p>
            {keys.map(key => <details className="sub-details" key={key}><summary>{milestones[key]} {p.permissions[key] && <Badge value="Custom" />}</summary>
              <Check name={key + "-enabled"} label="Use custom permissions for this milestone" checked={!!p.permissions[key]} />
              <div className="form-grid">{(["record","confirm","freeze","reopen"] as const).map(action => <fieldset className="permission-set" key={action}><legend>{action}</legend>
                {roleNames.filter(role => !["management","feedback","scholar"].includes(role)).map(role => <label className="check" key={role}>
                  <input name={key + "-" + action} value={role} type="checkbox" defaultChecked={p.permissions[key]?.[action].includes(role)} />{roles[role]}
                </label>)}
              </fieldset>)}</div>
            </details>)}
          </details>
          <button className="btn primary">Save programme settings</button>
        </ActionForm>
      </section>
      <section className="card padded"><h2>Department directory</h2>
        <ActionForm command="department" className="form-section"><Hidden values={{ id: "" }} /><Text name="name" label="New department name" required /><button className="btn small primary">Add department</button></ActionForm>
        {departments.map(dept => <details className="sub-details" key={dept.id}><summary>{dept.name}</summary><ActionForm command="department">
          <Hidden values={{ id: dept.id }} /><Text name="name" label="Department name" value={dept.name} required /><button className="btn small">Rename department</button>
        </ActionForm></details>)}
      </section>
      <section className="card padded"><h2>Authorized accounts</h2>
        <details className="sub-details"><summary>Authorize an account</summary><ActionForm command="account">
          <div className="form-grid"><Text name="name" label="Full name" required /><Text name="email" label="Institutional email" type="email" required />
            <label>Initial password (at least 14 characters)<input name="password" type="password" minLength={14} maxLength={256} autoComplete="new-password" required /></label>
            <Select name="role" label="Authorized role" choices={roleNames.map(role => ({ id: role, name: roles[role] }))} value="coordinator" />
            <Select name="department" label="Department scope" choices={departments} empty="None" /></div>
          <button className="btn small primary">Authorize account</button>
        </ActionForm></details>
        <div className="document-list">{accounts.map(account => <div className="doc-row" key={account.id}><span><strong>{account.name}</strong><small>{account.email} · {roles[account.role]}</small></span>
          <Badge value={account.active ? "Active" : "Revoked"} />
          {account.active && account.id !== actor.id && <ActionForm command="deactivate"><Hidden values={{ id: account.id }} /><button className="btn small">Revoke access</button></ActionForm>}
        </div>)}</div>
      </section>
    </div>
  </>;
}
