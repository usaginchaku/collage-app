import { readFile, mkdir, copyFile, readdir, lstat } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const publicFiles = JSON.parse(
  await readFile(new URL("../public-files.json", import.meta.url), "utf8"),
);
if (
  !Array.isArray(publicFiles) ||
  new Set(publicFiles).size !== publicFiles.length ||
  publicFiles.some(
    (path) =>
      !/^(index\.html|assets\/icon\.svg|src\/[a-z-]+\.(js|css))$/.test(path),
  )
)
  throw new Error("Invalid public file allowlist");

export async function build() {
  const output = resolve(root, "dist");
  await mkdir(output, { recursive: true });
  if ((await lstat(output)).isSymbolicLink())
    throw new Error("Output directory cannot be a link");
  async function checkTree(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error("Build directory contains a link");
      if (entry.isDirectory()) await checkTree(path);
      else if (
        !publicFiles.includes(relative(output, path).replaceAll("\\", "/"))
      )
        throw new Error(
          "Unexpected file in build output; refusing to publish it",
        );
    }
  }
  // Do not delete unknown files. Fail closed instead of accidentally publishing them.
  await checkTree(output);
  for (const path of publicFiles) {
    const source = resolve(root, path);
    const parts = path.split("/");
    for (let i = 1; i <= parts.length; i++) {
      if ((await lstat(resolve(root, ...parts.slice(0, i)))).isSymbolicLink())
        throw new Error("Public source cannot contain a link");
    }
    if (!(await lstat(source)).isFile())
      throw new Error("Invalid public source");
    const target = resolve(output, path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }
  await checkTree(output);
  console.log(`Built ${publicFiles.length} allowlisted files`);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await build();
