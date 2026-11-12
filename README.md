# altex-stock-alert

Verifică stocul unui produs Altex și trimite o alertă urgentă (push + email) când produsul intră în stoc.

- **Sursa de stoc:** `https://fenrir.altex.ro/catalog/product/?filter=sku:<COD>` (API-ul JSON folosit de site), câmpurile `stock_status` și `pickup_is_in_stock`.
- **Notificări:** [ntfy.sh](https://ntfy.sh) (gratuit, fără cont).
- **Rulare:** Cloudflare Worker la 1 minut (`src/worker.mjs`) sau, ca rezervă, GitHub Actions la 5 minute (`.github/workflows/stock-check.yml`). Folosește o singură variantă.

## 1. Abonare la notificări (ntfy)

Topicul tău este în fișierul `.dev.vars` (linia `NTFY_TOPIC=`). Nu-l da nimănui: cine îl știe poate citi și trimite notificări.

**Telefon (Android / iOS)**
1. Instalează aplicația **ntfy** din Google Play / App Store.
2. Apasă **+** → la „Topic name" scrie topicul → **Subscribe**.
3. Android: intră în topic → ⋮ → setări notificări și permite „Override Do Not Disturb" pentru prioritatea maximă. iOS: Setări → Notificări → ntfy → activează „Time Sensitive / Critical".

**PC / browser**
1. Deschide `https://ntfy.sh/app` în Chrome sau Edge.
2. **Subscribe to topic** → scrie topicul → **Subscribe**.
3. Acceptă notificările de browser când ești întrebat. (Opțional: meniul browserului → „Install ntfy" ca să meargă ca aplicație.)

## 2. Pornire

**Cloudflare Worker (1 minut)**
```bash
npx wrangler login
npx wrangler kv namespace create STATE     # copiază id-ul în wrangler.toml
npx wrangler secret put NTFY_TOPIC
npx wrangler secret put NTFY_EMAIL
npx wrangler deploy
npx wrangler tail                          # loguri live
```

**GitHub Actions (5 minute, rezervă)** – repo **public** (minute gratuite nelimitate), apoi în repo: Settings → Secrets and variables → Actions → adaugă `NTFY_TOPIC` și `NTFY_EMAIL` (opțional `RESEND_API_KEY`). GitHub oprește singur cron-ul după 60 de zile fără activitate în repo.

## 3. Test (alertă falsă)

- Cloudflare: `npx wrangler deploy --var FORCE_ALERT:true`, aștepți un minut, apoi `npx wrangler deploy` (revine la `false`).
- GitHub: Actions → „Altex stock check" → **Run workflow** → bifează `force_alert`.

Se trimite o singură alertă de test, marcată „TEST".

## 4. Cum opresc monitorul după ce cumpăr telefonul

- Cloudflare: `npx wrangler delete` (șterge Worker-ul și cron-ul).
- GitHub: Actions → „Altex stock check" → ⋯ → **Disable workflow** (sau șterge repo-ul).
- În aplicația ntfy: ține apăsat pe topic → **Unsubscribe**.

## 5. Cum îl refolosesc pentru alt produs Altex

1. Ia codul produsului din URL (partea de după `/cpd/`, ex. `SMTIP16PM5DT`).
2. Schimbă `PRODUCT_SKU`, `PRODUCT_URL` și `PRODUCT_NAME`:
   - Cloudflare: în `wrangler.toml`, secțiunea `[vars]`, apoi `npx wrangler deploy`.
   - GitHub: Settings → Secrets and variables → Actions → tab **Variables**.
3. Șterge starea veche: `npx wrangler kv key delete state --binding STATE --remote` (la GitHub nu e nevoie, starea se corectează la prima rulare).

## Cum se comportă

- Alertează doar la trecerea „fără stoc → în stoc", de 3 ori la 1 minut distanță, apoi se oprește. Emailul se trimite o singură dată.
- Dacă Altex răspunde cu eroare / captcha, starea nu se schimbă și primești „⚠️ Monitorul nu poate citi pagina" (prioritate mică, cel mult o dată la 6 ore).
- Nu cumpără nimic și nu se loghează nicăieri.
