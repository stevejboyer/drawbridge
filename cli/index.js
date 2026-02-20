#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { normalizeAll, mergeElements, rect, ellipse, text, diamond, arrow, line } from "../lib/elements.js";

const CANVAS_FILE = process.env.CANVAS_FILE || resolve(process.cwd(), "canvas.excalidraw");
const SERVER_URL = process.env.EXCALIDRAW_SYNC_URL || "http://localhost:3101";

const [, , command, ...rawArgs] = process.argv;

const HELP = `
drawbridge CLI

Commands:
  read                     Read the full canvas JSON
  read-elements            Read just the elements (active only, no deleted)
  read-summary             Human-readable summary of what's on the canvas
  write <json>             Replace full canvas (from arg or stdin)
  add <json>               Add elements (auto-fills missing fields)
  merge <json>             Smart merge by element ID (preserves concurrent edits)
  update <id> <json>       Update a specific element by ID
  delete <id> [id...]      Delete elements by ID
  clear                    Clear all elements
  status                   Check server status

Drawing shortcuts:
  draw-rect <x> <y> <w> <h> [color]       Add a rectangle
  draw-ellipse <x> <y> <w> <h> [color]    Add an ellipse
  draw-text <x> <y> <text> [--size N] [--color C]   Add text
  draw-diamond <x> <y> <w> <h> [color]    Add a diamond
  draw-arrow <x1> <y1> <x2> <y2> [color]  Add an arrow
  draw-line <x1> <y1> <x2> <y2> [color]   Add a line

Export:
  export-png [path]        Export canvas as PNG (requires browser open)

Options:
  --file, -f       Direct file mode (skip server, read/write file directly)

Environment:
  CANVAS_FILE              Path to canvas file (default: ./canvas.excalidraw)
  EXCALIDRAW_SYNC_URL      Server URL (default: http://localhost:3101)
`;

// Parse flags and positional args from rawArgs.
// Flags like --size 28 consume the next arg as their value.
const VALUED_FLAGS = new Set(["--size", "--color"]);
const flags = new Map(); // flag -> value (or true for boolean flags)
const args = [];

for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a.startsWith("--")) {
    if (VALUED_FLAGS.has(a)) {
      flags.set(a, rawArgs[++i] || null);
    } else {
      flags.set(a, true);
    }
  } else if (a === "-f") {
    flags.set("--file", true);
  } else {
    args.push(a);
  }
}
const useFile = flags.has("--file");

function getFlag(name) {
  return flags.get(name) || null;
}

// --- Canvas I/O ---

async function readCanvas() {
  if (!useFile) {
    try {
      const res = await fetch(`${SERVER_URL}/api/canvas`);
      if (res.ok) return await res.json();
    } catch {
      // fall through to file
    }
  }
  if (existsSync(CANVAS_FILE)) {
    return JSON.parse(readFileSync(CANVAS_FILE, "utf-8"));
  }
  console.error("Server not reachable and no local canvas file found.");
  process.exit(1);
}

async function writeCanvas(data) {
  if (!useFile) {
    try {
      const res = await fetch(`${SERVER_URL}/api/canvas`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        console.log("Canvas updated (synced to browser)");
        return;
      }
    } catch {
      // fall through to file
    }
  }
  writeFileSync(CANVAS_FILE, JSON.stringify(data, null, 2), "utf-8");
  console.log(`Written to ${CANVAS_FILE}`);
}

async function readStdin() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8").trim();
}

async function addElements(newElements) {
  const canvas = await readCanvas();
  const normalized = normalizeAll(
    Array.isArray(newElements) ? newElements : [newElements]
  );
  canvas.elements = [...(canvas.elements || []), ...normalized];
  await writeCanvas(canvas);
  return normalized;
}

async function mergeIncoming(newElements) {
  const canvas = await readCanvas();
  const normalized = normalizeAll(
    Array.isArray(newElements) ? newElements : [newElements]
  );
  canvas.elements = mergeElements(canvas.elements || [], normalized);
  await writeCanvas(canvas);
  return normalized;
}

// --- JSON parsing helper (handles stdin + args) ---

async function getJsonInput() {
  // First try stdin
  const stdin = await readStdin();
  if (stdin) return JSON.parse(stdin);

  // Then try joining remaining args as JSON
  const jsonStr = args.join(" ");
  if (jsonStr) return JSON.parse(jsonStr);

  console.error("No JSON input provided. Pass as argument or pipe via stdin.");
  process.exit(1);
}

// --- Main ---

