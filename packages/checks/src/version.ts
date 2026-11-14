import packageJson from "../package.json" with { type: "json" };

/**
 * Version of the check engine, reported in every result (specification §14). It is the version
 * of `@lorequill/checks`, which every bundle (extension, CLI, Action) inlines at build time.
 */
export const ENGINE_VERSION: string = packageJson.version;
