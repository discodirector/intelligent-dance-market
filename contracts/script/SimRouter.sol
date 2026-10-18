// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IERC20Minimal} from "v4-core/src/interfaces/external/IERC20Minimal.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";

/// @notice Sepolia rehearsal router (testnet only). Swaps / adds liquidity for msg.sender and settles
///         both currencies inside the unlock callback; the caller pays via ERC20 allowance.
contract SimRouter is IUnlockCallback {
    using TransientStateLibrary for IPoolManager;

    IPoolManager public immutable manager;

    error OnlyManager();
    error TransferFailed();

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    /// @param amountSpecified v4 convention: negative = exact input, positive = exact output.
    function swap(PoolKey calldata key, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96)
        external
        returns (BalanceDelta delta)
    {
        bytes memory res = manager.unlock(
            abi.encode(
                msg.sender,
                key,
                false,
                SwapParams(zeroForOne, amountSpecified, sqrtPriceLimitX96),
                int24(0),
                int24(0),
                int256(0)
            )
        );
        delta = abi.decode(res, (BalanceDelta));
    }

    function addLiquidity(PoolKey calldata key, int24 tickLower, int24 tickUpper, int256 liquidityDelta)
        external
        returns (BalanceDelta delta)
    {
        bytes memory res = manager.unlock(
            abi.encode(msg.sender, key, true, SwapParams(false, 0, 0), tickLower, tickUpper, liquidityDelta)
        );
        delta = abi.decode(res, (BalanceDelta));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(manager)) revert OnlyManager();
        (
            address payer,
            PoolKey memory key,
            bool modify,
            SwapParams memory params,
            int24 tickLower,
            int24 tickUpper,
            int256 liquidityDelta
        ) = abi.decode(data, (address, PoolKey, bool, SwapParams, int24, int24, int256));
        BalanceDelta delta;
        if (modify) {
            (delta,) = manager.modifyLiquidity(key, ModifyLiquidityParams(tickLower, tickUpper, liquidityDelta, 0), "");
        } else {
            delta = manager.swap(key, params, "");
        }
        _settle(key.currency0, payer);
        _settle(key.currency1, payer);
        return abi.encode(delta);
    }

    function _settle(Currency currency, address payer) private {
        int256 d = manager.currencyDelta(address(this), currency);
        if (d < 0) {
            manager.sync(currency);
            if (!IERC20Minimal(Currency.unwrap(currency)).transferFrom(payer, address(manager), uint256(-d))) {
                revert TransferFailed();
            }
            manager.settle();
        } else if (d > 0) {
            manager.take(currency, payer, uint256(d));
        }
    }
}
