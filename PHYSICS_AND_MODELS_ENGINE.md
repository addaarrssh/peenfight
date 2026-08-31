# Pen Fight — Complete 3D Modeling & Physics Engine Specification

This document provides an exhaustive architectural and mathematical breakdown of the 3D procedural pen construction pipeline, texture unwrapping, collision shapes, Rapier 3D physics simulation, table friction, flick dynamics, and AI aiming mechanics in **Pen Fight**.

---

## 1. Core Physics Simulation Configuration

The physics engine is powered by **Rapier 3D WebAssembly** (`@dimforge/rapier3d-compat`), running on a fixed sub-stepped numerical integration loop.

### Engine Global Constants (`hm`)

| Parameter | Key | Exact Value | Unit / Formula | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Physics Timestep** | `sim.dt` | `1 / 120` | seconds ($\approx 8.33\text{ ms}$) | Fixed 120 Hz physics simulation rate |
| **Max Substeps** | `sim.maxSubSteps` | `6` | iterations | Prevents tunneling during high-velocity collisions |
| **Gravity** | `sim.gravity` | `-9.81` | $\text{m/s}^2$ | Standard downward acceleration vector $(0, -9.81, 0)$ |
| **Linear Damping** | `pen.linearDamping` | `0.06` | dimensionless | Aerodynamic deceleration of translational sliding |
| **Angular Damping** | `pen.angularDamping` | `0.80` | dimensionless | High rotational friction (stops infinite spinning on desk) |
| **Out-of-Bounds Threshold** | `present.outY` | `-0.04` | meters ($-4\text{ cm}$) | Pen falling $4\text{ cm}$ below desk surface triggers elimination |

---

## 2. Table Arena Geometry & Friction

The playing surface is modeled as a solid Rapier rigid body:

* **Desk Dimensions**:
  * Width: $0.70\text{ m}$ ($70\text{ cm}$)
  * Depth: $0.45\text{ m}$ ($45\text{ cm}$)
  * Thickness: $0.03\text{ m}$ ($3\text{ cm}$)
  * Height above floor: $0.72\text{ m}$ ($72\text{ cm}$)
* **Desk Surface Friction**: $\mu_{\text{desk}} = 0.33$
* **Desk Surface Restitution**: $e_{\text{desk}} = 0.10$ (absorbs bouncing, keeping hits grounded)
* **Effective Contact Friction**:
  $$\mu_{\text{eff}} = \sqrt{\mu_{\text{desk}} \times \mu_{\text{pen}}}$$
* **Effective Contact Restitution**:
  $$e_{\text{eff}} = \max(e_{\text{desk}}, e_{\text{pen}})$$

---

## 3. Flick Input Mechanics & Impulse Dynamics

When a player drags and releases on a pen, the gesture is converted into an instantaneous impulse applied at a specific contact point along the pen's body.

### Mathematical Input Pipeline

1. **Deadzone Filter**:
   $$\Delta x = x_{\text{end}} - x_{\text{start}}, \quad \Delta y = y_{\text{end}} - y_{\text{start}}, \quad d = \sqrt{\Delta x^2 + \Delta y^2}$$
   If $d < 12\text{ px}$ (`deadZonePx`), the flick is canceled.

2. **Power Normalization & Gamma Curve**:
   $$\text{dragRatio} = \min\left(1.0, \frac{d}{\text{viewportHeight} \times 0.34}\right)$$
   $$\text{power} = (\text{dragRatio})^{\gamma}, \quad \text{where } \gamma = 1.45$$
   The $\gamma = 1.45$ curve provides fine-grained control for soft tactical nudges while rewarding full-screen swipes with maximum power.

3. **Mass-Adaptive Impulse Scaling**:
   Heavier pens (e.g. Parker Vector, Hulk) require more impulse to launch than lightweight pens (e.g. Classmate Octane):
   $$\text{massScale} = \left(\frac{m_{\text{pen}}}{m_{\text{ref}}}\right)^{0.9}, \quad \text{where } m_{\text{ref}} = 0.01372\text{ kg } (13.72\text{ g})$$
   $$J = \big(J_{\min} + \text{power} \times (J_{\max} - J_{\min})\big) \times \text{massScale}$$
   * $J_{\min} = 0.0015\text{ N}\cdot\text{s}$
   * $J_{\max} = 0.0275\text{ N}\cdot\text{s}$

4. **Off-Center Strike Point & Induced Angular Torque**:
   The contact point $\vec{r}_{\text{strike}}$ is determined by where the player touched along the pen axis ($t \in [-0.9, +0.9]$):
   $$\vec{J} = (J \cdot \vec{d}_x, \; 0, \; J \cdot \vec{d}_z)$$
   $$\text{RigidBody.applyImpulseAtPoint}(\vec{J}, \; \vec{r}_{\text{strike}}, \; \text{wakeUp} = \text{true})$$

   Because the impulse is applied off-center from the center of mass $\vec{r}_{\text{com}}$, Rapier generates an instantaneous angular torque impulse:
   $$\vec{\tau} = (\vec{r}_{\text{strike}} - \vec{r}_{\text{com}}) \times \vec{J}$$
   * **Tip Strike**: Maximum angular spin; pen pivots sharply while deflecting.
   * **Center Strike**: Pure linear slide with minimal rotation; ideal for direct knockouts.
   * **Cap / Rear Strike**: Causes rapid tail-whip spin.

