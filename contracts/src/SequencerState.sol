// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Canonical SPEC.md §3 codec and deterministic transition, shared by hook and vector generator.
library SequencerState {
    uint256 internal constant EMA_CAP = 3600;
    uint16 internal constant BPM_MIN = 90;
    uint16 internal constant BPM_MAX = 170;
    uint32 internal constant PAGE = 64;

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
    }

    function initial() internal pure returns (State memory s) {
        s.pattern = 0x10100101;
        s.bpm = 128;
        s.root = 9;
        s.intervalEma = 600;
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
    }

    function encode(State memory s) internal pure returns (uint256 a, uint256 b) {
        a = uint256(s.pattern) | uint256(s.bass) << 64 | uint256(s.swapCount) << 128 | uint256(s.lastTs) << 160
            | uint256(s.bpm) << 200 | uint256(s.root) << 216 | uint256(s.mode) << 224;
        b = uint256(s.patternId) | uint256(uint24(s.lastTick)) << 32 | uint256(uint32(s.pressure)) << 56
            | uint256(s.intervalEma) << 88 | uint256(s.releaseCount) << 120;
    }

    function mutate(State memory s, Input memory x, Thresholds memory t)
        internal
        pure
        returns (State memory, Mutation memory m)
    {
        bool first = s.swapCount == 0;
        unchecked {
            s.swapCount += 1;
        }
        uint256 h = uint256(keccak256(abi.encodePacked(s.swapCount, x.tick, x.blockNumber)));
        m.track = x.imdAmt < t.hat ? 2 : x.imdAmt < t.glitch ? 3 : x.imdAmt < t.snare ? 1 : 0;
        m.step = uint8(h % 16);
        uint64 bit = uint64(1) << (uint64(m.track) * 16 + m.step);
        if (x.isBuy) s.pattern |= bit;
        else s.pattern &= ~bit;
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
        m.whale = x.imdAmt >= t.kick;
        if (m.whale) {
            s.root = uint8((uint256(s.root) + 7) % 12);
            unchecked {
                s.patternId += 1;
            }
            m.movementPatternId = s.patternId;
        }
        if (s.swapCount % PAGE == 0) {
            unchecked {
                s.patternId += 1;
            }
        }
        s.lastTs = x.timestamp;
        s.lastTick = x.tick;
        return (s, m);
    }
}
