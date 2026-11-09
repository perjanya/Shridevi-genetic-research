"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="system-page"><h1>Workspace temporarily unavailable</h1><p>Try again or contact the dashboard administrator.</p><button className="btn primary" onClick={reset}>Try again</button></main>;
}
