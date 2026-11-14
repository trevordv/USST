/**
 * Deterministic extraction of a project contact from source text (project
 * description or article body). Many announcements name a person ("Neoen
 * Australia managing director Louis de Sambucy said ..."), an address or a
 * phone number. This is free, runs before any paid provider, and gives Lusha
 * an exact person to look up instead of a company-wide search.
 */

export interface TextContact {
  name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
}

const GENERIC_LOCAL_PART_RE =
  /^(info|admin|contact|contactus|hello|enquiries|enquiry|general|mail|projects?|team|reception|office|support|sales|media|pr|news|communications|renewables|solar|wind|energy|development|planning|noreply|no-reply|webmaster|postmaster|feedback|accounts|billing|hr|jobs|careers|connect|update|newsletter|marketing|ops|operations|privacy|community|engagement|consultation|submissions?)@/i;

const FREEMAIL_DOMAINS = new Set([
  "gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "yahoo.com.au", "bigpond.com",
  "bigpond.net.au", "icloud.com", "live.com", "live.com.au", "optusnet.com.au", "xtra.co.nz",
]);

// Publishers and agencies whose addresses appear in article text but are
// never the project developer's contact.
const NON_DEVELOPER_EMAIL_DOMAIN_RE =
  /(reneweconomy|pv-magazine|pv-tech|energy-storage\.news|solarquarter|ecogeneration|esdnews|utilitymagazine|energymagazine|greenreview|altenergy|luvi|\.gov\.au$|\.govt\.nz$)/i;

