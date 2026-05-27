// ══════════════════════════════════════════════
//  RITUAL TETRIS — main.js  (AI Edition)
//  + PVP Waiting Room + Live Opponent Board
//  + Result Modal with Board Capture & Share to X
//  + vs AI Mode (Pierre Dellacherie Algorithm)
// ══════════════════════════════════════════════

import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@6.10.0/dist/ethers.min.js";

// ── CONTRACT ──────────────────────────────────
const CONTRACT_ADDRESS = "0x56306dc9A61790ca7aaCC97edC50E320DB44fcF5";
const ABI = [
  "function enterSinglePlayer() payable",
  "function claimSinglePlayerReward(uint256 score, uint256 nonce)",
  "function claimNonce(address) view returns (uint256)",
  "function createPvPMatch() payable returns (uint256)",
  "function joinPvPMatch(uint256 matchId) payable",
  "function cancelPvPMatch(uint256 matchId)",
  "function claimPvPReward(uint256 matchId, address winner)",
  "event PvPMatchCreated(uint256 indexed matchId, address indexed player1)",
  "event PvPMatchJoined(uint256 indexed matchId, address indexed player2)",
  "event PvPMatchCancelled(uint256 indexed matchId, address indexed player1, uint256 refundAmount)"
];

let provider, signer, contract, currentMode;
let opponentAddress = null;

// ── RITUAL TESTNET CHAIN CONFIG ────────────────
const RITUAL_TESTNET = {
  chainId:     "0x7BB", // 1979 in decimal
  chainName:   "Ritual Testnet",
  nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
  rpcUrls:     ["https://rpc.ritualfoundation.org"],
  blockExplorerUrls: ["https://explorer.ritualfoundation.org"],
};

// ── NETWORK GUARD ──────────────────────────────
async function isCorrectNetwork() {
  if (!window.ethereum) return false;
  const chainId = await window.ethereum.request({ method: "eth_chainId" });
  return chainId.toLowerCase() === RITUAL_TESTNET.chainId.toLowerCase();
}

async function switchToRitualTestnet() {
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: RITUAL_TESTNET.chainId }],
    });
    return true;
  } catch (err) {
    if (err.code === 4902) {
      try {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [RITUAL_TESTNET],
        });
        return true;
      } catch (addErr) {
        console.warn("Gagal menambahkan Ritual Testnet:", addErr.message);
        return false;
      }
    }
    console.warn("Gagal switch network:", err.message);
    return false;
  }
}

