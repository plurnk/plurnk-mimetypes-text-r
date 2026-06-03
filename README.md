# @plurnk/plurnk-mimetypes-text-r

`text/x-r` mimetype handler for the [plurnk](https://github.com/plurnk) ecosystem. Tier 2 — uses the [r-lib/tree-sitter-r](https://github.com/r-lib/tree-sitter-r) grammar built to WASM and shipped pre-built (468 KB).

## install

```
npm i @plurnk/plurnk-mimetypes-text-r
```

No build tools required at install time.

## what it does

R's syntactic uniformity (everything is an expression, assignment is just a binary operator) means symbol extraction operates on binary_operator nodes and discriminates by the right-hand side:

- `name <- function(...)` / `name = function(...)` / `name <- \(...) ...` → **function** (or **method** if `name` matches the S3 `generic.Class` pattern)
- `name <- value` with SCREAMING_SNAKE_CASE → **constant**
- `name <- value` otherwise → **variable**
- `expr -> name` (right-assignment) → same dispatch with sides swapped
- `setClass(name, ...)` → **class** (S4)
- `setGeneric(name, ...)` → **function** (S4)
- `setMethod(name, ...)` → **method** (S4)

Three channels per the framework's #10 contract:
- **symbols** — described above
- **deep-json** — inherited from `TreeSitterExtractor`: full named-children walk of the R parse tree
- **deep-xml** — framework-projected

## coverage

Validated against R 4.1+ idioms:
- Both assignment styles (`<-` and `=`)
- Lambda syntax (`\(x) x * x`)
- Variadic params (`...`)
- Tidyverse pipe chains (`%>%` and native `|>`)
- S3 object system (method dispatch by `name.Class` convention)
- S4 object system (`setClass` / `setGeneric` / `setMethod`)

## license

MIT.
