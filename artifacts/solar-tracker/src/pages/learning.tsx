import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Check, DatabaseZap, History, ShieldCheck, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type MemoryItem = {
  id: number; memoryType: string; summary: string; confidence: "low" | "medium" | "high";
  source: string; sourceReference?: string | null; timesObserved: number; lastSeenAt: string; status: string;
};
type KnowledgeItem = {
  id: number; knowledgeType: string; summary: string; confidence: "low" | "medium" | "high";
  approvalStatus: string; evidenceCount: number; sourceMemoryIds: number[]; updatedAt: string;
  valueJson: Record<string, unknown>; subjectId?: string | null;
};
type SourceReliability = {
  sourceName: string; successes: number; failures: number; fallbackSuccesses: number;
  avgResponseMs: number | null; qualifyingProjects: number; reliabilityScore: number;
  lastSuccess: string | null; lastFailure: string | null;
};
type Dashboard = {
  memory: MemoryItem[]; knowledge: KnowledgeItem[]; feedback: Array<Record<string, unknown>>;
  conflicts: Array<{ id: number; summary: string; status: string; knowledgeIds: number[]; memoryIds: number[]; resolution?: string | null; resolutionAction?: string | null; selectedKnowledgeId?: number | null; resolvedBy?: number | null; resolvedAt?: string | null }>; metrics: Array<Record<string, unknown>>;
  sourceReliability: SourceReliability[];
};

const confidenceClass = { low: "bg-slate-100 text-slate-700", medium: "bg-amber-100 text-amber-800", high: "bg-emerald-100 text-emerald-800" };

function Trace({ ids }: { ids: number[] }) {
  return (
    <div className="mt-3 flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground" aria-label="Evidence trace">
      <span className="h-px w-6 bg-amber-500" />
      <span>MEMORY</span><span>→</span><span>{ids.length} EVIDENCE</span><span>→</span><span>REVIEW</span>
    </div>
  );
}

