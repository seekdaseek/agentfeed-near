// A SECOND independent client library paying this gateway: @fastnear/x402 (FastNEAR's adapters over the x402 foundation scheme), using its
// documented Node local-key payer. Not a dependency of this repo; install it next to the script:   npm install --no-save @fastnear/x402
//   AGENT_ACCOUNT_ID=you.testnet node scripts/fastnear-client.mjs [url]       (key from AGENT_PRIVATE_KEY or ~/.near-credentials/testnet/<id>.json)
import { createNearPaymentFetch } from '@fastnear/x402';
import { createLocalNearSigner } from '@fastnear/x402/node';
import { loadSecretKey } from '../src/client.js';

const accountId = process.env.AGENT_ACCOUNT_ID;
if (!accountId) { console.error('AGENT_ACCOUNT_ID is required'); process.exit(2); }
const signer = createLocalNearSigner({ accountId, secretKey: process.env.AGENT_PRIVATE_KEY || loadSecretKey(accountId), rpcUrls: { 'near:testnet': 'https://rpc.testnet.fastnear.com' } });
const paidFetch = createNearPaymentFetch({ signer, network: 'near:testnet' });
const url = process.argv[2] || 'https://near.ochinimus.app/api/sol-price';
const t0 = Date.now();
const res = await paidFetch(url);
const body = await res.json();
console.log(`status ${res.status} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (body.paid) console.log(`paid ${body.paid.amount_usdc} USDC, tx ${body.paid.tx}\n${body.paid.explorer}`);
console.log(JSON.stringify(body.data ?? body).slice(0, 200));
process.exit(res.ok ? 0 : 1);
