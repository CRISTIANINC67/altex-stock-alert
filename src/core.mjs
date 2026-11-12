// Logica comună (Cloudflare Worker + GitHub Actions).
// Nu conține niciun secret: totul vine din variabile de mediu.

export const MAX_ALERTS = 3; // alerta se repetă de 3 ori, câte una pe rulare
export const ERROR_NOTICE_INTERVAL_MS = 6 * 60 * 60 * 1000; // cel mult o dată la 6 ore
const FETCH_TIMEOUT_MS = 15000;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "ro-RO,ro;q=0.9,en;q=0.8",
  Origin: "https://altex.ro",
  Referer: "https://altex.ro/",
};

export const DEFAULT_STATE = {
  inStock: null, // null = necunoscut, true / false = ultima stare citită corect
  alertsSent: 0, // câte alerte s-au trimis pentru intrarea curentă în stoc
  emailSent: false, // emailul se trimite o singură dată pe intrare în stoc
  lastErrorNotice: 0, // timestamp (ms) al ultimei notificări "nu pot citi pagina"
  forceSent: false, // alerta de test a fost deja trimisă pentru FORCE_ALERT=true
};

export function readConfig(env) {
  const cfg = {
    sku: (env.PRODUCT_SKU || "").trim(),
    productUrl: (env.PRODUCT_URL || "").trim(),
    productName: (env.PRODUCT_NAME || "").trim(),
    ntfyServer: (env.NTFY_SERVER || "https://ntfy.sh").trim().replace(/\/+$/, ""),
    ntfyTopic: (env.NTFY_TOPIC || "").trim(),
    email: (env.NTFY_EMAIL || "").trim(),
    resendKey: (env.RESEND_API_KEY || "").trim(),
    force: String(env.FORCE_ALERT || "").trim().toLowerCase() === "true",
  };
  const missing = ["sku", "productUrl", "productName", "ntfyTopic"].filter((k) => !cfg[k]);
  if (missing.length) throw new Error(`Lipsesc variabile de configurare: ${missing.join(", ")}`);
  return cfg;
}

function formatPrice(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return `${value.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} lei`;
}

/**
 * Citește stocul din API-ul JSON pe care îl folosește și site-ul Altex.
 * Întoarce { ok: true, inStock, ... } DOAR dacă răspunsul e JSON valid pentru exact acest SKU.
 * Orice altceva (eroare, captcha, pagină de bot-protection) => { ok: false, reason }.
 */
export async function checkStock(cfg, fetchFn = fetch) {
  const url = `https://fenrir.altex.ro/catalog/product/?filter=sku:${encodeURIComponent(cfg.sku)}`;
  let res;
  let text;
  try {
    res = await fetchFn(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    text = await res.text();
  } catch (err) {
    return { ok: false, reason: `cererea a eșuat (${err?.name || "Error"}: ${err?.message || err})` };
  }
  if (res.status !== 200) return { ok: false, reason: `HTTP ${res.status}` };

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: "răspunsul nu este JSON (posibil captcha / bot-protection)" };
  }
  const product = Array.isArray(data?.products) ? data.products.find((p) => p?.sku === cfg.sku) : null;
  if (!product) return { ok: false, reason: `produsul ${cfg.sku} lipsește din răspuns` };
  if (typeof product.stock_status !== "number") return { ok: false, reason: "câmpul stock_status lipsește" };

  const online = product.stock_status > 0;
  const pickup = Number(product.pickup_is_in_stock) > 0;
  return {
    ok: true,
    inStock: online || pickup,
    online,
    pickup,
    stockStatus: product.stock_status,
    pickupIsInStock: product.pickup_is_in_stock ?? null,
    price: formatPrice(product.price),
  };
}

async function postNtfy(cfg, fetchFn, payload) {
  try {
    const res = await fetchFn(cfg.ntfyServer, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: String(err?.message || err) };
  }
}

