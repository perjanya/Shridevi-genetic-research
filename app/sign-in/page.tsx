import { redirect } from "next/navigation";
import { Dna, LockKeyhole, ArrowRight } from "lucide-react";
import { ActionForm } from "@/components/forms";
import { Brand } from "@/components/ui";
import { currentActor } from "@/lib/web-auth";

export default async function SignIn() {
  if (await currentActor()) redirect("/portfolio");
  return <main className="login">
    <div className="login-visual"><Brand /><div><div className="hero-symbol"><Dna size={72} strokeWidth={1.1} /></div><p className="eyebrow">Institutional research workspace</p><h1>From research idea<br />to documented impact.</h1><p>Manage the genetics laboratory’s study portfolio, review milestones and coordinate the next step.</p></div><small>Shridevi Institute of Medical Sciences and Research Hospital · Tumakuru</small></div>
    <section className="login-panel"><div className="login-form">
      <div className="icon-tile"><LockKeyhole size={22} /></div>
      <p className="eyebrow">Authorized staff</p><h2>Sign in to your workspace</h2><p className="muted">Use the account issued by your R&D administrator.</p>
      <ActionForm login>
        <label>Institutional email<input required name="email" type="email" autoComplete="username" /></label>
        <label>Password<input required name="password" type="password" autoComplete="current-password" /></label>
        <button className="btn primary">Sign in <ArrowRight size={16} /></button>
      </ActionForm>
      <p className="login-foot">Private access · Project-level information only</p>
    </div></section>
  </main>;
}
