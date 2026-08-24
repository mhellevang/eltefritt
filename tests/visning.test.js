'use strict';

// Visning-tester: hva siden skal si, som verdier. Før dette lå de samme
// reglene i update() og åtte render-funksjoner, og kunne bare sjekkes ved å
// boote index.html i jsdom og lese computed style.

const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../src/visning.js');
const P = require('../src/plantilstand.js');
const L = require('../src/logic.js');

const HOUR = 3600 * 1000;
const NOW = new Date(2026, 7, 24, 10, 0, 0, 0).getTime();

// Bygg en state og dens View i ett.
function view(extra = {}, nowMs = NOW) {
  const state = { ...P.defaults(), ...extra };
  V.normalize(state);
  return { state, v: V.viewOf(state, nowMs) };
}

// ---- Auto-hydrering ----

test('normalize: hydreringen følger melblandingens midtpunkt', () => {
  const state = { ...P.defaults(), flours: [{ type: 'sammaltrug', pct: 100 }], hydration: 60 };
  V.normalize(state);
  const band = L.weightedHydration(state.flours);
  assert.equal(state.hydration, Math.round((band.min + band.max) / 2));
});

test('normalize: manuelt satt hydrering røres ikke', () => {
  const state = { ...P.defaults(), hydrationManual: true, hydration: 68 };
  V.normalize(state);
  assert.equal(state.hydration, 68);
});

test('values: slideren tvinges bare når hydreringen følger melet', () => {
  assert.ok('hydration' in view().v.values);
  assert.ok(!('hydration' in view({ hydrationManual: true, hydration: 68 }).v.values),
    'ikke slåss med en slider brukeren drar i');
});

// ---- Brødstørrelse og utstyr ----

test('brødstørrelse: navngitte størrelser vs. egen vekt', () => {
  assert.deepEqual(view({ sizePerLoaf: 500 }).v.text['size-value'], { key: 'size.medium' });
  assert.deepEqual(view({ sizePerLoaf: 640 }).v.text['size-value'],
    { key: 'size.custom', params: { g: 640 } });
});

test('brødstørrelse: ferdig brød regnes fra deigvekt og avrundes til 50 g', () => {
  const { v } = view({ sizePerLoaf: 500 });
  const finished = v.text['size-detail'].params.finished.grams;
  assert.equal(finished % 50, 0);
  // Deig = mel × (1 + hydrering + 2 %), ferdig ≈ deig × 0,88.
  const dough = 500 * (1 + v.recipe.hydration / 100 + 0.02);
  assert.ok(Math.abs(finished - dough * 0.88) <= 25);
});

test('utstyr: gryte og banneton følger samme trapp på melvekt', () => {
  const step = g => view({ sizePerLoaf: g }).v.text['equipment-detail'][0].params;
  assert.deepEqual(step(500).pot, { i18n: 'equipment.pot.s' });
  assert.deepEqual(step(500).banneton, { i18n: 'banneton.s' });
  assert.deepEqual(step(700).pot, { i18n: 'equipment.pot.m' });
  assert.deepEqual(step(1000).pot, { i18n: 'equipment.pot.l' });
  assert.deepEqual(step(1400).pot, { i18n: 'equipment.pot.xl' });
  assert.deepEqual(step(2000).pot, { i18n: 'equipment.pot.xxl' });
});

test('utstyr: "per brød" legges bare til for flere brød', () => {
  assert.equal(view({ loaves: 1 }).v.text['equipment-detail'].length, 1);
  const flere = view({ loaves: 2 }).v.text['equipment-detail'];
  assert.equal(flere.length, 2);
  assert.deepEqual(flere[1], { key: 'equipment.perLoaf' });
});

// ---- Hydrerings-anbefaling ----

test('hydrering: ett mel med område gir range-forslag, likt min/maks gir single', () => {
  const range = view().v.text['hydration-suggestion'];
  assert.equal(range.key, 'hydration.suggestion.range');
  assert.ok(range.params.min < range.params.max);

  // Tom melliste faller tilbake på 75/75 i logic.js.
  const single = view({ flours: [] }).v.text['hydration-suggestion'];
  assert.deepEqual(single, { key: 'hydration.suggestion.single', params: { n: 75 } });
});

// ---- Synlighet ----

