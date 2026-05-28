/**
 * Parent → Add a new child (Step 10 form + Step 11 photo upload).
 *
 * Path: /(parent)/students/new
 *
 * This screen wires `uploadFile()` from `@/api/media` to the new
 * presigned-URL pipeline. The flow:
 *   1. Pick an image (expo-image-picker is optional; until installed we
 *      surface a "skip photo for now" path and let the parent come back).
 *   2. `uploadFile()` signs, PUTs, finalises, and polls until ready.
 *   3. We carry the returned `asset_id` into `enrolmentsApi.submit()` as
 *      `form_data.profile_photo_asset_id` so it lands on the
 *      enrolment / future student row.
 *
 * The screen is intentionally minimal — production-grade form layout lives
 * in the existing `(tabs)/parent/children.tsx` + enrolment flow. The Step
 * 11 deliverable is just the upload wiring.
 */

import { Stack, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { enrolmentsApi } from '@/api/endpoints/students';
import { uploadFile, type UploadableAsset, type UploadProgressEvent } from '@/api/media';
import { Header, PrimaryButton } from '@/components/ui';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

interface FormState {
  full_name: string;
  father_name: string;
  dob: string; // YYYY-MM-DD
  age_group: 'bal' | 'kishor' | 'tarun' | 'yuva';
  requested_centre_id: string;
  requested_batch_id: string;
  photo_asset_id: string | null;
  photo_preview_uri: string | null;
}

const EMPTY: FormState = {
  full_name: '',
  father_name: '',
  dob: '',
  age_group: 'bal',
  requested_centre_id: '',
  requested_batch_id: '',
  photo_asset_id: null,
  photo_preview_uri: null,
};

export default function NewStudentScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [progress, setProgress] = useState<UploadProgressEvent | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Trigger an image pick. Uses expo-image-picker if available; otherwise
   * surfaces a helpful message so the developer can install it. The picker
   * is wrapped in a dynamic import to keep the dependency optional in dev.
   */
  async function pickAndUpload(): Promise<void> {
    setProgress(null);
    let asset: UploadableAsset | null = null;
    try {
      const picker = await loadImagePicker();
      if (!picker) {
        Alert.alert(
          'Photo picker unavailable',
          'Install `expo-image-picker` to enable photo uploads on this device.',
        );
        return;
      }
      const permission = await picker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission required', 'Please grant photo library access.');
        return;
      }
      const result = await picker.launchImageLibraryAsync({
        mediaTypes: picker.MediaTypeOptions?.Images ?? 'Images',
        quality: 0.85, // light compression — server still strips EXIF + re-encodes
        allowsEditing: true,
        aspect: [4, 5],
      });
      if (result.canceled || !result.assets?.[0]) return;
      const picked = result.assets[0];
      asset = {
        uri: picked.uri,
        mimeType: picked.mimeType ?? picked.type ?? 'image/jpeg',
        fileSize: picked.fileSize ?? 0,
        fileName: picked.fileName ?? null,
      };
    } catch (err) {
      Alert.alert('Photo picker error', err instanceof Error ? err.message : String(err));
      return;
    }
    if (!asset) return;

    setBusy(true);
    try {
      const uploaded = await uploadFile(asset, 'student_photo', {
        onProgress: (evt) => setProgress(evt),
      });
      setForm((prev) => ({
        ...prev,
        photo_asset_id: uploaded.asset_id,
        photo_preview_uri: asset?.uri ?? prev.photo_preview_uri,
      }));
      setProgress({ progress: 1, stage: 'ready' });
    } catch (err) {
      setProgress(null);
      Alert.alert(
        'Upload failed',
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err),
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(): Promise<void> {
    if (!form.full_name || !form.dob || !form.requested_centre_id || !form.requested_batch_id) {
      Alert.alert('Missing details', 'Name, DOB, centre, and batch are required.');
      return;
    }
    setBusy(true);
    try {
      await enrolmentsApi.submit({
        full_name: form.full_name,
        dob: form.dob,
        age_group: form.age_group,
        father_name: form.father_name || undefined,
        requested_centre_id: form.requested_centre_id,
        requested_batch_id: form.requested_batch_id,
        form_data: form.photo_asset_id ? { profile_photo_asset_id: form.photo_asset_id } : {},
      });
      Alert.alert('Submitted', 'Enrolment request sent to the centre.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err) {
      Alert.alert('Submit failed', err instanceof ApiError ? err.message : 'Try again');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <Header title="Add a child" subtitle="Submit a new pathshala enrolment" />
      <ScrollView contentContainerStyle={styles.body}>
        {/* Photo section -- the Step 11 deliverable */}
        <View style={styles.photoBlock}>
          <View style={styles.avatarFrame}>
            {form.photo_preview_uri ? (
              <Image
                source={{ uri: form.photo_preview_uri }}
                style={styles.avatarImg}
                resizeMode="cover"
              />
            ) : (
              <Text style={styles.avatarPlaceholder}>Photo</Text>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Pressable
              onPress={() => void pickAndUpload()}
              disabled={busy}
              style={[styles.pickBtn, busy && styles.pickBtnDisabled]}
            >
              <Text style={styles.pickBtnText}>
                {form.photo_asset_id ? 'Change photo' : 'Add photo'}
              </Text>
            </Pressable>
            {progress ? (
              <Text style={styles.progressText}>
                {labelForStage(progress.stage)}
                {progress.stage === 'uploading' ? ` ${Math.round(progress.progress * 100)}%` : ''}
              </Text>
            ) : (
              <Text style={styles.hint}>
                Clear face, no filters. Max 5MB. We strip GPS automatically.
              </Text>
            )}
          </View>
        </View>

        <Text style={styles.note}>
          Tap "Add photo" to test the Step 11 upload pipeline. The picker shells out to
          expo-image-picker; the rest of the enrolment form is captured in the parent children flow.
        </Text>

        <View style={styles.cta}>
          <PrimaryButton onPress={() => void submit()}>Submit enrolment</PrimaryButton>
        </View>
      </ScrollView>
    </View>
  );
}

function labelForStage(stage: UploadProgressEvent['stage']): string {
  switch (stage) {
    case 'signing':
      return 'Preparing upload…';
    case 'uploading':
      return 'Uploading photo';
    case 'finalising':
      return 'Finalising…';
    case 'processing':
      return 'Server is processing…';
    case 'ready':
      return 'Photo ready';
    default:
      return '';
  }
}

/**
 * Optional `expo-image-picker` loader. Returns null when the package isn't
 * installed so the dev environment without it doesn't crash on import.
 *
 * Picker module shape we use:
 *   - requestMediaLibraryPermissionsAsync()
 *   - launchImageLibraryAsync({ mediaTypes, quality, allowsEditing, aspect })
 *   - MediaTypeOptions.Images
 *
 * Cast to a structural type so the helper compiles even without the dep.
 */
interface ExpoImagePickerLike {
  MediaTypeOptions?: { Images: unknown };
  requestMediaLibraryPermissionsAsync(): Promise<{ granted: boolean }>;
  launchImageLibraryAsync(opts: {
    mediaTypes: unknown;
    quality?: number;
    allowsEditing?: boolean;
    aspect?: [number, number];
  }): Promise<{
    canceled: boolean;
    assets?: Array<{
      uri: string;
      mimeType?: string;
      type?: string;
      fileSize?: number;
      fileName?: string | null;
    }>;
  }>;
}

async function loadImagePicker(): Promise<ExpoImagePickerLike | null> {
  try {
    // Dynamic import keeps expo-image-picker an optional install — Step 11
    // doesn't force a Metro rebuild on every parent app that's already
    // shipped without it.
    // @ts-expect-error optional dependency, resolved at runtime
    const mod = (await import('expo-image-picker').catch(() => null)) as ExpoImagePickerLike | null;
    return mod ?? null;
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JPColors.cream },
  body: { padding: JPSpacing.sp4, gap: JPSpacing.sp4 },
  photoBlock: {
    flexDirection: 'row',
    gap: JPSpacing.sp4,
    backgroundColor: '#FFFFFF',
    borderColor: JPColors.border,
    borderWidth: 1,
    borderRadius: JPRadius.md,
    padding: JPSpacing.sp4,
    alignItems: 'center',
  },
  avatarFrame: {
    width: 96,
    height: 120,
    borderRadius: JPRadius.md,
    backgroundColor: JPColors.creamDark,
    borderColor: JPColors.border,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarPlaceholder: {
    fontFamily: JPFonts.body,
    color: JPColors.textSub,
    fontSize: 12,
  },
  pickBtn: {
    backgroundColor: JPColors.saffron,
    paddingVertical: JPSpacing.sp3,
    paddingHorizontal: JPSpacing.sp4,
    borderRadius: JPRadius.pill,
    alignItems: 'center',
  },
  pickBtnDisabled: { opacity: 0.5 },
  pickBtnText: {
    fontFamily: JPFonts.body,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  hint: {
    fontFamily: JPFonts.body,
    color: JPColors.textSub,
    fontSize: 12,
    marginTop: JPSpacing.sp2,
  },
  progressText: {
    fontFamily: JPFonts.body,
    color: JPColors.saffron,
    fontSize: 13,
    marginTop: JPSpacing.sp2,
    fontWeight: '600',
  },
  note: {
    fontFamily: JPFonts.body,
    color: JPColors.textSub,
    fontSize: 12,
  },
  cta: { marginTop: JPSpacing.sp4 },
});
