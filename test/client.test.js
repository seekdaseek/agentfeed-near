// Our own client wrapper: it must refuse before signing anything it should not sign.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { KeyPair } from '@near-js/crypto';
import { createAgent } from '../src/client.js';
import { USDC } from '../src/config.js';

const secretKey = KeyPair.fromRandom('ed25519').toString();
const good = { scheme: 'exact', network: 'near:testnet', amount: '10000', asset: USDC.asset, payTo: 'x.testnet', maxTimeoutSeconds: 60 };
const fetch402 = (accept) => async () => new Response(JSON.stringify({ x402Version: 2, accepts: [accept] }), { status: 402, headers: { 'content-type': 'application/json' } });

describe('createAgent guards (nothing is signed, so no RPC is needed)', () => {
  const agent = (accept, o = {}) => createAgent({ accountId: 'a.testnet', secretKey, baseUrl: 'http://gw', fetchImpl: fetch402(accept), rpcUrl: 'http://127.0.0.1:9', ...o });
  test('refuses another network', async () => assert.rejects(agent({ ...good, network: 'near:mainnet' }).call('sol-price'), /no exact payment on near:testnet/));
  test('refuses another token', async () => assert.rejects(agent({ ...good, asset: 'usdc.fake.testnet' }).call('sol-price'), /asks for token usdc\.fake\.testnet/));
  test('refuses a price above the cap', async () => assert.rejects(agent({ ...good, amount: '200000' }, { maxPriceUsdc: 0.1 }).call('sol-price'), /above the cap of 0\.1/));
  test('refuses a scheme it does not know', async () => assert.rejects(agent({ ...good, scheme: 'upto' }).call('sol-price'), /no exact payment/));
  test('passes a non-402 response straight through', async () => {
    const a = createAgent({ accountId: 'a.testnet', secretKey, baseUrl: 'http://gw', fetchImpl: async () => new Response('{"error":"bad_request"}', { status: 400 }) });
    const r = await a.call('summarize');
    assert.equal(r.status, 400);
    assert.equal(r.paid, null);
  });
});
