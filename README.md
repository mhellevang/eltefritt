# Eltefritt

Kalkulator for eltefritt brød. Finn riktige mengder og en bakplan tilpasset ditt brød og din dag.

**🍞 Live:** <https://eltefritt.helledb.dev>

Eltefritt er no-knead-metoden gjort kjent av Jim Lahey: lang heving erstatter eltingen, og stekingen skjer i jerngryte med lokk for å fange dampen. Appen støtter både klassisk lang heving og kald etterheving i banneton, og lar deg velge mellom tørrgjær, ferskgjær og surdeig som heveform.

## Funksjoner

- Mengder for 1–4 brød, med tre presetstørrelser (Lite 400 g, Medium 500 g, Stort 700 g) eller egen melvekt
- Utstyrsanbefaling (jerngryte og brødform) tilpasset melvekt
- Flere meltyper samtidig: to typer auto-balanseres (den andre følger), tre+ justeres fritt med sum-indikator. Vektet hydreringsanbefaling (område, ikke ett tall)
- To hevemetoder: klassisk lang bulk, eller kort bulk + kald etterheving i banneton
- Tre heveformer: tørrgjær, ferskgjær eller surdeig (aktiv 100%-hydrert starter)
- Bakplan med toveis editerbare Start- og Klar-tidspunkter
- Norsk og engelsk, gjettet fra nettleserens språk ved første besøk (kan overstyres)
- Temperatur i °C eller °F, gjettet fra region (°F for USA m.fl., ellers °C); modellen regner alltid i Celsius, kun visningen konverterer
- Samlet innstillingsmeny (tannhjul): språk, temperaturenhet og tema (lys/mørk/automatisk)
- Valg av språk, enhet og tema lagres i nettleseren mellom besøk
- Fungerer offline som PWA, installerbar via Hjem-skjerm (mobil) eller nettleserens installer-knapp (desktop)

## Bakerens formel

```
Vann    = mel × hydrering %
Salt    = mel × 2 %
Gjær    = 0,23 % × (14 t / effektive timer)   ← tørrgjær eller ferskgjær
Surdeig = mel × inokulering %                 ← surdeig

Effektive timer = Σ fase_time × 2^((T - 21°C) / 10)   ← over ~10 °C
```

Referansepunktet er 0,23 % tørrgjær for 14 timers heving ved 21 °C. Ferskgjær ≈ tørrgjær × 3. Med surdeig antas 100%-hydrert starter; halvparten av starter-vekten regnes som mel og halvparten som vann, og trekkes fra de mengdene du blander inn.

Effektive timer er litt mer nyansert enn formelen over antyder: når vannet er varmere eller kjøligere enn rommet integreres temperaturfaktoren mens deigtemperaturen glir mot romtemp via Newtons avkjøling (vektet etter mel/vann sin varmekapasitet). I kald modus modelleres på samme måte at en romtemperert deig fortsetter å gjære mens den kjøler ned i kjøleskapet. Klassisk modus regner med en andreheving på ~1,5 t i tillegg til bulken.

Under ~10 °C faller gjæraktiviteten brattere enn Q10 ≈ 2 tilsier: der brukes Ratkowsky-formen rate ∝ (T − 1 °C)², skjøtt kontinuerlig mot Q10-kurven ved 10 °C, slik at gjæren er nær dvale ved kjøleskapstemp. Dette matcher [The Sourdough Journeys](https://thesourdoughjourney.com/) observasjon om at nesten all kjøleskapsgjæring skjer i nedkjølingsfasen.

### Surdeig-anker

20 % levain ved 21 °C ≈ 11 t bulk til ~70–75 % heving, basert på [The Sourdough Journey](https://thesourdoughjourney.com/the-mystery-of-percentage-rise-in-bulk-fermentation/) sine bulk-tabeller. Inokulering × bulk-tid er omvendt proporsjonalt, og skalerer med samme temperaturfaktor som gjærberegningen. Starter-styrke varierer ±25 %, så dette er veiledende.

I kald modus teller også kjøleskapsfasen med: dens 21°-ekvivalente timer (fra samme Newtons avkjøling-modell som gjærberegningen) trekkes fra bulk-målet, slik at anbefalt bulk + kald etterheving til sammen treffer ankeret. Kan ikke slideren nå anbefalingen, vises et hint i stedet for at verdien klampes stille.

### Hydreringsområder

Hydrering er alltid et område, ikke ett tall. Verdiene i `src/logic.js` er forankret slik:

- Hvete er basislinjen (70–75 %, vanlig for no-knead; [King Arthur](https://www.kingarthurbaking.com/blog/2023/01/11/bread-hydration) testet brødmel godt opp mot 80 %).
- Sammalt hvete trenger 5–10 % mer vann fordi kli suger vann ([King Arthur](https://www.kingarthurbaking.com/blog/2023/01/11/bread-hydration); [flourwise](https://flourwise.com/blog/bread-hydration-chart/)) → 75–82 %.
- Rug er svært vannsugende, 10–15 % mer enn hvit → 80–88 %; sammalt rug høyere, 85–92 %.
- Spelt har svakere gluten og tar ~5 % mindre vann → 65–72 % ([The Fresh Loaf](https://www.thefreshloaf.com/node/21548/hydration-speltwholewheat-sourdough)).
- Durum suger ~2 % mer enn brødmel men gir fast deig → 65–72 % ([sourdoughhydration.com](https://sourdoughhydration.com/flour/durum-semolina)).
- Havre og bygg har lite gluten; tallene er avledet fra helkorns-prinsippet, ikke en egen sitert kilde.

## Kjør lokalt

Åpne `index.html` direkte i en nettleser. For å teste service worker og PWA-funksjoner må filene serveres over HTTP:

```
python3 -m http.server    # eller: npx serve
```

## Struktur

- `index.html`: hele UI-et, inline CSS og scripts
- `src/logic.js`: rene helpers (matte, tabeller, modes) som lastes i nettleser og brukes av tester
- `src/plantilstand.js`: standardverdier, gyldige områder og gjenoppretting av lagret state. Feltbordet `FIELDS` er eneste kopi av hvert område; sliderne i `index.html` arver `min`/`max` derfra
- `src/visning.js`: utleder hva siden skal si som verdier (deskriptorer, ikke ferdig tekst). `index.html` har én applier som skriver dem ut
- `src/varsling.js`: alarm-tilstandsmaskinen (armering, fyring, gjentakelse, push-forsoning). Tar alle nettleser-effekter inn som en injisert adapter, så den kan testes med falsk klokke
- `tests/`: `node --test`-baserte enhets- og DOM-tester
- `sw.js`: service worker for PWA
- `manifest.webmanifest`: PWA-manifest

## Tester

```
npm install   # installerer jsdom (eneste devDep)
npm test      # kjører alle tester
```

Logikk-tester går mot `src/logic.js`, `src/plantilstand.js`, `src/visning.js` og `src/varsling.js`. DOM-tester laster `index.html` inn i jsdom og asserter på computed styles, slik at vi fanger CSS-feller som ren enhetstest ville glipt.
