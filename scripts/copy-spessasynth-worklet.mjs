import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(projectRoot, "node_modules", "spessasynth_lib", "dist", "spessasynth_processor.min.js");
const destinationDirectory = path.join(projectRoot, "public");
const destination = path.join(destinationDirectory, "spessasynth_processor.min.js");

await mkdir(destinationDirectory, { recursive: true });
await copyFile(source, destination);
