import { copyFile, mkdir } from "node:fs/promises";

const source = new URL("../src-tauri/icons/64x64.png", import.meta.url);
const targetDirectory = new URL("../frontend/src/assets/", import.meta.url);
const target = new URL("app-icon.png", targetDirectory);

await mkdir(targetDirectory, { recursive: true });
await copyFile(source, target);
