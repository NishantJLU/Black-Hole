import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as physics from './physics.js';
import { BlackHoleAudio } from './audio.js';
import { vertexShader, fragmentShader } from './shaders.js';

// --- CONFIGURATION & GLOBAL STATE ---
let container, renderer, scene, camera, controls, clock;
let composer, bloomPass;
let blackHoleMesh, shaderMaterial;
let nebulaTexture;

// Ergosphere and Audio
let ergosphereMesh;
let audioSynth;

// Particle System Globals
const MAX_PARTICLE_COUNT = 800;
let particleSystem, particleGeometry;
const particleData = []; // Array of { pos: [x,y,z], vel: [vx,vy,vz], temp: K, life: 1.0, decay: float }
let activeProbes = [];

// Cinematic Tours state
let activeTour = null; // null, 'orbit', 'polar', 'infall'
let tourTime = 0.0;
let infallComplete = false;

// Simulation settings
const settings = {
  mass: 1.0,
  spin: 0.0,
  metric: 'schwarzschild', // 'schwarzschild' or 'kerr'
  diskIn: 6.0,
  diskOut: 16.0,
  diskTemp: 6500,
  diskOpacity: 0.85,
  timeScale: 1.0,
  paused: false,
  showOverlay: false, // SVG Calibration Grid
  physicalScale: 'stellar', // 'stellar' or 'supermassive'
  skyboxIndex: 0,
  
  // Phase 2 Additions
  showErgosphere: false,
  viewMode: 0, // 0 = Space, 1 = Lensing Grid
  filterMode: 0, // 0 = Visible, 1 = X-Ray, 2 = Infrared, 3 = Doppler Heatmap
  showParticles: true,
  audioActive: false,
  
  // Phase 3 Additions
  showJets: false,
  jetIntensity: 1.2,
  diskTilt: 0.0,
  diskTiltActive: false,
  evaporating: false,
  probeLaunched: false,
  hudHidden: false
};

// Simulation uniform timers
let simTime = 0.0;

// Constant conversions
const SOLAR_MASS_KG = 1.989e30;
const G = 6.6743e-11;
const C = 299792458;

// Scale factors
const STELLAR_MASS = 10.0; // 10 Solar Masses
const SUPERMASSIVE_MASS = 4.3e6; // Sgr A* (4.3 million Solar Masses)

const skyboxColors = [
  [
    { r: 150, g: 30, b: 250, opacity: 0.15 }, // Purple
    { r: 0, g: 100, b: 250, opacity: 0.15 },  // Blue
    { r: 250, g: 0, b: 120, opacity: 0.10 }   // Magenta
  ],
  [
    { r: 255, g: 100, b: 0, opacity: 0.18 },  // Orange
    { r: 200, g: 0, b: 50, opacity: 0.12 },   // Deep Red
    { r: 80, g: 0, b: 150, opacity: 0.10 }    // Violet
  ],
  [
    { r: 0, g: 200, b: 220, opacity: 0.15 },  // Cyan
    { r: 0, g: 50, b: 200, opacity: 0.15 },   // Dark Blue
    { r: 120, g: 0, b: 200, opacity: 0.08 }   // Indigo
  ],
  []
];

// --- INITIALIZATION ---

function init() {
  container = document.getElementById('canvas-container');

  // 1. Renderer Setup
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);

  // 2. Scene & Camera Setup
  scene = new THREE.Scene();
  
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 8, 22);

  clock = new THREE.Clock();

  // 3. Orbit Controls Setup
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 4.0;
  controls.maxDistance = 45.0;
  controls.enablePan = false;

  // 4. Generate Space Nebula Skybox
  nebulaTexture = createNebulaTexture(settings.skyboxIndex);

  // 5. Create Black Hole Shader Mesh
  const rMax = 25.0;
  const sphereGeo = new THREE.SphereGeometry(rMax, 64, 64);
  
  shaderMaterial = new THREE.ShaderMaterial({
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    glslVersion: THREE.GLSL3,
    uniforms: {
      uCameraPos: { value: new THREE.Vector3() },
      uMass: { value: settings.mass },
      uSpin: { value: settings.spin },
      uTime: { value: 0.0 },
      uRMax: { value: rMax },
      uDiskIn: { value: settings.diskIn },
      uDiskOut: { value: settings.diskOut },
      uDiskTemp: { value: settings.diskTemp },
      uDiskOpacity: { value: settings.diskOpacity },
      uStepScale: { value: 0.07 },
      uMaxStep: { value: 0.6 },
      uShowOverlay: { value: settings.showOverlay },
      uUseTextureSky: { value: settings.skyboxIndex < 3 },
      uSkyTexture: { value: nebulaTexture },
      
      // Phase 2 Uniforms
      uViewMode: { value: settings.viewMode },
      uFilterMode: { value: settings.filterMode },
      
      // Phase 3 Uniforms
      uShowJets: { value: settings.showJets },
      uJetIntensity: { value: settings.jetIntensity },
      uDiskTilt: { value: settings.diskTilt }
    },
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false
  });

  blackHoleMesh = new THREE.Mesh(sphereGeo, shaderMaterial);
  scene.add(blackHoleMesh);

  // 6. Kerr Ergosphere Mesh (Oblated Wireframe Shell)
  const ergosphereGeo = new THREE.SphereGeometry(1.0, 32, 24);
  const ergosphereMat = new THREE.MeshBasicMaterial({
    color: 0x00f0ff,
    wireframe: true,
    transparent: true,
    opacity: 0.12,
    depthWrite: false
  });
  ergosphereMesh = new THREE.Mesh(ergosphereGeo, ergosphereMat);
  ergosphereMesh.rotation.x = Math.PI / 2; // Orient poles along World Z-axis
  ergosphereMesh.visible = settings.showErgosphere;
  scene.add(ergosphereMesh);

  // 7. Matter Accretion Particle System Setup
  initParticleSystem();

  // 8. Sonification Synth Setup
  audioSynth = new BlackHoleAudio();

  // 9. Post-Processing (Bloom / HDR glow)
  composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.5,
    0.4,
    0.15
  );
  composer.addPass(bloomPass);

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  // 10. Bind UI Controls & Event Listeners
  setupUI();
  updateTelemetry();
  updateSVGOverlay();

  window.addEventListener('resize', onWindowResize);
}

// --- PROCEDURAL GENERATORS ---

