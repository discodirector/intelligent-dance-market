// A TS port of Credits' CreditScore (Ethereum 0x817a9cffb4d6e7c206e745a4229001a472c1b7b7, the contract
// Statements.score() names; verified source src/CreditScore.sol + CreditDrawing.slips, Solidity 0.8.28): a Credit's
// score, 80-800 in ten-thousandths (800,000-8,000,000), from its seed and payment second alone. Pure and exact: the
// build script (build-credit-scores.ts) checks it against eth_call scoreOf on random Credits. Not shipped: the
// stations read the precomputed table (src/credittable.ts).
import { createHash } from "node:crypto";

/** CreditScore.TABLE: 647 five-byte big-endian entries (palette 16, active 257, occupied 145, eights 22, band 6, curve 201). */
const TABLE_HEX =
  "0000000000002ded55fb004223edf9001883faeb001ed9707d0060d1bbce0004336fbe004f88e8c600a2c1af4f0008afed5600372f44eb0012c85693" +
  "00792b4ebb000d88117600000000000025ea03c002ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff" +
  "02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff025a38b326022b39cb9601bea6320601b2c49ddf" +
  "01743acc12013118026b0109cf995000c26deeb2007c2e1672006dc64b55005524e13f0042e5a2f000233230b40019df7c4800140dc8be0008b8e3bc" +
  "000c5a80e2000a86b76200102d76fe001bb892b30021741007003e7a042b00576407aa006bad13d000818fbf6b00b456ed08010ffbb35b01385e9b48" +
  "015fc7cc7e018862bb2401a7a973f5014f7cae2a01476019a5012a3ee9eb00e7479da200b456ed080094f6d1ea007448ff6e006fe1f777005e63fb08" +
  "00477c36e1003a47f3c10024fb6e9c001f8023a90015fcc156001216ff590005336fa70003720c0600000000000001b483c00006f4b32d000e3cc4dd" +
  "0017e97790001d97f8b70026cb227300384461ee004bf5d8120059b2f57300677608f300784181960086fa3efb00ac779d9a00c586e7d000d356df4c" +
  "00dac9d2ea00cc19f06c00b9adfa280099582587007e00a5d3007641c8b8006998e7bd006311f8980060c0a054005094e6500049b8636b00453063c4" +
  "00364c12b30032421e8d003047ac510028a46e1e002c6016ad002a7b49db002e4d766f003442d7a4003c5a1d450040a93807004e47d66f0052d57a1b" +
  "005c0a7a2100654287ec00720b8097007a3e93e0007fd2fc7000972447d900a78c4f8d00c586e7d000e31abe1700fe8b58cc010406cc3300f01a46b7" +
  "00f4990df500eb9771aa00cf9e54a900bc8472e900b1a089ea00af03abff00a2ba055b00a05d5f82009b9ff37c008cb90c220090c47ee30086fa3efb" +
  "0085267e52008eb75bfb008358bb61008ac767e00092d89b48009df45f1700a517af7a00a9fb76ee00bc8472e900ded50f1300d6fbc7d800f96d8c08" +
  "0116c3aaf1011da5b4ef0123b63fdd013f9bf2aa01693ca22301574f7d38017fdb2f78018862bb2401cc63b510018862bb2401ef6c9eb901dcce291c" +
  "02079786cd02ba26c5ff0218bd34e6025a38b326022b39cb96025a38b32602ba26c5ff025a38b326025a38b32602ba26c5ff02ba26c5ff02ba26c5ff" +
  "02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff" +
  "02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff" +
  "02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff" +
  "02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff" +
  "02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff" +
  "02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff" +
  "02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff" +
  "02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff" +
  "02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff" +
  "02ba26c5ff025a38b326020aa6333c01b678ac2401abfccb3a01760444b201494d5b440119b83ac300fe3b1b8f00dbee149200c8b59b36009c0edffe" +
  "00861fc1a6006b958432005a24753c004ad70d870038d72b6400415015b4003cf6ac3e0046005f57005fbfccf50065d827b0007f32c8d90094b71700" +
  "00b3e3884e00bdc6b41c00a3c892ec008d8252de0071d3be08004fcfc16c0030df360a00282059bd000ea5fa060002c308220000000000000b7e0884" +
  "0011efcaaf0023ff9a79002022e58f001c703f52001547084c00087e4b8d000594cb570018c97ea3002c8c995c0034d60b490054eec5c1007881841a" +
  "00ab599a4c00d3160f8600e59ffb5d00edb6548700f57db64401071704c80111057f6f0121ea50d4012b1fdcf4013f17609201349ee7c8015496440d" +
  "0160adf368016b5da5e50182090294018ba5c448018ba5c44801a0e831c701b678ac2401d0fa0a2101e2ec89e6020aa6333c01ff42edb701f3895e21" +
  "020aa6333c025a38b326020aa6333c02462a8a7a02ba26c5ff025a38b326025a38b32602ba26c5ff02ba26c5ff025a38b32602ba26c5ff02ba26c5ff" +
  "02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff" +
  "02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff" +
  "02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff" +
  "02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff02ba26c5ff0000000000009d40b280" +
  "01854aebcc02a2d6715c03eb68967a05744d8bfe05744d8bfe05744d8bfe05744d8bfe05744d8bfe05744d8bfe05744d8bfe05744d8bfe05744d8bfe" +
  "05744d8bfe05744d8bfe05744d8bfe05744d8bfe05744d8bfe05744d8bfe05744d8bfe05744d8bfe00000000000091cfd63d007b2290e300b61d828f" +
  "00e1323df1011fbe3bd90004336fbe000b2822eb000fb178420016233a6d0019954673001c89570300207a72b4002592ac3900296ce6b5002c5d6498" +
  "00301015320032598d6d0035dc77a80038b08a77003af9184d003d645913003f7cf37a0041b7050b0043947ebb00456c09c80046eb892d0048a4ce3b" +
  "004a9f4077004beb4f1b004e679c5b004fef0e630051a12591005403312a00560d1f110057dd0403005972b6aa005b36c0c7005d860c54005f804236" +
  "0060697f9d00617ab47200637b30880065534953006656d41d006706cff600693eebe1006b9ef8be006c840713006e7c7018006f7d651b00712c3994" +
  "00736400120074ea233100756ab99b007607a8a00078bb335e007abde2d9007b97ec91007da2da9d007dc2223b007f621377008121c68400836b2a8c" +
  "0083b3fd190084393be200867ef16000884ee0a40089a15199008b1b196a008cd22c40008d4f2af3008f34421b008fe6c8b800920fcc970092dd6201" +
  "0094b27e160096e4617f009851c44e0099d9e9a4009a73dbf7009cb6fc15009f955c4f00a108c43e00a1f1477f00a3a8dbfd00a5f7e10800a6e18be0" +
  "00a908628300aa0a84c500acccb75d00aded842700b1282e3e00b3e6ddef00b5398db200b627df7d00b86f9f6700bb27e18400bcb50ae100bd9c4da1" +
  "00c0ed93d100c441a07d00c7031c8c00c97025b000cbfa532200cea92b4700d0e4ed7c00d2bdc6ed00d5f13cf700d8a3c49d00dad8d92800dcbda5fa" +
  "00def7d17d00e16d87be00e37eb5de00e451be6f00e65fc21a00e803420000e9e6929f00ea65a2d500ec3edf2a00ee75d9a400f06c45e500f1b44d23" +
  "00f4a9800a00f6f2ba9100f8c56b8000f97b21d500fcb2b56d00fe57e75300ffd0bafd0101a6859401034303e801052ca4fb0107e23b4f0109da39a2" +
  "010b29528f010ced6d9701100d31ba011247f95201155c52660116c5a0d30118d89f11011af5ab62011cd9b078011e3efdda01208374b101226fae06" +
  "0125613e090127eefb30012a0de706012b883c2a012e150fa201301e148101318964350133c11dbc013749d02c0139d17fa8013d7cb23c013f31f9ff" +
  "01435bbc220146a66823014ada55c0014e71c801015359f40f01572646cd015aeffac301606e7c53016336d6bd01679018f0016bc713e50171abdb4e" +
  "0176f8f071017b597cea01819270ef01860cd5ef018abf5be1018edccdf90193f5708c01987e7e70019de748d201a4528a6401abd84ae201b4065353" +
  "01bb7ac17701c221c7b701c88fb44a01ceca16b501d8763e6001dfa1f43201e9e5e2d801f384605401fc9c080d020536c1c2020ff667d5021ae73718" +
  "022892ee58023780cb7d0248ee0951025ea3e8e20271984406028a801ea402a9464d9302d161716703050d179303608a0b0c061f2a3a6c";

