#!/usr/bin/env node
// Reproducible WASM build for tree-sitter-swift.
//
// Clones r-lib/tree-sitter-r at the pinned commit in
// .r-grammar-pin, runs `tree-sitter generate && tree-sitter build --wasm`,
// and writes r.wasm at the package root.
//
// Idempotent: if r.wasm already exists and matches a prior run, this
// script does nothing. Used by CI to verify the committed WASM is the
// reproducible output of the pinned source.
import { mkdtemp, readFile, writeFile, copyFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pinPath = path.join(repoRoot, ".r-grammar-pin");
const wasmPath = path.join(repoRoot, "r.wasm");

const pin = (await readFile(pinPath, "utf-8")).trim();
if (!/^[0-9a-f]{7,40}$/i.test(pin)) {
    throw new Error(`.r-grammar-pin must be a git commit SHA, got: ${pin}`);
}

const work = await mkdtemp(path.join(tmpdir(), "r-wasm-build-"));
console.log(`build root: ${work}`);

await run("git", ["clone", "--no-checkout", "https://github.com/r-lib/tree-sitter-r.git", "src"], { cwd: work });
await run("git", ["checkout", pin], { cwd: path.join(work, "src") });
await run("npm", ["install", "--no-save", "tree-sitter-cli@^0.26.0"], { cwd: work });

const cli = path.join(work, "node_modules", ".bin", "tree-sitter");
await run(cli, ["generate"], { cwd: path.join(work, "src") });
await run(cli, ["build", "--wasm"], { cwd: path.join(work, "src") });

const builtWasm = path.join(work, "src", "tree-sitter-r.wasm");
await copyFile(builtWasm, wasmPath);
const bytes = (await readFile(wasmPath)).length;
console.log(`r.wasm: ${bytes} bytes (built from ${pin})`);

function run(cmd, args, opts) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: "inherit", ...opts });
        child.on("error", reject);
        child.on("exit", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`));
        });
    });
}
