import { useState } from "react";
import { useListAccessTokens, useCreateAccessToken, useRevokeAccessToken, getListAccessTokensQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Copy, Trash2, Plus, KeyRound, CheckCircle2 } from "lucide-react";
import { format, addDays } from "date-fns";
import { useAuth } from "@/lib/auth-context";

export default function InvitePage() {
  const { logout } = useAuth();
  const [adminKey, setAdminKey] = useState("");
  const [showAdmin, setShowAdmin] = useState(false);
  const [label, setLabel] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: tokens, refetch } = useListAccessTokens({
    query: {
      queryKey: getListAccessTokensQueryKey(),
      enabled: showAdmin && !!adminKey,
    },
    request: { headers: { "x-admin-key": adminKey } },
  });

  const createToken = useCreateAccessToken({
    request: { headers: { "x-admin-key": adminKey } },
  });

  const revokeToken = useRevokeAccessToken({
    request: { headers: { "x-admin-key": adminKey } },
  });

  const handleCreate = async () => {
    setCreatedToken(null);
    try {
      const result = await createToken.mutateAsync({
        data: { label: label.trim() || undefined },
      });
      setCreatedToken(result.token);
      setLabel("");
      refetch();
    } catch (err) {
      console.error("Failed to create token", err);
    }
  };

  const handleRevoke = async (id: number) => {
    try {
      await revokeToken.mutateAsync({ id });
      refetch();
    } catch (err) {
      console.error("Failed to revoke token", err);
    }
  };

  const getInviteUrl = (token: string) =>
    `${window.location.origin}/?token=${token}`;

  const handleCopy = (token: string) => {
    navigator.clipboard.writeText(getInviteUrl(token));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Team Invites</h1>
          <p className="text-muted-foreground">Generate a 7-day access link to share with a client or team member.</p>
        </div>

        {/* Admin key gate */}
        {!showAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <KeyRound className="h-4 w-4" />
                Admin Access
              </CardTitle>
              <CardDescription>Enter your admin key to manage invites.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={(e) => { e.preventDefault(); if (adminKey) setShowAdmin(true); }} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="admin-key">Admin Key</Label>
                  <Input
                    id="admin-key"
                    type="password"
                    value={adminKey}
                    onChange={(e) => setAdminKey(e.target.value)}
                    placeholder="Enter admin key..."
                  />
                </div>
                <Button type="submit" disabled={!adminKey} className="w-full">
                  Continue
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {showAdmin && (
          <>
            {/* Generate token */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Generate Access Link
                </CardTitle>
                <CardDescription>
                  Creates a unique link valid for <strong>7 days</strong> from today ({format(addDays(new Date(), 7), "d MMM yyyy")}). Copy and send it yourself.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="invite-label">Name / Label (optional)</Label>
                  <Input
                    id="invite-label"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g. Sarah Smith"
                    onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  />
                </div>
                <Button
                  onClick={handleCreate}
                  disabled={createToken.isPending}
                  className="w-full"
                >
                  {createToken.isPending ? "Generating..." : "Generate 7-Day Link"}
                </Button>

                {createdToken && (
                  <div className="rounded-md bg-primary/10 border border-primary/20 p-4 space-y-3">
                    <p className="text-sm font-medium text-primary">Link ready — copy and send it:</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs bg-background rounded px-3 py-2 border truncate">
                        {getInviteUrl(createdToken)}
                      </code>
                      <Button
                        size="sm"
                        onClick={() => handleCopy(createdToken)}
                        className="flex-shrink-0 gap-1.5"
                      >
                        {copied
                          ? <><CheckCircle2 className="h-4 w-4" /> Copied</>
                          : <><Copy className="h-4 w-4" /> Copy</>
                        }
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Expires {format(addDays(new Date(), 7), "EEEE d MMMM yyyy")}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Active invites list */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Active Invites</CardTitle>
              </CardHeader>
              <CardContent>
                {tokens && tokens.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Label</TableHead>
                        <TableHead>Expires</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-20"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tokens.map((t) => {
                        const expired = new Date(t.expiresAt) < new Date();
                        return (
                          <TableRow key={t.id}>
                            <TableCell className="font-medium">{t.label || "—"}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {format(new Date(t.expiresAt), "d MMM yyyy")}
                            </TableCell>
                            <TableCell>
                              <Badge variant={t.revoked ? "destructive" : expired ? "secondary" : "default"}>
                                {t.revoked ? "Revoked" : expired ? "Expired" : "Active"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0"
                                  onClick={() => handleCopy(t.token)}
                                  title="Copy invite link"
                                  disabled={t.revoked || expired}
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                  onClick={() => handleRevoke(t.id)}
                                  disabled={t.revoked}
                                  title="Revoke access"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-6">No invites generated yet.</p>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}
