import { z } from "zod";

import { canonicalIntegerString, rfc3339Millis } from "../domain/schemas";

export const T1_SINGLE_APPROVAL = "T1_SINGLE_APPROVAL" as const;
export const P0_DESIGNATED_APPROVER_ID = "USR-DEMO-OPERATOR";
export const P0_FINANCE_APPROVER_ROLE = "FINANCE_APPROVER";

export const actorAuthorityRecordSchema = z.object({
  organization_id: z.string().min(1).max(128),
  actor_id: z.string().min(1).max(128),
  actor_role: z.string().min(1).max(128),
  permissions: z.array(z.string().min(1).max(128)).max(32),
  authority_version: canonicalIntegerString,
  status: z.enum(["ACTIVE", "SUSPENDED", "REVOKED"]),
  valid_from: rfc3339Millis.refine((value) => Number.isFinite(Date.parse(value))),
  expires_at: rfc3339Millis.refine((value) => Number.isFinite(Date.parse(value))).nullable(),
}).strict();

export type ActorAuthorityRecord = z.infer<typeof actorAuthorityRecordSchema>;

export class ActorAuthorityRegistryError extends Error {
  constructor(message: string, public readonly code = "ACT-002") {
    super(message);
    this.name = "ActorAuthorityRegistryError";
  }
}

/** Namespace-owned authority records. These are persisted in the same snapshot as payment authority. */
export class ActorAuthorityRegistry {
  private readonly records = new Map<string, ActorAuthorityRecord>();

  constructor(records: unknown = []) {
    this.restore(records);
  }

  static seedP0Approver(organizationId: string, now = new Date()): ActorAuthorityRecord {
    return actorAuthorityRecordSchema.parse({
      organization_id: organizationId,
      actor_id: P0_DESIGNATED_APPROVER_ID,
      actor_role: P0_FINANCE_APPROVER_ROLE,
      permissions: [T1_SINGLE_APPROVAL],
      authority_version: "1",
      status: "ACTIVE",
      valid_from: now.toISOString(),
      expires_at: null,
    });
  }

  restore(value: unknown): void {
    if (!Array.isArray(value)) throw new ActorAuthorityRegistryError("Persisted actor authority registry is malformed");
    const parsed = value.map((entry) => actorAuthorityRecordSchema.parse(entry));
    const identities = parsed.map(({ organization_id, actor_id }) => this.identity(organization_id, actor_id));
    if (new Set(identities).size !== identities.length) {
      throw new ActorAuthorityRegistryError("Persisted actor authority registry has duplicate organization/actor identities");
    }
    parsed.forEach((record, index) => {
      const current = this.records.get(identities[index]!);
      if (!current) return;
      const nextVersion = BigInt(record.authority_version);
      const currentVersion = BigInt(current.authority_version);
      const permissionsUnchanged = record.permissions.length === current.permissions.length &&
        record.permissions.every((permission, permissionIndex) => permission === current.permissions[permissionIndex]);
      const authorityFieldsChanged = record.actor_role !== current.actor_role || !permissionsUnchanged ||
        record.valid_from !== current.valid_from || record.expires_at !== current.expires_at;
      if (nextVersion < currentVersion ||
          (current.status === "REVOKED" && record.status !== "REVOKED") ||
          (current.status === "SUSPENDED" && record.status === "ACTIVE" && nextVersion <= currentVersion) ||
          (nextVersion === currentVersion && authorityFieldsChanged)) {
        throw new ActorAuthorityRegistryError("Actor authority restore cannot roll back, reactivate, or change authority without a version increase");
      }
    });
    this.records.clear();
    parsed.forEach((record, index) => this.records.set(identities[index]!, record));
  }

  export(): ActorAuthorityRecord[] {
    return [...this.records.values()]
      .map((record) => ({ ...record, permissions: [...record.permissions] }))
      .sort((left, right) => this.identity(left.organization_id, left.actor_id).localeCompare(this.identity(right.organization_id, right.actor_id)));
  }

  resolve(organizationId: string, actorId: string): ActorAuthorityRecord | undefined {
    const record = this.records.get(this.identity(organizationId, actorId));
    return record ? { ...record, permissions: [...record.permissions] } : undefined;
  }

  resolveDesignatedApprover(organizationId: string, now = new Date()): ActorAuthorityRecord {
    const record = this.resolve(organizationId, P0_DESIGNATED_APPROVER_ID);
    if (!record || !this.isCurrentApprover(record, organizationId, now)) {
      throw new ActorAuthorityRegistryError("The designated P0 approver is missing, inactive, expired, or lacks T1_SINGLE_APPROVAL authority");
    }
    return record;
  }

  private isCurrentApprover(record: ActorAuthorityRecord, organizationId: string, now: Date): boolean {
    const instant = now.getTime();
    return record.organization_id === organizationId &&
      record.actor_id === P0_DESIGNATED_APPROVER_ID &&
      record.actor_role === P0_FINANCE_APPROVER_ROLE &&
      record.permissions.includes(T1_SINGLE_APPROVAL) &&
      record.status === "ACTIVE" &&
      Date.parse(record.valid_from) <= instant &&
      (record.expires_at === null || instant < Date.parse(record.expires_at));
  }

  private identity(organizationId: string, actorId: string): string {
    return `${organizationId}\u0000${actorId}`;
  }
}
