// Reads a settlement back from the chain's own record and compares it with a ledger row. Pure: takes the RPC `tx` result.
// A row is verified only if EVERY check passes: the relayer signed a transaction to the payer carrying a Delegate action whose
// inner action is one ft_transfer (1 yocto) on the USDC contract, every receipt succeeded, and the token receipt logged an
// NEP-141 ft_transfer event from the payer to the treasury for the ledger amount.
import { parseTransferEvents } from './chain.js';

export const toAtomic = (usdc) => {
  const [w, f = ''] = String(usdc).split('.');
  return BigInt(w) * 1_000_000n + BigInt((f + '000000').slice(0, 6));
};

export function checkTx(result, row, ctx) {
  const fail = (why) => ({ ok: false, why });
  if (!result) return fail('transaction not found');
  if (result.final_execution_status !== 'FINAL') return fail(`not final: ${result.final_execution_status}`);
  const tx = result.transaction;
  if (tx.hash !== row.tx_hash) return fail('hash mismatch');
  if (tx.signer_id !== ctx.relayer) return fail(`signed by ${tx.signer_id}, expected relayer ${ctx.relayer}`);
  if (row.relayer && row.relayer !== ctx.relayer) return fail('ledger relayer differs from the manifest relayer');
  if (tx.receiver_id !== row.payer) return fail(`transaction receiver ${tx.receiver_id} is not the payer ${row.payer}`);
  if (tx.actions.length !== 1 || !tx.actions[0].Delegate) return fail('not a single Delegate action');
  const d = tx.actions[0].Delegate.delegate_action;
  if (d.sender_id !== row.payer) return fail('delegate sender is not the payer');
  if (d.receiver_id !== ctx.token) return fail('delegate does not target the USDC contract');
  if (d.actions.length !== 1 || !d.actions[0].FunctionCall) return fail('inner action is not one function call');
  const fc = d.actions[0].FunctionCall;
  if (fc.method_name !== 'ft_transfer' || String(fc.deposit) !== '1') return fail('inner call is not ft_transfer with 1 yocto');
  const args = JSON.parse(Buffer.from(fc.args, 'base64').toString());
  const want = toAtomic(row.amount_usdc);
  if (args.receiver_id !== ctx.treasury || BigInt(args.amount) !== want) return fail('ft_transfer args differ from the ledger');
  if (!('SuccessValue' in result.status)) return fail('final status is not SuccessValue');
  for (const r of result.receipts_outcome) if (r.outcome.status.Failure) return fail('a receipt failed');
  const tokenReceipt = result.receipts_outcome.find((r) => r.outcome.executor_id === ctx.token);
  if (!tokenReceipt || !('SuccessValue' in tokenReceipt.outcome.status)) return fail('token receipt missing or not successful');
  const ev = parseTransferEvents(tokenReceipt.outcome.logs).filter((e) => e.from === row.payer && e.to === ctx.treasury && BigInt(e.amount) === want);
  if (ev.length !== 1) return fail('no single NEP-141 ft_transfer event payer -> treasury for the ledger amount');
  return { ok: true, amount: want };
}
