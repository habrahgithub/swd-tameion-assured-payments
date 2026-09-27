import { describe, expect, it } from "vitest";

import { domainContractMetadataSchema } from "../src/domain/contracts";

describe("J0 application shell", () => {
  it("loads the typed domain-contract boundary", () => {
    expect(domainContractMetadataSchema.parse({ version: "j0" })).toEqual({ version: "j0" });
  });
});
