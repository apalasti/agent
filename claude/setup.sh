#!/usr/bin/env bash
# setup.sh — symlink this folder's skills and commands into Claude Code's config dirs
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CLAUDE_SKILLS_DIR="$HOME/.claude/skills"
CLAUDE_COMMANDS_DIR="$HOME/.claude/commands"

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

# ─── skills (→ ~/.claude/skills/) ────────────────────────────────────────────

echo ""
echo "Skills  ($CLAUDE_SKILLS_DIR)"
mkdir -p "$CLAUDE_SKILLS_DIR"

for item in "$REPO_DIR/skills/"*; do
  [[ -e "$item" ]] || continue                  # skip if glob yields nothing
  name="$(basename "$item")"
  [[ "$name" == ".DS_Store" ]] && continue
  link_item "$item" "$CLAUDE_SKILLS_DIR/$name"
done

# ─── commands (→ ~/.claude/commands/) ────────────────────────────────────────

echo ""
echo "Commands  ($CLAUDE_COMMANDS_DIR)"
mkdir -p "$CLAUDE_COMMANDS_DIR"

shopt -s nullglob
items=("$REPO_DIR/commands/"*)
shopt -u nullglob

if [[ ${#items[@]} -eq 0 ]]; then
  echo "  (no commands to link yet)"
else
  for item in "${items[@]}"; do
    name="$(basename "$item")"
    [[ "$name" == ".DS_Store" ]] && continue
    link_item "$item" "$CLAUDE_COMMANDS_DIR/$name"
  done
fi

echo ""
echo "Done. Skills load automatically; the /issue command is available in Claude Code."
echo ""
echo "Tip: once verified, remove stale backups with:"
echo "  find ~/.claude/skills ~/.claude/commands -maxdepth 1 -name '*.bak' | xargs rm -rf"
