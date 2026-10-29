#!/bin/sh
# Read-only check of the daily batch cron on the VPS: did the batch of a given UTC day run, how many calls succeeded, and does the public ledger agree.
#   sh scripts/batch-status.sh [YYYY-MM-DD]        default: today (UTC). The cron slot is 08:12 UTC.
D=${1:-$(date -u +%F)}
echo "== batch.log, day $D (VPS)"
ssh -o BatchMode=yes solwatch "L=/opt/agentfeed-near/batch.log
grep \"^# batch\" \$L | grep \"$D\"
awk -v d=\"$D\" '/^# batch start/ {on = index(\$0, d) > 0} on && /\"status\":200/ {ok++} on && /\"error\"/ {err++} END {print \"ok_calls=\" ok+0, \"error_lines=\" err+0}' \$L
echo \"== crontab line\"; crontab -l | grep agentfeed-near-batch | cut -c1-80
echo \"== now: \$(date -u +%FT%TZ)\""
echo "== public ledger rows stamped $D"
curl -s -m 20 https://near.ochinimus.app/payments.csv | grep -c "^$D"
echo "== process"
curl -s -m 10 -o /dev/null -w "health %{http_code}\n" https://near.ochinimus.app/health
