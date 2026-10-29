# Demo video: shot list

Length target 2:45 to 3:00. The rules need the video on the owner's public X post (screenshots are not enough when judges cannot open the demo, Q-012). Every command below was run for real while writing this file; the expected output shows its shape, not numbers to read out (numbers drift, `docs/RESULTS.md` is the source).

## Before recording

- Use a fresh terminal, font 18 pt or larger, dark theme, window about 110 columns. Show only these commands; never `cat` an `.env`, never list `~/.near-credentials`. The payer is addressed by account id only: `export AGENT_ACCOUNT_ID=agentfeed-near-buyer.testnet`.
- Open these tabs first: the README top, `https://near.ochinimus.app/stats`, the explorer. In the browser, a tx page loads slowly the first time; open the one you will show beforehand.
- Run the paid shots once as a rehearsal (each paid call is 0.01 to 0.05 testnet USDC; the buyer holds a few USDC, check `node -e` balance or `/stats`).
- **Anything that sends USDC to the treasury outside the gateway ledger must run with `--record`** (`node scripts/drill.mjs --record S3`), otherwise `verify-evidence` will report an unlisted transfer. Calls made through the gateway are in the ledger automatically. The drill writes `evidence/drill-<date>-node<major>.txt`; on the same day and Node major it would overwrite an existing transcript, so record on a different day or move the old file first.
- Do not say a number you did not just see. Read counts off the screen.

## Shots

| # | time | on screen | do / type | say |
|---|---|---|---|---|
| 1 | 0:00-0:15 | README headline, then the repo name | scroll slowly | "AI agents that buy data per call and pay in USDC on NEAR, and need no NEAR. Built at NEAR HACKATHON for the agents track." |
| 2 | 0:15-0:35 | terminal | `curl -i https://near.ochinimus.app/api/sol-price` | "A call without payment answers 402, x402 version 2, scheme exact, network near testnet, the USDC contract and the payee. That header is all an agent needs." Show `HTTP/2 402` and the `payment-required` line, then the JSON `accepts`. |
| 3 | 0:35-1:05 | terminal, then explorer | `node src/client.js liquidations symbol=SOL limit=3 --pretty` | "The agent signs one delegate action, no gas, and retries. The data comes back with the settlement transaction." Click the `link`: point at the relayer as signer, the Delegate action, the inner `ft_transfer`, the USDC event. "The agent never touched NEAR for gas: the gateway's relayer paid it." |
| 4 | 1:05-1:30 | terminal | `node scripts/stock-client.mjs https://near.ochinimus.app/api/btc-price` then `node scripts/fastnear-client.mjs` (needs `npm install --no-save @fastnear/x402` done before) | "Two different client libraries, the x402 foundation's and FastNEAR's, pay this gateway without any change on their side." |
| 5 | 1:30-2:00 | terminal | `node scripts/drill.mjs --record S3` (about 40 s; speed it up 2x if needed) | "Now the dangerous moment: I kill the gateway with kill minus nine after the payment landed on the chain and before the data went out. The chain shows the agent has paid. I present the same signed payment again: it gets the data, and the balance moved exactly once." Point at the lines `chain at the kill: charged once` and `total effect on the chain: charged once`. |
| 6 | 2:00-2:20 | terminal | `node scripts/control-old-way.mjs` | "The old way: an account with USDC and almost no NEAR cannot even send the transfer, the network refuses it. The same account pays our gateway and its NEAR balance does not change. A funded account can pay the old way, so the comparison is fair." |
| 7 | 2:20-2:45 | terminal, then `docs/RESULTS.md` | `node scripts/verify-evidence.mjs` then open `docs/RESULTS.md` headline and the latency table | "Every ledger row is re-read from the chain by a script that does not use the gateway's code: all verified, the treasury balance matches. And the honest part: the payers are all our own accounts, zero independent payers, and settlement is most of each call's time." |
| 8 | 2:45-3:00 | README, repo URL | none | "Testnet only. AgentFeed already sells on Solana and Base; only this NEAR integration was built in the window. Code is MIT, written with Claude Code. It is one of two entries from the same builder, the other is StakeStreak on NEAR. Link below." |

## Expected output shapes

- Shot 2: `HTTP/2 402`, a base64 `payment-required: eyJ4NDAy...`, JSON with `"scheme": "exact"`, `"network": "near:testnet"`, `"amount": "10000"` (0.01 USDC), `"payTo": "agentfeed-near-treasury.testnet"`, `"maxTimeoutSeconds": 60`.
- Shot 3: `paid  status 200  ~6 s  0.02 USDC`, then `tx <hash>` and `link https://explorer.testnet.near.org/transactions/<hash>`.
- Shot 5: `S3  kill -9 after the broadcast landed ...`, then `PASS  chain at the kill: charged once (the agent has paid and has no data)`, `PASS  same signed payment, presented again: HTTP 200 with data`, `PASS  total effect on the chain: charged once`, and a closing `# N of N checks passed` (a single scenario is 7 checks).
- Shot 6: `PASS  refused by the network: NotEnoughBalance: ... does not have enough balance 0.0025 for operation costing 0.03...`, `PASS  NEAR balance unchanged: 0.002500 -> 0.002500`, `PASS  succeeded, tx ...`.
- Shot 7: `"verifiedOnChain": N` equal to `"rows": N`, `"failed": 0`, `"balanceMatches": true`.

## If something fails while recording

- A paid call answers 402 `payment_in_flight` or `settlement_pending`: wait 5 seconds and run it again; it was never charged twice (that is the point of shot 5).
- The explorer is slow: show `https://near.ochinimus.app/payments.csv` rows instead, each row is a transaction.
- The buyer is out of USDC: the owner sends USDC from the treasury (`ft_transfer` signed with the treasury key) or from `iussum-near-principal.testnet`; the treasury is the builder's own account.
- The drill fails to start: it needs `~/.near-credentials` for the relayer and buyer on the Mac; the recorded transcripts `evidence/drill-20261029-node22.txt` and `-node24.txt` can be shown instead and described honestly as a recording of an earlier run.

## After recording

Post on X with the video, say it was built at NEAR HACKATHON (`docs/SUBMISSION.md` section 4 has a draft), and give the post link: it is the `demoUrl`. Keep `near.ochinimus.app` up through 2026-11-25.
