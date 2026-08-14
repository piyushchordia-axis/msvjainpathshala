import { Switch, Route } from "wouter";
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
import PanchangPage from "@/pages/public/PanchangPage";
import GalleryPage from "@/pages/public/GalleryPage";
import { AboutPage, MsvPage } from "@/pages/public/PublicStubs";
import CoursesPage from "@/pages/public/CoursesPage";
import CourseDetailPage from "@/pages/public/CourseDetailPage";
import CertificatesPage from "@/pages/public/CertificatesPage";
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
  ShikshakCompletePaymentPage,
  SanchalakCompletePaymentPage,
} from "@/pages/public/join/CompletePaymentRoutes";
import NotFound from "@/pages/not-found";

/** Public marketing shell — lazy-loaded separately from admin (PERF #20). */
export default function PublicRoutes() {
  return (
    <PublicLayout>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/join" component={JoinLandingPage} />
        <Route path="/join/student" component={JoinStudentPage} />
        <Route path="/join/student/complete-payment" component={StudentCompletePaymentPage} />
        <Route path="/join/shikshak" component={JoinShikshakPage} />
        <Route path="/join/shikshak/complete-payment" component={ShikshakCompletePaymentPage} />
        <Route path="/join/sanchalak" component={JoinSanchalakPage} />
        <Route path="/join/sanchalak/complete-payment" component={SanchalakCompletePaymentPage} />
        <Route path="/centres" component={CentresPage} />
        <Route path="/centres/:id" component={CentreDetailPage} />
        <Route path="/team/:citySlug" component={TeamCityPage} />
        <Route path="/team" component={TeamPage} />
        <Route path="/shivirs" component={ShivirsPage} />
        <Route path="/shivirs/:id" component={ShivirDetailPage} />
        <Route path="/notices" component={NoticesPage} />
        <Route path="/library" component={LibraryPage} />
        <Route path="/library/item/:id" component={LibraryItemPage} />
        <Route path="/library/:id" component={LibrarySectionPage} />
        <Route path="/panchang" component={PanchangPage} />
        <Route path="/courses/:id" component={CourseDetailPage} />
        <Route path="/courses" component={CoursesPage} />
        <Route path="/certificates" component={CertificatesPage} />
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
