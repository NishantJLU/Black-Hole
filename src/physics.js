/**
 * physics.js
 * Physics formulas for a Schwarzschild and Kerr Black Hole.
 * Standard units where G = c = 1.
 */

// Speed of light in m/s (for physical scaling displays)
export const C_METRIC = 299792458; 

/**
 * Calculates the Schwarzschild radius (r_s = 2GM/c^2)
 * In normalized units where G = c = 1, r_s = 2 * M
 * @param {number} mass - Normalized mass of the black hole
 */
export function getSchwarzschildRadius(mass) {
  return 2.0 * mass;
}

/**
 * Calculates the Kerr outer event horizon radius
 * r_+ = M + sqrt(M^2 - a^2)
 * @param {number} mass - Normalized mass of the black hole
 * @param {number} spin - Dimensionless spin parameter (a in [0, 0.999])
 */
export function getEventHorizonRadius(mass, spin) {
  // spin is a_dimensionless = J / (M^2) in [-1, 1]
  // Physical spin parameter: a = spin_dimensionless * M
  const a = spin * mass;
  const discriminant = mass * mass - a * a;
  if (discriminant < 0) {
    return mass; // Singularity is naked, return mass as limit
  }
  return mass + Math.sqrt(discriminant);
}

/**
 * Calculates the photon sphere radius
 * For Schwarzschild: r = 3 * M = 1.5 * r_s
 * For Kerr, the photon orbits are asymmetric (prograde vs retrograde).
 * We return the average or the Schwarzschild equivalent for simple display,
 * and display the boundary values if requested.
 * @param {number} mass
 * @param {number} spin
 */
export function getPhotonSphereRadius(mass, spin) {
  if (spin === 0) {
    return 3.0 * mass;
  }
  // For Kerr, prograde photon orbit in the equatorial plane is:
  // r_ph_pro = 2 * M * (1 + cos(2/3 * acos(-a)))
  // retrograde photon orbit:
  // r_ph_ret = 2 * M * (1 + cos(2/3 * acos(a)))
  // We return the average of the two for a general representation
  const a = spin;
  const thetaPro = Math.acos(-a) * (2.0 / 3.0);
  const thetaRet = Math.acos(a) * (2.0 / 3.0);
  const rPro = 2.0 * mass * (1.0 + Math.cos(thetaPro));
  const rRet = 2.0 * mass * (1.0 + Math.cos(thetaRet));
  return {
    average: (rPro + rRet) * 0.5,
    prograde: rPro,
    retrograde: rRet
  };
}

/**
 * Calculates the Innermost Stable Circular Orbit (ISCO)
 * For Schwarzschild: r = 6 * M = 3 * r_s
 * For Kerr, it decreases to 1 * M (prograde) and increases to 9 * M (retrograde).
 */
export function getISCO(mass, spin) {
  if (spin === 0) {
    return 6.0 * mass;
  }
  const a = spin;
  const sign = Math.sign(a) || 1;
  const absA = Math.abs(a);
  
  const z1 = 1.0 + Math.pow(1.0 - absA * absA, 1.0 / 3.0) * (Math.pow(1.0 + absA, 1.0 / 3.0) + Math.pow(1.0 - absA, 1.0 / 3.0));
  const z2 = Math.sqrt(3.0 * absA * absA + z1 * z1);
  const rISCO = mass * (3.0 + z2 - sign * Math.sqrt((3.0 - z1) * (3.0 + z1 + 2.0 * z2)));
  return rISCO;
}

/**
 * Calculates the gravitational time dilation factor (d_tau / d_t)
 * representing the rate of proper time tau relative to coordinate time t.
 * Go to 0 at the event horizon.
 */
export function getTimeDilationFactor(mass, spin, r) {
  const rh = getEventHorizonRadius(mass, spin);
  if (r <= rh) return 0.0;
  
  if (spin === 0) {
    // Schwarzschild time dilation: sqrt(1 - r_s / r)
    const rs = getSchwarzschildRadius(mass);
    return Math.sqrt(1.0 - rs / r);
  } else {
    // Kerr time dilation on the equatorial plane (z = 0):
    // d_tau/d_t = sqrt(delta * sigma / ( (r^2 + a^2)^2 - delta * a^2 ))
    const a = spin * mass;
    const delta = r * r - 2.0 * mass * r + a * a;
    const sigma = r * r; // z = 0
    const numerator = delta * sigma;
    const denominator = Math.pow(r * r + a * a, 2) - delta * a * a;
    if (denominator <= 0 || numerator < 0) return 0.0;
    return Math.sqrt(numerator / denominator);
  }
}

/**
 * Calculates the escape velocity at a given radius r
 * v_esc = sqrt(2GM/r) = sqrt(r_s / r) in units where c = 1.
 */
export function getEscapeVelocity(mass, spin, r) {
  const rh = getEventHorizonRadius(mass, spin);
  if (r <= rh) return 1.0; // Speed of light
  const rs = getSchwarzschildRadius(mass);
  const v = Math.sqrt(rs / r);
  return Math.min(v, 1.0);
}

