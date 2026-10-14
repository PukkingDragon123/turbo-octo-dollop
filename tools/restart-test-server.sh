#!/bin/sh
# Restart the default no-HMR test server on :5174 (only that port; other agents' servers are left alone).
exec "$(dirname "$0")/serve-test.sh" 5174
