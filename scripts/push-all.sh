#!/bin/bash
# Push all project repos to GitHub
set -euo pipefail

for dir in /root/projects/*/; do
    if [ -d "$dir/.git" ]; then
        name=$(basename "$dir")
        echo "→ Pushing $name..."
        git -C "$dir" push --all 2>&1 | sed "s/^/  /"
    else
        echo "→ Skipping $(basename "$dir") (no git repo)"
    fi
done

echo "Done."
