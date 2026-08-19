/**
 * Shivir attendance roster as a PDF (SPEC 6.14 export).
 *
 * Bilingual builder rather than the plain one: student names are the entire
 * point of this document and roughly half of them are Devanagari, which
 * Helvetica silently strips.
 */
import { PdfBuilder } from "./pdf";
import type { RosterRow } from "../routes/v1/shivir-scanner";

const STATE_LABEL: Record<RosterRow["state"], { en: string; hi: string }> = {
  scanned: { en: "Attended", hi: "उपस्थित" },
  walk_in: { en: "Walk-in", hi: "बिना पंजीकरण" },
  not_arrived: { en: "Not arrived", hi: "नहीं आए" },
  registered: { en: "Registered", hi: "पंजीकृत" },
};

const SCAN_LABEL: Record<string, string> = {
  present: "Present",
  check_in: "Checked in",
  check_out: "Checked out",
};

export async function buildShivirAttendancePdf(input: {
  shivirName: string;
  startDate: string;
  endDate: string;
  roster: RosterRow[];
  scanCount: number;
}): Promise<Buffer> {
  const pdf = await PdfBuilder.createBilingual();

  pdf.headerBand("Shivir attendance", "शिविर उपस्थिति");
  pdf.bilingual(input.shivirName, input.shivirName, 14);
  pdf.bilingual(
    `${input.startDate} – ${input.endDate}`,
    `${input.startDate} – ${input.endDate}`,
    11,
  );
  pdf.spacer(8);

  const attended = input.roster.filter((r) => r.state === "scanned").length;
  const walkIns = input.roster.filter((r) => r.state === "walk_in").length;
  const missing = input.roster.filter((r) => r.state === "not_arrived").length;

  pdf.heading("Summary");
  pdf.bilingual("Summary", "सारांश", 10);
  pdf.spacer(4);
  pdf.keyValue("Registered and attended", String(attended));
  pdf.keyValue("Walk-ins (not registered)", String(walkIns));
  pdf.keyValue("Registered, did not arrive", String(missing));
  pdf.keyValue("Total scans recorded", String(input.scanCount));
  pdf.spacer(10);

  pdf.heading("Roster");
  pdf.bilingual("Roster", "नामावली", 10);
  pdf.spacer(4);

  if (input.roster.length === 0) {
    // An empty roster is a real state (nobody registered, nobody scanned) and
    // must read as that rather than as a broken export.
    pdf.callout(
      "No registrations and no scans were recorded for this shivir.",
      "इस शिविर के लिए कोई पंजीकरण या स्कैन दर्ज नहीं हुआ।",
    );
  } else {
    pdf.dataTable(
      ["Student", "Code", "Status", "Last scan", "Scans"],
      input.roster.map((r) => [
        r.full_name,
        r.student_code ?? "—",
        STATE_LABEL[r.state].en,
        r.last_scan_kind ? (SCAN_LABEL[r.last_scan_kind] ?? r.last_scan_kind) : "—",
        String(r.scan_count),
      ]),
      [34, 14, 18, 20, 8],
    );
  }

  return pdf.toBuffer();
}
