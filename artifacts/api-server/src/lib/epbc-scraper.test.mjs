import assert from "node:assert/strict";
import test from "node:test";
import {
  buildArcGisWhereClause,
  buildSearchPrompt,
  epbcAiRequestUpperBound,
  fetchArcGisEpbcRecords,
  fetchEpbcRecords,
  mapArcGisFeatureToEpbcRecord,
  mergeEpbcRecordDetails,
  planEpbcEnrichment,
} from "./epbc-scraper.ts";

function arcGisResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const solarAttributes = {
  REFERENCE_NUMBER: "2024/10015",
  NAME: "Cooma Solar and Battery Project 350 MW",
  PRIMARY_JURISDICTION: "NSW",
  REFERRAL_DECISION: "Controlled Action",
  STATUS_DESCRIPTION: "Assessment Approach Determined",
  STAGE_NAME: "Assessment",
  REFERRAL_TYPE: "Referral (S68)",
  YEAR: 2025,
  CATEGORY: "Energy Generation and Supply (renewable)",
  REFERRAL_URL: "http:\\\\epbcnotices.environment.gov.au\\referralslist",
  CRM_ID: "test-crm-id",
  OBJECTID: 5606,
};

test("maps official ArcGIS attributes into the existing EPBC model", () => {
  const record = mapArcGisFeatureToEpbcRecord(solarAttributes);

  assert.ok(record);
  assert.equal(record.epbcNumber, "2024/10015");
  assert.equal(record.projectName, "Cooma Solar and Battery Project 350 MW");
  assert.equal(record.state, "NSW");
  assert.equal(record.location, "NSW");
  assert.equal(record.industryType, "Energy Generation and Supply (renewable)");
  assert.equal(record.projectStatus, "Assessment Approach Determined");
  assert.equal(record.decisionStatus, "Controlled Action");
  assert.equal(record.technologyType, "Solar + BESS");
  assert.equal(record.sizeMw, 350);
  assert.equal(record.referralDate, "2025-01-01");
  assert.equal(
    record.sourceUrl,
    "https://epbcpublicportal.environment.gov.au/public-register/referral-detail/2024-10015",
  );
  assert.match(record.rawDescription, /CRM ID: test-crm-id/);
});

test("uses year-level ArcGIS filters for optional date ranges", () => {
  assert.equal(
    buildArcGisWhereClause("2023-07-01", "2025-02-28"),
    "1=1 AND YEAR >= 2023 AND YEAR <= 2025",
  );
  assert.equal(buildArcGisWhereClause(), "1=1");
});

test("paginates, filters non-energy records, and deduplicates EPBC numbers", async () => {
  const requestedUrls = [];
  const fetchImplementation = async (input) => {
    const url = new URL(String(input));
    requestedUrls.push(url);
    const offset = Number(url.searchParams.get("resultOffset"));
    if (offset === 0) {
      return arcGisResponse({
        features: [
          { attributes: solarAttributes },
          {
            attributes: {
              ...solarAttributes,
              REFERENCE_NUMBER: "2024/99999",
              NAME: "Solar Farm Access Road",
              CATEGORY: "Transport - Land",
              OBJECTID: 5607,
            },
          },
        ],
        exceededTransferLimit: true,
      });
    }

    return arcGisResponse({
      features: [{ attributes: { ...solarAttributes, OBJECTID: 9999 } }],
      exceededTransferLimit: false,
    });
  };

  const records = await fetchArcGisEpbcRecords(
    "2024-01-01",
    "2025-12-31",
    fetchImplementation,
  );

  assert.equal(records.length, 1);
  assert.equal(requestedUrls.length, 2);
  assert.equal(requestedUrls[0].searchParams.get("where"), "1=1 AND YEAR >= 2024 AND YEAR <= 2025");
  assert.equal(requestedUrls[1].searchParams.get("resultOffset"), "2");
  assert.equal(requestedUrls[0].searchParams.get("returnGeometry"), "false");
});

test("falls back to OpenAI records when the ArcGIS source is unavailable", async () => {
  let fallbackCalls = 0;
  const fallbackRecord = mapArcGisFeatureToEpbcRecord(solarAttributes);
  assert.ok(fallbackRecord);

  const records = await fetchEpbcRecords(undefined, undefined, {
    fetchImplementation: async () => arcGisResponse({ error: "unavailable" }, 503),
    priorRecords: [],
    fallback: async () => {
      fallbackCalls++;
      return [fallbackRecord];
    },
  });

  assert.equal(fallbackCalls, 1);
  assert.deepEqual(records, [fallbackRecord]);
});

