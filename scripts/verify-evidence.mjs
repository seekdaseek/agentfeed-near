// Re-checks every row of the gateway's public ledger against NEAR testnet itself (raw JSON-RPC, none of the gateway's code on the read path).
//   node scripts/verify-evidence.mjs [ledger.csv]      default: fetches https://near.ochinimus.app/payments.csv
// For each row: the relayer's transaction is FINAL, wraps one Delegate action from the payer with one ft_transfer (1 yocto) on the USDC
// contract, every receipt succeeded and the token receipt logged an ft_transfer event payer -> treasury for the ledger amount.
// Then: the treasury's USDC balance is compared with the ledger total plus the transfers listed in evidence/known-extra-transfers.csv
// (payments that reached the treasury outside the deployed gateway's ledger, each of them verified the same way).
import { readFileSync, existsSync } from 'node:fs';
import { parseLedger, verifyRows, treasuryBalance, fmtUsdc } from '../src/evidence.js';

const GATEWAY = (process.env.GATEWAY_URL || 'https://near.ochinimus.app').replace(/\/$/, '');
const RPC = process.env.NEAR_RPC_URL || 'https://rpc.testnet.fastnear.com';
const man = await (await fetch(`${GATEWAY}/.well-known/x402`)).json();
const ctx = { relayer: man.relayer, treasury: man.payTo, token: man.asset.account };
const csv = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : await (await fetch(`${GATEWAY}/payments.csv`)).text();
const rows = parseLedger(csv);
const extraPath = new URL('../evidence/known-extra-transfers.csv', import.meta.url);
const extras = existsSync(extraPath) ? parseLedger(readFileSync(extraPath, 'utf8')) : [];

const main = await verifyRows(rows, ctx, RPC);
const ext = await verifyRows(extras, ctx, RPC);
const bal = await treasuryBalance(ctx, RPC);
const expected = main.total + ext.total;
console.log(JSON.stringify({
  rows: rows.length, verifiedOnChain: main.ok, failed: main.bad.length, ledgerTotalUsdc: fmtUsdc(main.total),
  extraTransfersListed: extras.length, extraVerified: ext.ok, extraTotalUsdc: fmtUsdc(ext.total),
  treasuryBalanceUsdc: fmtUsdc(bal), treasuryMinusLedgerAndExtrasUsdc: fmtUsdc(bal - expected < 0n ? 0n : bal - expected), balanceMatches: bal === expected,
  treasury: ctx.treasury, relayer: ctx.relayer, token: ctx.token,
}, null, 1));
for (const b of [...main.bad, ...ext.bad]) console.log(b);
// A balance below what the chain-verified rows add up to cannot happen unless money left the treasury; above means unmatched inbound transfers.
process.exit(main.bad.length || ext.bad.length || bal < expected ? 1 : 0);
