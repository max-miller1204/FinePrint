// Reads the CAPTIONS object out of src/script.ts without a TypeScript toolchain.
import { readFileSync } from "node:fs";

export const readCaptions = () => {
  const src = readFileSync(new URL("../src/script.ts", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("{", src.indexOf("CAPTIONS")));
  return new Function(`return ${body.trim().replace(/;$/, "")}`)();
};
