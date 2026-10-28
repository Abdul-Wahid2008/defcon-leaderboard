import { connection } from 'next/server';

// Rendered per request so the proxy's CSP nonce can be stamped on Next's scripts.
export default async function Home() {
  await connection();
  return (
    <main className="page">
      <h1 className="title">DEFCON 2.0</h1>
      <p className="muted">Waiting for the first scoreboard update.</p>
    </main>
  );
}
