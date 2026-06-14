import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import NotFound from "@/pages/not-found";

import Dashboard from "./pages/dashboard";
import Projects from "./pages/projects";
import ProjectDetail from "./pages/project-detail";
import Scans from "./pages/scans";
import ScanDetail from "./pages/scan-detail";
import TokenGate from "./pages/token-gate";
import InvitePage from "./pages/invite";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

function AuthRouter() {
  const { isValid, isChecking, token } = useAuth();

  // If checking token, show loading (or the gate if no token)
  if (isChecking && token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Checking access...</div>
      </div>
    );
  }

  // If no valid token, show the gate
  if (!isValid) {
    return <TokenGate />;
  }

  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/projects" component={Projects} />
      <Route path="/projects/:id" component={ProjectDetail} />
      <Route path="/scans" component={Scans} />
      <Route path="/scans/:id" component={ScanDetail} />
      <Route path="/invite" component={InvitePage} />
      <Route component={NotFound} />
    </Switch>
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
