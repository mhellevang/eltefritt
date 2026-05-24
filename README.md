# Eltefritt

Kalkulator for eltefritt brød. Finn riktige mengder og en bakplan tilpasset ditt brød og din dag.

**🍞 Live:** <https://mhellevang.github.io/eltefritt/>

Eltefritt er no-knead-metoden gjort kjent av Jim Lahey: lang heving erstatter eltingen, og stekingen skjer i jerngryte med lokk for å fange dampen. Appen støtter både klassisk lang heving og kald etterheving i banneton, og lar deg velge mellom tørrgjær, ferskgjær og surdeig som heveform.

## Funksjoner

- Mengder for 1–4 brød, med tre presetstørrelser (Lite 400 g, Medium 500 g, Stort 700 g) eller egen melvekt
- Utstyrsanbefaling (jerngryte og brødform) tilpasset melvekt
- Flere meltyper samtidig med auto-balansert prosent og vektet hydreringsanbefaling (område, ikke ett tall)
- To hevemetoder: klassisk lang bulk, eller kort bulk + kald etterheving i banneton
- Tre heveformer: tørrgjær, ferskgjær eller surdeig (aktiv 100%-hydrert starter)
- Bakplan med toveis editerbare Start- og Klar-tidspunkter
- Tema lys, mørk eller automatisk (følger systemvalg)
- Innstillinger lagres i nettleseren mellom besøk
- Fungerer offline som PWA, installerbar via Hjem-skjerm (mobil) eller nettleserens installer-knapp (desktop)

## Bakerens formel

```
Vann    = mel × hydrering %
Salt    = mel × 2 %
Gjær    = 0,23 % × (14 t / effektive timer)   ← tørrgjær eller ferskgjær
Surdeig = mel × inokulering %                 ← surdeig

Effektive timer = Σ fase_time × 2^((T - 21°C) / 10)
```

Referansepunktet er 0,23 % tørrgjær for 14 timers heving ved 21 °C. Ferskgjær ≈ tørrgjær × 3. Med surdeig antas 100%-hydrert starter; halvparten av starter-vekten regnes som mel og halvparten som vann, og trekkes fra de mengdene du blander inn.

## Kjør lokalt

Åpne `index.html` direkte i en nettleser. For å teste service worker og PWA-funksjoner må filene serveres over HTTP:

```
python3 -m http.server    # eller: npx serve
```

## Struktur

- `index.html`: hele UI-et, inline CSS og scripts
- `src/logic.js`: rene helpers (matte, tabeller, modes) som lastes i nettleser og brukes av tester
- `tests/`: `node --test`-baserte enhets- og DOM-tester
- `sw.js`: service worker for PWA
- `manifest.webmanifest`: PWA-manifest

## Tester

```
npm install   # installerer jsdom (eneste devDep)
npm test      # kjører alle tester
```

Logikk-tester går mot `src/logic.js`. DOM-tester laster `index.html` inn i jsdom og asserter på computed styles, slik at vi fanger CSS-feller som ren enhetstest ville glipt.
