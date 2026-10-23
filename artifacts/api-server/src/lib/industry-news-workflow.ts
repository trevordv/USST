import {
  db,
  industryNewsSourceCoverageTable,
  industryNewsTable,
  scansTable,
} from "@workspace/db";
import { and, desc, eq, lt } from "drizzle-orm";
import { logger } from "./logger";
import {
  INDUSTRY_NEWS_SOURCES,
  REPORTING_TIMEZONE,
  buildSearchPlans,
  candidateFromSearchRow,
  canonicalEventKey,
  chooseCanonical,
  evidenceStatusFor,
  groupEventCandidates,
  isLikelyPriorEvent,
  resolveIndustryNewsWindow,
  type NewsCandidate,
  type ScanWindow,
  type SearchPlan,
} from "./industry-news-policy";

const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search";
const APIFY_GOOGLE_SEARCH_URL =
  "https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?timeout=120&memory=512";

interface PlanOutcome {
  plan: SearchPlan;
  candidates: NewsCandidate[];
  provider: "firecrawl" | "apify";
  status: "success" | "missing-credentials" | "provider-error";
  failureReason: string | null;
}

function readRows(body: unknown): Record<string, unknown>[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const data = (body as Record<string, unknown>).data;
  if (Array.isArray(data))
    return data.filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === "object" && !Array.isArray(item),
    );
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const record = data as Record<string, unknown>;
  return ["news", "web"]
    .flatMap((key) =>
      Array.isArray(record[key]) ? (record[key] as unknown[]) : [],
    )
    .filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === "object" && !Array.isArray(item),
    );
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(
      /(?:Bearer|token|key|authorization)\s*[=:]\s*\S+/gi,
      "credential=[redacted]",
    )
    .slice(0, 240);
}

async function mapBounded<T, U>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index]);
      }
    }),
  );
  return results;
}

async function firecrawlPlan(
  plan: SearchPlan,
  window: ScanWindow,
): Promise<PlanOutcome> {
  const key = process.env.FIRECRAWL_API_KEY?.trim();
  if (!key)
    return {
      plan,
      candidates: [],
      provider: "firecrawl",
      status: "missing-credentials",
      failureReason: "FIRECRAWL_API_KEY is not configured",
    };
  try {
    const response = await fetch(FIRECRAWL_SEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: plan.query,
        limit: 10,
        sources: [{ type: "news" }, { type: "web" }],
        scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok)
      throw new Error(`Firecrawl search returned HTTP ${response.status}`);
    const candidates = readRows((await response.json()) as unknown)
      .map((row) => candidateFromSearchRow(row, plan, window))
      .filter((item): item is NewsCandidate => item !== null);
    return {
      plan,
      candidates,
      provider: "firecrawl",
      status: "success",
      failureReason: null,
    };
  } catch (error) {
    return {
      plan,
      candidates: [],
      provider: "firecrawl",
      status: "provider-error",
      failureReason: safeError(error),
    };
  }
}

interface ApifyOrganicResult {
  title?: string;
  url?: string;
  description?: string;
  date?: string;
  publishedDate?: string;
  source?: string;
}

