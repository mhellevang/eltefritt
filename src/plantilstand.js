'use strict';

// Plantilstand: én modul som eier formen på bakeplanens state.
//
// Feltbordet FIELDS er den eneste kopien av hvert gyldige område. Både
// gjenopprettingen (som må kunne avvise korrupt eller utdatert lagret state)
// og sliderne i index.html henter grensene herfra, så de ikke kan drifte fra
// hverandre.
//
// Grensesnitt:
//   FIELDS             feltbord: standardverdi, gyldig område, evt. input-id
//   defaults()         fersk state
//   load(raw, nowMs)   → { state, resumed }. raw = lagret JSON-streng (eller
//                        null). Migrerer, validerer og avgjør om en pågående
//                        nedtelling skal gjenopptas.
//   serialize(state)   → streng for lagring
//
// Rene funksjoner: ingen localStorage, ingen DOM. Appen leser og skriver
// lageret; modulen bestemmer hva som er gyldig.

(function (globalScope) {
  const isNode = typeof module !== 'undefined' && !!module.exports;
  const Logic = isNode ? require('./logic.js') : globalScope.EltefrittLogic;
  const I18n = isNode ? require('./i18n.js') : globalScope.EltefrittI18n;

  // Gjenoppta en pågående nedtelling så lenge starten ikke ligger absurd
  // langt frem og planlagt ferdigtid (inkl. steking) ikke er passert.
  const RESUME_LOOKAHEAD_MS = 48 * 3600 * 1000;

  // num: tallfelt med gyldig område. oneOf: fast verdisett. bool: flagg.
  // inputId: DOM-kontrollen som skal arve området (index.html setter min/max).
  const FIELDS = {
    loaves:          { oneOf: [1, 2, 3, 4], default: 1 },
    sizePerLoaf:     { min: 100, max: 3000, default: 500, inputId: 'size-custom-input' },
    hydration:       { min: 60, max: 95, default: 75, inputId: 'hydration' },
    hydrationManual: { bool: true, default: false },
    // Romtemp. Alt av gjæring regnes mot denne.
    temperatureC:    { min: 15, max: 28, default: 21, inputId: 'temp' },
    // Vanntemp. Default = romtemp; slutter å følge når brukeren setter den selv.
    waterTempC:      { min: 5, max: 40, default: 21, inputId: 'water-temp' },
    waterTempManual: { bool: true, default: false },
    // Hevemodus: påvirker tidsplanen.
    mode:            { oneOf: () => Object.keys(Logic.MODE_META), default: 'classic' },
    // Heveform: påvirker ingrediensene.
    leaven:          { oneOf: ['dry', 'fresh', 'sourdough'], default: 'dry' },
    riseHours:       { min: 4, max: 24, default: 14, inputId: 'rise-time' },    // classic
    bulkHours:       { min: 1, max: 6, default: 2, inputId: 'bulk-time' },      // cold
    coldHours:       { min: 6, max: 36, default: 12, inputId: 'cold-time' },    // cold
    // Default 6 °C: typisk norsk kjøleskap ligger nærmere 5-6 °C enn
    // Mattilsynets ideal på 4 °C.
    coldTempC:       { min: 2, max: 10, default: 6, inputId: 'cold-temp' },
    // % av total mel, når leaven === 'sourdough'.
    sourInoculation: { min: 10, max: 40, default: 20, inputId: 'sour-inoculation' },
    // Hvilken slider som leder surdeigskoblingen.
    sourLead:        { oneOf: ['inoculation', 'time'], default: 'inoculation' },
    // Hvilket endepunkt av planen brukeren sist satte.
    timeAnchor:      { oneOf: ['start', 'ready'], default: 'start' },
    // Nedtelling + varsel når hevingen er ferdig.
    alarm:           { bool: true, default: false },
    // "Juster underveis": faktisk temp så langt. null = ingen justering.
    actualTempC:     { min: 15, max: 32, default: null, inputId: 'adjust-temp' }
  };

  const allowedValues = f => (typeof f.oneOf === 'function' ? f.oneOf() : f.oneOf);

  function defaults() {
    const state = {};
    Object.entries(FIELDS).forEach(([name, f]) => { state[name] = f.default; });
    // Ikke i FIELDS: egne former, ikke enkle felt med område.
    state.flours = [{ type: 'hvete', pct: 100 }];
    state.anchorTime = '10:00';   // HH:MM
    // Absolutt starttidspunkt, fryst mens alarmen er på (HH:MM er tvetydig
    // over døgngrenser).
    state.anchorDateMs = null;
    return state;
  }

  // Feltvis validering i stedet for Object.assign: lagret state kan komme fra
  // en eldre versjon av appen (andre felter, fjernede meltype-nøkler) eller
  // være korrupt, og skal aldri kunne sette state utenfor gyldige grenser.
  function restore(state, parsed) {
    // Migrer fra gammel state hvor surdeig var en modus (før heveform-toggle).
    if (parsed.mode === 'sourdough') {
      parsed = { ...parsed, mode: 'cold', leaven: 'sourdough' };
    }

    Object.entries(FIELDS).forEach(([name, f]) => {
      const v = parsed[name];
      if (f.bool) {
        if (typeof v === 'boolean') state[name] = v;
      } else if (f.oneOf) {
        if (allowedValues(f).includes(v)) state[name] = v;
      } else if (typeof v === 'number' && Number.isFinite(v) && v >= f.min && v <= f.max) {
        state[name] = v;
      }
      // Ugyldig eller manglende verdi: standardverdien står.
    });

    if (Array.isArray(parsed.flours)) {
      const flours = parsed.flours.filter(f =>
        f && Logic.FLOUR_TYPES[f.type] && typeof f.pct === 'number' && f.pct >= 0 && f.pct <= 100);
      const total = flours.reduce((s, f) => s + f.pct, 0);
      if (flours.length > 0 && total > 0) {
        flours.forEach(f => f.pct = Math.round((f.pct / total) * 100));
        const newTotal = flours.reduce((s, f) => s + f.pct, 0);
        if (newTotal !== 100) flours[0].pct += (100 - newTotal);
        state.flours = flours.map(f => ({ type: f.type, pct: f.pct }));
      }
    }

    // Gammel state manglet vanntemp: la den følge romtemp.
    if (!(typeof parsed.waterTempC === 'number' && Number.isFinite(parsed.waterTempC))) {
      state.waterTempC = state.temperatureC;
    }
    if (typeof parsed.waterTempManual !== 'boolean') {
      state.waterTempManual = state.waterTempC !== state.temperatureC;
    }

    // anchorTime/timeAnchor settes av gjenopptaks-avgjørelsen under, som
    // enten viderefører en pågående nedtelling eller nullstiller bakplanen.
    state.anchorDateMs = (typeof parsed.anchorDateMs === 'number' && Number.isFinite(parsed.anchorDateMs))
      ? parsed.anchorDateMs : null;
  }

  // Er den lagrede nedtellingen fortsatt aktuell? "Juster underveis" kan
  // strekke hevingen forbi planlagt totaltid, så vinduet regnes fra det
  // justerte målet når det finnes; da nullstiller ikke en omstart midt i
  // forlengelsen en fortsatt pågående bake.
  function resumable(state, nowMs) {
    if (!state.alarm || state.anchorDateMs == null) return false;
    if (state.anchorDateMs >= nowMs + RESUME_LOOKAHEAD_MS) return false;
    const total = Logic.modeTotalMinutes(state);
    let plannedEndMs = state.anchorDateMs + total * 60000;
    const adjusted = Logic.adjustedRiseDoneMs(state, nowMs);
    if (adjusted != null) {
      plannedEndMs = Math.max(plannedEndMs, adjusted + (total - Logic.riseDoneMinutes(state)) * 60000);
    }
    return nowMs < plannedEndMs;
  }

  function load(raw, nowMs) {
    const state = defaults();
    if (raw) {
      let parsed = null;
      try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) {}
      if (parsed && typeof parsed === 'object') restore(state, parsed);
    }

    const resumed = resumable(state, nowMs);
    state.timeAnchor = 'start';
    if (resumed) {
      state.anchorTime = I18n.formatTimeHM(new Date(state.anchorDateMs));
    } else {
      // Ikke arv starttid fra en bake for to dager siden: neste hele time.
      state.alarm = false;
      state.anchorDateMs = null;
      state.actualTempC = null;
      const d = new Date(nowMs);
      d.setHours(d.getHours() + 1, 0, 0, 0);
      state.anchorTime = I18n.formatTimeHM(d);
    }
    return { state, resumed };
  }

  const serialize = state => JSON.stringify(state);

  const api = { FIELDS, defaults, load, serialize, RESUME_LOOKAHEAD_MS };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.EltefrittPlantilstand = api;
})(typeof window !== 'undefined' ? window : null);
