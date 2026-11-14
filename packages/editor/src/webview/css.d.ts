// Stylesheets are bundled by esbuild next to the webview script.
declare module "*.css";

// A `?worker` import is the bundled source of a web worker, inlined as text by esbuild.
declare module "*?worker" {
  const source: string;
  export default source;
}
