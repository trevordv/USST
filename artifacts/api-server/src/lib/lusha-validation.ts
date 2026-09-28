export interface LushaRunOptions {
  approvedPaidProspecting: boolean;
  maxLushaCredits: number;
  dryRun: boolean;
}

export const MAX_LUSHA_CREDITS_PER_RUN = 100;

export function normalizeLushaRunOptions(input: Partial<LushaRunOptions> = {}): LushaRunOptions {
  const approvedPaidProspecting = input.approvedPaidProspecting === true;
  const value = Number(input.maxLushaCredits);
  return {
    approvedPaidProspecting,
    maxLushaCredits: approvedPaidProspecting && Number.isSafeInteger(value) && value > 0 && value <= MAX_LUSHA_CREDITS_PER_RUN ? value : 0,
    dryRun: input.dryRun === true,
  };
}

function normalized(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function isExactPersonMatch(expected: string | null | undefined, firstName: string | null | undefined, lastName: string | null | undefined): boolean {
  const received = normalized(`${firstName ?? ""} ${lastName ?? ""}`);
  return Boolean(received) && normalized(expected) === received;
}

export function isProfessionalCompanyEmail(email: string | null | undefined, companyDomain: string | null | undefined): boolean {
  const address = email?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return false;
  if (!companyDomain) return true;
  const actual = address.split("@")[1];
  const expected = companyDomain.toLowerCase().replace(/^www\./, "");
  return actual === expected || actual.endsWith(`.${expected}`);
}
