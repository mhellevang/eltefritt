'use strict';

// Kjøres med: node --test tests/
//
// Tester de rene hjelperne i src/logic.js. Små fixtures, tett kobling
// mellom test og oppførselen vi vil sikre, ikke implementasjon.

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/logic.js');

// ─── weightedHydration ─────────────────────────────────────────────────────

test('weightedHydration: ett mel returnerer dets eget område', () => {
  const r = L.weightedHydration([{ type: 'hvete', pct: 100 }]);
  assert.deepEqual(r, { min: 70, max: 75 });
});

test('weightedHydration: 50/50 hvete + sammalt rug snitter', () => {
  const r = L.weightedHydration([
    { type: 'hvete', pct: 50 },
    { type: 'sammaltrug', pct: 50 }
  ]);
  // hvete 70-75 + sammaltrug 85-92, halvparten av hver
  assert.equal(r.min, (70 + 85) / 2);
  assert.equal(r.max, (75 + 92) / 2);
});

test('weightedHydration: ukjent meltype ignoreres', () => {
  const r = L.weightedHydration([
    { type: 'hvete', pct: 50 },
    { type: 'finnesIkke', pct: 50 }
  ]);
  assert.deepEqual(r, { min: 70, max: 75 });
});

test('weightedHydration: tom liste gir fallback 75/75', () => {
  const r = L.weightedHydration([]);
  assert.deepEqual(r, { min: 75, max: 75 });
});

// ─── calculateYeast ────────────────────────────────────────────────────────

test('calculateYeast: 14 t @ 21°C gir referansen 0,23 %', () => {
  const r = L.calculateYeast(500, 14);
  assert.equal(r.pct, 0.23);
  assert.equal(r.grams, 500 * 0.0023);
});

test('calculateYeast: halvparten av effHours dobler gjær-prosenten', () => {
  const r = L.calculateYeast(500, 7);
  assert.equal(r.pct, 0.46);
});

test('calculateYeast: veldig kort effHours clampes for å unngå deling på null', () => {
  const r = L.calculateYeast(500, 0);
  // refYeastPct * refHours / 0.1 = 0.23 * 14 / 0.1 = 32.2
  assert.ok(Number.isFinite(r.pct));
  assert.ok(r.pct > 0);
});

// ─── fermentationFactor ────────────────────────────────────────────────────

test('fermentationFactor: følger Q10 ≈ 2 over kneet', () => {
  assert.equal(L.fermentationFactor(21), 1);
  assert.equal(L.fermentationFactor(31), 2);
  assert.equal(L.fermentationFactor(11), Math.pow(2, -1));
});

test('fermentationFactor: kontinuerlig i kneet ved 10°C', () => {
  const above = L.fermentationFactor(10);
  const below = L.fermentationFactor(10 - 1e-9);
  assert.ok(Math.abs(above - below) < 1e-6);
});

test('fermentationFactor: faller brattere enn Q10 under kneet', () => {
  // Ved 4°C sier ren Q10 ~0,31; Ratkowsky-delen skal ligge klart under.
  const q10 = Math.pow(2, (4 - 21) / 10);
  assert.ok(L.fermentationFactor(4) < q10 / 3);
});

test('fermentationFactor: null ved og under Tmin', () => {
  assert.equal(L.fermentationFactor(L.FERMENT_MIN_TEMP_C), 0);
  assert.equal(L.fermentationFactor(-5), 0);
});

test('fermentationFactor: strengt økende i kjøleskapsområdet 2–10°C', () => {
  for (let t = 2; t < 10; t++) {
    assert.ok(L.fermentationFactor(t) < L.fermentationFactor(t + 1));
  }
});

test('effectiveColdHours: kald fase domineres av nedkjølingen, ikke steady-state', () => {
  // 12 t ved 4°C fra romtemp: mesteparten av de effektive timene skal komme
  // fra de første timene (varm deig), ikke fra tiden etter equilibrering.
  const first6 = L.effectiveColdHours(6, 4, 21);
  const full12 = L.effectiveColdHours(12, 4, 21);
  assert.ok(first6 > (full12 - first6) * 3);
});

// ─── recommendedSourBulkHours / recommendedSourInoculation ────────────────