function createNebulaTexture(presetIndex) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#020204';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const colors = skyboxColors[presetIndex];

  if (colors && colors.length > 0) {
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 12; i++) {
      const x = Math.random() * canvas.width;
      const y = Math.random() * canvas.height;
      const r = 120 + Math.random() * 260;
      
      const rGrad = ctx.createRadialGradient(x, y, 0, x, y, r);
      const color = colors[i % colors.length];
      
      rGrad.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${color.opacity})`);
      rGrad.addColorStop(0.3, `rgba(${color.r}, ${color.g}, ${color.b}, ${color.opacity * 0.4})`);
      rGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      
      ctx.fillStyle = rGrad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

// --- PARTICLE SYSTEM ---

function initParticleSystem() {
  particleGeometry = new THREE.BufferGeometry();
  
  const positions = new Float32Array(MAX_PARTICLE_COUNT * 3);
  const colors = new Float32Array(MAX_PARTICLE_COUNT * 3);
  
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  
  // Custom round dot particle texture
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 16, 16);
  
  const pTex = new THREE.CanvasTexture(canvas);
  
  const pMat = new THREE.PointsMaterial({
    size: 0.15,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    map: pTex
  });
  
  particleSystem = new THREE.Points(particleGeometry, pMat);
  particleSystem.visible = settings.showParticles;
  scene.add(particleSystem);
  
  // Seed initial particles in stable orbits
  for (let i = 0; i < MAX_PARTICLE_COUNT / 2; i++) {
    spawnParticle(true);
  }
}

function spawnParticle(randomOrbit = false) {
  // Check if particle count exceeded
  if (particleData.length >= MAX_PARTICLE_COUNT) {
    // Reuse oldest dead particle or shift out
    return;
  }

  // Spawn radius between inner and outer edge
  const rMin = settings.diskIn;
  const rMax = settings.diskOut;
  const r = randomOrbit ? (rMin + Math.random() * (rMax - rMin)) : rMax;
  
  // Angle
  const phi = Math.random() * Math.PI * 2;
  
  // Keplerian orbital speed (v = sqrt(GM/r))
  const speed = Math.sqrt(settings.mass / r);
  
  // Coordinate position (lying mostly on z = 0 equatorial plane)
  const pos = [
    r * Math.cos(phi),
    r * Math.sin(phi),
    (Math.random() - 0.5) * 0.15 // small vertical dispersion
  ];
  
  // Orbital direction (counter-clockwise)
  const vel = [
    -speed * Math.sin(phi) + (Math.random() - 0.5) * 0.02,
    speed * Math.cos(phi) + (Math.random() - 0.5) * 0.02,
    (Math.random() - 0.5) * 0.01
  ];
  
  const temp = physics.getAccretionDiskTemperature(settings.mass, settings.spin, r, settings.diskTemp);
  const decay = 0.001 + Math.random() * 0.002;
  
  particleData.push({ pos, vel, temp, life: 1.0, decay });
}

function launchPenroseProbe() {
  const r = 18.0;
  const phi = Math.PI * 0.9;
  
  const pos = [
    r * Math.cos(phi),
    r * Math.sin(phi),
    0.0
  ];
  
  // Point velocity inward (roughly 4.6 units per second for visibility)
  const vel = [
    -4.2 * Math.cos(phi) - 1.2 * Math.sin(phi),
    -4.2 * Math.sin(phi) + 1.2 * Math.cos(phi),
    0.0
  ];
  
  // Create physical golden-yellow sphere mesh for clear visual feedback
  const probeGeo = new THREE.SphereGeometry(0.35, 16, 16);
  const probeMat = new THREE.MeshBasicMaterial({
    color: 0xffcc00,
    toneMapped: false
  });
  const probeMesh = new THREE.Mesh(probeGeo, probeMat);
  probeMesh.position.set(pos[0], pos[1], pos[2]);
  scene.add(probeMesh);
  
  activeProbes.push({
    mesh: probeMesh,
    pos: new THREE.Vector3(pos[0], pos[1], pos[2]),
    vel: new THREE.Vector3(vel[0], vel[1], vel[2]),
    type: 'original',
    life: 5.0
  });
  
  showAlert("PROBE LAUNCHED", "PENROSE ENERGY PROBE ACCELERATING TOWARDS ERGOSPHERE", false);
  
  if (settings.audioActive && audioSynth) {
    audioSynth.playLaunchTone();
  }
}

function updateActiveProbes(dt) {
  const massVal = settings.mass;
  const spinVal = settings.spin;
  const rHorizon = physics.getEventHorizonRadius(massVal, spinVal);
  const probeGeo = new THREE.SphereGeometry(0.25, 16, 16);
  
  for (let i = activeProbes.length - 1; i >= 0; i--) {
    const probe = activeProbes[i];
    const r2 = probe.pos.lengthSq();
    const r = Math.sqrt(r2);
    
    // 1. Event horizon absorption check
    if (r <= rHorizon + 0.15 || probe.life <= 0) {
      scene.remove(probe.mesh);
      probe.mesh.geometry.dispose();
      probe.mesh.material.dispose();
      activeProbes.splice(i, 1);
      continue;
    }
    
    // 2. Gravitational Acceleration (Paczynski-Wiita)
    if (probe.type !== 'escaping') {
      const acc = [0, 0, 0];
      physics.getPaczynskiWiitaAcceleration(massVal, [probe.pos.x, probe.pos.y, probe.pos.z], acc);
      probe.vel.x += acc[0] * dt;
      probe.vel.y += acc[1] * dt;
      probe.vel.z += acc[2] * dt;
    }
    
    // 3. Update Coordinates
    probe.pos.addScaledVector(probe.vel, dt);
    probe.mesh.position.copy(probe.pos);
    probe.life -= dt;
    
    // 4. Kerr Frame Dragging rotation
    if (spinVal > 0.0) {
      const omega = (2.0 * spinVal * massVal * massVal) / (r2 * r);
      const dTheta = omega * dt;
      probe.pos.applyAxisAngle(new THREE.Vector3(0, 0, 1), dTheta);
      probe.vel.applyAxisAngle(new THREE.Vector3(0, 0, 1), dTheta);
    }
    
    // 5. Emit particle trails (into the point cloud system)
    if (Math.random() < 0.5) {
      let trailTemp = 5200; // gold
      let decayRate = 0.012;
      if (probe.type === 'captured') {
        trailTemp = 1200; // red
        decayRate = 0.04;
      } else if (probe.type === 'escaping') {
        trailTemp = 25000; // cyan
        decayRate = 0.006; // longer trails for the escaping component
      }
      
      particleData.push({
        pos: [probe.pos.x, probe.pos.y, probe.pos.z],
        vel: [probe.vel.x * 0.15, probe.vel.y * 0.15, probe.vel.z * 0.15],
        temp: trailTemp,
        life: 1.0,
        decay: decayRate,
        isPenroseProbe: true,
        isProbeA: (probe.type === 'captured'),
        isProbeB: (probe.type === 'escaping')
      });
    }
    
    // 6. Check split inside the oblate ergosphere
    if (probe.type === 'original') {
      const cosTheta = probe.pos.z / Math.max(0.01, r);
      const theta = Math.acos(Math.max(-1.0, Math.min(1.0, cosTheta)));
      const re = physics.getErgosphereRadius(massVal, spinVal, theta);
      
      if (r <= re && spinVal > 0.0) {
        const dir = new THREE.Vector3().copy(probe.pos).normalize();
        const tangent = new THREE.Vector3(-dir.y, dir.x, 0.0);
        
        // Spawn captured virtual particle A (red)
        const velA = new THREE.Vector3().copy(dir).multiplyScalar(-1.5);
        const matA = new THREE.MeshBasicMaterial({ color: 0xff0055, toneMapped: false });
        const meshA = new THREE.Mesh(probeGeo, matA);
        meshA.position.copy(probe.pos);
        scene.add(meshA);
        
        activeProbes.push({
          mesh: meshA,
          pos: new THREE.Vector3().copy(probe.pos),
          vel: velA,
          type: 'captured',
          life: 1.5
        });
        
        // Spawn escaping virtual particle B (cyan, 1.8x velocity magnitude boost)
        const speedB = probe.vel.length() * 1.8;
        const velB = new THREE.Vector3()
          .copy(dir).multiplyScalar(0.65)
          .addScaledVector(tangent, 0.75)
          .normalize()
          .multiplyScalar(speedB);
        
        const matB = new THREE.MeshBasicMaterial({ color: 0x00f0ff, toneMapped: false });
        const meshB = new THREE.Mesh(probeGeo, matB);
        meshB.position.copy(probe.pos);
        scene.add(meshB);
        
        activeProbes.push({
          mesh: meshB,
          pos: new THREE.Vector3().copy(probe.pos),
          vel: velB,
          type: 'escaping',
          life: 3.5
        });
        
        showAlert("PENROSE PROCESS", "PROBE SPLIT IN ERGOSPHERE: ROTATIONAL ENERGY EXTRACTED! (+80% SPEED)", false);
        
        if (settings.audioActive && audioSynth) {
          audioSynth.playLaunchTone();
        }
        
        // Dispose and clean up original
        scene.remove(probe.mesh);
        probe.mesh.geometry.dispose();
        probe.mesh.material.dispose();
        activeProbes.splice(i, 1);
      }
    }
  }
}

function spawnHawkingParticle() {
  if (particleData.length >= MAX_PARTICLE_COUNT) return;

  const rHorizon = physics.getEventHorizonRadius(settings.mass, settings.spin);
  const r = rHorizon + 0.05;
  const theta = Math.acos(Math.random() * 2.0 - 1.0);
  const phi = Math.random() * Math.PI * 2;
  
  const pos = [
    r * Math.sin(theta) * Math.cos(phi),
    r * Math.sin(theta) * Math.sin(phi),
    r * Math.cos(theta)
  ];
  
  const norm = Math.max(0.01, Math.sqrt(pos[0]*pos[0] + pos[1]*pos[1] + pos[2]*pos[2]));
  const speed = 0.6 + Math.random() * 0.4;
  
  const vel = [
    (pos[0] / norm) * speed,
    (pos[1] / norm) * speed,
    (pos[2] / norm) * speed
  ];
  
  const temp = 12000 + Math.random() * 3000;
  const decay = 0.01 + Math.random() * 0.015;
  
  particleData.push({
    pos: pos,
    vel: vel,
    temp: temp,
    life: 1.0,
    decay: decay,
    isHawking: true
  });
}

function updateParticles(dt) {
  const massVal = settings.mass;
  const spinVal = settings.spin;
  const rHorizon = physics.getEventHorizonRadius(massVal, spinVal);
  
  const positions = particleGeometry.attributes.position.array;
  const colors = particleGeometry.attributes.color.array;
  
  // Temporary arrays for acceleration calculation
  const acc = [0, 0, 0];
  
  // Decay and integrate
  for (let i = particleData.length - 1; i >= 0; i--) {
    const p = particleData[i];
    
    // 1. Check event horizon absorption
    const r2 = p.pos[0]*p.pos[0] + p.pos[1]*p.pos[1] + p.pos[2]*p.pos[2];
    const r = Math.sqrt(r2);
    
    if (r <= rHorizon + 0.15 || p.life <= 0) {
      particleData.splice(i, 1);
      continue;
    }
    
    // Check Penrose split inside the ergosphere
    if (p.isPenroseProbe && !p.isProbeA && !p.isProbeB) {
      const cosTheta = p.pos[2] / Math.max(0.01, r);
      const theta = Math.acos(Math.max(-1.0, Math.min(1.0, cosTheta)));
      const re = physics.getErgosphereRadius(massVal, spinVal, theta);
      
      if (r <= re && spinVal > 0.0) {
        const dir = [p.pos[0] / r, p.pos[1] / r, p.pos[2] / r];
        const speedA = 0.35;
        const velA = [-dir[0] * speedA, -dir[1] * speedA, -dir[2] * speedA];
        
        // Particle A: Captured
        particleData.push({
          pos: [p.pos[0], p.pos[1], p.pos[2]],
          vel: velA,
          temp: 1200, // glowing red
          life: 0.8,
          decay: 0.02,
          isPenroseProbe: true,
          isProbeA: true,
          isProbeB: false
        });
        
        // Particle B: Escaping (1.8x velocity boost)
        const currentSpeed = Math.sqrt(p.vel[0]*p.vel[0] + p.vel[1]*p.vel[1] + p.vel[2]*p.vel[2]);
        const speedB = currentSpeed * 1.8;
        const tangent = [-dir[1], dir[0], 0];
        const velB = [
          (dir[0] * 0.7 + tangent[0] * 0.7) * speedB,
          (dir[1] * 0.7 + tangent[1] * 0.7) * speedB,
          dir[2] * speedB
        ];
        
        particleData.push({
          pos: [p.pos[0], p.pos[1], p.pos[2]],
          vel: velB,
          temp: 25000, // glowing cyan
          life: 1.8,
          decay: 0.002,
          isPenroseProbe: true,
          isProbeA: false,
          isProbeB: true
        });
        
        showAlert("PENROSE PROCESS", "PROBE SPLIT IN ERGOSPHERE: ROTATIONAL ENERGY EXTRACTED! (+80% SPEED)", false);
        
        if (settings.audioActive && audioSynth) {
          audioSynth.playLaunchTone();
        }
        
        particleData.splice(i, 1);
        continue;
      }
    }
    
    // 2. Acceleration and Integration
    if (!p.isHawking && !p.isProbeB) {
      physics.getPaczynskiWiitaAcceleration(massVal, p.pos, acc);
      p.vel[0] += acc[0] * dt;
      p.vel[1] += acc[1] * dt;
      p.vel[2] += acc[2] * dt;
      
      const drag = 1.0 - 0.08 * dt;
      p.vel[0] *= drag;
      p.vel[1] *= drag;
      p.vel[2] *= drag;
    }
    
    p.pos[0] += p.vel[0] * dt;
    p.pos[1] += p.vel[1] * dt;
    p.pos[2] += p.vel[2] * dt;
    
    // 4. Kerr Frame Dragging shift on the particle
    if (spinVal > 0.0) {
      const omega = (2.0 * spinVal * massVal * massVal) / (r2 * r);
      const dTheta = omega * dt;
      const cosT = Math.cos(dTheta);
      const sinT = Math.sin(dTheta);
      
      const px = p.pos[0] * cosT - p.pos[1] * sinT;
      const py = p.pos[0] * sinT + p.pos[1] * cosT;
      p.pos[0] = px;
      p.pos[1] = py;
      
      const vx = p.vel[0] * cosT - p.vel[1] * sinT;
      const vy = p.vel[0] * sinT + p.vel[1] * cosT;
      p.vel[0] = vx;
      p.vel[1] = vy;
    }
    
    // 5. Update life & temperature colors
    p.life -= p.decay * settings.timeScale;
    
    if (p.isPenroseProbe) {
      if (p.isProbeA) {
        p.temp = 1200;
      } else if (p.isProbeB) {
        p.temp = 25000;
      } else {
        p.temp = 5200;
      }
    } else if (p.isHawking) {
      // Keep its blue-white high temp
    } else {
      p.temp = physics.getAccretionDiskTemperature(massVal, spinVal, r, settings.diskTemp);
    }
    
    const colRGB = getBlackbodyColorVector(p.temp);
    
    // Write buffer attributes
    const idx = i * 3;
    positions[idx] = p.pos[0];
    positions[idx + 1] = p.pos[1];
    positions[idx + 2] = p.pos[2];
    
    let colScale = p.life;
    if (settings.filterMode === 1) { // X-Ray
      colScale *= smoothstep(6500, 11000, p.temp);
    } else if (settings.filterMode === 2) { // IR
      colScale *= smoothstep(8500, 3000, p.temp);
    }
    
    colors[idx] = colRGB[0] * colScale;
    colors[idx + 1] = colRGB[1] * colScale;
    colors[idx + 2] = colRGB[2] * colScale;
  }
  
  // Fill remaining vertex attributes with 0 (hidden)
  for (let i = particleData.length; i < MAX_PARTICLE_COUNT; i++) {
    const idx = i * 3;
    positions[idx] = 0;
    positions[idx + 1] = 0;
    positions[idx + 2] = 0;
    colors[idx] = 0;
    colors[idx + 1] = 0;
    colors[idx + 2] = 0;
  }
  
  particleGeometry.attributes.position.needsUpdate = true;
  particleGeometry.attributes.color.needsUpdate = true;
  
  // Slowly emit new matter
  if (particleData.length < MAX_PARTICLE_COUNT && !settings.paused) {
    if (settings.evaporating || settings.diskOpacity === 0.0) {
      const spawnRate = settings.evaporating ? 0.8 : 0.25;
      if (Math.random() < spawnRate) spawnHawkingParticle();
    } else {
      if (Math.random() < 0.2) spawnParticle(false);
    }
  }
}

function getBlackbodyColorVector(temp) {
  let T = Math.max(1000, Math.min(15000, temp));
  let t = T / 100;
  let r, g, b;

  if (t <= 66) {
    r = 1.0;
    g = t;
    g = 99.4708025861 * Math.log(g) - 161.1195681661;
    g = Math.max(0, Math.min(255, g)) / 255.0;
  } else {
    r = t - 60;
    r = 329.698727446 * Math.pow(r, -0.1332047592);
    r = Math.max(0, Math.min(255, r)) / 255.0;
    g = t - 60;
    g = 288.1221695283 * Math.pow(g, -0.0755148492);
    g = Math.max(0, Math.min(255, g)) / 255.0;
  }

  if (t >= 66) {
    b = 1.0;
  } else if (t <= 19) {
    b = 0.0;
  } else {
    b = t - 10;
    b = 138.5177312231 * Math.log(b) - 305.0447927307;
    b = Math.max(0, Math.min(255, b)) / 255.0;
  }

  return [r, g, b];
}

function smoothstep(min, max, value) {
  const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return x * x * (3 - 2 * x);
}

function setupUI() {
  const btnToggleHud = document.getElementById('btn-toggle-hud');
  const appContainer = document.getElementById('app');
  if (btnToggleHud && appContainer) {
    btnToggleHud.addEventListener('click', () => {
      settings.hudHidden = !settings.hudHidden;
      appContainer.classList.toggle('hud-hidden', settings.hudHidden);
      btnToggleHud.innerText = settings.hudHidden ? 'Show HUD' : 'Cinematic View';
      btnToggleHud.classList.toggle('active', settings.hudHidden);
    });
  }

  const metricSelect = document.getElementById('metric-select');
  const spinSliderGroup = document.getElementById('spin-slider-group');
  const statusIndicator = document.querySelector('.status-indicator');
  const solutionName = document.getElementById('metric-solution-name');

  metricSelect.addEventListener('change', (e) => {
    settings.metric = e.target.value;
    if (settings.metric === 'kerr') {
      spinSliderGroup.style.opacity = '1.0';
      spinSliderGroup.style.pointerEvents = 'all';
      statusIndicator.className = 'status-indicator active kerr-active';
      solutionName.innerText = 'KERR METRIC';
      if (settings.spin === 0) {
        settings.spin = 0.5;
        document.getElementById('input-spin').value = 0.5;
        document.getElementById('val-spin').innerText = '0.50';
        shaderMaterial.uniforms.uSpin.value = 0.5;
      }
    } else {
      spinSliderGroup.style.opacity = '0.5';
      spinSliderGroup.style.pointerEvents = 'none';
      statusIndicator.className = 'status-indicator active';
      solutionName.innerText = 'SCHWARZSCHILD METRIC';
      settings.spin = 0.0;
      shaderMaterial.uniforms.uSpin.value = 0.0;
    }
    updateTelemetry();
    updateErgosphereMesh();
  });

  // Range Sliders
  setupSlider('input-mass', 'val-mass', (val) => {
    settings.mass = val;
    shaderMaterial.uniforms.uMass.value = val;
    updateTelemetry();
    updateErgosphereMesh();
    
    // Automatically trigger runaway evaporation if slider set to minimum
    if (val <= 0.5) {
      settings.evaporating = true;
      const btnEvaporate = document.getElementById('btn-evaporate');
      if (btnEvaporate) btnEvaporate.classList.add('active');
      showAlert("EVAPORATION ACTIVE", "MASS CRITICAL MINIMUM: HAWKING DECAY RUNAWAY SEQUENCE INITIATED...", true);
    }
  });

  setupSlider('input-spin', 'val-spin', (val) => {
    settings.spin = val;
    shaderMaterial.uniforms.uSpin.value = val;
    updateTelemetry();
    updateErgosphereMesh();
  });

  setupSlider('input-disk-in', 'val-disk-in', (val) => {
    settings.diskIn = val;
    shaderMaterial.uniforms.uDiskIn.value = val;
    updateTelemetry();
  });

  setupSlider('input-disk-out', 'val-disk-out', (val) => {
    settings.diskOut = val;
    shaderMaterial.uniforms.uDiskOut.value = val;
    updateTelemetry();
  });

  setupSlider('input-temp', 'val-temp', (val) => {
    settings.diskTemp = val;
    shaderMaterial.uniforms.uDiskTemp.value = val;
    updateTelemetry();
  }, ' K');

  setupSlider('input-opacity', 'val-opacity', (val) => {
    settings.diskOpacity = val;
    shaderMaterial.uniforms.uDiskOpacity.value = val;
    updateTelemetry();
  });

  setupSlider('input-timescale', 'val-timescale', (val) => {
    settings.timeScale = val;
  });

  // Action Buttons
  const btnPause = document.getElementById('btn-pause');
  btnPause.addEventListener('click', () => {
    settings.paused = !settings.paused;
    btnPause.innerText = settings.paused ? 'Resume Flow' : 'Pause Flow';
    btnPause.classList.toggle('active', settings.paused);
  });

  const btnResetCam = document.getElementById('btn-reset-cam');
  btnResetCam.addEventListener('click', () => {
    activeTour = null;
    disableAlert();
    deactivateTourButtons();
    camera.position.set(0, 8, 22);
    controls.enabled = true;
    controls.reset();
  });

  const btnSkybox = document.getElementById('btn-skybox');
  btnSkybox.addEventListener('click', () => {
    settings.skyboxIndex = (settings.skyboxIndex + 1) % skyboxColors.length;
    nebulaTexture.dispose();
    nebulaTexture = createNebulaTexture(settings.skyboxIndex);
    shaderMaterial.uniforms.uSkyTexture.value = nebulaTexture;
    shaderMaterial.uniforms.uUseTextureSky.value = settings.skyboxIndex < 3;
  });

  // Physical Scale Toggles
  const scaleStellar = document.getElementById('scale-stellar');
  const scaleSupermassive = document.getElementById('scale-supermassive');

  scaleStellar.addEventListener('click', () => {
    settings.physicalScale = 'stellar';
    scaleStellar.classList.add('active');
    scaleSupermassive.classList.remove('active');
    updateTelemetry();
  });

  scaleSupermassive.addEventListener('click', () => {
    settings.physicalScale = 'supermassive';
    scaleSupermassive.classList.add('active');
    scaleStellar.classList.remove('active');
    updateTelemetry();
  });

  // Telemetry Switches
  const toggleOverlays = document.getElementById('toggle-overlays');
  const svgOverlay = document.getElementById('svg-overlay-container');
  settings.showOverlay = toggleOverlays.checked;
  svgOverlay.style.display = settings.showOverlay ? 'block' : 'none';

  toggleOverlays.addEventListener('change', (e) => {
    settings.showOverlay = e.target.checked;
    svgOverlay.style.display = settings.showOverlay ? 'block' : 'none';
  });

  // Phase 2 Sidebar toggles
  const toggleErgosphere = document.getElementById('toggle-ergosphere');
  toggleErgosphere.addEventListener('change', (e) => {
    settings.showErgosphere = e.target.checked;
    ergosphereMesh.visible = settings.showErgosphere;
    updateErgosphereMesh();
  });

  const toggleGrid = document.getElementById('toggle-grid');
  toggleGrid.addEventListener('change', (e) => {
    settings.viewMode = e.target.checked ? 1 : 0;
    shaderMaterial.uniforms.uViewMode.value = settings.viewMode;
  });

      const toggleParticles = document.getElementById('toggle-particles');
  toggleParticles.addEventListener('change', (e) => {
    settings.showParticles = e.target.checked;
    particleSystem.visible = settings.showParticles;
  });

  // Phase 3 Sidebar Toggles
  const toggleJets = document.getElementById('toggle-jets');
  toggleJets.addEventListener('change', (e) => {
    settings.showJets = e.target.checked;
    shaderMaterial.uniforms.uShowJets.value = settings.showJets;
  });

  const toggleDiskWarp = document.getElementById('toggle-disk-warp');
  toggleDiskWarp.addEventListener('change', (e) => {
    settings.diskTiltActive = e.target.checked;
  });

  // Phase 3 Action Buttons
  const btnPenroseProbe = document.getElementById('btn-penrose-probe');
  btnPenroseProbe.addEventListener('click', () => {
    launchPenroseProbe();
  });

  const btnEvaporate = document.getElementById('btn-evaporate');
  btnEvaporate.addEventListener('click', () => {
    settings.evaporating = !settings.evaporating;
    btnEvaporate.classList.toggle('active', settings.evaporating);
    if (settings.evaporating) {
      showAlert("EVAPORATION ACTIVE", "HAWKING QUANTUM DECAY RUNAWAY SEQUENCE INITIATED...", false);
    } else {
      disableAlert();
    }
  });

  // Audio Synth Button
  const btnAudio = document.getElementById('btn-audio');
  btnAudio.addEventListener('click', () => {
    const active = audioSynth.toggle();
    settings.audioActive = active;
    btnAudio.innerText = active ? 'Acoustic HUD: ON' : 'Acoustic HUD: OFF';
    btnAudio.classList.toggle('active', active);
  });

  // Spawn particle manual button
  document.getElementById('btn-spawn-particle').addEventListener('click', () => {
    for (let i = 0; i < 40; i++) {
      spawnParticle(false);
    }
  });

  // Phase 2 EM Camera Filters
  setupFilterButton('filter-visible', 0);
  setupFilterButton('filter-xray', 1);
  setupFilterButton('filter-ir', 2);
  setupFilterButton('filter-beaming', 3);

  // Phase 2 Flight Deck cinematic tours
  setupTourButton('tour-orbit', 'orbit');
  setupTourButton('tour-polar', 'polar');
  setupTourButton('tour-infall', 'infall');

  // Zoom slider and button bindings
  setupSlider('input-zoom', 'val-zoom', (val) => {
    setCameraDistance(val);
  });

  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');

  btnZoomIn.addEventListener('click', () => {
    if (activeTour) return;
    const d = camera.position.length();
    const targetD = Math.max(4.0, d - 1.5);
    setCameraDistance(targetD);
    const sliderZoom = document.getElementById('input-zoom');
    const displayZoom = document.getElementById('val-zoom');
    if (sliderZoom) sliderZoom.value = targetD;
    if (displayZoom) displayZoom.innerText = targetD.toFixed(1);
  });

  btnZoomOut.addEventListener('click', () => {
    if (activeTour) return;
    const d = camera.position.length();
    const targetD = Math.min(40.0, d + 1.5);
    setCameraDistance(targetD);
    const sliderZoom = document.getElementById('input-zoom');
    const displayZoom = document.getElementById('val-zoom');
    if (sliderZoom) sliderZoom.value = targetD;
    if (displayZoom) displayZoom.innerText = targetD.toFixed(1);
  });

  // Presets
  setupPreset('preset-gargantua', {
    metric: 'kerr',
    mass: 1.0,
    spin: 0.99,
    diskIn: 2.2,
    diskOut: 18.0,
    diskTemp: 5500,
    diskOpacity: 0.95,
    physicalScale: 'supermassive'
  });

  setupPreset('preset-sgra', {
    metric: 'kerr',
    mass: 1.0,
    spin: 0.45,
    diskIn: 5.0,
    diskOut: 13.0,
    diskTemp: 8500,
    diskOpacity: 0.70,
    physicalScale: 'supermassive'
  });

  setupPreset('preset-m87', {
    metric: 'kerr',
    mass: 2.2,
    spin: 0.90,
    diskIn: 3.5,
    diskOut: 20.0,
    diskTemp: 5800,
    diskOpacity: 1.10,
    physicalScale: 'supermassive'
  });

  setupPreset('preset-bare', {
    metric: 'schwarzschild',
    mass: 1.0,
    spin: 0.0,
    diskIn: 6.0,
    diskOut: 16.0,
    diskTemp: 6000,
    diskOpacity: 0.0,
    physicalScale: 'stellar'
  });
}

function setupFilterButton(btnId, mode) {
  const btn = document.getElementById(btnId);
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn-group .btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    settings.filterMode = mode;
    shaderMaterial.uniforms.uFilterMode.value = mode;
    updateTelemetry();
  });
}

function setupTourButton(btnId, tourType) {
  const btn = document.getElementById(btnId);
  btn.addEventListener('click', () => {
    deactivateTourButtons();
    
    if (activeTour === tourType) {
      // Toggle off
      activeTour = null;
      controls.enabled = true;
      disableAlert();
    } else {
      // Toggle on
      activeTour = tourType;
      tourTime = 0.0;
      infallComplete = false;
      controls.enabled = (tourType !== 'infall'); // Disable orbit drag only on infall
      btn.classList.add('active');
      
      if (tourType === 'infall') {
        // Prepare infall
        camera.position.set(0, 4.4, 22.0); // start at standard distance
        disableAlert();
      }
    }
  });
}

function deactivateTourButtons() {
  document.querySelectorAll('.flight-btn-group .btn').forEach(b => b.classList.remove('active'));
}

function setupSlider(inputId, displayId, callback, suffix = '') {
  const slider = document.getElementById(inputId);
  const display = document.getElementById(displayId);
  slider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    display.innerText = val.toFixed(2) + suffix;
    if (inputId === 'input-temp') {
      display.innerText = val + suffix;
    }
    callback(val);
  });
}

function setCameraDistance(d) {
  if (!camera || !controls) return;
  const dir = new THREE.Vector3().copy(camera.position).normalize();
  camera.position.copy(dir.multiplyScalar(d));
  controls.update();
}

function updateSliderUI(inputId, displayId, value, suffix = '') {
  const slider = document.getElementById(inputId);
  const display = document.getElementById(displayId);
  slider.value = value;
  display.innerText = inputId === 'input-temp' ? value + suffix : value.toFixed(2) + suffix;
}

function setupPreset(btnId, preset) {
  const btn = document.getElementById(btnId);
  btn.addEventListener('click', () => {
    document.querySelectorAll('.preset-btn-group .btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    settings.metric = preset.metric;
    settings.mass = preset.mass;
    settings.spin = preset.spin;
    settings.diskIn = preset.diskIn;
    settings.diskOut = preset.diskOut;
    settings.diskTemp = preset.diskTemp;
    settings.diskOpacity = preset.diskOpacity;
    settings.physicalScale = preset.physicalScale;

    document.getElementById('metric-select').value = preset.metric;
    document.getElementById('metric-select').dispatchEvent(new Event('change'));

    updateSliderUI('input-mass', 'val-mass', preset.mass);
    updateSliderUI('input-spin', 'val-spin', preset.spin);
    updateSliderUI('input-disk-in', 'val-disk-in', preset.diskIn);
    updateSliderUI('input-disk-out', 'val-disk-out', preset.diskOut);
    updateSliderUI('input-temp', 'val-temp', preset.diskTemp, ' K');
    updateSliderUI('input-opacity', 'val-opacity', preset.diskOpacity);

    document.getElementById('scale-stellar').classList.toggle('active', preset.physicalScale === 'stellar');
    document.getElementById('scale-supermassive').classList.toggle('active', preset.physicalScale === 'supermassive');

    // Reset filters and views for preset consistency
    settings.filterMode = 0;
    shaderMaterial.uniforms.uFilterMode.value = 0;
    document.querySelectorAll('.filter-btn-group .btn').forEach(b => b.classList.remove('active'));
    document.getElementById('filter-visible').classList.add('active');

    shaderMaterial.uniforms.uMass.value = preset.mass;
    shaderMaterial.uniforms.uSpin.value = preset.spin;
    shaderMaterial.uniforms.uDiskIn.value = preset.diskIn;
    shaderMaterial.uniforms.uDiskOut.value = preset.diskOut;
    shaderMaterial.uniforms.uDiskTemp.value = preset.diskTemp;
    shaderMaterial.uniforms.uDiskOpacity.value = preset.diskOpacity;

    // Reset Phase 3 states
    settings.showJets = false;
    settings.diskTiltActive = false;
    settings.evaporating = false;
    shaderMaterial.uniforms.uShowJets.value = false;
    shaderMaterial.uniforms.uDiskTilt.value = 0.0;
    
    // Reset HUD Cinematic view
    settings.hudHidden = false;
    const appContainer = document.getElementById('app');
    if (appContainer) appContainer.classList.remove('hud-hidden');
    const btnToggleHud = document.getElementById('btn-toggle-hud');
    if (btnToggleHud) {
      btnToggleHud.innerText = 'Cinematic View';
      btnToggleHud.classList.remove('active');
    }
    
    // Clear active Penrose probes
    for (let i = 0; i < activeProbes.length; i++) {
      scene.remove(activeProbes[i].mesh);
      activeProbes[i].mesh.geometry.dispose();
      activeProbes[i].mesh.material.dispose();
    }
    activeProbes = [];
    
    const toggleJets = document.getElementById('toggle-jets');
    if (toggleJets) toggleJets.checked = false;
    
    const toggleDiskWarp = document.getElementById('toggle-disk-warp');
    if (toggleDiskWarp) toggleDiskWarp.checked = false;
    
    const btnEvaporate = document.getElementById('btn-evaporate');
    if (btnEvaporate) btnEvaporate.classList.remove('active');

    updateTelemetry();
    updateErgosphereMesh();
  });
}

// --- ERGOSPHERE WIREFRAME SCALING ---

function updateErgosphereMesh() {
  if (!ergosphereMesh) return;
  
  if (!settings.showErgosphere || settings.metric !== 'kerr') {
    ergosphereMesh.visible = false;
    return;
  }
  
  // Show only in Kerr metric
  ergosphereMesh.visible = true;
  
  const massVal = settings.mass;
  const spinVal = settings.spin;
  
  // Kerr Ergosphere boundaries
  // Equator radius = 2.0 * M
  const rEquator = 2.0 * massVal;
  // Polar radius = outer horizon = M + sqrt(M^2 - a^2)
  const rPolar = physics.getEventHorizonRadius(massVal, spinVal);
  
  // Set scale (recall sphere was rotated by 90deg, so scale is scaled on axes)
  // local Z -> poles, local X/Y -> equator
  ergosphereMesh.scale.set(rEquator, rEquator, rPolar);
}

// --- TELEMETRY CALCULATIONS (CPU) ---

function updateTelemetry() {
  const massVal = settings.mass;
  const spinVal = settings.spin;
  
  let baseMassSolar = STELLAR_MASS;
  let labelClass = 'Stellar Mass';
  if (settings.physicalScale === 'supermassive') {
    baseMassSolar = SUPERMASSIVE_MASS;
    labelClass = massVal > 1.5 ? 'Supermassive (M87* Class)' : 'Supermassive (Sgr A* Class)';
  } else {
    labelClass = massVal > 2.0 ? 'Intermediate Mass' : 'Stellar Mass';
  }
  
  const totalSolarMasses = massVal * baseMassSolar;
  const rScaleKm = 2.953 * totalSolarMasses;

  // Horizon
  const rhNorm = physics.getEventHorizonRadius(massVal, spinVal);
  const rhKm = rhNorm * (rScaleKm / 2.0);

  // Photon Sphere
  let rphNorm = 3.0 * massVal;
  if (spinVal > 0) {
    const ph = physics.getPhotonSphereRadius(massVal, spinVal);
    rphNorm = ph.average;
  }
  const rphKm = rphNorm * (rScaleKm / 2.0);

  // ISCO
  const iscoNorm = physics.getISCO(massVal, spinVal);
  const iscoKm = iscoNorm * (rScaleKm / 2.0);

  // Dilation & Escape at camera position
  const camDistance = camera.position.length();
  const timeFlowRate = physics.getTimeDilationFactor(massVal, spinVal, camDistance);
  const dilationRatio = timeFlowRate > 0 ? (1.0 / timeFlowRate) : Infinity;

  const vEscRatio = physics.getEscapeVelocity(massVal, spinVal, camDistance);
  const vEscKms = vEscRatio * (C / 1000);

  // Peak Temperature
  const rPeak = iscoNorm * 1.361;
  const maxTempKelvin = physics.getAccretionDiskTemperature(massVal, spinVal, rPeak, settings.diskTemp);

  // Write to DOM
  document.getElementById('tel-class').innerText = labelClass;
  document.getElementById('tel-horizon').innerText = formatDistance(rhKm);
  document.getElementById('tel-horizon-units').innerText = rhNorm.toFixed(2);
  
  document.getElementById('tel-photon').innerText = formatDistance(rphKm);
  document.getElementById('tel-photon-units').innerText = rphNorm.toFixed(2);

  document.getElementById('tel-isco').innerText = formatDistance(iscoKm);
  document.getElementById('tel-isco-units').innerText = iscoNorm.toFixed(2);

  document.getElementById('tel-spin').innerText = spinVal.toFixed(2);

  document.getElementById('tel-dilation').innerText = (timeFlowRate * 100).toFixed(1) + '%';
  document.getElementById('tel-dilation-ratio').innerText = dilationRatio === Infinity ? 'Infinite' : `${dilationRatio.toFixed(2)}s at \u221e`;

  document.getElementById('tel-escape').innerText = formatVelocity(vEscKms);
  document.getElementById('tel-escape-c').innerText = vEscRatio.toFixed(3);

  document.getElementById('tel-temp').innerText = Math.round(maxTempKelvin).toLocaleString() + ' K';
  
  const tempColorIndicator = document.getElementById('temp-color');
  const colorRGB = getBlackbodyColorRGB(maxTempKelvin);
  tempColorIndicator.style.backgroundColor = colorRGB;
  tempColorIndicator.style.boxShadow = `0 0 8px ${colorRGB}`;

  // Real-time Spaghettification Telemetry
  const tidal = physics.getTidalForce(massVal, spinVal, camDistance, settings.physicalScale);
  const tfVal = document.getElementById('tel-tidal-force');
  const tgVal = document.getElementById('tel-tidal-g');
  const tsVal = document.getElementById('tel-tidal-status');
  
  if (tfVal && tgVal && tsVal) {
    tfVal.innerText = tidal.newtons > 1e6 ? tidal.newtons.toExponential(2) + ' N' : Math.round(tidal.newtons).toLocaleString() + ' N';
    tgVal.innerText = tidal.gForces > 1e5 ? tidal.gForces.toExponential(2) : Math.round(tidal.gForces).toLocaleString();
    
    if (tidal.gForces < 10.0) {
      tsVal.innerText = 'SAFE';
      tsVal.className = 'status-safe';
    } else if (tidal.gForces < 1000.0) {
      tsVal.innerText = 'DANGER';
      tsVal.className = 'status-warning';
    } else {
      tsVal.innerText = 'LETHAL';
      tsVal.className = 'status-lethal';
      
      // Proximity alert for extreme gravitational spaghettification
      if (!activeTour && camDistance <= 5.5) {
        showAlert("SPAGHETTIFICATION DETECTED", "TIDAL FORCES EXCEED BIOLOGICAL LIMITS!", true);
      }
    }
  }
}

function formatDistance(km) {
  if (km > 1.496e8) {
    return (km / 1.496e8).toFixed(3) + ' AU';
  } else if (km > 10000) {
    return Math.round(km).toLocaleString() + ' km';
  } else {
    return km.toFixed(2) + ' km';
  }
}

function formatVelocity(kms) {
  if (kms >= C / 1000 * 0.999) {
    return 'c (299,792 km/s)';
  }
  return Math.round(kms).toLocaleString() + ' km/s';
}

function getBlackbodyColorRGB(temp) {
  let T = Math.max(1000, Math.min(15000, temp));
  let t = T / 100;
  let r, g, b;

  if (t <= 66) {
    r = 255;
    g = t;
    g = 99.4708025861 * Math.log(g) - 161.1195681661;
    g = Math.max(0, Math.min(255, g));
  } else {
    r = t - 60;
    r = 329.698727446 * Math.pow(r, -0.1332047592);
    r = Math.max(0, Math.min(255, r));
    g = t - 60;
    g = 288.1221695283 * Math.pow(g, -0.0755148492);
    g = Math.max(0, Math.min(255, g));
  }

  if (t >= 66) {
    b = 255;
  } else if (t <= 19) {
    b = 0;
  } else {
    b = t - 10;
    b = 138.5177312231 * Math.log(b) - 305.0447927307;
    b = Math.max(0, Math.min(255, b));
  }

  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

// --- SVG LENS OVERLAYS (CPU Screen Space Projection) ---

function updateSVGOverlay() {
  if (!settings.showOverlay || !camera) return;

  const width = window.innerWidth;
  const height = window.innerHeight;
  
  const d = camera.position.length();
  const fovRad = (camera.fov * Math.PI) / 180;
  const tanFOV = Math.tan(fovRad / 2.0);

  const rhNorm = physics.getEventHorizonRadius(settings.mass, settings.spin);
  const rHorizonPx = height * (rhNorm / (2.0 * d * tanFOV));

  let rphNorm = 3.0 * settings.mass;
  if (settings.spin > 0) {
    const ph = physics.getPhotonSphereRadius(settings.mass, settings.spin);
    rphNorm = ph.average;
  }
  const rPhotonPx = height * (rphNorm / (2.0 * d * tanFOV));

  const circleHorizon = document.getElementById('overlay-horizon');
  const circlePhoton = document.getElementById('overlay-photon');
  const lblHorizon = document.getElementById('overlay-lbl-horizon');
  const lblPhoton = document.getElementById('overlay-lbl-photon');

  const cx = width / 2;
  const cy = height / 2;

  circleHorizon.setAttribute('cx', cx);
  circleHorizon.setAttribute('cy', cy);
  circleHorizon.setAttribute('r', rHorizonPx);

  circlePhoton.setAttribute('cx', cx);
  circlePhoton.setAttribute('cy', cy);
  circlePhoton.setAttribute('r', rPhotonPx);

  lblHorizon.setAttribute('x', cx + rHorizonPx + 8);
  lblHorizon.setAttribute('y', cy + 4);

  lblPhoton.setAttribute('x', cx + rPhotonPx + 8);
  lblPhoton.setAttribute('y', cy - 10);
}

// --- ALERT BANNER ---

function showAlert(title, message, isCritical = false) {
  const banner = document.getElementById('alert-banner');
  const alertTitle = document.getElementById('alert-title');
  const alertMsg = document.getElementById('alert-message');
  
  alertTitle.innerText = title;
  alertMsg.innerText = message;
  
  if (isCritical) {
    banner.style.borderColor = '#ff0055';
    banner.style.boxShadow = '0 0 30px rgba(255, 0, 85, 0.4)';
  } else {
    banner.style.borderColor = '#ff8a00';
    banner.style.boxShadow = '0 0 30px rgba(255, 138, 0, 0.4)';
  }
  
  banner.classList.remove('hidden');
}

function disableAlert() {
  document.getElementById('alert-banner').classList.add('hidden');
}

function triggerSingularityExplosion() {
  const flash = document.getElementById('flash-overlay');
  if (flash) {
    flash.classList.add('active');
  }
  
  if (bloomPass) bloomPass.strength = 15.0;
  if (renderer) renderer.toneMappingExposure = 4.0;
  
  if (settings.audioActive && audioSynth) {
    audioSynth.playExplosionTone();
  }

  // Clear any active Penrose probes
  for (let i = 0; i < activeProbes.length; i++) {
    scene.remove(activeProbes[i].mesh);
    activeProbes[i].mesh.geometry.dispose();
    activeProbes[i].mesh.material.dispose();
  }
  activeProbes = [];
  
  settings.mass = 1.0;
  updateSliderUI('input-mass', 'val-mass', 1.0);
  shaderMaterial.uniforms.uMass.value = 1.0;
  updateErgosphereMesh();
  updateTelemetry();
  
  showAlert("GAMMA RAY BURST", "SINGULARITY EVAPORATED IN A HYPER-ENERGETIC QUANTUM EXPLOSION!", true);
  
  setTimeout(() => {
    if (flash) flash.classList.remove('active');
    
    let t = 0;
    const restoreInterval = setInterval(() => {
      t += 0.1;
      if (t >= 1.0) {
        clearInterval(restoreInterval);
        if (bloomPass) bloomPass.strength = 1.5;
        if (renderer) renderer.toneMappingExposure = 1.0;
        disableAlert();
      } else {
        if (bloomPass) bloomPass.strength = 15.0 - (15.0 - 1.5) * t;
        if (renderer) renderer.toneMappingExposure = 4.0 - (4.0 - 1.0) * t;
      }
    }, 50);
  }, 1200);
}

// --- RENDER LOOP & RESIZING ---

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  
  updateSVGOverlay();
}

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  const cappedDelta = Math.min(delta, 0.1); // prevent massive jumps on tab suspension

  // 1. Cinematic Tour Controls
  if (activeTour) {
    tourTime += cappedDelta;
    
    if (activeTour === 'orbit') {
      const rOrbit = 20.0;
      camera.position.x = rOrbit * Math.cos(tourTime * 0.15);
      camera.position.z = rOrbit * Math.sin(tourTime * 0.15);
      camera.position.y = 3.5 * Math.sin(tourTime * 0.05) + 3.0;
      camera.lookAt(0, 0, 0);
    } else if (activeTour === 'polar') {
      const rPolar = 18.0;
      camera.position.x = rPolar * Math.sin(tourTime * 0.12) * Math.cos(0.3);
      camera.position.y = rPolar * Math.cos(tourTime * 0.12);
      camera.position.z = rPolar * Math.sin(tourTime * 0.12) * Math.sin(0.3);
      camera.lookAt(0, 0, 0);
    } else if (activeTour === 'infall') {
      const rHorizon = physics.getEventHorizonRadius(settings.mass, settings.spin);
      const rPhoton = 3.0 * settings.mass;
      
      // Decay distance exponentially towards event horizon
      let fallDistance = 22.0 - tourTime * 1.8;
      
      if (fallDistance <= rHorizon + 0.1) {
        // Horizon Crossed / Time Stopped!
        fallDistance = rHorizon + 0.05;
        if (!infallComplete) {
          infallComplete = true;
          showAlert("SINGULARITY REACHED", "COORDINATE TIME FLOW CEASED. INITIALIZING REBOOT...", true);
          settings.paused = true;
          
          // Audio pitch drop to infrasonic limit
          if (settings.audioActive) {
            audioSynth.update(rHorizon + 0.05, 2.0 * settings.mass);
          }
          
          // Reset tour after 3 seconds
          setTimeout(() => {
            activeTour = null;
            disableAlert();
            deactivateTourButtons();
            camera.position.set(0, 8, 22);
            controls.enabled = true;
            controls.reset();
            settings.paused = false;
            infallComplete = false;
          }, 4000);
        }
      } else {
        // Trigger alerts based on distances
        if (fallDistance <= rPhoton) {
          showAlert("CRITICAL TELEMETRY", "CROSSING PHOTON SPHERE BOUNDARY (r < 3.00 GM/c²)", true);
        } else if (fallDistance <= rPhoton * 1.5) {
          showAlert("PROXIMITY WARNING", "ACCELERATING THROUGH ERGOSPHERE LIMIT", false);
        }
      }
      
      // Keep camera approaching in a slightly tilted diagonal trajectory
      const pathAngle = 0.25; // 15deg tilt
      camera.position.set(
        0.0,
        fallDistance * Math.sin(pathAngle),
        fallDistance * Math.cos(pathAngle)
      );
      camera.lookAt(0, 0, 0);
    }
  } else {
    // Normal orbit controls update
    controls.update();
  }

  // Phase 3 Runaway Hawking Evaporation Decay
  if (settings.evaporating && !settings.paused) {
    const dM = physics.getHawkingMassDecay(settings.mass, cappedDelta * settings.timeScale, 0.05);
    settings.mass = Math.max(0.05, settings.mass - dM);
    
    // Sync slider & display
    updateSliderUI('input-mass', 'val-mass', settings.mass);
    shaderMaterial.uniforms.uMass.value = settings.mass;
    updateErgosphereMesh();
    updateTelemetry();
    
    // Play rising sweep frequency using the synthesizer if audio is active
    if (settings.audioActive && audioSynth && audioSynth.diskOsc) {
      const pitchScale = 1.0 / Math.max(0.05, settings.mass);
      audioSynth.diskOsc.frequency.setTargetAtTime(audioSynth.baseDiskFreq * pitchScale, audioSynth.ctx.currentTime, 0.1);
    }
    
    if (settings.mass <= 0.055) {
      settings.evaporating = false;
      const btnEvaporate = document.getElementById('btn-evaporate');
      if (btnEvaporate) btnEvaporate.classList.remove('active');
      triggerSingularityExplosion();
    }
  }

  // Smoothly transition disk tilt
  const targetTilt = settings.diskTiltActive ? 0.35 : 0.0;
  settings.diskTilt += (targetTilt - settings.diskTilt) * 0.08;
  shaderMaterial.uniforms.uDiskTilt.value = settings.diskTilt;

  // 2. Update shader uniforms
  shaderMaterial.uniforms.uCameraPos.value.copy(camera.position);
  
  if (!settings.paused) {
    simTime += cappedDelta * settings.timeScale;
    shaderMaterial.uniforms.uTime.value = simTime;
  }

  // 3. Update Audio Synthesizer
  if (settings.audioActive) {
    audioSynth.update(camera.position.length(), 2.0 * settings.mass);
  }

  // 4. Update CPU particles (Paczynski-Wiita orbital integration)
  if (settings.showParticles) {
    updateParticles(cappedDelta * settings.timeScale);
  }

  // Update Penrose Probe physical meshes
  updateActiveProbes(cappedDelta * settings.timeScale);

  // 5. Update HUD overlays
  updateTelemetry();
  updateSVGOverlay();

  // Bidirectional zoom slider sync
  if (!activeTour) {
    const d = camera.position.length();
    const sliderZoom = document.getElementById('input-zoom');
    const displayZoom = document.getElementById('val-zoom');
    if (sliderZoom && displayZoom) {
      sliderZoom.value = d;
      displayZoom.innerText = d.toFixed(1);
    }
  }

  // 6. Render with UnrealBloom Composer
  composer.render();
}

window.addEventListener('DOMContentLoaded', () => {
  init();
  animate();
});
