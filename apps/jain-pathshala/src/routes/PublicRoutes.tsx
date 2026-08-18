import { Switch, Route, useLocation } from "wouter";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { PublicLayout } from "@/pages/public/PublicLayout";
import HomePage from "@/pages/public/HomePage";
import CentresPage from "@/pages/public/CentresPage";
import CentreDetailPage from "@/pages/public/CentreDetailPage";
import TeamPage from "@/pages/public/TeamPage";
import TeamCityPage from "@/pages/public/TeamCityPage";
import ShivirsPage from "@/pages/public/ShivirsPage";
import ShivirDetailPage from "@/pages/public/ShivirDetailPage";
import NoticesPage from "@/pages/public/NoticesPage";
import LibraryPage from "@/pages/public/LibraryPage";
import LibrarySectionPage from "@/pages/public/LibrarySectionPage";
import LibraryItemPage from "@/pages/public/LibraryItemPage";
import LibraryPdfPage from "@/pages/public/LibraryPdfPage";
import LibraryRequestPage from "@/pages/public/LibraryRequestPage";
import MyLibraryRequestsPage from "@/pages/public/MyLibraryRequestsPage";
import PanchangPage from "@/pages/public/PanchangPage";
import GalleryPage from "@/pages/public/GalleryPage";
import { AboutPage, MsvPage } from "@/pages/public/PublicStubs";
import CoursesPage from "@/pages/public/CoursesPage";
import CourseDetailPage from "@/pages/public/CourseDetailPage";
import CertificatesPage from "@/pages/public/CertificatesPage";
import MyMsvPage from "@/pages/public/MyMsvPage";
import ContactPage from "@/pages/public/ContactPage";
import EnquirePage from "@/pages/public/EnquirePage";
import DonatePage from "@/pages/public/DonatePage";
import PublicExamsPage from "@/pages/public/ExamsPage";
import MyServiceRequestsPage from "@/pages/public/MyServiceRequestsPage";
import RegisterPage from "@/pages/public/RegisterPage";
import JoinLandingPage from "@/pages/public/join/JoinLandingPage";
import JoinStudentPage from "@/pages/public/join/JoinStudentPage";
import { JoinShikshakPage, JoinSanchalakPage } from "@/pages/public/join/JoinStaffRoutes";
import {
  StudentCompletePaymentPage,
} from "@/pages/public/join/CompletePaymentRoutes";
import NotFound from "@/pages/not-found";

/** Public marketing shell — lazy-loaded separately from admin (PERF #20). */
export default function PublicRoutes() {
  const [location] = useLocation();
  return (
    <PublicLayout>
      {/* One render-time throw used to blank the whole SPA (XC-WEB-01). */}
      <RouteErrorBoundary resetKey={location}>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/join" component={JoinLandingPage} />
        <Route path="/join/student" component={JoinStudentPage} />
        <Route path="/join/student/complete-payment" component={StudentCompletePaymentPage} />
        <Route path="/join/shikshak" component={JoinShikshakPage} />
        <Route path="/join/sanchalak" component={JoinSanchalakPage} />
        <Route path="/centres" component={CentresPage} />
        <Route path="/centres/:id" component={CentreDetailPage} />
        <Route path="/team/:citySlug" component={TeamCityPage} />
        <Route path="/team" component={TeamPage} />
        <Route path="/shivirs" component={ShivirsPage} />
        <Route path="/shivirs/:id" component={ShivirDetailPage} />
        <Route path="/notices" component={NoticesPage} />
        <Route path="/library" component={LibraryPage} />
        {/* Both must precede /library/:id — wouter matches in order, so the
            section route would otherwise swallow "request" as a section id. */}
        <Route path="/library/request" component={LibraryRequestPage} />
        <Route path="/library/my-requests" component={MyLibraryRequestsPage} />
        <Route path="/library/pdf/:id" component={LibraryPdfPage} />
        <Route path="/library/item/:id" component={LibraryItemPage} />
        <Route path="/library/:id" component={LibrarySectionPage} />
        <Route path="/panchang" component={PanchangPage} />
        <Route path="/courses/:id" component={CourseDetailPage} />
        <Route path="/courses" component={CoursesPage} />
        <Route path="/certificates" component={CertificatesPage} />
        {/* Member MSV apply/status — /msv stays the guest info page. */}
        <Route path="/my-msv" component={MyMsvPage} />
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
      </RouteErrorBoundary>
    </PublicLayout>
  );
}
