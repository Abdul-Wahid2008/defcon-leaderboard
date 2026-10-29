// Starts the collector once per server process (Node runtime only). A bad configuration is logged and leaves the API in
// its fail-closed 503 state; it must not stop the server from starting.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { getRuntime } = await import('./lib/runtime');
    await getRuntime();
  } catch {
    console.error('[collector] not started: configuration or store invalid (run npm run check-env)');
  }
}
