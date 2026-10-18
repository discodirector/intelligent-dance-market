// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {SequencerTestBase} from "./SequencerState.t.sol";
import {SequencerState as S} from "../src/SequencerState.sol";

/// @dev Every output is produced by the same Solidity transition used by afterSwap.
contract VectorsTest is SequencerTestBase {
    function words(uint256 a, uint256 b) internal pure returns (string memory) {
        return string.concat('{"slot0":"', vm.toString(a), '","slot1":"', vm.toString(b), '"}');
    }

    function vector(S.State memory s, S.Input memory x) internal pure returns (string memory json, S.State memory a) {
        return vectorVersion(s, x, false);
    }

    function vectorVersion(S.State memory s, S.Input memory x, bool v2)
        internal
        pure
        returns (string memory json, S.State memory a)
    {
        (uint256 b0, uint256 b1) = S.encode(s);
        S.Mutation memory m;
        (a, m) = v2 ? S.mutateV2(s, x, thresholds()) : change(s, x);
        (uint256 a0, uint256 a1) = S.encode(a);
        string memory ins = string.concat(
            '{"isBuy":',
            vm.toString(x.isBuy),
            ',"imdAmt":"',
            vm.toString(x.imdAmt),
            '","tick":',
            vm.toString(int256(x.tick)),
            ',"blockNumber":"',
            vm.toString(x.blockNumber),
            '","timestamp":',
            vm.toString(x.timestamp),
            "}"
        );
        string memory movement = m.whale
            ? string.concat(
                '{"patternId":',
                vm.toString(m.movementPatternId),
                ',"root":',
                vm.toString(m.movementRoot),
                ',"swapCount":',
                vm.toString(a.swapCount),
                "}"
            )
            : "null";
        string memory drop = m.whale
            ? string.concat(
                '{"track":',
                vm.toString(m.track),
                ',"fill":',
                vm.toString(x.isBuy),
                ',"mask":',
                vm.toString(m.dropMask),
                "}"
            )
            : "null";
        string memory ev = string.concat(
            '{"sender":"0x0000000000000000000000000000000000001234","swapCount":',
            vm.toString(a.swapCount),
            ',"track":',
            vm.toString(m.track),
            ',"step":',
            vm.toString(m.step),
            ',"on":',
            vm.toString(x.isBuy),
            ',"bassNote":',
            vm.toString(m.bassNote),
            ',"isBuy":',
            vm.toString(x.isBuy),
            ',"imdAmount":"',
            vm.toString(x.imdAmt),
            '","tick":',
            vm.toString(int256(x.tick)),
            ',"slot0":"',
            vm.toString(a0),
            '","slot1":"',
            vm.toString(a1),
            '","movement":',
            movement,
            ',"drop":',
            drop,
            "}"
        );
        if (v2) {
            string memory complete = completeJson(a, m);
            string memory acc = accumulationJson(m);
            // Replace the final brace to preserve the existing v1 schema fields verbatim.
            bytes memory prefix = bytes(ev);
            assembly ("memory-safe") { mstore(prefix, sub(mload(prefix), 1)) }
            ev = string.concat(
                string(prefix), ',"whale":', vm.toString(m.whale), acc, ',"trackComplete":', complete, "}"
            );
        }
        json = string.concat(
            '{"before":', words(b0, b1), ',"input":', ins, ',"after":', words(a0, a1), ',"event":', ev, "}"
        );
    }

    function completeJson(S.State memory a, S.Mutation memory m) internal pure returns (string memory) {
        if (!m.completed) return "null";
        string memory identity = string.concat(
            '{"trackNo":',
            vm.toString(a.trackNo),
            ',"patternId":',
            vm.toString(a.patternId),
            ',"root":',
            vm.toString(a.root)
        );
        string memory snapshot =
            string.concat(',"slot0":"', vm.toString(m.snapshot0), '","slot1":"', vm.toString(m.snapshot1));
        return string.concat(
            identity, snapshot, '","swapCount":', vm.toString(a.swapCount), ',"seed":"', vm.toString(a.pattern), '"}'
        );
    }

    function accumulationJson(S.Mutation memory m) internal pure returns (string memory) {
        if (m.whale) return "";
        return string.concat(
            ',"fromTrack":',
            vm.toString(m.fromTrack),
            ',"writeStep":',
            vm.toString(m.writeStep),
            ',"promoted":',
            vm.toString(m.promoted),
            ',"noop":',
            vm.toString(m.noop)
        );
    }

    /// @dev First swapCount whose tick-0 hash selects `track` (9 = any), `k` (0 = any) and `rot` (99 = any).
    function whaleCount(uint256 track, uint256 k, uint256 rot) internal pure returns (uint32) {
        for (uint32 c = 1; c < 50_000; ++c) {
            uint256 h = uint256(keccak256(abi.encodePacked(c, int24(0), uint64(20_000_000))));
            if (track != 9 && (h >> 16) % 4 != track) continue;
            if (k != 0 && 3 + (h >> 24) % 6 != k) continue;
            if (rot != 99 && (h >> 32) % 16 != rot) continue;
            return c;
        }
        revert("no hash");
    }

    function test_GenerateVectors() public {
        string memory all = "[";
        uint256 count;
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
        // 26 independent exact threshold cases, both buy/sell and signed ticks.
        for (uint256 i; i < 26; ++i) {
            S.State memory s = S.initial();
            s.bass = 0xfedcba9876543210;
            (string memory item,) = vector(s, input(i % 2 == 0, amounts[i / 2], int24(int256(i) * 60 - 900)));
            all = string.concat(all, count++ == 0 ? "" : ",", item);
        }
        // A full page, then one following swap: sells, whales, same-block swaps and capped intervals.
        S.State memory running = S.initial();
        for (uint256 i; i < 65; ++i) {
            S.Input memory x =
                input(i % 3 != 0, i == 63 ? uint128(100 ether) : amounts[i % 13], int24(int256(i) * 37 - 1200));
            x.blockNumber = uint64(20_000_000 + i / 2);
            x.timestamp = uint40(1_800_000_000 + (i / 2) * 4000);
            string memory item;
            (item, running) = vector(running, x);
            all = string.concat(all, ",", item);
            ++count;
        }
        // Mode boundaries, signed truncation and pressure extrema.
        int32[12] memory ps = [int32(7466), 7467, -1066, -1067, -7466, -7467, 1066, 1067, -17, -15, -16000, 16000];
        for (uint256 i; i < 12; ++i) {
            S.State memory s = S.initial();
            s.pressure = ps[i];
            (string memory item,) = vector(s, input(i < 4 || i == 8 || i == 11, 1 ether, -60));
            all = string.concat(all, ",", item);
            ++count;
        }
        // Explicit uint32 max EMA, timestamp wrap, min/max ticks and counter/page wraps.
        for (uint256 i; i < 13; ++i) {
            S.State memory s = S.initial();
            S.Input memory x = input(true, 100 ether, 0);
            if (i == 0) s.intervalEma = type(uint32).max;
            if (i == 1) {
                s.intervalEma = type(uint32).max;
                s.swapCount = 1;
            }
            if (i == 2) {
                s.lastTs = type(uint40).max;
                s.swapCount = 1;
                x.timestamp = 0;
            }
            if (i == 3) x.tick = type(int24).min;
            if (i == 4) x.tick = type(int24).max;
            if (i == 5) {
                s.swapCount = type(uint32).max;
                s.patternId = type(uint32).max;
            }
            if (i == 6) {
                s.patternId = type(uint32).max;
                s.swapCount = 63;
            }
            if (i == 7) {
                s.patternId = type(uint32).max;
                x.imdAmt = 100 ether - 1;
                s.swapCount = 63;
            }
            if (i == 8) x.timestamp = 0;
            if (i == 9) {
                s.swapCount = 1;
                s.lastTs = x.timestamp;
                s.intervalEma = 0;
            }
            if (i == 10) {
                x.blockNumber = type(uint64).max;
                s.releaseCount = type(uint32).max;
            }
            if (i == 11) {
                x.imdAmt = type(uint128).max;
                s.bass = type(uint64).max;
                x.isBuy = false;
            }
            if (i == 12) {
                s.swapCount = 38;
                s.intervalEma = 0;
                x.imdAmt = 1 ether;
            }
            (string memory item,) = vector(s, x);
            all = string.concat(all, ",", item);
            ++count;
        }
        // SPEC §3.3.8 whale drop/fill: every k = 3..8, rotation 0 and wrap (15), a sell wipe on every track,
        // a fill over an existing pattern, and a sell on an already-empty track.
        for (uint256 i; i < 14; ++i) {
            uint32 c;
            bool buy = true;
            if (i < 6) {
                c = whaleCount(i % 4, 3 + i, 99);
            } else if (i == 6) {
                c = whaleCount(9, 0, 0);
            } else if (i == 7) {
                c = whaleCount(9, 0, 15);
            } else if (i < 12) {
                c = whaleCount(i - 8, 0, 99);
                buy = false;
            } else {
                c = whaleCount(9, 0, 8);
            }
            S.State memory s = S.initial();
            s.swapCount = c - 1;
            s.lastTs = 1_799_999_000;
            s.pattern = i == 13 ? 0 : (i == 12 ? 0x0f0f_f0f0_3c3c_c3c3 : type(uint64).max);
            if (i == 13) buy = false;
            s.bass = 0x0123456789abcdef;
            (string memory item,) = vector(s, input(buy, i % 2 == 0 ? 100 ether : 431.5 ether, 0));
            all = string.concat(all, ",", item);
            ++count;
        }
        all = string.concat(all, "]");
        assertEq(count, 130);
        vm.writeJson(all, string.concat(vm.projectRoot(), "/../spec/vectors.json"));
    }

    // External fixture entry prevents the IR optimizer from inlining the large JSON formatter into each loop.
    function vectorV2(S.State memory s, S.Input memory x) external pure returns (string memory, S.State memory) {
        return vectorVersion(s, x, true);
    }

    function appendV2(string memory all, string memory name, S.State memory s, S.Input memory x)
        internal
        returns (string memory, S.State memory a)
    {
        string memory item;
        (item, a) = this.vectorV2(s, x);
        // Names are controlled fixtures, never user input.
        bytes memory body = bytes(item);
        for (uint256 i; i + 1 < body.length; ++i) {
            body[i] = body[i + 1];
        }
        assembly ("memory-safe") { mstore(body, sub(mload(body), 1)) }
        vm.writeLine(
            string.concat(vm.projectRoot(), "/../spec/vectors-v2.json"),
            string.concat(all, '{"name":"', name, '",', string(body))
        );
        return (",", a);
    }

    function test_GenerateVectorsV2() public {
        vm.writeFile(string.concat(vm.projectRoot(), "/../spec/vectors-v2.json"), "");
        string memory all = "[";
        // Every exact relative boundary, including dust and the absolute whale boundary.
        int256[8] memory offsets = [int256(-9), -8, 9, 10, 24, 25, -100, 100];
        for (uint256 i; i < 16; ++i) {
            S.State memory s = S.initialV2();
            s.pattern = 0;
            s.sizeLogEma = uint16(uint256(int256(S.log2Fixed(1 ether)) - offsets[i / 2]));
            (all,) = appendV2(all, "relative-boundary", s, input(i % 2 == 0, 1 ether, -120));
        }
        // All 16 column occupancy combinations, for every classified track and both sides.
        // Include arbitrary anchor bass, releaseCount and nonzero trackNo in each snapshot.
        for (uint256 t; t < 4; ++t) {
            for (uint256 column; column < 16; ++column) {
                for (uint256 side; side < 2; ++side) {
                    S.State memory s = S.initialV2();
                    s.swapCount = 17;
                    s.lastTs = 1_799_999_999;
                    s.bass = 0xfedcba9876543210;
                    s.trackNo = 7;
                    s.releaseCount = 99;
                    int256 r = t == 2 ? int256(-9) : t == 3 ? int256(0) : t == 1 ? int256(10) : int256(25);
                    s.sizeLogEma = uint16(uint256(int256(S.log2Fixed(1 ether)) - r));
                    uint256 step = uint256(keccak256(abi.encodePacked(uint32(18), int24(0), uint64(20_000_000)))) % 16;
                    s.pattern = 0;
                    for (uint256 row; row < 4; ++row) {
                        if (column & (1 << row) != 0) s.pattern |= uint64(1) << (row * 16 + step);
                    }
                    (all,) = appendV2(all, "accumulation-column", s, input(side == 0, 1 ether, 0));
                }
            }
        }
        // Circular scan: every possible available cell, including wrap past step 15.
        for (uint256 st; st < 16; ++st) {
            S.State memory s = S.initialV2();
            s.pattern = type(uint64).max ^ (uint64(1) << (32 + st));
            s.sizeLogEma = 1100; // dust-relative hat; occupied column climbs then scans hat
            (all,) = appendV2(all, "scan-wrap", s, input(true, 1 ether, 0));
        }
        // Saturation 47 -> 48 (post-write popcount), frozen row below saturation, 3599 vs 3600,
        // backwards clock, sell cooling, and malformed maximum packed fields must never revert.
        for (uint256 i; i < 18; ++i) {
            S.State memory s = S.initialV2();
            S.Input memory x = input(true, 1 ether, 0);
            s.swapCount = 63;
            s.lastTs = x.timestamp - 1;
            s.pattern = type(uint64).max;
            s.bass = type(uint64).max;
            s.heat = 15;
            if (i == 0) {
                s.pattern = 0x0000ffffffffffff;
                s.heat = 0;
            }
            if (i == 1) {
                s.pattern = 0x0000ffffffffffff;
                s.heat = 14;
            }
            if (i == 2) {
                s.pattern = 0xffff;
                s.sizeLogEma = 0;
            }
            if (i == 3) x.timestamp = s.lastTs + 3599;
            if (i == 4) x.timestamp = s.lastTs + 3600;
            if (i == 5) x.timestamp = s.lastTs - 1;
            if (i == 6) x.isBuy = false;
            if (i == 7) {
                x.isBuy = false;
                s.heat = 0;
            }
            if (i == 8) x.imdAmt = 100 ether;
            if (i == 9) {
                x.imdAmt = 100 ether;
                s.heat = 16;
            }
            if (i == 10) {
                x.imdAmt = 100 ether;
                x.isBuy = false;
            }
            if (i == 11) {
                s.trackNo = type(uint16).max;
                s.patternId = type(uint32).max;
                s.swapCount = type(uint32).max;
            }
            if (i == 12) {
                s.heat = 255;
                s.sizeLogEma = type(uint16).max;
            }
            if (i == 13) {
                s.intervalEma = type(uint32).max;
                x.tick = type(int24).min;
            }
            if (i == 14) {
                s.intervalEma = type(uint32).max;
                s.swapCount = 0;
                x.tick = type(int24).max;
            }
            if (i == 15) {
                x.imdAmt = 0;
                s.heat = 0;
            }
            if (i == 16) {
                x.imdAmt = type(uint128).max;
                x.blockNumber = type(uint64).max;
            }
            if (i == 17) {
                s.lastTs = type(uint40).max;
                x.timestamp = 0;
            }
            (all,) = appendV2(all, string.concat("edge-", vm.toString(i)), s, x);
        }
        // Exercise every curated kick/snare combination using the real transition hash seed picker.
        for (uint256 kick; kick < 6; ++kick) {
            for (uint256 snare; snare < 4; ++snare) {
                uint32 count = 1;
                for (;; ++count) {
                    uint256 h = uint256(keccak256(abi.encodePacked(count, int24(0), uint64(20_000_000))));
                    if (((h >> 64) & 255) % 6 == kick && ((h >> 72) & 3) == snare) break;
                }
                S.State memory s = S.initialV2();
                s.swapCount = count - 1;
                s.lastTs = 1_799_999_999;
                s.pattern = type(uint64).max;
                s.heat = 15;
                (all,) = appendV2(all, "curated-seed", s, input(true, 1 ether, 0));
            }
        }
        // A continuous live buy-heavy run, including multiple finished tracks and seeded next tracks.
        S.State memory running = S.initialV2();
        for (uint256 i; i < 180; ++i) {
            S.Input memory x = input(true, 1 ether, int24(int256(i) * 61 - 3000));
            x.timestamp += uint40(i * 6);
            x.blockNumber += uint64(i);
            (all, running) = appendV2(all, "live-heat-build", running, x);
        }
        vm.writeLine(string.concat(vm.projectRoot(), "/../spec/vectors-v2.json"), "]");
    }
}
