# Eltefritt

Kalkulator for eltefritt brød. Finn riktige mengder og en bakplan tilpasset ditt brød og din dag.

**🍞 Live:** <https://mhellevang.github.io/eltefritt/>

Basert på Jim Lahey-metoden, med støtte for både klassisk lang heving og kald etterheving i banneton. Velger fritt mellom tørrgjær, ferskgjær og surdeig som heveform.

## Funksjoner

- Mengder for 1–4 brød i tre størrelser, med utstyrsanbefaling
- Flere meltyper samtidig med auto-balansert prosent og vektet hydreringsanbefaling (område, ikke ett tall)
- To hevemetoder: klassisk lang bulk, eller kort bulk + kald etterheving i banneton
- Tre heveformer: tørrgjær, ferskgjær eller surdeig (aktiv 100%-hydrert starter)
- Bakplan med toveis editerbare Start- og Klar-tidspunkter

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

Åpne `index.html` i en nettleser.

## Struktur

- `index.html`: hele UI-et, inline CSS og scripts
- `src/logic.js`: rene helpers (matte, tabeller, modes) som lastes i nettleser og brukes av tester
- `tests/`: `node --test`-baserte enhets- og DOM-tester
- `sw.js`: service worker for PWA

## Tester

```
npm install   # installerer jsdom (eneste devDep)
npm test      # kjører alle tester
```

Logikk-tester går mot `src/logic.js`. DOM-tester laster `index.html` inn i jsdom og asserter på computed styles, slik at vi fanger CSS-feller som ren enhetstest ville glipt.
