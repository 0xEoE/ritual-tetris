// ══════════════════════════════════════════════
//  RITUAL TETRIS — main.js  (Enhanced PVP Edition)
//  + PVP Waiting Room + Live Opponent Board
//  + Result Modal with Board Capture & Share to X
// ══════════════════════════════════════════════

import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@6.10.0/dist/ethers.min.js";

// ── CONTRACT ──────────────────────────────────
const CONTRACT_ADDRESS = "0xbd6dA7BCfB129A373615ADF8c5f68999Fd2911C8";
const ABI = [
  "function enterSinglePlayer() payable",
  "function claimSinglePlayerReward(address player, uint256 score)",
  "function createPvPMatch() payable returns (uint256)",
  "function joinPvPMatch(uint256 matchId) payable",
  "function claimPvPReward(uint256 matchId, address winner)"
];

let provider, signer, contract, currentMode;
let opponentAddress = null;

// ══════════════════════════════════════════════
//  FIREBASE REALTIME DB — Cross-browser PVP Transport
//  Replace FIREBASE_URL with your own project's DB URL.
//  Free Spark plan is more than enough for testnet scale.
// ══════════════════════════════════════════════
const FIREBASE_URL = "https://ritual-tetris-default-rtdb.asia-southeast1.firebasedatabase.app"; // ✅ No trailing slash