---

## 4. Turn Settle Detection Algorithm

A flick turn is declared finished only when both pens come to a complete rest:

* **Linear Velocity Condition**: $|\vec{v}_{\text{lin}}| < 0.015\text{ m/s}$ ($1.5\text{ cm/s}$)
* **Angular Velocity Condition**: $|\vec{\omega}_{\text{ang}}| < 0.15\text{ rad/s}$ ($\approx 8.6^\circ/\text{s}$)
* **Stability Duration**: The velocity conditions must hold uninterrupted for **$300\text{ ms}$** (`stableMs`).
* **Safety Timeout**: If a pen wobbles infinitely near an edge, the turn auto-resolves after **$5000\text{ ms}$** (`timeoutMs`).

---

## 5. Procedural 3D Pen Modeling Engine

Pens in Pen Fight are **not static 3D OBJ or GLTF files**. They are synthesized procedurally in real-time from 2D silhouette photographs using Three.js and computer-vision unwrapping.

```
+---------------------+     Contour Extraction     +---------------------+
| 2D WebP Photograph  | --------------------------> | Profile Radii R(z)  |
| (assets/art/pen-*.webp)                           | (et = 96 points)    |
+---------------------+                             +---------------------+
           |                                                   |
           v                                                   v
+---------------------+     Lathe Rotation          +---------------------+
| UV Texture Unwrap   | --------------------------> | Three.js Mesh       |
| (256 x 1024 Canvas) |                             | (LatheGeometry)     |
+---------------------+                             +---------------------+
                                                               |
+---------------------+     Physical Cap Clip                  v
| BoxGeometry Clip    | --------------------------> [ Final 3D Pen Group ]
| + Metallic Material |
+---------------------+
```

### Step 1: Alpha & Contour Extraction (`qu()`)
1. An offscreen 2D canvas reads image pixels via `getImageData()`.
2. Scans vertical columns to detect edges where alpha $\ge 64$.
3. Calculates central axis $h = \text{median}\big(\frac{t[N] + B[N]}{2}\big)$ and barrel radius $D$.
4. Compensates barrel perspective warping using a cubic luminance gain table $f[N]$.

### Step 2: Radial Profile Array (`Oq()`)
* Generates an array of **96 radial cross-sections** (`et = 96`) from pen tip to end plug.
* Applies a 5-point weighted Gaussian filter $[1, 2, 3, 2, 1]$ to smooth photographic artifacts:
  $$R_{\text{smooth}}[e] = \frac{\sum_{q=-2}^{2} R[e+q] \cdot w[q+2]}{\sum w}$$

### Step 3: 3D Faceted Lathe Mesh Generation
* **Triangular Pens** (Reynolds Trimax, DOMS Groove):
  * Spun with **3 segments** (`sides = 3`) using flat shading (`flatShading: true`).
  * Creates authentic triangular prism edges that cannot roll freely.
* **Hexagonal Pencils** (Nataraj 621, Apsara Platinum):
  * Spun with **6 segments** (`sides = 6`) matching wooden pencil geometry.
* **Cylindrical Pens** (Reynolds 045, Pilot V5, Cello Gripper):
  * Spun with **20 segments** (`sides = 20`) with smooth surface normals.

### Step 4: UV Cylindrical Texture Unwrap (`jq()`)
* Creates a **$256 \times 1024$** canvas texture.
* Samples color coordinates using cylindrical trigonometry:
  $$X_A = \text{clamp}\big(c_y - \sin(\lambda) \cdot R_{\text{barrel}}, \; 0, \; \text{height} - 1\big)$$
  $$\lambda = \left(\frac{u}{256} \cdot 2\pi - \text{center}\right) \pmod{\Delta\theta}$$
* Automatically detects pen body color vs cap color via color saturation histograms (`Vq()`).

### Step 5: Physical Cap Clip Collider & Mesh (`Zq()`)
* Analyzes asymmetry between top and bottom contours to detect the pocket clip.
* Extrudes a 3D `BoxGeometry`:
  * Length: $L_{\text{clip}} = \max(8\text{ mm}, \text{len} \cdot 2 \cdot \text{halfLen})$
  * Height: $1.3\text{ mm}$
  * Width: $R_{\text{pen}} \times 0.66$
* Adds a **physical collision box** in Rapier:
  ```javascript
  ColliderDesc.cuboid(0.01, 0.0016, 0.0022).setTranslation(clipX, clipY, 0)
  ```
  **Critical Gameplay Effect**: When the pen slides, this physical clip catches against the tabletop, creating realistic tumbling, sudden braking, and angular deflection.

---

## 6. Complete Playable Pen Physics & Material Catalog

