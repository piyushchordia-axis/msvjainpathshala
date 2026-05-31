/**
 * Haversine distance — great-circle distance between two lat/lng pairs in
 * metres. Pure-JS, no deps.
 *
 * Accuracy: within ~0.5% of geodesic distance for ranges < 100km, which is
 * vastly more accuracy than GPS check-in needs (we tolerate a 500m radius
 * by default per `centres.gps_radius_m`).
 *
 * Used by `SessionsService.checkIn` to detect off-site check-ins and flag
 * `sessions.gps_haversine_m` for the sanchalak's review.
 */

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_M * c);
}
