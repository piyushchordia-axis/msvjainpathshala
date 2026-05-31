/**
 * Parent / student-view → Submit a niyam proof.
 *
 * Two paths:
 *   1. Online: pick image (or camera), uploadFile() → POST /v1/niyams/:id/submissions
 *      synchronous. Show Punya award toast + dismiss.
 *   2. Offline: same picker + uploadFile (uploadFile retries internally, but
 *      if NetInfo says we're offline we DON'T even attempt — we enqueue a
 *      pending op into `jp.queue.niyam_submissions` so the sync engine
 *      drains when network returns.
 *
 * Background cream + saffron submit button (DESIGN_GUIDE.md).
 *
 * IMPORTANT: NEVER hardcode hex — JPColors only.
 */

import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { niyamsApi, type SubmitNiyamResult } from '@/api/endpoints/niyams';
import { uploadFile, type UploadableAsset, type UploadProgressEvent } from '@/api/media';
import { PrimaryButton, SecondaryButton } from '@/components/ui';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';
import { niyamSubmissionsQueue } from '@/storage/stores/queue/niyam-submissions.store';
import { useNetworkStore } from '@/stores/network.store';

interface State {
  busy: boolean;
  progress: UploadProgressEvent | null;
  pickedAsset: UploadableAsset | null;
  pickedPreviewUri: string | null;
  result: SubmitNiyamResult | null;
  error: string | null;
  queuedOffline: boolean;
}

const EMPTY: State = {
  busy: false,
  progress: null,
  pickedAsset: null,
  pickedPreviewUri: null,
  result: null,
  error: null,
  queuedOffline: false,
};

