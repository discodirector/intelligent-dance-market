// Audio: the synth's live player routed through our master gain + analyser.
// createLivePlayer connects to ctx.destination, so we shadow `destination` on this AudioContext instance
// with our master gain (no synth change needed).
import { createLivePlayer, type LivePlayer, type Program, type SequencerState } from "@swarm-sequencer/synth";

export class Audio {
  ctx: AudioContext | null = null;
  player: LivePlayer | null = null;
  analyser: AnalyserNode | null = null;
  private master: GainNode | null = null;
  private volume = 0.75;
  timeData = new Uint8Array(2048);
  freqData = new Uint8Array(1024);

  /** `program`: what the live player plays (synth program.ts). Default house; a station page passes its own. */
  constructor(private readonly program?: Program) {}

  get running() {
    return !!this.player?.running;
  }

  /**
   * Call synchronously inside the tap/click handler, before any await. WebKit (every iOS browser) only lets a context
   * start inside the user gesture itself: created or resumed after an await, it stays suspended and plays nothing.
   * Also asks iOS for the "playback" audio session, so the ring/silent switch does not mute the page.
   */
  unlock() {
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session) {
      try {
        session.type = "playback";
      } catch {
        // older WebKit: no audio session control
      }
    }
    const ctx = this.ensureContext();
    void ctx.resume();
    // A one-sample silent buffer started in the gesture: older iOS needs a source to start before it unlocks output.
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.start(0);
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor({ latencyHint: "interactive" });
      const master = ctx.createGain();
      master.gain.value = this.volume;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.72;
      master.connect(analyser);
      analyser.connect(ctx.destination);
      Object.defineProperty(ctx, "destination", { value: master, configurable: true });
      this.ctx = ctx;
      this.master = master;
      this.analyser = analyser;
      this.timeData = new Uint8Array(analyser.fftSize);
      this.freqData = new Uint8Array(analyser.frequencyBinCount);
      this.player = createLivePlayer(ctx, { program: this.program });
    }
    return this.ctx;
  }

  async start(state: SequencerState, clock: number | null) {
    await this.ensureContext().resume();
    this.player!.setState(state);
    this.player!.setClock(clock);
    if (!this.player!.running) this.player!.start();
  }

  stop() {
    this.player?.stop();
    void this.ctx?.suspend();
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.volume * this.volume * 1.1, this.ctx.currentTime, 0.03);
  }
  getVolume() {
    return this.volume;
  }

  /** Fills timeData/freqData; returns RMS of the time-domain signal (0..1). */
  sample(): number {
    if (!this.analyser || !this.running) return 0;
    this.analyser.getByteTimeDomainData(this.timeData);
    this.analyser.getByteFrequencyData(this.freqData);
    let sum = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      const v = (this.timeData[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / this.timeData.length);
  }
}
