import { describe, expect, it } from "vitest";

import { runConnectivitySpike, J0ConnectivitySpikeNotConfiguredError } from "../src/j0d-spike/connectivity-spike";

describe("J0-D connectivity spike (isolated infrastructure harness)", () => {
  it("fails closed rather than fabricating a transaction when no provider credentials are configured", async () => {
    const originalCircle = process.env.CIRCLE_API_KEY;
    const originalEntity = process.env.CIRCLE_ENTITY_SECRET;
    const originalArc = process.env.ARC_API_KEY;
    delete process.env.CIRCLE_API_KEY;
    delete process.env.CIRCLE_ENTITY_SECRET;
    delete process.env.ARC_API_KEY;

    try {
      await expect(runConnectivitySpike()).rejects.toThrow(J0ConnectivitySpikeNotConfiguredError);
    } finally {
      if (originalCircle) process.env.CIRCLE_API_KEY = originalCircle;
      if (originalEntity) process.env.CIRCLE_ENTITY_SECRET = originalEntity;
      if (originalArc) process.env.ARC_API_KEY = originalArc;
    }
  });
});
