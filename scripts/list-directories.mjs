// Lists the gateway's routes in the two public x402 directories that take a self-service registration with no account and no key:
//   Ultravioleta Bazaar   POST https://facilitator.ultravioletadao.xyz/discovery/register   (supports near:testnet; its prober reads the URL afterwards)
//   402index              POST https://402index.io/api/v1/register                            (probes the URL, reviews the entry; 10 per hour per IP)
// Every entry says NEAR TESTNET in its name or description, so no agent mistakes it for a mainnet service.
//   node scripts/list-directories.mjs [--dry] [--uv] [--402index] [--only sol-price]       (nothing is sent without --uv or --402index; --dry prints the bodies)
import { setTimeout as sleep } from 'node:timers/promises';

const GATEWAY = (process.env.GATEWAY_URL || 'https://near.ochinimus.app').replace(/\/$/, '');
const arg = (n) => process.argv.includes(n);
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const man = await (await fetch(`${GATEWAY}/.well-known/x402`)).json();
const routes = man.routes.filter((r) => !only || r.id === only);
const post = async (url, body) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'agentfeed-near-owner/1.0' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: r.status, json, retryAfter: r.headers.get('retry-after') };
};
const live402 = async (r) => {
  const res = await fetch(r.url);
  const h = res.headers.get('payment-required');
  if (res.status !== 402 || !h) throw new Error(`${r.url} did not answer 402 with a payment-required header (${res.status})`);
  return JSON.parse(Buffer.from(h, 'base64').toString());
};
const text = (r) => `${r.description} Pays in Circle testnet USDC on NEAR TESTNET (near:testnet): no real money. x402 v2 exact, the gateway pays the gas.`;

if (arg('--uv')) {
  for (const [i, r] of routes.entries()) {
    const c = await live402(r);
    const body = { url: r.url, type: 'http', description: text(r), accepts: c.accepts, metadata: { provider: 'agentfeed-near', category: 'data', tags: ['near', 'near-testnet', 'market-data', 'testnet'] }, extensions: c.extensions || {} };
    if (arg('--dry')) { console.log('DRY uv', JSON.stringify(body).slice(0, 600)); continue; }
    const s = await post('https://facilitator.ultravioletadao.xyz/discovery/register', body);
    console.log(`uv ${i + 1}/${routes.length} ${r.id} HTTP ${s.status}`, s.status === 201 || s.status === 409 ? '' : JSON.stringify(s.json).slice(0, 300));
    if (s.status !== 201 && s.status !== 409) { console.log('STOP: an answer other than 201 or 409'); process.exit(1); }
    if (i + 1 < routes.length) await sleep(15000); // their limit is about 5 a minute per IP
  }
}
if (arg('--402index')) {
  for (const [i, r] of routes.entries()) {
    const body = { url: r.url, name: `AgentFeed NEAR testnet: ${r.id}`, protocol: 'x402', http_method: 'GET', description: text(r), price_usd: Number(r.price_usdc), payment_asset: 'USDC (Circle testnet)', payment_network: 'NEAR testnet (near:testnet)', provider: 'agentfeed-near' };
    if (arg('--dry')) { console.log('DRY 402index', JSON.stringify(body).slice(0, 600)); continue; }
    const s = await post('https://402index.io/api/v1/register', body);
    console.log(`402index ${i + 1}/${routes.length} ${r.id} HTTP ${s.status}`, JSON.stringify(s.json).slice(0, 240), s.retryAfter ? `retry-after ${s.retryAfter}` : '');
    if (s.status >= 400 && s.status !== 409) { console.log('STOP'); process.exit(1); }
    if (i + 1 < routes.length) await sleep(3000);
  }
}
if (!arg('--uv') && !arg('--402index')) console.log('nothing to do: pass --uv and/or --402index (add --dry to print the bodies without sending)');
