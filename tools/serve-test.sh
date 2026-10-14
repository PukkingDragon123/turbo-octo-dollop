#!/bin/sh
# (Re)start a private no-HMR vite test server on the given port and wait until it answers.
#   tools/serve-test.sh 5181      -> http://localhost:5181/
# The test config has file watching off, so restart after every source edit.
PORT="${1:-5174}"
cd "$(dirname "$0")/.." || exit 1
pkill -f "[v]ite --config vite.test.config.js --port $PORT " 2>/dev/null
sleep 0.5
nohup npx vite --config vite.test.config.js --port "$PORT" --strictPort > "/tmp/vite-test-$PORT.log" 2>&1 &
for i in $(seq 1 60); do
  if curl -s -o /dev/null "http://localhost:$PORT/"; then echo "test server ready on $PORT"; exit 0; fi
  sleep 0.5
done
echo "test server on $PORT did not start; see /tmp/vite-test-$PORT.log"; exit 1
