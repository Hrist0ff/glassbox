import type { PipelineRole } from "./llm";

/**
 * Time budget for one request-scoped generation.
 *
 * Hosting: the route declares `maxDuration = 300` (seconds). The server
 * deadline defaults to 270 s, leaving headroom below the platform limit, and
 * `reserveMs` of that is kept for persistence and the terminal event.
 */
export const BUDGET = {
  reserveMs: 12_000,
  calls: {
    // Planning with a reasoning model regularly takes 20–60 s; 90 s leaves headroom.
    extractor: { preferredMs: 90_000, minMs: 15_000 },
    generator: { preferredMs: 110_000, minMs: 30_000 },
    evaluator: { preferredMs: 60_000, minMs: 15_000 },
  } satisfies Record<PipelineRole, { preferredMs: number; minMs: number }>,
} as const;

export class BudgetExhaustedError extends Error {
  constructor(readonly role: PipelineRole) {
    super(`Not enough time left for the ${role}`);
    this.name = "BudgetExhaustedError";
  }
}

export class Deadline {
  private readonly startedAt: number;

  constructor(
    readonly totalMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.startedAt = now();
  }

  elapsedMs(): number {
    return this.now() - this.startedAt;
  }

  remainingMs(): number {
    return this.totalMs - this.elapsedMs();
  }

  expired(): boolean {
    return this.remainingMs() <= 0;
  }

  /** Timeout for one provider call, never past the reserve. Throws if below the role's minimum. */
  callTimeout(role: PipelineRole): number {
    const { preferredMs, minMs } = BUDGET.calls[role];
    const available = this.remainingMs() - BUDGET.reserveMs;
    if (available < minMs) throw new BudgetExhaustedError(role);
    return Math.min(preferredMs, available);
  }

  /** A generation attempt needs room for at least a minimal generate + evaluate. */
  canStartAttempt(): boolean {
    return this.remainingMs() - BUDGET.reserveMs >= BUDGET.calls.generator.minMs + BUDGET.calls.evaluator.minMs;
  }
}