const TITLE_WORDS = [
  "chief executive officer", "chief executive", "ceo", "managing director", "executive director",
  "chief operating officer", "coo", "chief development officer",
  "head of development", "head of projects", "development director", "project director",
  "director of development", "development manager", "project development manager",
  "project manager", "general manager", "country manager", "business development manager",
  "head of business development", "commercial manager", "founder", "co-founder",
];
// Titles match case-insensitively while names stay case-sensitive, so the
// pattern spells each letter as [xX] instead of using the /i flag.
const TITLE_RE = TITLE_WORDS
  .sort((a, b) => b.length - a.length)
  .map((title) => title
    .replace(/[-]/g, "\\-")
    .replace(/[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`)
    .replace(/\s+/g, "\\s+"))
  .join("|");

// Two to four capitalised name parts, allowing particles (de, van, von, da).
const NAME_PART = "[A-Z][a-z]*(?:['’\\-][A-Z]?[a-z]+)*";
const PERSON_NAME = `(${NAME_PART}(?:\\s+(?:(?:de|van|von|da|di|der|la|le)\\s+)?${NAME_PART}){1,3})`;

const NOT_A_PERSON_RE =
  /\b(?:solar|farm|energy|power|project|renewables?|australia|zealand|queensland|victoria|wales|south|western|northern|tasmania|group|limited|ltd|pty|council|government|department|minister|authority|commission|agency|bess|battery|park|hub|station|street|road)\b/i;

function cleanName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim();
  const parts = name.split(" ");
  if (parts.length < 2 || parts.length > 5) return null;
  if (NOT_A_PERSON_RE.test(name)) return null;
  return name;
}

function normalizeTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bCeo\b/, "CEO").replace(/\bCoo\b/, "COO");
}

/** Personal (non-generic, non-freemail, non-publisher) email addresses. */
export function extractPersonalEmails(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g)) {
    const email = match[0].toLowerCase().replace(/[.,;:]+$/, "");
    const domain = email.split("@")[1] ?? "";
    if (GENERIC_LOCAL_PART_RE.test(email) || FREEMAIL_DOMAINS.has(domain) || NON_DEVELOPER_EMAIL_DOMAIN_RE.test(domain)) continue;
    found.add(email);
  }
  return [...found];
}

/** First Australian or New Zealand phone number written in the text, normalised to spaced form. */
export function extractAuNzPhone(text: string): string | null {
  const patterns = [
    /(?<![\d+])\+61\s?\(?0?\)?\s?[2-478](?:[\s.-]?\d){8}(?!\d)/,        // +61 2 9xxx xxxx / +61 4xx xxx xxx
    /(?<![\d+])\+64\s?\(?0?\)?\s?[2-9](?:[\s.-]?\d){7,9}(?!\d)/,        // +64 9 xxx xxxx / +64 21 xxx xxxx
    /(?<![\d+])\(?0[2378]\)?[\s.-]?\d{4}[\s.-]?\d{4}(?!\d)/,             // (02) 9xxx xxxx
    /(?<![\d+])04\d{2}[\s.-]?\d{3}[\s.-]?\d{3}(?!\d)/,                   // 04xx xxx xxx
    /(?<![\d+])1[38]00[\s.-]?\d{3}[\s.-]?\d{3}(?!\d)/,                   // 1300/1800 xxx xxx
    /(?<![\d+])0[2-9][\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/,                    // NZ 09 xxx xxxx
    /(?<![\d+])02[0-9][\s.-]?\d{3,4}[\s.-]?\d{3,4}(?!\d)/,               // NZ mobile 021 xxx xxxx
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0].replace(/[().]/g, " ").replace(/-/g, " ").replace(/\s+/g, " ").trim();
  }
  return null;
}

/**
 * A named person with a sales-relevant title, e.g.
 *   "Neoen Australia managing director Louis de Sambucy said"
 *   "Jane Smith, project director at Acme Renewables,"
 *   "For more information contact Jane Smith on 0400 000 000"
 */
export function extractNamedPerson(text: string): { name: string; title: string | null } | null {
  const candidates: Array<{ name: string; title: string | null; score: number }> = [];
  const push = (rawName: string | undefined, rawTitle: string | undefined, score: number) => {
    const name = rawName ? cleanName(rawName) : null;
    if (name) candidates.push({ name, title: rawTitle ? normalizeTitle(rawTitle) : null, score });
  };

  // "contact Jane Smith" / "Contact: Jane Smith" / "please contact Jane Smith"
  for (const m of text.matchAll(new RegExp(`\\b[Cc]ontact(?:\\s+person)?:?\\s+${PERSON_NAME}`, "g"))) push(m[1], undefined, 3);
  // "<title> Jane Smith" (title immediately before the name)
  for (const m of text.matchAll(new RegExp(`\\b(${TITLE_RE})\\s+${PERSON_NAME}`, "g"))) push(m[2], m[1], 4);
  // "Jane Smith, <title>" / "Jane Smith, the company's <title>"
  for (const m of text.matchAll(new RegExp(`${PERSON_NAME},\\s+(?:the\\s+company[’']s\\s+|its\\s+|[A-Z][\\w&]+(?:\\s+[A-Z][\\w&]+)*\\s+)?(${TITLE_RE})\\b`, "g"))) push(m[1], m[2], 4);

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return { name: candidates[0].name, title: candidates[0].title };
}

/** Distinctive words of a company name used to relate an email domain to it. */
function companyTokens(company: string | null | undefined): string[] {
  const generic = new Set(["pty", "ltd", "limited", "group", "holdings", "energy", "solar", "power", "renewables",
    "renewable", "australia", "australian", "new", "zealand", "the", "and", "of", "co", "company", "corporation",
    "projects", "project", "development", "developments", "green", "clean", "capital", "infrastructure"]);
  return (company ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")
    .filter((word) => word.length >= 3 && !generic.has(word));
}

/** True when the email's domain contains a distinctive word of the company name. */
export function emailMatchesCompany(email: string, company: string | null | undefined): boolean {
  const domain = (email.split("@")[1] ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const tokens = companyTokens(company);
  if (tokens.length === 0) return false;
  if (tokens.some((token) => token.length >= 4 && domain.includes(token))) return true;
  const acronym = tokens.map((token) => token[0]).join("");
  return acronym.length >= 2 && tokens.length >= 2 && domain.startsWith(acronym);
}

/**
 * Extract the best project contact from text. An email is kept only when it
 * belongs to the developer (when the developer is known) or is the only
 * personal address present (when it is not).
 */
export function extractContactFromText(text: string | null | undefined, developer: string | null | undefined): TextContact {
  const body = (text ?? "").replace(/\s+/g, " ");
  if (!body.trim()) return { name: null, title: null, email: null, phone: null };
  const person = extractNamedPerson(body);
  const emails = extractPersonalEmails(body);
  const email = developer
    ? emails.find((candidate) => emailMatchesCompany(candidate, developer)) ?? null
    : emails.length === 1 ? emails[0] : null;
  const phone = extractAuNzPhone(body);
  return { name: person?.name ?? null, title: person?.title ?? null, email, phone };
}
