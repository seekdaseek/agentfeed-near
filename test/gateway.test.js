import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot, newBuyer, signDelegate, paymentFor, challenge, pay, payOnce, TREASURY, TOKEN, b64 } from './helpers.js';
import { openStore } from '../src/store.js';

let ctx; let buyer;
beforeEach(async () => { ctx = await boot(); buyer = newBuyer(ctx.world); });
afterEach(() => ctx.close());

const json = (r) => r.json();

describe('the 402 challenge', () => {
  test('unpaid GET returns x402 v2 exact on near:testnet with the payment in the header and the body', async () => {
    const ch = await challenge(ctx.url, 'liquidations', '?symbol=SOL');
    assert.equal(ch.status, 402);
    assert.deepEqual(ch.header.accepts, ch.body.accepts);
    assert.equal(ch.header.x402Version, 2);
    assert.deepEqual(ch.accept, { scheme: 'exact', network: 'near:testnet', amount: '20000', asset: TOKEN, payTo: TREASURY, maxTimeoutSeconds: 60 });
    assert.equal(ctx.up.calls.length, 0, 'an unpaid request never reaches AgentFeed');
  });

  test('each route is priced in USDC atomic units (6 decimals)', async () => {
    const want = { 'sol-price': '10000', 'trade-context': '30000' };
    for (const [id, amount] of Object.entries(want)) assert.equal((await challenge(ctx.url, id)).accept.amount, amount);
    assert.equal((await challenge(ctx.url, 'summarize', '?url=https://example.com')).accept.amount, '50000');
  });
});

describe('a valid payment', () => {
  test('is verified, the data is fetched, the relayer settles, and the agent gets data plus a receipt', async () => {
    const { res } = await payOnce(ctx, buyer);
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.route, 'sol-price');
    assert.equal(body.paid.amount_usdc, '0.01');
    assert.equal(body.paid.payer, buyer.name);
    assert.match(body.paid.explorer, /explorer\.testnet\.near\.org\/transactions\/FakeTx0001/);
    assert.deepEqual(body.data, ctx.up.payload);
    const receipt = JSON.parse(Buffer.from(res.headers.get('payment-response'), 'base64').toString());
    assert.deepEqual({ success: receipt.success, network: receipt.network, payer: receipt.payer }, { success: true, network: 'near:testnet', payer: buyer.name });
    assert.equal(ctx.relayer.submits, 1);
    assert.equal(ctx.up.calls.length, 1);
    assert.equal(ctx.up.calls[0].key, 'afk_test');
    assert.equal(ctx.store.get(ctx.store.all()[0].hash).state, 'delivered');
  });

  test('only declared query parameters are forwarded upstream', async () => {
    await payOnce(ctx, buyer, 'liquidations', {}, '?symbol=SOL&limit=5&evil=1');
    const u = new URL(ctx.up.calls[0].url, 'http://x');
    assert.equal(u.searchParams.get('symbol'), 'SOL');
    assert.equal(u.searchParams.get('limit'), '5');
    assert.equal(u.searchParams.has('evil'), false);
  });

  test('the same signed payment cannot be used twice (replay)', async () => {
    const first = await payOnce(ctx, buyer);
    assert.equal(first.res.status, 200);
    const again = await pay(ctx, 'sol-price', first.payment);
    assert.equal(again.status, 402);
    const body = await json(again);
    assert.equal(body.error, 'payment_replayed');
    assert.equal(body.charged, false);
    assert.equal(ctx.relayer.submits, 1);
    assert.equal(ctx.up.calls.length, 1);
  });

  test('a payment made for one route cannot buy another', async () => {
    const first = await payOnce(ctx, buyer, 'sol-price');
    const other = await pay(ctx, 'btc-price', first.payment);
    assert.equal(other.status, 402);
    assert.equal((await json(other)).error, 'payment_replayed');
    assert.equal(ctx.relayer.submits, 1);
  });

  test('two parallel requests with the same payment settle once', async () => {
    const ch = await challenge(ctx.url);
    const payment = paymentFor(ch.accept, await signDelegate(buyer, ch.accept));
    const [a, b] = await Promise.all([pay(ctx, 'sol-price', payment), pay(ctx, 'sol-price', payment)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 429].sort());
    assert.equal(ctx.relayer.submits, 1);
  });

  test('a payer with two different payments in flight at once gets one and a 429 for the other', async () => {
    const ch = await challenge(ctx.url);
    const p1 = paymentFor(ch.accept, await signDelegate(buyer, ch.accept, { nonce: 8n }));
    const p2 = paymentFor(ch.accept, await signDelegate(buyer, ch.accept, { nonce: 9n }));
    const [a, b] = await Promise.all([pay(ctx, 'sol-price', p1), pay(ctx, 'sol-price', p2)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 429].sort());
    assert.equal(ctx.relayer.submits, 1);
  });
});

