/**
 * audio.js
 * Spacetime Sonification Synthesizer using Web Audio API.
 * Modulates carrier frequencies based on camera distance (gravitational potential & redshift).
 */

export class BlackHoleAudio {
  constructor() {
    this.ctx = null;
    this.initialized = false;
    this.muted = true;
    
    // Nodes
    this.humOsc1 = null;
    this.humOsc2 = null;
    this.diskOsc = null;
    this.diskFilter = null;
    this.masterGain = null;
    this.diskGain = null;
    this.humGain = null;
    
    // Modulation values
    this.baseHumFreq = 55.0; // A1 note - deep bass
    this.baseDiskFreq = 150.0;
  }

  /**
   * Initializes the AudioContext and connects the synth nodes.
   * MUST be triggered by a user gesture.
   */
  init() {
    if (this.initialized) return;

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContextClass();
      
      // 1. Master Gain Node
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.0, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      // 2. Hum (Spacetime Potential) - Saw & Triangle oscillators for rich low rumble
      this.humOsc1 = this.ctx.createOscillator();
      this.humOsc1.type = 'sawtooth';
      this.humOsc1.frequency.setValueAtTime(this.baseHumFreq, this.ctx.currentTime);

      this.humOsc2 = this.ctx.createOscillator();
      this.humOsc2.type = 'triangle';
      this.humOsc2.frequency.setValueAtTime(this.baseHumFreq * 1.5, this.ctx.currentTime);

      // Lowpass filter for the hum to remove harsh high harmonics
      const humFilter = this.ctx.createBiquadFilter();
      humFilter.type = 'lowpass';
      humFilter.frequency.setValueAtTime(100.0, this.ctx.currentTime); // Cutoff 100Hz
      humFilter.Q.setValueAtTime(1.0, this.ctx.currentTime);

      this.humGain = this.ctx.createGain();
      this.humGain.gain.setValueAtTime(0.4, this.ctx.currentTime);

      this.humOsc1.connect(humFilter);
      this.humOsc2.connect(humFilter);
      humFilter.connect(this.humGain);
      this.humGain.connect(this.masterGain);

      // 3. Disk Whistle (Swirling Gas) - Sine wave with Bandpass filter to sound like wind
      this.diskOsc = this.ctx.createOscillator();
      this.diskOsc.type = 'sine';
      this.diskOsc.frequency.setValueAtTime(this.baseDiskFreq, this.ctx.currentTime);

      this.diskFilter = this.ctx.createBiquadFilter();
      this.diskFilter.type = 'bandpass';
      this.diskFilter.frequency.setValueAtTime(220.0, this.ctx.currentTime);
      this.diskFilter.Q.setValueAtTime(4.0, this.ctx.currentTime); // narrow band

      // Low frequency oscillator (LFO) to modulate disk volume (swirling waves)
      const lfo = this.ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(0.3, this.ctx.currentTime); // 0.3 Hz

      const lfoGain = this.ctx.createGain();
      lfoGain.gain.setValueAtTime(0.15, this.ctx.currentTime);
      
      this.diskGain = this.ctx.createGain();
      this.diskGain.gain.setValueAtTime(0.0, this.ctx.currentTime);

      lfo.connect(lfoGain);
      lfoGain.connect(this.diskGain.gain); // modulate disk volume

      this.diskOsc.connect(this.diskFilter);
      this.diskFilter.connect(this.diskGain);
      this.diskGain.connect(this.masterGain);

      // Start oscillators
      this.humOsc1.start();
      this.humOsc2.start();
      this.diskOsc.start();
      lfo.start();

      this.initialized = true;
      this.muted = false;
      
      // Fade in master volume
      this.masterGain.gain.linearRampToValueAtTime(0.6, this.ctx.currentTime + 1.0);
    } catch (e) {
      console.warn("Failed to initialize Web Audio API:", e);
    }
  }

  /**
   * Updates audio frequencies and volumes based on camera distance to the black hole
   * @param {number} r - Distance of the camera to the singularity
   * @param {number} rs - Schwarzschild radius of the black hole
   */
  update(r, rs) {
    if (!this.initialized || this.muted || !this.ctx) return;

    // Relativistic gravitational redshift factor at camera distance
    // z = sqrt(1 - rs / r)
    // As r -> rs, z -> 0 (frequencies drop to zero / infrasonic)
    const z = Math.sqrt(Math.max(0.005, 1.0 - rs / r));

    // Modulate hum frequencies
    const targetFreq1 = this.baseHumFreq * z;
    const targetFreq2 = this.baseHumFreq * 1.5 * z;

    // Modulate disk wind center frequency based on Keplerian speed at camera distance
    // v_kep proportional to 1 / sqrt(r)
    const speedFactor = 10.0 / Math.sqrt(Math.max(3.0, r));
    const targetDiskFreq = this.baseDiskFreq * speedFactor * z;

    const time = this.ctx.currentTime;
    
    // Smooth transitions to prevent audio pops/clicks
    this.humOsc1.frequency.setTargetAtTime(targetFreq1, time, 0.15);
    this.humOsc2.frequency.setTargetAtTime(targetFreq2, time, 0.15);
    this.diskOsc.frequency.setTargetAtTime(targetDiskFreq, time, 0.2);

    // Filter frequency tracking
    this.diskFilter.frequency.setTargetAtTime(targetDiskFreq * 1.2, time, 0.2);

    // Hum volume grows as camera gets closer to the gravity well (inverse relation)
    // Near horizon, master sound swells, but disk wind cuts out inside photon sphere
    const gravityFactor = Math.min(1.0, 15.0 / r);
    const diskProximityFactor = Math.max(0.0, 1.0 - Math.abs(r - 10.0) / 12.0); // loudest near disk plane/orbits

    this.humGain.gain.setTargetAtTime(0.3 + 0.5 * gravityFactor, time, 0.2);
    
    // If inside photon sphere (r <= 1.5 * rs = 3.0), the disk sounds dissolve
    const inPhotonSphere = r <= 1.5 * rs;
    const targetDiskVolume = inPhotonSphere ? 0.0 : (0.1 + 0.3 * diskProximityFactor);
    this.diskGain.gain.setTargetAtTime(targetDiskVolume, time, 0.25);
  }

  /**
   * Toggles mute/unmute state
   */
  toggle() {
    if (!this.initialized) {
      this.init();
      return !this.muted;
    }

    const time = this.ctx.currentTime;
    if (this.muted) {
      // Resume audio context if suspended
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      this.masterGain.gain.linearRampToValueAtTime(0.6, time + 0.5);
      this.muted = false;
    } else {
      this.masterGain.gain.linearRampToValueAtTime(0.0, time + 0.3);
      // Suspend after fade out
      setTimeout(() => {
        if (this.muted && this.ctx) this.ctx.suspend();
      }, 300);
      this.muted = true;
    }

    return !this.muted;
  }

  /**
   * Plays a futuristic probe launch tone (laser-chirp sweep).
   */
  playLaunchTone() {
    if (!this.initialized || this.muted || !this.ctx) return;
    const time = this.ctx.currentTime;
    
    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(330, time);
    // Sweep frequency up rapidly
    osc.frequency.exponentialRampToValueAtTime(1200, time + 0.4);
    
    gainNode.gain.setValueAtTime(0.0, time);
    gainNode.gain.linearRampToValueAtTime(0.35, time + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.4);
    
    osc.connect(gainNode);
    gainNode.connect(this.masterGain);
    
    osc.start(time);
    osc.stop(time + 0.45);
  }

  /**
   * Plays a rising sweep tension and white-noise GRB explosion burst.
   */
  playExplosionTone() {
    if (!this.initialized || this.muted || !this.ctx) return;
    const time = this.ctx.currentTime;
    
    // 1. Tension Sweep (Oscillator)
    const sweepOsc = this.ctx.createOscillator();
    const sweepGain = this.ctx.createGain();
    
    sweepOsc.type = 'sawtooth';
    sweepOsc.frequency.setValueAtTime(80, time);
    sweepOsc.frequency.exponentialRampToValueAtTime(1800, time + 2.5); // Rise to high pitch over 2.5s
    
    sweepGain.gain.setValueAtTime(0.0, time);
    sweepGain.gain.linearRampToValueAtTime(0.4, time + 0.5);
    sweepGain.gain.exponentialRampToValueAtTime(0.001, time + 2.5);
    
    sweepOsc.connect(sweepGain);
    sweepGain.connect(this.masterGain);
    
    sweepOsc.start(time);
    sweepOsc.stop(time + 2.5);

    // 2. White Noise Burst (Explosion) at t = 2.5s
    // Create noise buffer
    const bufferSize = this.ctx.sampleRate * 2.0; // 2 seconds
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2.0 - 1.0;
    }
    
    const noiseNode = this.ctx.createBufferSource();
    noiseNode.buffer = noiseBuffer;
    
    // Filter noise to sound like a deep boom
    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(400, time + 2.5);
    noiseFilter.frequency.exponentialRampToValueAtTime(40, time + 4.5);
    
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0, time);
    // Trigger explosion at 2.5 seconds
    noiseGain.gain.setValueAtTime(0.0, time + 2.5);
    noiseGain.gain.linearRampToValueAtTime(0.7, time + 2.55);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 4.5);
    
    noiseNode.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    
    noiseNode.start(time + 2.5);
    noiseNode.stop(time + 4.6);
  }
}

