// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Canonical SPEC.md §3 codec and deterministic transition, shared by hook and vector generator.
library SequencerState {
    uint256 internal constant EMA_CAP = 900;
    uint16 internal constant BPM_MIN = 72;
    uint16 internal constant BPM_MAX = 118;
    uint32 internal constant PAGE = 64;
    /// @dev Euclidean base masks for k = 3..8 (bit i set iff (i * k) % 16 < k), 16 bits each, k = 3 lowest.
    uint256 internal constant EUCLID = 0x5555_54a9_4949_2491_1111_0841;

    struct State {
        uint64 pattern;
        uint64 bass;
        uint32 swapCount;
        uint40 lastTs;
        uint16 bpm;
        uint8 root;
        uint8 mode;
        uint32 patternId;
        int24 lastTick;
        int32 pressure;
        uint32 intervalEma;
        uint32 releaseCount;
        uint16 sizeLogEma;
        uint8 heat;
        uint16 trackNo;
    }

    struct Input {
        bool isBuy;
        uint128 imdAmt;
        int24 tick;
        uint64 blockNumber;
        uint40 timestamp;
    }

    struct Thresholds {
        uint128 hat;
        uint128 glitch;
        uint128 snare;
        uint128 kick;
    }

    struct Mutation {
        uint8 track;
        uint8 step;
        uint8 bassNote;
        bool whale;
        uint32 movementPatternId;
        /// @dev Whale only: resulting 16-bit mask of the dropped/filled track (Drop event).
        uint16 dropMask;
        uint8 movementRoot;
        uint8 fromTrack;
        uint8 writeStep;
        bool promoted;
        bool noop;
        bool completed;
        uint256 snapshot0;
        uint256 snapshot1;
    }

    function initial() internal pure returns (State memory s) {
        s.pattern = 0x10100101;
        s.bpm = 96;
        s.root = 9;
        s.intervalEma = 600;
    }

    /// @notice V2 starts its market-size EMA at log2Fixed(5 IMD) = 993.
    function initialV2() internal pure returns (State memory s) {
        s = initial();
        s.sizeLogEma = 993;
    }

    function decode(uint256 a, uint256 b) internal pure returns (State memory s) {
        s.pattern = uint64(a);
        s.bass = uint64(a >> 64);
        s.swapCount = uint32(a >> 128);
        s.lastTs = uint40(a >> 160);
        s.bpm = uint16(a >> 200);
        s.root = uint8(a >> 216);
        s.mode = uint8(a >> 224);
        s.patternId = uint32(b);
        s.lastTick = int24(uint24(b >> 32));
        s.pressure = int32(uint32(b >> 56));
        s.intervalEma = uint32(b >> 88);
        s.releaseCount = uint32(b >> 120);
        s.sizeLogEma = uint16(b >> 152);
        s.heat = uint8(b >> 168);
        s.trackNo = uint16(b >> 176);
    }

    function encode(State memory s) internal pure returns (uint256 a, uint256 b) {
        a = uint256(s.pattern) | uint256(s.bass) << 64 | uint256(s.swapCount) << 128 | uint256(s.lastTs) << 160
            | uint256(s.bpm) << 200 | uint256(s.root) << 216 | uint256(s.mode) << 224;
        b = uint256(s.patternId) | uint256(uint24(s.lastTick)) << 32 | uint256(uint32(s.pressure)) << 56
            | uint256(s.intervalEma) << 88 | uint256(s.releaseCount) << 120 | uint256(s.sizeLogEma) << 152
            | uint256(s.heat) << 168 | uint256(s.trackNo) << 176;
    }

    function mutate(State memory s, Input memory x, Thresholds memory t)
        internal
        pure
        returns (State memory, Mutation memory m)
    {
        return transition(s, x, t, false, false);
    }

    /// @notice Exact TS mutate(prev, input, thresholds, V2_RULES), including snapshot before reset.
    function mutateV2(State memory s, Input memory x, Thresholds memory t)
        internal
        pure
        returns (State memory, Mutation memory m)
    {
        return transition(s, x, t, true, true);
    }

    /// @dev Benchmark/reference for the incremental heat/drop cost, with the same relative + accumulation rules.
    function mutateRelativeAcc(State memory s, Input memory x, Thresholds memory t)
        internal
        pure
        returns (State memory, Mutation memory m)
    {
        return transition(s, x, t, true, false);
    }

    function transition(State memory s, Input memory x, Thresholds memory t, bool v2, bool heatDrop)
        private
        pure
        returns (State memory, Mutation memory m)
    {
        // All arithmetic below is widened/bounded; counters deliberately wrap.
        unchecked {
            if (heatDrop && x.timestamp >= s.lastTs && uint256(x.timestamp) - s.lastTs >= 3600) s.heat = 0;
            uint256 sizeLog = v2 ? log2Fixed(x.imdAmt) : 0;
            bool first = s.swapCount == 0;
            s.swapCount += 1;
            uint256 h = uint256(keccak256(abi.encodePacked(s.swapCount, x.tick, x.blockNumber)));
            m.step = uint8(h % 16);
            m.whale = x.imdAmt >= t.kick;
            if (m.whale) {
                // SPEC §3.3.8 drop: a whale acts on a whole track. Sell wipes it; buy writes a rotated Euclidean rhythm.
                m.track = uint8((h >> 16) % 4);
                uint64 trackShift = uint64(m.track) * 16;
                s.pattern &= ~(uint64(0xffff) << trackShift);
                if (x.isBuy) {
                    uint256 base = (EUCLID >> (((h >> 24) % 6) * 16)) & 0xffff;
                    uint256 rot = (h >> 32) % 16;
                    m.dropMask = uint16(((base << rot) | (base >> (16 - rot))) & 0xffff);
                    s.pattern |= uint64(m.dropMask) << trackShift;
                }
            } else {
                if (v2) {
                    int256 relative = int256(sizeLog) - int256(uint256(s.sizeLogEma));
                    m.track = relative < -8 ? 2 : relative < 10 ? 3 : relative < 25 ? 1 : 0;
                    m.fromTrack = m.track;
                    (s.pattern, m.track, m.writeStep, m.noop) = accumulate(s.pattern, m.track, m.step, x.isBuy);
                    m.promoted = m.track != m.fromTrack || m.writeStep != m.step;
                    if (heatDrop && x.isBuy) {
                        // Saturate even for arbitrary packed input (heat=255), matching TS Math.min.
                        if ((popcount64(s.pattern) >= 48 || m.noop) && s.heat < 255) ++s.heat;
                    } else if (heatDrop && s.heat > 0) {
                        --s.heat;
                    }
                } else {
                    m.track = x.imdAmt < t.hat ? 2 : x.imdAmt < t.glitch ? 3 : x.imdAmt < t.snare ? 1 : 0;
                    uint64 bit = uint64(1) << (uint64(m.track) * 16 + m.step);
                    if (x.isBuy) s.pattern |= bit;
                    else s.pattern &= ~bit;
                }
            }
            uint64 shift = uint64(m.step) * 4;
            if (x.isBuy) {
                int256 tick = int256(x.tick); // Widen before abs, including int24.min.
                uint8 deg = uint8(1 + (uint256(tick < 0 ? -tick : tick) / 60) % 15);
                s.bass = (s.bass & ~(uint64(15) << shift)) | uint64(deg) << shift;
            } else if ((h >> 8) & 1 == 0) {
                s.bass &= ~(uint64(15) << shift);
            }
            m.bassNote = uint8((s.bass >> shift) & 15);
            uint256 dt = first ? s.intervalEma : (x.timestamp >= s.lastTs ? uint256(x.timestamp) - s.lastTs : 0);
            if (!first && dt > EMA_CAP) dt = EMA_CAP;
            s.intervalEma = uint32((uint256(s.intervalEma) * 7 + dt) / 8);
            uint256 reduction = uint256(s.intervalEma) * (BPM_MAX - BPM_MIN) / EMA_CAP;
            s.bpm = reduction >= BPM_MAX - BPM_MIN ? BPM_MIN : uint16(BPM_MAX - reduction);
            s.pressure = int32(int256(s.pressure) - int256(s.pressure) / 16 + (x.isBuy ? int256(1000) : int256(-1000)));
            s.mode = s.pressure > 8000 ? 2 : s.pressure >= 0 ? 0 : s.pressure >= -8000 ? 1 : 3;
            if (m.whale) {
                s.root = uint8((uint256(s.root) + 7) % 12);
                s.patternId += 1;
                m.movementPatternId = s.patternId;
                m.movementRoot = s.root;
            }
            if (s.swapCount % PAGE == 0) {
                s.patternId += 1;
            }
            s.lastTs = x.timestamp;
            s.lastTick = x.tick;
            if (v2) {
                uint256 l = sizeLog;
                uint256 lo = log2Fixed(0.01 ether);
                uint256 hi = log2Fixed(t.kick);
                l = l < lo ? lo : l;
                l = l > hi ? hi : l;
                s.sizeLogEma = uint16((uint256(s.sizeLogEma) * 7 + l) / 8);
                if (heatDrop && s.heat >= 16) {
                    m.completed = true;
                    (m.snapshot0, m.snapshot1) = encode(s);
                    s.root = uint8((uint256(s.root) + 7) % 12);
                    ++s.patternId;
                    ++s.trackNo;
                    s.pattern = dropSeed(h);
                    s.bass &= 0x000f000f000f000f;
                    s.heat = 0;
                }
            }
            return (s, m);
        }
    }

    /// @dev Integer log2 with four linear mantissa bits; binary search is bounded to seven probes for uint128.
    function log2Fixed(uint128 amount) internal pure returns (uint256) {
        if (amount == 0) return 0;
        uint256 x = amount;
        uint256 n = x;
        uint256 m;
        unchecked {
            if (n >= 1 << 64) {
                n >>= 64;
                m += 64;
            }
            if (n >= 1 << 32) {
                n >>= 32;
                m += 32;
            }
            if (n >= 1 << 16) {
                n >>= 16;
                m += 16;
            }
            if (n >= 1 << 8) {
                n >>= 8;
                m += 8;
            }
            if (n >= 1 << 4) {
                n >>= 4;
                m += 4;
            }
            if (n >= 1 << 2) {
                n >>= 2;
                m += 2;
            }
            if (n >= 1 << 1) m += 1;
            uint256 f = (m >= 4 ? x >> (m - 4) : x << (4 - m)) & 15;
            return m * 16 + f;
        }
    }

    function popcount64(uint64 value) internal pure returns (uint256) {
        unchecked {
            uint256 x = value;
            x -= (x >> 1) & 0x5555555555555555;
            x = (x & 0x3333333333333333) + ((x >> 2) & 0x3333333333333333);
            x = (x + (x >> 4)) & 0x0f0f0f0f0f0f0f0f;
            return ((x * 0x0101010101010101) >> 56) & 255;
        }
    }

    function dropSeed(uint256 h) internal pure returns (uint64) {
        uint256 kick = (0x1111_4141_0901_0481_0401_0101 >> ((((h >> 64) & 255) % 6) * 16)) & 0xffff;
        uint256 snare = (0x9010_1410_1090_1010 >> (((h >> 72) & 3) * 16)) & 0xffff;
        uint256 base = (EUCLID >> (((h >> 76) & 3) * 16)) & 0xffff;
        uint256 rot = (h >> 80) & 15;
        uint256 hat = ((base << rot) | (base >> (16 - rot))) & 0xffff;
        uint256 g = (h >> 84) & 31;
        uint256 glitch = g >= 16 ? uint256(1) << (g & 15) : 0;
        return uint64(kick | snare << 16 | hat << 32 | glitch << 48);
    }

    /// @dev Default buy ladder + circular scan; sells climb only through snare, never through kick.
    function accumulate(uint64 pattern, uint8 track, uint8 step, bool buy)
        internal
        pure
        returns (uint64, uint8, uint8, bool)
    {
        uint64 bit = uint64(1) << (uint256(track) * 16 + step);
        if ((pattern & bit != 0) == buy) {
            uint256 rung = track == 2 ? 0 : track == 3 ? 1 : track == 1 ? 2 : 3;
            bool found;
            for (uint256 q = rung + 1; q < (buy ? 4 : 3); ++q) {
                uint8 next = q == 1 ? 3 : q == 2 ? 1 : 0;
                uint64 candidate = uint64(1) << (uint256(next) * 16 + step);
                if ((pattern & candidate != 0) != buy) {
                    track = next;
                    bit = candidate;
                    found = true;
                    break;
                }
            }
            if (!found) {
                if (!buy) return (pattern, track, step, true);
                // Rotate row so bit 0 represents the next step, then find its first clear cell.
                uint256 row = (pattern >> (uint256(track) * 16)) & 0xffff;
                uint256 start = (uint256(step) + 1) & 15;
                uint256 clear = ~((row >> start) | (row << (16 - start))) & 0xffff;
                if (clear == 0) return (pattern, track, step, true);
                uint256 offset;
                unchecked {
                    if (clear & 0xff == 0) {
                        clear >>= 8;
                        offset += 8;
                    }
                    if (clear & 0xf == 0) {
                        clear >>= 4;
                        offset += 4;
                    }
                    if (clear & 3 == 0) {
                        clear >>= 2;
                        offset += 2;
                    }
                    if (clear & 1 == 0) offset += 1;
                }
                step = uint8((start + offset) & 15);
                bit = uint64(1) << (uint256(track) * 16 + step);
            }
        }
        return (buy ? pattern | bit : pattern & ~bit, track, step, false);
    }
}
