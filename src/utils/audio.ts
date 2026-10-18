/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

let mahjongImpactBuffer: AudioBuffer | null = null;
let mouseImpactBuffer: AudioBuffer | null = null;
let lastUiClickMs = -Infinity;

const MAHJONG_PRESS_SAMPLE_URL = new URL("../assets/audio/mahjong-press.wav", import.meta.url).href;
const MAHJONG_RELEASE_SAMPLE_URL = new URL("../assets/audio/mahjong-release.wav", import.meta.url).href;
const MOUSE_PRESS_SAMPLE_URL = new URL("../assets/audio/mouse-press.wav", import.meta.url).href;
const MOUSE_RELEASE_SAMPLE_URL = new URL("../assets/audio/mouse-release.wav", import.meta.url).href;

export const TACTILE_RELEASE_MIN_DELAY_MS = {
  mouse: 72,
  mahjong: 84
} as const;

export function getTactileReleaseMinDelayMs(mode: "mahjong" | "mouse"): number {
  return TACTILE_RELEASE_MIN_DELAY_MS[mode];
}

let mahjongPressBuffer: AudioBuffer | null = null;
let mahjongReleaseBuffer: AudioBuffer | null = null;
let mahjongRawSamplesPromise: Promise<[ArrayBuffer, ArrayBuffer]> | null = null;
let mahjongDecodePromise: Promise<[AudioBuffer, AudioBuffer]> | null = null;
let mousePressBuffer: AudioBuffer | null = null;
let mouseReleaseBuffer: AudioBuffer | null = null;
let mouseRawSamplesPromise: Promise<[ArrayBuffer, ArrayBuffer]> | null = null;
let mouseDecodePromise: Promise<[AudioBuffer, AudioBuffer]> | null = null;
let lastMahjongPointerMs = -Infinity;
let lastMousePointerMs = -Infinity;

function preloadMahjongRawSamples() {
  if (!mahjongRawSamplesPromise && typeof fetch !== "undefined") {
    mahjongRawSamplesPromise = Promise.all([
      fetch(MAHJONG_PRESS_SAMPLE_URL).then((response) => {
        if (!response.ok) throw new Error(`Mahjong press sample HTTP ${response.status}`);
        return response.arrayBuffer();
      }),
      fetch(MAHJONG_RELEASE_SAMPLE_URL).then((response) => {
        if (!response.ok) throw new Error(`Mahjong release sample HTTP ${response.status}`);
        return response.arrayBuffer();
      })
    ]);
  }
  return mahjongRawSamplesPromise;
}

async function ensureMahjongSampleBuffers(ctx: AudioContext): Promise<[AudioBuffer, AudioBuffer]> {
  if (mahjongPressBuffer && mahjongReleaseBuffer) return [mahjongPressBuffer, mahjongReleaseBuffer];
  if (!mahjongDecodePromise) {
    mahjongDecodePromise = (async () => {
      const raw = await preloadMahjongRawSamples();
      if (!raw) throw new Error("Mahjong sample loading unavailable");
      const [pressRaw, releaseRaw] = raw;
      const [press, release] = await Promise.all([
        ctx.decodeAudioData(pressRaw.slice(0)),
        ctx.decodeAudioData(releaseRaw.slice(0))
      ]);
      mahjongPressBuffer = press;
      mahjongReleaseBuffer = release;
      return [press, release] as [AudioBuffer, AudioBuffer];
    })().catch((error) => {
      mahjongDecodePromise = null;
      throw error;
    });
  }
  return mahjongDecodePromise;
}

function preloadMouseRawSamples() {
  if (!mouseRawSamplesPromise && typeof fetch !== "undefined") {
    mouseRawSamplesPromise = Promise.all([
      fetch(MOUSE_PRESS_SAMPLE_URL).then((response) => {
        if (!response.ok) throw new Error(`Mouse press sample HTTP ${response.status}`);
        return response.arrayBuffer();
      }),
      fetch(MOUSE_RELEASE_SAMPLE_URL).then((response) => {
        if (!response.ok) throw new Error(`Mouse release sample HTTP ${response.status}`);
        return response.arrayBuffer();
      })
    ]);
  }
  return mouseRawSamplesPromise;
}