const PALETTE = 0;
const ACTIVE = 16;
const OCCUPIED = 273;
const EIGHTS = 418;
const BAND = 440;
const CURVE = 446;
const KNOTS = 200;

let table: number[] | null = null;
/** The table's entries (parsed once). */
function entries(): number[] {
  if (table) return table;
  if (TABLE_HEX.length !== 647 * 10) throw new Error(`credit-score: TABLE must be 647 x 5 bytes, got ${TABLE_HEX.length / 2}`);
  table = Array.from({ length: 647 }, (_, i) => parseInt(TABLE_HEX.slice(i * 10, i * 10 + 10), 16));
  return table;
}

const sha256 = (b: Uint8Array) => new Uint8Array(createHash("sha256").update(b).digest());
const popcount = (x: bigint) => {
  let n = 0;
  for (; x; x &= x - 1n) n++;
  return n;
};

/** CreditDrawing.slips: each plate's misregistration offset (dx, dy), from sha256(seed ++ "/misprint"). */
export function slips(seed: Uint8Array): { dx: number[]; dy: number[] } {
  const dx = [0, 0, 0, 0];
  const dy = [0, 0, 0, 0];
  const h = sha256(new Uint8Array([...seed, ...new TextEncoder().encode("/misprint")]));
  if (h[0] >= 32) return { dx, dy };
  const dice = h[1];
  let maxStep = 1;
  let movers = 1;
  let kMoves = false;
  if (dice < 80) movers = 1;
  else if (dice < 160) movers = 2;
  else if (dice < 210) movers = 3;
  else if (dice < 240) {
    maxStep = 2;
    movers = 2 + (h[2] % 2);
  } else {
    maxStep = 2;
    movers = 3 + (h[2] % 2);
    kMoves = true;
  }
  const pool = kMoves ? [0, 1, 2, 3] : [0, 1, 2];
  let cursor = 3;
  const selected: number[] = [];
  while (selected.length < movers && pool.length > 0) {
    const idx = h[cursor++ % 32] % pool.length;
    selected.push(pool[idx]);
    pool.splice(idx, 1);
  }
  const ux = [-1, 1, 0, 0, -1, -1, 1, 1];
  const uy = [0, 0, -1, 1, -1, 1, -1, 1];
  for (const layer of selected) {
    const b = h[(layer + cursor) % 32];
    const c = h[(layer + cursor + 4) % 32];
    let x: number;
    let y: number;
    if (maxStep === 1) {
      x = ux[b % 8];
      y = uy[b % 8];
    } else {
      x = (b % 5) - 2;
      y = (c % 5) - 2;
      if (x === 0 && y === 0) x = b & 1 ? 2 : -2;
    }
    dx[layer] = x;
    dy[layer] = y;
  }
  return { dx, dy };
}