async function apifyPlans(
  plans: SearchPlan[],
  window: ScanWindow,
): Promise<PlanOutcome[]> {
  if (!plans.length) return [];
  const token = process.env.APIFY_API_TOKEN?.trim();
  if (!token)
    return plans.map((plan) => ({
      plan,
      candidates: [],
      provider: "apify",
      status: "missing-credentials",
      failureReason: "APIFY_API_TOKEN is not configured",
    }));
  try {
    const response = await fetch(
      `${APIFY_GOOGLE_SEARCH_URL}&token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queries: plans.map((plan) => plan.query).join("\n"),
          resultsPerPage: 10,
          maxPagesPerQuery: 1,
          languageCode: "en",
          mobileResults: false,
        }),
        signal: AbortSignal.timeout(125_000),
      },
    );
    if (!response.ok)
      throw new Error(`Apify Google search returned HTTP ${response.status}`);
    const rows = (await response.json()) as Array<{
      searchQuery?: { term?: string };
      organicResults?: ApifyOrganicResult[];
    }>;
    return plans.map((plan, index) => {
      const row =
        rows.find((candidate) => candidate.searchQuery?.term === plan.query) ??
        rows[index];
      const candidates = (row?.organicResults ?? [])
        .map((item) =>
          candidateFromSearchRow(
            {
              title: item.title,
              url: item.url,
              description: item.description,
              date: item.date ?? item.publishedDate,
              sourceName: item.source,
            },
            plan,
            window,
          ),
        )
        .filter((item): item is NewsCandidate => item !== null);
      return {
        plan,
        candidates,
        provider: "apify" as const,
        status: "success" as const,
        failureReason: null,
      };
    });
  } catch (error) {
    const reason = safeError(error);
    return plans.map((plan) => ({
      plan,
      candidates: [],
      provider: "apify",
      status: "provider-error",
      failureReason: reason,
    }));
  }
}

async function discover(window: ScanWindow): Promise<PlanOutcome[]> {
  const plans = buildSearchPlans(window);
  const direct = await mapBounded(plans, 3, (plan) =>
    firecrawlPlan(plan, window),
  );
  // A valid zero is evidence, not a reason to spend on another provider. Only
  // technically failed plans use the existing bounded Apify fallback.
  const failed = direct
    .filter((outcome) => outcome.status !== "success")
    .map((outcome) => outcome.plan);
  if (!failed.length) return direct;
  const fallback = await apifyPlans(failed, window);
  const byQuery = new Map(
    fallback.map((outcome) => [outcome.plan.query, outcome]),
  );
  return direct.map((outcome) =>
    outcome.status === "success"
      ? outcome
      : (byQuery.get(outcome.plan.query) ?? outcome),
  );
}

function combinedSupportingSources(
  group: NewsCandidate[],
  prior: typeof industryNewsTable.$inferSelect | undefined,
) {
  const sources = new Map<
    string,
    {
      name: string;
      url: string;
      sourceClass: "primary" | "secondary" | "commentary";
    }
  >();
  for (const source of prior?.supportingSources ?? [])
    sources.set(source.url, source);
  for (const item of group)
    sources.set(item.sourceUrl, {
      name: item.sourceName,
      url: item.sourceUrl,
      sourceClass: item.sourceClass,
    });
  return [...sources.values()];
}

function coverageRows(scanId: number, outcomes: PlanOutcome[]) {
  return INDUSTRY_NEWS_SOURCES.map((source) => {
    const relevant = outcomes.filter((outcome) =>
      outcome.plan.sourceKeys.includes(source.key),
    );
    const sourceCandidates = relevant
      .flatMap((outcome) => outcome.candidates)
      .filter((candidate) => candidate.sourceKey === source.key);
    const successful = relevant.some((outcome) => outcome.status === "success");
    const missingOnly =
      relevant.length > 0 &&
      relevant.every((outcome) => outcome.status === "missing-credentials");
    const latest = sourceCandidates
      .map((candidate) => candidate.publishedDate)
      .sort()
      .at(-1);
    return {
      scanId,
      sourceKey: source.key,
      sourceName: source.name,
      sourceUrl: source.url,
      geography: source.geography,
      sourceClass: source.sourceClass,
      coverage: source.coverage,
      accessMethod:
        relevant
          .map((outcome) => outcome.provider)
          .filter((provider, index, all) => all.indexOf(provider) === index)
          .join("+") || "targeted-search",
      status: successful
        ? sourceCandidates.length
          ? "success-with-results"
          : "success-zero-results"
        : missingOnly
          ? "missing-credentials"
          : "provider-error",
      candidateCount: sourceCandidates.length,
      qualifyingCount: sourceCandidates.length,
      failureReason: successful
        ? null
        : (relevant.map((outcome) => outcome.failureReason).find(Boolean) ??
          "Source search was not completed"),
      latestPublicationAt: latest ? new Date(`${latest}T00:00:00Z`) : null,
    };
  });
}

export async function scanIndustryNewsWorkflow(
  scanId: number,
  startDate?: string,
  endDate?: string,
): Promise<{
  found: number;
  provider: "firecrawl" | "apify" | "mixed";
  startDate: string;
  endDate: string;
}> {
  const [previousScan] = await db
    .select({ completedAt: scansTable.completedAt })
    .from(scansTable)
    .where(and(eq(scansTable.status, "completed"), lt(scansTable.id, scanId)))
    .orderBy(desc(scansTable.completedAt))
    .limit(1);
  const window = resolveIndustryNewsWindow({
    startDate,
    endDate,
    previousEnd: previousScan?.completedAt,
  });
  const outcomes = await discover(window);
  const candidates = outcomes.flatMap((outcome) => outcome.candidates);
  const groups = groupEventCandidates(candidates);
  const priorRows = await db
    .select()
    .from(industryNewsTable)
    .where(lt(industryNewsTable.scanId, scanId))
    .orderBy(desc(industryNewsTable.id))
    .limit(1000);
  const now = new Date();

  const archiveRows = groups.map((group) => {
    const canonical = chooseCanonical(group);
    const generatedKey = canonicalEventKey(canonical);
    const prior =
      priorRows.find((row) => row.canonicalKey === generatedKey) ??
      priorRows.find((row) => isLikelyPriorEvent(canonical, row));
    const supportingSources = combinedSupportingSources(group, prior);
    const priorUrls = new Set(
      (prior?.supportingSources ?? []).map((source) => source.url),
    );
    const hasNewEvidence = group.some((item) => !priorUrls.has(item.sourceUrl));
    return {
      scanId,
      title: canonical.title,
      summary: canonical.summary,
      sourceName: canonical.sourceName,
      sourceUrl: canonical.sourceUrl,
      author: canonical.author,
      country: canonical.country,
      contentType: canonical.contentType,
      publishedDate: canonical.publishedDate,
      canonicalKey: prior?.canonicalKey ?? generatedKey,
      region: canonical.region,
      category: canonical.category,
      sourceClass: canonical.sourceClass,
      evidenceStatus: evidenceStatusFor(group),
      developmentStatus: canonical.developmentStatus,
      noveltyStatus: prior
        ? hasNewEvidence
          ? "updated"
          : "previously_reported"
        : "new",
      lifecycleStage: canonical.lifecycleStage,
      importance: Math.max(...group.map((item) => item.importance)),
      eventDate: canonical.eventDate,
      secondaryTopics: [
        ...new Set(group.flatMap((item) => item.secondaryTopics)),
      ],
      stakeholderGroups: [
        ...new Set(group.flatMap((item) => item.stakeholderGroups)),
      ],
      capacityFacts: [
        ...new Map(
          group
            .flatMap((item) => item.capacityFacts)
            .map((fact) => [`${fact.value}:${fact.unit}`, fact]),
        ).values(),
      ],
      supportingSources,
      firstSeenAt: prior?.firstSeenAt ?? prior?.discoveredAt ?? now,
      lastSeenAt: now,
    };
  });

  const coverage = coverageRows(scanId, outcomes);
  await db.transaction(async (tx) => {
    await tx
      .delete(industryNewsSourceCoverageTable)
      .where(eq(industryNewsSourceCoverageTable.scanId, scanId));
    await tx
      .delete(industryNewsTable)
      .where(eq(industryNewsTable.scanId, scanId));
    if (coverage.length)
      await tx.insert(industryNewsSourceCoverageTable).values(coverage);
    if (archiveRows.length)
      await tx.insert(industryNewsTable).values(archiveRows);
  });

  const providers = new Set(outcomes.map((outcome) => outcome.provider));
  const provider =
    providers.size > 1
      ? "mixed"
      : ((providers.values().next().value ?? "firecrawl") as
          | "firecrawl"
          | "apify");
  logger.info(
    {
      scanId,
      found: archiveRows.length,
      candidateCount: candidates.length,
      provider,
      scanMode: window.mode,
      timezone: REPORTING_TIMEZONE,
      windowStart: window.startAt.toISOString(),
      windowEndExclusive: window.endAt.toISOString(),
      sourcesChecked: coverage.filter((row) => row.status.startsWith("success"))
        .length,
      sourcesFailed: coverage.filter((row) => !row.status.startsWith("success"))
        .length,
    },
    "Industry news market-intelligence scan complete",
  );
  return {
    found: archiveRows.length,
    provider,
    startDate: window.startDate,
    endDate: window.endExclusiveDate,
  };
}
