// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Absolute size constants for the launch quote currency: native ETH (18 decimals, wei).
/// @dev A 1/400 scale of the original IMD calibration, so the relative rules behave the same:
///      T_HAT 0.5 IMD -> 0.00125 ETH, T_GLITCH 5 -> 0.0125, T_SNARE 25 -> 0.0625,
///      EMA floor 0.01 IMD -> 0.000025 ETH, initial EMA size 5 IMD -> 0.0125 ETH.
///      The whale threshold is not a constant: it scales with the pool's FDV (see whale* below).
///      1/400 is not a power of two (16 * log2(400) = 138.3 units of 1/16 octave), so the wei values are exact
///      but log2Fixed rounds each one on its own: L(0.0125 ETH) = 854 (was L(5 IMD) = 993), L(floor) = 710
///      (was 849, same 144 gap). The EMA upper clamp is L(whale threshold of the swap), so it moves with FDV too:
///      L(0.04 ETH) = 881 at FDV 4 ETH, L(0.4 ETH) = 934 at FDV 400 ETH, L(WHALE_MIN) = 833, L(WHALE_MAX) = 1045.
///      T_HAT/T_GLITCH/T_SNARE reach the hook as constructor arguments (the v2 rules classify relative to the
///      size EMA and do not read them); the floor, initial size and whale constants are read by SequencerState.
///      The v1 transition (old Sepolia hook) keeps its own IMD thresholds.
library QuoteCalibration {
    uint128 internal constant T_HAT = 0.00125 ether; // 1_250_000_000_000_000 wei
    uint128 internal constant T_GLITCH = 0.0125 ether; // 12_500_000_000_000_000 wei
    uint128 internal constant T_SNARE = 0.0625 ether; // 62_500_000_000_000_000 wei
    /// @dev Amounts below this are clamped up before entering the size EMA (anti dust drag).
    uint128 internal constant EMA_FLOOR = 0.000025 ether; // 25_000_000_000_000 wei
    /// @dev sizeLogEma starts at log2Fixed(INITIAL_SIZE).
    uint128 internal constant INITIAL_SIZE = 0.0125 ether; // 12_500_000_000_000_000 wei

    // ---- Whale threshold (SPEC §3.1): whale_wei = K * sqrt(FDV_wei), clamped to [WHALE_MIN, WHALE_MAX].
    // FDV_wei = SUPPLY / P, P = 1.0001^tick = IDM per ETH (currency0 = ETH, currency1 = IDM, both 18 decimals).
    // sqrt(1 / P) = getSqrtPriceAtTick(-tick) / 2^96, so whale_wei = C * getSqrtPriceAtTick(-tick) >> 96 with
    // C = K * sqrt(SUPPLY) = floor(sqrt(K^2 * SUPPLY)) = floor(sqrt(4e41)) = 632455532033675866399.
    // K = 2e7 (sqrt-wei units) is calibrated so FDV 4 ETH (~$10k at $2500) -> 0.04 ETH; FDV 40 / 400 / 4000 ETH
    // -> 0.1265 / 0.4 / 1.265 ETH. Each tick moves the threshold by 0.005%; each 10x of FDV by sqrt(10) = 3.16x.
    // An ERC20 quote on currency1 reads the price the other way round: sqrt(FDV) uses getSqrtPriceAtTick(+tick).

    /// @dev Fixed IDM supply, wei (1 billion tokens).
    uint256 internal constant SUPPLY = 1e27;
    /// @dev Whale scale factor, wei per sqrt(wei) of FDV.
    uint256 internal constant WHALE_K = 2e7;
    /// @dev WHALE_K * sqrt(SUPPLY), rounded down: C * C <= 4e41 < (C + 1) * (C + 1). C < 2^70.
    uint256 internal constant WHALE_C = 632_455_532_033_675_866_399;
    /// @dev Clamp: 0.005 ETH is reached at FDV 0.0625 ETH (tick 234971), 50 ETH at FDV 6.25M ETH (tick 50754).
    uint128 internal constant WHALE_MIN = 0.005 ether; // 5_000_000_000_000_000 wei
    uint128 internal constant WHALE_MAX = 50 ether; // 50_000_000_000_000_000_000 wei
}
