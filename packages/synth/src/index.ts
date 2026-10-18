export {
  bassAt,
  bassLabel,
  bassMidi,
  decode,
  encode,
  HEAT_SHIFT,
  hexSlot,
  infoLine,
  initialState,
  isOn,
  midiToFreq,
  MODE_NAMES,
  NOTE_NAMES,
  SCALES,
  STEPS,
  TRACK_NO_SHIFT,
  TRACKS,
} from "./state.ts";
export type { DecodeOptions, SequencerState, Slots, State } from "./state.ts";

export { advanceIdle, eraAt, freshIdleMemory, genreStep, nowAt, planSteps, stateAt, stepCharacter, stepDuration, viewAt } from "./clock.ts";
export type { DropCue, IdleMemory, StepHit, TimelinePoint, TrackDropCue, TransportView } from "./clock.ts";

export { arrange, euclid, FORM_BARS, sectionAt } from "./arrange.ts";
export { LEAD_PATCHES, leadPatch } from "./leads.ts";
export type { LeadPatch } from "./leads.ts";
export type { Arrangement, MotifNote, Section, SectionName } from "./arrange.ts";

export { heatIdleFactor, IDLE_DRONE_SEC, IDLE_FULL_SEC, IDLE_SPARSE_SEC, idleLabel, idleStage } from "./idle.ts";
export type { IdleGains, IdleName, IdleStage } from "./idle.ts";

export { createLivePlayer, projectTimeline, renderTimelineToBuffer, renderToBuffer } from "./player.ts";
export type { EraView, LivePlayer, RenderOptions, StepListenerEvent } from "./player.ts";

export {
  CHAIN_BPM,
  ERA_CROSSFADE_BARS,
  ERAS,
  ERA_SCHEDULE,
  genreKey,
  genreTempo,
  crossfadeSeconds,
  epochOf,
  eraById,
  eraByIndex,
  eraOf,
} from "./eras.ts";
export type { Era, GenreId } from "./eras.ts";

export { GENRE_STYLES, styleById, styleFeel, styleOf } from "./styles.ts";
export type { GenreStyle, StyleChoice } from "./styles.ts";

export { audioBufferToWavBase64 } from "./wav.ts";