export default function LearningPage() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["learning-dashboard"],
    queryFn: () => customFetch<Dashboard>("/api/learning/dashboard", { responseType: "json" }),
  });
  const review = useMutation({
    mutationFn: ({ id, decision }: { id: number; decision: "approved" | "rejected" }) =>
      customFetch(`/api/learning/candidates/${id}/review`, { method: "POST", responseType: "json", body: JSON.stringify({ decision }) }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["learning-dashboard"] }); toast({ title: "Learning reviewed" }); },
  });
  const manage = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      customFetch(`/api/learning/knowledge/${id}`, { method: "PATCH", responseType: "json", body: JSON.stringify(body) }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["learning-dashboard"] }); toast({ title: "Knowledge updated" }); },
  });
  const resolveConflict = useMutation({
    mutationFn: ({ id, action, knowledgeId, reason }: { id: number; action: "select_preferred" | "reject_value" | "dismiss"; knowledgeId?: number; reason: string }) =>
      customFetch(`/api/learning/conflicts/${id}/resolve`, { method: "POST", responseType: "json", body: JSON.stringify({ action, knowledgeId, reason }) }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["learning-dashboard"] }); toast({ title: "Conflict action recorded" }); },
    onError: () => toast({ title: "Conflict was not updated", variant: "destructive" }),
  });
  const takeConflictAction = (id: number, action: "select_preferred" | "reject_value" | "dismiss", knowledgeId?: number) => {
    const reason = window.prompt("Resolution reason (required)");
    if (reason?.trim()) resolveConflict.mutate({ id, action, knowledgeId, reason: reason.trim() });
  };
  const data = query.data;
  const candidates = data?.knowledge.filter((item) => item.approvalStatus === "candidate") ?? [];

  return (
    <Layout>
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-3 border-b pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700"><ShieldCheck className="h-4 w-4" /> Controlled learning ledger</div>
            <h1 className="text-3xl font-bold tracking-tight">Learning / Memory</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Review what USST has observed, what it proposes to reuse, and the evidence behind each candidate. Hard project and security rules remain fixed.</p>
          </div>
          <Badge variant="outline" className="w-fit gap-2 px-3 py-1.5"><DatabaseZap className="h-3.5 w-3.5" /> {candidates.length} pending</Badge>
        </header>

        {query.isLoading && <div className="py-16 text-center text-muted-foreground">Loading the learning ledger…</div>}
        {query.isError && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">The learning ledger could not be loaded. Confirm administrator access and the database migration.</div>}
        {data && (
          <Tabs defaultValue="pending" className="space-y-4">
            <TabsList className="h-auto flex-wrap justify-start">
              <TabsTrigger value="pending">Pending learnings</TabsTrigger>
              <TabsTrigger value="memory">Memory</TabsTrigger>
              <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
              <TabsTrigger value="conflicts">Conflicts</TabsTrigger>
              <TabsTrigger value="sources">Source reliability</TabsTrigger>
              <TabsTrigger value="feedback">Recent feedback</TabsTrigger>
            </TabsList>

            <TabsContent value="pending" className="space-y-3">
              {candidates.length === 0 && <Card><CardContent className="py-10 text-center text-muted-foreground">No learning candidates need review.</CardContent></Card>}
              {candidates.map((item) => (
                <Card key={item.id} className="overflow-hidden border-l-4 border-l-amber-500">
                  <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{item.knowledgeType.replaceAll("_", " ")}</Badge><Badge className={confidenceClass[item.confidence]}>{item.confidence}</Badge></div>
                      <p className="mt-2 font-medium">{item.summary}</p>
                      <Trace ids={item.sourceMemoryIds} />
                      <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer font-medium text-foreground">Inspect evidence</summary><div className="mt-2 space-y-1 border-l-2 border-amber-200 pl-3">{data.memory.filter((memory) => item.sourceMemoryIds.includes(memory.id)).map((memory) => <p key={memory.id}>#{memory.id} · {memory.summary} · {memory.source}</p>)}</div></details>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button variant="outline" size="sm" onClick={() => review.mutate({ id: item.id, decision: "rejected" })}><X className="mr-2 h-4 w-4" />Reject</Button>
                      <Button variant="outline" size="sm" onClick={() => { const summary = window.prompt("Edit the human-readable learning summary", item.summary); if (summary?.trim()) manage.mutate({ id: item.id, body: { summary: summary.trim() } }); }}>Edit</Button>
                      <Button size="sm" onClick={() => review.mutate({ id: item.id, decision: "approved" })}><Check className="mr-2 h-4 w-4" />Approve</Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {data.conflicts.filter((item) => item.status === "open").map((item) => <div key={item.id} className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div><strong>Conflicting evidence blocks approval</strong><p className="mt-1">{item.summary}</p><p className="mt-1">Resolve it in the Conflicts tab.</p></div></div>)}
            </TabsContent>

            <TabsContent value="memory" className="grid gap-3 lg:grid-cols-2">
              {data.memory.map((item) => <Card key={item.id}><CardHeader className="pb-2"><div className="flex items-center justify-between gap-2"><CardTitle className="text-base">{item.summary}</CardTitle><Badge className={confidenceClass[item.confidence]}>{item.confidence}</Badge></div></CardHeader><CardContent className="text-xs text-muted-foreground"><div>{item.memoryType.replaceAll("_", " ")} · observed {item.timesObserved}×</div><div className="mt-2 font-mono">{item.source} · {new Date(item.lastSeenAt).toLocaleString()}</div></CardContent></Card>)}
            </TabsContent>

            <TabsContent value="knowledge" className="space-y-3">
              {data.knowledge.filter((item) => item.approvalStatus === "approved").map((item) => <Card key={item.id}><CardContent className="p-5"><div className="flex items-center justify-between gap-3"><p className="font-medium">{item.summary}</p><div className="flex items-center gap-2"><Badge className="bg-emerald-100 text-emerald-800">approved</Badge><Button variant="ghost" size="sm" onClick={() => manage.mutate({ id: item.id, body: { supersede: true } })}>Supersede</Button></div></div><Trace ids={item.sourceMemoryIds} /><details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">Inspect evidence</summary><div className="mt-2 space-y-1 border-l-2 border-amber-200 pl-3">{data.memory.filter((memory) => item.sourceMemoryIds.includes(memory.id)).map((memory) => <p key={memory.id}>#{memory.id} · {memory.summary} · {memory.source}</p>)}</div></details></CardContent></Card>)}
            </TabsContent>

            <TabsContent value="conflicts" className="space-y-4">
              {data.conflicts.length === 0 && <Card><CardContent className="py-10 text-center text-muted-foreground">No conflicts have been recorded.</CardContent></Card>}
              {data.conflicts.map((conflict) => {
                const values = data.knowledge.filter((item) => conflict.knowledgeIds.includes(item.id));
                return <Card key={conflict.id} className={conflict.status === "open" ? "border-amber-300" : ""}>
                  <CardHeader className="pb-3"><div className="flex items-center justify-between gap-3"><CardTitle className="text-base">Conflict #{conflict.id}</CardTitle><Badge variant={conflict.status === "open" ? "destructive" : "outline"}>{conflict.status}</Badge></div></CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <p>{conflict.summary}</p>
                    {values.map((value) => <div key={value.id} className="rounded-md border p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-medium">Knowledge #{value.id}: {value.summary}</p><pre className="mt-2 max-w-3xl overflow-x-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{JSON.stringify(value.valueJson, null, 2)}</pre><Trace ids={value.sourceMemoryIds} /></div>
                      {conflict.status === "open" && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => takeConflictAction(conflict.id, "reject_value", value.id)}>Reject value</Button><Button size="sm" onClick={() => takeConflictAction(conflict.id, "select_preferred", value.id)}>Approve preferred & resolve</Button></div>}</div>
                      <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">Inspect evidence</summary>{data.memory.filter((memory) => value.sourceMemoryIds.includes(memory.id) || conflict.memoryIds.includes(memory.id)).map((memory) => <p key={memory.id} className="mt-1">#{memory.id} · {memory.summary} · {memory.sourceReference ?? memory.source}</p>)}</details>
                    </div>)}
                    {conflict.status === "open" ? <Button variant="ghost" onClick={() => takeConflictAction(conflict.id, "dismiss")}>Dismiss conflict with reason</Button> : <p className="text-xs text-muted-foreground">{conflict.resolutionAction} by administrator #{conflict.resolvedBy ?? "unknown"} at {conflict.resolvedAt ? new Date(conflict.resolvedAt).toLocaleString() : "not recorded"}: {conflict.resolution}</p>}
                  </CardContent>
                </Card>;
              })}
            </TabsContent>

            <TabsContent value="sources">
              <div className="overflow-x-auto rounded-lg border"><table className="w-full text-sm"><thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="p-3">Source</th><th className="p-3">Reliability</th><th className="p-3">Access</th><th className="p-3">Fallbacks</th><th className="p-3">Avg runtime</th><th className="p-3">Projects</th></tr></thead><tbody>{data.sourceReliability.map((source) => <tr key={source.sourceName} className="border-t"><td className="p-3 font-medium">{source.sourceName}</td><td className="p-3"><span className="font-mono font-semibold">{source.reliabilityScore}%</span></td><td className="p-3">{source.successes} success / {source.failures} fail</td><td className="p-3">{source.fallbackSuccesses}</td><td className="p-3">{source.avgResponseMs == null ? "—" : `${source.avgResponseMs} ms`}</td><td className="p-3">{source.qualifyingProjects}</td></tr>)}</tbody></table></div>
            </TabsContent>

            <TabsContent value="feedback" className="space-y-3">
              {data.feedback.map((item, index) => <div key={String(item.id ?? index)} className="flex items-start gap-3 rounded-lg border p-4"><History className="mt-0.5 h-4 w-4 text-muted-foreground" /><div className="text-sm"><p className="font-medium">{String(item.feedbackType ?? "feedback").replaceAll("_", " ")}</p><p className="mt-1 text-muted-foreground">{String(item.reason ?? `${item.entityType ?? "entity"} ${item.entityId ?? ""}`)}</p></div></div>)}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </Layout>
  );
}
