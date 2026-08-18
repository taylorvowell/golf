#!/bin/sh
# Bootstrap the model assets, then become the requested command.
#
# `exec` matters: the served process must be PID 1 so the host's stop signal reaches it
# rather than this shell. And the fetch runs BEFORE it, not alongside — a worker that binds
# while its weights are still downloading can take a job it cannot run.
#
# A non-zero fetch exits the container. That is the intent: "started anyway, failed on the
# first job" is the failure mode this replaces.
#
# SWINGSAGE_SKIP_MODEL_BOOTSTRAP=1 opts out, for the two commands that legitimately need no
# model on disk: `python -m pytest tests` (the from-scratch reproducibility proof, step 03)
# and an interactive shell. The default direction is the safe one — forgetting the flag
# fetches, forgetting to serve models does not silently serve.
set -e

if [ -z "$SWINGSAGE_SKIP_MODEL_BOOTSTRAP" ]; then
  python -m service.fetchmodels
fi

exec "$@"
