import { useState } from "react";
import { useListAccessTokens, useCreateAccessToken, useRevokeAccessToken, getListAccessTokensQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Copy, Trash2, Plus, KeyRound, Mail, CheckCircle2, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth-context";

export default function InvitePage() {
  const { logout } = useAuth();
  const [adminKey, setAdminKey] = useState("");
  const [showAdmin, setShowAdmin] = useState(false);

  const [recipientEmail, setRecipientEmail] = useState("");
  const [label, setLabel] = useState("");
  const [lastResult, setLastResult] = useState<{ token: string; emailSent: boolean; recipientEmail: string } | null>(null);
  const [copyDone, setCopyDone] = useState(false);

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
    if (!recipientEmail) return;
    setLastResult(null);
    try {
      const result = await createToken.mutateAsync({
        data: {
          label: label.trim() || undefined,
          recipientEmail: recipientEmail.trim(),
          // No expiresAt → server defaults to 7 days
        },
      });
      setLastResult({
        token: result.token,
        emailSent: (result as { emailSent?: boolean }).emailSent ?? false,
        recipientEmail: recipientEmail.trim(),
      });
      setRecipientEmail("");
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

  const getInviteUrl = (token: string) => {
    const base = window.location.origin + window.location.pathname.replace(/\/$/, "").replace(/\/[^/]+$/, "");
    return `${window.location.origin}/?token=${token}`;
  };

  const handleCopy = (token: string) => {
    navigator.clipboard.writeText(getInviteUrl(token));
    setCopyDone(true);
    setTimeout(() => setCopyDone(false), 2000);
  };

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Team Invites</h1>
          <p className="text-muted-foreground">Send a 7-day access link directly to a client or team member.</p>
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
            <CardContent className="space-y-4">
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
            {/* Send invite */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Send an Invite
                </CardTitle>
                <CardDescription>
                  A unique access link will be emailed to the recipient. Valid for <strong>7 days</strong>.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="recipient-email">Client Email *</Label>
                  <Input
                    id="recipient-email"
                    type="email"
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    placeholder="client@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-label">Name / Label (optional)</Label>
                  <Input
                    id="invite-label"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g. Sarah Smith"
                  />
                </div>
                <Button
                  onClick={handleCreate}
                  disabled={!recipientEmail || createToken.isPending}
                  className="w-full"
                >
                  <Mail className="h-4 w-4 mr-2" />
                  {createToken.isPending ? "Sending..." : "Send Invite"}
                </Button>

                {lastResult && (
                  <div className={`rounded-md p-4 space-y-3 ${lastResult.emailSent ? "bg-green-50 border border-green-200" : "bg-amber-50 border border-amber-200"}`}>
                    {lastResult.emailSent ? (
                      <div className="flex items-center gap-2 text-green-700 font-medium text-sm">
                        <CheckCircle2 className="h-4 w-4" />
                        Invite sent to {lastResult.recipientEmail}
                      </div>
                    ) : (
                      <div className="flex items-start gap-2 text-amber-700 text-sm">
                        <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        <span>
                          Token created but email could not be sent (Gmail not configured). Share this link manually:
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs bg-white rounded px-2 py-1.5 border truncate text-gray-700">
                        {getInviteUrl(lastResult.token)}
                      </code>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleCopy(lastResult.token)}
                        className="flex-shrink-0"
                      >
                        {copyDone ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Token list */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Active Invites</CardTitle>
              </CardHeader>
              <CardContent>
                {tokens && tokens.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Recipient</TableHead>
                        <TableHead>Expires</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-16"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tokens.map((t) => (
                        <TableRow key={t.id}>
                          <TableCell>
                            <div className="font-medium text-sm">{t.label || "—"}</div>
                            <div className="text-xs text-muted-foreground">{(t as { recipientEmail?: string }).recipientEmail || ""}</div>
                          </TableCell>
                          <TableCell className="text-sm">
                            {format(new Date(t.expiresAt), "d MMM yyyy")}
                          </TableCell>
                          <TableCell>
                            <Badge variant={t.revoked ? "destructive" : new Date(t.expiresAt) < new Date() ? "secondary" : "default"}>
                              {t.revoked ? "Revoked" : new Date(t.expiresAt) < new Date() ? "Expired" : "Active"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={() => handleCopy(t.token)}
                                title="Copy link"
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-destructive"
                                onClick={() => handleRevoke(t.id)}
                                disabled={t.revoked}
                                title="Revoke"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">No invites yet.</p>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}