| Pen Name | ID | Shape | Length ($m$) | Radius ($m$) | Density ($\text{kg/m}^3$) | Mass ($g$) | Friction ($\mu$) | Restitution ($e$) | Special Physics Trait |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Reynolds 045** | `reynolds045` | Cylinder (20) | $0.145$ | $0.00497$ | $1224$ | $13.7\text{g}$ | $0.30$ | $0.38$ | Honest all-rounder; predictable slide |
| **Pilot V5** | `pilotV5` | Cylinder (20) | $0.142$ | $0.00465$ | $1128$ | $10.9\text{g}$ | $0.22$ | $0.44$ | Slim and low-friction; darts fast |
| **Reynolds Trimax** | `reynolds-trimax` | Triangle (3) | $0.146$ | $0.00694$ | $1556$ | $21.5\text{g}$ | $0.42$ | $0.20$ | Triangular hull; zero rolls, instant stop |
| **Cello Gripper** | `gripper` | Cylinder (20) | $0.145$ | $0.00487$ | $1409$ | $15.2\text{g}$ | $0.55$ | $0.30$ | High rubber friction; locks into position |
| **Montex Megatop** | `megatop` | Cylinder (20) | $0.150$ | $0.00589$ | $983$ | $16.1\text{g}$ | $0.30$ | $0.34$ | **Top-Heavy Cap**; wobbles and curves |
| **Add Gel** | `addgel` | Cylinder (20) | $0.145$ | $0.00546$ | $1303$ | $17.7\text{g}$ | $0.42$ | $0.30$ | Heavy body; solid knocking power |
| **Parker Vector** | `parker` | Cylinder (20) | $0.140$ | $0.00522$ | $1703$ | $20.4\text{g}$ | $0.28$ | $0.16$ | Dense steel body; high inertia |
| **Classmate Octane** | `classmate-octane` | Cylinder (20) | $0.143$ | $0.00521$ | $940$ | $11.4\text{g}$ | $0.26$ | $0.50$ | Lightweight & highly bouncy |
| **Flair Writometer** | `flair-writometer` | Cylinder (20) | $0.152$ | $0.00530$ | $825$ | $11.1\text{g}$ | $0.20$ | $0.40$ | Ultra-low friction; slides long distances |
| **Cello Butterflow** | `cello-butterflow` | Cylinder (20) | $0.146$ | $0.00535$ | $1331$ | $17.5\text{g}$ | $0.28$ | $0.18$ | Low rebound; deadens enemy impacts |
| **Linc Ocean** | `linc-ocean` | Cylinder (20) | $0.145$ | $0.00511$ | $1403$ | $16.7\text{g}$ | $0.33$ | $0.58$ | Maximum restitution; extreme bounce |
| **Reynolds Racer Gel**| `reynolds-racer-gel`| Cylinder (20) | $0.147$ | $0.00623$ | $1128$ | $20.3\text{g}$ | $0.46$ | $0.26$ | Wide diameter; strong defensive anchor |
| **Nataraj 621** | `nataraj-621` | Hexagonal (6) | $0.176$ | $0.00404$ | $871$ | $7.8\text{g}$ | $0.30$ | $0.15$ | Full-length pencil; 6 flat faces |
| **Nataraj 621 Stub** | `nataraj-621-stub` | Hexagonal (6) | $0.074$ | $0.00404$ | $871$ | $3.3\text{g}$ | $0.31$ | $0.14$ | Tiny stub; very small target area |
| **Apsara Platinum** | `apsara-platinum` | Hexagonal (6) | $0.128$ | $0.00404$ | $871$ | $5.7\text{g}$ | $0.29$ | $0.16$ | Balanced wooden pencil dynamics |
| **DOMS Groove** | `doms-groove` | Triangle (3) | $0.126$ | $0.00466$ | $871$ | $7.4\text{g}$ | $0.38$ | $0.13$ | Triangular + dimple grip |
| **The Hulk** | `lab-brass` | Cylinder (20) | $0.143$ | $0.00565$ | $1680$ | $24.1\text{g}$ | $0.36$ | $0.20$ | Super-heavyweight brass rod |

---

## 7. AI Bot Decision Engine

The bot opponent calculates shots using a heuristic targeting model:

1. **Targeting Vector**: Calculates line-of-sight from bot pen center to player pen center.
2. **Defensive Edge Detection (`edgeGuardDist = 0.12m`)**:
   If the bot is within $12\text{ cm}$ of any table boundary, it prioritizes an evasive repositioning flick toward table center with limited power (`0.34`).
3. **Aim Noise Simulation**:
   Injects Gaussian angular jitter:
   $$\theta_{\text{actual}} = \theta_{\text{ideal}} \pm \mathcal{N}(0, \; \text{aimNoiseDeg})$$
   Default bot aim noise is $13^\circ$; champion bots scale down to $4.6^\circ$.
4. **Power Noise Simulation**:
   $$\text{power}_{\text{actual}} = \text{power}_{\text{ideal}} \times (1 \pm \text{powerNoise})$$
   Default power fluctuation is $\pm 22\%$.
5. **Telegraph Preview (`telegraphMs = 270ms`)**:
   Before firing, the bot displays its projected aim line and power for $270\text{ ms}$ so human players can anticipate the strike.
