# Web Push sendes uten payload

Pushen fra push-serveren er tom: den er bare en VAPID-autorisert POST til
push-endepunktet, uten kryptert innhold. Service workeren i appen viser en
statisk notifikasjonstekst når den vekkes.

Uten payload trengs ingen aes128gcm-kryptering, og da trengs heller ingen
ECDH, HKDF eller AES-GCM-implementasjon. WebCrypto dekker ES256-signeringen
av VAPID-JWT-en alene, så push-serveren er en Cloudflare Worker helt uten
avhengigheter og uten byggesteg.

## Konsekvenser

- Notifikasjonsteksten må ligge i `sw.js`, duplisert fra `src/i18n.js`. De to
  må holdes i synk manuelt.
- Service workeren kan ikke lese `localStorage`, så språkvalget speiles til en
  cache appen skriver ved oppstart og språkbytte. Er den tom, faller varselet
  tilbake til norsk.
- Pushen kan ikke bære noe som varierer med baken (klokkeslett, hevemetode,
  hvilket steg som er neste). Skal den det, må denne beslutningen omgjøres, og
  da kommer krypteringen tilbake.
- Alarmen i åpen fane er fortsatt den primære varslingen; pushen er backup for
  når appen er lukket. Den tomme pushen er derfor et lite tap.
