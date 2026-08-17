/**
 * Session check-in / check-out sheet.
 *
 * Transport is POST /v1/sync/batch only — never the online-shaped
 * /v1/sessions/:id/check-in route. AT15: a missing or bad GPS fix never
 * blocks starting or ending a real class.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, View } from "react-native";
import * as Location from "expo-location";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { SyncOpStatus } from "@/components/SyncOpStatus";
import { Body, Button, Card, Row, Title } from "@/components/ui";
import { qk } from "@/lib/queries";
import { QUEUE_KEYS } from "@/lib/offline/queue-keys";
import { sessionKey } from "@/lib/offline/drain";
import { readQueue } from "@/lib/offline/storage";
import {
  drainQueues,
  enqueueCheckIn,
  enqueueCheckOut,
  retryOp,
} from "@/lib/offline/sync-engine";
import { ulid } from "@/lib/offline/ulid";
import type { SyncUiState } from "@/lib/offline/types";

export type SessionCheckInMode = "checkin" | "checkout";

/** accuracy_m is nullable: a real fix whose accuracy the platform did not report. */
type GpsFix = { lat: number; lng: number; accuracy_m: number | null } | null;

type Props = {
  visible: boolean;
  mode: SessionCheckInMode;
  batchId: string;
  sessionDate: string;
  batchName?: string | null;
  onClose: () => void;
  onSettled?: () => void;
};

