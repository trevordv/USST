/**
 * Lusha API v3 client (https://api.lusha.com/v3, header `api_key`).
 *
 * Replaces the v2 prospecting endpoints (/prospecting/filters/companies/names,
 * /prospecting/contact/search), which Lusha retires on 30 November 2026.
 *
 *   Named person:   POST /v3/contacts/search-and-enrich  { contacts[], reveal }
 *   Company only:   POST /v3/contacts/prospecting        { pagination, filters }
 *                   POST /v3/contacts/enrich             { ids[], reveal }
 *
 * A usable result has a work email or a direct phone number (either is kept).
 * Credits are taken from each response's `billing.creditsCharged`.
 */
import { isExactPersonMatch, isProfessionalCompanyEmail } from "./lusha-validation.ts";

const LUSHA_BASE = "https://api.lusha.com";

export type LushaFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface LushaContactResult {
  name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  companyDomain: string | null;
  creditsCharged: number;
}

interface LushaEmail { email?: string; type?: string; confidence?: string }
interface LushaPhone { number?: string; type?: string; doNotCall?: boolean }
interface LushaPerson {
  id?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  jobTitle?: { title?: string } | string;
  company?: { name?: string; domain?: string };
  emails?: LushaEmail[];
  phones?: LushaPhone[];
  error?: unknown;
}
interface LushaV3Response { results?: LushaPerson[]; billing?: { creditsCharged?: number } }

const SALES_TITLE_SCORES: Array<[RegExp, number]> = [
  [/business develop/i, 10],
  [/head of (?:project|develop)|project director|development director|director of develop/i, 9],
  [/managing director|chief executive|\bceo\b|country manager/i, 8],
  [/general manager|chief operating|\bcoo\b/i, 7],
  [/development manager|project manager|origination/i, 6],
  [/commercial manager|partnerships|procurement/i, 5],
];

export function salesTitleScore(title: string | null | undefined): number {
  for (const [pattern, score] of SALES_TITLE_SCORES) if (pattern.test(title ?? "")) return score;
  return 1;
}

function titleOf(person: LushaPerson): string | null {
  return typeof person.jobTitle === "string" ? person.jobTitle : person.jobTitle?.title ?? null;
}

function bareDomain(domain: string | null | undefined): string | null {
  const value = domain?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  return value || null;
}

/** Best work email (A+ work first) and a callable direct phone (mobile first, never DNC or masked). */
export function pickLushaContactDetails(person: LushaPerson, companyDomain: string | null): { email: string | null; phone: string | null } {
  const emails = (person.emails ?? []).filter((item) => item.email && isProfessionalCompanyEmail(item.email, companyDomain));
  const email = (emails.find((item) => item.type === "work" && item.confidence === "A+")
    ?? emails.find((item) => item.type === "work")
    ?? emails[0])?.email?.trim().toLowerCase() ?? null;
  const phones = (person.phones ?? []).filter((item) => item.number && !item.number.includes("...") && item.doNotCall !== true);
  const phone = (phones.find((item) => item.type === "mobile") ?? phones.find((item) => item.type === "direct") ?? phones[0])?.number ?? null;
  return { email, phone };
}

export class LushaV3Client {
  private readonly apiKey: string;
  private readonly fetchImpl: LushaFetch;
  private readonly timeoutMs: number;

