'use strict';

// Varsling-tester: hele alarm-tilstandsmaskinen drives gjennom sitt eget
// grensesnitt, med en adapter som bare noterer effekt-kallene og en falsk
// klokke. Ingen jsdom, ingen Notification, ingen AudioContext, ingen fetch.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createVarsling, ALARM_REPEAT_MS, ALARM_GIVE_UP_MS, PUSH_RETRY_MS
} = require('../src/varsling.js');

const T0 = 1_700_000_000_000;

// Falsk klokke + falske timere + logg over effekt-kall.
function harness(opts = {}) {
  let now = T0;
  let nextId = 1;
  let timers = [];
  const calls = [];
  const pushSent = [];
  let permission = opts.permission || 'granted';
  let pushEnabled = opts.pushEnabled !== false;
  let pushOk = opts.pushOk || (() => true);
  let onPush = opts.onPush || (() => {});

  const fx = {
    now: () => now,
    permission: () => permission,
    notify: () => { calls.push('notify'); return Promise.resolve(); },
    beep: () => calls.push('beep'),
    vibrate: () => calls.push('vibrate'),
    badge: on => calls.push('badge:' + on),
    titleFlash: on => calls.push('titleFlash:' + on),
    pushEnabled: () => pushEnabled,
    pushSend: target => { pushSent.push(target); onPush(target); return Promise.resolve(pushOk(target)); },
    setTimer: (fn, ms) => { const id = nextId++; timers.push({ id, at: now + ms, fn }); return id; },
    clearTimer: id => { timers = timers.filter(x => x.id !== id); }
  };

  // Tøm mikrotask-køen (push-forsoningen er async).
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };

  async function advance(ms) {
    const until = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      if (!timers.length || timers[0].at > until) break;
      const due = timers.shift();
      now = due.at;
      due.fn();
      await flush();
    }
    now = until;
    await flush();
  }

  return {
    v: createVarsling(fx),
    calls, pushSent, flush, advance,
    at: () => now,
    setPermission: p => { permission = p; },
    setPushEnabled: b => { pushEnabled = b; },
    count: name => calls.filter(c => c === name).length
  };
}

// ---- Armering ----

test('arm: målet frem i tid gir armert nedtelling, ingen fyring', async () => {
  const h = harness();
  const st = h.v.arm(T0 + 60_000);
  assert.equal(st.armed, true);
  assert.equal(st.fired, false);
  assert.equal(st.remainingMs, 60_000);
  assert.equal(h.count('beep'), 0);
  assert.equal(h.count('notify'), 0);
});

test('arm: mål i fortid markeres fyrt, men fyrer ikke etterskuddsvis', async () => {
  const h = harness();
  const st = h.v.arm(T0 - 1000);
  assert.equal(st.fired, true);
  assert.equal(h.count('beep'), 0, 'skal ikke pipe for et mål som alt er passert');
  assert.equal(h.count('notify'), 0);
  await h.flush();
  // Fyrt mål skal ikke ha noe planlagt i push-serveren.
  assert.deepEqual(h.pushSent, [null]);
});

test('arm: samme mål to ganger re-armerer ikke', async () => {
  const h = harness();
  h.v.arm(T0 + 60_000);
  const before = h.calls.length;
  h.v.arm(T0 + 60_000);
  assert.equal(h.calls.length, before, 'ingen nye effekt-kall for uendret mål');
});

test('arm: nytt mål etter fyring nullstiller fyrt og stopper blinkingen', async () => {
  const h = harness();
  h.v.arm(T0 + 1000);
  await h.advance(1000);
  h.v.tick();
  assert.equal(h.v.status().fired, true);

  const st = h.v.arm(h.at() + 3600_000);
  assert.equal(st.fired, false);
  assert.ok(h.calls.includes('titleFlash:false'));
  assert.ok(h.calls.includes('badge:false'));
});

// ---- Fyring ----

test('tick: fyrer først når tiden er ute, og bare én gang', async () => {
  const h = harness();
  h.v.arm(T0 + 10_000);

  await h.advance(9_000);
  assert.equal(h.v.tick().fired, false);
  assert.equal(h.count('beep'), 0);

  await h.advance(1_000);
  const st = h.v.tick();
  assert.equal(st.fired, true);
  assert.deepEqual(
    ['notify', 'vibrate', 'beep', 'badge:true', 'titleFlash:true'].filter(c => h.calls.includes(c)).length,
    5
  );

  h.v.tick();
  h.v.tick();
  assert.equal(h.count('beep'), 1, 'fyrer ikke på nytt for samme mål');
});

test('tick: uarmert er en no-op', async () => {
  const h = harness();
  const st = h.v.tick();
  assert.equal(st.armed, false);
  assert.equal(h.calls.length, 0);
});

test('fyring: varsel hoppes over uten tillatelse, men det pipes og vibreres', async () => {
  const h = harness({ permission: 'denied' });
  h.v.arm(T0 + 1000);
  await h.advance(1000);
  h.v.tick();
  assert.equal(h.count('notify'), 0);
  assert.equal(h.count('beep'), 1);
  assert.equal(h.count('vibrate'), 1);
});

// ---- Gjentakelse og oppgivelse ----

