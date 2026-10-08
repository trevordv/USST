export type SourceAccessMode =
  | "standard"
  | "structured-html"
  | "openai-first"
  | "aemo-workbook"
  | "epbc-arcgis"
  | "browse-ai-or-openai"
  | "authenticated";

export type SourceAuditGroup =
  | "working"
  | "inaccessible"
  | "extraction-problematic"
  | "authenticated";

export type SourceAcquisitionMethod =
  | "rss"
  | "structured-api"
  | "xlsx"
  | "html"
  | "firecrawl"
  | "apify"
  | "brightdata"
  | "openai-normalisation"
  | "authenticated";

export interface SourceAcquisitionPlan {
  methods: readonly SourceAcquisitionMethod[];
  firecrawlMode?: "scrape" | "crawl";
  maxFirecrawlPages?: number;
  maxFirecrawlDepth?: number;
}

export interface SourceRepairStrategy {
  name: string;
  auditGroup: SourceAuditGroup;
  mode: SourceAccessMode;
  officialUrls: readonly string[];
  fallback: "openai" | "browse-ai-then-openai" | "none";
  browseRobotIdEnvironmentKey?: string;
  parserTest: string;
}

/**
 * Registry-reviewed sources whose deterministic public acquisition has been
 * unreliable. Firecrawl is transport for these existing sources only; this
 * list never expands the approved 52-source registry.
 */
const FIRECRAWL_TARGET_SOURCES = new Set([
  "NSW Planning Portal",
  "NSW Planning Renewable Energy",
  "Planning Victoria",
  "QLD Coordinator-General",
  "QLD Planning – Renewable Energy",
  "SA Energy & Mining",
  "WA EPA",
  "NT Development Applications",
  "Planning Alerts Australia",
  "Clean Energy Council",
  "NZ Electricity Authority",
  "NZ Fast-track",
  "NZ EPA – Fast-track Projects",
  "NZ EPA – RMA Proposals",
  "NZ EPA – Public Consultations",
  "NZ Ministry for the Environment",
  "Energy Magazine",
  "PV Tech",
  "Energy-Storage.news",
  "SolarQuarter",
  "Energy Global",
  "Green Review",
  "Renewables Now",
  "Power Technology",
  "Australian Mining",
  "Infrastructure Magazine",
  "Energy News Bulletin",
  "Carbon News NZ",
  "Energy News NZ",
  "SEANZ Utility Solar",
  "MBIE Energy",
  "BusinessDesk NZ",
  "NZ Herald Business",
  "EECA",
  "PV Magazine Global",
]);

const FIRECRAWL_CRAWL_SOURCES = new Set([
  "NSW Planning Portal",
  "NZ Fast-track",
  "NZ EPA – Fast-track Projects",
  "NZ EPA – RMA Proposals",
  "NZ EPA – Public Consultations",
]);

const AEMO_GENERATION_INFORMATION_PAGE =
  "https://www.aemo.com.au/energy-systems/electricity/national-electricity-market-nem/nem-forecasting-and-planning/forecasting-and-planning-data/generation-information";

export const AEMO_GENERATION_WORKBOOK_URL =
  "https://www.aemo.com.au/-/media/files/electricity/nem/planning_and_forecasting/generation_information/2026/nem-generation-information-july-2026.xlsx?rev=3455851f2bc945b7ab61c5ceed272992&sc_lang=en";

