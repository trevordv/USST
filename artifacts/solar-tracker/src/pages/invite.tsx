import { useState } from "react";
import { useListAccessTokens, useCreateAccessToken, useRevokeAccessToken, getListAccessTokensQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Copy, Trash2, Plus, KeyRound } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth-context";

export default function InvitePage() {
  const { logout } = useAuth();
  const [adminKey, setAdminKey] = useState("");
  const [label, setLabel] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);

  const { data: tokens, refetch } = useListAccessTokens({
    query: {
      queryKey: getListAccessTokensQueryKey(),
      enabled: showAdmin && !!adminKey,
    },
    request: {
      headers: { "x-admin-key": adminKey },
    },
  });

  const createToken = useCreateAccessToken({
    request: {
      headers: { "x-admin-key": adminKey },
    },
  });

  const revokeToken = useRevokeAccessToken({
    request: {
      headers: { "x-admin-key": adminKey },
    },
  });

  const handleCreate = async () => {
    if (!expiresAt) return;
    setCreatedToken(null);
    try {
      const result = await createToken.mutateAsync({
        data: { label: label || undefined, expiresAt: new Date(expiresAt).toISOString() },
      });
      setCreatedToken(result.token);
      setLabel("");
      setExpiresAt("");
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

  const handleCopy = (token: string) => {
    navigator.clipboard.writeText(token);
  };

  const getInviteUrl = (token: string) => {
    const base = window.location.origin + window.location.pathname;
    return `${base}?token=${token}`;
  };

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Team Invites</h1>
            <p className="text-muted-foreground">Generate time-limited access tokens for your team.</p>
          </div>
          <Button variant="outline" onClick={logout}>
            Sign Out
          </Button>
        </div>

        {/* Admin key gate */}
        {!showAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <KeyRound className="h-4 w-4" />
                Admin Access
              </CardTitle>
              <CardDescription>
                Enter your admin key to manage invites.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Admin Key</Label>
                <Input
                  type="password"
                  value={adminKey}
                  onChange={(e) => setAdminKey(e.target.value)}
                  placeholder="Enter admin key..."
                />
              </div>
              <Button
                onClick={() => setShowAdmin(true)}
                disabled={!adminKey}
                className="w-full"
              >
                Continue
              </Button>
            </CardContent>
          </Card>
        )}

        {showAdmin && (
          <>
            {/* Create token */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Create New Token
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Label (optional)</Label>
                  <Input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g. Sarah — Marketing team"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Expires At</Label>
                  <Input
                    type="datetime-local"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                  />
                </div>
                <Button
                  onClick={handleCreate}
                  disabled={!expiresAt || createToken.isPending}
                  className="w-full"
                >
                  {createToken.isPending ? "Creating..." : "Generate Token"}
                </Button>

                {createdToken && (
                  <div className="rounded-md bg-primary/10 p-3 space-y-2">
                    <p className="text-sm font-medium">Token created! Share this link:</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs bg-background rounded px-2 py-1 truncate">
                        {getInviteUrl(createdToken)}
                      </code>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleCopy(getInviteUrl(createdToken))}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Token list */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Active Tokens</CardTitle>
              </CardHeader>
              <CardContent>
                {tokens && tokens.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Label</TableHead>
                        <TableHead>Token</TableHead>
                        <TableHead>Expires</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tokens.map((t) => (
                        <TableRow key={t.id}>
                          <TableCell className="font-medium">{t.label || "—"}</TableCell>
                          <TableCell>
                            <code className="text-xs">{t.token.slice(0, 8)}...
                              <Button
                                size="sm"
                                variant="ghost"
                                className="ml-1 h-6 w-6 p-0"
                                onClick={() => handleCopy(t.token)}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            </code>
                          </TableCell>
                          <TableCell className="text-sm">
                            {format(new Date(t.expiresAt), "MMM d, yyyy HH:mm")}
                          </TableCell>
                          <TableCell>
                            <Badge variant={t.revoked ? "destructive" : "default"}>
                              {t.revoked ? "Revoked" : "Active"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0 text-destructive"
                              onClick={() => handleRevoke(t.id)}
                              disabled={t.revoked}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No tokens yet.
                  </p>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}
