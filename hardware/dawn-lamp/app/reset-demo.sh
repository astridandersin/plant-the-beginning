#!/bin/sh
# Start the demo from a clean slate: empties the live history on the website and the
# lamp's own memory of past days. Run it with the app STOPPED in App Lab, then press Run.
# The device token is read from python/device_token.txt and never printed.
#   ./reset-demo.sh [board-address]      (default 172.20.10.6)
set -e
cd "$(dirname "$0")"
BOARD="${1:-172.20.10.6}"
TOKEN_FILE=python/device_token.txt
[ -s "$TOKEN_FILE" ] || { echo "No $TOKEN_FILE: nothing to authorise the reset with."; exit 1; }

printf 'Website history: '
curl -s -m 20 -X DELETE -H "x-device-token: $(cat "$TOKEN_FILE")" \
  "https://www.astridandersin.com/api/junction2026/relay?channel=dawn"
echo

printf 'Lamp memory: '
ssh -o BatchMode=yes -o ConnectTimeout=10 "arduino@$BOARD" \
  'cd ~/ArduinoApps/plant-the-beginning/python && rm -f state.json outbox.jsonl && echo cleared'
echo "Done. Press Run in App Lab."
