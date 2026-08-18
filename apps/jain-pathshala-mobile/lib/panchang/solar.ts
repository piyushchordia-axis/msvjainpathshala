/**
 * Civil sunrise / sunset via NOAA-style solar position (pure TS).
 * Refraction altitude ≈ −0.833°.
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function julianDay(year: number, month: number, day: number): number {
  // Meeus: integer division for Gregorian calendar
  if (month <= 2) {
    year -= 1;
    month += 12;
  }
  const A = Math.floor(year / 100);
  const B = 2 - A + Math.floor(A / 4);
  return (
    Math.floor(365.25 * (year + 4716)) +
    Math.floor(30.6001 * (month + 1)) +
    day +
    B -
    1524.5
  );
}

function solarMeanAnomaly(t: number): number {
  return 357.52911 + t * (35999.05029 - 0.0001537 * t);
}

function equationOfCenterT(M: number, t: number): number {
  const Mr = M * DEG;
  return (
    Math.sin(Mr) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * Mr) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * Mr) * 0.000289
  );
}

function sunDeclination(t: number): { decl: number; eqTimeMin: number } {
  const L0 = (280.46646 + t * (36000.76983 + 0.0003032 * t)) % 360;
  const M = solarMeanAnomaly(t);
  const C = equationOfCenterT(M, t);
  const sunTrue = L0 + C;
  const omega = 125.04 - 1934.136 * t;
  const lambda = sunTrue - 0.00569 - 0.00478 * Math.sin(omega * DEG);
  const epsilon0 =
    23.439291 - t * (0.013004167 + t * (0.0000001639 - t * 0.0000005036));
  const epsilon = epsilon0 + 0.00256 * Math.cos(omega * DEG);
  const decl = Math.asin(Math.sin(epsilon * DEG) * Math.sin(lambda * DEG)) * RAD;

  const y = Math.tan((epsilon * DEG) / 2) ** 2;
  const eqTimeMin =
    4 *
    RAD *
    (y * Math.sin(2 * L0 * DEG) -
      2 * 0.016708634 * Math.sin(M * DEG) +
      4 * 0.016708634 * y * Math.sin(M * DEG) * Math.cos(2 * L0 * DEG) -
      0.5 * y * y * Math.sin(4 * L0 * DEG) -
      1.25 * 0.016708634 * 0.016708634 * Math.sin(2 * M * DEG));

  return { decl, eqTimeMin };
}

function hourAngle(lat: number, decl: number): number | null {
  const latR = lat * DEG;
  const declR = decl * DEG;
  const cosH =
    (Math.cos(90.833 * DEG) - Math.sin(latR) * Math.sin(declR)) /
    (Math.cos(latR) * Math.cos(declR));
  if (cosH < -1 || cosH > 1) return null; // polar day/night
  return Math.acos(cosH) * RAD;
}

/**
 * Approximate UTC minutes from local-mean midnight for rise/set on the given
 * civil date at longitude (east positive). NOAA algorithm adapted.
 */
function sunEventUtcMinutes(
  year: number,
  month: number,
  day: number,
  lat: number,
  lng: number,
  rising: boolean,
): number | null {
  const jd = julianDay(year, month, day);
  // First pass at solar noon
  let t = (jd - 2451545.0 - lng / 360) / 36525;
  let { decl, eqTimeMin } = sunDeclination(t);
  let solarNoonMin = 720 - 4 * lng - eqTimeMin;
  const H = hourAngle(lat, decl);
  if (H == null) return null;
  let eventMin = rising ? solarNoonMin - 4 * H : solarNoonMin + 4 * H;

  // Second pass with refined time
  t = (jd + eventMin / 1440 - 2451545.0) / 36525;
  ({ decl, eqTimeMin } = sunDeclination(t));
  solarNoonMin = 720 - 4 * lng - eqTimeMin;
  const H2 = hourAngle(lat, decl);
  if (H2 == null) return null;
  eventMin = rising ? solarNoonMin - 4 * H2 : solarNoonMin + 4 * H2;
  return eventMin;
}

/**
 * Parse YYYY-MM-DD and return UTC epoch ms for sunrise & sunset
 * interpreted as wall-clock moments in `timeZone` (India: Asia/Kolkata = UTC+5:30).
 *
 * Implementation: compute event as UTC minutes from the calendar date's
 * 00:00 UTC, then the NOAA minutes are already UTC-based for that date's JD.
 */
export function computeSunriseSunset(opts: {
  lat: number;
  lng: number;
  date: string; // YYYY-MM-DD
  timeZone?: string;
}): { sunriseMs: number; sunsetMs: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(opts.date);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);

  const riseMin = sunEventUtcMinutes(year, month, day, opts.lat, opts.lng, true);
  const setMin = sunEventUtcMinutes(year, month, day, opts.lat, opts.lng, false);
  if (riseMin == null || setMin == null) return null;

  // JD midnight UTC for the date + event minutes → UTC Date
  const baseUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  const sunriseMs = baseUtc + riseMin * 60_000;
  const sunsetMs = baseUtc + setMin * 60_000;
  if (!(sunsetMs > sunriseMs)) return null;
  return { sunriseMs, sunsetMs };
}

/** Parse local HH:mm on a calendar date in IST (+05:30) to epoch ms. */
export function localHHmmToMs(date: string, hhmm: string): number | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!dm || !tm) return null;
  const y = Number(dm[1]);
  const mo = Number(dm[2]);
  const d = Number(dm[3]);
  const h = Number(tm[1]);
  const mi = Number(tm[2]);
  // IST = UTC+5:30 → UTC = local − 5:30
  return Date.UTC(y, mo - 1, d, h, mi) - (5 * 60 + 30) * 60_000;
}

/**
 * Render an instant as an IST wall-clock time, to the minute.
 *
 * The rounding direction matters and has no safe default for both cases.
 * toLocaleTimeString with hour+minute simply discards the seconds, so 06:48:59
 * printed as "6:48 am" — up to 59 seconds EARLY. A parent who waits for the
 * displayed minute and then eats has broken the Navkarsi vow on the app's word.
 *
 * So: a permission time rounds UP, and a deadline rounds DOWN. Both directions
 * err by making the observance slightly stricter, which is the only tolerable
 * way to be wrong here. Callers with a Pachchakkhan slot pass its `boundary`
 * (see istRoundingFor) rather than choosing.
 *
 * Default stays "down" for the informational sunrise/sunset line, so that it
 * agrees with Chovihar rather than reading a minute later than the sunset it
 * is derived from.
 */
export function formatTimeIst(
  ms: number,
  hi: boolean,
  round: "up" | "down" = "down",
): string {
  const MINUTE = 60_000;
  const rounded =
    round === "up" ? Math.ceil(ms / MINUTE) * MINUTE : Math.floor(ms / MINUTE) * MINUTE;
  return new Date(rounded).toLocaleTimeString(hi ? "hi-IN" : "en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
