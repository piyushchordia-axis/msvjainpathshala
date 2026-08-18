import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { formatDate } from "@/lib/format";
import type { NiyamSubmissionRow } from "@/lib/types";
import { niyamAccent } from "@/components/NiyamListRow";
import {
  firstProofPreview,
  ImageViewerModal,
  openProofExternally,
  ProofThumb,
} from "@/components/NiyamProof";
import { submissionBadge } from "@/lib/niyam-submission-badges";
import { useColors } from "@/hooks/useColors";
import { Body, Button, Row } from "@/components/ui";

const PREVIEW_LIMIT = 2;

function statusTone(status: string): "success" | "warning" | "error" | "neutral" | "primary" {
  const s = status.toLowerCase();
  if (s === "approved" || s === "accepted" || s === "auto_approved") return "success";
  if (s === "pending") return "warning";
  if (s === "rejected") return "error";
  if (s === "featured") return "primary";
  return "neutral";
}

function statusLabel(status: string, hi: boolean): string {
  const s = status.toLowerCase();
  if (s === "approved" || s === "accepted" || s === "auto_approved") {
    return hi ? "स्वीकृत" : "Approved";
  }
  if (s === "pending") return hi ? "लंबित" : "Pending";
  if (s === "rejected") return hi ? "अस्वीकृत" : "Rejected";
  return status;
}

function statusColors(
  tone: ReturnType<typeof statusTone>,
  c: ReturnType<typeof useColors>,
) {
  if (tone === "success") return { bg: c.successSoft, fg: c.successText };
  if (tone === "warning") return { bg: c.warningSoft, fg: c.warningText };
  if (tone === "error") return { bg: c.errorSoft, fg: c.errorText };
  if (tone === "primary") return { bg: c.saffron, fg: c.primaryForeground };
  return { bg: c.muted, fg: c.foreground };
}

type Props = {
  items: NiyamSubmissionRow[];
  hi: boolean;
  /** When true, only the latest two rows + a View all control. */
  preview?: boolean;
};

export function NiyamSubmissionsList({ items, hi, preview = false }: Props) {
  const router = useRouter();
  const c = useColors();
  const rows = preview ? items.slice(0, PREVIEW_LIMIT) : items;
  const showViewAll = preview && items.length > PREVIEW_LIMIT;
  const [viewerUri, setViewerUri] = useState<string | null>(null);

  return (
    <View style={{ gap: 8 }}>
      {rows.map((n) => {
        const title = hi ? n.niyam_title_hi ?? n.niyam_title_en : n.niyam_title_en;
        const featured = n.is_featured ? (hi ? "विशेष" : "Featured") : null;
        const meta = [n.niyam_type, formatDate(n.submission_date), featured]
          .filter(Boolean)
          .join(" · ");
        const previewProof = firstProofPreview(n);
        const rejected = n.status.toLowerCase() === "rejected";
        const reason = n.rejection_reason?.trim() || null;
        const accent = niyamAccent(n.niyam_type, c);
        const statusPal = statusColors(statusTone(n.status), c);
        const badge = submissionBadge(n);

        return (
          <View
            key={n.id}
            style={{
              // Neutral card, not accent.bg: tinting each card by niyam type
              // turned a month of history into a stack of red, amber and
              // saffron blocks. The stripe below still carries the type.
              backgroundColor: c.card,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: c.border,
              borderRadius: c.radius,
              overflow: "hidden",
              flexDirection: "row",
            }}
          >
            <View style={{ width: 5, alignSelf: "stretch", backgroundColor: accent.stripe }} />
            <View style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 12, gap: 6 }}>
              <Row style={{ alignItems: "center", gap: 10 }}>
                <ProofThumb
                  uri={previewProof.uri}
                  kind={previewProof.kind}
                  onPress={() => {
                    if (!previewProof.uri) return;
                    if (previewProof.kind === "photo") setViewerUri(previewProof.uri);
                    else void openProofExternally(previewProof.uri);
                  }}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Row style={{ alignItems: "center", gap: 8 }}>
                    <Body
                      style={{ flex: 1, fontSize: 15, fontWeight: "700", color: c.foreground }}
                      numberOfLines={2}
                    >
                      {title}
                    </Body>
                    {badge.kind === "points" ? (
                      <View
                        style={{
                          backgroundColor: accent.badge,
                          borderRadius: 999,
                          paddingHorizontal: 8,
                          paddingVertical: 3,
                        }}
                      >
                        <Body style={{ fontSize: 12, fontWeight: "700", color: accent.badgeFg }}>
                          +{badge.points}
                        </Body>
                      </View>
                    ) : (
                      <View
                        style={{
                          backgroundColor: statusPal.bg,
                          borderRadius: 999,
                          paddingHorizontal: 8,
                          paddingVertical: 3,
                        }}
                      >
                        <Body style={{ fontSize: 11, fontWeight: "700", color: statusPal.fg }}>
                          {statusLabel(badge.status, hi)}
                        </Body>
                      </View>
                    )}
                  </Row>
                  {meta ? (
                    <Body
                      style={{ marginTop: 3, fontSize: 11, color: c.mutedForeground }}
                      numberOfLines={1}
                    >
                      {meta}
                    </Body>
                  ) : null}
                </View>
              </Row>
              {rejected && reason ? (
                <Body style={{ fontSize: 13, lineHeight: 22 }}>{reason}</Body>
              ) : null}
              {/* The child's own notes are off the row: they are the one part
                  nobody is scanning for, and two extra lines per card is most
                  of why a month of history read as noise. A rejection reason
                  stays above — that is the line telling a family what to do. */}
            </View>
          </View>
        );
      })}
      {showViewAll ? (
        <Button
          label={hi ? "सभी देखें" : "View all"}
          variant="outline"
          onPress={() => router.push("/niyam-submissions")}
        />
      ) : null}
      <ImageViewerModal
        uri={viewerUri}
        open={!!viewerUri}
        onClose={() => setViewerUri(null)}
      />
    </View>
  );
}
