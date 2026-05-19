// ══════════════════════════════════════════════
//  RITUAL TETRIS — main.js
//  Full game logic + wallet + background canvas
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

// ── TETRIS SETTINGS ───────────────────────────
const canvas   = document.getElementById("tetris");
const ctx      = canvas.getContext("2d");
const BLOCK    = 30;
const COLS     = 10;
const ROWS     = 20;
const TARGET   = 9999;

let board, score, level, lines, gameRunning, paused;
let currentPiece, nextPiece, pieceX, pieceY;
let lastDrop, dropInterval;
let animFrameId;

// ── TETROMINOS — desaturated, dark-tinted for glass effect ──
const PIECES = [
  { shape: [[1,1,1,1]],              color: "#1ac8c8" }, // I — muted teal
  { shape: [[1,1],[1,1]],            color: "#c8a800" }, // O — dark gold
  { shape: [[0,1,0],[1,1,1]],        color: "#7c3faa" }, // T — deep violet
  { shape: [[0,1,1],[1,1,0]],        color: "#1a9e3f" }, // S — forest green
  { shape: [[1,1,0],[0,1,1]],        color: "#b83232" }, // Z — dark crimson
  { shape: [[1,0,0],[1,1,1]],        color: "#1a3faa" }, // J — deep navy
  { shape: [[0,0,1],[1,1,1]],        color: "#c86a00" }, // L — burnt orange
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

function sfxMove()  { playSound(220, 60,  "square", 0.15); }
function sfxRotate(){ playSound(330, 80,  "sine",   0.2);  }
function sfxLock()  { playSound(180, 120, "sine",   0.3);  }
function sfxLine()  { playSound(660, 180, "sine",   0.4);  }
function sfxDrop()  { playSound(120, 90,  "square", 0.25); }

// ── GLASS BLOCK DRAW — matches background piece style ──
function drawBlock(x, y, color) {
  const px = x * BLOCK;
  const py = y * BLOCK;
  const s  = BLOCK;

  ctx.save();

  // 1. Dark base fill (semi-transparent so board shows depth)
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = color;
  ctx.fillRect(px + 1, py + 1, s - 2, s - 2);

  // 2. Glass gradient — top-left bright, bottom-right dark
  ctx.globalAlpha = 1;
  const glassGrad = ctx.createLinearGradient(px, py, px + s, py + s);
  glassGrad.addColorStop(0,    "rgba(255,255,255,0.45)");
  glassGrad.addColorStop(0.35, "rgba(255,255,255,0.10)");
  glassGrad.addColorStop(0.6,  "rgba(0,0,0,0.05)");
  glassGrad.addColorStop(1,    "rgba(0,0,0,0.30)");
  ctx.fillStyle = glassGrad;
  ctx.fillRect(px + 1, py + 1, s - 2, s - 2);

  // 3. Thin colored border with neon glow
  ctx.shadowColor = color;
  ctx.shadowBlur  = 10;
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1.2;
  ctx.strokeRect(px + 1.5, py + 1.5, s - 3, s - 3);
  ctx.shadowBlur  = 0;

  // 4. Bright top-left edge highlight (glass catch-light)
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillRect(px + 2, py + 2, s - 5, 2);   // top edge
  ctx.fillRect(px + 2, py + 2, 2, s - 5);   // left edge

  // 5. Dark bottom-right shadow edge
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(px + 3, py + s - 3, s - 4, 2);  // bottom edge
  ctx.fillRect(px + s - 3, py + 3, 2, s - 5);  // right edge

  ctx.restore();
}

// ── DRAW ──────────────────────────────────────
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Locked board
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c]) drawBlock(c, r, board[r][c]);
    }
  }

  // Ghost piece
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
  }

  // Active piece
  if (currentPiece) {
    currentPiece.shape.forEach((row, dy) => {
      row.forEach((v, dx) => {
        if (v) drawBlock(pieceX + dx, pieceY + dy, currentPiece.color);
      });
    });
  }

  // Grid lines (subtle)
  ctx.strokeStyle = "rgba(0,255,157,0.04)";
  ctx.lineWidth = 0.5;
  for (let c = 0; c <= COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, canvas.height);
    ctx.stroke();
  }
  for (let r = 0; r <= ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(canvas.width, r * BLOCK);
    ctx.stroke();
  }
}

