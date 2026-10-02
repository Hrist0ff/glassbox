import type { Concept } from "@/lib/concept/schema";
import { binarySearch } from "./binary-search";
import { compoundInterest } from "./compound-interest";
import { dnsResolution } from "./dns";
import { httpVersions } from "./http-versions";
import { incidentTimeline } from "./incident-timeline";
import { raftLeaderElection } from "./raft";
import { usGovernment } from "./us-government";

export type BundledFixture = {
  slug: string;
  concept: Concept;
  /** Lower-case keywords that select this fixture in local demo mode. */
  keywords: string[];
};

/**
 * Curated explanations bundled with the app, shown under "Examples": message
 * flows and algorithms (version 1), and one example of each representation
 * added in version 2 (timeline lanes, comparison, hierarchy, chart).
 */
export const BUNDLED_FIXTURES: readonly BundledFixture[] = [
  { slug: "raft-leader-election", concept: raftLeaderElection, keywords: ["raft", "leader election", "consensus"] },
  { slug: "dns-resolution", concept: dnsResolution, keywords: ["dns", "domain name", "name resolution", "resolver"] },
  { slug: "binary-search", concept: binarySearch, keywords: ["binary search", "bisection", "binary-search"] },
  { slug: "incident-timeline", concept: incidentTimeline, keywords: ["incident", "outage", "postmortem", "timeline"] },
  { slug: "http-versions", concept: httpVersions, keywords: ["http/2", "http/3", "http versions", "http 2", "http 3", "quic"] },
  { slug: "us-government", concept: usGovernment, keywords: ["government", "branches", "congress", "federal"] },
  { slug: "compound-interest", concept: compoundInterest, keywords: ["compound interest", "simple interest", "interest"] },
];

export function findFixtureBySlug(slug: string): BundledFixture | undefined {
  return BUNDLED_FIXTURES.find((fixture) => fixture.slug === slug);
}

/** Demo-mode topic matching: plain keyword containment, no AI. */
export function matchFixtureForTopic(topic: string): BundledFixture | undefined {
  const normalized = topic.toLowerCase();
  return BUNDLED_FIXTURES.find((fixture) => fixture.keywords.some((k) => normalized.includes(k)));
}
