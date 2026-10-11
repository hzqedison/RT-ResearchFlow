#!/bin/bash
# No shell tracing: the setup password arrives on stdin, never in this wrapper's arguments.
set -eu
exec node "$(dirname "$0")/macos.mjs" "$@"
