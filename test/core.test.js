import test from 'node:test'
import assert from 'node:assert/strict'
import { check, parseStock } from '../src/core.js'

const env = { PRODUCT_URL: 'https://altex.ro/x/cpd/SKU1/', ALERT_TITLE: 'T', NTFY_TOPIC: 'topic', ALERT_EMAIL: 'a@b.c' }
const ld = (sku, avail) => `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', sku, offers: { availability: `https://schema.org/${avail}`, price: 99 } })}</script>`
// produs recomandat in stoc + buton "Adauga in cos": nu trebuie sa pacaleasca detectia
const page = (avail) => `<html>${ld('OTHER', 'InStock')}<button>Adauga in cos</button>${ld('SKU1', avail)}</html>`

function fake(body, status = 200) {
  const sent = []
  const fetchFn = async (url, init) => {
    if (url.startsWith('https://ntfy.sh')) { sent.push(JSON.parse(init.body)); return new Response('ok') }
    return new Response(body, { status })
  }
  return { sent, fetchFn }
}

test('parseStock ignora alte produse', () => {
  assert.equal(parseStock(page('OutOfStock'), 'SKU1').stock, 'out')
  assert.deepEqual(parseStock(page('InStock'), 'SKU1'), { stock: 'in', price: 99 })
  assert.equal(parseStock('<html>captcha</html>', 'SKU1').stock, 'unreadable')
})

test('fara stoc: nicio notificare', async () => {
  const f = fake(page('OutOfStock'))
  await check(env, {}, 1e12, f.fetchFn)
  assert.equal(f.sent.length, 0)
})

test('in stoc: exact 3 alerte urgente, apoi liniste; dupa out -> in iar', async () => {
  const f = fake(page('InStock'))
  let state = {}
  for (let i = 0; i < 5; i++) ({ state } = await check(env, state, 1e12, f.fetchFn))
  assert.equal(f.sent.length, 3)
  assert.equal(f.sent[0].priority, 5)
  assert.equal(f.sent[0].click, env.PRODUCT_URL)
  assert.equal(f.sent[0].actions[0].url, env.PRODUCT_URL)
  assert.equal(f.sent[0].email, 'a@b.c')
  assert.match(f.sent[0].message, /99 RON/)
  ;({ state } = await check(env, state, 1e12, fake(page('OutOfStock')).fetchFn))
  ;({ state } = await check(env, state, 1e12, f.fetchFn))
  assert.equal(f.sent.length, 4)
})

test('eroare / captcha: avertisment o data la 6 ore, niciodata "in stoc"', async () => {
  for (const f of [fake('blocked', 403), fake('<html>captcha</html>')]) {
    let state = {}
    ;({ state } = await check(env, state, 1e12, f.fetchFn))
    ;({ state } = await check(env, state, 1e12 + 60e3, f.fetchFn))
    assert.equal(f.sent.length, 1)
    assert.equal(f.sent[0].priority, 2)
    assert.equal(state.last, 'out')
    await check(env, state, 1e12 + 6 * 3600e3 + 1, f.fetchFn)
    assert.equal(f.sent.length, 2)
  }
})

test('FORCE_ALERT trimite o singura alerta de test', async () => {
  const f = fake(page('OutOfStock'))
  let state = {}
  for (let i = 0; i < 3; i++) ({ state } = await check({ ...env, FORCE_ALERT: 'true' }, state, 1e12, f.fetchFn))
  assert.equal(f.sent.length, 1)
  assert.match(f.sent[0].message, /TEST/)
  assert.equal(state.last, 'out')
})
