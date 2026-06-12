import { useState } from "react";
import { useListProjects, getListProjectsQueryKey, useExportProjects } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "wouter";
import { Download, Search, SearchX, Mail, Phone, User, ContactRound } from "lucide-react";
import { format } from "date-fns";

export default function Projects() {
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState<"ALL" | "AU" | "NZ">("ALL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [contactOnly, setContactOnly] = useState(false);

  const { data: allProjects, isLoading } = useListProjects(
    { 
      search: search || undefined,
      country: country !== "ALL" ? country : undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined
    },
    { 
      query: { 
        queryKey: getListProjectsQueryKey({
          search: search || undefined,
          country: country !== "ALL" ? country : undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined
        }) 
      } 
    }
  );

  const projects = contactOnly
    ? (allProjects ?? []).filter(p => p.contactEmail || p.contactName || p.contactPhone)
    : allProjects;

  const handleExport = async () => {
    try {
      // Create export directly or via hook
      // Since useExportProjects is a query hook, we probably should fetch it imperatively
      // But standard approach for downloads is just opening the url or fetching blob
      const url = `/api/projects/export?${new URLSearchParams({
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
        ...(country !== "ALL" && { country })
      }).toString()}`;
      
      window.location.href = url;
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <Layout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Projects Directory</h1>
            <p className="text-muted-foreground mt-1">Browse and filter all identified solar projects.</p>
          </div>
          <Button onClick={handleExport} variant="outline" className="gap-2">
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-4 p-4 bg-card border rounded-lg shadow-sm">
          <div className="flex-1 min-w-[200px] space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Search</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Developer, EPC, or Project Name..." 
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          
          <div className="w-32 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Country</label>
            <Select value={country} onValueChange={(val: any) => setCountry(val)}>
              <SelectTrigger>
                <SelectValue placeholder="All Countries" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="AU">Australia</SelectItem>
                <SelectItem value="NZ">New Zealand</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="w-40 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Announced After</label>
            <Input 
              type="date" 
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className="w-40 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Announced Before</label>
            <Input 
              type="date" 
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Contacts</label>
            <Button
              variant={contactOnly ? "default" : "outline"}
              size="sm"
              className="flex items-center gap-2 h-10"
              onClick={() => setContactOnly(v => !v)}
            >
              <ContactRound className="h-4 w-4" />
              {contactOnly ? "Has Contact ✓" : "Has Contact"}
            </Button>
          </div>
        </div>

        <div className="border rounded-lg bg-card overflow-hidden shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>Project</TableHead>
                <TableHead>Capacity</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Announced</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">Loading projects...</TableCell>
                </TableRow>
              ) : projects && projects.length > 0 ? (
                projects.map((p) => (
                  <TableRow key={p.id} className="group cursor-pointer hover:bg-muted/50 transition-colors">
                    <TableCell>
                      <Link href={`/projects/${p.id}`} className="block">
                        <div className="font-medium text-foreground">{p.name}</div>
                        <div className="text-xs text-muted-foreground mt-1 truncate max-w-[250px]">
                          {p.developer || p.epc || 'Unknown Developer'}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/projects/${p.id}`} className="block">
                        <div className="font-mono text-sm">
                          {p.capacityMw ? `${p.capacityMw} MW` : '-'}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/projects/${p.id}`} className="block">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={p.country === 'AU' ? 'border-blue-200 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'border-teal-200 bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300'}>
                            {p.country}
                          </Badge>
                          <span className="text-sm truncate max-w-[150px]">{p.location || '-'}</span>
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/projects/${p.id}`} className="block">
                        <TooltipProvider>
                          {p.contactEmail || p.contactName || p.contactPhone ? (
                            <div className="flex flex-col gap-0.5">
                              {p.contactName && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="flex items-center gap-1.5 text-xs text-foreground">
                                      <User className="h-3 w-3 text-muted-foreground shrink-0" />
                                      <span className="truncate max-w-[140px] font-medium">{p.contactName}</span>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>{p.contactName}</TooltipContent>
                                </Tooltip>
                              )}
                              {p.contactEmail && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="flex items-center gap-1.5 text-xs text-primary">
                                      <Mail className="h-3 w-3 shrink-0" />
                                      <span className="truncate max-w-[140px]">{p.contactEmail}</span>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>{p.contactEmail}</TooltipContent>
                                </Tooltip>
                              )}
                              {p.contactPhone && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                      <Phone className="h-3 w-3 shrink-0" />
                                      <span className="font-mono">{p.contactPhone}</span>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>{p.contactPhone}</TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground/50 italic">No contact</span>
                          )}
                        </TooltipProvider>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/projects/${p.id}`} className="block">
                        <Badge variant={p.status === 'announced' ? 'secondary' : 'default'} className="uppercase text-[10px] font-bold tracking-wider">
                          {p.status.replace('_', ' ')}
                        </Badge>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/projects/${p.id}`} className="block text-sm text-muted-foreground">
                        {p.announcedDate ? format(new Date(p.announcedDate), 'MMM d, yyyy') : '-'}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="h-48 text-center">
                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                      <SearchX className="h-8 w-8 mb-2" />
                      <p>No projects found matching these filters.</p>
                      <Button asChild variant="link" className="mt-2">
                        <Link href="/scans">Run a new scan?</Link>
                      </Button>
                    </div>
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
