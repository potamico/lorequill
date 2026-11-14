import type { BuildOptions, BuildResult, Plugin } from "esbuild";

export declare const browser: BuildOptions;
export declare function buildWorker(
  entryPoint: string,
): Promise<BuildResult<{ write: false; metafile: true }>>;
export declare const inlineWorker: Plugin;
