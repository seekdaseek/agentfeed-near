# Feedback on NEAR x402 tooling

Notes from building a gateway on `@x402/near` and reading `fastnear/x402-facilitator` and `r-near/x402-near-demo` (2026-10-29 onward). Kept as we hit things, not written at the end.

## What worked well

- **`@x402/near` ships all three halves** (client signer, server scheme, facilitator scheme and a facilitator signer). We verify with the facilitator scheme in-process and pay with the client scheme unchanged; the stock `@x402/fetch` client pays our gateway with none of our code on its side (`test/interop.test.js`).
- **The verification rules are written down in code that is easy to read** (`exact/facilitator/index.mjs`): one action, `ft_transfer`, 1 yocto, full-access key, block window, nonce range, balance, storage registration. Each failure has its own reason string, which made refusals testable one by one (15 named cases in `test/gateway.test.js`).
- **NEP-366 delegate actions do what the pitch says**: the buyer's NEAR balance did not change across a paid call; the relayer paid about 0.00033 NEAR (`evidence/phase1-prove-settle.txt`).

## Things that cost us time or that we had to work around

1. **Two incompatible "x402 on NEAR" wire formats are in circulation.** `r-near/x402-near-demo` uses scheme `near-delegate-exact`, a `delegateB64` field and `X-PAYMENT`; `@x402/near` and `fastnear/x402-facilitator` use scheme `exact`, `payload.signedDelegateAction` and `PAYMENT-SIGNATURE`. A client written from the first demo will not pay a server written for the second. We follow the second (x402 v2) because it is the one the x402 foundation package implements.
2. **The facilitator settle path does not let the caller see the relayer transaction hash before broadcast.** `submitSignedDelegateAction` signs, sends and waits in one call. For a gateway that must never charge without delivering (or deliver without a record), the hash has to be stored before the broadcast so a crash can be reconciled from the chain. We wrote our own submit (about 30 lines using `@near-js/transactions`) and keep the package's verification. A hook such as `onPrepared(txHash)` in the signer interface would remove the need.
3. **`maxTimeoutSeconds` is counted in blocks** (`ESTIMATED_BLOCK_SECONDS = 1`), and the facilitator rejects a delegate whose remaining window is larger than that number. A gateway that fetches data between verify and settle must pick a window long enough for its slowest upstream; ours is 60 blocks with a 15 s upstream timeout.
4. **Function-call keys cannot pay.** A delegate signed by a function-call access key is refused (`invalid_exact_near_function_call_key_not_allowed`), plausibly because a function-call key cannot attach a deposit (we observed that rule for plain transactions on testnet in a sibling project; we did not test it for delegates), but it means an agent whose account only has a restricted key cannot use x402 at all. Worth one line in the README of `@x402/near`.
5. **A single relayer key serialises settlement.** Relayer transactions share one nonce sequence, so concurrent settles need a lock or a gas-key relayer. Ours uses a mutex; by construction settlement throughput is therefore about one call per settle latency (not load-tested).
6. **A fresh install of `@x402/near` trips `npm audit` twice.** `@x402/core` pins `zod ^3.24.2`, which is in the range of GHSA-mrhx-c7xc-m3w5 (high; fixed in 4.6.6); an npm `overrides` entry to 4.6.7 clears it and the stock client still works (tested). `@near-js/crypto` pulls `secp256k1` -> `elliptic`, GHSA-848j-6mx2-7j84 (low), which has no patched release; the project only uses ed25519. A `zod` bump in `@x402/core` and an ed25519-only `@near-js/crypto` path would give users a clean audit.
7. **The hosted reference facilitators need manually approved credentials**, so a hackathon project cannot depend on them. Embedding the facilitator scheme in the gateway (this repo) is the workable path, and `@x402/near/exact/facilitator` makes that easy.

## Numbers

- Settle latency to `FINAL` on testnet: 4.3 s for the first call (`settle_ms` in the ledger). Measured against Mezo testnet in `docs/RESULTS.md` once the batch has run.
