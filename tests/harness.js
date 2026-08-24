'use strict';

// Laster index.html inn i jsdom for DOM-tester.
//
// Strategi: les index.html, erstatt hver <script src="src/*.js"> med innholdet
// inline, og la jsdom kjøre alle inline scripts. Dermed unngår vi at jsdom
// må hente noe over nettverket. Bilder, fonter og CSS dropper bare.
//
// Bruk:
//   const { loadPage, fire } = require('./harness');
//   const { window, document, close } = await loadPage();
//   ... driv siden ...
//   close();

const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

async function loadPage(opts = {}) {
  // Frø språk/enhet deterministisk: jsdom sin navigator.language er en-US, så
  // uten frø ville auto-deteksjon vippe hele DOM-suiten til engelsk/Fahrenheit.
  const lang = opts.lang || 'nb';
  const unit = opts.unit || 'c';

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const i18n = fs.readFileSync(path.join(ROOT, 'src/i18n.js'), 'utf8');
  const logic = fs.readFileSync(path.join(ROOT, 'src/logic.js'), 'utf8');
  const varsling = fs.readFileSync(path.join(ROOT, 'src/varsling.js'), 'utf8');
  const plantilstand = fs.readFileSync(path.join(ROOT, 'src/plantilstand.js'), 'utf8');
  const visning = fs.readFileSync(path.join(ROOT, 'src/visning.js'), 'utf8');

  // Inline src-modulene i samme rekkefølge som nettleseren laster dem, så
  // jsdom slipper å hente dem over HTTP.
  const inlinedHtml = html
    .replace(/<script src="src\/i18n\.js"><\/script>/, `<script>${i18n}</script>`)
    .replace(/<script src="src\/logic\.js"><\/script>/, `<script>${logic}</script>`)
    .replace(/<script src="src\/varsling\.js"><\/script>/, `<script>${varsling}</script>`)
    .replace(/<script src="src\/plantilstand\.js"><\/script>/, `<script>${plantilstand}</script>`)
    .replace(/<script src="src\/visning\.js"><\/script>/, `<script>${visning}</script>`);

  const dom = new JSDOM(inlinedHtml, {
    url: 'http://localhost:8765/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    // Frø språk/enhet før noen scripts kjører (head-boot leser localStorage).
    beforeParse(window) {
      try {
        window.localStorage.setItem('eltefritt-lang', lang);
        window.localStorage.setItem('eltefritt-unit', unit);
        // Simuler lagret state fra en tidligere økt (f.eks. gjenopptak av
        // pågående nedtelling): opts.seedState merges ikke, lagres som-er.
        if (opts.seedState) {
          window.localStorage.setItem('eltefritt-state', JSON.stringify(opts.seedState));
        }
      } catch (e) {}
    }
    // Default `resources` setting laster ikke nett-ressurser, så CSS,
    // fonter, bilder og manifest blir bare hoppet over uten feil.
  });
  const { window } = dom;

  // Vent på at inline scripts har kjørt ferdig.
  await new Promise(resolve => {
    if (window.document.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve, { once: true });
  });
  await tick(window, 0);

  return {
    window,
    document: window.document,
    tick: (ms) => tick(window, ms),
    close: () => window.close(),
  };
}

function tick(window, ms = 0) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function fire(window, target, type, init = {}) {
  let event;
  if (type === 'input' || type === 'change') {
    event = new window.Event(type, { bubbles: true, ...init });
  } else if (type === 'click' || type.startsWith('mouse')) {
    event = new window.MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  } else {
    event = new window.Event(type, { bubbles: true, ...init });
  }
  target.dispatchEvent(event);
  return event;
}

module.exports = { loadPage, fire };
