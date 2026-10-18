// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {SequencerTestBase} from "./SequencerState.t.sol";
import {SequencerState as S} from "../src/SequencerState.sol";
import {QuoteCalibration as Q} from "../src/QuoteCalibration.sol";

contract SequencerV2Test is SequencerTestBase {
    function test_LayoutV2() public pure {
        S.State memory s = S.initialV2();
        s.sizeLogEma = 0xabcd;
        s.heat = 0xef;
        s.trackNo = 0x9876;
        (uint256 a, uint256 b) = S.encode(s);
        assertEq((b >> 152) & 0xffff, 0xabcd);
        assertEq((b >> 168) & 0xff, 0xef);
        assertEq((b >> 176) & 0xffff, 0x9876);
        assertEq(abi.encode(s), abi.encode(S.decode(a, b)));
    }

    function test_Log2FixedKnownValues() public pure {
        assertEq(S.log2Fixed(0), 0);
        assertEq(S.log2Fixed(1), 0);
        assertEq(S.log2Fixed(3), 24);
        assertEq(S.log2Fixed(5 ether), 993);
        assertEq(S.log2Fixed(0.01 ether), 849);
        assertEq(S.log2Fixed(100 ether), 1061);
        assertEq(S.log2Fixed(type(uint128).max), 2047);
    }

    function test_EthCalibration() public pure {
        // 1/400 of the IMD calibration, exact in wei; the whale threshold scales with FDV (test_WhaleThreshold*).
        assertEq(Q.T_HAT * 400, 0.5 ether);
        assertEq(Q.T_GLITCH * 400, 5 ether);
        assertEq(Q.T_SNARE * 400, 25 ether);
        assertEq(Q.EMA_FLOOR * 400, 0.01 ether);
        assertEq(Q.INITIAL_SIZE * 400, 5 ether);
        // log2Fixed pins (1/16 octave): rounding differs from the IMD values since 400 is not a power of two.
        assertEq(S.log2Fixed(Q.INITIAL_SIZE), 854);
        assertEq(S.log2Fixed(Q.EMA_FLOOR), 710);
        assertEq(S.log2Fixed(Q.T_HAT), 801);
        assertEq(S.log2Fixed(Q.T_SNARE), 891);
        assertEq(S.log2Fixed(Q.WHALE_MIN), 833); // lowest possible EMA upper clamp
        assertEq(S.log2Fixed(Q.WHALE_MAX), 1045); // highest
        assertEq(S.initialV2().sizeLogEma, 854);
        assertEq(S.initialV2().sizeLogEma, S.log2Fixed(Q.INITIAL_SIZE));
    }

    function test_SilenceBoundaryAndSellCooling() public pure {
        for (uint256 i; i < 4; ++i) {
            S.State memory s = S.initialV2();
            s.swapCount = 1;
            s.lastTs = 10000;
            s.heat = 10;
            s.pattern = type(uint64).max;
            S.Input memory x = input(i != 3, UNIT, 0);
            x.timestamp = i == 0 ? 13599 : i == 1 ? 13600 : i == 2 ? 9999 : 10001;
            (S.State memory a,) = v2(s, x);
            assertEq(a.heat, i == 0 || i == 2 ? 11 : i == 1 ? 1 : 9);
        }
    }

    function test_DropSnapshotBeforeResetAndCountersWrap() public pure {
        S.State memory s = S.initialV2();
        s.pattern = type(uint64).max;
        s.bass = type(uint64).max;
        s.heat = 15;
        s.lastTs = 1_799_999_999;
        s.swapCount = type(uint32).max;
        s.patternId = type(uint32).max;
        s.trackNo = type(uint16).max;
        s.releaseCount = 77;
        (S.State memory a, S.Mutation memory m) = v2(s, input(true, UNIT, 0));
        assertTrue(m.completed);
        S.State memory snapshot = S.decode(m.snapshot0, m.snapshot1);
        assertEq(snapshot.heat, 16);
        assertEq(snapshot.trackNo, type(uint16).max);
        assertEq(snapshot.pattern, type(uint64).max);
        assertEq(snapshot.patternId, 0); // page wrap precedes snapshot
        assertEq(snapshot.root, 9);
        assertEq(a.trackNo, 0);
        assertEq(a.patternId, 1);
        assertEq(a.root, 4);
        assertEq(a.bass, snapshot.bass & 0x000f000f000f000f);
        assertEq(m.bassNote, (snapshot.bass >> (m.step * 4)) & 15);
        assertEq(a.heat, 0);
        assertEq(a.releaseCount, 77);
        assertEq(a.pattern, S.dropSeed(uint256(keccak256(abi.encodePacked(uint32(0), int24(0), uint64(20_000_000))))));
    }

    function test_WhaleLeavesHeatButSilenceStillResets() public pure {
        for (uint256 i; i < 4; ++i) {
            S.State memory s = S.initialV2();
            s.heat = 15;
            s.lastTs = 1000;
            S.Input memory x = input(i % 2 == 0, Q.WHALE_MAX, 0); // tick 0: FDV 1e9 ETH, top clamp
            x.timestamp = i < 2 ? 4599 : 4600;
            (S.State memory a, S.Mutation memory m) = v2(s, x);
            assertEq(a.heat, i < 2 ? 15 : 0);
            assertFalse(m.completed);
            assertTrue(m.whale);
        }
    }

    function test_SaturationUsesPostWritePopcount44() public pure {
        S.Input memory x = input(true, UNIT, 0);
        uint256 step = uint256(keccak256(abi.encodePacked(uint32(1), int24(0), uint64(20_000_000)))) % 16;
        S.State memory s = S.initialV2();
        // 43 on, relative hat write raises it to exactly 44 (SAT_BITS).
        s.pattern = 0x0000ffff0fffffff ^ (uint64(1) << (32 + step)); // full kick + hat rows, 12 snare bits
        s.sizeLogEma = 1100;
        (S.State memory a,) = v2(s, x);
        assertEq(S.popcount64(a.pattern), 44);
        assertEq(a.heat, 1);
        // 42 on -> 43 after the write: below saturation, and the write changed a bit, so no heat.
        // (mutateV2 updates the memory state in place: rebuild it.)
        s = S.initialV2();
        s.pattern = 0x0000ffff0ffffffe ^ (uint64(1) << (32 + step));
        s.sizeLogEma = 1100;
        (a,) = v2(s, x);
        assertEq(S.popcount64(a.pattern), 43);
        assertEq(a.heat, 0);
    }

    function test_WhaleThresholdCalibrationAndClamps() public pure {
        assertEq(Q.WHALE_C * Q.WHALE_C <= Q.WHALE_K * Q.WHALE_K * Q.SUPPLY, true);
        assertGt((Q.WHALE_C + 1) * (Q.WHALE_C + 1), Q.WHALE_K * Q.WHALE_K * Q.SUPPLY);
        // FDV 4 / 40 / 400 / 4000 ETH (ticks nearest 1e9 / FDV IDM per ETH) -> 0.04 / 0.1265 / 0.4 / 1.265 ETH.
        assertEq(S.whaleThreshold(193380, true), 39_998_766_246_454_331);
        assertEq(S.whaleThreshold(193379, true), 40_000_766_134_770_696);
        assertApproxEqRel(S.whaleThreshold(170352, true), 0.12649110640673517 ether, 1e14);
        assertApproxEqRel(S.whaleThreshold(147325, true), 0.4 ether, 1e14);
        assertApproxEqRel(S.whaleThreshold(124298, true), 1.2649110640673518 ether, 1e14);
        // Clamp boundaries (pinned): 50 ETH for tick <= 50754, 0.005 ETH for tick >= 234971.
        assertEq(Q.WHALE_MIN, 0.005 ether);
        assertEq(Q.WHALE_MAX, 50 ether);
        assertEq(S.whaleThreshold(50754, true), Q.WHALE_MAX);
        assertEq(S.whaleThreshold(50755, true), 49_998_189_365_703_816_076);
        assertEq(S.whaleThreshold(234970, true), 5_000_073_327_709_522);
        assertEq(S.whaleThreshold(234971, true), Q.WHALE_MIN);
        // Tick extremes and out-of-range int24 saturate instead of reverting.
        assertEq(S.whaleThreshold(type(int24).min, true), Q.WHALE_MAX);
        assertEq(S.whaleThreshold(-887272, true), Q.WHALE_MAX);
        assertEq(S.whaleThreshold(887272, true), Q.WHALE_MIN);
        assertEq(S.whaleThreshold(type(int24).max, true), Q.WHALE_MIN);
        assertEq(S.whaleThreshold(type(int24).min, false), Q.WHALE_MIN);
        assertEq(S.whaleThreshold(type(int24).max, false), Q.WHALE_MAX);
    }

    /// @dev Higher tick = more IDM per ETH = lower FDV = lower threshold; a currency1 quote mirrors the tick.
    function testFuzz_WhaleThresholdMonotoneBoundedSymmetric(int24 a, int24 b) public pure {
        (int24 lo, int24 hi) = a <= b ? (a, b) : (b, a);
        uint128 wLo = S.whaleThreshold(lo, true);
        uint128 wHi = S.whaleThreshold(hi, true);
        assertGe(wLo, wHi);
        assertGe(wHi, Q.WHALE_MIN);
        assertLe(wLo, Q.WHALE_MAX);
        if (a > type(int24).min) assertEq(S.whaleThreshold(-a, false), S.whaleThreshold(a, true));
    }

    function testFuzz_CodecV2(uint256 a, uint256 b) public pure {
        (uint256 x, uint256 y) = S.encode(S.decode(a, b));
        assertEq(x, a & ((uint256(1) << 232) - 1));
        assertEq(y, b & ((uint256(1) << 192) - 1));
    }

    function testFuzz_AccumulateAgainstLoop(uint64 pattern, uint8 track, uint8 step, bool buy) public pure {
        track %= 4;
        step %= 16;
        uint8[4] memory ladder = [uint8(2), 3, 1, 0];
        uint8[4] memory rung = [uint8(3), 2, 0, 1];
        uint8 wantTrack = track;
        uint8 wantStep = step;
        bool found = ((pattern >> (uint256(track) * 16 + step)) & 1 != 0) != buy;
        if (!found) {
            for (uint256 q = rung[track] + 1; q < (buy ? 4 : 3); ++q) {
                if (((pattern >> (uint256(ladder[q]) * 16 + step)) & 1 != 0) != buy) {
                    wantTrack = ladder[q];
                    found = true;
                    break;
                }
            }
        }
        if (!found && buy) {
            for (uint256 i = 1; i < 16; ++i) {
                uint8 st = uint8((uint256(step) + i) % 16);
                if ((pattern >> (uint256(track) * 16 + st)) & 1 == 0) {
                    wantStep = st;
                    found = true;
                    break;
                }
            }
        }
        uint64 expected = pattern;
        if (found) {
            uint64 bit = uint64(1) << (uint256(wantTrack) * 16 + wantStep);
            expected = buy ? pattern | bit : pattern & ~bit;
        }
        (uint64 actual, uint8 t, uint8 st, bool noop) = S.accumulate(pattern, track, step, buy);
        assertEq(actual, expected);
        assertEq(t, wantTrack);
        assertEq(st, wantStep);
        assertEq(noop, !found);
    }

    function testFuzz_ArbitraryPackedStateNeverReverts(
        uint256 a,
        uint256 b,
        bool buy,
        uint128 amount,
        int24 tick,
        uint64 n,
        uint40 ts
    ) public pure {
        S.State memory s = S.decode(a, b);
        uint32 release = s.releaseCount;
        (S.State memory next, S.Mutation memory m) = v2(s, S.Input(buy, amount, tick, n, ts));
        assertEq(next.releaseCount, release);
        assertLe(next.heat, 15);
        assertGe(next.bpm, 72);
        assertLe(next.bpm, 118);
        assertEq(m.completed, m.snapshot0 != 0); // snapshot includes this swap's valid BPM
    }
}
