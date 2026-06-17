import { TreeSitterExtractor } from "@plurnk/plurnk-mimetypes";
import type {
    HandlerContent,
    MimeRef,
    MimeSymbol,
    QueryConstructor,
    TreeSitterNode,
    TreeSitterParser,
    TreeSitterTree,
} from "@plurnk/plurnk-mimetypes";
import { extract, refsQuery } from "./r.ts";

// text/x-r handler. Tier 2 — tree-sitter-r grammar built to WASM at publish
// time and shipped alongside this code. Validated against R 4.1+ idioms
// including native pipes (|>), lambdas (\(x)), S3/S4 object systems, and
// tidyverse-style code.
//
// R's syntactic uniformity (everything is an expression, assignment is just
// a binary operator) means symbol extraction operates on binary_operator
// nodes whose lhs is an identifier — emitting function or variable/constant
// based on the rhs shape. See src/r.ts for the full mapping.
export default class TextR extends TreeSitterExtractor {
    protected async loadParser(): Promise<TreeSitterParser> {
        const ts = await import("web-tree-sitter" as string) as {
            Parser: {
                init(): Promise<void>;
                new (): { setLanguage(lang: unknown): void; parse(content: string): unknown };
            };
            Language: {
                load(wasmPath: string): Promise<unknown>;
            };
            Query: QueryConstructor;
        };
        await ts.Parser.init();
        const wasmUrl = new URL("../r.wasm", import.meta.url);
        const lang = await ts.Language.load(wasmUrl.pathname);
        this.setQueryContext(lang, ts.Query);
        const parser = new ts.Parser();
        parser.setLanguage(lang);
        return parser as unknown as TreeSitterParser;
    }

    protected extractFromTree(tree: TreeSitterTree, _content: HandlerContent): MimeSymbol[] {
        return extract(tree.rootNode);
    }

    // References channel (SPEC §16): function call edges (plain + pkg::fn).
    // The base collectRefs() owns parse/compile/run/cleanup; every capture is a
    // direct identifier whose container resolves by line containment.
    override references(content: HandlerContent): Promise<MimeRef[]> {
        return this.collectRefs(content, refsQuery, (root) => extract(root));
    }
}
