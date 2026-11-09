import Link from "next/link";
export default function NotFound() {
  return <main className="system-page"><h1>Page unavailable</h1><p>The page may have moved or your account may need access.</p><Link href="/portfolio" className="btn primary">Back to portfolio</Link></main>;
}