async function sendResendEmail(cfg, fetchFn, subject, text) {
  try {
    const res = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "Altex Stock Alert <onboarding@resend.dev>", to: [cfg.email], subject, text }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Publică pe ntfy (push pe toate dispozitivele abonate la topic).
 * Cu wantEmail: câmpul "email" merge pe aceeași cerere (echivalentul headerului "Email:").
 * Dacă ntfy refuză emailul, push-ul se retrimite fără email, iar emailul pleacă prin Resend (dacă e configurat).
 */
export async function notify(cfg, fetchFn, { title, message, priority, tags, wantEmail }) {
  const payload = {
    topic: cfg.ntfyTopic,
    title,
    message,
    priority,
    tags,
    click: cfg.productUrl,
    actions: [{ action: "view", label: "Deschide pagina produsului", url: cfg.productUrl }],
  };
  const withEmail = Boolean(wantEmail && cfg.email);
  let push = await postNtfy(cfg, fetchFn, withEmail ? { ...payload, email: cfg.email } : payload);
  let emailOk = withEmail && push.ok;
  let emailVia = emailOk ? "ntfy" : null;

  if (withEmail && !push.ok) {
    const firstStatus = push.status;
    push = await postNtfy(cfg, fetchFn, payload);
    push.emailAttemptStatus = firstStatus;
    if (cfg.resendKey) {
      emailOk = await sendResendEmail(cfg, fetchFn, title, `${message}\n\n${cfg.productUrl}`);
      if (emailOk) emailVia = "resend";
    }
  }
  return { pushOk: push.ok, pushStatus: push.status, emailAttemptStatus: push.emailAttemptStatus, emailOk, emailVia };
}

function stockMessage(cfg, check, { test = false } = {}) {
  const lines = [];
  if (test) lines.push("ACESTA ESTE UN TEST (FORCE_ALERT=true). Produsul NU este neapărat în stoc.");
  if (check?.ok) {
    if (check.price) lines.push(`Preț: ${check.price}`);
    if (!test) {
      if (check.online) lines.push("Disponibil pentru comandă online.");
      else if (check.pickup) lines.push("Disponibil doar cu ridicare din magazin.");
    }
  }
  lines.push(cfg.productUrl);
  return lines.join("\n");
}

/**
 * O rulare completă. `store` = { get(): state|null, put(state) }.
 * Scrie starea doar când se schimbă (limita KV gratuită: 1000 scrieri / zi).
 */
export async function runOnce({ env, store, fetchFn = fetch, now = Date.now() }) {
  const cfg = readConfig(env);
  const prev = { ...DEFAULT_STATE, ...((await store.get()) || {}) };
  const next = { ...prev };
  const log = { sku: cfg.sku, events: [] };
  const alertTitle = `🚨 ${cfg.productName} E ÎN STOC LA ALTEX!`;

  const check = await checkStock(cfg, fetchFn);
  log.check = check;

  // Mod de test: o singură alertă falsă cât timp FORCE_ALERT=true.
  if (cfg.force) {
    if (!prev.forceSent) {
      const sent = await notify(cfg, fetchFn, {
        title: alertTitle,
        message: stockMessage(cfg, check, { test: true }),
        priority: 5,
        tags: ["rotating_light", "test_tube"],
        wantEmail: true,
      });
      log.events.push({ type: "force_alert", ...sent });
      if (sent.pushOk) next.forceSent = true;
    }
  } else {
    next.forceSent = false;
  }

  if (!check.ok) {
    // Nu se poate citi stocul: NU schimbăm starea și NU tratăm ca "în stoc".
    if (now - (prev.lastErrorNotice || 0) >= ERROR_NOTICE_INTERVAL_MS) {
      const sent = await notify(cfg, fetchFn, {
        title: "⚠️ Monitorul nu poate citi pagina",
        message: `Altex: ${check.reason}\nVerificarea stocului nu funcționează momentan. Verifică manual:\n${cfg.productUrl}`,
        priority: 2,
        tags: ["warning"],
        wantEmail: false,
      });
      log.events.push({ type: "error_notice", ...sent });
      if (sent.pushOk) next.lastErrorNotice = now;
    }
  } else if (check.inStock) {
    if (prev.inStock !== true) {
      // Tranziția "fără stoc -> în stoc": pornește seria de 3 alerte.
      next.alertsSent = 0;
      next.emailSent = false;
      log.events.push({ type: "transition_in_stock" });
    }
    next.inStock = true;
    if (next.alertsSent < MAX_ALERTS) {
      const sent = await notify(cfg, fetchFn, {
        title: alertTitle,
        message: stockMessage(cfg, check),
        priority: 5,
        tags: ["rotating_light"],
        wantEmail: !next.emailSent,
      });
      log.events.push({ type: "stock_alert", number: next.alertsSent + 1, ...sent });
      if (sent.pushOk) next.alertsSent += 1;
      if (sent.emailOk) next.emailSent = true;
    }
  } else {
    next.inStock = false;
    next.alertsSent = 0;
    next.emailSent = false;
  }

  if (JSON.stringify(next) !== JSON.stringify(prev)) {
    await store.put(next);
    log.stateSaved = true;
  }
  log.state = next;
  // pending = mai sunt alerte de repetat cât timp produsul rămâne în stoc
  log.pending = next.inStock === true && next.alertsSent < MAX_ALERTS && check.ok;
  return log;
}
