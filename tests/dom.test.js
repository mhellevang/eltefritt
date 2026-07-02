'use strict';

// DOM-tester via jsdom. Laster index.html, driver klikk og asserter på
// computed style, slik at vi fanger bugger som ren logikk-test ikke ville sett
// (f.eks. CSS-overstyring av [hidden]-attributtet).

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, fire } = require('./harness');

// jsdom har ingen localStorage som overlever mellom tester, men staten
// persisteres til localStorage *innenfor* en kjøring. Hver test får sin
// egen loadPage(), så de er isolerte.

test('default-tilstand: Tørrgjær valgt, Surdeig-rad skjult', async () => {
  const { document, close } = await loadPage();
  try {
    const tørrgjær = document.querySelector('button[data-leaven="dry"]');
    assert.equal(tørrgjær.getAttribute('aria-pressed'), 'true');

    const starterRow = document.getElementById('starter-row');
    const cs = document.defaultView.getComputedStyle(starterRow);
    assert.equal(cs.display, 'none', 'starter-row skal være skjult når heveform=dry');

    const yeastRow = document.getElementById('yeast-row');
    const cs2 = document.defaultView.getComputedStyle(yeastRow);
    assert.notEqual(cs2.display, 'none', 'yeast-row skal være synlig når heveform=dry');
  } finally {
    close();
  }
});

test('klikk Surdeig: starter-row vises, yeast-row skjules, inokuleringsslider dukker opp', async () => {
  const { window, document, close } = await loadPage();
  try {
    const surdeig = document.querySelector('button[data-leaven="sourdough"]');
    fire(window, surdeig, 'click');

    const starterRow = document.getElementById('starter-row');
    assert.notEqual(
      window.getComputedStyle(starterRow).display, 'none',
      'starter-row skal være synlig når heveform=sourdough'
    );

    const yeastRow = document.getElementById('yeast-row');
    assert.equal(
      window.getComputedStyle(yeastRow).display, 'none',
      'yeast-row skal være skjult når heveform=sourdough'
    );

    const sourControls = document.getElementById('sourdough-controls');
    assert.notEqual(
      window.getComputedStyle(sourControls).display, 'none',
      'sourdough-controls skal være synlig'
    );
  } finally {
    close();
  }
});

test('klikk Ferskgjær: yeast-row sier "Ferskgjær"', async () => {
  const { window, document, close } = await loadPage();
  try {
    const fersk = document.querySelector('button[data-leaven="fresh"]');
    fire(window, fersk, 'click');

    const label = document.getElementById('yeast-label');
    assert.equal(label.textContent, 'Ferskgjær');
  } finally {
    close();
  }
});

test('bytt fra Surdeig tilbake til Tørrgjær skjuler starter-row', async () => {
  const { window, document, close } = await loadPage();
  try {
    // Først til Surdeig
    fire(window, document.querySelector('button[data-leaven="sourdough"]'), 'click');
    // Så tilbake til Tørrgjær
    fire(window, document.querySelector('button[data-leaven="dry"]'), 'click');

    const starterRow = document.getElementById('starter-row');
    assert.equal(
      window.getComputedStyle(starterRow).display, 'none',
      'starter-row skal være skjult igjen etter bytte tilbake til Tørrgjær'
    );
  } finally {
    close();
  }
});

test('Hevemetode = Kald viser cold-controls, skjuler classic-controls', async () => {
  const { window, document, close } = await loadPage();
  try {
    const kald = document.querySelector('button[data-mode="cold"]');
    fire(window, kald, 'click');

    const cold = document.getElementById('cold-controls');
    const classic = document.getElementById('classic-controls');
    assert.notEqual(window.getComputedStyle(cold).display, 'none');
    assert.equal(window.getComputedStyle(classic).display, 'none');
  } finally {
    close();
  }
});