test('synlighet: kontrollsettet følger hevemodus', () => {
  const klassisk = view({ mode: 'classic' }).v.hidden;
  assert.equal(klassisk['classic-controls'], false);
  assert.equal(klassisk['cold-controls'], true);
  const kald = view({ mode: 'cold' }).v.hidden;
  assert.equal(kald['cold-controls'], false);
  assert.equal(kald['classic-controls'], true);
});

test('synlighet: surdeigskontrollene bare for surdeig', () => {
  assert.equal(view({ leaven: 'dry' }).v.hidden['sourdough-controls'], true);
  assert.equal(view({ leaven: 'sourdough' }).v.hidden['sourdough-controls'], false);
});

// ---- Ingredienser ----

test('surdeig: starter-raden vises i stedet for gjær-raden', () => {
  const { v } = view({ leaven: 'sourdough' });
  assert.equal(v.hidden['yeast-row'], true);
  assert.equal(v.hidden['starter-row'], false);
  assert.equal(v.text['starter-amount'].grams, v.recipe.starter);
  assert.ok(!('yeast-amount' in v.text), 'ingen gjærmengde å skrive');
});

test('tørrgjær: mengden er gjærvekten, detaljlinja regner om til ferskgjær', () => {
  const { v } = view({ leaven: 'dry' });
  assert.deepEqual(v.text['yeast-label'], { key: 'yeast.dry' });
  assert.equal(v.text['yeast-amount'].grams, v.recipe.yeast);
  assert.equal(v.text['yeast-fresh'].key, 'yeast.detail.dry');
  assert.equal(v.text['yeast-fresh'].params.grams.grams, v.recipe.yeast * 3);
  assert.equal(v.text['yeast-fresh'].params.pct.pct2, v.recipe.yeastPct);
});

test('ferskgjær: mengden er 3× tørrgjær, detaljlinja regner tilbake', () => {
  const { v } = view({ leaven: 'fresh' });
  assert.deepEqual(v.text['yeast-label'], { key: 'yeast.fresh' });
  assert.equal(v.text['yeast-amount'].grams, v.recipe.yeast * 3);
  assert.equal(v.text['yeast-fresh'].key, 'yeast.detail.fresh');
  assert.equal(v.text['yeast-fresh'].params.grams.grams, v.recipe.yeast);
});

test('vannrad: sub-teksten sier fra bare når vannet følger romtemp', () => {
  assert.deepEqual(view({ temperatureC: 21, waterTempC: 21 }).v.text['water-sub'],
    { key: 'water.sub.roomTemp' });
  assert.deepEqual(view({ temperatureC: 21, waterTempC: 35 }).v.text['water-sub'], { text: '' });
});

test('avlesninger: temperaturer sendes som celsius, ikke som ferdig tekst', () => {
  const { v } = view({ temperatureC: 24, waterTempC: 30, coldTempC: 4 });
  assert.equal(v.temps['temp-value'], 24);
  assert.equal(v.temps['water-temp-value'], 30);
  assert.equal(v.temps['water-temp-inline-value'], 30);
  assert.equal(v.temps['cold-temp-value'], 4);
});

// ---- Mel ----

test('mel: én type gir ingen oppdeling, bare en etikett i små bokstaver', () => {
  const { v } = view({ flours: [{ type: 'sammalt', pct: 100 }] });
  assert.deepEqual(v.flour.breakdown, []);
  assert.deepEqual(v.text['flour-types-label'], { key: 'flour.sammalt', lower: true });
});

test('mel: flere typer gir oppdeling som summerer til melmengden', () => {
  const { v } = view({ flours: [{ type: 'hvete', pct: 70 }, { type: 'rug', pct: 30 }] });
  assert.equal(v.text['flour-types-label'].key, 'flour.typesLabelOther');
  assert.equal(v.text['flour-types-label'].params.count, 2);
  const sum = v.flour.breakdown.reduce((s, f) => s + f.grams, 0);
  assert.ok(Math.abs(sum - v.recipe.flourAdded) < 0.001);
});

test('mel: typer på 0 % utelates fra oppdelingen', () => {
  const { v } = view({ flours: [{ type: 'hvete', pct: 100 }, { type: 'rug', pct: 0 }] });
  assert.deepEqual(v.flour.breakdown.map(f => f.type), ['hvete']);
});

