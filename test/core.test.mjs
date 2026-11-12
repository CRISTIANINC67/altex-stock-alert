import test from "node:test";
import assert from "node:assert/strict";
import { runOnce, ERROR_NOTICE_INTERVAL_MS } from "../src/core.mjs";

const ENV = {
  PRODUCT_SKU: "SMTIP16PM5DT",
  PRODUCT_URL: "https://altex.ro/x/cpd/SMTIP16PM5DT/",
  PRODUCT_NAME: "iPhone 16 Pro Max 512GB",
  NTFY_TOPIC: "test-topic",
  NTFY_EMAIL: "me@example.com",
};

const altexJson = (stock, pickup = 0) =>
  new Response(JSON.stringify({ products: [{ sku: "SMTIP16PM5DT", price: 3349.95, stock_status: stock, pickup_is_in_stock: pickup }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function harness(initial = null) {
  let state = initial;
  let altex = () => altexJson(0);
  let ntfy = () => new Response("{}", { status: 200 });
  const sent = [];
  const fetchFn = async (url, init = {}) => {
    if (String(url).includes("fenrir.altex.ro")) return altex();
    const body = JSON.parse(init.body);
    const res = ntfy(body, url);
    if (res.ok) sent.push({ url: String(url), ...body });
    return res;
  };
  return {
    sent,
    get state() { return state; },
    setAltex: (fn) => (altex = fn),
    setNtfy: (fn) => (ntfy = fn),
    run: (env = {}, now = 1_000_000_000_000) =>
      runOnce({ env: { ...ENV, ...env }, fetchFn, now, store: { get: async () => state, put: async (s) => (state = s) } }),
  };
}

test("fără stoc: nicio notificare", async () => {
  const h = harness();
  await h.run();
  await h.run();
  assert.equal(h.sent.length, 0);
  assert.equal(h.state.inStock, false);
});

test("tranziție în stoc: 3 alerte urgente, apoi se oprește; email o singură dată", async () => {
  const h = harness();
  await h.run();
  h.setAltex(() => altexJson(1));
  for (let i = 0; i < 6; i++) await h.run();
  assert.equal(h.sent.length, 3);
  const [a, b, c] = h.sent;
  assert.equal(a.title, "🚨 iPhone 16 Pro Max 512GB E ÎN STOC LA ALTEX!");
  assert.equal(a.priority, 5);
  assert.equal(a.click, ENV.PRODUCT_URL);
  assert.deepEqual(a.actions[0], { action: "view", label: "Deschide pagina produsului", url: ENV.PRODUCT_URL });
  assert.match(a.message, /3\.349,95 lei/);
  assert.equal(a.email, "me@example.com");
  assert.equal(b.email, undefined);
  assert.equal(c.email, undefined);
});

test("iese din stoc și reintră: seria de alerte repornește", async () => {
  const h = harness({ inStock: true, alertsSent: 3, emailSent: true });
  h.setAltex(() => altexJson(1));
  await h.run();
  assert.equal(h.sent.length, 0);
  h.setAltex(() => altexJson(0));
  await h.run();
  h.setAltex(() => altexJson(1));
  await h.run();
  assert.equal(h.sent.length, 1);
});

test("doar ridicare din magazin contează ca stoc", async () => {
  const h = harness({ inStock: false });
  h.setAltex(() => altexJson(0, 1));
  await h.run();
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0].message, /ridicare din magazin/);
});

test("captcha / eroare: nu e tratat ca stoc, avertisment cu prioritate mică cel mult o dată la 6 ore", async () => {
  const h = harness({ inStock: false });
  h.setAltex(() => new Response("<html>Access Denied</html>", { status: 200 }));
  const t0 = 1_000_000_000_000;
  await h.run({}, t0);
  await h.run({}, t0 + 60_000);
  h.setAltex(() => new Response("blocked", { status: 403 }));
  await h.run({}, t0 + ERROR_NOTICE_INTERVAL_MS - 1);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].title, "⚠️ Monitorul nu poate citi pagina");
  assert.equal(h.sent[0].priority, 2);
  assert.equal(h.sent[0].email, undefined);
  assert.equal(h.state.inStock, false);
  await h.run({}, t0 + ERROR_NOTICE_INTERVAL_MS);
  assert.equal(h.sent.length, 2);
});

test("eroare cât timp e în stoc nu repornește alertele", async () => {
  const h = harness({ inStock: true, alertsSent: 3, emailSent: true, lastErrorNotice: 1_000_000_000_000 });
  h.setAltex(() => { throw new Error("timeout"); });
  await h.run();
  h.setAltex(() => altexJson(1));
  await h.run();
  assert.equal(h.sent.length, 0);
});

test("răspuns pentru alt SKU sau fără stock_status = eroare", async () => {
  const h = harness();
  h.setAltex(() => new Response(JSON.stringify({ products: [{ sku: "ALTUL", stock_status: 1 }] }), { status: 200 }));
  const log = await h.run();
  assert.equal(log.check.ok, false);
  assert.equal(h.state.inStock, null);
  assert.equal(h.sent[0].priority, 2);
});

test("FORCE_ALERT=true: o singură alertă de test cu email, fără să schimbe starea stocului", async () => {
  const h = harness();
  await h.run({ FORCE_ALERT: "true" });
  await h.run({ FORCE_ALERT: "true" });
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].priority, 5);
  assert.equal(h.sent[0].email, "me@example.com");
  assert.match(h.sent[0].message, /TEST/);
  assert.equal(h.state.inStock, false);
  await h.run({ FORCE_ALERT: "false" });
  assert.equal(h.state.forceSent, false);
});

test("ntfy refuză emailul: push-ul pleacă fără email, emailul merge prin Resend", async () => {
  const h = harness({ inStock: false });
  h.setAltex(() => altexJson(1));
  h.setNtfy((body, url) => {
    if (String(url).includes("resend.com")) return new Response("{}", { status: 200 });
    return body.email ? new Response("{}", { status: 429 }) : new Response("{}", { status: 200 });
  });
  const log = await h.run({ RESEND_API_KEY: "re_test" });
  const ev = log.events.find((e) => e.type === "stock_alert");
  assert.equal(ev.pushOk, true);
  assert.equal(ev.emailVia, "resend");
  assert.equal(h.sent.filter((s) => s.url.includes("ntfy")).length, 1);
  assert.equal(h.state.emailSent, true);
});

test("starea se scrie doar când se schimbă", async () => {
  let puts = 0;
  let state = null;
  const store = { get: async () => state, put: async (s) => { state = s; puts++; } };
  const fetchFn = async () => altexJson(0);
  for (let i = 0; i < 5; i++) await runOnce({ env: ENV, store, fetchFn });
  assert.equal(puts, 1);
});