test('surdeig: å øke inokulering kortere bulk-tid (kobling)', async () => {
  const { window, document, close } = await loadPage();
  try {
    // Surdeig i klassisk modus (rise-time-slider 4–24 t), der hele
    // anbefalingsområdet får plass og koblingen er tydeligst synlig.
    fire(window, document.querySelector('button[data-leaven="sourdough"]'), 'click');

    const bulkSlider = document.getElementById('rise-time');
    const inoc = document.getElementById('sour-inoculation');

    // Start: 20% inokulering → ~11 t bulk.
    inoc.value = '20';
    fire(window, inoc, 'input');
    const bulkAt20 = parseInt(bulkSlider.value, 10);

    // Øk til 30%. Formelen sier ~7,3 t.
    inoc.value = '30';
    fire(window, inoc, 'input');
    const bulkAt30 = parseInt(bulkSlider.value, 10);

    assert.ok(bulkAt30 < bulkAt20, `forventet at høyere inokulering gir kortere bulk (20%→${bulkAt20}, 30%→${bulkAt30})`);
  } finally {
    close();
  }
});

test('surdeig: å forlenge bulk-tid reduserer inokulering (andre retning)', async () => {
  const { window, document, close } = await loadPage();
  try {
    fire(window, document.querySelector('button[data-leaven="sourdough"]'), 'click');
    fire(window, document.querySelector('button[data-mode="cold"]'), 'click');

    const bulkSlider = document.getElementById('bulk-time');
    const inoc = document.getElementById('sour-inoculation');

    bulkSlider.value = '3';
    fire(window, bulkSlider, 'input');
    const inocAt3 = parseInt(inoc.value, 10);

    bulkSlider.value = '6';
    fire(window, bulkSlider, 'input');
    const inocAt6 = parseInt(inoc.value, 10);

    assert.ok(inocAt6 < inocAt3, `forventet at lengre bulk gir lavere inokulering (3 t→${inocAt3}%, 6 t→${inocAt6}%)`);
  } finally {
    close();
  }
});

test('endring i meltype oppdaterer Vann-mengden', async () => {
  const { window, document, close } = await loadPage();
  try {
    const waterBefore = document.getElementById('water-amount').textContent;

    // Bytt meltype til sammalt rug (høyere anbefalt hydrering).
    // Ingen guard her: finnes ikke selecten, skal testen feile høylytt.
    const select = document.querySelector('.flour-type-select');
    assert.ok(select, 'forventer .flour-type-select i flour-listen');
    select.value = 'sammaltrug';
    fire(window, select, 'change');

    const waterAfter = document.getElementById('water-amount').textContent;
    assert.notEqual(waterAfter, waterBefore, 'vannmengden skal endres når meltype byttes');
  } finally {
    close();
  }
});

// ─── i18n + temperaturenhet ────────────────────────────────────────────────

test('engelsk + Fahrenheit ved oppstart: lang=en, temp i °F, modell forblir Celsius', async () => {
  const { document, close } = await loadPage({ lang: 'en', unit: 'f' });
  try {
    assert.equal(document.documentElement.lang, 'en');
    // Statisk tekst er engelsk.
    assert.equal(document.querySelector('[data-i18n="card.recipe"]').textContent, 'Recipe');
    // Dynamisk gjær-label er engelsk.
    assert.equal(document.getElementById('yeast-label').textContent, 'Dry yeast');
    // Avlesning i °F (21 °C → 70 °F); men range-input forblir Celsius.
    assert.equal(document.getElementById('temp-value').textContent, '70');
    assert.equal(document.getElementById('temp').value, '21');
    const unitSpan = document.querySelector('#temp-value + .temp-unit');
    assert.equal(unitSpan.textContent, '°F');
  } finally {
    close();
  }
});

test('bytte språk i menyen re-lokaliserer statisk og dynamisk tekst', async () => {
  const { window, document, close } = await loadPage({ lang: 'nb' });
  try {
    assert.equal(document.querySelector('[data-i18n="card.recipe"]').textContent, 'Oppskrift');
    const enBtn = document.querySelector('#settings-menu [data-lang-value="en"]');
    fire(window, enBtn, 'click');
    assert.equal(document.documentElement.lang, 'en');
    assert.equal(document.querySelector('[data-i18n="card.recipe"]').textContent, 'Recipe');
    assert.equal(document.getElementById('yeast-label').textContent, 'Dry yeast');
  } finally {
    close();
  }
});

