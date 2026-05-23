'use strict';

// DOM-tester via jsdom. Laster index.html, driver klikk og asserter på
// computed style — fanger bugger som ren logikk-test ikke ville sett
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

test('endring i flour-prosent oppdaterer Vann-mengden', async () => {
  const { window, document, close } = await loadPage();
  try {
    const waterBefore = document.getElementById('water-amount').textContent;

    // Bytt meltype til sammalt rug (høyere anbefalt hydrering).
    const select = document.querySelector('.flour-type-select');
    if (select) {
      select.value = 'sammaltrug';
      fire(window, select, 'change');

      const waterAfter = document.getElementById('water-amount').textContent;
      assert.notEqual(waterAfter, waterBefore, 'vannmengden skal endres når meltype byttes');
    }
  } finally {
    close();
  }
});
