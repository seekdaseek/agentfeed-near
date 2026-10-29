# agentfeed-near

**AI agents buy [AgentFeed](https://x402.ochinimus.app) market data per call and pay in USDC on NEAR: the agent signs one NEP-366 delegate action, the gateway relays it and pays the gas, so the agent needs USDC only.** Live at https://near.ochinimus.app: **10 paid calls and 0.18 USDC settled on NEAR testnet through the deployed gateway as of 2026-10-29, every one a transaction you can open** (all from our own buyer account; counted from the gateway's ledger at [`/payments.csv`](https://near.ochinimus.app/payments.csv), re-read from the chain by `scripts/verify-evidence.mjs`: 10 of 10 verified). The live number is at [`/stats`](https://near.ochinimus.app/stats).

Built for NEAR HACKATHON, track `agents`. Testnet only: nothing here is on NEAR mainnet and the USDC has no dollar value.

## Prior work and what is new (disclosure)

- **AgentFeed** (https://x402.ochinimus.app) is an existing product by the same builder: a paid crypto-data API for agents, live on Solana, Base and other chains. It is not part of this submission and was not changed.
- **agentfeed-mezo** (https://github.com/seekdaseek/agentfeed-mezo) is the same idea for Mezo, built on Oct 25 for another hackathon. This repo reuses its architecture (separate gateway, 402 challenge, fetch-before-settle, sqlite replay ledger, `/stats`, `/payments.csv`, manifest, client, MCP server, evidence verifier) and none of its chain code. That reuse is the builder's own earlier work.
- **New in the hackathon window, and the only thing judged:** everything in this repository: the NEAR payment path (x402 `exact` with NEP-366 delegate actions, verified with `@x402/near`, settled by our own relayer), the crash-safe payment state machine, the tests, the NEAR client and the scripts. First commit 2026-10-29.
- **The other entry** of the same builder: **StakeStreak on NEAR** (track `social`, separate repo).

## Judge it in five minutes

1. **See the 402, no wallet.** `curl -i https://near.ochinimus.app/api/sol-price` returns `HTTP/2 402` with a base64 `payment-required` header and the same JSON in the body:
   ```json
   { "x402Version": 2, "error": "payment_required",
     "accepts": [{ "scheme": "exact", "network": "near:testnet", "amount": "10000",
                   "asset": "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af",
                   "payTo": "agentfeed-near-treasury.testnet", "maxTimeoutSeconds": 60 }] }
   ```
2. **See real settlements, no wallet.** Open [`/stats`](https://near.ochinimus.app/stats) and [`/payments.csv`](https://near.ochinimus.app/payments.csv), then click any `tx_url`. The explorer shows a transaction signed by the relayer whose `Delegate` action moves 0.01 to 0.05 USDC from the buyer to the treasury. [`/.well-known/x402`](https://near.ochinimus.app/.well-known/x402) lists the 8 routes.
3. **Re-check the evidence against the chain yourself, no wallet:** `npm install && node scripts/verify-evidence.mjs` reads every ledger row from NEAR testnet RPC and prints `verifiedOnChain`, the treasury balance and whether it equals the ledger. Expected: [`evidence/phase2-verify-evidence.txt`](evidence/phase2-verify-evidence.txt).
4. **Run the tests:** `npm install && npm test` (84 tests, no network, including a stock x402 client paying the gateway and the MCP server driven by a real MCP client).
5. **Pay a call yourself** (needs a testnet account holding a little Circle testnet USDC, from [faucet.circle.com](https://faucet.circle.com); NEAR is needed once, 0.00125 NEAR for the token's `storage_deposit` registration, and never to pay):
   ```sh
   git clone https://github.com/seekdaseek/agentfeed-near && cd agentfeed-near && npm install
   AGENT_ACCOUNT_ID=you.testnet node src/client.js sol-price --pretty
   AGENT_ACCOUNT_ID=you.testnet node src/client.js liquidations symbol=SOL limit=5 --pretty
   ```
   The key is read from `~/.near-credentials/testnet/you.testnet.json` (near-cli format) or from `AGENT_PRIVATE_KEY=ed25519:...`. The account must be storage-registered on the USDC contract. Expected output shape (measured, 2026-10-29):
   ```
   paid  status 200  5.9 s  0.01 USDC
   tx    FojDWd9d5k79Noa1CdCSuR4iRyd2XtNGr9iJ58tchM7w
   link  https://explorer.testnet.near.org/transactions/FojDWd9d5k79Noa1CdCSuR4iRyd2XtNGr9iJ58tchM7w
   data  {"route":"/api/sol-price",...}
   ```
   Phase 1 transcript with balances before and after: [`evidence/phase1-prove-settle.txt`](evidence/phase1-prove-settle.txt).

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
| Demo buyer (ours) | `agentfeed-near-buyer.testnet`, funded with 5 USDC from `iussum-near-principal.testnet`, a testnet account the builder holds from a sibling project (which also made the Phase 1 proof call) |

## Built with

Node.js 22+ (gateway running on 22.23.1 on the VPS; the test suite has been run on 24.16 only), `@x402/near` 2.28.0, `@near-js/*` 2.5.1, better-sqlite3, `@modelcontextprotocol/sdk`, zod. **AI assistance:** this code was written with Claude Code (Anthropic) under the builder's direction; the live proof above was produced by executing the code against NEAR testnet.

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
- Settle latency to `FINAL` is 4.1 to 4.7 s per call on testnet (8 live calls), 5.3 to 6.6 s end to end when AgentFeed answers fast; the data fetch and the settlement run one after the other by design (fetch before settle), and one relayer key means settlements are serialised. One call took 13.2 s because AgentFeed's `liq-pulse` took 8.1 s that time.
- A function-call access key cannot pay (the verifier refuses it); the payer needs a full-access key.
- The sample upstream (`/api/sample`) returns a stub, not live data; the deployed gateway uses a prepaid key and returns live data.

## Known advisories

`npm audit` on 2026-10-29 reported two findings. One is fixed, one has no patched release.

- **zod, GHSA-mrhx-c7xc-m3w5 (CVE-2023-54404, high), fixed.** `@x402/core` 2.28.0 pins `zod ^3.24.2` (3.25.76 installed), and the advisory affects `< 4.6.6`. `package.json` carries `"overrides": { "@x402/core": { "zod": "4.6.7" } }`, so every zod in the tree is now 4.6.7 (`npm ls zod`). All 61 tests pass on it, including the stock `@x402/fetch` / `@x402/core` client driving the gateway. This is an override of a pinned range, which the `@x402/core` maintainers have not tested; if `@x402/core` ever misbehaves on zod 4, this line is the first suspect.
- **elliptic, GHSA-848j-6mx2-7j84 (CVE-2025-14505, low), documented only.** Vulnerable range `<= 6.6.1`; **no patched version exists** (6.6.1 is the latest release on npm, last published 2024-11-13). It enters through `@near-js/crypto` -> `secp256k1` -> `elliptic`. The flaw is in secp256k1 ECDSA signing (a truncated nonce `k`); this repo signs only with ed25519 keys and never calls a secp256k1 path. `npm audit` still lists 8 low findings, all the same chain (`@near-js/*`, `@x402/near`, `secp256k1`, `elliptic`); its suggested "fixes" downgrade `@near-js/*` to 1.x, which `@x402/near` does not accept.

## License

MIT, see [LICENSE](LICENSE).
