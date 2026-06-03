import { describe, it } from "node:test";
import assert from "node:assert/strict";
import TextR from "./TextR.ts";

const metadata = {
    mimetype: "text/x-r",
    glyph: "📊",
    extensions: [".R", ".r"] as const,
};

const h = () => new TextR(metadata);

describe("TextR — function assignments", () => {
    it("name <- function(...) → function", async () => {
        const syms = await h().extractRaw("add <- function(a, b) a + b\n");
        const fn = syms.find((s) => s.name === "add");
        assert.equal(fn?.kind, "function");
        assert.deepEqual(fn?.params, ["a", "b"]);
    });

    it("name = function(...) → function (=-style assignment)", async () => {
        const syms = await h().extractRaw("add = function(a, b) a + b\n");
        assert.equal(syms.find((s) => s.name === "add")?.kind, "function");
    });

    it("right-assignment of a value: expr -> name → variable", async () => {
        // `f(x) -> result` is a real R idiom (often at end of pipe chains).
        // Right-assignment of an unparenthesized function literal isn't valid
        // R syntax — the `->` binds to the function body, not the function
        // itself — so we don't test that case.
        const syms = await h().extractRaw("1 + 2 -> answer\n");
        assert.equal(syms.find((s) => s.name === "answer")?.kind, "variable");
    });

    it("R 4.1+ lambda backslash syntax", async () => {
        const syms = await h().extractRaw("square <- \\(x) x * x\n");
        const fn = syms.find((s) => s.name === "square");
        assert.equal(fn?.kind, "function");
        assert.deepEqual(fn?.params, ["x"]);
    });

    it("variadic params surface as ...", async () => {
        const syms = await h().extractRaw("logger <- function(msg, ...) cat(msg)\n");
        const fn = syms.find((s) => s.name === "logger");
        assert.deepEqual(fn?.params, ["msg", "..."]);
    });
});

describe("TextR — variable / constant", () => {
    it("SCREAMING_SNAKE_CASE → constant", async () => {
        const syms = await h().extractRaw("MAX_ITERATIONS <- 1000L\n");
        assert.equal(syms.find((s) => s.name === "MAX_ITERATIONS")?.kind, "constant");
    });

    it("regular lowercase → variable", async () => {
        const syms = await h().extractRaw("x <- 1\npi_approx <- 3.14\n");
        assert.equal(syms.find((s) => s.name === "x")?.kind, "variable");
        assert.equal(syms.find((s) => s.name === "pi_approx")?.kind, "variable");
    });
});

describe("TextR — S3 methods", () => {
    it("name.Class <- function(...) → method (S3 convention)", async () => {
        const syms = await h().extractRaw("print.Dog <- function(x, ...) cat(x$name)\n");
        const m = syms.find((s) => s.name === "print.Dog");
        assert.equal(m?.kind, "method");
    });

    it("leading-dot identifiers don't get S3 treatment", async () => {
        // .hidden is a convention for private/hidden — not an S3 method
        const syms = await h().extractRaw(".hidden <- function() NULL\n");
        assert.equal(syms.find((s) => s.name === ".hidden")?.kind, "function");
    });
});

describe("TextR — S4 setClass/setGeneric/setMethod", () => {
    it("setClass → class", async () => {
        const syms = await h().extractRaw('setClass("Person", representation(name = "character"))\n');
        assert.equal(syms.find((s) => s.name === "Person")?.kind, "class");
    });

    it("setGeneric → function", async () => {
        const syms = await h().extractRaw('setGeneric("greet", function(x) standardGeneric("greet"))\n');
        assert.equal(syms.find((s) => s.name === "greet")?.kind, "function");
    });

    it("setMethod → method", async () => {
        const syms = await h().extractRaw('setMethod("greet", "Person", function(x) paste("hi"))\n');
        assert.equal(syms.find((s) => s.name === "greet")?.kind, "method");
    });
});

describe("TextR — real-world fixtures", () => {
    it("tidyverse pipe chains don't crash extraction", async () => {
        const src = [
            "library(dplyr)",
            "result <- mtcars %>% filter(mpg > 20) %>% group_by(cyl) %>% summarize(avg = mean(hp))",
            "result2 <- mtcars |> head(5)",
        ].join("\n");
        const syms = await h().extractRaw(src);
        assert.equal(syms.find((s) => s.name === "result")?.kind, "variable");
        assert.equal(syms.find((s) => s.name === "result2")?.kind, "variable");
    });

    it("mixed S3 + S4 + functions surfaces appropriately", async () => {
        const src = [
            'setClass("Person", representation(name = "character"))',
            'setGeneric("greet", function(x) standardGeneric("greet"))',
            "make_dog <- function(name) { obj <- list(name = name); class(obj) <- 'Dog'; obj }",
            "print.Dog <- function(x, ...) cat(x$name)",
        ].join("\n");
        const syms = await h().extractRaw(src);
        assert.equal(syms.find((s) => s.name === "Person")?.kind, "class");
        assert.equal(syms.find((s) => s.name === "greet")?.kind, "function");
        assert.equal(syms.find((s) => s.name === "make_dog")?.kind, "function");
        assert.equal(syms.find((s) => s.name === "print.Dog")?.kind, "method");
    });
});

describe("TextR — error handling", () => {
    it("empty input → []", async () => {
        assert.deepEqual(await h().extractRaw(""), []);
    });

    it("doesn't throw on malformed source", async () => {
        await assert.doesNotReject(h().extractRaw("function ((( broken"));
    });

    it("binary content → []", async () => {
        assert.deepEqual(await h().extractRaw(new Uint8Array([1, 2, 3])), []);
    });
});

describe("TextR — deep-json channel", () => {
    it("returns parse tree with native node types", async () => {
        const tree = await h().deepJson("x <- 1\n") as { type: string; children?: unknown[] };
        assert.equal(tree.type, "program");
        assert.ok(Array.isArray(tree.children));
    });
});
