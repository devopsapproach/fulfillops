import "dotenv/config";
import { z } from "zod";

const apiConfigSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
});

export const apiConfig = apiConfigSchema.parse(process.env);
