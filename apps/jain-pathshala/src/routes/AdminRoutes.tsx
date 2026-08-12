import { lazy, Suspense } from "react";
import { Switch, Route } from "wouter";
import { AdminLayout } from "@/pages/admin/AdminLayout";
import NotFound from "@/pages/not-found";

const DashboardPage = lazy(() => import("@/pages/admin/DashboardPage"));
const StudentsPage = lazy(() => import("@/pages/admin/StudentsPage"));
const EnrolmentsPage = lazy(() => import("@/pages/admin/EnrolmentsPage"));
const BatchesPage = lazy(() => import("@/pages/admin/BatchesPage"));
const CentreStaffPage = lazy(() => import("@/pages/admin/CentreStaffPage"));
const AnalyticsPage = lazy(() => import("@/pages/admin/AnalyticsPage"));
const AttendancePage = lazy(() => import("@/pages/admin/AttendancePage"));
const NiyamReviewPage = lazy(() => import("@/pages/admin/NiyamReviewPage"));
const ExamBuilderPage = lazy(() => import("@/pages/admin/ExamBuilderPage"));
const ExamGradingPage = lazy(() => import("@/pages/admin/ExamGradingPage"));
const GalleryAdminPage = lazy(() => import("@/pages/admin/GalleryAdminPage"));
const MediaCurationPage = lazy(() => import("@/pages/admin/MediaCurationPage"));
const NoticesAdminPage = lazy(() => import("@/pages/admin/NoticesAdminPage"));
const AdminLibraryPage = lazy(() => import("@/pages/admin/LibraryAdminPage"));
const HomeworkAdminPage = lazy(() => import("@/pages/admin/HomeworkPage"));
const RegistrationFormsPage = lazy(() => import("@/pages/admin/RegistrationFormsPage"));
const JoinAdminPage = lazy(() => import("@/pages/admin/JoinAdminPage"));
const ServiceRequestsAdminPage = lazy(() => import("@/pages/admin/ServiceRequestsAdminPage"));
const IdCardsAdminPage = lazy(() => import("@/pages/admin/IdCardsPage"));
const ProgressAdminPage = lazy(() => import("@/pages/admin/ProgressPage"));
const AuditLogPage = lazy(() => import("@/pages/admin/AuditLogPage"));
const CompetitionsAdminPage = lazy(() => import("@/pages/admin/CompetitionsPage"));
const QuizzesAdminPage = lazy(() => import("@/pages/admin/QuizzesPage"));
const MsvAdminPage = lazy(() => import("@/pages/admin/MsvAdminPage"));
const ShivirDashboardPage = lazy(() => import("@/pages/admin/ShivirDashboardPage"));
const EnquiriesAdminPage = lazy(() => import("@/pages/admin/EnquiriesPage"));

const AdminCentresPage = lazy(() =>
  import("@/pages/admin/AdminListPages").then((m) => ({ default: m.CentresPage })),
);
const AdminShivirsPage = lazy(() =>
  import("@/pages/admin/AdminListPages").then((m) => ({ default: m.ShivirsPage })),
);
const NiyamsPage = lazy(() =>
  import("@/pages/admin/AdminListPages").then((m) => ({ default: m.NiyamsPage })),
);
const PunyaAwardPage = lazy(() =>
  import("@/pages/admin/AdminListPages").then((m) => ({ default: m.PunyaAwardPage })),
);
const PunyaConfigsPage = lazy(() =>
  import("@/pages/admin/AdminListPages").then((m) => ({ default: m.PunyaConfigsPage })),
);
const PunyaAuditPage = lazy(() =>
  import("@/pages/admin/AdminListPages").then((m) => ({ default: m.PunyaAuditPage })),
);
const ShikshaksPage = lazy(() =>
  import("@/pages/admin/AdminListPages").then((m) => ({ default: m.ShikshaksPage })),
);
const HolidaysPage = lazy(() =>
  import("@/pages/admin/AdminListPages").then((m) => ({ default: m.HolidaysPage })),
);
const ReportsPage = lazy(() =>
  import("@/pages/admin/AdminListPages").then((m) => ({ default: m.ReportsPage })),
);
const GeographyPage = lazy(() =>
  import("@/pages/admin/AdminListPages").then((m) => ({ default: m.GeographyPage })),
);
const SettingsPage = lazy(() =>
  import("@/pages/admin/AdminListPages").then((m) => ({ default: m.SettingsPage })),
);

