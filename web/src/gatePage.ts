// web/gate.html: the style pack gate as a built page (web/dist, the bot image). The pipeline (bot/src/stations/gate.ts)
// opens it in Chromium and calls window.__gatePack(pack) with a pack parsed as data; the tape windows are baked in.
import gateWindows from "../scripts/station-gate-windows.json";
import { gatePack } from "./gate";

declare global {
  interface Window {
    __gatePack?: (pack: unknown) => ReturnType<typeof gatePack>;
    __gateReady?: boolean;
  }
}

window.__gatePack = (pack: unknown) => gatePack(pack, (gateWindows as { windows: Parameters<typeof gatePack>[1] }).windows);
window.__gateReady = true;
