'use strict';

// Kjøres med: node --test tests/
//
// Tester oversettelse, deteksjon og temperatur/tall-formatering i src/i18n.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../src/i18n.js');

// ─── detectLang ─────────────────────────────────────────────────────────────

test('detectLang: norske locale gir nb', () => {
  assert.equal(I.detectLang({ languages: ['nb-NO', 'en'] }), 'nb');
  assert.equal(I.detectLang({ languages: ['nn-NO'] }), 'nb');
  assert.equal(I.detectLang({ languages: ['no'] }), 'nb');
});

test('detectLang: engelske locale gir en', () => {
  assert.equal(I.detectLang({ languages: ['en-US'] }), 'en');
  assert.equal(I.detectLang({ languages: ['en-GB', 'nb'] }), 'en');
});

test('detectLang: ukjent locale faller tilbake til engelsk', () => {
  assert.equal(I.detectLang({ languages: ['fr-FR', 'de'] }), 'en');
  assert.equal(I.detectLang({ languages: [] }), 'en');
});

// ─── detectUnit ─────────────────────────────────────────────────────────────

test('detectUnit: USA gir Fahrenheit', () => {
  assert.equal(I.detectUnit({ languages: ['en-US'] }), 'f');
});

test('detectUnit: Storbritannia og Norge gir Celsius', () => {
  assert.equal(I.detectUnit({ languages: ['en-GB'] }), 'c');
  assert.equal(I.detectUnit({ languages: ['nb-NO'] }), 'c');
});

test('detectUnit: bart "en" maksimerer til US → Fahrenheit', () => {
  assert.equal(I.detectUnit({ languages: ['en'] }), 'f');
});

test('detectUnit: eksplisitt region vinner over senere språk', () => {
  // nb-NO har eksplisitt NO → Celsius, selv om en kommer etter.
  assert.equal(I.detectUnit({ languages: ['nb-NO', 'en-US'] }), 'c');
});

test('detectUnit: tom liste gir Celsius', () => {
  assert.equal(I.detectUnit({ languages: [] }), 'c');
});

// ─── convertTemp / formatTemp ───────────────────────────────────────────────

test('convertTemp: Celsius avrundes, Fahrenheit konverteres', () => {
  assert.equal(I.convertTemp(21, 'c'), 21);
  assert.equal(I.convertTemp(20.6, 'c'), 21);
  assert.equal(I.convertTemp(0, 'f'), 32);
  assert.equal(I.convertTemp(100, 'f'), 212);
  assert.equal(I.convertTemp(21, 'f'), 70);
  assert.equal(I.convertTemp(245, 'f'), 473);
  assert.equal(I.convertTemp(220, 'f'), 428);
});

test('formatTemp: suffiks følger enhet og locale', () => {
  assert.equal(I.formatTemp(245, 'c', 'nb-NO'), '245 °C');
  assert.equal(I.formatTemp(245, 'f', 'en-GB'), '473 °F');
  assert.equal(I.formatTemp(21, 'f', 'nb-NO'), '70 °F');
});

// ─── formatNumber ───────────────────────────────────────────────────────────

test('formatNumber: desimaltegn følger locale', () => {
  assert.equal(I.formatNumber(8.6, 'nb-NO', { maximumFractionDigits: 1 }), '8,6');
  assert.equal(I.formatNumber(8.6, 'en-GB', { maximumFractionDigits: 1 }), '8.6');
  assert.equal(I.formatNumber(0.23, 'nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), '0,23');
  assert.equal(I.formatNumber(0.23, 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), '0.23');
});

// ─── createTranslator ───────────────────────────────────────────────────────

test('t: slår opp og interpolerer params', () => {
  const t = I.createTranslator('en').t;
  assert.equal(t('plan.secondProof', { hours: '1.5' }), 'Final proof · ~1.5 h');
});

test('t: manglende nøkkel i en faller tilbake til nb, så til selve nøkkelen', () => {
  const t = I.createTranslator('en').t;
  // Finnes i begge: returnerer engelsk.
  assert.equal(t('plan.start'), 'Start');
  // Helt ukjent nøkkel: returneres som den er (synlig, ikke blank/kast).
  assert.equal(t('this.key.does.not.exist'), 'this.key.does.not.exist');
});

test('t: array-verdier (ukedager) returneres uendret', () => {
  const t = I.createTranslator('nb').t;
  const days = t('day.weekdaysShort');
  assert.ok(Array.isArray(days));
  assert.equal(days.length, 7);
  assert.equal(days[1], 'man');
});

// ─── Nøkkel-paritet (hovedvakt mot at tabellene drifter) ────────────────────

test('MESSAGES: nb og en har nøyaktig samme nøkler', () => {
  const nb = Object.keys(I.MESSAGES.nb).sort();
  const en = Object.keys(I.MESSAGES.en).sort();
  assert.deepEqual(nb, en);
});

// ─── Flyttede prosa-vakter (innhold som før lå i logic-testene) ─────────────

test('prosa: nb fersk-bland nevner ferskgjær', () => {
  assert.match(I.MESSAGES.nb['step.mix.body.fresh'], /ferskgj[æa]r/i);
  assert.match(I.MESSAGES.en['step.mix.body.fresh'], /fresh yeast/i);
});

test('prosa: rug-tipset nevner surdeig, lavgluten nevner gluten', () => {
  assert.match(I.MESSAGES.nb['tip.rye'], /surdeig/);
  assert.match(I.MESSAGES.nb['tip.lowGluten'], /gluten/);
  assert.match(I.MESSAGES.en['tip.rye'], /sourdough/);
  assert.match(I.MESSAGES.en['tip.lowGluten'], /gluten/);
});

test('prosa: "Sjekk starter"-tittel bevart på norsk', () => {
  assert.equal(I.MESSAGES.nb['step.starterCheck.title'], 'Sjekk starter');
});

test('prosa: engelsk stekesteg konverterer ovnstemp til °F via params', () => {
  const t = I.createTranslator('en').t;
  const body = t('step.bake.body', {
    hot: I.formatTemp(245, 'f', 'en-GB'),
    low: I.formatTemp(220, 'f', 'en-GB'),
    pan: I.formatTemp(220, 'f', 'en-GB')
  });
  assert.match(body, /473 °F/);
  assert.match(body, /428 °F/);
  assert.doesNotMatch(body, /°C/);
});
