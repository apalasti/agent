#!/usr/bin/env bash
# setup.sh — symlink this repo's skills and extensions into pi's global config dirs,
# and install the forked extensions under packages/ as pi packages
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PI_AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
PI_SKILLS_DIR="$PI_AGENT_DIR/skills"
PI_EXTENSIONS_DIR="$PI_AGENT_DIR/extensions"
PI_AGENTS_DIR="$PI_AGENT_DIR/agents"

# ─── helpers ─────────────────────────────────────────────────────────────────

link_item() {
  local src="$1"
  local dest="$2"

  # Already the correct symlink → nothing to do
  if [[ -L "$dest" && "$(readlink "$dest")" == "$src" ]]; then
    echo "  ✓ already linked: $(basename "$dest")"
    return
  fi

  # Existing real file/dir → back it up
  if [[ -e "$dest" && ! -L "$dest" ]]; then
    local backup="${dest}.bak"
    echo "  ⚑ backing up existing $(basename "$dest") → $(basename "$backup")"
    mv "$dest" "$backup"
  fi

  # Stale or wrong symlink → remove it
  if [[ -L "$dest" ]]; then
    rm "$dest"
  fi

  ln -s "$src" "$dest"
  echo "  ↗ linked: $(basename "$dest")"
}

# ─── skills ──────────────────────────────────────────────────────────────────

echo ""
echo "Skills  ($PI_SKILLS_DIR)"
mkdir -p "$PI_SKILLS_DIR"

for item in "$REPO_DIR/skills/"*; do
  [[ -e "$item" ]] || continue                  # skip if glob yields nothing
  name="$(basename "$item")"
  link_item "$item" "$PI_SKILLS_DIR/$name"
done

# ─── extensions ──────────────────────────────────────────────────────────────

echo ""
echo "Extensions  ($PI_EXTENSIONS_DIR)"
mkdir -p "$PI_EXTENSIONS_DIR"

shopt -s nullglob
items=("$REPO_DIR/extensions/"*)
shopt -u nullglob

if [[ ${#items[@]} -eq 0 ]]; then
  echo "  (no extensions to link yet)"
else
  for item in "${items[@]}"; do
    name="$(basename "$item")"
    link_item "$item" "$PI_EXTENSIONS_DIR/$name"
  done
fi

# ─── agents ──────────────────────────────────────────────────────────────────

echo ""
echo "Agents  ($PI_AGENTS_DIR)"
mkdir -p "$PI_AGENTS_DIR"

for item in "$REPO_DIR/agents/"*.md; do
  [[ -e "$item" ]] || continue
  name="$(basename "$item")"
  link_item "$item" "$PI_AGENTS_DIR/$name"
done

echo ""
echo "Done. Restart pi (or run /reload) to pick up changes."
echo ""
echo "Tip: once verified, remove stale backups with:"
echo "  find '$PI_SKILLS_DIR' '$PI_EXTENSIONS_DIR' '$PI_AGENTS_DIR' -maxdepth 1 -name '*.bak' | xargs rm -rf"
