#!/bin/bash
# Double-click to start Cecilia: runs the local server (if it isn't already) and opens the app window.
cd "$(dirname "$0")"
if ! lsof -nP -iTCP:8123 -sTCP:LISTEN >/dev/null 2>&1; then
  nohup python3 serve.py >/tmp/cecilia-server.log 2>&1 &
  sleep 1
fi
open -na "Google Chrome" --args --app=http://localhost:8123
