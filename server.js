// server.js - Backend for Locked Dungeon Admin Dashboard
// Run with: node server.js

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve your HTML file from 'public' folder

// Simple file-based database (data.json)
const DATA_FILE = path.join(__dirname, 'data.json');

// Initialize data file if it doesn't exist
function initDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
      sessions: [],
      attempts: [],
      completions: [],
      hints: [],
      locked: []
    }, null, 2));
  }
}

// Read data
function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (error) {
    console.error('Error reading data:', error);
    return { sessions: [], attempts: [], completions: [], hints: [], locked: [] };
  }
}

// Write data
function writeData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error writing data:', error);
  }
}

// Generate unique session ID
function generateSessionId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// ===== API ENDPOINTS =====

// Get or create session
app.post('/api/session', (req, res) => {
  const data = readData();
  const sessionId = generateSessionId();

  const session = {
    id: sessionId,
    startTime: Date.now(),
    userAgent: req.headers['user-agent'],
    ip: req.ip
  };

  data.sessions.push(session);
  writeData(data);

  res.json({ sessionId });
});

// Track attempt (when user starts game)
app.post('/api/track/attempt', (req, res) => {
  const { sessionId, difficulty } = req.body;
  const data = readData();

  data.attempts.push({
    sessionId,
    difficulty,
    timestamp: Date.now()
  });

  writeData(data);
  res.json({ success: true });
});

// Track completion (when user wins)
app.post('/api/track/complete', (req, res) => {
  const { sessionId, difficulty, time, hintsUsed } = req.body;
  const data = readData();

  data.completions.push({
    sessionId,
    difficulty,
    time,
    hintsUsed,
    timestamp: Date.now()
  });

  writeData(data);
  res.json({ success: true });
});

// Track hint usage
app.post('/api/track/hint', (req, res) => {
  const { sessionId, riddle, difficulty } = req.body;
  const data = readData();

  data.hints.push({
    sessionId,
    riddle,
    difficulty,
    timestamp: Date.now()
  });

  writeData(data);
  res.json({ success: true });
});

// Track locked users
app.post('/api/track/locked', (req, res) => {
  const { sessionId, tabSwitches, difficulty } = req.body;
  const data = readData();

  data.locked.push({
    sessionId,
    tabSwitches,
    difficulty,
    timestamp: Date.now()
  });

  writeData(data);
  res.json({ success: true });
});

// Admin: Get all analytics (requires password)
app.post('/api/admin/analytics', (req, res) => {
  const { password } = req.body;

  // Simple password check
  if (password !== 'Aakshatadmin') {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const data = readData();

  // Calculate statistics
  const stats = {
    totalSessions: data.sessions.length,
    totalAttempts: data.attempts.length,
    totalCompletions: data.completions.length,
    totalLocked: data.locked.length,
    totalHints: data.hints.length,

    // Completion times
    completionTimes: data.completions.map(c => ({
      time: c.time,
      difficulty: c.difficulty,
      hintsUsed: c.hintsUsed,
      timestamp: c.timestamp
    })),

    // Average time by difficulty
    avgTimeEasy: calculateAvgTime(data.completions, 'easy'),
    avgTimeMedium: calculateAvgTime(data.completions, 'medium'),
    avgTimeHard: calculateAvgTime(data.completions, 'hard'),

    // Best times
    bestTimeEasy: calculateBestTime(data.completions, 'easy'),
    bestTimeMedium: calculateBestTime(data.completions, 'medium'),
    bestTimeHard: calculateBestTime(data.completions, 'hard'),

    // Recent activity (last 50)
    recentActivity: [
      ...data.attempts.map(a => ({ type: 'attempt', ...a })),
      ...data.completions.map(c => ({ type: 'completion', ...c })),
      ...data.locked.map(l => ({ type: 'locked', ...l })),
      ...data.hints.map(h => ({ type: 'hint', ...h }))
    ].sort((a, b) => b.timestamp - a.timestamp).slice(0, 50)
  };

  res.json(stats);
});

// Admin: Get detailed session data
app.post('/api/admin/sessions', (req, res) => {
  const { password } = req.body;

  if (password !== 'Aakshatadmin') {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const data = readData();
  res.json(data);
});

// Admin: Clear all data
app.post('/api/admin/clear', (req, res) => {
  const { password } = req.body;

  if (password !== 'Aakshatadmin') {
    return res.status(401).json({ error: 'Invalid password' });
  }

  writeData({
    sessions: [],
    attempts: [],
    completions: [],
    hints: [],
    locked: []
  });

  res.json({ success: true });
});

// Helper functions
function calculateAvgTime(completions, difficulty) {
  const filtered = completions.filter(c => c.difficulty === difficulty);
  if (filtered.length === 0) return 0;
  const sum = filtered.reduce((acc, c) => acc + c.time, 0);
  return Math.floor(sum / filtered.length);
}

function calculateBestTime(completions, difficulty) {
  const filtered = completions.filter(c => c.difficulty === difficulty);
  if (filtered.length === 0) return null;
  return Math.min(...filtered.map(c => c.time));
}

// Initialize and start server
initDataFile();

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║   🎃 Locked Dungeon Server Running 🎃    ║
╠═══════════════════════════════════════════╣
║  Server: http://localhost:${PORT}          ║
║  Admin: http://localhost:${PORT}/admin.html║
╚═══════════════════════════════════════════╝
  `);
});