test('recommendedSourBulkHours: 20% @ 21°C = referanse 11 t', () => {
  assert.equal(L.recommendedSourBulkHours(20, 21), 11);
});

test('recommendedSourBulkHours: halv inokulering dobler bulk-tid', () => {
  assert.equal(L.recommendedSourBulkHours(10, 21), 22);
});

test('recommendedSourBulkHours: dobbel inokulering halverer bulk-tid', () => {
  assert.equal(L.recommendedSourBulkHours(40, 21), 5.5);
});

test('recommendedSourBulkHours: 10°C varmere halverer bulk-tid (Q10)', () => {
  assert.equal(L.recommendedSourBulkHours(20, 31), 5.5);
});

test('recommendedSourInoculation: 11 t @ 21°C = referanse 20%', () => {
  assert.equal(L.recommendedSourInoculation(11, 21), 20);
});

test('inokulering ↔ bulk-tid: round-trip', () => {
  const bulk = L.recommendedSourBulkHours(15, 23);
  const inoc = L.recommendedSourInoculation(bulk, 23);
  assert.ok(Math.abs(inoc - 15) < 0.001, `forventet ~15, fikk ${inoc}`);
});

test('recommendedSourBulkHours: kjøleskapsfasens effektive timer trekkes fra bulk-målet', () => {
  // 20% @ 21°C trenger 11 effektive timer totalt; bidrar kjøleskapet med 5,
  // gjenstår 6 t bulk ved romtemp (faktor 1).
  assert.equal(L.recommendedSourBulkHours(20, 21, 5), 6);
});

test('recommendedSourBulkHours: kjøleskapsbidrag større enn målet gir 0 t bulk, ikke negativt', () => {
  assert.equal(L.recommendedSourBulkHours(20, 21, 20), 0);
});

test('recommendedSourInoculation: kjøleskapsbidrag reduserer nødvendig inokulering', () => {
  const uten = L.recommendedSourInoculation(6, 21);
  const med = L.recommendedSourInoculation(6, 21, 5);
  assert.ok(med < uten, `forventet med < uten (med=${med}, uten=${uten})`);
  // 6 t bulk + 5 t kald = 11 effektive timer = referansen → 20%.
  assert.equal(med, 20);
});

test('inokulering ↔ bulk-tid: round-trip med kjøleskapsbidrag', () => {
  const coldEff = 3;
  const bulk = L.recommendedSourBulkHours(15, 23, coldEff);
  const inoc = L.recommendedSourInoculation(bulk, 23, coldEff);
  assert.ok(Math.abs(inoc - 15) < 0.001, `forventet ~15, fikk ${inoc}`);
});

// ─── initialDoughTempC / effectiveBulkHours (vanntemperatur) ──────────────

test('initialDoughTempC: vann og mel på samme temp gir samme deigtemp', () => {
  assert.equal(L.initialDoughTempC(21, 21, 75), 21);
  assert.equal(L.initialDoughTempC(10, 10, 80), 10);
});

test('initialDoughTempC: 35°C vann + 21°C mel ved 75% hydrering ligger mellom', () => {
  const t = L.initialDoughTempC(35, 21, 75);
  // Med c_vann ≈ 4,18 og c_mel ≈ 1,7 vekter vannet mer enn melmassen tilsier.
  // Forventer ~29–31 °C; ikke 21, ikke 35.
  assert.ok(t > 28 && t < 32, `forventet 28-32°C, fikk ${t}`);
});

test('initialDoughTempC: kjølig vann (5°C) trekker deigtemp under romtemp', () => {
  const t = L.initialDoughTempC(5, 21, 75);
  assert.ok(t < 21, `forventet < 21°C, fikk ${t}`);
});

test('initialDoughTempC: høyere hydrering forsterker vanntemperaturens vekt', () => {
  const lav = L.initialDoughTempC(35, 21, 60);
  const høy = L.initialDoughTempC(35, 21, 85);
  assert.ok(høy > lav, `forventet at 85% gir høyere deigtemp enn 60% (lav=${lav}, høy=${høy})`);
});

