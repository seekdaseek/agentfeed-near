# Results

_Written by `scripts/results.mjs` on 2026-10-29T14:13:02.833Z from https://near.ochinimus.app/payments.csv (commit d28ec6a). Do not edit by hand; run the script again._

**43 paid calls and 0.76 USDC settled on NEAR testnet through the deployed gateway; 43 of 43 re-read from the chain and verified. 0 of 2 payer accounts are independent of the builder: every call was bought by our own accounts.**

## What is counted

- Window: 2026-10-29T12:41:34.000Z to 2026-10-29T14:12:42.000Z (UTC). Source: the gateway ledger, rows in state `delivered` (data handed over) or `settled`.
- Calls: 43. USDC: 0.760000. Distinct payer accounts: 2; independent of the builder (not in `evidence/own-accounts.txt`): **0**.
- Payments in any other state (`/stats` `by_state`): none.

| payer | calls | USDC | whose |
|---|---|---|---|
| `94ef19a8ac…8668b4` | 8 | 0.090000 | ours |
| `agentfeed-near-buyer.testnet` | 35 | 0.670000 | ours |

### By route

| route | calls | USDC | settle p50 |
|---|---|---|---|
| btc-price | 6 | 0.060000 | 4.6 s |
| funding-pulse | 5 | 0.050000 | 4.3 s |
| liq-pulse | 4 | 0.040000 | 4.3 s |
| liquidations | 5 | 0.100000 | 4.5 s |
| market-snapshot | 4 | 0.080000 | 4.4 s |
| sol-price | 11 | 0.110000 | 4.4 s |
| summarize | 4 | 0.200000 | 4.5 s |
| trade-context | 4 | 0.120000 | 4.4 s |

### By day (UTC)

| day | calls | USDC |
|---|---|---|
| 2026-10-29 | 43 | 0.760000 |

## Chain check

Every ledger row was looked up by transaction hash on NEAR testnet RPC (`https://rpc.testnet.fastnear.com`) by the same code as `scripts/verify-evidence.mjs`: the relayer `agentfeed-near-relayer.testnet` signed it, it is FINAL, it wraps one Delegate action from the payer with one `ft_transfer` (1 yocto) on the USDC contract, every receipt succeeded, and the token logged an `ft_transfer` event payer to treasury for the ledger amount.

- Ledger rows verified: **43 of 43**. Ledger total 0.760000 USDC.
- Transfers into the treasury that are not in the deployed ledger (the Phase 1 proof, a local rehearsal, the live drill; listed in `evidence/known-extra-transfers.csv`): 22 listed, 22 verified the same way, 0.230000 USDC.
- Treasury `agentfeed-near-treasury.testnet` USDC balance: **0.990000**. Ledger plus listed extras: 0.990000. **They match exactly.**

## Latency

Server-side timings from the ledger (`settle_ms` runs from the relayer broadcast to `FINAL`; `upstream_ms` is the AgentFeed fetch; `total_ms` is the whole paid request inside the gateway; "gateway-only" is total minus upstream).

| | n | p50 | p90 | max |
|---|---|---|---|---|
| settle (broadcast to FINAL) | 43 | 4.4 s | 4.6 s | 5.1 s |
| AgentFeed fetch | 43 | 0.5 s | 1.5 s | 9.3 s |
| gateway-only (total minus fetch) | 43 | 5.1 s | 5.3 s | 5.8 s |
| whole paid request | 43 | 5.5 s | 6.6 s | 14.3 s |

## The number that makes us look bad

**Settlement is about 87% of the gateway's own time on a typical call (median settle share of gateway-only time), and the gateway-only time is 5.1 s at the median, 5.3 s at p90.** AgentFeed itself answers in 0.5 s at the median. A cent-priced data call therefore spends most of its time waiting for a blockchain.

Against the same product on Mezo (`evidence/mezo-latency.json`, measured 2026-10-29 from a read-only copy of that gateway's ledger):

| | n | gateway-only p50 | gateway-only p90 | gateway-only max |
|---|---|---|---|---|
| agentfeed-near (this ledger, gasless for the agent) | 43 | 5.1 s | 5.3 s | 5.8 s |
| agentfeed-mezo, permit scheme (gasless for the agent) | 58 | 6.2 s | 14.3 s | 26.9 s |
| agentfeed-mezo, transfer scheme (agent paid its own gas first) | 9 | 0.6 s | 3.8 s | 3.8 s |

Reading it honestly: against the like-for-like Mezo gasless path (permit scheme) the NEAR gateway is not slower at the median. The real cost shows against a payment the agent has already settled itself (Mezo's transfer scheme, 0.6 s inside the gateway at the median): the gasless convenience moves the 4.4 s of settlement (broadcast to FINAL, median) from "before the request" into the request. That is a trade, not a free lunch: the agent never holds NEAR or manages gas, and it pays for that with latency per call. What the ledger cannot show is how the broadcast-to-FINAL time splits between inclusion and finality; the code waits for FINAL because the ledger must never count a payment that can still be reorged. Serial design adds to it: data is fetched first, then the payment settles (so an outage never charges), and one relayer key serialises settlements.

The other number that looks bad, stated plainly: **independent payers = 0.** Every payment on NEAR in this ledger was made by an account the builder controls (`evidence/own-accounts.txt`). AgentFeed's separate mainnet history is not part of this file.

## Regenerate

```sh
node scripts/results.mjs            # fetches the ledger and re-reads every row from NEAR testnet RPC
```
