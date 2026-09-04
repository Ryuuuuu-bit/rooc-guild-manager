// fontkit ships no TypeScript types of its own (and none exist on
// @types/fontkit either) — this is a minimal any-typed ambient shim just
// so `import fontkit from "fontkit"` type-checks. Only the two calls this
// project actually makes (`openSync`, `.hasGlyphForCodePoint`) are used;
// keeping the shim untyped avoids pretending to model the rest of its API.
declare module "fontkit";
