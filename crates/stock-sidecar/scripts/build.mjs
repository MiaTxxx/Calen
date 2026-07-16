import { copyFile, cp, mkdir, rm } from "node:fs/promises";

import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

const result = await build({
  entryPoints: ["src/stdio.mts"],
  outfile: "dist/stdio.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  minifySyntax: true,
  minifyWhitespace: true,
  legalComments: "external",
  metafile: true,
  logLevel: "info",
});

const output = Object.values(result.metafile.outputs).find((entry) =>
  entry.entryPoint?.endsWith("src/stdio.mts")
);
const unexpectedImports = (output?.imports ?? []).filter(
  (entry) => entry.external && !entry.path.startsWith("node:")
);
if (unexpectedImports.length) {
  throw new Error(
    `sidecar bundle contains external runtime dependencies: ${unexpectedImports
      .map((entry) => entry.path)
      .join(", ")}`
  );
}

await copyFile("NOTICE.md", "dist/NOTICE.md");
await cp("licenses", "dist/licenses", { recursive: true });
