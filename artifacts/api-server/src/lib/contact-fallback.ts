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

export function inferKnownDeveloperFromText(
  text: string | null | undefined,
  organizationNames: string[],
): string | null {
  const haystack = ` ${words(text ?? "").join(" ")} `;
  if (!haystack.trim()) return null;

  const matches = new Map<string, { original: string; normalized: string }>();
  for (const original of organizationNames) {
    const normalized = normalizeKnownOrganization(original);
    if (normalized.length < 5) continue;
    const needle = ` ${normalized} `;
    if (haystack.includes(needle)) {
      matches.set(normalized, { original, normalized });
    }
  }
  if (matches.size === 0) return null;

  const ranked = [...matches.values()].sort((a,b) => b.normalized.length - a.normalized.length);
  const best = ranked[0];
  if (ranked.length > 1 && ranked[1].normalized.length === best.normalized.length && ranked[1].normalized !== best.normalized) {
    return null;
  }
  return best.original;
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
