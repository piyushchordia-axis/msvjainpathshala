import { Switch, Route } from "wouter";
import { PublicLayout } from "@/pages/public/PublicLayout";
import HomePage from "@/pages/public/HomePage";
import CentresPage from "@/pages/public/CentresPage";
import CentreDetailPage from "@/pages/public/CentreDetailPage";
import ShivirsPage from "@/pages/public/ShivirsPage";
import ShivirDetailPage from "@/pages/public/ShivirDetailPage";
import NoticesPage from "@/pages/public/NoticesPage";
import LibraryPage from "@/pages/public/LibraryPage";
import GalleryPage from "@/pages/public/GalleryPage";
import { AboutPage, MsvPage } from "@/pages/public/PublicStubs";
import ContactPage from "@/pages/public/ContactPage";
import EnquirePage from "@/pages/public/EnquirePage";
import DonatePage from "@/pages/public/DonatePage";
import PublicExamsPage from "@/pages/public/ExamsPage";
import MyServiceRequestsPage from "@/pages/public/MyServiceRequestsPage";
import RegisterPage from "@/pages/public/RegisterPage";
import NotFound from "@/pages/not-found";

/** Public marketing shell — lazy-loaded separately from admin (PERF #20). */
export default function PublicRoutes() {
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
