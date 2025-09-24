#!/bin/bash

# mini-a.sh - Wrapper script for ojob mini-a.yaml
# Author: Nuno Aguiar

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Execute ojob with mini-a.yaml and pass all arguments
exec ojob "$SCRIPT_DIR/mini-a.yaml" "$@"