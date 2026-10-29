#!/bin/sh
# Real paid calls against a live gateway, cycling every route once per round. One failed call does not stop the batch.
#   AGENT_ACCOUNT_ID=you.testnet GATEWAY_URL=https://near.ochinimus.app sh scripts/run-batch.sh [rounds]
# On the VPS the agent settings live in a mode-600 file:  ENV_FILE=/opt/agentfeed-near/.buyer.env NODE=/usr/bin/node sh scripts/run-batch.sh 2
ROUNDS=${1:-1}
NODE=${NODE:-node}
run() { if [ -n "$ENV_FILE" ]; then "$NODE" --env-file="$ENV_FILE" src/client.js "$@"; else "$NODE" src/client.js "$@"; fi; }
echo "# batch start $(date -u +%Y-%m-%dT%H:%M:%SZ) rounds=$ROUNDS"
i=0
while [ $i -lt "$ROUNDS" ]; do
  for r in sol-price btc-price liq-pulse funding-pulse market-snapshot trade-context "liquidations limit=5 symbol=SOL" "summarize url=https://near.org"; do
    run $r
  done
  i=$((i+1))
done
echo "# batch end $(date -u +%Y-%m-%dT%H:%M:%SZ)"