test('bytte enhet til °F oppdaterer avlesning, ikke modellverdien', async () => {
  const { window, document, close } = await loadPage({ lang: 'nb', unit: 'c' });
  try {
    assert.equal(document.getElementById('temp-value').textContent, '21');
    const fBtn = document.querySelector('#settings-menu [data-unit-value="f"]');
    fire(window, fBtn, 'click');
    assert.equal(document.getElementById('temp-value').textContent, '70');
    assert.equal(document.querySelector('#temp-value + .temp-unit').textContent, '°F');
    // Slider/modell forblir Celsius.
    assert.equal(document.getElementById('temp').value, '21');
  } finally {
    close();
  }
});

test('alarm: av som standard, viser hjelpetekst', async () => {
  const { document, close } = await loadPage();
  try {
    const off = document.querySelector('button[data-alarm="off"]');
    const on = document.querySelector('button[data-alarm="on"]');
    assert.equal(off.getAttribute('aria-pressed'), 'true');
    assert.equal(on.getAttribute('aria-pressed'), 'false');
    const detail = document.getElementById('alarm-detail');
    assert.match(detail.textContent, /varsel/i);
    assert.equal(detail.classList.contains('is-active'), false);
  } finally {
    close();
  }
});

test('alarm: klikk På armer nedtelling og viser gjenværende tid', async () => {
  const { window, document, close } = await loadPage();
  try {
    const on = document.querySelector('button[data-alarm="on"]');
    fire(window, on, 'click');
    assert.equal(on.getAttribute('aria-pressed'), 'true');
    const detail = document.getElementById('alarm-detail');
    // Standard klassisk 14 t heving fra start om ~1 t ⇒ nedtelling med timer.
    assert.match(detail.textContent, /⏰/);
    assert.match(detail.textContent, /hevingen er ferdig/i);
    assert.match(detail.textContent, /\d+\s+t/);
    // Sekund-oppløsning: nedtellingen viser "... SS sek".
    assert.match(detail.textContent, /\d{2}\s+sek/);
    assert.equal(detail.classList.contains('is-active'), true);

    // Skru av igjen ⇒ tilbake til hjelpetekst, ingen nedtelling.
    const off = document.querySelector('button[data-alarm="off"]');
    fire(window, off, 'click');
    assert.equal(off.getAttribute('aria-pressed'), 'true');
    assert.equal(document.getElementById('alarm-detail').classList.contains('is-active'), false);
  } finally {
    close();
  }
});

test('vannrad: inline temp-stepper endrer vanntemp, gjær og Heving-slideren', async () => {
  const { window, document, close } = await loadPage();
  try {
    const plus = document.querySelector('.water-temp-inline [data-step-dir="1"]');
    const yeastBefore = document.getElementById('yeast-amount').textContent;

    fire(window, plus, 'click');
    fire(window, plus, 'click');
    fire(window, plus, 'click');

    // Inline-visning og slideren i Heving skal følge med.
    assert.equal(document.getElementById('water-temp-inline-value').textContent, '24');
    assert.equal(document.getElementById('water-temp-value').textContent, '24');
    assert.equal(document.getElementById('water-temp').value, '24');

    // Effekten på gjær er dempet (vektet blandetemp + avkjøling mot romtemp),
    // så gå helt til maks 40 °C for en avrundings-synlig endring.
    for (let i = 0; i < 16; i++) fire(window, plus, 'click');
    assert.equal(document.getElementById('water-temp').value, '40');
    assert.notEqual(
      document.getElementById('yeast-amount').textContent, yeastBefore,
      'gjærmengden skal endres når vanntemp settes opp'
    );

    // Manuelt satt temp ⇒ sub-teksten "romtemperert" forsvinner.
    assert.equal(document.getElementById('water-sub').textContent, '');
  } finally {
    close();
  }
});

test('vannrad: gram-hintet ved vanntemp-slideren følger oppskriftens vannmengde', async () => {
  const { document, close } = await loadPage();
  try {
    const grams = document.getElementById('water-temp-grams').textContent;
    const water = document.getElementById('water-amount').textContent;
    assert.equal(grams, `til ${water} g vann`);
  } finally {
    close();
  }
});