async function ensureMouseSampleBuffers(ctx: AudioContext): Promise<[AudioBuffer, AudioBuffer]> {
  if (mousePressBuffer && mouseReleaseBuffer) return [mousePressBuffer, mouseReleaseBuffer];
  if (!mouseDecodePromise) {
    mouseDecodePromise = (async () => {
      const raw = await preloadMouseRawSamples();
      if (!raw) throw new Error("Mouse sample loading unavailable");
      const [pressRaw, releaseRaw] = raw;
      const [press, release] = await Promise.all([
        ctx.decodeAudioData(pressRaw.slice(0)),
        ctx.decodeAudioData(releaseRaw.slice(0))
      ]);
      mousePressBuffer = press;
      mouseReleaseBuffer = release;
      return [press, release] as [AudioBuffer, AudioBuffer];
    })().catch((error) => {
      mouseDecodePromise = null;
      throw error;
    });
  }
  return mouseDecodePromise;
}

function playDecodedBuffer(ctx: AudioContext, buffer: AudioBuffer, volume: number, gainMul: number) {
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = buffer;
  gain.gain.value = clampAudioGain(volume) * gainMul;
  source.connect(gain);
  gain.connect(ctx.destination);
  source.start();
}

// Fetch the tiny source clips as soon as the module is evaluated so the first real pointer
// interaction usually only needs decodeAudioData, not a network round trip. This does not resume
// the AudioContext and therefore does not violate browser autoplay policy.
if (typeof window !== "undefined") {
  void preloadMahjongRawSamples()?.catch(() => undefined);
  void preloadMouseRawSamples()?.catch(() => undefined);
}

function seededNoiseSample(seedState: { value: number }): number {
  seedState.value = (Math.imul(seedState.value, 1664525) + 1013904223) >>> 0;
  return (seedState.value / 4294967295) * 2 - 1;
}

function makeMechanicalImpactBuffer(ctx: AudioContext, mode: "mahjong" | "mouse"): AudioBuffer {
  const duration = mode === "mahjong" ? 0.135 : 0.075;
  const count = Math.max(1, Math.ceil(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, count, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const seed = { value: mode === "mahjong" ? 0x6d61686a : 0x6d6f7573 };
  let priorNoise = 0;
  let peak = 1e-6;

  for (let i = 0; i < count; i++) {
    const t = i / ctx.sampleRate;
    const rawNoise = seededNoiseSample(seed);
    // First-difference noise concentrates the attack energy at high frequencies, much closer to
    // a hard tile/switch impact than a pitched oscillator sweep.
    const brightNoise = rawNoise - priorNoise * 0.82;
    priorNoise = rawNoise;
    let sample = 0;

    if (mode === "mahjong") {
      const e1 = Math.exp(-t * 43);
      const t2 = t - 0.0145;
      const e2 = t2 > 0 ? Math.exp(-t2 * 58) : 0;
      const ceramic =
        0.34 * Math.sin(2 * Math.PI * 720 * t) +
        0.30 * Math.sin(2 * Math.PI * 1180 * t + 0.34) +
        0.20 * Math.sin(2 * Math.PI * 2110 * t + 0.82) +
        0.11 * Math.sin(2 * Math.PI * 3420 * t + 1.10);
      const secondTile = t2 > 0
        ? 0.28 * Math.sin(2 * Math.PI * 860 * t2) + 0.18 * Math.sin(2 * Math.PI * 2550 * t2 + 0.6)
        : 0;
      sample = ceramic * e1 + secondTile * e2 + brightNoise * (0.16 * Math.exp(-t * 105) + 0.08 * e2);
      // A tiny lower body mode gives the porcelain/bakelite tile its audible mass.
      sample += 0.16 * Math.sin(2 * Math.PI * 390 * t) * Math.exp(-t * 31);
    } else {
      const press = Math.exp(-t * 118);
      const tr = t - 0.031;
      const release = tr > 0 ? Math.exp(-tr * 150) : 0;
      sample =
        (0.35 * Math.sin(2 * Math.PI * 1350 * t) +
          0.20 * Math.sin(2 * Math.PI * 3150 * t + 0.35) +
          0.11 * Math.sin(2 * Math.PI * 610 * t)) * press +
        brightNoise * 0.22 * Math.exp(-t * 190);
      if (tr > 0) {
        sample += (0.18 * Math.sin(2 * Math.PI * 980 * tr) +
          0.10 * Math.sin(2 * Math.PI * 2450 * tr + 0.5) +
          brightNoise * 0.08) * release;
      }
    }
    data[i] = sample;
    peak = Math.max(peak, Math.abs(sample));
  }

  const normalise = (mode === "mahjong" ? 0.88 : 0.82) / peak;
  for (let i = 0; i < data.length; i++) data[i] = Math.tanh(data[i] * normalise * 1.18) * 0.86;
  return buffer;
}

function playMechanicalImpact(mode: "mahjong" | "mouse", volume: number) {
  const ctx = getAudioContext();
  if (mode === "mahjong" && !mahjongImpactBuffer) mahjongImpactBuffer = makeMechanicalImpactBuffer(ctx, mode);
  if (mode === "mouse" && !mouseImpactBuffer) mouseImpactBuffer = makeMechanicalImpactBuffer(ctx, mode);
  const source = ctx.createBufferSource();
  source.buffer = mode === "mahjong" ? mahjongImpactBuffer : mouseImpactBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = mode === "mahjong" ? "highshelf" : "peaking";
  filter.frequency.value = mode === "mahjong" ? 1750 : 2600;
  filter.Q.value = mode === "mahjong" ? 0.7 : 1.1;
  filter.gain.value = mode === "mahjong" ? 2.2 : 1.4;
  const gain = ctx.createGain();
  gain.gain.value = clampAudioGain(volume) * (mode === "mahjong" ? 0.58 : 0.48);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start();
}

function clampAudioGain(volume: number) {
  return Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0.5));
}

