# altex-stock-alert

Verifică la fiecare minut dacă produsul de pe Altex a intrat în stoc și trimite o alertă urgentă prin ntfy (push + email). Rulează gratuit pe Cloudflare Workers, deci merge și cu PC-ul oprit.

## 1. Primești notificările (ntfy)

Numele topicului tău e în fișierul `.dev.vars` (linia `NTFY_TOPIC=`). Cine știe numele poate citi alertele, deci nu-l da mai departe.

- **Telefon (Android / iOS):** instalează aplicația **ntfy** din Google Play / App Store → `+` → lipește numele topicului → Subscribe.
  - Android: în setările topicului lasă „Instant delivery” pornit și permite aplicației să ignore „Nu deranja”, ca alerta urgentă să sune și pe silențios.
  - iOS: Setări → Notificări → ntfy → pornește „Time Sensitive / Critical”.
- **PC / browser:** deschide `https://ntfy.sh/app` → „Subscribe to topic” → lipește topicul → acceptă notificările browserului. Tabul trebuie să rămână deschis (sau instalează pagina ca aplicație din meniul browserului).
- **Email:** vine automat la adresa din secretul `ALERT_EMAIL`. Verifică și folderul Spam la primul test.

## 2. Test

În `wrangler.toml` pune `FORCE_ALERT = "true"`, apoi `npx wrangler deploy`. În cel mult un minut primești o singură alertă de test. Pune înapoi `"false"` și fă din nou deploy.

Loguri live: `npx wrangler tail`.

## 3. Oprești monitorul (după ce ai cumpărat)

```
npx wrangler delete
```

Asta șterge Worker-ul și cron-ul. (Pauză temporară: șterge linia din `crons` și fă deploy.)

## 4. Îl refolosești pentru alt produs Altex

În `wrangler.toml` schimbă `PRODUCT_URL` (linkul produsului, trebuie să conțină `/cpd/COD/`) și `ALERT_TITLE`, apoi `npx wrangler deploy`. Dacă noul produs e deja în stoc, primești alerta imediat.

## Varianta de rezervă (GitHub Actions, la 5 minute)

Doar dacă Altex începe să blocheze Cloudflare (primești „⚠️ Monitorul nu poate citi pagina”). Urcă folderul într-un repo GitHub privat, apoi în Settings → Secrets and variables → Actions adaugă secretele `NTFY_TOPIC`, `ALERT_EMAIL` și variabilele `PRODUCT_URL`, `ALERT_TITLE`. Test: Actions → altex-stock-check → Run workflow → bifează `force_alert`. Oprire: Actions → altex-stock-check → `…` → Disable workflow.

## Cum decide „în stoc”

Citește din HTML-ul paginii blocul JSON-LD al produsului (`offers.availability`). `OutOfStock` = fără stoc; orice altă valoare = în stoc. Dacă blocul lipsește (eroare, captcha), nu alertează, ci trimite avertismentul de prioritate mică, cel mult o dată la 6 ore.
