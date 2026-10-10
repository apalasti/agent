#!/usr/bin/env bash
# Copies the shared kit into every plugin's src/kit/, plus any vendored component it needs that the plugin lacks.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
donor="$here/../bb-plugin-worktrees/components/ui"
for plugin in "$here"/../bb-plugin-*/; do
  [ -f "$plugin/app.tsx" ] || continue
  rm -rf "$plugin/src/kit"
  mkdir -p "$plugin/src/kit"
  cp "$here"/src/*.ts* "$plugin/src/kit/"
  for dep in button icon dropdown-menu menu-item-hover tooltip; do
    [ -e "$plugin/components/ui/$dep.tsx" ] || cp "$donor/$dep.tsx" "$plugin/components/ui/"
  done
done