/** UI click dispatcher with de-duplication for capture-phase + component click handlers. */
export function playSndClick(volume = 0.5, enabled = true, mode: "mahjong" | "mouse" = "mouse") {
  if (!enabled) return;
  const stamp = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (stamp - lastUiClickMs < 24) return;
  lastUiClickMs = stamp;

  // Real pointer interactions are handled as separate press/release events by App.tsx. Ignore
  // the subsequent click handler invocation; keyboard/preview calls still get a compact pair.
  if (mode === "mahjong") {
    if (stamp - lastMahjongPointerMs < 160) return;
    playSndMahjongPress(volume, true);
    window.setTimeout(() => playSndMahjongRelease(volume, true), TACTILE_RELEASE_MIN_DELAY_MS.mahjong);
    return;
  }
  if (stamp - lastMousePointerMs < 160) return;
  playSndMousePress(volume, true);
  window.setTimeout(() => playSndMouseRelease(volume, true), TACTILE_RELEASE_MIN_DELAY_MS.mouse);
}

/**
 * Recorded mahjong/tile click selected by the user. The supplied source contains two distinct
 * impacts; Round 126 splits them into press and release clips so the UI feels mechanically linked
 * to the pointer gesture rather than playing both sounds after `click`.
 */
export function playSndMahjongPress(volume = 0.5, enabled = true) {
  if (!enabled) return;
  lastMahjongPointerMs = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    const ctx = getAudioContext();
    void ensureMahjongSampleBuffers(ctx)
      .then(([press]) => playDecodedBuffer(ctx, press, volume, 0.72))
      .catch(() => playMechanicalImpact("mahjong", volume));
  } catch (e) {
    console.error("Audio error:", e);
  }
}

export function playSndMahjongRelease(volume = 0.5, enabled = true) {
  if (!enabled) return;
  lastMahjongPointerMs = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    const ctx = getAudioContext();
    void ensureMahjongSampleBuffers(ctx)
      .then(([, release]) => playDecodedBuffer(ctx, release, volume, 0.68))
      .catch(() => playMechanicalImpact("mahjong", volume * 0.88));
  } catch (e) {
    console.error("Audio error:", e);
  }
}

/** Compatibility helper for non-pointer/preview calls: press followed by release. */
export function playSndMahjong(volume = 0.5, enabled = true) {
  if (!enabled) return;
  playSndMahjongPress(volume, true);
  window.setTimeout(() => playSndMahjongRelease(volume, true), TACTILE_RELEASE_MIN_DELAY_MS.mahjong);
}

/**
 * Recorded mouse microswitch selected by the user. Round 127 splits the supplied two-click sample
 * into independent pointer-down / pointer-up assets and level-matches them against mahjong mode.
 * Effective RMS at the configured playback multipliers is ~-20 dBFS for all four tactile clips.
 */
export function playSndMousePress(volume = 0.5, enabled = true) {
  if (!enabled) return;
  lastMousePointerMs = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    const ctx = getAudioContext();
    void ensureMouseSampleBuffers(ctx)
      .then(([press]) => playDecodedBuffer(ctx, press, volume, 0.78))
      .catch(() => playMechanicalImpact("mouse", volume));
  } catch (e) {
    console.error("Audio error:", e);
  }
}

