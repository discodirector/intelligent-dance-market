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

interface ITestIMD {
    function mint(address to, uint256 amount) external;
    function approve(address spender, uint256 value) external returns (bool);
}

/// @notice V2 Sepolia rehearsal (relative + accumulate + heat/drop): self-deployed IDM + SequencerHook on the real Uniswap v4 PoolManager,
///         paired with IMD's Sepolia test token. Factory = the broadcasting EOA, which calls initialize itself.
/// Deployment requires a separate user-approved run; this source update does not deploy or broadcast.
contract DeploySepolia is Script {
    using PoolIdLibrary for PoolKey;

    IPoolManager constant MANAGER = IPoolManager(0xE03A1074c86CFeDd5C142C4F04F1a1536e203543);
    address constant IMD = 0x44a1Cd38474FB1748400E7DEb5F8D786ccE3F89A;
    uint160 constant FLAGS = 0x3040;
    // Thresholds identical to contracts/launch.json.
    uint128 constant T_HAT = 0.5e18;
    uint128 constant T_GLITCH = 5e18;
    uint128 constant T_SNARE = 25e18;
    uint128 constant T_KICK = 100e18;
    // Opening price 1 IDM = 0.001 IMD.
    uint160 constant SQRT_IMD_PER_IDM = 2505414483750479311864138015; // sqrt(0.001) * 2^96
    uint160 constant SQRT_IDM_PER_IMD = 2505414483750479311864138015696; // sqrt(1000) * 2^96
    // Full-range liquidity: L = sqrt(100_000 IMD * 100_000_000 IDM).
    int256 constant LIQUIDITY = 3162277660168379331998893;
    int24 constant MIN_TICK = -887220;
    int24 constant MAX_TICK = 887220;
    uint256 constant IMD_MINT = 150_000e18;

    function run() external {
        address deployer = msg.sender;
        vm.startBroadcast();

        SequencerToken token = new SequencerToken();

        bytes memory args = abi.encode(MANAGER, address(token), deployer, IMD, T_HAT, T_GLITCH, T_SNARE, T_KICK);
        (address predicted, bytes32 salt) =
            HookMiner.find(CREATE2_FACTORY, FLAGS, type(SequencerHook).creationCode, args);
        SequencerHook hook =
            new SequencerHook{salt: salt}(MANAGER, address(token), deployer, IMD, T_HAT, T_GLITCH, T_SNARE, T_KICK);
        require(address(hook) == predicted, "hook address mismatch");
        require(uint160(address(hook)) & 0x3fff == FLAGS, "hook flags");

        SimRouter router = new SimRouter(MANAGER);

        ITestIMD(IMD).mint(deployer, IMD_MINT);
        ITestIMD(IMD).approve(address(router), type(uint256).max);
        token.approve(address(router), type(uint256).max);

        bool idmIs0 = address(token) < IMD;
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(idmIs0 ? address(token) : IMD),
            currency1: Currency.wrap(idmIs0 ? IMD : address(token)),
            fee: 12500,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        MANAGER.initialize(key, idmIs0 ? SQRT_IMD_PER_IDM : SQRT_IDM_PER_IMD);
        router.addLiquidity(key, MIN_TICK, MAX_TICK, LIQUIDITY);

        vm.stopBroadcast();

        console2.log("token", address(token));
        console2.log("hook", address(hook));
        console2.log("router", address(router));
        console2.log("idmIsCurrency0", idmIs0);
        console2.logBytes32(PoolId.unwrap(key.toId()));
    }
}
