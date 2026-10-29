# agentfeed-near

**AI agents buy [AgentFeed](https://x402.ochinimus.app) market data per call and pay in USDC on NEAR: the agent signs one NEP-366 delegate action, the gateway relays it and pays the gas, so the agent needs USDC only.** Phase 1 status (2026-10-29): 1 paid call settled on NEAR testnet from our own buyer account ([explorer](https://explorer.testnet.near.org/transactions/CnkcxKjhLZaXWx7vCae52mJSssPVykEKUpNbdJuBhr4N)); the live count and money are in `docs/RESULTS.md` and at `/stats` once the gateway is deployed.

Built for NEAR HACKATHON, track `agents`. Testnet only: nothing here is on NEAR mainnet and the USDC has no dollar value.

## Prior work and what is new (disclosure)

- **AgentFeed** (https://x402.ochinimus.app) is an existing product by the same builder: a paid crypto-data API for agents, live on Solana, Base and other chains. It is not part of this submission and was not changed.
- **agentfeed-mezo** (https://github.com/seekdaseek/agentfeed-mezo) is the same idea for Mezo, built on Oct 25 for another hackathon. This repo reuses its architecture (separate gateway, 402 challenge, fetch-before-settle, sqlite replay ledger, `/stats`, `/payments.csv`, manifest, client, MCP server, evidence verifier) and none of its chain code. That reuse is the builder's own earlier work.
- **New in the hackathon window, and the only thing judged:** everything in this repository: the NEAR payment path (x402 `exact` with NEP-366 delegate actions, verified with `@x402/near`, settled by our own relayer), the crash-safe payment state machine, the tests, the NEAR client and the scripts. First commit 2026-10-29.
- **The other entry** of the same builder: **StakeStreak on NEAR** (track `social`, separate repo).

## Judge it in five minutes

_Filled in during Phase 2 once the gateway is deployed; the commands below already work locally._

1. Without a wallet: `curl -i https://near.ochinimus.app/api/sol-price` (the 402 and its `payment-required` header), then `/stats`, `/payments.csv`, `/.well-known/x402`, any explorer link.
2. `npm install && npm test` (no network; 61 tests including a stock x402 client paying the gateway).
3. With a funded testnet account (USDC from the Circle faucet, no NEAR needed to pay):
   ```sh
   AGENT_ACCOUNT_ID=you.testnet node src/client.js sol-price --pretty
   ```
   The key is read from `~/.near-credentials/testnet/you.testnet.json` (near-cli format) or from `AGENT_PRIVATE_KEY=ed25519:...`. Expected output shape (measured, local gateway, 2026-10-29):
   ```
   paid  status 200  5.8 s  0.01 USDC
   tx    CnkcxKjhLZaXWx7vCae52mJSssPVykEKUpNbdJuBhr4N
   link  https://explorer.testnet.near.org/transactions/CnkcxKjhLZaXWx7vCae52mJSssPVykEKUpNbdJuBhr4N
   ```
   Full transcript with balances before and after: [`evidence/phase1-prove-settle.txt`](evidence/phase1-prove-settle.txt).

## How it works

```
agent                     gateway (this repo)                         NEAR testnet            AgentFeed
  | GET /api/liquidations      |                                           |                      |
  |--------------------------->|                                           |                      |
  | 402 + PAYMENT-REQUIRED     |  exact, near:testnet, USDC, payTo, 60 blocks                     |
  |<---------------------------|                                           |                      |
  | sign DelegateAction{ ft_transfer(treasury, price), 1 yocto }  (off-chain, no gas, no broadcast)|
  | GET + PAYMENT-SIGNATURE    |                                           |                      |
  |--------------------------->| verify: shape, signature, key, nonce, window, balance, storage --->|
  |                            | GET /api/liquidations (prepaid key) -------------------------------->|
  |                            |<-------------------------------------------------- data ---------|
  |                            | verify again, store relayer tx hash, then broadcast ->|          |
  |                            |<------------ FINAL, ft_transfer receipt SuccessValue -|          |
  | 200 + data + explorer link |                                           |                      |
  |<---------------------------|                                           |                      |
```

**Wire format.** x402 v2 `exact` on `near:testnet`, the same one `@x402/near` and [fastnear/x402-facilitator](https://github.com/fastnear/x402-facilitator) define, so a stock x402 NEAR client pays this gateway unmodified (`test/interop.test.js` drives `@x402/fetch` with the `@x402/near` client scheme against it). We embed the `@x402/near` facilitator verifier in the gateway and run our own relayer, because the hosted reference facilitators need manually approved credentials. The older `r-near/x402-near-demo` uses a different, custom scheme name; see [docs/FEEDBACK.md](docs/FEEDBACK.md).

**Charged once or not at all.** Every payment is one row in sqlite keyed by the sha256 of the signed delegate. It moves `reserved` (verified, data being fetched) to `submitted` (the relayer transaction hash is stored **before** it is broadcast) to `settled` (the chain's `ft_transfer` receipt succeeded) to `delivered`, or ends `failed`.

| what goes wrong | what happens |
|---|---|
| AgentFeed is down | `502`, `charged:false`, nothing broadcast; the same payment works when it is back |
| payer spends the balance while the data is fetched | caught by a second verification before any gas is spent |
| the relayer cannot broadcast | `402 settlement_failed`, `charged:false` |
| the broadcast answer is lost (timeout, crash) | the stored hash is looked up on the chain; the same payment header resolves it, with no second transfer |
| the process dies after the chain settled but before the data went out | the same header collects the data (`recovered:true`), still charged once |
| the same header again after delivery | `402 payment_replayed` |

Verified by named tests in `test/gateway.test.js` ("crash drill"); the live `kill -9` drill is Phase 3.

## Routes

| route | USDC per call |
|---|---|
| `/api/sol-price`, `/api/btc-price`, `/api/liq-pulse`, `/api/funding-pulse` | 0.01 |
| `/api/liquidations`, `/api/market-snapshot` | 0.02 |
| `/api/trade-context` | 0.03 |
| `/api/summarize?url=` | 0.05 |

Only declared query parameters are forwarded; paid routes are `GET` only (no free `HEAD`).

## Addresses (NEAR testnet)

| | account |
|---|---|
| USDC (Circle, NEP-141, 6 decimals) | `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af` |
| Treasury (payTo) | `agentfeed-near-treasury.testnet` |
| Relayer (pays gas) | `agentfeed-near-relayer.testnet` |
| Demo buyer | `iussum-near-principal.testnet`, a testnet account the builder holds from a sibling project (Phase 2 moves to a dedicated buyer) |

## Built with

Node.js 22+, `@x402/near` 2.28.0, `@near-js/*` 2.5.1, better-sqlite3, `@modelcontextprotocol/sdk`, zod. **AI assistance:** this code was written with Claude Code (Anthropic) under the builder's direction; the live proof above was produced by executing the code against NEAR testnet.

## Run your own

```sh
npm install && npm test
cat > .env <<'EOF2'
TREASURY_ACCOUNT_ID=your-treasury.testnet   # payTo; must be storage_deposit-registered on the USDC contract
RELAYER_ACCOUNT_ID=your-relayer.testnet     # pays gas; needs a little testnet NEAR
RELAYER_PRIVATE_KEY=ed25519:...
UPSTREAM_KEY=afk_...                        # an AgentFeed prepaid key
PUBLIC_URL=http://localhost:3041
EOF2
chmod 600 .env && npm start
```

Optional: `PORT`, `HOST`, `NEAR_RPC_URL`, `USDC_ACCOUNT_ID`, `UPSTREAM_URL`, `UPSTREAM_PREFIX` (use `/api/sample` for the free sample data, no key), `DB_PATH`, `MAX_TIMEOUT_SECONDS`, `DAILY_UPSTREAM_CAP` (defaults in [`src/config.js`](src/config.js)).

## Honest limits

- Testnet only. All payments in this repo's ledger come from the builder's own buyer account; there is no independent NEAR customer.
- The first measured settle latency to `FINAL` is 4.3 s (5.8 s end to end); one relayer key means settlements are serialised.
- A function-call access key cannot pay (the verifier refuses it); the payer needs a full-access key.
- The sample upstream (`/api/sample`) returns a stub, not live data; the deployed gateway uses a prepaid key and returns live data.

## Known advisories

`npm audit` (2026-10-29) reports `elliptic` through `secp256k1` through `@near-js/crypto` (no fix upstream; this repo only uses ed25519 keys and never calls the secp256k1 path) and a nested older `zod` inside `@x402/core`; this repo's own `zod` is 4.6.7.

## License

MIT, see [LICENSE](LICENSE).
