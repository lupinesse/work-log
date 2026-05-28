#!/bin/bash
# Print a build version string: the current git tag if HEAD is tagged,
# otherwise the short commit hash. Appends "*" when the tree is dirty.
# Falls back to "unknown" outside a git repository so the build never fails.

if ! git status > /dev/null 2>&1; then
  echo 'unknown'
  exit 0
fi

GIT_HASH=$(git log -n1 --pretty='%h')
DESCRIBE=$(git describe --exact-match --tags "$GIT_HASH" 2> /dev/null)

if [[ -n $DESCRIBE ]]; then
  RESULT=$(echo "$DESCRIBE" | sed 's/^v\([0-9]\)/\1/')
else
  RESULT=$GIT_HASH
fi

if [[ -n $(git status -s) ]]; then
  RESULT+="*"
fi

echo "$RESULT"
