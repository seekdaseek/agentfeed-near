// Writes docs/RESULTS.md from the gateway's public ledger, and re-reads every row from the chain while doing so.
//   node scripts/results.mjs [--gateway https://near.ochinimus.app] [--out docs/RESULTS.md]
// Nothing in the generated file is typed by hand except the fixed explanatory sentences in this script. The Mezo comparison comes from
// evidence/mezo-latency.json (a dated measurement, not recomputed here). A payer counts as independent only if it is not in evidence/own-accounts.txt.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { parseLedger, verifyRows, treasuryBalance, fmtUsdc, toAtomic } from '../src/evidence.js';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i < 0 ? d : process.argv[i + 1]; };
const GATEWAY = (arg('--gateway', process.env.GATEWAY_URL || 'https://near.ochinimus.app')).replace(/\/$/, '');
const OUT = new URL(arg('--out', '../docs/RESULTS.md'), import.meta.url);
const RPC = process.env.NEAR_RPC_URL || 'https://rpc.testnet.fastnear.com';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const man = await (await fetch(`${GATEWAY}/.well-known/x402`)).json();
const stats = await (await fetch(`${GATEWAY}/stats`)).json();
const csv = await (await fetch(`${GATEWAY}/payments.csv`)).text();
const ctx = { relayer: man.relayer, treasury: man.payTo, token: man.asset.account };
const rows = parseLedger(csv);
const extras = existsSync(new URL('../evidence/known-extra-transfers.csv', import.meta.url)) ? parseLedger(read('../evidence/known-extra-transfers.csv')) : [];
const own = new Set(read('../evidence/own-accounts.txt').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean));
const mezo = JSON.parse(read('../evidence/mezo-latency.json'));

const main = await verifyRows(rows, ctx, RPC);
const ext = await verifyRows(extras, ctx, RPC);
const bal = await treasuryBalance(ctx, RPC);

