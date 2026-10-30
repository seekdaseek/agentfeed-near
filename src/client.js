// Agent client: pays AgentFeed-on-NEAR routes in USDC. Library + CLI.
// The payment is the stock x402 `exact` NEAR client from @x402/near (one NEP-366 delegate action carrying one ft_transfer);
// this file adds the checks an unattended agent needs around it: never sign for another network, token or a price above the cap.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ExactNearScheme, createClientNearSigner } from '@x402/near';
import { JsonRpcProvider } from '@near-js/providers';
import { NEAR_TESTNET, USDC } from './config.js';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
const unb64 = (s) => JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// near-cli stores keys as ~/.near-credentials/testnet/<account>.json with a private_key field
export function loadSecretKey(accountId, dir = join(homedir(), '.near-credentials', 'testnet')) {
  const k = JSON.parse(readFileSync(join(dir, `${accountId}.json`), 'utf8')).private_key;
  if (!/^ed25519:/.test(k || '')) throw new Error(`no ed25519 private_key in ${accountId}.json`);
  return k;
}

export function createAgent({
  accountId, secretKey, baseUrl = 'https://near.ochinimus.app', rpcUrl = NEAR_TESTNET.rpcUrl, fetchImpl = fetch,
  maxPriceUsdc = 0.1, asset = USDC.asset, network = NEAR_TESTNET.network, explorer = NEAR_TESTNET.explorer, retries = 3,
}) {
  const signer = createClientNearSigner({ accountId, secretKey, rpcUrls: { [network]: rpcUrl } });
  const scheme = new ExactNearScheme(signer);
  const provider = new JsonRpcProvider({ url: rpcUrl });
  baseUrl = baseUrl.replace(/\/$/, '');

  const urlFor = (route, params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)]));
    return `${baseUrl}/api/${route}${q.size ? `?${q}` : ''}`;
  };
  const readChallenge = async (res) => {
    const h = res.headers.get('payment-required');
    return h ? unb64(h) : res.json();
  };

  // Never sign what the 402 says without checking it against what this agent expects.
  function guard(accept) {
    if (accept.scheme !== 'exact') throw new Error(`refusing: scheme ${accept.scheme}, expected exact`);
    if (accept.network !== network) throw new Error(`refusing: challenge is for ${accept.network}, expected ${network}`);
    if (accept.asset !== asset) throw new Error(`refusing: challenge asks for token ${accept.asset}, expected USDC ${asset}`);
    const usdc = Number(BigInt(accept.amount)) / 1e6;
    if (usdc > maxPriceUsdc) throw new Error(`refusing: price ${usdc} USDC is above the cap of ${maxPriceUsdc}`);
  }

  // Signs one payment for a route and returns it WITHOUT sending it, so the same signed payment can be presented more than once
  // (the drill does exactly that after killing the gateway). Returns { status, body } instead when the route needs no payment.
  async function prepare(route, params = {}) {
    const url = urlFor(route, params);
    const first = await fetchImpl(url);
    if (first.status !== 402) return { unpaid: { status: first.status, ok: first.ok, body: await first.json().catch(() => ({})) } };
    const challenge = await readChallenge(first);
    const accept = challenge.accepts?.find((a) => a.scheme === 'exact' && a.network === network);
    if (!accept) throw new Error(`gateway offers no exact payment on ${network}`);
    guard(accept);
    const signed = await scheme.createPaymentPayload(2, accept); // signs one NEP-366 delegate action; no gas, no broadcast
    const payment = { x402Version: 2, resource: challenge.resource, accepted: accept, payload: signed.payload };
    return { url, payment, header: b64(payment), send: () => fetchImpl(url, { headers: { 'payment-signature': b64(payment) } }) };
  }

  async function call(route, params = {}) {
    const t0 = Date.now();
    const p = await prepare(route, params);
    if (p.unpaid) return { ok: p.unpaid.ok, status: p.unpaid.status, body: p.unpaid.body, ms: Date.now() - t0, paid: null };
    let res = await p.send();
    let body = await res.json().catch(() => ({}));
    // The same signed payment can be presented again while its block window is open: it can only be charged once, and
    // "charged:false" refusals, a pending settlement and a payment still in flight all resolve by asking again.
    for (let i = 0; i < retries && !res.ok && (body.charged === false ? ['upstream_unavailable', 'chain_unavailable'].includes(body.error) : ['settlement_pending', 'settlement_unconfirmed', 'payment_in_flight'].includes(body.error)); i++) {
      await sleep(2500);
      res = await p.send();
      body = await res.json().catch(() => ({}));
    }
    const receipt = res.headers.get('payment-response') ? unb64(res.headers.get('payment-response')) : null;
    return { ok: res.ok, status: res.status, body, receipt, ms: Date.now() - t0, paid: res.ok ? { tx: receipt?.transaction, url: `${explorer}/tx/${receipt?.transaction}` } : null };
  }

  const balance = async () => BigInt(await provider.callFunction(asset, 'ft_balance_of', { account_id: accountId }, { finality: 'final' }));
  return { accountId, call, prepare, urlFor, balance };
}

// ---- CLI ----
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const flag = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
  const n = Number(flag('--n', '1'));
  const gap = Number(flag('--gap-ms', '0'));
  const pretty = args.includes('--pretty') ? (args.splice(args.indexOf('--pretty'), 1), true) : false;
  const [route, ...kv] = args;
  const accountId = process.env.AGENT_ACCOUNT_ID;
  if (!route || !accountId) {
    console.error('usage: AGENT_ACCOUNT_ID=you.testnet [AGENT_PRIVATE_KEY=ed25519:...] [GATEWAY_URL=...] node src/client.js <route> [k=v ...] [--n N] [--pretty]');
    console.error('       without AGENT_PRIVATE_KEY the key is read from ~/.near-credentials/testnet/<AGENT_ACCOUNT_ID>.json (near-cli format)');
    process.exit(2);
  }
  const params = Object.fromEntries(kv.map((x) => x.split(/=(.*)/s).slice(0, 2)));
  const agent = createAgent({ accountId, secretKey: process.env.AGENT_PRIVATE_KEY || loadSecretKey(accountId), baseUrl: process.env.GATEWAY_URL || undefined, maxPriceUsdc: Number(process.env.MAX_PRICE_USDC || 0.1) });
  let okCount = 0;
  for (let i = 0; i < n; i++) {
    try {
      const r = await agent.call(route, params);
      if (r.ok) okCount++;
      const preview = JSON.stringify(r.body.data ?? r.body).slice(0, 160);
      if (pretty) {
        console.log(`${r.ok ? 'paid' : 'refused'}  status ${r.status}  ${(r.ms / 1000).toFixed(1)} s  ${r.body.paid ? `${r.body.paid.amount_usdc} USDC` : r.body.error}`);
        if (r.paid) console.log(`tx    ${r.paid.tx}\nlink  ${r.paid.url}`);
        console.log(`data  ${preview}`);
      } else console.log(JSON.stringify({ i: i + 1, route, status: r.status, ms: r.ms, tx: r.paid?.tx, explorer: r.paid?.url, error: r.ok ? undefined : r.body.error, preview }));
    } catch (e) { console.log(JSON.stringify({ i: i + 1, route, error: e.message })); }
    if (gap) await sleep(gap);
  }
  console.log(`# ${okCount}/${n} paid calls succeeded`);
}
