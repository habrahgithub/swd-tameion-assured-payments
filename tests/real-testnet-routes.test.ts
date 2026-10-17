import { describe, expect, it } from "vitest";

import { GET as getLegacyStatus } from "../app/api/internal/demo/real-testnet-payment/status/route";
import { POST as legacyAssess } from "../app/api/internal/demo/real-testnet-payment/assess/route";
import { POST as legacyAuthorize } from "../app/api/internal/demo/real-testnet-payment/authorize/route";
import { POST as legacyExecute } from "../app/api/internal/demo/real-testnet-payment/execute/route";

describe("retired fixed-ID testnet lane", () => {
  it("does not expose assessment, authorization, submission, or status for the synthetic obligation", async () => {
    const response = await Promise.all([
      legacyAssess(),
      legacyAuthorize(),
      legacyExecute(),
      getLegacyStatus(),
    ]);
    expect(response.map((item) => item.status)).toEqual([410, 410, 410, 410]);
    const bodies = await Promise.all(response.map((item) => item.json()));
    expect(bodies.map((body) => body.error)).toEqual([
      expect.stringContaining("retired"),
      expect.stringContaining("retired"),
      expect.stringContaining("retired"),
      expect.stringContaining("retired"),
    ]);
  });
});
