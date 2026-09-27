#!/bin/sh
# TrainMyBot — start the MuJoCo viewer backend on http://localhost:8766
PY=/Users/founderlin/.workbuddy/binaries/python/envs/default/bin/python
if [ ! -x "$PY" ]; then
  echo "Managed Python not found at $PY" >&2
  exit 1
fi
exec "$PY" "$(dirname "$0")/server.py"
