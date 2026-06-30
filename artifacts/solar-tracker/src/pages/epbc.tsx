import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RefreshCw, ExternalLink, Sun, XCircle, Download, Search, Upload } from "lucide-react";
import { format } from "date-fns";
import { useDebounce } from "@/lib/use-debounce";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface EpbcProject {
  id: number;
  epbcNumber: string;
  projectName: string;
  proponent: string | null;
  industryType: string | null;
  projectStatus: string | null;
  decisionStatus: string | null;
  state: string | null;
  location: string | null;
  technologyType: string | null;
  sizeMw: number | null;
  referralDate: string | null;
  approvalDate: string | null;
  sourceUrl: string | null;
  rawDescription: string | null;
  isRenewable: boolean;
  isSolar: boolean;
  isApproved: boolean;
  relevanceStatus: string;
  scrapedAt: string;
  updatedAt: string;
}

interface EpbcMeta {
  lastScrapedAt: string | null;
  total: number;
}

interface SyncResult {
  newCount: number;
  updatedCount: number;
  total: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const RELEVANCE_LABELS: Record<string, string> = {
  solar: "Solar",
  wind: "Wind",
  bess: "BESS",
  transmission: "Transmission",
  needs_review: "Needs Review",
  not_relevant: "Not Relevant",
  pending: "Pending",
};

const RELEVANCE_COLORS: Record<string, string> = {
  solar: "border-amber-300 bg-amber-50 text-amber-700",
  wind: "border-blue-300 bg-blue-50 text-blue-700",
  bess: "border-purple-300 bg-purple-50 text-purple-700",
  transmission: "border-slate-300 bg-slate-50 text-slate-700",
  needs_review: "border-orange-300 bg-orange-50 text-orange-700",
  not_relevant: "border-red-200 bg-red-50 text-red-600",
  pending: "border-gray-200 bg-gray-50 text-gray-500",
};

const AU_STATES = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA", "National", "Offshore"];

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function buildQuery(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v && v !== "all") q.set(k, v);
  }
  return q.toString() ? `?${q.toString()}` : "";
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EpbcPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [state, setState] = useState("all");
  const [technology, setTechnology] = useState("all");
  const [relevanceStatus, setRelevanceStatus] = useState("all");
  const [approvalStatus, setApprovalStatus] = useState("all");
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const debouncedSearch = useDebounce(search, 300);

  const queryStr = buildQuery({
    search: debouncedSearch || undefined,
    state: state !== "all" ? state : undefined,
    technology: technology !== "all" ? technology : undefined,
    relevanceStatus: relevanceStatus !== "all" ? relevanceStatus : undefined,
    approvalStatus: approvalStatus !== "all" ? approvalStatus : undefined,
  });

  const { data: projects = [], isLoading } = useQuery<EpbcProject[]>({
    queryKey: ["epbc-projects", queryStr],
    queryFn: () => apiFetch<EpbcProject[]>(`/api/epbc/projects${queryStr}`),
  });

  const { data: meta } = useQuery<EpbcMeta>({
    queryKey: ["epbc-meta"],
    queryFn: () => apiFetch<EpbcMeta>("/api/epbc/meta"),
    staleTime: 60_000,
  });

  const [syncStartDate, setSyncStartDate] = useState("");
  const [syncEndDate, setSyncEndDate] = useState("");

  const syncMutation = useMutation<SyncResult>({
    mutationFn: () => apiFetch<SyncResult>("/api/epbc/sync", {
      method: "POST",
      body: JSON.stringify({
        startDate: syncStartDate || undefined,
        endDate:   syncEndDate   || undefined,
      }),
    }),
    onSuccess: (data) => {
      setSyncMsg(`Sync complete: ${data.newCount} new, ${data.updatedCount} updated`);
      qc.invalidateQueries({ queryKey: ["epbc-projects"] });
      qc.invalidateQueries({ queryKey: ["epbc-meta"] });
      setTimeout(() => setSyncMsg(null), 5000);
    },
    onError: (err: Error) => {
      setSyncMsg(`Sync failed: ${err.message}`);
      setTimeout(() => setSyncMsg(null), 6000);
    },
  });

  const patchMutation = useMutation<EpbcProject, Error, { id: number; patch: Partial<EpbcProject> }>({
    mutationFn: ({ id, patch }) =>
      apiFetch<EpbcProject>(`/api/epbc/projects/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["epbc-projects"] }),
  });

  const uploadMutation = useMutation<{ newCount: number; updatedCount: number; skipped: number; total: number }, Error, File>({
    mutationFn: async (file) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${BASE}/api/epbc/upload`, { method: "POST", body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return res.json() as Promise<{ newCount: number; updatedCount: number; skipped: number; total: number }>;
    },
    onSuccess: (data) => {
      setSyncMsg(`Upload complete: ${data.newCount} new, ${data.updatedCount} updated, ${data.skipped} skipped`);
      qc.invalidateQueries({ queryKey: ["epbc-projects"] });
      qc.invalidateQueries({ queryKey: ["epbc-meta"] });
      setTimeout(() => setSyncMsg(null), 7000);
    },
    onError: (err: Error) => {
      setSyncMsg(`Upload failed: ${err.message}`);
      setTimeout(() => setSyncMsg(null), 6000);
    },
  });

  const importMutation = useMutation<{ projectId: number; message: string }, Error, number>({
    mutationFn: (id) =>
      apiFetch<{ projectId: number; message: string }>(`/api/epbc/projects/${id}/import`, {
        method: "POST",
      }),
    onSuccess: (data) => {
      setSyncMsg(`Imported as project #${data.projectId}`);
      qc.invalidateQueries({ queryKey: ["epbc-projects"] });
      setTimeout(() => setSyncMsg(null), 5000);
    },
    onError: (err: Error) => {
      setSyncMsg(`Import failed: ${err.message}`);
      setTimeout(() => setSyncMsg(null), 5000);
    },
  });

  // Unique tech types from current data
  const techTypes = Array.from(new Set(projects.map((p) => p.technologyType).filter(Boolean))) as string[];

  return (
    <Layout>
      <TooltipProvider>
        <div className="space-y-5">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">EPBC Projects</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Renewable energy referrals from the EPBC Public Portal
                {meta?.lastScrapedAt && (
                  <span className="ml-2 text-xs text-muted-foreground/70">
                    · Last synced {format(new Date(meta.lastScrapedAt), "d MMM yyyy, HH:mm")}
                  </span>
                )}
                {meta && (
                  <span className="ml-2 text-xs text-muted-foreground/70">
                    · {meta.total} total records
                  </span>
                )}
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap justify-end">
              {syncMsg && (
                <span className="text-xs text-muted-foreground">{syncMsg}</span>
              )}

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadMutation.mutate(file);
                  e.target.value = "";
                }}
              />

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadMutation.isPending}
                  >
                    <Upload className={`h-4 w-4 mr-2 ${uploadMutation.isPending ? "animate-pulse" : ""}`} />
                    {uploadMutation.isPending ? "Importing…" : "Upload XLSX"}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-xs">
                  Download the XLSX export from the EPBC portal, then upload it here to import all records.
                </TooltipContent>
              </Tooltip>

              <div className="flex items-center gap-1">
                <input
                  type="date"
                  value={syncStartDate}
                  onChange={(e) => setSyncStartDate(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  title="Announced After (optional)"
                  placeholder="From"
                />
                <span className="text-xs text-muted-foreground">–</span>
                <input
                  type="date"
                  value={syncEndDate}
                  onChange={(e) => setSyncEndDate(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  title="Announced Before (optional)"
                  placeholder="To"
                />
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => syncMutation.mutate()}
                    disabled={syncMutation.isPending}
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                    {syncMutation.isPending ? "Trying…" : "Try Live Sync"}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-xs">
                  Searches the EPBC portal via ChatGPT web search. Set a date range to focus results — leave blank to sweep all years. Upload XLSX is more reliable for bulk historical imports.
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search name, number, proponent…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 w-64"
              />
            </div>

            <Select value={state} onValueChange={setState}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="State" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All States</SelectItem>
                {AU_STATES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={technology} onValueChange={setTechnology}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Technology" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Technologies</SelectItem>
                {techTypes.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={relevanceStatus} onValueChange={setRelevanceStatus}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Relevance" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Relevance</SelectItem>
                {Object.entries(RELEVANCE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={approvalStatus} onValueChange={setApprovalStatus}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Approval" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Approvals</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="not_approved">Not Approved</SelectItem>
              </SelectContent>
            </Select>

            <span className="text-sm text-muted-foreground ml-1">
              {isLoading ? "Loading…" : `${projects.length} result${projects.length !== 1 ? "s" : ""}`}
            </span>
          </div>

          {/* Table */}
          <div className="border rounded-lg bg-card overflow-hidden shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="w-28">EPBC #</TableHead>
                  <TableHead>Project Name</TableHead>
                  <TableHead>Proponent</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Technology</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Relevance</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 9 }).map((_, j) => (
                        <TableCell key={j}>
                          <div className="h-4 bg-muted animate-pulse rounded" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : projects.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-48 text-center text-muted-foreground">
                      <p className="text-sm">No EPBC projects found.</p>
                      <p className="text-xs mt-1">Try adjusting filters or click "Refresh EPBC Data".</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  projects.map((project) => (
                    <TableRow key={project.id} className="hover:bg-muted/30 transition-colors">
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground">{project.epbcNumber}</span>
                      </TableCell>

                      <TableCell className="max-w-xs">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="truncate font-medium text-sm cursor-default">
                              {project.projectName}
                            </div>
                          </TooltipTrigger>
                          {project.rawDescription && (
                            <TooltipContent side="bottom" className="max-w-sm text-xs">
                              {project.rawDescription.slice(0, 300)}
                              {project.rawDescription.length > 300 ? "…" : ""}
                            </TooltipContent>
                          )}
                        </Tooltip>
                        {project.referralDate && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            Referred {project.referralDate.slice(0, 10)}
                          </div>
                        )}
                      </TableCell>

                      <TableCell className="text-sm text-muted-foreground max-w-[140px] truncate">
                        {project.proponent ?? "-"}
                      </TableCell>

                      <TableCell>
                        {project.state ? (
                          <Badge variant="outline" className="text-[10px] font-mono">
                            {project.state}
                          </Badge>
                        ) : "-"}
                      </TableCell>

                      <TableCell className="text-sm">
                        {project.technologyType ?? "-"}
                      </TableCell>

                      <TableCell className="font-mono text-sm">
                        {project.sizeMw != null ? `${project.sizeMw} MW` : "-"}
                      </TableCell>

                      <TableCell>
                        <div className="text-xs text-muted-foreground">
                          {project.projectStatus ?? "-"}
                        </div>
                        {project.isApproved && (
                          <Badge
                            variant="outline"
                            className="text-[10px] mt-0.5 border-green-200 bg-green-50 text-green-700"
                          >
                            Approved
                          </Badge>
                        )}
                      </TableCell>

                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] font-semibold ${
                            RELEVANCE_COLORS[project.relevanceStatus] ?? RELEVANCE_COLORS.pending
                          }`}
                        >
                          {RELEVANCE_LABELS[project.relevanceStatus] ?? project.relevanceStatus}
                        </Badge>
                      </TableCell>

                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {project.sourceUrl && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <a
                                  href={project.sourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              </TooltipTrigger>
                              <TooltipContent>View on EPBC Portal</TooltipContent>
                            </Tooltip>
                          )}

                          {project.relevanceStatus !== "solar" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={() =>
                                    patchMutation.mutate({
                                      id: project.id,
                                      patch: { relevanceStatus: "solar", isSolar: true },
                                    })
                                  }
                                  className="p-1 rounded hover:bg-amber-50 transition-colors text-muted-foreground hover:text-amber-600"
                                >
                                  <Sun className="h-3.5 w-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>Mark as Solar</TooltipContent>
                            </Tooltip>
                          )}

                          {project.relevanceStatus !== "not_relevant" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={() =>
                                    patchMutation.mutate({
                                      id: project.id,
                                      patch: { relevanceStatus: "not_relevant" },
                                    })
                                  }
                                  className="p-1 rounded hover:bg-red-50 transition-colors text-muted-foreground hover:text-red-600"
                                >
                                  <XCircle className="h-3.5 w-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>Mark as Not Relevant</TooltipContent>
                            </Tooltip>
                          )}

                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => importMutation.mutate(project.id)}
                                disabled={importMutation.isPending}
                                className="p-1 rounded hover:bg-blue-50 transition-colors text-muted-foreground hover:text-blue-600 disabled:opacity-40"
                              >
                                <Download className="h-3.5 w-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Import into Projects</TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </TooltipProvider>
    </Layout>
  );
}
