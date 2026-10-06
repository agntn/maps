/** CLI-only `reverse` and `distance`: a point is one pasted "latitude,longitude" word. */

import { defineTool, Type } from "@agntn/tools";
import { parseCoordinates } from "./core/coordinates.ts";
import { REVERSE_GRANULARITIES } from "./core/types.ts";
import { loadOperations } from "./tools.ts";

const filled = (description: string) => Type.String({ pattern: "\\S", description });

export const reverseCommand = defineTool({
  name: "maps_reverse_pair",
  title: "Reverse Geocode",
  description:
    'Resolve "latitude,longitude" to the nearest place (put "--" before a pair that starts with a minus)',
  effect: "read",
  input: Type.Object(
    {
      coordinates: filled('Coordinate pair as "latitude,longitude", for example 52.2318,21.0067'),
      provider: Type.Optional(filled('Provider, or "all" to compare every provider')),
      language: Type.Optional(filled("Preferred language for result names (BCP 47)")),
      granularity: Type.Optional(
        Type.String({ enum: [...REVERSE_GRANULARITIES], description: "Result granularity" }),
      ),
      raw: Type.Optional(
        Type.Boolean({ description: "Print the provider's own record of the place too" }),
      ),
    },
    { additionalProperties: false },
  ),
  cli: { command: "reverse", positional: ["coordinates"] },
  execute: async ({ coordinates, ...options }) =>
    (await loadOperations()).reverse({ ...parseCoordinates(coordinates), ...options }),
});

export const distanceCommand = defineTool({
  name: "maps_distance_pair",
  title: "Measure Distance",
  description:
    'Great-circle distance between two "latitude,longitude" pairs (put "--" before a pair that starts with a minus)',
  effect: "read",
  input: Type.Object(
    {
      from: filled('Start point as "latitude,longitude", for example 52.2297,21.0122'),
      to: filled('End point as "latitude,longitude", for example 50.0647,19.9450'),
    },
    { additionalProperties: false },
  ),
  cli: { command: "distance", positional: ["from", "to"] },
  execute: async ({ from, to }) =>
    (await loadOperations()).distance({ from: parseCoordinates(from), to: parseCoordinates(to) }),
});
