**Phase 3 (2026-10-29): 39 paid calls and 0.71 USDC settled on NEAR testnet through the deployed gateway at https://near.ochinimus.app, all from our own accounts (0 independent payers); 39 of 39 re-read from the chain, treasury reconciles exactly (`docs/RESULTS.md`, written by `scripts/results.mjs`).** A daily batch cron keeps the count growing.

# NEAR HACKATHON, track `agents`: submission checklist

Project: **agentfeed-near**. Repo: https://github.com/seekdaseek/agentfeed-near (private until the owner flips it). Live: https://near.ochinimus.app (deployed 2026-10-29). MIT. Second entry of the same builder, named as the rules require: **StakeStreak on NEAR** (track `social`, separate repo).

Status words below: DONE (exists and was run), PLANNED (phase named), OWNER (needs the owner).

## 1. Rubric

There is no formal rubric. Event rules (nearhackathon.com/HACKATHON.md, read 2026-10-29): AI screening by Claude Code and Codex for reproducibility and feature verification, humans decide. So every claim below is tied to a command or a named test.

Track sentence: "Agents that earn, spend, negotiate, hire other agents, and pay for APIs, compute, or data, using crypto directly or through NEAR Intents."

| part of the sentence | what this project does | scene / named tests |
|---|---|---|
| pay for data, crypto directly | an agent buys AgentFeed market data per call in USDC on NEAR | DONE: `scripts/prove-settle.mjs` (one real call, explorer link); tests "is verified, the data is fetched, the relayer settles..." and `test/interop.test.js` (a stock x402 client pays us) |
| spend (unattended) | the agent client refuses a challenge for another network, token, scheme or a price over its cap | DONE: `test/client.test.js`. The gateway refuses 15 kinds of bad payment before touching AgentFeed or spending gas (`test/gateway.test.js`, "refusals never reach AgentFeed...") |
| earn | the gateway earns USDC into a treasury account per call | DONE: treasury balance equals the ledger, re-read from chain by `scripts/verify-evidence.mjs` (DONE: 10 of 10 rows and the treasury balance, `evidence/phase2-verify-evidence.txt`) |
| negotiate, hire other agents | not done. We do not claim these. | none |
| NEAR Intents | OUT: Intents has no testnet and this entry is testnet only | none |

## 2. Sponsor primitives, by name

- **NEP-141** fungible token: Circle USDC on NEAR testnet, `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af`, 6 decimals; `ft_transfer`, `ft_balance_of`, and the `ft_transfer` NEP-141 event our ledger check reads.
- **NEP-366 delegate actions (meta transactions)**: the agent signs one delegate action carrying one `ft_transfer` (1 yocto, 30 Tgas); the gateway's relayer wraps it in a transaction and pays the gas.
- **NEP-145 `storage_deposit`**: the treasury is registered on the token (tx `HgTW6xktB7MKCymZkxbH1kehQxyGF7SQXFDUs235DV89`); the verifier refuses a payment to an unregistered payee.
- **x402 `exact` scheme on `near:testnet`**, x402 v2 wire format as defined by `@x402/near` (the x402 foundation package) and `fastnear/x402-facilitator`: `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE` and `PAYMENT-RESPONSE` headers, payload `{ signedDelegateAction }`.
- **Libraries**: `@x402/near` 2.28.0 (client and facilitator schemes), `@near-js/{providers,signers,transactions,utils,crypto}` 2.5.1. (`near-api-js` is not used directly; `@near-js/*` are its parts.) `near-cli-rs` 0.30.1 for account setup.
- **Why NEAR, one sentence:** the agent signs one delegate action off-chain and the gateway relays it and pays the gas, so an agent needs USDC only, no NEAR, no gas management, and no account at the API.

## 3. Action (what a judge does)

