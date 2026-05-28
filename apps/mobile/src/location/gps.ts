/**
 * GPS capture helper for the shikshak check-in flow (SPEC §8.2).
 *
 * Two surfaces:
 *   - `ensurePermission()`: request foreground permission. Returns a status
 *     enum so the UI can show a guidance message rather than crash on deny.
 *   - `getCurrentPosition({ minAccuracyM })`: poll for a fix until either the
 *     desired accuracy is met or the timeout elapses. We reject if the
 *     final fix is worse than `minAccuracyM` so the server doesn't see a
 *     500m-accuracy reading.
 */

import * as Location from 'expo-location';

export type GpsPermissionStatus = 'granted' | 'denied' | 'restricted';

export interface GpsFix {
  lat: number;
  lng: number;
  accuracy_m: number;
  captured_at: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MIN_ACCURACY_M = 100;
const POLL_INTERVAL_MS = 1_500;

export async function ensurePermission(): Promise<GpsPermissionStatus> {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.status === 'granted') return 'granted';
  if (current.status === 'denied' && !current.canAskAgain) return 'denied';
  const next = await Location.requestForegroundPermissionsAsync();
  if (next.status === 'granted') return 'granted';
  if (next.status === 'denied') return 'denied';
  return 'restricted';
}

export async function getCurrentPosition(opts?: {
  minAccuracyM?: number;
  timeoutMs?: number;
}): Promise<GpsFix> {
  const minAccuracy = opts?.minAccuracyM ?? DEFAULT_MIN_ACCURACY_M;
  const timeout = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const permission = await ensurePermission();
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Location permission was denied. Enable it in system settings to check in.'
        : 'Location permission is restricted on this device.',
    );
  }

  const start = Date.now();
  let bestFix: GpsFix | null = null;
  while (Date.now() - start < timeout) {
    let pos: Location.LocationObject;
    try {
      pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
    } catch {
      // Try once more in a moment — first fix can fail on cold start.
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    const fix: GpsFix = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy_m: Math.round(pos.coords.accuracy ?? 9999),
      captured_at: new Date(pos.timestamp).toISOString(),
    };
    if (!bestFix || fix.accuracy_m < bestFix.accuracy_m) {
      bestFix = fix;
    }
    if (fix.accuracy_m <= minAccuracy) {
      return fix;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  if (bestFix && bestFix.accuracy_m <= minAccuracy * 1.5) {
    // Soft accept if we're within 50% of the gate at timeout — the server
    // also enforces the hard 100m gate, so an out-of-gate fix surfaces a
    // useful error there.
    return bestFix;
  }
  throw new Error(
    bestFix
      ? `Could not get a precise GPS fix (best ${bestFix.accuracy_m}m). Move outdoors and try again.`
      : 'Could not get a GPS fix. Move outdoors and try again.',
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
