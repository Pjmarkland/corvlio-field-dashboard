const fixture = vi.hoisted(() => ({
  business: null as Record<string, any> | null,
  db: {
    transaction: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@workspace/db", () => ({
  businessesTable: {
    id: "id",
    websiteEnrichmentAttemptedAt: "attemptedAt",
  },
  db: fixture.db,
}));

vi.mock("drizzle-orm", () => ({
  and: (...clauses: unknown[]) => ({ kind: "and", clauses }),
  eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
  isNull: (column: unknown) => ({ kind: "isNull", column }),
}));

import {
  applyWebsiteEnrichment,
  claimWebsiteEnrichment,
} from "../../src/lib/businessDirectory";

function createTransaction() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          for: async () => fixture.business ? [fixture.business] : [],
        }),
      }),
    }),
    update: () => ({
      set: (changes: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            fixture.business = { ...fixture.business, ...changes };
            return [fixture.business];
          },
        }),
      }),
    }),
  };
}

function flattenConditions(condition: any): any[] {
  if (!condition) return [];
  if (Array.isArray(condition)) return condition.flatMap(flattenConditions);
  if (condition.kind === "and") return condition.clauses.flatMap(flattenConditions);
  return [condition];
}

function setUpDatabaseMocks() {
  const transaction = createTransaction();
  fixture.db.transaction.mockImplementation((callback: (tx: unknown) => unknown) =>
    callback(transaction),
  );
  fixture.db.select.mockImplementation(() => ({
    from: () => Promise.resolve(fixture.business ? [fixture.business] : []),
  }));
  fixture.db.update.mockImplementation(() => {
    let changes: Record<string, unknown> = {};
    let condition: unknown;
    return {
      set: (nextChanges: Record<string, unknown>) => {
        changes = nextChanges;
        return {
          where: (nextCondition: unknown) => {
            condition = nextCondition;
            return {
              returning: async () => {
                const clauses = flattenConditions(condition);
                const checksId = clauses.some(
                  (clause) => clause.kind === "eq" && clause.column === "id" && clause.value === fixture.business?.id,
                );
                const checksUnclaimed = clauses.some(
                  (clause) => clause.kind === "isNull" && clause.column === "attemptedAt",
                );

                if (
                  !checksId
                  || !checksUnclaimed
                  || !fixture.business
                  || fixture.business.websiteEnrichmentAttemptedAt !== null
                ) {
                  return [];
                }

                fixture.business = { ...fixture.business, ...changes };
                return [fixture.business];
              },
            };
          },
        };
      },
    };
  });
}

describe("business website enrichment writes", () => {
  beforeEach(() => {
    fixture.business = {
      id: 12,
      businessType: "Owner-entered HVAC contractor",
      pricingPolicy: null,
      warrantyInfo: null,
      websiteEnrichmentAttemptedAt: null,
      websiteEnrichmentSources: {},
    };
    setUpDatabaseMocks();
  });

  it("preserves owner-entered values and accepts only sourced values for blank fields", async () => {
    await applyWebsiteEnrichment(
      12,
      {
        businessType: "Website-suggested plumber",
        pricingPolicy: "Free written estimates",
        warrantyInfo: "Lifetime coverage",
      },
      {
        businessType: "https://example.com/",
        pricingPolicy: "https://example.com/pricing",
      },
    );

    expect(fixture.business?.businessType).toBe("Owner-entered HVAC contractor");
    expect(fixture.business?.websiteEnrichmentSources.businessType).toBeUndefined();
    expect(fixture.business?.pricingPolicy).toBe("Free written estimates");
    expect(fixture.business?.websiteEnrichmentSources.pricingPolicy).toBe(
      "https://example.com/pricing",
    );
    expect(fixture.business?.warrantyInfo).toBeNull();
    expect(fixture.business?.websiteEnrichmentSources.warrantyInfo).toBeUndefined();
  });

  it("allows only one concurrent request to claim website enrichment", async () => {
    const claims = await Promise.all([
      claimWebsiteEnrichment(12, "https://example.com"),
      claimWebsiteEnrichment(12, "https://example.com"),
      claimWebsiteEnrichment(12, "https://example.com"),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(fixture.business?.websiteEnrichmentAttemptedAt).toBeInstanceOf(Date);
  });
});