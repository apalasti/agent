# Paste Detector Extension

Automatically detects pasted code snippets and replaces them with file references.

## What it does

When you paste code into pi:

1. **Detects** multi-line code snippets in your input
2. **Searches** the codebase using ripgrep (`rg`)
3. **Replaces** found code with `[Found in path/to/file.ts:line-range]`
4. **Ignores** if not found — original text is sent unchanged
5. **Respects** `.gitignore` automatically (via ripgrep)

## Features

✅ Automatic `.gitignore` support  
✅ Fast fixed-string search (no regex overhead)  
✅ Skips git-ignored files  
✅ Ignores commands (`/`), inline bash (`!`), and single-line inputs  
✅ Smart detection — only processes pasted code blocks  

## Usage

1. Copy some code from a file in your project
2. Paste it into pi
3. If found in the codebase, it transforms to: `[Found in src/file.ts:42-55]`
4. If not found, the original code is sent unchanged

## Requirements

- `rg` (ripgrep) must be installed
  ```bash
  brew install ripgrep
  ```

## Configuration

Edit `index.ts` to customize:

| Setting | Line | Default | Purpose |
|---------|------|---------|---------|
| Min length | 25 | 10 chars | Minimum snippet size before searching |
| Line check | 29 | `.includes("\n")` | What counts as "pasted" code |
| Search length | 44 | 500 chars | Max chars to search (for speed) |

## How to use from agent repo

The `setup.sh` script automatically symlinks this extension into `~/.pi/agent/extensions/paste-detector/`.

After adding/modifying, run:
```bash
./setup.sh
```

Then reload in pi:
```
/reload
```

## Under the hood

- Uses ripgrep with `-F` (fixed string, no regex)
- Stops at first match (`--max-count 1`)
- Extracts filename and line number from ripgrep output
- Calculates line range from pasted snippet length