- **No wallet (DONE, deployed):** `curl -i https://near.ochinimus.app/api/sol-price` shows the 402 and its `payment-required` header; `/stats`, `/payments.csv` and any explorer link need nothing. `npm test` needs no network.
- **With a testnet account (command exists, DONE locally):** `AGENT_ACCOUNT_ID=you.testnet node src/client.js sol-price --pretty` pays one call. Expected output is pasted in the README under "Judge it in five minutes" and in `evidence/phase1-prove-settle.txt`.
- `scripts/prove-settle.mjs` is the maintainer's proof (it reads the maintainer's own credential files) and is not the judge path; the judge path is the client command above with the judge's own funded testnet account (USDC from the Circle faucet, one click).

## 4. Evidence

Headline (one line, count and money): **settled calls and USDC on NEAR testnet, counted by `docs/RESULTS.md` from the ledger** (written by `scripts/results.mjs`, PLANNED Phase 3). Phase 2 count (deployed gateway): 10 calls, 0.18 USDC. Four earlier calls (0.05 USDC) went through the Phase 1 proof and a local rehearsal gateway; they are real and chain-verified but outside the deployed ledger, listed in `evidence/known-extra-transfers.csv` and counted separately by `verify-evidence`.

NEAR payments in the window come from **our own buyer account** `agentfeed-near-buyer.testnet` (the Phase 1 proof call came from `iussum-near-principal.testnet`, a testnet account the owner holds from a sibling project, which also funded the buyer with 5 USDC). The README says so plainly; nothing here is an independent customer.

AgentFeed's existing traction, quoted only after excluding our wallets. Method and numbers, read 2026-10-29 from `/opt/agentfeed/agentfeed.db` (`calls`, `status = 'paid'`, read-only through the solwatch MCP and one read-only `sed` of `ops/af-digest.js`):

| | wallets | paid calls | USDC |
|---|---|---|---|
| all payer wallets, all time (Solana, Base, other rails) | 238 | 1,586 | 11.35 |
| ours, excluded: the five in `OWN_WALLETS` (`ops/af-digest.js`: Gack9..., TeStKW..., EqRNNp..., 0xFEfF..., 0x05b3...) plus the older demo payer `GBFoGJ...` and our treasuries / test wallet if they ever paid (cj7, 6e6, natX; none of the last three appear) | 6 | 326 | 3.29 |
| **remainder** | **232** | **1,259** | **8.06** |

Of the 232: 176 paid exactly once, 34 twice, 22 three times or more. Earlier on-chain profiling of this ledger (Oct 8) found that several of the biggest remaining wallets are **catalog sweepers** (they pay one to three calls to each of hundreds of x402 services) and one is a benchmarker; one repeat buyer is real. So the README may say "232 wallets other than ours have paid AgentFeed, mostly one-off probes" and must not say "customers" or "users". Nothing about AgentFeed's mainnet traffic is a NEAR result and the README keeps the two apart.

## 5. Field (searched 2026-10-29; to be repeated in Phase 4)

- `r-near/x402-near-demo`: testnet demo, custom scheme name, three small files, no replay ledger, no data behind it.
- `fastnear/x402-facilitator`: production-grade Rust facilitator for NEAR and Base, Circle USDC, reference deployments gated by manual approval. A facilitator, not an API that sells anything.
- `@x402/near` (x402 foundation): client, server and facilitator schemes; the library we build on.
- near-pay and others: PLANNED, search in Phase 4 and list what is found, including entries we cannot beat.

Our angle, stated without comparison to unseen entries: a live API that already sells on Solana and Base now sells on NEAR through a separate gateway, with a ledger that survives a crash between data and settlement (charged once or not at all), a verifier that re-reads every settlement from the chain, and a stock x402 client that pays it unmodified.

## 6. Format

README with the headline line first (DONE as skeleton), LICENSE MIT (DONE), demo video per `docs/VIDEO.md` (PLANNED Phase 4), idea text 20 to 2000 characters (PLANNED Phase 4, in `docs/SUBMISSION.md`), `consent: true` and form fields (OWNER, Nov 13).

## 7. Liveness