function showWrongNetworkOverlay() {
  if (document.getElementById("wrongNetworkOverlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "wrongNetworkOverlay";
  overlay.innerHTML = `
    <div class="wn-modal">
      <div class="wn-corner wn-tl"></div>
      <div class="wn-corner wn-tr"></div>
      <div class="wn-corner wn-bl"></div>
      <div class="wn-corner wn-br"></div>
      <div class="wn-icon">⚠</div>
      <div class="wn-tag">// NETWORK ERROR</div>
      <div class="wn-title">WRONG NETWORK</div>
      <div class="wn-divider"></div>
      <div class="wn-body">
        Ritual Tetris <b>only runs</b> on the<br>
        <span class="wn-highlight">RITUAL TESTNET</span><br><br>
        Other networks (including Mainnet) are <b>not supported</b><br>
        to keep your assets safe.
      </div>
      <div class="wn-divider"></div>
      <div class="wn-info-row">
        <span class="wn-lbl">CHAIN ID</span>
        <span class="wn-val">1979</span>
      </div>
      <div class="wn-info-row">
        <span class="wn-lbl">NETWORK</span>
        <span class="wn-val">RITUAL TESTNET</span>
      </div>
      <div class="wn-divider"></div>
      <button id="wnSwitchBtn" class="ritual-btn">
        ⇄ SWITCH TO RITUAL TESTNET
      </button>
    </div>
  `;

  if (!document.getElementById("wrongNetworkStyles")) {
    const s = document.createElement("style");
    s.id = "wrongNetworkStyles";
    s.textContent = `
      #wrongNetworkOverlay {
        position: fixed; inset: 0; z-index: 2000;
        background: rgba(0,0,0,0.92);
        backdrop-filter: blur(8px);
        display: flex; align-items: center; justify-content: center;
      }
      .wn-modal {
        position: relative;
        background: #060606;
        border: 1px solid rgba(255,51,102,0.5);
        box-shadow: 0 0 60px rgba(255,51,102,0.12), 0 0 0 1px rgba(255,51,102,0.08);
        padding: 36px 40px;
        max-width: 420px; width: 90%;
        text-align: center;
        font-family: 'Share Tech Mono', monospace;
      }
      .wn-corner {
        position: absolute; width: 12px; height: 12px;
        border-color: #ff3366; border-style: solid;
      }
      .wn-tl { top:-1px; left:-1px;   border-width: 2px 0 0 2px; }
      .wn-tr { top:-1px; right:-1px;  border-width: 2px 2px 0 0; }
      .wn-bl { bottom:-1px; left:-1px;  border-width: 0 0 2px 2px; }
      .wn-br { bottom:-1px; right:-1px; border-width: 0 2px 2px 0; }
      .wn-icon {
        font-size: 2.4rem; color: #ff3366;
        text-shadow: 0 0 20px rgba(255,51,102,0.6);
        margin-bottom: 8px;
        animation: wnPulse 2s infinite;
      }
      @keyframes wnPulse { 0%,100%{opacity:1;} 50%{opacity:0.5;} }
      .wn-tag {
        font-size: 0.6rem; letter-spacing: 4px;
        color: rgba(255,51,102,0.5); margin-bottom: 6px;
      }
      .wn-title {
        font-family: 'Orbitron', monospace;
        font-size: 1.8rem; font-weight: 900;
        color: #ff3366; letter-spacing: 6px;
        text-shadow: 0 0 30px rgba(255,51,102,0.4);
        margin-bottom: 4px;
      }
      .wn-divider {
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(255,51,102,0.25), transparent);
        margin: 16px 0;
      }
      .wn-body {
        font-size: 0.75rem; color: rgba(204,255,0,0.55);
        letter-spacing: 1px; line-height: 1.9;
      }
      .wn-highlight {
        color: #00ff9d; font-size: 0.85rem;
        letter-spacing: 3px;
      }
      .wn-info-row {
        display: flex; justify-content: space-between;
        align-items: center; margin: 8px 0; text-align: left;
      }
      .wn-lbl { font-size: 0.6rem; letter-spacing: 2px; color: rgba(204,255,0,0.3); }
      .wn-val { font-size: 0.72rem; letter-spacing: 1px; color: #ccff00; }
      #wnSwitchBtn {
        width: 100%; margin-top: 4px;
        border-color: #00ff9d !important; color: #00ff9d !important;
        letter-spacing: 2px; padding: 14px 20px;
        font-size: 0.8rem;
      }
      #wnSwitchBtn:hover {
        background: rgba(0,255,157,0.1) !important;
        box-shadow: 0 0 20px rgba(0,255,157,0.2) !important;
      }
    `;
    document.head.appendChild(s);
  }

  document.body.appendChild(overlay);
  document.getElementById("wnSwitchBtn").addEventListener("click", async () => {
    const ok = await switchToRitualTestnet();
    if (ok) hideWrongNetworkOverlay();
  });
}

function hideWrongNetworkOverlay() {
  const el = document.getElementById("wrongNetworkOverlay");
  if (el) el.remove();
}

// React to user manually switching network in MetaMask
if (window.ethereum) {
  window.ethereum.on("chainChanged", (chainId) => {
    if (chainId.toLowerCase() === RITUAL_TESTNET.chainId.toLowerCase()) {
      hideWrongNetworkOverlay();
    } else {
      showWrongNetworkOverlay();
    }
  });
}

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
const COLS    = 10;
const ROWS    = 20;
const TARGET  = 9999;

// BLOCK size dihitung dinamis berdasarkan ruang layar yang tersedia
let BLOCK = 30;

function resizeCanvas() {
  // Available height = viewport minus header minus gameScreen top padding minus game-label row
  const headerH   = document.querySelector(".terminal-header")?.offsetHeight || 64;
  const labelH    = 20; // .game-label height + margin (~0.6rem + 6px)
  const paddingH  = 8;  // #gameScreen padding-top
  const reserved  = headerH + paddingH + labelH + 8; // 8px bottom breathing room
  const availH    = window.innerHeight - reserved;

  // Derive BLOCK size from available height (board is ROWS=20 rows tall)
  const blockFromH = Math.floor(availH / ROWS);
  BLOCK = Math.min(36, Math.max(20, blockFromH));

  canvas.width  = BLOCK * COLS;
  canvas.height = BLOCK * ROWS;

  // Sync side-panel height to match board height exactly, preventing overflow
  const sidePanel = document.querySelector(".side-panel");
  if (sidePanel) {
    sidePanel.style.maxHeight = canvas.height + "px";
  }

  // Store header height as CSS var for #gameScreen height calc
  document.documentElement.style.setProperty("--header-h", headerH + "px");
}

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
      setTimeout(() => showResult("pvp"), 800);
    } else if (currentMode === "vs-ai") {
      stopAi();
      // Use opponentScore/Lines to hold AI final score for result display
      opponentScore = aiScore;
      opponentLines = aiLines;
      showResult("vs-ai");
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
  resizeCanvas(); // ← sesuaikan ukuran canvas dengan layar saat ini
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
    syncBoardToPvp();
    clearInterval(pvpSyncInterval);
    pvpSyncInterval = setInterval(syncBoardToPvp, 500);
  }
  if (mode === "vs-ai") {
    startAi();
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
  } else if (mode === "vs-ai") {
    modeLabel.textContent  = "VS AI";
    modeLabel.style.borderColor = "rgba(0,200,255,0.3)";
    modeLabel.style.color  = "#00ccff";
    modeLabel.style.background = "rgba(0,200,255,0.05)";

    // Inject AI board INSIDE the side-panel, at the very top (before active protocol block)
    const sidePanel = document.querySelector(".side-panel");
    const panel = document.createElement("div");
    panel.id = "opponentPanel";
    panel.style.cssText = "display:flex; flex-direction:column; align-items:center; gap:6px; margin-bottom:8px; flex-shrink:1; min-height:0;";
    panel.innerHTML = `
      <div style="font-size:0.62rem; letter-spacing:3px; color:rgba(0,200,255,0.6); align-self:flex-start;">
        // RITUAL_AI
      </div>
      <div style="
        font-size:0.5rem; letter-spacing:2px; color:rgba(0,200,255,0.35);
        text-align:center; line-height:1.6; align-self:flex-start;
      ">NIGHTMARE — 2-PLY LOOKAHEAD</div>
      <div style="position:relative; width:100%; flex-shrink:1; min-height:0;">
        <canvas id="aiCanvas"
          style="display:block; width:100%; max-width:100%; border:1px solid rgba(0,200,255,0.4);
                 background:#000; box-shadow:0 0 20px rgba(0,200,255,0.15);
                 image-rendering:pixelated;">
        </canvas>
        <div style="
          position:absolute; top:6px; right:6px;
          width:8px; height:8px; border-radius:50%;
          background:#00ccff; box-shadow:0 0 6px #00ccff;
          animation:blink 1.2s infinite;
        "></div>
      </div>
      <div style="display:flex; gap:6px; width:100%;">
        <div style="flex:1; border:1px solid rgba(0,200,255,0.2); background:#060606; padding:8px 10px;">
          <div style="font-size:0.5rem; letter-spacing:1px; color:rgba(0,200,255,0.35); margin-bottom:4px;">// AI SCORE</div>
          <div id="aiScoreVal" style="font-family:'Orbitron',monospace; font-size:0.85rem; font-weight:700; color:#00ccff; letter-spacing:1px;">00000</div>
        </div>
        <div style="flex:1; border:1px solid rgba(0,200,255,0.2); background:#060606; padding:8px 10px;">
          <div style="font-size:0.5rem; letter-spacing:1px; color:rgba(0,200,255,0.35); margin-bottom:4px;">LV / LINES</div>
          <div style="display:flex; gap:6px; align-items:baseline;">
            <div id="aiLevelVal" style="font-family:'Orbitron',monospace; font-size:0.85rem; font-weight:700; color:#00ccff; letter-spacing:1px;">01</div>
            <div style="font-size:0.5rem; color:rgba(0,200,255,0.35);">/</div>
            <div id="aiLinesVal" style="font-family:'Orbitron',monospace; font-size:0.85rem; font-weight:700; color:#00ccff; letter-spacing:1px;">000</div>
          </div>
        </div>
      </div>
      <div style="height:1px; width:100%; background:linear-gradient(90deg,transparent,rgba(0,200,255,0.2),transparent); margin:4px 0;"></div>
    `;
    // Insert at the TOP of side-panel (before all existing children)
    sidePanel.insertBefore(panel, sidePanel.firstChild);
    // Size the AI canvas: fill panel width, height = width * 2 (10col × 20row ratio)
    // But cap at 45% of board height so info blocks below always fit
    const aiCanvas = panel.querySelector("#aiCanvas");
    const panelW = Math.min(210, Math.round(window.innerWidth * 0.18));
    const aiW = Math.max(80, panelW - 24);
    // Cap height: at most 45% of the player board height to leave room for stats
    const maxAiH = Math.floor(canvas.height * 0.45);
    const aiH = Math.min(aiW * 2, maxAiH);
    aiCanvas.width  = aiW;
    aiCanvas.height = aiH;
    // Reset game area styles (no extra gap needed)
    gameScreen.style.justifyContent = "";
    gameScreen.style.gap = "";
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
//  AI ENGINE — Pierre Dellacherie Algorithm
//  Evaluates every possible placement for the
//  current piece and picks the best one based on
//  weighted heuristics. Near-superhuman level.
// ══════════════════════════════════════════════

// AI state
let aiBoard = null;          // AI's own board (separate from player's)
let aiScore = 0;
let aiLines = 0;
let aiLevel = 1;
let aiCurrentPiece = null;
let aiNextPiece    = null;
let aiPieceX = 0;
let aiPieceY = 0;
let aiDropInterval = 60;    // AI drops very fast — superhuman speed
let aiLastDrop = 0;
let aiAnimFrameId = null;
let aiRunning = false;
let aiMoveQueue = [];        // queued moves to animate (left/right/rotate)
let aiMoveTimer = null;
let aiGameOver = false;

// ── AI Heuristic weights (NIGHTMARE MODE — near-unbeatable) ──
const AI_WEIGHTS = {
  linesCleared:    10.0,  // aggressively reward clearing lines
  holes:          -12.0,  // annihilate holes — top priority
  bumpiness:       -3.5,  // demand a flat surface
  aggregateHeight: -4.5,  // stay very low at all times
  wellDepth:        2.5,  // maintain I-piece well
  coveredHoles:   -8.0,   // extra penalty for buried holes
  rowTransitions: -3.2,   // penalize uneven rows
  colTransitions: -4.0,   // penalize column gaps
  tetrisReady:     6.0,   // reward near-Tetris setups
};

// Clone a board (2D array)
function cloneBoard(b) {
  return b.map(row => [...row]);
}

// Try to place a piece at given x, rotation on a board — returns final Y or -1 if invalid
function aiDropPiece(b, shape, startX) {
  let y = 0;
  // Find lowest valid Y
  while (!aiCollideAt(b, shape, startX, y + 1)) y++;
  // Check it's a valid placement (piece fits at y=0 at least)
  if (aiCollideAt(b, shape, startX, 0)) return { y: -1, valid: false };
  return { y, valid: true };
}

function aiCollideAt(b, shape, nx, ny) {
  return shape.some((row, dy) =>
    row.some((v, dx) => v && (
      nx + dx < 0 || nx + dx >= COLS || ny + dy >= ROWS ||
      (ny + dy >= 0 && b[ny + dy]?.[nx + dx])
    ))
  );
}

function aiRotateShape(shape) {
  return shape[0].map((_, i) => shape.map(row => row[i]).reverse());
}

// Place piece on cloned board, return new board
function aiMergePiece(b, shape, x, y, color) {
  const nb = cloneBoard(b);
  shape.forEach((row, dy) => row.forEach((v, dx) => {
    if (v && y + dy >= 0) nb[y + dy][x + dx] = color;
  }));
  return nb;
}

// Clear lines, return { board, cleared }
function aiClearLines(b) {
  let cleared = 0;
  const nb = b.filter(row => {
    if (row.every(cell => cell)) { cleared++; return false; }
    return true;
  });
  while (nb.length < ROWS) nb.unshift(Array(COLS).fill(null));
  return { board: nb, cleared };
}

// Count holes (empty cells with a filled cell above)
function countHoles(b) {
  let holes = 0;
  for (let c = 0; c < COLS; c++) {
    let blockFound = false;
    for (let r = 0; r < ROWS; r++) {
      if (b[r][c]) blockFound = true;
      else if (blockFound) holes++;
    }
  }
  return holes;
}

// Column heights
function getHeights(b) {
  return Array.from({ length: COLS }, (_, c) => {
    for (let r = 0; r < ROWS; r++) if (b[r][c]) return ROWS - r;
    return 0;
  });
}

// Bumpiness = sum of absolute differences between adjacent columns
function getBumpiness(heights) {
  let bump = 0;
  for (let i = 0; i < heights.length - 1; i++) bump += Math.abs(heights[i] - heights[i + 1]);
  return bump;
}

// Well depth (column much lower than both neighbors — good for I piece)
function getWellDepth(heights) {
  let total = 0;
  for (let i = 0; i < heights.length; i++) {
    const left  = i > 0               ? heights[i - 1] : 99;
    const right = i < heights.length-1 ? heights[i + 1] : 99;
    const well  = Math.min(left, right) - heights[i];
    if (well > 0) total += well;
  }
  return total;
}

// Count cells with filled cells above AND below (buried holes — worse)
function countCoveredHoles(b) {
  let covered = 0;
  for (let c = 0; c < COLS; c++) {
    let blockAbove = false;
    let depth = 0;
    for (let r = 0; r < ROWS; r++) {
      if (b[r][c]) { blockAbove = true; depth = 0; }
      else if (blockAbove) { depth++; covered += depth; }
    }
  }
  return covered;
}

// Row transitions: filled→empty or empty→filled in each row
function getRowTransitions(b) {
  let trans = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS - 1; c++) {
      if (!!b[r][c] !== !!b[r][c+1]) trans++;
    }
    // borders count as filled
    if (!b[r][0]) trans++;
    if (!b[r][COLS-1]) trans++;
  }
  return trans;
}

