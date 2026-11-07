import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { windowsBuildEnvironment } from "./windows-env.mjs";

// --source accepts a saved production dsp.rs for a native before/after comparison.
const option = (name) =>
  process.argv
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
const output = path.resolve(
  option("out") ?? "artifacts/music-analysis/native.json",
);
const source = option("source");
let manifest = path.resolve("scripts/dsp-probe/Cargo.toml");
if (source) {
  const directory = path.resolve("artifacts/music-analysis/baseline-probe");
  await mkdir(directory, { recursive: true });
  const main = (await readFile("scripts/dsp-probe/main.rs", "utf8")).replaceAll(
    "../../src-tauri/src/dsp.rs",
    path.resolve(source).replaceAll("\\", "/"),
  );
  await writeFile(path.join(directory, "main.rs"), main);
  const referenceManifest = (await readFile(manifest, "utf8"))
    .replace('name = "soundspectra-dsp-probe"', 'name = "soundspectra-dsp-reference-probe"')
    .replace('name = "dsp-native-probe"', 'name = "dsp-reference-probe"');
  await writeFile(path.join(directory, "Cargo.toml"), referenceManifest);
  manifest = path.join(directory, "Cargo.toml");
}
const result = spawnSync(
  "cargo",
  [
    "run",
    "--quiet",
    "--manifest-path",
    manifest,
    "--target-dir",
    path.resolve("artifacts/music-analysis/native-target"),
  ],
  {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
    env:
      process.platform === "win32"
        ? windowsBuildEnvironment().env
        : process.env,
  },
);
if (result.status !== 0) throw new Error(result.stderr || String(result.error));
const data = JSON.parse(result.stdout);
const sourceBytes = await readFile(path.resolve(source ?? 'src-tauri/src/dsp.rs'));
let fingerprint = 0xcbf29ce484222325n;
for (const byte of sourceBytes) fingerprint = ((fingerprint ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
if (data.dspFingerprint !== fingerprint.toString(16).padStart(16, '0'))
  throw new Error('Probe binary does not match the requested DSP source; refusing stale measurements.');
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, result.stdout);
console.log(output);
