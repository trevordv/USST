import { useState, useEffect } from "react";
import { useListScans, getListScansQueryKey, useTriggerScan, ScanInput } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Play, Loader2, CheckCircle2, XCircle, AlertCircle, ExternalLink } from "lucide-react";
import { useLocation } from "wouter";
import { format } from "date-fns";

export default function Scans() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const { data: scans, isLoading } = useListScans({
    query: {
      queryKey: getListScansQueryKey(),
      refetchInterval: (query) => {
        // Poll every 3 seconds if any scan is running
        const hasRunning = query.state.data?.some(s => s.status === 'running');
        return hasRunning ? 3000 : false;
      }
    }
  });

  const triggerScan = useTriggerScan();

  const handleTrigger = () => {
    const data: ScanInput = {};
    if (startDate) data.startDate = startDate;
    if (endDate) data.endDate = endDate;

    triggerScan.mutate({ data }, {
      onSuccess: () => {
        toast({
          title: "Scan Started",
          description: "The intelligence engine is now scanning for new projects.",
        });
        queryClient.invalidateQueries({ queryKey: getListScansQueryKey() });
        setStartDate("");
        setEndDate("");
      },
      onError: (err) => {
        toast({
          variant: "destructive",
          title: "Scan Failed to Start",
          description: err instanceof Error ? err.message : "Unknown error occurred",
        });
      }
    });
  };

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Intelligence Scans</h1>
          <p className="text-muted-foreground mt-1">Monitor and trigger automated data collection runs.</p>
        </div>

        <Card className="border-primary/20">
          <CardHeader className="bg-muted/30">
            <CardTitle>Trigger New Scan</CardTitle>
            <CardDescription>Manually start a data extraction job across all sources.</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row items-end gap-4">
              <div className="space-y-2 flex-1 max-w-xs">
                <Label htmlFor="scan-start">Announced After (Optional)</Label>
                <Input 
                  id="scan-start" 
                  type="date" 
                  value={startDate} 
                  onChange={e => setStartDate(e.target.value)} 
                />
              </div>
              <div className="space-y-2 flex-1 max-w-xs">
                <Label htmlFor="scan-end">Announced Before (Optional)</Label>
                <Input 
                  id="scan-end" 
                  type="date" 
                  value={endDate} 
                  onChange={e => setEndDate(e.target.value)} 
                />
              </div>
              <Button 
                onClick={handleTrigger} 
                disabled={triggerScan.isPending}
                className="w-full sm:w-auto font-bold tracking-wide uppercase gap-2"
              >
                {triggerScan.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {triggerScan.isPending ? "Starting..." : "Run Scan"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Scan History</CardTitle>
          </CardHeader>
          <div className="border-t">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="text-right">Sources Scanned</TableHead>
                  <TableHead className="text-right">Total Found</TableHead>
                  <TableHead className="text-right text-primary font-medium">New Projects</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center">Loading scan history...</TableCell>
                  </TableRow>
                ) : scans && scans.length > 0 ? (
                  scans.map((scan) => (
                    <TableRow key={scan.id}>
                      <TableCell className="font-mono text-xs font-medium text-muted-foreground">
                        RUN-{scan.id.toString().padStart(4, '0')}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {scan.status === 'running' && <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />}
                          {scan.status === 'completed' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                          {scan.status === 'failed' && <XCircle className="h-4 w-4 text-destructive" />}
                          <Badge variant="outline" className={`uppercase text-[10px] tracking-wider ${
                            scan.status === 'running' ? 'border-blue-200 text-blue-700 bg-blue-50' :
                            scan.status === 'completed' ? 'border-green-200 text-green-700 bg-green-50' :
                            'border-red-200 text-red-700 bg-red-50'
                          }`}>
                            {scan.status}
                          </Badge>
                        </div>
                        {scan.errorMessage && (
                          <div className="text-xs text-destructive mt-1 max-w-xs truncate" title={scan.errorMessage}>
                            {scan.errorMessage}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {format(new Date(scan.startedAt), 'MMM d, HH:mm:ss')}
                      </TableCell>
                      <TableCell className="text-right font-mono">{scan.sourcesScanned}</TableCell>
                      <TableCell className="text-right font-mono">{scan.projectsFound}</TableCell>
                      <TableCell className="text-right font-mono font-bold text-primary">
                        {scan.newProjects !== undefined ? `+${scan.newProjects}` : '-'}
                      </TableCell>
                      <TableCell>
                        {scan.status === 'completed' && (scan.newProjects ?? 0) > 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 text-xs"
                            onClick={() => navigate(`/projects?scanId=${scan.id}`)}
                          >
                            <ExternalLink className="h-3 w-3" />
                            View {scan.newProjects} new
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="h-48 text-center text-muted-foreground">
                      <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      No scans have been run yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    </Layout>
  );
}