async function main() {
  switch (command) {
    case "read": {
      const canvas = await readCanvas();
      console.log(JSON.stringify(canvas, null, 2));
      break;
    }

    case "read-elements": {
      const canvas = await readCanvas();
      const active = (canvas.elements || []).filter((e) => !e.isDeleted);
      console.log(JSON.stringify(active, null, 2));
      break;
    }

    case "read-summary": {
      const canvas = await readCanvas();
      const active = (canvas.elements || []).filter((e) => !e.isDeleted);
      if (active.length === 0) {
        console.log("Canvas is empty.");
        break;
      }
      console.log(`${active.length} elements on canvas:\n`);
      for (const el of active) {
        const pos = `(${Math.round(el.x)}, ${Math.round(el.y)})`;
        const size = el.width ? ` ${Math.round(el.width)}x${Math.round(el.height)}` : "";
        const extra = el.text ? ` "${el.text}"` : "";
        const color = el.backgroundColor && el.backgroundColor !== "transparent"
          ? ` fill:${el.backgroundColor}`
          : "";
        console.log(`  ${el.type.padEnd(10)} ${el.id.substring(0, 8).padEnd(9)} ${pos}${size}${extra}${color}`);
      }
      break;
    }

    case "write": {
      const data = await getJsonInput();
      await writeCanvas(data);
      break;
    }

    case "add": {
      const data = await getJsonInput();
      const added = await addElements(data);
      console.log(`Added ${added.length} element(s)`);
      break;
    }

    case "merge": {
      const data = await getJsonInput();
      const merged = await mergeIncoming(data);
      console.log(`Merged ${merged.length} element(s)`);
      break;
    }

    case "update": {
      const id = args[0];
      if (!id) {
        console.error("Usage: drawbridge update <id> <json>");
        process.exit(1);
      }
      const updates = JSON.parse(args.slice(1).join(" ") || (await readStdin()));
      const canvas = await readCanvas();
      const idx = canvas.elements.findIndex((e) => e.id === id);
      if (idx === -1) {
        console.error(`Element '${id}' not found`);
        process.exit(1);
      }
      canvas.elements[idx] = {
        ...canvas.elements[idx],
        ...updates,
        version: (canvas.elements[idx].version || 0) + 1,
        versionNonce: Math.floor(Math.random() * 2_000_000_000),
        updated: Date.now(),
      };
      await writeCanvas(canvas);
      console.log(`Updated element '${id}'`);
      break;
    }

    case "delete": {
      if (args.length === 0) {
        console.error("Usage: drawbridge delete <id> [id...]");
        process.exit(1);
      }
      const idsToDelete = new Set(args);
      const canvas = await readCanvas();
      let count = 0;
      for (const el of canvas.elements) {
        if (idsToDelete.has(el.id)) {
          el.isDeleted = true;
          el.version = (el.version || 0) + 1;
          el.updated = Date.now();
          count++;
        }
      }
      await writeCanvas(canvas);
      console.log(`Deleted ${count} element(s)`);
      break;
    }

    case "clear": {
      const canvas = await readCanvas();
      canvas.elements = [];
      await writeCanvas(canvas);
      console.log("Canvas cleared");
      break;
    }

    case "status": {
      try {
        const res = await fetch(`${SERVER_URL}/api/health`);
        const data = await res.json();
        console.log(`Server running. Canvas: ${data.canvas}`);
      } catch {
        console.log("Server not running.");
        if (existsSync(CANVAS_FILE)) {
          console.log(`Canvas file exists at: ${CANVAS_FILE}`);
        }
      }
      break;
    }

    // --- Drawing shortcuts ---

    case "draw-rect": {
      const [x, y, w, h, color] = args;
      const el = rect(+x, +y, +w, +h, color ? { backgroundColor: color } : {});
      await addElements(el);
      console.log(`Added rectangle '${el.id}' at (${x}, ${y})`);
      break;
    }

    case "draw-ellipse": {
      const [x, y, w, h, color] = args;
      const el = ellipse(+x, +y, +w, +h, color ? { backgroundColor: color } : {});
      await addElements(el);
      console.log(`Added ellipse '${el.id}' at (${x}, ${y})`);
      break;
    }

    case "draw-text": {
      // args: x y ...textWords
      const [x, y, ...textWords] = args;
      const fontSize = +(getFlag("--size") || 20);
      const color = getFlag("--color") || "#1e1e1e";
      const content = textWords.join(" ");
      const el = text(+x, +y, content, { fontSize, strokeColor: color });
      await addElements(el);
      console.log(`Added text '${el.id}' at (${x}, ${y}): "${content}"`);
      break;
    }

    case "draw-diamond": {
      const [x, y, w, h, color] = args;
      const el = diamond(+x, +y, +w, +h, color ? { backgroundColor: color } : {});
      await addElements(el);
      console.log(`Added diamond '${el.id}' at (${x}, ${y})`);
      break;
    }

    case "draw-arrow": {
      const [x1, y1, x2, y2, color] = args;
      const el = arrow(+x1, +y1, +x2, +y2, color ? { strokeColor: color } : {});
      await addElements(el);
      console.log(`Added arrow '${el.id}' from (${x1},${y1}) to (${x2},${y2})`);
      break;
    }

    case "draw-line": {
      const [x1, y1, x2, y2, color] = args;
      const el = line(+x1, +y1, +x2, +y2, color ? { strokeColor: color } : {});
      await addElements(el);
      console.log(`Added line '${el.id}' from (${x1},${y1}) to (${x2},${y2})`);
      break;
    }

    // --- Export ---

    case "export-png": {
      const outPath = resolve(args[0] || "canvas.png");
      try {
        const res = await fetch(`${SERVER_URL}/api/export-png`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          console.error(`Export failed: ${err.error || res.statusText}`);
          process.exit(1);
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        writeFileSync(outPath, buffer);
        console.log(`Exported PNG to ${outPath} (${Math.round(buffer.length / 1024)}KB)`);
      } catch (err) {
        console.error(`Export failed: ${err.message}`);
        console.error("Make sure the server is running and the browser tab is open.");
        process.exit(1);
      }
      break;
    }

    default:
      console.log(HELP);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
