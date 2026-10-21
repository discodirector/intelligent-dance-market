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

export { createLivePlayer, projectTimeline, renderReleaseToBuffer, renderTimelineToBuffer, renderToBuffer } from "./player.ts";
export type { EraView, LivePlayer, LivePlayerOptions, RenderOptions, StepListenerEvent } from "./player.ts";

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
export type { Era, EraScheduleEntry, GenreId } from "./eras.ts";

export { allStyles, GENRE_STYLES, STYLE_SCHEDULE, styleById, styleFeel, styleListAt, styleOf, stylesAt } from "./styles.ts";
export type { GenreStyle, StyleChoice, StyleList, StyleScheduleEntry, StyleSource } from "./styles.ts";

export { HOUSE_PROGRAM } from "./program.ts";
export { assertPack, programFromPack, validatePack } from "./pack.ts";
export type { PackBases, PackLeadPatch, StationPack, StationStyle } from "./pack.ts";
export { BUS_NAMES, DATA_FIELDS, DATA_GENRES } from "./styledata.ts";
export { SOUND_DEFAULTS } from "./engine.ts";
export type {
  AcidData,
  BusName,
  DataGenre,
  DrumLayer,
  DrumVoice,
  FxData,
  GarageData,
  GenreDataMap,
  HatSpec,
  LiquidData,
  LofiHouseData,
  PadSpec,
  SoundData,
  StyleData,
  SubSpec,
  TripHopData,
} from "./styledata.ts";
export type { Program } from "./program.ts";
export { SYNTH_VERSION } from "./version.ts";

export { audioBufferToWavBase64 } from "./wav.ts";

export { counterBars, planRelease, RELEASE_DEFAULTS, RELEASE_HEAT_MAX, RELEASE_SAT_BITS, releaseBodyForm, releaseGenre, releasePace, releaseTempo } from "./release.ts";
export type { ReleaseGenre, ReleaseInput, ReleaseOptions, ReleasePace, ReleasePlan, ReleaseSection, ReleaseSwap } from "./release.ts";
