// NEAR adapter. Verification is the x402 `exact` NEAR facilitator scheme from @x402/near (the same rules as
// fastnear/x402-facilitator: one NEP-366 delegate action carrying one ft_transfer with 1 yocto, full-access payer key,
// block window, nonce range, balance and storage registration). Submission is ours, because the gateway has to store the
// relayer transaction hash BEFORE it broadcasts, so that a crash between broadcast and answer can be reconciled from the chain.
import { createFacilitatorNearSigner, fromBase64, FT_TRANSFER_METHOD } from '@x402/near';
import { ExactNearScheme } from '@x402/near/exact/facilitator';
import { KeyPairSigner } from '@near-js/signers';
import { JsonRpcProvider } from '@near-js/providers';
import { SCHEMA, actionCreators, createTransaction, encodeTransaction } from '@near-js/transactions';
import { baseDecode, baseEncode } from '@near-js/utils';
import { deserialize } from 'borsh';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Serialises async work: one relayer key means one nonce sequence, so relayer transactions go out one at a time.
function mutex() {
  let tail = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => {});
    return run;
  };
}

const hasFailure = (s) => typeof s === 'object' && s !== null && 'Failure' in s && Boolean(s.Failure);

// NEP-141 events are logged by the token contract as  EVENT_JSON:{"standard":"nep141","event":"ft_transfer","data":[{...}]}
export function parseTransferEvents(logs = []) {
  const out = [];
  for (const l of logs) {
    if (typeof l !== 'string' || !l.startsWith('EVENT_JSON:')) continue;
    try {
      const e = JSON.parse(l.slice('EVENT_JSON:'.length));
      if (e.standard === 'nep141' && e.event === 'ft_transfer') for (const d of e.data || []) out.push({ from: d.old_owner_id, to: d.new_owner_id, amount: String(d.amount) });
    } catch { /* not ours */ }
  }
  return out;
}

// Reads a final execution outcome. success only when no receipt failed and the token contract's own receipt succeeded.
export function interpretOutcome(outcome, token) {
  if (hasFailure(outcome.status)) return { kind: 'failure', error: JSON.stringify(outcome.status.Failure) };
  for (const r of outcome.receipts_outcome ?? []) {
    if (hasFailure(r.outcome?.status)) return { kind: 'failure', error: JSON.stringify(r.outcome.status.Failure) };
  }
  const tokenReceipt = (outcome.receipts_outcome ?? []).find((r) => r.outcome?.executor_id === token);
  const st = tokenReceipt?.outcome?.status;
  if (typeof st === 'object' && st !== null && 'SuccessValue' in st) {
    return { kind: 'success', transfers: parseTransferEvents(tokenReceipt.outcome.logs), tx: outcome.transaction_outcome?.id };
  }
  return { kind: 'failure', error: 'inner_ft_transfer_receipt_not_successful' };
}

// `signer` is a FacilitatorNearSigner (RPC reads + relayer ids); `submit` and `lookup` talk to the relayer and the chain.
// Tests inject fakes for all three; the live build is makeLiveChain().
export function makeChain({ signer, submit, lookup, rebroadcast, token, maxSponsoredGas }) {
  const scheme = new ExactNearScheme(signer, undefined, { maxSponsoredGas });
  return {
    relayerId: signer.getRelayerIds()[0],
    token,
    blockHeight: (network) => signer.getCurrentBlockHeight(network),
    // payload: the x402 PaymentPayload from the PAYMENT-SIGNATURE header; requirements: what this gateway asked for
    verify: (payload, requirements) => scheme.verify(payload, requirements),
    // { signedDelegateAction, onPrepared(txHash, signedTxBase64) } -> { kind: success|failure, tx, error?, transfers? }; throws if the answer is unknown
    submit,
    // (txHash) -> { kind: success|failure|pending|unknown, ... }
    lookup,
    // (signedTxBase64, token) -> same shape as lookup(); sends the stored, already signed relayer transaction again
    rebroadcast: rebroadcast || (async () => { throw new Error('rebroadcast is not available'); }),
  };
}

