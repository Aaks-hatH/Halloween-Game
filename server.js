import express from "express";
import http from "http";
import cors from "cors";
import bodyParser from "body-parser";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public')); // Serve static files

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// In-memory storage (replace with database in production)
let sessions = new Map(); // sessionId -> { ws, locked, progress, startTime, difficulty }
let analytics = {
  attempts: [],
  completions: [],
  locked: [],
  hints: []
};

// Admin credentials
const ADMIN_PASSWORD = "Password123"; // Change this!

// Generate unique session IDs
function generateSessionId() {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

// WebSocket handling
wss.on("connection", (ws) => {
  const sessionId = generateSessionId();
  sessions.set(sessionId, { 
    ws, 
    locked: false, 
    progress: {}, 
    startTime: Date.now(),
    lastActivity: Date.now()
  });

  console.log(`🟢 Player connected: ${sessionId} (Total: ${sessions.size})`);
  ws.send(JSON.stringify({ type: "session_id", sessionId }));

  // Heartbeat
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      const session = sessions.get(sessionId);
      if (!session) return;

      session.lastActivity = Date.now();

      switch(data.type) {
        case "ping":
          ws.send(JSON.stringify({ type: "pong" }));
          break;
        
        case "progress_update":
          session.progress = data.progress;
          break;
        
        case "event":
          // Track analytics
          analytics[data.event] = analytics[data.event] || [];
          analytics[data.event].push({
            sessionId,
            ...data.details,
            timestamp: Date.now()
          });
          break;
      }
    } catch (err) {
      console.error("❌ Message parse error:", err);
    }
  });

  ws.on("close", () => {
    sessions.delete(sessionId);
    console.log(`🔴 Player disconnected: ${sessionId} (Total: ${sessions.size})`);
  });

  ws.on('error', (error) => {
    console.error(`❌ WebSocket error for ${sessionId}:`, error);
  });
});

// Heartbeat to detect broken connections
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeat);
});

// ============ REST API ROUTES ============

// Root route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Admin dashboard
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Get all active sessions
app.get("/api/players", (req, res) => {
  const list = Array.from(sessions.entries()).map(([id, session]) => ({
    sessionId: id,
    locked: session.locked,
    progress: session.progress,
    startTime: session.startTime,
    difficulty: session.progress.difficulty,
    lastActivity: session.lastActivity
  }));
  res.json(list);
});

// Lock or unlock a player
app.post("/api/lock", (req, res) => {
  const { sessionId, locked } = req.body;
  const session = sessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: "Player not found" });
  }

  session.locked = locked;
  
  try {
    session.ws.send(JSON.stringify({ 
      type: "lock_status", 
      locked 
    }));
    console.log(`${locked ? "🔒" : "🔓"} Player ${sessionId} ${locked ? 'locked' : 'unlocked'}`);
    res.json({ success: true });
  } catch (err) {
    console.error("Error sending lock status:", err);
    res.status(500).json({ error: "Failed to send lock status" });
  }
});

// Reset a player's progress
app.post("/api/reset", (req, res) => {
  const { sessionId } = req.body;
  const session = sessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: "Player not found" });
  }

  session.progress = {};
  
  try {
    session.ws.send(JSON.stringify({ type: "reset" }));
    console.log(`🔄 Reset progress for ${sessionId}`);
    res.json({ success: true });
  } catch (err) {
    console.error("Error sending reset:", err);
    res.status(500).json({ error: "Failed to send reset" });
  }
});

// Track event from client
app.post("/api/event", (req, res) => {
  const { sessionId, event, details } = req.body;
  
  if (!analytics[event]) {
    analytics[event] = [];
  }
  
  analytics[event].push({
    sessionId,
    ...details,
    timestamp: Date.now()
  });
  
  res.json({ success: true });
});

// Admin: Get analytics (requires password)
app.post("/api/admin/analytics", (req, res) => {
  const { password } = req.body;
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  // Calculate statistics
  const attempts = analytics.attempt || [];
  const completions = analytics.complete || [];
  const locked = analytics.locked || [];
  const hints = analytics.hint || [];
  
  // Calculate completion times by difficulty
  const completionsByDiff = {
    easy: completions.filter(c => c.difficulty === 'easy'),
    medium: completions.filter(c => c.difficulty === 'medium'),
    hard: completions.filter(c => c.difficulty === 'hard')
  };
  
  const calcStats = (arr) => {
    if (arr.length === 0) return { best: 0, avg: 0 };
    const times = arr.map(c => c.time).filter(t => t);
    return {
      best: times.length ? Math.min(...times) : 0,
      avg: times.length ? Math.floor(times.reduce((a, b) => a + b, 0) / times.length) : 0
    };
  };
  
  const easyStats = calcStats(completionsByDiff.easy);
  const mediumStats = calcStats(completionsByDiff.medium);
  const hardStats = calcStats(completionsByDiff.hard);
  
  // Recent activity (last 50 events)
  const allEvents = [
    ...attempts.map(e => ({ ...e, type: 'attempt' })),
    ...completions.map(e => ({ ...e, type: 'complete' })),
    ...locked.map(e => ({ ...e, type: 'locked' })),
    ...hints.map(e => ({ ...e, type: 'hint' }))
  ].sort((a, b) => b.timestamp - a.timestamp).slice(0, 50);
  
  res.json({
    totalSessions: sessions.size,
    totalAttempts: attempts.length,
    totalCompletions: completions.length,
    totalLocked: locked.length,
    totalHints: hints.length,
    bestTimeEasy: easyStats.best,
    avgTimeEasy: easyStats.avg,
    bestTimeMedium: mediumStats.best,
    avgTimeMedium: mediumStats.avg,
    bestTimeHard: hardStats.best,
    avgTimeHard: hardStats.avg,
    recentActivity: allEvents,
    completionTimes: completions.sort((a, b) => b.timestamp - a.timestamp).slice(0, 20)
  });
});

// Admin: Get all sessions
app.post("/api/admin/sessions", (req, res) => {
  const { password } = req.body;
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  const allSessions = Array.from(sessions.entries()).map(([id, session]) => ({
    sessionId: id,
    locked: session.locked,
    progress: session.progress,
    startTime: session.startTime,
    lastActivity: session.lastActivity
  }));
  
  res.json({
    sessions: allSessions,
    analytics
  });
});

// Admin: Clear all data
app.post("/api/admin/clear", (req, res) => {
  const { password } = req.body;
  
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  analytics = {
    attempts: [],
    completions: [],
    locked: [],
    hints: []
  };
  
  console.log("🗑️ All analytics data cleared");
  res.json({ success: true });
});

// Health check
app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy", 
    sessions: sessions.size,
    uptime: process.uptime()
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
  console.log(`📊 Admin panel: http://localhost:${PORT}/admin`);
  console.log(`🎮 Game: http://localhost:${PORT}/`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
