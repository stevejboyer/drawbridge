import { createServer } from "http";
import { WebSocketServer } from "ws";
import express from "express";
import { watch } from "chokidar";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3101;
const CANVAS_FILE = process.env.CANVAS_FILE || resolve(process.cwd(), "canvas.excalidraw");
const SERVE_STATIC = process.argv.includes("--serve");

// Initialize canvas file if it doesn't exist
const DEFAULT_CANVAS = JSON.stringify(
  {
    type: "excalidraw",
    version: 2,
    elements: [],
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
  },
  null,
  2
);

if (!existsSync(CANVAS_FILE)) {
  writeFileSync(CANVAS_FILE, DEFAULT_CANVAS, "utf-8");
  console.log(`Created new canvas: ${CANVAS_FILE}`);
}

function readCanvas() {
  try {
    const raw = readFileSync(CANVAS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return JSON.parse(DEFAULT_CANVAS);
  }
}

// Track writes from WebSocket clients so the file watcher ignores them
let lastWriteFromClient = 0;
const DEBOUNCE_MS = 300;

function writeCanvas(data) {
  lastWriteFromClient = Date.now();
  writeFileSync(CANVAS_FILE, JSON.stringify(data, null, 2), "utf-8");
}

// Express app (for serving built frontend in production)
const app = express();

if (SERVE_STATIC) {
  const distPath = resolve(__dirname, "../dist");
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(resolve(distPath, "index.html"));
  });
}

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, canvas: CANVAS_FILE });
});

// REST endpoint to read canvas (useful for CLI)
app.get("/api/canvas", (_req, res) => {
  res.json(readCanvas());
});

// REST endpoint to write canvas (useful for CLI)
app.use("/api/canvas", express.json({ limit: "10mb" }));
app.put("/api/canvas", (req, res) => {
  writeCanvas(req.body);
  broadcast(JSON.stringify({ type: "scene-update", data: req.body }), null);
  res.json({ ok: true });
});

// REST endpoint to request a PNG export.
// The browser client handles the actual rendering — the server acts as a relay.
// Flow: CLI -> GET /api/export-png -> server sets pendingExport flag ->
//       broadcasts to browser -> browser renders -> POST /api/export-png with blob ->
//       server resolves the pending request.
let pendingExportResolve = null;

app.get("/api/export-png", (_req, res) => {
  if (pendingExportResolve) {
    res.status(409).json({ error: "Export already in progress" });
    return;
  }

  // Set a timeout in case the browser doesn't respond
  const timeout = setTimeout(() => {
    if (pendingExportResolve) {
      pendingExportResolve = null;
      res.status(504).json({ error: "Export timed out — is the browser open?" });
    }
  }, 10000);

  pendingExportResolve = (pngBuffer) => {
    clearTimeout(timeout);
    pendingExportResolve = null;
    res.set("Content-Type", "image/png");
    res.send(pngBuffer);
  };

  // Tell the browser to generate a PNG
  broadcast(JSON.stringify({ type: "export-request" }), null);
});

// Receive the PNG from the browser
app.post("/api/export-png", express.raw({ type: "image/png", limit: "50mb" }), (req, res) => {
  if (pendingExportResolve) {
    pendingExportResolve(req.body);
    res.json({ ok: true });
  } else {
    res.status(400).json({ error: "No pending export request" });
  }
});

const server = createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server, path: "/ws" });

function broadcast(message, excludeSocket) {
  for (const client of wss.clients) {
    if (client !== excludeSocket && client.readyState === 1) {
      client.send(message);
    }
  }
}

wss.on("connection", (ws) => {
  console.log("Client connected");

  // Send current canvas state on connect
  const canvas = readCanvas();
  ws.send(JSON.stringify({ type: "scene-update", data: canvas }));

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "scene-update") {
        writeCanvas(msg.data);
        // Broadcast to other connected clients (not back to sender)
        broadcast(raw.toString(), ws);
      }
    } catch (err) {
      console.error("Bad message:", err.message);
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
  });
});

// Watch the canvas file for external changes (CLI writes directly to file)
const watcher = watch(CANVAS_FILE, {
  persistent: true,
  awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
});

watcher.on("change", () => {
  // Ignore changes we just made from a WebSocket client
  if (Date.now() - lastWriteFromClient < DEBOUNCE_MS + 200) {
    return;
  }

  console.log("External file change detected, broadcasting...");
  const canvas = readCanvas();
  broadcast(JSON.stringify({ type: "scene-update", data: canvas }), null);
});

server.listen(PORT, () => {
  console.log(`\n  excalidraw-sync server running:`);
  console.log(`    WebSocket:  ws://localhost:${PORT}/ws`);
  console.log(`    REST API:   http://localhost:${PORT}/api/canvas`);
  console.log(`    Canvas:     ${CANVAS_FILE}\n`);
});