test('effectiveBulkHours: vanntemp = romtemp gir samme som konstant faktor', () => {
  const eff = L.effectiveBulkHours(14, 21, 21, 75);
  assert.ok(Math.abs(eff - 14) < 1e-9, `forventet 14, fikk ${eff}`);
});

test('effectiveBulkHours: konstant faktor bevares når vann = romtemp ved andre temperaturer', () => {
  const eff = L.effectiveBulkHours(14, 31, 31, 75);
  assert.ok(Math.abs(eff - 28) < 1e-9, `forventet 28, fikk ${eff}`);
});

test('effectiveBulkHours: varmt vann gir flere effektive timer', () => {
  const baseline = L.effectiveBulkHours(14, 21, 21, 75);
  const warm = L.effectiveBulkHours(14, 21, 35, 75);
  assert.ok(warm > baseline, `forventet warm > baseline (baseline=${baseline}, warm=${warm})`);
});

test('effectiveBulkHours: kjølig vann gir færre effektive timer', () => {
  const baseline = L.effectiveBulkHours(14, 21, 21, 75);
  const cool = L.effectiveBulkHours(14, 21, 10, 75);
  assert.ok(cool < baseline, `forventet cool < baseline (baseline=${baseline}, cool=${cool})`);
});

test('effectiveBulkHours: kort bulk har større relativ effekt av varmt vann (avkjøling kicker inn)', () => {
  // 2 t bulk: vannet har ikke kjølt seg ned ennå.
  const shortRatio = L.effectiveBulkHours(2, 21, 35, 75) / L.effectiveBulkHours(2, 21, 21, 75);
  // 14 t bulk: vannet nådde romtemp tidlig, så det varme bidraget utgjør lite av snittet.
  const longRatio = L.effectiveBulkHours(14, 21, 35, 75) / L.effectiveBulkHours(14, 21, 21, 75);
  assert.ok(shortRatio > longRatio,
    `forventet at varmt vann har større relativ effekt på 2t enn 14t (kort=${shortRatio}, lang=${longRatio})`);
});

// ─── modeEffectiveHours ────────────────────────────────────────────────────

test('modeEffectiveHours: klassisk @ 21°C er riseHours + andreheving', () => {
  const eff = L.modeEffectiveHours({
    mode: 'classic', riseHours: 14, temperatureC: 21
  });
  // 14 t bulk @ 21°C (faktor 1) + andreheving @ 21°C (faktor 1)
  assert.equal(eff, 14 + L.SECOND_PROOF_HOURS);
});

test('modeEffectiveHours: klassisk @ 31°C halverer effektiv tid (Q10≈2)', () => {
  const eff = L.modeEffectiveHours({
    mode: 'classic', riseHours: 14, temperatureC: 31
  });
  // Både bulk og andreheving skaleres med faktor 2 ved 31°C.
  assert.equal(eff, (14 + L.SECOND_PROOF_HOURS) * 2);
});

test('modeEffectiveHours: kald summerer bulk + nedkjølt kjøleskapsfase', () => {
  const eff = L.modeEffectiveHours({
    mode: 'cold',
    temperatureC: 21,
    bulkHours: 2,
    coldHours: 12,
    coldTempC: 4
  });
  const bulk = L.effectiveBulkHours(2, 21, 21, 75); // 21°C = ref, vann = romtemp
  const cold = L.effectiveColdHours(12, 4, 21);      // kjøler fra romtemp mot 4°C
  assert.equal(eff, bulk + cold);
});

test('effectiveColdHours: nedkjøling gir flere effektive timer enn konstant kjøleskapsfaktor', () => {
  // En varm deig gjærer mer mens den kjøler ned enn om den var 4°C hele tiden.
  const withCooldown = L.effectiveColdHours(12, 4, 21);
  const constant = 12 * L.fermentationFactor(4);
  assert.ok(withCooldown > constant,
    `forventet at nedkjøling gir mer gjæring (nedkjøl=${withCooldown}, konstant=${constant})`);
});

test('modeEffectiveHours: varmt vann øker effektive timer i klassisk modus', () => {
  const base = { mode: 'classic', riseHours: 14, temperatureC: 21, hydration: 75 };
  const cold = L.modeEffectiveHours({ ...base, waterTempC: 21 });
  const warm = L.modeEffectiveHours({ ...base, waterTempC: 35 });
  assert.ok(warm > cold, `forventet warm > cold (cold=${cold}, warm=${warm})`);
});

