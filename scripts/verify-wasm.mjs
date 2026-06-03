#!/usr/bin/env node
// Verifies the committed r.wasm is byte-identical to what the pinned
// source rebuilds to. CI runs this on every PR to catch tampering.
import { mkdtemp, readFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pin = (await readFile(path.join(repoRoot, ".r-grammar-pin"), "utf-8")).trim();
const committedBytes = await readFile(path.join(repoRoot, "r.wasm"));
const committedHash = createHash("sha256").update(committedBytes).digest("hex");
console.log(`committed r.wasm sha256: ${committedHash}`);

const work = await mkdtemp(path.join(tmpdir(), "r-wasm-verify-"));
await run("git", ["clone", "--no-checkout", "https://github.com/r-lib/tree-sitter-r.git", "src"], { cwd: work });
await run("git", ["checkout", pin], { cwd: path.join(work, "src") });
await run("npm", ["install", "--no-save", "tree-sitter-cli@^0.26.0"], { cwd: work });
const cli = path.join(work, "node_modules", ".bin", "tree-sitter");
await run(cli, ["generate"], { cwd: path.join(work, "src") });
await run(cli, ["build", "--wasm"], { cwd: path.join(work, "src") });

const rebuiltBytes = await readFile(path.join(work, "src", "tree-sitter-r.wasm"));
const rebuiltHash = createHash("sha256").update(rebuiltBytes).digest("hex");
console.log(`rebuilt r.wasm sha256: ${rebuiltHash}`);

if (committedHash !== rebuiltHash) {
    console.error("FAIL: committed r.wasm does not match rebuild from pinned source");
    process.exit(1);
}
console.log("OK: bytes identical");

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
