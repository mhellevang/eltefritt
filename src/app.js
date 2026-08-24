'use strict';

// Eltefritt-appen: kobler DOM-en i index.html til modulene i src/.
//
// Her ligger bare det som må kjenne DOM-en: hendelseslyttere, steppere,
// applieren som skriver ut en View, nettleser-adapteren Varsling får sine
// effekter gjennom, og innstillingsmenyen. Beslutningene ligger i modulene:
//
//   src/logic.js         oppskrift, hevetider, plan, surdeigskobling
//   src/plantilstand.js  standardverdier, gyldige områder, gjenoppretting
//   src/visning.js       hva siden skal si, som deskriptorer
//   src/varsling.js      alarm-tilstandsmaskinen
//   src/i18n.js          språk, enheter, formatering

(() => {
  const {
    FLOUR_TYPES,
    addMinutes, modeTotalMinutes, riseDoneMinutes, planWindow,
    sourCoupling, adjustedRiseDoneMs
  } = window.EltefrittLogic;

  const { createVarsling } = window.EltefrittVarsling;
  const Plantilstand = window.EltefrittPlantilstand;
  const Visning = window.EltefrittVisning;
  const I18n = window.EltefrittI18n;

  // ---- Språk + temperaturenhet (presentasjonsvalg, separat fra recipe-state,
  // speiler tema sin egen localStorage-nøkkel). Fravær ⇒ gjett fra nettleseren. ----
  const LANG_KEY = 'eltefritt-lang';
  const UNIT_KEY = 'eltefritt-unit';
  function readPref(key, valid, fallback) {
    try { const v = localStorage.getItem(key); if (valid(v)) return v; } catch (e) {}
    return fallback();
  }
  let lang = readPref(LANG_KEY, v => v === 'nb' || v === 'en', () => I18n.detectLang());
  let unit = readPref(UNIT_KEY, v => v === 'c' || v === 'f', () => I18n.detectUnit());
  let t = I18n.createTranslator(lang).t;
  const localeTag = () => I18n.localeTag(lang);

  // ---- State ----
  // Standardverdier, gyldige områder og gjenoppretting ligger i
  // src/plantilstand.js; her holder vi bare den levende staten.
  const STATE_KEY = 'eltefritt-state';
  const state = Plantilstand.defaults();

  // ---- Helpers ----
  const $ = sel => document.querySelector(sel);
  const $$ = sel => document.querySelectorAll(sel);

  // "Nå" går alltid via Date.now(), aldri bare new Date(). Da kan klokka
  // overstyres fra konsoll/test (Date.now = () => ekte + 10 t) og hele
  // appen – plan, dag-etiketter, nedtelling og justering – følger med.
  const nowDate = () => new Date(Date.now());

  // Locale-bevisst tallformatering (erstatter manuell desimal-komma).
  const formatNumber = (n, opts) => I18n.formatNumber(n, localeTag(), opts);
  const formatGrams = (g) => g >= 100
    ? formatNumber(Math.round(g))
    : formatNumber(Math.round(g * 10) / 10, { maximumFractionDigits: 1 });
  const formatTimeHM = (date) => I18n.formatTimeHM(date);

  // Temperatur: modellen er Celsius, visningen konverterer til valgt enhet.
  const fmtTemp = (celsius) => I18n.formatTemp(celsius, unit, localeTag());

  // Deskriptor-params → ferdig-formaterte verdier:
  //   { celsius: N } → temperaturstreng i valgt enhet
  //   number        → locale-formatert tall
  //   ellers        → uendret
  function resolveParams(params) {
    if (!params) return undefined;
    const out = {};
    for (const k in params) {
      const v = params[k];
      if (v && typeof v === 'object' && typeof v.celsius === 'number') out[k] = fmtTemp(v.celsius);
      // "~11" / "under 1": omtrentlig timetall der 0 ikke er meningsfullt.
      else if (v && typeof v === 'object' && typeof v.approxHours === 'number') {
        out[k] = v.approxHours < 1 ? t('sour.recUnder1') : '~' + formatNumber(Math.round(v.approxHours));
      }
      // Nøstet oppslag: en param som selv er en oversatt frase.
      else if (v && typeof v === 'object' && typeof v.i18n === 'string') out[k] = t(v.i18n);
      // Gram-mengde med appens avrundingsregler.
      else if (v && typeof v === 'object' && typeof v.grams === 'number') out[k] = formatGrams(v.grams);
      // Prosent med to desimaler (gjærmengde).
      else if (v && typeof v === 'object' && typeof v.pct2 === 'number') {
        out[k] = formatNumber(v.pct2, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
      // Klokkeslett med dag-etikett når det ikke er i dag.
      else if (v && typeof v === 'object' && typeof v.at === 'number') {
        const d = new Date(v.at);
        const day = dayLabelInfo(d);
        out[k] = formatTimeHM(d) + (day.isToday ? '' : ' ' + day.label);
      }
      else if (typeof v === 'number') out[k] = formatNumber(v);
      else out[k] = v;
    }
    return out;
  }
  // Oversett en deskriptor (nøkkel + evt. temp/tall-params).
  const td = (key, params) => t(key, resolveParams(params));

  // Skriv ut en visnings-slot fra src/visning.js. Én form per måte å vise en
  // verdi på, og ingen beslutninger: alt som varierer er avgjort i viewOf().
  function renderSlot(slot) {
    if (!slot) return '';
    if (Array.isArray(slot)) return slot.map(renderSlot).join('');
    if (slot.text != null) return slot.text;
    if (slot.grams != null) return formatGrams(slot.grams);
    const out = td(slot.key, slot.params);
    return slot.lower ? out.toLowerCase() : out;
  }

  // Dag-etikett (i dag / i morgen / ukedag) med isToday-flagg.
  function dayLabelInfo(date) {
    const info = I18n.dayLabelKey(date, nowDate());
    const label = info.idx != null ? t('day.weekdaysShort')[info.idx] : t(info.key);
    return { label, isToday: info.isToday };
  }

  // ---- Stepper ----
  // Stepper-knapper (− [bar] +) erstatter slidere så vertikal scrolling på mobil
  // ikke krasjer med horisontal drag. Beholder <input type="range"> visuelt
  // skjult for å bevare tastatur og ARIA, og for at eksisterende input-handlers
  // kan kjøre uendret når stepperen dispatcher "input".
  function refreshStepperVisual(input) {
    const stepper = input.closest('.stepper');
    if (!stepper) return;
    const fill = stepper.querySelector('.step-fill');
    if (!fill) return;
    const min = parseFloat(input.min) || 0;
    const max = parseFloat(input.max) || 100;
    const val = parseFloat(input.value) || 0;
    const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
    fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
  }

  function refreshHydrationRecommend(recMin, recMax) {
    const input = $('#hydration');
    const band = $('#hydration-recommend');
    if (!input || !band) return;
    const sliderMin = parseFloat(input.min);
    const sliderMax = parseFloat(input.max);
    const span = sliderMax - sliderMin;
    if (span <= 0) return;
    const clampedMin = Math.max(sliderMin, Math.min(sliderMax, recMin));
    const clampedMax = Math.max(sliderMin, Math.min(sliderMax, recMax));
    const leftPct = ((clampedMin - sliderMin) / span) * 100;
    const widthPct = ((clampedMax - clampedMin) / span) * 100;
    band.style.left = leftPct + '%';
    band.style.width = widthPct + '%';
  }

  function attachHoldButton(btn, action) {
    let holdTimer = null;
    let repeatInterval = null;
    let firedOnPointerdown = false;

    const clear = () => {
      clearTimeout(holdTimer);
      clearInterval(repeatInterval);
      holdTimer = repeatInterval = null;
    };

    btn.addEventListener('pointerdown', (e) => {
      if (btn.disabled) return;
      if (e.button !== undefined && e.button !== 0) return;
      firedOnPointerdown = true;
      action();
      holdTimer = setTimeout(() => {
        repeatInterval = setInterval(() => {
          if (btn.disabled) { clear(); return; }
          action();
        }, 80);
      }, 400);
    });
    btn.addEventListener('pointerup', clear);
    btn.addEventListener('pointerleave', clear);
    btn.addEventListener('pointercancel', clear);
    btn.addEventListener('click', (e) => {
      if (firedOnPointerdown) {
        firedOnPointerdown = false;
        e.preventDefault();
        return;
      }
      if (btn.disabled) return;
      action();
    });
  }

  function initStepper(input) {
    const stepper = input.closest('.stepper');
    if (!stepper) return;
    const minus = stepper.querySelector('[data-step-dir="-1"]');
    const plus = stepper.querySelector('[data-step-dir="1"]');

    const step = (dir) => {
      const before = input.value;
      if (dir > 0) input.stepUp(); else input.stepDown();
      if (input.value !== before) {
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };

    if (minus) attachHoldButton(minus, () => step(-1));
    if (plus) attachHoldButton(plus, () => step(1));

    input.addEventListener('input', () => refreshStepperVisual(input));
    refreshStepperVisual(input);
  }

  // ---- Render ----
  function renderSegment(buttons, currentValue, attr) {
    buttons.forEach(b => {
      const active = b.dataset[attr] == currentValue;
      b.setAttribute('aria-pressed', active);
    });
  }

  // Grytestørrelser forankret i Lahey: originaloppskriften (~400 g mel)
  // anbefaler 4,5–5,5 qt ≈ 4,3–5,2 L, og praktisk erfaring sier at 4 L
  // (23 cm) er passe romslig for 500 g mel (~900 g deig). For liten gryte
  // risikerer at toppen treffer lokket under ovnsspranget; for stor er
  // tilgivende, så tabellen runder heller opp. Brødform: deigen fyller
  // formen ~2/3 før etterheving.
  function setFlourPct(idx, newPct) {
    const n = state.flours.length;
    if (n === 1) {
      state.flours[0].pct = 100;
      return;
    }
    newPct = Math.max(0, Math.min(100, Math.round(newPct)));
    state.flours[idx].pct = newPct;
    // Med 3+ meltyper auto-balanserer vi IKKE. Proporsjonal rebalansering flyttet
    // de andre andelene vekk fra verdiene du nettopp satte, så det ble umulig å
    // treffe f.eks. 85/10/5. Hver glider er nå uavhengig; "Sum"-indikatoren
    // viser når du er i mål på 100 %. (Andelene brukes uansett som forhold:
    // resten av regnestykket normaliserer mot summen.)
    if (n >= 3) return;
    // Med nøyaktig to meltyper er den andre fullt bestemt (komplementet), så her
    // auto-balanserer vi fortsatt - det føles riktig og kan ikke "krangle".
    const remainder = 100 - newPct;
    const others = state.flours.map((_, i) => i).filter(i => i !== idx);
    const otherSum = others.reduce((s, i) => s + state.flours[i].pct, 0);

    if (otherSum === 0) {
      const each = Math.floor(remainder / others.length);
      others.forEach(i => state.flours[i].pct = each);
    } else {
      others.forEach(i => {
        state.flours[i].pct = Math.round((state.flours[i].pct / otherSum) * remainder);
      });
    }
    // Korrigér evt. rundingsfeil ved å justere den siste "andre"
    const total = state.flours.reduce((s, f) => s + f.pct, 0);
    if (total !== 100 && others.length > 0) {
      state.flours[others[others.length - 1]].pct += (100 - total);
    }
  }

  // Med 3+ frie glidere må brukeren selv treffe 100 %. Vis hvor langt unna.
  function renderFlourList() {
    const list = $('#flour-list');
    list.innerHTML = '';
    state.flours.forEach((f, idx) => {
      const row = document.createElement('div');
      row.className = 'flour-row';

      const top = document.createElement('div');
      top.className = 'flour-row-top';

      const select = document.createElement('select');
      select.className = 'flour-type-select';
      Object.keys(FLOUR_TYPES).forEach((key) => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = t('flour.' + key);
        if (key === f.type) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener('change', e => {
        state.flours[idx].type = e.target.value;
        state.hydrationManual = false;
        update();
      });

      const pctLabel = document.createElement('span');
      pctLabel.className = 'flour-pct';
      pctLabel.textContent = `${f.pct}%`;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove-btn';
      removeBtn.setAttribute('aria-label', t('aria.removeFlour'));
      removeBtn.innerHTML = '×';
      if (state.flours.length === 1) {
        removeBtn.style.visibility = 'hidden';
      }
      removeBtn.addEventListener('click', () => {
        state.flours.splice(idx, 1);
        // Re-normaliser etter fjerning
        const total = state.flours.reduce((s, ff) => s + ff.pct, 0);
        if (total > 0 && total !== 100) {
          state.flours.forEach(ff => ff.pct = Math.round((ff.pct / total) * 100));
          const newTotal = state.flours.reduce((s, ff) => s + ff.pct, 0);
          if (newTotal !== 100) state.flours[0].pct += (100 - newTotal);
        }
        state.hydrationManual = false;
        update();
      });

      top.appendChild(select);
      top.appendChild(pctLabel);
      top.appendChild(removeBtn);

      const stepper = document.createElement('div');
      stepper.className = 'stepper';

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'flour-slider visually-hidden';
      slider.min = '0';
      slider.max = '100';
      slider.step = '5';
      slider.value = f.pct;
      slider.setAttribute('aria-label', t('aria.flourShare', { name: t('flour.' + f.type) }));

      const minusBtn = document.createElement('button');
      minusBtn.type = 'button';
      minusBtn.className = 'step-btn';
      minusBtn.setAttribute('data-step-dir', '-1');
      minusBtn.setAttribute('aria-label', t('aria.decrease', { field: t('aria.flourShareField', { name: t('flour.' + f.type) }) }));
      minusBtn.textContent = '−';

      const track = document.createElement('div');
      track.className = 'step-track';
      track.setAttribute('aria-hidden', 'true');
      const fill = document.createElement('div');
      fill.className = 'step-fill';
      track.appendChild(fill);

      const plusBtn = document.createElement('button');
      plusBtn.type = 'button';
      plusBtn.className = 'step-btn';
      plusBtn.setAttribute('data-step-dir', '1');
      plusBtn.setAttribute('aria-label', t('aria.increase', { field: t('aria.flourShareField', { name: t('flour.' + f.type) }) }));
      plusBtn.textContent = '+';

      stepper.appendChild(slider);
      stepper.appendChild(minusBtn);
      stepper.appendChild(track);
      stepper.appendChild(plusBtn);

      if (state.flours.length === 1) {
        slider.disabled = true;
        minusBtn.disabled = true;
        plusBtn.disabled = true;
      }

      slider.addEventListener('input', e => {
        const v = parseInt(e.target.value, 10);
        setFlourPct(idx, v);
        state.hydrationManual = false;
        update({ skipFlourList: true, fromSlider: idx });
      });

      row.appendChild(top);
      row.appendChild(stepper);
      list.appendChild(row);

      initStepper(slider);
    });
  }

  // Melandeler: hele lista bygges på nytt når den kan ha endret form, ellers
  // synkroniseres den eksisterende DOM-en (så en pågående drag ikke brytes).
  function applyFlour(flour, opts) {
    if (!opts.skipFlourList) {
      renderFlourList();
    } else {
      const rows = $('#flour-list').children;
      flour.rows.forEach((f, i) => {
        const row = rows[i];
        if (!row) return;
        const pctLabel = row.querySelector('.flour-pct');
        const slider = row.querySelector('.flour-slider');
        if (pctLabel) pctLabel.textContent = `${f.pct}%`;
        if (slider && i !== opts.fromSlider) {
          slider.value = f.pct;
          refreshStepperVisual(slider);
        }
      });
    }

    const warn = $('#flour-warning');
    warn.textContent = renderSlot(flour.sum);
    warn.classList.toggle('error', flour.sumError);

    const tipEl = $('#flour-tip');
    tipEl.innerHTML = flour.tips.map(tip => `<p>${t(tip.key)}</p>`).join('');

    const wrap = $('#flour-breakdown');
    wrap.innerHTML = '';
    flour.breakdown.forEach(f => {
      const row = document.createElement('div');
      row.className = 'ingredient';
      row.innerHTML = `
        <span class="name">${t('flour.' + f.type)} <span class="sub">${f.pct}%</span></span>
        <span class="amount">${formatGrams(f.grams)} g</span>
      `;
      wrap.appendChild(row);
    });
  }

  function renderInstructions(instructions) {
    const ol = $('#method-list');
    ol.innerHTML = '';
    instructions.forEach(step => {
      const li = document.createElement('li');
      const strong = document.createElement('strong');
      strong.textContent = t(step.titleKey) + ':';
      li.appendChild(strong);
      li.appendChild(document.createTextNode(' ' + td(step.bodyKey, step.params)));
      ol.appendChild(li);
    });
  }

  // Døgnskinnen: skinnefargen følger klokka, så planen viser natta deigen
  // hever gjennom. Knekkpunkter (time, rgb) med lineær blanding mellom dem.
  const RAIL_KEYS = [
    [0,    [56, 63, 105]],   // natt
    [4.5,  [56, 63, 105]],
    [7.5,  [222, 158, 92]],  // morgen
    [10,   [235, 200, 122]], // dag
    [16.5, [235, 200, 122]],
    [19.5, [200, 116, 60]],  // kveld
    [23,   [56, 63, 105]],
    [24,   [56, 63, 105]]
  ];

  function railColor(date) {
    const h = date.getHours() + date.getMinutes() / 60;
    let i = 1;
    while (RAIL_KEYS[i][0] < h) i++;
    const [h0, c0] = RAIL_KEYS[i - 1];
    const [h1, c1] = RAIL_KEYS[i];
    const f = (h - h0) / (h1 - h0);
    const c = c0.map((v, j) => Math.round(v + (c1[j] - v) * f));
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  }

  // Dag-etiketter håndteres av dayLabelInfo() (i18n) lenger oppe i scriptet.
  // Planvinduet (start/ferdig ut fra anker og modus) ligger i logic.js.
  const getStartAndReady = () => planWindow(state, Date.now());

  function renderPlan(plan) {
    const { start, ready, items } = plan;
    const startInput = $('#start-time');
    const readyInput = $('#ready-time');
    if (document.activeElement !== startInput) startInput.value = formatTimeHM(start);
    if (document.activeElement !== readyInput) readyInput.value = formatTimeHM(ready);
    $('#start-day').textContent = dayLabelInfo(start).label;
    $('#ready-day').textContent = dayLabelInfo(ready).label;
    $('#start-dot').style.background = railColor(start);
    $('#ready-dot').style.background = railColor(ready);

    const stepsEl = $('#plan-steps');
    stepsEl.innerHTML = '';
    const stepEls = [];
    items.forEach(item => {
      if (item.kind === 'duration') {
        const d = document.createElement('div');
        d.className = 'plan-duration';
        d.textContent = td(item.key, item.params);
        stepsEl.appendChild(d);
      } else {
        const s = document.createElement('div');
        s.className = 'plan-step';
        const day = dayLabelInfo(item.time);
        const dayHtml = day.isToday ? '' : ` <span class="plan-day">${day.label}</span>`;
        s.innerHTML = `
          <span class="plan-dot" aria-hidden="true" style="background: ${railColor(item.time)}"></span>
          <span class="plan-label">${t(item.labelKey)}</span>
          <span class="plan-time">${formatTimeHM(item.time)}${dayHtml}</span>
        `;
        stepsEl.appendChild(s);
        stepEls.push([s, item.time]);
      }
    });

    // Gradienten forankres i start (topp), hvert steg og klar (bunn); mellom
    // ankrene samples fargen omtrent time for time, så natta blir synlig midt
    // i lange hevestrekk selv uten steg der.
    const totalH = stepsEl.offsetHeight;
    if (!totalH) return;
    const anchors = [[0, start]];
    stepEls.forEach(([el, time]) => {
      anchors.push([(el.offsetTop + el.offsetHeight / 2) / totalH, time]);
    });
    anchors.push([1, ready]);
    const stops = [];
    for (let i = 0; i < anchors.length - 1; i++) {
      const [p0, t0] = anchors[i];
      const [p1, t1] = anchors[i + 1];
      const spanMs = t1 - t0;
      const n = Math.max(1, Math.min(24, Math.round(spanMs / 3600000)));
      for (let k = 0; k < n; k++) {
        const f = k / n;
        const at = new Date(t0.getTime() + spanMs * f);
        stops.push(`${railColor(at)} ${((p0 + (p1 - p0) * f) * 100).toFixed(1)}%`);
      }
    }
    stops.push(`${railColor(ready)} 100%`);
    stepsEl.style.setProperty('--rail', `linear-gradient(to bottom, ${stops.join(', ')})`);
  }

  // ---- Alarm / nedtelling ----
  // En ren web-app kan ikke pålitelig fyre en alarm hvis fanen er lukket i
  // timevis (Notification Triggers er Chrome-only og eksperimentelt). Derfor:
  // live nedtelling + varsel/lyd/vibrasjon når hevingen er ferdig, så lenge
  // fanen er åpen (også i bakgrunnen), med Web Push som backup når den ikke er.
  //
  // Selve tilstandsmaskinen (armert → fyrt → kvittert, gjentakelse, oppgi,
  // push-forsoning) ligger i src/varsling.js. Her bygges bare nettleser-
  // adapteren den kjører effektene sine gjennom.
  const baseTitle = () => t('doc.title');

  function alarmSupported() { return typeof Notification !== 'undefined'; }
  function alarmPermission() { return alarmSupported() ? Notification.permission : 'unsupported'; }

  // "12 t 34 min 05 sek" / "45 min 05 sek" / "5 sek" i valgt locale. Sekunder
  // (og minutter under en time) nullpolstres til to siffer så bredden ikke
  // hopper mens den tikker. Math.ceil så den teller ned til null uten å henge
  // på "0 sek" før alarmen faktisk går.
  function formatDuration(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = n => String(n).padStart(2, '0');
    if (h > 0) return `${formatNumber(h)} ${t('unit.hours')} ${pad(m)} ${t('unit.min')} ${pad(s)} ${t('unit.sec')}`;
    if (m > 0) return `${formatNumber(m)} ${t('unit.min')} ${pad(s)} ${t('unit.sec')}`;
    return `${formatNumber(s)} ${t('unit.sec')}`;
  }

  // Frys/re-frys starten som absolutt tidspunkt. Kalles når alarmen slås på
  // og når brukeren flytter ankeret mens den er på.
  function refreezeAnchor() {
    state.anchorDateMs = null;
    if (state.alarm) state.anchorDateMs = getStartAndReady().start.getTime();
  }

  // Justert bulk-slutt når "faktisk temp så langt" er satt. null = ingen
  // justering aktiv; kan ligge i fortid når deigen er over budsjett, og da
  // settes alarmen som allerede utløst.
  function adjustedRiseDoneDate() {
    const ms = adjustedRiseDoneMs(state, Date.now());
    return ms == null ? null : new Date(ms);
  }

  function alarmTargetDate() {
    const adjusted = adjustedRiseDoneDate();
    if (adjusted) return adjusted;
    const { start } = getStartAndReady();
    return addMinutes(start, riseDoneMinutes(state));
  }

  // ---- Nettleser-adapter for Varsling ----
  let audioCtx = null;        // opprettes ved brukergest (toggle på) for å omgå autoplay-sperre
  let titleFlashTimer = null; // blinker fane-tittel til brukeren ser den

  // Opprett/vekk audio-context. Må skje i en brukergest for at pip skal være
  // tillatt (autoplay-sperre); kalles fra alarm-toggle og, for gjenopptatte
  // nedtellinger, fra første interaksjon etter oppstart.
  function warmAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { if (!audioCtx) audioCtx = new AC(); if (audioCtx.state === 'suspended') audioCtx.resume(); }
    } catch (e) {}
  }

  function playBeeps() {
    if (!audioCtx) return;
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const now = audioCtx.currentTime;
      // To grupper: pip-pip-pip … pip-pip. Triangelbølge bærer bedre enn
      // sinus, og siste tone i hver gruppe ligger en kvart opp for å skjære
      // gjennom bakgrunnsstøy.
      [[0, 880], [0.35, 880], [0.7, 1109], [1.3, 880], [1.65, 1109]].forEach(([offset, freq]) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.45, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.28);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.3);
      });
    } catch (e) {}
  }

  function vibrateBurst() {
    if (navigator.vibrate) { try { navigator.vibrate([300, 150, 300, 150, 300]); } catch (e) {} }
  }

  // App-badge på ikonet (dock/oppgavelinje/hjemskjerm) når alarmen har gått.
  // Erstatter tittel-blinkingen i installert PWA-modus, der det ikke finnes
  // noen fanetittel å blinke i. No-op der API-et ikke støttes.
  function setBadge(on) {
    try {
      if (!('setAppBadge' in navigator)) return;
      if (on) navigator.setAppBadge(); else navigator.clearAppBadge();
    } catch (e) {}
  }

  function flashTitle(on) {
    if (!on) {
      if (titleFlashTimer) { clearInterval(titleFlashTimer); titleFlashTimer = null; }
      document.title = baseTitle();
      return;
    }
    if (titleFlashTimer) return;
    let lit = false;
    titleFlashTimer = setInterval(() => {
      lit = !lit;
      document.title = lit ? '⏰ ' + t('alarm.done') : baseTitle();
    }, 1000);
  }

  // Chrome på Android tillater ikke Notification-konstruktøren i sidekontekst
  // ("Illegal constructor"); gå via service workeren der en finnes, så virker
  // varselet overalt og klikk håndteres av sw.js (som også kan gjenåpne appen).
  // Konstruktør-fallback dekker kjøring uten SW (f.eks. åpnet fra fil).
  async function showAlarmNotification() {
    const opts = {
      body: t('alarm.notify.body'),
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: 'eltefritt-rise',
      renotify: true,
      // Bli stående til brukeren lukker varselet (der nettleseren støtter det).
      requireInteraction: true
    };
    const reg = 'serviceWorker' in navigator
      ? await navigator.serviceWorker.getRegistration() : null;
    if (reg) return reg.showNotification(t('alarm.notify.title'), opts);
    const n = new Notification(t('alarm.notify.title'), opts);
    n.onclick = () => { try { window.focus(); } catch (e) {} n.close(); };
  }

  // ---- Web Push (valgfritt) ----
  // Det lokale varselet krever åpen fane/app; Web Push vekker service
  // workeren selv når appen er lukket. Krever en deployet push-server
  // (se push-server/README.md). Tomme konstanter = hele funksjonen av,
  // og alarmen virker som før.
  const PUSH_SERVER = 'https://eltefritt-push.mathias-hellevang.workers.dev';
  const VAPID_PUBLIC_KEY = 'BC5ZLEJHjx7LG_km01geRtEK0h-YdMgyWJP4IF0RuM-KIU_jH0Xil6SL--bBs-m0S1WWBHJlH5X_rgk7L7CNDII';  // offentlig nøkkel fra nøkkelgenereringen i README

  function pushEnabled() {
    return !!(PUSH_SERVER && VAPID_PUBLIC_KEY &&
      'serviceWorker' in navigator && 'PushManager' in window);
  }

  // Speil språkvalget til en cache service workeren kan lese (den har ikke
  // localStorage), så push-varselet fra sw.js kommer på riktig språk.
  function persistLangForSW() {
    if (!('caches' in window)) return;
    caches.open('eltefritt-prefs')
      .then(c => c.put('./__lang', new Response(lang)))
      .catch(() => {});
  }

  function vapidKeyBytes() {
    const s = VAPID_PUBLIC_KEY;
    const pad = '='.repeat((4 - s.length % 4) % 4);
    const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }

  // Sender ett ønske til push-serveren og sier om det gikk. targetMs = null
  // avbestiller. Forsoningen (hva som er ønsket vs. bekreftet, ett kall om
  // gangen, nytt forsøk ved feil) ligger i Varsling.
  async function pushSend(targetMs) {
    const reg = await navigator.serviceWorker.ready;
    if (targetMs == null) {
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return true;  // ingenting å avbestille
      const res = await fetch(PUSH_SERVER + '/cancel', {
        method: 'POST',
        body: JSON.stringify({ endpoint: sub.endpoint })
      });
      return res.ok;
    }
    const sub = await reg.pushManager.getSubscription() ||
      await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes() });
    const res = await fetch(PUSH_SERVER + '/schedule', {
      method: 'POST',
      body: JSON.stringify({ subscription: sub.toJSON(), fireAtMs: targetMs })
    });
    return res.ok;
  }

  const varsling = createVarsling({
    now: () => Date.now(),
    permission: alarmPermission,
    notify: showAlarmNotification,
    beep: playBeeps,
    vibrate: vibrateBurst,
    badge: setBadge,
    titleFlash: flashTitle,
    pushEnabled,
    pushSend
  });

  // Skriver nedtellings-/statuslinja i #alarm-detail ut fra alarmstatusen.
  function refreshCountdown(st) {
    const el = $('#alarm-detail');
    el.classList.remove('is-active', 'is-done');
    if (st.fired) {
      el.textContent = t('alarm.done');
      el.classList.add('is-done');
      return;
    }
    if (alarmPermission() === 'denied') {
      el.textContent = t('alarm.countdown', { dur: formatDuration(st.remainingMs) }) + ' · ' + t('alarm.blocked');
    } else {
      el.textContent = t('alarm.countdown', { dur: formatDuration(st.remainingMs) });
    }
    el.classList.add('is-active');
  }

  // Kalles fra update(): synk toggle-knapper og (re)arm målet ut fra planen.
  function renderAlarm() {
    renderSegment($$('.seg button[data-alarm]'), state.alarm ? 'on' : 'off', 'alarm');
    const el = $('#alarm-detail');
    if (!state.alarm) {
      varsling.disarm();
      el.classList.remove('is-active', 'is-done');
      el.textContent = t('alarm.help');
      return;
    }
    refreshCountdown(varsling.arm(alarmTargetDate().getTime()));
  }

  // 1 Hz-tikk: oppdater nedtelling og la Varsling fyre når tiden er ute.
  setInterval(() => {
    if (!state.alarm) return;
    const st = varsling.tick();
    if (st.armed) refreshCountdown(st);
  }, 1000);

  // Kvitter alarmen ved første interaksjon (fanger også Av-knappen og
  // juster-stepperen; å røre appen er å ha fått den med seg).
  ['pointerdown', 'keydown'].forEach(ev =>
    document.addEventListener(ev, () => varsling.acknowledge(), { capture: true }));

  // Stopp blinking og gjentatt piping når brukeren kommer tilbake til fanen.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) varsling.seen();
  });

  document.addEventListener('pointerdown', () => { if (state.alarm) warmAudio(); }, { capture: true });

  // En bake pågår når den frosne starten er passert og alarmen ikke har gått;
  // da betyr "Av" å forkaste den (av så på re-ankrer til en ny plan).
  function bakeInProgress() {
    return state.anchorDateMs != null && state.anchorDateMs <= Date.now() && !varsling.status().fired;
  }

  function setAlarm(on) {
    if (!on && state.alarm && bakeInProgress() && !window.confirm(t('alarm.confirmOff'))) {
      return;
    }
    if (on && !state.alarm) {
      warmAudio();
      // Be om varselstillatelse (ufarlig om den allerede er avgjort).
      if (alarmSupported() && Notification.permission === 'default') {
        try { Notification.requestPermission().then(() => update({ skipFlourList: true })); } catch (e) {}
      }
    }
    state.alarm = on;
    if (!on) state.actualTempC = null;
    refreezeAnchor();
    update({ skipFlourList: true });
  }

  // "Juster underveis": synlig mens en klassisk bulk pågår med alarmen på.
  // Stepperen viser faktisk temp så langt; avviker den fra planlagt temp,
  // regnes gjenstående tid om og alarmen re-armeres (via alarmTargetDate).
  // Hva som skal stå der er avgjort i viewOf().
  function applyAdjust(adjust) {
    $('#adjust-field').hidden = !adjust.active;
    if (!adjust.active) return;
    const input = $('#adjust-temp');
    if (document.activeElement !== input) {
      input.value = adjust.shownTempC;
      refreshStepperVisual(input);
    }
    renderTempReadout('adjust-temp-value', adjust.shownTempC);
    $('#adjust-detail').textContent = renderSlot(adjust.note);
  }

  // Temperatur-avlesning: tall i valgt enhet + enhets-suffiks (°C/°F). Modellen
  // forblir Celsius; bare visningen konverteres.
  function renderTempReadout(id, celsius) {
    const el = $('#' + id);
    if (!el) return;
    el.textContent = I18n.convertTemp(celsius, unit);
    const u = el.nextElementSibling;
    if (u && u.classList.contains('temp-unit')) u.textContent = unit === 'f' ? '°F' : '°C';
  }

  // Slider-markører: temp-markører konverteres til enhet, tid-markører får
  // locale-tall + lokalisert time-enhet.
  function renderMarks() {
    $$('[data-temp-mark]').forEach(el => {
      el.textContent = I18n.convertTemp(parseFloat(el.getAttribute('data-temp-mark')), unit) + '°';
    });
    $$('[data-time-mark]').forEach(el => {
      el.textContent = formatNumber(parseFloat(el.getAttribute('data-time-mark'))) + ' ' + t('unit.hours');
    });
  }

  // Statiske stepper-knapper: bygg "Reduser/Øk <felt>"-aria fra feltnøkkel.
  const STEPPER_FIELD = {
    'hydration': 'aria.field.hydration',
    'temp': 'aria.field.roomTemp',
    'water-temp': 'aria.field.waterTemp',
    'rise-time': 'aria.field.bulk',
    'bulk-time': 'aria.field.bulk',
    'cold-time': 'aria.field.coldProof',
    'cold-temp': 'aria.field.coldTemp',
    'sour-inoculation': 'aria.field.sourAmount',
    'adjust-temp': 'aria.field.adjustTemp'
  };
  function localizeStaticSteppers() {
    $$('[data-stepper-for]').forEach(st => {
      const fieldKey = STEPPER_FIELD[st.getAttribute('data-stepper-for')];
      if (!fieldKey) return;
      const field = t(fieldKey);
      const minus = st.querySelector('[data-step-dir="-1"]');
      const plus = st.querySelector('[data-step-dir="1"]');
      if (minus) minus.setAttribute('aria-label', t('aria.decrease', { field }));
      if (plus) plus.setAttribute('aria-label', t('aria.increase', { field }));
    });
  }

  // Lokaliser all statisk tekst (data-i18n*), dokument-metadata, hjelpetekster
  // med temp-params, og stepper-aria. Kjøres ved oppstart og språk/enhet-bytte.
  function applyStaticI18n() {
    document.documentElement.lang = lang;
    document.title = t('doc.title');
    const md = document.querySelector('meta[name="description"]');
    if (md) md.setAttribute('content', t('doc.metaDescription'));
    $$('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
    $$('[data-i18n-aria-label]').forEach(el => { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label'))); });
    $$('[data-i18n-title]').forEach(el => { el.setAttribute('title', t(el.getAttribute('data-i18n-title'))); });
    // Hjelpetekster med temperatur-param (avhenger av enhet).
    const wt = $('#water-temp-detail');
    if (wt) wt.textContent = t('helper.waterTemp', { maxTemp: fmtTemp(40) });
    const sa = $('#sour-amount-detail');
    if (sa) sa.textContent = t('helper.sourAmount', { temp: fmtTemp(21) });
    localizeStaticSteppers();
    // Kjøres ved oppstart og hvert språkbytte: riktig sted å synke SW-språket.
    persistLangForSW();
  }

  // Bygg oversetter på nytt og re-rendre alt ved språk/enhet-bytte.
  function rerenderAll() {
    t = I18n.createTranslator(lang).t;
    applyStaticI18n();
    update();
  }

  // Skriver ut en ferdig View. Ingen beslutninger her: alt som varierer med
  // state er avgjort i viewOf(), og alt som varierer med språk/enhet i
  // renderSlot/renderTempReadout.
  function apply(view, opts) {
    Object.entries(view.text).forEach(([id, slot]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = renderSlot(slot);
    });
    Object.entries(view.hidden).forEach(([id, isHidden]) => {
      const el = document.getElementById(id);
      if (el) el.hidden = isHidden;
    });
    Object.entries(view.temps).forEach(([id, celsius]) => renderTempReadout(id, celsius));
    Object.entries(view.values).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = value;
      refreshStepperVisual(el);
    });

    refreshHydrationRecommend(view.hydrationBand.min, view.hydrationBand.max);
    renderMarks();
    renderInstructions(view.instructions);
    applyFlour(view.flour, opts);
    renderPlan(view.plan);
    renderAlarm();
    applyAdjust(view.adjust);
  }

  function saveState() {
    try { localStorage.setItem(STATE_KEY, Plantilstand.serialize(state)); } catch (e) {}
  }

  function update(opts = {}) {
    Visning.normalize(state);
    apply(Visning.viewOf(state, Date.now()), opts);
    saveState();
  }

  // ---- Surdeig-kobling ----
  // Når leaven=sourdough koples inokulering og bulk-tid sammen. Beslutningen
  // (hvilket felt som følger, hvilken verdi, om anbefalingen ble klampet og
  // hvilket hint som gjelder) ligger i sourCoupling() i logic.js; her skrives
  // den bare ut. Grensene kommer fra FIELDS, ikke fra DOM-en.
  function resyncSourFromLead() {
    if (state.leaven !== 'sourdough') return;
    const d = sourCoupling(state, Plantilstand.FIELDS);
    state[d.field] = d.value;
    const input = document.getElementById(Plantilstand.FIELDS[d.field].inputId);
    if (input) {
      input.value = d.value;
      refreshStepperVisual(input);
    }
    // Når anbefalingen klampes til feltets grenser, si fra i stedet for å
    // late som om den klampede verdien er anbefalt.
    const note = $('#sour-clamp-note');
    note.hidden = !d.note;
    note.textContent = d.note ? td(d.note.key, d.note.params) : '';
  }

  // ---- Wire up controls ----
  $$('.seg button[data-loaves]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.loaves = parseInt(btn.dataset.loaves, 10);
      renderSegment($$('.seg button[data-loaves]'), state.loaves, 'loaves');
      update();
    });
  });

  $$('.seg button[data-size]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.sizePerLoaf = parseInt(btn.dataset.size, 10);
      renderSegment($$('.seg button[data-size]'), state.sizePerLoaf, 'size');
      $('#size-custom-input').value = state.sizePerLoaf;
      update();
    });
  });

  $('#size-custom-input').addEventListener('input', e => {
    const size = Plantilstand.FIELDS.sizePerLoaf;
    const v = parseInt(e.target.value, 10);
    if (!Number.isFinite(v) || v < size.min || v > size.max) return;
    state.sizePerLoaf = v;
    renderSegment($$('.seg button[data-size]'), state.sizePerLoaf, 'size');
    update();
  });

  $('#hydration').addEventListener('input', e => {
    state.hydration = parseInt(e.target.value, 10);
    state.hydrationManual = true;
    update();
  });

  $('#temp').addEventListener('input', e => {
    const newRoom = parseInt(e.target.value, 10);
    state.temperatureC = newRoom;
    // Vannet følger romtemp til brukeren eksplisitt setter en egen verdi.
    if (!state.waterTempManual) {
      state.waterTempC = newRoom;
      $('#water-temp').value = newRoom;
      refreshStepperVisual($('#water-temp'));
    }
    resyncSourFromLead();
    update();
  });

  $('#water-temp').addEventListener('input', e => {
    state.waterTempC = parseInt(e.target.value, 10);
    // Settes vannet tilbake til romtemp, begynner det å følge igjen.
    state.waterTempManual = state.waterTempC !== state.temperatureC;
    update({ skipFlourList: true });
  });

  // Inline-stepperen i oppskriftens vannrad driver samme #water-temp-input,
  // så clamp (5–40) og manuell-flagget gjenbrukes via input-eventet.
  {
    const input = $('#water-temp');
    const inline = $('.water-temp-inline');
    const step = (dir) => {
      const before = input.value;
      if (dir > 0) input.stepUp(); else input.stepDown();
      if (input.value !== before) {
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };
    attachHoldButton(inline.querySelector('[data-step-dir="-1"]'), () => step(-1));
    attachHoldButton(inline.querySelector('[data-step-dir="1"]'), () => step(1));
  }

  $('#rise-time').addEventListener('input', e => {
    state.riseHours = parseInt(e.target.value, 10);
    if (state.leaven === 'sourdough') {
      state.sourLead = 'time';
      resyncSourFromLead();
    }
    update();
  });

  $$('.seg button[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.mode = btn.dataset.mode;
      renderSegment($$('.seg button[data-mode]'), state.mode, 'mode');
      // Når bulk-slideren bytter (riseHours ↔ bulkHours), må surdeig-koblingen re-synces.
      resyncSourFromLead();
      update();
    });
  });

  $('#bulk-time').addEventListener('input', e => {
    state.bulkHours = parseInt(e.target.value, 10);
    if (state.leaven === 'sourdough') {
      state.sourLead = 'time';
      resyncSourFromLead();
    }
    update({ skipFlourList: true });
  });

  $('#cold-time').addEventListener('input', e => {
    state.coldHours = parseInt(e.target.value, 10);
    // Kjøleskapsfasen inngår i surdeigskoblingen; oppdater følgeren.
    resyncSourFromLead();
    update({ skipFlourList: true });
  });

  $('#cold-temp').addEventListener('input', e => {
    state.coldTempC = parseInt(e.target.value, 10);
    resyncSourFromLead();
    update({ skipFlourList: true });
  });

  $('#sour-inoculation').addEventListener('input', e => {
    state.sourInoculation = parseInt(e.target.value, 10);
    state.sourLead = 'inoculation';
    resyncSourFromLead();
    update({ skipFlourList: true });
  });

  $$('.seg button[data-leaven]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.leaven = btn.dataset.leaven;
      renderSegment($$('.seg button[data-leaven]'), state.leaven, 'leaven');
      // Når man bytter TIL surdeig, juster bulk eller inokulering til å matche lederen.
      resyncSourFromLead();
      update();
    });
  });

  $$('.seg button[data-alarm]').forEach(btn => {
    btn.addEventListener('click', () => setAlarm(btn.dataset.alarm === 'on'));
  });

  $('#adjust-temp').addEventListener('input', e => {
    const v = parseInt(e.target.value, 10);
    // Tilbake på planlagt temp = ingen justering.
    state.actualTempC = v === state.temperatureC ? null : v;
    update({ skipFlourList: true });
  });

  $('#start-time').addEventListener('input', e => {
    if (!e.target.value) return;
    state.timeAnchor = 'start';
    state.anchorTime = e.target.value;
    refreezeAnchor();
    update({ skipFlourList: true });
  });

  // Ny klar-tid betyr "jeg vil ha brødet klart da", ikke "flytt hele planen":
  // starten står fast og hevetiden strekkes/krympes i stedet (klassisk: bulk,
  // kald: kjøleskapsfasen). Først når ønsket tid krever en hevetid utenfor
  // sliderens grenser, ankres planen på klar-tiden og starten flyttes (som før).
  $('#ready-time').addEventListener('input', e => {
    if (!e.target.value) return;
    const { start } = getStartAndReady();
    const total = modeTotalMinutes(state);
    const [hh, mm] = e.target.value.split(':').map(Number);
    const sameDay = new Date(start);
    sameDay.setHours(hh, mm, 0, 0);
    // HH:MM er tvetydig over døgngrenser (kald modus kan passere 24 t):
    // velg døgn-kandidaten som ligger nærmest dagens totaltid.
    const diffMin = Math.round((sameDay - start) / 60000);
    let gap = null;
    for (let k = 0; k <= 2; k++) {
      const cand = diffMin + k * 24 * 60;
      if (cand <= 0) continue;
      if (gap === null || Math.abs(cand - total) < Math.abs(gap - total)) gap = cand;
    }
    const slider = state.mode === 'cold' ? $('#cold-time') : $('#rise-time');
    const curHours = state.mode === 'cold' ? state.coldHours : state.riseHours;
    const fixedMin = total - curHours * 60;
    const newHours = Math.round((gap - fixedMin) / 60);

    if (newHours >= parseInt(slider.min, 10) && newHours <= parseInt(slider.max, 10)) {
      slider.value = newHours;
      refreshStepperVisual(slider);
      if (state.mode === 'cold') {
        state.coldHours = newHours;
        resyncSourFromLead();
      } else {
        state.riseHours = newHours;
        if (state.leaven === 'sourdough') {
          state.sourLead = 'time';
          resyncSourFromLead();
        }
      }
      state.timeAnchor = 'start';
      state.anchorTime = formatTimeHM(start);
    } else {
      state.timeAnchor = 'ready';
      state.anchorTime = e.target.value;
      // Starten flyttes; det frosne ankeret må følge med.
      refreezeAnchor();
    }
    update({ skipFlourList: true });
  });

  $('#now-btn').addEventListener('click', () => {
    const now = nowDate();
    state.timeAnchor = 'start';
    state.anchorTime = formatTimeHM(now);
    refreezeAnchor();
    update({ skipFlourList: true });
  });

  $('#add-flour-btn').addEventListener('click', () => {
    // Gi den nye meltypen ~1/(n+1) av andelen, og skaler eksisterende proporsjonalt ned.
    const initialNewPct = Math.round(100 / (state.flours.length + 1));
    const scale = (100 - initialNewPct) / 100;
    state.flours.forEach(f => f.pct = Math.round(f.pct * scale));
    const used = new Set(state.flours.map(f => f.type));
    const nextType = Object.keys(FLOUR_TYPES).find(k => !used.has(k)) || 'sammalt';
    state.flours.push({ type: nextType, pct: initialNewPct });
    // Rett opp rundingsfeil
    const total = state.flours.reduce((s, f) => s + f.pct, 0);
    if (total !== 100) state.flours[0].pct += (100 - total);
    state.hydrationManual = false;
    update();
  });

  // ---- Innstillingsmeny: språk + temperaturenhet + tema ----
  // Tema beholder samme localStorage-nøkkel og pre-paint-boot som før; her
  // flyttes bare kontrollen inn i den samlede menyen.
  const THEME_KEY = 'eltefritt-theme';
  function currentTheme() {
    try { const v = localStorage.getItem(THEME_KEY); return (v === 'light' || v === 'dark') ? v : 'auto'; }
    catch (e) { return 'auto'; }
  }
  function syncThemeColorMeta(choice) {
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
      if (choice === 'light' || choice === 'dark') {
        m.setAttribute('content', choice === 'dark' ? '#191713' : '#f1efe9');
      } else {
        const media = m.getAttribute('media') || '';
        m.setAttribute('content', media.includes('dark') ? '#191713' : '#f1efe9');
      }
    });
  }
  function applyTheme(choice) {
    try {
      if (choice === 'light' || choice === 'dark') {
        localStorage.setItem(THEME_KEY, choice);
        document.documentElement.setAttribute('data-theme', choice);
      } else {
        localStorage.removeItem(THEME_KEY);
        document.documentElement.removeAttribute('data-theme');
      }
    } catch (e) {}
    syncThemeColorMeta(choice);
  }
  function syncSettingsSelected() {
    renderSegment($$('#settings-menu [data-lang-value]'), lang, 'langValue');
    renderSegment($$('#settings-menu [data-unit-value]'), unit, 'unitValue');
    renderSegment($$('#settings-menu [data-theme-value]'), currentTheme(), 'themeValue');
  }

  const settingsBtn = $('#settings-btn');
  const settingsMenu = $('#settings-menu');
  const settingsOpen = () => settingsMenu.getAttribute('data-open') === 'true';
  const openSettings = () => { settingsMenu.setAttribute('data-open', 'true'); settingsBtn.setAttribute('aria-expanded', 'true'); };
  const closeSettings = () => { settingsMenu.removeAttribute('data-open'); settingsBtn.setAttribute('aria-expanded', 'false'); };
  settingsBtn.addEventListener('click', e => { e.stopPropagation(); settingsOpen() ? closeSettings() : openSettings(); });
  document.addEventListener('click', e => {
    if (settingsOpen() && !settingsMenu.contains(e.target) && !settingsBtn.contains(e.target)) closeSettings();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && settingsOpen()) { closeSettings(); settingsBtn.focus(); }
  });

  $$('#settings-menu [data-lang-value]').forEach(b => b.addEventListener('click', () => {
    lang = b.dataset.langValue;
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
    rerenderAll();
    syncSettingsSelected();
  }));
  $$('#settings-menu [data-unit-value]').forEach(b => b.addEventListener('click', () => {
    unit = b.dataset.unitValue;
    try { localStorage.setItem(UNIT_KEY, unit); } catch (e) {}
    rerenderAll();
    syncSettingsSelected();
  }));
  $$('#settings-menu [data-theme-value]').forEach(b => b.addEventListener('click', () => {
    applyTheme(b.dataset.themeValue);
    syncSettingsSelected();
  }));

  // ---- Gjenoppretting ----
  // Plantilstand validerer lagret state feltvis, migrerer gammel form og
  // avgjør om en pågående nedtelling skal gjenopptas.
  // NB: lyd krever brukergest, så en gjenopptatt alarm piper først etter at
  // brukeren har rørt appen (warmAudio); varsel/vibrasjon/badge går uansett.
  {
    let raw = null;
    try { raw = localStorage.getItem(STATE_KEY); } catch (e) {}
    Object.assign(state, Plantilstand.load(raw, Date.now()).state);
  }

  // Synkroniser DOM-kontrollene med gjenopprettet state. Sliderne arver
  // grensene sine fra FIELDS, så det finnes bare én kopi av hvert område.
  renderSegment($$('.seg button[data-loaves]'), state.loaves, 'loaves');
  renderSegment($$('.seg button[data-size]'), state.sizePerLoaf, 'size');
  renderSegment($$('.seg button[data-mode]'), state.mode, 'mode');
  renderSegment($$('.seg button[data-leaven]'), state.leaven, 'leaven');
  Object.entries(Plantilstand.FIELDS).forEach(([name, f]) => {
    if (!f.inputId || f.min == null) return;
    const el = document.getElementById(f.inputId);
    if (!el) return;
    el.min = f.min;
    el.max = f.max;
    if (state[name] != null) el.value = state[name];
  });

  // Init steppers etter at input.value er satt (initStepper synker visualet)
  ['hydration', 'temp', 'water-temp', 'rise-time', 'bulk-time', 'cold-time', 'cold-temp', 'sour-inoculation', 'adjust-temp'].forEach(id => {
    const inp = document.getElementById(id);
    if (inp) initStepper(inp);
  });

  // Gjenopprettet surdeig-state kan være lagret med en eldre kobling-formel;
  // resync så følgeren (og evt. klampe-hint) stemmer med dagens modell.
  resyncSourFromLead();

  // Lokaliser statisk tekst og marker valgt språk/enhet/tema, før første render.
  applyStaticI18n();
  syncSettingsSelected();

  update();
})();
