// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {SequencerHook} from "../src/SequencerHook.sol";
import {SequencerToken} from "../src/SequencerToken.sol";
import {SequencerState as S} from "../src/SequencerState.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta, toBalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {HookMiner} from "v4-periphery/test/shared/HookMiner.sol";
import {PoolRouter} from "./helpers/PoolRouter.sol";
import {MockQuote} from "./helpers/MockQuote.sol";
import {QuoteCalibration as Q} from "../src/QuoteCalibration.sol";

/// @dev Nested call excludes Foundry isolation mode's transaction intrinsic/calldata gas.
contract CallbackGasMeter {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function measure(
        SequencerHook target,
        address pm,
        address sender,
        PoolKey memory k,
        SwapParams memory p,
        BalanceDelta d
    ) external returns (uint256 used) {
        vm.cool(address(target));
        vm.cool(pm);
        vm.prank(pm);
        uint256 start = gasleft();
        (bytes4 selector, int128 delta) = target.afterSwap(sender, k, p, d, "");
        used = start - gasleft();
        require(selector == IHooks.afterSwap.selector && delta == 0, "unexpected return");
    }
}

abstract contract SequencerHookTestBase is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    /// @dev Fixed address for the ERC20-quote suites; the launch suite uses native ETH (address(0)).
    address constant ERC20_QUOTE = 0x5F7Bb59365ce557C26dbcAa4EE9d39A4b95B7127;
    /// @dev 1 IMD at the 1/400 ETH calibration: a non-whale swap.
    uint128 constant UNIT = 0.0025 ether;
    bytes32 constant MUTATED =
        keccak256("Mutated(address,uint32,uint8,uint8,bool,uint8,bool,uint128,int24,uint256,uint256)");
    bytes32 constant MOVEMENT = keccak256("Movement(uint32,uint8,uint32)");
    bytes32 constant COMPLETE = keccak256("TrackComplete(uint16,uint32,uint8,uint256,uint256,uint32,uint64)");
    bytes32 constant ACCUMULATED = keccak256("Accumulated(uint32,uint8,uint8,bool,bool)");
    bytes32 constant DROP = keccak256("Drop(uint32,uint8,bool,uint16)");
    PoolManager manager;
    SequencerHook hook;
    SequencerToken token;
    MockQuote erc20;
    address QUOTE;
    PoolRouter router;
    PoolKey key;
    bytes32 hookSalt;
    function quote0() internal pure virtual returns (bool);

    function nativeQuote() internal pure virtual returns (bool) {
        return false;
    }

    /// @dev Pool start tick. 0 (price 1, FDV 1e9 quote: whale at the WHALE_MAX clamp) unless a suite overrides it.
    function initTick() internal pure virtual returns (int24) {
        return 0;
    }

    /// @dev Liquidity position around initTick: half-width in ticks and amount.
    function liquidityShape() internal pure virtual returns (int24 halfWidth, int256 amount) {
        return (600, 1e26);
    }

    /// @dev The tick of FDV 4 quote (launch, ~$10k): 1.0001^tick = 2.5e8 IDM per quote, signed by orientation.
    function launchTick() internal pure returns (int24) {
        return quote0() ? int24(193380) : int24(-193380);
    }

    /// @dev Comfortably above the whale threshold the swap will see (a buy raises the FDV and the threshold a bit).
    function whaleAmount() internal view returns (uint128) {
        return hook.whaleThreshold() * 5 / 4;
    }

    receive() external payable {}

    /// @dev Native ETH is paid from the router's balance, so count both as the swapper's wallet.
    function quoteBalance() internal view returns (uint256) {
        return nativeQuote() ? address(this).balance + address(router).balance : erc20.balanceOf(address(this));
    }

    function setUp() public {
        vm.warp(1_800_000_000);
        vm.roll(20_000_000);
        manager = new PoolManager(address(this));
        QUOTE = nativeQuote() ? address(0) : ERC20_QUOTE;
        bytes32 tokenHash = keccak256(type(SequencerToken).creationCode);
        for (uint256 i;; ++i) {
            address predicted = address(
                uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), bytes32(i), tokenHash))))
            );
            if ((predicted > QUOTE) == quote0()) {
                token = new SequencerToken{salt: bytes32(i)}();
                break;
            }
        }
        if (!nativeQuote()) {
            vm.etch(ERC20_QUOTE, address(new MockQuote()).code);
            erc20 = MockQuote(ERC20_QUOTE);
            erc20.mint(address(this), 1e30);
        }
        hook = _deploy();
        key = PoolKey(
            Currency.wrap(quote0() ? QUOTE : address(token)),
            Currency.wrap(quote0() ? address(token) : QUOTE),
            12500,
            60,
            IHooks(address(hook))
        );
        router = new PoolRouter(manager);
        token.approve(address(router), type(uint256).max);
        if (nativeQuote()) vm.deal(address(router), 1e30);
        else erc20.approve(address(router), type(uint256).max);
        manager.initialize(key, TickMath.getSqrtPriceAtTick(initTick()));
        (int24 halfWidth, int256 liq) = liquidityShape();
        router.liquidityRange(key, initTick() - halfWidth, initTick() + halfWidth, liq);
    }

    function args() internal view returns (bytes memory) {
        return abi.encode(manager, address(token), address(this), QUOTE, Q.T_HAT, Q.T_GLITCH, Q.T_SNARE);
    }

    function _deploy() internal returns (SequencerHook deployed) {
        bytes32 hash = keccak256(abi.encodePacked(type(SequencerHook).creationCode, args()));
        for (uint256 i; i < 300_000; ++i) {
            bytes32 salt = bytes32(i);
            address predicted =
                address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, hash)))));
            if ((uint160(predicted) & Hooks.ALL_HOOK_MASK) == 0x3040 && predicted.code.length == 0) {
                hookSalt = salt;
                assertEq(
                    predicted,
                    HookMiner.computeAddress(
                        address(this), i, abi.encodePacked(type(SequencerHook).creationCode, args())
                    )
                );
                deployed = new SequencerHook{salt: salt}(
                    manager, address(token), address(this), QUOTE, Q.T_HAT, Q.T_GLITCH, Q.T_SNARE
                );
                assertEq(address(deployed), predicted);
                return deployed;
            }
        }
        revert("salt search exhausted");
    }

    function params(bool buy, int256 amount) internal pure returns (SwapParams memory) {
        bool z = buy == quote0();
        // Open price limits: valid at any start price (exact amounts here never reach them).
        return SwapParams(z, amount, z ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1);
    }

    function thresholdsAt(int24 tick) internal view returns (S.Thresholds memory) {
        return S.Thresholds(Q.T_HAT, Q.T_GLITCH, Q.T_SNARE, S.whaleThreshold(tick, quote0()));
    }

    function test_PermissionsBindingsAndInitialState() public view {
        assertEq(uint160(address(hook)) & Hooks.ALL_HOOK_MASK, 0x3040);
        Hooks.Permissions memory p;
        p.beforeInitialize = true;
        p.afterInitialize = true;
        p.afterSwap = true;
        assertEq(abi.encode(hook.getHookPermissions()), abi.encode(p));
        assertEq(hook.factory(), address(this));
        assertEq(hook.quote(), QUOTE);
        assertEq(hook.T_HAT(), Q.T_HAT);
        assertEq(hook.quoteIs0(), quote0());
        assertEq(hook.whaleThreshold(), S.whaleThreshold(initTick(), quote0()));
        assertEq(hook.whaleThresholdAt(launchTick()), S.whaleThreshold(launchTick(), quote0()));
        // FDV 4 quote -> 0.04 quote, within one tick (0.005%).
        assertApproxEqRel(hook.whaleThresholdAt(launchTick()), 0.04 ether, 1e14);
        assertEq(hook.token(), address(token));
        (uint256 a, uint256 b) = hook.raw();
        (uint256 x, uint256 y) = S.encode(S.initialV2());
        assertEq(a, x);
        assertEq(b, y);
        assertEq(vm.load(address(hook), bytes32(0)), bytes32(a));
        assertEq(vm.load(address(hook), bytes32(uint256(1))), bytes32(b));
        assertEq(abi.encode(hook.state()), abi.encode(S.initialV2()));
    }

    function _assertSwap(bool buy, int256 specified) internal returns (BalanceDelta d) {
        S.State memory before = hook.state();
        uint256 seqBefore = token.balanceOf(address(this));
        uint256 quoteBefore = quoteBalance();
        vm.recordLogs();
        d = router.swap(key, params(buy, specified));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        int128 seqDelta = quote0() ? d.amount1() : d.amount0();
        int128 quoteDelta = quote0() ? d.amount0() : d.amount1();
        assertEq(seqDelta > 0, buy);
        assertEq(int256(token.balanceOf(address(this))) - int256(seqBefore), int256(seqDelta));
        assertEq(int256(quoteBalance()) - int256(quoteBefore), int256(quoteDelta));
        uint128 amount = uint128(uint256(quoteDelta < 0 ? -int256(quoteDelta) : int256(quoteDelta)));
        (, int24 tick,,) = IPoolManager(address(manager)).getSlot0(key.toId());
        (S.State memory expected, S.Mutation memory m) = S.mutateV2(
            before, S.Input(buy, amount, tick, uint64(block.number), uint40(block.timestamp)), thresholdsAt(tick)
        );
        assertEq(m.whale, amount >= hook.whaleThresholdAt(tick));
        (uint256 a, uint256 b) = hook.raw();
        (uint256 x, uint256 y) = S.encode(expected);
        assertEq(a, x);
        assertEq(b, y);
        uint256 mutations;
        uint256 movements;
        uint256 drops;
        uint256 completed;
        uint256 accumulated;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(hook)) continue;
            if (logs[i].topics[0] == MOVEMENT) {
                assertEq(mutations, 0);
                ++movements;
                assertEq(uint256(logs[i].topics[1]), m.movementPatternId);
                assertEq(logs[i].data, abi.encode(m.movementRoot, expected.swapCount));
            } else if (logs[i].topics[0] == DROP) {
                assertEq(mutations, 0);
                assertEq(movements, 1);
                ++drops;
                assertEq(uint256(logs[i].topics[1]), expected.swapCount);
                assertEq(logs[i].data, abi.encode(m.track, buy, m.dropMask));
            } else if (logs[i].topics[0] == ACCUMULATED) {
                assertEq(mutations, 0);
                ++accumulated;
                assertEq(uint256(logs[i].topics[1]), expected.swapCount);
                assertEq(logs[i].data, abi.encode(m.fromTrack, m.writeStep, m.promoted, m.noop));
            } else if (logs[i].topics[0] == COMPLETE) {
                assertEq(mutations, 0);
                ++completed;
                assertEq(uint256(logs[i].topics[1]), expected.trackNo);
                assertEq(
                    logs[i].data,
                    abi.encode(
                        expected.patternId,
                        expected.root,
                        m.snapshot0,
                        m.snapshot1,
                        expected.swapCount,
                        expected.pattern
                    )
                );
            } else if (logs[i].topics[0] == MUTATED) {
                ++mutations;
                assertEq(logs[i].topics[1], bytes32(uint256(uint160(address(router)))));
                assertEq(uint256(logs[i].topics[2]), expected.swapCount);
                assertEq(logs[i].data, abi.encode(m.track, m.step, buy, m.bassNote, buy, amount, tick, a, b));
            }
        }
        assertEq(mutations, 1);
        assertEq(movements, m.whale ? 1 : 0);
        assertEq(drops, m.whale ? 1 : 0);
        assertEq(completed, m.completed ? 1 : 0);
        assertEq(accumulated, !m.whale && (m.promoted || m.noop) ? 1 : 0);
        assertEq(token.balanceOf(address(hook)), 0);
        if (!nativeQuote()) assertEq(erc20.balanceOf(address(hook)), 0);
        assertEq(address(hook).balance, 0);
    }

    function _saturate(uint8 heat) internal {
        S.State memory s = hook.state();
        s.pattern = type(uint64).max;
        s.bass = type(uint64).max;
        s.heat = heat;
        s.lastTs = uint40(block.timestamp);
        s.swapCount = 63;
        s.trackNo = type(uint16).max;
        (uint256 a, uint256 b) = S.encode(s);
        vm.store(address(hook), bytes32(0), bytes32(a));
        vm.store(address(hook), bytes32(uint256(1)), bytes32(b));
    }

    function test_RealTrackCompleteSnapshotAndCompanionEvent() public {
        _saturate(15);
        _assertSwap(true, -int256(uint256(UNIT)));
        assertEq(hook.state().trackNo, 0);
        assertEq(hook.state().heat, 0);
        assertEq(hook.state().patternId, 2); // page then track completion
        assertEq(hook.state().root, 4);
    }

    function test_GasColdWorstNormal() public {
        _saturate(14);
        _gas(true, false, false, 40_000);
    }

    function test_GasColdScanSpill() public {
        _saturate(14);
        S.State memory s = hook.state();
        uint256 step = uint256(keccak256(abi.encodePacked(uint32(64), int24(0), uint64(block.number)))) % 16;
        // The last available hat cell in circular scan order, with every ladder rung occupied.
        s.pattern ^= uint64(1) << (32 + ((step + 15) & 15));
        (uint256 a, uint256 b) = S.encode(s);
        vm.store(address(hook), bytes32(0), bytes32(a));
        vm.store(address(hook), bytes32(uint256(1)), bytes32(b));
        _gas(true, false, false, 40_000);
    }

    function test_GasColdTrackComplete() public {
        _saturate(15);
        _gas(true, false, false, 45_000);
    }

    function test_RealBuySellExactInput() public {
        _assertSwap(true, -0.01 ether);
        vm.warp(block.timestamp + 12);
        vm.roll(block.number + 1);
        _assertSwap(false, -0.01 ether);
    }

    function test_RealBuySellExactOutput() public {
        _assertSwap(true, 0.01 ether);
        _assertSwap(false, 0.01 ether);
    }

    function test_RealWhaleAndPage64EventOrder() public {
        S.State memory s = hook.state();
        s.swapCount = 63;
        s.patternId = 3;
        (uint256 a, uint256 b) = S.encode(s);
        vm.store(address(hook), bytes32(0), bytes32(a));
        vm.store(address(hook), bytes32(uint256(1)), bytes32(b));
        _assertSwap(true, -int256(uint256(whaleAmount())));
        assertTrue(hook.state().root != 9);
        assertEq(hook.state().patternId, 5);
    }

    function test_RealWhaleBuyFillsAndWhaleSellDrops() public {
        // Fill a known pattern, then whale buy (Euclidean fill) and whale sell (track wipe) through the real manager.
        S.State memory s = hook.state();
        s.pattern = type(uint64).max;
        (uint256 a, uint256 b) = S.encode(s);
        vm.store(address(hook), bytes32(0), bytes32(a));
        vm.store(address(hook), bytes32(uint256(1)), bytes32(b));
        for (uint256 i; i < 6; ++i) {
            bool buy = i % 2 == 0;
            S.State memory before = hook.state();
            int256 w = int256(uint256(whaleAmount()));
            _assertSwap(buy, buy ? -w : w);
            assertEq(hook.state().patternId, before.patternId + 1); // whale movement
            S.State memory after_ = hook.state();
            uint64 changed = before.pattern ^ after_.pattern;
            // only one track's 16 bits may change
            uint256 tracksTouched;
            for (uint256 t; t < 4; ++t) {
                if ((changed >> (t * 16)) & 0xffff != 0) ++tracksTouched;
            }
            assertLe(tracksTouched, 1);
            vm.warp(block.timestamp + 12);
            vm.roll(block.number + 1);
        }
    }

    function test_RealCountWrapDoesNotBlockSwaps() public {
        S.State memory s = hook.state();
        s.swapCount = type(uint32).max;
        s.patternId = type(uint32).max;
        (uint256 a, uint256 b) = S.encode(s);
        vm.store(address(hook), bytes32(0), bytes32(a));
        vm.store(address(hook), bytes32(uint256(1)), bytes32(b));
        _assertSwap(true, -int256(uint256(whaleAmount())));
        assertEq(hook.state().swapCount, 0);
        assertEq(hook.state().patternId, 1);
    }

    function test_RealPartialFillUsesActualDeltaAndPostSwapTick() public {
        S.State memory before = hook.state();
        SwapParams memory p = params(true, -1e25);
        (uint160 price,,,) = IPoolManager(address(manager)).getSlot0(key.toId());
        p.sqrtPriceLimitX96 = p.zeroForOne ? price - price / 8000 : price + price / 8000;
        BalanceDelta d = router.swap(key, p);
        int128 q = quote0() ? d.amount0() : d.amount1();
        uint128 amount = uint128(uint256(-int256(q)));
        assertLt(amount, 1e25);
        (, int24 tick,,) = IPoolManager(address(manager)).getSlot0(key.toId());
        assertTrue(tick != initTick());
        (S.State memory expected,) = S.mutateV2(
            before, S.Input(true, amount, tick, uint64(block.number), uint40(block.timestamp)), thresholdsAt(tick)
        );
        assertEq(abi.encode(hook.state()), abi.encode(expected));
    }

    function test_RealPageRolloverAfter64Swaps() public {
        router.batch(key, params(true, -int256(uint256(UNIT))), 64, true);
        S.State memory s = hook.state();
        assertEq(s.swapCount, 64);
        assertEq(s.patternId, 1);
        assertEq(s.root, 9);
        assertEq(s.intervalEma, 0);
        assertEq(s.bpm, 118);
        assertEq(token.balanceOf(address(hook)), 0);
        if (!nativeQuote()) assertEq(erc20.balanceOf(address(hook)), 0);
        assertEq(address(hook).balance, 0);
    }

    function test_LiquidityAddRemoveDoNotMutate() public {
        (uint256 a, uint256 b) = hook.raw();
        router.liquidity(key, 1e20);
        router.liquidity(key, -1e20);
        (uint256 x, uint256 y) = hook.raw();
        assertEq(a, x);
        assertEq(b, y);
    }

    function test_EnabledCallbacksRejectNonManager() public {
        vm.expectRevert(SequencerHook.OnlyPoolManager.selector);
        hook.beforeInitialize(address(this), key, 1);
        vm.expectRevert(SequencerHook.OnlyPoolManager.selector);
        hook.afterInitialize(address(this), key, 1, 0);
        vm.expectRevert(SequencerHook.OnlyPoolManager.selector);
        hook.afterSwap(address(this), key, params(true, -1), toBalanceDelta(1, -1), "");
    }

    function test_CannotReinitializeOrUseAnotherPool() public {
        vm.prank(address(manager));
        vm.expectRevert(SequencerHook.AlreadyInitialized.selector);
        hook.afterInitialize(address(this), key, 1, 0);
        PoolKey memory other = key;
        other.fee = 3000;
        vm.prank(address(manager));
        vm.expectRevert(SequencerHook.InvalidPool.selector);
        hook.afterSwap(address(this), other, params(true, -1), toBalanceDelta(1, -1), "");
    }

    function test_FreshHookOnlyFactoryAndExactPairCanInitialize() public {
        SequencerHook fresh = _deploy();
        PoolKey memory k = key;
        k.hooks = IHooks(address(fresh));
        vm.prank(address(manager));
        vm.expectRevert(SequencerHook.InvalidPool.selector);
        fresh.beforeInitialize(address(0xBAD), k, 1);
        vm.prank(address(manager));
        vm.expectRevert(SequencerHook.InvalidPool.selector);
        fresh.afterInitialize(address(0xBAD), k, 1, 0);
        PoolKey memory invalid = PoolKey(k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks);
        invalid.fee = 3000;
        vm.prank(address(manager));
        vm.expectRevert(SequencerHook.InvalidPool.selector);
        fresh.beforeInitialize(address(this), invalid, 1);
        invalid = PoolKey(k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks);
        invalid.tickSpacing = 1;
        vm.prank(address(manager));
        vm.expectRevert(SequencerHook.InvalidPool.selector);
        fresh.beforeInitialize(address(this), invalid, 1);
        invalid = PoolKey(k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks);
        invalid.currency0 = Currency.wrap(address(1));
        vm.prank(address(manager));
        vm.expectRevert(SequencerHook.InvalidPool.selector);
        fresh.beforeInitialize(address(this), invalid, 1);
        manager.initialize(k, uint160(1 << 96));
        assertTrue(fresh.initialized());
    }

    function test_ConstructorRejectsBadAddressesAndThresholds() public {
        vm.expectRevert(SequencerHook.InvalidConfiguration.selector);
        new SequencerHook(manager, address(token), address(this), QUOTE, 0, Q.T_GLITCH, Q.T_SNARE);
        vm.expectRevert(SequencerHook.InvalidConfiguration.selector);
        new SequencerHook(manager, address(token), address(this), QUOTE, Q.T_GLITCH, Q.T_GLITCH, Q.T_SNARE);
        vm.expectRevert(SequencerHook.InvalidConfiguration.selector);
        new SequencerHook(manager, QUOTE, address(this), QUOTE, Q.T_HAT, Q.T_GLITCH, Q.T_SNARE);
        // The token must be a real ERC20 even when the quote is native ETH.
        vm.expectRevert(SequencerHook.InvalidConfiguration.selector);
        new SequencerHook(manager, address(0), address(this), address(0), Q.T_HAT, Q.T_GLITCH, Q.T_SNARE);
        vm.expectRevert(SequencerHook.InvalidConfiguration.selector);
        new SequencerHook(manager, address(0), address(this), ERC20_QUOTE, Q.T_HAT, Q.T_GLITCH, Q.T_SNARE);
        vm.expectRevert(SequencerHook.InvalidConfiguration.selector);
        new SequencerHook(
            IPoolManager(address(0)), address(token), address(this), QUOTE, Q.T_HAT, Q.T_GLITCH, Q.T_SNARE
        );
        vm.expectRevert(SequencerHook.InvalidConfiguration.selector);
        new SequencerHook(manager, address(token), address(0), QUOTE, Q.T_HAT, Q.T_GLITCH, Q.T_SNARE);
    }

    function test_RejectsPoolWithTheOtherQuoteKind() public {
        SequencerHook fresh = _deploy();
        // Native hook: an ERC20-quoted pool is not its pair. ERC20 hook: the native ETH pool is not its pair.
        address other = nativeQuote() ? ERC20_QUOTE : address(0);
        bool otherFirst = other < address(token);
        PoolKey memory k = PoolKey(
            Currency.wrap(otherFirst ? other : address(token)),
            Currency.wrap(otherFirst ? address(token) : other),
            12500,
            60,
            IHooks(address(fresh))
        );
        vm.prank(address(manager));
        vm.expectRevert(SequencerHook.InvalidPool.selector);
        fresh.beforeInitialize(address(this), k, 1);
        // Unsorted currencies with the right pair are rejected too.
        PoolKey memory swapped = PoolKey(key.currency1, key.currency0, 12500, 60, IHooks(address(fresh)));
        vm.prank(address(manager));
        vm.expectRevert(SequencerHook.InvalidPool.selector);
        fresh.beforeInitialize(address(this), swapped, 1);
    }

    function test_DisabledCallbacksRefuse() public {
        ModifyLiquidityParams memory p = ModifyLiquidityParams(-60, 60, 1, 0);
        BalanceDelta z = toBalanceDelta(0, 0);
        vm.expectRevert(SequencerHook.HookNotEnabled.selector);
        hook.beforeAddLiquidity(address(this), key, p, "");
        vm.expectRevert(SequencerHook.HookNotEnabled.selector);
        hook.afterAddLiquidity(address(this), key, p, z, z, "");
        vm.expectRevert(SequencerHook.HookNotEnabled.selector);
        hook.beforeRemoveLiquidity(address(this), key, p, "");
        vm.expectRevert(SequencerHook.HookNotEnabled.selector);
        hook.afterRemoveLiquidity(address(this), key, p, z, z, "");
        vm.expectRevert(SequencerHook.HookNotEnabled.selector);
        hook.beforeSwap(address(this), key, params(true, -1), "");
        vm.expectRevert(SequencerHook.HookNotEnabled.selector);
        hook.beforeDonate(address(this), key, 0, 0, "");
        vm.expectRevert(SequencerHook.HookNotEnabled.selector);
        hook.afterDonate(address(this), key, 0, 0, "");
    }

    function test_ZeroSeqDeltaIsSellRegardlessOfDirectionAndMinQuoteDeltaSafe() public {
        BalanceDelta d = quote0() ? toBalanceDelta(type(int128).min, 0) : toBalanceDelta(0, type(int128).min);
        vm.prank(address(manager));
        (bytes4 selector, int128 delta) = hook.afterSwap(address(router), key, params(true, -1), d, "");
        assertEq(selector, IHooks.afterSwap.selector);
        assertEq(delta, 0);
        assertEq(hook.state().pressure, -1000);
        assertEq(hook.state().patternId, 1);
    }

    function _gas(bool buy, bool whale, bool page, uint256 ceiling) internal {
        if (page) {
            S.State memory s = hook.state();
            s.swapCount = 63;
            (uint256 a, uint256 b) = S.encode(s);
            vm.store(address(hook), bytes32(0), bytes32(a));
            vm.store(address(hook), bytes32(uint256(1)), bytes32(b));
        }
        int128 amount = whale ? int128(hook.whaleThreshold()) : int128(UNIT);
        BalanceDelta d = quote0()
            ? toBalanceDelta(buy ? -amount : amount, buy ? amount : -amount)
            : toBalanceDelta(buy ? amount : -amount, buy ? -amount : amount);
        SwapParams memory p = params(buy, -int256(amount));
        // Deliberately cold hook AND manager storage; a real callback gets a warm manager pool slot.
        SequencerHook target = hook;
        PoolKey memory k = key;
        address sender = address(router);
        address pm = address(manager);
        CallbackGasMeter meter = new CallbackGasMeter();
        uint256 gasUsed = meter.measure(target, pm, sender, k, p, d);
        emit log_named_uint(
            nativeQuote()
                ? "afterSwap gas (native ETH=currency0)"
                : quote0() ? "afterSwap gas (ERC20 quote=currency0)" : "afterSwap gas (ERC20 quote=currency1)",
            gasUsed
        );
        assertLe(gasUsed, ceiling);
    }

    function test_GasColdPreviouslyZeroSlot1() public {
        S.State memory s = hook.state();
        s.swapCount = 38;
        s.intervalEma = 0;
        s.pressure = 0;
        s.lastTick = 0;
        // Default v2 initialization keeps sizeLogEma nonzero; this is deliberately synthetic.
        s.sizeLogEma = 0;
        (uint256 a, uint256 b) = S.encode(s);
        assertEq(b, 0);
        vm.store(address(hook), bytes32(0), bytes32(a));
        vm.store(address(hook), bytes32(uint256(1)), bytes32(b));
        // At the launch tick the hash lands on the occupied kick step: scan + Accumulated event (~55.1k).
        _gas(true, false, false, 56_000);
    }

    function test_GasColdFirstBuy() public {
        _gas(true, false, false, 35_000);
    }

    function test_GasColdFirstSell() public {
        _gas(false, false, false, 40_000);
    }

    // Whale path budget (SPEC §3.3.8 drop/fill): <= 45k.
    function test_GasColdWhale() public {
        _gas(true, true, false, 45_000);
    }

    function test_GasColdWhaleSell() public {
        _gas(false, true, false, 45_000);
    }

    function test_GasColdWhaleBuyPage64() public {
        _gas(true, true, true, 45_000);
    }

    function test_GasColdWhalePage64() public {
        _gas(false, true, true, 45_000);
    }
}

