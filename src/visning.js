'use strict';

// Visning: alt appen utleder om hva siden skal si, som verdier.
//
// viewOf() er ren: den slår ikke opp tekst, formaterer ingen tall og rører
// ikke DOM. Hver tekst-slot er en deskriptor i samme form logic.js allerede
// bruker, og render-laget i index.html slår dem opp og skriver dem ut. Da kan
// visningsreglene testes uten jsdom, og applieren har ingen beslutninger.
//
// Grensesnitt:
//   normalize(state)     bringer state til konsistent form (auto-hydrering).
//                        Muterer; kalles før viewOf, som bare leser.
//   viewOf(state, nowMs) → View
//
// View:
//   text    elementId → slot
//   hidden  elementId → bool
//   temps   elementId → grader celsius (render-laget velger enhet)
//   values  input-id  → tallverdi kontrollen skal tvinges til
//   hydrationBand, instructions, flour, plan, recipe
//
// Slot-former (én per måte å vise en verdi på):
//   { key, params }   i18n-oppslag; params kan bære markører som { grams: n }
//   { text }          ferdig streng
//   { grams: n }      gram-mengde
//   [ slot, ... ]     sammensatt tekst
// `lower: true` på en slot gir små bokstaver.

(function (globalScope) {
  const isNode = typeof module !== 'undefined' && !!module.exports;
  const Logic = isNode ? require('./logic.js') : globalScope.EltefrittLogic;

  // Lite/Medium/Stort i gram mel, per bakverk; alt annet er egen vekt. Brød
  // er bundet av gryte og form, rundstykker bare av brettet.
  const SIZE_PRESETS = { loaf: [400, 500, 700], rolls: [500, 750, 1000] };
  const SIZE_NAME_KEYS = ['size.small', 'size.medium', 'size.large'];

  // Gryte- og banneton-anbefaling er samme trapp på melvekt per brød.
  const SIZE_STEPS = [[600, 's'], [800, 'm'], [1100, 'l'], [1500, 'xl']];
  function sizeStep(g) {
    const hit = SIZE_STEPS.find(([max]) => g <= max);
    return hit ? hit[1] : 'xxl';
  }

  // Auto-hydrering: er den ikke manuelt overstyrt, følger den midtpunktet av
  // anbefalt område for melblandingen.
  function normalize(state) {
    if (!state.hydrationManual) {
      const r = Logic.weightedHydration(state.flours, state.product);
      state.hydration = Math.round((r.min + r.max) / 2);
    }
    return state;
  }

  function flourSum(totalPct) {
    if (totalPct === 100) return { key: 'flourSum.exact' };
    const diff = 100 - totalPct;
    return diff > 0
      ? { key: 'flourSum.remaining', params: { total: totalPct, diff } }
      : { key: 'flourSum.over', params: { total: totalPct, diff: -diff } };
  }

  function viewOf(state, nowMs) {
    const recipe = Logic.computeRecipe(state);
    const band = Logic.weightedHydration(state.flours, state.product);
    const rolls = Logic.isRolls(state.product);
    const recMin = Math.round(band.min);
    const recMax = Math.round(band.max);

    const text = {};
    const hidden = {};
    const temps = {};
    const values = {};

    // ---- Brødstørrelse ----
    const sizeKey = SIZE_NAME_KEYS[SIZE_PRESETS[state.product].indexOf(state.sizePerLoaf)];
    text['size-value'] = sizeKey
      ? { key: sizeKey }
      : { key: 'size.custom', params: { g: state.sizePerLoaf } };
    // Deig = mel × (1 + hydrering + 2 % salt); ferdig brød ≈ deig × 0.88
    // (litt vekttap fra stekning), avrundet til nærmeste 50 g.
    const doughFactor = 1 + recipe.hydration / 100 + 0.02;
    const dough = state.sizePerLoaf * doughFactor;
    hidden['loaves-field'] = rolls;
    text['size-label'] = { key: rolls ? 'field.size.rolls' : 'field.size' };
    if (rolls) {
      text['size-detail'] = {
        key: 'size.detail.rolls',
        params: { flour: { grams: state.sizePerLoaf }, count: Logic.rollCount(dough) }
      };
      text['equipment-detail'] = [{ key: 'equipment.rolls' }];
    } else {
      const finished = Math.round((dough * 0.88) / 50) * 50;
      text['size-detail'] = {
        key: 'size.detail',
        params: { flour: { grams: state.sizePerLoaf }, finished: { grams: finished } }
      };
      const step = sizeStep(state.sizePerLoaf);
      text['equipment-detail'] = [
        { key: 'equipment.line', params: { pot: { i18n: 'equipment.pot.' + step }, banneton: { i18n: 'banneton.' + step } } }
      ];
      if (state.loaves > 1) text['equipment-detail'].push({ key: 'equipment.perLoaf' });
    }
    text['loaves-value'] = { text: String(state.loaves) };

    // ---- Hydrering ----
    text['hydration-suggestion'] = recMin === recMax
      ? { key: 'hydration.suggestion.single', params: { n: recMin } }
      : { key: 'hydration.suggestion.range', params: { min: recMin, max: recMax } };
    text['hydration-value'] = { text: String(state.hydration) };
    // Følger hydreringen melblandingen, må slideren tvinges med; er den
    // manuelt satt, er brukeren i ferd med å dra i den.
    if (!state.hydrationManual) values['hydration'] = state.hydration;

    // ---- Avlesninger ----
    temps['temp-value'] = state.temperatureC;
    temps['water-temp-value'] = state.waterTempC;
    temps['water-temp-inline-value'] = state.waterTempC;
    temps['cold-temp-value'] = state.coldTempC;
    text['time-value'] = { text: String(state.riseHours) };
    text['bulk-time-value'] = { text: String(state.bulkHours) };
    text['cold-time-value'] = { text: String(state.coldHours) };
    text['sour-inoculation-value'] = { text: String(state.sourInoculation) };

    // ---- Hevemodus og heveform ----
    Object.entries(Logic.MODE_META).forEach(([key, meta]) => {
      hidden[meta.controlsId] = state.mode !== key;
    });
    hidden['sourdough-controls'] = state.leaven !== 'sourdough';
    const mode = Logic.MODE_META[state.mode];
    text['mode-detail'] = mode ? { key: mode.detailKey } : { text: '' };
    const leaven = Logic.LEAVEN_DETAILS[state.leaven];
    text['leaven-detail'] = leaven ? { key: leaven.key, params: leaven.params } : { text: '' };

    // ---- Ingredienser ----
    text['flour-amount'] = { grams: recipe.flourAdded };
    text['water-amount'] = { grams: recipe.water };
    text['water-temp-grams'] = { key: 'field.waterTemp.grams', params: { grams: { grams: recipe.water } } };
    // Temp-tallet vises alltid i inline-stepperen; sub-teksten sier bare fra
    // når vannet fortsatt følger romtemp.
    text['water-sub'] = state.waterTempC === state.temperatureC
      ? { key: 'water.sub.roomTemp' } : { text: '' };
    text['salt-amount'] = { grams: recipe.salt };

    const sourdough = recipe.leaven === 'sourdough';
    hidden['yeast-row'] = sourdough;
    hidden['starter-row'] = !sourdough;
    if (sourdough) {
      text['starter-amount'] = { grams: recipe.starter };
    } else {
      // Ferskgjær doseres ~3× tørrgjær; raden viser den valgte formen og
      // detaljlinja regner om til den andre.
      const fresh = recipe.leaven === 'fresh';
      const pct = { pct2: recipe.yeastPct };
      text['yeast-label'] = { key: fresh ? 'yeast.fresh' : 'yeast.dry' };
      text['yeast-amount'] = { grams: fresh ? recipe.yeast * 3 : recipe.yeast };
      text['yeast-fresh'] = fresh
        ? { key: 'yeast.detail.fresh', params: { pct, grams: { grams: recipe.yeast } } }
        : { key: 'yeast.detail.dry', params: { pct, grams: { grams: recipe.yeast * 3 } } };
    }

    // ---- Mel ----
    const totalPct = state.flours.reduce((s, f) => s + f.pct, 0);
    const tips = Logic.flourTips(state.flours);
    hidden['flour-tip'] = tips.length === 0;
    const single = state.flours.length === 1;
    hidden['flour-warning'] = single;
    text['flour-types-label'] = single
      ? { key: 'flour.' + state.flours[0].type, lower: true }
      : { key: 'flour.typesLabelOther', params: { count: state.flours.length } };

    const flour = {
      rows: state.flours.map(f => ({ type: f.type, pct: f.pct })),
      totalPct,
      sum: flourSum(totalPct),
      sumError: totalPct !== 100,
      tips,
      // Én type trenger ingen oppdeling; da sier etiketten alt.
      breakdown: single ? [] : state.flours
        .filter(f => f.pct !== 0)
        .map(f => ({
          type: f.type,
          pct: f.pct,
          grams: (f.pct / Math.max(totalPct, 1)) * recipe.flourAdded
        }))
    };

    // ---- Tidsplan ----
    const { start, ready } = Logic.planWindow(state, nowMs);
    const plan = { start, ready, items: Logic.modePlanItems(state, start) };

    return {
      text, hidden, temps, values,
      recipe,
      hydrationBand: { min: band.min, max: band.max },
      instructions: Logic.modeInstructions(state),
      flour,
      plan
    };
  }

  const api = { normalize, viewOf, SIZE_PRESETS, sizeStep };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.EltefrittVisning = api;
})(typeof window !== 'undefined' ? window : null);
