// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {HookMiner} from "v4-periphery/test/shared/HookMiner.sol";
import {SequencerHook} from "../src/SequencerHook.sol";
import {SequencerToken} from "../src/SequencerToken.sol";
import {SimRouter} from "./SimRouter.sol";
import {QuoteCalibration as Q} from "../src/QuoteCalibration.sol";

/// @notice V2 Sepolia rehearsal (relative + accumulate + heat/drop): self-deployed IDM + SequencerHook on the real
///         Uniswap v4 PoolManager, paired with native ETH exactly like the Robinhood Chain launch (pairWith "eth").
///         Factory = the broadcasting EOA, which calls initialize itself. Runbook: contracts/SEPOLIA-V2.md.
/// Deployment requires a separate user-approved run; this source update does not deploy or broadcast.
contract DeploySepolia is Script {
    using PoolIdLibrary for PoolKey;

    IPoolManager constant MANAGER = IPoolManager(0xE03A1074c86CFeDd5C142C4F04F1a1536e203543);
    /// @dev Native ETH: address(0), always currency0.
    address constant QUOTE = address(0);
    uint160 constant FLAGS = 0x3040;
    // Opening price at the launch FDV: 4 ETH for 1B IDM, i.e. 250,000,000 IDM per ETH (tick 193379), so the
    // FDV-scaled whale threshold starts where launch will: ~0.04 ETH (SPEC §3.1).
    uint160 constant SQRT_IDM_PER_ETH = 1252707241875239655932069007848031; // floor(sqrt(2.5e8) * 2^96)
    // Full-range liquidity: L = floor(sqrt(1 ETH * 2.5e8 IDM)) = 1 ETH + 250M IDM, deep enough for 0.05-0.15 ETH whales.
    int256 constant LIQUIDITY = 15811388300841896659994;
    uint256 constant LIQUIDITY_ETH = 1.01 ether; // 1 ETH plus rounding headroom; the router refunds the rest.
    int24 constant MIN_TICK = -887220;
    int24 constant MAX_TICK = 887220;

    function run() external {
        address deployer = msg.sender;
        vm.startBroadcast();

        SequencerToken token = new SequencerToken();

        // hat/glitch/snare as in contracts/launch.json (QuoteCalibration, native ETH); the whale scales with FDV.
        bytes memory args = abi.encode(MANAGER, address(token), deployer, QUOTE, Q.T_HAT, Q.T_GLITCH, Q.T_SNARE);
        (address predicted, bytes32 salt) =
            HookMiner.find(CREATE2_FACTORY, FLAGS, type(SequencerHook).creationCode, args);
        SequencerHook hook =
            new SequencerHook{salt: salt}(MANAGER, address(token), deployer, QUOTE, Q.T_HAT, Q.T_GLITCH, Q.T_SNARE);
        require(address(hook) == predicted, "hook address mismatch");
        require(uint160(address(hook)) & 0x3fff == FLAGS, "hook flags");

        SimRouter router = new SimRouter(MANAGER);

        token.approve(address(router), type(uint256).max);

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(QUOTE),
            currency1: Currency.wrap(address(token)),
            fee: 12500,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        MANAGER.initialize(key, SQRT_IDM_PER_ETH);
        router.addLiquidity{value: LIQUIDITY_ETH}(key, MIN_TICK, MAX_TICK, LIQUIDITY);

        vm.stopBroadcast();

        console2.log("token", address(token));
        console2.log("hook", address(hook));
        console2.log("router", address(router));
        console2.log("quote", "native ETH (currency0)");
        console2.logBytes32(PoolId.unwrap(key.toId()));
    }
}