describe('refusals never reach AgentFeed and never spend relayer gas', () => {
  const cases = {
    'wrong network in accepted': [{ accepted: { network: 'near:mainnet' } }, 'invalid_exact_near_network_mismatch'],
    'wrong token in accepted': [{ accepted: { asset: 'usdc.fake.testnet' } }, 'invalid_exact_near_asset_mismatch'],
    'wrong payee in accepted': [{ accepted: { payTo: 'someone.testnet' } }, 'invalid_exact_near_pay_to_mismatch'],
    'amount in accepted below the price': [{ accepted: { amount: '1' } }, 'invalid_exact_near_amount_mismatch'],
    'delegate pays a different recipient': [{ payTo: 'someone.testnet' }, 'invalid_exact_near_payload_recipient_mismatch'],
    'delegate pays less than the price': [{ amount: '9999' }, 'invalid_exact_near_payload_amount_mismatch'],
    'delegate pays more than the price': [{ amount: '10001' }, 'invalid_exact_near_payload_amount_mismatch'],
    'delegate targets another token contract': [{ receiverId: 'usdc.fake.testnet' }, 'invalid_exact_near_payload_token_contract_mismatch'],
    'delegate calls ft_transfer_call': [{ method: 'ft_transfer_call' }, 'invalid_exact_near_payload_method_name'],
    'delegate attaches no yocto': [{ deposit: 0n }, 'invalid_exact_near_payload_attached_deposit'],
    'delegate asks for far too much gas': [{ gas: 300_000_000_000_000n }, 'invalid_exact_near_payload_gas_limit_exceeded'],
    'delegate already expired': [{ maxBlockHeight: 9_999n }, 'invalid_exact_near_payload_delegate_action_expired'],
    'delegate window longer than maxTimeoutSeconds': [{ maxBlockHeight: 10_500n }, 'invalid_exact_near_payload_delegate_action_timeout_window_exceeds_max_timeout'],
    'delegate nonce already used': [{ nonce: 7n }, 'invalid_exact_near_payload_delegate_action_nonce_already_used'],
    'tampered signature': [{ tamper: true }, 'invalid_exact_near_payload_signature'],
  };
  for (const [name, [o, code]] of Object.entries(cases)) {
    test(name, async () => {
      const { res } = await payOnce(ctx, buyer, 'sol-price', o);
      assert.equal(res.status, 402);
      const body = await json(res);
      assert.equal(body.error, code);
      assert.equal(body.charged, false);
      assert.equal(ctx.up.calls.length, 0);
      assert.equal(ctx.relayer.submits, 0);
      assert.equal(ctx.store.all().length, 0);
    });
  }

  test('payer with less USDC than the price', async () => {
    const poor = newBuyer(ctx.world, 'poor.testnet', { balance: 9_999n });
    const { res } = await payOnce(ctx, poor);
    assert.equal((await json(res)).error, 'insufficient_funds');
    assert.equal(ctx.relayer.submits, 0);
  });

  test('payer whose key is a function-call key', async () => {
    const fc = newBuyer(ctx.world, 'fckey.testnet', { permission: 'FunctionCall' });
    const { res } = await payOnce(ctx, fc);
    assert.equal((await json(res)).error, 'invalid_exact_near_function_call_key_not_allowed');
  });

  test('payer whose key does not exist on the account', async () => {
    const ghost = newBuyer(ctx.world, 'ghost.testnet');
    ctx.world.keys.clear();
    const { res } = await payOnce(ctx, ghost);
    assert.equal((await json(res)).error, 'invalid_exact_near_access_key_not_found');
  });

  test('treasury not registered on the token', async () => {
    ctx.world.registered.delete(TREASURY);
    const { res } = await payOnce(ctx, buyer);
    assert.equal((await json(res)).error, 'invalid_exact_near_recipient_not_registered_for_storage');
  });

  test('the relayer cannot be the payer', async () => {
    const self = newBuyer(ctx.world, 'agentfeed-near-relayer.testnet');
    const { res } = await payOnce(ctx, self);
    assert.equal((await json(res)).error, 'invalid_exact_near_relayer_cannot_be_payer');
  });

  test('malformed header, missing payload, and a header that is not base64 JSON', async () => {
    const ch = await challenge(ctx.url);
    const bad = await fetch(`${ctx.url}/api/sol-price`, { headers: { 'payment-signature': '%%%not-base64-json' } });
    assert.equal(bad.status, 400);
    assert.equal((await json(bad)).error, 'malformed_payment');
    const noPayload = await pay(ctx, 'sol-price', { x402Version: 2, accepted: ch.accept, payload: {} });
    assert.equal((await json(noPayload)).error, 'invalid_exact_near_payload_shape');
    const junk = await pay(ctx, 'sol-price', paymentFor(ch.accept, 'AAAA'));
    assert.equal((await json(junk)).error, 'invalid_exact_near_payload_signed_delegate_action');
    assert.equal(ctx.relayer.submits, 0);
  });

  test('NEAR RPC down while verifying: 503, nothing charged, nothing fetched', async () => {
    const ch = await challenge(ctx.url);
    const sda = await signDelegate(buyer, ch.accept);
    ctx.world.rpcDown = true;
    const res = await pay(ctx, 'sol-price', paymentFor(ch.accept, sda));
    assert.equal(res.status, 402);
    const body = await json(res);
    assert.equal(body.charged, false);
    assert.equal(ctx.up.calls.length, 0);
    ctx.world.rpcDown = false;
    assert.equal((await pay(ctx, 'sol-price', paymentFor(ch.accept, sda))).status, 200, 'the same payment works once the RPC is back');
  });
});

