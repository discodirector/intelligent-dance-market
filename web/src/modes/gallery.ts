import { initialState, type SequencerState } from "@swarm-sequencer/synth";

function setBit(pattern: bigint, track: number, step: number): bigint {
  return pattern | (1n << BigInt(track * 16 + step));
}

/**
 * One busy page shared by every era preview. `patternId` stays 0 so the era
 * comes from the player override, not from `floor(patternId / 4)`.
 */
export function galleryState(): SequencerState {
  let pattern = 0n;
  for (const step of [0, 8, 10]) pattern = setBit(pattern, 0, step);
  for (const step of [4, 12]) pattern = setBit(pattern, 1, step);
  for (const step of [2, 6, 10, 14]) pattern = setBit(pattern, 2, step);
  for (const step of [3, 11, 15]) pattern = setBit(pattern, 3, step);
  const degrees = [1, 0, 3, 5, 0, 7, 8, 0, 1, 5, 0, 8, 3, 0, 7, 1];
  let bass = 0n;
  degrees.forEach((degree, step) => {
    bass |= BigInt(degree & 15) << BigInt(step * 4);
  });
  return { ...initialState(), pattern, bass, bpm: 96, patternId: 0 };
}
