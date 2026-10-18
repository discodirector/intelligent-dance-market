import { parseAbi } from "viem";

export const hookAbi = parseAbi([
  "function raw() view returns (uint256, uint256)",
  "function poolId() view returns (bytes32)",
  "function factory() view returns (address)",
  // Same topic on the v1 (IMD) and v2 (ETH) hooks; the amount parameter was renamed imdAmount -> quoteAmount.
  "event Mutated(address indexed sender, uint32 indexed swapCount, uint8 track, uint8 step, bool on, uint8 bassNote, bool isBuy, uint128 quoteAmount, int24 tick, uint256 slot0, uint256 slot1)",
  "event Movement(uint32 indexed patternId, uint8 root, uint32 swapCount)",
  "event Drop(uint32 indexed swapCount, uint8 track, bool fill, uint16 mask)",
  // v2 hook only.
  "event TrackComplete(uint16 indexed trackNo, uint32 patternId, uint8 root, uint256 slot0, uint256 slot1, uint32 swapCount, uint64 seed)",
  "event Accumulated(uint32 indexed swapCount, uint8 fromTrack, uint8 writeStep, bool promoted, bool noop)",
]);

export const routerAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  // payable since the native-ETH SimRouter (v2 rehearsal); the v1 router simply gets no value.
  "function swap(PoolKey key, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96) payable returns (int256)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function mint(address to, uint256 amount)",
]);
