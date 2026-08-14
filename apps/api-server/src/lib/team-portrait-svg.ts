/**
 * Simple illustrated Jain-person placeholders for Team cards.
 * Distinct per member id — people (not scenery), cream/saffron/maroon palette.
 */

const SKIN = ["#F2D2B6", "#E8C4A0", "#D4A574", "#C68642"] as const;
const HAIR = ["#1A0A00", "#2C1810", "#3D2314", "#4A2C14"] as const;
const KURTA = ["#FFFEF9", "#F5EDE0", "#FDF8F2"] as const;
const ACCENT = ["#D4621A", "#7A1818", "#C8941F"] as const;

function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(arr: readonly T[], n: number): T {
  return arr[n % arr.length]!;
}

export function renderJainTeamPortraitSvg(
  memberId: string,
  gender: "male" | "female" | null,
): string {
  const h = hash32(memberId);
  const isFemale = gender === "female" ? true : gender === "male" ? false : (h & 1) === 1;
  const skin = pick(SKIN, h >>> 2);
  const hair = pick(HAIR, h >>> 5);
  const cloth = pick(KURTA, h >>> 8);
  const accent = pick(ACCENT, h >>> 11);
  const eye = "#3D2314";

  const stole = isFemale
    ? `<path d="M70 400 C90 300 140 275 200 290 C250 278 310 310 330 400 Z" fill="${accent}"/>
       <path d="M248 268 C300 250 340 310 348 400 L250 400 C255 330 250 290 248 268 Z" fill="${cloth}"/>`
    : `<path d="M95 305 L155 268 L175 400 L70 400 Z" fill="${accent}" opacity="0.92"/>
       <path d="M305 305 L245 268 L225 400 L330 400 Z" fill="${accent}" opacity="0.92"/>`;

  const hairEl = isFemale
    ? `<ellipse cx="200" cy="142" rx="88" ry="78" fill="${hair}"/>
       <circle cx="268" cy="168" r="28" fill="${hair}"/>
       <path d="M118 168 C110 230 118 280 132 318 C148 290 155 240 160 200 Z" fill="${hair}"/>`
    : `<path d="M122 148 C122 88 168 72 200 72 C232 72 278 88 278 148 C278 118 248 98 200 98 C152 98 122 118 122 148 Z" fill="${hair}"/>`;

  const bindi = isFemale
    ? `<circle cx="200" cy="148" r="5" fill="${accent}"/>`
    : `<circle cx="200" cy="146" r="4.5" fill="${accent}"/>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400" role="img" aria-label="Team member portrait">
  <rect width="400" height="400" fill="#FDF8F2"/>
  <ellipse cx="200" cy="400" rx="148" ry="118" fill="${cloth}"/>
  ${stole}
  <rect x="172" y="248" width="56" height="52" rx="18" fill="${skin}"/>
  <circle cx="200" cy="168" r="78" fill="${skin}"/>
  <ellipse cx="128" cy="176" rx="12" ry="18" fill="${skin}"/>
  <ellipse cx="272" cy="176" rx="12" ry="18" fill="${skin}"/>
  ${hairEl}
  ${bindi}
  <path d="M168 158 Q180 150 190 158" fill="none" stroke="${hair}" stroke-width="3.5" stroke-linecap="round"/>
  <path d="M210 158 Q220 150 232 158" fill="none" stroke="${hair}" stroke-width="3.5" stroke-linecap="round"/>
  <ellipse cx="178" cy="176" rx="9" ry="11" fill="#FFFEF9"/>
  <ellipse cx="222" cy="176" rx="9" ry="11" fill="#FFFEF9"/>
  <circle cx="179" cy="177" r="5" fill="${eye}"/>
  <circle cx="223" cy="177" r="5" fill="${eye}"/>
  <circle cx="177" cy="175" r="1.6" fill="#FFFEF9"/>
  <circle cx="221" cy="175" r="1.6" fill="#FFFEF9"/>
  <path d="M196 196 L200 204 L204 196" fill="none" stroke="#C4896A" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M178 222 Q200 236 222 222" fill="none" stroke="#B07060" stroke-width="3" stroke-linecap="round"/>
</svg>`;
}