test("supplements structured records without replacing official status fields", () => {
  const structured = mapArcGisFeatureToEpbcRecord(solarAttributes);
  assert.ok(structured);
  const supplemental = {
    ...structured,
    proponent: "Example Energy",
    projectStatus: "Different web status",
    sizeMw: 420,
    referralDate: "2025-03-14",
    rawDescription: "420 MW solar and battery project",
  };

  const [merged] = mergeEpbcRecordDetails([structured], [supplemental]);
  assert.equal(merged.proponent, "Example Energy");
  assert.equal(merged.sizeMw, 350);
  assert.equal(merged.referralDate, "2025-03-14");
  assert.equal(merged.projectStatus, "Assessment Approach Determined");
  assert.match(merged.rawDescription, /420 MW/);
});

test("does not append OpenAI-only records after the official source succeeds", () => {
  const structured = mapArcGisFeatureToEpbcRecord(solarAttributes);
  const supplementalOnly = mapArcGisFeatureToEpbcRecord({
    ...solarAttributes,
    REFERENCE_NUMBER: "2025/12345",
    NAME: "Supplemental Solar Project",
  });
  assert.ok(structured);
  assert.ok(supplementalOnly);

  const merged = mergeEpbcRecordDetails([structured], [supplementalOnly]);
  assert.deepEqual(merged, [structured]);
});

test("does not invoke fallback after a successful structured response", async () => {
  let fallbackCalls = 0;
  const records = await fetchEpbcRecords(undefined, undefined, {
    fetchImplementation: async () => arcGisResponse({
      features: [{ attributes: solarAttributes }],
      exceededTransferLimit: false,
    }),
    fallback: async () => {
      fallbackCalls++;
      return [];
    },
    supplementStructuredRecords: false,
  });

  assert.equal(records.length, 1);
  assert.equal(fallbackCalls, 0);
});

test("an ArcGIS outage retains prior EPBC coverage and adds bounded discoveries", async () => {
  const prior = mapArcGisFeatureToEpbcRecord(solarAttributes);
  const discovered = mapArcGisFeatureToEpbcRecord({
    ...solarAttributes, REFERENCE_NUMBER: "2025/12345",
    NAME: "New Official Solar Project 80 MW", OBJECTID: 7777,
  });
  assert.ok(prior && discovered);
  const records = await fetchEpbcRecords(undefined, undefined, {
    fetchImplementation: async () => arcGisResponse({}, 503),
    priorRecords: [prior],
    fallback: async () => ({ records: [discovered], cached: 0, aiCalls: 1 }),
  });
  assert.deepEqual(records.map(record => record.epbcNumber), [prior.epbcNumber, discovered.epbcNumber]);
});

test("complete deterministic EPBC records never invoke AI supplementation", async () => {
  let fallbackCalls = 0;
  const records = await fetchEpbcRecords("2025-01-01", "2025-12-31", {
    fetchImplementation: async () => arcGisResponse({ features: [{ attributes: solarAttributes }] }),
    supplementStructuredRecords: true,
    priorRecords: [],
    fallback: async () => { fallbackCalls++; return []; },
  });
  assert.equal(fallbackCalls, 0);
  assert.equal(records.length, 1);
  assert.equal(records[0].sizeMw, 350);
  assert.equal(records[0].isSolar, true);
});

