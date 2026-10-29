// Runtime configuration. Everything comes from the environment so the same code runs on the VPS and in tests.
export const NEAR_TESTNET = {
  network: 'near:testnet',
  networkId: 'testnet',
  rpcUrl: 'https://rpc.testnet.fastnear.com',
  explorer: 'https://explorer.testnet.near.org',
};

// Circle USDC on NEAR testnet, the default asset of @x402/near and of the fastnear/x402-facilitator reference deployment.
export const USDC = {
  asset: '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af',
  symbol: 'USDC',
  decimals: 6,
};

export function loadConfig(env = process.env) {
  const need = (k) => {
    if (!env[k]) throw new Error(`${k} is required`);
    return env[k];
  };
  const account = (k) => {
    const v = need(k);
    if (!/^[a-z0-9._-]{2,64}$/.test(v)) throw new Error(`${k} must be a NEAR account id`);
    return v;
  };
  const key = (k) => {
    const v = need(k);
    if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(v)) throw new Error(`${k} must be an ed25519:<base58> secret key`);
    return v;
  };
  const upstreamPrefix = (env.UPSTREAM_PREFIX || '/api').replace(/\/$/, '');
  // The paid upstream path needs the prepaid key; the free /api/sample path (local proofs and tests) does not.
  const upstreamKey = upstreamPrefix === '/api' ? need('UPSTREAM_KEY') : (env.UPSTREAM_KEY || '');
  return {
    port: Number(env.PORT || 3041),
    host: env.HOST || '127.0.0.1',
    publicUrl: (env.PUBLIC_URL || 'https://near.ochinimus.app').replace(/\/$/, ''),
    network: NEAR_TESTNET.network,
    rpcUrl: env.NEAR_RPC_URL || NEAR_TESTNET.rpcUrl,
    explorer: NEAR_TESTNET.explorer,
    usdc: { ...USDC, asset: env.USDC_ACCOUNT_ID || USDC.asset },
    treasury: account('TREASURY_ACCOUNT_ID'),
    relayerId: account('RELAYER_ACCOUNT_ID'),
    relayerKey: key('RELAYER_PRIVATE_KEY'),
    maxTimeoutSeconds: Number(env.MAX_TIMEOUT_SECONDS || 60), // NEAR blocks are about 1 s, @x402/near counts one block per second
    upstreamUrl: (env.UPSTREAM_URL || 'https://x402.ochinimus.app').replace(/\/$/, ''),
    upstreamPrefix,
    upstreamKey,
    upstreamTimeoutMs: Number(env.UPSTREAM_TIMEOUT_MS || 15000),
    dbPath: env.DB_PATH || './agentfeed-near.db',
    dailyUpstreamCap: Number(env.DAILY_UPSTREAM_CAP || 5000),
    settleWaitMs: Number(env.SETTLE_WAIT_MS || 30000), // keep below maxTimeoutSeconds: a delegate action expires after that many blocks
  };
}
