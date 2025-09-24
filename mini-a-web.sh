#!/bin/bash

# mini-a-web.sh - Wrapper script for ojob mini-a-web.yaml
# Author: Nuno Aguiar

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Execute ojob with mini-a-web.yaml and pass all arguments
exec /bin/bash -c "cd $SCRIPT_DIR && ojob \"$SCRIPT_DIR/mini-a-web.yaml\" \"$@\""