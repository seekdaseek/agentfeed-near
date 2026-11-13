// Re-checks every row of the gateway's public ledger against NEAR testnet itself (raw JSON-RPC, none of the gateway's code on the read path).
//   node scripts/verify-evidence.mjs [ledger.csv]      default: fetches https://near.ochinimus.app/payments.csv
// For each row: the relayer's transaction is FINAL, wraps one Delegate action from the payer with one ft_transfer (1 yocto) on the USDC
// contract, every receipt succeeded and the token receipt logged an ft_transfer event payer -> treasury for the ledger amount.
// Then: the treasury's USDC balance is compared with the ledger total plus the transfers listed in evidence/known-extra-transfers.csv
// (payments that reached the treasury outside the deployed gateway's ledger, each of them verified the same way) minus the verified
// outflows in evidence/treasury-outflows.csv (the treasury recycling USDC to our own batch buyer).
import { readFileSync, existsSync } from 'node:fs';
import { parseLedger, verifyRows, verifyOutflows, treasuryBalance, fmtUsdc, toAtomic } from '../src/evidence.js';

const args = process.argv.slice(2);
const ALL = args.includes('--all');
const RECENT = 30; // default: the newest 30 rows are re-read from the chain (a regular node keeps a few days); --all re-reads every row and every extra
const GATEWAY = (process.env.GATEWAY_URL || 'https://near.ochinimus.app').replace(/\/$/, '');
// regular node for recent transactions; --all uses an archival node, because a regular node prunes transactions after a few days and
// archival nodes are rate-limited (several minutes for a few hundred rows)
const RPC = process.env.NEAR_RPC_URL || (ALL ? 'https://archival-rpc.testnet.near.org' : 'https://rpc.testnet.fastnear.com');
const STATE_RPC = process.env.NEAR_STATE_RPC_URL || 'https://rpc.testnet.fastnear.com'; // balances: current state, regular node
const man = await (await fetch(`${GATEWAY}/.well-known/x402`)).json();
const ctx = { relayer: man.relayer, treasury: man.payTo, token: man.asset.account };
const file = args.find((a) => !a.startsWith('--'));
const csv = file ? readFileSync(file, 'utf8') : await (await fetch(`${GATEWAY}/payments.csv`)).text();
const rows = parseLedger(csv);
const extraPath = new URL('../evidence/known-extra-transfers.csv', import.meta.url);
const extras = existsSync(extraPath) ? parseLedger(readFileSync(extraPath, 'utf8')) : [];

// USDC the treasury sent out itself (a recycle to our own batch buyer), each verified from the chain and each to an account in own-accounts.txt.
const outPath = new URL('../evidence/treasury-outflows.csv', import.meta.url);
const outflows = existsSync(outPath) ? parseLedger(readFileSync(outPath, 'utf8')) : [];
const own = new Set(readFileSync(new URL('../evidence/own-accounts.txt', import.meta.url), 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean));
const notOwn = outflows.filter((o) => !own.has(o.to)).map((o) => `${o.tx_hash}: recipient ${o.to} is not in evidence/own-accounts.txt`);

const sum = (a) => a.reduce((t, r) => t + toAtomic(r.amount_usdc), 0n);
const checked = ALL ? rows : rows.slice(-RECENT);
const main = await verifyRows(checked, ctx, RPC);
const ext = ALL ? await verifyRows(extras, ctx, RPC) : { ok: 0, total: sum(extras), bad: [] };
const out = await verifyOutflows(outflows, ctx, RPC);
const bal = await treasuryBalance(ctx, STATE_RPC);
// not --all: the totals of the rows that were not re-read come from the CSV files, and the output says so
const ledgerTotal = ALL ? main.total : sum(rows);
const expected = ledgerTotal + ext.total - out.total;
console.log(JSON.stringify({
  mode: ALL ? 'all rows re-read from the chain' : `newest ${checked.length} rows re-read from the chain, the rest counted from the CSV; use --all for every row`,
  rows: rows.length, rowsCheckedOnChain: checked.length, verifiedOnChain: main.ok, failed: main.bad.length, ledgerTotalUsdc: fmtUsdc(ledgerTotal),
  extraTransfersListed: extras.length, extraVerified: ALL ? ext.ok : 'not re-read without --all', extraTotalUsdc: fmtUsdc(ext.total),
  outflowsListed: outflows.length, outflowsVerified: out.ok, outflowTotalUsdc: fmtUsdc(out.total),
  treasuryBalanceUsdc: fmtUsdc(bal), treasuryMinusExpectedUsdc: fmtUsdc(bal - expected < 0n ? 0n : bal - expected), balanceMatches: bal === expected,
  treasury: ctx.treasury, relayer: ctx.relayer, token: ctx.token,
}, null, 1));
for (const b of [...main.bad, ...ext.bad, ...out.bad, ...notOwn]) console.log(b);
// expected = ledger + listed extras - verified outflows. A balance below it means money left the treasury unrecorded; above means unmatched inbound transfers.
process.exit(main.bad.length || ext.bad.length || out.bad.length || notOwn.length || bal < expected ? 1 : 0);
