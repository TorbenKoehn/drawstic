#!/usr/bin/env node
// Published CLI entry. Unlike src/cli.ts (which self-runs via `import.meta.main`
// under Bun/Deno), this wrapper always runs and needs no `import.meta.main`, so
// the bin works on Node >= 20. Dev keeps using `bun run src/cli.ts`.
import { main } from './cli.js'

process.exitCode = main(process.argv.slice(2))
