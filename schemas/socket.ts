import { z } from "zod";
import { pokeResponseSchema } from "./poke";
import { pushRequestSchema } from "./push";

export const requestSchema = z.tuple([z.literal("pushReq"), pushRequestSchema]);

export const responseSchema = z.tuple([
  z.literal("pokeRes"),
  pokeResponseSchema,
]);

export type Request = z.infer<typeof requestSchema>;
export type Response = z.infer<typeof responseSchema>;
