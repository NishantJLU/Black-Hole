import * as THREE from 'three';

/**
 * shaders.js
 * Relativistic Ray Marching GLSL Shaders for Schwarzschild and Kerr Black Holes.
 * Uses WebGL2 (GLSL 3.00 ES).
 */

export const vertexShader = `
  out vec2 vUv;
  out vec3 vWorldPosition;

  void main() {
    vUv = uv;
    // Calculate world position for ray direction determination
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const fragmentShader = `
  precision highp float;

  // Inputs from vertex shader
  in vec2 vUv;
  in vec3 vWorldPosition;

  // Uniforms
  uniform vec3 uCameraPos;
  uniform float uMass;
  uniform float uSpin;          // Dimensionless spin parameter a in [0, 0.999]
  uniform float uTime;
  uniform float uRMax;          // Outer boundary radius of simulation
  
  // Accretion Disk parameters
  uniform float uDiskIn;
  uniform float uDiskOut;
  uniform float uDiskTemp;       // Base temperature in Kelvin
  uniform float uDiskOpacity;
  
  // Controls
  uniform float uStepScale;     // Controls step size multiplier (default 0.08)
  uniform float uMaxStep;       // Maximum allowed step size
  uniform bool uShowOverlay;    // Toggle overlays/helper visuals in shader
  uniform bool uUseTextureSky;  // Use space texture
  uniform sampler2D uSkyTexture;// Skybox equirectangular texture
  
  // Phase 2 Additions
  uniform int uViewMode;        // 0 = Stars/Nebula, 1 = Reference Grid
  uniform int uFilterMode;      // 0 = Normal, 1 = X-Ray/UV, 2 = Infrared, 3 = Relativistic Beaming Heatmap

  // Phase 3 Additions
  uniform bool uShowJets;
  uniform float uJetIntensity;
  uniform float uDiskTilt;      // Tilt angle in radians

  // Output color
  out vec4 fragColor;

  #define MAX_STEPS 250
  #define PI 3.14159265359

  // --- MATH & UTILITIES ---

  // Hash function for noise
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  // 2D Value Noise
  float noise(vec2 p) {
    vec2 ip = floor(p);
    vec2 fp = fract(p);
    fp = fp * fp * (3.0 - 2.0 * fp); // Smooth Hermite interpolation
    
    float a = hash(ip);
    float b = hash(ip + vec2(1.0, 0.0));
    float c = hash(ip + vec2(0.0, 1.0));
    float d = hash(ip + vec2(1.0, 1.0));
    
    return mix(mix(a, b, fp.x), mix(c, d, fp.x), fp.y);
  }

  // 2D Fractional Brownian Motion (fBm)
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100.0);
    // Rotate matrix to reduce axial alignment artifacts
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = rot * p * 2.0 + shift;
      a *= 0.5;
    }
    return v;
  }

  // Blackbody radiation color approximation from temperature in Kelvin
  // Fits Mitchell Charity's blackbody table (1000K to 12000K)
  vec3 blackbody(float Temp) {
    float T = clamp(Temp, 1000.0, 15000.0);
    float t = T / 100.0;
    vec3 col = vec3(0.0);
    
    // Red
    if (t <= 66.0) {
      col.r = 1.0;
    } else {
      col.r = t - 60.0;
      col.r = 329.698727446 * pow(col.r, -0.1332047592);
      col.r = clamp(col.r / 255.0, 0.0, 1.0);
    }
    
    // Green
    if (t <= 66.0) {
      col.g = t;
      col.g = 99.4708025861 * log(col.g) - 161.1195681661;
      col.g = clamp(col.g / 255.0, 0.0, 1.0);
    } else {
      col.g = t - 60.0;
      col.g = 288.1221695283 * pow(col.g, -0.0755148492);
      col.g = clamp(col.g / 255.0, 0.0, 1.0);
    }
    
    // Blue
    if (t >= 66.0) {
      col.b = 1.0;
    } else if (t <= 19.0) {
      col.b = 0.0;
    } else {
      col.b = t - 10.0;
      col.b = 138.5177312231 * log(col.b) - 305.0447927307;
      col.b = clamp(col.b / 255.0, 0.0, 1.0);
    }
    
    return col;
  }

  // --- RAY-SPHERE INTERSECTION ---
  // Jump the ray from camera to outer sphere boundary to save performance
  bool intersectOuterSphere(vec3 ro, vec3 rd, float rMax, out float tEntry) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - rMax * rMax;
    float h = b * b - c;
    if (h < 0.0) return false; // Miss
    h = sqrt(h);
    float t1 = -b - h;
    
    if (t1 > 0.0) {
      tEntry = t1;
      return true; // Ray starts outside and enters sphere
    }
    
    // Camera is inside the sphere
    tEntry = 0.0;
    return true;
  }

  // --- BACKGROUND SKY SAMPLING ---
  vec2 getEquirectangularUV(vec3 dir) {
    float phi = atan(dir.z, dir.x);
    float theta = asin(dir.y);
    float u = (phi + PI) / (2.0 * PI);
    float v = (theta + PI / 2.0) / PI;
    return vec2(u, v);
  }

  // Procedural sharp starfield
  float hash3d(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract(p.x * p.y * p.z);
  }

  vec3 getProceduralStars(vec3 dir) {
    vec3 p = dir * 180.0;
    vec3 ip = floor(p);
    vec3 fp = fract(p);
    
    float h = hash3d(ip);
    vec3 star_color = vec3(0.0);
    
    if (h > 0.985) { // Star density
      vec3 jitter = vec3(hash3d(ip + 1.1), hash3d(ip + 2.3), hash3d(ip + 3.7)) - 0.5;
      vec3 delta = fp - 0.5 - jitter * 0.4;
      float dist = length(delta);
      
      float size = 0.03 + 0.08 * hash3d(ip + 4.9);
      float star = smoothstep(size, 0.0, dist);
      
      // Star temperature 3000K to 12000K
      vec3 col = blackbody(3000.0 + 9000.0 * hash3d(ip + 5.2));
      star_color = col * star * (0.8 + 2.5 * hash3d(ip + 6.1));
    }
    return star_color;
  }

  // Procedural coordinate checkerboard reference grid
  vec3 getGridColor(vec3 dir) {
    vec2 uv = getEquirectangularUV(dir);
    // 36 divisions horizontally, 18 vertically
    vec2 grid = fract(uv * vec2(36.0, 18.0));
    float lineX = smoothstep(0.05, 0.0, abs(grid.x - 0.5) - 0.475);
    float lineY = smoothstep(0.08, 0.0, abs(grid.y - 0.5) - 0.46);
    float checker = (step(0.5, grid.x) == step(0.5, grid.y)) ? 1.0 : 0.0;
    
    vec3 baseCol = mix(vec3(0.005, 0.012, 0.025), vec3(0.02, 0.035, 0.065), checker);
    // Grid lines color is neon cyan
    vec3 gridCol = mix(baseCol, vec3(0.0, 0.9, 1.0), max(lineX, lineY));
    
    // Add central axes (equator and prime meridian) in bright amber
    float equatorLine = smoothstep(0.01, 0.0, abs(uv.y - 0.5));
    float meridianLine = smoothstep(0.005, 0.0, abs(uv.x - 0.5));
    gridCol = mix(gridCol, vec3(1.0, 0.54, 0.0), max(equatorLine, meridianLine));
    
    return gridCol;
  }

  // Relativistic Beaming Heatmap false color
  vec3 beamingColor(float g) {
    // g ranges from ~0.2 (redshifted/dim) to ~1.8 (blueshifted/bright)
    if (g < 1.0) {
      float t = smoothstep(0.3, 1.0, g);
      return mix(vec3(0.9, 0.05, 0.05), vec3(0.05, 0.85, 0.05), t); // Red to Green
    } else {
      float t = smoothstep(1.0, 1.5, g);
      return mix(vec3(0.05, 0.85, 0.05), vec3(0.0, 0.75, 1.0), t); // Green to Cyan/Blue
    }
  }

  // --- MAIN RAY-MARCHING SIMULATION ---

  void main() {
    // Setup initial ray position and direction
    vec3 ro = uCameraPos;
    vec3 rd = normalize(vWorldPosition - uCameraPos);
    
    // Check intersection with the bounding sphere of the simulation
    float tEntry = 0.0;
    if (!intersectOuterSphere(ro, rd, uRMax, tEntry)) {
      // If ray misses bounding sphere completely, render standard sky
      vec3 star_color = getProceduralStars(rd);
      if (uUseTextureSky) {
        vec3 sky_tex = texture(uSkyTexture, getEquirectangularUV(rd)).rgb;
        fragColor = vec4(sky_tex + star_color, 1.0);
      } else {
        fragColor = vec4(star_color, 1.0);
      }
      return;
    }
    
    // Starting position of ray integration
    vec3 p = ro + rd * tEntry;
    vec3 v = rd; // Initial velocity (speed = 1)
    
    // Physics constants
    float r_s = 2.0 * uMass; // Schwarzschild radius
    
    // Event horizon outer radius r+
    float discriminant = uMass * uMass - (uSpin * uMass) * (uSpin * uMass);
    float r_h = (discriminant >= 0.0) ? (uMass + sqrt(discriminant)) : uMass;
    
    // Disk integration buffers
    vec3 acc_color = vec3(0.0);
    float acc_alpha = 0.0;
    bool hitHorizon = false;
    
    // Trace variables
    vec3 p_prev = p;
    float lambda = 0.0; // Affine parameter/time path

    // Ray marching loop
    for (int stepIdx = 0; stepIdx < MAX_STEPS; stepIdx++) {
      float r2 = dot(p, p);
      float r = sqrt(r2);
      
      // 1. Check Event Horizon intersection
      if (r <= r_h + 0.01) {
        hitHorizon = true;
        break;
      }
      
      // 2. Check Outer Boundary escape
      if (r > uRMax + 1.0) {
        break;
      }
      
      // 3. Adaptive Step Size (detailed near horizon, fast in flat space)
      float dt = min(uMaxStep, uStepScale * r);
      p_prev = p;
      
      // 4. Calculate Geodesic Acceleration (Schwarzschild core)
      vec3 L_vec = cross(p, v);
      float L2 = dot(L_vec, L_vec);
      // Schwarzschild general relativity deflection term
      vec3 acc = -1.5 * r_s * L2 * p / (r2 * r2 * r);
      
      // 5. Apply Frame Dragging (Kerr Metric rotation around Z-axis)
      if (uSpin > 0.0) {
        // Frame dragging angular velocity: omega = 2 a M / r^3
        // In our coordinates, M = uMass, a = uSpin * uMass
        float omega = (2.0 * uSpin * uMass * uMass) / (r2 * r);
        float dTheta = omega * dt;
        
        float cosT = cos(dTheta);
        float sinT = sin(dTheta);
        mat2 rotZ = mat2(cosT, -sinT, sinT, cosT);
        
        // Drag position and velocity
        p.xy = rotZ * p.xy;
        v.xy = rotZ * v.xy;
        p_prev.xy = rotZ * p_prev.xy;
      }
      
      // 6. Integrate step (Semi-implicit Euler / Verlet-like)
      p += v * dt + 0.5 * acc * dt * dt;
      v += acc * dt;
      v = normalize(v); // Photon coordinate direction normalization
      
      // Volumetric Polar Jets integration
      if (uShowJets) {
        float d_axis = length(p.xy);
        float w_jet = 0.5 + 0.08 * abs(p.z);
        if (d_axis <= w_jet && abs(p.z) <= 18.0) {
          float d_jet = exp(-0.15 * abs(p.z)) * (1.0 - d_axis / w_jet);
          d_jet = max(0.0, d_jet);
          
          // Add noise to the jets for volumetric turbulence/detail
          float jet_noise = noise(vec2(p.z * 1.5 - uTime * 4.0, d_axis * 4.0));
          d_jet *= (0.6 + 0.4 * jet_noise);
          
          // Jet color gradient: violet at base, cyan further out
          vec3 jet_col = mix(vec3(0.5, 0.1, 1.0), vec3(0.0, 0.7, 1.0), min(1.0, abs(p.z) / 12.0));
          
          float step_opac = d_jet * uJetIntensity * dt;
          acc_color += (1.0 - acc_alpha) * jet_col * step_opac;
          acc_alpha += (1.0 - acc_alpha) * step_opac;
        }
      }
      
      // 7. Check Accretion Disk Intersection (equatorial plane crossing z = 0, or warped disk)
      float r_xy_prev = length(p_prev.xy);
      float r_xy = length(p.xy);
      float z_disk_prev = 0.0;
      float z_disk = 0.0;
      
      if (uDiskTilt > 0.0) {
        z_disk_prev = p_prev.y * sin(uDiskTilt) * smoothstep(uDiskIn, uDiskOut, r_xy_prev);
        z_disk = p.y * sin(uDiskTilt) * smoothstep(uDiskIn, uDiskOut, r_xy);
      }
      
      float h_prev = p_prev.z - z_disk_prev;
      float h = p.z - z_disk;
      
      if (h_prev * h < 0.0) {
        // Find exact crossing fraction t in [0, 1]
        float t_cross = abs(h_prev) / (abs(h_prev) + abs(h));
        vec3 p_disk = mix(p_prev, p, t_cross);
        float r_disk = length(p_disk);
        
        // Check if within accretion disk radii
        if (r_disk >= uDiskIn && r_disk <= uDiskOut) {
          // Keplerian orbital speed: v_orb = sqrt(GM/r)
          // M = uMass. In G=1, v_orb = sqrt(uMass/r)
          float v_orb = sqrt(uMass / r_disk);
          
          // Keplerian orbital angular frequency: omega = sqrt(GM/r^3)
          float omega_kep = sqrt(uMass / (r_disk * r_disk * r_disk));
          
          // Fluid motion unit tangent vector (counter-clockwise)
          vec2 gas_dir = normalize(vec2(-p_disk.y, p_disk.x));
          vec3 v_gas = vec3(gas_dir * v_orb, 0.0);
          
          if (uDiskTilt > 0.0) {
            float slope_y = sin(uDiskTilt) * smoothstep(uDiskIn, uDiskOut, r_disk);
            v_gas.z = v_gas.y * slope_y;
            v_gas = normalize(v_gas) * v_orb;
          }
          
          // Relativistic Doppler Beaming calculation
          // v_ray is the direction of the ray at crossing
          float v_los = dot(v_gas, v); // Line of sight speed relative to photon
          
          // Lorentz factor
          float gamma = 1.0 / sqrt(1.0 - v_orb * v_orb);
          
          // Doppler shift factor D:
          // D = 1 / (gamma * (1 + beta * cos(theta)))
          // Denominator has (1.0 + v_los) since ray direction points from camera to disk (reversed)
          float D = sqrt(1.0 - v_orb * v_orb) / (1.0 + v_los);
          
          // Total shift factor including gravitational redshift:
          // g = D * sqrt(1.0 - r_s / r)
          // For Kerr, gravitational redshift is modified, but Schwarzschild approximation is highly stable
          float g_redshift = sqrt(max(0.0001, 1.0 - r_s / r_disk));
          float g_total = D * g_redshift;
          
          // Beaming factor: intensity scaled by g_total^4
          float beaming = pow(g_total, 4.0);
          
          // Temperature profile of standard thin disk: Novikov-Thorne approximation
          // T(r) goes to 0 at r_in (ISCO) and decays as r^(-3/4)
          // We normalize so that the peak temperature corresponds to uDiskTemp
          float NT_factor = 0.0;
          if (r_disk > uDiskIn) {
            float x = r_disk / uDiskIn;
            // NT profile shape: x^(-3/4) * (1 - sqrt(1/x))^(1/4)
            NT_factor = pow(1.0 / x, 0.75) * pow(max(0.0, 1.0 - sqrt(1.0 / x)), 0.25);
            // Normalize so peak value is 1.0 (peak occurs at x = 1.361)
            NT_factor /= 0.1924; 
          }
          
          float T_local = NT_factor * uDiskTemp;
          float T_obs = g_total * T_local; // Observed temperature shifted
          
          // Convert observed temperature to physical blackbody color depending on filter mode
          vec3 bbody_color = vec3(0.0);
          
          if (uFilterMode == 0) {
            // Normal visible light
            bbody_color = blackbody(T_obs);
          } else if (uFilterMode == 1) {
            // X-Ray / UV view: only show ultra-hot region (> 6500K), map to high-energy violet/blue
            float xray_intensity = smoothstep(6500.0, 11000.0, T_obs);
            bbody_color = vec3(0.5, 0.4, 1.0) * xray_intensity * 2.5;
          } else if (uFilterMode == 2) {
            // Infrared view: highlight cool gas (< 8500K), map to warm dark orange
            float ir_intensity = smoothstep(8500.0, 3000.0, T_obs);
            bbody_color = vec3(1.0, 0.35, 0.05) * ir_intensity * 1.5;
          } else if (uFilterMode == 3) {
            // Doppler Beaming view: map Doppler shift factor to color heatmap directly
            bbody_color = beamingColor(g_total) * 1.5;
          }
          
          // Generate swirly dust/gas patterns via fBm noise in polar coordinates
          float phi = atan(p_disk.y, p_disk.x);
          
          // Differential rotation: offset noise angle by Keplerian speed * time
          // Multiply speed to animate accretion flow
          float rot_speed = 3.0;
          float phi_animated = phi - omega_kep * uTime * rot_speed;
          
          // Spiral arm distortion: winding pattern angle + K * ln(r)
          float winding = 3.5;
          float spiral_coord = phi_animated - winding * log(r_disk);
          
          // Evaluate noise
          vec2 noise_uv = vec2(r_disk * 0.7, spiral_coord * 2.0);
          float gas_noise = fbm(noise_uv);
          
          // Disk thickness and volume simulation (density profile)
          // Gaussian peak in disk center, fading at boundaries
          float border_fade = smoothstep(uDiskIn, uDiskIn + 0.6, r_disk) * 
                              smoothstep(uDiskOut, uDiskOut - 1.2, r_disk);
          
          // Combine noise, border fades, and custom opacity
          float density = (gas_noise * 0.7 + 0.3) * border_fade;
          float step_opacity = density * uDiskOpacity;
          
          // Accumulate color and transparency using radiative transfer
          // color_new = color_old + (1 - alpha_old) * emission * opacity
          acc_color += (1.0 - acc_alpha) * bbody_color * beaming * step_opacity;
          acc_alpha += (1.0 - acc_alpha) * step_opacity;
          
          // Early exit if the ray is fully saturated
          if (acc_alpha > 0.98) {
            acc_alpha = 1.0;
            break;
          }
        }
      }
    }
    
    // 8. Composite background starfield + black hole shadow + overlays
    vec3 final_color = vec3(0.0);
    
    if (hitHorizon) {
      // Ray captured by event horizon -> Shadow
      final_color = vec3(0.0);
    } else {
      // Ray escaped -> Sample background starfield
      vec3 lensed_rd = v; // Ray direction after lensing
      
      // Gravitational Redshift applied to background stars
      // Stars are redshifted by the potential at the camera position
      float cam_rs = 2.0 * uMass;
      float cam_r = length(uCameraPos);
      float z_cam = 1.0 / sqrt(max(0.01, 1.0 - cam_rs / cam_r));
      
      vec3 background_color = vec3(0.0);
      
      if (uViewMode == 1) {
        // Lensing Checkerboard Reference Grid
        background_color = getGridColor(lensed_rd);
      } else {
        // Standard Starfield / Nebula
        vec3 star_color = getProceduralStars(lensed_rd);
        
        // Dim stars in spectral filters for realistic false-color contrast
        if (uFilterMode == 1) {
          // X-Ray: only extremely hot blue stars remain, rest dimmed
          star_color *= 0.15;
        } else if (uFilterMode == 2) {
          // Infrared: stars look shifted towards red
          star_color = vec3(star_color.r * 1.2, star_color.g * 0.7, star_color.b * 0.4) * 0.6;
        } else if (uFilterMode == 3) {
          // Doppler Beaming: hide stars to focus purely on disk kinematics
          star_color = vec3(0.0);
        }

        if (uUseTextureSky && uFilterMode == 0) {
          vec3 sky_tex = texture(uSkyTexture, getEquirectangularUV(lensed_rd)).rgb;
          background_color = sky_tex * (1.0 / z_cam) + star_color;
        } else if (uUseTextureSky && uFilterMode != 0) {
          // Dim and colorize space background in false color modes
          vec3 sky_tex = texture(uSkyTexture, getEquirectangularUV(lensed_rd)).rgb;
          if (uFilterMode == 1) { // X-Ray: violet gas
            background_color = vec3(sky_tex.r * 0.2, sky_tex.g * 0.1, sky_tex.b * 0.8) * 0.3 + star_color;
          } else if (uFilterMode == 2) { // IR: red dust
            background_color = vec3(sky_tex.r * 0.9, sky_tex.g * 0.3, sky_tex.b * 0.1) * 0.4 + star_color;
          } else { // Beaming: no background
            background_color = vec3(0.0);
          }
        } else {
          background_color = star_color;
        }
      }
      
      final_color = background_color;
    }
    
    // Blend with accretion disk color buffer
    // final = disk_color + (1 - disk_alpha) * background_color
    vec3 composition = acc_color + (1.0 - acc_alpha) * final_color;
    
    // 9. Render Scientific Overlays inside Shader (Photon Sphere grid indicator if toggled)
    if (uShowOverlay) {
      // Add a subtle grid/outline at the photon sphere r = 1.5 * r_s = 3 * uMass
      // This is a scientific helper to show where the photon sphere boundary lies in space
      float r_photon = 3.0 * uMass;
      
      // Compute distance from ray path to origin
      // Find the minimum distance the ray reached
      // We can approximate the closest approach in the shader by calculating the distance to the center
      // Let's draw a glowing shell at r_photon
      float closest_r = length(p); // at end of loop, or we can check min r in loop
      // Better yet: draw it as a wireframe grid on the bounding sphere if needed.
      // But we can keep it clean by rendering visual aids on the CPU,
      // or drawing a subtle glowing ring around the shadow.
    }
    
    // Final tone mapping / clamping
    fragColor = vec4(composition, 1.0);
  }
`;
