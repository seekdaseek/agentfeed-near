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

// ---- shared by scripts/verify-evidence.mjs and scripts/results.mjs

// Header-based parse, so columns added later (upstream_ms, total_ms) do not break older ledgers.
export function parseLedger(text) {
  const [head, ...rest] = text.trim().split('\n');
  const cols = head.split(',');
  return rest.filter(Boolean).map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
}

// Runs fn over items with a few requests in flight at once (the archival node answers in about 3 s, so one at a time is minutes), keeping order.
async function mapPool(items, n, fn) {
  const out = new Array(items.length); let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); if (++done % 25 === 0) console.error(`  ... ${done}/${items.length} rows`); }
  }));
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Raw JSON-RPC, none of the gateway's code on the read path. Retries a transaction the node does not know yet; null when it never shows up.
export async function rpc(rpcUrl, method, params) {
  let limited = 0;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await (await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(10000) })).json();
      if (r.result) return r.result;
      // the archival node rate-limits bursts: back off and try again without using up a try
      if (r.error?.code === -429 && ++limited <= 8) { await sleep(1500 * limited); i--; continue; }
      if (r.error?.cause?.name === 'UNKNOWN_TRANSACTION') { await sleep(500); continue; }
      if (i === 2) return null;
    } catch { await sleep(500); }
  }
  return null;
}

export async function verifyRows(rows, ctx, rpcUrl) {
  const res = await mapPool(rows, 8, async (row) => {
    const result = await rpc(rpcUrl, 'tx', { tx_hash: row.tx_hash, sender_account_id: ctx.relayer, wait_until: 'FINAL' });
    return { row, c: checkTx(result, row, ctx) };
  });
  let ok = 0, total = 0n; const bad = [];
  for (const { row, c } of res) { if (c.ok) { ok++; total += c.amount; } else bad.push(`${row.tx_hash}: ${c.why}`); }
  return { ok, total, bad };
}

export async function treasuryBalance(ctx, rpcUrl) {
  const r = await rpc(rpcUrl, 'query', { request_type: 'call_function', finality: 'final', account_id: ctx.token, method_name: 'ft_balance_of', args_base64: Buffer.from(JSON.stringify({ account_id: ctx.treasury })).toString('base64') });
  return BigInt(r.result.map((b) => String.fromCharCode(b)).join('').replace(/"/g, ''));
}

export const fmtUsdc = (a) => `${a / 1_000_000n}.${String(a % 1_000_000n).padStart(6, '0')}`;

// ---- outflows: USDC that left the treasury

// The batch buyer spends USDC that lands in the treasury, so the treasury recycles it to the buyer with one plain ft_transfer that the
// treasury itself signs (evidence/treasury-outflows.csv: timestamp_utc,from,to,amount_usdc,tx_hash,note). Each outflow is verified from the
// chain the same way as a ledger row, and verify-evidence / results.mjs subtract the verified total: balance = ledger + extras - outflows.
export function checkOutflow(result, row, ctx) {
  const fail = (why) => ({ ok: false, why });
  if (!result) return fail('transaction not found');
  if (result.final_execution_status !== 'FINAL') return fail(`not final: ${result.final_execution_status}`);
  const tx = result.transaction;
  if (tx.hash !== row.tx_hash) return fail('hash mismatch');
  if (row.from !== ctx.treasury) return fail('the record is not an outflow of the treasury');
  if (tx.signer_id !== ctx.treasury) return fail(`signed by ${tx.signer_id}, expected the treasury ${ctx.treasury}`);
  if (tx.receiver_id !== ctx.token) return fail('transaction does not target the USDC contract');
  if (tx.actions.length !== 1 || !tx.actions[0].FunctionCall) return fail('not a single function call');
  const fc = tx.actions[0].FunctionCall;
  if (fc.method_name !== 'ft_transfer' || String(fc.deposit) !== '1') return fail('call is not ft_transfer with 1 yocto');
  const args = JSON.parse(Buffer.from(fc.args, 'base64').toString());
  const want = toAtomic(row.amount_usdc);
  if (args.receiver_id !== row.to || BigInt(args.amount) !== want) return fail('ft_transfer args differ from the record');
  if (!('SuccessValue' in result.status)) return fail('final status is not SuccessValue');
  for (const r of result.receipts_outcome) if (r.outcome.status.Failure) return fail('a receipt failed');
  const tokenReceipt = result.receipts_outcome.find((r) => r.outcome.executor_id === ctx.token);
  if (!tokenReceipt || !('SuccessValue' in tokenReceipt.outcome.status)) return fail('token receipt missing or not successful');
  const ev = parseTransferEvents(tokenReceipt.outcome.logs).filter((e) => e.from === ctx.treasury && e.to === row.to && BigInt(e.amount) === want);
  if (ev.length !== 1) return fail('no single NEP-141 ft_transfer event treasury -> recipient for the recorded amount');
  return { ok: true, amount: want };
}

export async function verifyOutflows(rows, ctx, rpcUrl) {
  const res = await mapPool(rows, 8, async (row) => {
    const result = await rpc(rpcUrl, 'tx', { tx_hash: row.tx_hash, sender_account_id: ctx.treasury, wait_until: 'FINAL' });
    return { row, c: checkOutflow(result, row, ctx) };
  });
  let ok = 0, total = 0n; const bad = [];
  for (const { row, c } of res) { if (c.ok) { ok++; total += c.amount; } else bad.push(`${row.tx_hash}: ${c.why}`); }
  return { ok, total, bad };
}
