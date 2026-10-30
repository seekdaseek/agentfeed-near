// CONTROL: the same 0.01 USDC purchase made the old way and our way, on NEAR testnet.
//   node scripts/control-old-way.mjs [--save]    --save writes evidence/control-<date>.txt; needs ~/.near-credentials for the control account and the buyer
//
//   (a) old way, no gas:  an account that holds USDC but has almost no NEAR signs a plain ft_transfer -> the network refuses it
//   (b) our way:          the SAME account pays the gateway with one delegate action; the relayer pays the gas; its NEAR balance is unchanged
//   (c) old way, funded:  an account with NEAR signs the same plain ft_transfer -> it works, so the control is fair
//
// Setup (once, done 2026-10-29): a fresh implicit account (key generated locally) funded with 0.0025 NEAR (storage minimum 0.00182, spendable
// 0.00068, less than the ~0.003 a 30 Tgas call needs), registered on the USDC contract by the buyer and sent 0.05 USDC by the buyer.
import { writeFileSync } from 'node:fs';
import { createAgent, loadSecretKey } from '../src/client.js';
import { provider, usdcBalance, nearBalance, settledNearBalance, oldWayTransfer } from '../src/control.js';

// the control account: an implicit NEAR account (its id is the hex of its public key; the key is in ~/.near-credentials/testnet/<id>.json)
const POOR = process.env.CONTROL_ACCOUNT || '94ef19a8accede5cef0983c5cd0eeeda22aa43cb34210567e6d4eacfde8668b4';
const BUYER = 'agentfeed-near-buyer.testnet';
const GATEWAY = (process.env.GATEWAY_URL || 'https://near.ochinimus.app').replace(/\/$/, '');
const PRICE = 10_000n;
const near = (x) => (Number(x) / 1e24).toFixed(6);
const usdc = (x) => (Number(x) / 1e6).toFixed(6);
const p = provider();
const out = []; let bad = 0;
const say = (s = '') => { console.log(s); out.push(s); };
const check = (ok, what) => { if (!ok) bad++; say(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`); };

const s0 = { near: await nearBalance(p, POOR), usdc: await usdcBalance(p, POOR) };
say(`# control ${new Date().toISOString()}  account ${POOR.slice(0, 10)}…${POOR.slice(-6)}  USDC ${usdc(s0.usdc)}  NEAR total ${near(s0.near.total)}, locked for storage ${near(s0.near.locked)}, spendable ${near(s0.near.spendable)}`);

say('\n(a) old way, no gas: plain ft_transfer signed by the account itself');
const a = await oldWayTransfer({ p, accountId: POOR, secretKey: loadSecretKey(POOR), to: BUYER, amount: PRICE });
check(a.ok === false, `refused by the network: ${a.type}: ${(a.message || '').replace(/\s+/g, ' ').slice(0, 220)}`);
const sA = { near: await nearBalance(p, POOR), usdc: await usdcBalance(p, POOR) };
check(sA.usdc === s0.usdc && sA.near.total === s0.near.total, 'nothing moved: no transaction was recorded, no explorer link exists for a refusal at validation');

say('\n(b) our way: the same account pays the gateway with a delegate action (the relayer pays the gas)');
const agent = createAgent({ accountId: POOR, secretKey: loadSecretKey(POOR), baseUrl: GATEWAY, retries: 1 });
const b = await agent.call('sol-price');
check(b.ok, `gateway answered ${b.status} in ${(b.ms / 1000).toFixed(1)} s${b.paid ? `, tx ${b.paid.tx}` : `, ${b.body?.error}`}`);
if (b.paid) say(`  ${b.paid.url}`);
const sB = { near: await nearBalance(p, POOR), usdc: await usdcBalance(p, POOR) };
check(sB.usdc === s0.usdc - PRICE, `USDC moved by exactly the price: ${usdc(s0.usdc)} -> ${usdc(sB.usdc)}`);
check(sB.near.total === s0.near.total, `NEAR balance unchanged: ${near(s0.near.total)} -> ${near(sB.near.total)}`);

say('\n(c) old way, funded: the buyer account (which holds NEAR) signs the same plain ft_transfer');
const bb0 = await settledNearBalance(p, BUYER);
const c = await oldWayTransfer({ p, accountId: BUYER, secretKey: loadSecretKey(BUYER), to: POOR, amount: PRICE });
check(c.ok, c.ok ? `succeeded, tx ${c.tx}  ${'https://testnet.near.rocks/tx/' + c.tx}` : `${c.type}: ${c.message}`);
const bb1 = await settledNearBalance(p, BUYER); // after the refund of the unused prepaid gas
const spent = bb0.total - bb1.total;
check(c.ok && spent > 0n, `it cost the signer NEAR for gas: ${near(spent)} NEAR`);

say(`\n# ${bad ? `${bad} CHECK(S) FAILED` : 'all checks passed'}`);
if (process.argv.includes('--save')) writeFileSync(new URL(`../evidence/control-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.txt`, import.meta.url), out.join('\n') + '\n');
process.exit(bad ? 1 : 0);
