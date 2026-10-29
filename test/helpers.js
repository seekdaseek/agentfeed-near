// Test harness: the real gateway code and the real @x402/near `exact` verifier over a FAKE NEAR world and a FAKE upstream.
// Delegate actions are real NEP-366 signed delegates made with the NEAR libraries; only RPC reads, the relayer broadcast and
// AgentFeed are stubbed. Live-chain evidence is in evidence/ and the README, not here.
import http from 'node:http';
import { KeyPair } from '@near-js/crypto';
import { KeyPairSigner } from '@near-js/signers';
import { actionCreators, buildDelegateAction, encodeSignedDelegate } from '@near-js/transactions';
import { ONE_YOCTO, DEFAULT_FT_TRANSFER_GAS, EMPTY_CONTRACT_CODE_HASH, toBase64 } from '@x402/near';
import { loadConfig, USDC } from '../src/config.js';
import { makeChain } from '../src/chain.js';
import { createGateway } from '../src/server.js';
import { openStore } from '../src/store.js';
import { priceAtomic, findRoute } from '../src/routes.js';

export const TREASURY = 'agentfeed-near-treasury.testnet';
export const RELAYER = 'agentfeed-near-relayer.testnet';
export const TOKEN = USDC.asset;
export const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');

export const baseEnv = () => ({
  TREASURY_ACCOUNT_ID: TREASURY, RELAYER_ACCOUNT_ID: RELAYER, RELAYER_PRIVATE_KEY: `ed25519:${'1'.repeat(88)}`,
  UPSTREAM_KEY: 'afk_test', DB_PATH: ':memory:', PUBLIC_URL: 'http://gw.test', UPSTREAM_URL: 'http://upstream.test',
});

// A tiny NEAR: block height, accounts, access keys, balances, storage registration.
export function fakeWorld() {
  const w = {
    height: 10_000n,
    accounts: new Set([TREASURY, RELAYER, TOKEN]),
    codeHash: new Map([[TOKEN, 'ContractCodeHashContractCodeHash11']]),
    keys: new Map(), // `${account}|${publicKey}` -> { nonce, permissionKind }
    balances: new Map(),
    registered: new Set([TREASURY]),
    rpcDown: false,
  };
  return w;
}

export function fakeSigner(w) {
  const guard = () => { if (w.rpcDown) throw new Error('rpc down'); };
  return {
    getRelayerIds: () => [RELAYER],
    async getCurrentBlockHeight() { guard(); return w.height; },
    async viewAccount({ accountId }) { guard(); return w.accounts.has(accountId) ? { codeHash: w.codeHash.get(accountId) || EMPTY_CONTRACT_CODE_HASH } : null; },
    async viewAccessKey({ accountId, publicKey }) { guard(); return w.keys.get(`${accountId}|${publicKey}`) ?? null; },
    async ftBalanceOf({ accountId }) { guard(); return w.balances.get(accountId) ?? 0n; },
    async storageBalanceOf({ accountId }) { guard(); return { supported: true, registered: w.registered.has(accountId) }; },
    async submitSignedDelegateAction() { throw new Error('the gateway submits through chain.submit, not the scheme'); },
  };
}

// A buyer: a real ed25519 key registered in the fake world with a USDC balance.
export function newBuyer(w, name = 'buyer-one.testnet', { balance = 5_000_000n, permission = 'FullAccess', nonce = 7n } = {}) {
  const kp = KeyPair.fromRandom('ed25519');
  const signer = new KeyPairSigner(kp);
  const publicKey = kp.getPublicKey();
  w.accounts.add(name);
  w.keys.set(`${name}|${publicKey.toString()}`, { nonce, permissionKind: permission });
  w.balances.set(name, balance);
  return { name, kp, signer, publicKey, w };
}

// A signed delegate action as the stock client builds it, with knobs to build bad ones.
export async function signDelegate(buyer, accept, o = {}) {
  const w = buyer.w;
  const accessNonce = w.keys.get(`${buyer.name}|${buyer.publicKey.toString()}`)?.nonce ?? 0n;
  const fn = actionCreators.functionCall(
    o.method ?? 'ft_transfer',
    o.args ?? { receiver_id: o.payTo ?? accept.payTo, amount: o.amount ?? accept.amount },
    o.gas ?? DEFAULT_FT_TRANSFER_GAS,
    o.deposit ?? ONE_YOCTO,
  );
  const da = buildDelegateAction({
    actions: o.actions ?? [fn],
    maxBlockHeight: o.maxBlockHeight ?? (w.height + BigInt(accept.maxTimeoutSeconds)),
    nonce: o.nonce ?? accessNonce + 1n,
    publicKey: buyer.publicKey,
    receiverId: o.receiverId ?? accept.asset,
    senderId: o.senderId ?? buyer.name,
  });
  const [, signed] = await buyer.signer.signDelegateAction(da);
  const bytes = Buffer.from(encodeSignedDelegate(signed));
  if (o.tamper) bytes[bytes.length - 3] ^= 0xff; // flips signature bytes
  return toBase64(bytes);
}

