import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KeyRound, AlertCircle } from "lucide-react";

export default function TokenGate() {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const { setToken, isChecking, isValid } = useAuth();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!input.trim()) {
      setError("Please enter an access token");
      return;
    }
    setToken(input.trim());
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4">
            <img
              src="/logo.png"
              alt="USST Logo"
              className="h-24 w-24 object-contain mx-auto"
            />
          </div>
          <CardTitle className="text-xl">Utility Scale Solar Tracker</CardTitle>
          <CardDescription>
            Enter your access token to continue
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="token">Access Token</Label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="token"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Paste your token here..."
                  className="pl-10"
                  disabled={isChecking}
                />
              </div>
            </div>

            {isValid === false && !isChecking && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>Invalid or expired token. Please check and try again.</span>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={isChecking}>
              {isChecking ? "Checking..." : "Access App"}
            </Button>
          </form>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            If you don&apos;t have a token, ask the app owner to generate one for you.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
