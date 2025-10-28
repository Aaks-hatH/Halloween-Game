// Complete game.js file - Place this in your public folder
(function() {
  'use strict';
  
  const WS_URL = "wss://halloween-game-1.onrender.com";
  let ws = null;
  let sessionId = null;
  let playerName = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 5;
  let isConnected = false;
  let gameStarted = false;
  let pending2FARequest = false;

  const ENCRYPTED_ADMIN_PASS = atob('QWFrc2hhdGFkbWlu');
  let isAdminAuthenticated = false;
  
  function decrypt(encoded) {
    return atob(encoded);
  }
  
  const riddlesByDifficulty = {
    easy: [
      {id: 1, title: "Riddle 1", text: "I have no body, but I can appear,\nI whisper in your ear, but vanish near.\n\nYou'll feel my chill though I am air,\nWhat am I, haunting everywhere?", answer: decrypt('Rw==')},
      {id: 2, title: "Riddle 2", text: "I am full of ghosts, cobwebs, and fright,\nPeople visit me on Halloween night.\nDark and spooky is my style,\nWhat am I?", answer: decrypt('SA==')},
      {id: 3, title: "Riddle 3", text: "Round and hollow, dark my core,\nI open wide but have no door.\nWithout me, faces cannot see\nWhat letter am I meant to be?\n(Hint: The letter is a Shape)", answer: decrypt('Tw==')},
      {id: 4, title: "Riddle 4", text: "Neither living nor quite dead,\nI rise again when moonlight's shed.\nI shamble slow, with vacant hue\nGuess my name.", answer: decrypt('VQ==')},
      {id: 5, title: "Riddle 5", text: "I live inside a haunted flame,\nWithout me, dark would rule the game.\nI flicker soft, I guard your soul\nWhat am I, with shining role?", answer: decrypt('TA==')}
    ],
    medium: [
      {id: 1, title: "Riddle 1", text: "I have no body, but I can appear,\nI whisper in your ear, but vanish near.\n\nYou'll feel my chill though I am air,\nWhat am I, haunting everywhere?", answer: decrypt('Rw==')},
      {id: 2, title: "Riddle 2", text: "I am full of ghosts, cobwebs, and fright,\nPeople visit me on Halloween night.\nDark and spooky is my style,\nWhat am I?", answer: decrypt('SA==')},
      {id: 3, title: "Riddle 3", text: "Round and hollow, dark my core,\nI open wide but have no door.\nWithout me, faces cannot see\nWhat letter am I meant to be?", answer: decrypt('Tw==')},
      {id: 4, title: "Riddle 4", text: "Neither living nor quite dead,\nI rise again when moonlight's shed.\nI shamble slow, with vacant hue\nGuess my name.", answer: decrypt('VQ==')},
      {id: 5, title: "Riddle 5", text: "I live inside a haunted flame,\nWithout me, dark would rule the game.\nI flicker soft, I guard your soul\nWhat am I, with shining role?", answer: decrypt('TA==')}
    ],
    hard: [
      {id: 1, title: "Riddle 1", text: "I have no body, but I can appear,\nI whisper in your ear, but vanish near.\n\nYou'll feel my chill though I am air,\nWhat am I, haunting everywhere?", answer: decrypt('Rw==')},
      {id: 2, title: "Riddle 2", text: "I am full of ghosts, cobwebs, and fright,\nPeople visit me on Halloween night.\nDark and spooky is my style,\nWhat am I?", answer: decrypt('SA==')},
      {id: 3, title: "Riddle 3", text: "Round and hollow, dark my core,\nI open wide but have no door.\nWithout me, faces cannot see\nWhat letter am I meant to be?", answer: decrypt('Tw==')},
      {id: 4, title: "Riddle 4", text: "Neither living nor quite dead,\nI rise again when moonlight's shed.\nI shamble slow, with vacant hue\nGuess my name.", answer: decrypt('VQ==')},
      {id: 5, title: "Riddle 5", text: "I live inside a haunted flame,\nWithout me, dark would rule the game.\nI flicker soft, I guard your soul\nWhat am I, with shining role?", answer: decrypt('TA==')}
    ]
  };
  
  const hints = {
    "1": "Think of a chilling presence that has no physical body.",
    "2": "A place people visit on Halloween where scary things are displayed, two words.",
    "3": "A round letter that is also a shape.",
    "4": "A word for the category a walking dead creature is classified as.",
    "5": "A source of flickering illumination that keeps the dark away."
  };
  
  let riddles = [];
  let difficulty = null;
  let maxLives = 0;
  let lives = 0;
  let timeLimit = 0;
  let startTime = null;
  let timerInterval = null;
  let hintsUsed = 0;
  let totalHints = 0;
  let hintsRemaining = 0;
  
  const solved = {1:false, 2:false, 3:false, 4:false, 5:false};
  let tabSwitchCount = 0;
  let firstWarningShown = false;
  let isLocked = false;

  function sanitizeInput(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[<>"'`;&|*$(){}[\]]/g, '').trim().slice(0, 100);
  }

  function safeSetItem(key, value) {
    try {
      const sanitizedKey = sanitizeInput(key);
      const sanitizedValue = typeof value === 'string' ? value : JSON.stringify(value);
      localStorage.setItem(sanitizedKey, sanitizedValue);
      return true;
    } catch (e) {
      console.error('Storage error:', e);
      return false;
    }
  }

  function safeGetItem(key) {
    try {
      const sanitizedKey = sanitizeInput(key);
      return localStorage.getItem(sanitizedKey);
    } catch (e) {
      console.error('Storage error:', e);
      return null;
    }
  }

  function connectWebSocket() {
    console.log('🔌 Attempting to connect to:', WS_URL);
    
    try {
      ws = new WebSocket(WS_URL);
    } catch (err) {
      console.error('❌ Failed to create WebSocket:', err);
      isConnected = false;
      return;
    }

    ws.onopen = () => {
      console.log("✅ Connected to backend");
      isConnected = true;
      reconnectAttempts = 0;
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        console.log('📨 Received:', msg);
        
        if (msg.type === "session_id") {
          sessionId = msg.sessionId;
          gameStarted = msg.gameStarted;
          console.log('🆔 Session ID:', sessionId);
          console.log('🎮 Game Started:', gameStarted);
          
          if (!gameStarted) {
            showWaitingScreen();
          }
          
          if (playerName) {
            sendPlayerName();
          }
          
          showSessionId();
        }
        
        if (msg.type === "game_started") {
          gameStarted = true;
          hideWaitingScreen();
          alert("🎮 The game has started! Good luck!");
          
          if (playerName && !difficulty) {
            showDifficultyScreen();
          }
        }
        
        if (msg.type === "game_stopped") {
          gameStarted = false;
          showWaitingScreen();
          alert("⏹️ The game has been stopped by admin.");
        }
        
        if (msg.type === "lock_status" && msg.locked) {
          alert("🔒 Your session was locked by admin!");
          lockPage();
        }
        
        if (msg.type === "lock_status" && !msg.locked) {
          localStorage.removeItem('dungeon_locked');
          localStorage.removeItem('tab_switch_count');
          alert("🔓 Unlocked by admin! Reloading...");
          setTimeout(() => location.reload(), 500);
        }
        
        if (msg.type === "reset") {
          alert("🔄 Progress reset by admin!");
          localStorage.clear();
          location.reload();
        }
        
        if (msg.type === "admin_login_response") {
          handle2FAResponse(msg);
        }
      } catch (err) {
        console.error('❌ Message error:', err);
      }
    };

    ws.onclose = (event) => {
      console.log('🔴 Disconnected');
      isConnected = false;
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        setTimeout(connectWebSocket, 2000 * (reconnectAttempts + 1));
        reconnectAttempts++;
      }
    };

    ws.onerror = (error) => {
      console.error('❌ WebSocket error:', error);
    };
  }

  function showWaitingScreen() {
    let waitScreen = document.getElementById('waitingScreen');
    if (!waitScreen) {
      waitScreen = document.createElement('div');
      waitScreen.id = 'waitingScreen';
      waitScreen.className = 'difficulty-screen';
      waitScreen.innerHTML = `
        <div class="difficulty-content">
          <h2 style="margin-bottom: 20px; font-size: 2.5rem;">⏳ Waiting for Admin</h2>
          <p style="margin-bottom: 30px; font-size: 1.2rem; color: #ffb366;">
            The game hasn't started yet.<br><br>
            Please wait for the admin to start the game.
          </p>
          <div style="text-align: center;">
            <div style="display: inline-block; width: 50px; height: 50px; border: 5px solid #ff8c00; border-top: 5px solid transparent; border-radius: 50%; animation: spin 1s linear infinite;"></div>
          </div>
        </div>
      `;
      document.body.appendChild(waitScreen);
    }
  }

  function hideWaitingScreen() {
    const waitScreen = document.getElementById('waitingScreen');
    if (waitScreen) waitScreen.remove();
  }

  function handle2FAResponse(msg) {
    if (msg.success) {
      alert('✅ Admin access granted!');
      pending2FARequest = false;
      isAdminAuthenticated = true;
      document.getElementById('adminLogin').style.display = 'none';
      document.getElementById('adminContent').style.display = 'block';
      document.getElementById('adminStats').style.display = 'block';
      document.getElementById('adminControls').style.display = 'block';
      updateAdminStats();
      
      if (ws && isConnected) {
        ws.send(JSON.stringify({ type: "admin_authenticated" }));
      }
    } else if (msg.reason === "pending_approval") {
      pending2FARequest = true;
      alert('⏳ Waiting for admin approval...\n\nThe current admin must approve your access request.');
    } else {
      alert('❌ Admin access denied: ' + (msg.reason || 'Unknown error'));
      pending2FARequest = false;
    }
  }

  function sendPlayerName() {
    if (!ws || !isConnected || !sessionId || !playerName) return;
    try {
      ws.send(JSON.stringify({
        type: "set_name",
        playerName: playerName
      }));
      console.log('📤 Player name sent:', playerName);
    } catch (err) {
      console.error('Failed to send player name:', err);
    }
  }

  function showSessionId() {
    if (!sessionId) return;
    let display = document.getElementById('sessionDisplay');
    if (!display) {
      display = document.createElement('div');
      display.id = 'sessionDisplay';
      display.style.cssText = `
        position: fixed; bottom: 80px; right: 20px;
        background: rgba(20,20,20,0.9); border: 2px solid #ff8c00;
        border-radius: 10px; padding: 10px 15px; z-index: 10000;
        font-size: 0.9rem; color: #ff8c00; font-family: 'Creepster', cursive;
      `;
      document.body.appendChild(display);
    }
    if (playerName) {
      display.innerHTML = `👤 ${playerName}`;
    } else {
      display.innerHTML = `🆔 ${sessionId.slice(0, 8)}`;
    }
  }

  function sendProgressUpdate() {
    if (!ws || !isConnected || !sessionId) return;
    try {
      ws.send(JSON.stringify({
        type: "progress_update",
        progress: { 
          difficulty, 
          solved, 
          lives, 
          startTime, 
          hintsUsed, 
          tabSwitchCount,
          playerName
        }
      }));
    } catch (err) {
      console.error('Failed to send progress:', err);
    }
  }

  function trackEventBackend(event, details = {}) {
    if (!ws || !isConnected) return;
    try {
      ws.send(JSON.stringify({
        type: "event",
        event: event,
        details: { 
          ...details, 
          sessionId,
          playerName
        }
      }));
    } catch (err) {
      console.error('Failed to track:', err);
    }
  }

  function showNamePrompt() {
    const savedName = safeGetItem('player_name');
    if (savedName) {
      playerName = savedName;
      showSessionId();
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'difficulty-screen';
    overlay.innerHTML = `
      <div class="difficulty-content">
        <h2 style="margin-bottom: 20px; font-size: 2.5rem;">👻 Welcome to the Dungeon 👻</h2>
        <p style="margin-bottom: 30px; font-size: 1.2rem; color: #ffb366;">What shall we call you, brave soul?</p>
        <input 
          type="text" 
          id="nameInput" 
          placeholder="Enter your name" 
          maxlength="20"
          style="width: 100%; padding: 15px; margin-bottom: 20px; font-size: 1.3rem;"
          autofocus
        >
        <button class="difficulty-btn" onclick="submitName()">
          Continue
        </button>
        <p style="margin-top: 15px; font-size: 0.9rem; color: #cc7700; font-style: italic;">
          This name will be visible to the game master
        </p>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('nameInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        window.submitName();
      }
    });
  }

  window.submitName = function() {
    const nameInput = document.getElementById('nameInput');
    const name = sanitizeInput(nameInput.value || '').trim();
    
    if (!name || name.length < 2) {
      alert('Please enter a name (at least 2 characters)');
      return;
    }
    
    playerName = name;
    safeSetItem('player_name', playerName);
    
    const overlay = document.querySelector('.difficulty-screen');
    if (overlay) overlay.remove();
    
    if (sessionId && isConnected) {
      sendPlayerName();
    }
    
    showSessionId();
    
    if (gameStarted) {
      showDifficultyScreen();
    } else {
      showWaitingScreen();
    }
  };

  try {
    connectWebSocket();
  } catch (err) {
    console.log('⚠️ Could not connect to backend');
  }

  setInterval(() => {
    if (ws && isConnected) {
      ws.send(JSON.stringify({ type: "ping" }));
    }
  }, 30000);

  // Continue with the rest of game functions...
  // (Due to length limits, copy the remaining functions from the complete_fixed_index artifact)
  // This includes: trackEvent, formatTime, showDifficultyScreen, selectDifficulty,
  // saveProgress, loadProgress, renderRiddles, checkRiddle, etc.
  
  function init() {
    const wasLocked = checkInitialLock();
    if (wasLocked) return;
    
    const hasProgress = loadProgress();
    
    if (!hasProgress && !difficulty) {
      const savedName = safeGetItem('player_name');
      if (savedName) {
        playerName = savedName;
        if (gameStarted) {
          showDifficultyScreen();
        }
      } else {
        showNamePrompt();
      }
    } else if (difficulty) {
      const savedName = safeGetItem('player_name');
      if (savedName) {
        playerName = savedName;
      }
      
      if (gameStarted) {
        renderRiddles();
        updateProgressDisplay();
        updateLivesDisplay();
        startTimer();
      } else {
        showWaitingScreen();
      }
    }
  }

  init();

})();

function saveProgress() {
    try {
      const progress = {
        difficulty,
        solved,
        lives,
        startTime,
        timeLimit,
        hintsUsed,
        hintsRemaining,
        tabSwitchCount
      };
      safeSetItem('dungeon_progress', JSON.stringify(progress));
      
      // SEND TO BACKEND
      sendProgressUpdate();
    } catch (e) {
      console.error('Save error:', e);
    }
  }

  function loadProgress() {
    try {
      const saved = safeGetItem('dungeon_progress');
      if (!saved) return false;
      
      const progress = JSON.parse(saved);
      if (!progress.difficulty) return false;
      
      difficulty = sanitizeInput(progress.difficulty);
      if (!['easy', 'medium', 'hard'].includes(difficulty)) return false;
      
      riddles = riddlesByDifficulty[difficulty];
      Object.assign(solved, progress.solved);
      lives = parseInt(progress.lives) || maxLives;
      hintsUsed = parseInt(progress.hintsUsed) || 0;
      hintsRemaining = parseInt(progress.hintsRemaining) || 0;
      tabSwitchCount = parseInt(progress.tabSwitchCount) || 0;
      startTime = progress.startTime;
      timeLimit = parseInt(progress.timeLimit) || 0;
      
      switch(difficulty) {
        case 'easy': 
          maxLives = 999;
          totalHints = 2;
          break;
        case 'medium': 
          maxLives = 5;
          totalHints = 1;
          break;
        case 'hard': 
          maxLives = 3;
          totalHints = 0;
          break;
      }
      
      return true;
    } catch (e) {
      console.error('Load error:', e);
      return false;
    }
  }

  function checkInitialLock() {
    try {
      const locked = safeGetItem('dungeon_locked');
      if (locked === 'true') {
        const count = parseInt(safeGetItem('tab_switch_count') || '5');
        showPermanentLock(count);
        return true;
      }
    } catch (e) {
      console.error('Storage error:', e);
    }
    return false;
  }

  function stripZeroWidth(str) {
    return str.replace(/[\u200B\u200C\u200D\uFEFF\u2060]/g, '');
  }

  function updateLivesDisplay() {
    if (maxLives === 999) {
      document.getElementById('livesDisplay').innerHTML = '';
    } else {
      const hearts = '❤️'.repeat(lives) + '💔'.repeat(maxLives - lives);
      document.getElementById('livesDisplay').innerHTML = hearts;
    }
  }

  function createRiddleCard(r) {
    const card = document.createElement('div');
    card.className = 'riddle-card';
    card.id = 'card-' + r.id;

    const h = document.createElement('h3');
    h.textContent = r.title;
    h.style.marginBottom = '12px';
    card.appendChild(h);

    const riddleText = document.createElement('div');
    riddleText.className = 'riddle-text no-select';
    riddleText.textContent = r.text;
    card.appendChild(riddleText);

    const controls = document.createElement('div');
    controls.className = 'riddle-controls';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'answer' + r.id;
    input.placeholder = 'Your answer';
    input.autocomplete = 'off';
    input.spellcheck = false;

    input.addEventListener('paste', (ev) => {
      ev.preventDefault();
      alert('Pasting is disabled. Please type your answer.');
    });
    input.addEventListener('copy', (ev) => ev.preventDefault());
    input.addEventListener('cut', (ev) => ev.preventDefault());

    const submit = document.createElement('button');
    submit.textContent = 'Submit';
    submit.onclick = () => checkRiddle(r.id);

    const feedback = document.createElement('div');
    feedback.className = 'feedback';
    feedback.id = 'feedback' + r.id;

    controls.appendChild(input);
    controls.appendChild(submit);
    card.appendChild(controls);
    card.appendChild(feedback);

    return card;
  }

  function renderRiddles() {
    const container = document.getElementById('riddleContainer');
    riddles.forEach(r => {
      container.appendChild(createRiddleCard(r));
    });
  }

  function updateProgressDisplay() {
    const solvedCount = Object.values(solved).filter(Boolean).length;
    const pct = (solvedCount/5) * 100;
    document.getElementById('progressFill').style.width = pct + '%';
    document.getElementById('progressFill').textContent = `${solvedCount}/5`;
    document.getElementById('progressText').textContent = `${solvedCount} / 5 solved`;
  }

  function checkRiddle(id) {
    if (isLocked) {
      alert('Page is locked due to excessive tab switching.');
      return;
    }
    
    const inp = document.getElementById('answer' + id);
    const fb = document.getElementById('feedback' + id);
    if (!inp) return;
    
    let val = sanitizeInput(inp.value || '').trim();
    val = stripZeroWidth(val);
    
    if (!val) {
      fb.style.color = '#ff4444';
      fb.textContent = 'Please type an answer.';
      return;
    }
    
    const first = val[0].toUpperCase();
    const riddle = riddles.find(r => r.id === id);
    if (!riddle) return;
    
    const expected = riddle.answer.toUpperCase();
    
    if (first === expected) {
      solved[id] = true;
      fb.style.color = '#00cc66';
      fb.textContent = '✓ Correct — nice work.';
      inp.disabled = true;
      const card = document.getElementById('card-' + id);
      if (card) card.classList.add('solved');
      updateProgressDisplay();
      saveProgress();
    } else {
      lives--;
      updateLivesDisplay();
      fb.style.color = '#ff4444';
      fb.textContent = '✗ Incorrect — try again.';
      
      if (lives <= 0) {
        endGame(false, 'You have run out of lives! The dungeon claims your soul...');
      }
      
      setTimeout(() => { fb.textContent = ''; }, 3000);
      saveProgress();
    }
  }

  function getFinalCode() {
    return riddles.map(r => r.answer[0].toUpperCase()).join('');
  }

  function endGame(success, message) {
    stopTimer();
    isLocked = true;
    
    document.querySelectorAll('input, button').forEach(el => {
      if (!el.closest('.admin-panel') && el.id !== 'adminToggle') {
        el.disabled = true;
      }
    });
    
    const res = document.getElementById('result');
    res.style.color = success ? '#00cc66' : '#ff4444';
    res.textContent = message;
    
    if (success) {
      const time = getElapsedTime();
      trackEvent('complete', {difficulty, time, hintsUsed});
      safeSetItem('dungeon_progress', '');
    }
  }

  document.getElementById('unlockBtn').addEventListener('click', () => {
    if (isLocked) {
      alert('Page is locked due to excessive tab switching.');
      return;
    }
    const codeInput = document.getElementById('codeInput');
    const res = document.getElementById('result');
    let entered = sanitizeInput(codeInput.value || '').trim().toUpperCase();
    entered = stripZeroWidth(entered);
    
    if (!entered) {
      res.style.color = '#ff8c00';
      res.textContent = 'Enter the 5-letter code to escape!';
      return;
    }
    if (entered.length !== 5) {
      res.style.color = '#ff4444';
      res.textContent = 'Code must be 5 letters.';
      return;
    }
    
    const target = getFinalCode();
    if (entered === target) {
      endGame(true, '🎉 You have escaped the dungeon! The spirits bow to your wisdom. 🎉');
      showShareButton();
    } else {
      lives--;
      updateLivesDisplay();
      res.style.color = '#ff4444';
      res.textContent = '❌ Wrong code... The dungeon remains locked.';
      
      if (lives <= 0) {
        endGame(false, 'You have run out of lives! The dungeon claims your soul...');
      }
      saveProgress();
    }
  });

  function showShareButton() {
    const time = getElapsedTime();
    const res = document.getElementById('result');
    const shareBtn = document.createElement('button');
    shareBtn.className = 'share-btn';
    shareBtn.textContent = '📤 Share Your Victory';
    shareBtn.onclick = () => {
      const text = `I escaped the Locked Dungeon in ${formatTime(time)} on ${difficulty} mode! 💀🎃 Can you beat my time?`;
      if (navigator.share) {
        navigator.share({title: 'Locked Dungeon Victory', text});
      } else {
        navigator.clipboard.writeText(text);
        alert('Victory message copied to clipboard!');
      }
    };
    res.appendChild(document.createElement('br'));
    res.appendChild(shareBtn);
  }

  document.getElementById('codeInput').addEventListener('paste', (ev) => {
    ev.preventDefault();
    alert('Pasting is disabled. Please type your answer.');
  });

  document.getElementById('hintBtn').addEventListener('click', () => {
    const hb = document.getElementById('hintBox');
    
    if (hintsRemaining <= 0) {
      hb.style.display = 'block';
      hb.innerHTML = `<p class="no-select" style="font-family: Creepster, cursive, sans-serif; font-size: 1.2rem;">⛔ No hints remaining! (${hintsUsed}/${totalHints} used)</p>`;
      return;
    }
    
    const rn = prompt('Which riddle do you want a hint for? (1-5)');
    
    if (!rn) {
      hb.style.display = 'none'; 
      hb.innerHTML = '';
      return;
    }
    
    const n = parseInt(sanitizeInput(rn));
    
    if (n < 1 || n > 5 || !hints[n]) {
      hb.style.display = 'block';
      hb.innerHTML = `<p class="no-select" style="font-family: Creepster, cursive, sans-serif; font-size: 1.2rem;">That riddle doesn't exist — try a number from 1 to 5.</p>`;
      return;
    }
    
    hb.style.display = 'block';
    hb.innerHTML = `<p class="no-select" style="font-family: Creepster, cursive, sans-serif; font-size: 1.2rem;">💡 Hint for Riddle ${n}: ${hints[n]}<br><br>Hints remaining: ${hintsRemaining - 1}/${totalHints}</p>`;
    hintsRemaining--;
    hintsUsed++;
    trackEvent('hint', {riddle: n, difficulty});
    saveProgress();
  });

  document.getElementById('adminToggle').addEventListener('click', () => {
    document.getElementById('adminPanel').classList.toggle('active');
  });

  window.adminLogin = function() {
    const pass = sanitizeInput(document.getElementById('adminPassword').value);
    if (pass === ENCRYPTED_ADMIN_PASS) {
      isAdminAuthenticated = true;
      document.getElementById('adminLogin').style.display = 'none';
      document.getElementById('adminContent').style.display = 'block';
      document.getElementById('adminStats').style.display = 'block';
      document.getElementById('adminControls').style.display = 'block';
      updateAdminStats();
    } else {
      alert('Incorrect password!');
    }
  };

  window.closeAdmin = function() {
    document.getElementById('adminPanel').classList.remove('active');
  };

  function updateAdminStats() {
    const stats = getAnalytics();
    document.getElementById('statAttempts').textContent = stats.attempts;
    document.getElementById('statCompletions').textContent = stats.completions;
    document.getElementById('statLocked').textContent = stats.locked;
    document.getElementById('statAvgTime').textContent = formatTime(Math.floor(stats.avgTime));
    document.getElementById('statBestTime').textContent = stats.bestTime ? formatTime(stats.bestTime) : '--';
    document.getElementById('statHints').textContent = stats.hints;
  }

  window.resetProgress = function() {
    if (!isAdminAuthenticated) {
      alert('Admin authentication required!');
      return;
    }
    if (confirm('Reset current progress? This will restart the game.')) {
      safeSetItem('dungeon_progress', '');
      location.reload();
    }
  };

  window.unlockUser = function() {
    if (!isAdminAuthenticated) {
      alert('Admin authentication required!');
      return;
    }
    if (confirm('Unlock this user and allow them to play again?')) {
      safeSetItem('dungeon_locked', '');
      safeSetItem('tab_switch_count', '');
      location.reload();
    }
  };

  window.clearAllData = function() {
    if (!isAdminAuthenticated) {
      alert('Admin authentication required!');
      return;
    }
    if (confirm('Clear all analytics data? This cannot be undone!')) {
      safeSetItem('dungeon_analytics', '');
      updateAdminStats();
      alert('Analytics cleared!');
    }
  };

  window.exportData = function() {
    if (!isAdminAuthenticated) {
      alert('Admin authentication required!');
      return;
    }
    const analytics = safeGetItem('dungeon_analytics') || '{}';
    const blob = new Blob([analytics], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dungeon-analytics-' + Date.now() + '.json';
    a.click();
  };

  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    return false;
  });

  document.addEventListener('keydown', (e) => {
    if (
      (e.ctrlKey && (e.key === 'c' || e.key === 'C')) ||
      (e.ctrlKey && (e.key === 'x' || e.key === 'X')) ||
      (e.ctrlKey && (e.key === 'u' || e.key === 'U')) ||
      (e.ctrlKey && e.shiftKey && (e.key === 'i' || e.key === 'I')) ||
      (e.ctrlKey && e.shiftKey && (e.key === 'j' || e.key === 'J')) ||
      (e.ctrlKey && e.shiftKey && (e.key === 'c' || e.key === 'C')) ||
      e.key === 'F12'
    ) {
      e.preventDefault();
      return false;
    }
  });

  document.body.classList.add('no-select');
  const inputs = document.querySelectorAll('input[type="text"]');
  inputs.forEach(input => {
    input.style.userSelect = 'text';
    input.style.webkitUserSelect = 'text';
  });

  document.addEventListener('visibilitychange', () => {
    if (isLocked) return;
    
    if (document.hidden) {
      tabSwitchCount++;
      saveProgress();
      
      if (tabSwitchCount >= 5) {
        lockPage();
      }
    } else {
      if (tabSwitchCount === 1 && !firstWarningShown) {
        showWarning(
          '⚠️ WARNING ⚠️',
          `Tab switching detected!<br><br>Using external help (like ChatGPT) defeats the purpose of this puzzle.<br><br>Try to solve it yourself!`,
          `Switches detected: ${tabSwitchCount}<br><strong style="color: #ff4444;">After 5 switches, the page will be PERMANENTLY LOCKED!</strong>`
        );
        firstWarningShown = true;
      } else if (tabSwitchCount >= 3 && tabSwitchCount < 5) {
        showWarning(
          '🚨 FINAL WARNING 🚨',
          `You have switched tabs ${tabSwitchCount} times!<br><br>One more switch and the page will be PERMANENTLY LOCKED!<br><br><strong style="color: #ff0000;">Even refreshing won't help!</strong>`,
          `Switches remaining: ${5 - tabSwitchCount}`
        );
      }
    }
  });

  function showWarning(title, message, footer) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0, 0, 0, 0.95); display: flex;
      align-items: center; justify-content: center; z-index: 10000;
      animation: fadeIn 0.3s ease;
    `;

    const warningBox = document.createElement('div');
    warningBox.style.cssText = `
      background: linear-gradient(135deg, rgba(139, 0, 0, 0.95), rgba(70, 0, 0, 0.95));
      border: 3px solid #ff4444; border-radius: 20px; padding: 40px;
      max-width: 500px; text-align: center;
      box-shadow: 0 0 50px rgba(255, 68, 68, 0.5);
    `;

    warningBox.innerHTML = `
      <h2 style="color: #ff4444; font-size: 2rem; margin-bottom: 20px; font-family: Creepster, cursive;">${title}</h2>
      <p style="color: #ffaa66; font-size: 1.3rem; margin-bottom: 20px; line-height: 1.8; font-family: Creepster, cursive;">
        ${message}
      </p>
      <p style="color: #ff8c00; font-size: 1.1rem; margin-bottom: 25px; font-family: Creepster, cursive;">
        ${footer}
      </p>
      <button id="acknowledgeBtn" style="
        padding: 15px 30px; font-size: 1.3rem; border-radius: 12px;
        border: none; background: linear-gradient(135deg, #ff8c00, #ff6600);
        color: #0a0a0a; font-weight: bold; cursor: pointer;
        font-family: Creepster, cursive;
      ">I Understand</button>
    `;

    overlay.appendChild(warningBox);
    document.body.appendChild(overlay);
    
    const btn = warningBox.querySelector('#acknowledgeBtn');
    btn.onclick = () => overlay.remove();
  }

  function lockPage() {
    isLocked = true;
    stopTimer();
    
    try {
      safeSetItem('dungeon_locked', 'true');
      safeSetItem('tab_switch_count', tabSwitchCount.toString());
      trackEvent('locked', {tabSwitches: tabSwitchCount, difficulty});
    } catch (e) {
      console.error('Failed to save lock:', e);
    }
    
    showPermanentLock(tabSwitchCount);
  }

  function showPermanentLock(count) {
    isLocked = true;
    
    const overlay = document.createElement('div');
    overlay.id = 'lockOverlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(139, 0, 0, 0.98); display: flex;
      align-items: center; justify-content: center; z-index: 10000;
      animation: fadeIn 0.5s ease;
    `;

    const lockBox = document.createElement('div');
    lockBox.style.cssText = `
      background: linear-gradient(135deg, rgba(0, 0, 0, 0.95), rgba(70, 0, 0, 0.95));
      border: 4px solid #ff0000; border-radius: 20px; padding: 50px;
      max-width: 600px; text-align: center;
      box-shadow: 0 0 80px rgba(255, 0, 0, 0.8);
    `;

    lockBox.innerHTML = `
      <h1 style="color: #ff0000; font-size: 3rem; margin-bottom: 30px; font-family: Creepster, cursive;">🔒 PERMANENTLY LOCKED 🔒</h1>
      <p style="color: #ffaa66; font-size: 1.5rem; margin-bottom: 20px; line-height: 1.8; font-family: Creepster, cursive;">
        You have been caught switching tabs too many times!<br><br>
        The dungeon is now PERMANENTLY LOCKED.<br><br>
        Refreshing the page will not help.
      </p>
      <p style="color: #ff8c00; font-size: 1.3rem; font-family: Creepster, cursive; font-style: italic; margin-top: 30px;">
        Tab switches detected: ${count}
      </p>
    `;

    overlay.appendChild(lockBox);
    document.body.appendChild(overlay);
    
    const adminToggle = document.getElementById('adminToggle');
    const adminPanel = document.getElementById('adminPanel');
    if (adminToggle) adminToggle.style.zIndex = '10002';
    if (adminPanel) adminPanel.style.zIndex = '10003';
    
    document.querySelectorAll('input, button').forEach(el => {
      if (!el.closest('.admin-panel') && el.id !== 'adminToggle') {
        el.disabled = true;
      }
    });
  }

  function init() {
    const wasLocked = checkInitialLock();
    if (wasLocked) return;
    
    const hasProgress = loadProgress();
    
    if (!hasProgress && !difficulty) {
      // Check if player already has a name
      const savedName = safeGetItem('player_name');
      if (savedName) {
        playerName = savedName;
        showDifficultyScreen();
      } else {
        showNamePrompt();
      }
    } else if (difficulty) {
      // Load saved name if available
      const savedName = safeGetItem('player_name');
      if (savedName) {
        playerName = savedName;
      }
      renderRiddles();
      updateProgressDisplay();
      updateLivesDisplay();
      startTimer();
    }
  }

  init();

})();
</script>
</body>
</html>
