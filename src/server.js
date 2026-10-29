// agentfeed-near gateway: HTTP 402 in front of AgentFeed, paid in USDC on NEAR testnet (x402 `exact`, NEP-366 delegate action).
import http from 'node:http';
import { settlementCacheKey, decodeSignedDelegateB64 } from '@x402/near';
import { ROUTES, findRoute, priceAtomic, priceUsdc, usdcStr, cleanParams } from './routes.js';
import { waitForOutcome } from './chain.js';
import { landingHtml } from './landing.js';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
const fromB64 = (s) => JSON.parse(Buffer.from(s, 'base64').toString('utf8'));

// Everything that is not a plain 402 refusal.
const STATUS = { malformed_payment: 400, payment_in_flight: 429, settlement_pending: 409, chain_unavailable: 503 };

export function createGateway({ cfg, chain, store, fetchImpl = fetch, now = () => Math.floor(Date.now() / 1000) }) {
  const inflight = new Set(); // payer accounts and payment hashes currently being processed
  const hits = new Map(); // ip -> [count, windowStart]
  let upstreamDay = { day: '', n: 0 };

  const txUrl = (h) => `${cfg.explorer}/transactions/${h}`;
  const requirementsFor = (route) => ({
    scheme: 'exact',
    network: cfg.network,
    amount: String(priceAtomic(route)),
    asset: cfg.usdc.asset,
    payTo: cfg.treasury,
    maxTimeoutSeconds: cfg.maxTimeoutSeconds,
  });
  // What the verifier checks against: the advertised requirements, with the block window widened by the configured slack.
  const verifyRequirements = (route) => ({ ...requirementsFor(route), maxTimeoutSeconds: cfg.maxTimeoutSeconds + cfg.windowSlackBlocks });
  async function noteSkew(code, sda) {
    if (code !== 'invalid_exact_near_payload_delegate_action_timeout_window_exceeds_max_timeout') return;
    try { console.warn('window refusal', JSON.stringify({ delegateMaxBlockHeight: String(decodeSignedDelegateB64(sda).delegate.maxBlockHeight), gatewayFinalHeight: String(await chain.blockHeight(cfg.network)), advertised: cfg.maxTimeoutSeconds, slack: cfg.windowSlackBlocks })); } catch { /* diagnostics only */ }
  }
  const challenge = (route, code, message) => ({
    x402Version: 2,
    error: code || 'payment_required',
    message: message || `${priceUsdc(route)} USDC on NEAR testnet`,
    resource: { url: `${cfg.publicUrl}/api/${route.id}`, description: route.description, mimeType: 'application/json' },
    price: { amount: priceUsdc(route), currency: 'USDC', atomic: String(priceAtomic(route)) },
    accepts: [requirementsFor(route)],
  });

  const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'PAYMENT-REQUIRED, PAYMENT-RESPONSE', 'access-control-allow-headers': 'content-type, payment-signature, x-payment' };
  const send = (res, status, body, headers = {}) => {
    const isStr = typeof body === 'string';
    res.writeHead(status, { 'content-type': isStr ? (headers['content-type'] || 'text/html; charset=utf-8') : 'application/json', 'cache-control': 'no-store', ...cors, ...headers });
    res.end(isStr ? body : JSON.stringify(body, null, 2));
  };
  const send402 = (res, route, code, message, extra = {}) => {
    const body = { ...challenge(route, code, message), ...extra };
    send(res, code && STATUS[code] ? STATUS[code] : 402, body, { 'payment-required': b64(challenge(route, code, message)) });
  };

  const manifest = () => ({
    name: 'agentfeed-near',
    description: 'AgentFeed market data for AI agents, paid per call in USDC on NEAR testnet. The agent signs one NEP-366 delegate action; the gateway relays it and pays the gas.',
    x402Version: 2,
    kinds: [{ x402Version: 2, scheme: 'exact', network: cfg.network }],
    network: cfg.network,
    asset: { account: cfg.usdc.asset, symbol: cfg.usdc.symbol, decimals: cfg.usdc.decimals, standard: 'NEP-141 (Circle USDC)' },
    payTo: cfg.treasury,
    relayer: chain.relayerId,
    maxTimeoutSeconds: cfg.maxTimeoutSeconds,
    explorer: cfg.explorer,
    upstream: 'https://x402.ochinimus.app',
    routes: ROUTES.map((r) => ({ id: r.id, method: 'GET', path: `/api/${r.id}`, url: `${cfg.publicUrl}/api/${r.id}`, price_usdc: priceUsdc(r), price_atomic: String(priceAtomic(r)), params: r.params, title: r.title, description: r.description })),
    source: 'https://github.com/seekdaseek/agentfeed-near',
  });

  const csv = () => {
    const head = 'timestamp_utc,route,payer,amount_usdc,tx_hash,relayer,tx_url,state,settle_ms,upstream_ms,total_ms';
    const rows = store.all().map((p) => [new Date((p.ts_settled || p.ts_created) * 1000).toISOString(), p.route, p.payer, usdcStr(p.amount), p.tx_hash, p.relayer, txUrl(p.tx_hash), p.state, p.settle_ms ?? '', p.upstream_ms ?? '', p.total_ms ?? ''].join(','));
    return [head, ...rows].join('\n') + '\n';
  };

  async function upstream(route, query) {
    const day = new Date().toISOString().slice(0, 10);
    if (upstreamDay.day !== day) upstreamDay = { day, n: 0 };
    if (upstreamDay.n >= cfg.dailyUpstreamCap) return { error: 'capacity', status: 503 };
    upstreamDay.n++;
    const url = `${cfg.upstreamUrl}${cfg.upstreamPrefix}${route.upstream}${query.size ? `?${query}` : ''}`;
    const t0 = Date.now();
    try {
      const headers = { accept: 'application/json', ...(cfg.upstreamKey ? { 'x-agentfeed-key': cfg.upstreamKey } : {}) };
      const r = await fetchImpl(url, { headers, signal: AbortSignal.timeout(cfg.upstreamTimeoutMs) });
      const text = await r.text();
      let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 2000) }; }
      if (r.status >= 500) return { error: 'upstream_unavailable', status: 502, detail: `AgentFeed answered ${r.status}`, ms: Date.now() - t0 };
      if (r.status >= 400) return { error: 'upstream_rejected', status: r.status === 402 ? 502 : 400, detail: json, ms: Date.now() - t0 };
      return { ok: true, json, ms: Date.now() - t0 };
    } catch (e) {
      return { error: 'upstream_unavailable', status: 502, detail: e.name === 'TimeoutError' ? 'AgentFeed timed out' : 'AgentFeed unreachable', ms: Date.now() - t0 };
    }
  }

  // Hands the data over. The response is written first and the row marked delivered second: if the process dies between the
  // two, the payment stays "settled" and the same header collects the data again, which is the safe direction.
  function deliver(res, route, row, up, t0, extra = {}) {
    const receipt = { success: true, network: cfg.network, payer: row.payer, transaction: row.tx_hash };
    send(res, 200, {
      route: route.id,
      paid: { amount_usdc: priceUsdc(route), currency: 'USDC', network: cfg.network, payer: row.payer, tx: row.tx_hash, explorer: txUrl(row.tx_hash), relayer: row.relayer, settle_ms: row.settle_ms ?? undefined, ...extra },
      data: up.json,
    }, { 'payment-response': b64(receipt) });
    store.delivered(row.hash, { upstream_ms: up.ms, total_ms: Date.now() - t0 });
  }

  // A payment left "submitted": ask the chain; if it never saw the transaction, send the stored bytes again (idempotent), then ask again.
  async function resolveSubmitted(row, timeoutMs) {
    const token = cfg.usdc.asset;
    let r = await waitForOutcome(chain, row.tx_hash, { timeoutMs: Math.min(timeoutMs, 3000), intervalMs: 1000, token });
    if (r.kind === 'unknown' && row.signed_tx) {
      try { r = await chain.rebroadcast(row.signed_tx, token); } catch { /* the node may refuse stale bytes: the chain lookup below decides */ }
      if (r.kind !== 'success' && r.kind !== 'failure') r = await waitForOutcome(chain, row.tx_hash, { timeoutMs, token });
    } else if (r.kind !== 'success' && r.kind !== 'failure') r = await waitForOutcome(chain, row.tx_hash, { timeoutMs, token });
    return r;
  }

  // A payment header we have already seen. This is where "charged at most once, and if charged then the data is collectable" lives.
  async function prior(res, route, cp, row, t0) {
    if (row.route !== route.id) return send402(res, route, 'payment_replayed', 'this payment was made for another route', { charged: false });
    if (row.state === 'delivered') return send402(res, route, 'payment_replayed', 'this payment was already used', { charged: false });
    if (row.state === 'failed') return send402(res, route, 'payment_failed', `this payment did not settle (${row.error || 'failed'}); sign a new one`, { charged: false });
    if (row.state === 'reserved' || inflight.has(row.hash)) return send(res, 429, { error: 'payment_in_flight', message: 'this payment is being processed' }, { 'retry-after': '5' });
    inflight.add(row.hash);
    try {
      let current = row;
      if (current.state === 'submitted') {
        const r = await resolveSubmitted(current, Math.min(cfg.settleWaitMs, 20000));
        if (r.kind === 'failure') { store.failed(current.hash, r.error); return send402(res, route, 'settlement_failed', 'the transfer did not happen, nothing was charged', { charged: false, tx: current.tx_hash }); }
        if (r.kind !== 'success') return send(res, 409, { error: 'settlement_pending', charged: 'unknown', tx: current.tx_hash, explorer: txUrl(current.tx_hash), message: 'the settlement transaction is not final yet; retry with the same payment' }, { 'retry-after': '5' });
        store.settled(current.hash, null);
        current = store.get(current.hash);
      }
      // settled and not delivered: the agent was charged, so deliver without charging again
      const up = await upstream(route, cp.query);
      if (!up.ok) return send(res, up.status, { error: up.error, charged: true, tx: current.tx_hash, explorer: txUrl(current.tx_hash), detail: up.detail, message: 'you were charged; retry with the same payment to collect the data' });
      return deliver(res, route, current, up, t0, { recovered: true });
    } finally { inflight.delete(row.hash); }
  }

  async function paid(req, res, route, url) {
    const t0 = Date.now();
    const cp = cleanParams(route, url.searchParams);
    if (!cp.ok) return send(res, 400, { error: 'bad_request', message: cp.error });
    const raw = req.headers['payment-signature'] || req.headers['x-payment'];
    if (!raw) return send402(res, route);

    let payload;
    try { payload = fromB64(raw); } catch { return send402(res, route, 'malformed_payment', 'payment header is not base64 JSON'); }
    const sda = payload?.payload?.signedDelegateAction;
    if (typeof sda !== 'string' || !sda) return send402(res, route, 'invalid_exact_near_payload_shape', 'payload.signedDelegateAction (base64 borsh) is required');
    let hash;
    try { hash = settlementCacheKey(sda); } catch { return send402(res, route, 'invalid_exact_near_payload_signed_delegate_action', 'signedDelegateAction is not base64'); }

    const seen = store.get(hash);
    if (seen) return prior(res, route, cp, seen, t0);

    const requirements = verifyRequirements(route);
    let verified;
    try { verified = await chain.verify(payload, requirements); } catch (e) { return send402(res, route, 'chain_unavailable', `NEAR RPC error: ${e.message}`, { charged: false }); }
    if (verified?.isValid !== true) {
      const code = verified?.invalidReason || 'verification_failed';
      await noteSkew(code, sda);
      return send402(res, route, code, verified?.invalidMessage || `x402 NEAR exact verification failed: ${code}`, { charged: false });
    }
    const payer = verified.payer;
    if (!payer) return send402(res, route, 'verification_failed', 'could not read the payer from the verified payment', { charged: false });

    // One payment in flight per payer account: a delegate nonce is single-use per access key, so racing signatures only burn relayer gas.
    if (inflight.has(`payer:${payer}`) || inflight.has(hash)) return send(res, 429, { error: 'payment_in_flight', message: 'one paid call at a time per payer account' }, { 'retry-after': '5' });
    inflight.add(`payer:${payer}`); inflight.add(hash);
    try {
      const maxBlockHeight = String(decodeSignedDelegateB64(sda).delegate.maxBlockHeight); // verify() already accepted it
      if (!store.reserve({ hash, route: route.id, payer, amount: String(priceAtomic(route)), max_block_height: maxBlockHeight })) return send402(res, route, 'payment_replayed', 'this payment was already used', { charged: false });

      // Fetch first, settle second: if AgentFeed is down the payer is never charged and can retry with the same payment.
      const up = await upstream(route, cp.query);
      if (!up.ok) {
        store.release(hash);
        return send(res, up.status, { error: up.error, charged: false, detail: up.detail, message: 'no payment was taken; retry with the same payment' });
      }
      // The delegate action may have aged or the payer may have spent the balance while the data was fetched: check again before spending relayer gas.
      const again = await chain.verify(payload, requirements).catch((e) => ({ isValid: false, invalidReason: 'chain_unavailable', invalidMessage: e.message }));
      if (!again.isValid) { store.release(hash); return send402(res, route, again.invalidReason, again.invalidMessage, { charged: false }); }

      const t1 = Date.now();
      let result;
      try {
        result = await chain.submit({ signedDelegateAction: sda, onPrepared: (txHash, signedTx) => store.submitted(hash, txHash, chain.relayerId, signedTx) });
      } catch (e) {
        const row = store.get(hash);
        if (row.state === 'reserved') { store.release(hash); return send402(res, route, 'settlement_failed', `settlement could not be submitted, nothing was charged: ${e.message}`, { charged: false }); }
        result = await resolveSubmitted(row, cfg.settleWaitMs); // broadcast was attempted: the chain decides, after one resend of the stored bytes if it never saw them
      }
      const row = store.get(hash);
      if (result.kind === 'failure') { store.failed(hash, result.error); return send402(res, route, 'settlement_failed', 'the transfer did not happen, nothing was charged', { charged: false, tx: row.tx_hash, detail: result.error }); }
      if (result.kind !== 'success') return send(res, 504, { error: 'settlement_unconfirmed', charged: 'unknown', tx: row.tx_hash, explorer: txUrl(row.tx_hash), message: 'the settlement is not final yet; retry with the same payment and it will be resolved from the chain' });
      const mismatch = result.transfers?.length && !result.transfers.some((t) => t.from === payer && t.to === cfg.treasury && t.amount === String(priceAtomic(route)));
      if (mismatch) { store.failed(hash, 'transfer_event_mismatch'); return send(res, 502, { error: 'transfer_event_mismatch', charged: 'unknown', tx: row.tx_hash, explorer: txUrl(row.tx_hash) }); }
      store.settled(hash, Date.now() - t1);
      return deliver(res, route, store.get(hash), up, t0);
    } finally { inflight.delete(`payer:${payer}`); inflight.delete(hash); }
  }

  // Resolves payments left "submitted" by a crash or a timeout: the chain says whether the agent was charged.
  async function reconcile() {
    let height = null;
    const out = { settled: 0, failed: 0, pending: 0 };
    for (const row of store.pending()) {
      const r = await chain.lookup(row.tx_hash, cfg.usdc.asset).catch(() => ({ kind: 'pending' }));
      if (r.kind === 'success') { store.settled(row.hash, null); out.settled++; continue; }
      if (r.kind === 'failure') { store.failed(row.hash, r.error); out.failed++; continue; }
      // never found: once the delegate window has closed it can no longer land, so the agent was not charged
      try { height ??= await chain.blockHeight(cfg.network); } catch { /* try next time */ }
      if (r.kind === 'unknown' && height != null && row.max_block_height && height > BigInt(row.max_block_height) + 30n) { store.failed(row.hash, 'expired_unsubmitted'); out.failed++; } else out.pending++;
    }
    return out;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const ip = String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '');
      const nowMs = Date.now();
      const h = hits.get(ip) || [0, nowMs];
      if (nowMs - h[1] > 60000) { h[0] = 0; h[1] = nowMs; }
      h[0]++; hits.set(ip, h);
      if (hits.size > 5000) hits.clear();
      if (h[0] > 240) return send(res, 429, { error: 'rate_limited' }, { 'retry-after': '30' });

      const url = new URL(req.url, 'http://x');
      const p = url.pathname.replace(/\/+$/, '') || '/';
      if (req.method === 'OPTIONS') return send(res, 204, '', {});
      if (p.startsWith('/api/')) {
        if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed', message: 'paid routes are GET only' }, { allow: 'GET' });
        const route = findRoute(p.slice(5));
        if (!route) return send(res, 404, { error: 'unknown_route', routes: ROUTES.map((r) => r.id) });
        return await paid(req, res, route, url);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method_not_allowed' }, { allow: 'GET, HEAD' });
      if (p === '/') return send(res, 200, landingHtml({ cfg, routes: ROUTES, priceUsdc, relayer: chain.relayerId }));
      if (p === '/health') return send(res, 200, { ok: true, network: cfg.network, settled: store.stats().settled });
      if (p === '/.well-known/x402' || p === '/.well-known/agentfeed-near.json' || p === '/manifest.json') return send(res, 200, manifest());
      if (p === '/stats') {
        const s = store.stats();
        return send(res, 200, {
          settled_calls: s.settled, usdc_settled: usdcStr(s.atomic), distinct_payers: s.payers, last_24h: s.last24h,
          settle_ms: s.settleMs, by_state: s.byState, by_route: s.byRoute,
          note: 'every payer is our own buyer account on NEAR testnet; see README, Evidence',
          recent: store.recent(10).map((x) => ({ ts: x.ts_settled || x.ts_created, route: x.route, payer: x.payer, amount_usdc: usdcStr(x.amount), tx: x.tx_hash, explorer: txUrl(x.tx_hash), settle_ms: x.settle_ms })),
        });
      }
      if (p === '/payments.csv') return send(res, 200, csv(), { 'content-type': 'text/csv; charset=utf-8' });
      return send(res, 404, { error: 'not_found', see: '/.well-known/x402' });
    } catch (e) {
      console.error('unhandled', e);
      if (!res.headersSent) send(res, 500, { error: 'internal_error' });
    }
  });
  server.reconcile = reconcile;
  return server;
}
