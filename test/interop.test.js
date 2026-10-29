// Interop: a STOCK x402 client (@x402/fetch + @x402/core client + the @x402/near client scheme) pays this gateway
// with no code from this repo on the payer side. Only the NEAR RPC reads are faked (the client signer's access-key and block lookups).
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { wrapFetchWithPayment, x402Client, x402HTTPClient, decodePaymentResponseHeader } from '@x402/fetch';
import { ExactNearScheme } from '@x402/near/exact/client';
import { boot, newBuyer, signDelegate } from './helpers.js';

let ctx; let buyer;
beforeEach(async () => { ctx = await boot(); buyer = newBuyer(ctx.world); });
afterEach(() => ctx.close());

// ClientNearSigner contract from @x402/near: createSignedDelegateAction({ x402Version, paymentRequirements }) -> base64 borsh SignedDelegate
const stockSigner = (b) => ({ createSignedDelegateAction: ({ paymentRequirements }) => signDelegate(b, paymentRequirements) });

describe('stock x402 client', () => {
  test('wrapFetchWithPayment pays a 402 from this gateway and gets the data and a settlement header', async () => {
    const client = new x402Client().register('near:testnet', new ExactNearScheme(stockSigner(buyer)));
    const fetchPaid = wrapFetchWithPayment(fetch, client);
    const res = await fetchPaid(`${ctx.url}/api/liquidations?symbol=SOL`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.paid.amount_usdc, '0.02');
    assert.deepEqual(body.data, ctx.up.payload);
    const settle = decodePaymentResponseHeader(res.headers.get('payment-response'));
    assert.equal(settle.success, true);
    assert.equal(settle.network, 'near:testnet');
    assert.equal(settle.payer, buyer.name);
    assert.match(settle.transaction, /^FakeTx/);
    assert.equal(ctx.relayer.submits, 1);
  });

  test('x402HTTPClient reads our PAYMENT-REQUIRED header and builds the PAYMENT-SIGNATURE header', async () => {
    const http = new x402HTTPClient(new x402Client().register('near:testnet', new ExactNearScheme(stockSigner(buyer))));
    const first = await fetch(`${ctx.url}/api/sol-price`);
    const required = http.getPaymentRequiredResponse((n) => first.headers.get(n), await first.json());
    assert.equal(required.x402Version, 2);
    assert.equal(required.accepts[0].network, 'near:testnet');
    const payload = await http.createPaymentPayload(required);
    const headers = http.encodePaymentSignatureHeader(payload);
    const second = await fetch(`${ctx.url}/api/sol-price`, { headers });
    assert.equal(second.status, 200);
  });
});
