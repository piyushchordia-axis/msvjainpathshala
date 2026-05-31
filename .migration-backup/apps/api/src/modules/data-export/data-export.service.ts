/**
 * DataExportService — parent self-service data export (GDPR / DPDP
 * "right to access"). Aggregates the authenticated parent's own profile and
 * the data of their children into a single JSON document.
 *
 * Scope: a parent only ever exports their own account + linked children.
 * Released progress reports are included (parents only see released ones);
 * unreleased reports and staff notes are deliberately excluded.
 */

import { Injectable } from '@nestjs/common';

import { AppError, ERROR_CODES } from '@jp/shared';

import { DonationsRepository } from '../../db/repositories/donations.repository';
import { ProgressReportsRepository } from '../../db/repositories/progress-reports.repository';
import { StudentsRepository } from '../../db/repositories/students.repository';
import { UsersRepository } from '../../db/repositories/users.repository';

export interface ParentDataExport {
  generated_at: string;
  parent: {
    id: string;
    full_name: string | null;
    phone: string;
    email: string | null;
    role: string;
    preferred_language: string;
    gallery_visibility_opt_in: boolean;
    created_at: string;
  };
  children: Array<{
    id: string;
    full_name: string;
    father_name: string | null;
    dob: string;
    age_group: string;
    student_code: string;
    centre_id: string;
    batch_id: string | null;
    msv_status: string;
    status: string;
    enrolled_at: string;
    progress_reports: Array<{
      period_kind: string;
      period_label: string;
      generated_at: string | null;
      released_at: string | null;
      shikshak_comment: string | null;
    }>;
  }>;
  donations: Array<{
    id: string;
    amount_paise: number;
    currency: string;
    purpose: string;
    status: string;
    frequency: string;
    receipt_number: string | null;
    financial_year: string | null;
    created_at: string;
  }>;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

@Injectable()
export class DataExportService {
  constructor(
    private readonly users: UsersRepository,
    private readonly students: StudentsRepository,
    private readonly reports: ProgressReportsRepository,
    private readonly donations: DonationsRepository,
  ) {}

  async exportForParent(parentUserId: string): Promise<ParentDataExport> {
    const user = await this.users.findById(parentUserId);
    if (!user) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Account not found',
        statusCode: 404,
      });
    }

    const kids = await this.students.findByParent(parentUserId);
    const children: ParentDataExport['children'] = [];
    for (const k of kids) {
      const allReports = await this.reports.listForStudent(k.id);
      const released = allReports.filter((r) => r.released_to_parent);
      children.push({
        id: k.id,
        full_name: k.full_name,
        father_name: k.father_name,
        dob: String(k.dob),
        age_group: k.age_group,
        student_code: k.student_code,
        centre_id: k.centre_id,
        batch_id: k.batch_id,
        msv_status: k.msv_status,
        status: k.status,
        enrolled_at: iso(k.enrolled_at) ?? '',
        progress_reports: released.map((r) => ({
          period_kind: r.period_kind,
          period_label: r.period_label,
          generated_at: iso(r.generated_at),
          released_at: iso(r.released_at),
          shikshak_comment: r.shikshak_comment,
        })),
      });
    }

    const donationRows = await this.donations.listForDonor(parentUserId);
    const donations = donationRows.map((d) => ({
      id: d.id,
      amount_paise: d.amount_paise,
      currency: d.currency,
      purpose: d.purpose,
      status: d.status,
      frequency: d.frequency,
      receipt_number: d.receipt_number,
      financial_year: d.financial_year,
      created_at: iso(d.created_at) ?? '',
    }));

    return {
      generated_at: new Date().toISOString(),
      parent: {
        id: user.id,
        full_name: user.full_name,
        phone: user.phone,
        email: user.email,
        role: user.role,
        preferred_language: user.preferred_language,
        gallery_visibility_opt_in: user.gallery_visibility_opt_in,
        created_at: iso(user.created_at) ?? '',
      },
      children,
      donations,
    };
  }
}
