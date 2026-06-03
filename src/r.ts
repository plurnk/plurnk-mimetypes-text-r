import type { MimeSymbol, SymbolKind, TreeSitterNode } from "@plurnk/plurnk-mimetypes";

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
export function extract(root: TreeSitterNode): MimeSymbol[] {
    const out: MimeSymbol[] = [];
    for (let i = 0; i < root.namedChildCount; i += 1) {
        const child = root.namedChild(i);
        if (!child) continue;
        dispatch(child, out);
    }
    return out;
}

function dispatch(node: TreeSitterNode, out: MimeSymbol[]): void {
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

function handleAssignment(node: TreeSitterNode, out: MimeSymbol[], reversed: boolean): void {
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
            line: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            params: extractParams(valueSide.childForFieldName("parameters")),
        });
        return;
    }

    // Non-function assignment: variable or constant.
    const kind: SymbolKind = isScreamingSnake(name) ? "constant" : "variable";
    out.push({
        name,
        kind,
        line: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
    });
}

function handleCall(node: TreeSitterNode, out: MimeSymbol[]): void {
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
        line: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
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