export function playSndMouseRelease(volume = 0.5, enabled = true) {
  if (!enabled) return;
  lastMousePointerMs = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    const ctx = getAudioContext();
    void ensureMouseSampleBuffers(ctx)
      .then(([, release]) => playDecodedBuffer(ctx, release, volume, 0.78))
      .catch(() => playMechanicalImpact("mouse", volume * 0.92));
  } catch (e) {
    console.error("Audio error:", e);
  }
}

/** Compatibility helper for non-pointer/preview calls: recorded press followed by release. */
export function playSndMouseClick(volume = 0.5, enabled = true) {
  if (!enabled) return;
  playSndMousePress(volume, true);
  window.setTimeout(() => playSndMouseRelease(volume, true), TACTILE_RELEASE_MIN_DELAY_MS.mouse);
}

/**
 * Premium Upgrade Sound with Popcorn Cascade
 * Combines a beautiful mechanical rising chime with a fast 1-2-3 satisfying pop-sequence.
 */
export function playSndUpgrade(volume = 0.5, enabled = true) {
  if (!enabled) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Chime notes: C4 -> E4 -> G4 -> C5
    const notes = [261.63, 329.63, 392.00, 523.25];
    notes.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + index * 0.08);

      gain.gain.setValueAtTime(0, now + index * 0.08);
      gain.gain.linearRampToValueAtTime(volume * 0.1, now + index * 0.08 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.08 + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + index * 0.08);
      osc.stop(now + index * 0.08 + 0.3);
    });

    // Layer: Playful Popcorn Cascade (Bubble pops at offset times)
    const popOffsets = [0.05, 0.12, 0.20];
    const popFreqs = [700, 950, 1100];
    popOffsets.forEach((delay, idx) => {
      const oscPop = ctx.createOscillator();
      const gainPop = ctx.createGain();
      oscPop.type = "triangle";
      oscPop.frequency.setValueAtTime(popFreqs[idx] * 0.7, now + delay);
      oscPop.frequency.exponentialRampToValueAtTime(popFreqs[idx] * 1.3, now + delay + 0.03);

      gainPop.gain.setValueAtTime(0, now + delay);
      gainPop.gain.linearRampToValueAtTime(volume * 0.08, now + delay + 0.002);
      gainPop.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.03);

      oscPop.connect(gainPop);
      gainPop.connect(ctx.destination);
      oscPop.start(now + delay);
      oscPop.stop(now + delay + 0.04);
    });
  } catch (e) {
    console.error(e);
  }
}

/**
 * Satisfying Wind Rush / Rapid Intensification Sound
 * A warm, accelerating engine/turbine hum + rising frequency wind whoosh.
 */
export function playSndRapid(volume = 0.5, enabled = true) {
  if (!enabled) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(75, now);
    osc.frequency.exponentialRampToValueAtTime(280, now + 0.8);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(150, now);
    filter.frequency.exponentialRampToValueAtTime(800, now + 0.8);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(volume * 0.14, now + 0.2);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

    // Add a high-pitch whistle layer (wind vortex effect)
    const whistle = ctx.createOscillator();
    const whistleGain = ctx.createGain();
    whistle.type = "sine";
    whistle.frequency.setValueAtTime(600, now);
    whistle.frequency.exponentialRampToValueAtTime(1800, now + 0.8);

    whistleGain.gain.setValueAtTime(0, now);
    whistleGain.gain.linearRampToValueAtTime(volume * 0.03, now + 0.3);
    whistleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    whistle.connect(whistleGain);
    whistleGain.connect(ctx.destination);

    osc.start(now);
    whistle.start(now);
    osc.stop(now + 0.8);
    whistle.stop(now + 0.8);
  } catch (e) {
    console.error(e);
  }
}

/**
 * Deep Satisfying Landfall Rumble
 * Uses a heavy low-frequency triangle shake and low-passed noise burst for a cinematic feel.
 */
export function playSndLand(volume = 0.5, enabled = true) {
  if (!enabled) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const noise = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(100, now);
    osc.frequency.exponentialRampToValueAtTime(35, now + 0.7);

    noise.type = "sawtooth";
    noise.frequency.setValueAtTime(40, now);
    noise.frequency.linearRampToValueAtTime(15, now + 0.7);

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.setValueAtTime(75, now);

    gain.gain.setValueAtTime(volume * 0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

    osc.connect(lowpass);
    noise.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    noise.start(now);
    osc.stop(now + 0.7);
    noise.stop(now + 0.7);
  } catch (e) {
    console.error(e);
  }
}

