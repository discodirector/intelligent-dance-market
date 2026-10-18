// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {SequencerTestBase} from "./SequencerState.t.sol";
import {SequencerState as S} from "../src/SequencerState.sol";

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

    function test_SilenceBoundaryAndSellCooling() public pure {
        for (uint256 i; i < 4; ++i) {
            S.State memory s = S.initialV2();
            s.swapCount = 1;
            s.lastTs = 10000;
            s.heat = 10;
            s.pattern = type(uint64).max;
            S.Input memory x = input(i != 3, 1 ether, 0);
            x.timestamp = i == 0 ? 13599 : i == 1 ? 13600 : i == 2 ? 9999 : 10001;
            (S.State memory a,) = S.mutateV2(s, x, thresholds());
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
        (S.State memory a, S.Mutation memory m) = S.mutateV2(s, input(true, 1 ether, 0), thresholds());
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
            S.Input memory x = input(i % 2 == 0, 100 ether, 0);
            x.timestamp = i < 2 ? 4599 : 4600;
            (S.State memory a, S.Mutation memory m) = S.mutateV2(s, x, thresholds());
            assertEq(a.heat, i < 2 ? 15 : 0);
            assertFalse(m.completed);
            assertTrue(m.whale);
        }
    }

    function test_SaturationUsesPostWritePopcount48() public pure {
        S.Input memory x = input(true, 1 ether, 0);
        uint256 step = uint256(keccak256(abi.encodePacked(uint32(1), int24(0), uint64(20_000_000)))) % 16;
        S.State memory s = S.initialV2();
        // 47 on, relative hat write raises it to exactly 48.
        s.pattern = 0x0000ffffffffffff ^ (uint64(1) << (32 + step));
        s.sizeLogEma = 1100;
        (S.State memory a,) = S.mutateV2(s, x, thresholds());
        assertEq(S.popcount64(a.pattern), 48);
        assertEq(a.heat, 1);
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
        (S.State memory next, S.Mutation memory m) = S.mutateV2(s, S.Input(buy, amount, tick, n, ts), thresholds());
        assertEq(next.releaseCount, release);
        assertLe(next.heat, 15);
        assertGe(next.bpm, 72);
        assertLe(next.bpm, 118);
        assertEq(m.completed, m.snapshot0 != 0); // snapshot includes this swap's valid BPM
    }
}
