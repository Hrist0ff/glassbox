import type { Concept } from "@/lib/concept/schema";
import { binarySearch } from "./binary-search";
import { dnsResolution } from "./dns";
import { raftLeaderElection } from "./raft";

export type BundledFixture = {
  slug: string;
  concept: Concept;
  /** Lower-case keywords that select this fixture in local demo mode. */
  keywords: string[];
};

/**
 * Curated explanations bundled with the app. They are also seeded into
 * Supabase with the same ids (see `scripts/generate-seed.ts`).
 */
export const BUNDLED_FIXTURES: readonly BundledFixture[] = [
  { slug: "raft-leader-election", concept: raftLeaderElection, keywords: ["raft", "leader election", "consensus"] },
  { slug: "dns-resolution", concept: dnsResolution, keywords: ["dns", "domain name", "name resolution", "resolver"] },
  { slug: "binary-search", concept: binarySearch, keywords: ["binary search", "bisection", "binary-search"] },
];

export function findFixtureBySlug(slug: string): BundledFixture | undefined {
  return BUNDLED_FIXTURES.find((fixture) => fixture.slug === slug);
}

/** Demo-mode topic matching: plain keyword containment, no AI. */
export function matchFixtureForTopic(topic: string): BundledFixture | undefined {
  const normalized = topic.toLowerCase();
  return BUNDLED_FIXTURES.find((fixture) => fixture.keywords.some((k) => normalized.includes(k)));
}
