# Eltefritt push-server

Gjør at heve-alarmen når frem som systemvarsel **selv når appen er lukket**
(mobil med låst skjerm inkludert). Appen fungerer som før uten denne serveren;
Web Push er et tillegg som slås på ved å fylle inn to konstanter i `index.html`.

Arkitektur: Cloudflare Worker uten avhengigheter. Én Durable Object per
push-abonnement holder ett fyringstidspunkt (`storage.setAlarm`) og sender en
tom, VAPID-signert Web Push når tiden er inne. `sw.js` i appen viser selve
notifikasjonen, så pushen trenger ingen payload (og dermed ingen
payload-kryptering).

## Oppsett (én gang)

1. **Generer VAPID-nøkkelpar** (krever Node 20+):

   ```bash
   node -e "crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign']).then(async k=>{console.log('PUBLIC :',Buffer.from(await crypto.subtle.exportKey('raw',k.publicKey)).toString('base64url'));console.log('PRIVATE:',JSON.stringify(await crypto.subtle.exportKey('jwk',k.privateKey)))})"
   ```

2. **Lim inn offentlig nøkkel** (PUBLIC-linjen) i `VAPID_PUBLIC_KEY` i
   `wrangler.toml` her, og i `VAPID_PUBLIC_KEY`-konstanten i `index.html`.

3. **Lagre privat nøkkel som secret** (PRIVATE-linjen, hele JSON-strengen).
   Den skal aldri sjekkes inn:

   ```bash
   cd push-server
   npx wrangler secret put VAPID_PRIVATE_JWK
   ```

4. **Deploy** (logger inn i Cloudflare første gang):

   ```bash
   npx wrangler deploy
   ```

5. **Lim inn worker-URL-en** fra deploy-outputen (f.eks.
   `https://eltefritt-push.<konto>.workers.dev`) i `PUSH_SERVER`-konstanten i
   `index.html`, og deploy appen som vanlig.

## Verifisere

Slå på alarmen i appen med kort hevetid, lukk appen/fanen helt, og vent til
tidspunktet: systemvarselet skal komme likevel. På iOS må appen være lagt til
på hjemskjermen (iOS 16.4+).

## API

- `POST /schedule` — `{ subscription: <PushSubscription.toJSON()>, fireAtMs }`.
  Samme endepunkt overskriver forrige tidspunkt (retargeting fra
  "Juster underveis" er bare en ny /schedule).
- `POST /cancel` — `{ endpoint }`. Sletter abonnementets lagring og alarm.

Begge er CORS-låst til `ALLOWED_ORIGIN`. Ingen kontoer, ingen persondata:
serveren lagrer kun push-endepunktet (en anonym URL hos nettleserens
push-tjeneste) og ett tidspunkt, og sletter alt når pushen er sendt.
