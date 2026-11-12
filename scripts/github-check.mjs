// Varianta de rezervă (GitHub Actions, cron la 5 minute). Starea stă în state.json (păstrat cu actions/cache).
// Rulează și local: `npm run check` (citește .dev.vars dacă există).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { runOnce } from "../src/core.mjs";

const STATE_FILE = process.env.STATE_FILE || "state.json";

const env = { ...process.env };
if (existsSync(".dev.vars")) {
  for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2];
  }
}

const store = {
  get: async () => (existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : null),
  put: async (state) => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)),
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// O singură verificare pe rulare. Doar dacă produsul E în stoc, rularea mai stă
// și repetă alerta la 1 minut distanță (maximum 3 alerte în total).
for (let i = 0; i < 3; i++) {
  const log = await runOnce({ env, store });
  console.log(JSON.stringify(log));
  if (!log.pending) break;
  await sleep(60_000);
}