/**
 * Eye Wall Replacement Cycle (EWRC) Atmospheric Ring
 * Resonance sweeps of two phase-locked sine waves creating a beautiful acoustic ring.
 */
export function playSndEWRC(volume = 0.5, enabled = true) {
  if (!enabled) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = "sine";
    osc1.frequency.setValueAtTime(280, now);
    osc1.frequency.linearRampToValueAtTime(360, now + 0.3);
    osc1.frequency.linearRampToValueAtTime(280, now + 0.6);

    osc2.type = "sine";
    osc2.frequency.setValueAtTime(140, now);
    osc2.frequency.linearRampToValueAtTime(180, now + 0.3);
    osc2.frequency.linearRampToValueAtTime(140, now + 0.6);

    gain.gain.setValueAtTime(volume * 0.12, now);
    gain.gain.linearRampToValueAtTime(volume * 0.18, now + 0.3);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.6);
    osc2.stop(now + 0.6);
  } catch (e) {
    console.error(e);
  }
}

/**
 * Extratropical Transition (ET) Liquid Wave Sound
 * A smooth, descending organic wave representing the structural change.
 */
export function playSndET(volume = 0.5, enabled = true) {
  if (!enabled) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.linearRampToValueAtTime(90, now + 0.6);

    gain.gain.setValueAtTime(volume * 0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.6);
  } catch (e) {
    console.error(e);
  }
}

/**
 * Dissipate / Dissolution Whisper
 * A fading, soothing sigh of wind with a gentle soft bubble burst.
 */
export function playSndDissipate(volume = 0.5, enabled = true) {
  if (!enabled) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    
    // Smooth white-noise simulation sigh
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.9);

    gain.gain.setValueAtTime(volume * 0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.9);

    // Layer: Tiny fading bubble burst
    const oscPop = ctx.createOscillator();
    const gainPop = ctx.createGain();
    oscPop.type = "sine";
    oscPop.frequency.setValueAtTime(600, now + 0.15);
    oscPop.frequency.exponentialRampToValueAtTime(300, now + 0.22);
    
    gainPop.gain.setValueAtTime(0, now + 0.15);
    gainPop.gain.linearRampToValueAtTime(volume * 0.05, now + 0.15 + 0.005);
    gainPop.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    oscPop.connect(gainPop);
    gainPop.connect(ctx.destination);
    oscPop.start(now + 0.15);
    oscPop.stop(now + 0.22);
  } catch (e) {
    console.error(e);
  }
}

/**
 * Satisfying Mechanical Bezel Slider Tick
 * Perfect click for adjusting range sliders, feels high-end and tactile.
 */
export function playSndSliderTick(volume = 0.5, enabled = true) {
  if (!enabled) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(2200, now);
    osc.frequency.exponentialRampToValueAtTime(950, now + 0.012);

    gainNode.gain.setValueAtTime(volume * 0.025, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.012);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.012);
  } catch (e) {
    // Fail silently to avoid interrupting slider interactions
  }
}

/**
 * Typhoon Spawn / Birth Sound
 * Warm wind blow combined with a soft ambient bell.
 */
export function playSndSpawn(volume = 0.5, enabled = true) {
  if (!enabled) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    
    // Layer 1: Warm wind puff
    const oscWind = ctx.createOscillator();
    const gainWind = ctx.createGain();
    oscWind.type = "triangle";
    oscWind.frequency.setValueAtTime(80, now);
    oscWind.frequency.linearRampToValueAtTime(160, now + 0.4);
    oscWind.frequency.linearRampToValueAtTime(60, now + 0.8);
    
    gainWind.gain.setValueAtTime(volume * 0.15, now);
    gainWind.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    
    // Layer 2: Satisfying ambient bell
    const oscBell = ctx.createOscillator();
    const gainBell = ctx.createGain();
    oscBell.type = "sine";
    oscBell.frequency.setValueAtTime(523.25, now); // C5
    oscBell.frequency.exponentialRampToValueAtTime(783.99, now + 0.55); // G5
    
    gainBell.gain.setValueAtTime(volume * 0.1, now);
    gainBell.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    
    oscWind.connect(gainWind);
    gainWind.connect(ctx.destination);
    
    oscBell.connect(gainBell);
    gainBell.connect(ctx.destination);
    
    oscWind.start(now);
    oscBell.start(now);
    
    oscWind.stop(now + 0.8);
    oscBell.stop(now + 0.8);
  } catch (e) {
    console.error(e);
  }
}
