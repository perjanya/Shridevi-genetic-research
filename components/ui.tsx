import type { ReactNode } from "react";
import { CircleHelp, Dna, MoveRight } from "lucide-react";

export function Brand() {
  return <div className="brand"><span className="brand-mark"><Dna size={23} /></span><span><strong>Shridevi Genetics</strong><small>Research programme</small></span></div>;
}
export function Heading({ kicker, title, description, children }: { kicker: string; title: string; description: string; children?: ReactNode }) {
  return <header className="heading-row page-heading"><div><p className="eyebrow">{kicker}</p><h1>{title}</h1><p className="muted">{description}</p></div>{children && <div className="heading-actions">{children}</div>}</header>;
}
export function Badge({ value }: { value: string }) {
  const color = ["Completed", "Frozen", "Approved", "Coverage confirmed", "Resolved", "Active"].includes(value) ? "green" :
    ["On hold", "In progress", "Pending", "Planning", "Seeking funding"].includes(value) ? "amber" :
      ["Overdue", "Rejected", "Withdrawn", "Urgent", "Blocked"].includes(value) ? "red" : "blue";
  return <span className={"badge " + color}><i />{value}</span>;
}
export function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="empty"><CircleHelp size={25} /><strong>{title}</strong><p>{detail}</p></div>;
}
export function Text({ name, label, value = "", type = "text", required = false, placeholder, min, step }: { name: string; label: string; value?: string | number | null; type?: string; required?: boolean; placeholder?: string; min?: number; step?: string }) {
  return <label>{label}<input name={name} type={type} defaultValue={value ?? ""} required={required} placeholder={placeholder} min={min} step={step} /></label>;
}
export function Area({ name, label, value = "", rows = 3 }: { name: string; label: string; value?: string; rows?: number }) {
  return <label>{label}<textarea name={name} defaultValue={value} rows={rows} /></label>;
}
export function Select({ name, label, value = "", choices, empty, required = false }: { name: string; label: string; value?: string; choices: readonly (string | { id: string; name: string })[]; empty?: string; required?: boolean }) {
  return <label>{label}<select name={name} defaultValue={value} required={required}>
    {empty && <option value="">{empty}</option>}
    {choices.map(choice => typeof choice === "string" ? <option key={choice}>{choice}</option> : <option key={choice.id} value={choice.id}>{choice.name}</option>)}
  </select></label>;
}
export function Check({ name, label, checked }: { name: string; label: string; checked?: boolean }) {
  return <label className="check"><input type="checkbox" name={name} defaultChecked={checked} />{label}</label>;
}
export function Hidden({ values }: { values: Record<string, string | number> }) {
  return <>{Object.entries(values).map(([key, value]) => <input type="hidden" name={key} value={value} key={key} />)}</>;
}
export function SectionLink({ children }: { children: ReactNode }) { return <span className="section-link">{children} <MoveRight size={16} /></span>; }
export function inr(amount: number | null, lakh = false) {
  if (amount === null) return "—";
  return lakh ? "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 4 }).format(amount / 100000) + " lakh"
    : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(amount);
}
export function valueFrom(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return typeof value === "string" ? value : "";
}
