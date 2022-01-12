/* eslint-env node */

import dts from "rollup-plugin-dts";

// We only use rollup for creating a bundled d.ts file.
// We use esbuild for building the actual code.

export default {
  input: "out/.dts/client.d.ts",
  output: {
    file: `./out/client.d.ts`,
  },
  plugins: [dts()],
};