test('modeEffectiveHours: varmt vann øker bulk-bidraget i kald modus, kjøleskap-bidrag uendret', () => {
  const base = {
    mode: 'cold', bulkHours: 2, coldHours: 12,
    temperatureC: 21, coldTempC: 4, hydration: 75
  };
  const cold = L.modeEffectiveHours({ ...base, waterTempC: 21 });
  const warm = L.modeEffectiveHours({ ...base, waterTempC: 35 });
  // Kjøleskapsfasen er uavhengig av vanntemp (starter på romtemp etter bulk).
  const coldPhase = L.effectiveColdHours(12, 4, 21);
  // Hele økningen skal sitte i bulk-leddet.
  assert.ok(warm - cold > 0);
  assert.ok(Math.abs((cold - coldPhase) - 2) < 1e-9, 'baseline bulk skal være 2 t når vann = romtemp');
  assert.ok((warm - coldPhase) > 2, 'varmt vann skal gi bulk-bidrag større enn 2');
});

test('modeEffectiveHours: uten waterTempC i state faller den tilbake til romtemp', () => {
  const eff = L.modeEffectiveHours({ mode: 'classic', riseHours: 14, temperatureC: 21 });
  assert.equal(eff, 14 + L.SECOND_PROOF_HOURS);
});

// ─── computeRecipe ─────────────────────────────────────────────────────────

const baseState = {
  loaves: 1,
  sizePerLoaf: 500,
  flours: [{ type: 'hvete', pct: 100 }],
  hydration: 75,
  hydrationManual: false,
  temperatureC: 21,
  mode: 'classic',
  leaven: 'dry',
  riseHours: 14,
  bulkHours: 2,
  coldHours: 12,
  coldTempC: 4,
  sourInoculation: 20
};

test('computeRecipe: klassisk + tørrgjær gir riktige mengder', () => {
  const r = L.computeRecipe(baseState);
  assert.equal(r.flourTotal, 500);
  assert.equal(r.flourAdded, 500);
  assert.equal(r.hydration, 73); // midt i 70-75 for hvete, avrundet som i UI
  assert.equal(r.water, 500 * 0.73);
  assert.equal(r.salt, 500 * 0.02);
  assert.equal(r.leaven, 'dry');
  // effHours = 14 t bulk + andreheving (begge @ 21°C, faktor 1).
  const eff = 14 + L.SECOND_PROOF_HOURS;
  assert.equal(r.yeastPct, 0.23 * 14 / eff);
  assert.equal(r.yeast, (0.23 * 14 / eff / 100) * 500);
});

test('computeRecipe: manuell hydrering overstyrer anbefaling', () => {
  const r = L.computeRecipe({ ...baseState, hydrationManual: true, hydration: 80 });
  assert.equal(r.hydration, 80);
  assert.equal(r.water, 500 * 0.80);
});

test('computeRecipe: 2 brød × 500 g dobler totalt mel', () => {
  const r = L.computeRecipe({ ...baseState, loaves: 2 });
  assert.equal(r.flourTotal, 1000);
  assert.equal(r.water, 1000 * 0.73);
});

test('computeRecipe: surdeig trekker mel og vann fra starter (100 % hydrering)', () => {
  const r = L.computeRecipe({ ...baseState, leaven: 'sourdough', sourInoculation: 20 });
  // 500 g × 20 % = 100 g surdeig. 50 g mel + 50 g vann.
  assert.equal(r.flourTotal, 500);
  assert.equal(r.starter, 100);
  assert.equal(r.flourAdded, 450);
  assert.equal(r.water, 500 * 0.73 - 50);
  assert.equal(r.leaven, 'sourdough');
  assert.equal(r.yeast, undefined);
});

test('computeRecipe: kald modus får annen gjær-mengde enn klassisk', () => {
  const classic = L.computeRecipe(baseState);
  const cold = L.computeRecipe({ ...baseState, mode: 'cold' });
  // Begge gir gjær, men kald har lavere effHours (kjøleskap = lite gjæring)
  // så trenger MER gjær for samme totaltid.
  assert.ok(cold.yeast > classic.yeast);
});

