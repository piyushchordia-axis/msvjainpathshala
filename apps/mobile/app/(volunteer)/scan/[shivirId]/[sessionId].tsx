/**
 * Volunteer QR scanner — Step 15 (SPEC §6.14, §8.6).
 *
 * URL pattern: `/(volunteer)/scan/[shivirId]/[sessionId]`.
 *
 * Behaviour:
 *   - Asks the user for camera permission on mount.
 *   - When granted, mounts `expo-camera`'s `CameraView` with a QR-only
 *     barcode scanner setting.
 *   - On a successful scan:
 *       * Generates a ULID `client_op_id`.
 *       * Tries the direct POST `/v1/shivirs/:id/scan` if the device is
 *         online. On 2xx → success flash + display student name +
 *         in/out direction. On 4xx → red flash + reason.
 *       * On network error OR if `useNetworkStore.isOnline === false`,
 *         enqueues the scan into `shivirScansQueue` (Step 14 unified
 *         drain handles it) → shows a "Saved offline" toast.
 *   - A bottom-sheet "Scan history" lists the last 20 scans this
 *     session (success + failures).
 *   - A "Manual entry" mode (for when the camera misreads) provides a
 *     text input.
 *
 * Camera lock: after each scan, we debounce the camera for 1.5s so the
 * volunteer doesn't accidentally re-scan the same badge while the
 * confirmation flash is still on screen.
 */

// expo-camera — see src/types/expo-camera.d.ts for the type shim. The
// runtime native module ships with `pnpm install` once the dep is added.
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ulid } from 'ulid';

import { ApiError } from '@/api/client';
import { GhostButton, PrimaryButton } from '@/components/ui';
import { JPColors, JPRadius, JPSpacing } from '@/constants/colors';
import { shivirScansQueue } from '@/storage';
import { useNetworkStore } from '@/stores/network.store';
import { shivirsApi, type ScanResponse, type ShivirScanKind } from '@/sync/shivirs.api';

const CAMERA_DEBOUNCE_MS = 1500;

type ScanOutcome =
  | { kind: 'success'; scan: ScanResponse }
  | { kind: 'offline'; client_op_id: string; student_qr_code: string }
  | { kind: 'error'; code: string; message: string };

interface HistoryEntry {
  at: string;
  outcome: ScanOutcome;
}

