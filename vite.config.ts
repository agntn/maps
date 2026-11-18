import oxfmt from "@agntn/ox/oxfmt";
import oxlint from "@agntn/ox/oxlint";
import { defineConfig } from "vite-plus";

/** Lint, format and test run on Vite+. The build stays on obuild (`build.config.ts`). */
export default defineConfig({
  fmt: { ...oxfmt, ignorePatterns: ["dist"] },
  lint: {
    ...oxlint,
    rules: {
      ...oxlint.rules,
      "typescript/prefer-readonly-parameter-types": [
        "error",
        {
          allow: [
            /** Public types and the provider itself. An internal type gets `readonly` instead. */
            {
              from: "file",
              name: [
                "BoundingBox",
                "ClientOptions",
                "ConvertOptions",
                "CoordinateConversion",
                "DecodedCoordinates",
                "DistanceTextOptions",
                "GeoAddress",
                "GeoLocation",
                "GeoPoint",
                "GeocodeOptions",
                "LocationTextOptions",
                "MapsError",
                "Provider",
                "ProviderConfig",
                "ProviderListing",
                "ProviderOutcome",
                "ReverseOptions",
                "UtmPosition",
                "What3wordsOptions",
              ],
            },
            /** Lib types the rule reads as mutable whatever wraps them. */
            { from: "lib", name: ["AbortSignal", "Response"] },
            {
              from: "package",
              name: ["ExtensionAPI"],
              package: "@earendil-works/pi-coding-agent",
            },
            { from: "package", name: ["ExtensionAPI"], package: "@oh-my-pi/pi-coding-agent" },
          ],
          ignoreInferredTypes: true,
        },
      ],
    },
    overrides: [
      {
        /** Tests build mutable doubles and need no API docs. */
        files: ["test/**/*.ts"],
        rules: {
          "jsdoc/require-param": "off",
          "jsdoc/require-returns": "off",
          "typescript/prefer-readonly-parameter-types": "off",
        },
      },
      {
        /** The evals are `.mjs` outside the tsconfig program: every value there is `any`. */
        files: ["test/eval-*.mjs"],
        rules: {
          "typescript/no-unsafe-argument": "off",
          "typescript/no-unsafe-assignment": "off",
          "typescript/no-unsafe-call": "off",
          "typescript/no-unsafe-member-access": "off",
          "typescript/no-unsafe-return": "off",
        },
      },
    ],
    ignorePatterns: ["dist"],
  },
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
});
