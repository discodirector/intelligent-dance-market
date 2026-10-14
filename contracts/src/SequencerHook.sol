// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {SequencerState} from "./SequencerState.sol";

/// @notice One factory-created IDM/IMD pool; swaps compose music without moving funds.
/// @dev Implements IHooks directly like IMD launch examples; disabled callbacks always refuse.
contract SequencerHook is IHooks {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    // Exactly SPEC §3.2. Bindings follow these two words and never change during swaps.
    uint256 private slot0;
    uint256 private slot1;
    PoolId public poolId;
    bool public initialized;

    IPoolManager public immutable poolManager;
    address public immutable token;
    address public immutable factory;
    address public immutable imd;
    uint128 public immutable T_HAT;
    uint128 public immutable T_GLITCH;
    uint128 public immutable T_SNARE;
    uint128 public immutable T_KICK;
    uint160 public constant HOOK_FLAGS = 0x3040;
    uint24 public constant LP_FEE = 12500;
    int24 public constant TICK_SPACING = 60;

    error OnlyPoolManager();
    error InvalidConfiguration();
    error InvalidPool();
    error AlreadyInitialized();
    error HookNotEnabled();

    event Mutated(
        address indexed sender,
        uint32 indexed swapCount,
        uint8 track,
        uint8 step,
        bool on,
        uint8 bassNote,
        bool isBuy,
        uint128 imdAmount,
        int24 tick,
        uint256 slot0,
        uint256 slot1
    );
    event Movement(uint32 indexed patternId, uint8 root, uint32 swapCount);
    // Reserved ABI for stretch R7; there is no oracle callback or release mutation in this implementation.
    event TrackReleased(uint32 indexed releaseId, uint32 patternId, uint256 slot0, uint256 slot1);

    /// @dev No constructor chain-state reads: IMD rehearses construction in an empty EVM.
    constructor(
        IPoolManager manager_,
        address token_,
        address factory_,
        address imd_,
        uint128 hat_,
        uint128 glitch_,
        uint128 snare_,
        uint128 kick_
    ) {
        if (
            address(manager_) == address(0) || token_ == address(0) || factory_ == address(0) || imd_ == address(0)
                || token_ == imd_ || hat_ == 0 || hat_ >= glitch_ || glitch_ >= snare_ || snare_ >= kick_
        ) revert InvalidConfiguration();
        poolManager = manager_;
        token = token_;
        factory = factory_;
        imd = imd_;
        T_HAT = hat_;
        T_GLITCH = glitch_;
        T_SNARE = snare_;
        T_KICK = kick_;
        Hooks.validateHookPermissions(this, getHookPermissions());
    }

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        _;
    }

    function getHookPermissions() public pure returns (Hooks.Permissions memory p) {
        p.beforeInitialize = true;
        p.afterInitialize = true;
        p.afterSwap = true;
    }

    function _validateInitialization(address sender, PoolKey calldata key) private view {
        if (initialized) revert AlreadyInitialized();
        address a = Currency.unwrap(key.currency0);
        address b = Currency.unwrap(key.currency1);
        if (
            sender != factory || a >= b || address(key.hooks) != address(this) || key.fee != LP_FEE
                || key.tickSpacing != TICK_SPACING || !((a == token && b == imd) || (a == imd && b == token))
        ) revert InvalidPool();
    }

    function beforeInitialize(address sender, PoolKey calldata key, uint160)
        external
        view
        onlyPoolManager
        returns (bytes4)
    {
        _validateInitialization(sender, key);
        return IHooks.beforeInitialize.selector;
    }

    function afterInitialize(address sender, PoolKey calldata key, uint160, int24)
        external
        onlyPoolManager
        returns (bytes4)
    {
        _validateInitialization(sender, key);
        poolId = key.toId();
        initialized = true;
        (slot0, slot1) = SequencerState.encode(SequencerState.initial());
        return IHooks.afterInitialize.selector;
    }

    function afterSwap(address sender, PoolKey calldata key, SwapParams calldata, BalanceDelta delta, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, int128)
    {
        PoolId id = key.toId();
        if (!initialized || PoolId.unwrap(id) != PoolId.unwrap(poolId)) revert InvalidPool();
        bool seqIs0 = Currency.unwrap(key.currency0) == token;
        int256 imdDelta = seqIs0 ? int256(delta.amount1()) : int256(delta.amount0());
        bool isBuy = (seqIs0 ? delta.amount0() : delta.amount1()) > 0;
        uint128 amount = uint128(uint256(imdDelta < 0 ? -imdDelta : imdDelta));
        (, int24 tick,,) = poolManager.getSlot0(id);
        (SequencerState.State memory s, SequencerState.Mutation memory m) = SequencerState.mutate(
            SequencerState.decode(slot0, slot1),
            SequencerState.Input(isBuy, amount, tick, uint64(block.number), uint40(block.timestamp)),
            SequencerState.Thresholds(T_HAT, T_GLITCH, T_SNARE, T_KICK)
        );
        (slot0, slot1) = SequencerState.encode(s);
        if (m.whale) emit Movement(m.movementPatternId, s.root, s.swapCount);
        emit Mutated(sender, s.swapCount, m.track, m.step, isBuy, m.bassNote, isBuy, amount, tick, slot0, slot1);
        return (IHooks.afterSwap.selector, 0);
    }

    function state() external view returns (SequencerState.State memory) {
        return SequencerState.decode(slot0, slot1);
    }

    function raw() external view returns (uint256, uint256) {
        return (slot0, slot1);
    }

    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotEnabled();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotEnabled();
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotEnabled();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotEnabled();
    }

    function beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        external
        pure
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        revert HookNotEnabled();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotEnabled();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotEnabled();
    }
}
