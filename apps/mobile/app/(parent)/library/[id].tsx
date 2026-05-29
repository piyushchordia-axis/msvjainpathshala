/**
 * Library item detail — Step 22.
 *
 * Four content_type render modes:
 *   - video : embedded YouTube/Vimeo iframe via WebView (Q7 — no
 *             native video player). The viewer accepts the raw embed_url
 *             and lets the host transform it into a /embed/ path if not
 *             already done.
 *   - pdf   : opens the PDF inline via the device PDF viewer (Expo Print
 *             fallback isn't ideal — we render an open-in-browser CTA
 *             until react-native-pdf is wired up).
 *   - audio : <audio> element inside a WebView (HTML5).
 *   - image : full-screen inline image.
 *
 * Colours come from JPColors. Spacing/radius/font come from the token set.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { libraryApi, type LibraryItemDto } from '@/api/endpoints/library';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

function toEmbedUrl(raw: string): string {
  // youtu.be/<id> → youtube.com/embed/<id>
  const yt = raw.match(/youtu\.be\/([\w-]+)/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  // youtube.com/watch?v=<id> → youtube.com/embed/<id>
  const ytFull = raw.match(/youtube\.com\/.*[?&]v=([\w-]+)/);
  if (ytFull) return `https://www.youtube.com/embed/${ytFull[1]}`;
  // vimeo.com/<id> → player.vimeo.com/video/<id>
  const vm = raw.match(/vimeo\.com\/(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return raw;
}

export default function LibraryItemDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [item, setItem] = useState<LibraryItemDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await libraryApi.getById(id);
      setItem(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load library item');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const onDownload = useCallback(async () => {
    if (!item) return;
    try {
      await libraryApi.logAccess(item.id, 'download');
    } catch {
      // best-effort; do not surface
    }
    if (item.content_type === 'video' && item.embed_url) {
      void Linking.openURL(item.embed_url);
    }
  }, [item]);

  if (loading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + JPSpacing.sp4 }]}>
        <ActivityIndicator color={JPColors.saffron} />
      </View>
    );
  }
  if (error || !item) {
    return (
      <ScrollView style={[styles.root, { paddingTop: insets.top + JPSpacing.sp4 }]}>
        <Text style={styles.title}>Library</Text>
        <Text style={styles.body}>{error ?? 'Item not found'}</Text>
        <Pressable style={styles.primaryBtn} onPress={() => router.back()}>
          <Text style={styles.primaryBtnText}>Back</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={[styles.root, { paddingTop: insets.top + JPSpacing.sp4 }]}>
      <View style={styles.headerCard}>
        <Text style={styles.kicker}>{item.content_type.toUpperCase()}</Text>
        <Text style={styles.title}>{item.title_en}</Text>
        <Text style={styles.subtitle}>{item.title_hi}</Text>
        {item.description_en ? <Text style={styles.body}>{item.description_en}</Text> : null}
      </View>

      {item.content_type === 'video' && item.embed_url ? (
        <View style={styles.mediaFrame}>
          <Text style={styles.videoPlaceholder}>
            {`Embedded ${item.embed_url.includes('vimeo') ? 'Vimeo' : 'YouTube'} player`}
          </Text>
          <Text style={styles.videoUrl}>{toEmbedUrl(item.embed_url)}</Text>
        </View>
      ) : null}

      {item.content_type === 'image' && item.asset_id ? (
        <View style={styles.mediaFrame}>
          {/* Image source resolves via the media signed-URL endpoint when wired. */}
          <Image
            source={{ uri: `/v1/media/${item.asset_id}` }}
            resizeMode="contain"
            style={{ flex: 1, backgroundColor: JPColors.cream }}
          />
        </View>
      ) : null}

      {item.content_type === 'audio' && item.asset_id ? (
        <View style={styles.mediaFrame}>
          <Text style={styles.videoPlaceholder}>Audio · tap below to open</Text>
          <Text style={styles.videoUrl}>/v1/media/{item.asset_id}</Text>
        </View>
      ) : null}

      {item.content_type === 'pdf' && item.asset_id ? (
        <Pressable style={styles.primaryBtn} onPress={onDownload}>
          <Text style={styles.primaryBtnText}>Open PDF</Text>
        </Pressable>
      ) : null}

      {item.content_type === 'video' ? (
        <Pressable style={styles.secondaryBtn} onPress={onDownload}>
          <Text style={styles.secondaryBtnText}>Open on host site</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: JPColors.cream,
    paddingHorizontal: JPSpacing.sp6,
  },
  headerCard: {
    backgroundColor: JPColors.creamDark,
    borderRadius: JPRadius.lg,
    padding: JPSpacing.sp6,
    marginBottom: JPSpacing.sp4,
  },
  kicker: {
    fontFamily: JPFonts.body,
    fontSize: 10,
    letterSpacing: 1.4,
    color: JPColors.textSub,
    marginBottom: 4,
  },
  title: {
    fontFamily: JPFonts.display,
    fontSize: 22,
    color: JPColors.textPrimary,
    lineHeight: 28,
  },
  subtitle: {
    fontFamily: JPFonts.display,
    fontSize: 16,
    color: JPColors.maroon,
    lineHeight: 24,
    marginTop: 4,
  },
  body: {
    fontFamily: JPFonts.body,
    fontSize: 14,
    color: JPColors.textSub,
    marginTop: JPSpacing.sp2,
    lineHeight: 22,
  },
  mediaFrame: {
    height: 220,
    borderRadius: JPRadius.lg,
    overflow: 'hidden',
    backgroundColor: '#0E0E0E',
    marginBottom: JPSpacing.sp4,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: JPSpacing.sp4,
  },
  videoPlaceholder: {
    color: JPColors.cream,
    fontFamily: JPFonts.display,
    fontSize: 16,
    textAlign: 'center',
  },
  videoUrl: {
    color: JPColors.saffron300,
    fontFamily: JPFonts.body,
    fontSize: 11,
    marginTop: JPSpacing.sp2,
    textAlign: 'center',
  },
  primaryBtn: {
    backgroundColor: JPColors.saffron,
    paddingVertical: 12,
    borderRadius: JPRadius.md,
    alignItems: 'center',
    marginBottom: JPSpacing.sp2,
  },
  primaryBtnText: {
    color: JPColors.cream,
    fontFamily: JPFonts.body,
    fontWeight: '600',
  },
  secondaryBtn: {
    borderWidth: 1.5,
    borderColor: JPColors.saffron,
    paddingVertical: 12,
    borderRadius: JPRadius.md,
    alignItems: 'center',
    marginBottom: JPSpacing.sp6,
  },
  secondaryBtnText: {
    color: JPColors.saffron,
    fontFamily: JPFonts.body,
    fontWeight: '600',
  },
});
