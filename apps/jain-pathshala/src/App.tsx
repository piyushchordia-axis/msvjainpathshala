import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToasterJP } from "@/components/ui/toast-jp";
import { AuthProvider } from "@/lib/auth-context";
import { LocaleProvider } from "@/lib/locale-context";

const PublicRoutes = lazy(() => import("@/routes/PublicRoutes"));
const AdminRoutes = lazy(() => import("@/routes/AdminRoutes"));
const LoginPage = lazy(() => import("@/pages/admin/LoginPage"));
const PublicLoginPage = lazy(() => import("@/pages/public/PublicLoginPage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

function RouteFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center bg-background text-sm text-muted-foreground">
      Loading…
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Switch>
        <Route path="/admin/login" component={LoginPage} />
        <Route path="/login" component={PublicLoginPage} />
        <Route path="/admin" component={AdminRoutes} />
        <Route path="/admin/*?" component={AdminRoutes} />
        <Route component={PublicRoutes} />
      </Switch>
    </Suspense>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <LocaleProvider>
          <AuthProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <ToasterJP />
          </AuthProvider>
        </LocaleProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