describe('fetch before settle: the agent is never charged for data it did not get', () => {
  test('AgentFeed down: 502 charged:false, nothing submitted; the same payment works after recovery', async () => {
    ctx.up.mode = 'down';
    const first = await payOnce(ctx, buyer);
    assert.equal(first.res.status, 502);
    const body = await json(first.res);
    assert.equal(body.error, 'upstream_unavailable');
    assert.equal(body.charged, false);
    assert.equal(ctx.relayer.submits, 0);
    assert.equal(ctx.store.get(ctx.store.all()[0]?.hash ?? 'none'), undefined);
    ctx.up.mode = 'ok';
    const retry = await pay(ctx, 'sol-price', first.payment);
    assert.equal(retry.status, 200);
    assert.equal(ctx.relayer.submits, 1);
  });

  test('relayer cannot broadcast: 402 settlement_failed charged:false, then the same payment works', async () => {
    ctx.relayer.mode = 'throw_before';
    const first = await payOnce(ctx, buyer);
    assert.equal(first.res.status, 402);
    const body = await json(first.res);
    assert.equal(body.error, 'settlement_failed');
    assert.equal(body.charged, false);
    assert.equal(ctx.store.all().length, 0);
    ctx.relayer.mode = 'ok';
    assert.equal((await pay(ctx, 'sol-price', first.payment)).status, 200);
  });

  test('payer balance gone between the fetch and the settle: refused before any gas is spent', async () => {
    const ch = await challenge(ctx.url);
    const payment = paymentFor(ch.accept, await signDelegate(buyer, ch.accept));
    // the upstream call is where the money "moves": drain the balance when AgentFeed is asked
    ctx.up.server.once('request', () => ctx.world.balances.set(buyer.name, 0n));
    const res = await pay(ctx, 'sol-price', payment);
    assert.equal(res.status, 402);
    const body = await json(res);
    assert.equal(body.error, 'insufficient_funds');
    assert.equal(body.charged, false);
    assert.equal(ctx.relayer.submits, 0);
  });

  test('the transfer fails on chain: charged:false and the payment is spent', async () => {
    ctx.relayer.mode = 'fail';
    const first = await payOnce(ctx, buyer);
    assert.equal(first.res.status, 402);
    const body = await json(first.res);
    assert.equal(body.error, 'settlement_failed');
    assert.equal(body.charged, false);
    const again = await json(await pay(ctx, 'sol-price', first.payment));
    assert.equal(again.error, 'payment_failed');
    assert.equal(again.charged, false);
    assert.equal(ctx.store.all().length, 0, 'a failed payment is not counted as a settled call');
  });

  test('a transfer event that does not match the price marks the payment failed, not delivered', async () => {
    ctx.relayer.transfer = { from: buyer.name, to: 'someone.testnet', amount: '10000' };
    const { res } = await payOnce(ctx, buyer);
    assert.equal(res.status, 502);
    assert.equal((await json(res)).error, 'transfer_event_mismatch');
    assert.equal(ctx.store.all().length, 0);
  });
});

