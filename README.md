# drawbridge

Real-time collaborative drawing between humans and AI. You draw in the browser, your AI assistant draws via the CLI — both see each other's changes live.

Built on [Excalidraw](https://excalidraw.com), the open-source whiteboard tool.

## Why?

AI coding assistants like Claude Code, Cursor, and Copilot are great at text — but sometimes you need to sketch out an architecture diagram, a UI layout, or a flow chart together. This tool gives your AI a shared canvas to draw on alongside you.

**The problem:** AI assistants running in terminals can't render visual output. They can describe diagrams in text, but that's clunky for spatial thinking.

**The solution:** A shared Excalidraw canvas. The human draws in the browser. The AI draws via CLI commands. Changes sync in real-time both ways. The AI can even export a PNG to "see" what's on the canvas.

## How it works

```
 ┌──────────┐     WebSocket      ┌──────────┐      REST API      ┌──────────┐
 │ Browser  │ ←───────────────→  │  Server  │ ←────────────────  │   CLI    │
 │ (you)    │                    │ (relay)  │                    │ (AI)     │
 └──────────┘                    └──────────┘                    └──────────┘
                                      ↕
                               canvas.excalidraw
```

- You draw in a full Excalidraw editor in the browser
- Your AI draws by running CLI commands in the terminal
- A lightweight server syncs changes between them via WebSocket
- Everything is backed by a single `.excalidraw` JSON file

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [pnpm](https://pnpm.io/) (install with `npm install -g pnpm` if you don't have it)

## Quick start

**1. Clone and install:**

```bash
git clone https://github.com/stevejboyer/drawbridge.git
cd drawbridge
pnpm install
```

**2. Start the dev server:**

```bash
pnpm dev
```

This starts two processes:
- Vite dev server (frontend) at `http://localhost:3100`
- Express + WebSocket server (backend) at `http://localhost:3101`

**3. Open the editor:**

Go to `http://localhost:3100` in your browser. You'll see the full Excalidraw editor with a green "Synced" indicator in the top-right corner.

**4. Start drawing!**

Draw something in the browser, then verify the sync works from the CLI:

```bash
node cli/index.js read-summary
```

You should see a list of the elements you just drew.

## Using with your AI assistant

Once the server is running and the browser is open, tell your AI assistant about the CLI. Here's an example prompt you can give it:

> I have drawbridge running locally. It's a shared Excalidraw canvas — I draw in the browser and you draw via the CLI. The server is at localhost:3101.
>
> Here are the commands you can use (run from the drawbridge directory):
>
> - `node cli/index.js read-summary` — see what's on the canvas
> - `node cli/index.js draw-text <x> <y> <text>` — add text
> - `node cli/index.js draw-rect <x> <y> <w> <h> [color]` — add a rectangle
> - `node cli/index.js draw-ellipse <x> <y> <w> <h> [color]` — add an ellipse
> - `node cli/index.js draw-arrow <x1> <y1> <x2> <y2>` — add an arrow
> - `node cli/index.js draw-line <x1> <y1> <x2> <y2>` — add a line
> - `node cli/index.js draw-diamond <x> <y> <w> <h> [color]` — add a diamond
> - `node cli/index.js export-png <path>` — export canvas as PNG (so you can "see" it)
> - `node cli/index.js delete <id>` — remove an element
> - `node cli/index.js clear` — clear the canvas
>
> Coordinates are in pixels. Colors are hex strings like '#a5d8ff'.

Your AI can then draw diagrams, read what you've sketched, and collaborate visually.

## CLI reference

### Reading the canvas

```bash
# Human-readable summary of all elements
node cli/index.js read-summary

# Full canvas JSON
node cli/index.js read

# Just the elements array (active only, no deleted)
node cli/index.js read-elements

# Check if the server is running
node cli/index.js status
```

### Drawing shapes

```bash
node cli/index.js draw-rect 100 100 200 80 '#a5d8ff'
node cli/index.js draw-ellipse 400 100 150 150 '#b2f2bb'
node cli/index.js draw-diamond 500 50 120 120 '#d0bfff'
node cli/index.js draw-text 100 50 Hello world! --size 28 --color '#2563eb'
node cli/index.js draw-arrow 300 140 400 175
node cli/index.js draw-line 100 200 300 200
```

All drawing commands auto-populate the required Excalidraw element fields (version, seed, nonce, etc.) — you only need to pass the basics.

### Managing elements

```bash
# Delete elements by ID
node cli/index.js delete <element-id> [more-ids...]

# Update a specific element
node cli/index.js update <element-id> '{"backgroundColor":"#ffc9c9"}'

# Clear the entire canvas
node cli/index.js clear
```

### Adding raw elements

For more complex drawings, you can pass raw Excalidraw JSON. Missing fields are auto-filled:

```bash
# Add elements (via stdin)
echo '[{"type":"rectangle","x":0,"y":0,"width":100,"height":50}]' | node cli/index.js add

# Smart merge by element ID (preserves concurrent edits)
echo '[{"id":"existing-id","x":200}]' | node cli/index.js merge
```

### Exporting

```bash
# Export as PNG (requires the browser tab to be open)
node cli/index.js export-png screenshot.png
```

The PNG export works by asking the browser to render the canvas — so the browser tab must be open for this to work.

### Options

```bash
# Use direct file mode (skip server, read/write the .excalidraw file directly)
node cli/index.js read-summary --file
```

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `PORT` | `3101` | Backend server port |
| `CANVAS_FILE` | `./canvas.excalidraw` | Path to shared canvas file |
| `EXCALIDRAW_SYNC_URL` | `http://localhost:3101` | Server URL (used by CLI) |

## Architecture

```
drawbridge/
├── cli/index.js          # CLI tool — drawing commands, read/write, export
├── server/index.js       # Express + WebSocket server — syncs file ↔ browser
├── src/
│   ├── App.jsx           # React app — Excalidraw editor + WebSocket sync
│   └── main.jsx          # Entry point
├── lib/
│   └── elements.js       # Element factory helpers (rect, text, etc.) + merge logic
├── index.html            # Vite entry
├── vite.config.js        # Vite config with dev proxy
└── canvas.excalidraw     # Shared canvas file (gitignored, created on first run)
```

### Sync details

1. **Browser → Server → File**: You draw in the browser → `onChange` fires (debounced 300ms) → elements sent via WebSocket → server writes `canvas.excalidraw`
2. **CLI → Server → Browser**: AI runs a CLI command → hits REST API → server writes file + broadcasts via WebSocket → browser calls `updateScene()`
3. **Direct file edit → Browser**: If something writes to `canvas.excalidraw` directly, chokidar detects the change and broadcasts to all connected browsers
4. **Echo prevention**: Scene fingerprinting (element count + version sum) prevents update loops when the browser receives its own changes back

### PNG export flow

The CLI can't render Excalidraw (no browser context), so export uses a relay:

1. CLI sends `GET /api/export-png` to server
2. Server broadcasts `export-request` to browser via WebSocket
3. Browser renders PNG using Excalidraw's `exportToBlob()` and POSTs it back
4. Server relays the PNG bytes to the CLI's pending HTTP response

### Element helpers (for programmatic use)

The `lib/elements.js` module exports factory functions if you want to build on top of this:

```js
import { rect, ellipse, text, arrow, normalize, mergeElements } from './lib/elements.js'

const box = rect(100, 100, 200, 80, { backgroundColor: '#a5d8ff' })
const label = text(130, 120, 'Hello', { fontSize: 24 })
const merged = mergeElements(existingElements, newElements)
```

## Tech stack

- [Excalidraw](https://excalidraw.com) — open-source whiteboard (React component)
- [Vite](https://vite.dev) — frontend dev server
- [Express](https://expressjs.com) — backend server
- [ws](https://github.com/websockets/ws) — WebSocket server
- [chokidar](https://github.com/paulmillr/chokidar) — file watching

## License

MIT
