#!/usr/bin/env bash
# setup.sh — symlink this repo's skills and extensions into pi's global config dirs,
# and install the forked extensions under packages/ as pi packages
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PI_AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
PI_SKILLS_DIR="$PI_AGENT_DIR/skills"
PI_EXTENSIONS_DIR="$PI_AGENT_DIR/extensions"

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

# ─── forked extensions (git submodules) ──────────────────────────────────────

# These are full upstream repos with their own history and dependencies, so they
# are not symlinked like the rest. pi loads them from the `packages` list in its
# settings, pointing straight at the checkout.

echo ""
echo "Packages  ($PI_AGENT_DIR/settings.json)"

git -C "$REPO_DIR" submodule update --init --recursive

while read -r sub; do
  dir="$REPO_DIR/$sub"
  name="$(basename "$dir")"

  # pi runs the extension's source in place, so its deps must be installed
  if [[ -f "$dir/package-lock.json" ]]; then
    if [[ ! -d "$dir/node_modules" || "$dir/package-lock.json" -nt "$dir/node_modules" ]]; then
      echo "  ⇣ installing deps: $name"
      (cd "$dir" && npm ci --silent)
    else
      echo "  ✓ deps up to date: $name"
    fi
  fi

  if ! command -v pi >/dev/null; then
    echo "  ⚠ pi not on PATH — run 'pi install $dir' once it is"
    continue
  fi

  # Idempotent: pi rewrites the path relative to its config dir and won't duplicate
  pi install "$dir" >/dev/null </dev/null
  echo "  ↗ registered with pi: $name"

  # The published build registering alongside the fork would load the extension twice
  if [[ -f "$PI_AGENT_DIR/settings.json" ]] && node -e '
    const [file, name] = process.argv.slice(1);
    const pkgs = JSON.parse(require("fs").readFileSync(file, "utf8")).packages ?? [];
    const sources = pkgs.map((p) => (typeof p === "string" ? p : p.source));
    process.exit(sources.includes("npm:" + name) ? 0 : 1);
  ' "$PI_AGENT_DIR/settings.json" "$name"; then
    echo "  ⚠ 'npm:$name' is also in packages — remove it, or the extension loads twice"
  fi
done < <(git -C "$REPO_DIR" config -f .gitmodules --get-regexp '^submodule\..*\.path$' | awk '{print $2}')

echo ""
echo "Done. Restart pi (or run /reload) to pick up changes."
echo ""
echo "Tip: once verified, remove stale backups with:"
echo "  find '$PI_SKILLS_DIR' '$PI_EXTENSIONS_DIR' -maxdepth 1 -name '*.bak' | xargs rm -rf"
