// Audio tap for a headless harness (bot/src/radio): the player's master output as interleaved s16le, posted every 4800
// frames (100 ms at 48 kHz; the rate is the device's), the same tap as the YouTube stream page (stream.ts).
import type { Audio } from "./audio";

const TAP = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.n = 0; this.buf = new Int16Array(4800 * 2); }
  process(inputs) {
    const ch = inputs[0];
    const L = ch && ch[0], R = (ch && ch[1]) || L;
    const frames = L ? L.length : 128;
    for (let i = 0; i < frames; i++) {
      const l = L ? L[i] : 0, r = R ? R[i] : 0;
      this.buf[this.n * 2] = Math.max(-32768, Math.min(32767, Math.round(l * 32767)));
      this.buf[this.n * 2 + 1] = Math.max(-32768, Math.min(32767, Math.round(r * 32767)));
      if (++this.n === 4800) { this.port.postMessage(this.buf.buffer, [this.buf.buffer]); this.buf = new Int16Array(4800 * 2); this.n = 0; }
    }
    return true;
  }
}
registerProcessor("idm-listen-tap", Tap);`;

function toB64(buf: ArrayBuffer) {
  const u8 = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Taps a started Audio: every chunk goes to `onChunk` as base64 PCM. Returns the context's sample rate. */
export async function startTap(audio: Audio, onChunk: (b64: string) => void): Promise<number> {
  const ctx = audio.ctx!;
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([TAP], { type: "application/javascript" })));
  const tap = new AudioWorkletNode(ctx, "idm-listen-tap", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: "explicit" });
  // audio.ts shadows ctx.destination with its master gain; the tap (silent output) must reach the real destination
  // to be pulled, never the master (that would feed back).
  const realDest = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, "destination")!.get!.call(ctx) as AudioDestinationNode;
  audio.analyser!.connect(tap);
  tap.connect(realDest);
  tap.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onChunk(toB64(e.data));
  return ctx.sampleRate;
}