// Thin REST wrapper — no SDK needed, pure fetch
const FB = {
  // Write / overwrite a path
  async set(path, data) {
    await fetch(`${FIREBASE_URL}/${path}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
  // Patch / merge fields at a path
  async update(path, data) {
    await fetch(`${FIREBASE_URL}/${path}.json`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
  // One-time read
  async get(path) {
    const r = await fetch(`${FIREBASE_URL}/${path}.json`);
    return r.json();
  },
  // Delete a path
  async remove(path) {
    await fetch(`${FIREBASE_URL}/${path}.json`, { method: "DELETE" });
  },
  // Long-poll listener (Server-Sent Events) — fires callback on every change
  listen(path, callback) {
    // SSE requires Accept header — EventSource handles this automatically
    // Firebase REST SSE works without auth when rules are .read: true
    const es = new EventSource(`${FIREBASE_URL}/${path}.json`);
    es.addEventListener("put",   e => { try { callback(JSON.parse(e.data)); } catch(_) {} });
    es.addEventListener("patch", e => { try { callback(JSON.parse(e.data)); } catch(_) {} });
    es.onerror = () => {}; // silently reconnect
    return es; // caller holds reference to close()
  },
};

// Active Firebase listeners — kept so we can close them on cleanup
let fbMatchListener   = null;  // listens to matches/{matchId}
let fbBoardListener   = null;  // listens to boards/{matchId}/opponent

let pvpMatchId = null;
let pvpRole    = null; // "host" | "guest"
let pvpSyncInterval = null;
let myWalletAddr = null; // set on wallet connect

// ── SEND any PVP event to Firebase ────────────
async function sendPvpUpdate(type, payload) {
  if (!pvpMatchId || !pvpRole) return;
  const path = `matches/${pvpMatchId}/events/${pvpRole}`;
  await FB.set(path, { type, payload, ts: Date.now() });
}

// ── Init listeners once match is established ──
function initPvpListeners() {
  // Close any old listeners
  if (fbMatchListener) { fbMatchListener.close(); fbMatchListener = null; }
  if (fbBoardListener) { fbBoardListener.close(); fbBoardListener = null; }

  const oppRole = pvpRole === "host" ? "guest" : "host";

  // 1. Listen for opponent match events (GAME_OVER, etc.)
  fbMatchListener = FB.listen(`matches/${pvpMatchId}/events/${oppRole}`, (data) => {
    if (!data || !data.data) return;
    handlePvpMessage(data.data);
  });

  // 2. Listen for opponent board state
  fbBoardListener = FB.listen(`boards/${pvpMatchId}/${oppRole}`, (data) => {
    if (!data || !data.data) return;
    const state = data.data;
    if (state && state.board) {
      opponentBoard = state.board;
      opponentScore = state.score || 0;
      opponentLines = state.lines || 0;
      drawOpponentBoard();
    }
  });
}

// ── Cleanup Firebase on game end / quit ───────
async function cleanupPvp() {
  if (fbMatchListener) { fbMatchListener.close(); fbMatchListener = null; }
  if (fbBoardListener) { fbBoardListener.close(); fbBoardListener = null; }
  clearInterval(pvpSyncInterval);
  // Remove our board state from Firebase
  if (pvpMatchId && pvpRole) {
    await FB.remove(`boards/${pvpMatchId}/${pvpRole}`);
  }
}

// ── TETRIS SETTINGS ───────────────────────────
const canvas  = document.getElementById("tetris");
const ctx     = canvas.getContext("2d");
const BLOCK   = 30;
const COLS    = 10;
const ROWS    = 20;
const TARGET  = 9999;

let board, score, level, lines, gameRunning, paused;
let currentPiece, nextPiece, pieceX, pieceY;
let lastDrop, dropInterval;
let animFrameId;

// Opponent board state (for PVP)
let opponentBoard = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
let opponentScore = 0;
let opponentLines = 0;
let opponentFinished = false;

// ── TETROMINOS ────────────────────────────────
const PIECES = [
  { shape: [[1,1,1,1]],              color: "#1ac8c8" },
  { shape: [[1,1],[1,1]],            color: "#c8a800" },
  { shape: [[0,1,0],[1,1,1]],        color: "#7c3faa" },
  { shape: [[0,1,1],[1,1,0]],        color: "#1a9e3f" },
  { shape: [[1,1,0],[0,1,1]],        color: "#b83232" },
  { shape: [[1,0,0],[1,1,1]],        color: "#1a3faa" },
  { shape: [[0,0,1],[1,1,1]],        color: "#c86a00" },
];

function randomPiece() {
  return JSON.parse(JSON.stringify(PIECES[Math.floor(Math.random() * PIECES.length)]));
}

// ── SOUND ─────────────────────────────────────
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSound(freq, duration, type = "sine", volume = 0.35) {
  try {
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration / 1000);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration / 1000);
  } catch(e) {}
}
function sfxMove()   { playSound(220, 60,  "square", 0.15); }
function sfxRotate() { playSound(330, 80,  "sine",   0.2);  }
function sfxLock()   { playSound(180, 120, "sine",   0.3);  }
function sfxLine()   { playSound(660, 180, "sine",   0.4);  }
function sfxDrop()   { playSound(120, 90,  "square", 0.25); }
function sfxWin()    { [523,659,784,1047].forEach((f,i) => setTimeout(() => playSound(f, 220, "sine", 0.4), i*120)); }
function sfxLose()   { [300,250,200,150].forEach((f,i) => setTimeout(() => playSound(f, 180, "square", 0.3), i*100)); }

// ── GLASS BLOCK DRAW ──────────────────────────
function drawBlock(cx, cy, color, customCtx) {
  const c = customCtx || ctx;
  const px = cx * BLOCK;
  const py = cy * BLOCK;
  const s  = BLOCK;
  c.save();
  c.globalAlpha = 0.82;
  c.fillStyle = color;
  c.fillRect(px + 1, py + 1, s - 2, s - 2);
  c.globalAlpha = 1;
  const glassGrad = c.createLinearGradient(px, py, px + s, py + s);
  glassGrad.addColorStop(0,    "rgba(255,255,255,0.45)");
  glassGrad.addColorStop(0.35, "rgba(255,255,255,0.10)");
  glassGrad.addColorStop(0.6,  "rgba(0,0,0,0.05)");
  glassGrad.addColorStop(1,    "rgba(0,0,0,0.30)");
  c.fillStyle = glassGrad;
  c.fillRect(px + 1, py + 1, s - 2, s - 2);
  c.shadowColor = color;
  c.shadowBlur  = 10;
  c.strokeStyle = color;
  c.lineWidth   = 1.2;
  c.strokeRect(px + 1.5, py + 1.5, s - 3, s - 3);
  c.shadowBlur  = 0;
  c.fillStyle = "rgba(255,255,255,0.55)";
  c.fillRect(px + 2, py + 2, s - 5, 2);
  c.fillRect(px + 2, py + 2, 2, s - 5);
  c.fillStyle = "rgba(0,0,0,0.35)";
  c.fillRect(px + 3, py + s - 3, s - 4, 2);
  c.fillRect(px + s - 3, py + 3, 2, s - 5);
  c.restore();
}

// ── DRAW MAIN BOARD ───────────────────────────
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (board[r][c]) drawBlock(c, r, board[r][c]);

  if (currentPiece) {
    let ghostY = pieceY;
    while (!collideAt(pieceX, ghostY + 1)) ghostY++;
    if (ghostY !== pieceY) {
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = currentPiece.color;
      currentPiece.shape.forEach((row, dy) => row.forEach((v, dx) => {
        if (v) ctx.fillRect((pieceX + dx) * BLOCK, (ghostY + dy) * BLOCK, BLOCK, BLOCK);
      }));
      ctx.globalAlpha = 1;
    }
    currentPiece.shape.forEach((row, dy) => row.forEach((v, dx) => {
      if (v) drawBlock(pieceX + dx, pieceY + dy, currentPiece.color);
    }));
  }

  ctx.strokeStyle = "rgba(0,255,157,0.04)";
  ctx.lineWidth = 0.5;
  for (let c = 0; c <= COLS; c++) {
    ctx.beginPath(); ctx.moveTo(c * BLOCK, 0); ctx.lineTo(c * BLOCK, canvas.height); ctx.stroke();
  }
  for (let r = 0; r <= ROWS; r++) {
    ctx.beginPath(); ctx.moveTo(0, r * BLOCK); ctx.lineTo(canvas.width, r * BLOCK); ctx.stroke();
  }
}

// ── DRAW OPPONENT BOARD ───────────────────────
function drawOpponentBoard() {
  const oppCanvas = document.getElementById("opponentCanvas");
  if (!oppCanvas) return;
  const oc = oppCanvas.getContext("2d");
  oc.clearRect(0, 0, oppCanvas.width, oppCanvas.height);
  const OB = 15; // smaller block size for opponent board
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const color = opponentBoard[r][c];
      if (color) {
        oc.save();
        oc.globalAlpha = 0.85;
        oc.fillStyle = color;
        oc.fillRect(c * OB + 1, r * OB + 1, OB - 2, OB - 2);
        oc.globalAlpha = 1;
        oc.strokeStyle = color;
        oc.lineWidth = 0.8;
        oc.strokeRect(c * OB + 1, r * OB + 1, OB - 2, OB - 2);
        oc.fillStyle = "rgba(255,255,255,0.4)";
        oc.fillRect(c * OB + 2, r * OB + 2, OB - 4, 1.5);
        oc.fillRect(c * OB + 2, r * OB + 2, 1.5, OB - 4);
        oc.restore();
      } else {
        oc.strokeStyle = "rgba(0,255,157,0.03)";
        oc.lineWidth = 0.5;
        oc.strokeRect(c * OB, r * OB, OB, OB);
      }
    }
  }
  // Update opp score
  const el = document.getElementById("oppScoreVal");
  if (el) el.textContent = String(opponentScore).padStart(5, "0");
  const lel = document.getElementById("oppLinesVal");
  if (lel) lel.textContent = String(opponentLines).padStart(3, "0");
}

// ── COLLISION ─────────────────────────────────
function collideAt(nx, ny, shape = currentPiece.shape) {
  return shape.some((row, dy) =>
    row.some((v, dx) => v && (
      nx + dx < 0 || nx + dx >= COLS || ny + dy >= ROWS ||
      (ny + dy >= 0 && board[ny + dy]?.[nx + dx])
    ))
  );
}
function collide() { return collideAt(pieceX, pieceY); }

// ── MERGE / CLEAR ─────────────────────────────
function merge() {
  currentPiece.shape.forEach((row, dy) => row.forEach((v, dx) => {
    if (v && pieceY + dy >= 0) board[pieceY + dy][pieceX + dx] = currentPiece.color;
  }));
  sfxLock();
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(cell => cell)) {
      board.splice(r, 1);
      board.unshift(Array(COLS).fill(null));
      cleared++; r++;
    }
  }
  if (cleared) {
    const pts = [0, 100, 300, 500, 800][cleared] * level;
    score += pts;
    lines += cleared;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 800 - (level - 1) * 70);
    sfxLine();
    updateUI();
    // Sync board state to opponent
    if (currentMode === "pvp") syncBoardToPvp();
  }
}

function drop() {
  pieceY++;
  if (collide()) {
    pieceY--;
    merge();
    clearLines();
    spawnNext();
    if (currentMode === "pvp") syncBoardToPvp();
  }
}

function hardDrop() {
  let dropped = 0;
  while (!collideAt(pieceX, pieceY + 1)) { pieceY++; dropped++; }
  score += dropped * 2;
  drop();
  sfxDrop();
  updateUI();
}

function rotate() {
  const orig    = currentPiece.shape;
  const rotated = orig[0].map((_, i) => orig.map(row => row[i]).reverse());
  const prev    = currentPiece.shape;
  currentPiece.shape = rotated;
  if (collide()) {
    for (const kick of [1, -1, 2, -2]) {
      pieceX += kick;
      if (!collide()) { sfxRotate(); return; }
      pieceX -= kick;
    }
    currentPiece.shape = prev;
  } else sfxRotate();
}

function spawnNext() {
  currentPiece = nextPiece;
  nextPiece    = randomPiece();
  pieceX = Math.floor(COLS / 2) - Math.floor(currentPiece.shape[0].length / 2);
  pieceY = 0;
  if (collide()) {
    gameRunning = false;
    cancelAnimationFrame(animFrameId);
    if (currentMode === "pvp") {
      sendPvpUpdate("GAME_OVER", { score, lines, level });
      clearInterval(pvpSyncInterval);
      // Wait briefly for opponent result before showing popup
      setTimeout(() => showResult("pvp"), 800);
    } else {
      showResult("single");
    }
  }
}

// ── GAME LOOP ─────────────────────────────────
function gameLoop(timestamp) {
  if (!gameRunning) return;
  if (!paused && timestamp - lastDrop > dropInterval) {
    drop();
    lastDrop = timestamp;
  }
  draw();
  animFrameId = requestAnimationFrame(gameLoop);
}

// ── START GAME ────────────────────────────────
function startGame(mode) {
  currentMode  = mode;
  board        = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  score = 0; level = 1; lines = 0; dropInterval = 800; paused = false;
  opponentBoard    = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  opponentScore    = 0;
  opponentLines    = 0;
  opponentFinished = false;

  currentPiece = randomPiece();
  nextPiece    = randomPiece();
  pieceX = Math.floor(COLS / 2) - Math.floor(currentPiece.shape[0].length / 2);
  pieceY = 0;
  gameRunning = true;

  showScreen("gameScreen");
  setupGameScreenForMode(mode);
  updateUI();
  lastDrop = performance.now();
  cancelAnimationFrame(animFrameId);
  animFrameId = requestAnimationFrame(gameLoop);

  if (mode === "pvp") {
    // Send initial board state immediately
    syncBoardToPvp();
    // Periodic sync every 500ms for smooth live updates
    clearInterval(pvpSyncInterval);
    pvpSyncInterval = setInterval(syncBoardToPvp, 500);
  }
}

// ── PVP SYNC — push my board state to Firebase ─
async function syncBoardToPvp() {
  if (!pvpMatchId || !pvpRole) return;
  // Write board state to Firebase; opponent's SSE listener picks it up in ~100-300ms
  await FB.set(`boards/${pvpMatchId}/${pvpRole}`, {
    board: board,
    score: score,
    lines: lines,
    level: level,
    ts: Date.now(),
  });
}

// ── Handle incoming opponent events from Firebase ─
function handlePvpMessage(msg) {
  if (!msg || !msg.type) return;
  const { type, payload } = msg;

  if (type === "GAME_OVER") {
    opponentFinished = true;
    opponentScore    = payload.score;
    opponentLines    = payload.lines;
    drawOpponentBoard();
    if (gameRunning) {
      showPvpNotif("OPPONENT FINISHED — KEEP GOING TO SECURE YOUR SCORE!");
    } else {
      showResult("pvp");
    }
  } else if (type === "OPPONENT_JOINED") {
    closePvpWaiting();
    if (!gameRunning) startGame("pvp");
  }
}

function showPvpNotif(msg) {
  let el = document.getElementById("pvpNotif");
  if (!el) {
    el = document.createElement("div");
    el.id = "pvpNotif";
    el.style.cssText = `
      position:fixed; top:80px; left:50%; transform:translateX(-50%);
      background:rgba(255,0,204,0.12); border:1px solid rgba(255,0,204,0.5);
      color:#ff00cc; font-family:'Share Tech Mono',monospace; font-size:0.7rem;
      letter-spacing:2px; padding:10px 24px; z-index:9999;
      animation: pvpNotifIn 0.3s ease;
    `;
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 4000);
}

// ── SETUP GAME SCREEN FOR MODE ────────────────
function setupGameScreenForMode(mode) {
  const gameScreen = document.getElementById("gameScreen");
  const modeLabel  = document.getElementById("activeModeLabel");

  // Remove any existing opponent panel
  const existing = document.getElementById("opponentPanel");
  if (existing) existing.remove();

  if (mode === "pvp") {
    modeLabel.textContent  = "PVP ARENA";
    modeLabel.style.borderColor = "rgba(255,0,204,0.3)";
    modeLabel.style.color  = "#ff00cc";
    modeLabel.style.background = "rgba(255,0,204,0.05)";

    // Inject opponent panel
    const panel = document.createElement("div");
    panel.id = "opponentPanel";
    panel.innerHTML = `
      <div style="
        display:flex; flex-direction:column; align-items:center; gap:10px;
        padding:0 0 0 20px;
      ">
        <div style="font-size:0.62rem; letter-spacing:3px; color:rgba(255,0,204,0.5); margin-bottom:4px;">
          // OPPONENT_BOARD
        </div>
        <div style="position:relative;">
          <canvas id="opponentCanvas" width="150" height="300"
            style="display:block; border:1px solid rgba(255,0,204,0.35);
                   background:#000; box-shadow:0 0 20px rgba(255,0,204,0.15);
                   image-rendering:pixelated;">
          </canvas>
          <div id="oppFinishOverlay" style="
            display:none; position:absolute; inset:0;
            background:rgba(0,0,0,0.7); align-items:center; justify-content:center;
            color:#ff00cc; font-family:'Orbitron',monospace; font-size:0.9rem;
            letter-spacing:2px; text-align:center; flex-direction:column; gap:8px;
          ">
            <div>FINISHED</div>
          </div>
        </div>
        <div style="border:1px solid rgba(255,0,204,0.15); background:#060606;
             padding:10px 14px; width:150px;">
          <div style="font-size:0.55rem; letter-spacing:2px;
               color:rgba(255,0,204,0.35); margin-bottom:6px;">// OPP SCORE</div>
          <div id="oppScoreVal" style="
            font-family:'Orbitron',monospace; font-size:1.1rem; font-weight:700;
            color:#ff00cc; letter-spacing:2px;">00000</div>
        </div>
        <div style="border:1px solid rgba(255,0,204,0.15); background:#060606;
             padding:10px 14px; width:150px;">
          <div style="font-size:0.55rem; letter-spacing:2px;
               color:rgba(255,0,204,0.35); margin-bottom:6px;">// OPP LINES</div>
          <div id="oppLinesVal" style="
            font-family:'Orbitron',monospace; font-size:1.1rem; font-weight:700;
            color:#ff00cc; letter-spacing:2px;">000</div>
        </div>
      </div>
    `;
    // Insert opponent panel after side-panel
    gameScreen.appendChild(panel);
    gameScreen.style.justifyContent = "center";
    gameScreen.style.gap = "20px";
  } else {
    modeLabel.textContent  = "SINGLE PLAYER";
    modeLabel.style.borderColor = "";
    modeLabel.style.color  = "";
    modeLabel.style.background = "";
  }
}

// ── UI UPDATES ────────────────────────────────
function updateUI() {
  const scoreEl = document.getElementById("score");
  const levelEl = document.getElementById("level");
  const linesEl = document.getElementById("lines");
  const barEl   = document.getElementById("scoreBar");
  if (scoreEl) scoreEl.textContent = String(score).padStart(5, "0");
  if (levelEl) levelEl.textContent = String(level).padStart(2, "0");
  if (linesEl) linesEl.textContent = String(lines).padStart(3, "0");
  if (barEl)   barEl.style.width   = Math.min((score / TARGET) * 100, 100) + "%";
}

// ══════════════════════════════════════════════
//  RESULT MODAL (Single + PVP) with Share to X
// ══════════════════════════════════════════════

function showResult(mode) {
  let modal = document.getElementById("resultModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "resultModal";
    modal.className = "result-backdrop";
    document.body.appendChild(modal);
    injectResultStyles();
  }

  const isPvp    = mode === "pvp";
  const myWon    = isPvp ? (score >= opponentScore) : (score >= TARGET);
  const isDraw   = isPvp && score === opponentScore;

  // Determine header info
  let headerTag, headerTitle, headerColor;
  if (!isPvp) {
    headerTag   = "// SESSION TERMINATED";
    headerTitle = score >= TARGET ? "VICTORY" : "GAME OVER";
    headerColor = score >= TARGET ? "#00ff9d" : "#ff3366";
  } else if (isDraw) {
    headerTag   = "// PVP MATCH RESULT";
    headerTitle = "DRAW";
    headerColor = "#ffcc00";
  } else if (myWon) {
    headerTag   = "// PVP MATCH RESULT";
    headerTitle = "VICTORY";
    headerColor = "#00ff9d";
  } else {
    headerTag   = "// PVP MATCH RESULT";
    headerTitle = "DEFEATED";
    headerColor = "#ff3366";
  }

  const pvpRows = isPvp ? `
    <div class="result-vs-row">
      <div class="result-vs-col">
        <div class="result-vs-label">YOU</div>
        <div class="result-vs-score" style="color:${myWon && !isDraw ? '#00ff9d':'#ccff00'}">
          ${String(score).padStart(5,"0")}
        </div>
        <div class="result-vs-sub">${lines} LINES · LV${level}</div>
      </div>
      <div class="result-vs-divider">VS</div>
      <div class="result-vs-col">
        <div class="result-vs-label">OPPONENT</div>
        <div class="result-vs-score" style="color:${!myWon && !isDraw ? '#00ff9d':'#ff00cc'}">
          ${String(opponentScore).padStart(5,"0")}
        </div>
        <div class="result-vs-sub">${opponentLines} LINES</div>
      </div>
    </div>
  ` : `
    <div class="result-score-block">
      <div class="result-score-label">FINAL SCORE</div>
      <div class="result-big-score">${String(score).padStart(5,"0")}</div>
      <div class="result-stats-row">
        <span>LEVEL <b>${String(level).padStart(2,"0")}</b></span>
        <span>LINES <b>${String(lines).padStart(3,"0")}</b></span>
      </div>
    </div>
  `;

  modal.innerHTML = `
    <div class="result-modal">
      <div class="result-corner result-tl"></div>
      <div class="result-corner result-tr"></div>
      <div class="result-corner result-bl"></div>
      <div class="result-corner result-br"></div>

      <div class="result-tag">${headerTag}</div>
      <div class="result-title" style="color:${headerColor};text-shadow:0 0 30px ${headerColor}66">
        ${headerTitle}
      </div>
      <div class="result-divider"></div>

      ${pvpRows}

      <div class="result-divider" style="margin-top:4px;"></div>

      <!-- Board Snapshot -->
      <div class="result-board-section">
        <div class="result-board-label">// FINAL BOARD STATE</div>
        <canvas id="resultBoardCanvas" width="200" height="400"
          style="display:block; margin:0 auto; border:1px solid rgba(0,255,157,0.2);
                 background:#000; image-rendering:pixelated;"></canvas>
      </div>

      <div class="result-divider"></div>
      <div class="result-actions">
        <button class="ritual-btn result-share-btn" id="shareXBtn">
          𝕏 SHARE TO X
        </button>
        <button class="ritual-btn" id="resRestartBtn">↺ PLAY AGAIN</button>
        <button class="ritual-btn danger" id="resExitBtn">⏹ EXIT</button>
      </div>
    </div>
  `;

  modal.classList.add("visible");
  document.body.style.overflow = "hidden";

  // Render board snapshot into result canvas
  renderBoardSnapshot();

  // Button listeners
  modal.querySelector("#shareXBtn").addEventListener("click", shareToX);
  modal.querySelector("#resRestartBtn").addEventListener("click", async () => {
    closeResult();
    if (currentMode === "single") {
      if (await payEntry("single")) startGame("single");
    } else {
      showPvpWaiting();
    }
  });
  modal.querySelector("#resExitBtn").addEventListener("click", () => {
    closeResult();
    showScreen("modeScreen");
  });

  // Sound
  if ((isPvp && myWon && !isDraw) || (!isPvp && score >= TARGET)) sfxWin();
  else if (!isDraw) sfxLose();

  // Claim reward if applicable
  if (!isPvp && score >= TARGET && contract) claimSingleReward();
  if (isPvp && myWon && !isDraw && contract && pvpMatchId !== null) claimPvpReward();
}

function closeResult() {
  const modal = document.getElementById("resultModal");
  if (modal) modal.classList.remove("visible");
  document.body.style.overflow = "";
}

// ── BOARD SNAPSHOT RENDERER ───────────────────
function renderBoardSnapshot() {
  const snapCanvas = document.getElementById("resultBoardCanvas");
  if (!snapCanvas) return;
  const sc   = snapCanvas.getContext("2d");
  const SB   = 20; // snapshot block size
  const SW   = COLS * SB;
  const SH   = ROWS * SB;
  snapCanvas.width  = SW;
  snapCanvas.height = SH;

  sc.fillStyle = "#000";
  sc.fillRect(0, 0, SW, SH);

  // Draw locked board
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const color = board[r][c];
      if (color) {
        sc.save();
        sc.globalAlpha = 0.85;
        sc.fillStyle = color;
        sc.fillRect(c * SB + 1, r * SB + 1, SB - 2, SB - 2);
        sc.globalAlpha = 1;
        const g = sc.createLinearGradient(c*SB, r*SB, c*SB+SB, r*SB+SB);
        g.addColorStop(0,   "rgba(255,255,255,0.4)");
        g.addColorStop(0.4, "rgba(255,255,255,0.08)");
        g.addColorStop(1,   "rgba(0,0,0,0.25)");
        sc.fillStyle = g;
        sc.fillRect(c * SB + 1, r * SB + 1, SB - 2, SB - 2);
        sc.strokeStyle = color;
        sc.lineWidth = 0.8;
        sc.shadowColor = color;
        sc.shadowBlur  = 6;
        sc.strokeRect(c * SB + 1.5, r * SB + 1.5, SB - 3, SB - 3);
        sc.shadowBlur = 0;
        sc.fillStyle = "rgba(255,255,255,0.5)";
        sc.fillRect(c * SB + 2, r * SB + 2, SB - 4, 1.5);
        sc.fillRect(c * SB + 2, r * SB + 2, 1.5, SB - 4);
        sc.restore();
      } else {
        sc.strokeStyle = "rgba(0,255,157,0.04)";
        sc.lineWidth = 0.5;
        sc.strokeRect(c * SB, r * SB, SB, SB);
      }
    }
  }
  // Draw the last active piece (faded)
  if (currentPiece) {
    sc.globalAlpha = 0.55;
    currentPiece.shape.forEach((row, dy) => row.forEach((v, dx) => {
      if (v) {
        sc.fillStyle = currentPiece.color;
        sc.fillRect((pieceX + dx) * SB + 1, (pieceY + dy) * SB + 1, SB - 2, SB - 2);
      }
    }));
    sc.globalAlpha = 1;
  }
}

// ── SHARE TO X ────────────────────────────────
async function shareToX() {
  const snapCanvas = document.getElementById("resultBoardCanvas");
  if (!snapCanvas) return;

  // Build a composite share image
  const shareCanvas  = document.createElement("canvas");
  shareCanvas.width  = 600;
  shareCanvas.height = 520;
  const sc = shareCanvas.getContext("2d");

  // Background
  sc.fillStyle = "#040404";
  sc.fillRect(0, 0, 600, 520);

  // Scanline effect
  for (let y = 0; y < 520; y += 4) {
    sc.fillStyle = "rgba(0,0,0,0.07)";
    sc.fillRect(0, y, 600, 2);
  }

  // Border
  sc.strokeStyle = "#00ff9d";
  sc.lineWidth = 1.5;
  sc.strokeRect(8, 8, 584, 504);
  sc.strokeStyle = "#ffcc00";
  sc.lineWidth = 1;
  sc.strokeRect(12, 12, 576, 496);

  // Header text
  sc.fillStyle = "#ccff00";
  sc.font = "bold 11px 'Courier New', monospace";
  sc.letterSpacing = "3px";
  sc.fillText("// ON-CHAIN GAMING", 28, 38);

  sc.fillStyle = "#ccff00";
  sc.font = "bold 28px 'Courier New', monospace";
  sc.fillText("[RITUAL] TETRIS", 28, 72);

  // Divider
  sc.strokeStyle = "rgba(0,255,157,0.25)";
  sc.lineWidth = 1;
  sc.beginPath(); sc.moveTo(28, 84); sc.lineTo(572, 84); sc.stroke();

  // Draw the board snapshot, centered
  const boardW = snapCanvas.width;
  const boardH = snapCanvas.height;
  const scale  = Math.min(280 / boardW, 380 / boardH);
  const bw = boardW * scale;
  const bh = boardH * scale;
  const bx = (600 - bw) / 2 - 80;
  const by = 100;

  sc.drawImage(snapCanvas, bx, by, bw, bh);

  // Board border glow
  sc.shadowColor = "#00ff9d";
  sc.shadowBlur  = 16;
  sc.strokeStyle = "rgba(0,255,157,0.6)";
  sc.lineWidth   = 1.5;
  sc.strokeRect(bx - 2, by - 2, bw + 4, bh + 4);
  sc.shadowBlur  = 0;

  // Stats panel (right side)
  const sx = bx + bw + 30;
  const sy = by + 20;
  const sw = 150;

  sc.strokeStyle = "rgba(0,255,157,0.2)";
  sc.lineWidth = 1;
  sc.strokeRect(sx, sy, sw, 200);

  sc.fillStyle = "rgba(0,255,157,0.05)";
  sc.fillRect(sx, sy, sw, 200);

  sc.fillStyle = "rgba(0,255,157,0.35)";
  sc.font = "10px 'Courier New'";
  sc.fillText("// SCORE", sx + 12, sy + 22);
  sc.fillStyle = "#ccff00";
  sc.font = "bold 24px 'Courier New'";
  sc.fillText(String(score).padStart(5,"0"), sx + 12, sy + 54);

  sc.fillStyle = "rgba(0,255,157,0.35)";
  sc.font = "10px 'Courier New'";
  sc.fillText("// LEVEL", sx + 12, sy + 82);
  sc.fillStyle = "#ccff00";
  sc.font = "bold 22px 'Courier New'";
  sc.fillText(String(level).padStart(2,"0"), sx + 12, sy + 110);

  sc.fillStyle = "rgba(0,255,157,0.35)";
  sc.font = "10px 'Courier New'";
  sc.fillText("// LINES", sx + 12, sy + 138);
  sc.fillStyle = "#ccff00";
  sc.font = "bold 22px 'Courier New'";
  sc.fillText(String(lines).padStart(3,"0"), sx + 12, sy + 166);

  // Result badge
  const isPvp = currentMode === "pvp";
  const won   = isPvp ? score >= opponentScore : score >= TARGET;
  sc.fillStyle = won ? "rgba(0,255,157,0.1)" : "rgba(255,51,102,0.1)";
  sc.strokeStyle = won ? "#00ff9d" : "#ff3366";
  sc.lineWidth = 1;
  sc.fillRect(sx, sy + 216, sw, 34);
  sc.strokeRect(sx, sy + 216, sw, 34);
  sc.fillStyle = won ? "#00ff9d" : "#ff3366";
  sc.font = "bold 13px 'Courier New'";
  sc.textAlign = "center";
  sc.fillText(won ? "VICTORY" : "GAME OVER", sx + sw / 2, sy + 238);
  sc.textAlign = "left";

  // Mode badge
  sc.fillStyle = "rgba(255,204,0,0.06)";
  sc.strokeStyle = "rgba(255,204,0,0.3)";
  sc.lineWidth = 1;
  sc.fillRect(sx, sy + 262, sw, 28);
  sc.strokeRect(sx, sy + 262, sw, 28);
  sc.fillStyle = "#ffcc00";
  sc.font = "9px 'Courier New'";
  sc.textAlign = "center";
  sc.fillText(isPvp ? "PVP ARENA" : "SOLO MODE", sx + sw / 2, sy + 280);
  sc.textAlign = "left";

  // Footer
  sc.fillStyle = "rgba(0,255,157,0.3)";
  sc.font = "9px 'Courier New'";
  sc.fillText("RITUAL TESTNET  |  0xeoe.github.io/ritual-tetris", 28, 494);

  // Convert to blob and download + open Twitter
  shareCanvas.toBlob(async (blob) => {
    if (!blob) return;

    // Download image
    const url  = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = `ritual-tetris-${Date.now()}.png`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);

    // Brief delay then open Twitter intent
    await new Promise(r => setTimeout(r, 400));

    const modeStr  = currentMode === "pvp" ? "PVP Arena" : "Solo Mode";
    const resultStr = (currentMode === "pvp" ? score >= opponentScore : score >= TARGET)
      ? "🏆 VICTORY"
      : "💀 Game Over";
    const tweet = encodeURIComponent(
      `${resultStr} — ${String(score).padStart(5,"0")} pts · LV${level} · ${lines} lines\n` +
      `Playing [RITUAL] TETRIS on-chain! 🎮⛓️\n` +
      `Mode: ${modeStr} | Network: Ritual Testnet\n\n` +
      `🕹️ Play here: https://0xEoE.github.io/ritual-tetris/\n\n` +
      `@0xEyesofEtresia @Ritualnet\n` +
      `#RitualTestnet`
    );
    window.open(`https://x.com/intent/tweet?text=${tweet}`, "_blank");
  }, "image/png");
}

