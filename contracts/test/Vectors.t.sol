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
        (uint256 b0, uint256 b1) = S.encode(s);
        S.Mutation memory m;
        (a, m) = change(s, x);
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
                vm.toString(a.root),
                ',"swapCount":',
                vm.toString(a.swapCount),
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
            "}"
        );
        json = string.concat(
            '{"before":', words(b0, b1), ',"input":', ins, ',"after":', words(a0, a1), ',"event":', ev, "}"
        );
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
        all = string.concat(all, "]");
        assertEq(count, 116);
        vm.writeJson(all, string.concat(vm.projectRoot(), "/../spec/vectors.json"));
    }
}
