# Eltefritt

Kalkulator for eltefritt brød. Finn riktige mengder og en bakplan tilpasset ditt brød og din dag.

**🍞 Live:** <https://mhellevang.github.io/eltefritt/>

Basert på Jim Lahey-metoden, med støtte for både klassisk lang heving og kald etterheving i banneton.

## Funksjoner

- Beregner mel, vann, salt og gjær for 1–4 brød i tre størrelser
- Flere meltyper samtidig (hvete, sammalt, rug, spelt, durum, havre, bygg) med auto-balansert prosent og vektet hydreringsanbefaling
- To hevemoduser:
  - **Klassisk** — lang bulkheving + kort etterheving før steking
  - **Kald etterheving** — kort bulk + lang heving i kjøleskap, banneton-vennlig
- Gjærberegning vekter hver fase mot 21°C-ekvivalente timer (Q10 ≈ 2)
- Bakplan med toveis editerbare Start- og Klar-tidspunkter
- Steg-for-steg instruksjoner tilpasset valgt hevemodus
- Utstyrsanbefaling (jerngryte/brødform-størrelse) per brødstørrelse
- Responsiv: én kolonne på mobil, to kolonner på desktop
- Tilstand lagres i `localStorage`

## Bakerens formel

```
Vann   = mel × hydrering %
Salt   = mel × 2 %
Gjær   = 0,23 % × (14 t / effektive timer)

Effektive timer = Σ fase_time × 2^((T - 21°C) / 10)
```

Referansepunktet er 0,23 % tørrgjær for 14 timers heving ved 21 °C. Fersk gjær ≈ tørrgjær × 3.

## Kjør lokalt

```sh
open index.html
```

Ingen byggesteg, ingen avhengigheter. Hele appen er én HTML-fil med inline CSS og JS.

## Legge til en ny hevemodus

All modus-spesifikk oppførsel ligger i `MODES`-tabellen i `index.html`. For å legge til f.eks. surdeig eller direktebakst:

1. Ny entry i `MODES` med `label`, `detail`, `controlsId`, `effectiveHours()`, `totalMinutes()`, `planItems(start)` og `instructions`
2. Ny `<div id="…-controls">`-blokk med tilhørende slidere
3. Ny knapp i `<div class="seg">` for hevemetode

Resten av appen oppdager den automatisk via oppslag i `MODES`.
