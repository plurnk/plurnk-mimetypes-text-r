import { treeSitterSpan } from "@plurnk/plurnk-mimetypes";
import type { SymbolKind, TreeSitterNode, TreeSitterSymbolProjection } from "@plurnk/plurnk-mimetypes";

// R SPEC §3 mapping for tree-sitter-r.
//
// R's uniform syntax: assignment is a `binary_operator` with `<-` or `=`.
// We walk top-level statements and discriminate by rhs:
//
//   binary_operator (<- or =) with lhs: identifier:
//     rhs: function_definition → function (or method if name contains dot — S3)
//     rhs: anything else       → variable / constant (SCREAMING_SNAKE → constant)
//
//   top-level call to setClass(name, ...)  → class
//   top-level call to setGeneric(name, ...) → function
//   top-level call to setMethod(name, ...)  → method
//
// Right-assignment (->) is also handled — it has the same shape with lhs/rhs
// swapped.
export function extract(root: TreeSitterNode): TreeSitterSymbolProjection[] {
    const out: TreeSitterSymbolProjection[] = [];
    for (let i = 0; i < root.namedChildCount; i += 1) {
        const child = root.namedChild(i);
        if (!child) continue;
        dispatch(child, out);
    }
    return out;
}

function dispatch(node: TreeSitterNode, out: TreeSitterSymbolProjection[]): void {
    if (node.type === "binary_operator") {
        const op = operatorOf(node);
        if (op === "<-" || op === "=" || op === "<<-") {
            handleAssignment(node, out, /*reversed*/ false);
            return;
        }
        if (op === "->" || op === "->>") {
            handleAssignment(node, out, /*reversed*/ true);
            return;
        }
        return;
    }
    if (node.type === "call") {
        handleCall(node, out);
    }
}

function handleAssignment(node: TreeSitterNode, out: TreeSitterSymbolProjection[], reversed: boolean): void {
    // For `x <- expr`, lhs=x, rhs=expr; for `expr -> x`, lhs=expr, rhs=x.
    const nameSide = reversed
        ? node.childForFieldName("rhs")
        : node.childForFieldName("lhs");
    const valueSide = reversed
        ? node.childForFieldName("lhs")
        : node.childForFieldName("rhs");
    if (!nameSide || nameSide.type !== "identifier") return;
    const name = nameSide.text;

    if (valueSide && valueSide.type === "function_definition") {
        const isS3Method = name.includes(".") && !name.startsWith(".");
        out.push({
            name,
            kind: isS3Method ? "method" : "function",
            span: treeSitterSpan(node),
            params: extractParams(valueSide.childForFieldName("parameters")),
        });
        return;
    }

    // Non-function assignment: variable or constant.
    const kind: SymbolKind = isScreamingSnake(name) ? "constant" : "variable";
    out.push({
        name,
        kind,
        span: treeSitterSpan(node),
    });
}

function handleCall(node: TreeSitterNode, out: TreeSitterSymbolProjection[]): void {
    const fn = node.childForFieldName("function");
    if (!fn || fn.type !== "identifier") return;
    const fnName = fn.text;
    if (fnName !== "setClass" && fnName !== "setGeneric" && fnName !== "setMethod") return;

    const args = node.childForFieldName("arguments");
    if (!args) return;
    const firstArgValue = firstArgumentValue(args);
    if (!firstArgValue) return;

    const declaredName = stringContentOf(firstArgValue);
    if (!declaredName) return;

    const kindMap: Record<string, SymbolKind> = {
        setClass: "class",
        setGeneric: "function",
        setMethod: "method",
    };
    out.push({
        name: declaredName,
        kind: kindMap[fnName],
        span: treeSitterSpan(node),
    });
}

// In tree-sitter-r, binary_operator's actual operator token sits between lhs
// and rhs as a child of the node — we identify it by checking children types.
function operatorOf(node: TreeSitterNode): string | null {
    const OPS = new Set(["<-", "=", "<<-", "->", "->>", "<-?"]);
    for (let i = 0; i < node.childCount; i += 1) {
        const child = node.child(i);
        if (!child) continue;
        if (OPS.has(child.type)) return child.type;
    }
    return null;
}

function extractParams(parametersNode: TreeSitterNode | null): string[] {
    if (!parametersNode) return [];
    const out: string[] = [];
    for (let i = 0; i < parametersNode.namedChildCount; i += 1) {
        const child = parametersNode.namedChild(i);
        if (!child || child.type !== "parameter") continue;
        const name = child.childForFieldName("name");
        if (!name) continue;
        if (name.type === "identifier") out.push(name.text);
        else if (name.type === "dots") out.push("...");
    }
    return out;
}

function firstArgumentValue(args: TreeSitterNode): TreeSitterNode | null {
    for (let i = 0; i < args.namedChildCount; i += 1) {
        const child = args.namedChild(i);
        if (child && child.type === "argument") {
            return child.childForFieldName("value");
        }
    }
    return null;
}

function stringContentOf(node: TreeSitterNode): string | null {
    if (node.type === "string") {
        for (let i = 0; i < node.namedChildCount; i += 1) {
            const sub = node.namedChild(i);
            if (sub && sub.type === "string_content") return sub.text;
        }
    }
    return null;
}

function isScreamingSnake(name: string): boolean {
    if (name.length < 2) return false;
    let hasLetter = false;
    for (const c of name) {
        if (c >= "A" && c <= "Z") hasLetter = true;
        else if (c === "_" || (c >= "0" && c <= "9")) continue;
        else return false;
    }
    return hasLetter;
}

// References query for tree-sitter-r (SPEC §16). R is syntactically uniform —
// "everything is a call" — but the only high-confidence, name-join-resolvable
// edge is the function CALL. We emit two shapes of `call`, both precision-first:
//
//   call function: (identifier)                    → call (plain free call: foo())
//   call function: (namespace_operator rhs:)       → call (pkg::fn() / pkg:::fn())
//
// Deliberately NOT emitted (precision over recall, SPEC §16):
//   - member calls `obj$method()` — the function slot is an extract_operator,
//     not a bound function name; the receiver is a runtime value, not joinable.
//   - bare identifier reads (the reserved `use` kind).
//   - `library(pkg)` / `require(pkg)` surface as ordinary `library` calls whose
//     argument is a bare identifier read — not emitted as an import edge (R has
//     no bound import symbol to join on; the package name is a dead row at best).
export const refsQuery = `
(call function: (identifier) @ref.call)
(call function: (namespace_operator rhs: (identifier) @ref.call))
`;
