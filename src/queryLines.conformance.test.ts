import { describe, it } from "node:test";
import { assertQueryLineConformance } from "@plurnk/plurnk-mimetypes/conformance";
import Handler from "./TextR.ts";

const h = new Handler({"mimetype":"text/x-r","glyph":"📊","extensions":[".R",".r"]});

describe("#41 query-line conformance", () => {
    it("every structural match carries a source-line span", async () => {
        await assertQueryLineConformance(h, [{ source: "x <- 1\nf <- function(a, b) {\n  a + b\n}\n", dialect: "jsonpath", pattern: "$..*" }]);
    });
});