const CoursesAdminPage = lazy(() => import("@/pages/admin/CoursesAdminPage"));
const ExamsPage = lazy(() =>
  import("@/pages/admin/AdminExtendedPages").then((m) => ({ default: m.ExamsPage })),
);
const DonationsPage = lazy(() =>
  import("@/pages/admin/AdminExtendedPages").then((m) => ({ default: m.DonationsPage })),
);
const QueuesPage = lazy(() =>
  import("@/pages/admin/AdminExtendedPages").then((m) => ({ default: m.QueuesPage })),
);

function AdminPageFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
      Loading…
    </div>
  );
}

/** Admin shell — each page is a separate chunk (PERF #20). */
export default function AdminRoutes() {
  return (
    <AdminLayout>
      <Suspense fallback={<AdminPageFallback />}>
        <Switch>
          <Route path="/admin" component={DashboardPage} />
          <Route path="/admin/analytics" component={AnalyticsPage} />
          <Route path="/admin/students" component={StudentsPage} />
          <Route path="/admin/enrolments" component={EnrolmentsPage} />
          <Route path="/admin/msv-enrolments" component={MsvAdminPage} />
          <Route path="/admin/shikshaks" component={ShikshaksPage} />
          <Route path="/admin/batches" component={BatchesPage} />
          <Route path="/admin/courses" component={CoursesAdminPage} />
          <Route path="/admin/curriculum" component={CoursesAdminPage} />
          <Route path="/admin/exams" component={ExamsPage} />
          <Route path="/admin/exam-builder" component={ExamBuilderPage} />
          <Route path="/admin/exam-grading" component={ExamGradingPage} />
          <Route path="/admin/niyams" component={NiyamsPage} />
          <Route path="/admin/niyam-review" component={NiyamReviewPage} />
          <Route path="/admin/homework" component={HomeworkAdminPage} />
          <Route path="/admin/progress" component={ProgressAdminPage} />
          <Route path="/admin/competitions" component={CompetitionsAdminPage} />
          <Route path="/admin/quizzes" component={QuizzesAdminPage} />
          <Route path="/admin/shivirs" component={AdminShivirsPage} />
          <Route path="/admin/punya/manual-award" component={PunyaAwardPage} />
          <Route path="/admin/punya/configs" component={PunyaConfigsPage} />
          <Route path="/admin/punya/audit" component={PunyaAuditPage} />
          <Route path="/admin/centres/:id" component={CentreStaffPage} />
          <Route path="/admin/centres" component={AdminCentresPage} />
          <Route path="/admin/id-cards" component={IdCardsAdminPage} />
          <Route path="/admin/holidays" component={HolidaysPage} />
          <Route path="/admin/attendance" component={AttendancePage} />
          <Route path="/admin/notices" component={NoticesAdminPage} />
          <Route path="/admin/gallery" component={GalleryAdminPage} />
          <Route path="/admin/media-curation" component={MediaCurationPage} />
          <Route path="/admin/library/items/:id" component={AdminLibraryPage} />
          <Route path="/admin/library/items" component={AdminLibraryPage} />
          <Route path="/admin/library/audio" component={AdminLibraryPage} />
          <Route path="/admin/library/panchang" component={AdminLibraryPage} />
          <Route path="/admin/library/media" component={AdminLibraryPage} />
          <Route path="/admin/library" component={AdminLibraryPage} />
          <Route path="/admin/donations" component={DonationsPage} />
          <Route path="/admin/service-requests" component={ServiceRequestsAdminPage} />
          <Route path="/admin/registration-forms" component={RegistrationFormsPage} />
          <Route path="/admin/join" component={JoinAdminPage} />
          <Route path="/admin/shivir-dashboard" component={ShivirDashboardPage} />
          <Route path="/admin/enquiries" component={EnquiriesAdminPage} />
          <Route path="/admin/reports" component={ReportsPage} />
          <Route path="/admin/audit" component={AuditLogPage} />
          <Route path="/admin/geography" component={GeographyPage} />
          <Route path="/admin/settings" component={SettingsPage} />
          <Route path="/admin/queues" component={QueuesPage} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </AdminLayout>
  );
}
