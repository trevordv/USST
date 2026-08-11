import assert from "node:assert/strict";
import test from "node:test";
import {
  buildArcGisWhereClause,
  fetchArcGisEpbcRecords,
  fetchEpbcRecords,
  mapArcGisFeatureToEpbcRecord,
  mergeEpbcRecordDetails,
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