export function SessionCheckIn({
  visible,
  mode,
  batchId,
  sessionDate,
  batchName,
  onClose,
  onSettled,
}: Props) {
  const c = useColors();
  const { hi } = useLocale();
  const qc = useQueryClient();

  // Mint once per sheet open — reuse across retries of the same attempt (AT16).
  const submissionOpIdRef = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [denyLocation, setDenyLocation] = useState(false);
  const [opState, setOpState] = useState<SyncUiState | null>(null);
  const [opError, setOpError] = useState<{ code: string; message: string } | undefined>();

  useEffect(() => {
    if (!visible) return;
    submissionOpIdRef.current = ulid();
    setBusy(false);
    setDenyLocation(false);
    setOpState(null);
    setOpError(undefined);
  }, [visible, mode, batchId, sessionDate]);

  const refreshQueueState = useCallback(async () => {
    const queue = mode === "checkin" ? QUEUE_KEYS.checkin : QUEUE_KEYS.checkout;
    const ops = await readQueue(queue);
    const key = sessionKey(batchId, sessionDate);
    const op = ops.find((o) => {
      const p = o.payload as { batch_id?: string; session_date?: string };
      return sessionKey(p.batch_id ?? "", p.session_date ?? "") === key;
    });
    if (!op) {
      setOpState(null);
      setOpError(undefined);
      return;
    }
    setOpState(op.state);
    setOpError(op.last_error);
  }, [mode, batchId, sessionDate]);

  async function captureFix(): Promise<GpsFix> {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        setDenyLocation(true);
        return null;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      return {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        // AT32.2 — never invent a fix. `?? 0` claimed pinpoint accuracy, so
        // AT15's "accuracy > 100 ⇒ unverified" path could never trigger and the
        // Sanchalak saw a wrongly-trusted check-in.
        accuracy_m: pos.coords.accuracy ?? null,
      };
    } catch {
      setDenyLocation(true);
      return null;
    }
  }

  async function submit(fix: GpsFix) {
    if (!submissionOpIdRef.current) submissionOpIdRef.current = ulid();
    const submission_op_id = submissionOpIdRef.current;
    setBusy(true);
    setOpState("queued");
    setOpError(undefined);
    try {
      if (mode === "checkin") {
        await enqueueCheckIn({
          submission_op_id,
          batch_id: batchId,
          session_date: sessionDate,
          lat: fix?.lat ?? null,
          lng: fix?.lng ?? null,
          accuracy_m: fix?.accuracy_m ?? null,
        });
      } else {
        await enqueueCheckOut({
          submission_op_id,
          batch_id: batchId,
          session_date: sessionDate,
          lat: fix?.lat ?? null,
          lng: fix?.lng ?? null,
          accuracy_m: fix?.accuracy_m ?? null,
        });
      }
      setOpState("syncing");
      const results = await drainQueues();
      const mine = results.find((r) => r.submission_op_id === submission_op_id);
      if (!mine) {
        // Still queued offline — drain will retry later.
        setOpState("queued");
      } else if (mine.status === "success" || mine.status === "duplicate") {
        setOpState("synced");
        void qc.invalidateQueries({ queryKey: qk.today });
        onSettled?.();
        onClose();
      } else if (mine.status === "conflict") {
        setOpState("conflict");
        setOpError(
          mine.error ?? {
            code: "ERR_ALREADY_CHECKED_IN_BY_OTHER",
            message: hi
              ? "किसी अन्य गुरुजी ने यह सत्र पहले ही शुरू कर दिया है — संचालक से संपर्क करें।"
              : "Another Guruji already started this session — contact the Sanchalak.",
          },
        );
      } else {
        setOpState("failed");
        setOpError(
          mine.error ?? {
            code: "ERR_NETWORK",
            message: hi
              ? "सर्वर तक नहीं पहुँच सके। पुनः प्रयास करें — डेटा हटाया नहीं गया।"
              : "Couldn't reach the server. Retry — nothing was discarded.",
          },
        );
      }
      await refreshQueueState();
    } catch (err) {
      setOpState("failed");
      setOpError({
        code: "ERR_NETWORK",
        message:
          err instanceof Error
            ? err.message
            : hi
              ? "सर्वर तक नहीं पहुँच सके। पुनः प्रयास करें।"
              : "Couldn't reach the server. Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function startWithLocation() {
    setDenyLocation(false);
    const fix = await captureFix();
    if (!fix) return; // denial UI offers start-without-location
    await submit(fix);
  }

  async function startWithoutLocation() {
    await submit(null);
  }

  async function onRetry() {
    const queue = mode === "checkin" ? QUEUE_KEYS.checkin : QUEUE_KEYS.checkout;
    if (submissionOpIdRef.current) {
      await retryOp(queue, submissionOpIdRef.current);
      await refreshQueueState();
      onSettled?.();
    }
  }

  const isCheckIn = mode === "checkin";
  const title = isCheckIn
    ? hi
      ? "कक्षा शुरू करें"
      : "Start class"
    : hi
      ? "कक्षा समाप्त करें"
      : "End class";

  const conflictDetail =
    opError?.code === "ERR_ALREADY_CHECKED_IN_BY_OTHER"
      ? hi
        ? "किसी अन्य गुरुजी ने यह सत्र पहले ही शुरू कर दिया है। संचालक से संपर्क करें।"
        : "Another Guruji already started this session. Contact the Sanchalak."
      : opError?.message;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          justifyContent: "flex-end",
          backgroundColor: "rgba(0,0,0,0.35)",
        }}
      >
        <Card
          style={{
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
            gap: 14,
            paddingBottom: 28,
          }}
        >
          <Title style={{ fontSize: 18 }}>{title}</Title>
          {batchName ? <Body muted>{batchName}</Body> : null}
          <Body muted style={{ fontSize: 13 }}>
            {isCheckIn
              ? hi
                ? "केंद्र पर होने की पुष्टि के लिए स्थान कैप्चर किया जाएगा। अनुमति न देने पर भी कक्षा शुरू हो सकती है — संचालक को यह असत्यापित दिखेगा।"
                : "We'll capture your location to confirm you're at the centre. You can still start without it — the Sanchalak will see it as unverified."
              : hi
                ? "कक्षा समाप्त करते समय स्थान कैप्चर किया जाएगा। अनुमति न देने पर भी कक्षा समाप्त हो सकती है।"
                : "We'll capture your location when ending class. You can still end without it."}
          </Body>

          {denyLocation ? (
            <Card style={{ backgroundColor: c.warningSoft, borderColor: c.border }}>
              <Body style={{ color: c.warningText }}>
                {hi
                  ? "स्थान उपलब्ध नहीं। बिना स्थान के शुरू करें — संचालक को असत्यापित दिखेगा।"
                  : "Location unavailable. Start without location — the Sanchalak will see it as unverified."}
              </Body>
            </Card>
          ) : null}

          {opState && opState !== "synced" && opState !== "duplicate" ? (
            <SyncOpStatus
              state={opState}
              error={opError}
              onRetry={opState === "failed" ? () => void onRetry() : undefined}
              title={
                opState === "queued"
                  ? isCheckIn
                    ? hi
                      ? "कक्षा शुरू — सिंक होगी"
                      : "Class started — will sync"
                    : hi
                      ? "कक्षा समाप्त — सिंक होगी"
                      : "Class ended — will sync"
                  : opState === "conflict"
                    ? hi
                      ? "सत्र पहले से शुरू"
                      : "Session already started"
                    : undefined
              }
              detail={opState === "conflict" ? conflictDetail : undefined}
            />
          ) : null}

          <Row style={{ gap: 10, flexWrap: "wrap" }}>
            <Button
              label={
                isCheckIn
                  ? hi
                    ? "स्थान के साथ शुरू करें"
                    : "Start with location"
                  : hi
                    ? "स्थान के साथ समाप्त करें"
                    : "End with location"
              }
              icon="location"
              loading={busy}
              onPress={() => void startWithLocation()}
              style={{ flex: 1, minWidth: 140 }}
            />
            <Button
              label={
                isCheckIn
                  ? hi
                    ? "बिना स्थान शुरू करें"
                    : "Start without location"
                  : hi
                    ? "बिना स्थान समाप्त करें"
                    : "End without location"
              }
              variant="outline"
              loading={busy}
              onPress={() => void startWithoutLocation()}
              style={{ flex: 1, minWidth: 140 }}
            />
          </Row>
          <Button label={hi ? "रद्द करें" : "Cancel"} variant="ghost" onPress={onClose} disabled={busy} />
        </Card>
      </View>
    </Modal>
  );
}
