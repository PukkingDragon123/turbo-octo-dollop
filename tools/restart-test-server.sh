#!/bin/sh
# Restart the no-HMR test server (it does not watch files, so restart after edits)
pkill -f "[v]ite --config vite.test.config.js" 2>/dev/null
sleep 0.5
cd "$(dirname "$0")/.." && (npx vite --config vite.test.config.js > /tmp/vite2.log 2>&1 &)
for i in $(seq 1 40); do curl -s -o /dev/null localhost:5174/ && break; sleep 0.25; done
echo "test server up"
