// Process entry. Kept separate from server.js because PM2 fork mode makes argv[1] its own container,
// so an "is this the main module" check never fires under PM2.
import { loadConfig } from './config.js';
import { openStore } from './store.js';
import { makeLiveChain } from './chain.js';
import { createGateway } from './server.js';

const cfg = loadConfig();
const store = openStore(cfg.dbPath);
const chain = makeLiveChain(cfg);
const server = createGateway({ cfg, chain, store });
server.listen(cfg.port, cfg.host, async () => {
  console.log(`agentfeed-near listening on ${cfg.host}:${cfg.port} relayer=${chain.relayerId} treasury=${cfg.treasury} asset=${cfg.usdc.asset}`);
  const first = await server.reconcile().catch((e) => ({ error: e.message }));
  console.log('reconcile at start', JSON.stringify(first));
});
setInterval(() => server.reconcile().catch((e) => console.error('reconcile', e.message)), 60000).unref();
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(); store.close(); process.exit(0); });