// Column transitions: filled→empty or empty→filled in each column
function getColTransitions(b) {
  let trans = 0;
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS - 1; r++) {
      if (!!b[r][c] !== !!b[r+1][c]) trans++;
    }
  }
  return trans;
}

// Reward having exactly one well column of height >= 4 (Tetris ready)
function getTetrisReadiness(heights) {
  let minH = Math.min(...heights);
  let minCount = heights.filter(h => h === minH).length;
  let neighborMin = heights.filter((h, i) => {
    const l = i > 0 ? heights[i-1] : 99;
    const r = i < heights.length-1 ? heights[i+1] : 99;
    return (l - h >= 3 && r - h >= 3);
  }).length;
  return minCount === 1 && neighborMin >= 1 ? 1 : 0;
}

// Evaluate a board state — higher is better
function evaluateBoard(b, linesCleared) {
  const heights      = getHeights(b);
  const aggH         = heights.reduce((a, v) => a + v, 0);
  const holes        = countHoles(b);
  const coveredHoles = countCoveredHoles(b);
  const bump         = getBumpiness(heights);
  const well         = getWellDepth(heights);
  const rowTrans     = getRowTransitions(b);
  const colTrans     = getColTransitions(b);
  const tetrisReady  = getTetrisReadiness(heights);

  // Extra penalty if stack is dangerously high
  const maxH = Math.max(...heights);
  const dangerPenalty = maxH > 14 ? (maxH - 14) * -8.0 : 0;

  // Bonus for clearing 4 lines (Tetris)
  const tetrisBonus = linesCleared === 4 ? 20 : 0;

  return (
    AI_WEIGHTS.linesCleared    * linesCleared  +
    AI_WEIGHTS.holes           * holes         +
    AI_WEIGHTS.coveredHoles    * coveredHoles  +
    AI_WEIGHTS.bumpiness       * bump          +
    AI_WEIGHTS.aggregateHeight * aggH          +
    AI_WEIGHTS.wellDepth       * well          +
    AI_WEIGHTS.rowTransitions  * rowTrans      +
    AI_WEIGHTS.colTransitions  * colTrans      +
    AI_WEIGHTS.tetrisReady     * tetrisReady   +
    dangerPenalty + tetrisBonus
  );
}

