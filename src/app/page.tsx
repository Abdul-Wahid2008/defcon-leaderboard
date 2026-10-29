import { connection } from 'next/server';
import { viewInput } from '../lib/api';
import { BoardClient } from '../components/board-client';
import { getDeps } from '../lib/runtime';
import { buildBoard, type BoardBody } from '../lib/view';

// Rendered per request so the proxy's CSP nonce can be stamped on Next's scripts, and so the first paint already holds
// the same clipped board the API serves (freeze applies to the HTML as well, D28).
async function initialBoard(): Promise<BoardBody | null> {
  try {
    return buildBoard(await viewInput(await getDeps()));
  } catch {
    return null; // the client shows its waiting state and keeps polling
  }
}

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const sp = await searchParams;
  return <BoardClient initial={await initialBoard()} tv={sp.tv === '1'} />;
}
