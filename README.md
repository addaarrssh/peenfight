# PenFight Clone (`peenfight`)

Complete 1:1 standalone clone of [https://www.penfight.xyz/](https://www.penfight.xyz/).

## 🚀 How to Run

Navigate to this folder and start any local HTTP server:

```bash
cd peenfight
python3 -m http.server 3000
```
or with Node.js:
```bash
cd peenfight
npx serve . -l 3000
```

Open **http://localhost:3000** in your browser to play.

---

## 📁 Directory Structure

```
peenfight/
├── index.html                    # Main entry point (identical to live penfight.xyz)
├── offline.html                  # Standalone bundled fallback
├── rules.html, pens.html, ...    # Subpages & archives
├── terms/, privacy/              # Legal policy pages
└── assets/
    ├── index-qt_1fHzp.js         # Complete Three.js & Rapier 3D physics engine bundle (3.5 MB)
    ├── index-D_gjLeFT.css        # Full CSS styles, responsive layouts, chits & paper textures
    ├── schoolbag.glb             # 3D backpack mesh
    ├── art/                      # High-res pen photographs, geometry profiles & textures
    │   ├── pen-reynolds045.webp
    │   ├── pen-reynolds-trimax.webp
    │   ├── pen-pilotV5.webp
    │   ├── pen-gripper.webp
    │   └── ... (all 17 reference art assets)
    ├── fonts/                    # WOFF2 fonts (Anton, Patrick Hand)
    ├── *.mp3 / *.wav             # High-fidelity audio (bell, hubbub, glass, tap, cheer, boo)
    └── *.json                    # Lottie celebration & burst animations
```
