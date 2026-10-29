import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { usdcStr, cleanParams, findRoute, priceAtomic } from '../src/routes.js';
import { interpretOutcome, parseTransferEvents } from '../src/chain.js';
import { loadConfig } from '../src/config.js';
import { baseEnv, TOKEN } from './helpers.js';

describe('amounts', () => {
  test('usdcStr', () => {
    assert.equal(usdcStr(10000n), '0.01');
    assert.equal(usdcStr('50000'), '0.05');
    assert.equal(usdcStr(1_000_000n), '1.00');
    assert.equal(usdcStr(1_234_567n), '1.234567');
    assert.equal(usdcStr(0n), '0.00');
  });
  test('prices are whole cents in 6-decimal atomic units', () => {
    assert.equal(priceAtomic(findRoute('sol-price')), 10_000n);
    assert.equal(priceAtomic(findRoute('summarize')), 50_000n);
  });
});

describe('cleanParams', () => {
  const q = (s) => new URLSearchParams(s);
  test('keeps declared, drops unknown, validates types', () => {
    const r = findRoute('liquidations');
    assert.equal(cleanParams(r, q('symbol=SOL&x=1')).query.toString(), 'symbol=SOL');
    assert.equal(cleanParams(r, q('limit=abc')).ok, false);
    assert.equal(cleanParams(r, q('min_usd=1000.5')).ok, true);
    assert.equal(cleanParams(findRoute('summarize'), q('')).ok, false);
  });
});

describe('outcomes', () => {
  const ev = (o) => `EVENT_JSON:${JSON.stringify({ standard: 'nep141', version: '1.0.0', event: 'ft_transfer', data: [o] })}`;
  const outcome = (over = {}) => ({
    status: { SuccessValue: '' }, transaction_outcome: { id: 'TX' },
    receipts_outcome: [
      { outcome: { executor_id: 'payer.testnet', status: { SuccessValue: '' }, logs: [] } },
      { outcome: { executor_id: TOKEN, status: { SuccessValue: '' }, logs: [ev({ old_owner_id: 'payer.testnet', new_owner_id: 'treasury.testnet', amount: '10000' })] } },
    ], ...over,
  });
  test('parses the NEP-141 ft_transfer event the live token emits', () => {
    assert.deepEqual(parseTransferEvents(outcome().receipts_outcome[1].outcome.logs), [{ from: 'payer.testnet', to: 'treasury.testnet', amount: '10000' }]);
    assert.deepEqual(parseTransferEvents(['hello', 'EVENT_JSON:{not json']), []);
  });
  test('success needs the token contract receipt to succeed', () => {
    assert.equal(interpretOutcome(outcome(), TOKEN).kind, 'success');
    const noToken = outcome(); noToken.receipts_outcome.pop();
    assert.equal(interpretOutcome(noToken, TOKEN).kind, 'failure');
  });
  test('any failed receipt is a failure, even if the first receipt succeeded', () => {
    const o = outcome(); o.receipts_outcome[1].outcome.status = { Failure: { ActionError: { kind: 'FunctionCallError' } } };
    assert.equal(interpretOutcome(o, TOKEN).kind, 'failure');
    assert.equal(interpretOutcome(outcome({ status: { Failure: 'x' } }), TOKEN).kind, 'failure');
  });
});

describe('config', () => {
  test('rejects a relayer key that is not ed25519', () => {
    assert.throws(() => loadConfig({ ...baseEnv(), RELAYER_PRIVATE_KEY: 'secp256k1:abc' }), /RELAYER_PRIVATE_KEY/);
  });
  test('the paid upstream path needs the prepaid key; the free sample path does not', () => {
    const { UPSTREAM_KEY, ...rest } = baseEnv();
    assert.throws(() => loadConfig(rest), /UPSTREAM_KEY is required/);
    assert.equal(loadConfig({ ...rest, UPSTREAM_PREFIX: '/api/sample' }).upstreamKey, '');
  });
});