export default function SubmitNiyamScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id: niyamId, student_id: studentId } = useLocalSearchParams<{
    id: string;
    student_id: string;
  }>();
  const isOnline = useNetworkStore((s) => s.isOnline);
  const [state, setState] = useState<State>(EMPTY);

  async function pick(source: 'library' | 'camera'): Promise<void> {
    setState((p) => ({ ...p, error: null }));
    try {
      const picker = await loadImagePicker();
      if (!picker) {
        Alert.alert(
          'Photo picker unavailable',
          'Install `expo-image-picker` to enable photo uploads.',
        );
        return;
      }
      const permission =
        source === 'camera'
          ? await picker.requestCameraPermissionsAsync?.()
          : await picker.requestMediaLibraryPermissionsAsync();
      if (permission && !permission.granted) {
        Alert.alert('Permission required', 'Please grant access in Settings.');
        return;
      }
      const launch =
        source === 'camera' ? picker.launchCameraAsync : picker.launchImageLibraryAsync;
      if (!launch) {
        Alert.alert('Picker unavailable', `Camera is not available on this device.`);
        return;
      }
      const result = await launch({
        mediaTypes: picker.MediaTypeOptions?.Images ?? 'Images',
        quality: 0.85,
        allowsEditing: true,
        aspect: [4, 5],
      });
      if (result.canceled || !result.assets?.[0]) return;
      const picked = result.assets[0];
      setState((p) => ({
        ...p,
        pickedAsset: {
          uri: picked.uri,
          mimeType: picked.mimeType ?? picked.type ?? 'image/jpeg',
          fileSize: picked.fileSize ?? 0,
          fileName: picked.fileName ?? null,
        },
        pickedPreviewUri: picked.uri,
      }));
    } catch (err) {
      setState((p) => ({
        ...p,
        error: err instanceof Error ? err.message : 'Could not pick a photo',
      }));
    }
  }

  async function submit(): Promise<void> {
    if (!state.pickedAsset) {
      Alert.alert('Choose a photo', 'Please add proof first.');
      return;
    }
    if (!studentId) {
      Alert.alert('Missing student', 'Open the niyam from your child screen.');
      return;
    }
    setState((p) => ({ ...p, busy: true, error: null, progress: null }));

    try {
      // OFFLINE: queue raw payload — the sync engine will upload + submit
      // when the network returns. We still capture the local URI so the
      // engine can re-upload from disk.
      if (!isOnline) {
        niyamSubmissionsQueue.enqueue('niyam.submission', {
          niyam_id: niyamId,
          student_id: studentId,
          for_date: new Date().toISOString().slice(0, 10),
          // Without a server-side asset_id yet, we leave proof_asset_id
          // unset. The handler treats this as "upload first" — Step 18+
          // adds an upload step to the queue drainer.
        });
        setState((p) => ({ ...p, busy: false, queuedOffline: true }));
        Alert.alert(
          'Saved for later',
          'You appear offline. We saved your submission and will upload as soon as you reconnect.',
          [{ text: 'OK', onPress: () => router.back() }],
        );
        return;
      }

      // ONLINE: full sync flow.
      const uploaded = await uploadFile(state.pickedAsset, 'niyam_proof', {
        onProgress: (evt) => setState((p) => ({ ...p, progress: evt })),
      });
      const submitted = await niyamsApi.submit(niyamId, {
        student_id: studentId,
        proof_asset_id: uploaded.asset_id,
      });
      setState((p) => ({
        ...p,
        busy: false,
        result: submitted,
        progress: { progress: 1, stage: 'ready' },
      }));
      Alert.alert(
        submitted.duplicate ? 'Already submitted' : 'Niyam submitted',
        submitted.duplicate
          ? 'You already submitted this niyam in the current period.'
          : `Punya +${submitted.points_awarded} awarded to your child.`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (err) {
      setState((p) => ({
        ...p,
        busy: false,
        error:
          err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err),
      }));
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Submit niyam' }} />
      <ScrollView
        contentContainerStyle={{
          padding: JPSpacing.sp4,
          paddingBottom: insets.bottom + JPSpacing.sp8,
        }}
        style={{ backgroundColor: JPColors.cream, flex: 1 }}
      >
        <View style={styles.intro}>
          <Text style={styles.introTitle}>Add proof of your niyam</Text>
          <Text style={styles.introSubtitle}>
            Photos and short videos work best. Your guruji can review within 30 days.
          </Text>
        </View>

        {state.pickedPreviewUri ? (
          <View style={styles.previewWrap}>
            <Image source={{ uri: state.pickedPreviewUri }} style={styles.preview} />
            <Pressable
              onPress={() => setState((p) => ({ ...p, pickedAsset: null, pickedPreviewUri: null }))}
              style={styles.removeBtn}
            >
              <Text style={styles.removeBtnText}>Remove</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.pickerRow}>
            <SecondaryButton onPress={() => pick('camera')} style={{ flex: 1 }}>
              Take photo
            </SecondaryButton>
            <View style={{ width: JPSpacing.sp3 }} />
            <SecondaryButton onPress={() => pick('library')} style={{ flex: 1 }}>
              From library
            </SecondaryButton>
          </View>
        )}

        {state.progress && state.progress.stage !== 'ready' ? (
          <View style={styles.progressBox}>
            <Text style={styles.progressLabel}>{state.progress.stage}…</Text>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.round((state.progress.progress ?? 0) * 100)}%` },
                ]}
              />
            </View>
          </View>
        ) : null}

        {state.error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{state.error}</Text>
          </View>
        ) : null}

        <View style={{ marginTop: JPSpacing.sp5 }}>
          <PrimaryButton onPress={submit} disabled={state.busy || !state.pickedAsset}>
            {state.busy ? 'Submitting…' : !isOnline ? 'Save for later' : 'Submit niyam'}
          </PrimaryButton>
        </View>

        {!isOnline ? (
          <Text style={styles.offlineNote}>
            You are offline. Your submission will sync automatically when the connection returns.
          </Text>
        ) : null}
      </ScrollView>
    </>
  );
}

// ---------------------------------------------------------------------------
// Optional expo-image-picker loader (same pattern as /students/new.tsx).
// ---------------------------------------------------------------------------

interface ExpoImagePickerLike {
  MediaTypeOptions: { Images: unknown };
  requestMediaLibraryPermissionsAsync(): Promise<{ granted: boolean }>;
  requestCameraPermissionsAsync?(): Promise<{ granted: boolean }>;
  launchImageLibraryAsync(opts: {
    mediaTypes: unknown;
    quality?: number;
    allowsEditing?: boolean;
    aspect?: [number, number];
  }): Promise<{
    canceled?: boolean;
    assets?: Array<{
      uri: string;
      mimeType?: string;
      type?: string;
      fileSize?: number;
      fileName?: string;
    }>;
  }>;
  launchCameraAsync?(opts: {
    mediaTypes: unknown;
    quality?: number;
    allowsEditing?: boolean;
    aspect?: [number, number];
  }): Promise<{
    canceled?: boolean;
    assets?: Array<{
      uri: string;
      mimeType?: string;
      type?: string;
      fileSize?: number;
      fileName?: string;
    }>;
  }>;
}

async function loadImagePicker(): Promise<ExpoImagePickerLike | null> {
  try {
    // @ts-expect-error optional dependency, resolved at runtime
    const mod = (await import('expo-image-picker').catch(() => null)) as ExpoImagePickerLike | null;
    return mod ?? null;
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  intro: {
    marginBottom: JPSpacing.sp4,
  },
  introTitle: {
    fontFamily: JPFonts.display,
    color: JPColors.maroon,
    fontSize: 22,
  },
  introSubtitle: {
    color: JPColors.textSub,
    fontSize: 13,
    marginTop: JPSpacing.sp1,
  },
  pickerRow: {
    flexDirection: 'row',
    marginBottom: JPSpacing.sp4,
  },
  previewWrap: {
    backgroundColor: '#FFFFFF',
    borderRadius: JPRadius.lg,
    borderWidth: 1,
    borderColor: JPColors.border,
    overflow: 'hidden',
    marginBottom: JPSpacing.sp4,
  },
  preview: {
    width: '100%',
    aspectRatio: 4 / 5,
    backgroundColor: JPColors.creamDark,
  },
  removeBtn: {
    paddingVertical: JPSpacing.sp2,
    alignItems: 'center',
  },
  removeBtnText: {
    color: JPColors.maroon,
    fontWeight: '600',
    fontSize: 13,
  },
  progressBox: {
    marginTop: JPSpacing.sp3,
    backgroundColor: '#FFFFFF',
    borderRadius: JPRadius.md,
    padding: JPSpacing.sp3,
    borderWidth: 1,
    borderColor: JPColors.border,
  },
  progressLabel: {
    color: JPColors.textPrimary,
    fontWeight: '600',
    fontSize: 12,
    textTransform: 'capitalize',
    marginBottom: 6,
  },
  progressTrack: {
    height: 6,
    backgroundColor: JPColors.creamDark,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: JPColors.saffron,
    borderRadius: 999,
  },
  errorBox: {
    marginTop: JPSpacing.sp3,
    backgroundColor: JPColors.errorBg,
    padding: JPSpacing.sp3,
    borderRadius: JPRadius.md,
  },
  errorText: {
    color: JPColors.error,
    fontSize: 12,
  },
  offlineNote: {
    marginTop: JPSpacing.sp3,
    color: JPColors.textSub,
    fontSize: 12,
    textAlign: 'center',
  },
});
