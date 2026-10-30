// LIVE drill on NEAR testnet: the gateway is killed with SIGKILL at the dangerous points of a payment, and the chain, not the gateway,
// says what the agent was charged.
//
//   node scripts/drill.mjs [--record] [S1 S2 ...]         needs ~/.near-credentials for the relayer, treasury and buyer accounts
//
// What runs: a real `node src/main.js` gateway (live NEAR testnet, a local fake AgentFeed upstream that can hold a request) and a
// pass-through proxy in front of the NEAR RPC that can hold the relayer's broadcast or answer it with the node's TIMEOUT_ERROR. The agent signs ONE payment per
// scenario and presents the same signed payment again after the failure. After each scenario the USDC balances are read from the chain.
//
//   S1  killed while the data is being fetched         (after verify, before any transaction)   expect: charged 0 at the kill, once after the retry
//   S2  killed after the tx hash and bytes are stored, before the broadcast leaves the process   expect: charged 0 at the kill, once after the retry (stored bytes resent)
//   S3  killed after the broadcast LANDED, before the reply reached the gateway                  expect: charged once at the kill, once after the retry (no second charge)
//   S4  gateway alive, the RPC answers the broadcast with TIMEOUT_ERROR but the tx DID land    expect: served in the same request (found by looking the hash up), charged once
//   S5  gateway alive, the RPC answers TIMEOUT_ERROR and the tx never reached the chain         expect: hash unknown to the chain, stored bytes resent, served in the same request, charged once
//   S6  the delivered payment is presented again                                                 expect: refused, no change
//
// --record appends the delivered payments to evidence/known-extra-transfers.csv (they are real transfers into the treasury that the
// deployed gateway's ledger does not contain) and writes evidence/drill-<date>-node<major>.txt.
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { mkdtempSync, appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { JsonRpcProvider } from '@near-js/providers';
import { createAgent, loadSecretKey } from '../src/client.js';

// On a machine without ~/.near-credentials (the VPS) the keys come from RELAYER_PRIVATE_KEY and AGENT_PRIVATE_KEY.
const keyFor = (account, envName) => process.env[envName] || loadSecretKey(account);
import { NEAR_TESTNET, USDC } from '../src/config.js';

const RECORD = process.argv.includes('--record');
const ONLY = process.argv.slice(2).filter((a) => /^S\d$/.test(a));
const BUYER = process.env.AGENT_ACCOUNT_ID || 'agentfeed-near-buyer.testnet';
const TREASURY = 'agentfeed-near-treasury.testnet';
const RELAYER = 'agentfeed-near-relayer.testnet';
const PRICE = 10_000n; // sol-price, 0.01 USDC
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const real = new JsonRpcProvider({ url: NEAR_TESTNET.rpcUrl });
const lines = [];
const say = (s = '') => { console.log(s); lines.push(s); };

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const readBody = (req) => new Promise((res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => res(Buffer.concat(c).toString())); });
const balance = async (a) => BigInt(await real.callFunction(USDC.asset, 'ft_balance_of', { account_id: a }, { finality: 'final' }));
const bal = async () => ({ buyer: await balance(BUYER), treasury: await balance(TREASURY) });
const usdc = (x) => (Number(x) / 1e6).toFixed(6);

// ---- fake AgentFeed upstream that can hold one request
function makeUpstream() {
  const u = new EventEmitter(); u.hold = false; u.calls = 0;
  u.server = http.createServer(async (req, res) => {
    u.calls++;
    if (u.hold) { u.emit('held'); await new Promise((r) => u.once('release', r)); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ drill: true, path: req.url }));
  });
  u.waitHeld = () => new Promise((r) => u.once('held', r));
  return u;
}

// What a NEAR RPC node answers when a transaction is not final in time (observed on testnet: HANDLER_ERROR / TIMEOUT_ERROR / "Timeout").
// Network-level failures are not used for S4/S5 because @near-js/providers retries those 12 times with identical bytes on its own.
const TIMEOUT_REPLY = JSON.stringify({ jsonrpc: '2.0', id: 1, error: { name: 'HANDLER_ERROR', cause: { name: 'TIMEOUT_ERROR', info: { debug_info: 'Timeout' } }, code: -32000, message: 'Server error', data: 'Timeout' } });