export const SOURCE_REPAIR_STRATEGIES: readonly SourceRepairStrategy[] = [
  {
    name: "Renew Economy",
    auditGroup: "working",
    mode: "standard",
    officialUrls: [
      "https://reneweconomy.com.au/feed/",
      "https://reneweconomy.com.au/?s=solar+project+announced",
    ],
    fallback: "openai",
    parserTest: "rss",
  },
  {
    name: "PV Magazine Australia",
    auditGroup: "working",
    mode: "standard",
    officialUrls: [
      "https://www.pv-magazine-australia.com/feed/",
      "https://www.pv-magazine-australia.com/?s=solar+project",
    ],
    fallback: "openai",
    parserTest: "rss",
  },
  {
    name: "PV Magazine Global",
    auditGroup: "working",
    mode: "standard",
    officialUrls: [
      "https://www.pv-magazine.com/?s=Australia+solar+project",
      "https://www.pv-magazine.com/?s=Australia+solar+farm",
    ],
    fallback: "openai",
    parserTest: "html",
  },
  {
    name: "PV Tech",
    auditGroup: "extraction-problematic",
    mode: "standard",
    officialUrls: ["https://www.pv-tech.org/?s=Australia+solar"],
    fallback: "openai",
    parserTest: "html",
  },
  {
    name: "Energy-Storage.news",
    auditGroup: "extraction-problematic",
    mode: "standard",
    officialUrls: ["https://www.energy-storage.news/?s=Australia+solar"],
    fallback: "openai",
    parserTest: "html",
  },
  {
    name: "SolarQuarter",
    auditGroup: "extraction-problematic",
    mode: "standard",
    officialUrls: ["https://solarquarter.com/?s=Australia+solar"],
    fallback: "openai",
    parserTest: "html",
  },
  {
    name: "Energy Global",
    auditGroup: "extraction-problematic",
    mode: "standard",
    officialUrls: ["https://www.energyglobal.com/solar/"],
    fallback: "openai",
    parserTest: "html",
  },
  {
    name: "Green Review",
    auditGroup: "extraction-problematic",
    mode: "standard",
    officialUrls: ["https://greenreview.com.au/all-energy/"],
    fallback: "openai",
    parserTest: "html",
  },
  {
    name: "Renewables Now",
    auditGroup: "extraction-problematic",
    mode: "standard",
    officialUrls: ["https://www.renewablesnow.com/news/solar/"],
    fallback: "openai",
    parserTest: "html",
  },
  {
    name: "Power Technology",
    auditGroup: "extraction-problematic",
    mode: "standard",
    officialUrls: ["https://www.power-technology.com/marketdata/"],
    fallback: "openai",
    parserTest: "html",
  },
  {
    name: "Australian Mining",
    auditGroup: "extraction-problematic",
    mode: "standard",
    officialUrls: ["https://www.australianmining.com.au/?s=solar"],
    fallback: "openai",
    parserTest: "html",
  },
  {
    name: "Infrastructure Magazine",
    auditGroup: "extraction-problematic",
    mode: "standard",
    officialUrls: ["https://infrastructuremagazine.com.au/?s=solar"],
    fallback: "openai",
    parserTest: "html",
  },
  {
    name: "Energy News Bulletin",
    auditGroup: "extraction-problematic",
    mode: "standard",
    officialUrls: ["https://www.energynewsbulletin.net/power"],
    fallback: "openai",
    parserTest: "html",
  },
  {
    name: "Carbon News NZ",
    auditGroup: "extraction-problematic",
    mode: "standard",
    officialUrls: ["https://www.carbonnews.co.nz/news-page/25/energy"],
    fallback: "openai",
    parserTest: "html",
  },
  {
    name: "Energy News NZ",
    auditGroup: "extraction-problematic",
    mode: "standard",
    officialUrls: ["https://www.energynews.co.nz/"],
    fallback: "openai",
    parserTest: "html",
  },
  {
    name: "SEANZ Utility Solar",
    auditGroup: "extraction-problematic",
    mode: "standard",
    officialUrls: ["https://www.seanz.org.nz/utility-solar"],
    fallback: "openai",
    parserTest: "html",
  },
  {
    name: "MBIE Energy",
    auditGroup: "extraction-problematic",
    mode: "standard",
    officialUrls: ["https://www.mbie.govt.nz/building-and-energy/energy-and-natural-resources/energy-statistics-and-modelling/energy-publications-and-technical-papers/nz-generation-data-updates"],
    fallback: "openai",
    parserTest: "html",
  },
  {
    name: "BusinessDesk NZ",
    auditGroup: "extraction-problematic",
    mode: "standard",
    officialUrls: ["https://businessdesk.co.nz/"],
    fallback: "openai",
    parserTest: "html",
  },
  {
    name: "NZ Herald Business",
    auditGroup: "extraction-problematic",
    mode: "standard",
    officialUrls: ["https://www.nzherald.co.nz/business/"],
    fallback: "openai",
    parserTest: "html",
  },
  {
    name: "EECA",
    auditGroup: "extraction-problematic",
    mode: "standard",
    officialUrls: ["https://www.eeca.govt.nz/"],
    fallback: "openai",
    parserTest: "html",
  },
  {
    name: "EcoGeneration",
    auditGroup: "working",
    mode: "standard",
    officialUrls: [
      "https://www.ecogeneration.com.au/category/projects/solar-projects/feed/",
      "https://www.ecogeneration.com.au/category/projects/solar-projects/",
    ],
    fallback: "openai",
    parserTest: "rss",
  },
  {
    name: "Utility Magazine",
    auditGroup: "working",
    mode: "standard",
    officialUrls: [
      "https://utilitymagazine.com.au/category/electricity/solar/feed/",
      "https://utilitymagazine.com.au/category/electricity/solar/",
    ],
    fallback: "openai",
    parserTest: "rss",
  },
  {
    name: "ESD News",
    auditGroup: "working",
    mode: "standard",
    officialUrls: [
      "https://esdnews.com.au/feed/",
      "https://esdnews.com.au/tag/solar/",
    ],
    fallback: "openai",
    parserTest: "rss",
  },
  {
    name: "RenewMap",
    auditGroup: "extraction-problematic",
    mode: "openai-first",
    officialUrls: ["https://renewmap.com.au/resources/"],
    fallback: "openai",
    parserTest: "scoped-openai",
  },
  {
    name: "ARENA",
    auditGroup: "working",
    mode: "standard",
    officialUrls: [
      "https://arena.gov.au/feed/",
      "https://arena.gov.au/news/?s=solar+project",
    ],
    fallback: "openai",
    parserTest: "rss",
  },
  {
    name: "Clean Energy Regulator",
    auditGroup: "extraction-problematic",
    mode: "openai-first",
    officialUrls: [
      "https://cer.gov.au/markets/reports-and-data/large-scale-renewable-energy-data",
    ],
    fallback: "openai",
    parserTest: "scoped-openai",
  },
  {
    name: "AEMO",
    auditGroup: "inaccessible",
    mode: "aemo-workbook",
    officialUrls: [
      AEMO_GENERATION_INFORMATION_PAGE,
      AEMO_GENERATION_WORKBOOK_URL,
    ],
    fallback: "openai",
    parserTest: "aemo-workbook",
  },
  {
    name: "Capacity Investment Scheme",
    auditGroup: "inaccessible",
    mode: "openai-first",
    officialUrls: [
      "https://www.dcceew.gov.au/energy/renewable/capacity-investment-scheme/closed-cis-tenders",
      "https://www.dcceew.gov.au/energy/renewable/capacity-investment-scheme/open-cis-tenders",
    ],
    fallback: "openai",
    parserTest: "scoped-openai",
  },
  {
    name: "EPBC Act Referrals",
    auditGroup: "extraction-problematic",
    mode: "epbc-arcgis",
    officialUrls: [
      "https://gis.environment.gov.au/gispubmap/rest/services/ogc_services/EPBC_Referrals/MapServer/0",
      "https://epbcpublicportal.environment.gov.au/all-referrals/",
    ],
    fallback: "openai",
    parserTest: "epbc-arcgis",
  },
  {
    name: "EPBC Referrals Spatial Database",
    auditGroup: "extraction-problematic",
    mode: "epbc-arcgis",
    officialUrls: [
      "https://gis.environment.gov.au/gispubmap/rest/services/ogc_services/EPBC_Referrals/MapServer/0",
      "https://data.gov.au/data/dataset/referrals-spatial-database",
    ],
    fallback: "openai",
    parserTest: "epbc-arcgis",
  },
  {
    name: "NSW Planning Portal",
    auditGroup: "extraction-problematic",
    mode: "openai-first",
    officialUrls: [
      "https://www.planningportal.nsw.gov.au/major-projects/projects",
    ],
    fallback: "openai",
    parserTest: "scoped-openai",
  },
  {
    name: "NSW Planning Renewable Energy",
    auditGroup: "extraction-problematic",
    mode: "openai-first",
    officialUrls: [
      "https://www.planning.nsw.gov.au/the-planning-system/renewable-energy",
    ],
    fallback: "openai",
    parserTest: "scoped-openai",
  },
  {
    name: "Planning Victoria",
    auditGroup: "inaccessible",
    mode: "openai-first",
    officialUrls: [
      "https://www.planning.vic.gov.au/guides-and-resources/guides/all-guides/renewable-energy-facilities/solar-energy-facilities",
    ],
    fallback: "openai",
    parserTest: "scoped-openai",
  },
  {
    name: "QLD Coordinator-General",
    auditGroup: "inaccessible",
    mode: "openai-first",
    officialUrls: [
      "https://www.coordinatorgeneral.qld.gov.au/projects/find-a-project/current-coordinated-projects",
      "https://www.coordinatorgeneral.qld.gov.au/projects/find-a-project",
    ],
    fallback: "openai",
    parserTest: "scoped-openai",
  },
  {
    name: "SA Energy & Mining",
    auditGroup: "inaccessible",
    mode: "openai-first",
    officialUrls: [
      "https://energymining.sa.gov.au/industry/hydrogen-and-renewable-energy/large-scale-generation-and-storage/solar-energy-projects",
    ],
    fallback: "openai",
    parserTest: "scoped-openai",
  },
  {
    name: "WA EPA",
    auditGroup: "inaccessible",
    mode: "openai-first",
    officialUrls: ["https://www.epa.wa.gov.au/proposal-search"],
    fallback: "openai",
    parserTest: "scoped-openai",
  },
  {
    name: "NT Development Applications",
    auditGroup: "extraction-problematic",
    mode: "openai-first",
    officialUrls: ["https://www.ntlis.nt.gov.au/planning"],
    fallback: "openai",
    parserTest: "scoped-openai",
  },
  {
    name: "Tasmania EPA",
    auditGroup: "working",
    mode: "standard",
    officialUrls: [
      "https://epa.tas.gov.au/business-industry/assessment/proposals-assessed-by-the-epa",
    ],
    fallback: "openai",
    parserTest: "html-empty",
  },
  {
    name: "Planning Alerts Australia",
    auditGroup: "extraction-problematic",
    mode: "openai-first",
    officialUrls: ["https://www.planningalerts.org.au/"],
    fallback: "openai",
    parserTest: "scoped-openai",
  },
  {
    name: "Clean Energy Council",
    auditGroup: "extraction-problematic",
    mode: "openai-first",
    officialUrls: [
      "https://cleanenergycouncil.org.au/advocacy/large-scale-solar",
    ],
    fallback: "openai",
    parserTest: "scoped-openai",
  },
  {
    name: "QLD Planning – Renewable Energy",
    auditGroup: "inaccessible",
    mode: "openai-first",
    officialUrls: [
      "https://www.planning.qld.gov.au/planning-framework/state-assessment-and-referral-agency/sara-submissions-portal",
    ],
    fallback: "openai",
    parserTest: "scoped-openai",
  },
  {
    name: "Smart Energy Council",
    auditGroup: "working",
    mode: "standard",
    officialUrls: [
      "https://smartenergy.org.au/feed/",
      "https://smartenergy.org.au/news/",
    ],
    fallback: "openai",
    parserTest: "rss",
  },
  {
    name: "Energy Magazine",
    auditGroup: "extraction-problematic",
    mode: "standard",
    officialUrls: [
      "https://www.energymagazine.com.au/feed/",
      "https://www.energymagazine.com.au/?s=solar+project",
    ],
    fallback: "openai",
    parserTest: "rss-and-current-search",
  },
  {
    name: "NZ Electricity Authority",
    auditGroup: "extraction-problematic",
    mode: "openai-first",
    officialUrls: [
      "https://www.ea.govt.nz/data-and-insights/charts-and-dashboards/generation-investment-pipeline/",
    ],
    fallback: "openai",
    parserTest: "scoped-openai",
  },
  {
    name: "Transpower NZ",
    auditGroup: "extraction-problematic",
    mode: "structured-html",
    officialUrls: [
      "https://www.transpower.co.nz/connections/whats-latest-grid-connections",
    ],
    fallback: "openai",
    parserTest: "official-project-html",
  },
  {
    name: "NZ Fast-track",
    auditGroup: "inaccessible",
    mode: "browse-ai-or-openai",
    officialUrls: ["https://www.fasttrack.govt.nz/projects/"],
    fallback: "browse-ai-then-openai",
    browseRobotIdEnvironmentKey: "BROWSE_AI_NZ_FAST_TRACK_ROBOT_ID",
    parserTest: "browse-or-scoped-openai",
  },
  {
    name: "NZ EPA – Fast-track Projects",
    auditGroup: "inaccessible",
    mode: "browse-ai-or-openai",
    officialUrls: [
      "https://www.epa.govt.nz/fast-track-consenting/fast-track-projects/",
    ],
    fallback: "browse-ai-then-openai",
    browseRobotIdEnvironmentKey: "BROWSE_AI_NZ_EPA_FAST_TRACK_ROBOT_ID",
    parserTest: "browse-or-scoped-openai",
  },
  {
    name: "NZ EPA – RMA Proposals",
    auditGroup: "inaccessible",
    mode: "browse-ai-or-openai",
    officialUrls: ["https://www.epa.govt.nz/industry-areas/rma-proposals/"],
    fallback: "browse-ai-then-openai",
    browseRobotIdEnvironmentKey: "BROWSE_AI_NZ_EPA_RMA_ROBOT_ID",
    parserTest: "browse-or-scoped-openai",
  },
  {
    name: "NZ EPA – Public Consultations",
    auditGroup: "inaccessible",
    mode: "browse-ai-or-openai",
    officialUrls: ["https://www.epa.govt.nz/public-consultations/"],
    fallback: "browse-ai-then-openai",
    browseRobotIdEnvironmentKey: "BROWSE_AI_NZ_EPA_CONSULTATIONS_ROBOT_ID",
    parserTest: "browse-or-scoped-openai",
  },
  {
    name: "NZ Ministry for the Environment",
    auditGroup: "working",
    mode: "standard",
    officialUrls: [
      "https://environment.govt.nz/acts-and-regulations/acts/fast-track-approvals/fast-track-projects/",
    ],
    fallback: "openai",
    parserTest: "html-empty",
  },
  {
    name: "AltEnergy Australia",
    auditGroup: "authenticated",
    mode: "authenticated",
    officialUrls: [
      "https://altenergy.com.au/login",
      "https://altenergy.com.au/kilowatt_subcribers",
      "https://altenergy.com.au/newsandviews",
      "https://altenergy.com.au/watt_news",
    ],
    fallback: "none",
    parserTest: "authenticated-altenergy",
  },
  {
    name: "LUVI Project Tracker",
    auditGroup: "authenticated",
    mode: "authenticated",
    officialUrls: [
      "https://luvi.com.au/projects?category=Energy&status=Proposed%2CApproved%2CCommitted%2CCommitted+%28FID%29",
      "https://luvi.com.au/data/pipeline.enc?v=20260628a",
    ],
    fallback: "none",
    parserTest: "authenticated-luvi",
  },
] as const;

