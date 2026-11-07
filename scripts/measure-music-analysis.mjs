import ts from "typescript";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const option = (name) =>
  process.argv
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
const root = path.resolve(option("root") ?? "src/features/spectrum");
const input = path.resolve(
  option("input") ?? "artifacts/music-analysis/native.json",
);
const output = path.resolve(
  option("out") ?? "artifacts/music-analysis/measurements.json",
);
const compiled = path.resolve(`${output}.modules`);
const legacyInput = process.argv.includes("--legacy");
const visited = new Set();
async function compile(file) {
  const relative = path.relative(root, file).replace(/\.tsx?$/, ".mjs");
  const destination = path.join(compiled, relative);
  if (visited.has(file)) return destination;
  visited.add(file);
  let js = ts.transpileModule(await readFile(file, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  const imports = [...js.matchAll(/from\s+(['"])(\.[^'"]+)\1/g)];
  for (const match of imports) {
    const dependency = path.resolve(path.dirname(file), `${match[2]}.ts`);
    await compile(dependency);
    js = js.replace(match[0], `from '${match[2]}.mjs'`);
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, js);
  return destination;
}
const { createMusicDriver } = await import(
  pathToFileURL(
    await compile(path.join(root, "music-engine/effects/musicDriver.ts")),
  )
);
const { SceneMotion } = await import(
  pathToFileURL(await compile(path.join(root, "three/motion.ts")))
);
const { defaultMusicSettings } = await import(
  pathToFileURL(await compile(path.join(root, "music-engine/catalog.ts")))
);
const data = JSON.parse(await readFile(input, "utf8"));
const results = [];
for (const fixture of data.cases) {
  const driver = createMusicDriver(),
    motion = new SceneMotion(),
    onsets = [],
    trace = [];
  let frame;
  for (const { audio } of fixture.frames) {
    const time = (audio.samplePosition / audio.sampleRate) * 1000;
    frame = driver.updateAudio(
      { ...audio, audible: legacyInput ? audio.rms > 0.006 : undefined },
      time,
      1,
      undefined,
      true,
    );
    motion.step(audio, data.hop / data.rate, defaultMusicSettings, false, {
      ...frame,
      onset: false,
    });
    if (frame.onset)
      onsets.push({
        time,
        strength: frame.beatStrength,
        transients: frame.transients,
      });
    trace.push({
      time,
      volume: motion.volume,
      maximumLevel: Math.max(...frame.levels),
      pulse: frame.pulse,
      presence: motion.presence,
    });
  }
  const audio = fixture.frames.at(-1).audio;
  results.push({
    name: fixture.name,
    rms: audio.rms,
    bands: audio.bands,
    bandRms: audio.bandRms,
    audible: frame.audible,
    intensity: frame.intensity,
    displayIntensity: frame.displayIntensity,
    displayPresence: frame.displayPresence,
    levels: frame.levels,
    relativeLevels: frame.relativeLevels,
    onsets,
    trace,
  });
}
await mkdir(path.dirname(output), { recursive: true });
await writeFile(
  output,
  JSON.stringify({ input, root, legacyInput, dspFingerprint: data.dspFingerprint, results }, null, 2),
);
console.log(output);
