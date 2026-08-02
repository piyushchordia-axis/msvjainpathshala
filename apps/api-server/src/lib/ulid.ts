/** Crockford Base32 ULID (26 chars) — matches DB CHECK / api-zod ulidSchema. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function ulid(now = Date.now()): string {
  let t = now;
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32]! + time;
    t = Math.floor(t / 32);
  }
  let rand = "";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  for (let i = 0; i < 16; i++) {
    rand += CROCKFORD[bytes[i]! % 32]!;
  }
  return (time + rand).slice(0, 26);
}
