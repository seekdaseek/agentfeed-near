// "The old way": the same USDC payment made with plain NEAR tooling. The signer pays the gas, so it must hold NEAR.
// Used by scripts/control-old-way.mjs and the live (NEAR_LIVE=1) tests in test/control.test.js.
import { JsonRpcProvider } from '@near-js/providers';
import { KeyPairSigner } from '@near-js/signers';
import { actionCreators, createTransaction } from '@near-js/transactions';
import { baseDecode } from '@near-js/utils';
import { NEAR_TESTNET, USDC } from './config.js';

export const provider = (rpcUrl = NEAR_TESTNET.rpcUrl) => new JsonRpcProvider({ url: rpcUrl });

export async function usdcBalance(p, accountId, asset = USDC.asset) {
  return BigInt(await p.callFunction(asset, 'ft_balance_of', { account_id: accountId }, { finality: 'final' }));
}

// Total NEAR, the part locked for the account's storage, and what is left to spend.
export async function nearBalance(p, accountId) {
  const a = await p.viewAccount(accountId, { finality: 'final' });
  const total = BigInt(a.amount);
  const locked = BigInt(a.storage_usage) * 10n ** 19n;
  return { total, locked, spendable: total > locked ? total - locked : 0n };
}

// The balance once it stops moving: a transaction first reserves gas for its full 30 Tgas and the unused part comes back in a refund
// receipt a few blocks later, so a read taken right after FINAL shows the reservation, not the cost.
export async function settledNearBalance(p, accountId, { tries = 12, gapMs = 1500 } = {}) {
  let last = await nearBalance(p, accountId);
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, gapMs));
    const now = await nearBalance(p, accountId);
    if (now.total === last.total) return now;
    last = now;
  }
  return last;
}

// A plain transaction signed by `accountId` itself: ft_transfer with 1 yocto and 30 Tgas, sent to the token contract.
// Returns { ok:true, tx, finalStatus } or { ok:false, type, message } when the network refuses it.
export async function oldWayTransfer({ p, accountId, secretKey, to, amount, asset = USDC.asset, gas = 30_000_000_000_000n }) {
  const signer = KeyPairSigner.fromSecretKey(secretKey);
  const publicKey = await signer.getPublicKey();
  const [ak, block] = await Promise.all([p.viewAccessKey(accountId, publicKey, { finality: 'final' }), p.block({ finality: 'final' })]);
  const tx = createTransaction(accountId, publicKey, asset, BigInt(ak.nonce) + 1n,
    [actionCreators.functionCall('ft_transfer', { receiver_id: to, amount: String(amount) }, gas, 1n)], baseDecode(block.header.hash));
  const [, signed] = await signer.signTransaction(tx);
  try {
    const out = await p.sendTransactionUntil(signed, 'FINAL');
    const failed = JSON.stringify(out.status).includes('Failure') || out.receipts_outcome.some((r) => JSON.stringify(r.outcome.status).includes('Failure'));
    if (failed) return { ok: false, type: 'ExecutionFailure', message: JSON.stringify(out.status).slice(0, 300) };
    return { ok: true, tx: out.transaction_outcome.id, finalStatus: out.final_execution_status };
  } catch (e) {
    return { ok: false, type: e.type || e.name, message: String(e.message || e).slice(0, 400) };
  }
}
