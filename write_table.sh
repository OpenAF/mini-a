#!/bin/bash
printf "| File | Author |\n|---|---|\n"
for f in $(find mcps -type f); do
  a=$(grep -i -m1 -E "author[:=]" "$f" | sed -E "s/.*[Aa]uthor[:=]\\s*//")
  [ -z "$a" ] && a="N/A"
  printf "| %s | %s |\n" "$f" "$a"
done > result.md