const strategyByName = new Map(
  SOURCE_REPAIR_STRATEGIES.map((strategy) => [strategy.name, strategy]),
);

export function getSourceRepairStrategy(name: string): SourceRepairStrategy {
  const strategy = strategyByName.get(name);
  if (!strategy)
    throw new Error(`No source repair strategy configured for ${name}`);
  return strategy;
}

/**
 * Derive the bounded acquisition order from the audited source contract.
 * Working structured integrations stay first and paid transports are exposed
 * only for the reviewed weak-source set above.
 */
export function getSourceAcquisitionPlan(name: string): SourceAcquisitionPlan {
  const strategy = getSourceRepairStrategy(name);
  if (strategy.mode === "authenticated") return { methods: ["authenticated"] };
  if (strategy.mode === "aemo-workbook") return { methods: ["xlsx", "openai-normalisation"] };
  if (strategy.mode === "epbc-arcgis") return { methods: ["structured-api", "openai-normalisation"] };

  const direct: SourceAcquisitionMethod[] = strategy.parserTest === "rss" ||
    strategy.parserTest === "rss-and-current-search"
    ? ["rss", "html"]
    : ["html"];
  if (!FIRECRAWL_TARGET_SOURCES.has(name)) {
    return { methods: [...direct, "openai-normalisation"] };
  }
  const firecrawlMode = FIRECRAWL_CRAWL_SOURCES.has(name) ? "crawl" : "scrape";
  return {
    methods: [...direct, "firecrawl", "apify", "brightdata", "openai-normalisation"],
    firecrawlMode,
    maxFirecrawlPages: firecrawlMode === "crawl" ? 3 : 1,
    maxFirecrawlDepth: firecrawlMode === "crawl" ? 1 : 0,
  };
}

export function validateSourceRepairStrategies(
  configuredNames: readonly string[],
): void {
  const configured = new Set(configuredNames);
  const strategies = new Set(
    SOURCE_REPAIR_STRATEGIES.map((strategy) => strategy.name),
  );
  const missing = [...configured].filter((name) => !strategies.has(name));
  const stale = [...strategies].filter((name) => !configured.has(name));
  if (
    configuredNames.length !== 52 ||
    configured.size !== 52 ||
    missing.length ||
    stale.length
  ) {
    throw new Error(
      `Source repair strategy mismatch: configured=${configuredNames.length}, unique=${configured.size}, missing=${missing.join(",") || "none"}, stale=${stale.join(",") || "none"}`,
    );
  }
}
