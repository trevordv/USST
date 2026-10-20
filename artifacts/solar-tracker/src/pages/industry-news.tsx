import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/layout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth-context";
import { useSearch, useLocation } from "wouter";
import { ExternalLink, Newspaper, Search, X } from "lucide-react";

interface IndustryNewsItem {
  id: number;
  scanId: number;
  title: string;
  summary: string | null;
  sourceName: string;
  sourceUrl: string;
  author: string | null;
  country: "AU" | "NZ";
  contentType: "news" | "linkedin" | "journalist" | "industry";
  publishedDate: string;
  discoveredAt: string;
}

const TYPE_LABELS: Record<IndustryNewsItem["contentType"], string> = {
  news: "News",
  linkedin: "LinkedIn",
  journalist: "Journalist",
  industry: "Industry",
};

export default function IndustryNews() {
  const { token } = useAuth();
  const searchString = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(searchString);
  const scanId = params.get("scanId");

  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("ALL");
  const [contentType, setContentType] = useState("ALL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [items, setItems] = useState<IndustryNewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const query = new URLSearchParams();
      if (scanId) query.set("scanId", scanId);
      if (search.trim()) query.set("search", search.trim());
      if (country !== "ALL") query.set("country", country);
      if (contentType !== "ALL") query.set("contentType", contentType);
      if (startDate) query.set("startDate", startDate);
      if (endDate) query.set("endDate", endDate);

      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/industry-news?" + query.toString(), {
          headers: { Authorization: "Bearer " + token },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Unable to load industry news");
        setItems(await response.json() as IndustryNewsItem[]);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setError(err instanceof Error ? err.message : "Unable to load industry news");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [token, scanId, search, country, contentType, startDate, endDate]);

  const uniqueItems = useMemo(() => {
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.sourceUrl)) return false;
      seen.add(item.sourceUrl);
      return true;
    });
  }, [items]);

  return (
    <Layout>
      <div className="flex flex-col gap-6">
        {scanId && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/10 border border-primary/20 rounded-lg text-sm">
            <span className="font-medium text-primary">
              Showing market intelligence from RUN-{scanId.padStart(4, "0")}
            </span>
            <Button variant="ghost" size="sm" className="h-6 px-2 gap-1" onClick={() => navigate("/industry-news")}>
              <X className="h-3 w-3" /> Clear scan filter
            </Button>
          </div>
        )}

        <div>
          <h1 className="text-3xl font-bold tracking-tight">Industry News</h1>
          <p className="text-muted-foreground mt-1">
            Latest Australia and New Zealand utility-scale solar market intelligence from news, industry publications, journalists and public LinkedIn posts.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-4 p-4 bg-card border rounded-lg shadow-sm">
          <div className="flex-1 min-w-[240px] space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Search</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Topic, source, journalist..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="w-36 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Country</label>
            <Select value={country} onValueChange={setCountry}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="AU">Australia</SelectItem>
                <SelectItem value="NZ">New Zealand</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-40 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Source type</label>
            <Select value={contentType} onValueChange={setContentType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="news">News</SelectItem>
                <SelectItem value="linkedin">LinkedIn</SelectItem>
                <SelectItem value="journalist">Journalist</SelectItem>
                <SelectItem value="industry">Industry</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-40 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Published from</label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="w-40 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Published to</label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {loading ? "Loading..." : uniqueItems.length + " items"}
          </p>
        </div>

        {error ? (
          <Card><CardContent className="py-10 text-center text-destructive">{error}</CardContent></Card>
        ) : !loading && uniqueItems.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Newspaper className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
              <p className="font-medium">No market intelligence found for these filters.</p>
              <p className="text-sm text-muted-foreground mt-1">Run a new scan to search the selected date range.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {uniqueItems.map((item) => (
              <Card key={item.id}>
                <CardContent className="p-5">
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-2 mb-2">
                        <Badge variant="secondary">{item.country === "AU" ? "Australia" : "New Zealand"}</Badge>
                        <Badge variant="outline">{TYPE_LABELS[item.contentType]}</Badge>
                        <span className="text-xs text-muted-foreground self-center">{item.publishedDate}</span>
                      </div>
                      <h2 className="text-lg font-semibold leading-snug">{item.title}</h2>
                      {item.summary && <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{item.summary}</p>}
                      <p className="text-xs text-muted-foreground mt-3">
                        {item.sourceName}{item.author ? " · " + item.author : ""}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" asChild className="shrink-0 gap-2">
                      <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                        Open source <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