`near.ochinimus.app` up through Nov 25 (results Nov 18): PM2 `agentfeed-near` (port 3041, `--max-old-space-size=96`, `--max-memory-restart 150M`) and `agentfeed-near-tunnel`, saved in the PM2 dump. DONE 2026-10-29. Daily buyer batch (PLANNED Phase 3) on a cron keeps the count growing (Phase 3). Check: `curl https://near.ochinimus.app/health` (200 observed). Restart procedure: `pm2 delete` then `pm2 start` then `pm2 save`, never `pm2 restart`.

## 8. Social

X post with demo video required; the owner posts it. A draft goes in `docs/SUBMISSION.md` (Phase 4). OWNER.

## 9. Fit

Track `agents`. AgentFeed is literally what the track sentence says agents pay for: data over an API, per call, with crypto. This project's contribution is the NEAR rail: gasless for the agent, verified and settled by us.

## 10. Control

DONE. `scripts/control-old-way.mjs` (transcript `evidence/control-20261029.txt`; the three named live tests are in `test/control.test.js`, run with `NEAR_LIVE=1 npm test`, 3 of 3 pass): (a) an implicit account holding 0.05 USDC and 0.0025 NEAR (0.00182 locked for storage) signs a plain `ft_transfer` and the network refuses it (`NotEnoughBalance ... operation costing 0.0309 NEAR`, a call reserves its full 30 Tgas), test "control: an account holding USDC and almost no NEAR cannot pay the old way"; (b) the same account pays the gateway with a delegate action, HTTP 200, USDC down by exactly the price, NEAR balance unchanged at 0.0025, test "control: the same account pays through the gateway and its NEAR balance does not change"; (c) a funded account's direct `ft_transfer` works and burns 0.000263 NEAR, test **"control: a funded account can pay the old way"**. Not covered: the per-API account or key the old way also needs; that part is argued, not measured.

## 11. Gates

None paid. Testnet USDC: the principal account holds 20 USDC less what the batch spends. The batch's spend stays in the treasury, which is ours, so USDC is recycled to the buyer by an `ft_transfer` from the treasury; running out is not a risk. If more is ever needed: Circle faucet (a reCAPTCHA click by the owner). NEAR for gas: relayer and treasury were funded 10 NEAR each by the testnet faucet service; each paid call costs the relayer about 0.00033 NEAR.

## 12. Repo artifacts

| artifact | state |
|---|---|
| one-command demo with expected output | DONE: `node src/client.js <route> --pretty`, `scripts/stock-client.mjs`, `scripts/prove-settle.mjs`; output in the README |
| `docs/RESULTS.md` written by a script | DONE: `node scripts/results.mjs` (re-reads every row from NEAR RPC while writing) |
| one number that makes us look bad, with diagnosis | DONE in `docs/RESULTS.md`: settlement is about 86% of the gateway's own time on a call (5.0 s median gateway-only, 4.3 s of it broadcast-to-FINAL), against Mezo's transfer scheme at 0.6 s where the agent had already paid; versus Mezo's gasless permit path (6.2 s median, 14.3 s p90, 58 calls) NEAR is not slower. Also stated: independent payers = 0. |
| drill: kill the gateway between data fetch and settlement, agent charged once or not at all | DONE live: `node scripts/drill.mjs`, 32 of 32 checks, `evidence/drill-20261029.txt` (S1 to S6 in the README) |
| `docs/FEEDBACK.md` on NEAR x402 tooling | DONE as a living file: 11 findings |
| `docs/SUBMISSION.md` evidence map | PLANNED Phase 4 |
| `docs/VIDEO.md` shot list | PLANNED Phase 4 |

## What is NOT done at the end of Phase 3

`docs/SUBMISSION.md`, `docs/VIDEO.md`, the field search for other entries, the fresh-clone judge run, gitleaks on the final tree, the idea text. The 08:12 UTC cron slot has not fired yet. Nothing here is claimed done that was not run.
