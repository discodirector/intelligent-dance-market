// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IERC20Minimal} from "v4-core/src/interfaces/external/IERC20Minimal.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {SequencerState} from "./SequencerState.sol";

/// @dev The few hook views the treasury needs; all exist on every SequencerHook version.
interface ISequencerHookView {
    function token() external view returns (address);
    function poolId() external view returns (PoolId);
    function raw() external view returns (uint256, uint256);
}

/// @title PulseTreasury
/// @notice Keeps the IDM track alive in silence. The launcher's fee share (native ETH and IDM) is sent here;
///         after 15 minutes without any swap, anyone may call pulse() and the treasury buys a hat-sized amount
///         of IDM with ETH. The buy is an ordinary swap of the IDM/ETH pool, so the SequencerHook writes it
///         into the grid like any other buy (and, on a saturated grid, adds heat).
///         Immutable: no owner, no admin, no upgrade, no withdrawal. Bought IDM stays here until burn().
///
/// @dev Cadence. pulse() needs (block.timestamp - hook.lastTs) >= PULSE_IDLE, and the pulse itself is a swap
///      that resets lastTs, so there is at most one pulse per 15-minute window. In total silence: one pulse every
///      15 min, 96 per day, at most 96 * MAX_PULSE = 0.192 ETH/day (and each pulse spends at most 1% of the
///      balance, so a quiet stretch drains it geometrically, never at once). Because 15 min < 3600 s, heat never resets
///      during pulsed silence: on a saturated grid each pulse adds 1 heat, so 16 pulses finish a track in
///      ~4 h of silence. Any real swap also resets lastTs and so postpones the next pulse; real trading
///      always takes precedence. The synth's 60-minute idle fade to a drone never starts while pulses run.
///
///      Size. amount = 2^((sizeLogEma - 24) / 16) in SequencerState.log2Fixed space (1/16 octave units),
///      i.e. 1.5 octaves under the market's size EMA. The hook files a non-whale swap as a hat when
///      log2Fixed(amount) - sizeLogEma < -8, so the pulse plays the quietest voice. The amount is then
///      clamped to [MIN_PULSE, MAX_PULSE] and to at most 1% of the ETH balance; below MIN_PULSE it reverts.
///      At MIN_PULSE the hat class needs sizeLogEma > L(MIN_PULSE) + 8 = 718; at the EMA floor (710) a
///      pulse files as glitch instead. The pool fee (1.25%) is paid like any other trader's.
///
///      MEV. Pulses are tiny (<= 0.002 ETH) and every leg pays the 1.25% pool fee, so sandwiching a pulse
///      costs the attacker ~2.5% of their own size for a profit bounded by the pulse's price impact: it is
///      unprofitable. sqrtPriceLimit bounds the worst case at a ~2% price move (the swap fills partially
///      at the limit and the unspent ETH stays here). The timing is public by design.
///
///      Transparency. The treasury calls PoolManager.swap itself, so Mutated.sender == address(this) for every
///      pulse; clients label these swaps as treasury pulses.
contract PulseTreasury is IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    /// @notice Minimum silence (seconds since the hook's lastTs) before a pulse.
    uint256 public constant PULSE_IDLE = 15 minutes;
    /// @notice Largest pulse, in wei of native ETH.
    uint256 public constant MAX_PULSE = 0.002 ether;
    /// @notice Dust floor: equals the hook's EMA floor (QuoteCalibration.EMA_FLOOR, L = 710).
    uint256 public constant MIN_PULSE = 0.000025 ether;
    /// @notice Pulse size offset under the size EMA, in 1/16 octave (24 = 1.5 octaves).
    uint256 public constant HAT_OFFSET = 24;
    /// @notice A pulse spends at most balance / BUDGET_DIVISOR (1%).
    uint256 public constant BUDGET_DIVISOR = 100;
    /// @notice sqrtPriceLimit = sqrtPrice * 9900 / 10000, so the price may fall at most 1 - 0.99^2 = 1.99%.
    uint256 public constant SQRT_PRICE_LIMIT_BPS = 9900;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    IPoolManager public immutable poolManager;
    ISequencerHookView public immutable hook;
    /// @notice IDM, currency1 of the pool (native ETH is currency0).
    address public immutable idm;
    PoolId public immutable poolId;
    uint24 private immutable fee;
    int24 private immutable tickSpacing;

    /// @dev Transient flag: set only for the duration of pulse(); guards reentry and the unlock callback.
    bytes32 private constant PULSING_SLOT = keccak256("PulseTreasury.pulsing");

    event Pulse(uint256 amountIn, uint256 amountOut, uint256 idleSec, uint8 heatBefore);
    event Burned(uint256 amount);

    error InvalidKey();
    error NotIdle(uint256 idleSec);
    error NoBudget();
    error OnlyPoolManager();
    error Reentrant();
    error NotPulsing();
    error NothingToBurn();

    /// @dev Deploy after launch: the hook must already be initialized on this exact pool.
    constructor(IPoolManager manager_, PoolKey memory key_, address hook_, address idm_) {
        if (
            address(manager_) == address(0) || idm_ == address(0) || Currency.unwrap(key_.currency0) != address(0)
                || Currency.unwrap(key_.currency1) != idm_ || address(key_.hooks) != hook_
                || ISequencerHookView(hook_).token() != idm_
                || PoolId.unwrap(ISequencerHookView(hook_).poolId()) != PoolId.unwrap(key_.toId())
        ) revert InvalidKey();
        poolManager = manager_;
        hook = ISequencerHookView(hook_);
        idm = idm_;
        poolId = key_.toId();
        fee = key_.fee;
        tickSpacing = key_.tickSpacing;
    }

    /// @notice Accepts ETH from anyone (fee payouts, donations). Empty body: safe under a 2300-gas stipend.
    /// @dev IDM arrives by plain ERC20 transfer and needs no hook here.
    receive() external payable {}

    /// @notice The pool key, rebuilt from immutables.
    function poolKey() public view returns (PoolKey memory) {
        return PoolKey(Currency.wrap(address(0)), Currency.wrap(idm), fee, tickSpacing, IHooks(address(hook)));
    }

    /// @notice Pulse size for a given size EMA (log2Fixed units) and ETH balance; 0 = no budget.
    function pulseSize(uint256 sizeLogEma, uint256 balance) public pure returns (uint256 amount) {
        amount = sizeLogEma > HAT_OFFSET ? exp2Fixed(sizeLogEma - HAT_OFFSET) : 0;
        if (amount < MIN_PULSE) amount = MIN_PULSE;
        if (amount > MAX_PULSE) amount = MAX_PULSE;
        uint256 cap = balance / BUDGET_DIVISOR;
        if (amount > cap) amount = cap;
        if (amount < MIN_PULSE) amount = 0;
    }

    /// @notice What pulse() would do now: keepers and clients read this before sending.
    function nextPulse() public view returns (bool ready, uint256 amount, uint256 idleSec, uint8 heat) {
        (uint256 a, uint256 b) = hook.raw();
        // SPEC §3.2 packed layout: lastTs = slot0[160..200), sizeLogEma = slot1[152..168), heat = slot1[168..176).
        uint256 lastTs = uint40(a >> 160);
        idleSec = block.timestamp >= lastTs ? block.timestamp - lastTs : 0;
        heat = uint8(b >> 168);
        amount = pulseSize(uint16(b >> 152), address(this).balance);
        ready = idleSec >= PULSE_IDLE && amount > 0;
    }

    /// @notice Buys a hat-sized amount of IDM after >= 15 min of silence. Callable by anyone.
    function pulse() external returns (uint256 amountIn, uint256 amountOut) {
        if (_pulsing()) revert Reentrant();
        (, uint256 amount, uint256 idleSec, uint8 heat) = nextPulse();
        if (idleSec < PULSE_IDLE) revert NotIdle(idleSec);
        if (amount == 0) revert NoBudget();
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolId);
        uint160 limit = uint160(uint256(sqrtPriceX96) * SQRT_PRICE_LIMIT_BPS / 10_000);
        if (limit <= TickMath.MIN_SQRT_PRICE) limit = TickMath.MIN_SQRT_PRICE + 1;
        _setPulsing(true);
        (amountIn, amountOut) = abi.decode(poolManager.unlock(abi.encode(amount, limit)), (uint256, uint256));
        _setPulsing(false);
        emit Pulse(amountIn, amountOut, idleSec, heat);
    }

    /// @dev Only the PoolManager, and only inside this contract's own pulse().
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        if (!_pulsing()) revert NotPulsing();
        (uint256 amount, uint160 limit) = abi.decode(data, (uint256, uint160));
        BalanceDelta d = poolManager.swap(poolKey(), SwapParams(true, -int256(amount), limit), "");
        uint256 paid = uint256(-int256(d.amount0()));
        uint256 got = uint256(int256(d.amount1()));
        poolManager.settle{value: paid}();
        poolManager.take(Currency.wrap(idm), address(this), got);
        return abi.encode(paid, got);
    }

    /// @notice Sends the treasury's whole IDM balance to 0x…dEaD. Callable by anyone.
    function burn() external returns (uint256 amount) {
        amount = IERC20Minimal(idm).balanceOf(address(this));
        if (amount == 0) revert NothingToBurn();
        require(IERC20Minimal(idm).transfer(DEAD, amount));
        emit Burned(amount);
    }

    /// @notice Inverse of SequencerState.log2Fixed on its grid: log2Fixed(exp2Fixed(l)) == l for l >= 64.
    function exp2Fixed(uint256 l) public pure returns (uint256) {
        uint256 m = l >> 4;
        uint256 v = 16 + (l & 15);
        if (m >= 4) return m - 4 >= 252 ? type(uint256).max : v << (m - 4);
        return v >> (4 - m);
    }

    /// @notice log2Fixed of an amount, exactly as the hook classifies it.
    function log2Fixed(uint128 amount) external pure returns (uint256) {
        return SequencerState.log2Fixed(amount);
    }

    function _pulsing() private view returns (bool on) {
        bytes32 slot = PULSING_SLOT;
        assembly ("memory-safe") {
            on := tload(slot)
        }
    }

    function _setPulsing(bool on) private {
        bytes32 slot = PULSING_SLOT;
        assembly ("memory-safe") {
            tstore(slot, on)
        }
    }
}