// Find the best move using 2-piece lookahead (current + next piece)
function aiFindBestMove(b, piece) {
  let bestScore = -Infinity;
  let bestMove  = { rotations: 0, x: 0 };
  let shape = piece.shape;

  for (let rot = 0; rot < 4; rot++) {
    const w = shape[0].length;
    for (let x = -1; x <= COLS - w + 1; x++) {
      const { y, valid } = aiDropPiece(b, shape, x);
      if (!valid) continue;
      const merged = aiMergePiece(b, shape, x, y, piece.color);
      const { board: cleared, cleared: numCleared } = aiClearLines(merged);
      const immediate = evaluateBoard(cleared, numCleared);

      // ── 2-piece lookahead with next piece ──
      let bestNext = -Infinity;
      if (aiNextPiece) {
        let nextShape = aiNextPiece.shape;
        for (let rot2 = 0; rot2 < 4; rot2++) {
          const w2 = nextShape[0].length;
          for (let x2 = -1; x2 <= COLS - w2 + 1; x2++) {
            const { y: y2, valid: v2 } = aiDropPiece(cleared, nextShape, x2);
            if (!v2) continue;
            const m2 = aiMergePiece(cleared, nextShape, x2, y2, aiNextPiece.color);
            const { board: c2, cleared: n2 } = aiClearLines(m2);
            const s2 = evaluateBoard(c2, n2);
            if (s2 > bestNext) bestNext = s2;
          }
          nextShape = aiRotateShape(nextShape);
        }
      }

      // Weight: 60% immediate + 40% lookahead
      const combined = immediate * 0.6 + (bestNext === -Infinity ? immediate : bestNext) * 0.4;
      if (combined > bestScore) {
        bestScore = combined;
        bestMove  = { rotations: rot, x, y };
      }
    }
    shape = aiRotateShape(shape);
  }
  return bestMove;
}

// Execute AI move: queue the rotation + translation steps, then hard-drop
function aiExecuteMove(move) {
  const steps = [];
  // Queue rotations
  for (let i = 0; i < move.rotations; i++) steps.push("rotate");
  // Queue horizontal moves
  const dx = move.x - aiPieceX;
  const dir = dx > 0 ? "right" : "left";
  for (let i = 0; i < Math.abs(dx); i++) steps.push(dir);
  // Final hard drop
  steps.push("drop");
  aiMoveQueue = steps;
  aiProcessMoveQueue();
}

function aiProcessMoveQueue() {
  if (!aiRunning || aiMoveQueue.length === 0) return;
  const action = aiMoveQueue.shift();

  if (action === "rotate") {
    const rotated = aiRotateShape(aiCurrentPiece.shape);
    // Try kick if needed
    let kicked = false;
    for (const kick of [0, 1, -1, 2, -2]) {
      if (!aiCollideAt(aiBoard, rotated, aiPieceX + kick, aiPieceY)) {
        aiCurrentPiece.shape = rotated;
        aiPieceX += kick;
        kicked = true;
        break;
      }
    }
  } else if (action === "right") {
    if (!aiCollideAt(aiBoard, aiCurrentPiece.shape, aiPieceX + 1, aiPieceY)) aiPieceX++;
  } else if (action === "left") {
    if (!aiCollideAt(aiBoard, aiCurrentPiece.shape, aiPieceX - 1, aiPieceY)) aiPieceX--;
  } else if (action === "drop") {
    // Hard drop
    while (!aiCollideAt(aiBoard, aiCurrentPiece.shape, aiPieceX, aiPieceY + 1)) aiPieceY++;
    aiLockAndSpawn();
    return;
  }

  // Draw AI board after each step
  drawAiBoard();
  // Continue queue with tiny delay — lightning fast moves
  aiMoveTimer = setTimeout(aiProcessMoveQueue, 18);
}

