'use strict';

// Varsling: hele alarm-tilstandsmaskinen bak ett lite grensesnitt.
//
// Modulen eier beslutningene — når alarmen er armert, når den fyrer, når den
// gjentas, når den gir opp, og hva push-serveren skal ha planlagt — og tar
// alle nettleser-effekter inn som en injisert adapter. Appen sender inn
// nettleser-adapteren (Notification, AudioContext, vibrate, setAppBadge,
// fetch mot push-serveren); testene sender inn en adapter som bare noterer
// kallene og har en falsk klokke.
//
// Grensesnitt:
//   arm(targetMs)  planen sier hevingen er ferdig på targetMs. Idempotent;
//                  re-armerer bare når målet faktisk har flyttet seg.
//   disarm()       alarmen er av.
//   tick()         kalles 1 Hz; fyrer alarmen når tiden er ute.
//   acknowledge()  brukeren har rørt appen — stopp gjentatt piping.
//   seen()         brukeren ser på fanen — stopp også tittel-blinkingen.
//   status()       { armed, fired, remainingMs }
//
// arm() og tick() returnerer samme status, så render-laget slipper et ekstra
// oppslag.

(function (globalScope) {
  // Alarmen gjentas til den kvitteres, så et enkelt pip ikke går tapt.
  // En forlatt fane skal ikke pipe evig: gi opp etter ALARM_GIVE_UP_MS.
  const ALARM_REPEAT_MS = 12 * 1000;
  const ALARM_GIVE_UP_MS = 5 * 60 * 1000;
  // Pushen er backup, den lokale alarmen primær: ikke gi opp stille ved feil,
  // men ikke hamre heller.
  const PUSH_RETRY_MS = 30 * 1000;

  const noop = () => {};

  function createVarsling(effects) {
    const fx = {
      now: () => Date.now(),
      permission: () => 'unsupported',
      notify: noop,
      beep: noop,
      vibrate: noop,
      badge: noop,
      titleFlash: noop,
      pushEnabled: () => false,
      pushSend: () => Promise.resolve(false),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h),
      ...effects
    };

    let targetMs = null;   // absolutt tidspunkt hevingen er ferdig; null = ikke armert
    let fired = false;     // har vi allerede varslet for gjeldende mål
    let repeatTimer = null;
    let giveUpAt = 0;

    let pushDesiredMs = null; // siste ønskede mål (null = ingenting skal være planlagt)
    let pushSyncedMs;         // bekreftet servertilstand; undefined = ukjent, så første
                              // avbestilling alltid sendes (rydder etter forrige økt)
    let pushInFlight = false;
    let pushRetryTimer = null;

    function status() {
      return {
        armed: targetMs != null,
        fired,
        remainingMs: targetMs == null ? 0 : targetMs - fx.now()
      };
    }

    // ---- Push-forsoning ----
    // Hold serverens fyringstidspunkt i synk med alarm-målet. targetMs = null
    // avbestiller. Én forespørsel om gangen; endres målet underveis synkes det
    // på nytt etterpå, så siste ønske vinner (ikke siste svar som kom frem).
    function syncPush(next) {
      pushDesiredMs = next;
      pumpPush();
    }

    async function pumpPush() {
      if (pushInFlight || !fx.pushEnabled() || pushDesiredMs === pushSyncedMs) return;
      // Uten varsel-tillatelse er det ingenting å sende; arm() kaller hit
      // igjen når tillatelsen evt. gis. Avbestilling går uansett.
      if (pushDesiredMs != null && fx.permission() !== 'granted') return;

      pushInFlight = true;
      const sending = pushDesiredMs;
      let ok = false;
      try { ok = (await fx.pushSend(sending)) !== false; } catch (e) { ok = false; }
      pushInFlight = false;

      if (ok) pushSyncedMs = sending;
      if (pushDesiredMs !== sending) { pumpPush(); return; }
      if (!ok) {
        fx.clearTimer(pushRetryTimer);
        pushRetryTimer = fx.setTimer(pumpPush, PUSH_RETRY_MS);
      }
    }

    // ---- Piping / gjentakelse ----
    function burst() {
      fx.vibrate();
      fx.beep();
    }

    function stopRepeat() {
      if (repeatTimer != null) { fx.clearTimer(repeatTimer); repeatTimer = null; }
    }

    function scheduleRepeat() {
      repeatTimer = fx.setTimer(() => {
        repeatTimer = null;
        if (fx.now() > giveUpAt) return;
        burst();
        scheduleRepeat();
      }, ALARM_REPEAT_MS);
    }

    function fire() {
      if (fx.permission() === 'granted') {
        try { Promise.resolve(fx.notify()).catch(noop); } catch (e) {}
      }
      burst();
      stopRepeat();
      fx.badge(true);
      giveUpAt = fx.now() + ALARM_GIVE_UP_MS;
      scheduleRepeat();
      fx.titleFlash(true);
    }

    // ---- Grensesnitt ----
    function acknowledge() {
      stopRepeat();
      fx.badge(false);
    }

    function seen() {
      if (!fired) return;
      fx.titleFlash(false);
      acknowledge();
    }

    function arm(nextTargetMs) {
      if (nextTargetMs !== targetMs) {
        // Planen endret seg: arm på nytt. Ikke fyr etterskuddsvis for et mål
        // som allerede er passert (f.eks. ved gjenoppretting).
        targetMs = nextTargetMs;
        fired = fx.now() >= nextTargetMs;
        if (!fired) { fx.titleFlash(false); acknowledge(); }
      }
      // Utenfor endrings-sjekken: tillatelsen kan bli gitt etter armering, og
      // syncPush deduper selv mot pushSyncedMs.
      syncPush(fired ? null : targetMs);
      return status();
    }

    function disarm() {
      targetMs = null;
      fired = false;
      fx.titleFlash(false);
      acknowledge();
      syncPush(null);
    }

    function tick() {
      if (targetMs == null) return status();
      if (fx.now() >= targetMs && !fired) {
        fired = true;
        fire();
      }
      return status();
    }

    return { arm, disarm, tick, acknowledge, seen, status };
  }

  const api = { createVarsling, ALARM_REPEAT_MS, ALARM_GIVE_UP_MS, PUSH_RETRY_MS };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.EltefrittVarsling = api;
})(typeof window !== 'undefined' ? window : null);
