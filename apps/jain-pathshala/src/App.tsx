import { Switch, Route, Router as WouterRouter } from 'wouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ToasterJP } from '@/components/ui/toast-jp';
import { AuthProvider } from '@/lib/auth-context';
import { LocaleProvider } from '@/lib/locale-context';

import { PublicLayout } from '@/pages/public/PublicLayout';
import { AdminLayout } from '@/pages/admin/AdminLayout';

import HomePage from '@/pages/public/HomePage';
import CentresPage from '@/pages/public/CentresPage';
import CentreDetailPage from '@/pages/public/CentreDetailPage';
import ShivirsPage from '@/pages/public/ShivirsPage';
import ShivirDetailPage from '@/pages/public/ShivirDetailPage';
import NoticesPage from '@/pages/public/NoticesPage';
import LibraryPage from '@/pages/public/LibraryPage';
import GalleryPage from '@/pages/public/GalleryPage';
import { AboutPage, MsvPage } from '@/pages/public/PublicStubs';
import ContactPage from '@/pages/public/ContactPage';
import EnquirePage from '@/pages/public/EnquirePage';
import DonatePage from '@/pages/public/DonatePage';
import PublicExamsPage from '@/pages/public/ExamsPage';
import MyServiceRequestsPage from '@/pages/public/MyServiceRequestsPage';

import LoginPage from '@/pages/admin/LoginPage';
import DashboardPage from '@/pages/admin/DashboardPage';
import StudentsPage from '@/pages/admin/StudentsPage';
import EnrolmentsPage from '@/pages/admin/EnrolmentsPage';
import BatchesPage from '@/pages/admin/BatchesPage';
import AnalyticsPage from '@/pages/admin/AnalyticsPage';
import AttendancePage from '@/pages/admin/AttendancePage';
import NiyamReviewPage from '@/pages/admin/NiyamReviewPage';
import ExamBuilderPage from '@/pages/admin/ExamBuilderPage';
import {
  CentresPage as AdminCentresPage,
  ShivirsPage as AdminShivirsPage,
  NiyamsPage,
  PunyaAwardPage,
  PunyaConfigsPage,
  PunyaAuditPage,
  ShikshaksPage,
  HolidaysPage,
  ReportsPage,
  GeographyPage,
  SettingsPage,
} from '@/pages/admin/AdminListPages';
import GalleryAdminPage from '@/pages/admin/GalleryAdminPage';
import NoticesAdminPage from '@/pages/admin/NoticesAdminPage';
import AdminLibraryPage from '@/pages/admin/LibraryAdminPage';
import {
  CurriculumPage,
  ExamsPage,
  DonationsPage,
  QueuesPage,
} from '@/pages/admin/AdminExtendedPages';
// Wave 2 standalone admin pages
import HomeworkAdminPage from '@/pages/admin/HomeworkPage';
import RegistrationFormsPage from '@/pages/admin/RegistrationFormsPage';
import ServiceRequestsAdminPage from '@/pages/admin/ServiceRequestsAdminPage';
import IdCardsAdminPage from '@/pages/admin/IdCardsPage';
import ProgressAdminPage from '@/pages/admin/ProgressPage';
import AuditLogPage from '@/pages/admin/AuditLogPage';
import RegisterPage from '@/pages/public/RegisterPage';
// Wave 3 standalone pages
import CompetitionsAdminPage from '@/pages/admin/CompetitionsPage';
import QuizzesAdminPage from '@/pages/admin/QuizzesPage';
import MsvAdminPage from '@/pages/admin/MsvAdminPage';
import ShivirDashboardPage from '@/pages/admin/ShivirDashboardPage';
import EnquiriesAdminPage from '@/pages/admin/EnquiriesPage';

import NotFound from '@/pages/not-found';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function PublicRoutes() {
  return (
    <PublicLayout>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/centres" component={CentresPage} />
        <Route path="/centres/:id" component={CentreDetailPage} />
        <Route path="/shivirs" component={ShivirsPage} />
        <Route path="/shivirs/:id" component={ShivirDetailPage} />
        <Route path="/notices" component={NoticesPage} />
        <Route path="/library" component={LibraryPage} />
        <Route path="/gallery" component={GalleryPage} />
        <Route path="/about" component={AboutPage} />
        <Route path="/contact" component={ContactPage} />
        <Route path="/donate" component={DonatePage} />
        <Route path="/enquire" component={EnquirePage} />
        <Route path="/msv" component={MsvPage} />
        <Route path="/register" component={RegisterPage} />
        <Route path="/exams" component={PublicExamsPage} />
        <Route path="/my-requests" component={MyServiceRequestsPage} />
        <Route component={NotFound} />
      </Switch>
    </PublicLayout>
  );
}

function AdminRoutes() {
  return (
    <AdminLayout>
      <Switch>
        <Route path="/admin" component={DashboardPage} />
        <Route path="/admin/analytics" component={AnalyticsPage} />
        <Route path="/admin/students" component={StudentsPage} />
        <Route path="/admin/enrolments" component={EnrolmentsPage} />
        <Route path="/admin/msv-enrolments" component={MsvAdminPage} />
        <Route path="/admin/shikshaks" component={ShikshaksPage} />
        <Route path="/admin/batches" component={BatchesPage} />
        <Route path="/admin/curriculum" component={CurriculumPage} />
        <Route path="/admin/exams" component={ExamsPage} />
        <Route path="/admin/exam-builder" component={ExamBuilderPage} />
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
        <Route path="/admin/centres" component={AdminCentresPage} />
        <Route path="/admin/id-cards" component={IdCardsAdminPage} />
        <Route path="/admin/holidays" component={HolidaysPage} />
        <Route path="/admin/attendance" component={AttendancePage} />
        <Route path="/admin/notices" component={NoticesAdminPage} />
        <Route path="/admin/gallery" component={GalleryAdminPage} />
        <Route path="/admin/library" component={AdminLibraryPage} />
        <Route path="/admin/donations" component={DonationsPage} />
        <Route path="/admin/service-requests" component={ServiceRequestsAdminPage} />
        <Route path="/admin/registration-forms" component={RegistrationFormsPage} />
        <Route path="/admin/shivir-dashboard" component={ShivirDashboardPage} />
        <Route path="/admin/enquiries" component={EnquiriesAdminPage} />
        <Route path="/admin/reports" component={ReportsPage} />
        <Route path="/admin/audit" component={AuditLogPage} />
        <Route path="/admin/geography" component={GeographyPage} />
        <Route path="/admin/settings" component={SettingsPage} />
        <Route path="/admin/queues" component={QueuesPage} />
        <Route component={NotFound} />
      </Switch>
    </AdminLayout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/admin/login" component={LoginPage} />
      <Route path="/admin" component={AdminRoutes} />
      <Route path="/admin/*?" component={AdminRoutes} />
      <Route component={PublicRoutes} />
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <LocaleProvider>
          <AuthProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
              <Router />
            </WouterRouter>
            <ToasterJP />
          </AuthProvider>
        </LocaleProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
