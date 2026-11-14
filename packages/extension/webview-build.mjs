import { build } from "esbuild";
import path from "node:path";

/** Shared settings of the webview's browser bundles. */
export const browser = {
  bundle: true,
  platform: "browser",
  target: "es2022",
  logLevel: "info",
};

/** Builds a web worker script; a unit test runs the result without a DOM. */
export function buildWorker(entryPoint) {
  return build({
    ...browser,
    entryPoints: [entryPoint],
    format: "iife",
    // Packages such as `decode-named-character-reference` have a DOM variant for browsers;
    // a worker has no DOM and needs their worker variant.
    conditions: ["worker"],
    // Inlined as a string, where readable code only costs size.
    minify: true,
    write: false,
    metafile: true,
    logLevel: "silent",
  });
}

/**
 * `import source from "./file?worker"` bundles `file.ts` as a separate web worker script and
 * inlines it as text, so the webview can start it from a blob URL without loading another file.
 */
export const inlineWorker = {
  name: "inline-worker",
  setup(pluginBuild) {
    // The path is kept relative to the working directory: esbuild writes it into the bundle as a
    // comment, and an absolute path would make the bundle differ between machines.
    pluginBuild.onResolve({ filter: /\?worker$/ }, (args) => ({
      path: path
        .relative(
          process.cwd(),
          path.resolve(args.resolveDir, `${args.path.slice(0, -"?worker".length)}.ts`),
        )
        .split(path.sep)
        .join("/"),
      namespace: "inline-worker",
    }));
    pluginBuild.onLoad({ filter: /.*/, namespace: "inline-worker" }, async (args) => {
      const result = await buildWorker(path.resolve(args.path));
      return {
        contents: `export default ${JSON.stringify(result.outputFiles[0].text)};`,
        loader: "js",
        watchFiles: Object.keys(result.metafile.inputs).map((input) => path.resolve(input)),
      };
    });
  },
};
