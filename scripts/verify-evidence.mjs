// Re-checks every row of the gateway's public ledger against NEAR testnet itself (raw JSON-RPC, none of the gateway's code on the read path).
//   node scripts/verify-evidence.mjs [ledger.csv]      default: fetches https://near.ochinimus.app/payments.csv
// For each row: the relayer's transaction is FINAL, wraps one Delegate action from the payer with one ft_transfer (1 yocto) on the USDC
// contract, every receipt succeeded and the token receipt logged an ft_transfer event payer -> treasury for the ledger amount.
// Then: the treasury's USDC balance is compared with the ledger total plus the transfers listed in evidence/known-extra-transfers.csv
// (payments that reached the treasury outside the deployed gateway's ledger, each of them verified the same way).
import { readFileSync, existsSync } from 'node:fs';
import { checkTx, toAtomic } from '../src/evidence.js';

const GATEWAY = (process.env.GATEWAY_URL || 'https://near.ochinimus.app').replace(/\/$/, '');
const RPC = process.env.NEAR_RPC_URL || 'https://rpc.testnet.fastnear.com';
const man = await (await fetch(`${GATEWAY}/.well-known/x402`)).json();
const ctx = { relayer: man.relayer, treasury: man.payTo, token: man.asset.account };
const csv = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : await (await fetch(`${GATEWAY}/payments.csv`)).text();
const parse = (text) => text.trim().split('\n').slice(1).filter(Boolean).map((l) => {
  const [ts, route, payer, amount_usdc, tx_hash, relayer, , state] = l.split(',');
  return { ts, route, payer, amount_usdc, tx_hash, relayer, state };
});
const rows = parse(csv);
const extraPath = new URL('../evidence/known-extra-transfers.csv', import.meta.url);
const extras = existsSync(extraPath) ? parse(readFileSync(extraPath, 'utf8')) : [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rpc(method, params) {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) })).json();
      if (r.result) return r.result;
      if (r.error?.cause?.name === 'UNKNOWN_TRANSACTION') { await sleep(500); continue; }
      if (i === 5) return null;
    } catch { await sleep(500); }
  }
  return null;
}
async function verify(list) {
  let ok = 0, total = 0n; const bad = [];
  for (const row of list) {
    const result = await rpc('tx', { tx_hash: row.tx_hash, sender_account_id: ctx.relayer, wait_until: 'FINAL' });
    const c = checkTx(result, row, ctx);
    if (c.ok) { ok++; total += c.amount; } else bad.push(`${row.tx_hash}: ${c.why}`);
  }
  return { ok, total, bad };
}
const main = await verify(rows);
const ext = await verify(extras);
const bal = BigInt((await rpc('query', { request_type: 'call_function', finality: 'final', account_id: ctx.token, method_name: 'ft_balance_of', args_base64: Buffer.from(JSON.stringify({ account_id: ctx.treasury })).toString('base64') })).result.map((b) => String.fromCharCode(b)).join('').replace(/"/g, ''));
const usdc = (a) => `${a / 1_000_000n}.${String(a % 1_000_000n).padStart(6, '0')}`;
const expected = main.total + ext.total;
console.log(JSON.stringify({
  rows: rows.length, verifiedOnChain: main.ok, failed: main.bad.length, ledgerTotalUsdc: usdc(main.total),
  extraTransfersListed: extras.length, extraVerified: ext.ok, extraTotalUsdc: usdc(ext.total),
  treasuryBalanceUsdc: usdc(bal), treasuryMinusLedgerAndExtrasUsdc: usdc(bal - expected < 0n ? 0n : bal - expected), balanceMatches: bal === expected,
  treasury: ctx.treasury, relayer: ctx.relayer, token: ctx.token,
}, null, 1));
for (const b of [...main.bad, ...ext.bad]) console.log(b);
// A balance below what the chain-verified rows add up to cannot happen unless money left the treasury; above means unmatched inbound transfers.
process.exit(main.bad.length || ext.bad.length || bal < expected ? 1 : 0);
