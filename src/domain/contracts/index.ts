import { z } from "zod";

export const domainContractMetadataSchema = z
  .object({
    version: z.string().min(1),
  })
  .strict();

export type DomainContractMetadata = z.infer<typeof domainContractMetadataSchema>;
