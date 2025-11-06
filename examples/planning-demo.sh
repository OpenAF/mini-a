#!/bin/bash
# Demo of improved planning mode

set -euo pipefail

mini_a_bin="${MINI_A_BIN:-ojob}"
job_file="${MINI_A_JOB:-mini-a.yaml}"

run_demo() {
  echo "=== Demo 1: Automatic Updates ==="
  $mini_a_bin "$job_file" goal="Analyze this directory structure and create a report" \
    useshell=true \
    useplanning=true \
    planfile=demo_plan.md \
    updatefreq=auto \
    updateinterval=2 \
    verbose=true

  echo -e "\n=== Check the plan file ==="
  cat demo_plan.md

  echo -e "\n=== Demo 2: Checkpoint Updates ==="
  $mini_a_bin "$job_file" goal="Create a project structure with folders and files" \
    useshell=true \
    useplanning=true \
    planfile=demo_plan2.md \
    updatefreq=checkpoints \
    maxsteps=20

  echo -e "\n=== Check the plan file ==="
  cat demo_plan2.md
}

cleanup() {
  rm -f demo_plan.md demo_plan2.md
}

run_demo
cleanup
