// ============================================
// Shortify AI - WebSocket Server for real-time task progress
// ============================================
// Runs alongside Next.js on a separate port (default: 8001)
// Protocol: JSON messages over WebSocket
//
// Client -> Server:
//   { type: "subscribe", dramaId: "<id>" }
//   { type: "ping" }
//
// Server -> Client:
//   { type: "task:progress", taskId, dramaId, payload, timestamp }
//   { type: "task:completed", taskId, dramaId, payload, timestamp }
//   { type: "task:failed", taskId, dramaId, payload, timestamp }
//   { type: "pong" }
//   { type: "subscribed", dramaId }

import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { taskEventBus, type TaskEvent } from "../lib/task-event-bus";

const WS_PORT = parseInt(process.env.WS_PORT || "8001", 10);

const server = createServer((_req, res) => {
  // Simple health endpoint for the WS server
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok", service: "shortify-ws", port: WS_PORT }));
});

const wss = new WebSocketServer({ server, path: "/ws" });

interface ClientConnection {
  ws: WebSocket;
  dramaId: string | null;
  userId: string | null;
  unsubscribe?: () => void;
  isAlive: boolean;
  lastPing: number;
}

const clients = new Map<WebSocket, ClientConnection>();

function send(client: ClientConnection, data: Record<string, unknown>) {
  if (client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify(data));
  }
}

wss.on("connection", (ws, req) => {
  // Extract token from query params for auth (optional)
  const url = new URL(req.url || "/", `http://localhost:${WS_PORT}`);
  const token = url.searchParams.get("token");

  const client: ClientConnection = {
    ws,
    dramaId: null,
    userId: token || null,
    isAlive: true,
    lastPing: Date.now(),
  };

  clients.set(ws, client);
  console.log(`[ws] Client connected (total: ${clients.size})`);

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.type) {
        case "subscribe": {
          // Unsubscribe from previous drama
          if (client.unsubscribe) {
            client.unsubscribe();
          }

          client.dramaId = msg.dramaId;
          client.unsubscribe = taskEventBus.on(msg.dramaId, (event) => {
            send(client, event as unknown as Record<string, unknown>);
          });

          send(client, { type: "subscribed", dramaId: msg.dramaId });
          console.log(`[ws] Client subscribed to drama ${msg.dramaId} (subs: ${taskEventBus.subscriberCount(msg.dramaId)})`);
          break;
        }

        case "ping": {
          client.isAlive = true;
          client.lastPing = Date.now();
          send(client, { type: "pong" });
          break;
        }
      }
    } catch (err) {
      console.warn("[ws] Invalid message:", err);
    }
  });

  ws.on("close", () => {
    if (client.unsubscribe) {
      client.unsubscribe();
    }
    clients.delete(ws);
    console.log(`[ws] Client disconnected (total: ${clients.size})`);
  });

  ws.on("error", (err) => {
    console.error("[ws] Connection error:", err.message);
    if (client.unsubscribe) {
      client.unsubscribe();
    }
    clients.delete(ws);
  });
});

// Heartbeat: detect and close dead connections every 30s
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    const client = clients.get(ws);
    if (!client) return;

    if (!client.isAlive) {
      console.log("[ws] Terminating dead connection");
      ws.terminate();
      return;
    }

    client.isAlive = false;
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  });
}, 30000);

wss.on("close", () => {
  clearInterval(heartbeat);
});

server.listen(WS_PORT, () => {
  console.log(`[ws] WebSocket server listening on port ${WS_PORT}`);
});