// ── INJECT RESULT MODAL STYLES ────────────────
function injectResultStyles() {
  if (document.getElementById("resultModalStyles")) return;
  const style = document.createElement("style");
  style.id = "resultModalStyles";
  style.textContent = `
    .result-backdrop {
      display: none;
      position: fixed; inset: 0; z-index: 1000;
      background: rgba(0,0,0,0.88);
      backdrop-filter: blur(6px);
      align-items: center; justify-content: center;
      overflow-y: auto;
    }
    .result-backdrop.visible {
      display: flex;
    }
    .result-modal {
      position: relative;
      background: #060606;
      border: 1px solid rgba(0,255,157,0.3);
      padding: 32px 36px;
      max-width: 480px;
      width: 90%;
      margin: auto;
      box-shadow: 0 0 60px rgba(0,255,157,0.08), 0 0 120px rgba(0,0,0,0.5);
    }
    .result-corner {
      position: absolute;
      width: 12px; height: 12px;
      border-color: #ffcc00; border-style: solid;
    }
    .result-tl { top:-1px; left:-1px;   border-width: 2px 0 0 2px; }
    .result-tr { top:-1px; right:-1px;  border-width: 2px 2px 0 0; }
    .result-bl { bottom:-1px; left:-1px;  border-width: 0 0 2px 2px; }
    .result-br { bottom:-1px; right:-1px; border-width: 0 2px 2px 0; }
    .result-tag {
      font-size: 0.6rem; letter-spacing: 4px;
      color: rgba(204,255,0,0.4); margin-bottom: 8px;
    }
    .result-title {
      font-family: 'Orbitron', monospace;
      font-size: 2.2rem; font-weight: 900;
      letter-spacing: 6px; margin-bottom: 6px;
    }
    .result-divider {
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(0,255,157,0.2), transparent);
      margin: 16px 0;
    }
    .result-score-block { text-align: center; padding: 8px 0; }
    .result-score-label {
      font-size: 0.62rem; letter-spacing: 3px;
      color: rgba(204,255,0,0.35); margin-bottom: 8px;
    }
    .result-big-score {
      font-family: 'Orbitron', monospace;
      font-size: 2.8rem; font-weight: 900;
      color: #ccff00; letter-spacing: 4px;
      text-shadow: 0 0 30px rgba(204,255,0,0.3);
    }
    .result-stats-row {
      display: flex; gap: 24px; justify-content: center;
      font-size: 0.68rem; letter-spacing: 2px;
      color: rgba(204,255,0,0.4); margin-top: 12px;
    }
    .result-stats-row b { color: #ccff00; }
    /* PVP vs row */
    .result-vs-row {
      display: flex; align-items: center; gap: 12px;
      padding: 8px 0;
    }
    .result-vs-col { flex: 1; text-align: center; }
    .result-vs-label {
      font-size: 0.6rem; letter-spacing: 3px;
      color: rgba(204,255,0,0.4); margin-bottom: 6px;
    }
    .result-vs-score {
      font-family: 'Orbitron', monospace;
      font-size: 1.8rem; font-weight: 900; letter-spacing: 3px;
    }
    .result-vs-sub {
      font-size: 0.58rem; letter-spacing: 1px;
      color: rgba(204,255,0,0.3); margin-top: 6px;
    }
    .result-vs-divider {
      font-family: 'Orbitron', monospace;
      font-size: 1rem; color: #ffcc00; letter-spacing: 2px;
      padding: 0 8px;
    }
    /* Board snapshot */
    .result-board-section { text-align: center; }
    .result-board-label {
      font-size: 0.58rem; letter-spacing: 3px;
      color: rgba(0,255,157,0.35); margin-bottom: 10px;
    }
    /* Actions */
    .result-actions {
      display: flex; gap: 10px; flex-wrap: wrap;
    }
    .result-share-btn {
      border-color: rgba(0,0,0,0.5) !important;
      background: #000 !important;
      color: #fff !important;
      flex: 1;
    }
    .result-share-btn:hover {
      background: rgba(255,255,255,0.05) !important;
      border-color: #fff !important;
      box-shadow: 0 0 16px rgba(255,255,255,0.15) !important;
    }
    .ritual-btn.danger {
      border-color: rgba(255,0,100,0.4);
      color: #ff3366;
    }
    .ritual-btn.danger:hover {
      background: rgba(255,0,100,0.08);
      border-color: #ff3366;
      box-shadow: 0 0 16px rgba(255,0,100,0.2);
      color: #ff3366;
    }
    @keyframes pvpNotifIn {
      from { opacity:0; transform: translateX(-50%) translateY(-10px); }
      to   { opacity:1; transform: translateX(-50%) translateY(0); }
    }
  `;
  document.head.appendChild(style);
}

