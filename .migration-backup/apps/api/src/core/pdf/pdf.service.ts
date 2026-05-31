/**
 * PdfService — server-side PDF rendering via pdfkit.
 *
 * Pure rendering: callers fetch the data, call render*, then upload the
 * returned Buffer via StorageService. No DB or storage access here. Brand
 * colours mirror the design tokens (saffron / maroon / cream / gold / ink).
 */

import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

const JP = {
  saffron: '#D4621A',
  maroon: '#7A1818',
  cream: '#FDF8F2',
  creamDark: '#F5EDE0',
  gold: '#C8941F',
  ink: '#1A0A00',
  inkSub: '#8B6F5E',
  white: '#FFFFFF',
} as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Stable, locale-independent DD Mon YYYY (UTC). */
function fmtDate(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export interface IdCardPdfData {
  orgName: string;
  studentName: string;
  studentCode: string;
  ageGroup: string;
  centreName: string;
  cardNumber: string;
  issuedAt: Date;
  qrPayload: string;
}

export interface ProgressReportStat {
  label: string;
  value: string;
}

export interface ProgressReportPdfData {
  orgName: string;
  studentName: string;
  studentCode: string;
  centreName: string;
  periodKind: string;
  periodLabel: string;
  generatedAt: Date;
  shikshakComment: string | null;
  stats: ProgressReportStat[];
}

export interface DonationReceiptPdfData {
  receiptNumber: string;
  financialYear: string;
  issuedOnDisplay: string;
  donorName: string;
  donorEmail?: string | null;
  donorPhone?: string | null;
  donorPanMasked?: string | null;
  purposeLabel: string;
  campaignName?: string | null;
  razorpayPaymentId: string;
  razorpayOrderId: string;
  capturedOnDisplay: string;
  amountInrDisplay: string;
  currency: string;
  trustName: string;
  eightyGNote: string;
}

export interface EightyGCertPdfData {
  receiptNumber: string;
  financialYear: string;
  issuedOnDisplay: string;
  donorName: string;
  donorPanMasked: string | null;
  purposeLabel: string;
  razorpayPaymentId: string;
  capturedOnDisplay: string;
  amountInrDisplay: string;
  currency: string;
  trustName: string;
  trustAddress: string;
  trustPan: string;
  registrationNumber: string;
  section: string;
}

@Injectable()
export class PdfService {
  /** Collect a pdfkit document into a single Buffer. */
  private toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    });
  }

  /**
   * Student digital ID card — a single 350×220pt landscape card. The
   * scannable QR is rendered by the apps from the stored qr_payload; here we
   * draw a placeholder box + the card number for a print fallback.
   */
  async renderIdCard(data: IdCardPdfData): Promise<Buffer> {
    const W = 350;
    const H = 220;
    const doc = new PDFDocument({ size: [W, H], margin: 0 });

    // Background
    doc.rect(0, 0, W, H).fill(JP.cream);

    // Header band
    doc.rect(0, 0, W, 46).fill(JP.maroon);
    doc
      .fillColor(JP.white)
      .fontSize(13)
      .text(data.orgName, 16, 12, { width: W - 32 });
    doc.fillColor(JP.gold).fontSize(8).text('Student identity card', 16, 30);

    // Saffron accent rule
    doc.rect(0, 46, W, 3).fill(JP.saffron);

    // Body
    const left = 16;
    let y = 62;
    doc
      .fillColor(JP.ink)
      .fontSize(15)
      .text(data.studentName, left, y, { width: W - 120 });
    y += 24;

    const row = (label: string, value: string): void => {
      doc.fillColor(JP.inkSub).fontSize(8).text(label.toUpperCase(), left, y);
      doc
        .fillColor(JP.ink)
        .fontSize(11)
        .text(value, left, y + 9, { width: W - 130 });
      y += 26;
    };
    row('Student code', data.studentCode);
    row('Age group', data.ageGroup);
    row('Centre', data.centreName);

    // QR placeholder block (top-right) — apps render the real QR from payload
    const qrSize = 78;
    const qrX = W - qrSize - 16;
    const qrY = 60;
    doc.rect(qrX, qrY, qrSize, qrSize).fill(JP.white);
    doc.rect(qrX, qrY, qrSize, qrSize).lineWidth(1).stroke(JP.creamDark);
    doc
      .fillColor(JP.inkSub)
      .fontSize(6)
      .text('Scan in app', qrX, qrY + qrSize - 12, { width: qrSize, align: 'center' });

    // Footer: card number + issued date
    doc.rect(0, H - 26, W, 26).fill(JP.creamDark);
    doc
      .fillColor(JP.maroon)
      .fontSize(9)
      .text(`No. ${data.cardNumber}`, left, H - 18);
    doc
      .fillColor(JP.inkSub)
      .fontSize(8)
      .text(`Issued ${fmtDate(data.issuedAt)}`, W - 150, H - 17, { width: 134, align: 'right' });

    return this.toBuffer(doc);
  }

  /**
   * Monthly / termly progress report — an A4 document with a student header,
   * a stats grid, the shikshak's comment and a generated-on footer.
   */
  async renderProgressReport(data: ProgressReportPdfData): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const pageW = doc.page.width;
    const left = 48;
    const contentW = pageW - left * 2;

    // Header band
    doc.rect(0, 0, pageW, 96).fill(JP.maroon);
    doc.fillColor(JP.white).fontSize(20).text(data.orgName, left, 28, { width: contentW });
    doc.fillColor(JP.gold).fontSize(11).text('Progress report', left, 58);
    doc.rect(0, 96, pageW, 4).fill(JP.saffron);

    let y = 128;

    // Student + period block
    doc.fillColor(JP.ink).fontSize(18).text(data.studentName, left, y);
    y += 26;
    doc
      .fillColor(JP.inkSub)
      .fontSize(10)
      .text(`Student code ${data.studentCode}   ·   ${data.centreName}`, left, y, {
        width: contentW,
      });
    y += 16;
    const periodTitle = data.periodKind === 'termly' ? 'Term' : 'Month';
    doc.fillColor(JP.inkSub).fontSize(10).text(`${periodTitle}: ${data.periodLabel}`, left, y);
    y += 28;

    // Stats grid (two columns of cards)
    doc.fillColor(JP.maroon).fontSize(13).text('Summary', left, y);
    y += 22;
    const gap = 12;
    const cardW = (contentW - gap) / 2;
    const cardH = 56;
    data.stats.forEach((stat, i) => {
      const col = i % 2;
      const rowIdx = Math.floor(i / 2);
      const x = left + col * (cardW + gap);
      const cy = y + rowIdx * (cardH + gap);
      doc.roundedRect(x, cy, cardW, cardH, 8).fill(JP.creamDark);
      doc
        .fillColor(JP.inkSub)
        .fontSize(8)
        .text(stat.label.toUpperCase(), x + 12, cy + 10, { width: cardW - 24 });
      doc
        .fillColor(JP.ink)
        .fontSize(16)
        .text(stat.value, x + 12, cy + 24, { width: cardW - 24 });
    });
    const rows = Math.ceil(data.stats.length / 2);
    y += rows * (cardH + gap) + 8;

    // Shikshak comment
    doc.fillColor(JP.maroon).fontSize(13).text("Guruji's comment", left, y);
    y += 20;
    doc.roundedRect(left, y, contentW, 90, 8).fill(JP.cream);
    doc.roundedRect(left, y, contentW, 90, 8).lineWidth(1).stroke(JP.creamDark);
    doc
      .fillColor(data.shikshakComment ? JP.ink : JP.inkSub)
      .fontSize(11)
      .text(data.shikshakComment ?? 'No comment recorded for this period.', left + 14, y + 14, {
        width: contentW - 28,
        height: 62,
      });

    // Footer
    doc
      .fillColor(JP.inkSub)
      .fontSize(8)
      .text(
        `Generated ${fmtDate(data.generatedAt)} · Shared with you as the parent / abhivaavak.`,
        left,
        doc.page.height - 56,
        { width: contentW },
      );

    return this.toBuffer(doc);
  }

  /** Donation receipt — A4 (replaces HTML → Chromium pipeline). */
  async renderDonationReceipt(data: DonationReceiptPdfData): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const pageW = doc.page.width;
    const left = 48;
    const contentW = pageW - left * 2;

    doc
      .roundedRect(left, 48, contentW, doc.page.height - 96, 12)
      .lineWidth(1.5)
      .stroke(JP.creamDark);

    doc.rect(left + 12, 60, contentW - 24, 52).fill(JP.maroon);
    doc
      .fillColor(JP.white)
      .fontSize(18)
      .text('Jain Pathshala', left + 24, 72);
    doc
      .fillColor(JP.gold)
      .fontSize(9)
      .text(`Donation receipt · ${data.financialYear}`, left + 24, 94);
    doc
      .fillColor(JP.white)
      .fontSize(10)
      .text(`Receipt no. ${data.receiptNumber}`, left + contentW - 200, 78, {
        width: 176,
        align: 'right',
      });

    let y = 128;
    doc
      .fillColor(JP.maroon)
      .fontSize(16)
      .text('Thank you for your gift', left + 24, y);
    y += 22;
    doc
      .fillColor(JP.inkSub)
      .fontSize(10)
      .text(`Issued on ${data.issuedOnDisplay}.`, left + 24, y);
    y += 28;

    const field = (label: string, value: string, x: number, fy: number): void => {
      doc.fillColor(JP.inkSub).fontSize(8).text(label.toUpperCase(), x, fy);
      doc
        .fillColor(JP.ink)
        .fontSize(11)
        .text(value, x, fy + 11, { width: contentW / 2 - 36 });
    };

    field('Donor', data.donorName, left + 24, y);
    field('Purpose', data.purposeLabel, left + 24 + contentW / 2, y);
    y += 44;
    field('Payment id', data.razorpayPaymentId, left + 24, y);
    field('Order id', data.razorpayOrderId, left + 24 + contentW / 2, y);
    y += 44;
    if (data.donorPanMasked) {
      field('Donor PAN', data.donorPanMasked, left + 24, y);
      field('Payment date', data.capturedOnDisplay, left + 24 + contentW / 2, y);
      y += 44;
    } else {
      field('Payment date', data.capturedOnDisplay, left + 24, y);
      y += 44;
    }

    doc.roundedRect(left + 24, y, contentW - 48, 56, 8).fill(JP.creamDark);
    doc
      .fillColor(JP.inkSub)
      .fontSize(8)
      .text('Amount received', left + 36, y + 12);
    doc
      .fillColor(JP.inkSub)
      .fontSize(9)
      .text(`Indian Rupees (${data.currency})`, left + 36, y + 24);
    doc
      .fillColor(JP.saffron)
      .fontSize(26)
      .text(`₹${data.amountInrDisplay}`, left + contentW - 180, y + 10, {
        width: 156,
        align: 'right',
      });

    y += 72;
    let foot =
      `Received with gratitude on behalf of ${data.trustName}. ` +
      'This is a computer-generated receipt and is valid without a signature.';
    if (data.eightyGNote) foot = `${data.eightyGNote}${foot}`;
    doc
      .fillColor(JP.inkSub)
      .fontSize(9)
      .text(foot, left + 24, y, { width: contentW - 48 });
    y += 48;
    doc
      .fillColor(JP.inkSub)
      .fontSize(9)
      .text('Megh Sanskar Vatika · Jain Pathshala', left + 24, y);
    doc
      .fillColor(JP.maroon)
      .fontSize(11)
      .text('Authorised signatory', left + contentW - 180, y, { width: 156, align: 'right' });
    doc
      .fillColor(JP.inkSub)
      .fontSize(9)
      .text(data.trustName, left + contentW - 180, y + 14, {
        width: 156,
        align: 'right',
      });

    return this.toBuffer(doc);
  }

  /** 80G tax certificate — A4 (replaces HTML → Chromium pipeline). */
  async renderEightyGCert(data: EightyGCertPdfData): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const left = 48;
    const contentW = doc.page.width - left * 2;

    doc
      .roundedRect(left, 56, contentW, doc.page.height - 112, 10)
      .lineWidth(2)
      .stroke(JP.gold);
    doc
      .roundedRect(left + 8, 64, contentW - 16, doc.page.height - 128, 6)
      .lineWidth(1)
      .stroke(JP.creamDark);

    let y = 88;
    doc
      .fillColor(JP.gold)
      .fontSize(9)
      .text('80G CERTIFICATE', left, y, { width: contentW, align: 'center' });
    y += 18;
    doc
      .fillColor(JP.maroon)
      .fontSize(20)
      .text(data.trustName, left, y, { width: contentW, align: 'center' });
    y += 28;
    doc
      .fillColor(JP.inkSub)
      .fontSize(9)
      .text(data.trustAddress, left, y, { width: contentW, align: 'center' });
    y += 14;
    doc
      .fillColor(JP.inkSub)
      .fontSize(9)
      .text(`PAN: ${data.trustPan} · 80G Reg.: ${data.registrationNumber}`, left, y, {
        width: contentW,
        align: 'center',
      });
    y += 14;
    doc
      .fillColor(JP.inkSub)
      .fontSize(9)
      .text(`Section ${data.section} of the Income-tax Act, 1961`, left, y, {
        width: contentW,
        align: 'center',
      });
    y += 32;

    doc
      .fillColor(JP.ink)
      .fontSize(10)
      .text(
        `Certificate no. ${data.receiptNumber}   ·   Financial year ${data.financialYear}`,
        left + 20,
        y,
        { width: contentW - 40 },
      );
    y += 22;

    const panClause = data.donorPanMasked ? `(PAN ${data.donorPanMasked}) ` : '';
    doc
      .fillColor(JP.ink)
      .fontSize(11)
      .text(
        `This is to certify that ${data.donorName} ${panClause}has made a donation to ${data.trustName} on ${data.capturedOnDisplay} via Razorpay payment ID ${data.razorpayPaymentId} for the purpose of ${data.purposeLabel}.`,
        left + 20,
        y,
        { width: contentW - 40, align: 'left' },
      );
    y += 56;

    doc.roundedRect(left + 20, y, contentW - 40, 64, 6).fill(JP.creamDark);
    doc
      .fillColor(JP.inkSub)
      .fontSize(8)
      .text('Donation received', left + 32, y + 10);
    doc
      .fillColor(JP.gold)
      .fontSize(22)
      .text(`₹${data.amountInrDisplay}`, left + 32, y + 24);
    doc
      .fillColor(JP.inkSub)
      .fontSize(9)
      .text(`Currency: ${data.currency}`, left + 32, y + 48);
    y += 80;

    doc
      .fillColor(JP.ink)
      .fontSize(10)
      .text(
        `This donation is eligible for deduction under Section ${data.section} of the Income-tax Act, 1961, subject to the conditions specified therein. The donor is advised to retain this certificate for filing income-tax returns.`,
        left + 20,
        y,
        { width: contentW - 40 },
      );
    y += 56;

    doc
      .fillColor(JP.inkSub)
      .fontSize(9)
      .text(`Date of issue · ${data.issuedOnDisplay}`, left + 20, y);
    doc
      .fillColor(JP.inkSub)
      .fontSize(9)
      .text(`Authorised signatory, ${data.trustName}`, left + contentW - 220, y, {
        width: 200,
        align: 'right',
      });
    y += 28;
    doc
      .fillColor(JP.inkSub)
      .fontSize(8)
      .text('Computer-generated certificate. Valid without a physical signature.', left, y, {
        width: contentW,
        align: 'center',
      });

    return this.toBuffer(doc);
  }
}
