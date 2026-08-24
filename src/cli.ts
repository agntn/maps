#!/usr/bin/env node

/** Maps CLI - unified geocoding commands */
import { defineCommand, runMain } from "citty";
import { version } from "./version.ts";

/** Side-effect import: registers every built-in provider before the CLI parses arguments. */
import "./providers/index.ts";

const main = defineCommand({
  meta: {
    name: "maps",
    version,
    description: "Unified maps and geocoding CLI",
  },
  subCommands: {
    geocode: () => import("./commands/geocode.ts").then((m) => m.default),
    reverse: () => import("./commands/reverse.ts").then((m) => m.default),
    distance: () => import("./commands/distance.ts").then((m) => m.default),
    providers: () => import("./commands/providers.ts").then((m) => m.default),
    mcp: () => import("./commands/mcp.ts").then((m) => m.default),
  },
});

await runMain(main);
