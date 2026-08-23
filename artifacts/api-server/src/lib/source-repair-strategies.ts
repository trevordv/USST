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

export interface SourceRepairStrategy {
  name: string;
  auditGroup: SourceAuditGroup;
  mode: SourceAccessMode;
  officialUrls: readonly string[];
  fallback: "openai" | "browse-ai-then-openai" | "none";
  browseRobotIdEnvironmentKey?: string;
  parserTest: string;
}

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
    configuredNames.length !== 34 ||
    configured.size !== 34 ||
    missing.length ||
    stale.length
  ) {
    throw new Error(
      `Source repair strategy mismatch: configured=${configuredNames.length}, unique=${configured.size}, missing=${missing.join(",") || "none"}, stale=${stale.join(",") || "none"}`,
    );
  }
}
