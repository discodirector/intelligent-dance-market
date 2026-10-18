// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {SequencerTestBase} from "./SequencerState.t.sol";
import {SequencerState as S} from "../src/SequencerState.sol";

/// @dev Measures only the rule increment over relative+accumulate; callback/log costs are measured separately.
contract TransitionGasMeter {
    function measure(S.State memory s, S.Input memory x, S.Thresholds memory t, bool drop)
        external
        view
        returns (uint256 used, bytes memory result)
    {
        uint256 start = gasleft();
        S.Mutation memory m;
        if (drop) (s, m) = S.mutateV2(s, x, t);
        else (s, m) = S.mutateRelativeAcc(s, x, t);
        used = start - gasleft();
        result = abi.encode(s, m);
    }
}

contract SequencerGasV2Test is SequencerTestBase {
    function test_GasHeatDropIncrement() public {
        TransitionGasMeter meter = new TransitionGasMeter();
        for (uint256 i; i < 3; ++i) {
            S.State memory s = S.initialV2();
            s.swapCount = 10;
            s.lastTs = 1_799_999_999;
            s.heat = 7;
            if (i == 1) s.pattern = type(uint64).max;
            S.Input memory x = input(i != 2, UNIT, 0);
            (uint256 base, bytes memory a) = meter.measure(s, x, v2Thresholds(x.tick), false);
            (uint256 v2, bytes memory b) = meter.measure(s, x, v2Thresholds(x.tick), true);
            emit log_named_uint(
                i == 0
                    ? "heat/drop increment normal buy"
                    : i == 1 ? "heat/drop increment saturated buy" : "heat/drop increment sell",
                v2 - base
            );
            assertTrue(a.length == b.length && a.length > 0);
            assertGe(v2, base);
            assertLe(v2 - base, 600);
        }
    }
}
