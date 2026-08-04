import { View } from "react-native";
import { useRouter } from "expo-router";
import { formatDate } from "@/lib/format";
import type { NiyamSubmissionRow } from "@/lib/types";
import { NiyamListRow } from "@/components/NiyamListRow";
import { Button } from "@/components/ui";

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

type Props = {
  items: NiyamSubmissionRow[];
  hi: boolean;
  /** When true, only the latest two rows + a View all control. */
  preview?: boolean;
};

export function NiyamSubmissionsList({ items, hi, preview = false }: Props) {
  const router = useRouter();
  const rows = preview ? items.slice(0, PREVIEW_LIMIT) : items;
  const showViewAll = preview && items.length > PREVIEW_LIMIT;

  return (
    <View style={{ gap: 8 }}>
      {rows.map((n) => {
        const title = hi ? n.niyam_title_hi : n.niyam_title_en;
        const featured = n.is_featured ? (hi ? "विशेष" : "Featured") : null;
        const meta = [n.niyam_type, formatDate(n.submission_date), featured]
          .filter(Boolean)
          .join(" · ");
        return (
          <NiyamListRow
            key={n.id}
            title={title}
            meta={meta}
            points={n.points_awarded}
            niyamType={n.niyam_type}
            statusLabel={statusLabel(n.status, hi)}
            statusTone={statusTone(n.status)}
            showChevron={false}
          />
        );
      })}
      {showViewAll ? (
        <Button
          label={hi ? "सभी देखें" : "View all"}
          variant="outline"
          onPress={() => router.push("/niyam-submissions")}
        />
      ) : null}
    </View>
  );
}