/**
 * Estimates the Novikov-Thorne temperature profile of the accretion disk
 * T(r) is proportional to r^(-3/4) * (1 - sqrt(r_in / r))^(1/4)
 * Returns the temperature in Kelvin.
 */
export function getAccretionDiskTemperature(mass, spin, r, baseTemp = 6000) {
  const r_in = getISCO(mass, spin);
  if (r <= r_in) return 0.0;
  
  // Normalized radial coordinate x = r / r_in
  const x = r / r_in;
  // Novikov-Thorne-like radial temperature factor
  // Peak occurs at roughly 1.3 * r_in
  const factor = Math.pow(1.0 / x, 0.75) * Math.pow(1.0 - Math.sqrt(1.0 / x), 0.25);
  
  // Normalize the factor so that the peak is roughly equal to baseTemp
  // Peak of x^(-0.75)*(1 - x^(-0.5))^(0.25) occurs at x = 49/36 = 1.361
  const peakX = 49.0 / 36.0;
  const peakVal = Math.pow(1.0 / peakX, 0.75) * Math.pow(1.0 - Math.sqrt(1.0 / peakX), 0.25);
  
  return (factor / peakVal) * baseTemp;
}

/**
 * Calculates the outer boundary of the Kerr ergosphere at a given polar angle theta
 * r_e = M + sqrt(M^2 - a^2 * cos^2(theta))
 */
export function getErgosphereRadius(mass, spin, theta) {
  const a = spin * mass;
  const cosT = Math.cos(theta);
  const discriminant = mass * mass - a * a * cosT * cosT;
  if (discriminant < 0) return mass;
  return mass + Math.sqrt(discriminant);
}

/**
 * Calculates the Paczynski-Wiita pseudo-Newtonian acceleration vector for a particle
 * a = -M / (r - r_s)^2 * (pos / r)
 * This potential models the ISCO at r = 6M = 3r_s and horizon capture at r = r_s
 */
export function getPaczynskiWiitaAcceleration(mass, pos, accArray = [0, 0, 0]) {
  const r2 = pos[0] * pos[0] + pos[1] * pos[1] + pos[2] * pos[2];
  const r = Math.sqrt(r2);
  const rs = 2.0 * mass;
  
  if (r <= rs + 0.05) {
    accArray[0] = 0.0;
    accArray[1] = 0.0;
    accArray[2] = 0.0;
    return accArray;
  }
  
  // Acceleration magnitude
  const denom = r - rs;
  const mag = -mass / (denom * denom * r);
  
  accArray[0] = pos[0] * mag;
  accArray[1] = pos[1] * mag;
  accArray[2] = pos[2] * mag;
  
  return accArray;
}

/**
 * Calculates the tidal stretching force (differential gravity) on a human body
 * (Mass m = 80kg, Length L = 1.8m) in Newtons and Earth g-forces.
 * F_stretch = 2 * G * M_phys * m * L / r_phys^3
 */
export function getTidalForce(mass, spin, r, physicalScale = 'stellar') {
  const G = 6.6743e-11;
  const SOLAR_MASS = 1.989e30;
  
  // 1. Convert normalized coordinate mass M and radius r to physical values
  let totalSolarMasses = mass * 10.0; // Stellar (10 Solar Masses)
  if (physicalScale === 'supermassive') {
    totalSolarMasses = mass * 4.3e6; // Sgr A* (4.3 Million Solar Masses)
  }
  
  const M_phys = totalSolarMasses * SOLAR_MASS;
  
  // r_s physical scale in meters (R_s ≈ 2953m per solar mass)
  const rScaleMeters = 2953.0 * totalSolarMasses;
  
  // Physical distance in meters (since coordinate r_s is 2.0)
  const r_phys = Math.max(0.1, r) * (rScaleMeters / 2.0);
  
  // 2. Compute tidal stretching force
  const m = 80.0; // human mass in kg
  const L = 1.8;  // human height in meters
  
  // Tension force in Newtons
  const F_stretch = (2.0 * G * M_phys * m * L) / (r_phys * r_phys * r_phys);
  
  // Earth g-forces (stretching is relative to standard gravity on 80kg)
  const g_forces = F_stretch / (m * 9.80665);
  
  return {
    newtons: F_stretch,
    gForces: g_forces
  };
}

/**
 * Calculates the Hawking Temperature of the black hole in Kelvin
 * T_H = hbar * c^3 / (8 * pi * G * M * kB) ≈ 6.169e-8 / M_solar Kelvin
 */
export function getHawkingTemperature(mass, physicalScale = 'stellar') {
  let totalSolarMasses = mass * 10.0;
  if (physicalScale === 'supermassive') {
    totalSolarMasses = mass * 4.3e6;
  }
  
  return 6.169e-8 / totalSolarMasses;
}

/**
 * Calculates Hawking evaporation mass decay: dM/dt = -C_evap / M^2
 * @param {number} mass - Current normalized mass
 * @param {number} dt - Time step
 * @param {number} scale - Evaporation speed scaling constant
 */
export function getHawkingMassDecay(mass, dt, scale = 0.05) {
  // Prevent division by zero or negative mass
  if (mass <= 0.05) return 0.0;
  return (scale / (mass * mass)) * dt;
}


