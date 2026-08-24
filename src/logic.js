'use strict';

// Rene helpers ekstrahert fra index.html slik at de kan enhetstestes.
// Lastes i nettleseren som vanlig <script> (eksponerer window.EltefrittLogic);
// importeres i tester via Node's require/import (module.exports = api).
//
// Funksjoner tar all data de trenger som argumenter (ingen closures over
// `state`), så tester kan sende inn små fixtures.

(function (globalScope) {
  const REF_TEMP = 21;
  // Steking: 30 min med lokk + ~15 min uten. Matcher "~45 min" i instruksjonene.
  const BAKE_MIN = 45;

  // Etterheving (andreheving) i klassisk modus, etter forming og før steking.
  // Laheys originaloppskrift bruker ~2 t; vi velger 1,5 t som representativt
  // midtsjikt og beskriver 1–2 t i instruksjonene. Tidligere var dette
  // hardkodet til 45 min, som er i knappeste laget for en no-knead-deig.
  const SECOND_PROOF_HOURS = 1.5;

  // Newtons avkjøling: en typisk eltefritt-deig (500–1000 g) i tildekket
  // bolle ved romtemp har en tidskonstant tau ≈ 2–4 t. Vi velger 2,5 t som
  // grovt midtsjikt; tallet er ikke målt, og varierer mye med deigstørrelse,
  // bolle, lokk, og om deigen står i trekk eller en lun krok.
  const COOLING_TAU_HOURS = 2.5;

  // Samme prinsipp i kjøleskapet: en romtemperert deig kjøler ikke momentant
  // ned til kjøleskapstemp. En deig på 500–1000 g bruker typisk noen timer på
  // å nå kjernetemp i kjøleskap, og det skjer en god del gjæring underveis.
  // tau er noe lengre enn ved romtemp pga. mindre konveksjon i kjøleskapet.
  const COLD_COOLING_TAU_HOURS = 3;

  // Spesifikk varmekapasitet (J/g/K). Tørt mel ≈ 1,7; vann 4,18. Brukes til
  // å vekte starttemperaturen i deigen basert på mel:vann-forholdet.
  const FLOUR_HEAT_CAPACITY = 1.7;
  const WATER_HEAT_CAPACITY = 4.18;

  // ---- Meltyper med anbefalt hydreringsområde ----
  // Hydrering er alltid et område, ikke ett tall (mølle, sesong og malingsgrad
  // varierer), og brukeren kan overstyre. Verdiene er forankret slik:
  //
  //  - Hvete er basislinjen: 70–75 % er vanlig for no-knead (Lahey ~75 %,
  //    King Arthur testet brødmel godt opp mot 80 %).
  //  - Sammalt hvete trenger 5–10 % mer vann enn hvit fordi kli suger vann
  //    (King Arthur; flourwise). → 75–82 %. "Fin" sammalt ligger mellom hvit
  //    og full sammalt → 73–78 %.
  //  - Rug er svært vannsugende og trenger 10–15 % mer enn hvit (King Arthur;
  //    flourwise). Blandbart rugmel 80–88 %, sammalt/helkorns rug høyere,
  //    85–92 %. (Rene rugbrød kan gå 95–100 %+, men det er en egen stil.)
  //  - Spelt har svakere gluten og tar ~5 % mindre vann enn hvete; 65–72 %
  //    er et trygt utgangspunkt (The Fresh Loaf; Cook Geeks).
  //  - Durum suger ~2 % mer enn brødmel men gir fast deig; 65–72 % er
  //    arbeidbart (sourdoughhydration.com; pane di Altamura ~60 %).
  //  - Havre og bygg har lite gluten; tallene er avledet fra helkorns-
  //    prinsippet (kli suger vann) snarere enn en egen sitert kilde.
  //
  // Kilder: se README og src/logic.js-kommentarer.
  //
  // Visningsnavn ligger i src/i18n.js (nøkkel 'flour.<type>'); her bare tall.
  const FLOUR_TYPES = {
    hvete:      { hydrationMin: 70, hydrationMax: 75 },
    sammalt:    { hydrationMin: 75, hydrationMax: 82 },
    sammaltfin: { hydrationMin: 73, hydrationMax: 78 },
    rug:        { hydrationMin: 80, hydrationMax: 88 },
    sammaltrug: { hydrationMin: 85, hydrationMax: 92 },
    spelt:      { hydrationMin: 65, hydrationMax: 72 },
    durum:      { hydrationMin: 65, hydrationMax: 72 },
    havre:      { hydrationMin: 72, hydrationMax: 78 },
    bygg:       { hydrationMin: 72, hydrationMax: 78 }
  };

  // Meltyper som hever dårlig uten surdeig / mangler gluten.
  const RYE_TYPES = new Set(['rug', 'sammaltrug']);
  const LOW_GLUTEN_TYPES = new Set(['havre', 'bygg']);

  // Heveform- og hevemetode-detaljer er nå deskriptorer (i18n-nøkler); render-
  // laget slår opp og fyller inn evt. params. Celsius-verdier markeres som
  // { celsius: N } slik at visningen kan konvertere til valgt enhet.
  const LEAVEN_DETAILS = {
    dry:       { key: 'leaven.detail.dry', params: { temp: { celsius: REF_TEMP } } },
    fresh:     { key: 'leaven.detail.fresh' },
    sourdough: { key: 'leaven.detail.sourdough' }
  };

  const MODE_META = {
    classic: {
      labelKey: 'mode.classic.label',
      detailKey: 'mode.classic.detail',
      controlsId: 'classic-controls'
    },
    cold: {
      labelKey: 'mode.cold.label',
      detailKey: 'mode.cold.detail',
      controlsId: 'cold-controls'
    }
  };

  // Stekekonstanter (recipe-faste; visningen konverterer til °F ved behov).
  const BAKE_POT_TEMP_C = 245;
  const BAKE_LID_OFF_TEMP_C = 220;
  const BAKE_PAN_TEMP_C = 220;

  // ---- Date-helpers (rene) ----
  const addMinutes = (d, m) => new Date(d.getTime() + m * 60 * 1000);
  const addHours = (d, h) => addMinutes(d, h * 60);

  // ---- Fermenteringshastighet vs. temperatur ----
  // Over ~10 °C følger gjæraktiviteten Q10 ≈ 2 (dobling per 10 °C), som alle
  // referansepunktene i appen er kalibrert mot (21 °C og oppover). Under
  // ~10 °C faller aktiviteten brattere enn Q10 tilsier, og gjæren er nær
  // dvale ved kjøleskapstemp: The Sourdough Journey finner at det skjer lite
  // gjæring etter at deigen har nådd ~4 °C — nesten alt skjer i nedkjølings-
  // fasen. Lavtemp-delen modelleres derfor med Ratkowsky-formen
  // rate ∝ (T − Tmin)² (standard i næringsmiddelmikrobiologi; Tmin for
  // S. cerevisiae ligger rundt 0–3 °C, vi bruker 1 °C), skjøtt kontinuerlig
  // mot Q10-kurven i kneet ved 10 °C.
  const LOW_TEMP_KNEE_C = 10;
  const FERMENT_MIN_TEMP_C = 1;

  function fermentationFactor(tempC) {
    if (tempC >= LOW_TEMP_KNEE_C) return Math.pow(2, (tempC - REF_TEMP) / 10);
    if (tempC <= FERMENT_MIN_TEMP_C) return 0;
    const kneeFactor = Math.pow(2, (LOW_TEMP_KNEE_C - REF_TEMP) / 10);
    const x = (tempC - FERMENT_MIN_TEMP_C) / (LOW_TEMP_KNEE_C - FERMENT_MIN_TEMP_C);
    return kneeFactor * x * x;
  }

  // ---- Calculations ----
  function weightedHydration(flours) {
    let sumMin = 0, sumMax = 0, total = 0;
    flours.forEach(f => {
      const ft = FLOUR_TYPES[f.type];
      if (!ft) return;
      sumMin += ft.hydrationMin * f.pct;
      sumMax += ft.hydrationMax * f.pct;
      total += f.pct;
    });
    if (total === 0) return { min: 75, max: 75 };
    return { min: sumMin / total, max: sumMax / total };
  }

  // Referanse: 0.23 % instant tørrgjær gir ~14 t god heving ved 21 °C.
  function calculateYeast(flourGrams, effectiveHours) {
    const refYeastPct = 0.23;
    const refHours = 14;
    const yeastPct = refYeastPct * refHours / Math.max(effectiveHours, 0.1);
    return { grams: (yeastPct / 100) * flourGrams, pct: yeastPct };
  }

  // Surdeig: kobling mellom inokulering, bulkheving og temperatur.
  // Referansepunkt 20 % levain @ 21 °C ≈ 11 t bulk til ~70–75 % heving, basert
  // på The Sourdough Journey sine bulk-tabeller (ved 21 °C tar bulken typisk
  // 11–12 t med en sunn starter på 15–20 %). Tidligere brukte vi 6 t, som var
  // for kort for romtemp. Starter-styrke varierer fortsatt ±25 %, så dette er
  // veiledende. Inokulering × bulk-tid er omvendt proporsjonalt, og produktet
  // skalerer med fermentationFactor (Q10 ≈ 2 over 10 °C, brattere fall under).
  //
  // I kald modus bidrar også kjøleskapsfasen med gjæring (deigen er varm en
  // stund mens den kjøler ned). Begge funksjonene tar derfor en valgfri
  // coldEffectiveHours (21°-ekvivalente timer fra effectiveColdHours) som
  // trekkes fra/legges til bulk-målet, slik at anbefalingen gjelder summen
  // av bulk + kjøleskapsfase, ikke bulk alene.
  const SOUR_BASE_BULK = 11;
  const SOUR_BASE_INOC = 20;

  function recommendedSourBulkHours(inoculation, temperatureC, coldEffectiveHours = 0) {
    if (inoculation <= 0) return SOUR_BASE_BULK;
    const targetEffective = SOUR_BASE_BULK * (SOUR_BASE_INOC / inoculation);
    const remainingEffective = Math.max(0, targetEffective - coldEffectiveHours);
    return remainingEffective / fermentationFactor(temperatureC);
  }

  function recommendedSourInoculation(bulkHours, temperatureC, coldEffectiveHours = 0) {
    const bulkEffective = Math.max(0, bulkHours) * fermentationFactor(temperatureC);
    const totalEffective = bulkEffective + coldEffectiveHours;
    if (totalEffective <= 0) return SOUR_BASE_INOC;
    return SOUR_BASE_INOC * (SOUR_BASE_BULK / totalEffective);
  }

  // Starttemperatur i deigen rett etter blanding, vektet etter varmekapasitet.
  // Antar at melet ligger ved romtemp; vannet er det vi varierer.
  function initialDoughTempC(waterTempC, flourTempC, hydrationPct) {
    const flourCap = FLOUR_HEAT_CAPACITY;
    const waterCap = (hydrationPct / 100) * WATER_HEAT_CAPACITY;
    return (flourCap * flourTempC + waterCap * waterTempC) / (flourCap + waterCap);
  }

  // 21°C-ekvivalente timer for en fase der deigen starter ved en annen temp
  // enn omgivelsene og konvergerer mot dem via Newtons avkjøling. Vi integrerer
  // fermenteringsfaktoren numerisk mens deigtemperaturen glir fra startTempC
  // mot ambientC med tidskonstant tau. Brukes både for romtemp-bulk (vann
  // varmere/kjøligere enn rommet) og for kald etterheving (varm deig som
  // kjøler ned).
  function effectivePhaseHours(hours, ambientC, startTempC, tau) {
    const baseFactor = fermentationFactor(ambientC);
    const dT = startTempC - ambientC;
    if (Math.abs(dT) < 0.05 || hours <= 0) {
      return hours * baseFactor;
    }
    // Midpoint-regel med 240 steg er rikelig nøyaktig for et glatt integrand.
    const N = 240;
    const dt = hours / N;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) * dt;
      const T = ambientC + dT * Math.exp(-t / tau);
      sum += fermentationFactor(T);
    }
    return sum * dt;
  }

  // Romtemp-bulk: deigen starter på blandetemperaturen (vektet vann/mel) og
  // konvergerer mot romtemp.
  function effectiveBulkHours(bulkHours, roomTempC, waterTempC, hydrationPct) {
    const T0 = initialDoughTempC(waterTempC, roomTempC, hydrationPct);
    return effectivePhaseHours(bulkHours, roomTempC, T0, COOLING_TAU_HOURS);
  }

  // Kald etterheving: en romtemperert deig (etter bulk) som kjøler mot
  // kjøleskapstemp. Modellerer gjæringen som skjer mens deigen fortsatt er varm.
  function effectiveColdHours(coldHours, coldTempC, startTempC) {
    return effectivePhaseHours(coldHours, coldTempC, startTempC, COLD_COOLING_TAU_HOURS);
  }

  // ---- Juster underveis ----
  // Planen "riseHours ved temperatureC" er egentlig et budsjett av 21°-
  // ekvivalente timer (samme budsjett gjærmengden ble regnet fra). Har deigen
  // i stedet stått elapsedHours ved actualTempC, er forbruket et annet.
  // Returnerer gjenstående klokketimer ved actualTempC; negativ verdi betyr
  // at deigen er over budsjett. Gjelder klassisk modus (riseHours).
  function adjustedBulkRemainingHours(state, elapsedHours, actualTempC) {
    const waterTempC = state.waterTempC != null ? state.waterTempC : state.temperatureC;
    const hydration = state.hydration != null ? state.hydration : 75;
    const budget = effectiveBulkHours(state.riseHours, state.temperatureC, waterTempC, hydration);
    const consumed = effectiveBulkHours(Math.max(0, elapsedHours), actualTempC, waterTempC, hydration);
    return (budget - consumed) / fermentationFactor(actualTempC);
  }

  // Justert slutt på bulkhevingen når "faktisk temp så langt" er satt (kun
  // klassisk modus, mens hevingen pågår). null = ingen justering aktiv. Målet
  // regnes fra nå + gjenstående budsjett; ved konstant temp er det stabilt
  // mellom oppdateringer (avrundet til hele minutter mot smådrift). Kan ligge
  // i fortid når deigen er over budsjett.
  function adjustedRiseDoneMs(state, nowMs) {
    if (state.mode !== 'classic' || state.actualTempC == null) return null;
    if (!state.alarm || state.anchorDateMs == null) return null;
    const elapsedH = (nowMs - state.anchorDateMs) / 3600000;
    if (elapsedH <= 0) return null;
    const remainingH = adjustedBulkRemainingHours(state, elapsedH, state.actualTempC);
    return Math.round((nowMs + remainingH * 3600000) / 60000) * 60000;
  }

  // 21°C-ekvivalente timer for gjærberegning (Q10 ≈ 2).
  function modeEffectiveHours(state) {
    const waterTempC = state.waterTempC != null ? state.waterTempC : state.temperatureC;
    const hydration = state.hydration != null ? state.hydration : 75;
    // Andrehevingen skjer ved romtemp etter at deigen har equilibrert, så den
    // bidrar med SECOND_PROOF_HOURS skalert med romtempfaktoren.
    const secondProofFactor = fermentationFactor(state.temperatureC);
    if (state.mode === 'classic') {
      const bulk = effectiveBulkHours(state.riseHours, state.temperatureC, waterTempC, hydration);
      return bulk + SECOND_PROOF_HOURS * secondProofFactor;
    }
    if (state.mode === 'cold') {
      const bulk = effectiveBulkHours(state.bulkHours, state.temperatureC, waterTempC, hydration);
      // Deigen går inn i kjøleskapet på romtemp og kjøler ned underveis.
      const cold = effectiveColdHours(state.coldHours, state.coldTempC, state.temperatureC);
      return bulk + cold;
    }
    return 0;
  }

  function modeTotalMinutes(state) {
    if (state.mode === 'classic') return state.riseHours * 60 + SECOND_PROOF_HOURS * 60 + BAKE_MIN;
    if (state.mode === 'cold') return state.bulkHours * 60 + state.coldHours * 60 + BAKE_MIN;
    return 0;
  }

  // Minutter fra start til selve hevingen er ferdig og deigen er klar for
  // neste aktive steg (grunnlaget for nedtelling/alarm). Klassisk: slutten av
  // bulkhevingen (da former du deigen). Kald: slutten av kald etterheving (da
  // skal brødet i ovnen). Ekskluderer alltid steketiden.
  function riseDoneMinutes(state) {
    if (state.mode === 'classic') return state.riseHours * 60;
    if (state.mode === 'cold') return (state.bulkHours + state.coldHours) * 60;
    return 0;
  }

  // Returnerer deskriptorer; render-laget formaterer tall/temp/locale.
  // duration: { kind, key, params? }; step: { kind, labelKey, time }.
  function modePlanItems(state, start) {
    if (state.mode === 'classic') {
      const shape = addHours(start, state.riseHours);
      const bake = addHours(shape, SECOND_PROOF_HOURS);
      return [
        { kind: 'duration', key: 'plan.bulk', params: { hours: state.riseHours, temp: { celsius: state.temperatureC } } },
        { kind: 'step', labelKey: 'plan.shapeClassic', time: shape },
        { kind: 'duration', key: 'plan.secondProof', params: { hours: SECOND_PROOF_HOURS } },
        { kind: 'step', labelKey: 'plan.intoOven', time: bake },
        { kind: 'duration', key: 'plan.bake' }
      ];
    }
    // cold
    const shape = addHours(start, state.bulkHours);
    const bake = addHours(shape, state.coldHours);
    return [
      { kind: 'duration', key: 'plan.bulk', params: { hours: state.bulkHours, temp: { celsius: state.temperatureC } } },
      { kind: 'step', labelKey: 'plan.shapeCold', time: shape },
      { kind: 'duration', key: 'plan.cold', params: { hours: state.coldHours, temp: { celsius: state.coldTempC } } },
      { kind: 'step', labelKey: 'plan.intoOvenCold', time: bake },
      { kind: 'duration', key: 'plan.bake' }
    ];
  }

  // Bland-steget varierer med heveform; resten av instruksjonene er mode-spesifikke.
  // Hvert steg er en deskriptor { titleKey, bodyKey, params? }; render-laget slår
  // opp tekst og fyller inn temperatur-params (markert som { celsius: N }).
  function blandStep(leaven) {
    if (leaven === 'sourdough') {
      return { titleKey: 'step.mix.title', bodyKey: 'step.mix.body.sourdough' };
    }
    if (leaven === 'fresh') {
      return { titleKey: 'step.mix.title', bodyKey: 'step.mix.body.fresh' };
    }
    return { titleKey: 'step.mix.dryTitle', bodyKey: 'step.mix.body.dry' };
  }

  const SOURDOUGH_CHECK = { titleKey: 'step.starterCheck.title', bodyKey: 'step.starterCheck.body' };

  const BAKE_PARAMS = {
    hot: { celsius: BAKE_POT_TEMP_C },
    low: { celsius: BAKE_LID_OFF_TEMP_C },
    pan: { celsius: BAKE_PAN_TEMP_C }
  };

  function modeInstructions(state) {
    const leaven = state.leaven;
    const steps = [];
    if (leaven === 'sourdough') steps.push(SOURDOUGH_CHECK);
    steps.push(blandStep(leaven));

    if (state.mode === 'classic') {
      steps.push({
        titleKey: 'step.bulk.title',
        bodyKey: leaven === 'sourdough' ? 'step.bulk.body.classic.sourdough' : 'step.bulk.body.classic.yeast'
      });
      steps.push({ titleKey: 'step.shape.title', bodyKey: 'step.shape.body' });
      steps.push({ titleKey: 'step.bake.title', bodyKey: 'step.bake.body', params: BAKE_PARAMS });
      steps.push({
        titleKey: 'step.cool.title',
        bodyKey: leaven === 'sourdough' ? 'step.cool.body.sourdough' : 'step.cool.body.short'
      });
      return steps;
    }
    // cold
    steps.push({ titleKey: 'step.bulk.title', bodyKey: 'step.bulk.body.cold' });
    steps.push({ titleKey: 'step.shapeCold.title', bodyKey: 'step.shapeCold.body' });
    steps.push({
      titleKey: 'step.coldProof.title',
      bodyKey: leaven === 'sourdough' ? 'step.coldProof.body.sourdough' : 'step.coldProof.body.yeast'
    });
    steps.push({ titleKey: 'step.bakeCold.title', bodyKey: 'step.bakeCold.body', params: BAKE_PARAMS });
    steps.push({
      titleKey: 'step.cool.title',
      bodyKey: leaven === 'sourdough' ? 'step.cool.body.sourdoughShort' : 'step.cool.body.short'
    });
    return steps;
  }

  // Hovedberegning: tar hele state, returnerer alle mengder for oppskriften.
  function computeRecipe(state) {
    const flourTotal = state.sizePerLoaf * state.loaves;
    let hydration;
    if (state.hydrationManual) {
      hydration = state.hydration;
    } else {
      const r = weightedHydration(state.flours);
      // Avrund til heltall så oppskriften bruker nøyaktig samme verdi som
      // vises i UI-et (som viser hele prosent).
      hydration = Math.round((r.min + r.max) / 2);
    }
    const totalWater = flourTotal * (hydration / 100);
    const salt = flourTotal * 0.02;

    if (state.leaven === 'sourdough') {
      const starter = flourTotal * (state.sourInoculation / 100);
      // 100%-hydrert starter: halvparten mel, halvparten vann.
      const starterFlour = starter / 2;
      const starterWater = starter / 2;
      return {
        flourTotal,
        flourAdded: flourTotal - starterFlour,
        hydration,
        water: totalWater - starterWater,
        salt,
        starter,
        leaven: 'sourdough'
      };
    }

    const yeastInfo = calculateYeast(flourTotal, modeEffectiveHours(state));
    return {
      flourTotal,
      flourAdded: flourTotal,
      hydration,
      water: totalWater,
      salt,
      yeast: yeastInfo.grams,
      yeastPct: yeastInfo.pct,
      leaven: state.leaven
    };
  }

  function flourTips(flours) {
    // Med 3+ meltyper redigeres andelene fritt, så summen er ikke garantert 100.
    // Regn tipsene på faktiske andeler (normalisert mot summen).
    const total = flours.reduce((s, f) => s + f.pct, 0) || 1;
    const share = pred => flours.reduce((s, f) => s + (pred(f.type) ? f.pct : 0), 0) / total * 100;
    const ryePct = share(t => RYE_TYPES.has(t));
    const lowGlutenPct = share(t => LOW_GLUTEN_TYPES.has(t));
    const tips = [];
    if (ryePct > 50) {
      tips.push({ key: 'tip.rye' });
    }
    if (lowGlutenPct > 30) {
      tips.push({ key: 'tip.lowGluten' });
    }
    return tips;
  }

  const api = {
    REF_TEMP, BAKE_MIN, SECOND_PROOF_HOURS,
    COOLING_TAU_HOURS, COLD_COOLING_TAU_HOURS,
    FLOUR_HEAT_CAPACITY, WATER_HEAT_CAPACITY,
    LOW_TEMP_KNEE_C, FERMENT_MIN_TEMP_C, fermentationFactor,
    FLOUR_TYPES, RYE_TYPES, LOW_GLUTEN_TYPES,
    LEAVEN_DETAILS, MODE_META,
    addMinutes, addHours,
    weightedHydration, calculateYeast,
    initialDoughTempC, effectivePhaseHours, effectiveBulkHours, effectiveColdHours,
    adjustedBulkRemainingHours, adjustedRiseDoneMs,
    recommendedSourBulkHours, recommendedSourInoculation,
    modeEffectiveHours, modeTotalMinutes, riseDoneMinutes,
    modePlanItems, modeInstructions,
    blandStep,
    computeRecipe, flourTips
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.EltefrittLogic = api;
})(typeof window !== 'undefined' ? window : null);
