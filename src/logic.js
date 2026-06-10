'use strict';

// Rene helpers ekstrahert fra index.html slik at de kan enhetstestes.
// Lastes i nettleseren som vanlig <script> (eksponerer window.EltefrittLogic);
// importeres i tester via Node's require/import (module.exports = api).
//
// Funksjoner tar all data de trenger som argumenter (ingen closures over
// `state`), så tester kan sende inn små fixtures.

(function (globalScope) {
  const REF_TEMP = 21;
  const BAKE_MIN = 50;

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
  const FLOUR_TYPES = {
    hvete:      { name: 'Hvetemel',          hydrationMin: 70, hydrationMax: 75 },
    sammalt:    { name: 'Sammalt hvete',     hydrationMin: 75, hydrationMax: 82 },
    sammaltfin: { name: 'Sammalt hvete, fin',hydrationMin: 73, hydrationMax: 78 },
    rug:        { name: 'Rugmel',            hydrationMin: 80, hydrationMax: 88 },
    sammaltrug: { name: 'Sammalt rug',       hydrationMin: 85, hydrationMax: 92 },
    spelt:      { name: 'Speltmel',          hydrationMin: 65, hydrationMax: 72 },
    durum:      { name: 'Durumhvete',        hydrationMin: 65, hydrationMax: 72 },
    havre:      { name: 'Havremel',          hydrationMin: 72, hydrationMax: 78 },
    bygg:       { name: 'Byggmel',           hydrationMin: 72, hydrationMax: 78 }
  };

  // Meltyper som hever dårlig uten surdeig / mangler gluten.
  const RYE_TYPES = new Set(['rug', 'sammaltrug']);
  const LOW_GLUTEN_TYPES = new Set(['havre', 'bygg']);

  const LEAVEN_DETAILS = {
    dry: 'Standard. 0,23% gir 14 t god heving ved 21 °C.',
    fresh: '≈ 3× tørrgjær, smuldres direkte i vannet.',
    sourdough: 'Aktiv 100%-hydrert starter. Krever erfaring med starter-styrke; tider er omtrentlige.'
  };

  const MODE_META = {
    classic: {
      label: 'Klassisk',
      detail: 'Lang bulkheving + kort etterheving før steking.',
      controlsId: 'classic-controls'
    },
    cold: {
      label: 'Kald etterheving',
      detail: 'Kort bulk + lang etterheving i kjøleskap (banneton-vennlig).',
      controlsId: 'cold-controls'
    }
  };

  // ---- Date-helpers (rene) ----
  const addMinutes = (d, m) => new Date(d.getTime() + m * 60 * 1000);
  const addHours = (d, h) => addMinutes(d, h * 60);

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
  // skalerer med Q10 ≈ 2.
  const SOUR_BASE_BULK = 11;
  const SOUR_BASE_INOC = 20;

  function recommendedSourBulkHours(inoculation, temperatureC) {
    if (inoculation <= 0) return SOUR_BASE_BULK;
    const tempFactor = Math.pow(2, (REF_TEMP - temperatureC) / 10);
    return SOUR_BASE_BULK * (SOUR_BASE_INOC / inoculation) * tempFactor;
  }

  function recommendedSourInoculation(bulkHours, temperatureC) {
    if (bulkHours <= 0) return SOUR_BASE_INOC;
    const tempFactor = Math.pow(2, (REF_TEMP - temperatureC) / 10);
    return SOUR_BASE_INOC * (SOUR_BASE_BULK / bulkHours) * tempFactor;
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
  // Q10≈2-faktoren numerisk mens deigtemperaturen glir fra startTempC mot
  // ambientC med tidskonstant tau. Brukes både for romtemp-bulk (vann varmere/
  // kjøligere enn rommet) og for kald etterheving (varm deig som kjøler ned).
  function effectivePhaseHours(hours, ambientC, startTempC, tau) {
    const baseFactor = Math.pow(2, (ambientC - REF_TEMP) / 10);
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
      sum += Math.pow(2, (T - REF_TEMP) / 10);
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

  // 21°C-ekvivalente timer for gjærberegning (Q10 ≈ 2).
  function modeEffectiveHours(state) {
    const waterTempC = state.waterTempC != null ? state.waterTempC : state.temperatureC;
    const hydration = state.hydration != null ? state.hydration : 75;
    // Andrehevingen skjer ved romtemp etter at deigen har equilibrert, så den
    // bidrar med SECOND_PROOF_HOURS skalert med romtempfaktoren.
    const secondProofFactor = Math.pow(2, (state.temperatureC - REF_TEMP) / 10);
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

  function modePlanItems(state, start) {
    if (state.mode === 'classic') {
      const shape = addHours(start, state.riseHours);
      const bake = addHours(shape, SECOND_PROOF_HOURS);
      return [
        { kind: 'duration', text: `Bulkheving · ${state.riseHours} t ved ${state.temperatureC}°C` },
        { kind: 'step', label: 'Form og etterhev', time: shape },
        { kind: 'duration', text: `Etterheving · ~${String(SECOND_PROOF_HOURS).replace('.', ',')} t` },
        { kind: 'step', label: 'Inn i ovnen', time: bake },
        { kind: 'duration', text: 'Steking · ~45 min' }
      ];
    }
    // cold
    const shape = addHours(start, state.bulkHours);
    const bake = addHours(shape, state.coldHours);
    return [
      { kind: 'duration', text: `Bulkheving · ${state.bulkHours} t ved ${state.temperatureC}°C` },
      { kind: 'step', label: 'Form og legg i banneton', time: shape },
      { kind: 'duration', text: `I kjøleskap · ${state.coldHours} t ved ${state.coldTempC}°C` },
      { kind: 'step', label: 'Inn i ovnen (rett fra kjøleskap)', time: bake },
      { kind: 'duration', text: 'Steking · ~45 min' }
    ];
  }

  // Bland-steget varierer med heveform; resten av instruksjonene er mode-spesifikke.
  function blandStep(leaven) {
    if (leaven === 'sourdough') {
      return ['Bland', 'Løs opp surdeigen i vannet med fingrene. Tilsett mel og salt, og rør til en grov, klissete deig.'];
    }
    if (leaven === 'fresh') {
      return ['Bland', 'Visp sammen mel og salt i en stor bolle. Smuldre ferskgjæren i vannet og rør raskt sammen, og hell over melet. Rør til en klissete, uregelmessig deig. Ikke elt.'];
    }
    return ['Bland tørt', 'Visp sammen mel, salt og tørrgjær i en stor bolle. Hell i alt vannet og rør med slikkepott til alt er fuktet. Deigen skal være klissete og uregelmessig. Ikke elt.'];
  }

  const SOURDOUGH_CHECK = ['Sjekk starter', 'Bruk en aktiv, 100%-hydrert starter (peak ca. 4–8 t etter mating ved romtemp). Float-test: en liten klatt skal flyte i et glass vann.'];

  function modeInstructions(state) {
    const leaven = state.leaven;
    const steps = [];
    if (leaven === 'sourdough') steps.push(SOURDOUGH_CHECK);
    steps.push(blandStep(leaven));

    if (state.mode === 'classic') {
      const bulkText = leaven === 'sourdough'
        ? 'Dekk bollen. La heve ved romtemperatur. Gjør 3–4 stretch & fold første 1,5–2 t for struktur. Deigen skal være luftig og pille med bobler, 50–75% større når den er klar.'
        : 'Dekk bollen med plastfolie eller lokk. La heve ved romtemperatur til deigen er ca. dobbelt så stor og full av bobler på overflaten.';
      steps.push(['Bulkheving', bulkText]);
      steps.push(['Form', 'Vend deigen ut på godt melet benk. Brett inn fra alle kantene mot midten, snu med skjøten ned og forme til en kule. La etterheve på melet kjøkkenhåndkle eller i banneton i 1–2 t, til deigen er synlig luftigere og rundt 50 % større. Snarvei: hopp over forming og plopp deigen rett i den varme gryta etter bulk, det blir litt rustikkere men funker fint.']);
      steps.push(['Stek', 'I jerngryte: forvarm gryte med lokk til 245 °C. Vipp deigen forsiktig oppi, sett på lokket og stek 30 min. Ta av lokket, skru ned til 220 °C og stek videre ~15 min til brødet er gyllent og lyder hult når du banker på bunnen. I brødform: smør formen, hell deigen i, og stek på 220 °C i ~40 min. Sett en skål med kokende vann i bunnen av ovnen de første 15 min for sprøere skorpe.']);
      steps.push(['Avkjøl', leaven === 'sourdough'
        ? 'La avkjøle på rist i minst 1 t før du skjærer. Surdeigsbrød trenger lengre tid for å sette seg enn gjærbakt.'
        : 'La brødet avkjøle på rist i minst 30 min før du skjærer.']);
      return steps;
    }
    // cold
    steps.push(['Bulkheving', 'Dekk og la stå ved romtemperatur. Gjør gjerne 2–3 stretch & fold underveis for ekstra struktur.']);
    steps.push(['Form og legg i banneton', 'Vend ut på godt melet benk. Brett inn fra kantene mot midten og forme til en kule eller batard. Mel en banneton (gjerne med rismel) og legg deigen i med skjøtesiden opp.']);
    steps.push(['Kald etterheving', leaven === 'sourdough'
      ? 'Dekk banneton med plastpose eller dusjhette og sett i kjøleskap. 12–18 t gir god smak og enklere skåring.'
      : 'Dekk banneton med plastpose eller dusjhette og sett i kjøleskap. Lang tid gir dypere smak og enklere skåring.']);
    steps.push(['Stek direkte fra kjøleskap', 'I jerngryte: forvarm gryte med lokk til 245 °C. Vipp deigen rett fra kald banneton over på bakepapir, skår med kniv eller barberblad, og senk i den varme gryta. Lokk på, stek 30 min. Ta av lokket, skru ned til 220 °C og stek ~15 min til gyllent. I brødform: smør formen, hell deigen i (skår om ønskelig), stek på 220 °C i ~40 min. Sett en skål med kokende vann i bunnen av ovnen de første 15 min for sprøere skorpe.']);
    steps.push(['Avkjøl', leaven === 'sourdough'
      ? 'La avkjøle på rist i minst 1 t før du skjærer.'
      : 'La avkjøle på rist i minst 30 min før du skjærer.']);
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
      hydration = (r.min + r.max) / 2;
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
    const ryePct = flours.reduce((s, f) => s + (RYE_TYPES.has(f.type) ? f.pct : 0), 0);
    const lowGlutenPct = flours.reduce((s, f) => s + (LOW_GLUTEN_TYPES.has(f.type) ? f.pct : 0), 0);
    const tips = [];
    if (ryePct > 50) {
      tips.push('Rene rugbrød hever dårlig med vanlig gjær. Vurder surdeig, eller bland inn mer hvete.');
    }
    if (lowGlutenPct > 30) {
      tips.push('Havre og bygg har lite gluten. Hold andelen under 30 % for en deig som hever godt.');
    }
    return tips;
  }

  const api = {
    REF_TEMP, BAKE_MIN, SECOND_PROOF_HOURS,
    COOLING_TAU_HOURS, COLD_COOLING_TAU_HOURS,
    FLOUR_HEAT_CAPACITY, WATER_HEAT_CAPACITY,
    FLOUR_TYPES, RYE_TYPES, LOW_GLUTEN_TYPES,
    LEAVEN_DETAILS, MODE_META,
    addMinutes, addHours,
    weightedHydration, calculateYeast,
    initialDoughTempC, effectivePhaseHours, effectiveBulkHours, effectiveColdHours,
    recommendedSourBulkHours, recommendedSourInoculation,
    modeEffectiveHours, modeTotalMinutes,
    modePlanItems, modeInstructions,
    blandStep,
    computeRecipe, flourTips
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.EltefrittLogic = api;
})(typeof window !== 'undefined' ? window : null);
