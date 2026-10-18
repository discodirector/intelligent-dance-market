// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {SequencerState as S} from "../src/SequencerState.sol";
import {QuoteCalibration as Q} from "../src/QuoteCalibration.sol";

abstract contract SequencerTestBase is Test {
    /// @dev 1 IMD at the 1/400 ETH calibration: a mid-size v2 swap well below the whale threshold.
    uint128 internal constant UNIT = 0.0025 ether;

    /// @dev v1 (old Sepolia hook, IMD quote) thresholds; v1 vectors and tests stay on these.
    function thresholds() internal pure returns (S.Thresholds memory) {
        return S.Thresholds(0.5 ether, 5 ether, 25 ether, 100 ether);
    }

    /// @dev Launch hook thresholds (native ETH quote) for a swap that leaves the pool at `tick`.
    function v2Thresholds(int24 tick) internal pure returns (S.Thresholds memory) {
        return S.Thresholds(Q.T_HAT, Q.T_GLITCH, Q.T_SNARE, S.whaleThreshold(tick, true));
    }

    /// @dev The v2 transition exactly as the native-ETH hook runs it.
    function v2(S.State memory s, S.Input memory x) internal pure returns (S.State memory, S.Mutation memory) {
        return S.mutateV2(s, x, v2Thresholds(x.tick));
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
        assertEq(s.bpm, 96);
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
        S.State memory s = S.State(1, 2, 3, 4, 128, 9, 2, 5, -60, -1000, 600, 6, 0, 0, 0);
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
            assertEq(m.whale, i >= 11);
            // Whales act on dropTrack = (h >> 16) % 4 instead of the kick cell.
            if (i < 11) assertEq(m.track, tracks[i]);
            else assertEq(m.track, (_hash(1, 0) >> 16) % 4);
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
        assertEq(a.bpm, 88);
        assertEq(a.lastTs, 1_800_000_000);
    }

    function test_FirstSwapAtTimestampZero() public pure {
        S.Input memory x = input(true, 0, 0);
        x.timestamp = 0;
        (S.State memory a,) = change(S.initial(), x);
        (a,) = change(a, x);
        assertEq(a.intervalEma, 525);
        assertEq(a.bpm, 92);
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
        assertEq(a.intervalEma, 637);
        assertEq(a.bpm, 86);
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
        assertEq(a.bpm, 72);
        s = S.initial();
        s.swapCount = 1;
        s.intervalEma = type(uint32).max;
        (a,) = change(s, input(true, 0, 0));
        assertEq(a.intervalEma, (uint256(type(uint32).max) * 7 + 900) / 8);
        assertEq(a.bpm, 72);
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
        (uint256 x, uint256 y) = S.encode(S.decode(a, b & ((uint256(1) << 152) - 1)));
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
        // Half the runs exercise the non-whale path (a uniform uint128 is almost always a whale).
        if (seed & 1 == 0) amount = amount % 100 ether;
        uint64 oldPattern = s.pattern;
        uint64 oldBass = s.bass;
        (S.State memory a, S.Mutation memory m) = change(s, S.Input(buy, amount, tick, n, ts));
        assertGe(a.bpm, 72);
        assertLe(a.bpm, 118);
        assertLe(a.mode, 3);
        assertLe(a.root, 11);
        assertLe(a.pressure, 16000);
        assertGe(a.pressure, -16000);
        assertEq((oldBass ^ a.bass) & ~(uint64(15) << (uint256(m.step) * 4)), 0);
        if (amount < 100 ether) {
            // Non-whale: at most one drum bit changes, and it ends equal to the side.
            uint64 bit = uint64(1) << (uint256(m.track) * 16 + m.step);
            assertEq((oldPattern ^ a.pattern) & ~bit, 0);
            assertEq((a.pattern & bit) != 0, buy);
            assertEq(m.dropMask, 0);
        } else {
            // Whale: only the dropped track's 16 bits may change; it ends equal to dropMask.
            uint64 trackBits = uint64(0xffff) << (uint256(m.track) * 16);
            assertEq((oldPattern ^ a.pattern) & ~trackBits, 0);
            assertEq(uint16(a.pattern >> (uint256(m.track) * 16)), m.dropMask);
            if (buy) {
                uint256 hits;
                for (uint256 i; i < 16; ++i) {
                    hits += (m.dropMask >> i) & 1;
                }
                assertGe(hits, 3);
                assertLe(hits, 8);
            } else {
                assertEq(m.dropMask, 0);
            }
        }
    }

    // ------------------------------------------------------------- whale drop / fill (SPEC §3.3.8)

    function _hash(uint32 count, int24 tick) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(count, tick, uint64(20_000_000))));
    }

    /// @dev Reference Euclidean mask straight from the SPEC formula (loop form).
    function _euclid(uint256 k, uint256 rot) internal pure returns (uint16 mask) {
        for (uint256 i; i < 16; ++i) {
            if ((i * k) % 16 < k) mask |= uint16(1 << ((i + rot) % 16));
        }
    }

    /// Finds a swapCount whose hash selects `track` (and optionally k/rot) for a whale at tick 0.
    function _find(uint256 track, uint256 k, uint256 rot) internal pure returns (uint32 count) {
        for (uint32 c = 1; c < 20_000; ++c) {
            uint256 h = _hash(c, 0);
            if ((h >> 16) % 4 != track) continue;
            if (k != 0 && 3 + (h >> 24) % 6 != k) continue;
            if (rot != 99 && (h >> 32) % 16 != rot) continue;
            return c;
        }
        revert("no matching hash");
    }

    function _stateBefore(uint32 count) internal pure returns (S.State memory s) {
        s = S.initial();
        s.swapCount = count - 1;
        s.pattern = type(uint64).max; // every drum bit on, so a wipe is visible on any track
    }

    function test_EuclidTableMatchesSpecLoop() public pure {
        for (uint256 k = 3; k <= 8; ++k) {
            uint16 base = uint16((S.EUCLID >> ((k - 3) * 16)) & 0xffff);
            assertEq(base, _euclid(k, 0));
            uint256 hits;
            for (uint256 i; i < 16; ++i) {
                hits += (base >> i) & 1;
            }
            assertEq(hits, k, "exact hit count");
        }
    }

    function test_WhaleSellWipesEachTrackIncludingKick() public pure {
        for (uint256 track; track < 4; ++track) {
            uint32 c = _find(track, 0, 99);
            (S.State memory a, S.Mutation memory m) = change(_stateBefore(c), input(false, 100 ether, 0));
            assertTrue(m.whale);
            assertEq(m.track, track);
            assertEq(m.dropMask, 0);
            assertEq(uint16(a.pattern >> (track * 16)), 0, "track wiped");
            assertEq(a.pattern | (uint64(0xffff) << (track * 16)), type(uint64).max, "other tracks untouched");
            assertEq(m.step, _hash(c, 0) % 16);
        }
    }

    function test_WhaleBuyFillsEveryKWithRotation() public pure {
        for (uint256 k = 3; k <= 8; ++k) {
            uint32 c = _find(k % 4, k, 99);
            uint256 h = _hash(c, 0);
            (S.State memory a, S.Mutation memory m) = change(_stateBefore(c), input(true, 250 ether, 0));
            uint16 expected = _euclid(k, (h >> 32) % 16);
            assertEq(m.track, k % 4);
            assertEq(m.dropMask, expected);
            assertEq(uint16(a.pattern >> (uint256(m.track) * 16)), expected, "track replaced");
            assertEq(a.pattern | (uint64(0xffff) << (uint256(m.track) * 16)), type(uint64).max, "others untouched");
        }
    }

    function test_WhaleBuyRotationWraps() public pure {
        // rot 15 wraps every hit except one past bit 15; rot 0 is the unrotated base.
        for (uint256 rot = 0; rot < 16; rot += 15) {
            uint32 c = _find(1, 0, rot);
            uint256 h = _hash(c, 0);
            uint256 k = 3 + (h >> 24) % 6;
            (, S.Mutation memory m) = change(_stateBefore(c), input(true, 100 ether, 0));
            assertEq(m.dropMask, _euclid(k, rot));
        }
    }

    function test_WhaleBassStillUsesStepAndMovementUnchanged() public pure {
        uint32 c = _find(2, 0, 99);
        S.State memory s = _stateBefore(c);
        (S.State memory a, S.Mutation memory m) = change(s, input(true, 100 ether, -600));
        assertEq(m.step, _hash(c, -600) % 16);
        assertEq(m.bassNote, 11); // 1 + (600 / 60) % 15
        assertEq(uint8((a.bass >> (uint256(m.step) * 4)) & 15), 11);
        assertEq(a.root, 4);
        assertEq(m.movementPatternId, 1);
    }

    function test_NonWhaleHasNoDropMask() public pure {
        (, S.Mutation memory m) = change(S.initial(), input(true, 100 ether - 1, 0));
        assertFalse(m.whale);
        assertEq(m.dropMask, 0);
        assertEq(m.track, 0);
    }
}
