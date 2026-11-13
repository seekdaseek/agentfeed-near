// checkTx() against the REAL transaction from the Phase 1 proof (test/fixtures/proof-tx.json, fetched from NEAR testnet RPC),
// then against deliberately wrong ledger rows: each must fail, for the stated reason.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkTx, checkOutflow, toAtomic } from '../src/evidence.js';

const real = JSON.parse(readFileSync(new URL('./fixtures/proof-tx.json', import.meta.url), 'utf8'));
const ctx = { relayer: 'agentfeed-near-relayer.testnet', treasury: 'agentfeed-near-treasury.testnet', token: '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af' };
const row = { tx_hash: 'CnkcxKjhLZaXWx7vCae52mJSssPVykEKUpNbdJuBhr4N', payer: 'iussum-near-principal.testnet', amount_usdc: '0.01', relayer: ctx.relayer };
const clone = () => structuredClone(real);

describe('checkTx on the real proof transaction', () => {
  test('the true ledger row verifies', () => assert.deepEqual(checkTx(real, row, ctx), { ok: true, amount: 10000n }));
  test('a wrong amount is refused', () => assert.match(checkTx(real, { ...row, amount_usdc: '0.02' }, ctx).why, /ft_transfer args differ/));
  test('a wrong payer is refused', () => assert.match(checkTx(real, { ...row, payer: 'someone.testnet' }, ctx).why, /receiver .* is not the payer/));
  test('a wrong treasury is refused', () => assert.match(checkTx(real, row, { ...ctx, treasury: 'other.testnet' }).why, /args differ/));
  test('a wrong token is refused', () => assert.match(checkTx(real, row, { ...ctx, token: 'usdc.fake.testnet' }).why, /does not target the USDC/));
  test('a wrong relayer is refused', () => assert.match(checkTx(real, row, { ...ctx, relayer: 'other.testnet' }).why, /signed by/));
  test('a missing transaction is refused', () => assert.equal(checkTx(null, row, ctx).ok, false));
  test('a non-final transaction is refused', () => { const r = clone(); r.final_execution_status = 'INCLUDED'; assert.match(checkTx(r, row, ctx).why, /not final/); });
  test('a failed token receipt is refused', () => {
    const r = clone(); const t = r.receipts_outcome.find((x) => x.outcome.executor_id === ctx.token); t.outcome.status = { Failure: { ActionError: {} } };
    assert.match(checkTx(r, row, ctx).why, /a receipt failed/);
  });
  test('a missing transfer event is refused', () => {
    const r = clone(); const t = r.receipts_outcome.find((x) => x.outcome.executor_id === ctx.token); t.outcome.logs = [];
    assert.match(checkTx(r, row, ctx).why, /no single NEP-141/);
  });
  test('a tampered hash is refused', () => assert.match(checkTx(real, { ...row, tx_hash: 'x' }, ctx).why, /hash mismatch/));
});

describe('toAtomic', () => {
  test('parses ledger amounts', () => {
    assert.equal(toAtomic('0.01'), 10000n);
    assert.equal(toAtomic('1.00'), 1_000_000n);
    assert.equal(toAtomic('0.05'), 50000n);
  });
});

// checkOutflow() against the REAL treasury -> buyer recycle (test/fixtures/outflow-tx.json, fetched from NEAR testnet RPC on 2026-11-13),
// then against deliberately wrong records.
describe('checkOutflow on the real treasury recycle transaction', () => {
  const outReal = JSON.parse(readFileSync(new URL('./fixtures/outflow-tx.json', import.meta.url), 'utf8'));
  const outRow = { from: ctx.treasury, to: 'agentfeed-near-buyer.testnet', amount_usdc: '4.00', tx_hash: '' };
  outRow.tx_hash = outReal.transaction.hash;
  test('the true record verifies', () => assert.deepEqual(checkOutflow(outReal, outRow, ctx), { ok: true, amount: 4_000_000n }));
  test('a wrong amount is refused', () => assert.match(checkOutflow(outReal, { ...outRow, amount_usdc: '4.01' }, ctx).why, /args differ/));
  test('a wrong recipient is refused', () => assert.match(checkOutflow(outReal, { ...outRow, to: 'someone.testnet' }, ctx).why, /args differ/));
  test('a record that is not from the treasury is refused', () => assert.match(checkOutflow(outReal, { ...outRow, from: 'other.testnet' }, ctx).why, /not an outflow of the treasury/));
  test('a different treasury is refused', () => assert.match(checkOutflow(outReal, outRow, { ...ctx, treasury: 'other.testnet' }).why, /not an outflow|signed by/));
  test('a wrong token is refused', () => assert.match(checkOutflow(outReal, outRow, { ...ctx, token: 'usdc.fake.testnet' }).why, /does not target the USDC/));
  test('an unknown transaction is refused', () => assert.match(checkOutflow(null, outRow, ctx).why, /not found/));
  test('a failed receipt is refused', () => {
    const t = structuredClone(outReal); t.receipts_outcome[0].outcome.status = { Failure: { x: 1 } };
    assert.match(checkOutflow(t, outRow, ctx).why, /receipt failed|final status/);
  });
  test('a ledger payment (relayer-signed) is not an outflow', () => assert.match(checkOutflow(real, { ...outRow, tx_hash: real.transaction.hash }, ctx).why, /signed by/));
});
