import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertHandlerConformance } from "@plurnk/plurnk-mimetypes/conformance";
import TextR from "./TextR.ts";

const metadata = { mimetype: "text/x-r", glyph: "📊", extensions: [".R", ".r"] };
const h = () => new TextR(metadata);

// Real-world tidyverse-flavoured R: local helpers, free calls into those
// helpers, namespaced calls (dplyr::, stats::), and an S3 method. Decoy names
// "secret" and "TODO" live only inside a string and a comment.
const SRC = `library(dplyr)

normalize <- function(x) {
  (x - mean(x)) / sd(x)
}

summarize_frame <- function(df) {
  # TODO: handle the empty-frame case
  scaled <- normalize(df$value)
  out <- dplyr::mutate(df, z = scaled)
  stats::sd(out$z)
}

print.report <- function(x, ...) {
  message("secret diagnostics")
  summarize_frame(x$data)
}
`;

describe("TextR — references", () => {
    it("plain free calls are call edges scoped to the enclosing function", async () => {
        const refs = await h().references(SRC);
        assert.ok(refs.some((r) => r.name === "normalize" && r.kind === "call" && r.container === "summarize_frame"));
        assert.ok(refs.some((r) => r.name === "mean" && r.kind === "call" && r.container === "normalize"));
        assert.ok(refs.some((r) => r.name === "sd" && r.kind === "call" && r.container === "normalize"));
    });

    it("namespaced pkg::fn calls capture the function name as a call edge", async () => {
        const refs = await h().references(SRC);
        assert.ok(refs.some((r) => r.name === "mutate" && r.kind === "call" && r.container === "summarize_frame"));
        assert.ok(refs.some((r) => r.name === "sd" && r.kind === "call" && r.container === "summarize_frame"));
    });

    it("a call into a local function joins the local def by container/name", async () => {
        const refs = await h().references(SRC);
        // print.report is an S3 method; the call to summarize_frame inside it
        // resolves to the top-level function def of the same name.
        assert.ok(refs.some((r) => r.name === "summarize_frame" && r.kind === "call" && r.container === "print.report"));
    });

    it("member calls and string/comment content do not surface as refs", async () => {
        const refs = await h().references(SRC);
        assert.ok(!refs.some((r) => r.name === "secret"));
        assert.ok(!refs.some((r) => r.name === "TODO"));
    });

    it("passes the SPEC §16 conformance invariants", async () => {
        await assertHandlerConformance(h(), {
            source: SRC,
            decoyNames: ["secret", "TODO"],
            expectJoins: [
                { refName: "normalize", container: "summarize_frame" },
                { refName: "summarize_frame", container: "print.report" },
            ],
            expectRefs: [
                { name: "normalize", kind: "call" },
                { name: "mutate", kind: "call" },
            ],
        });
    });
});
