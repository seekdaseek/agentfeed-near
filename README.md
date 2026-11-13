# agentfeed-near

**AI agents buy [AgentFeed](https://x402.ochinimus.app) market data per call and pay in USDC on NEAR: the agent signs one NEP-366 delegate action, the gateway relays it and pays the gas, so the agent needs USDC only.** Live at https://near.ochinimus.app: **278 paid calls and 5.40 USDC settled on NEAR testnet through the deployed gateway as of 2026-11-13 08:25Z, every one a transaction you can open** (all from our own accounts, 0 independent payers; read from the gateway's ledger at [`/stats`](https://near.ochinimus.app/stats) and [`/payments.csv`](https://near.ochinimus.app/payments.csv)). The treasury holds 1.64 USDC, which is the ledger 5.40 plus the listed extras 0.24 minus the 4.00 recycled to the batch buyer. [`docs/RESULTS.md`](docs/RESULTS.md) is the 2026-10-29 snapshot (43 calls, 43 of 43 re-read from the chain): regenerating it for 278 rows hit the archival RPC's rate limit, so it was not refreshed.

Built for NEAR HACKATHON, tracks `agents` and `realworld`. Testnet only: nothing here is on NEAR mainnet and the USDC has no dollar value.

## Prior work and what is new (disclosure)

- **AgentFeed** (https://x402.ochinimus.app) is an existing product by the same builder: a paid crypto-data API for agents, live on Solana, Base and other chains. It is not part of this submission and was not changed.
- **agentfeed-mezo** (https://github.com/seekdaseek/agentfeed-mezo) is the same idea for Mezo, built on Oct 25 for another hackathon. This repo reuses its architecture (separate gateway, 402 challenge, fetch-before-settle, sqlite replay ledger, `/stats`, `/payments.csv`, manifest, client, MCP server, evidence verifier) and none of its chain code. That reuse is the builder's own earlier work.
- **New in the hackathon window, and the only thing judged:** everything in this repository: the NEAR payment path (x402 `exact` with NEP-366 delegate actions, verified with `@x402/near`, settled by our own relayer), the crash-safe payment state machine, the tests, the NEAR client and the scripts. First commit 2026-10-29.
- **The other entry** of the same builder: **StakeStreak on NEAR**, https://github.com/seekdaseek/stakestreak-near (track `social`). It is an independent project with its own repository; it names this one in its README.

## What was built in the window (Q-003: the diff)

- **This repository was created on 2026-10-29 for NEAR HACKATHON.** Its first commit is [`7b26248`](https://github.com/seekdaseek/agentfeed-near/commit/7b26248) (2026-10-29 14:22 +02:00). The announcement the window starts from is dated 2026-10-19 (https://x.com/nearprotocol/status/2112257967818997891, read from the live HACKATHON.md on 2026-11-13); the window ends 2026-11-14.
- **It holds no pre-hackathon code.** Every commit here is dated 2026-10-29 or later, so there is no older history to separate and no `pre-hackathon` tag: the baseline of this repository is empty.
- **The prior work is in separate repositories and was left unchanged:** AgentFeed, the product this gateway sits in front of, https://github.com/seekdaseek/agentfeed; and agentfeed-mezo, the same idea for Mezo, whose architecture this repository reuses and none of whose chain code it contains, https://github.com/seekdaseek/agentfeed-mezo.
- **The diff:** every commit, [commits/hackathon-submission](https://github.com/seekdaseek/agentfeed-near/commits/hackathon-submission); everything after the first commit, [compare 7b26248...hackathon-submission](https://github.com/seekdaseek/agentfeed-near/compare/7b26248...hackathon-submission) (a compare view leaves out the first commit's own files; those are in [the first commit](https://github.com/seekdaseek/agentfeed-near/commit/7b26248)). The annotated tag `hackathon-submission` marks the commit that was submitted.

## Judge it in five minutes

1. **See the 402, no wallet.** `curl -i https://near.ochinimus.app/api/sol-price` returns `HTTP/2 402` with a base64 `payment-required` header and the same JSON in the body:
   ```json
   { "x402Version": 2, "error": "payment_required",
     "accepts": [{ "scheme": "exact", "network": "near:testnet", "amount": "10000",
                   "asset": "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af",
                   "payTo": "agentfeed-near-treasury.testnet", "maxTimeoutSeconds": 60 }] }
   ```
2. **See real settlements, no wallet.** Open [`/stats`](https://near.ochinimus.app/stats) and [`/payments.csv`](https://near.ochinimus.app/payments.csv), then click any `tx_url`. The explorer shows a transaction signed by the relayer whose `Delegate` action moves 0.01 to 0.05 USDC from the buyer to the treasury. [`/.well-known/x402`](https://near.ochinimus.app/.well-known/x402) lists the 8 routes.
3. **Re-check the evidence against the chain yourself, no wallet:** `npm install && node scripts/verify-evidence.mjs` re-reads the newest 30 ledger rows from NEAR testnet RPC (a few seconds) and prints `verifiedOnChain`, the treasury balance and whether it equals ledger plus listed extras minus the recorded outflow (`balanceMatches: true` expected). `node scripts/verify-evidence.mjs --all` re-reads every row and every extra from an archival node, which rate-limits: allow several minutes, it may need a rerun. The regular node keeps only a few days, so older rows need `--all`. An older full run: [`evidence/phase2-verify-evidence.txt`](evidence/phase2-verify-evidence.txt).
4. **Run the tests:** `npm install && npm test` (130 tests, no network, including a stock x402 client paying the gateway, the MCP server driven by a real MCP client, and the crash cases). Run on Node 22.23.1 (Mac and the Linux box) and 24.16. `NEAR_LIVE=1 npm test` adds 3 live control tests against testnet.
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
   link  https://testnet.near.rocks/tx/FojDWd9d5k79Noa1CdCSuR4iRyd2XtNGr9iJ58tchM7w
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

Verified by named tests in `test/gateway.test.js` ("crash drill") and by the live drill below.

## Crash drill, live on NEAR testnet

`node scripts/drill.mjs` runs a real `node src/main.js` gateway and kills it with `kill -9` at the dangerous points of one payment, with a pass-through proxy in front of the NEAR RPC that can hold the relayer's broadcast or answer it with the node's own `TIMEOUT_ERROR`. The agent signs **one** payment per scenario and presents the same signed payment again; the USDC balances are read from the chain after each step. Run three times on 2026-10-29, transcripts in `evidence/`:

| run | runtime | result |
|---|---|---|
| [`drill-20261029-node24.txt`](evidence/drill-20261029-node24.txt) | Mac, Node 24.16.0 (darwin/arm64) | 32 of 32 |
| [`drill-20261029-node22-run1.txt`](evidence/drill-20261029-node22-run1.txt) | the VPS, **Node 22.23.1 (linux/x64), the box's runtime** | **29 of 32**: scenario S4 was refused with `invalid_exact_near_payload_delegate_action_timeout_window_exceeds_max_timeout` (no money moved) |
| [`drill-20261029-node22.txt`](evidence/drill-20261029-node22.txt) | the VPS, Node 22.23.1, after the fix below | **32 of 32** |

The failure was real and is kept as found. The `@x402/near` verifier refuses a delegate action whose remaining window is longer than `maxTimeoutSeconds` blocks, and the stock client signs exactly that long from its own view of the chain. Any time the gateway's RPC connection is even one block behind the client's, a good payment looks too long. I could not reproduce a height regression by polling the RPC afterwards (25 fresh-connection reads from the box and from the Mac, no regression), so the skew explanation is a hypothesis; the fix does not depend on it: the gateway now verifies against the advertised window plus `WINDOW_SLACK_BLOCKS` (default 20) and logs the delegate height and its own height if it ever refuses a window again. The advertised `maxTimeoutSeconds` (60) is unchanged. Two new tests pin it (a 65-block window passes, an 85-block window is refused), and setting the slack to 0 makes the first one fail.

| scenario | what the chain showed at the failure | after presenting the same payment again |
|---|---|---|
| S1 `kill -9` while AgentFeed is being fetched | charged 0 | served, charged once |
| S2 `kill -9` after the tx hash and signed bytes are stored, before the broadcast | charged 0; the stored hash is unknown to the chain (real `UNKNOWN_TRANSACTION`) | the stored bytes are sent again, same hash, served, charged once |
| S3 `kill -9` after the broadcast landed, before the reply | charged once, no data delivered | served from the stored hash (`recovered:true`), still charged once |
| S4 node answers `TIMEOUT_ERROR` but the tx landed (gateway alive) | n/a | found by looking the hash up, served in the same request, charged once |
| S5 node answers `TIMEOUT_ERROR`, tx never reached the chain (gateway alive) | n/a | stored bytes sent again, served in the same request, charged once |
| S6 the delivered payment presented again | n/a | `402 payment_replayed`, balances unchanged |

Writing the drill found a real bug in the first design, which only a live node could show: `wait_until: FINAL` on an unknown transaction hash blocks until the node gives up (30 s when first measured, 10 s a few hours later on the same endpoint) and ends in `TIMEOUT_ERROR`, so "the chain never saw it" looked like "still pending" and the resend could never trigger. Lookups now use `wait_until: NONE`, which answers `UNKNOWN_TRANSACTION` in about 0.2 s. The gateway also stores the exact signed relayer transaction with its hash, so a restart can send identical bytes (same hash: the chain can execute them at most once).

## Control: the same purchase the old way

`node scripts/control-old-way.mjs` (transcript [`evidence/control-20261029.txt`](evidence/control-20261029.txt); live tests `NEAR_LIVE=1 npm test`):

- **(a) Old way, no gas.** A plain NEAR account that holds 0.05 USDC and 0.0025 NEAR (0.00182 of it locked for storage) signs `ft_transfer` itself. The network refuses it at validation: `NotEnoughBalance: Sender 94ef19a8…8668b4 does not have enough balance 0.0025 for operation costing 0.030919383768607000000001` (a call reserves its full 30 Tgas up front). Nothing is recorded, so a refusal has no explorer link.
- **(b) Our way.** The same account pays this gateway with one delegate action: HTTP 200, USDC down by exactly 0.01, **NEAR balance unchanged at 0.0025**.
- **(c) Old way, funded.** The buyer account, which holds NEAR, signs the same `ft_transfer` and it works, burning 0.000263 NEAR in gas. So the control is fair: the old way works if you hold NEAR.

What the control does not cover: the old way also needs an account or key at every API; there is no equivalent to run here, so that part is argued, not measured.

## Results and the daily batch

[`docs/RESULTS.md`](docs/RESULTS.md) is written by `node scripts/results.mjs` from the public ledger: counts by route and day, payer accounts (and how many are independent of the builder: **0**), latency percentiles, a chain check of every row, treasury reconciliation, and the number that makes this project look bad, with the comparison against the same product on Mezo.

A cron entry on the VPS buys two rounds of the 8 routes (16 calls, 0.32 USDC) every day at 08:12 UTC from the buyer account (`flock`, `timeout 900`, its own log), so the ledger keeps growing for the judging window. It settled 16 calls on each day from 2026-10-30 to 2026-11-10; on 2026-11-11 the buyer ran out of USDC after 7 calls, and on 2026-11-12 it settled nothing. The treasury refilled the buyer on 2026-11-13 (one hand-run batch and the 08:12 batch, 32 calls that day).

**Record rule:** every USDC transfer out of the treasury (the recycle to the buyer) is listed in [`evidence/treasury-outflows.csv`](evidence/treasury-outflows.csv), checked against the chain by `scripts/verify-evidence.mjs`, and subtracted when the treasury balance is reconciled.

## Discovery, second client library, submission pack

- [`docs/DISCOVERY.md`](docs/DISCOVERY.md): who else does x402 on NEAR (field search), where agents discover paid APIs, what was listed (Ultravioleta Bazaar, 8 routes; 402index rejected NEAR) and what needs the owner. The gateway also serves [`/openapi.json`](https://near.ochinimus.app/openapi.json) (OpenAPI 3.1 with `x-payment-info`) and [`/llms.txt`](https://near.ochinimus.app/llms.txt).
- A second independent client library pays the gateway unmodified: `npm install --no-save @fastnear/x402 && AGENT_ACCOUNT_ID=you.testnet node scripts/fastnear-client.mjs` ([`evidence/fastnear-client-20261029.txt`](evidence/fastnear-client-20261029.txt)).
- [`docs/SUBMISSION.md`](docs/SUBMISSION.md) (idea text, payload rules, evidence map, owner-only steps), [`docs/VIDEO.md`](docs/VIDEO.md) (shot list), `scripts/check-submission.mjs` (validates the payload, never sends it).

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

Node.js 22+ (gateway running on 22.23.1 on the VPS; the test suite has been run on 24.16 only), `@x402/near` 2.28.0, `@near-js/*` 2.5.1, better-sqlite3, `@modelcontextprotocol/sdk`, zod.

Written with AI coding assistance, as the rules allow (Q-005).

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

Optional: `PORT`, `HOST`, `NEAR_RPC_URL`, `USDC_ACCOUNT_ID`, `UPSTREAM_URL`, `UPSTREAM_PREFIX` (use `/api/sample` for the free sample data, no key), `DB_PATH`, `MAX_TIMEOUT_SECONDS`, `WINDOW_SLACK_BLOCKS`, `SETTLE_WAIT_MS`, `DAILY_UPSTREAM_CAP` (defaults in [`src/config.js`](src/config.js)).

## Honest limits

- Testnet only. All payments in this repo's ledger come from the builder's own accounts; there is no independent NEAR customer (`docs/RESULTS.md` counts independent payers: 0).
- Settle latency to `FINAL` is 4.1 to 4.7 s per call on testnet (8 live calls), 5.3 to 6.6 s end to end when AgentFeed answers fast; the data fetch and the settlement run one after the other by design (fetch before settle), and one relayer key means settlements are serialised. One call took 13.2 s because AgentFeed's `liq-pulse` took 8.1 s that time.
- A function-call access key cannot pay (the verifier refuses it); the payer needs a full-access key.
- The sample upstream (`/api/sample`) returns a stub, not live data; the deployed gateway uses a prepaid key and returns live data.

## Known advisories

`npm audit` on 2026-10-29 reported two findings. One is fixed, one has no patched release.

- **zod, GHSA-mrhx-c7xc-m3w5 (CVE-2023-54404, high), fixed.** `@x402/core` 2.28.0 pins `zod ^3.24.2` (3.25.76 installed), and the advisory affects `< 4.6.6`. `package.json` carries `"overrides": { "@x402/core": { "zod": "4.6.7" } }`, so every zod in the tree is now 4.6.7 (`npm ls zod`). All 61 tests pass on it, including the stock `@x402/fetch` / `@x402/core` client driving the gateway. This is an override of a pinned range, which the `@x402/core` maintainers have not tested; if `@x402/core` ever misbehaves on zod 4, this line is the first suspect.
- **elliptic, GHSA-848j-6mx2-7j84 (CVE-2025-14505, low), documented only.** Vulnerable range `<= 6.6.1`; **no patched version exists** (6.6.1 is the latest release on npm, last published 2024-11-13). It enters through `@near-js/crypto` -> `secp256k1` -> `elliptic`. The flaw is in secp256k1 ECDSA signing (a truncated nonce `k`); this repo signs only with ed25519 keys and never calls a secp256k1 path. `npm audit` still lists 8 low findings, all the same chain (`@near-js/*`, `@x402/near`, `secp256k1`, `elliptic`); its suggested "fixes" downgrade `@near-js/*` to 1.x, which `@x402/near` does not accept.

## License

MIT, see [LICENSE](LICENSE).