/** CreditScore.traitsOf: plate mask, active bits, occupied cells, eights, registration band. */
export function traitsOf(seed: Uint8Array, paidAt: bigint) {
  if (seed.length !== 21) throw new Error("seed must be 21 bytes");
  const mask = Number(paidAt % 15n) + 1;
  const hash = BigInt("0x" + Buffer.from(sha256(seed)).toString("hex"));
  const { dx, dy } = slips(seed);
  const rows = new Array<bigint>(12).fill(0n);
  let active = 0;
  for (let l = 0; l < 4; l++) {
    if (((mask >> l) & 1) === 0) continue;
    const plate = (hash >> BigInt(192 - 64 * l)) & 0xffff_ffff_ffff_ffffn;
    active += popcount(plate);
    for (let y = 0; y < 8; y++) {
      const bits = (plate >> BigInt(56 - 8 * y)) & 0xffn;
      if (bits === 0n) continue;
      rows[y + dy[l] + 2] |= bits << BigInt(2 - dx[l]);
    }
  }
  const occupied = rows.reduce((a, r) => a + popcount(r), 0);
  const eights = seed.reduce((a, b) => a + (b === 0x38 ? 1 : 0), 0);
  const misprint = sha256(new Uint8Array([...seed, ...new TextEncoder().encode("/misprint")]));
  let band = 0;
  if (misprint[0] < 32) {
    const d = misprint[1];
    band = d < 80 ? 1 : d < 160 ? 2 : d < 210 ? 3 : d < 240 ? 4 : 5;
  }
  return { mask, active, occupied, eights, band };
}

/** CreditScore.curve: a rarity placed on 800,000-8,000,000. */
export function curve(x: number): number {
  const t = entries();
  if (x <= t[CURVE]) return 800_000;
  if (x >= t[CURVE + KNOTS]) return 8_000_000;
  let l = 0;
  let h = KNOTS;
  while (h - l > 1) {
    const m = (l + h) >> 1;
    if (t[CURVE + m] <= x) l = m;
    else h = m;
  }
  const low = BigInt(t[CURVE + l]);
  const d = BigInt(t[CURVE + l + 1]) - low;
  return 800_000 + Number((36_000n * (BigInt(l) * d + (BigInt(x) - low))) / d);
}

/** CreditScore.scoreOf(seed, paidAt): ten-thousandths (1,324,012 = 132.4012, Credit #1). */
export function scoreOf(seed: Uint8Array, paidAt: bigint): { score: number; mask: number } {
  const t = entries();
  const { mask, active, occupied, eights, band } = traitsOf(seed, paidAt);
  const rarity = t[PALETTE + mask] + t[ACTIVE + active] + t[OCCUPIED + occupied] + t[EIGHTS + eights] + t[BAND + band];
  return { score: curve(rarity), mask };
}