function aiLockAndSpawn() {
  // Merge piece into AI board
  aiCurrentPiece.shape.forEach((row, dy) => row.forEach((v, dx) => {
    if (v && aiPieceY + dy >= 0) aiBoard[aiPieceY + dy][aiPieceX + dx] = aiCurrentPiece.color;
  }));

  // Clear lines
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (aiBoard[r].every(cell => cell)) {
      aiBoard.splice(r, 1);
      aiBoard.unshift(Array(COLS).fill(null));
      cleared++; r++;
    }
  }
  if (cleared) {
    const pts = [0, 100, 300, 500, 800][cleared] * aiLevel;
    aiScore += pts;
    aiLines += cleared;
    aiLevel  = Math.floor(aiLines / 10) + 1;
    updateAiUI();
  }

  drawAiBoard();

  // Spawn next
  aiCurrentPiece = aiNextPiece;
  aiNextPiece    = randomPiece();
  aiPieceX = Math.floor(COLS / 2) - Math.floor(aiCurrentPiece.shape[0].length / 2);
  aiPieceY = 0;

  // Check game over for AI (it almost never loses)
  if (aiCollideAt(aiBoard, aiCurrentPiece.shape, aiPieceX, aiPieceY)) {
    aiGameOver = true;
    aiRunning  = false;
    updateAiUI();
    return;
  }

  // Plan next move — almost no pause between pieces
  if (aiRunning) {
    const move = aiFindBestMove(aiBoard, aiCurrentPiece);
    setTimeout(() => aiExecuteMove(move), 60); // near-instant next piece
  }
}

// ── Draw AI board onto #aiCanvas ──
function drawAiBoard() {
  const aiCanvas = document.getElementById("aiCanvas");
  if (!aiCanvas || !aiBoard) return;
  const ac  = aiCanvas.getContext("2d");
  // Use the canvas's actual pixel width (set as attribute in setupGameScreenForMode)
  const AB  = Math.floor((aiCanvas.width || 150) / COLS);
  ac.clearRect(0, 0, aiCanvas.width, aiCanvas.height);

  // Draw locked cells
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const color = aiBoard[r][c];
      if (color) {
        ac.save();
        ac.globalAlpha = 0.85;
        ac.fillStyle = color;
        ac.fillRect(c * AB + 1, r * AB + 1, AB - 2, AB - 2);
        ac.globalAlpha = 1;
        const g = ac.createLinearGradient(c*AB, r*AB, c*AB+AB, r*AB+AB);
        g.addColorStop(0,   "rgba(255,255,255,0.42)");
        g.addColorStop(0.4, "rgba(255,255,255,0.08)");
        g.addColorStop(1,   "rgba(0,0,0,0.28)");
        ac.fillStyle = g;
        ac.fillRect(c * AB + 1, r * AB + 1, AB - 2, AB - 2);
        ac.shadowColor = color;
        ac.shadowBlur  = 8;
        ac.strokeStyle = color;
        ac.lineWidth   = 1;
        ac.strokeRect(c * AB + 1.5, r * AB + 1.5, AB - 3, AB - 3);
        ac.shadowBlur  = 0;
        ac.fillStyle = "rgba(255,255,255,0.5)";
        ac.fillRect(c * AB + 2, r * AB + 2, AB - 4, 1.5);
        ac.fillRect(c * AB + 2, r * AB + 2, 1.5, AB - 4);
        ac.restore();
      } else {
        ac.strokeStyle = "rgba(0,200,255,0.04)";
        ac.lineWidth   = 0.5;
        ac.strokeRect(c * AB, r * AB, AB, AB);
      }
    }
  }

  // Draw current AI piece with ghost
  if (aiCurrentPiece && aiRunning) {
    // Ghost
    let ghostY = aiPieceY;
    while (!aiCollideAt(aiBoard, aiCurrentPiece.shape, aiPieceX, ghostY + 1)) ghostY++;
    if (ghostY !== aiPieceY) {
      ac.globalAlpha = 0.12;
      ac.fillStyle = aiCurrentPiece.color;
      aiCurrentPiece.shape.forEach((row, dy) => row.forEach((v, dx) => {
        if (v) ac.fillRect((aiPieceX + dx) * AB, (ghostY + dy) * AB, AB, AB);
      }));
      ac.globalAlpha = 1;
    }
    // Active piece
    aiCurrentPiece.shape.forEach((row, dy) => row.forEach((v, dx) => {
      if (v && aiPieceY + dy >= 0) {
        ac.save();
        ac.globalAlpha = 0.9;
        ac.fillStyle = aiCurrentPiece.color;
        ac.fillRect((aiPieceX + dx) * AB + 1, (aiPieceY + dy) * AB + 1, AB - 2, AB - 2);
        ac.globalAlpha = 1;
        ac.fillStyle = "rgba(255,255,255,0.5)";
        ac.fillRect((aiPieceX + dx) * AB + 2, (aiPieceY + dy) * AB + 2, AB - 4, 1.5);
        ac.restore();
      }
    }));
  }

  // Grid
  ac.strokeStyle = "rgba(0,200,255,0.04)";
  ac.lineWidth = 0.5;
  for (let c = 0; c <= COLS; c++) {
    ac.beginPath(); ac.moveTo(c * AB, 0); ac.lineTo(c * AB, aiCanvas.height); ac.stroke();
  }
  for (let r = 0; r <= ROWS; r++) {
    ac.beginPath(); ac.moveTo(0, r * AB); ac.lineTo(aiCanvas.width, r * AB); ac.stroke();
  }
}

// ── Update AI panel stats ──
function updateAiUI() {
  const el = document.getElementById("aiScoreVal");
  if (el) el.textContent = String(aiScore).padStart(5, "0");
  const ll = document.getElementById("aiLinesVal");
  if (ll) ll.textContent = String(aiLines).padStart(3, "0");
  const lv = document.getElementById("aiLevelVal");
  if (lv) lv.textContent = String(aiLevel).padStart(2, "0");
}

// ── Start AI engine ──
function startAi() {
  aiBoard        = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  aiScore        = 0;
  aiLines        = 0;
  aiLevel        = 1;
  aiGameOver     = false;
  aiRunning      = true;
  aiMoveQueue    = [];
  aiCurrentPiece = randomPiece();
  aiNextPiece    = randomPiece();
  aiPieceX       = Math.floor(COLS / 2) - Math.floor(aiCurrentPiece.shape[0].length / 2);
  aiPieceY       = 0;
  updateAiUI();

  // Kick off first move after a very short intro pause
  setTimeout(() => {
    if (!aiRunning) return;
    const move = aiFindBestMove(aiBoard, aiCurrentPiece);
    aiExecuteMove(move);
  }, 200);
}