// ══════════════════════════════════════════════
//  PVP WAITING ROOM — Firebase Auto-Matchmaking
// ══════════════════════════════════════════════

// How matchmaking works:
//   1. User A (host) → writes to Firebase: lobbies/open/{matchId} = { hostAddr, ts }
//   2. User B (guest) → reads Firebase: find any open lobby, join it
//   3. Both now share the same matchId → Firebase board sync starts
//   Timeout: 90 seconds. If no opponent found → show error + refund prompt.

const MATCHMAKE_TIMEOUT_MS = 90_000; // 90 seconds
let matchmakeTimer = null;
let waitingLobbyListener = null; // SSE listener for lobby status
let waitingElapsed = 0;
let waitingTickInterval = null;

async function showPvpWaiting() {
  let overlay = document.getElementById("pvpWaitingOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "pvpWaitingOverlay";
    injectWaitingStyles();
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div class="pvp-wait-modal">
      <div class="pvp-wait-corner pvp-tl"></div>
      <div class="pvp-wait-corner pvp-tr"></div>
      <div class="pvp-wait-corner pvp-bl"></div>
      <div class="pvp-wait-corner pvp-br"></div>

      <div class="pvp-wait-tag">// PROTOCOL_02 — PVP ARENA</div>
      <div class="pvp-wait-title">WAITING FOR<br>OPPONENT</div>

      <div class="pvp-wait-anim">
        <div class="pvp-block b1"></div>
        <div class="pvp-block b2"></div>
        <div class="pvp-block b3"></div>
        <div class="pvp-block b4"></div>
      </div>

      <div class="pvp-wait-divider"></div>

      <div class="pvp-wait-info">
        <div class="pvp-wait-row">
          <span class="pvp-wait-lbl">MATCH ID</span>
          <span class="pvp-wait-val" id="pvpMatchIdDisplay">—</span>
        </div>
        <div class="pvp-wait-row">
          <span class="pvp-wait-lbl">ENTRY FEE</span>
          <span class="pvp-wait-val" style="color:#ffcc00">0.005 RITUAL ✓</span>
        </div>
        <div class="pvp-wait-row">
          <span class="pvp-wait-lbl">STATUS</span>
          <span class="pvp-wait-val pvp-blink" id="pvpStatus">SEARCHING…</span>
        </div>
        <div class="pvp-wait-row">
          <span class="pvp-wait-lbl">TIMEOUT</span>
          <span class="pvp-wait-val" id="pvpCountdown" style="color:rgba(204,255,0,0.5)">1:30</span>
        </div>
      </div>

      <div class="pvp-wait-divider"></div>

      <div style="font-size:0.6rem;letter-spacing:1px;color:rgba(0,255,157,0.3);
           text-align:center;margin-bottom:20px;line-height:1.8;">
        AUTO-MATCHMAKING ACTIVE<br>
        OPPONENT WILL BE FOUND WITHIN 90 SECONDS
      </div>

      <div style="display:flex;gap:10px;">
        <button class="ritual-btn" id="pvpShareMatchBtn" style="flex:1;font-size:0.65rem;">
          📋 COPY MATCH ID
        </button>
        <button class="ritual-btn danger" id="pvpCancelBtn" style="flex:1;font-size:0.65rem;">
          ✕ CANCEL
        </button>
      </div>
    </div>
  `;

  overlay.classList.add("visible");
  document.body.style.overflow = "hidden";

  // ── STEP 1: Try to find an existing open lobby first (guest path) ──
  let joinedExisting = false;
  try {
    const openLobbies = await FB.get("lobbies/open");
    if (openLobbies) {
      // Find a lobby that is NOT ours (different wallet address)
      const entries = Object.entries(openLobbies);
      for (const [lobbyMatchId, lobbyData] of entries) {
        // Skip if it's our own lobby (same wallet) or stale (older than 3 min)
        const isOurs  = myWalletAddr && lobbyData.hostAddr === myWalletAddr;
        const isStale = Date.now() - (lobbyData.ts || 0) > 180_000;
        if (!isOurs && !isStale) {
          // Found a lobby to join!
          joinedExisting = true;
          pvpMatchId = lobbyMatchId;
          pvpRole    = "guest";
          document.getElementById("pvpMatchIdDisplay").textContent = pvpMatchId;

          // Remove lobby from open list (it's now taken)
          await FB.remove(`lobbies/open/${pvpMatchId}`);
          // Write to match so host knows guest joined
          await sendPvpUpdate("OPPONENT_JOINED", { guestAddr: myWalletAddr || "anonymous" });

          // Init Firebase board listeners
          initPvpListeners();
          updatePvpStatus("OPPONENT FOUND!", "#00ff9d");
          setTimeout(() => {
            closePvpWaiting();
            startGame("pvp");
          }, 1200);
          break;
        }
      }
    }
  } catch(e) {
    console.warn("Lobby search failed:", e);
  }

  if (!joinedExisting) {
    // ── STEP 2: No open lobby found — become the host, post our lobby ──
    pvpRole    = "host";
    pvpMatchId = `M${Date.now().toString(36).toUpperCase()}`;
    document.getElementById("pvpMatchIdDisplay").textContent = pvpMatchId;

    try {
      await FB.set(`lobbies/open/${pvpMatchId}`, {
        hostAddr: myWalletAddr || "anonymous",
        ts: Date.now(),
      });
    } catch(e) {
      console.warn("Could not post lobby:", e);
    }

    // Init board listeners so we're ready when guest joins
    initPvpListeners();

    // ── STEP 3: Poll Firebase match events — wait for OPPONENT_JOINED ──
    // initPvpListeners() already listens on matches/{matchId}/events/guest
    // handlePvpMessage will call closePvpWaiting + startGame when guest fires

    // Countdown ticker
    waitingElapsed = 0;
    clearInterval(waitingTickInterval);
    waitingTickInterval = setInterval(() => {
      waitingElapsed += 1000;
      const remaining = Math.max(0, MATCHMAKE_TIMEOUT_MS - waitingElapsed);
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      const el = document.getElementById("pvpCountdown");
      if (el) el.textContent = `${mins}:${secs.toString().padStart(2,"0")}`;

      // Pulse status text every 5s for feedback
      if (waitingElapsed % 5000 === 0) {
        const dots = ".".repeat(((waitingElapsed / 5000) % 3) + 1);
        const statusEl = document.getElementById("pvpStatus");
        if (statusEl && statusEl.textContent.startsWith("SEARCHING")) {
          statusEl.textContent = `SEARCHING${dots}`;
        }
      }

      if (waitingElapsed >= MATCHMAKE_TIMEOUT_MS) {
        clearInterval(waitingTickInterval);
        onMatchmakeTimeout();
      }
    }, 1000);
  }

  // Copy match ID button
  overlay.querySelector("#pvpShareMatchBtn").addEventListener("click", () => {
    navigator.clipboard?.writeText(pvpMatchId || "").catch(() => {});
    const btn = overlay.querySelector("#pvpShareMatchBtn");
    btn.textContent = "✓ COPIED!";
    setTimeout(() => btn.textContent = "📋 COPY MATCH ID", 2000);
  });

  // Cancel button
  overlay.querySelector("#pvpCancelBtn").addEventListener("click", async () => {
    clearInterval(waitingTickInterval);
    clearTimeout(matchmakeTimer);
    if (pvpRole === "host" && pvpMatchId) {
      await FB.remove(`lobbies/open/${pvpMatchId}`).catch(() => {});
    }
    closePvpWaiting();
  });
}

function updatePvpStatus(text, color = "#ccff00") {
  const el = document.getElementById("pvpStatus");
  if (!el) return;
  el.textContent  = text;
  el.style.color  = color;
  el.style.animation = color === "#00ff9d" ? "none" : "";
}

function onMatchmakeTimeout() {
  updatePvpStatus("NO OPPONENT FOUND", "#ff3366");
  // Clean up our lobby listing
  if (pvpRole === "host" && pvpMatchId) {
    FB.remove(`lobbies/open/${pvpMatchId}`).catch(() => {});
  }
  // Show timeout message inside modal
  const infoDiv = document.querySelector(".pvp-wait-info");
  if (infoDiv) {
    const msg = document.createElement("div");
    msg.style.cssText = "margin-top:14px;font-size:0.62rem;letter-spacing:1px;color:#ff3366;text-align:center;line-height:1.7;";
    msg.innerHTML = "MATCHMAKING TIMED OUT (90s)<br>NO OPPONENTS AVAILABLE RIGHT NOW.<br><span style=\"color:rgba(204,255,0,0.4)\">TRY AGAIN OR INVITE A FRIEND.</span>";
    infoDiv.appendChild(msg);
  }
}

// ── Manual join by Match ID (e.g. from shared link) ──
window.joinPvpByMatchId = async function(matchId) {
  pvpMatchId = matchId;
  pvpRole    = "guest";
  // Remove from open lobbies
  await FB.remove(`lobbies/open/${matchId}`).catch(() => {});
  await sendPvpUpdate("OPPONENT_JOINED", { guestAddr: myWalletAddr || "anonymous" });
  initPvpListeners();
  closePvpWaiting();
  startGame("pvp");
};
function closePvpWaiting() {
  const overlay = document.getElementById("pvpWaitingOverlay");
  if (overlay) {
    overlay.classList.remove("visible");
    document.body.style.overflow = "";
  }
}

function injectWaitingStyles() {
  if (document.getElementById("pvpWaitingStyles")) return;
  const style = document.createElement("style");
  style.id = "pvpWaitingStyles";
  style.textContent = `
    #pvpWaitingOverlay {
      display: none; position: fixed; inset: 0; z-index: 1000;
      background: rgba(0,0,0,0.92); backdrop-filter: blur(8px);
      align-items: center; justify-content: center;
    }
    #pvpWaitingOverlay.visible { display: flex; }
    .pvp-wait-modal {
      position: relative; background: #060606;
      border: 1px solid rgba(255,0,204,0.3);
      padding: 36px 40px; max-width: 420px; width: 90%;
      box-shadow: 0 0 60px rgba(255,0,204,0.08);
    }
    .pvp-wait-corner {
      position: absolute; width: 14px; height: 14px;
      border-color: #ff00cc; border-style: solid;
    }
    .pvp-tl { top:-1px; left:-1px;   border-width: 2px 0 0 2px; }
    .pvp-tr { top:-1px; right:-1px;  border-width: 2px 2px 0 0; }
    .pvp-bl { bottom:-1px; left:-1px;  border-width: 0 0 2px 2px; }
    .pvp-br { bottom:-1px; right:-1px; border-width: 0 2px 2px 0; }
    .pvp-wait-tag {
      font-size: 0.6rem; letter-spacing: 3px;
      color: rgba(255,0,204,0.45); margin-bottom: 10px;
    }
    .pvp-wait-title {
      font-family: 'Orbitron', monospace; font-size: 1.8rem;
      font-weight: 900; color: #ff00cc; letter-spacing: 4px;
      text-shadow: 0 0 30px rgba(255,0,204,0.35); margin-bottom: 28px;
      line-height: 1.3;
    }
    .pvp-wait-anim {
      display: flex; gap: 8px; justify-content: center; margin-bottom: 24px;
    }
    .pvp-block {
      width: 22px; height: 22px;
      border: 1px solid rgba(255,0,204,0.5);
      animation: pvpBlockPulse 1.2s infinite;
    }
    .pvp-block.b1 { background: rgba(26,200,200,0.25); animation-delay: 0s; }
    .pvp-block.b2 { background: rgba(200,168,0,0.25);  animation-delay: 0.2s; }
    .pvp-block.b3 { background: rgba(124,63,170,0.25); animation-delay: 0.4s; }
    .pvp-block.b4 { background: rgba(255,0,204,0.25);  animation-delay: 0.6s; }
    @keyframes pvpBlockPulse {
      0%,100% { opacity:0.3; transform: scale(0.9); }
      50%      { opacity:1;   transform: scale(1.1); border-color: #ff00cc;
                 box-shadow: 0 0 12px rgba(255,0,204,0.5); }
    }
    .pvp-wait-divider {
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(255,0,204,0.2), transparent);
      margin: 20px 0;
    }
    .pvp-wait-info { display: flex; flex-direction: column; gap: 10px; }
    .pvp-wait-row {
      display: flex; justify-content: space-between; align-items: center;
    }
    .pvp-wait-lbl {
      font-size: 0.6rem; letter-spacing: 2px; color: rgba(204,255,0,0.35);
    }
    .pvp-wait-val {
      font-size: 0.72rem; letter-spacing: 1px; color: #ccff00;
      font-family: 'Share Tech Mono', monospace;
    }
    .pvp-blink { animation: pvpStatusBlink 1s infinite; color: #ff00cc !important; }
    @keyframes pvpStatusBlink {
      0%,100% { opacity: 1; } 50% { opacity: 0.4; }
    }
  `;
  document.head.appendChild(style);
}

// ── SCREEN SWITCHER ───────────────────────────
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
  document.getElementById(id)?.classList.remove("hidden");
}

// ── PAUSE ─────────────────────────────────────
function togglePause() {
  if (!gameRunning) return;
  paused = !paused;
  const btn = document.getElementById("pauseBtn");
  if (paused) {
    if (btn) btn.textContent = "▶ RESUME";
    cancelAnimationFrame(animFrameId);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ccff00";
    ctx.font = "bold 18px 'Orbitron', monospace";
    ctx.textAlign = "center";
    ctx.fillText("PAUSED", canvas.width / 2, canvas.height / 2);
    ctx.textAlign = "left";
  } else {
    if (btn) btn.textContent = "⬡ PAUSE";
    lastDrop = performance.now();
    animFrameId = requestAnimationFrame(gameLoop);
  }
}

// ── WALLET ────────────────────────────────────
async function connectWallet() {
  if (!window.ethereum) return alert("MetaMask tidak ditemukan!");
  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    signer   = await provider.getSigner();
    contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
    const addr = await signer.getAddress();
    myWalletAddr = addr; // store globally for matchmaking
    const btn  = document.getElementById("connectBtn");
    const dot  = document.getElementById("statusDot");
    btn.innerHTML = `✅ ${addr.slice(0,6)}…${addr.slice(-4)}`;
    dot.classList.remove("offline");
  } catch(e) {
    alert("Gagal connect: " + e.message);
  }
}

async function payEntry(mode) {
  if (!contract) { alert("Connect wallet dulu!"); return false; }
  const fee = mode === "single" ? "0.001" : "0.005";
  try {
    let tx;
    if (mode === "single") {
      tx = await contract.enterSinglePlayer({ value: ethers.parseEther(fee) });
    } else {
      tx = await contract.createPvPMatch({ value: ethers.parseEther(fee) });
      // In production: capture returned matchId from tx receipt
      // pvpMatchId = parseInt(receipt.logs[0].data, 16);
    }
    await tx.wait();
    return true;
  } catch(e) {
    alert("Transaksi gagal: " + e.message);
    return false;
  }
}

async function claimSingleReward() {
  try {
    const addr = await signer.getAddress();
    const tx = await contract.claimSinglePlayerReward(addr, score);
    await tx.wait();
    console.log("Single reward claimed!");
  } catch(e) {
    console.warn("Claim failed:", e.message);
  }
}

async function claimPvpReward() {
  try {
    const addr = await signer.getAddress();
    const tx = await contract.claimPvPReward(pvpMatchId, addr);
    await tx.wait();
    console.log("PVP reward claimed!");
  } catch(e) {
    console.warn("PVP claim failed:", e.message);
  }
}

// ── EVENT LISTENERS ───────────────────────────
document.getElementById("connectBtn").addEventListener("click", connectWallet);

document.getElementById("singleBtn").addEventListener("click", async () => {
  if (await payEntry("single")) startGame("single");
});

document.getElementById("pvpBtn").addEventListener("click", async () => {
  if (await payEntry("pvp")) {
    pvpMatchId = null; // reset, will be assigned in showPvpWaiting
    pvpRole    = null;
    showPvpWaiting();
  }
});

document.getElementById("quitBtn").addEventListener("click", async () => {
  gameRunning = false;
  cancelAnimationFrame(animFrameId);
  await cleanupPvp();
  showScreen("modeScreen");
});

document.getElementById("pauseBtn").addEventListener("click", togglePause);

// ── KEYBOARD ──────────────────────────────────
document.addEventListener("keydown", e => {
  if (!gameRunning || !currentPiece) return;
  if (e.key === "Escape" || e.key === "p" || e.key === "P") { togglePause(); return; }
  if (paused) return;
  switch (e.key) {
    case "ArrowLeft":  pieceX--; if (collide()) pieceX++; else sfxMove(); break;
    case "ArrowRight": pieceX++; if (collide()) pieceX--; else sfxMove(); break;
    case "ArrowDown":  drop(); score++; updateUI(); break;
    case "ArrowUp": case "x": case "X": rotate(); break;
    case " ": e.preventDefault(); hardDrop(); break;
  }
  draw();
  if (currentMode === "pvp") syncBoardToPvp();
});

// ── BACKGROUND CANVAS (Falling Tetris Blocks) ─
(function initBackground() {
  const bgCanvas = document.getElementById("bgCanvas");
  if (!bgCanvas) return;
  const bCtx = bgCanvas.getContext("2d");
  const CELL = 28;
  const BG_PIECES = [
    { shape: [[1,1,1,1]],         color: "rgba(0,255,157,"  },
    { shape: [[1,1],[1,1]],       color: "rgba(255,204,0,"  },
    { shape: [[0,1,0],[1,1,1]],   color: "rgba(204,255,0,"  },
    { shape: [[1,0],[1,0],[1,1]], color: "rgba(0,200,255,"  },
    { shape: [[0,1],[0,1],[1,1]], color: "rgba(255,0,204,"  },
    { shape: [[0,1,1],[1,1,0]],   color: "rgba(0,255,157,"  },
    { shape: [[1,1,0],[0,1,1]],   color: "rgba(255,100,0,"  },
  ];
  let bgPieces = [], W, H;
  function resize() { W = bgCanvas.width = window.innerWidth; H = bgCanvas.height = window.innerHeight; }
  resize();
  window.addEventListener("resize", resize);
  function spawnBgPiece() {
    const p = BG_PIECES[Math.floor(Math.random() * BG_PIECES.length)];
    return {
      shape: p.shape, color: p.color,
      x: Math.floor(Math.random() * Math.max(1, Math.floor(W/CELL) - 4)) * CELL,
      y: -CELL * 4,
      speed: 0.3 + Math.random() * 0.6,
      opacity: 0.04 + Math.random() * 0.10,
      rotation: 0,
      rotSpeed: (Math.random() - 0.5) * 0.008,
      scale: 0.6 + Math.random() * 0.7,
    };
  }
  for (let i = 0; i < 18; i++) { const p = spawnBgPiece(); p.y = Math.random() * H; bgPieces.push(p); }
  function drawBgPiece(p) {
    bCtx.save();
    const s = CELL * p.scale;
    const cx = p.x + (p.shape[0].length * s) / 2;
    const cy = p.y + (p.shape.length * s) / 2;
    bCtx.translate(cx, cy); bCtx.rotate(p.rotation); bCtx.translate(-cx, -cy);
    p.shape.forEach((row, r) => row.forEach((cell, c) => {
      if (!cell) return;
      const px = p.x + c * s, py = p.y + r * s;
      bCtx.fillStyle   = p.color + p.opacity + ")"; bCtx.fillRect(px+1, py+1, s-2, s-2);
      bCtx.strokeStyle = p.color + (p.opacity * 3) + ")"; bCtx.lineWidth = 0.8; bCtx.strokeRect(px+1, py+1, s-2, s-2);
      bCtx.fillStyle   = p.color + (p.opacity * 2.5) + ")"; bCtx.fillRect(px+2, py+2, s-4, 1.5); bCtx.fillRect(px+2, py+2, 1.5, s-4);
    }));
    bCtx.restore();
  }
  function bgAnimate() {
    bCtx.clearRect(0, 0, W, H);
    bgPieces.forEach((p, i) => {
      p.y += p.speed; p.rotation += p.rotSpeed;
      if (p.y > H + CELL * 5) bgPieces[i] = spawnBgPiece();
      drawBgPiece(p);
    });
    if (bgPieces.length < 22 && Math.random() < 0.003) bgPieces.push(spawnBgPiece());
    requestAnimationFrame(bgAnimate);
  }
  bgAnimate();
})();

console.log("%c🎮 Ritual Tetris — PVP Edition Loaded", "color:#00ff9d; font-size:16px");