test("deduplicates before AI and sends only genuinely unresolved official records", async () => {
  const complete = mapArcGisFeatureToEpbcRecord(solarAttributes);
  const unresolved = mapArcGisFeatureToEpbcRecord({
    ...solarAttributes,
    REFERENCE_NUMBER: "2025/10020",
    NAME: "River Renewable Energy Project",
    OBJECTID: 5608,
  });
  assert.ok(complete);
  assert.ok(unresolved);
  const duplicate = { ...unresolved, rawDescription: `${unresolved.rawDescription} duplicate` };
  const plan = planEpbcEnrichment([complete, unresolved, duplicate]);
  assert.equal(plan.totalCandidates, 3);
  assert.equal(plan.duplicatesRemoved, 1);
  assert.equal(plan.deterministicallyResolved, 1);
  assert.deepEqual(plan.unresolved.map(record => record.epbcNumber), ["2025/10020"]);

  let requested = [];
  await fetchEpbcRecords(undefined, undefined, {
    fetchImplementation: async () => arcGisResponse({
      features: [{ attributes: solarAttributes }, { attributes: {
        ...solarAttributes, REFERENCE_NUMBER: "2025/10020",
        NAME: "River Renewable Energy Project", OBJECTID: 5608,
      } }],
    }),
    supplementStructuredRecords: true,
    priorRecords: [],
    fallback: async (_start, _end, unresolvedRecords) => {
      requested = unresolvedRecords;
      return [];
    },
  });
  assert.deepEqual(requested.map(record => record.epbcNumber), ["2025/10020"]);
});

test("prior EPBC evidence resolves an official record before paid work", () => {
  const unresolved = mapArcGisFeatureToEpbcRecord({
    ...solarAttributes, REFERENCE_NUMBER: "2025/10021",
    NAME: "River Renewable Energy Project", OBJECTID: 5609,
  });
  assert.ok(unresolved);
  const prior = {
    ...unresolved,
    technologyType: "Solar",
    sizeMw: 75,
    rawDescription: "75 MW solar project",
    isRenewable: true,
    isSolar: true,
    relevanceStatus: "solar",
  };
  const plan = planEpbcEnrichment([unresolved], [prior]);
  assert.equal(plan.unresolved.length, 0);
  assert.equal(plan.deterministicallyResolved, 1);
  assert.equal(plan.records[0].sizeMw, 75);
  assert.equal(plan.records[0].isSolar, true);
});

test("cached unresolved batches report zero new AI requests and preserve empty results", async () => {
  let cacheLookups = 0;
  const records = await fetchEpbcRecords(undefined, undefined, {
    fetchImplementation: async () => arcGisResponse({ features: [{ attributes: {
      ...solarAttributes, REFERENCE_NUMBER: "2025/10022",
      NAME: "River Renewable Energy Project", OBJECTID: 5610,
    } }] }),
    supplementStructuredRecords: true,
    priorRecords: [],
    fallback: async (_start, _end, unresolvedRecords) => {
      cacheLookups++;
      assert.equal(unresolvedRecords.length, 1);
      return { records: [], cached: 1, aiCalls: 0 };
    },
  });
  assert.equal(cacheLookups, 1);
  assert.equal(records.length, 1); // Official coverage is never discarded.
});

test("technology and capacity gates remain decisive before AI planning", () => {
  const subFive = mapArcGisFeatureToEpbcRecord({ ...solarAttributes, REFERENCE_NUMBER: "2025/10023", NAME: "4.5 MW Solar Farm" });
  const wind = mapArcGisFeatureToEpbcRecord({ ...solarAttributes, REFERENCE_NUMBER: "2025/10024", NAME: "90 MW Wind Farm" });
  const battery = mapArcGisFeatureToEpbcRecord({ ...solarAttributes, REFERENCE_NUMBER: "2025/10025", NAME: "50 MW Battery Project" });
  assert.ok(subFive && wind && battery);
  const plan = planEpbcEnrichment([subFive, wind, battery]);
  assert.equal(plan.unresolved.length, 0);
  assert.equal(subFive.isSolar, true);
  assert.equal(subFive.sizeMw, 4.5);
  assert.equal(wind.relevanceStatus, "wind");
  assert.equal(battery.relevanceStatus, "bess");
});

test("AI work is bounded by unresolved batches and restricted to official EPBC hosts", () => {
  assert.equal(epbcAiRequestUpperBound(0), 0);
  assert.equal(epbcAiRequestUpperBound(1), 1);
  assert.equal(epbcAiRequestUpperBound(20), 1);
  assert.equal(epbcAiRequestUpperBound(21), 2);
  const prompt = buildSearchPrompt("Resolve 2025/10020 only", "2026-09-05");
  assert.match(prompt, /Search ONLY the official EPBC portal/);
  assert.match(prompt, /epbcpublicportal\.environment\.gov\.au/);
  assert.match(prompt, /gis\.environment\.gov\.au/);
  assert.doesNotMatch(prompt, /news sources|developer sites|social media/i);
});
