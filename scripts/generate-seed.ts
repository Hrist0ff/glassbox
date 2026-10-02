/**
 * Writes supabase/seed.sql from the bundled fixtures.
 *
 *   npm run seed:generate
 *
 * Every fixture is validated with the same validator used for generated
 * content; the script fails rather than writing an invalid seed.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildSeedSql } from "../lib/fixtures/seed-sql";

const target = join(process.cwd(), "supabase", "seed.sql");
writeFileSync(target, buildSeedSql());
console.log(`Wrote ${target}`);
