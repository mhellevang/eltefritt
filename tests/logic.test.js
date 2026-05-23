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
  // hvete 70-75 + sammaltrug 82-85, halvparten av hver
  assert.equal(r.min, (70 + 82) / 2);
  assert.equal(r.max, (75 + 85) / 2);
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

// ─── recommendedSourBulkHours / recommendedSourInoculation ────────────────

test('recommendedSourBulkHours: 20% @ 21°C = referanse 6 t', () => {
  assert.equal(L.recommendedSourBulkHours(20, 21), 6);
});

test('recommendedSourBulkHours: halv inokulering dobler bulk-tid', () => {
  assert.equal(L.recommendedSourBulkHours(10, 21), 12);
});

test('recommendedSourBulkHours: dobbel inokulering halverer bulk-tid', () => {
  assert.equal(L.recommendedSourBulkHours(40, 21), 3);
});

test('recommendedSourBulkHours: 10°C varmere halverer bulk-tid (Q10)', () => {
  assert.equal(L.recommendedSourBulkHours(20, 31), 3);
});

test('recommendedSourInoculation: 6 t @ 21°C = referanse 20%', () => {
  assert.equal(L.recommendedSourInoculation(6, 21), 20);
});

test('inokulering ↔ bulk-tid: round-trip', () => {
  const bulk = L.recommendedSourBulkHours(15, 23);
  const inoc = L.recommendedSourInoculation(bulk, 23);
  assert.ok(Math.abs(inoc - 15) < 0.001, `forventet ~15, fikk ${inoc}`);
});

// ─── modeEffectiveHours ────────────────────────────────────────────────────

test('modeEffectiveHours: klassisk @ 21°C er bare riseHours', () => {
  const eff = L.modeEffectiveHours({
    mode: 'classic', riseHours: 14, temperatureC: 21
  });
  assert.equal(eff, 14);
});

test('modeEffectiveHours: klassisk @ 31°C halverer effektiv tid (Q10≈2)', () => {
  const eff = L.modeEffectiveHours({
    mode: 'classic', riseHours: 14, temperatureC: 31
  });
  assert.equal(eff, 14 * 2); // høyere temp = mer effektiv tid per faktisk time
});

test('modeEffectiveHours: kald summerer bulk + kjøleskap med egne faktorer', () => {
  const eff = L.modeEffectiveHours({
    mode: 'cold',
    temperatureC: 21,
    bulkHours: 2,
    coldHours: 12,
    coldTempC: 4
  });
  const bulk = 2 * Math.pow(2, 0);          // 21°C = ref, faktor 1
  const cold = 12 * Math.pow(2, (4 - 21) / 10);
  assert.equal(eff, bulk + cold);
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
  assert.equal(r.hydration, 72.5); // midt i 70-75 for hvete
  assert.equal(r.water, 500 * 0.725);
  assert.equal(r.salt, 500 * 0.02);
  assert.equal(r.leaven, 'dry');
  assert.equal(r.yeastPct, 0.23);
  assert.equal(r.yeast, 500 * 0.0023);
});

test('computeRecipe: manuell hydrering overstyrer anbefaling', () => {
  const r = L.computeRecipe({ ...baseState, hydrationManual: true, hydration: 80 });
  assert.equal(r.hydration, 80);
  assert.equal(r.water, 500 * 0.80);
});

test('computeRecipe: 2 brød × 500 g dobler totalt mel', () => {
  const r = L.computeRecipe({ ...baseState, loaves: 2 });
  assert.equal(r.flourTotal, 1000);
  assert.equal(r.water, 1000 * 0.725);
});

test('computeRecipe: surdeig trekker mel og vann fra starter (100 % hydrering)', () => {
  const r = L.computeRecipe({ ...baseState, leaven: 'sourdough', sourInoculation: 20 });
  // 500 g × 20 % = 100 g surdeig. 50 g mel + 50 g vann.
  assert.equal(r.flourTotal, 500);
  assert.equal(r.starter, 100);
  assert.equal(r.flourAdded, 450);
  assert.equal(r.water, 500 * 0.725 - 50);
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

test('flourTips: 60 % rug utløser surdeig-tipset', () => {
  const tips = L.flourTips([
    { type: 'rug', pct: 60 },
    { type: 'hvete', pct: 40 }
  ]);
  assert.equal(tips.length, 1);
  assert.match(tips[0], /surdeig/);
});

test('flourTips: 40 % havre utløser glutentipset', () => {
  const tips = L.flourTips([
    { type: 'havre', pct: 40 },
    { type: 'hvete', pct: 60 }
  ]);
  assert.equal(tips.length, 1);
  assert.match(tips[0], /gluten/);
});

// ─── modeInstructions ──────────────────────────────────────────────────────

test('modeInstructions: surdeig får "Sjekk starter" som første steg', () => {
  const steps = L.modeInstructions({ ...baseState, leaven: 'sourdough' });
  assert.equal(steps[0][0], 'Sjekk starter');
});

test('modeInstructions: tørrgjær har ikke "Sjekk starter"-steget', () => {
  const steps = L.modeInstructions({ ...baseState, leaven: 'dry' });
  assert.notEqual(steps[0][0], 'Sjekk starter');
});

test('modeInstructions: ferskgjær nevner "ferskgjær" i bland-steget', () => {
  const steps = L.modeInstructions({ ...baseState, leaven: 'fresh' });
  const bland = steps.find(s => s[0] === 'Bland');
  assert.match(bland[1], /ferskgj[æa]r/i);
});

test('modeInstructions: kald + surdeig ender i kjøleskap', () => {
  const steps = L.modeInstructions({ ...baseState, mode: 'cold', leaven: 'sourdough' });
  const kald = steps.find(s => s[0] === 'Kald etterheving');
  assert.ok(kald, 'forventer "Kald etterheving"-steg');
});
