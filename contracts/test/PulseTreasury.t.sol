// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {SequencerHook} from "../src/SequencerHook.sol";
import {SequencerToken} from "../src/SequencerToken.sol";
import {SequencerState as S} from "../src/SequencerState.sol";
import {QuoteCalibration as Q} from "../src/QuoteCalibration.sol";
import {PulseTreasury} from "../src/PulseTreasury.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {PoolRouter} from "./helpers/PoolRouter.sol";

/// @dev Tries to drive the treasury from inside someone else's unlock.
contract UnlockAttacker is IUnlockCallback {
    IPoolManager immutable manager;
    PulseTreasury immutable treasury;
    bool callPulse;

    constructor(IPoolManager m, PulseTreasury t) {
        manager = m;
        treasury = t;
    }

    function attack(bool pulse_) external {
        callPulse = pulse_;
        manager.unlock("");
    }

    function unlockCallback(bytes calldata) external returns (bytes memory) {
        if (callPulse) treasury.pulse();
        else treasury.unlockCallback(abi.encode(uint256(1e15), uint160(1)));
        return "";
    }
}

/// @dev IDM/ETH launch configuration: native ETH currency0, IDM currency1, the real v4 PoolManager and hook.
contract PulseTreasuryTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    bytes32 constant MUTATED =
        keccak256("Mutated(address,uint32,uint8,uint8,bool,uint8,bool,uint128,int24,uint256,uint256)");
    bytes32 constant COMPLETE = keccak256("TrackComplete(uint16,uint32,uint8,uint256,uint256,uint32,uint64)");
    bytes32 constant PULSE = keccak256("Pulse(uint256,uint256,uint256,uint8)");
    int256 constant LIQ = 1e26;

    PoolManager manager;
    SequencerHook hook;
    SequencerToken token;
    PoolRouter router;
    PoolKey key;
    PulseTreasury treasury;

    receive() external payable {}

    function setUp() public {
        vm.warp(1_800_000_000);
        vm.roll(20_000_000);
        manager = new PoolManager(address(this));
        token = new SequencerToken();
        hook = _deployHook();
        key = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(token)), 12500, 60, IHooks(address(hook)));
        router = new PoolRouter(manager);
        token.approve(address(router), type(uint256).max);
        vm.deal(address(router), 1e30);
        manager.initialize(key, uint160(1 << 96));
        router.liquidity(key, LIQ);
        treasury = new PulseTreasury(manager, key, address(hook), address(token));
        vm.deal(address(treasury), 1 ether);
    }

    function _deployHook() internal returns (SequencerHook) {
        bytes memory init = abi.encodePacked(
            type(SequencerHook).creationCode,
            abi.encode(manager, address(token), address(this), address(0), Q.T_HAT, Q.T_GLITCH, Q.T_SNARE)
        );
        bytes32 hash = keccak256(init);
        for (uint256 i; i < 300_000; ++i) {
            address predicted =
                address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), bytes32(i), hash)))));
            if ((uint160(predicted) & Hooks.ALL_HOOK_MASK) == 0x3040 && predicted.code.length == 0) {
                return new SequencerHook{salt: bytes32(i)}(
                    manager, address(token), address(this), address(0), Q.T_HAT, Q.T_GLITCH, Q.T_SNARE
                );
            }
        }
        revert("salt search exhausted");
    }

    /// @dev A real trader's buy: resets the hook's lastTs.
    function _trade() internal {
        router.swap(key, SwapParams(true, -int256(uint256(0.01 ether)), uint160(1 << 95)));
    }

    function _store(S.State memory s) internal {
        (uint256 a, uint256 b) = S.encode(s);
        vm.store(address(hook), bytes32(0), bytes32(a));
        vm.store(address(hook), bytes32(uint256(1)), bytes32(b));
    }

    function _saturate(uint8 heat) internal {
        S.State memory s = hook.state();
        s.pattern = type(uint64).max;
        s.heat = heat;
        s.swapCount = 10;
        s.lastTs = uint40(block.timestamp);
        _store(s);
    }

    /// @dev Absolute from the hook's lastTs (via-IR may cache block.timestamp inside one test).
    function _idle() internal {
        vm.warp(uint256(hook.state().lastTs) + 15 minutes);
        vm.roll(vm.getBlockNumber() + 225);
    }

    // ---------------------------------------------------------------- constructor / constants

    function test_ConstantsMatchHookCalibration() public view {
        assertEq(treasury.MIN_PULSE(), Q.EMA_FLOOR);
        assertEq(S.log2Fixed(uint128(treasury.MIN_PULSE())), 710);
        assertEq(S.log2Fixed(uint128(treasury.MAX_PULSE())), 812);
        assertEq(treasury.PULSE_IDLE(), 900);
        assertLt(treasury.PULSE_IDLE(), 3600); // heat never resets during pulsed silence
        assertEq(treasury.MAX_PULSE() * (1 days / treasury.PULSE_IDLE()), 0.192 ether);
        assertEq(abi.encode(treasury.poolKey()), abi.encode(key));
        assertEq(address(treasury.hook()), address(hook));
        assertEq(treasury.idm(), address(token));
    }

    function test_ConstructorValidatesKey() public {
        PoolKey memory k = key;
        k.currency0 = Currency.wrap(address(0xBEEF));
        vm.expectRevert(PulseTreasury.InvalidKey.selector);
        new PulseTreasury(manager, k, address(hook), address(token));
        vm.expectRevert(PulseTreasury.InvalidKey.selector);
        new PulseTreasury(manager, key, address(hook), address(0xBEEF));
        k = key;
        k.fee = 3000; // another pool id than the hook's
        vm.expectRevert(PulseTreasury.InvalidKey.selector);
        new PulseTreasury(manager, k, address(hook), address(token));
        vm.expectRevert(PulseTreasury.InvalidKey.selector);
        new PulseTreasury(IPoolManager(address(0)), key, address(hook), address(token));
        k = key;
        k.hooks = IHooks(address(0x3040));
        vm.expectRevert(PulseTreasury.InvalidKey.selector);
        new PulseTreasury(manager, k, address(hook), address(token));
    }

    // ---------------------------------------------------------------- idle gate

    function test_PulseBeforeIdleReverts() public {
        _trade();
        uint256 t0 = 1_800_000_000;
        vm.warp(t0 + 15 minutes - 1);
        vm.expectRevert(abi.encodeWithSelector(PulseTreasury.NotIdle.selector, uint256(15 minutes - 1)));
        treasury.pulse();
        (bool ready,,,) = treasury.nextPulse();
        assertFalse(ready);
        vm.warp(t0 + 15 minutes);
        (ready,,,) = treasury.nextPulse();
        assertTrue(ready);
        treasury.pulse();
        // The pulse is a swap: the next one waits another 15 minutes.
        vm.expectRevert(abi.encodeWithSelector(PulseTreasury.NotIdle.selector, uint256(0)));
        treasury.pulse();
    }

    function test_RealTradePostponesPulse() public {
        uint256 t0 = 1_800_000_000; // setUp's warp; a literal, since via-IR re-reads block.timestamp
        _trade();
        vm.warp(t0 + 14 minutes);
        _trade();
        vm.warp(t0 + 28 minutes);
        vm.expectRevert(abi.encodeWithSelector(PulseTreasury.NotIdle.selector, uint256(14 minutes)));
        treasury.pulse();
    }

    // ---------------------------------------------------------------- the buy as the hook sees it

    function test_PulseIsHatBuyRecordedByHook() public {
        _trade();
        _idle();
        S.State memory before = hook.state();
        uint256 ethBefore = address(treasury).balance;
        uint256 want = treasury.pulseSize(before.sizeLogEma, ethBefore);
        vm.recordLogs();
        (uint256 amountIn, uint256 amountOut) = treasury.pulse();
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(amountIn, want);
        assertEq(address(treasury).balance, ethBefore - amountIn);
        assertEq(token.balanceOf(address(treasury)), amountOut);
        assertGt(amountOut, 0);

        (, int24 tick,,) = IPoolManager(address(manager)).getSlot0(key.toId());
        (S.State memory expected, S.Mutation memory m) = S.mutateV2(
            before,
            S.Input(true, uint128(amountIn), tick, uint64(block.number), uint40(block.timestamp)),
            S.Thresholds(Q.T_HAT, Q.T_GLITCH, Q.T_SNARE, S.whaleThreshold(tick, true))
        );
        assertEq(abi.encode(hook.state()), abi.encode(expected));
        assertFalse(m.whale);
        assertEq(m.fromTrack, 2, "hat class");
        assertLt(int256(S.log2Fixed(uint128(amountIn))) - int256(uint256(before.sizeLogEma)), -8);
        assertEq(hook.state().lastTs, block.timestamp);

        bool sawMutated;
        bool sawPulse;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(hook) && logs[i].topics[0] == MUTATED) {
                assertEq(logs[i].topics[1], bytes32(uint256(uint160(address(treasury)))), "sender = treasury");
                (,,,,, uint128 quoteAmount,,,) =
                    abi.decode(logs[i].data, (uint8, uint8, bool, uint8, bool, uint128, int24, uint256, uint256));
                assertEq(quoteAmount, amountIn);
                sawMutated = true;
            }
            if (logs[i].emitter == address(treasury) && logs[i].topics[0] == PULSE) {
                assertEq(logs[i].data, abi.encode(amountIn, amountOut, uint256(15 minutes), before.heat));
                sawPulse = true;
            }
        }
        assertTrue(sawMutated && sawPulse);
    }

    function test_PulseOnSaturatedGridAddsHeat() public {
        _saturate(5);
        _idle();
        treasury.pulse();
        assertEq(hook.state().heat, 6);
    }

    function test_SixteenPulsesInSilenceCompleteTrack() public {
        _saturate(0);
        uint16 trackNo = hook.state().trackNo;
        for (uint256 i; i < 15; ++i) {
            _idle();
            treasury.pulse();
            assertEq(hook.state().heat, i + 1, "heat climbs, no silence reset at 15 min");
        }
        _idle();
        vm.recordLogs();
        treasury.pulse();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool completed;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(hook) && logs[i].topics[0] == COMPLETE) completed = true;
        }
        assertTrue(completed);
        assertEq(hook.state().heat, 0);
        assertEq(hook.state().trackNo, trackNo + 1);
        // 16 pulses * 15 min = 4 h of silence.
        assertEq(16 * treasury.PULSE_IDLE(), 4 hours);
    }

    function test_FirstSwapEverCanBeAPulse() public {
        // Fresh hook: lastTs = 0, so the treasury may open the pool's music itself.
        (bool ready,,,) = treasury.nextPulse();
        assertTrue(ready);
        treasury.pulse();
        assertEq(hook.state().swapCount, 1);
    }

    // ---------------------------------------------------------------- amount clamps

    function test_PulseSizeClamps() public view {
        // EMA high (upper clamp L(whale threshold): 881 at FDV 4 ETH, at most L(WHALE_MAX) = 1045): capped at MAX_PULSE.
        assertEq(treasury.pulseSize(1045, 10 ether), 0.002 ether);
        assertEq(treasury.pulseSize(881, 10 ether), 0.002 ether);
        assertEq(treasury.pulseSize(918, 10 ether), 0.002 ether);
        assertEq(treasury.pulseSize(854, 10 ether), 0.002 ether); // initial EMA
        // Mid: exactly 1.5 octaves under the EMA.
        uint256 mid = treasury.pulseSize(800, 10 ether);
        assertEq(S.log2Fixed(uint128(mid)), 776);
        assertLt(mid, 0.002 ether);
        // EMA low (floor 710): clamped up to MIN_PULSE.
        assertEq(treasury.pulseSize(710, 10 ether), Q.EMA_FLOOR);
        assertEq(treasury.pulseSize(0, 10 ether), Q.EMA_FLOOR);
        // Small balance: at most 1%.
        assertEq(treasury.pulseSize(918, 0.1 ether), 0.001 ether);
        // Dust: 1% under MIN_PULSE means no budget.
        assertEq(treasury.pulseSize(918, 0.0025 ether), 0.000025 ether);
        assertEq(treasury.pulseSize(918, 0.0025 ether - 1), 0);
        assertEq(treasury.pulseSize(918, 0), 0);
    }

    function testFuzz_Exp2FixedInvertsLog2Fixed(uint16 l) public view {
        l = uint16(bound(l, 64, 2047));
        assertEq(S.log2Fixed(uint128(treasury.exp2Fixed(l))), l);
    }

    /// @dev For every reachable EMA above 718 the pulse is filed as a hat (relative < -8), with ample budget.
    ///      The EMA upper clamp follows the FDV-scaled whale threshold: at most L(WHALE_MAX) = 1045.
    function testFuzz_HatClassAcrossEma(uint16 ema) public view {
        ema = uint16(bound(ema, 719, S.log2Fixed(Q.WHALE_MAX)));
        uint256 amount = treasury.pulseSize(ema, 10 ether);
        S.State memory s = S.initialV2();
        s.sizeLogEma = ema;
        s.swapCount = 5;
        (, S.Mutation memory m) = S.mutateV2(
            s,
            S.Input(true, uint128(amount), 0, 1, 1),
            S.Thresholds(Q.T_HAT, Q.T_GLITCH, Q.T_SNARE, S.whaleThreshold(0, true))
        );
        assertEq(m.fromTrack, 2);
    }

    function test_EmaAtFloorFilesGlitchNotHat() public view {
        uint256 amount = treasury.pulseSize(710, 10 ether);
        S.State memory s = S.initialV2();
        s.sizeLogEma = 710;
        s.swapCount = 5;
        (, S.Mutation memory m) = S.mutateV2(
            s,
            S.Input(true, uint128(amount), 0, 1, 1),
            S.Thresholds(Q.T_HAT, Q.T_GLITCH, Q.T_SNARE, S.whaleThreshold(0, true))
        );
        assertEq(m.fromTrack, 3);
    }

    function test_PulseHighEmaUsesMax() public {
        S.State memory s = hook.state();
        s.sizeLogEma = 918;
        _store(s);
        (uint256 amountIn,) = treasury.pulse();
        assertEq(amountIn, 0.002 ether);
    }

    function test_PulseLowEmaUsesMin() public {
        S.State memory s = hook.state();
        s.sizeLogEma = 720;
        _store(s);
        (uint256 amountIn,) = treasury.pulse();
        assertEq(amountIn, Q.EMA_FLOOR);
    }

    function test_PulseSmallBalanceUsesOnePercent() public {
        vm.deal(address(treasury), 0.05 ether);
        (uint256 amountIn,) = treasury.pulse();
        assertEq(amountIn, 0.0005 ether);
    }

    function test_PulseDustReverts() public {
        vm.deal(address(treasury), 0.0025 ether - 1);
        vm.expectRevert(PulseTreasury.NoBudget.selector);
        treasury.pulse();
        vm.deal(address(treasury), 0);
        vm.expectRevert(PulseTreasury.NoBudget.selector);
        treasury.pulse();
    }

    // ---------------------------------------------------------------- price limit

    function test_PriceLimitBoundsMoveAndKeepsUnspentEth() public {
        // Thin pool: a max pulse would move the price by far more than 2%.
        router.liquidity(key, -(LIQ - 5e16));
        S.State memory s = hook.state();
        s.sizeLogEma = 918;
        _store(s);
        (uint160 p0,,,) = IPoolManager(address(manager)).getSlot0(key.toId());
        uint256 ethBefore = address(treasury).balance;
        (uint256 amountIn, uint256 amountOut) = treasury.pulse();
        (uint160 p1,,,) = IPoolManager(address(manager)).getSlot0(key.toId());
        assertLt(amountIn, 0.002 ether, "partial fill");
        assertGt(amountOut, 0);
        assertEq(p1, uint160(uint256(p0) * 9900 / 10_000), "stopped at the limit");
        // Price (sqrtP^2) fell by at most 1.99%.
        assertGe(uint256(p1) * p1 * 10_000 / (uint256(p0) * p0), 9801 - 1);
        assertEq(address(treasury).balance, ethBefore - amountIn);
    }

    // ---------------------------------------------------------------- burn / receive

    function test_BurnSendsAllIdmToDead() public {
        treasury.pulse();
        token.transfer(address(treasury), 7 ether);
        uint256 bal = token.balanceOf(address(treasury));
        vm.expectEmit(address(treasury));
        emit PulseTreasury.Burned(bal);
        vm.prank(address(0xCAFE)); // anyone
        assertEq(treasury.burn(), bal);
        assertEq(token.balanceOf(address(treasury)), 0);
        assertEq(token.balanceOf(treasury.DEAD()), bal);
        vm.expectRevert(PulseTreasury.NothingToBurn.selector);
        treasury.burn();
    }

    function test_ReceivesEthUnderStipendAndIdm() public {
        uint256 before = address(treasury).balance;
        payable(address(treasury)).transfer(1 ether); // 2300-gas stipend, like a fee payout via transfer()
        (bool ok,) = address(treasury).call{value: 2 ether}("");
        assertTrue(ok);
        assertEq(address(treasury).balance, before + 3 ether);
        token.transfer(address(treasury), 5 ether);
        assertEq(token.balanceOf(address(treasury)), 5 ether);
    }

    // ---------------------------------------------------------------- callback safety

    function test_UnlockCallbackRejectsOthers() public {
        vm.expectRevert(PulseTreasury.OnlyPoolManager.selector);
        treasury.unlockCallback(abi.encode(uint256(1e15), uint160(1)));
        // Even the PoolManager cannot drive it outside the treasury's own pulse().
        vm.prank(address(manager));
        vm.expectRevert(PulseTreasury.NotPulsing.selector);
        treasury.unlockCallback(abi.encode(uint256(1e15), uint160(1)));
    }

    function test_CannotDriveTreasuryFromAnotherUnlock() public {
        UnlockAttacker attacker = new UnlockAttacker(manager, treasury);
        vm.expectRevert(); // OnlyPoolManager, wrapped by the PoolManager
        attacker.attack(false);
        vm.expectRevert(); // AlreadyUnlocked: a pulse can't run inside someone else's unlock
        attacker.attack(true);
        assertEq(address(treasury).balance, 1 ether);
    }

    // ---------------------------------------------------------------- gas

    function test_GasPulse() public {
        _trade();
        _idle();
        vm.cool(address(treasury));
        vm.cool(address(hook));
        vm.cool(address(manager));
        uint256 start = gasleft();
        treasury.pulse();
        uint256 used = start - gasleft();
        emit log_named_uint("pulse() gas (cold, normal grid)", used);
        assertLt(used, 200_000);
    }

    function test_GasPulseSaturated() public {
        _saturate(3);
        _idle();
        vm.cool(address(treasury));
        vm.cool(address(hook));
        vm.cool(address(manager));
        uint256 start = gasleft();
        treasury.pulse();
        uint256 used = start - gasleft();
        emit log_named_uint("pulse() gas (cold, saturated grid)", used);
        assertLt(used, 200_000);
    }
}