describe('crash drill: charged once or not at all', () => {
  test('broadcast outcome unknown: 504 now, and the same payment is resolved from the chain later without a second charge', async () => {
    ctx.relayer.mode = 'throw_unknown';
    const first = await payOnce(ctx, buyer);
    assert.equal(first.res.status, 504);
    const body = await json(first.res);
    assert.equal(body.error, 'settlement_unconfirmed');
    assert.equal(body.charged, 'unknown');
    const row = ctx.store.get(ctx.store.pending()[0].hash);
    assert.equal(row.state, 'submitted');
    assert.equal(row.tx_hash, body.tx, 'the tx hash was stored before the broadcast');
    // the chain finishes the transaction
    ctx.relayer.txs.set(body.tx, { kind: 'success', transfers: [], tx: body.tx });
    ctx.relayer.mode = 'ok';
    const retry = await pay(ctx, 'sol-price', first.payment);
    assert.equal(retry.status, 200);
    const r = await json(retry);
    assert.equal(r.paid.recovered, true);
    assert.equal(r.paid.tx, body.tx);
    assert.equal(ctx.relayer.submits, 1, 'no second relayer transaction');
    assert.equal((await pay(ctx, 'sol-price', first.payment)).status, 402, 'and now it is used up');
  });

  test('broadcast outcome unknown, then the chain says it failed: nothing charged, payment spent', async () => {
    ctx.relayer.mode = 'throw_unknown';
    const first = await payOnce(ctx, buyer);
    const { tx } = await json(first.res);
    ctx.relayer.txs.set(tx, { kind: 'failure', error: 'DelegateActionExpired' });
    const retry = await json(await pay(ctx, 'sol-price', first.payment));
    assert.equal(retry.error, 'settlement_failed');
    assert.equal(retry.charged, false);
    assert.equal(ctx.relayer.submits, 1);
  });

  test('crash after the chain settled but before the data went out: the same header collects the data, charged once', async () => {
    const first = await payOnce(ctx, buyer);
    assert.equal(first.res.status, 200);
    const hash = ctx.store.all()[0].hash;
    ctx.store.db.prepare("UPDATE payments SET state = 'settled', ts_delivered = NULL WHERE hash = ?").run(hash); // what a kill -9 between settle and response leaves
    const retry = await pay(ctx, 'sol-price', first.payment);
    assert.equal(retry.status, 200);
    assert.equal((await json(retry)).paid.recovered, true);
    assert.equal(ctx.relayer.submits, 1);
    assert.equal((await pay(ctx, 'sol-price', first.payment)).status, 402);
  });

  test('settled and AgentFeed is down on the collect: charged:true with an instruction to retry; the retry delivers', async () => {
    const first = await payOnce(ctx, buyer);
    const hash = ctx.store.all()[0].hash;
    ctx.store.db.prepare("UPDATE payments SET state = 'settled' WHERE hash = ?").run(hash);
    ctx.up.mode = 'down';
    const down = await pay(ctx, 'sol-price', first.payment);
    assert.equal(down.status, 502);
    assert.equal((await json(down)).charged, true);
    ctx.up.mode = 'ok';
    assert.equal((await pay(ctx, 'sol-price', first.payment)).status, 200);
    assert.equal(ctx.relayer.submits, 1);
  });

  test('a restart drops reservations (nothing was broadcast) and keeps submitted payments for reconciliation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'afn-'));
    const path = join(dir, 'restart.db');
    const s1 = openStore(path);
    for (const h of ['aa', 'bb']) s1.reserve({ hash: h, route: 'sol-price', payer: 'p.testnet', amount: '10000', max_block_height: '10060' });
    s1.submitted('bb', 'TxBB', RELAYER_ID);
    s1.close();
    const s2 = openStore(path);
    assert.equal(s2.get('aa'), undefined);
    assert.equal(s2.get('bb').state, 'submitted');
    s2.close();
  });

  test('reconcile() settles what the chain confirmed, fails what failed, fails what can no longer land, leaves the rest', async () => {
    const ins = (h, tx, max) => { ctx.store.reserve({ hash: h, route: 'sol-price', payer: 'p.testnet', amount: '10000', max_block_height: String(max) }); ctx.store.submitted(h, tx, RELAYER_ID); };
    ins('h1', 'TxOk', 10_060n); ins('h2', 'TxBad', 10_060n); ins('h3', 'TxGone', 9_000n); ins('h4', 'TxWait', 10_060n);
    ctx.relayer.txs.set('TxOk', { kind: 'success', transfers: [], tx: 'TxOk' });
    ctx.relayer.txs.set('TxBad', { kind: 'failure', error: 'boom' });
    const out = await ctx.gw.reconcile();
    assert.deepEqual(out, { settled: 1, failed: 2, pending: 1 });
    assert.equal(ctx.store.get('h1').state, 'settled');
    assert.equal(ctx.store.get('h2').state, 'failed');
    assert.equal(ctx.store.get('h3').error, 'expired_unsubmitted');
    assert.equal(ctx.store.get('h4').state, 'submitted');
  });
});

