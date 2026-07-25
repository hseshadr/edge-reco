# @edgeproc/errors

**One error system for a whole app.** Every failure gets a stable **code**, one
`classify()` turns raw failures (an HTTP 402, a thrown `AbortError`, a dead
network) into that code, and your app renders it through its own translations.
No more the-same-402-says-three-different-things.

It is thin glue over two mature standards, not a new framework:

- **[i18next](https://www.i18next.com/)** owns the human descriptions (you pass
  in its `t` — it stays an _optional_ peer, never bundled).
- **[RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457)** owns the
  wire shape.

Zero runtime dependencies. The only new code is ~200 lines: register a catalog,
and classify a raw failure into a code.

## The problem, in one line

The same HTTP `402` becomes _"out of credits"_ in Settings and a misleading
_"check your model and endpoint"_ in chat, because each `catch` block
re-invents the message. This collapses that N-way drift to one answer.

## Quickstart — run it now

```bash
# Node >= 22.13 and pnpm. From the repo root:
pnpm install && pnpm demo
```

You'll see a raw `402` classified into `ai.provider.out_of_credits`, rendered in
English and Spanish, and serialized to RFC 9457 — the exact loop below.

### Register your errors

```ts
import { defineErrors, starterPack } from "@edgeproc/errors";

// Start from the 18 universal codes, add your own on top.
export const errors = defineErrors({
  ...starterPack,
  "shop.out_of_stock": {
    category: "provider",
    params: ["sku"], // the typed contract for this code's params
    en: "Sorry, {sku} is sold out.",
  },
});
```

### Classify a raw failure at the boundary

```ts
try {
  await callProvider();
} catch (err) {
  const code = errors.classify(err); // e.g. { status: 402 } -> "ai.provider.out_of_credits"
  showError(errors.describe(code, {}, t)); // render via YOUR i18next `t`
}
```

`describe` calls your app's i18next `t("errors.<code>", params)`. If that key
isn't localized yet, it falls back to the catalog's default English — so you're
never stuck with a raw key on screen.

### Serialize it for an API (RFC 9457)

```ts
// A Python/Node backend can emit the identical shape:
errors.toProblemDetails("ai.provider.out_of_credits", { creditsLeft: 0 });
// => { type: "ai.provider.out_of_credits",
//      title: "Your provider account is out of credits. Add credits and try again.",
//      status: 402, creditsLeft: 0 }
```

### Throw a coded error when you already know the cause

```ts
import { CanonicalError } from "@edgeproc/errors";

// At a throw-site (e.g. an OPFS store hitting a quota):
throw errors.create("bundle.quota_exceeded", { requiredBytes: 5_000_000 });
// or standalone: new CanonicalError("bundle.quota_exceeded", "device", { ... })
```

## What `classify` knows out of the box

Duck-typed from the raw failure (`.status`, `.name`, `.message`/`.body`), with
the AlmaMesh-proven mappings pre-loaded and `internal.unknown` as the fallback:

| Raw failure                            | Code                          |
| -------------------------------------- | ----------------------------- |
| `status: 401` / `403`                  | `ai.provider.unauthorized`    |
| `status: 402`                          | `ai.provider.out_of_credits`  |
| `status: 404`                          | `ai.model.unavailable`        |
| `status: 429`                          | `ai.provider.rate_limited`    |
| `status: 5xx`                          | `ai.provider.server_error`    |
| `name: "AbortError"` / timed out       | `ai.request.timeout`          |
| `"Failed to fetch"` (no status)        | `net.unreachable`             |
| `name: "PrivacyViolationError"`        | `ai.privacy.violation`        |
| _(anything else)_                      | `internal.unknown`            |

Your catalog extends this: any entry's `httpStatus` or `match` predicate joins
the same rule engine.

## API

| Export             | Kind  | Role                                                              |
| ------------------ | ----- | ---------------------------------------------------------------- |
| `defineErrors`     | fn    | register one/more catalog fragments → a typed `Registry`         |
| `starterPack`      | const | the 18 universal codes (optional starting point)                 |
| `CanonicalError`   | class | `Error` subclass carrying `{ code, params, category }`           |
| `DuplicateCodeError` | class | thrown when a code is defined in two fragments                 |
| `errorNameOf` / `errorTextOf` / `httpStatusOf` | fn | duck-type helpers for writing your own `match` rules |

`Registry` methods: `classify(raw)`, `describe(code, params?, t?)`,
`toProblemDetails(code, params?, opts?)`, `create(code, params?)`, plus
`codes` / `has` / `get`.

## Under the hood (for the expert reader)

- **The code is the identity.** `<domain>.<subject>.<reason>`, greppable and
  loggable. A shipped code is a stable API contract — deprecate, never rename.
- **The catalog entry is the typed params contract.** `params: ["creditsLeft"]`
  is what makes `describe(code, { creditsLeft })` type-check; there's no reliance
  on i18next's own type inference, keeping coupling low.
- **Two ways to register.** A single spread object
  (`defineErrors({ ...starterPack, ...own })`) gives the richest param typing;
  separate fragments (`defineErrors(starterPack, own)`) add runtime
  duplicate-code detection across them.
- **Classify precedence.** Author `match` predicates win first (most specific),
  then the `httpStatus` table (first registration wins — codes stay stable),
  then `internal.unknown`.
- **RFC 9457 caveat.** Problem Details is literally "for HTTP APIs"; on the
  client we adopt its _shape_ as a clean envelope. The real payoff is a backend
  emitting it verbatim.

The optional starter catalog ships in this package as `starterPack`
(`src/starter-pack.ts`): the 18 universal codes (`ai.*`, `net.*`, `bundle.*`,
`config.*`, `internal.*`). Spread it into your own registration —
`defineErrors({ ...starterPack, ...own })` — or leave it out and define every
code yourself.

## Develop

```bash
pnpm gate   # lint (biome) + typecheck (tsc) + test (vitest, 100% cov) + build
```

## License

MIT.
