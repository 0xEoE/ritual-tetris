# 🎮 RITUAL TETRIS - Frontend

Frontend untuk game **Ritual Tetris** yang terhubung langsung dengan smart contract di Ritual Chain.

---

## ✨ Tentang Project

Ritual Tetris adalah game Tetris klasik dengan integrasi ekonomi on-chain.  
Player dapat bermain Single Player maupun PvP sambil bertransaksi menggunakan native token RITUAL.

---

## 🚀 Cara Menjalankan Lokal

### Prasyarat
- Node.js v20 atau lebih baru
- Wallet MetaMask yang terkoneksi ke **Ritual Chain**

### Langkah Instalasi

```bash
# 1. Masuk ke folder
cd ritual-tetris-frontend

# 2. Install dependencies
npm install

# 3. Jalankan development server
npm run dev

Buka browser ke: http://localhost:5173

🎯 Fitur Frontend

Visual Ritual Aesthetic (dark terminal + glass neon effect)
Full Tetris gameplay dengan Ghost Piece
Kontrol keyboard (Arrow + Space)
Sound effects
Wallet Connect (MetaMask)
Entry fee on-chain (Single Player & PvP)
Real-time score & level
Animasi background falling blocks

📁 Struktur Folder Penting

ritual-tetris-frontend/
├── public/
│   ├── ritual-logo.png
│   └── ritual-tab-icon.png
├── src/
│   ├── main.js          ← Logic game + blockchain
│   └── style.css        ← Styling Ritual Theme
├── index.html
├── vite.config.js
└── README.md

🔗 Contract Address
Ritual Chain Testnet
0xbd6dA7BCfB129A373615ADF8c5f68999Fd2911C8

🌐 Deploy ke GitHub Pages

Push project ke GitHub repository
Aktifkan GitHub Pages di Settings > Pages
Tambahkan di vite.config.js:

export default {
  base: '/ritual-tetris/',   // ganti sesuai nama repo
}

Build & deploy:
npm run build

🎮 Cara Bermain
Connect wallet
Pilih mode (Single Player / PvP)
Bayar entry fee
Main Tetris:
← → : Gerak
↓ : Soft drop
↑ : Rotate
Spasi : Hard drop

Single Player: Capai skor 9999+ untuk claim reward

Dibuat dengan ❤️ untuk Testnet Ritual Chain oleh Veyyy (❖,❖) aka 0xEyesofEtresia aka 0xEoE, May 19,2026