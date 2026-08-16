// Eltefritt push-server: Cloudflare Worker + én Durable Object per
// push-abonnement. Hver DO holder ett fyringstidspunkt og sender en tom
// Web Push (kun VAPID-autorisasjon) når alarmen går; sw.js i appen viser
// en statisk notifikasjon. Uten payload trengs ingen aes128gcm-kryptering,
// så worker-en er avhengighetsfri (WebCrypto gjør ES256-signeringen).
//
// API (CORS-låst til ALLOWED_ORIGIN):
//   POST /schedule  { subscription: <PushSubscription.toJSON()>, fireAtMs }
//   POST /cancel    { endpoint }
//
// Oppsett og deploy: se README.md i denne mappen.

const MAX_AHEAD_MS = 48 * 3600 * 1000;

function corsHeaders(env) {
  return {
    'access-control-allow-origin': env.ALLOWED_ORIGIN,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type'
  };
}

export default {
  async fetch(req, env) {
    const headers = corsHeaders(env);
    if (req.method === 'OPTIONS') return new Response(null, { headers });

    const url = new URL(req.url);
    if (req.method !== 'POST' || (url.pathname !== '/schedule' && url.pathname !== '/cancel')) {
      return new Response('not found', { status: 404, headers });
    }

    let body;
    try { body = await req.json(); } catch (e) {
      return new Response('bad json', { status: 400, headers });
    }
    const endpoint = url.pathname === '/schedule' ? body.subscription && body.subscription.endpoint : body.endpoint;
    if (typeof endpoint !== 'string' || !endpoint.startsWith('https://')) {
      return new Response('bad endpoint', { status: 400, headers });
    }
    if (url.pathname === '/schedule' &&
        !(Number.isFinite(body.fireAtMs) && body.fireAtMs < Date.now() + MAX_AHEAD_MS)) {
      return new Response('bad fireAtMs', { status: 400, headers });
    }

    // Endepunktet identifiserer abonnementet; samme endepunkt = samme DO,
    // så en ny /schedule overskriver forrige tidspunkt.
    const stub = env.PUSH_ALARM.get(env.PUSH_ALARM.idFromName(endpoint));
    const res = await stub.fetch('https://do' + url.pathname, {
      method: 'POST',
      body: JSON.stringify(body)
    });
    return new Response(await res.text(), {
      status: res.status,
      headers: { ...headers, 'content-type': 'application/json' }
    });
  }
};

export class PushAlarm {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(req) {
    const url = new URL(req.url);
    const body = await req.json();
    if (url.pathname === '/schedule') {
      // Ikke i fortid: klokkeskjevhet hos klienten gis ett sekunds slark.
      await this.state.storage.put('sub', body.subscription);
      await this.state.storage.setAlarm(Math.max(body.fireAtMs, Date.now() + 1000));
      return new Response('{"ok":true}');
    }
    await this.state.storage.deleteAlarm();
    await this.state.storage.deleteAll();
    return new Response('{"ok":true}');
  }

  async alarm() {
    const sub = await this.state.storage.get('sub');
    await this.state.storage.deleteAll();
    if (!sub) return;
    // Utgått/tilbaketrukket abonnement (404/410 o.l.) er uproblematisk:
    // lagringen er allerede tømt, og klienten re-abonnerer ved neste alarm.
    try { await sendEmptyPush(sub, this.env); } catch (e) {}
  }
}

// ---- Web Push uten payload: VAPID-autorisert POST til push-endepunktet ----

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function vapidJwt(audience, env) {
  const key = await crypto.subtle.importKey(
    'jwk', JSON.parse(env.VAPID_PRIVATE_JWK),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(enc.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT
  })));
  // WebCrypto signerer ECDSA i rå r||s-form, som er akkurat det JWT ES256 vil ha.
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(header + '.' + claims));
  return header + '.' + claims + '.' + b64url(sig);
}

async function sendEmptyPush(sub, env) {
  const audience = new URL(sub.endpoint).origin;
  const jwt = await vapidJwt(audience, env);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
      // Behold pushen hos push-tjenesten i inntil en time hvis enheten er
      // offline i det alarmen går.
      TTL: '3600',
      Urgency: 'high'
    }
  });
  if (res.status !== 201 && !res.ok) throw new Error('push ' + res.status);
}
