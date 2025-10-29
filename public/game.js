// game.js — complete, working version
(function(){
  'use strict';

  const WS_URL = "wss://halloween-game-1.onrender.com";
  let ws = null;
  let sessionId = null;
  let playerName = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 5;
  let isConnected = false;

  const ENCRYPTED_ADMIN_PASS = 'UHVycGxlJk9yYW5nZU1vdXNlXjI='; 
  function decrypt(s){ try { return atob(s); } catch(e) { return s; } }

  function sanitizeInput(input){
    if (typeof input !== 'string') return '';
    return input.replace(/[<>"'`;&|*$(){}[\]]/g,'').trim().slice(0,100);
  }
  function safeSetItem(k,v){ try { localStorage.setItem(sanitizeInput(k), typeof v === 'string' ? v : JSON.stringify(v)); return true; } catch(e){ console.error('Storage error',e); return false; } }
  function safeGetItem(k){ try { return localStorage.getItem(sanitizeInput(k)); } catch(e){ return null; } }

  function connectWebSocket(){
    try { ws = new WebSocket(WS_URL); } catch(e){ console.error('WS create failed', e); return; }

    ws.onopen = () => {
      isConnected = true;
      reconnectAttempts = 0;
      if (sessionId && playerName) sendPlayerName();
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'session_id') {
          sessionId = msg.sessionId;
          showSessionId();
          if (playerName) sendPlayerName();
        } else if (msg.type === 'lock_status') {
          if (msg.locked) { alert('🔒 Your session was locked by admin.'); lockPage(); }
          else { safeSetItem('dungeon_locked',''); safeSetItem('tab_switch_count','0'); alert('🔓 Unlocked by admin. Reloading...'); setTimeout(()=>location.reload(),500); }
        } else if (msg.type === 'reset') {
          alert('🔄 Progress reset by admin. Reloading...');
          localStorage.removeItem('dungeon_progress');
          setTimeout(()=>location.reload(),300);
        }
      } catch(e){ console.error('WS msg parse', e); }
    };

    ws.onclose = () => {
      isConnected = false;
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        setTimeout(connectWebSocket, 2000 * reconnectAttempts);
      }
    };

    ws.onerror = (err) => console.error('WS error', err);
  }

  function sendRaw(obj){
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify(obj)); } catch(e){ console.error('WS send failed', e); }
  }

  function sendPlayerName(){
    if (!sessionId || !playerName) return;
    sendRaw({ type: 'set_name', playerName });
  }

  function sendProgressUpdate(){
    if (!sessionId) return;
    sendRaw({ type: 'progress_update', progress: { difficulty, solved, lives, startTime, hintsUsed, tabSwitchCount, playerName }});
  }

  function trackEventBackend(evt, details={}){
    if (!sessionId || !isConnected) return;
    sendRaw({ type: 'event', event: evt, details: { ...details, sessionId, playerName }});
  }

  setInterval(()=>{ try { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type:'ping'})); } catch(e){} }, 30000);

  const riddlesByDifficulty = {
    easy: [
      {id:1, title:'Riddle 1', text:"I have no body, but I can appear,\nI whisper in your ear, but vanish near.\n\nYou'll feel my chill though I am air,\nWhat am I, haunting everywhere?", answer: 'GHOST'}, 
      {id:2, title:'Riddle 2', text:"I am full of ghosts, cobwebs, and fright,\nPeople visit me on Halloween night.\nDark and spooky is my style,\nWhat am I?", answer: 'HAUNTEDHOUSE'}, 
      {id:3, title:'Riddle 3', text:"Round and hollow, dark my core,\nI open wide but have no door.\nWithout me, faces cannot see\nWhat letter am I meant to be?\n(Hint: The letter is a Shape)", answer: 'O'}, 
      {id:4, title:'Riddle 4', text:"Neither living nor quite dead,\nI rise again when moonlight's shed.\nI shamble slow, with vacant hue\nGuess my name.", answer: 'UNDEAD'}, 
      {id:5, title:'Riddle 5', text:"I live inside a haunted flame,\nWithout me, dark would rule the game.\nI flicker soft, I guard your soul\nWhat am I, with shining role?", answer: 'LIGHT'}
    ],
    medium: [],
    hard: []
  };
  riddlesByDifficulty.medium = JSON.parse(JSON.stringify(riddlesByDifficulty.easy));
  riddlesByDifficulty.hard = JSON.parse(JSON.stringify(riddlesByDifficulty.easy));

  const hints = {
    "1":"Think of a chilling presence that has no physical body.",
    "2":"A place people visit on Halloween where scary things are displayed, two words.",
    "3":"A round letter that is also a shape.",
    "4":"A word for the category a walking dead creature is classified as.",
    "5":"A source of flickering illumination that keeps the dark away."
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

  const solved = {1:false,2:false,3:false,4:false,5:false};
  let tabSwitchCount = 0;
  let firstWarningShown = false;
  let isLocked = false;

  function formatTime(seconds){ const m = Math.floor(seconds/60); const s = seconds%60; return `${m}:${String(s).padStart(2,'0')}`; }

  function updateTimer(){
    if (!startTime) return;
    const elapsed = Math.floor((Date.now() - startTime)/1000);
    const remaining = timeLimit - elapsed;
    const timerEl = document.getElementById('timer');
    if (timeLimit > 0 && timerEl) {
      if (remaining <= 0) { endGame(false, "Time's up! The dungeon remains locked."); return; }
      timerEl.textContent = '⏱️ ' + formatTime(remaining);
      if (remaining <= 60) timerEl.classList.add('warning');
    }
  }
  
  function startTimer(){
    if (timeLimit <= 0) return;
    clearInterval(timerInterval);
    startTime = Date.now();
    const tc = document.getElementById('timerContainer'); if (tc) tc.style.display = 'block';
    updateTimer();
    timerInterval = setInterval(updateTimer, 1000);
  }
  
  function stopTimer(){ if (timerInterval) clearInterval(timerInterval); timerInterval = null; }
  function getElapsedTime(){ return startTime ? Math.floor((Date.now() - startTime)/1000) : 0; }

  function saveProgress(){
    try {
      const progress = { difficulty, solved, lives, startTime, timeLimit, hintsUsed, hintsRemaining, tabSwitchCount };
      safeSetItem('dungeon_progress', JSON.stringify(progress));
      sendProgressUpdate();
    } catch(e){ console.error('saveProgress', e); }
  }

  function loadProgress(){
    try {
      const raw = safeGetItem('dungeon_progress'); if (!raw) return false;
      const p = JSON.parse(raw); if (!p.difficulty) return false;
      difficulty = sanitizeInput(p.difficulty);
      if (!['easy','medium','hard'].includes(difficulty)) return false;
      riddles = riddlesByDifficulty[difficulty];
      Object.assign(solved, p.solved || solved);
      lives = parseInt(p.lives) || maxLives;
      hintsUsed = parseInt(p.hintsUsed) || 0;
      hintsRemaining = parseInt(p.hintsRemaining) || 0;
      tabSwitchCount = parseInt(p.tabSwitchCount) || 0;
      startTime = p.startTime || null;
      timeLimit = parseInt(p.timeLimit) || 0;
      switch(difficulty){ case 'easy': maxLives=999; totalHints=2; break; case 'medium': maxLives=5; totalHints=1; break; case 'hard': maxLives=3; totalHints=0; break; }
      return true;
    } catch(e){ console.error('loadProgress', e); return false; }
  }

  function checkInitialLock(){
    try {
      const locked = safeGetItem('dungeon_locked');
      if (locked === 'true') {
        const count = parseInt(safeGetItem('tab_switch_count') || '5');
        showPermanentLock(count);
        return true;
      }
    } catch(e){}
    return false;
  }

  function showSessionId(){
    if (!sessionId) return;
    let display = document.getElementById('sessionDisplay');
    if (!display){
      display = document.createElement('div');
      display.id = 'sessionDisplay';
      display.style.cssText = "position: fixed; bottom: 80px; right: 20px; background: rgba(20,20,20,0.9); border: 2px solid #ff8c00; border-radius:10px; padding:10px 15px; z-index:10000; font-size:0.9rem; color:#ff8c00; font-family:'Creepster', cursive;";
      document.body.appendChild(display);
    }
    display.innerHTML = playerName ? `👤 ${playerName}` : `🆔 ${sessionId.slice(0,8)}`;
  }

  function showWarning(title, message, footer){
    const overlay = document.createElement('div');
    overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.95);display:flex;align-items:center;justify-content:center;z-index:10000;";
    const box = document.createElement('div');
    box.style.cssText = "background:linear-gradient(135deg, rgba(139,0,0,0.95), rgba(70,0,0,0.95)); border:3px solid #ff4444; border-radius:20px; padding:30px; max-width:520px; text-align:center;";
    box.innerHTML = `<h2 style="color:#ff4444;font-family:Creepster, cursive;">${title}</h2><p style="color:#ffaa66; font-family:Creepster, cursive;">${message}</p><p style="color:#ff8c00; font-family:Creepster, cursive;">${footer}</p><button id="warnOk" style="margin-top:12px;padding:10px 18px;border-radius:10px;">I Understand</button>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    box.querySelector('#warnOk').onclick = ()=> overlay.remove();
  }

  function showPermanentLock(count){
    isLocked = true;
    stopTimer();
    const overlay = document.createElement('div');
    overlay.id = 'lockOverlay';
    overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(139,0,0,0.98);display:flex;align-items:center;justify-content:center;z-index:10000;";
    const box = document.createElement('div');
    box.style.cssText = "background:linear-gradient(135deg, rgba(0,0,0,0.95), rgba(70,0,0,0.95)); border:4px solid #ff0000; border-radius:20px; padding:50px; max-width:600px; text-align:center; box-shadow:0 0 80px rgba(255,0,0,0.8);";
    box.innerHTML = `<h1 style="color:#ff0000;font-family:Creepster, cursive;">🔒 PERMANENTLY LOCKED 🔒</h1><p style="color:#ffaa66;font-family:Creepster, cursive;">You have been caught switching tabs too many times!<br><br>Tab switches detected: ${count}</p>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.querySelectorAll('input, button').forEach(el => { if (el.id !== 'adminToggle') el.disabled = true; });
  }

  function lockPage(){
    isLocked = true;
    stopTimer();
    try {
      safeSetItem('dungeon_locked','true');
      safeSetItem('tab_switch_count', String(tabSwitchCount));
      trackEvent('locked', { tabSwitches: tabSwitchCount, difficulty });
      if (isConnected && sessionId) sendRaw({ type:'event', event:'locked', details:{ tabSwitches: tabSwitchCount, difficulty }});
    } catch(e){}
    showPermanentLock(tabSwitchCount);
  }

  function createRiddleCard(r){
    const card = document.createElement('div');
    card.className = 'riddle-card';
    card.id = 'card-' + r.id;
    const h = document.createElement('h3'); h.textContent = r.title; h.style.marginBottom='12px';
    const rtext = document.createElement('div'); rtext.className='riddle-text no-select'; rtext.textContent = r.text;
    const controls = document.createElement('div'); controls.className='riddle-controls';
    const input = document.createElement('input'); input.type='text'; input.id = 'answer' + r.id; input.placeholder='Your answer'; input.autocomplete='off'; input.spellcheck=false;
    input.addEventListener('paste',(e)=>{ e.preventDefault(); alert('Pasting disabled. Type your answer.'); });
    input.addEventListener('copy',(e)=>e.preventDefault()); input.addEventListener('cut',(e)=>e.preventDefault());
    const submit = document.createElement('button'); submit.textContent='Submit'; submit.onclick = ()=> checkRiddle(r.id);
    const fb = document.createElement('div'); fb.className='feedback'; fb.id = 'feedback' + r.id;
    controls.appendChild(input); controls.appendChild(submit);
    card.appendChild(h); card.appendChild(rtext); card.appendChild(controls); card.appendChild(fb);
    return card;
  }

  function renderRiddles(){
    const container = document.getElementById('riddleContainer');
    if (!container) return;
    container.innerHTML = '';
    riddles.forEach(r => container.appendChild(createRiddleCard(r)));
    Object.keys(solved).forEach(k => { if (solved[k]) { const inp = document.getElementById('answer'+k); if (inp) { inp.disabled = true; const card = document.getElementById('card-'+k); if (card) card.classList.add('solved'); } } });
  }

  function updateProgressDisplay(){
    const solvedCount = Object.values(solved).filter(Boolean).length;
    const pct = (solvedCount/5)*100;
    const fill = document.getElementById('progressFill');
    const text = document.getElementById('progressText');
    if (fill) { fill.style.width = pct + '%'; fill.textContent = `${solvedCount}/5`; }
    if (text) text.textContent = `${solvedCount} / 5 solved`;
  }

  function updateLivesDisplay(){
    const el = document.getElementById('livesDisplay');
    if (!el) return;
    if (maxLives === 999) el.innerHTML = '';
    else el.innerHTML = '❤️'.repeat(Math.max(0,lives)) + '💔'.repeat(Math.max(0,maxLives - lives));
  }

  function checkRiddle(id){
    if (isLocked) { alert('Page locked due to tab switching.'); return; }
    const inp = document.getElementById('answer'+id);
    const fb = document.getElementById('feedback'+id);
    if (!inp) return;
    let val = (inp.value || '').trim().replace(/\s+/g, '').toUpperCase();
    val = val.replace(/[\u200B\u200C\u200D\uFEFF\u2060]/g,'');
    if (!val) { if (fb){ fb.style.color='#ff4444'; fb.textContent='Please type an answer.'; } return; }
    const first = val[0];
    const r = riddles.find(rr => rr.id === id);
    if (!r) return;
    const expected = (r.answer || '')[0];
    if (first === expected) {
      solved[id] = true;
      if (fb){ fb.style.color='#00cc66'; fb.textContent='✓ Correct — nice work.'; }
      inp.disabled = true;
      const card = document.getElementById('card-'+id); if (card) card.classList.add('solved');
      updateProgressDisplay();
      trackEvent('riddle_solved', { riddle:id, difficulty });
      trackEventBackend('riddle_solved', { riddle:id, difficulty });
      sendProgressUpdate();
      saveProgress();
    } else {
      lives = Math.max(0, lives - 1);
      updateLivesDisplay();
      if (fb){ fb.style.color='#ff4444'; fb.textContent='✗ Incorrect — try again.'; }
      if (lives <= 0) endGame(false, 'You have run out of lives! The dungeon claims your soul...');
      setTimeout(()=>{ if (fb) fb.textContent=''; }, 3000);
      trackEvent('riddle_failed', { riddle:id, difficulty });
      trackEventBackend('riddle_failed', { riddle:id, difficulty });
      saveProgress();
    }
  }

  function getFinalCode(){ return riddles.map(r => (r.answer || '')[0] || '?').join(''); }

  function endGame(success, message){
    stopTimer();
    isLocked = true;
    document.querySelectorAll('input, button').forEach(el => { if (el.id !== 'adminToggle') el.disabled = true; });
    const res = document.getElementById('result');
    if (res) { res.style.color = success ? '#00cc66' : '#ff4444'; res.textContent = message; }
    if (success) {
      const time = getElapsedTime();
      trackEvent('complete', { difficulty, time, hintsUsed });
      trackEventBackend('complete', { difficulty, time, hintsUsed });
      safeSetItem('dungeon_progress','');
      showShareButton();
    } else {
      trackEvent('failed', { difficulty });
      trackEventBackend('failed', { difficulty });
    }
  }

  function attachUnlock(){
    const btn = document.getElementById('unlockBtn');
    const input = document.getElementById('codeInput');
    if (!btn || !input) return;
    btn.addEventListener('click', ()=>{
      if (isLocked) { alert('Page is locked due to excessive tab switching.'); return; }
      let entered = (input.value || '').trim().replace(/\s+/g, '').toUpperCase();
      entered = entered.replace(/[\u200B\u200C\u200D\uFEFF\u2060]/g,'');
      const res = document.getElementById('result');
      if (!entered) { if (res){ res.style.color='#ff8c00'; res.textContent='Enter the 5-letter code to escape!'; } return; }
      if (entered.length !== 5) { if (res){ res.style.color='#ff4444'; res.textContent='Code must be 5 letters.'; } return; }
      const target = getFinalCode();
      console.log('Final code check:', entered, '===', target);
      if (entered === target) {
        endGame(true, '🎉 You have escaped the dungeon! The spirits bow to your wisdom. 🎉');
      } else {
        lives = Math.max(0, lives - 1);
        updateLivesDisplay();
        if (res){ res.style.color='#ff4444'; res.textContent = '❌ Wrong code... The dungeon remains locked.'; }
        if (lives <= 0) endGame(false, 'You have run out of lives! The dungeon claims your soul...');
        saveProgress();
      }
    });
    input.addEventListener('paste', (e)=>{ e.preventDefault(); alert('Pasting is disabled. Please type your answer.'); });
  }

  function showShareButton(){
    const time = getElapsedTime();
    const res = document.getElementById('result');
    if (!res) return;
    const btn = document.createElement('button');
    btn.className = 'share-btn';
    btn.textContent = '📤 Share Your Victory';
    btn.onclick = ()=>{
      const text = `I escaped the Locked Dungeon in ${formatTime(time)} on ${difficulty} mode! 💀🎃`;
      if (navigator.share) navigator.share({ title:'Locked Dungeon Victory', text }).catch(()=>{ navigator.clipboard.writeText(text); alert('Victory message copied to clipboard!'); });
      else { navigator.clipboard.writeText(text); alert('Victory message copied to clipboard!'); }
    };
    res.appendChild(document.createElement('br'));
    res.appendChild(btn);
  }

  function trackEvent(evt, data = {}){
    try {
      const key = sanitizeInput(evt);
      const analytics = JSON.parse(safeGetItem('dungeon_analytics') || '{}');
      if (!analytics[key]) analytics[key] = [];
      analytics[key].push({ ...data, timestamp: Date.now() });
      safeSetItem('dungeon_analytics', JSON.stringify(analytics));
      if (isConnected && sessionId) trackEventBackend(key, data);
    } catch(e){ console.error('trackEvent', e); }
  }

  function getAnalytics(){
    try {
      const analytics = JSON.parse(safeGetItem('dungeon_analytics') || '{}');
      const attempts = (analytics.attempt || []).length;
      const completions = (analytics.complete || []).length;
      const locked = (analytics.locked || []).length;
      const hints = (analytics.hint || []).length;
      const completeTimes = (analytics.complete || []).map(c=>c.time).filter(Boolean);
      const avgTime = completeTimes.length ? completeTimes.reduce((a,b)=>a+b,0)/completeTimes.length : 0;
      const bestTime = completeTimes.length ? Math.min(...completeTimes) : 0;
      return { attempts, completions, locked, hints, avgTime, bestTime };
    } catch(e){ 
      console.error('getAnalytics error:', e);
      return { attempts:0, completions:0, locked:0, hints:0, avgTime:0, bestTime:0 }; 
    }
  }

  let isAdminAuthenticated = false;

  window.adminLogin = function(){
    const passInput = document.getElementById('adminPassword');
    if (!passInput) { alert('❌ Password input not found!'); return; }
    const enteredPass = passInput.value.trim();
    const correctPass = atob('UHVycGxlJk9yYW5nZU1vdXNlXjI=');
    if (enteredPass === correctPass) {
      isAdminAuthenticated = true;
      document.getElementById('adminLogin').style.display = 'none';
      document.getElementById('adminContent').style.display = 'block';
      document.getElementById('adminStats').style.display = 'block';
      document.getElementById('adminControls').style.display = 'block';
      updateAdminStats();
      alert('✅ Admin authenticated successfully!');
    } else {
      alert('❌ Incorrect password!');
    }
  };

  window.closeAdmin = function(){ document.getElementById('adminPanel')?.classList.remove('active'); };

  function updateAdminStats(){
    const stats = getAnalytics();
    const sAttempts = document.getElementById('statAttempts');
    const sCompletions = document.getElementById('statCompletions');
    const sLocked = document.getElementById('statLocked');
    const sAvg = document.getElementById('statAvgTime');
    const sBest = document.getElementById('statBestTime');
    const sHints = document.getElementById('statHints');
    if (sAttempts) sAttempts.textContent = stats.attempts || 0;
    if (sCompletions) sCompletions.textContent = stats.completions || 0;
    if (sLocked) sLocked.textContent = stats.locked || 0;
    if (sAvg) sAvg.textContent = formatTime(Math.floor(stats.avgTime || 0));
    if (sBest) sBest.textContent = stats.bestTime ? formatTime(stats.bestTime) : '--';
    if (sHints) sHints.textContent = stats.hints || 0;
  }

  window.resetProgress = function(){
    if (!isAdminAuthenticated){ alert('❌ Admin authentication required!'); return; }
    if (!confirm('Reset current progress? This clears local progress for this client.')) return;
    try {
      safeSetItem('dungeon_progress','');
      alert('✅ Progress reset! Reloading...');
      setTimeout(() => location.reload(), 500);
    } catch(e) { alert('❌ Error resetting progress: ' + e.message); }
  };

  window.unlockUser = function(){
    if (!isAdminAuthenticated){ alert('❌ Admin authentication required!'); return; }
    try {
      safeSetItem('dungeon_locked','');
      safeSetItem('tab_switch_count','0');
      alert('✅ Local unlock performed. Reloading...');
      setTimeout(() => location.reload(), 500);
    } catch(e) { alert('❌ Error unlocking: ' + e.message); }
  };

  window.clearAllData = function(){
    if (!isAdminAuthenticated){ alert('❌ Admin authentication required!'); return; }
    if (!confirm('Clear all analytics stored locally? This cannot be undone!')) return;
    try {
      safeSetItem('dungeon_analytics','{}');
      updateAdminStats();
      alert('✅ Local analytics cleared.');
    } catch(e) { alert('❌ Error clearing data: ' + e.message); }
  };

  window.exportData = function(){
    if (!isAdminAuthenticated){ alert('❌ Admin authentication required!'); return; }
    try {
      const analytics = safeGetItem('dungeon_analytics') || '{}';
      const blob = new Blob([analytics], { type:'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); 
      a.href = url; 
      a.download = 'dungeon-analytics-' + Date.now() + '.json'; 
      a.click();
      URL.revokeObjectURL(url);
      alert('✅ Data exported successfully!');
    } catch(e) { alert('❌ Error exporting data: ' + e.message); }
  };

  document.addEventListener('visibilitychange', () => {
    if (isLocked) return;
    if (document.hidden) {
      tabSwitchCount++;
      saveProgress();
      if (tabSwitchCount >= 5) lockPage();
    } else {
      if (tabSwitchCount === 1 && !firstWarningShown) {
        showWarning('⚠️ WARNING ⚠️', 'Tab switching detected! Using external help defeats the purpose of this puzzle.', `Switches detected: ${tabSwitchCount}`);
        firstWarningShown = true;
      } else if (tabSwitchCount >= 3 && tabSwitchCount < 5) {
        showWarning('🚨 FINAL WARNING 🚨', `You have switched tabs ${tabSwitchCount} times! One more switch and the page will be PERMANENTLY LOCKED!`, `Switches remaining: ${5 - tabSwitchCount}`);
      }
    }
  });

  function initUIBindings(){
    console.log('🔧 Initializing UI bindings...');
    attachUnlock();
    const adminToggle = document.getElementById('adminToggle');
    if (adminToggle) {
      adminToggle.addEventListener('click', ()=>{ document.getElementById('adminPanel')?.classList.toggle('active'); });
    }
    const nameInput = document.getElementById('nameInput');
    if (nameInput) {
      nameInput.addEventListener('keypress', (e)=>{ if (e.key === 'Enter') window.submitName?.(); });
    }
    console.log('✅ UI bindings complete');
  }

  function init(){
    console.log('🎮 Initializing game...');
    try { connectWebSocket(); } catch(e){ console.warn('WS init failed', e); }
    const savedName = safeGetItem('player_name'); 
    if (savedName) playerName = savedName;
    if (checkInitialLock()) return;
    const loaded = loadProgress();
    if (!loaded) {
      if (!playerName) { showNamePrompt(); }
      else { showSessionId(); showDifficultyScreen(); }
    } else {
      riddles = riddlesByDifficulty[difficulty];
      renderRiddles();
      updateProgressDisplay();
      updateLivesDisplay();
      if (startTime && timeLimit > 0) startTimer();
      showSessionId();
    }
    setTimeout(() => {
      initUIBindings();
      console.log('✅ Game initialized');
    }, 100);
  }

  window.submitName = function(){
    const input = document.getElementById('nameInput');
    const name = sanitizeInput(input?.value || '').trim();
    if (!name || name.length < 2){ alert('Please enter a name (at least 2 characters)'); return; }
    playerName = name;
    safeSetItem('player_name', playerName);
    document.querySelector('.difficulty-screen')?.remove();
    showSessionId();
    showDifficultyScreen();
  };

  window.selectDifficulty = function(diff){
    difficulty = diff;
    if (!['easy','medium','hard'].includes(difficulty)) { alert('Invalid difficulty'); return; }
    riddles = riddlesByDifficulty[difficulty];
    switch(difficulty){
      case 'easy': 
        maxLives = 999; 
        timeLimit = 0; 
        totalHints = 2; 
        hintsRemaining = 2; 
        console.log('✅ Easy mode: Unlimited lives, 2 hints');
        break;
      case 'medium': 
        maxLives = 5; 
        timeLimit = 15*60; 
        totalHints = 1; 
        hintsRemaining = 1; 
        console.log('✅ Medium mode: 5 lives, 15min timer, 1 hint');
        break;
      case 'hard': 
        maxLives = 3; 
        timeLimit = 10*60; 
        totalHints = 0; 
        hintsRemaining = 0; 
        console.log('✅ Hard mode: 3 lives, 10min timer, 0 hints');
        break;
    }
    lives = maxLives;
    document.querySelector('.difficulty-screen')?.remove();
    trackEvent('attempt', { difficulty });
    trackEventBackend('attempt', { difficulty });
    saveProgress();
    renderRiddles();
    updateProgressDisplay();
    updateLivesDisplay();
    startTimer();
    setTimeout(() => {
      initUIBindings();
      console.log('✅ UI bindings attached after difficulty selection');
    }, 100);
  };

  function showNamePrompt(){
    const savedName = safeGetItem('player_name');
    if (savedName) { playerName = savedName; showSessionId(); return; }
    const overlay = document.createElement('div');
    overlay.className = 'difficulty-screen';
    overlay.innerHTML = `
      <div class="difficulty-content">
        <h2 style="margin-bottom: 20px; font-size: 2.2rem;">👻 Welcome to the Dungeon 👻</h2>
        <p style="margin-bottom: 20px; font-size: 1.1rem; color: #ffb366;">What shall we call you, brave soul?</p>
        <input type="text" id="nameInput" placeholder="Enter your name" maxlength="20" style="width:100%;padding:12px;margin-bottom:12px;font-size:1.1rem;" autofocus>
        <div style="display:flex;gap:8px;">
          <button onclick="window.submitName()">Continue</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('nameInput')?.focus();
  }

  function showDifficultyScreen(){
    document.querySelector('.difficulty-screen')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'difficulty-screen';
    overlay.innerHTML = `
      <div class="difficulty-content">
        <h2 style="margin-bottom:16px;font-size:2rem;">Choose Difficulty</h2>
        <p style="margin-bottom:12px;color:#ffb366;">Select how hard you want the dungeon to be.</p>
        <button class="difficulty-btn" onclick="selectDifficulty('easy')">Easy — Practice</button>
        <button class="difficulty-btn" onclick="selectDifficulty('medium')">Medium — Normal</button>
        <button class="difficulty-btn" onclick="selectDifficulty('hard')">Hard — Hardcore</button>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  // Hint button function - SINGLE DEFINITION
  window.manualHintClick = function(){
    console.log('🔍 Hint button clicked!');
    console.log('Hints remaining:', hintsRemaining);
    console.log('Total hints:', totalHints);
    
    const hb = document.getElementById('hintBox');
    
    if (typeof hintsRemaining === 'undefined' || hintsRemaining <= 0) { 
      if (hb) {
        hb.style.display='block'; 
        hb.innerHTML = '<p class="no-select" style="font-family:Creepster, cursive; font-size:1.2rem;">⛔ No hints remaining! (' + (hintsUsed || 0) + '/' + (totalHints || 0) + ' used)</p>';
      }
      return; 
    }
    
    const rn = prompt('Which riddle do you want a hint for? (1-5)');
    console.log('User entered:', rn);
    
    if (!rn) { 
      if (hb) { hb.style.display='none'; hb.innerHTML=''; }
      return; 
    }
    
    const n = parseInt(rn);
    console.log('Parsed number:', n);
    
    const gameHints = {
      "1":"Think of a chilling presence that has no physical body.",
      "2":"A place people visit on Halloween where scary things are displayed, two words.",
      "3":"A round letter that is also a shape.",
      "4":"A word for the category a walking dead creature is classified as.",
      "5":"A source of flickering illumination that keeps the dark away."
    };
    
    if (!n || n < 1 || n > 5 || !gameHints[n]) { 
      if (hb) {
        hb.style.display='block'; 
        hb.innerHTML = '<p class="no-select" style="font-family:Creepster, cursive; font-size:1.2rem;">That riddle doesn\'t exist – try 1 to 5.</p>';
      }
      return; 
    }
    
    if (hb) {
      hb.style.display='block';
      hb.innerHTML = '<p class="no-select" style="font-family:Creepster, cursive; font-size:1.2rem;">💡 Hint for Riddle ' + n + ': ' + gameHints[n] + '<br><br>Hints remaining: ' + (hintsRemaining - 1) + '/' + totalHints + '</p>';
    }
    
    hintsRemaining--; 
    hintsUsed++;
    console.log('Hint given! Remaining:', hintsRemaining);
    
    try {
      trackEvent('hint', { riddle:n, difficulty });
      trackEventBackend('hint', { riddle:n, difficulty });
      saveProgress();
    } catch(e) { console.error('Error tracking hint:', e); }
  };

  document.addEventListener('DOMContentLoaded', ()=> { init(); });

})();
