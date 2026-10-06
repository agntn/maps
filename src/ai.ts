/** Vercel AI SDK tool surface over the shared maps tool definitions. */

import type { Static } from "@agntn/tools";
import { toAiTool, type AiToolOutput } from "@agntn/tools/ai";
import type { Tool } from "ai";
import type { CoordinateConversion } from "./core/convert.ts";
import type {
  DistanceDetails,
  GeocodeDetails,
  ProvidersDetails,
  ReverseDetails,
} from "./tool-operations.ts";
import {
  convertSchema,
  convertTool as convertDefinition,
  distanceSchema,
  distanceTool as distanceDefinition,
  geocodeAddressSchema,
  geocodeAddressTool as geocodeAddressDefinition,
  geocodeSchema,
  geocodeTool as geocodeDefinition,
  providersSchema,
  providersTool as providersDefinition,
  reverseSchema,
  reverseTool as reverseDefinition,
} from "./tools.ts";

export const geocodeTool: Tool<
  Static<typeof geocodeSchema>,
  AiToolOutput<GeocodeDetails>
> = toAiTool(geocodeDefinition);

export const geocodeAddressTool: Tool<
  Static<typeof geocodeAddressSchema>,
  AiToolOutput<GeocodeDetails>
> = toAiTool(geocodeAddressDefinition);

export const reverseTool: Tool<
  Static<typeof reverseSchema>,
  AiToolOutput<ReverseDetails>
> = toAiTool(reverseDefinition);

export const distanceTool: Tool<
  Static<typeof distanceSchema>,
  AiToolOutput<DistanceDetails>
> = toAiTool(distanceDefinition);

export const convertTool: Tool<
  Static<typeof convertSchema>,
  AiToolOutput<CoordinateConversion>
> = toAiTool(convertDefinition);

export const providersTool: Tool<
  Static<typeof providersSchema>,
  AiToolOutput<ProvidersDetails>
> = toAiTool(providersDefinition);
