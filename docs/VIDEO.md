# Demo video

Two cuts were rendered on 2026-10-29 and are **not uploaded or posted**: that is the owner's step. Landscape 1920x1080, 30 fps, H.264 + AAC, narrated by the AssemblyAI Voice Agent voice `charles`. The files are local and git-ignored (`video/`, not in this repository, because of size and because the build needs an AssemblyAI key):

| file | length | for |
|---|---|---|
| `video/agentfeed-near-demo.mp4` + `.srt` | 3:40 | the full demo (YouTube, the submission) |
| `video/agentfeed-near-demo-x.mp4` + `.srt` | 1:14 | the X post (fits a free account's 2:20 limit) |
| `video/verify-report.md`, `transcript*.txt`, `facts.json`, contact sheets | | how the video was checked (below) |

Rules it follows: full-frame terminal, explorer and code shots; the picture shows what the narration says at that moment (boxes highlight each thing as it is named); **no text over the picture** (the `.srt` is a sidecar: attach it on upload); one end card; no face, no slides.

## What is on screen

| time | beat | picture |
|---|---|---|
| 0:00 | A | the live gateway page https://near.ochinimus.app |
| 0:21 | B | `curl -si` of an unpaid call (the 402 and its `PAYMENT-REQUIRED` header), then `jq .accepts` with each field boxed as it is named |
| 0:45 | C | a real paid call (`src/client.js liquidations`), then the same transaction on NEAR Rocks (a public testnet explorer): transfer buyer to treasury, the Delegate receipt, the `ft_transfer`, the raw data with the relayer as transaction signer |
| 1:19 | D | the stock `@x402/fetch` client and `@fastnear/x402` paying the live gateway |
| 1:41 | E | `node scripts/drill.mjs --record S3`: `kill -9` after the payment landed on the chain, the chain shows the agent charged, the same payment presented again, charged once |
| 2:03 | K | the code at HEAD: `paid()` order in `src/server.js` (verify, reserve, fetch, verify again, submit), the hash and signed bytes stored before the broadcast (`src/chain.js`, `src/store.js`), the resend of the stored bytes (`resolveSubmitted`), the lookup with `wait_until: NONE` |
| 2:40 | G | `node scripts/control-old-way.mjs`: the old way refused for lack of NEAR, our way leaves the NEAR balance unchanged, the funded old way works |
| 2:58 | H | `node scripts/verify-evidence.mjs`, then `docs/RESULTS.md`: every row verifies, 0 independent payers |
| 3:19 | I | end card: tracks, four facts, the disclosure, near.ochinimus.app, the repository |

The X cut is beats A (shorter), C, E and the end card.

## How it was made, and what it is not

- **Terminal shots are replays of real runs.** Each command was run once for real in a clone of the repository at HEAD, with the time of every output line recorded; the replay types the command and shows each line at the time it really appeared. No waits were compressed. The prompt reads `~/agentfeed-near %`, not the real machine name. Explorer and gateway pages were captured live by headless Chrome. Code shots are the files at `origin/main` HEAD of the render.
- **Every spoken number comes from `facts.json`**, read live on render day with its time; a build check fails on any digit in a spoken line that a fact does not cover, and each fact check ran. The narration gives no number for how long an unknown transaction hash blocks a `FINAL` lookup: it measured 30 s in the morning and 10 s in the afternoon of the same day.
- **Checked after the render:** length, 1920x1080, 30 fps, loudness -14 LUFS, true peak below -2 dBFS, the audio of the final file transcribed and matched to the script line by line, the transaction on screen equals the one the client printed and the chain reports it final with the relayer as signer, a secret scan of every shot with each rule first proven on a known positive. Details in `video/verify-report.md`.
- The video has not been watched end to end by a person. The numbers in it are as of 2026-10-29 about 14:50 UTC; `docs/RESULTS.md` keeps counting.
- The payments made while capturing (about 0.06 USDC of testnet USDC, all through our own accounts) are in `docs/RESULTS.md` or in `evidence/known-extra-transfers.csv`; `verify-evidence` reconciles the treasury after them.

## Owner steps

1. Watch it once. If a line is wrong, say which; a re-render needs the build folder (`/Volumes/D/agentfeed-near-video`, outside the repository) and its AssemblyAI key.
2. Upload the long cut with the `.srt` (YouTube) and post the X cut with the video on X, saying it was built at NEAR HACKATHON (`docs/SUBMISSION.md` section 4 has a draft). The post link is the `demoUrl`.
3. Keep `near.ochinimus.app` up through 2026-11-25.
