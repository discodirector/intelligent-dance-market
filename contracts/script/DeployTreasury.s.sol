// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PulseTreasury} from "../src/PulseTreasury.sol";
import {FeeSplitter} from "../src/FeeSplitter.sol";

/// @notice Deploys PulseTreasury for the launched IDM/ETH pool, then the FeeSplitter in front of it. Run after launch: the hook must be initialized,
///         because the constructor checks the key against hook.poolId(). Runbook: contracts/TREASURY-RUNBOOK.md.
/// @dev Env (all required except fee/tick spacing):
///        POOL_MANAGER  v4 PoolManager of the launch chain
///        HOOK          the deployed SequencerHook
///        IDM           the IDM token (currency1; native ETH is currency0)
///        POOL_FEE      default 12500 (SequencerHook.LP_FEE)
///        TICK_SPACING  default 60 (SequencerHook.TICK_SPACING)
///        TEAM          team wallet: half of the fee ETH (FeeSplitter); unset = treasury only
///      The signer comes from forge's own flags (--ledger, --account, ...); this script never reads a key.
///      Deployment requires a separate user-approved run; this source does not deploy or broadcast by itself.
contract DeployTreasury is Script {
    function run() external returns (PulseTreasury treasury, FeeSplitter splitter) {
        IPoolManager manager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        address hook = vm.envAddress("HOOK");
        address idm = vm.envAddress("IDM");
        uint24 fee = uint24(vm.envOr("POOL_FEE", uint256(12500)));
        int24 tickSpacing = int24(int256(vm.envOr("TICK_SPACING", uint256(60))));
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(idm),
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: IHooks(hook)
        });

        address team = vm.envOr("TEAM", address(0));

        vm.startBroadcast();
        treasury = new PulseTreasury(manager, key, hook, idm);
        if (team != address(0)) splitter = new FeeSplitter(team, address(treasury), idm);
        vm.stopBroadcast();

        console2.log("treasury", address(treasury));
        if (team == address(0)) {
            console2.log("next: owner calls LaunchFactory.setRequester(launchNumber, treasury) - see TREASURY-RUNBOOK.md");
        } else {
            console2.log("splitter", address(splitter));
            console2.log("next: owner calls LaunchFactory.setRequester(launchNumber, splitter) - see TREASURY-RUNBOOK.md");
        }
    }
}
