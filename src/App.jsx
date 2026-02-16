import React, { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw, exportToBlob } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

// Debounce helper
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// Simple hash of elements array for version comparison.
// We use element count + sum of version numbers as a fast fingerprint.
function sceneFingerprint(elements) {
  if (!elements || !elements.length) return "0:0";
  let vSum = 0;
  let count = 0;
  for (const el of elements) {
    if (!el.isDeleted) {
      count++;
      vSum += el.version || 0;
    }
  }
  return `${count}:${vSum}`;
}

// Determine WebSocket URL based on current location
function getWsUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

// Handle export-request from server: render PNG and POST it back
async function handleExportRequest(api) {
  try {
    const elements = api.getSceneElements();
    const appState = api.getAppState();
    const files = api.getFiles();

    const blob = await exportToBlob({
      elements: elements.filter((e) => !e.isDeleted),
      appState: { ...appState, exportWithDarkMode: false },
      files,
      mimeType: "image/png",
      quality: 1,
    });

    await fetch("/api/export-png", {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: blob,
    });

    console.log("[sync] PNG export sent to server");
  } catch (err) {
    console.error("[sync] Export failed:", err);
  }
}

export default function App() {
  const [excalidrawAPI, setExcalidrawAPI] = useState(null);
  const wsRef = useRef(null);
  const lastRemoteFingerprint = useRef("0:0");
  const [connected, setConnected] = useState(false);

  // Connect to WebSocket
  useEffect(() => {
    let ws;
    let reconnectTimer;

    function connect() {
      ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[sync] Connected to server");
        setConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "scene-update" && excalidrawAPI) {
            const incoming = msg.data.elements || [];
            const fp = sceneFingerprint(incoming);

            // Store the fingerprint so onChange knows to ignore the echo
            lastRemoteFingerprint.current = fp;

            excalidrawAPI.updateScene({
              elements: incoming,
            });
          }

          // Handle export request from server (triggered by CLI)
          if (msg.type === "export-request" && excalidrawAPI) {
            handleExportRequest(excalidrawAPI);
          }
        } catch (err) {
          console.error("[sync] Bad message:", err);
        }
      };

      ws.onclose = () => {
        console.log("[sync] Disconnected, reconnecting in 2s...");
        setConnected(false);
        reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    if (excalidrawAPI) {
      connect();
    }

    return () => {
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [excalidrawAPI]);

  // Debounced save — sends scene to server on user changes
  const sendUpdate = useCallback(
    debounce((elements, appState, files) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      // Check if this change matches what we just received from the server.
      // If so, it's an echo from updateScene — don't send it back.
      const fp = sceneFingerprint(elements);
      if (fp === lastRemoteFingerprint.current) {
        return;
      }

      ws.send(
        JSON.stringify({
          type: "scene-update",
          data: {
            type: "excalidraw",
            version: 2,
            elements,
            appState: {
              viewBackgroundColor: appState.viewBackgroundColor || "#ffffff",
            },
            files: files || {},
          },
        })
      );
    }, 300),
    []
  );

  const handleChange = useCallback(
    (elements, appState, files) => {
      sendUpdate(elements, appState, files);
    },
    [sendUpdate]
  );

  return (
    <div style={{ width: "100%", height: "100%" }}>
      {/* Connection indicator */}
      <div
        style={{
          position: "fixed",
          top: 8,
          right: 8,
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "rgba(255,255,255,0.9)",
          padding: "4px 10px",
          borderRadius: 6,
          fontSize: 12,
          fontFamily: "system-ui",
          color: connected ? "#16a34a" : "#dc2626",
          border: `1px solid ${connected ? "#bbf7d0" : "#fecaca"}`,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: connected ? "#16a34a" : "#dc2626",
          }}
        />
        {connected ? "Synced" : "Disconnected"}
      </div>

      <Excalidraw
        excalidrawAPI={(api) => setExcalidrawAPI(api)}
        onChange={handleChange}
      />
    </div>
  );
}
