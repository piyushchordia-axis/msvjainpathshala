/**
 * useNetworkStore — Zustand store fed by `@react-native-community/netinfo`.
 *
 * Mounted from the `NetworkProvider` in `app/_layout.tsx`. The store also
 * exposes the raw NetInfoState so callers can branch on connection type
 * (cellular vs wifi) — useful for "don't auto-upload over cellular" rules
 * the gallery / media features may want later.
 */

import { create } from 'zustand';

import type { NetInfoState } from '@react-native-community/netinfo';

interface NetworkState {
  isOnline: boolean;
  type: NetInfoState['type'] | 'unknown';
  details: NetInfoState['details'] | null;
  setState(s: NetInfoState): void;
}

export const useNetworkStore = create<NetworkState>((set) => ({
  isOnline: true, // optimistic until NetInfo reports
  type: 'unknown',
  details: null,
  setState: (s) =>
    set({
      isOnline: Boolean(s.isConnected) && s.isInternetReachable !== false,
      type: s.type,
      details: s.details,
    }),
}));
