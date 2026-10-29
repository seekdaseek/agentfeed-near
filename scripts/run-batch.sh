#!/bin/sh
# Real paid calls against a live gateway, cycling every route once per round.
#   AGENT_ACCOUNT_ID=you.testnet GATEWAY_URL=https://near.ochinimus.app sh scripts/run-batch.sh [rounds]
ROUNDS=${1:-1}
i=0
while [ $i -lt $ROUNDS ]; do
  for r in sol-price btc-price liq-pulse funding-pulse market-snapshot trade-context "liquidations limit=5 symbol=SOL" "summarize url=https://near.org"; do
    node src/client.js $r
  done
  i=$((i+1))
done
