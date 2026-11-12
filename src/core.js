const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'ro-RO,ro;q=0.9,en;q=0.8',
}
const SIX_HOURS = 6 * 60 * 60 * 1000

// Citeste doar JSON-LD-ul produsului cu SKU-ul nostru: pagina are si produse recomandate care sunt in stoc.
export function parseStock(html, sku) {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    let d
    try { d = JSON.parse(m[1]) } catch { continue }
    if (d['@type'] !== 'Product' || d.sku !== sku) continue
    const offer = [d.offers].flat()[0]
    if (!offer?.availability) break
    return { stock: /OutOfStock|SoldOut|Discontinued/.test(offer.availability) ? 'out' : 'in', price: offer.price }
  }
  return { stock: 'unreadable', why: 'Nu am gasit datele de stoc ale produsului in pagina (posibil captcha / bot-protection).' }
}

// O verificare. Primeste starea veche, intoarce starea noua; apelantul o salveaza.
// Daca o notificare esueaza arunca eroare, deci starea nu avanseaza si se reincearca la rularea urmatoare.
export async function check(env, old, now = Date.now(), fetchFn = fetch) {
  const state = { last: 'out', sent: 0, warnedAt: 0, forced: false, ...old }
  const url = env.PRODUCT_URL
  const sku = url.match(/\/cpd\/([^/]+)/)[1]

  const notify = async (n) => {
    const res = await fetchFn('https://ntfy.sh/', { method: 'POST', headers: env.NTFY_TOKEN ? { Authorization: `Bearer ${env.NTFY_TOKEN}` } : {}, body: JSON.stringify({ topic: env.NTFY_TOPIC, click: url, ...n }) })
    if (!res.ok) throw new Error(`ntfy HTTP ${res.status} (token: ${env.NTFY_TOKEN ? `da, ${env.NTFY_TOKEN.length} caractere` : "nu"}): ${await res.text()}`)
  }
  const alert = (price, test) => notify({
    title: env.ALERT_TITLE,
    message: `${test ? 'TEST (alerta falsa). ' : ''}${price ? `Pret: ${price} RON. ` : ''}Apasa pentru a deschide pagina produsului.`,
    priority: 5,
    actions: [{ action: 'view', label: 'Deschide pagina', url }],
    email: env.ALERT_EMAIL || undefined,
  })

  let result
  try {
    const res = await fetchFn(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) })
    result = res.ok ? parseStock(await res.text(), sku) : { stock: 'unreadable', why: `HTTP ${res.status}` }
  } catch (e) {
    result = { stock: 'unreadable', why: String(e) }
  }

  // FORCE_ALERT trimite o singura alerta de test, nu una pe minut.
  if (env.FORCE_ALERT === 'true') {
    if (!state.forced) { await alert(result.price, true); state.forced = true }
  } else state.forced = false

  if (result.stock === 'unreadable') {
    if (now - state.warnedAt > SIX_HOURS) {
      await notify({ title: '⚠️ Monitorul nu poate citi pagina', message: result.why, priority: 2 })
      state.warnedAt = now
    }
  } else if (result.stock === 'in') {
    if (state.last !== 'in') state.sent = 0
    if (state.sent < 3) { await alert(result.price); state.sent++ }
    state.last = 'in'
  } else {
    state.last = 'out'
    state.sent = 0
  }
  return { state, result }
}
