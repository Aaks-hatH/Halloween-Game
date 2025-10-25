import express from "express";
import http from "http";
import cors from "cors";
import bodyParser from "body-parser";
import { WebSocketServer } from "ws";

const app = express();
app.use(cors());
app.use(bodyParser.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Store active players: sessionId -> { ws, locked, progress }
let players = new Map();

// Generate unique session IDs
function generateSessionId() {
  return Math.random().toString(36).substring(2, 10);
}

// Handle WebSocket connections
wss.on("connection", (ws) => {
  const sessionId = generateSessionId();
  players.set(sessionId, { ws, locked: false, progress: {} });

  console.log(`🟢 Player connected: ${sessionId}`);
  ws.send(JSON.stringify({ type: "session_id", sessionId }));

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === "ping") return; // heartbeat

      if (data.type === "progress_update") {
        const player = players.get(sessionId);
        if (player) player.progress = data.progress;
      }
    } catch (err) {
      console.error("❌ Message parse error:", err);
    }
  });

  ws.on("close", () => {
    players.delete(sessionId);
    console.log(`🔴 Player disconnected: ${sessionId}`);
  });
});

// --------------
// REST API ROUTES
// --------------

// Get all active players
app.get("/api/players", (req, res) => {
  const list = Array.from(players.entries()).map(([id, { locked, progress }]) => ({
    sessionId: id,
    locked,
    progress,
  }));
  res.json(list);
});

// Lock or unlock a player
app.post("/api/lock", (req, res) => {
  const { sessionId, locked } = req.body;
  const player = players.get(sessionId);
  if (!player) return res.status(404).json({ error: "Player not found" });

  player.locked = locked;
  player.ws.send(JSON.stringify({ type: "lock_status", locked }));
  console.log(`${locked ? "🔒" : "🔓"} Player ${sessionId}`);
  res.json({ success: true });
});

// Reset a player's progress
app.post("/api/reset", (req, res) => {
  const { sessionId } = req.body;
  const player = players.get(sessionId);
  if (!player) return res.status(404).json({ error: "Player not found" });

  player.progress = {};
  player.ws.send(JSON.stringify({ type: "reset" }));
  console.log(`🔄 Reset progress for ${sessionId}`);
  res.json({ success: true });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
