// The AgentFeed routes this gateway resells, priced in USDC cents per call (Circle USDC has 6 decimals).
// Upstream list prices on 2026-10-29 are $0.001 to $0.02 (x402.ochinimus.app/openapi.json); every route here sells at or above list.
const CENT = 10_000n; // 0.01 USDC in atomic units

export const ROUTES = [
  { id: 'sol-price', upstream: '/sol-price', cents: 1, params: {}, title: 'SOL spot price', description: 'Live SOL/USD spot price.' },
  { id: 'btc-price', upstream: '/btc-price', cents: 1, params: {}, title: 'BTC spot price', description: 'Live BTC/USD spot price.' },
  { id: 'liq-pulse', upstream: '/liq-pulse', cents: 1, params: {}, title: 'Liquidation pulse', description: 'What is being liquidated right now, in one small payload.' },
  { id: 'funding-pulse', upstream: '/funding-pulse', cents: 1, params: {}, title: 'Funding pulse', description: 'The most extreme perp funding rates right now.' },
  { id: 'liquidations', upstream: '/liquidations', cents: 2, params: { symbol: 'string', scope: 'string', limit: 'int', min_usd: 'number' }, title: 'Recent liquidations', description: 'Live liquidation tape across venues. Optional symbol, scope, limit, min_usd.' },
  { id: 'market-snapshot', upstream: '/market-snapshot', cents: 2, params: {}, title: 'Market snapshot', description: 'Crypto market snapshot in one call.' },
  { id: 'trade-context', upstream: '/trade-context', cents: 3, params: {}, title: 'Trade context', description: 'Crypto trading context in one call: prices, funding, liquidations.' },
  { id: 'summarize', upstream: '/summarize', cents: 5, params: { url: 'string!', length: 'string' }, title: 'Summarize a web page', description: 'Fixed-purpose language task: summarize the page at ?url=. Optional length.' },
];

export const priceAtomic = (route) => BigInt(route.cents) * CENT;
export const priceUsdc = (route) => (route.cents / 100).toFixed(2);
export const findRoute = (id) => ROUTES.find((r) => r.id === id);
export const usdcStr = (atomic) => {
  const a = BigInt(atomic);
  const whole = a / 1_000_000n;
  const frac = (a % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '').padEnd(2, '0');
  return `${whole}.${frac}`;
};

// Keep only declared params; reject a missing required one. Returns { ok, query } or { ok:false, error }.
export function cleanParams(route, searchParams) {
  const query = new URLSearchParams();
  for (const [name, spec] of Object.entries(route.params)) {
    const required = spec.endsWith('!');
    const type = spec.replace('!', '');
    const v = searchParams.get(name);
    if (v == null || v === '') {
      if (required) return { ok: false, error: `missing required query parameter: ${name}` };
      continue;
    }
    if (v.length > 2048) return { ok: false, error: `${name} is too long` };
    if (type === 'int' && !/^\d{1,6}$/.test(v)) return { ok: false, error: `${name} must be an integer` };
    if (type === 'number' && !/^\d{1,15}(\.\d{1,6})?$/.test(v)) return { ok: false, error: `${name} must be a number` };
    query.set(name, v);
  }
  return { ok: true, query };
}