test('gjentakelse: piper hver 12. sekund til den gir opp etter 5 min', async () => {
  const h = harness();
  h.v.arm(T0 + 1000);
  await h.advance(1000);
  h.v.tick();
  assert.equal(h.count('beep'), 1);

  await h.advance(ALARM_REPEAT_MS);
  assert.equal(h.count('beep'), 2);

  await h.advance(ALARM_REPEAT_MS * 3);
  assert.equal(h.count('beep'), 5);

  // Godt forbi oppgi-grensen: ingen nye pip.
  await h.advance(ALARM_GIVE_UP_MS * 2);
  const afterGiveUp = h.count('beep');
  await h.advance(ALARM_REPEAT_MS * 5);
  assert.equal(h.count('beep'), afterGiveUp, 'skal ha gitt opp');
  assert.ok(afterGiveUp <= 1 + Math.ceil(ALARM_GIVE_UP_MS / ALARM_REPEAT_MS));
});

test('acknowledge: stopper gjentatt piping og badge, men ikke blinkingen', async () => {
  const h = harness();
  h.v.arm(T0 + 1000);
  await h.advance(1000);
  h.v.tick();

  const since = h.calls.length;
  h.v.acknowledge();
  const after = h.calls.slice(since);
  assert.ok(after.includes('badge:false'));
  assert.ok(!after.includes('titleFlash:false'),
    'tittel-blinkingen styres av fane-synlighet, ikke av kvittering');

  const beeps = h.count('beep');
  await h.advance(ALARM_REPEAT_MS * 4);
  assert.equal(h.count('beep'), beeps, 'ingen flere pip etter kvittering');
});

test('seen: stopper blinkingen og kvitterer, no-op før fyring', async () => {
  const h = harness();
  h.v.arm(T0 + 60_000);
  let since = h.calls.length;
  h.v.seen();
  assert.deepEqual(h.calls.slice(since), [], 'ingenting å se før alarmen har gått');

  await h.advance(60_000);
  h.v.tick();
  since = h.calls.length;
  h.v.seen();
  const after = h.calls.slice(since);
  assert.ok(after.includes('titleFlash:false'));
  assert.ok(after.includes('badge:false'));
});

test('disarm: rydder blinking, badge og planlagt push', async () => {
  const h = harness();
  h.v.arm(T0 + 60_000);
  await h.flush();
  h.v.disarm();
  await h.flush();

  assert.equal(h.v.status().armed, false);
  assert.equal(h.v.status().fired, false);
  assert.ok(h.calls.includes('titleFlash:false'));
  assert.ok(h.calls.includes('badge:false'));
  assert.deepEqual(h.pushSent, [T0 + 60_000, null]);
});

// ---- Push-forsoning ----

test('push: armering planlegger målet, uendret mål sendes ikke på nytt', async () => {
  const h = harness();
  h.v.arm(T0 + 60_000);
  await h.flush();
  assert.deepEqual(h.pushSent, [T0 + 60_000]);

  h.v.arm(T0 + 60_000);
  await h.flush();
  assert.deepEqual(h.pushSent, [T0 + 60_000], 'deduper mot bekreftet servertilstand');
});

test('push: uten tillatelse sendes ingenting, og det sendes når den gis', async () => {
  const h = harness({ permission: 'default' });
  h.v.arm(T0 + 60_000);
  await h.flush();
  assert.deepEqual(h.pushSent, []);

  h.setPermission('granted');
  h.v.arm(T0 + 60_000);   // samme mål; renderAlarm kaller hit på nytt
  await h.flush();
  assert.deepEqual(h.pushSent, [T0 + 60_000]);
});

test('push: avbestilling går uansett tillatelse', async () => {
  const h = harness({ permission: 'denied' });
  h.v.disarm();
  await h.flush();
  assert.deepEqual(h.pushSent, [null], 'rydder etter forrige økt selv uten tillatelse');
});

test('push: av når nettleseren ikke støtter det', async () => {
  const h = harness({ pushEnabled: false });
  h.v.arm(T0 + 60_000);
  await h.flush();
  assert.deepEqual(h.pushSent, []);
});

test('push: feil gir nytt forsøk etter 30 s', async () => {
  let ok = false;
  const h = harness({ pushOk: () => ok });
  h.v.arm(T0 + 60_000);
  await h.flush();
  assert.equal(h.pushSent.length, 1);

  await h.advance(PUSH_RETRY_MS - 1000);
  assert.equal(h.pushSent.length, 1, 'ikke hamre');

  ok = true;
  await h.advance(1000);
  assert.equal(h.pushSent.length, 2, 'nytt forsøk etter 30 s');

  await h.advance(PUSH_RETRY_MS * 3);
  assert.equal(h.pushSent.length, 2, 'ingen flere forsøk etter at det gikk');
});

test('push: siste ønske vinner når målet flyttes mens et kall er underveis', async () => {
  const h = harness({
    // Flytt målet midt i det første kallet.
    onPush: target => { if (target === T0 + 60_000) h.v.arm(T0 + 90_000); }
  });
  h.v.arm(T0 + 60_000);
  await h.flush();
  assert.deepEqual(h.pushSent, [T0 + 60_000, T0 + 90_000]);
  // Ett kall om gangen: ingen overlappende forespørsler.
  assert.equal(new Set(h.pushSent).size, h.pushSent.length);
});

test('push: fyring avbestiller planen (serveren skal ikke pushe i tillegg)', async () => {
  const h = harness();
  h.v.arm(T0 + 1000);
  await h.flush();
  await h.advance(1000);
  h.v.tick();
  h.v.arm(T0 + 1000);   // update() kaller renderAlarm som før
  await h.flush();
  assert.deepEqual(h.pushSent, [T0 + 1000, null]);
});