// ── COLLISION ─────────────────────────────────
function collideAt(nx, ny, shape = currentPiece.shape) {
  return shape.some((row, dy) =>
    row.some((v, dx) => v && (
      nx + dx < 0 ||
      nx + dx >= COLS ||
      ny + dy >= ROWS ||
      (ny + dy >= 0 && board[ny + dy]?.[nx + dx])
    ))
  );
}

function collide() { return collideAt(pieceX, pieceY); }

// ── MERGE ─────────────────────────────────────
function merge() {
  currentPiece.shape.forEach((row, dy) => row.forEach((v, dx) => {
    if (v && pieceY + dy >= 0) {
      board[pieceY + dy][pieceX + dx] = currentPiece.color;
    }
  }));
  sfxLock();
}

// ── CLEAR LINES ───────────────────────────────
function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(cell => cell)) {
      board.splice(r, 1);
      board.unshift(Array(COLS).fill(null));
      cleared++;
      r++;
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
  }
}

// ── DROP ──────────────────────────────────────
function drop() {
  pieceY++;
  if (collide()) {
    pieceY--;
    merge();
    clearLines();
    spawnNext();
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

// ── ROTATE ────────────────────────────────────
function rotate() {
  const orig = currentPiece.shape;
  const rotated = orig[0].map((_, i) => orig.map(row => row[i]).reverse());
  const prevShape = currentPiece.shape;
  currentPiece.shape = rotated;
  // Wall kick: try shifts if collision
  if (collide()) {
    for (const kick of [1, -1, 2, -2]) {
      pieceX += kick;
      if (!collide()) { sfxRotate(); return; }
      pieceX -= kick;
    }
    currentPiece.shape = prevShape; // revert
  } else {
    sfxRotate();
  }
}

// ── SPAWN NEXT ────────────────────────────────
function spawnNext() {
  currentPiece = nextPiece;
  nextPiece    = randomPiece();
  pieceX = Math.floor(COLS / 2) - Math.floor(currentPiece.shape[0].length / 2);
  pieceY = 0;

  if (collide()) {
    gameRunning = false;
    cancelAnimationFrame(animFrameId);
    showGameOver();
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
  score        = 0;
  level        = 1;
  lines        = 0;
  dropInterval = 800;
  paused       = false;

  currentPiece = randomPiece();
  nextPiece    = randomPiece();
  pieceX = Math.floor(COLS / 2) - Math.floor(currentPiece.shape[0].length / 2);
  pieceY = 0;

  gameRunning = true;

  showScreen("gameScreen");

  // Update active mode label
  const modeLabel = document.getElementById("activeModeLabel");
  if (mode === "pvp") {
    modeLabel.textContent = "PVP ARENA";
    modeLabel.style.borderColor = "rgba(255,0,204,0.3)";
    modeLabel.style.color = "#ff00cc";
    modeLabel.style.background = "rgba(255,0,204,0.05)";
  } else {
    modeLabel.textContent = "SINGLE PLAYER";
    modeLabel.style.borderColor = "";
    modeLabel.style.color = "";
    modeLabel.style.background = "";
  }

  updateUI();
  lastDrop = performance.now();
  cancelAnimationFrame(animFrameId);
  animFrameId = requestAnimationFrame(gameLoop);
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

// ── GAME OVER MODAL ───────────────────────────
function showGameOver() {
  // Ensure modal exists in DOM (create once)
  let modal = document.getElementById("gameOverModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "gameOverModal";
    modal.className = "go-backdrop";
    modal.innerHTML = `
      <div class="go-modal">
        <div class="go-corner go-tl"></div>
        <div class="go-corner go-tr"></div>
        <div class="go-corner go-bl"></div>
        <div class="go-corner go-br"></div>

        <div class="go-tag">// SESSION TERMINATED</div>
        <div class="go-title">GAME OVER</div>
        <div class="go-divider"></div>

        <div class="go-stat-label">FINAL SCORE</div>
        <div class="go-score" id="goScore">00000</div>

        <div class="go-stats-row">
          <div class="go-mini-stat">
            <div class="go-mini-val" id="goLevel">01</div>
            <div class="go-mini-label">LEVEL</div>
          </div>
          <div class="go-mini-stat">
            <div class="go-mini-val" id="goLines">000</div>
            <div class="go-mini-label">LINES</div>
          </div>
        </div>

        <div class="go-divider"></div>
        <div class="go-actions">
          <button class="ritual-btn" id="goRestartBtn">↺ PLAY AGAIN</button>
          <button class="ritual-btn danger" id="goExitBtn">⏹ EXIT</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector("#goRestartBtn").addEventListener("click", async () => {
      closeGameOver();
      if (currentMode === "single") {
        if (await payEntry("single")) startGame("single");
      } else {
        if (await payEntry("pvp")) startGame("pvp");
      }
    });

    modal.querySelector("#goExitBtn").addEventListener("click", () => {
      closeGameOver();
      showScreen("modeScreen");
    });
  }

  // Populate values
  modal.querySelector("#goScore").textContent = String(score).padStart(5, "0");
  modal.querySelector("#goLevel").textContent = String(level).padStart(2, "0");
  modal.querySelector("#goLines").textContent = String(lines).padStart(3, "0");

  // Show with animation
  modal.classList.add("visible");
  document.body.style.overflow = "hidden";

  // Attempt reward claim if applicable
  if (score >= TARGET && contract && currentMode === "single") {
    claimSingleReward();
  }
}

function closeGameOver() {
  const modal = document.getElementById("gameOverModal");
  if (modal) modal.classList.remove("visible");
  document.body.style.overflow = "";
}

async function claimSingleReward() {
  try {
    const addr = await signer.getAddress();
    const tx = await contract.claimSinglePlayerReward(addr, score);
    await tx.wait();
    console.log("Reward claimed!");
  } catch(e) {
    console.warn("Claim failed:", e.message);
  }
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
    // Draw pause overlay text
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ccff00";
    ctx.font = "bold 18px 'Orbitron', monospace";
    ctx.textAlign = "center";
    ctx.fillText("PAUSED", canvas.width / 2, canvas.height / 2);
    ctx.textAlign = "left";
  } else {
    if (btn) btn.textContent = "⏸ PAUSE";
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
    const btn  = document.getElementById("connectBtn");
    const dot  = document.getElementById("statusDot");

    btn.innerHTML = `✅ ${addr.slice(0,6)}…${addr.slice(-4)}`;
    dot.classList.remove("offline");
  } catch(e) {
    alert("Gagal connect: " + e.message);
  }
}

async function payEntry(mode) {
  if (!contract) {
    alert("Connect wallet dulu!");
    return false;
  }
  const fee = mode === "single" ? "0.001" : "0.003";
  try {
    const tx = mode === "single"
      ? await contract.enterSinglePlayer({ value: ethers.parseEther(fee) })
      : await contract.createPvPMatch({ value: ethers.parseEther(fee) });
    await tx.wait();
    return true;
  } catch(e) {
    alert("Transaksi gagal: " + e.message);
    return false;
  }
}

// ── EVENT LISTENERS ───────────────────────────
document.getElementById("connectBtn")
  .addEventListener("click", connectWallet);

document.getElementById("singleBtn")
  .addEventListener("click", async () => {
    if (await payEntry("single")) startGame("single");
  });

document.getElementById("pvpBtn")
  .addEventListener("click", async () => {
    if (await payEntry("pvp")) startGame("pvp");
  });

document.getElementById("quitBtn")
  .addEventListener("click", () => {
    gameRunning = false;
    cancelAnimationFrame(animFrameId);
    showScreen("modeScreen");
  });

document.getElementById("pauseBtn")
  .addEventListener("click", togglePause);

// ── KEYBOARD ──────────────────────────────────
document.addEventListener("keydown", e => {
  if (!gameRunning || !currentPiece) return;

  if (e.key === "Escape" || e.key === "p" || e.key === "P") {
    togglePause();
    return;
  }

  if (paused) return;

  switch (e.key) {
    case "ArrowLeft":
      pieceX--;
      if (collide()) pieceX++;
      else sfxMove();
      break;
    case "ArrowRight":
      pieceX++;
      if (collide()) pieceX--;
      else sfxMove();
      break;
    case "ArrowDown":
      drop();
      score++;
      updateUI();
      break;
    case "ArrowUp":
    case "x":
    case "X":
      rotate();
      break;
    case " ":
      e.preventDefault();
      hardDrop();
      break;
  }
  draw();
});

// ── BACKGROUND CANVAS (Falling Tetris Blocks) ─
(function initBackground() {
  const bgCanvas = document.getElementById("bgCanvas");
  const bCtx     = bgCanvas.getContext("2d");
  const CELL     = 28;

  const BG_PIECES = [
    { shape: [[1,1,1,1]],            color: "rgba(0,255,157,"   }, // I
    { shape: [[1,1],[1,1]],          color: "rgba(255,204,0,"   }, // O
    { shape: [[0,1,0],[1,1,1]],      color: "rgba(204,255,0,"   }, // T
    { shape: [[1,0],[1,0],[1,1]],    color: "rgba(0,200,255,"   }, // L
    { shape: [[0,1],[0,1],[1,1]],    color: "rgba(255,0,204,"   }, // J
    { shape: [[0,1,1],[1,1,0]],      color: "rgba(0,255,157,"   }, // S
    { shape: [[1,1,0],[0,1,1]],      color: "rgba(255,100,0,"   }, // Z
  ];

  let bgPieces = [], W, H;

  function resize() {
    W = bgCanvas.width  = window.innerWidth;
    H = bgCanvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize);

  function spawnBgPiece() {
    const p    = BG_PIECES[Math.floor(Math.random() * BG_PIECES.length)];
    const cols = Math.floor(W / CELL);
    return {
      shape:    p.shape,
      color:    p.color,
      x:        Math.floor(Math.random() * Math.max(1, cols - 4)) * CELL,
      y:        -CELL * 4,
      speed:    0.3 + Math.random() * 0.6,
      opacity:  0.04 + Math.random() * 0.10,
      rotation: 0,
      rotSpeed: (Math.random() - 0.5) * 0.008,
      scale:    0.6 + Math.random() * 0.7,
    };
  }

  // Scatter initial pieces across screen
  for (let i = 0; i < 18; i++) {
    const p = spawnBgPiece();
    p.y = Math.random() * H;
    bgPieces.push(p);
  }

  function drawBgPiece(p) {
    bCtx.save();
    const s  = CELL * p.scale;
    const cx = p.x + (p.shape[0].length * s) / 2;
    const cy = p.y + (p.shape.length * s) / 2;
    bCtx.translate(cx, cy);
    bCtx.rotate(p.rotation);
    bCtx.translate(-cx, -cy);

    p.shape.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (!cell) return;
        const px = p.x + c * s;
        const py = p.y + r * s;

        // Fill
        bCtx.fillStyle   = p.color + p.opacity + ")";
        bCtx.fillRect(px + 1, py + 1, s - 2, s - 2);

        // Border
        bCtx.strokeStyle = p.color + (p.opacity * 3) + ")";
        bCtx.lineWidth   = 0.8;
        bCtx.strokeRect(px + 1, py + 1, s - 2, s - 2);

        // Inner highlight (glass top-left edge)
        bCtx.fillStyle = p.color + (p.opacity * 2.5) + ")";
        bCtx.fillRect(px + 2, py + 2, s - 4, 1.5);
        bCtx.fillRect(px + 2, py + 2, 1.5, s - 4);
      });
    });
    bCtx.restore();
  }

  function bgAnimate() {
    bCtx.clearRect(0, 0, W, H);
    bgPieces.forEach((p, i) => {
      p.y        += p.speed;
      p.rotation += p.rotSpeed;
      if (p.y > H + CELL * 5) bgPieces[i] = spawnBgPiece();
      drawBgPiece(p);
    });
    if (bgPieces.length < 22 && Math.random() < 0.003) {
      bgPieces.push(spawnBgPiece());
    }
    requestAnimationFrame(bgAnimate);
  }

  bgAnimate();
})();

console.log("%c🎮 Ritual Tetris — Glass Edition Loaded", "color:#00ff9d; font-size:16px");