export default function VolunteerScannerScreen() {
  const router = useRouter();
  const { shivirId, sessionId } = useLocalSearchParams<{ shivirId: string; sessionId: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const isOnline = useNetworkStore((s) => s.isOnline);

  const [scanLocked, setScanLocked] = useState(false);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err' | null; message: string }>({
    kind: null,
    message: '',
  });
  const [manualValue, setManualValue] = useState('');
  const [manualMode, setManualMode] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  const onScan = useCallback(
    async (code: string) => {
      if (!code || scanLocked) return;
      if (!shivirId || !sessionId) return;
      setScanLocked(true);
      const client_op_id = ulid();
      const scanned_at = new Date().toISOString();

      let outcome: ScanOutcome;
      try {
        if (!isOnline) {
          shivirScansQueue.enqueue('shivir.scan', {
            shivir_id: shivirId,
            scanned_code: code,
            scanned_at,
            scanner_user_id: '', // resolved by sync handler from JWT
          });
          outcome = { kind: 'offline', client_op_id, student_qr_code: code };
        } else {
          const scan = await shivirsApi.scan(shivirId, {
            shivir_session_id: sessionId,
            student_qr_code: code,
            client_op_id,
            scanned_at,
          });
          outcome = { kind: 'success', scan };
        }
      } catch (err) {
        if (err instanceof ApiError) {
          // 4xx / 409 from the server — show the reason.
          outcome = {
            kind: 'error',
            code: err.code,
            message: err.message,
          };
        } else {
          // Network / 5xx — enqueue for later retry.
          shivirScansQueue.enqueue('shivir.scan', {
            shivir_id: shivirId,
            scanned_code: code,
            scanned_at,
            scanner_user_id: '',
          });
          outcome = { kind: 'offline', client_op_id, student_qr_code: code };
        }
      }

      setHistory((prev) => [{ at: scanned_at, outcome }, ...prev].slice(0, 20));
      applyFlash(outcome);
      // unlock after the debounce window
      debounceTimer.current = setTimeout(() => setScanLocked(false), CAMERA_DEBOUNCE_MS);
    },
    [isOnline, scanLocked, sessionId, shivirId],
  );

  const applyFlash = (outcome: ScanOutcome) => {
    if (outcome.kind === 'success') {
      const dir = directionLabel(outcome.scan.scan_kind);
      setFlash({
        kind: 'ok',
        message: `${outcome.scan.student_full_name} · ${dir}`,
      });
    } else if (outcome.kind === 'offline') {
      setFlash({ kind: 'ok', message: 'Saved offline — will sync when online' });
    } else {
      setFlash({ kind: 'err', message: outcome.message });
    }
    setTimeout(() => setFlash({ kind: null, message: '' }), CAMERA_DEBOUNCE_MS);
  };

  const onManualSubmit = useCallback(() => {
    const v = manualValue.trim();
    if (!v) return;
    setManualValue('');
    void onScan(v);
  }, [manualValue, onScan]);

  const cameraOverlay = useMemo(() => {
    if (flash.kind === null) {
      return (
        <View style={styles.cameraGuide}>
          <View style={styles.reticle} />
          <Text style={styles.cameraPrompt}>
            {isOnline ? "Scan a student's ID badge" : 'Offline — scans will sync later'}
          </Text>
        </View>
      );
    }
    return (
      <View style={[styles.flashOverlay, flash.kind === 'ok' ? styles.flashOk : styles.flashErr]}>
        <Text style={styles.flashText}>{flash.message}</Text>
      </View>
    );
  }, [flash, isOnline]);

  // ---------------- Render branches ----------------

  if (!permission) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.centered}>
          <ActivityIndicator color={JPColors.saffron} />
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted && !manualMode) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.centered}>
          <Text style={styles.headline}>Camera permission required</Text>
          <Text style={styles.body}>
            We need access to your camera to scan student ID badges. You can also enter codes
            manually if you prefer.
          </Text>
          <View style={{ height: SP.m }} />
          <PrimaryButton onPress={() => void requestPermission()}>Allow camera</PrimaryButton>
          <View style={{ height: SP.s }} />
          <GhostButton onPress={() => setManualMode(true)}>Enter codes manually</GhostButton>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Shivir scan</Text>
        <Pressable
          onPress={() => setManualMode((v) => !v)}
          hitSlop={12}
          accessibilityLabel="Toggle manual entry"
        >
          <Text style={styles.action}>{manualMode ? 'Camera' : 'Manual'}</Text>
        </Pressable>
      </View>

      {/* Camera or manual entry */}
      {manualMode ? (
        <View style={[styles.cameraBox, styles.manualBox]}>
          <Text style={styles.body}>Enter the student code or QR payload</Text>
          <TextInput
            value={manualValue}
            onChangeText={setManualValue}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            placeholder="MSV-AHM-00123 or QR text"
            placeholderTextColor={JPColors.textSub}
            editable={!scanLocked}
          />
          <View style={{ height: SP.s }} />
          <PrimaryButton
            onPress={onManualSubmit}
            disabled={scanLocked || manualValue.trim().length === 0}
          >
            {scanLocked ? 'Scanning…' : 'Submit'}
          </PrimaryButton>
        </View>
      ) : (
        <View style={styles.cameraBox}>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={(result) => {
              if (scanLocked) return;
              void onScan(result.data);
            }}
          />
          {cameraOverlay}
        </View>
      )}

      {/* History bottom sheet */}
      <View style={styles.sheet}>
        <Text style={styles.sheetTitle}>Recent scans</Text>
        <ScrollView style={{ maxHeight: 220 }} contentContainerStyle={{ paddingBottom: 8 }}>
          {history.length === 0 ? (
            <Text style={styles.body}>No scans yet — point the camera at a QR.</Text>
          ) : (
            history.map((h, i) => <HistoryRow key={`${h.at}:${i}`} entry={h} />)
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const time = new Date(entry.at).toLocaleTimeString();
  if (entry.outcome.kind === 'success') {
    const scan = entry.outcome.scan;
    return (
      <View style={[styles.row, styles.rowOk]}>
        <Text style={styles.rowTime}>{time}</Text>
        <Text style={styles.rowName} numberOfLines={1}>
          {scan.student_full_name}
        </Text>
        <Text style={styles.rowKind}>{directionLabel(scan.scan_kind)}</Text>
      </View>
    );
  }
  if (entry.outcome.kind === 'offline') {
    return (
      <View style={[styles.row, styles.rowQueue]}>
        <Text style={styles.rowTime}>{time}</Text>
        <Text style={styles.rowName} numberOfLines={1}>
          Queued for sync
        </Text>
        <Text style={styles.rowKind}>offline</Text>
      </View>
    );
  }
  return (
    <View style={[styles.row, styles.rowErr]}>
      <Text style={styles.rowTime}>{time}</Text>
      <Text style={styles.rowName} numberOfLines={2}>
        {entry.outcome.message}
      </Text>
      <Text style={styles.rowKind}>{entry.outcome.code}</Text>
    </View>
  );
}

function directionLabel(kind: ShivirScanKind): string {
  switch (kind) {
    case 'check_in':
      return 'Checked in';
    case 'check_out':
      return 'Checked out';
    case 'present':
      return 'Marked present';
    default:
      return kind;
  }
}

// Spacing aliases — JPSpacing keys are sp0..sp11, but reading sp4 vs sp6 vs
// sp8 in a layout file is unclear; this local map maps to the conventional
// xs/s/m/l/xl scale used elsewhere in the screen.
const SP = {
  xs: JPSpacing.sp2, // 8
  s: JPSpacing.sp3, // 12
  m: JPSpacing.sp4, // 16
  l: JPSpacing.sp6, // 24
} as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JPColors.cream },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SP.l,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.m,
    paddingVertical: SP.s,
  },
  back: { color: JPColors.saffron, fontSize: 16 },
  title: { color: JPColors.textPrimary, fontSize: 16, fontWeight: '600' },
  action: { color: JPColors.saffron, fontSize: 14 },
  cameraBox: {
    marginHorizontal: SP.m,
    height: 360,
    borderRadius: JPRadius.lg,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  camera: { flex: 1 },
  manualBox: {
    backgroundColor: JPColors.creamDark,
    padding: SP.m,
    justifyContent: 'center',
  },
  cameraGuide: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reticle: {
    width: 220,
    height: 220,
    borderWidth: 3,
    borderColor: JPColors.saffron,
    borderRadius: JPRadius.lg,
  },
  cameraPrompt: {
    color: '#FFFFFF',
    marginTop: SP.m,
    fontSize: 14,
  },
  flashOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SP.m,
  },
  flashOk: { backgroundColor: 'rgba(22, 101, 52, 0.78)' },
  flashErr: { backgroundColor: 'rgba(122, 24, 24, 0.78)' },
  flashText: { color: '#FFFFFF', fontSize: 18, fontWeight: '600', textAlign: 'center' },
  input: {
    borderWidth: 1,
    borderColor: JPColors.textSub,
    borderRadius: JPRadius.md,
    paddingHorizontal: SP.m,
    paddingVertical: SP.s,
    fontSize: 16,
    color: JPColors.textPrimary,
    backgroundColor: '#FFFFFF',
  },
  sheet: {
    flex: 1,
    marginTop: SP.m,
    paddingHorizontal: SP.m,
  },
  sheetTitle: {
    color: JPColors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: SP.xs,
  },
  body: { color: JPColors.textSub, fontSize: 14, lineHeight: 22 },
  headline: { color: JPColors.maroon, fontSize: 20, fontWeight: '600', textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SP.xs,
    paddingHorizontal: SP.s,
    borderRadius: JPRadius.md,
    marginBottom: SP.xs,
    gap: SP.s,
  },
  rowOk: { backgroundColor: '#DCEEDD' },
  rowErr: { backgroundColor: '#F8E0E0' },
  rowQueue: { backgroundColor: '#FBEED0' },
  rowTime: { color: JPColors.textSub, fontSize: 12, width: 70 },
  rowName: { flex: 1, color: JPColors.textPrimary, fontSize: 14 },
  rowKind: { color: JPColors.textSub, fontSize: 12, fontWeight: '600' },
});
