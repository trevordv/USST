import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import NotFound from "@/pages/not-found";

import TokenGate from "./pages/token-gate";

const Dashboard = lazy(() => import("./pages/dashboard"));
const Projects = lazy(() => import("./pages/projects"));
const ProjectDetail = lazy(() => import("./pages/project-detail"));
const Scans = lazy(() => import("./pages/scans"));
const ScanDetail = lazy(() => import("./pages/scan-detail"));
const EpbcPage = lazy(() => import("./pages/epbc"));
const LearningPage = lazy(() => import("./pages/learning"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

function AuthRouter() {
  const { isValid, isChecking, token } = useAuth();

  if (isChecking && token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Checking access...</div>
      </div>
    );
  }

  if (!isValid) {
    return <TokenGate />;
  }

  return (
    <Suspense
      fallback={(
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="animate-pulse text-muted-foreground">Loading page...</div>
        </div>
      )}
    >
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/projects" component={Projects} />
        <Route path="/projects/:id" component={ProjectDetail} />
        <Route path="/scans" component={Scans} />
        <Route path="/scans/:id" component={ScanDetail} />
        <Route path="/epbc" component={EpbcPage} />
        <Route path="/learning" component={LearningPage} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}>
            <AuthRouter />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
