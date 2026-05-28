/**
 * Sync engine — singleton, registered from the AuthProvider on first
 * sign-in and torn down on logout.
 *
 * Triggers per CLAUDE.md "Offline sync rules":
 *   - NetInfo connection edge (offline → online)
 *   - AppState change (background → active)
 *   - 60s timer while online
 *
 * Drain priority (CLAUDE.md): attendance → shivir_scans → niyam_submissions
 * → acknowledgements. The per-queue drain function lands in each feature
 * step; Step 8 only exposes the orchestrator + hooks the queues to a
 * "drainable" interface.
 *
 * The engine is intentionally minimal: per-domain processors register
 * themselves via `registerDrain(queueName, fn)` and the engine calls them
 * in priority order. This keeps the engine itself agnostic to the
 * domain-specific request shapes.
 */

import NetInfo, { type NetInfoSubscription } from '@react-native-community/netinfo';
import { AppState, type AppStateStatus } from 'react-native';

import { acknowledgementsQueue } from '@/storage/stores/queue/acknowledgements.store';
import { attendanceQueue } from '@/storage/stores/queue/attendance.store';
import { niyamSubmissionsQueue } from '@/storage/stores/queue/niyam-submissions.store';
import { shivirScansQueue } from '@/storage/stores/queue/shivir-scans.store';
import { useSyncStore } from '@/stores/sync.store';

const DRAIN_PRIORITY = [
  'attendance',
  'shivir_scans',
  'niyam_submissions',
  'acknowledgements',
] as const;
type DrainName = (typeof DRAIN_PRIORITY)[number];
type DrainFn = () => Promise<void>;

const drainRegistry: Partial<Record<DrainName, DrainFn>> = {};

export function registerDrain(name: DrainName, fn: DrainFn): void {
  drainRegistry[name] = fn;
}

class SyncEngine {
  private timer: ReturnType<typeof setInterval> | null = null;
  private netInfoUnsub: NetInfoSubscription | null = null;
  private appStateSub: ReturnType<typeof AppState.addEventListener> | null = null;
  private inFlight = false;

  start(): void {
    if (this.timer || this.netInfoUnsub) return;
    this.timer = setInterval(() => void this.tick('timer'), 60_000);
    this.netInfoUnsub = NetInfo.addEventListener((s) => {
      if (s.isConnected && s.isInternetReachable !== false) {
        void this.tick('netinfo-online');
      } else {
        useSyncStore.getState().setStatus('offline');
      }
    });
    this.appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') void this.tick('appstate-active');
    });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.netInfoUnsub?.();
    this.netInfoUnsub = null;
    this.appStateSub?.remove();
    this.appStateSub = null;
  }

  /** Public so the UI can force a manual sync (e.g. "Retry" button). */
  async tick(reason: string): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    const store = useSyncStore.getState();
    store.setStatus('syncing');
    try {
      for (const name of DRAIN_PRIORITY) {
        const fn = drainRegistry[name];
        if (!fn) continue;
        await fn();
      }
      store.setStatus('idle');
      store.setLastSync(new Date().toISOString());
      store.setLastError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      store.setLastError(msg);
      // status flipped to 'error' inside setLastError
    } finally {
      this.inFlight = false;
      // Update count from the last tick (rough, in-process only).
      const total =
        attendanceQueue.count() +
        shivirScansQueue.count() +
        niyamSubmissionsQueue.count() +
        acknowledgementsQueue.count();
      store.setPendingCount(total);
      // Mute the trigger label past lint with a no-op read.
      void reason;
    }
  }
}

export const syncEngine = new SyncEngine();