export function paymentFor(accept, sda, o = {}) {
  return {
    x402Version: 2, resource: { url: 'http://gw.test/api/x', description: 'x', mimeType: 'application/json' },
    accepted: { ...accept, ...(o.accepted || {}) }, payload: { signedDelegateAction: sda },
  };
}

export function fakeUpstream() {
  const u = { mode: 'ok', calls: [], payload: { tool: 'sol_price', data: { symbol: 'SOL', usd: 142.5 } } };
  u.server = http.createServer((req, res) => {
    u.calls.push({ url: req.url, key: req.headers['x-agentfeed-key'] });
    if (u.mode === 'down') { res.writeHead(503); return res.end('{"error":"stale"}'); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(u.payload));
  });
  return new Promise((r) => u.server.listen(0, '127.0.0.1', () => { u.url = `http://127.0.0.1:${u.server.address().port}`; r(u); }));
}

// The relayer side: submit() records the tx hash through onPrepared BEFORE it "broadcasts", exactly like the live chain does.
export function fakeRelayer(w) {
  const r = {
    mode: 'ok', // ok | fail | throw_before | throw_unknown | throw_lost
    submits: 0, txs: new Map(), // txHash -> outcome the "chain" would report
    lookups: [], rebroadcasts: [], rebroadcastMode: 'chain', // chain: the resend lands | throw: the node refuses it | none: unknown still
    async submit({ signedDelegateAction, onPrepared }) {
      r.submits++;
      if (r.mode === 'throw_before') throw new Error('rpc refused the broadcast');
      const tx = `FakeTx${String(r.submits).padStart(4, '0')}${'x'.repeat(32)}`;
      onPrepared(tx, Buffer.from(`signed:${tx}`).toString('base64'));
      r.last = { tx, signedDelegateAction };
      if (r.mode === 'throw_unknown' || r.mode === 'throw_lost') { // lost: the node never saw it; unknown: it saw it and is still working
        if (r.mode === 'throw_unknown') r.txs.set(tx, { kind: 'pending' });
        const e = new Error('broadcast outcome unknown: timeout'); e.unknown = true; e.txHash = tx; throw e;
      }
      if (r.mode === 'fail') { r.txs.set(tx, { kind: 'failure', error: 'ft_transfer panicked' }); return { kind: 'failure', error: 'ft_transfer panicked', tx }; }
      const out = r.transfer ? { ...r.transfer } : null;
      r.txs.set(tx, { kind: 'success', transfers: out ? [out] : [], tx });
      return { kind: 'success', transfers: out ? [out] : [], tx };
    },
    async lookup(tx) { r.lookups.push(tx); return r.txs.get(tx) ?? { kind: 'unknown' }; },
    async rebroadcast(signedB64) {
      r.rebroadcasts.push(signedB64);
      if (r.rebroadcastMode === 'throw') throw new Error('node refused the transaction');
      const tx = Buffer.from(signedB64, 'base64').toString().replace(/^signed:/, '');
      if (r.rebroadcastMode === 'chain') { const out = { kind: 'success', transfers: [], tx }; r.txs.set(tx, out); return out; }
      return { kind: 'unknown' };
    },
  };
  return r;
}

export async function boot({ world = fakeWorld(), dbPath = ':memory:', overrides = {} } = {}) {
  const up = await fakeUpstream();
  const cfg = loadConfig({ ...baseEnv(), UPSTREAM_URL: up.url, UPSTREAM_PREFIX: '/api', DB_PATH: dbPath, SETTLE_WAIT_MS: '300', ...overrides });
  const relayer = fakeRelayer(world);
  const chain = makeChain({ signer: fakeSigner(world), submit: relayer.submit, lookup: relayer.lookup, rebroadcast: relayer.rebroadcast, token: TOKEN });
  const store = openStore(dbPath);
  const gw = createGateway({ cfg, chain, store });
  await new Promise((r) => gw.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${gw.address().port}`;
  const close = () => { gw.closeAllConnections(); gw.close(); up.server.closeAllConnections(); up.server.close(); store.close(); };
  return { cfg, world, chain, relayer, store, up, gw, url, close };
}

export async function challenge(url, route = 'sol-price', qs = '') {
  const r = await fetch(`${url}/api/${route}${qs}`);
  const body = await r.json();
  const header = r.headers.get('payment-required') ? JSON.parse(Buffer.from(r.headers.get('payment-required'), 'base64').toString()) : null;
  return { status: r.status, body, header, accept: body.accepts?.[0] };
}

export const pay = (ctx, route, payment, qs = '') => fetch(`${ctx.url}/api/${route}${qs}`, { headers: { 'payment-signature': b64(payment) } });

// challenge + sign + pay in one go; returns the Response together with the payment so a test can replay it
export async function payOnce(ctx, buyer, route = 'sol-price', o = {}, qs = '') {
  const ch = await challenge(ctx.url, route, qs);
  const sda = await signDelegate(buyer, ch.accept, o);
  const payment = paymentFor(ch.accept, sda, o);
  const res = await pay(ctx, route, payment, qs);
  return { res, payment, ch, sda };
}
export { findRoute, priceAtomic };
