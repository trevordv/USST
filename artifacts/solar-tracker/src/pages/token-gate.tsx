import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, CheckCircle2, KeyRound, LogIn, Mail } from "lucide-react";

export default function TokenGate() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [forgotMode, setForgotMode] = useState(false);
  const { login, requestPasswordReset, updatePassword, isChecking, isRecovery } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");

    if (!email.trim() || !password) {
      setError("Enter your email address and password.");
      return;
    }

    const message = await login(email, password);
    if (message) setError(message);
  };

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");

    if (!email.trim()) {
      setError("Enter your email address.");
      return;
    }

    const message = await requestPasswordReset(email);
    if (message) {
      setError(message);
      return;
    }

    setNotice("Password reset email sent. Open the link in that email to choose your password.");
  };

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");

    if (password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    const message = await updatePassword(password);
    if (message) setError(message);
  };

  const logoHeader = (
    <CardHeader className="text-center">
      <div className="mx-auto mb-4">
        <img src="/logo.png" alt="USST Logo" className="h-24 w-24 object-contain mx-auto" />
      </div>
      <CardTitle className="text-xl">Utility Scale Solar Tracker</CardTitle>
      <CardDescription>
        {isRecovery
          ? "Choose a password for your USST account"
          : forgotMode
            ? "Reset your USST password"
            : "Sign in with your authorised USST account"}
      </CardDescription>
    </CardHeader>
  );

  if (isRecovery) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          {logoHeader}
          <CardContent>
            <form onSubmit={handlePasswordUpdate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isChecking}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isChecking}
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={isChecking}>
                <KeyRound className="mr-2 h-4 w-4" />
                {isChecking ? "Saving..." : "Set Password"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        {logoHeader}
        <CardContent>
          {forgotMode ? (
            <form onSubmit={handleResetRequest} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reset-email">Email</Label>
                <Input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={isChecking}
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {notice && (
                <div className="flex items-center gap-2 rounded-md bg-muted p-3 text-sm">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  <span>{notice}</span>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={isChecking}>
                <Mail className="mr-2 h-4 w-4" />
                Send Reset Email
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setForgotMode(false);
                  setError("");
                  setNotice("");
                }}
              >
                Back to Sign In
              </Button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={isChecking}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isChecking}
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={isChecking}>
                <LogIn className="mr-2 h-4 w-4" />
                {isChecking ? "Signing in..." : "Sign In"}
              </Button>
              <Button
                type="button"
                variant="link"
                className="w-full"
                onClick={() => {
                  setForgotMode(true);
                  setError("");
                  setNotice("");
                }}
              >
                Forgot password?
              </Button>
            </form>
          )}

          <p className="mt-4 text-center text-xs text-muted-foreground">
            Access is limited to accounts approved by the USST administrator.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
