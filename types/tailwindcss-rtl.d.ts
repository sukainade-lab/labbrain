// tailwindcss-rtl ships no type declarations. It is a Tailwind plugin object
// (the value returned by tailwindcss/plugin). Declaring it here lets the ESM
// `import tailwindcssRtl from "tailwindcss-rtl"` in tailwind.config.ts typecheck
// without an implicit-any. The ESM import (not require) is required so the config
// loads under the webpack dev PostCSS path on Windows, where require() is
// undefined in the ESM module scope.
declare module "tailwindcss-rtl" {
  import type { PluginCreator } from "tailwindcss/types/config";
  const plugin: { handler: PluginCreator } | PluginCreator;
  export default plugin;
}
