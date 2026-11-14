import type { Profile } from "@lorequill/profile";

/** The check engine that CI runs differs from the one the editor bundles. */
export interface EngineMismatch {
  /** `checks.engine_version` of the profile: the engine of the pinned Action. */
  readonly expected: string;
  /** The engine bundled with this editor. */
  readonly actual: string;
}

/**
 * Compares the profile's declared CI engine with the bundled one (specification §14). Different
 * engines may report different findings, so the editor shows the mismatch instead of promising
 * equal results. A profile without `checks.engine_version` declares nothing to compare.
 */
export function engineMismatch(profile: Profile, actual: string): EngineMismatch | undefined {
  const expected = profile.checks?.engine_version;
  return expected === undefined || expected === actual ? undefined : { expected, actual };
}
