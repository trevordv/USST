import { customFetch, useGetProject, getGetProjectQueryKey } from "@workspace/api-client-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "@/hooks/use-toast";
import { Layout } from "@/components/layout";
import { useParams, Link, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { ArrowLeft, ExternalLink, Mail, Phone, User, MapPin, Zap, Building2, Calendar, CheckCircle2, Copy, ThumbsDown, X } from "lucide-react";

export default function ProjectDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  const search = useSearch();
  const params2 = new URLSearchParams(search);
  const fromScan = params2.get("fromScan");
  const scanId = params2.get("scanId");
  const backHref = fromScan
    ? `/scans/${fromScan}`
    : scanId
    ? `/projects?scanId=${scanId}`
    : "/projects";
  const backLabel = fromScan
    ? `Back to Scan RUN-${fromScan.padStart(4, "0")}`
    : scanId
    ? `Back to Scan RUN-${scanId.padStart(4, "0")} Results`
    : "Back to Projects";
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateSearch, setDuplicateSearch] = useState("");
  const [duplicateReason, setDuplicateReason] = useState("Same project reported under a different name or source.");
  const [canonicalProject, setCanonicalProject] = useState<{ id: number; name: string; developer?: string | null; location?: string | null } | null>(null);

  const { data: project, isLoading, isError } = useGetProject(id, {
    query: {
      enabled: !!id,
      queryKey: getGetProjectQueryKey(id)
    }
  });

  const feedback = useMutation({
    mutationFn: (body: Record<string, unknown>) => customFetch("/api/learning/feedback", {
      method: "POST",
      responseType: "json",
      body: JSON.stringify({ entityType: "project", entityId: id, ...body }),
    }),
    onSuccess: () => { setDuplicateOpen(false); setCanonicalProject(null); toast({ title: "Feedback recorded", description: "It will inform future runs after review where required." }); },
    onError: () => toast({ title: "Feedback was not recorded", variant: "destructive" }),
  });
  const canonicalResults = useQuery({
    queryKey: ["canonical-project-search", duplicateSearch],
    queryFn: () => customFetch<Array<{ id: number; name: string; developer?: string | null; location?: string | null }>>(`/api/projects?search=${encodeURIComponent(duplicateSearch)}`, { responseType: "json" }),
    enabled: duplicateOpen && duplicateSearch.trim().length >= 2,
  });

  if (isLoading) {
    return (
      <Layout>
        <div className="space-y-6">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-12 w-2/3" />
          <div className="grid gap-6 md:grid-cols-3">
            <Skeleton className="h-64 col-span-2" />
            <Skeleton className="h-64 col-span-1" />
          </div>
        </div>
      </Layout>
    );
  }

  if (isError || !project) {
    return (
      <Layout>
        <div className="text-center py-20">
          <h2 className="text-2xl font-bold text-destructive">Project not found</h2>
          <Button asChild variant="outline" className="mt-4">
            <Link href="/projects">Return to Directory</Link>
          </Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-4 -ml-3 text-muted-foreground">
            <Link href={backHref}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              {backLabel}
            </Link>
          </Button>
          
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <Badge variant={project.status === 'announced' ? 'secondary' : 'default'} className="uppercase text-[10px] font-bold tracking-wider">
                  {project.status.replace('_', ' ')}
                </Badge>
                <Badge variant="outline" className={project.country === 'AU' ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-teal-200 bg-teal-50 text-teal-700'}>
                  {project.country}
                </Badge>
              </div>
              <h1 className="text-4xl font-bold tracking-tight text-foreground">{project.name}</h1>
            </div>
            
            {project.sourceUrl && (
              <Button asChild variant="outline" className="shrink-0 gap-2">
                <a href={project.sourceUrl} target="_blank" rel="noopener noreferrer">
                  View Source <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Improve future results</CardTitle>
                <CardDescription>Optional feedback becomes evidence. It never changes USST's hard eligibility rules.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => feedback.mutate({ actionType: "confirm_project", feedbackType: "confirm", correctedValue: { projectId: id } })}><CheckCircle2 className="mr-2 h-4 w-4" />Confirm</Button>
                <Button variant="outline" size="sm" onClick={() => setDuplicateOpen(true)}><Copy className="mr-2 h-4 w-4" />Mark duplicate</Button>
                <Button variant="outline" size="sm" onClick={() => feedback.mutate({ actionType: "reject_false_positive", feedbackType: "false_positive", originalValue: { name: project.name, sourceName: project.sourceName, sourceUrl: project.sourceUrl, developer: project.developer, location: project.location }, correctedValue: { rejected: true }, reason: "User rejected this project as a false positive." })}><ThumbsDown className="mr-2 h-4 w-4" />Reject false positive</Button>
                {project.contactEmail && <Button variant="outline" size="sm" onClick={() => feedback.mutate({ actionType: "confirm_contact", entityType: "contact", feedbackType: "confirm_contact", correctedValue: { email: project.contactEmail, name: project.contactName } })}><Mail className="mr-2 h-4 w-4" />Confirm contact</Button>}
                {project.contactEmail && <Button variant="outline" size="sm" onClick={() => feedback.mutate({ actionType: "reject_contact", entityType: "contact", feedbackType: "reject_contact", originalValue: { email: project.contactEmail, name: project.contactName }, correctedValue: { rejected: true } })}><X className="mr-2 h-4 w-4" />Reject contact</Button>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Project Details</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-8">
                <div>
                  <div className="flex items-center text-sm font-medium text-muted-foreground mb-1">
                    <Zap className="mr-2 h-4 w-4" /> Capacity
                  </div>
                  <div className="text-lg font-mono font-medium">
                    {project.capacityMw ? `${project.capacityMw} MW` : 'Unknown'}
                  </div>
                </div>
                
                <div>
                  <div className="flex items-center text-sm font-medium text-muted-foreground mb-1">
                    <Building2 className="mr-2 h-4 w-4" /> Developer
                  </div>
                  <div className="text-lg font-medium">
                    {project.developer || 'Not Disclosed'}
                  </div>
                </div>

                <div>
                  <div className="flex items-center text-sm font-medium text-muted-foreground mb-1">
                    <MapPin className="mr-2 h-4 w-4" /> Location
                  </div>
                  <div className="text-lg">
                    {project.location || 'Unknown'}
                  </div>
                </div>

                <div>
                  <div className="flex items-center text-sm font-medium text-muted-foreground mb-1">
                    <Calendar className="mr-2 h-4 w-4" /> Announced Date
                  </div>
                  <div className="text-lg">
                    {project.announcedDate ? format(new Date(project.announcedDate), 'MMMM d, yyyy') : 'Unknown'}
                  </div>
                </div>

                {project.epc && (
                  <div className="sm:col-span-2 pt-4 border-t">
                    <div className="text-sm font-medium text-muted-foreground mb-1">EPC Contractor</div>
                    <div className="text-lg font-medium">{project.epc}</div>
                  </div>
                )}
              </CardContent>
            </Card>

            {project.description && (
              <Card>
                <CardHeader>
                  <CardTitle>Description</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {project.description}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-6">
            <Card className="border-primary/20 shadow-sm">
              <CardHeader className="bg-primary/5 pb-4 border-b border-primary/10">
                <CardTitle className="flex items-center gap-2 text-primary-foreground">
                  <Phone className="h-5 w-5 text-primary" />
                  Sales Contact
                </CardTitle>
                <CardDescription>Primary lead for this project</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                {project.contactName || project.contactEmail || project.contactPhone ? (
                  <>
                    {project.contactName && (
                      <div className="flex items-start gap-3">
                        <User className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium">{project.contactName}</p>
                          <p className="text-xs text-muted-foreground">Decision Maker</p>
                        </div>
                      </div>
                    )}
                    
                    {project.contactEmail && (
                      <div className="flex items-start gap-3">
                        <Mail className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                        <div>
                          <a href={`mailto:${project.contactEmail}`} className="text-sm font-medium text-primary hover:underline">
                            {project.contactEmail}
                          </a>
                        </div>
                      </div>
                    )}
                    
                    {project.contactPhone && (
                      <div className="flex items-start gap-3">
                        <Phone className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                        <div>
                          <a href={`tel:${project.contactPhone}`} className="text-sm font-mono font-medium hover:text-primary">
                            {project.contactPhone}
                          </a>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-6 text-muted-foreground text-sm">
                    No contact information extracted for this project.
                  </div>
                )}
              </CardContent>
            </Card>

          </div>
        </div>
      </div>
      <Dialog open={duplicateOpen} onOpenChange={setDuplicateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Select the canonical project</DialogTitle>
            <DialogDescription>No projects are merged or deleted. Your relationship becomes evidence and requires administrator approval.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input value={duplicateSearch} onChange={(event) => { setDuplicateSearch(event.target.value); setCanonicalProject(null); }} placeholder="Search project name, developer, or location" />
            <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border p-2">
              {duplicateSearch.trim().length < 2 && <p className="p-2 text-sm text-muted-foreground">Enter at least two characters.</p>}
              {canonicalResults.data?.filter((item) => item.id !== id).map((item) => (
                <button key={item.id} type="button" onClick={() => setCanonicalProject(item)} className={`w-full rounded-md border p-3 text-left text-sm ${canonicalProject?.id === item.id ? "border-primary bg-primary/5" : "hover:bg-muted"}`}>
                  <span className="font-medium">{item.name}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{[item.developer, item.location].filter(Boolean).join(" · ") || `Project #${item.id}`}</span>
                </button>
              ))}
            </div>
            <Input value={duplicateReason} onChange={(event) => setDuplicateReason(event.target.value)} placeholder="Reason for the duplicate relationship" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDuplicateOpen(false)}>Cancel</Button>
            <Button disabled={!canonicalProject || !duplicateReason.trim() || feedback.isPending} onClick={() => canonicalProject && feedback.mutate({ actionType: "mark_duplicate", feedbackType: "duplicate", originalValue: { duplicateProjectId: id }, correctedValue: { duplicateProjectId: id, canonicalProjectId: canonicalProject.id }, reason: duplicateReason.trim() })}>Submit for review</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
