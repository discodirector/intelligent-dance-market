// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IERC20Minimal} from "v4-core/src/interfaces/external/IERC20Minimal.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

/// @dev Test-only router: exercises real swaps and settles both currencies during unlock.
///      Native ETH is paid from the router's own balance (fund it with vm.deal) and taken to the payer.
contract PoolRouter is IUnlockCallback {
    using TransientStateLibrary for IPoolManager;
    using CurrencyLibrary for Currency;

    IPoolManager public immutable manager;

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    function liquidity(PoolKey memory key, int256 amount) external {
        liquidityRange(key, -600, 600, amount);
    }

    function liquidityRange(PoolKey memory key, int24 lower, int24 upper, int256 amount) public {
        // The range rides in the unused swap params: zeroForOne=false, amountSpecified=lower, limit=upper.
        manager.unlock(
            abi.encode(
                msg.sender, key, true, amount, SwapParams(false, lower, uint160(uint24(upper))), uint256(0), false
            )
        );
    }

    function swap(PoolKey memory key, SwapParams memory params) external returns (BalanceDelta) {
        return abi.decode(
            manager.unlock(abi.encode(msg.sender, key, false, int256(0), params, uint256(1), false)), (BalanceDelta)
        );
    }

    function batch(PoolKey memory key, SwapParams memory params, uint256 count, bool alternate) external {
        manager.unlock(abi.encode(msg.sender, key, false, int256(0), params, count, alternate));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "only manager");
        (
            address payer,
            PoolKey memory key,
            bool modify,
            int256 amount,
            SwapParams memory params,
            uint256 count,
            bool alternate
        ) = abi.decode(data, (address, PoolKey, bool, int256, SwapParams, uint256, bool));
        BalanceDelta last;
        if (modify) {
            int24 lower = int24(params.amountSpecified);
            int24 upper = int24(uint24(params.sqrtPriceLimitX96));
            (last,) = manager.modifyLiquidity(key, ModifyLiquidityParams(lower, upper, amount, bytes32(0)), "");
        } else {
            for (uint256 i; i < count; ++i) {
                last = manager.swap(key, params, "");
                if (alternate) {
                    params.zeroForOne = !params.zeroForOne;
                    // Open price limits for the next direction in these small test swaps (any start price).
                    params.sqrtPriceLimitX96 =
                        params.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
                }
            }
        }
        _settle(key.currency0, payer);
        _settle(key.currency1, payer);
        return abi.encode(last);
    }

    function _settle(Currency currency, address payer) private {
        int256 delta = manager.currencyDelta(address(this), currency);
        if (delta < 0) {
            manager.sync(currency);
            if (currency.isAddressZero()) {
                manager.settle{value: uint256(-delta)}();
                return;
            }
            require(IERC20Minimal(Currency.unwrap(currency)).transferFrom(payer, address(manager), uint256(-delta)));
            manager.settle();
        } else if (delta > 0) {
            manager.take(currency, payer, uint256(delta));
        }
    }
}