/// @dev Launch configuration: IDM/ETH with native ETH (address(0), always currency0).
contract SequencerHookNativeEthTest is SequencerHookTestBase {
    function quote0() internal pure override returns (bool) {
        return true;
    }

    function nativeQuote() internal pure override returns (bool) {
        return true;
    }
}

contract SequencerHookERC20Quote0Test is SequencerHookTestBase {
    function quote0() internal pure override returns (bool) {
        return true;
    }
}

contract SequencerHookERC20Quote1Test is SequencerHookTestBase {
    function quote0() internal pure override returns (bool) {
        return false;
    }
}

/// @dev Launch configuration at the launch price: FDV 4 ETH (tick 193380), ~1.8 ETH and ~4.5e8 IDM of liquidity.
contract SequencerHookNativeEthLaunchFdvTest is SequencerHookTestBase {
    function quote0() internal pure override returns (bool) {
        return true;
    }

    function nativeQuote() internal pure override returns (bool) {
        return true;
    }

    function initTick() internal pure override returns (int24) {
        return launchTick();
    }

    function liquidityShape() internal pure override returns (int24, int256) {
        return (60_000, 3e22);
    }

    /// @dev Real swaps around 0.04 ETH: the post-swap tick decides, bit-exact with the library.
    function test_RealWhaleBoundaryAtLaunchFdv() public {
        uint128 t = hook.whaleThreshold();
        assertApproxEqRel(t, 0.04 ether, 1e14);
        _assertSwap(true, -int256(uint256(t * 9 / 10)));
        assertEq(hook.state().patternId, 0); // not a whale
        _assertSwap(true, -int256(uint256(t * 11 / 10)));
        assertEq(hook.state().patternId, 1); // whale (buys raise the threshold by well under 10%)
        // A sell of the same size lowers FDV and the threshold: still a whale.
        _assertSwap(false, int256(uint256(t * 11 / 10)));
        assertEq(hook.state().patternId, 2);
    }
}

/// @dev ERC20 quote sorted above IDM (quote = currency1) at FDV 4 quote: the tick reads the other way (-193380).
contract SequencerHookERC20Quote1LaunchFdvTest is SequencerHookTestBase {
    function quote0() internal pure override returns (bool) {
        return false;
    }

    function initTick() internal pure override returns (int24) {
        return launchTick();
    }

    function liquidityShape() internal pure override returns (int24, int256) {
        return (60_000, 3e22);
    }
}