  constructor(apiKey: string, fetchImpl: LushaFetch = fetch as unknown as LushaFetch, timeoutMs = 30_000) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  private async post(path: string, body: unknown): Promise<LushaV3Response | null> {
    const response = await this.fetchImpl(`${LUSHA_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", api_key: this.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      const error = new Error(`Lusha ${path} returned HTTP ${response.status}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return (await response.json()) as LushaV3Response;
  }

  /** Look up one named person at a company. Exact name match required. */
  async findNamedPerson(input: { firstName: string; lastName: string; companyName: string; companyDomain?: string | null }): Promise<LushaContactResult | null> {
    const domain = bareDomain(input.companyDomain);
    const json = await this.post("/v3/contacts/search-and-enrich", {
      contacts: [{
        clientReferenceId: "usst-1",
        firstName: input.firstName,
        lastName: input.lastName,
        companyName: input.companyName,
        ...(domain ? { companyDomain: domain } : {}),
      }],
      reveal: ["emails", "phones"],
    });
    const credits = Number(json?.billing?.creditsCharged ?? 0) || 0;
    const person = json?.results?.find((item) => !item.error);
    if (!person || !isExactPersonMatch(`${input.firstName} ${input.lastName}`, person.firstName, person.lastName)) {
      return { name: null, title: null, email: null, phone: null, companyDomain: domain, creditsCharged: credits };
    }
    const resolvedDomain = bareDomain(person.company?.domain) ?? domain;
    const details = pickLushaContactDetails(person, resolvedDomain);
    return {
      name: [person.firstName, person.lastName].filter(Boolean).join(" ") || null,
      title: titleOf(person),
      ...details,
      companyDomain: resolvedDomain,
      creditsCharged: credits,
    };
  }

  /**
   * Find the most sales-relevant person at a company (AU/NZ-based staff first)
   * and reveal their details. At most one person is revealed per company.
   */
  async findCompanyContact(input: { companyName: string; companyDomain?: string | null }): Promise<LushaContactResult | null> {
    const domain = bareDomain(input.companyDomain);
    const companies = domain ? { domains: [domain] } : { names: [input.companyName] };
    let credits = 0;
    let candidates: LushaPerson[] = [];
    for (const countries of [["AU", "NZ"], null] as const) {
      const search = await this.post("/v3/contacts/prospecting", {
        pagination: { page: 0, size: 10 },
        filters: {
          companies: { include: companies },
          ...(countries ? { contacts: { include: { countries } } } : {}),
        },
        options: { excludeDnc: true },
      });
      credits += Number(search?.billing?.creditsCharged ?? 0) || 0;
      candidates = (search?.results ?? []).filter((item) => item.id && item.firstName && item.lastName && !item.error &&
        companyMatches(item.company, input.companyName, domain));
      if (candidates.length > 0) break;
    }
    if (candidates.length === 0) return { name: null, title: null, email: null, phone: null, companyDomain: domain, creditsCharged: credits };

    const best = [...candidates].sort((a, b) => salesTitleScore(titleOf(b)) - salesTitleScore(titleOf(a)))[0];
    const enriched = await this.post("/v3/contacts/enrich", { ids: [best.id], reveal: ["emails", "phones"] });
    credits += Number(enriched?.billing?.creditsCharged ?? 0) || 0;
    const person = enriched?.results?.find((item) => item.id === best.id && !item.error) ?? enriched?.results?.[0];
    if (!person || person.error) return { name: null, title: null, email: null, phone: null, companyDomain: domain, creditsCharged: credits };
    const resolvedDomain = bareDomain(person.company?.domain ?? best.company?.domain) ?? domain;
    return {
      name: [person.firstName ?? best.firstName, person.lastName ?? best.lastName].filter(Boolean).join(" ") || null,
      title: titleOf(person) ?? titleOf(best),
      ...pickLushaContactDetails(person, resolvedDomain),
      companyDomain: resolvedDomain,
      creditsCharged: credits,
    };
  }
}

function normalizeCompany(value: string | null | undefined): string {
  return (value ?? "").toLowerCase()
    .replace(/\b(pty|ltd|limited|group|holdings|inc|corp|co|company|australia|new zealand|nz|au)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

/** The prospecting result must belong to the requested company. */
export function companyMatches(company: { name?: string; domain?: string } | undefined, expectedName: string, expectedDomain: string | null): boolean {
  if (!company) return false;
  if (expectedDomain) return bareDomain(company.domain) === expectedDomain;
  const actual = normalizeCompany(company.name);
  const expected = normalizeCompany(expectedName);
  return Boolean(actual) && (actual === expected || actual.startsWith(`${expected} `) || expected.startsWith(`${actual} `));
}
