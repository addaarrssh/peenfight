<div align="center">

# ⚡ PEN FIGHT 3D (पेन फाइट) 🖊️💥
### *The Iconic Indian Classroom Game Reimagined in Real-Time 3D*

[![Live Demo](https://img.shields.io/badge/🎮_Live_Game-Play_Now-FF6B35?style=for-the-badge&logo=vercel&logoColor=white)](https://peenfight.vercel.app)
[![Three.js](https://img.shields.io/badge/Three.js-r128-black?style=for-the-badge&logo=three.js&logoColor=white)](https://threejs.org/)
[![Rapier Physics](https://img.shields.io/badge/Rapier.js-WASM_Physics-E05D44?style=for-the-badge&logo=webassembly&logoColor=white)](https://rapier.rs/)
[![WebRTC](https://img.shields.io/badge/WebRTC-P2P_Multiplayer-339933?style=for-the-badge&logo=webrtc&logoColor=white)](https://webrtc.org/)
[![License](https://img.shields.io/badge/License-Proprietary_/_All_Rights_Reserved-blue?style=for-the-badge)](README.md)

<br />

**[👉 Click Here to Play the Live Game](https://peenfight.vercel.app)**

*Zero installations. Zero plugins. Instant browser play on Mobile & Desktop.*

---

</div>

## 📖 Overview

**Pen Fight 3D** brings the legendary Indian school desk sport to the modern web. From the ink-stained wooden benches of Class 9B to your browser screen, flick your favorite pen, exploit realistic 3D collision physics, and knock your rival off the desk!

Built using **Three.js**, **Rapier.js (WebAssembly 3D Physics)**, and serverless **WebRTC Peer-to-Peer Data Channels**, this project delivers low-latency, deterministic multiplayer pen combat across mobile phones, tablets, and desktops.

---

## ✨ Key Highlights & Features

### 🕹️ Authentic 3D Physics Engine
- **Rigid-Body Dynamics**: Implemented with **Rapier.js (WASM)** simulating true-to-life center of mass, angular velocity, and linear damping.
- **Surface Friction & Incline**: Custom desk restitution and kinetic friction calibrated to replicate school desk laminate.
- **Dynamic Flick Force Vectoring**: Touch-and-drag power gauge with angle trajectory calculation and visual cue pulses.

### 🌐 Peer-to-Peer Real-Time Multiplayer
- **Serverless WebRTC Netcode**: Direct peer-to-peer data channels with automated delivery queues, packet acknowledgments (ACKs), and sequence ordering.
- **Authoritative Referee Loop**: 25 FPS serverless collision refereeing preventing out-of-bounds desyncs.
- **Match Lobbies & WhatsApp Sharing**: Instant room code generator with 1-click WhatsApp and link sharing.
- **Best-of-3 Tournament Mode**: Alternating turns, live comic scoreboard, and mutual rematch consensus voting.

### 📱 Responsive Dynamic Viewport
- **Aspect-Aware Camera Frustum**: Real-time vertical/horizontal FOV adaptation preventing table cutoff on vertical smartphone screens (iPhone, Samsung Galaxy, iPad, and Ultra-Wide displays).

### 🎨 Comic-Zine Manga Art Direction
- Chalkboard background, reactive collision impact pulses, comic badge typography, authentic pen clack sound effects, and persistent local storage for unlocked arsenal items.

---

## 🖊️ The 12 Iconic Pens & Physics Profiles

Every pen features distinct physical attributes based on its real-world counterpart:

| Pen Name | Striker Role | Weight / Density | Friction | Bounce | Special Trait |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Reynolds Trimax** | Heavy Anchor | 1480 kg/m³ | High (0.50) | 0.28 | Devastating knockout power, immovable center |
| **Cello Gripper** | Precision Sweeper | 1409 kg/m³ | Max (0.55) | 0.30 | Rubberized body parks dead-center on impact |
| **Pilot V5** | Dart Skimmer | 1128 kg/m³ | Low (0.22) | 0.44 | Ultra-fast velocity, maximum glide distance |
| **Linc Ocean** | Balanced Duelist | 1250 kg/m³ | Med (0.35) | 0.35 | Aerodynamic cap with uniform rebound |
| **Montex Megatop** | Spin Wobbler | 983 kg/m³ | Med (0.30) | 0.38 | Top-heavy cap creates spinning ricochet shots |
| **Reynolds 045** | Classic All-Rounder| 1224 kg/m³ | Balanced (0.30)| 0.38 | Standard schoolyard benchmark pen |
| **Parker Vector** | Steel Smasher | 1550 kg/m³ | High (0.42) | 0.25 | Heavy stainless-steel body, high kinetic momentum |
| **Addgel Achiever** | Gel Slider | 1180 kg/m³ | Low (0.25) | 0.40 | High-speed straight line attacker |
| **Cello Butterflow** | Smooth Glider | 1210 kg/m³ | Low (0.24) | 0.36 | Low surface resistance for long-range snipes |
| **Flair Writometer** | Long Distance | 1310 kg/m³ | Med (0.32) | 0.32 | Heavy ink capacity provides steady linear push |
| **Reynolds Racer Gel**| Quick Strike | 1140 kg/m³ | Med (0.28) | 0.42 | Agile recovery from desk edges |
| **Classmate Octane** | Grip Finisher | 1270 kg/m³ | High (0.48) | 0.31 | Hexagonal body prevents rolling off edges |

---

## 🛠️ Architecture & Tech Stack

```
[Touch / Mouse Drag Gesture]
             │
             ▼
[Vector Calculation & Power Meter]
             │
      ┌──────┴────────────────────────┐
      │                               │
      ▼                               ▼
[Rapier WASM Physics Step]    [WebRTC P2P Packet Sync]
      │                               │
      ▼                               ▼
[Three.js 3D Viewport Render] [Host Referee Out-of-Bounds Detection]
```

- **Frontend Core**: Vanilla JavaScript (ES6+), HTML5 Canvas, WebGL.
- **3D Graphics**: [Three.js](https://threejs.org/) (GLTF Loader, custom PBR shaders, procedural chalkboard backdrop, dynamic lighting).
- **Physics Engine**: [Rapier.js](https://rapier.rs/) (WebAssembly rigid-body physics, convex hull colliders, continuous collision detection).
- **Networking**: WebRTC P2P Data Channels with PeerJS signaling.
- **Deployment**: [Vercel Edge Network](https://vercel.com).

---

## 📜 How to Play

1. **Aim**: Click / tap on your pen and drag backward to aim your shot.
2. **Power**: Pull further back to charge up your flick power.
3. **Release**: Let go to strike the opponent's pen.
4. **Win Condition**: Knock your opponent's pen completely off the desk while keeping your own pen safely on the wood. First to win 2 rounds takes the match!

---

## 👨‍💻 Author & Creator

**Adarsh Sahu**
- **Live Game**: [peenfight.vercel.app](https://peenfight.vercel.app)
- **GitHub**: [@addaarrssh](https://github.com/addaarrssh)

---

## 🔒 Source Code & License Notice

This repository serves as the public architecture, showcase, and technical documentation for **Pen Fight 3D**. The proprietary physics calibration, custom shader pipeline, and netcode implementation are maintained in a protected production build.

*Copyright © 2026 Adarsh Sahu. All rights reserved.*
