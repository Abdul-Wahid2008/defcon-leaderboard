// PROVISIONAL fake scoreboard for demos, tests and attack runs. Serves the SAME invented field names as
// tests/fixtures/provisional-scoreboard.json; it says nothing about the club's real file. Binds 127.0.0.1 only.
//   FAKE_PORT=3290  FAKE_TEAMS=30  FAKE_ROUND_MS=3000  FAKE_START_ROUND=1
// Control (localhost): GET /__mode?m=<ok|hold|500|garbage|timeout|redirect|huge|hostile|dupkeys>   GET /__round?set=N   GET /__stats (scoreboard.json request count)
import http from 'node:http';

const port = Number(process.env.FAKE_PORT ?? 3290);
const teamCount = Number(process.env.FAKE_TEAMS ?? 30);
const roundMs = Number(process.env.FAKE_ROUND_MS ?? 3000);
const startedAt = Date.now();
let offset = Number(process.env.FAKE_START_ROUND ?? 1) - 1;
let mode = 'ok';
let heldRound = 0;
let hits = 0;

const currentRound = () => (mode === 'hold' ? heldRound : offset + 1 + Math.floor((Date.now() - startedAt) / roundMs));

const HOSTILE = ['<script>alert(1)</script>', 'Evil‮team', 'zero​width', 'A'.repeat(300), '   spaced    out   ', '__proto__'];

function doc(round: number) {
  const teams = Array.from({ length: teamCount }, (_, i) => {
    // Every 5th team shares a rate so ties appear; a slow wobble makes ranks change over time.
    const rate = 10 + ((i * 7) % 23) + (i % 5 === 0 ? 3 : 0);
    const attack = round * rate * 0.5 + ((round + i) % 3);
    const defense = round * rate * 0.3;
    const sla = round * rate * 0.2;
    return {
      teamId: i + 1,
      teamName: mode === 'hostile' ? HOSTILE[i % HOSTILE.length] : `Team ${String(i + 1).padStart(2, '0')}`,
      totalPoints: Math.round((attack + defense + sla) * 1000) / 1000,
      attackPoints: Math.round(attack * 1000) / 1000,
      defensePoints: Math.round(defense * 1000) / 1000,
      serviceLevelAgreementPoints: Math.round(sla * 1000) / 1000,
      services: [
        { serviceName: 'docuvault', status: (round + i) % 7 === 0 ? 'MUMBLE' : 'OK' },
        { serviceName: 'pulsechat', status: (round + i) % 11 === 0 ? 'OFFLINE' : 'OK' },
      ],
    };
  });
  return { _note: 'PROVISIONAL fake', currentRound: round, timestamp: new Date().toISOString(), teams };
}

const json = (res: http.ServerResponse, body: string, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
};

const server = http.createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://x');
  if (u.pathname === '/__mode') {
    mode = u.searchParams.get('m') ?? 'ok';
    if (mode === 'hold') heldRound = offset + 1 + Math.floor((Date.now() - startedAt) / roundMs);
    return json(res, JSON.stringify({ mode }));
  }
  if (u.pathname === '/__round') {
    const set = Number(u.searchParams.get('set'));
    if (Number.isInteger(set)) offset = set - 1 - Math.floor((Date.now() - startedAt) / roundMs);
    return json(res, JSON.stringify({ round: currentRound() }));
  }
  if (u.pathname === '/__stats') return json(res, JSON.stringify({ hits }));
  if (u.pathname !== '/scoreboard.json') return json(res, '{}', 404);
  hits++;
  switch (mode) {
    case '500':
      return json(res, '{"error":"boom"}', 500);
    case 'garbage':
      return json(res, '<<<not json at all');
    case 'timeout':
      return; // never answer
    case 'redirect':
      res.writeHead(302, { Location: 'http://127.0.0.1:1/' });
      return void res.end();
    case 'huge':
      return json(res, JSON.stringify({ pad: 'x'.repeat(3 * 1024 * 1024) }));
    case 'dupkeys':
      return json(res, '{"currentRound":' + currentRound() + ',"currentRound":1,"__proto__":{"polluted":true},"teams":[]}');
    default:
      return json(res, JSON.stringify(doc(currentRound())));
  }
});

server.listen(port, '127.0.0.1', () => console.log(`fake scoreboard on http://127.0.0.1:${port}/scoreboard.json (${teamCount} teams, ${roundMs} ms/round)`));
