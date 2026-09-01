# ⚡ Pen Fight 3D (पेन फाइट) 🖊️💥

> *Remember the final school bell ringing, clearing the wooden desk with your elbow, and pulling out a Trimax or a Cello Gripper to settle who ruled the classroom?*

I built **Pen Fight 3D** to recreate that pure, chaotic Indian schoolyard nostalgia right inside the browser — in full 3D with real-time peer-to-peer multiplayer.

🎮 **Play the live game here:** [https://penfighting.vercel.app](https://penfighting.vercel.app)

---

## 🌟 Why I Built This

Every Indian student who grew up in the 90s, 2000s, or 2010s has played Pen Fight on the last bench. Whether it was putting rubber bands on a Cello Gripper, loading lead inside a Reynolds Trimax to make it an immovable anchor, or skimming a lightweight Pilot V5 across the laminate — the game had its own unofficial physics, meta-strategies, and schoolyard legends.

I wanted to see if I could capture that exact physical feeling in modern web tech:
- The clack of hard plastic on a classroom desk.
- The tension of a pen teetering on the cliff of the table edge.
- Playing seamlessly with a friend over a quick WhatsApp room link with zero installs.

---

## 🚀 How It Works (Under the Hood)

Building realistic pen physics in the browser turned out to be a fascinating engineering challenge:

1. **Rigid-Body Physics (Rapier.js WASM)**:
   Pens aren't simple cylinders or spheres — their center of mass is unevenly distributed (especially pens with heavy caps like Montex Megatop or metal clips like Parker). I used Rapier.js running in WebAssembly to simulate realistic friction, linear damping, restitution (bounce), and rotational torque.

2. **3D WebGL Rendering (Three.js)**:
   Custom 3D models and procedural chalkboard shaders with manga comic styling, ink halftone dots, and reactive camera shake pulses on heavy collisions.

3. **Zero-Latency P2P Netcode (WebRTC & PeerJS)**:
   Instead of routing every physics tick through an expensive game server, matches run peer-to-peer directly between two browsers using WebRTC data channels. To keep both screens 100% in sync without edge desyncs, the shooter streams live transforms at 30 FPS with deterministic settle confirmation.

4. **Aspect-Aware Mobile Camera**:
   Calculates real-time vertical FOV adjustments so mobile players on vertical iPhone and Android screens get the exact same visible desk area and flick sensitivity as desktop players.

---

## 🖊️ The Striker Arsenal

I modeled 12 of the most iconic pens from our school days, each tuned with custom weight, grip, and bounce:

- **Reynolds Trimax** — The Heavy Tank. High density, hard to knock off, devastates lighter pens.
- **Cello Gripper** — The Control Master. Rubber grip gives it maximum surface friction to park right where you aim.
- **Pilot V5** — The Needle. Ultra-low friction and high glide speed for long-distance snipes.
- **Linc Ocean** — The Balanced Duelist. Smooth, predictable rebound and great all-rounder.
- **Montex Megatop** — The Spin King. Top-heavy cap creates crazy wobbles and unexpected ricochets.
- **Reynolds 045** — The Legend. The classic transparent ballpoint every student started with.
- *Plus Parker Vector, Cello Butterflow, Addgel, Flair Writometer, Reynolds Racer Gel, and Classmate Octane.*

---

## 🎮 Game Modes

- **1P Solo Duel**: Quick offline duels against AI bot opponents with adjustable aggression and risk logic.
- **2P Online Multiplayer**: Create a private room, share the link via WhatsApp or clipboard, pick your pen in an 8-second live draft, and battle in a Best-of-3 round match with mutual rematch voting.

---

## 🔒 Source Code & Project Status

The complete game is deployed and actively maintained live at **[penfighting.vercel.app](https://penfighting.vercel.app)**.

To protect the custom physics engine tuning, shader assets, and netcode from direct duplication, the production implementation is maintained in a private build repository, while this repository serves as the public architecture showcase and documentation hub.

Feel free to open an issue or connect on LinkedIn if you have feedback, want to discuss the WebRTC/Three.js architecture, or just want to challenge me to a match!

---

## 👨‍💻 Built By

**Adarsh Sahu**
- 🌐 **Live Game**: [https://penfighting.vercel.app](https://penfighting.vercel.app)
- 💼 **LinkedIn**: [Adarsh Sahu](https://linkedin.com/in/addaarrssh)
- 🐙 **GitHub**: [@addaarrssh](https://github.com/addaarrssh)

*If this brought back school memories, share the match link with your old classmates and see who still has the best flick!* 🚀
