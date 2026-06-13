import { useParams, Link } from "wouter";
import { useGetScan, getGetScanQueryKey, useGetScanProjects, getGetScanProjectsQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { ArrowLeft, Sparkles, CheckCircle2 } from "lucide-react";

export default function ScanDetail() {
  const params = useParams();
  const scanId = parseInt(params.id || "0", 10);

  const { data: scan, isLoading: scanLoading } = useGetScan(scanId, {
    query: { enabled: !!scanId, queryKey: getGetScanQueryKey(scanId) },
  });

  const { data: projects, isLoading: projectsLoading } = useGetScanProjects(scanId, {
    query: { enabled: !!scanId, queryKey: getGetScanProjectsQueryKey(scanId) },
  });

  const isLoading = scanLoading || projectsLoading;

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
                <div className="text-sm text-muted-foreground">Total found</div>
                <div className="text-xl font-mono font-bold">{scan.projectsFound}</div>
              </div>
              <div className="text-right">
                <div className="text-sm text-muted-foreground">New</div>
                <div className="text-xl font-mono font-bold text-primary">+{scan.newProjects}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Projects table */}
        <div className="border rounded-lg bg-card overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b bg-muted/50 flex items-center justify-between">
            <h2 className="font-semibold text-sm">
              All projects discovered ({projects?.length ?? 0})
            </h2>
            {newCount > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                <span>{newCount} new project{newCount !== 1 ? "s" : ""} highlighted</span>
              </div>
            )}
          </div>

          {/* Historical scan notice */}
          {projects && projects.length === 0 && (scan.projectsFound ?? 0) > 0 && (
            <div className="px-4 py-6 bg-amber-50/60 border-b border-amber-200 text-sm text-amber-800">
              <p className="font-semibold">
                This scan ran before full project tracking was enabled.
              </p>
              <p className="text-xs text-amber-700 mt-1.5 leading-relaxed">
                Only scans run after this update will show the complete list of all projects found.
                {(scan.newProjects ?? 0) > 0 && (
                  <span>
                    You can still view the{" "}
                    <Link href={`/projects?scanId=${scan.id}`} className="underline font-medium">
                      {scan.newProjects} new project{(scan.newProjects ?? 0) !== 1 ? "s" : ""}
                    </Link>{" "}
                    discovered by this scan.
                  </span>
                )}
              </p>
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="w-12"></TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Capacity</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Announced</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects && projects.length > 0 ? (
                projects.map((project) => (
                  <TableRow
                    key={project.id}
                    className={`group cursor-pointer transition-colors ${
                      project.isNew
                        ? "bg-green-50/60 hover:bg-green-100/70 dark:bg-green-950/20 dark:hover:bg-green-900/30"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <TableCell className="text-center">
                      {project.isNew && (
                        <Badge
                          variant="outline"
                          className="border-green-300 bg-green-100 text-green-700 text-[10px] uppercase tracking-wider"
                        >
                          <Sparkles className="h-3 w-3 mr-0.5" />
                          New
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link href={`/projects/${project.id}`} className="block">
                        <div className="font-medium text-foreground">{project.name}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {project.developer || "Unknown Developer"}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/projects/${project.id}`} className="block">
                        <div className="font-mono text-sm">
                          {project.capacityMw ? `${project.capacityMw} MW` : "-"}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/projects/${project.id}`} className="block">
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
                      <Link href={`/projects/${project.id}`} className="block">
                        <Badge
                          variant={project.status === "announced" ? "secondary" : "default"}
                          className="uppercase text-[10px] font-bold tracking-wider"
                        >
                          {project.status.replace("_", " ")}
                        </Badge>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/projects/${project.id}`} className="block text-sm text-muted-foreground">
                        {project.announcedDate
                          ? format(new Date(project.announcedDate), "MMM d, yyyy")
                          : "-"}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="h-48 text-center text-muted-foreground">
                    <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No projects found for this scan.</p>
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