// ---- numbers
const num = (v) => (v === '' || v == null ? null : Number(v));
const pct = (a, q) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
const secs = (ms) => (ms == null ? 'n/a' : `${(ms / 1000).toFixed(1)} s`);
const total = rows.reduce((a, r) => a + toAtomic(r.amount_usdc), 0n);
const times = rows.map((r) => r.timestamp_utc).sort();
const group = (key) => { const m = new Map(); for (const r of rows) { const k = key(r); const e = m.get(k) || { n: 0, atomic: 0n, settle: [] }; e.n++; e.atomic += toAtomic(r.amount_usdc); e.settle.push(num(r.settle_ms)); m.set(k, e); } return [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))); };
const settle = rows.map((r) => num(r.settle_ms));
const upstream = rows.map((r) => num(r.upstream_ms));
const totalMs = rows.map((r) => num(r.total_ms));
const ownMs = rows.map((r, i) => (totalMs[i] != null && upstream[i] != null ? totalMs[i] - upstream[i] : null));
const share = rows.map((r, i) => (settle[i] != null && ownMs[i] ? settle[i] / ownMs[i] : null));
const payers = group((r) => r.payer);
const independent = payers.filter(([p]) => !own.has(p));
const notDelivered = (stats.by_state || []).filter((s) => s.state !== 'delivered');
let commit = 'unknown'; try { commit = execSync('git rev-parse --short HEAD', { cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a git checkout */ }
const verified = main.ok === rows.length && main.bad.length === 0;
const reconciles = bal === main.total + ext.total;
const medShare = pct(share, 0.5);

const md = [];
const w = (s = '') => md.push(s);
w('# Results');
w();
w(`_Written by \`scripts/results.mjs\` on ${new Date().toISOString()} from ${GATEWAY}/payments.csv (commit ${commit}). Do not edit by hand; run the script again._`);
w();
w(`**${rows.length} paid calls and ${fmtUsdc(total).replace(/0+$/, '').replace(/\.$/, '.00')} USDC settled on NEAR testnet through the deployed gateway; ${main.ok} of ${rows.length} re-read from the chain and verified. ${independent.length} of ${payers.length} payer accounts are independent of the builder: every call was bought by our own accounts.**`);
w();
w('## What is counted');
w();
w(`- Window: ${times[0] ?? 'n/a'} to ${times.at(-1) ?? 'n/a'} (UTC). Source: the gateway ledger, rows in state \`delivered\` (data handed over) or \`settled\`.`);
w(`- Calls: ${rows.length}. USDC: ${fmtUsdc(total)}. Distinct payer accounts: ${payers.length}; independent of the builder (not in \`evidence/own-accounts.txt\`): **${independent.length}**.`);
w(`- Payments in any other state (\`/stats\` \`by_state\`): ${notDelivered.length ? notDelivered.map((s) => `${s.state} ${s.n}`).join(', ') : 'none'}.`);
w();
w('| payer | calls | USDC | whose |');
w('|---|---|---|---|');
for (const [p, e] of payers) w(`| \`${p.length > 24 ? `${p.slice(0, 10)}…${p.slice(-6)}` : p}\` | ${e.n} | ${fmtUsdc(e.atomic)} | ${own.has(p) ? 'ours' : '**not listed as ours**'} |`);
w();
w('### By route');
w();
w('| route | calls | USDC | settle p50 |');
w('|---|---|---|---|');
for (const [r, e] of group((x) => x.route)) w(`| ${r} | ${e.n} | ${fmtUsdc(e.atomic)} | ${secs(pct(e.settle, 0.5))} |`);
w();
w('### By day (UTC)');
w();
w('| day | calls | USDC |');
w('|---|---|---|');
for (const [d, e] of group((x) => x.timestamp_utc.slice(0, 10))) w(`| ${d} | ${e.n} | ${fmtUsdc(e.atomic)} |`);
w();
w('## Chain check');
w();
w(`Every ledger row was looked up by transaction hash on NEAR testnet RPC (\`${RPC}\`) by the same code as \`scripts/verify-evidence.mjs\`: the relayer \`${ctx.relayer}\` signed it, it is FINAL, it wraps one Delegate action from the payer with one \`ft_transfer\` (1 yocto) on the USDC contract, every receipt succeeded, and the token logged an \`ft_transfer\` event payer to treasury for the ledger amount.`);
w();
w(`- Ledger rows verified: **${main.ok} of ${rows.length}**${main.bad.length ? ` (FAILED: ${main.bad.length})` : ''}. Ledger total ${fmtUsdc(main.total)} USDC.`);
w(`- Transfers into the treasury that are not in the deployed ledger (the Phase 1 proof, a local rehearsal, the live drill; listed in \`evidence/known-extra-transfers.csv\`): ${extras.length} listed, ${ext.ok} verified the same way, ${fmtUsdc(ext.total)} USDC.`);
w(`- Treasury \`${ctx.treasury}\` USDC balance: **${fmtUsdc(bal)}**. Ledger plus listed extras: ${fmtUsdc(main.total + ext.total)}. **${reconciles ? 'They match exactly.' : `They differ by ${fmtUsdc(bal > main.total + ext.total ? bal - main.total - ext.total : main.total + ext.total - bal)} USDC (${bal > main.total + ext.total ? 'unlisted inbound transfers' : 'money left the treasury'}).`}**`);
if (main.bad.length) { w(); for (const b of main.bad) w(`- FAILED ${b}`); }
w();
w('## Latency');
w();
w(`Server-side timings from the ledger (\`settle_ms\` runs from the relayer broadcast to \`FINAL\`; \`upstream_ms\` is the AgentFeed fetch; \`total_ms\` is the whole paid request inside the gateway; "gateway-only" is total minus upstream).`);
w();
w('| | n | p50 | p90 | max |');
w('|---|---|---|---|---|');
const lat = (name, a) => { const v = a.filter((x) => x != null); w(`| ${name} | ${v.length} | ${secs(pct(a, 0.5))} | ${secs(pct(a, 0.9))} | ${secs(v.length ? Math.max(...v) : null)} |`); };
lat('settle (broadcast to FINAL)', settle);
lat('AgentFeed fetch', upstream);
lat('gateway-only (total minus fetch)', ownMs);
lat('whole paid request', totalMs);
w();
w('## The number that makes us look bad');
w();
w(`**Settlement is about ${medShare == null ? 'n/a' : `${Math.round(medShare * 100)}%`} of the gateway's own time on a typical call (median settle share of gateway-only time), and the gateway-only time is ${secs(pct(ownMs, 0.5))} at the median, ${secs(pct(ownMs, 0.9))} at p90.** AgentFeed itself answers in ${secs(pct(upstream, 0.5))} at the median. A cent-priced data call therefore spends most of its time waiting for a blockchain.`);
w();
w('Against the same product on Mezo (`evidence/mezo-latency.json`, measured ' + mezo.measured + ' from a read-only copy of that gateway\'s ledger):');
w();
w('| | n | gateway-only p50 | gateway-only p90 | gateway-only max |');
w('|---|---|---|---|---|');
w(`| agentfeed-near (this ledger, gasless for the agent) | ${rows.length} | ${secs(pct(ownMs, 0.5))} | ${secs(pct(ownMs, 0.9))} | ${secs(ownMs.filter((x) => x != null).length ? Math.max(...ownMs.filter((x) => x != null)) : null)} |`);
w(`| agentfeed-mezo, permit scheme (gasless for the agent) | ${mezo.permit.n} | ${secs(mezo.permit.own_ms.p50)} | ${secs(mezo.permit.own_ms.p90)} | ${secs(mezo.permit.own_ms.max)} |`);
w(`| agentfeed-mezo, transfer scheme (agent paid its own gas first) | ${mezo.transfer.n} | ${secs(mezo.transfer.own_ms.p50)} | ${secs(mezo.transfer.own_ms.p90)} | ${secs(mezo.transfer.own_ms.max)} |`);
w();
w(`Reading it honestly: against the like-for-like Mezo gasless path (permit scheme) the NEAR gateway is ${pct(ownMs, 0.5) != null && pct(ownMs, 0.5) <= mezo.permit.own_ms.p50 ? 'not slower' : 'slower'} at the median. The real cost shows against a payment the agent has already settled itself (Mezo's transfer scheme, ${secs(mezo.transfer.own_ms.p50)} inside the gateway at the median): the gasless convenience moves the ${secs(pct(settle, 0.5))} of settlement (broadcast to FINAL, median) from "before the request" into the request. That is a trade, not a free lunch: the agent never holds NEAR or manages gas, and it pays for that with latency per call. What the ledger cannot show is how the broadcast-to-FINAL time splits between inclusion and finality; the code waits for FINAL because the ledger must never count a payment that can still be reorged. Serial design adds to it: data is fetched first, then the payment settles (so an outage never charges), and one relayer key serialises settlements.`);
w();
w('The other number that looks bad, stated plainly: **independent payers = ' + independent.length + '.** Every payment on NEAR in this ledger was made by an account the builder controls (`evidence/own-accounts.txt`). AgentFeed\'s separate mainnet history is not part of this file.');
w();
w('## Regenerate');
w();
w('```sh');
w('node scripts/results.mjs            # fetches the ledger and re-reads every row from NEAR testnet RPC');
w('```');
writeFileSync(OUT, md.join('\n') + '\n');
console.log(`wrote ${OUT.pathname}: ${rows.length} rows, ${main.ok} verified, treasury reconciles: ${reconciles}, independent payers: ${independent.length}`);
process.exit(verified ? 0 : 1);
