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
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta, toBalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {HookMiner} from "v4-periphery/test/shared/HookMiner.sol";
import {PoolRouter} from "./helpers/PoolRouter.sol";
import {MockIMD} from "./helpers/MockIMD.sol";

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
    address constant IMD = 0x5F7Bb59365ce557C26dbcAa4EE9d39A4b95B7127;
    bytes32 constant MUTATED =
        keccak256("Mutated(address,uint32,uint8,uint8,bool,uint8,bool,uint128,int24,uint256,uint256)");
    bytes32 constant MOVEMENT = keccak256("Movement(uint32,uint8,uint32)");
    PoolManager manager;
    SequencerHook hook;
    SequencerToken token;
    MockIMD imd;
    PoolRouter router;
    PoolKey key;
    bytes32 hookSalt;
    function quote0() internal pure virtual returns (bool);

    function setUp() public {
        vm.warp(1_800_000_000);
        vm.roll(20_000_000);
        manager = new PoolManager(address(this));
        bytes32 tokenHash = keccak256(type(SequencerToken).creationCode);
        for (uint256 i;; ++i) {
            address predicted = address(
                uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), bytes32(i), tokenHash))))
            );
            if ((predicted > IMD) == quote0()) {
                token = new SequencerToken{salt: bytes32(i)}();
                break;
            }
        }
        vm.etch(IMD, address(new MockIMD()).code);
        imd = MockIMD(IMD);
        imd.mint(address(this), 1e30);
        hook = _deploy();
        key = PoolKey(
            Currency.wrap(quote0() ? IMD : address(token)),
            Currency.wrap(quote0() ? address(token) : IMD),
            12500,
            60,
            IHooks(address(hook))
        );
        router = new PoolRouter(manager);
        token.approve(address(router), type(uint256).max);
        imd.approve(address(router), type(uint256).max);
        manager.initialize(key, uint160(1 << 96));
        router.liquidity(key, 1e26);
    }

    function args() internal view returns (bytes memory) {
        return abi.encode(
            manager,
            address(token),
            address(this),
            IMD,
            uint128(0.5 ether),
            uint128(5 ether),
            uint128(25 ether),
            uint128(100 ether)
        );
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
                    manager, address(token), address(this), IMD, 0.5 ether, 5 ether, 25 ether, 100 ether
                );
                assertEq(address(deployed), predicted);
                return deployed;
            }
        }
        revert("salt search exhausted");
    }

    function params(bool buy, int256 amount) internal pure returns (SwapParams memory) {
        bool z = buy == quote0();
        return SwapParams(z, amount, z ? uint160(1 << 95) : uint160(1 << 97));
    }

    function test_PermissionsBindingsAndInitialState() public view {
        assertEq(uint160(address(hook)) & Hooks.ALL_HOOK_MASK, 0x3040);
        Hooks.Permissions memory p;
        p.beforeInitialize = true;
        p.afterInitialize = true;
        p.afterSwap = true;
        assertEq(abi.encode(hook.getHookPermissions()), abi.encode(p));
        assertEq(hook.factory(), address(this));
        assertEq(hook.imd(), IMD);
        assertEq(hook.token(), address(token));
        (uint256 a, uint256 b) = hook.raw();
        (uint256 x, uint256 y) = S.encode(S.initial());
        assertEq(a, x);
        assertEq(b, y);
        assertEq(vm.load(address(hook), bytes32(0)), bytes32(a));
        assertEq(vm.load(address(hook), bytes32(uint256(1))), bytes32(b));
        assertEq(abi.encode(hook.state()), abi.encode(S.initial()));
    }

    function _assertSwap(bool buy, int256 specified) internal returns (BalanceDelta d) {
        S.State memory before = hook.state();
        uint256 seqBefore = token.balanceOf(address(this));
        uint256 imdBefore = imd.balanceOf(address(this));
        vm.recordLogs();
        d = router.swap(key, params(buy, specified));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        int128 seqDelta = quote0() ? d.amount1() : d.amount0();
        int128 imdDelta = quote0() ? d.amount0() : d.amount1();
        assertEq(seqDelta > 0, buy);
        assertEq(int256(token.balanceOf(address(this))) - int256(seqBefore), int256(seqDelta));
        assertEq(int256(imd.balanceOf(address(this))) - int256(imdBefore), int256(imdDelta));
        uint128 amount = uint128(uint256(imdDelta < 0 ? -int256(imdDelta) : int256(imdDelta)));
        (, int24 tick,,) = IPoolManager(address(manager)).getSlot0(key.toId());
        (S.State memory expected, S.Mutation memory m) = S.mutate(
            before,
            S.Input(buy, amount, tick, uint64(block.number), uint40(block.timestamp)),
            S.Thresholds(0.5 ether, 5 ether, 25 ether, 100 ether)
        );
        (uint256 a, uint256 b) = hook.raw();
        (uint256 x, uint256 y) = S.encode(expected);
        assertEq(a, x);
        assertEq(b, y);
        uint256 mutations;
        uint256 movements;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(hook)) continue;
            if (logs[i].topics[0] == MOVEMENT) {
                assertEq(mutations, 0);
                ++movements;
                assertEq(uint256(logs[i].topics[1]), m.movementPatternId);
                assertEq(logs[i].data, abi.encode(expected.root, expected.swapCount));
            } else if (logs[i].topics[0] == MUTATED) {
                ++mutations;
                assertEq(logs[i].topics[1], bytes32(uint256(uint160(address(router)))));
                assertEq(uint256(logs[i].topics[2]), expected.swapCount);
                assertEq(logs[i].data, abi.encode(m.track, m.step, buy, m.bassNote, buy, amount, tick, a, b));
            }
        }
        assertEq(mutations, 1);
        assertEq(movements, m.whale ? 1 : 0);
        assertEq(token.balanceOf(address(hook)), 0);
        assertEq(imd.balanceOf(address(hook)), 0);
        assertEq(address(hook).balance, 0);
    }

    function test_RealBuySellExactInput() public {
        _assertSwap(true, -10 ether);
        vm.warp(block.timestamp + 12);
        vm.roll(block.number + 1);
        _assertSwap(false, -10 ether);
    }

    function test_RealBuySellExactOutput() public {
        _assertSwap(true, 10 ether);
        _assertSwap(false, 10 ether);
    }

    function test_RealWhaleAndPage64EventOrder() public {
        S.State memory s = hook.state();
        s.swapCount = 63;
        s.patternId = 3;
        (uint256 a, uint256 b) = S.encode(s);
        vm.store(address(hook), bytes32(0), bytes32(a));
        vm.store(address(hook), bytes32(uint256(1)), bytes32(b));
        _assertSwap(true, -100 ether);
        assertEq(hook.state().patternId, 5);
    }

    function test_RealCountWrapDoesNotBlockSwaps() public {
        S.State memory s = hook.state();
        s.swapCount = type(uint32).max;
        s.patternId = type(uint32).max;
        (uint256 a, uint256 b) = S.encode(s);
        vm.store(address(hook), bytes32(0), bytes32(a));
        vm.store(address(hook), bytes32(uint256(1)), bytes32(b));
        _assertSwap(true, -100 ether);
        assertEq(hook.state().swapCount, 0);
        assertEq(hook.state().patternId, 1);
    }

    function test_RealPartialFillUsesActualDeltaAndPostSwapTick() public {
        S.State memory before = hook.state();
        SwapParams memory p = params(true, -1e25);
        p.sqrtPriceLimitX96 = p.zeroForOne ? uint160((uint256(1) << 96) - 1e25) : uint160((uint256(1) << 96) + 1e25);
        BalanceDelta d = router.swap(key, p);
        int128 q = quote0() ? d.amount0() : d.amount1();
        uint128 amount = uint128(uint256(-int256(q)));
        assertLt(amount, 1e25);
        (, int24 tick,,) = IPoolManager(address(manager)).getSlot0(key.toId());
        assertTrue(tick != 0);
        (S.State memory expected,) = S.mutate(
            before,
            S.Input(true, amount, tick, uint64(block.number), uint40(block.timestamp)),
            S.Thresholds(0.5 ether, 5 ether, 25 ether, 100 ether)
        );
        assertEq(abi.encode(hook.state()), abi.encode(expected));
    }

    function test_RealPageRolloverAfter64Swaps() public {
        router.batch(key, params(true, -1 ether), 64, true);
        S.State memory s = hook.state();
        assertEq(s.swapCount, 64);
        assertEq(s.patternId, 1);
        assertEq(s.root, 9);
        assertEq(s.intervalEma, 0);
        assertEq(s.bpm, 170);
        assertEq(token.balanceOf(address(hook)), 0);
        assertEq(imd.balanceOf(address(hook)), 0);
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
        new SequencerHook(manager, address(token), address(this), IMD, 0, 5 ether, 25 ether, 100 ether);
        vm.expectRevert(SequencerHook.InvalidConfiguration.selector);
        new SequencerHook(manager, address(token), address(this), IMD, 5 ether, 5 ether, 25 ether, 100 ether);
        vm.expectRevert(SequencerHook.InvalidConfiguration.selector);
        new SequencerHook(manager, IMD, address(this), IMD, 0.5 ether, 5 ether, 25 ether, 100 ether);
        vm.expectRevert(SequencerHook.InvalidConfiguration.selector);
        new SequencerHook(
            IPoolManager(address(0)), address(token), address(this), IMD, 0.5 ether, 5 ether, 25 ether, 100 ether
        );
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

    function test_ZeroSeqDeltaIsSellRegardlessOfDirectionAndMinImdDeltaSafe() public {
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
        int128 amount = whale ? int128(100 ether) : int128(1 ether);
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
        emit log_named_uint(quote0() ? "afterSwap gas (IMD=currency0)" : "afterSwap gas (IMD=currency1)", gasUsed);
        assertLe(gasUsed, ceiling);
    }

    function test_GasColdPreviouslyZeroSlot1() public {
        S.State memory s = hook.state();
        s.swapCount = 38;
        s.intervalEma = 0;
        s.pressure = 0;
        s.lastTick = 0;
        (uint256 a, uint256 b) = S.encode(s);
        assertEq(b, 0);
        vm.store(address(hook), bytes32(0), bytes32(a));
        vm.store(address(hook), bytes32(uint256(1)), bytes32(b));
        _gas(true, false, false, 50_000);
    }

    function test_GasColdFirstBuy() public {
        _gas(true, false, false, 35_000);
    }

    function test_GasColdFirstSell() public {
        _gas(false, false, false, 35_000);
    }

    function test_GasColdWhale() public {
        _gas(true, true, false, 35_000);
    }

    function test_GasColdWhaleBuyPage64() public {
        _gas(true, true, true, 35_000);
    }

    function test_GasColdWhalePage64() public {
        _gas(false, true, true, 35_000);
    }
}

contract SequencerHookIMD0Test is SequencerHookTestBase {
    function quote0() internal pure override returns (bool) {
        return true;
    }
}

contract SequencerHookIMD1Test is SequencerHookTestBase {
    function quote0() internal pure override returns (bool) {
        return false;
    }
}
