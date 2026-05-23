'use strict';

// Laster index.html inn i jsdom for DOM-tester.
//
// Strategi: les index.html, erstatt <script src="src/logic.js"> med innholdet
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

async function loadPage() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const logic = fs.readFileSync(path.join(ROOT, 'src/logic.js'), 'utf8');

  // Inline logic.js så vi slipper at jsdom prøver å hente den over HTTP.
  const inlinedHtml = html.replace(
    /<script src="src\/logic\.js"><\/script>/,
    `<script>${logic}</script>`
  );

  const dom = new JSDOM(inlinedHtml, {
    url: 'http://localhost:8765/',
    runScripts: 'dangerously',
    pretendToBeVisual: true
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