// ---- pass-through proxy in front of the NEAR RPC. Only `send_tx` (the relayer's broadcast) is ever interfered with, once per arming.
function makeProxy() {
  const p = new EventEmitter(); p.mode = 'pass'; p.sends = [];
  p.server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    let method; try { method = JSON.parse(body).method; } catch { /* not JSON */ }
    let mode = 'pass';
    if (method === 'send_tx') { mode = p.mode; p.mode = 'pass'; p.sends.push(mode); }
    if (mode === 'hold_before') { p.emit('held', 'before'); return; } // never forwarded, never answered
    if (mode === 'timeout_before') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(TIMEOUT_REPLY); return; } // never forwarded
    const r = await fetch(NEAR_TESTNET.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    const text = await r.text();
    if (mode === 'hold_after') { p.emit('held', 'after'); return; } // forwarded and FINAL, reply withheld
    if (mode === 'timeout_after') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(TIMEOUT_REPLY); return; } // forwarded and FINAL, the caller is told it timed out
    res.writeHead(r.status, { 'content-type': 'application/json' });
    res.end(text);
  });
  p.waitHeld = () => new Promise((r) => p.once('held', r));
  return p;
}

// ---- the gateway under test: a real child process
async function startGateway(env) {
  const child = spawn(process.execPath, ['src/main.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  child.out = () => out;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${env.PORT}/health`)).ok) return child; } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error(`gateway did not start: ${out.slice(-300)}`);
}
const kill9 = (child) => new Promise((res) => { if (child.exitCode !== null || child.signalCode !== null) return res(); child.once('exit', res); child.kill('SIGKILL'); });
const row = (dbPath) => { const d = new Database(dbPath, { readonly: true }); try { return d.prepare('SELECT state, tx_hash, length(signed_tx) AS signed_len, error FROM payments ORDER BY id DESC LIMIT 1').get(); } finally { d.close(); } };

const results = [];
const check = (sid, what, ok, detail = '') => { results.push({ sid, what, ok }); say(`  ${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`); };
const delta = (a, b) => ({ buyer: b.buyer - a.buyer, treasury: b.treasury - a.treasury });
const charged = (d) => (d.buyer === -PRICE && d.treasury === PRICE ? 'charged once' : d.buyer === 0n && d.treasury === 0n ? 'charged 0' : `buyer ${usdc(d.buyer)} treasury ${usdc(d.treasury)}`);

async function main() {
  const up = makeUpstream(); await new Promise((r) => up.server.listen(0, '127.0.0.1', r));
  const proxy = makeProxy(); await new Promise((r) => proxy.server.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'afn-drill-'));
  const dbPath = join(dir, 'drill.db');
  const port = await freePort();
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), HOST: '127.0.0.1', PUBLIC_URL: `http://127.0.0.1:${port}`, DB_PATH: dbPath,
    TREASURY_ACCOUNT_ID: TREASURY, RELAYER_ACCOUNT_ID: RELAYER, RELAYER_PRIVATE_KEY: keyFor(RELAYER, 'RELAYER_PRIVATE_KEY'),
    NEAR_RPC_URL: `http://127.0.0.1:${proxy.server.address().port}`, UPSTREAM_URL: `http://127.0.0.1:${up.server.address().port}`, UPSTREAM_PREFIX: '/api/sample',
  };
  const agent = createAgent({ accountId: BUYER, secretKey: keyFor(BUYER, 'AGENT_PRIVATE_KEY'), baseUrl: `http://127.0.0.1:${port}`, rpcUrl: NEAR_TESTNET.rpcUrl, retries: 0 });
  let gw = await startGateway(env);
  const restart = async () => { await kill9(gw); proxy.mode = 'pass'; up.hold = false; up.emit('release'); await sleep(300); gw = await startGateway(env); };
  const delivered = [];
  const stamp = new Date().toISOString();
  say(`# live drill ${stamp}  buyer ${BUYER}  treasury ${TREASURY}  relayer ${RELAYER}  price ${usdc(PRICE)} USDC`);
  say(`# runtime: node ${process.version} on ${process.platform}/${process.arch} (the gateway child runs the same node binary)`);
  say(`# gateway: node src/main.js (pid ${gw.pid}) on :${port}, NEAR RPC through a local proxy, upstream = local fake`);

  const want = (id) => !ONLY.length || ONLY.includes(id);
  const finish = async (sid, p, b0, extra = {}) => {
    const res = await p.send(); const body = await res.json().catch(() => ({}));
    const b2 = await bal(); const d = delta(b0, b2);
    check(sid, `same signed payment, presented again: HTTP 200 with data`, res.status === 200 && body.data?.drill === true, `status ${res.status}${body.error ? ` ${body.error}` : ''}`);
    check(sid, `total effect on the chain: ${charged(d)}`, d.buyer === -PRICE && d.treasury === PRICE);
    if (extra.recovered != null) check(sid, `served as a recovery of the stored payment (recovered:${extra.recovered})`, Boolean(body.paid?.recovered) === extra.recovered);
    if (extra.tx) check(sid, 'served transaction is the one stored before the kill', body.paid?.tx === extra.tx, body.paid?.tx);
    const r = row(dbPath);
    check(sid, `ledger row is delivered`, r?.state === 'delivered', r?.state);
    if (body.paid?.tx) { delivered.push({ sid, tx: body.paid.tx, payer: BUYER }); say(`  tx ${body.paid.tx}  ${NEAR_TESTNET.explorer}/tx/${body.paid.tx}`); }
    return { res, body };
  };

  if (want('S1')) {
    say('\nS1  kill -9 while the data is being fetched');
    const b0 = await bal(); const p = await agent.prepare('sol-price'); up.hold = true;
    const inflight = p.send().catch(() => null); const held = up.waitHeld(); await held;
    const r = row(dbPath); await kill9(gw);
    const d = delta(b0, await bal());
    check('S1', `at the kill the gateway had verified and reserved only (state ${r?.state}, no tx hash)`, r?.state === 'reserved' && !r.tx_hash, JSON.stringify(r));
    check('S1', `chain at the kill: ${charged(d)}`, d.buyer === 0n && d.treasury === 0n);
    up.hold = false; up.emit('release'); await inflight; proxy.mode = 'pass'; gw = await startGateway(env);
    await finish('S1', p, b0, { recovered: false });
  }

  if (want('S2')) {
    say('\nS2  kill -9 after the relayer tx hash and bytes are stored, before the broadcast leaves the process');
    const b0 = await bal(); const p = await agent.prepare('sol-price'); proxy.mode = 'hold_before';
    const inflight = p.send().catch(() => null); await proxy.waitHeld();
    const r = row(dbPath); await kill9(gw);
    const d = delta(b0, await bal());
    check('S2', `at the kill: state ${r?.state}, tx hash stored, signed bytes stored (${r?.signed_len} chars)`, r?.state === 'submitted' && Boolean(r.tx_hash) && r.signed_len > 100);
    check('S2', `chain at the kill: ${charged(d)}`, d.buyer === 0n && d.treasury === 0n);
    let seen = null; try { await real.viewTransactionStatus(r.tx_hash, RELAYER, 'NONE'); seen = true; } catch (e) { seen = /doesn't exist|UNKNOWN_TRANSACTION/i.test(String(e.message)) ? false : 'error'; }
    check('S2', 'the stored transaction hash is unknown to the chain (real UNKNOWN_TRANSACTION)', seen === false, String(seen));
    await inflight; await restart();
    await finish('S2', p, b0, { recovered: true, tx: r.tx_hash });
  }

  if (want('S3')) {
    say('\nS3  kill -9 after the broadcast landed on the chain, before the reply reached the gateway');
    const b0 = await bal(); const p = await agent.prepare('sol-price'); proxy.mode = 'hold_after';
    const inflight = p.send().catch(() => null); await proxy.waitHeld();
    const r = row(dbPath); await kill9(gw);
    const d = delta(b0, await bal());
    check('S3', `at the kill: state ${r?.state}, tx hash stored`, r?.state === 'submitted' && Boolean(r.tx_hash));
    check('S3', `chain at the kill: ${charged(d)} (the agent has paid and has no data)`, d.buyer === -PRICE && d.treasury === PRICE);
    await inflight; await restart();
    await finish('S3', p, b0, { recovered: true, tx: r.tx_hash });
  }

  if (want('S4')) {
    say('\nS4  gateway alive, the node answers TIMEOUT_ERROR but the transaction landed');
    const b0 = await bal(); const p = await agent.prepare('sol-price'); proxy.mode = 'timeout_after'; const sends0 = proxy.sends.length;
    const { body } = await finish('S4', p, b0);
    check('S4', `broadcast was sent exactly once (no resend needed)`, proxy.sends.length - sends0 === 1, proxy.sends.slice(sends0).join(','));
    void body;
  }

  if (want('S5')) {
    say('\nS5  gateway alive, the node answers TIMEOUT_ERROR and the transaction never reached the chain: stored bytes sent again');
    const b0 = await bal(); const p = await agent.prepare('sol-price'); proxy.mode = 'timeout_before'; const sends0 = proxy.sends.length;
    const { body } = await finish('S5', p, b0);
    const modes = proxy.sends.slice(sends0);
    check('S5', `broadcast attempts: ${modes.join(' then ')} (first timed out without reaching the chain, second is the stored bytes)`, modes.length === 2 && modes[0] === 'timeout_before' && modes[1] === 'pass');
    const r = row(dbPath);
    check('S5', 'served transaction equals the stored hash', body.paid?.tx === r?.tx_hash);
  }

  if (want('S6')) {
    say('\nS6  the last delivered payment is presented once more');
    const b0 = await bal(); const p = await agent.prepare('sol-price');
    const first = await p.send(); await first.json().catch(() => null);
    const b1 = await bal();
    const again = await p.send(); const body = await again.json().catch(() => ({}));
    const b2 = await bal();
    check('S6', `second presentation refused: ${again.status} ${body.error}`, again.status === 402 && body.error === 'payment_replayed' && body.charged === false);
    check('S6', `chain: one charge in total, none for the replay`, delta(b0, b1).buyer === -PRICE && delta(b1, b2).buyer === 0n && delta(b1, b2).treasury === 0n);
    const r = row(dbPath); if (first.status === 200) delivered.push({ sid: 'S6', tx: r.tx_hash, payer: BUYER });
  }

  await kill9(gw); up.server.close(); proxy.server.close();
  const failed = results.filter((r) => !r.ok);
  say(`\n# ${results.length - failed.length} of ${results.length} checks passed${failed.length ? `; FAILED: ${failed.map((f) => `${f.sid} ${f.what}`).join(' | ')}` : ''}`);
  if (RECORD) {
    const csvRows = delivered.map((d) => {
      const dbr = new Database(dbPath, { readonly: true }).prepare('SELECT * FROM payments WHERE tx_hash = ?').get(d.tx);
      return [new Date((dbr.ts_settled || dbr.ts_created) * 1000).toISOString(), dbr.route, dbr.payer, '0.01', d.tx, RELAYER, `${NEAR_TESTNET.explorer}/tx/${d.tx}`, dbr.state, dbr.settle_ms ?? ''].join(',');
    });
    appendFileSync(new URL('../evidence/known-extra-transfers.csv', import.meta.url), csvRows.join('\n') + '\n');
    writeFileSync(new URL(`../evidence/drill-${stamp.slice(0, 10).replaceAll('-', '')}-node${process.versions.node.split('.')[0]}.txt`, import.meta.url), lines.join('\n') + '\n');
    say(`# recorded ${csvRows.length} transfers in evidence/known-extra-transfers.csv and the transcript in evidence/drill-*.txt`);
  }
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
