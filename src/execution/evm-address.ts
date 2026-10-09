const KECCAK_ROUND_CONSTANTS = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
] as const;

const KECCAK_ROTATIONS = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
] as const;

const UINT64_MASK = (1n << 64n) - 1n;

function rotateLane(value: bigint, count: number): bigint {
  if (count === 0) return value;
  const shift = BigInt(count);
  return ((value << shift) | (value >> (64n - shift))) & UINT64_MASK;
}

function keccak256Utf8(value: string): Buffer {
  const input = Buffer.from(value, "utf8");
  const rate = 136;
  const padded = Buffer.alloc(rate);
  input.copy(padded);
  padded[input.length] = 0x01;
  padded[rate - 1] |= 0x80;

  const lanes = Array<bigint>(25).fill(0n);
  for (let index = 0; index < rate; index += 1) {
    const laneIndex = Math.floor(index / 8);
    lanes[laneIndex] = lanes[laneIndex]! | (BigInt(padded[index]!) << BigInt((index % 8) * 8));
  }

  for (const roundConstant of KECCAK_ROUND_CONSTANTS) {
    const columnParity = Array<bigint>(5);
    for (let x = 0; x < 5; x += 1) {
      columnParity[x] = lanes[x]! ^ lanes[x + 5]! ^ lanes[x + 10]! ^ lanes[x + 15]! ^ lanes[x + 20]!;
    }
    const theta = columnParity.map((_, x) => columnParity[(x + 4) % 5]! ^ rotateLane(columnParity[(x + 1) % 5]!, 1));
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) lanes[x + 5 * y] = lanes[x + 5 * y]! ^ theta[x]!;
    }

    const permuted = Array<bigint>(25).fill(0n);
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        const nextX = y;
        const nextY = (2 * x + 3 * y) % 5;
        permuted[nextX + 5 * nextY] = rotateLane(lanes[x + 5 * y]!, KECCAK_ROTATIONS[x]![y]!);
      }
    }

    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        lanes[x + 5 * y] = permuted[x + 5 * y]! ^ ((~permuted[(x + 1) % 5 + 5 * y]!) & permuted[(x + 2) % 5 + 5 * y]!);
      }
    }
    lanes[0] = lanes[0]! ^ roundConstant;
  }

  const output = Buffer.alloc(32);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number((lanes[Math.floor(index / 8)]! >> BigInt((index % 8) * 8)) & 0xffn);
  }
  return output;
}

function normalizedEvmAddress(address: string): string | null {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  const lowercase = address.slice(2).toLowerCase();
  if (address === `0x${lowercase}`) return lowercase;

  const hash = keccak256Utf8(lowercase).toString("hex");
  const checksummed = `0x${[...lowercase].map((character, index) =>
    Number.parseInt(hash[index]!, 16) >= 8 ? character.toUpperCase() : character,
  ).join("")}`;
  return address === checksummed ? lowercase : null;
}

/** Compare lowercase canonical or valid EIP-55 addresses by their 20-byte identity. */
export function sameEvmAddressIdentity(left: string | undefined, right: string | undefined): boolean {
  if (left === undefined || right === undefined) return false;
  const normalizedLeft = normalizedEvmAddress(left);
  const normalizedRight = normalizedEvmAddress(right);
  return normalizedLeft !== null && normalizedRight !== null && normalizedLeft === normalizedRight;
}