// ── Stop AI engine ──
function stopAi() {
  aiRunning = false;
  clearTimeout(aiMoveTimer);
  aiMoveQueue = [];
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
  const isVsAi   = mode === "vs-ai";
  const myWon    = (isPvp || isVsAi) ? (score >= opponentScore) : (score >= TARGET);
  const isDraw   = (isPvp || isVsAi) && score === opponentScore;

  // Determine header info
  let headerTag, headerTitle, headerColor;
  if (!isPvp && !isVsAi) {
    headerTag   = "// SESSION TERMINATED";
    headerTitle = score >= TARGET ? "VICTORY" : "GAME OVER";
    headerColor = score >= TARGET ? "#00ff9d" : "#ff3366";
  } else if (isDraw) {
    headerTag   = isVsAi ? "// VS AI RESULT" : "// PVP MATCH RESULT";
    headerTitle = "DRAW";
    headerColor = "#ffcc00";
  } else if (myWon) {
    headerTag   = isVsAi ? "// VS AI RESULT" : "// PVP MATCH RESULT";
    headerTitle = isVsAi ? "YOU BEAT THE AI!" : "VICTORY";
    headerColor = "#00ff9d";
  } else {
    headerTag   = isVsAi ? "// VS AI RESULT" : "// PVP MATCH RESULT";
    headerTitle = isVsAi ? "AI WINS" : "DEFEATED";
    headerColor = "#ff3366";
  }

  const oppLabel  = isVsAi ? "RITUAL AI" : "OPPONENT";
  const oppColor  = isVsAi ? "#00ccff"   : "#ff00cc";
  const pvpRows = (isPvp || isVsAi) ? `
    <div class="result-vs-row">
      <div class="result-vs-col">
        <div class="result-vs-label">YOU</div>
        <div class="result-vs-score" style="color:${myWon && !isDraw ? '#00ff9d':'#ccff00'}">
          ${String(score).padStart(5,"0")}
        </div>
        <div class="result-vs-sub">${lines} LINES · LV${level}${isVsAi && myWon && !isDraw ? ' · REWARD CLAIMED' : ''}</div>
      </div>
      <div class="result-vs-divider">VS</div>
      <div class="result-vs-col">
        <div class="result-vs-label">${oppLabel}</div>
        <div class="result-vs-score" style="color:${!myWon && !isDraw ? '#00ff9d': oppColor}">
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
        ${((isVsAi && myWon && !isDraw) || (!isPvp && !isVsAi && score >= TARGET) || (isPvp && myWon && !isDraw)) && contract ? `
        <button class="ritual-btn result-claim-btn" id="resClaimBtn">
          ⚡ CLAIM REWARD
        </button>
        ` : ''}
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

  // Claim reward button (if applicable)
  const claimBtn = modal.querySelector("#resClaimBtn");
  if (claimBtn) {
    claimBtn.addEventListener("click", async () => {
      claimBtn.disabled = true;
      claimBtn.textContent = "⏳ CLAIMING...";
      try {
        if (isVsAi && myWon && !isDraw && contract) {
          await claimSingleReward();
        } else if (!isPvp && !isVsAi && score >= TARGET && contract) {
          await claimSingleReward();
        } else if (isPvp && myWon && !isDraw && contract && pvpMatchId !== null) {
          await claimPvpReward();
        }
        claimBtn.textContent = "✅ REWARD CLAIMED!";
        claimBtn.style.borderColor = "rgba(0,255,157,0.6)";
        claimBtn.style.color = "#00ff9d";
      } catch(e) {
        claimBtn.disabled = false;
        claimBtn.textContent = "⚡ CLAIM REWARD";
      }
    });
  }

  modal.querySelector("#resRestartBtn").addEventListener("click", async () => {
    closeResult();
    if (currentMode === "single") {
      if (await payEntry("single")) startGame("single");
    } else if (currentMode === "vs-ai") {
      if (await payEntry("single")) startGame("vs-ai");
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
  const isPvp  = currentMode === "pvp";
  const isVsAi = currentMode === "vs-ai";
  const won    = (isPvp || isVsAi) ? score >= opponentScore : score >= TARGET;
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
  sc.fillText(isPvp ? "PVP ARENA" : isVsAi ? "VS AI" : "SOLO MODE", sx + sw / 2, sy + 280);
  sc.textAlign = "left";

  // Footer
  sc.fillStyle = "rgba(0,255,157,0.3)";
  sc.font = "9px 'Courier New'";
  sc.fillText("RITUAL TETRIS  |  ritual-tetris.vercel.app", 28, 494);

  // Build tweet text
  const modeStr  = currentMode === "pvp" ? "PVP Arena" : currentMode === "vs-ai" ? "vs AI" : "Solo Mode";
  const resultStr = currentMode === "vs-ai"
    ? (score > opponentScore ? "🤖 Beat the AI!" : score === opponentScore ? "🤝 Draw vs AI" : "🤖 AI Wins")
    : (currentMode === "pvp" ? score >= opponentScore : score >= TARGET)
      ? "🏆 VICTORY"
      : "💀 Game Over";
  const tweet = encodeURIComponent(
    `${resultStr} — ${String(score).padStart(5,"0")} pts · LV${level} · ${lines} lines\n` +
    `Playing [RITUAL] TETRIS on-chain! 🎮⛓️\n` +
    `Mode: ${modeStr} | Network: Ritual Testnet\n\n` +
    `🕹️ Play here: https://ritual-tetris.vercel.app/\n\n` +
    `@0xEyesofEtresia @Ritualnet\n` +
    `#RitualTestnet`
  );

  // Open Twitter IMMEDIATELY (synchronous, before any async) to avoid popup blocker
  const twitterWindow = window.open(`https://x.com/intent/tweet?text=${tweet}`, "_blank");
  if (!twitterWindow) {
    // If popup was blocked, show a fallback link in the modal
    const shareBtn = document.getElementById("shareXBtn");
    if (shareBtn) {
      shareBtn.innerHTML = `<a href="https://x.com/intent/tweet?text=${tweet}" target="_blank" style="color:inherit;text-decoration:none;">𝕏 OPEN TWITTER (click here)</a>`;
    }
  }

  // Download the share image (async is fine for download)
  shareCanvas.toBlob((blob) => {
    if (!blob) return;
    const url  = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = `ritual-tetris-${Date.now()}.png`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
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
    .result-claim-btn {
      border-color: rgba(255,204,0,0.5) !important;
      background: rgba(255,204,0,0.06) !important;
      color: #ffcc00 !important;
      flex: 1;
      letter-spacing: 2px;
    }
    .result-claim-btn:hover {
      background: rgba(255,204,0,0.12) !important;
      border-color: #ffcc00 !important;
      box-shadow: 0 0 16px rgba(255,204,0,0.2) !important;
    }
    .result-claim-btn:disabled {
      opacity: 0.7;
      cursor: not-allowed;
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
let hostOnChainMatchId = null; // on-chain matchId milik host, dipakai untuk refund

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
      const entries = Object.entries(openLobbies);
      for (const [lobbyMatchId, lobbyData] of entries) {
        const isOurs  = myWalletAddr && lobbyData.hostAddr === myWalletAddr;
        const isStale = Date.now() - (lobbyData.ts || 0) > 180_000;
        if (!isOurs && !isStale) {
          joinedExisting = true;
          pvpMatchId = lobbyMatchId;   // Firebase key, misal "M5"
          pvpRole    = "guest";
          document.getElementById("pvpMatchIdDisplay").textContent = pvpMatchId;

          // Ambil onChainMatchId yang disimpan host
          const onChainMatchId = lobbyData.onChainMatchId;
          if (onChainMatchId === undefined || onChainMatchId === null) {
            console.warn("onChainMatchId tidak ditemukan di lobby data");
            joinedExisting = false;
            break;
          }

    // ── GUEST: bayar ke contract dan join match on-chain ──
          updatePvpStatus("JOINING MATCH ON-CHAIN…", "#ffcc00");
          try {
            const tx = await contract.joinPvPMatch(onChainMatchId, {
              value: ethers.parseEther("0.005")
            });
            await tx.wait();
          } catch(contractErr) {
            showToast("Failed to join match on-chain: " + contractErr.message);
            joinedExisting = false;
            break;
          }

          // Hapus dari lobby setelah berhasil join
          await FB.remove(`lobbies/open/${pvpMatchId}`);
          // Beritahu host bahwa guest sudah join
          await sendPvpUpdate("OPPONENT_JOINED", {
            guestAddr:      myWalletAddr || "anonymous",
            onChainMatchId: onChainMatchId,
          });

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
    pvpRole = "host";
    // pvpMatchId sudah di-set on-chain oleh payEntry() — jangan overwrite dengan string
    const onChainMatchId = pvpMatchId; // integer dari contract
    hostOnChainMatchId   = onChainMatchId; // simpan ke module scope untuk cancel & timeout
    // Firebase key tidak boleh angka murni, pakai prefix "M"
    const fbLobbyKey = `M${onChainMatchId}`;
    document.getElementById("pvpMatchIdDisplay").textContent = fbLobbyKey;

    try {
      await FB.set(`lobbies/open/${fbLobbyKey}`, {
        hostAddr:      myWalletAddr || "anonymous",
        onChainMatchId: onChainMatchId,  // ← guest butuh ini untuk joinPvPMatch di contract
        ts:            Date.now(),
      });
    } catch(e) {
      console.warn("Could not post lobby:", e);
    }

    // Ganti pvpMatchId ke fbLobbyKey agar Firebase path konsisten
    pvpMatchId = fbLobbyKey;

    // Init board listeners so we're ready when guest joins
    initPvpListeners();

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

      if (waitingElapsed % 5000 === 0) {
        const dots = ".".repeat(((waitingElapsed / 5000) % 3) + 1);
        const statusEl = document.getElementById("pvpStatus");
        if (statusEl && statusEl.textContent.startsWith("SEARCHING")) {
          statusEl.textContent = `SEARCHING${dots}`;
        }
      }

      if (waitingElapsed >= MATCHMAKE_TIMEOUT_MS) {
        clearInterval(waitingTickInterval);
        onMatchmakeTimeout(hostOnChainMatchId); // kirim onChainMatchId untuk refund
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
      // Hapus lobby dari Firebase
      await FB.remove(`lobbies/open/${pvpMatchId}`).catch(() => {});

      // Refund via contract menggunakan hostOnChainMatchId (module scope)
      if (hostOnChainMatchId !== null && contract) {
        try {
          updatePvpStatus("PROCESSING REFUND…", "#ffcc00");
          const tx = await contract.cancelPvPMatch(hostOnChainMatchId);
          await tx.wait();
          updatePvpStatus("REFUND 0.005 RITUAL BERHASIL ✓", "#00ff9d");
          await new Promise(r => setTimeout(r, 1500));
        } catch(e) {
          const isRejected = e.code === 4001
            || e.code === "ACTION_REJECTED"
            || (e.message && e.message.toLowerCase().includes("user denied"))
            || (e.message && e.message.toLowerCase().includes("user rejected"));
          if (!isRejected) console.warn("Refund gagal saat cancel:", e.message);
        }
      }
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

async function onMatchmakeTimeout(onChainMatchId) {
  updatePvpStatus("NO OPPONENT FOUND", "#ff3366");

  if (pvpRole === "host" && pvpMatchId) {
    FB.remove(`lobbies/open/${pvpMatchId}`).catch(() => {});
  }

  if (pvpRole === "host" && onChainMatchId !== undefined && onChainMatchId !== null && contract) {
    updatePvpStatus("PROCESSING REFUND…", "#ffcc00");
    try {
      const tx = await contract.cancelPvPMatch(onChainMatchId);
      await tx.wait();
      updatePvpStatus("REFUND 0.005 RITUAL BERHASIL ✓", "#00ff9d");
    } catch(e) {
      const isRejected = e.code === 4001
        || e.code === "ACTION_REJECTED"
        || (e.message && e.message.toLowerCase().includes("user denied"))
        || (e.message && e.message.toLowerCase().includes("user rejected"));
      if (!isRejected) console.warn("Refund gagal:", e.message);
      updatePvpStatus("REFUND DIBATALKAN", "#ff3366");
    }
  }

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
  const preConnect = document.getElementById("preConnectCenter");
  const footer     = document.getElementById("siteFooter");
  const gameScreen = document.getElementById("gameScreen");

  if (id === "gameScreen") {
    if (preConnect) preConnect.style.display = "none";
    if (footer)     footer.style.display     = "none";
    gameScreen.classList.remove("hidden");
    document.body.classList.add("game-active");
  } else {
    // kembali ke mode select
    gameScreen.classList.add("hidden");
    if (preConnect) preConnect.style.display = "";
    if (footer)     footer.style.display     = "";
    document.body.classList.remove("game-active");
  }
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

// ── TOAST NOTIFICATION (replaces browser alert) ───────────────
function showToast(msg, type = "error") {
  let el = document.getElementById("ritualToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "ritualToast";
    const colors = {
      error:   { border: "rgba(255,51,102,0.6)",  bg: "rgba(255,51,102,0.08)",  text: "#ff3366" },
      success: { border: "rgba(0,255,157,0.6)",   bg: "rgba(0,255,157,0.08)",   text: "#00ff9d" },
      warn:    { border: "rgba(255,204,0,0.6)",   bg: "rgba(255,204,0,0.08)",   text: "#ffcc00" },
    };
    const s = document.createElement("style");
    s.textContent = `
      #ritualToast {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -60px);
        z-index: 9999;
        font-family: 'Share Tech Mono', monospace;
        font-size: 0.75rem;
        letter-spacing: 2px;
        padding: 14px 32px;
        border: 1px solid;
        max-width: 500px;
        width: 90%;
        text-align: center;
        opacity: 0;
        transition: opacity 0.25s, transform 0.25s;
        pointer-events: none;
        box-shadow: 0 0 40px rgba(0,0,0,0.6);
      }
      #ritualToast.visible {
        opacity: 1;
        transform: translate(-50%, -50%);
      }
    `;
    document.head.appendChild(s);
    document.body.appendChild(el);
  }
  const palette = {
    error:   { border: "rgba(255,51,102,0.6)",  bg: "rgba(255,51,102,0.08)",  text: "#ff3366" },
    success: { border: "rgba(0,255,157,0.6)",   bg: "rgba(0,255,157,0.08)",   text: "#00ff9d" },
    warn:    { border: "rgba(255,204,0,0.6)",   bg: "rgba(255,204,0,0.08)",   text: "#ffcc00" },
  }[type] || { border: "rgba(255,51,102,0.6)", bg: "rgba(255,51,102,0.08)", text: "#ff3366" };

  el.style.borderColor = palette.border;
  el.style.background  = palette.bg;
  el.style.color       = palette.text;
  el.textContent = msg;
  el.classList.add("visible");

  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove("visible"), 3500);
}

// ── WALLET ────────────────────────────────────
async function connectWallet() {
  if (!window.ethereum) return showToast("MetaMask not found. Please install it to continue.");
  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);

    // ── NETWORK CHECK ──────────────────────────
    const onCorrectNetwork = await isCorrectNetwork();
    if (!onCorrectNetwork) {
      const switched = await switchToRitualTestnet();
      if (!switched) {
        showWrongNetworkOverlay();
        return;
      }
      provider = new ethers.BrowserProvider(window.ethereum);
    }
    // ──────────────────────────────────────────

    signer   = await provider.getSigner();
    contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
    const addr = await signer.getAddress();
    myWalletAddr = addr;

    // Update UI — sembunyikan connectBtn, tampilkan walletInfo
    const connectBtn  = document.getElementById("connectBtn");
    const walletInfo  = document.getElementById("walletInfo");
    const walletAddr  = document.getElementById("walletAddr");
    const dot         = document.getElementById("statusDot");

    connectBtn.style.display = "none";
    walletAddr.textContent   = `${addr.slice(0,6)}…${addr.slice(-4)}`;
    walletInfo.style.display = "flex";
    dot.classList.remove("offline");
  } catch(e) {
    showToast("Connection failed: " + e.message);
  }
}

function disconnectWallet() {
  provider     = null;
  signer       = null;
  contract     = null;
  myWalletAddr = null;

  const connectBtn = document.getElementById("connectBtn");
  const walletInfo = document.getElementById("walletInfo");
  const dot        = document.getElementById("statusDot");

  connectBtn.style.display = "";
  walletInfo.style.display = "none";
  dot.classList.add("offline");
}

async function payEntry(mode) {
  if (!contract) { showToast("Please connect your wallet first."); return false; }
  const fee = mode === "single" ? "0.001" : "0.005";
  try {
    if (mode === "single") {
      const tx = await contract.enterSinglePlayer({ value: ethers.parseEther(fee) });
      await tx.wait();
    } else {
      const tx = await contract.createPvPMatch({ value: ethers.parseEther(fee) });
      const receipt = await tx.wait();

      const iface = new ethers.Interface([
        "event PvPMatchCreated(uint256 indexed matchId, address indexed player1)"
      ]);
      let foundMatchId = null;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed && parsed.name === "PvPMatchCreated") {
            foundMatchId = parsed.args.matchId;
            break;
          }
        } catch (_) {}
      }
      if (foundMatchId === null) {
        console.warn("Gagal mendapatkan Match ID dari contract.");
        return false;
      }
      pvpMatchId = Number(foundMatchId);
    }
    return true;
  } catch(e) {
    // Jika user sengaja reject di MetaMask — diam saja, tidak perlu popup
    const isRejected = e.code === 4001
      || e.code === "ACTION_REJECTED"
      || (e.message && e.message.toLowerCase().includes("user denied"))
      || (e.message && e.message.toLowerCase().includes("user rejected"));
    if (!isRejected) {
      console.warn("Transaksi gagal:", e.message);
    }
    return false;
  }
}

async function claimSingleReward() {
  try {
    const addr = await signer.getAddress();
    // Ambil nonce terkini dari contract — mencegah double-claim
    const nonce = await contract.claimNonce(addr);
    const tx = await contract.claimSinglePlayerReward(score, nonce);
    await tx.wait();
    console.log("✅ Single reward claimed! Nonce:", nonce.toString());
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
document.getElementById("disconnectBtn").addEventListener("click", disconnectWallet);

document.getElementById("singleBtn").addEventListener("click", async () => {
  if (await payEntry("single")) startGame("single");
});

document.getElementById("pvpBtn").addEventListener("click", async () => {
  pvpRole = null;
  if (await payEntry("pvp")) {
    showPvpWaiting();
  }
});

document.getElementById("vsAiBtn").addEventListener("click", async () => {
  // vs-AI uses same entry fee as solo (0.001 RITUAL) — no on-chain match needed
  if (await payEntry("single")) startGame("vs-ai");
});

document.getElementById("quitBtn").addEventListener("click", async () => {
  gameRunning = false;
  cancelAnimationFrame(animFrameId);
  if (currentMode === "vs-ai") stopAi();
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

console.log("%c🎮 Ritual Tetris — AI Edition Loaded", "color:#00ff9d; font-size:16px");

// ── RESPONSIVE CANVAS RESIZE ──────────────────
window.addEventListener("resize", () => {
  if (gameRunning) {
    resizeCanvas();
    draw();
  }
});
