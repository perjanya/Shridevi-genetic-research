"use client";

import { startTransition, useActionState, useState, type ReactNode } from "react";
import { Plus, Printer, X } from "lucide-react";
import { mutate, signIn, type FormState } from "@/app/actions";

export function ActionForm({ children, command, className, login = false }: { children: ReactNode; command?: string; className?: string; login?: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(login ? signIn : mutate, {});
  return <form action={action} className={className} aria-busy={pending} onSubmit={event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
    startTransition(() => action(data));
  }}>
    {command && <input type="hidden" name="command" value={command} />}
    <fieldset disabled={pending} className="form-fieldset">{children}</fieldset>
    {pending && <p className="form-message" role="status">Saving…</p>}
    {state.error && <p className="form-message error" role="alert">{state.error}</p>}
    {state.message && <p className="form-message success" role="status">{state.message}</p>}
  </form>;
}

export function AddTopic() {
  const [open, setOpen] = useState(false);
  return <>
    <button className="btn primary" onClick={() => setOpen(true)}><Plus size={17} /> Add research topic</button>
    {open && <div className="modal-overlay" onKeyDown={e => { if (e.key === "Escape") setOpen(false); }}>
      <section className="modal card" role="dialog" aria-modal="true" aria-labelledby="add-title">
        <div className="heading-row"><div><p className="eyebrow">Project intake</p><h2 id="add-title">Add research topic</h2></div><button className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}><X size={20} /></button></div>
        <p className="muted">A title is enough to start. The study gets a permanent ID as soon as you save.</p>
        <ActionForm command="create">
          <label>Study title<input name="title" required maxLength={240} autoFocus /></label>
          <label>Duplicate-title reason <span className="muted">(if applicable)</span><textarea name="reason" rows={2} maxLength={6000} /></label>
          <div className="form-actions"><button className="btn" type="button" onClick={() => setOpen(false)}>Cancel</button><button className="btn primary">Save concept</button></div>
        </ActionForm>
      </section>
    </div>}
  </>;
}

export function Print() {
  return <button className="btn" onClick={() => window.print()}><Printer size={16} /> Print summary</button>;
}

export function Followups({ values }: { values: { finding: string; owner: string; due: string }[] }) {
  const [count, setCount] = useState(Math.max(values.length, 1));
  return <section className="form-section">
    <h3>Follow-up actions</h3>
    {Array.from({ length: count }, (_, i) => <div className="form-grid triple" key={i}>
      <label>Finding or action<input name="finding" defaultValue={values[i]?.finding} maxLength={240} /></label>
      <label>Owner<input name="followupOwner" defaultValue={values[i]?.owner} maxLength={240} /></label>
      <label>Due date<input type="date" name="followupDue" defaultValue={values[i]?.due} /></label>
    </div>)}
    {count < 30 && <button type="button" className="btn small" onClick={() => setCount(count + 1)}><Plus size={14} /> Add follow-up</button>}
  </section>;
}
