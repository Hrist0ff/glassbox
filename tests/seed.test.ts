import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ARENA, LABEL, LIMITS, SAFE_ZONE } from "@/lib/concept/constants";
import { insideArena, labelBox, nodeBox } from "@/lib/concept/geometry";
import { buildSeedSql } from "@/lib/fixtures/seed-sql";

describe("seed", () => {
  it("supabase/seed.sql is up to date with the fixtures (run `npm run seed:generate`)", () => {
    const onDisk = readFileSync(join(process.cwd(), "supabase", "seed.sql"), "utf8");
    expect(onDisk).toBe(buildSeedSql());
  });
});

describe("safe zone", () => {
  it("fits the widest possible label at every corner, as promised to the generator", () => {
    const widest = "W".repeat(LABEL.maxLineChars) + " " + "W".repeat(LIMITS.label.max - LABEL.maxLineChars - 1);
    for (const x of [SAFE_ZONE.minX, SAFE_ZONE.maxX]) {
      for (const y of [SAFE_ZONE.minY, SAFE_ZONE.maxY]) {
        const node = { x, y, label: widest };
        expect(insideArena(nodeBox(node)), `node at ${x},${y}`).toBe(true);
        expect(insideArena(labelBox(node)), `label at ${x},${y}`).toBe(true);
      }
    }
    expect(SAFE_ZONE.maxX).toBeLessThan(ARENA.width);
  });
});
