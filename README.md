# Event Horizon: Relativistic Black Hole Simulation

An interactive, scientifically rigorous, high-performance 3D General Relativistic ray-tracer built with WebGL2, Three.js, and Web Audio API. This application simulates the physics and visual distortions around non-rotating (Schwarzschild) and rotating (Kerr) black holes in real-time.

![Interactive Simulation Screen](https://img.shields.io/badge/WebGL2-Performance-cyan?style=for-the-badge&logo=webgl)
![Framework](https://img.shields.io/badge/Three.js-0.184.0-blue?style=for-the-badge&logo=three.js)
[![Vercel Deployment](https://img.shields.io/badge/Vercel-Live%20Demo-black?style=for-the-badge&logo=vercel)](https://black-hole-mocha.vercel.app/)
![Status](https://img.shields.io/badge/Simulation-Phase%203%20Complete-success?style=for-the-badge)

---

## 🌌 Simulation Features

### 1. General Relativity Core (GPU Geodesics)
*   **Geodesic Ray-Marching**: Photons are integrated in real-time on the GPU, yielding realistic gravitational lensing. Light curves, secondary Einstein rings, and complex halos are fully lensed around the black hole shadow.
*   **Schwarzschild vs. Kerr Metrics**: Supports toggle between Schwarzschild (non-rotating) and Kerr (rotating with frame-dragging) spacetimes.
*   **Frame Dragging (Lense-Thirring Effect)**: In Kerr metric, space itself is dragged around the rotation axis. Photons and particles are subjected to Lense-Thirring angular velocity:
    $$\omega_{\text{drag}} = \frac{2 a M}{r^3}$$
*   **Accretion Disk Kinetics**: Relativistic Doppler beaming and gravitational redshift scale local temperatures and brightness depending on the direction of fluid rotation.
    *   *Doppler factor*: $D = \frac{\sqrt{1 - v_{\text{orb}}^2}}{1 + v_{\text{los}}}$
    *   *Intensity scaling*: $I_{\text{obs}} \propto g^4 I_{\text{emit}}$ where $g = D \sqrt{1 - r_s / r}$.

### 2. Advanced Spacetime Phenomena
*   **Penrose Process Energy Extraction**: Launch a golden probe which splits inside the ergosphere boundary shell. One half falls into the event horizon (red trail), while the other escapes with an **80% energy boost** (cyan trail), extracting rotation energy.
*   **Hawking Evaporation Runaway**: Turn off the accretion disk and activate evaporation. Mass shrinks exponentially ($\propto 1/M^2$) as virtual Hawking radiation particles escape, concluding in a massive white-out gamma-ray burst explosion before resetting.
*   **Tidal Force Inspector (Spaghettification HUD)**: A telemetry panel computing real-time stretching force on a human body ($m = 80$ kg, $L = 1.8$ m):
    $$F_{\text{stretch}} = \frac{2 G M_{\text{phys}} m L}{r_{\text{phys}}^3}$$
    Illustrates why stellar-mass black holes spaghettify you long before crossing the horizon, while supermassive ones allow safe traversal.
*   **Bardeen-Petterson Accretion Warp**: Accretion disk tilts and warps into a twisted 3D bowl shape:
    $$z_{\text{disk}} = y \sin(\theta_{\text{tilt}}) \cdot \text{smoothstep}(uDiskIn, uDiskOut, r)$$

### 3. Volumetric & Acoustic HUD
*   **Volumetric Polar Jets**: Visualizes collimated plasma jets emanating along the spin Z-axis, which are lensed and arced around the horizon.
*   **Acoustic HUD (Sonification)**: Synthesizes low-frequency hums mapped to the camera's gravitational potential and whistling sine oscillations representing Keplerian disk winds.
*   **CPU Viscous Particle System**: Up to 800 matter particles Swirling around the disk, governed by the Paczynski-Wiita potential:
    $$\mathbf{a}_{PW} = -\frac{GM}{(r - r_s)^2} \mathbf{\hat{r}}$$

---

## 🛠️ Tech Stack
*   **Graphics**: WebGL2 (GLSL 3.00 ES) + Three.js for canvas orchestration.
*   **Post-processing**: `UnrealBloomPass` and `EffectComposer` for high-dynamic-range (HDR) bloom.
*   **Audio**: Web Audio API oscillators and lowpass/bandpass filtering.
*   **Bundler**: Vite.

---

## 💻 Getting Started

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) installed.

### Installation & Run

1.  Clone the repository:
    ```bash
    git clone https://github.com/NishantJLU/Black-Hole.git
    cd Black-Hole
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Start local development server:
    ```bash
    npm run dev
    ```
4.  Build for production:
    ```bash
    npm run build
    ```

---

## 🎮 Interface Controls
*   **Preset Selector**: Gargantua (Interstellar class), Sagittarius A*, M87*, or Bare Singularity.
*   **EM Filters**: Normal Visible, UV/X-Ray (highlights hot inner gas), Infrared (highlights cold outer dust), and Doppler shift heatmap.
*   **Cinematic Flight Tours**:
    *   *Orbit Tour*: Automatic elliptical camera orbit.
    *   *Polar Tour*: Over-the-pole flyby to inspect gravity lensing halos.
    *   *Infall Singularity*: Cinematic plunge. Fades out local sound and reboots the interface once inside the event horizon.
*   **Cinematic View**: Toggle button to hide all controls and view the black hole in full screen.
