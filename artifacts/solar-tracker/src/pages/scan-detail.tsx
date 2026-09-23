import { useParams, Link } from "wouter";
import {
  useGetScan, getGetScanQueryKey, useGetScanProjects, getGetScanProjectsQueryKey,
  useGetScanSources, getGetScanSourcesQueryKey,
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { useState } from "react";

type ScanResultFilter = "all" | "new" | "updated" | "inventory_observed";

export default function ScanDetail() {
  const [resultFilter, setResultFilter] = useState<ScanResultFilter>("all");
  const params = useParams();
  const scanId = parseInt(params.id || "0", 10);

  const { data: scan, isLoading: scanLoading } = useGetScan(scanId, {
    query: { enabled: !!scanId, queryKey: getGetScanQueryKey(scanId) },
  });

  const { data: projects, isLoading: projectsLoading } = useGetScanProjects(scanId, {
    query: { enabled: !!scanId, queryKey: getGetScanProjectsQueryKey(scanId) },
  });

  const { data: sourceHealth, isLoading: sourceHealthLoading } = useGetScanSources(scanId, {
    query: { enabled: !!scanId, queryKey: getGetScanSourcesQueryKey(scanId) },
  });

  const isLoading = scanLoading || projectsLoading || sourceHealthLoading;

  if (isLoading) {
    return (
      <Layout>
        <div className="max-w-6xl mx-auto space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="h-96" />
        </div>
      </Layout>
    );
  }

  if (!scan) {
    return (
      <Layout>
        <div className="max-w-6xl mx-auto py-20 text-center">
          <h2 className="text-2xl font-bold text-destructive">Scan not found</h2>
          <Button asChild variant="outline" className="mt-4">
            <Link href="/scans">Back to Scan History</Link>
          </Button>
        </div>
      </Layout>
    );
  }

  const newCount = projects?.filter((p) => p.isNew).length ?? 0;
  const updatedCount = projects?.filter((p) => p.eventType === "updated").length ?? 0;
  const observedCount = projects?.filter((p) => p.eventType === "inventory_observed").length ?? 0;
  const successfulSources = sourceHealth?.filter((item) =>
    item.outcome === "success-with-results" || item.outcome === "success-zero-results"
  ).length ?? 0;
  const healthCategory = (item: NonNullable<typeof sourceHealth>[number]) => {
    if (item.outcome === "success-zero-results") return "Valid zero";
    if (item.outcome === "success-with-results") {
      if (item.acquisitionMethod === "firecrawl") return "Healthy Firecrawl";
      if (item.acquisitionMethod === "apify") return "Healthy Apify";
      if (item.acquisitionMethod === "brightdata") return "Healthy Bright Data";
      return "Healthy direct";
    }
    if (item.outcome === "blocked") return "Blocked";
    if (item.outcome === "timeout" || item.outcome === "rate-limited") return "Degraded";
    return "Failed";
  };

  const visibleProjects = projects?.filter((project) => resultFilter === "all" || project.eventType === resultFilter) ?? [];
  // Sort: new projects, dated updates, then inventory observations.
  const eventOrder = { new: 0, updated: 1, inventory_observed: 2 } as const;
  const sortedProjects = projects
    ? [...visibleProjects].sort((a, b) => eventOrder[a.eventType] - eventOrder[b.eventType])
    : [];

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-4 -ml-3 text-muted-foreground">
            <Link href="/scans">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Scan History
            </Link>
          </Button>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <Badge variant="outline" className="font-mono text-xs">
                  RUN-{scan.id.toString().padStart(4, "0")}
                </Badge>
                <Badge
                  variant="outline"
                  className={`uppercase text-[10px] tracking-wider ${
                    scan.status === "completed"
                      ? "border-green-200 text-green-700 bg-green-50"
                      : scan.status === "running"
                      ? "border-blue-200 text-blue-700 bg-blue-50"
                      : "border-red-200 text-red-700 bg-red-50"
                  }`}
                >
                  {scan.status}
                </Badge>
              </div>
              <h1 className="text-3xl font-bold tracking-tight">Scan Results</h1>
              <p className="text-muted-foreground mt-1">
                Started {format(new Date(scan.startedAt), "MMM d, yyyy HH:mm:ss")}
                {scan.completedAt && (
                  <span>
                    {" "}
                    · Completed {format(new Date(scan.completedAt), "HH:mm:ss")}
                  </span>
                )}
              </p>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-sm text-muted-foreground">Sources scanned</div>
                <div className="text-xl font-mono font-bold">{scan.sourcesScanned}</div>
              </div>
              <div className="text-right">
                <div className="text-sm text-muted-foreground">Encountered</div>
                <div className="text-xl font-mono font-bold">{scan.projectsFound ?? 0}</div>
              </div>
              <div className="text-right">
                <div className="text-sm text-muted-foreground">New</div>
                <div className="text-xl font-mono font-bold text-primary">+{newCount}</div>
              </div>
              <div className="text-right">
                <div className="text-sm text-muted-foreground">Updated</div>
                <div className="text-xl font-mono font-bold text-amber-600">{updatedCount}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Durable source acquisition health */}
        <div className="border rounded-lg bg-card overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b bg-muted/50 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-sm">Source acquisition health</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {sourceHealth?.length ?? 0} sources attempted · {successfulSources} successfully acquired
              </p>
            </div>
          </div>
          {sourceHealth && sourceHealth.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead>Source</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Candidates</TableHead>
                  <TableHead className="text-right">Qualifying</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sourceHealth.map((item) => {
                  const category = healthCategory(item);
                  const healthy = category.startsWith("Healthy") || category === "Valid zero";
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.sourceName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={healthy
                          ? "border-green-200 text-green-700 bg-green-50"
                          : category === "Degraded" ? "border-amber-200 text-amber-700 bg-amber-50"
                          : "border-red-200 text-red-700 bg-red-50"}>
                          {category}
                        </Badge>
                        {item.failureReason && <div className="text-xs text-muted-foreground mt-1">{item.failureReason}</div>}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        <div>{item.acquisitionMethod}</div>
                        {item.openaiNormalisationAttempted && (
                          <div className="mt-1 font-sans text-muted-foreground">
                            OpenAI normalisation {item.openaiNormalisationSucceeded ? "completed" : "failed"}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">{item.candidateCount}</TableCell>
                      <TableCell className="text-right font-mono">{item.qualifyingProjectCount}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{(item.durationMs / 1000).toFixed(1)}s</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              Source health is unavailable for scans created before Issue #41.
            </div>
          )}
        </div>

        {/* Projects table */}
        <div className="border rounded-lg bg-card overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b bg-muted/50 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold text-sm">
              Qualifying scan results ({projects?.length ?? 0})
              {newCount > 0 && (
                <span className="ml-2 text-xs font-normal text-emerald-600">
                  · {newCount} new
                </span>
              )}
            </h2>
            <div className="flex flex-wrap gap-2" aria-label="Scan result categories">
              {([
                ["all", "All", projects?.length ?? 0],
                ["new", "New", newCount],
                ["updated", "Updated", updatedCount],
                ["inventory_observed", "Inventory Observed", observedCount],
              ] as const).map(([value, label, count]) => (
                <Button
                  key={value}
                  size="sm"
                  variant={resultFilter === value ? "default" : "outline"}
                  onClick={() => setResultFilter(value)}
                >
                  {label}: {count}
                </Button>
              ))}
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>Project</TableHead>
                <TableHead>Capacity</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Announced</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedProjects.length > 0 ? (
                sortedProjects.map((project) => {
                  const projectHref = `/projects/${project.id}?fromScan=${scanId}`;
                  return (
                  <TableRow
                    key={project.id}
                    className={`group cursor-pointer transition-colors ${
                      project.isNew
                        ? "bg-emerald-50/60 hover:bg-emerald-50 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/30"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <TableCell>
                      <Link href={projectHref} className="block">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{project.name}</span>
                          {project.isNew && (
                            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px] font-bold tracking-wider uppercase px-1.5 py-0">
                              New
                            </Badge>
                          )}
                          {project.eventType === "updated" && (
                            <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px] font-bold tracking-wider uppercase px-1.5 py-0">
                              Updated
                            </Badge>
                          )}
                          {project.eventType === "inventory_observed" && (
                            <Badge variant="outline" className="text-[10px] font-bold tracking-wider uppercase px-1.5 py-0">
                              Observed
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {project.developer || "Unknown Developer"}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={projectHref} className="block">
                        <div className="font-mono text-sm">
                          {project.capacityMw ? `${project.capacityMw} MW` : "-"}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={projectHref} className="block">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={
                              project.country === "AU"
                                ? "border-blue-200 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                                : "border-teal-200 bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300"
                            }
                          >
                            {project.country}
                          </Badge>
                          <span className="text-sm truncate max-w-[150px]">
                            {project.location || "-"}
                          </span>
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={projectHref} className="block">
                        <Badge
                          variant={project.status === "announced" ? "secondary" : "default"}
                          className="uppercase text-[10px] font-bold tracking-wider"
                        >
                          {project.status.replace("_", " ")}
                        </Badge>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={projectHref} className="block text-sm text-muted-foreground">
                        {project.effectiveDate
                          ? format(new Date(project.effectiveDate), "MMM d, yyyy")
                          : project.announcedDate
                          ? format(new Date(project.announcedDate), "MMM d, yyyy")
                          : "-"}
                      </Link>
                    </TableCell>
                  </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-48 text-center text-muted-foreground">
                    <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No projects found in this scan.</p>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </Layout>
  );
}