export function makeLiveChain(cfg) {
  const { network, rpcUrl, relayerId, relayerKey } = cfg;
  const signer = createFacilitatorNearSigner({ relayers: [{ accountId: relayerId, secretKey: relayerKey }], rpcUrls: { [network]: rpcUrl } });
  const provider = new JsonRpcProvider({ url: rpcUrl });
  const keySigner = KeyPairSigner.fromSecretKey(relayerKey);
  const lock = mutex();

  async function submit({ signedDelegateAction, onPrepared }) {
    return lock(async () => {
      const decoded = deserialize(SCHEMA.SignedDelegate, fromBase64(signedDelegateAction));
      const senderId = decoded.delegateAction.senderId;
      const publicKey = await keySigner.getPublicKey();
      const [accessKey, block] = await Promise.all([
        provider.viewAccessKey(relayerId, publicKey, { finality: 'final' }),
        provider.block({ finality: 'final' }),
      ]);
      const tx = createTransaction(relayerId, publicKey, senderId, BigInt(accessKey.nonce) + 1n, [actionCreators.signedDelegate(decoded)], baseDecode(block.header.hash));
      const [hashBytes, signedTx] = await keySigner.signTransaction(tx);
      const txHash = baseEncode(hashBytes);
      onPrepared(txHash, Buffer.from(encodeTransaction(signedTx)).toString('base64')); // persisted before the broadcast
      let outcome;
      try {
        outcome = await provider.sendTransactionUntil(signedTx, 'FINAL');
      } catch (e) {
        const err = new Error(`broadcast outcome unknown: ${e.message || e}`);
        err.txHash = txHash;
        err.unknown = true;
        throw err;
      }
      return { ...interpretOutcome(outcome, decoded.delegateAction.receiverId), tx: txHash };
    });
  }

  async function lookup(txHash, token) {
    try {
      // wait_until NONE answers at once: UNKNOWN_TRANSACTION for a hash the node has never seen, the current status otherwise.
      // With FINAL an unknown hash blocks until the node gives up (measured on testnet: 30 s at 12:2xZ, 10 s at 14:4xZ on 2026-10-29) and ends in TIMEOUT_ERROR, which would make "never seen" look like "still pending".
      const outcome = await provider.viewTransactionStatus(txHash, relayerId, 'NONE');
      if (outcome.final_execution_status !== 'FINAL') return { kind: 'pending' };
      return { ...interpretOutcome(outcome, token), tx: txHash };
    } catch (e) {
      const msg = `${e?.type || ''} ${e?.message || ''} ${JSON.stringify(e?.data || '')}`;
      if (/UNKNOWN_TRANSACTION|doesn't exist|does not exist|not found/i.test(msg)) return { kind: 'unknown' };
      if (/TIMEOUT/i.test(msg)) return { kind: 'pending' };
      throw e;
    }
  }

  // Re-sending identical bytes cannot charge twice: the relayer nonce and the delegate nonce are each single-use on chain.
  async function rebroadcast(signedTxBase64, token) {
    const outcome = await provider.sendJsonRpc('send_tx', { signed_tx_base64: signedTxBase64, wait_until: 'FINAL' });
    return { ...interpretOutcome(outcome, token), tx: outcome.transaction_outcome?.id };
  }

  return { ...makeChain({ signer, submit, lookup, rebroadcast, token: cfg.usdc.asset }), provider };
}

// Polls lookup() until the transaction is final or the deadline passes. 'unknown' counts as "not yet" for a while: a node may not have indexed a just-sent tx.
export async function waitForOutcome(chain, txHash, { timeoutMs = 45000, intervalMs = 1500, token = chain.token } = {}) {
  const end = Date.now() + timeoutMs;
  let last = { kind: 'unknown' };
  while (Date.now() < end) {
    try { last = await chain.lookup(txHash, token); } catch { last = { kind: 'pending' }; }
    if (last.kind === 'success' || last.kind === 'failure') return last;
    const left = end - Date.now();
    if (left <= 0) break;
    await sleep(Math.min(intervalMs, left));
  }
  return last;
}

export { FT_TRANSFER_METHOD };
