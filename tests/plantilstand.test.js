'use strict';

// Plantilstand-tester: gjenoppretting av lagret state og gjenopptaks-
// avgjørelsen, drevet som rene funksjoner. Før dette lå de i en closure i
// index.html og kunne bare nås ved å boote hele siden i jsdom.

const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/plantilstand.js');
const Logic = require('../src/logic.js');

const HOUR = 3600 * 1000;
// Fast "nå": 2026-08-24 14:00 lokal tid.
const NOW = new Date(2026, 7, 24, 14, 0, 0, 0).getTime();

const load = (raw, nowMs = NOW) => P.load(raw, nowMs);

// ---- Feltbordet ----

test('FIELDS: hvert tallfelt har et gyldig område og standardverdi innenfor det', () => {
  Object.entries(P.FIELDS).forEach(([name, f]) => {
    if (f.min == null) return;
    assert.ok(f.min < f.max, `${name}: min < max`);
    if (f.default != null) {
      assert.ok(f.default >= f.min && f.default <= f.max, `${name}: default innenfor området`);
    }
  });
});

test('FIELDS: ingen to felter deler samme DOM-kontroll', () => {
  const ids = Object.values(P.FIELDS).map(f => f.inputId).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length);
});

test('defaults: gir en fersk flours-liste per kall', () => {
  const a = P.defaults();
  const b = P.defaults();
  a.flours[0].pct = 42;
  assert.equal(b.flours[0].pct, 100, 'ingen delt mutabel default');
});

// ---- Gjenoppretting ----

test('load: uten lagret state gir standardverdier og neste hele time', () => {
  const { state, resumed } = load(null);
  assert.equal(resumed, false);
  assert.equal(state.anchorTime, '15:00');
  assert.equal(state.timeAnchor, 'start');
  assert.equal(state.riseHours, P.FIELDS.riseHours.default);
});

test('load: korrupt JSON faller tilbake til standardverdier', () => {
  const { state } = load('{ dette er ikke json');
  assert.deepEqual(state.flours, [{ type: 'hvete', pct: 100 }]);
  assert.equal(state.hydration, P.FIELDS.hydration.default);
});

test('load: tall utenfor gyldig område forkastes feltvis', () => {
  const { state } = load(JSON.stringify({
    hydration: 999, temperatureC: -40, riseHours: 14.5, coldHours: 12
  }));
  assert.equal(state.hydration, P.FIELDS.hydration.default);
  assert.equal(state.temperatureC, P.FIELDS.temperatureC.default);
  assert.equal(state.riseHours, 14.5, 'innenfor området, selv om det ikke er heltall');
  assert.equal(state.coldHours, 12, 'gyldig verdi beholdes');
});

test('load: ukjente verdisett-verdier forkastes', () => {
  const { state } = load(JSON.stringify({ leaven: 'gjærsopp', loaves: 7, sourLead: 'tja' }));
  assert.equal(state.leaven, 'dry');
  assert.equal(state.loaves, 1);
  assert.equal(state.sourLead, 'inoculation');
});

test('load: NaN og strenger i tallfelt forkastes', () => {
  const { state } = load(JSON.stringify({ hydration: null, coldTempC: '6' }));
  assert.equal(state.hydration, P.FIELDS.hydration.default);
  assert.equal(state.coldTempC, P.FIELDS.coldTempC.default);
});

test('load: actualTempC utenfor området blir null, ikke standardverdi', () => {
  assert.equal(load(JSON.stringify({ actualTempC: 99 })).state.actualTempC, null);
  // En gyldig verdi beholdes bare når baken faktisk gjenopptas; ellers
  // nullstilles justeringen sammen med resten av bakplanen.
  const running = { alarm: true, mode: 'classic', riseHours: 14, temperatureC: 21, anchorDateMs: NOW - 2 * HOUR };
  assert.equal(load(JSON.stringify({ ...running, actualTempC: 24 })).state.actualTempC, 24);
  assert.equal(load(JSON.stringify({ actualTempC: 24 })).state.actualTempC, null);
});

test('load: migrerer gammel state der surdeig var en modus', () => {
  const { state } = load(JSON.stringify({ mode: 'sourdough' }));
  assert.equal(state.mode, 'cold');
  assert.equal(state.leaven, 'sourdough');
});

test('load: gammel state uten vanntemp lar vannet følge romtemp', () => {
  const { state } = load(JSON.stringify({ temperatureC: 24 }));
  assert.equal(state.waterTempC, 24);
  assert.equal(state.waterTempManual, false);
});

test('load: avvikende lagret vanntemp regnes som manuelt satt', () => {
  const { state } = load(JSON.stringify({ temperatureC: 21, waterTempC: 35 }));
  assert.equal(state.waterTempC, 35);
  assert.equal(state.waterTempManual, true);
});

// ---- Meltyper ----

test('load: ukjente meltyper filtreres bort og resten normaliseres til 100 %', () => {
  const { state } = load(JSON.stringify({
    flours: [{ type: 'hvete', pct: 30 }, { type: 'kikertmel', pct: 40 }, { type: 'rug', pct: 30 }]
  }));
  assert.deepEqual(state.flours.map(f => f.type), ['hvete', 'rug']);
  assert.equal(state.flours.reduce((s, f) => s + f.pct, 0), 100);
});

