/**
 * PDF generation via pdf-lib (pure-JS, bundler-safe). Provides a small
 * auto-paginating builder used by Donation receipts, Student Progress
 * Report exports, and bilingual centre monthly reports.
 *
 * Helvetica encodes WinAnsi only — Devanagari is stripped via `sanitize`
 * unless `createBilingual()` embeds Noto Sans Devanagari via @pdf-lib/fontkit.
 *
 * The Devanagari TTF is inlined by the api-server esbuild ttf-binary plugin so
 * the built dist/*.mjs has no filesystem dependency on assets/.
 */
import "regenerator-runtime/runtime.js";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import devanagariFont from "../../assets/fonts/NotoSansDevanagari-Regular.ttf";

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 50;
const INK = rgb(0.1, 0.04, 0);
const MUTED = rgb(0.55, 0.44, 0.37);
/** Design-token RGB equivalents (pdf-lib cannot use CSS variables). */
const SAFFRON = rgb(0.831, 0.384, 0.102); // saffron #D4621A
const MAROON = rgb(0.478, 0.094, 0.094); // maroon #7A1818
const CREAM = rgb(0.992, 0.973, 0.949); // cream #FDF8F2
const CREAM_DARK = rgb(0.961, 0.929, 0.878); // cream-dark #F5EDE0
const WHITE = rgb(1, 1, 1);

/** Replace characters outside WinAnsi (e.g. Devanagari) so Helvetica won't throw. */
export function sanitize(text: string): string {
  // eslint-disable-next-line no-control-regex
  return (text ?? "").replace(/[^\u0000-\u00ff]/g, "").replace(/\s+/g, " ").trim();
}

function hasDevanagari(text: string): boolean {
  return /[\u0900-\u097F]/.test(text);
}

/**
 * Fail at boot (or before embed) if the inlined font is missing/empty —
 * better than a Sanchalak seeing a raw ENOENT on the first report of the month.
 */
export function assertDevanagariFontAvailable(): void {
  if (!devanagariFont || devanagariFont.byteLength < 1_000) {
    throw new Error(
      "Devanagari font is missing from the API bundle — bilingual centre monthly reports cannot run. Rebuild the API so NotoSansDevanagari-Regular.ttf is inlined (esbuild ttf-binary plugin), then redeploy.",
    );
  }
}

export class PdfBuilder {
  private doc!: PDFDocument;
  private page!: PDFPage;
  private font!: PDFFont;
  private bold!: PDFFont;
  private hiFont: PDFFont | null = null;
  private y = 0;

  static async create(): Promise<PdfBuilder> {
    const b = new PdfBuilder();
    b.doc = await PDFDocument.create();
    b.font = await b.doc.embedFont(StandardFonts.Helvetica);
    b.bold = await b.doc.embedFont(StandardFonts.HelveticaBold);
    b.newPage();
    return b;
  }

