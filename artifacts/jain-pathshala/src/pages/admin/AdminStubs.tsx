import { AdminPlaceholder } from '@/components/admin/AdminPlaceholder';

export function AnalyticsPage() {
  return <AdminPlaceholder title="Analytics" subtitle="Attendance trends and tier distribution" body="Analytics data loads from the API. Connect the backend to see live charts." />;
}

export function StudentsPage() {
  return <AdminPlaceholder title="Students" subtitle="Roster across your centres and batches" body="Student management is available through the admin panel once connected to the backend API." />;
}

export function EnrolmentsPage() {
  return <AdminPlaceholder title="Enrolments" subtitle="Review and approve enrolment requests" body="Enrolment queue loads from the API when the backend is running." />;
}

export function MsvEnrolmentsPage() {
  return <AdminPlaceholder title="MSV Applications" subtitle="Manage MSV programme admissions" body="MSV application management coming via the backend API." />;
}

export function ShikshaksPage() {
  return <AdminPlaceholder title="Shikshaks" subtitle="Gurujis and Didis across your centres" body="Shikshak roster loads from the backend API." />;
}

export function BatchesPage() {
  return <AdminPlaceholder title="Batches" subtitle="Batches across your centres with schedules" body="Batch management is available once connected to the backend API." />;
}

export function CurriculumPage() {
  return <AdminPlaceholder title="Curriculum" subtitle="Lesson plans and study materials" body="Curriculum management loads from the backend." />;
}

export function ExamsPage() {
  return <AdminPlaceholder title="Exams" subtitle="Manage exams and OTP sessions" body="Exam management is available through the backend API." />;
}

export function NiyamsPage() {
  return <AdminPlaceholder title="Niyams" subtitle="Spiritual commitments and submissions" body="Niyam tracking loads from the backend API." />;
}

export function ShivirsPage() {
  return <AdminPlaceholder title="Shivirs" subtitle="Residential and day camps" body="Shivir management is available through the backend API." />;
}

export function PunyaAwardPage() {
  return <AdminPlaceholder title="Award Punya" subtitle="Manually award Punya points" body="Punya award tool requires backend API connection." />;
}

export function PunyaConfigsPage() {
  return <AdminPlaceholder title="Punya Configs" subtitle="Configure Punya award rules" body="Punya configuration loads from the backend." />;
}

export function PunyaAuditPage() {
  return <AdminPlaceholder title="Punya Audit" subtitle="Audit log of Punya awards" body="Punya audit log loads from the backend API." />;
}

export function CentresPage() {
  return <AdminPlaceholder title="Centres" subtitle="Manage centres in your scope" body="Centre management loads from the backend API." />;
}

export function HolidaysPage() {
  return <AdminPlaceholder title="Holiday Calendar" subtitle="Centre holiday schedule" body="Holiday calendar loads from the backend." />;
}

export function NoticesPage() {
  return <AdminPlaceholder title="Notices" subtitle="Publish notices to your centres" body="Notice management is available through the backend API." />;
}

export function GalleryPage() {
  return <AdminPlaceholder title="Gallery" subtitle="Photos from across the network" body="Gallery management loads from the backend." />;
}

export function LibraryPage() {
  return <AdminPlaceholder title="Library" subtitle="Learning resources and materials" body="Library management loads from the backend." />;
}

export function DonationsPage() {
  return <AdminPlaceholder title="Donations" subtitle="Donation records and campaigns" body="Donation data loads from the backend API." />;
}

export function ServiceRequestsPage() {
  return <AdminPlaceholder title="Service Requests" subtitle="Open service requests in your scope" body="Service request management loads from the backend." />;
}

export function ReportsPage() {
  return <AdminPlaceholder title="Reports" subtitle="Detailed reports for your scope" body="Report generation is available through the backend API." />;
}

export function AuditPage() {
  return <AdminPlaceholder title="Audit Log" subtitle="Track changes across your scope" body="Audit log loads from the backend API." />;
}

export function GeographyPage() {
  return <AdminPlaceholder title="Geography" subtitle="Manage states, cities, and zones" body="Geography management loads from the backend." />;
}

export function SettingsPage() {
  return <AdminPlaceholder title="Settings" subtitle="Platform settings and configuration" body="Settings load from the backend." />;
}

export function QueuesPage() {
  return <AdminPlaceholder title="Queues" subtitle="Background job queue status" body="Queue monitoring requires backend API connection." />;
}
