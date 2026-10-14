// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {SequencerState as S} from "../src/SequencerState.sol";

abstract contract SequencerTestBase is Test {
    function thresholds() internal pure returns (S.Thresholds memory) {
        return S.Thresholds(0.5 ether, 5 ether, 25 ether, 100 ether);
    }

    function input(bool buy, uint128 amt, int24 tick) internal pure returns (S.Input memory) {
        return S.Input(buy, amt, tick, 20_000_000, 1_800_000_000);
    }

    function change(S.State memory s, S.Input memory x) internal pure returns (S.State memory, S.Mutation memory) {
        return S.mutate(s, x, thresholds());
    }
}

contract SequencerStateTest is SequencerTestBase {
    function test_InitialState() public pure {
        S.State memory s = S.initial();
        assertEq(s.pattern, 0x10100101);
        assertEq(s.bpm, 128);
        assertEq(s.root, 9);
        assertEq(s.intervalEma, 600);
        assertEq(s.bass, 0);
        assertEq(s.swapCount, 0);
        assertEq(s.lastTs, 0);
        assertEq(s.mode, 0);
        assertEq(s.patternId, 0);
        assertEq(s.lastTick, 0);
        assertEq(s.pressure, 0);
        assertEq(s.releaseCount, 0);
    }

    function test_ExactBitLayoutAndSignedFields() public pure {
        S.State memory s = S.State(1, 2, 3, 4, 128, 9, 2, 5, -60, -1000, 600, 6);
        (uint256 a, uint256 b) = S.encode(s);
        assertEq(
            a,
            1 | uint256(2) << 64 | uint256(3) << 128 | uint256(4) << 160 | uint256(128) << 200 | uint256(9) << 216
                | uint256(2) << 224
        );
        assertEq(b, 5 | uint256(0xffffc4) << 32 | uint256(0xfffffc18) << 56 | uint256(600) << 88 | uint256(6) << 120);
    }

    function test_ThresholdEdges() public pure {
        uint128[13] memory amounts = [
            uint128(0),
            0.5 ether - 1,
            0.5 ether,
            0.5 ether + 1,
            5 ether - 1,
            5 ether,
            5 ether + 1,
            25 ether - 1,
            25 ether,
            25 ether + 1,
            100 ether - 1,
            100 ether,
            100 ether + 1
        ];
        uint8[13] memory tracks = [uint8(2), 2, 3, 3, 3, 1, 1, 1, 0, 0, 0, 0, 0];
        for (uint256 i; i < 13; ++i) {
            (, S.Mutation memory m) = change(S.initial(), input(true, amounts[i], 0));
            assertEq(m.track, tracks[i]);
            assertEq(m.whale, i >= 11);
        }
    }

    function test_HashUsesFourThreeEightBytes() public pure {
        (, S.Mutation memory m) = change(S.initial(), input(true, 1 ether, -123));
        bytes memory packed = abi.encodePacked(uint32(1), int24(-123), uint64(20_000_000));
        assertEq(packed.length, 15);
        assertEq(m.step, uint256(keccak256(packed)) % 16);
    }

    function test_BuySetsAndSellClearsOnlySelectedBit() public pure {
        (S.State memory buy, S.Mutation memory m) = change(S.initial(), input(true, 6 ether, 0));
        uint64 bit = uint64(1) << (uint256(m.track) * 16 + m.step);
        assertEq(buy.pattern, uint64(0x10100101) | bit);
        S.State memory s = S.initial();
        s.pattern = type(uint64).max;
        (S.State memory sell,) = change(s, input(false, 6 ether, 0));
        assertEq(sell.pattern, type(uint64).max ^ bit);
    }

    function test_BassDegreeNegativeTickAndMinInt24() public pure {
        int24[6] memory ticks = [int24(-60), 60, -899, 900, type(int24).min, type(int24).max];
        for (uint256 i; i < 6; ++i) {
            (, S.Mutation memory m) = change(S.initial(), input(true, 0, ticks[i]));
            int256 t = ticks[i];
            assertEq(m.bassNote, 1 + uint256(t < 0 ? -t : t) / 60 % 15);
        }
    }

    function test_SellBassBothHashBranches() public pure {
        bool cleared;
        bool preserved;
        for (uint64 n = 1; n < 100; ++n) {
            S.State memory s = S.initial();
            s.bass = type(uint64).max;
            S.Input memory x = input(false, 1 ether, -120);
            x.blockNumber = n;
            (S.State memory a, S.Mutation memory m) = change(s, x);
            uint256 h = uint256(keccak256(abi.encodePacked(uint32(1), x.tick, n)));
            if ((h >> 8) & 1 == 0) {
                assertEq(m.bassNote, 0);
                cleared = true;
            } else {
                assertEq(a.bass, type(uint64).max);
                preserved = true;
            }
        }
        assertTrue(cleared && preserved);
    }

    function test_FirstSwapKeepsEmaEvenWithHugeTimestamp() public pure {
        (S.State memory a,) = change(S.initial(), input(true, 0, 0));
        assertEq(a.intervalEma, 600);
        assertEq(a.bpm, 157);
        assertEq(a.lastTs, 1_800_000_000);
    }

    function test_FirstSwapAtTimestampZero() public pure {
        S.Input memory x = input(true, 0, 0);
        x.timestamp = 0;
        (S.State memory a,) = change(S.initial(), x);
        (a,) = change(a, x);
        assertEq(a.intervalEma, 525);
        assertEq(a.bpm, 159);
    }

    function test_EmaSameBlockAndCap() public pure {
        S.State memory s = S.initial();
        s.swapCount = 1;
        s.lastTs = 100;
        S.Input memory x = input(true, 0, 0);
        x.timestamp = 100;
        (S.State memory a,) = change(s, x);
        assertEq(a.intervalEma, 525);
        s = S.initial();
        s.swapCount = 1;
        s.lastTs = 100;
        x.timestamp = type(uint40).max;
        (a,) = change(s, x);
        assertEq(a.intervalEma, 975);
        assertEq(a.bpm, 149);
    }

    function test_TimestampWrapUsesZeroInterval() public pure {
        S.State memory s = S.initial();
        s.swapCount = 1;
        s.lastTs = type(uint40).max;
        S.Input memory x = input(true, 0, 0);
        x.timestamp = 0;
        (S.State memory a,) = change(s, x);
        assertEq(a.intervalEma, 525);
        assertEq(a.lastTs, 0);
    }

    function test_EmaUint32MaxDoesNotOverflowAndBpmClamps() public pure {
        S.State memory s = S.initial();
        s.intervalEma = type(uint32).max;
        (S.State memory a,) = change(s, input(true, 0, 0));
        assertEq(a.intervalEma, type(uint32).max);
        assertEq(a.bpm, 90);
        s = S.initial();
        s.swapCount = 1;
        s.intervalEma = type(uint32).max;
        (a,) = change(s, input(true, 0, 0));
        assertEq(a.intervalEma, (uint256(type(uint32).max) * 7 + 3600) / 8);
        assertEq(a.bpm, 90);
    }

    function test_PressureSignedDivisionRoundsTowardZero() public pure {
        S.State memory s = S.initial();
        s.pressure = -17;
        (S.State memory a,) = change(s, input(true, 0, 0));
        assertEq(a.pressure, 984);
        s = S.initial();
        s.pressure = -15;
        (a,) = change(s, input(false, 0, 0));
        assertEq(a.pressure, -1015);
    }

    function test_ModeBoundaries() public pure {
        int32[8] memory previous = [int32(7466), 7467, -1066, -1067, -7466, -7467, 1066, 1067];
        int32[8] memory expected = [int32(8000), 8001, 0, -1, -8000, -8001, 0, 1];
        uint8[8] memory modes = [uint8(0), 2, 0, 1, 1, 3, 0, 0];
        for (uint256 i; i < 8; ++i) {
            S.State memory s = S.initial();
            s.pressure = previous[i];
            (S.State memory a,) = change(s, input(i < 4, 0, 0));
            assertEq(a.pressure, expected[i]);
            assertEq(a.mode, modes[i]);
        }
    }

    function test_WhaleAndPageHaveSeparateIncrements() public pure {
        S.State memory s = S.initial();
        s.swapCount = 63;
        s.patternId = 10;
        (S.State memory a, S.Mutation memory m) = change(s, input(false, 100 ether, -5));
        assertEq(a.root, 4);
        assertEq(a.patternId, 12);
        assertEq(m.movementPatternId, 11);
        assertEq(a.swapCount, 64);
        assertEq(a.lastTick, -5);
    }

    function test_PageAloneDoesNotEmitMovement() public pure {
        S.State memory s = S.initial();
        s.swapCount = 63;
        (S.State memory a, S.Mutation memory m) = change(s, input(true, 1 ether, 0));
        assertEq(a.patternId, 1);
        assertEq(a.root, 9);
        assertFalse(m.whale);
    }

    function test_CountsWrapWithoutRevert() public pure {
        S.State memory s = S.initial();
        s.swapCount = type(uint32).max;
        s.patternId = type(uint32).max;
        (S.State memory a, S.Mutation memory m) = change(s, input(true, 100 ether, 0));
        assertEq(a.swapCount, 0);
        assertEq(m.movementPatternId, 0);
        assertEq(a.patternId, 1);
    }

    function test_ReleaseCountPreserved() public pure {
        S.State memory s = S.initial();
        s.releaseCount = type(uint32).max;
        (S.State memory a,) = change(s, input(true, 100 ether, 0));
        assertEq(a.releaseCount, type(uint32).max);
    }

    function test_ZeroSlot1IsReachableAfter38Swaps() public pure {
        bytes memory directions = bytes("SBBBBBSSBBBBBBBBBBBBBBBBBBSBBBSSSSSSSS");
        S.State memory s = S.initial();
        for (uint256 i; i < directions.length; ++i) {
            (s,) = change(s, input(directions[i] == bytes1("B"), 1 ether, 0));
        }
        (uint256 a, uint256 b) = S.encode(s);
        assertEq(s.swapCount, 38);
        assertEq(b, 0);
        assertTrue(a != 0);
    }

    function testFuzz_PackingRoundtrip(uint256 a, uint256 b) public pure {
        (uint256 x, uint256 y) = S.encode(S.decode(a, b));
        assertEq(x, a & ((uint256(1) << 232) - 1));
        assertEq(y, b & ((uint256(1) << 152) - 1));
    }

    function testFuzz_MutationBoundsAndOnlySelectedBits(
        uint256 seed,
        bool buy,
        uint128 amount,
        int24 tick,
        uint64 n,
        uint40 ts
    ) public pure {
        S.State memory s = S.initial();
        s.pattern = uint64(seed);
        s.bass = uint64(seed >> 64);
        s.swapCount = uint32(seed >> 128);
        s.intervalEma = uint32(seed >> 160);
        s.pressure = int32(int256(seed % 32001) - 16000);
        s.lastTs = uint40(seed >> 192);
        uint64 oldPattern = s.pattern;
        uint64 oldBass = s.bass;
        (S.State memory a, S.Mutation memory m) = change(s, S.Input(buy, amount, tick, n, ts));
        assertGe(a.bpm, 90);
        assertLe(a.bpm, 170);
        assertLe(a.mode, 3);
        assertLe(a.root, 11);
        assertLe(a.pressure, 16000);
        assertGe(a.pressure, -16000);
        uint64 bit = uint64(1) << (uint256(m.track) * 16 + m.step);
        assertEq((oldPattern ^ a.pattern) & ~bit, 0);
        assertEq((oldBass ^ a.bass) & ~(uint64(15) << (uint256(m.step) * 4)), 0);
        assertEq((a.pattern & bit) != 0, buy);
    }
}
