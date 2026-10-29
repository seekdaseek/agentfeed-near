// A stock x402 client, no code from this repo on the payer side: @x402/fetch wraps fetch, @x402/near supplies the NEAR signer and scheme.
//   AGENT_ACCOUNT_ID=you.testnet node scripts/stock-client.mjs [url]     (default https://near.ochinimus.app/api/sol-price)
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from '@x402/fetch';
import { ExactNearScheme } from '@x402/near/exact/client';
import { createClientNearSigner } from '@x402/near';
import { loadSecretKey } from '../src/client.js';

const accountId = process.env.AGENT_ACCOUNT_ID;
if (!accountId) { console.error('AGENT_ACCOUNT_ID is required (key from AGENT_PRIVATE_KEY or ~/.near-credentials/testnet/<id>.json)'); process.exit(2); }
const secretKey = process.env.AGENT_PRIVATE_KEY || loadSecretKey(accountId);
const url = process.argv[2] || 'https://near.ochinimus.app/api/sol-price';
const client = new x402Client().register('near:testnet', new ExactNearScheme(createClientNearSigner({ accountId, secretKey })));
const t0 = Date.now();
const res = await wrapFetchWithPayment(fetch, client)(url);
const body = await res.json();
console.log(`status ${res.status} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const h = res.headers.get('payment-response');
if (h) { const s = decodePaymentResponseHeader(h); console.log(`settlement ${s.transaction} payer ${s.payer} on ${s.network}\nhttps://explorer.testnet.near.org/transactions/${s.transaction}`); }
console.log(JSON.stringify(body.data ?? body).slice(0, 200));
process.exit(res.ok ? 0 : 1);
