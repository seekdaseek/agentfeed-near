# Field search and discovery

Written 2026-10-29. Goal: find out who else builds x402 on NEAR, where NEAR agents and x402 clients discover paid APIs, and get agentfeed-near listed wherever that is free and needs no account. Everything marked **verified** was read from the source or run; everything else says so. Limits: the web search tool is a general one, so absence from the results is weak evidence, and hackathon submissions are not public before the window.

## 1. Who else is doing x402 on NEAR

| project | what it is | what I verified | relation to this repo |
|---|---|---|---|
| [`@x402/near`](https://www.npmjs.com/package/@x402/near) (x402 foundation) | client, resource-server and facilitator schemes for `exact` on NEAR | read the source (2.28.0); 2.29.0 published 2026-10-28 | the library this repo builds on |
| [fastnear/x402-facilitator](https://github.com/fastnear/x402-facilitator) | production Rust facilitator for NEAR and Base, hosted reference instances behind manually approved credentials | read `mechanism.rs`, `types.rs`, the access docs; its merchant discovery catalog `docs/catalog/resources.json` is **empty** (0 entries) and its operator's own demos are ineligible by rule | we run our own relayer instead of depending on it |
| [`@fastnear/x402`](https://js.fastnear.com/x402) 2.5.0 | adapters over `@x402/near` for browser wallets, a Node local-key payer, resource servers, facilitators | **ran its Node payer against the live gateway: HTTP 200, settled**, `evidence/fastnear-client-20261029.txt`, `scripts/fastnear-client.mjs` | a second, independent client library that pays us unmodified |
| [r-near/x402-near-demo](https://github.com/r-near/x402-near-demo) | testnet demo, three small files | read all of it; it uses a custom scheme name (`near-delegate-exact`), not the x402 v2 `exact` wire format | different wire format; no data behind it, no ledger |
| [`r402-near`](https://docs.rs/crate/r402-near/latest) 0.21.0 (repo qntx/r402) | Rust crate, "NEAR chain support for the x402 payment protocol" | read the crates.io page only: it names the crate and its maintainer, nothing about discovery | a Rust implementation of the same scheme; not tested here |
| [Kampouse/near-pay](https://github.com/Kampouse/near-pay) | Rust crate and CLI for agents paying 402s; signs Solana payments through NEAR chain signatures, cross-chain sends through NEAR Intents | read the README: it is a **payer**, its x402 payments settle on Solana, no live deployment described, 3 stars | complementary (a client), not a NEAR-settled seller |
| Ultravioleta DAO facilitator | multi-chain facilitator | read its live `/supported`: lists `near` and `near-testnet`, scheme `exact`, x402 v1 and v2 | also a discovery surface, see below |
| `ironflip.duckdns.org` | a search result describing a NEAR-based gateway with x402 endpoints | **could not reach it** (connection refused); the snippet says payments are proven by Solana or Base transactions, i.e. not NEAR settlement | unverified, not counted |

No other hackathon entry for x402 on NEAR turned up. That is weak evidence only (see the limits above).

**Our angle, without claims about unseen entries:** a live API that already sells to strangers on Solana and Base, now sold on NEAR through a separate gateway that (a) a stock x402 NEAR client and a second independent client library both pay unmodified, (b) is charged-once-or-not-at-all under `kill -9` at four points (live drill, 32 of 32 on Node 22 on the box), (c) is audited by a script that re-reads every ledger row from the chain, and (d) says openly that every payment so far came from our own accounts.

## 2. Where agents and clients discover paid x402 APIs, and what each needs

| surface | what it is | needs an account, a post or a form? | NEAR support | status |
|---|---|---|---|---|
| **Ultravioleta Bazaar** (`POST /discovery/register`) | curated catalog on the facilitator that supports `near:testnet`; its prober reads each URL afterwards | **no** account, no key (rate limit about 5 a minute) | **yes, `near:testnet` is in its `/supported`** | **registered 2026-10-29: all 8 routes, HTTP 201**. Read back from `GET /discovery/resources?q=near.ochinimus`: 2 of 8 exposed so far (`/api/sol-price` and `/api/summarize`, `status: alive`, `verifiedBy: x402_challenge`, `ownership: unattested`); its prober exposes a few listings per tick, so the other 6 should follow; re-check with `curl 'https://facilitator.ultravioletadao.xyz/discovery/resources?q=near.ochinimus&limit=100'` |
| **402index** (`POST /api/v1/register`) | directory that probes the URL and reviews entries | no account | **no**: its verifier answered `422 x402 verification failed: invalid payment requirements`, `assetKnown:false`, `valid:false` for our 402 | **rejected**. I did not alter the requirements to get past it; one attempt, one re-read of the full answer, stopped |
| x402scan (via `agentcash register`) | explorer of x402 resources | no account for the CLI (used for AgentFeed before) | **no**: `@agentcash/discovery` 1.7.5 knows `solana` and `eip155` ids, nothing for `near` (grep of the package) | not attempted: it could not list a NEAR network |
| x402scout (`POST x402scout.com/register`) | free self-registration catalog | no account | its docs show only `network: base-mainnet` | not attempted: listing a NEAR testnet service under a mainnet-only schema would mislabel it |
| Coinbase CDP Bazaar | automatic, for resources settled through the CDP facilitator | n/a | our payments never touch CDP | not applicable |
| **fastnear facilitator catalog** (`/discovery/resources`) | opt-in catalog of independent merchants on the reference facilitators; currently **empty** | **yes: a GitHub issue (access request) and a PR** from the owner's account | NEAR and Base | **needs the owner**, draft in section 3 |
| x402 ecosystem page, awesome-x402 and similar lists | curated lists | a pull request from the owner's GitHub | n/a | **needs the owner**. The `x402.org/ecosystem` URL I tried returned 404, so the procedure is not verified |
| Official MCP Registry, Smithery, mcp.so, PulseMCP | MCP server indexes | GitHub login and an npm package (our MCP server is a local stdio server holding a payer key; it is not published) | n/a | **needs the owner** (npm publish and `mcp-publisher login github`) |
| Glama and other crawlers of public GitHub repos | automatic | none, but the repo must be public | n/a | after the public flip on Nov 13, nothing to do |
| NEAR AI Agent Market (`market.near.ai`) | marketplace where agents bid on tasks, paid in NEAR | an account on the market; its `skill.md` page returned no registration steps to me | n/a | **needs the owner**; fit unclear (it sells tasks, not per-call data) |
| nearcatalog, NEAR ecosystem pages, awesome-near | project directories | forms or pull requests | n/a | **needs the owner**; not researched in detail |
| The X post | the hackathon requires it | the owner posts | n/a | **owner** |

## 3. Drafts for what only the owner can do (nothing here has been sent or posted)

**A. fastnear catalog access request** (GitHub issue on `fastnear/x402-facilitator`, template `access_request.yml`; their rules: an independently operated resource-server URL and payee, no credentials in the issue, public evidence tying the payee to the operator, a listing is not a claim of activity):

> Network: `near:testnet`. Resource server: https://near.ochinimus.app (public HTTPS, canonical unpaid 402 on every `GET /api/<route>`, OpenAPI at `/openapi.json` with `x-payment-info`, manifest at `/.well-known/x402`). Payee (USDC recipient): `agentfeed-near-treasury.testnet`, controlled by the operator; evidence: the ledger at `/payments.csv` and `scripts/verify-evidence.mjs` in https://github.com/seekdaseek/agentfeed-near show it receiving every settlement. We run our own relayer and do not use the hosted facilitator for settlement; we are asking only for catalog listing and a zero-budget credential for the private `/verify` read. Expected load: a few calls a day. Honest status: every payment so far is from our own buyer accounts; no independent payer yet.

(The repository must be public before this links to it; the public flip is planned for Nov 13, so the issue is best opened after that. The catalog admission needs `declareDiscoveryExtension` output for each route, which this gateway does not emit yet: a follow-up if the owner wants this listing.)

**B. A line for awesome-x402 and the x402 ecosystem list:** `agentfeed-near: pay-per-call crypto market data for agents on NEAR testnet (x402 v2 exact, NEP-366 delegate actions, relayer pays gas). https://near.ochinimus.app, https://github.com/seekdaseek/agentfeed-near`.

**C. MCP registries:** needs `npm publish` of an `agentfeed-near` package (the stdio server in `src/mcp.js`) and `mcp-publisher login github` under the owner's account. I recommend not doing this before the window ends: the server needs a payer key, so it is a developer tool, not a hosted service an agent can add with one click.

## 4. What I would NOT do to get "payers who are not us"

- Fund strangers' accounts or run a faucet and then count their calls: those payers would be ours in everything but name. If it is ever done as a courtesy, it must be disclosed and excluded from `docs/RESULTS.md` (`evidence/own-accounts.txt` is the mechanism).
- Retry 402index with a doctored challenge, or list a testnet service in a mainnet-only schema.
- Seed payers from our own batch (the daily cron is labelled as ours and counted as ours).

What is honestly available: make the endpoint easy for the people who will actually test NEAR x402 clients (the authors and users of `@x402/near`, `@fastnear/x402`, `r402-near`): a live server that answers a correct 402 and settles, with a faucet link and a `storage_deposit` command in `/llms.txt` and the README. The first independent payer, if one comes, will be someone testing a client, not a buyer of market data, and the ledger will show it as an account not in `evidence/own-accounts.txt`.

## 5. Changes made to the gateway because of this search

- `/openapi.json` (OpenAPI 3.1, `x-payment-info` on every route) and `/llms.txt`, both saying NEAR TESTNET in the first lines.
- An unpaid request now always gets the 402, even for `/api/summarize` without `?url=` (it answered 400 before, so a prober never saw it as a paid route). A request that carries a payment but misses the parameter still gets a 400 before anything is verified or charged. Two tests pin both.
- `scripts/list-directories.mjs` (dry-run by default) does the two self-service registrations.