// ─── flourTips ─────────────────────────────────────────────────────────────

test('flourTips: 100 % hvete gir ingen tips', () => {
  assert.deepEqual(L.flourTips([{ type: 'hvete', pct: 100 }]), []);
});

test('flourTips: 60 % rug utløser rug-tipset', () => {
  const tips = L.flourTips([
    { type: 'rug', pct: 60 },
    { type: 'hvete', pct: 40 }
  ]);
  assert.equal(tips.length, 1);
  assert.equal(tips[0].key, 'tip.rye');
});

test('flourTips: 40 % havre utløser lavgluten-tipset', () => {
  const tips = L.flourTips([
    { type: 'havre', pct: 40 },
    { type: 'hvete', pct: 60 }
  ]);
  assert.equal(tips.length, 1);
  assert.equal(tips[0].key, 'tip.lowGluten');
});

// ─── modeInstructions ──────────────────────────────────────────────────────

test('modeInstructions: surdeig får "Sjekk starter" som første steg', () => {
  const steps = L.modeInstructions({ ...baseState, leaven: 'sourdough' });
  assert.equal(steps[0].titleKey, 'step.starterCheck.title');
});

test('modeInstructions: tørrgjær har ikke "Sjekk starter"-steget', () => {
  const steps = L.modeInstructions({ ...baseState, leaven: 'dry' });
  assert.notEqual(steps[0].titleKey, 'step.starterCheck.title');
});

test('modeInstructions: ferskgjær bruker fersk-bland-steget', () => {
  const steps = L.modeInstructions({ ...baseState, leaven: 'fresh' });
  const bland = steps.find(s => s.titleKey === 'step.mix.title');
  assert.ok(bland, 'forventer bland-steg');
  assert.equal(bland.bodyKey, 'step.mix.body.fresh');
});

test('modeInstructions: kald + surdeig ender i kald etterheving', () => {
  const steps = L.modeInstructions({ ...baseState, mode: 'cold', leaven: 'sourdough' });
  const kald = steps.find(s => s.titleKey === 'step.coldProof.title');
  assert.ok(kald, 'forventer kald etterheving-steg');
});

test('modeInstructions: stekesteg bærer temp-params (celsius)', () => {
  const steps = L.modeInstructions({ ...baseState, leaven: 'dry' });
  const bake = steps.find(s => s.titleKey === 'step.bake.title');
  assert.ok(bake, 'forventer stekesteg');
  assert.equal(bake.params.hot.celsius, 245);
  assert.equal(bake.params.low.celsius, 220);
});

test('modePlanItems: bulk-steg er deskriptor med temp/time-params', () => {
  const items = L.modePlanItems({ mode: 'classic', riseHours: 14, temperatureC: 21 }, new Date(2020, 0, 1, 10, 0));
  assert.equal(items[0].key, 'plan.bulk');
  assert.equal(items[0].params.hours, 14);
  assert.equal(items[0].params.temp.celsius, 21);
});

// ─── riseDoneMinutes ───────────────────────────────────────────────────────

test('riseDoneMinutes: klassisk = bulkhevingen (uten etterheving/steking)', () => {
  assert.equal(L.riseDoneMinutes({ mode: 'classic', riseHours: 14 }), 14 * 60);
});

test('riseDoneMinutes: kald = bulk + kald etterheving (uten steking)', () => {
  assert.equal(L.riseDoneMinutes({ mode: 'cold', bulkHours: 2, coldHours: 12 }), (2 + 12) * 60);
});

test('riseDoneMinutes: alltid kortere enn total tid (steking ekskludert)', () => {
  const classic = { mode: 'classic', riseHours: 14, temperatureC: 21 };
  const cold = { mode: 'cold', bulkHours: 2, coldHours: 12, temperatureC: 21, coldTempC: 6 };
  assert.ok(L.riseDoneMinutes(classic) < L.modeTotalMinutes(classic));
  assert.ok(L.riseDoneMinutes(cold) < L.modeTotalMinutes(cold));
});

test('riseDoneMinutes: ukjent modus gir 0', () => {
  assert.equal(L.riseDoneMinutes({ mode: 'ukjent' }), 0);
});
