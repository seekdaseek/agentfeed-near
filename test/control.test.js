// LIVE control tests: the same purchase made the old way (the signer pays gas, so it needs NEAR) and our way (the relayer pays).
// They talk to NEAR testnet and the deployed gateway and need the control and buyer keys in ~/.near-credentials, so they only run
// with NEAR_LIVE=1:   NEAR_LIVE=1 npm test
// Each paid run adds one 0.01 USDC call to the deployed ledger (payer: the control account, ours).
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent, loadSecretKey } from '../src/client.js';
import { provider, usdcBalance, nearBalance, settledNearBalance, oldWayTransfer } from '../src/control.js';

const live = process.env.NEAR_LIVE === '1' ? false : 'set NEAR_LIVE=1 to run against NEAR testnet and the deployed gateway';
const POOR = process.env.CONTROL_ACCOUNT || '94ef19a8accede5cef0983c5cd0eeeda22aa43cb34210567e6d4eacfde8668b4';
const BUYER = 'agentfeed-near-buyer.testnet';
const GATEWAY = process.env.GATEWAY_URL || 'https://near.ochinimus.app';
const PRICE = 10_000n;

describe('control: the old way against our way', { skip: live }, () => {
  const p = provider();
  let before0;
  before(async () => { before0 = { near: await nearBalance(p, POOR), usdc: await usdcBalance(p, POOR) }; });

  test('control: an account holding USDC and almost no NEAR cannot pay the old way', async () => {
    assert.ok(before0.usdc >= PRICE, 'the control account must hold USDC');
    assert.ok(before0.near.spendable < 3_000_000_000_000_000_000_000n, 'the control account must hold less spendable NEAR than a 30 Tgas call needs (about 0.03 NEAR)');
    const r = await oldWayTransfer({ p, accountId: POOR, secretKey: loadSecretKey(POOR), to: BUYER, amount: PRICE });
    assert.equal(r.ok, false);
    assert.match(r.message, /does not have enough balance|NotEnoughBalance|LackBalanceForState/);
    assert.equal(await usdcBalance(p, POOR), before0.usdc, 'nothing moved');
  });

  test('control: the same account pays through the gateway and its NEAR balance does not change', async () => {
    const agent = createAgent({ accountId: POOR, secretKey: loadSecretKey(POOR), baseUrl: GATEWAY, retries: 1 });
    const r = await agent.call('sol-price');
    assert.equal(r.ok, true, JSON.stringify(r.body).slice(0, 200));
    assert.match(r.paid.tx, /^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    const after = { near: await nearBalance(p, POOR), usdc: await usdcBalance(p, POOR) };
    assert.equal(after.near.total, before0.near.total, 'NEAR balance unchanged');
    assert.equal(after.usdc, before0.usdc - PRICE, 'USDC moved by the price');
  });

  test('control: a funded account can pay the old way', async () => {
    const b0 = await settledNearBalance(p, BUYER);
    const r = await oldWayTransfer({ p, accountId: BUYER, secretKey: loadSecretKey(BUYER), to: POOR, amount: PRICE });
    assert.equal(r.ok, true, JSON.stringify(r));
    const b1 = await settledNearBalance(p, BUYER);
    assert.ok(b0.total > b1.total, 'the old way costs the signer NEAR for gas');
  });
});
