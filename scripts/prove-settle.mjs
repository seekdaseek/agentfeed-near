// One real paid call on NEAR testnet, end to end, in one process:
//   local gateway (live chain, relayer + treasury from ~/.near-credentials) <- stock x402 NEAR client (the buyer account)
// The upstream is AgentFeed's free /api/sample route, so no prepaid key is needed for this proof.
//   node scripts/prove-settle.mjs [route] [buyer.testnet]
import { JsonRpcProvider } from '@near-js/providers';
import { loadConfig } from '../src/config.js';
import { openStore } from '../src/store.js';
import { makeLiveChain } from '../src/chain.js';
import { createGateway } from '../src/server.js';
import { createAgent, loadSecretKey } from '../src/client.js';

const route = process.argv[2] || 'sol-price';
const buyer = process.argv[3] || 'iussum-near-principal.testnet';
const relayerId = process.env.RELAYER_ACCOUNT_ID || 'agentfeed-near-relayer.testnet';
const treasury = process.env.TREASURY_ACCOUNT_ID || 'agentfeed-near-treasury.testnet';

const cfg = loadConfig({
  TREASURY_ACCOUNT_ID: treasury, RELAYER_ACCOUNT_ID: relayerId, RELAYER_PRIVATE_KEY: loadSecretKey(relayerId),
  UPSTREAM_PREFIX: '/api/sample', DB_PATH: ':memory:', PUBLIC_URL: 'http://127.0.0.1', HOST: '127.0.0.1', PORT: '0',
});
const store = openStore(':memory:');
const chain = makeLiveChain(cfg);
const server = createGateway({ cfg, chain, store });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}`;
const provider = new JsonRpcProvider({ url: cfg.rpcUrl });
const bal = async (a) => BigInt(await provider.callFunction(cfg.usdc.asset, 'ft_balance_of', { account_id: a }, { finality: 'final' }));
const nearBal = async (a) => (await provider.viewAccount(a, { finality: 'final' })).amount;
const usdc = (x) => (Number(x) / 1e6).toFixed(6);

const agent = createAgent({ accountId: buyer, secretKey: loadSecretKey(buyer), baseUrl: url, rpcUrl: cfg.rpcUrl });
const before = { buyer: await bal(buyer), treasury: await bal(treasury), buyerNear: await nearBal(buyer), relayerNear: await nearBal(relayerId) };
console.log(`buyer ${buyer}  USDC ${usdc(before.buyer)}   treasury ${treasury}  USDC ${usdc(before.treasury)}`);
const first = await fetch(`${url}/api/${route}`);
console.log(`unpaid GET /api/${route} -> ${first.status}, payment-required header ${first.headers.get('payment-required') ? 'present' : 'MISSING'}`);

const r = await agent.call(route);
console.log(`paid call -> status ${r.status} in ${(r.ms / 1000).toFixed(2)} s`);
if (!r.ok) { console.log(JSON.stringify(r.body, null, 1)); server.close(); store.close(); process.exit(1); }
console.log(`tx ${r.paid.tx}\n${r.paid.url}`);
console.log(`data ${JSON.stringify(r.body.data).slice(0, 200)}`);

const after = { buyer: await bal(buyer), treasury: await bal(treasury), buyerNear: await nearBal(buyer), relayerNear: await nearBal(relayerId) };
const outcome = await provider.viewTransactionStatus(r.paid.tx, relayerId, 'FINAL');
console.log(JSON.stringify({
  buyer_usdc_delta: usdc(after.buyer - before.buyer), treasury_usdc_delta: usdc(after.treasury - before.treasury),
  buyer_near_unchanged: before.buyerNear === after.buyerNear, relayer_near_spent_yocto: (BigInt(before.relayerNear) - BigInt(after.relayerNear)).toString(),
  tx_signer: outcome.transaction.signer_id, tx_receiver: outcome.transaction.receiver_id, final_status: outcome.final_execution_status,
  ledger: store.all().map((p) => ({ state: p.state, route: p.route, payer: p.payer, amount: p.amount, tx: p.tx_hash, settle_ms: p.settle_ms })),
}, null, 1));
const logs = outcome.receipts_outcome.flatMap((x) => x.outcome.logs);
console.log('token receipt logs:', JSON.stringify(logs));
server.close(); store.close();