  /** Helvetica + embedded Noto Sans Devanagari for bilingual centre reports. */
  static async createBilingual(): Promise<PdfBuilder> {
    assertDevanagariFontAvailable();
    try {
      const b = await PdfBuilder.create();
      b.doc.registerFontkit(fontkit);
      b.hiFont = await b.doc.embedFont(devanagariFont, { subset: true });
      return b;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Could not embed the Devanagari font required for bilingual reports (${detail}). Rebuild the API so NotoSansDevanagari-Regular.ttf is inlined, then try again.`,
      );
    }
  }

  private fontFor(text: string, preferBold = false): PDFFont {
    if (this.hiFont && hasDevanagari(text)) return this.hiFont;
    return preferBold ? this.bold : this.font;
  }

  private prepare(text: string): string {
    if (this.hiFont && hasDevanagari(text)) return (text ?? "").replace(/\s+/g, " ").trim();
    return sanitize(text);
  }

  private newPage(): void {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - MARGIN;
  }

  private ensure(space: number): void {
    if (this.y - space < MARGIN) this.newPage();
  }

  title(text: string): this {
    this.ensure(30);
    const t = this.prepare(text);
    const font = this.fontFor(t, true);
    this.page.drawText(t, { x: MARGIN, y: this.y, size: 18, font, color: INK });
    this.y -= 26;
    return this;
  }

  heading(text: string): this {
    this.ensure(22);
    this.y -= 6;
    const t = this.prepare(text);
    const font = this.fontFor(t, true);
    this.page.drawText(t, { x: MARGIN, y: this.y, size: 12, font, color: MAROON });
    this.y -= 18;
    return this;
  }

  /** Saffron band at the top of the current page — call first. */
  headerBand(titleEn: string, titleHi: string): this {
    const h = 76;
    const top = A4[1];
    this.page.drawRectangle({ x: 0, y: top - h, width: A4[0], height: h, color: SAFFRON });
    this.page.drawRectangle({ x: 0, y: top - h - 4, width: A4[0], height: 4, color: MAROON });
    const en = this.prepare(titleEn);
    const hi = this.prepare(titleHi);
    this.page.drawText(en, {
      x: MARGIN,
      y: top - 30,
      size: 16,
      font: this.fontFor(en, true),
      color: WHITE,
    });
    if (hi) {
      this.page.drawText(hi, {
        x: MARGIN,
        y: top - 50,
        size: 12,
        font: this.fontFor(hi),
        color: CREAM,
      });
    }
    this.y = top - h - 22;
    return this;
  }

  /** Cream callout box — EN then HI on separate lines. */
  callout(en: string, hi?: string, size = 10): this {
    const maxWidth = A4[0] - MARGIN * 2 - 16;
    const enP = this.prepare(en);
    const hiP = hi ? this.prepare(hi) : "";
    const enFont = this.fontFor(enP);
    const hiFont = hiP ? this.fontFor(hiP) : this.font;
    const enLines = this.wrap(enP, enFont, size, maxWidth);
    const hiLines = hiP ? this.wrap(hiP, hiFont, size, maxWidth) : [];
    const lineH = size + 4;
    const pad = 10;
    const boxH = pad * 2 + (enLines.length + hiLines.length) * lineH;
    this.ensure(boxH + 8);
    const boxBottom = this.y - boxH + size;
    this.page.drawRectangle({
      x: MARGIN,
      y: boxBottom,
      width: A4[0] - MARGIN * 2,
      height: boxH,
      color: CREAM_DARK,
    });
    let ty = this.y - pad;
    for (const line of enLines) {
      this.page.drawText(line, { x: MARGIN + 8, y: ty, size, font: enFont, color: INK });
      ty -= lineH;
    }
    for (const line of hiLines) {
      this.page.drawText(line, { x: MARGIN + 8, y: ty, size, font: hiFont, color: INK });
      ty -= lineH;
    }
    this.y -= boxH + 10;
    return this;
  }

  /** Two-column metric table: EN label, HI label, value. No mixed-script keys. */
  metricRows(
    rows: Array<{ en: string; hi?: string; value: string }>,
    size = 10,
  ): this {
    const innerW = A4[0] - MARGIN * 2;
    const valueW = 150;
    const labelW = innerW - valueW - 8;
    const lineH = size + 3;
    for (const row of rows) {
      const en = this.prepare(row.en);
      const hi = row.hi ? this.prepare(row.hi) : "";
      const val = this.prepare(row.value);
      const enFont = this.fontFor(en);
      const hiFont = hi ? this.fontFor(hi) : this.font;
      const valFont = this.fontFor(val, true);
      const enLines = this.wrap(en, enFont, size, labelW);
      const hiLines = hi ? this.wrap(hi, hiFont, size, labelW) : [];
      const blockH = Math.max(enLines.length + hiLines.length, 1) * lineH + 6;
      this.ensure(blockH);
      this.page.drawRectangle({
        x: MARGIN,
        y: this.y - blockH + size,
        width: innerW,
        height: blockH,
        color: CREAM,
      });
      let ty = this.y - 4;
      for (const line of enLines) {
        this.page.drawText(line, { x: MARGIN + 6, y: ty, size, font: enFont, color: INK });
        ty -= lineH;
      }
      for (const line of hiLines) {
        this.page.drawText(line, { x: MARGIN + 6, y: ty, size: size - 1, font: hiFont, color: MUTED });
        ty -= lineH;
      }
      const valY = this.y - 4;
      const vw = valFont.widthOfTextAtSize(val, size);
      this.page.drawText(val, {
        x: MARGIN + innerW - 8 - vw,
        y: valY,
        size,
        font: valFont,
        color: INK,
      });
      this.y -= blockH + 2;
    }
    return this;
  }

  /** Simple grid table. Headers and cells are single-script (no mixed EN/HI in one cell). */
  dataTable(headers: string[], rows: string[][], colWeights: number[], size = 9): this {
    const innerW = A4[0] - MARGIN * 2;
    const totalW = colWeights.reduce((s, w) => s + w, 0) || 1;
    const widths = colWeights.map((w) => (w / totalW) * innerW);
    const pad = 5;
    const lineH = size + 4;

    const drawRow = (cells: string[], header: boolean) => {
      const prepared = cells.map((c, i) => {
        const t = this.prepare(c);
        const font = this.fontFor(t, header);
        const max = Math.max(12, widths[i]! - pad * 2);
        const lines = this.wrap(t, font, size, max);
        return { lines, font };
      });
      const nLines = Math.max(1, ...prepared.map((p) => p.lines.length));
      const rowH = nLines * lineH + pad;
      this.ensure(rowH);
      this.page.drawRectangle({
        x: MARGIN,
        y: this.y - rowH + size,
        width: innerW,
        height: rowH,
        color: header ? SAFFRON : CREAM,
      });
      let x = MARGIN;
      const color = header ? WHITE : INK;
      for (let i = 0; i < prepared.length; i++) {
        const cell = prepared[i]!;
        let ty = this.y - 2;
        for (const line of cell.lines) {
          this.page.drawText(line, { x: x + pad, y: ty, size, font: cell.font, color });
          ty -= lineH;
        }
        x += widths[i]!;
      }
      this.y -= rowH;
    };

    drawRow(headers, true);
    for (const r of rows) drawRow(r, false);
    this.y -= 8;
    return this;
  }

  text(text: string, size = 11): this {
    const maxWidth = A4[0] - MARGIN * 2;
    const t = this.prepare(text);
    const font = this.fontFor(t);
    for (const line of this.wrap(t, font, size, maxWidth)) {
      this.ensure(size + 4);
      this.page.drawText(line, { x: MARGIN, y: this.y, size, font, color: INK });
      this.y -= size + 4;
    }
    return this;
  }

  /** EN line then HI line (or a single line when HI omitted). */
  bilingual(en: string, hi?: string, size = 11): this {
    this.text(en, size);
    if (hi && hi.trim()) this.text(hi, size);
    return this;
  }

  keyValue(key: string, value: string, size = 11): this {
    this.ensure(size + 6);
    const k = this.prepare(key);
    const v = this.prepare(value);
    this.page.drawText(k, { x: MARGIN, y: this.y, size, font: this.fontFor(k, true), color: MUTED });
    this.page.drawText(v, { x: MARGIN + 160, y: this.y, size, font: this.fontFor(v), color: INK });
    this.y -= size + 6;
    return this;
  }

  spacer(h = 10): this {
    this.y -= h;
    return this;
  }

  hr(): this {
    this.ensure(12);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: A4[0] - MARGIN, y: this.y },
      thickness: 0.5,
      color: MUTED,
    });
    this.y -= 12;
    return this;
  }

  private wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    const words = text.split(" ");
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [""];
  }

  async toBuffer(): Promise<Buffer> {
    const bytes = await this.doc.save();
    return Buffer.from(bytes);
  }
}

// ---------------------------------------------------------------------------
// 80G donation receipt builder
// ---------------------------------------------------------------------------
/**
 * Inputs for an 80G tax-exemption receipt. Amounts are in paise; the builder
 * formats rupees for display. donor_email/phone/purpose/campaign are optional
 * and printed only when present.
 */
export interface DonationReceiptInput {
  receipt_number: string;
  financial_year: string;
  /** ISO date string of capture (printed as a plain date). */
  captured_at: string;
  donor_name: string;
  donor_email?: string | null;
  donor_phone?: string | null;
  amount_paise: number;
  purpose?: string | null;
  campaign_name?: string | null;
  razorpay_payment_id?: string | null;
}

/** Format paise as an Indian-rupee amount string, e.g. 25000 -> "INR 250.00". */
function formatRupees(paise: number): string {
  const rupees = paise / 100;
  return `INR ${rupees.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Render a single-page 80G donation receipt PDF. English-first (Helvetica /
 * WinAnsi) like the rest of pdf.ts; the receipt_number is the gapless per-FY
 * registered series (JP/<fy>/<no>). Returns the PDF bytes.
 */
export async function buildDonationReceiptPdf(input: DonationReceiptInput): Promise<Buffer> {
  const pdf = await PdfBuilder.create();
  const date = new Date(input.captured_at);
  const dateStr = Number.isNaN(date.getTime())
    ? input.captured_at
    : date.toISOString().slice(0, 10);

  pdf
    .title("Jain Pathshala")
    .text("80G Donation Receipt")
    .spacer(4)
    .hr()
    .keyValue("Receipt No.", input.receipt_number)
    .keyValue("Financial Year", input.financial_year)
    .keyValue("Date", dateStr)
    .hr()
    .heading("Donor")
    .keyValue("Name", input.donor_name);
  if (input.donor_email) pdf.keyValue("Email", input.donor_email);
  if (input.donor_phone) pdf.keyValue("Phone", input.donor_phone);

  pdf.hr().heading("Donation");
  pdf.keyValue("Amount", formatRupees(input.amount_paise));
  if (input.purpose) pdf.keyValue("Purpose", input.purpose);
  if (input.campaign_name) pdf.keyValue("Campaign", input.campaign_name);
  if (input.razorpay_payment_id) pdf.keyValue("Payment Ref", input.razorpay_payment_id);

  pdf
    .hr()
    .text(
      "This receipt is issued for the donation received with thanks. Donations to Jain Pathshala are eligible for deduction under Section 80G of the Income Tax Act, 1961, subject to applicable conditions.",
      10,
    )
    .spacer(8)
    .text("This is a computer-generated receipt and does not require a signature.", 9);

  return pdf.toBuffer();
}
