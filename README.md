# excalidraw-sync

A collaborative drawing tool that syncs an [Excalidraw](https://excalidraw.com) canvas between a browser and a CLI. Built for AI + human drawing workflows — an AI assistant draws via the CLI while a human views and edits in the browser, all in real-time.

## How it works

```
 ┌──────────┐     WebSocket      ┌──────────┐     File Watch     ┌──────────┐
 │ Browser  │ ←───────────────→  │  Server  │ ←────────────────  │   CLI    │
 │ (draw)   │                    │ (relay)  │                    │ (AI/you) │
 └──────────┘                    └──────────┘                    └──────────┘
                                      ↕
                               canvas.excalidraw
```

- **Browser**: Full Excalidraw editor at `localhost:3100`. Draw freely — changes sync automatically.
- **Server**: Express + WebSocket relay. Watches the canvas file and broadcasts changes.
- **CLI**: Read the canvas, add elements, export PNGs. All commands auto-populate required Excalidraw fields.
- **Canvas file**: A standard `.excalidraw` JSON file that everything reads/writes.

## Quick start

```bash
git clone https://github.com/YOUR_USERNAME/excalidraw-sync.git
cd excalidraw-sync
pnpm install
pnpm dev
```

Open `http://localhost:3100` in your browser. The Excalidraw editor appears with a green "Synced" indicator.

## CLI usage

```bash
# See what's on the canvas
node cli/index.js read-summary

# Draw shapes
node cli/index.js draw-rect 100 100 200 80 '#a5d8ff'
node cli/index.js draw-ellipse 400 100 150 150 '#b2f2bb'
node cli/index.js draw-text 100 50 Hello world! --size 28 --color '#2563eb'
node cli/index.js draw-arrow 300 140 400 175
node cli/index.js draw-line 100 200 300 200
node cli/index.js draw-diamond 500 50 120 120 '#d0bfff'

# Manage elements
node cli/index.js delete <element-id>
node cli/index.js clear
node cli/index.js update <element-id> '{"backgroundColor":"#ffc9c9"}'

# Add raw Excalidraw elements (missing fields auto-filled)
echo '[{"type":"rectangle","x":0,"y":0,"width":100,"height":50}]' | node cli/index.js add

# Smart merge (preserves concurrent edits by merging on element ID)
echo '[{"id":"existing-id","x":200}]' | node cli/index.js merge

# Export a PNG snapshot (requires browser tab open)
node cli/index.js export-png screenshot.png

# Check server status
node cli/index.js status
```

## Architecture

```
excalidraw-sync/
├── cli/index.js          # CLI tool
├── server/index.js       # Express + WebSocket server
├── src/
│   ├── App.jsx           # React app with Excalidraw + sync logic
│   └── main.jsx          # Entry point
├── lib/
│   └── elements.js       # Element factory helpers + merge logic
├── index.html            # Vite entry
├── vite.config.js        # Vite config with proxy
└── canvas.excalidraw     # Shared canvas file (gitignored)
```

## How sync works

1. **Browser draws** → `onChange` fires (debounced 300ms) → sends elements via WebSocket → server writes to `canvas.excalidraw`
2. **CLI writes** → hits REST API `PUT /api/canvas` → server writes file + broadcasts via WebSocket → browser calls `updateScene()`
3. **Direct file edit** → chokidar detects change → server broadcasts to all WebSocket clients
4. **Echo prevention** — scene fingerprinting (element count + version sum) prevents update loops

## PNG export flow

The CLI can't render Excalidraw directly (no browser context), so export uses a relay:

1. CLI sends `GET /api/export-png` to server
2. Server broadcasts `export-request` to browser via WebSocket
3. Browser renders PNG using `exportToBlob()` and POSTs it back to server
4. Server relays the PNG bytes back to the CLI's pending HTTP response

## Element helpers

The `lib/elements.js` module provides factory functions that produce valid Excalidraw elements:

```js
import { rect, ellipse, text, diamond, arrow, line, normalize, mergeElements } from './lib/elements.js'

// Create elements with minimal params — all required fields auto-filled
const box = rect(100, 100, 200, 80, { backgroundColor: '#a5d8ff' })
const label = text(130, 120, 'Hello', { fontSize: 24 })

// Normalize partial elements (e.g., from user input)
const valid = normalize({ type: 'rectangle', x: 0, y: 0, width: 50, height: 50 })

// Smart merge by element ID
const merged = mergeElements(existingElements, newElements)
```

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `PORT` | `3101` | Server port |
| `CANVAS_FILE` | `./canvas.excalidraw` | Path to shared canvas file |
| `EXCALIDRAW_SYNC_URL` | `http://localhost:3101` | Server URL (for CLI) |

## Use with AI assistants

This tool was designed for use with AI coding assistants (Claude Code, Cursor, etc.) that have shell access. The AI can:

- **Draw diagrams** using `draw-*` commands or raw JSON via `add`/`merge`
- **Read the canvas** with `read-summary` to understand what the human drew
- **Export snapshots** with `export-png` to "see" the canvas visually
- **Collaborate in real-time** — both human and AI see each other's changes live

## License

MIT
