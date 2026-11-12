// Cloudflare Worker: rulează la fiecare minut (Cron Trigger), starea stă în KV.
import { runOnce } from "./core.mjs";

const STATE_KEY = "state";

export default {
  async scheduled(event, env) {
    const store = {
      get: () => env.STATE.get(STATE_KEY, "json"),
      put: (state) => env.STATE.put(STATE_KEY, JSON.stringify(state)),
    };
    try {
      const log = await runOnce({ env, store, now: event.scheduledTime || Date.now() });
      console.log(JSON.stringify(log));
    } catch (err) {
      console.error(`Rulare eșuată: ${err?.message || err}`);
    }
  },
};
