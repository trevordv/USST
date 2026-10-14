const COMMON_ORG_WORDS = new Set([
  "pty","ltd","limited","group","holdings","inc","corp","co","company","australia",
  "energy","solar","power","renewables","renewable","green","clean","au","nz"
]);

function words(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(Boolean);
}

export function normalizeKnownOrganization(value: string | null | undefined): string {
  return words(value ?? "").filter((word) => !COMMON_ORG_WORDS.has(word)).join(" ");
}

export interface KnownContact {
  organizationName: string;
  name: string | null;
  email: string;
  phone: string | null;
}

export interface ExistingProjectContactFields {
  developer: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

export interface MissingContactFieldUpdates {
  developer?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
}

/**
 * Fill only absent project/developer contact fields. This deliberately never
 * replaces stored values: known-company evidence can recover historic gaps,
 * but cannot establish that an existing contact is wrong.
 */
export function planMissingContactFieldUpdates(
  existing: ExistingProjectContactFields,
  developerEvidence: string | null | undefined,
  fallback: KnownContact | null,
): MissingContactFieldUpdates {
  const updates: MissingContactFieldUpdates = {};
  if (!existing.developer?.trim() && developerEvidence) updates.developer = developerEvidence;
  if (!fallback) return updates;
  if (!existing.contactName?.trim() && fallback.name) updates.contactName = fallback.name;
  if (!existing.contactEmail?.trim() && fallback.email) updates.contactEmail = fallback.email;
  if (!existing.contactPhone?.trim() && fallback.phone) updates.contactPhone = fallback.phone;
  return updates;
}

export function inferKnownDeveloperFromText(
  text: string | null | undefined,
  organizationNames: string[],
): string | null {
  const haystack = ` ${words(text ?? "").join(" ")} `;
  if (!haystack.trim()) return null;

  const matches = new Map<string, { original: string; normalized: string }>();
  for (const original of organizationNames) {
    const normalized = normalizeKnownOrganization(original);
    // Short alphabetic names (for example "AGL") are too ambiguous to infer
    // merely from a mention. A short registered identifier containing a digit
    // (for example "OX2") is materially more specific, provided it is still
    // an exact, unique known-organisation match below.
    const compact = normalized.replace(/\s+/g, "");
    const isSpecificShortIdentifier = /^[a-z]{1,2}\d[a-z0-9]*$/.test(compact) && compact.length >= 3;
    if (normalized.length < 4 && !isSpecificShortIdentifier) continue;
    const needle = ` ${normalized} `;
    if (haystack.includes(needle)) {
      matches.set(normalized, { original, normalized });
    }
  }
  if (matches.size !== 1) return null;
  return [...matches.values()][0].original;
}

export function matchKnownContact(
  developer: string | null | undefined,
  contacts: KnownContact[],
): KnownContact | null {
  const target = normalizeKnownOrganization(developer);
  if (!target) return null;

  const matches = contacts
    .filter((contact) => normalizeKnownOrganization(contact.organizationName) === target)
    .sort((a,b) => {
      const completenessA = Number(Boolean(a.phone)) + Number(Boolean(a.name));
      const completenessB = Number(Boolean(b.phone)) + Number(Boolean(b.name));
      return completenessB - completenessA;
    });

  return matches[0] ?? null;
}