test('mel: sum-teksten skiller mellom nøyaktig, rest og overskudd', () => {
  assert.deepEqual(view().v.flour.sum, { key: 'flourSum.exact' });

  const rest = view({ flours: [{ type: 'hvete', pct: 60 }, { type: 'rug', pct: 30 }] }).v.flour;
  assert.equal(rest.sum.key, 'flourSum.remaining');
  assert.deepEqual(rest.sum.params, { total: 90, diff: 10 });
  assert.equal(rest.sumError, true);

  const over = view({ flours: [{ type: 'hvete', pct: 80 }, { type: 'rug', pct: 40 }] }).v.flour;
  assert.equal(over.sum.key, 'flourSum.over');
  assert.deepEqual(over.sum.params, { total: 120, diff: 20 });
});

test('mel: tips-feltet skjules når det ikke er noe å si', () => {
  assert.equal(view().v.hidden['flour-tip'], true);
  const rug = view({ flours: [{ type: 'sammaltrug', pct: 100 }] }).v;
  assert.equal(rug.hidden['flour-tip'], false);
  assert.ok(rug.flour.tips.length > 0);
});

// ---- Tidsplan ----

test('tidsplan: start og ferdig kommer fra planvinduet', () => {
  const { state, v } = view({ anchorTime: '18:00', timeAnchor: 'start' });
  const w = L.planWindow(state, NOW);
  assert.equal(v.plan.start.getTime(), w.start.getTime());
  assert.equal(v.plan.ready.getTime(), w.ready.getTime());
  assert.ok(v.plan.items.length > 0);
  assert.ok(v.instructions.length > 0);
});

// ---- Juster underveis ----

const running = extra => ({
  alarm: true, mode: 'classic', riseHours: 14, temperatureC: 21, waterTempC: 21,
  anchorDateMs: NOW - 2 * HOUR, ...extra
});

test('juster: skjult uten alarm, uten klassisk modus eller uten frosset start', () => {
  assert.equal(view(running({ alarm: false })).v.adjust.active, false);
  assert.equal(view(running({ mode: 'cold' })).v.adjust.active, false);
  assert.equal(view(running({ anchorDateMs: null })).v.adjust.active, false);
});

test('juster: hjelpetekst så lenge ingen faktisk temp er satt', () => {
  const { v } = view(running());
  assert.equal(v.adjust.active, true);
  assert.equal(v.adjust.shownTempC, 21, 'viser planlagt temp til brukeren setter en');
  assert.deepEqual(v.adjust.note, { key: 'adjust.help' });
});

test('juster: avvikende temp gir et justert klokkeslett', () => {
  const { v } = view(running({ actualTempC: 17 }));
  assert.equal(v.adjust.shownTempC, 17);
  assert.equal(v.adjust.note.key, 'adjust.readyAt');
  assert.ok(v.adjust.note.params.time.at > NOW);
});

test('juster: over budsjett sier at deigen er forbi ferdig', () => {
  const { v } = view(running({ anchorDateMs: NOW - 20 * HOUR, actualTempC: 25 }));
  assert.deepEqual(v.adjust.note, { key: 'adjust.overdue' });
});

// ---- Formen på View-en ----

test('viewOf: hver tekst-slot har en form applieren kjenner', () => {
  ['classic', 'cold'].forEach(mode => {
    ['dry', 'fresh', 'sourdough'].forEach(leaven => {
      const { v } = view({ mode, leaven });
      Object.entries(v.text).forEach(([id, slot]) => {
        const slots = Array.isArray(slot) ? slot : [slot];
        slots.forEach(x => {
          const known = x.key != null || x.text != null || x.grams != null;
          assert.ok(known, `${mode}/${leaven}/${id}: ukjent slot-form ${JSON.stringify(x)}`);
        });
      });
      Object.values(v.hidden).forEach(h => assert.equal(typeof h, 'boolean'));
      Object.values(v.temps).forEach(c => assert.equal(typeof c, 'number'));
    });
  });
});

test('viewOf: rører ikke state', () => {
  const state = { ...P.defaults(), hydrationManual: true, hydration: 68 };
  const before = JSON.stringify(state);
  V.viewOf(state, NOW);
  assert.equal(JSON.stringify(state), before);
});
