# altex-stock-alert

Verifică la fiecare minut dacă produsul de pe Altex a intrat în stoc și trimite o alertă urgentă prin ntfy (push + email). Rulează gratuit în cloud, deci merge și cu PC-ul oprit.

## Cum funcționează

1. Un **Cloudflare Worker** citește pagina produsului la fiecare minut și ține minte ultima stare (KV).
2. Când are ceva de anunțat, pornește workflow-ul **`notify`** din acest repo GitHub.
3. Workflow-ul trimite mesajul prin **ntfy** (push + email).

De ce în doi pași: ntfy.sh refuză cererile venite direct din Cloudflare, iar GitHub nu poate citi pagina Altex și își pornește cron-urile cam o dată pe oră. Alerta ajunge la câteva zeci de secunde după detectare.

Unde stau secretele:

| Unde | Secret |
|---|---|
| GitHub → Settings → Secrets and variables → Actions | `NTFY_TOPIC`, `NTFY_TOKEN`, `ALERT_EMAIL` |
| Cloudflare (`wrangler secret put`) | `GITHUB_TOKEN` (token fin, doar acest repo, Actions: Read and write) |

## 1. Primești notificările (ntfy)

Numele topicului e în `.dev.vars` (linia `NTFY_TOPIC=`). Cine îl știe poate citi alertele, deci nu-l da mai departe.

- **Telefon (Android / iOS):** instalează aplicația **ntfy** → `+` → lipește topicul → Subscribe.
  - Android: lasă „Instant delivery” pornit și permite aplicației să ignore „Nu deranja”, ca alerta urgentă să sune și pe silențios.
  - iOS: Setări → Notificări → ntfy → pornește „Time Sensitive”.
- **PC / browser:** `https://ntfy.sh/app` → „Subscribe to topic” → lipește topicul → acceptă notificările. Tabul trebuie să rămână deschis (sau instalează pagina ca aplicație din meniul browserului).
- **Email:** vine la adresa din secretul `ALERT_EMAIL`. Verifică și Spam.

## 2. Test

În `wrangler.toml` pune `FORCE_ALERT = "true"`, apoi rulează `npx.cmd wrangler deploy`. În 1–2 minute primești o singură alertă de test. Pune înapoi `"false"` și fă din nou deploy.

Loguri live ale Worker-ului: `npx.cmd wrangler tail`. Mesajele trimise se văd în GitHub → Actions → notify.

## 3. Oprești monitorul (după ce ai cumpărat)

```
npx.cmd wrangler delete
```

Asta șterge Worker-ul și cron-ul; fără el, workflow-ul din GitHub nu mai pornește niciodată. Apoi poți șterge și tokenul GitHub (Settings → Developer settings → Personal access tokens).

## 4. Îl refolosești pentru alt produs Altex

În `wrangler.toml` schimbă `PRODUCT_URL` (linkul produsului, trebuie să conțină `/cpd/COD/`) și `ALERT_TITLE`, apoi `npx.cmd wrangler deploy`. Dacă noul produs e deja în stoc, primești alerta imediat.

## Cum decide „în stoc”

Citește din HTML-ul paginii blocul JSON-LD al produsului (`offers.availability`). `OutOfStock` = fără stoc; orice altă valoare = în stoc. Alertează doar la trecerea „fără stoc → în stoc”, de 3 ori la un minut distanță. Dacă blocul lipsește (eroare, captcha), nu alertează, ci trimite „⚠️ Monitorul nu poate citi pagina”, cel mult o dată la 6 ore.