test('load: bare ukjente meltyper beholder standardmelet', () => {
  const { state } = load(JSON.stringify({ flours: [{ type: 'kikertmel', pct: 100 }] }));
  assert.deepEqual(state.flours, [{ type: 'hvete', pct: 100 }]);
});

test('load: avrundingsrest legges på første mel så summen blir 100', () => {
  const { state } = load(JSON.stringify({
    flours: [{ type: 'hvete', pct: 1 }, { type: 'rug', pct: 1 }, { type: 'spelt', pct: 1 }]
  }));
  assert.equal(state.flours.reduce((s, f) => s + f.pct, 0), 100);
});

// ---- Gjenopptak ----

const bake = extra => JSON.stringify({
  alarm: true, mode: 'classic', riseHours: 14, temperatureC: 21, waterTempC: 21, ...extra
});

test('gjenopptak: pågående bake videreføres med starttiden som anker', () => {
  const anchor = NOW - 2 * HOUR;
  const { state, resumed } = load(bake({ anchorDateMs: anchor }));
  assert.equal(resumed, true);
  assert.equal(state.alarm, true);
  assert.equal(state.anchorDateMs, anchor);
  assert.equal(state.anchorTime, '12:00');
  assert.equal(state.timeAnchor, 'start');
});

test('gjenopptak: utgått bake nullstilles', () => {
  // Klassisk plan er ~16,25 t inkl. steking; 20 t siden start er over.
  const { state, resumed } = load(bake({ anchorDateMs: NOW - 20 * HOUR }));
  assert.equal(resumed, false);
  assert.equal(state.alarm, false);
  assert.equal(state.anchorDateMs, null);
  assert.equal(state.actualTempC, null);
  assert.equal(state.anchorTime, '15:00');
});

test('gjenopptak: justert (forlenget) heving overlever planlagt ferdigtid', () => {
  const anchor = NOW - 20 * HOUR;
  // Uten justering er den samme baken utgått ...
  assert.equal(load(bake({ anchorDateMs: anchor })).resumed, false);
  // ... men 20 t ved 15 °C har brukt mindre av budsjettet enn planlagt.
  const { state, resumed } = load(bake({ anchorDateMs: anchor, actualTempC: 15 }));
  assert.equal(resumed, true);
  assert.equal(state.actualTempC, 15);
});

test('gjenopptak: alarm av gir ingen gjenopptak', () => {
  const { resumed } = load(bake({ alarm: false, anchorDateMs: NOW - HOUR }));
  assert.equal(resumed, false);
});

test('gjenopptak: start absurd langt frem i tid gjenopptas ikke', () => {
  const { resumed } = load(bake({ anchorDateMs: NOW + P.RESUME_LOOKAHEAD_MS + HOUR }));
  assert.equal(resumed, false);
});

test('gjenopptak: kald modus bruker sin egen totaltid', () => {
  const cold = { alarm: true, mode: 'cold', bulkHours: 2, coldHours: 12, temperatureC: 21 };
  // Kald plan er 2 + 12 t + 45 min steking.
  assert.equal(load(JSON.stringify({ ...cold, anchorDateMs: NOW - 10 * HOUR })).resumed, true);
  assert.equal(load(JSON.stringify({ ...cold, anchorDateMs: NOW - 20 * HOUR })).resumed, false);
});

// ---- Lagring ----

test('serialize → load: state overlever en runde gjennom lageret', () => {
  const before = load(JSON.stringify({
    leaven: 'sourdough', mode: 'cold', sourInoculation: 15, sourLead: 'time',
    coldHours: 20, flours: [{ type: 'hvete', pct: 70 }, { type: 'sammaltrug', pct: 30 }]
  })).state;
  const after = load(P.serialize(before)).state;
  assert.deepEqual(after.flours, before.flours);
  assert.equal(after.leaven, 'sourdough');
  assert.equal(after.sourInoculation, 15);
  assert.equal(after.sourLead, 'time');
  assert.equal(after.coldHours, 20);
});

// ---- Delt med logic.js ----

test('adjustedRiseDoneMs: null uten aktiv justering', () => {
  const base = { mode: 'classic', alarm: true, anchorDateMs: NOW - HOUR, riseHours: 14, temperatureC: 21 };
  assert.equal(Logic.adjustedRiseDoneMs({ ...base, actualTempC: null }, NOW), null);
  assert.equal(Logic.adjustedRiseDoneMs({ ...base, mode: 'cold', actualTempC: 20 }, NOW), null);
  assert.equal(Logic.adjustedRiseDoneMs({ ...base, alarm: false, actualTempC: 20 }, NOW), null);
  assert.equal(Logic.adjustedRiseDoneMs({ ...base, anchorDateMs: NOW + HOUR, actualTempC: 20 }, NOW), null);
});

test('adjustedRiseDoneMs: kaldere enn planlagt skyver målet senere', () => {
  const base = { mode: 'classic', alarm: true, anchorDateMs: NOW - 4 * HOUR, riseHours: 14, temperatureC: 21, waterTempC: 21 };
  const cold = Logic.adjustedRiseDoneMs({ ...base, actualTempC: 17 }, NOW);
  const warm = Logic.adjustedRiseDoneMs({ ...base, actualTempC: 25 }, NOW);
  assert.ok(cold > warm);
  assert.equal(cold % 60000, 0, 'avrundet til hele minutter');
});