const RELAYER_ID = 'agentfeed-near-relayer.testnet';

describe('routes and surfaces', () => {
  test('a required parameter is checked before any payment is read', async () => {
    const r = await fetch(`${ctx.url}/api/summarize`);
    assert.equal(r.status, 400);
  });
  test('unknown route is 404, other verbs are 405 (no free HEAD)', async () => {
    assert.equal((await fetch(`${ctx.url}/api/nope`)).status, 404);
    assert.equal((await fetch(`${ctx.url}/api/sol-price`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${ctx.url}/api/sol-price`, { method: 'HEAD' })).status, 405);
  });
  test('/stats and /payments.csv count delivered calls only, and say so', async () => {
    await payOnce(ctx, buyer);
    const stats = await json(await fetch(`${ctx.url}/stats`));
    assert.equal(stats.settled_calls, 1);
    assert.equal(stats.usdc_settled, '0.01');
    assert.equal(stats.distinct_payers, 1);
    assert.match(stats.note, /our own buyer/);
    const csv = await (await fetch(`${ctx.url}/payments.csv`)).text();
    const lines = csv.trim().split('\n');
    assert.equal(lines[0], 'timestamp_utc,route,payer,amount_usdc,tx_hash,relayer,tx_url,state,settle_ms');
    assert.equal(lines.length, 2);
    assert.match(lines[1], /sol-price,buyer-one\.testnet,0\.01,FakeTx0001/);
  });
  test('the manifest names the network, token, payee and relayer', async () => {
    const m = await json(await fetch(`${ctx.url}/.well-known/x402`));
    assert.equal(m.network, 'near:testnet');
    assert.equal(m.asset.account, TOKEN);
    assert.equal(m.payTo, TREASURY);
    assert.equal(m.relayer, RELAYER_ID);
    assert.equal(m.routes.length, 8);
  });
  test('b64 helper sanity', () => assert.equal(Buffer.from(b64({ a: 1 }), 'base64').toString(), '{"a":1}'));
});
