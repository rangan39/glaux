# Dependency audit policy

Sophon treats production and development dependency findings separately because
only production dependencies can be bundled into the web application or Chrome
extension.

## Enforced release gate

CI runs:

```bash
npm run audit:production
```

This fails on high or critical findings reachable from production dependencies.
The Chrome extension audit independently checks the built package for forbidden
payloads and remote executable references.

## Known development-only advisory

As of July 26, 2026, a full `npm audit` reports `GHSA-mh99-v99m-4gvg` through
the ESLint toolchain. The affected paths are development-only:

- `eslint-plugin-import` → `minimatch@3` → `brace-expansion@1`
- `eslint-plugin-jsx-a11y` → `minimatch@3` → `brace-expansion@1`
- `eslint-plugin-react` → `minimatch@3` → `brace-expansion@1`

The advisory is an availability risk: an attacker-controlled, extremely large
brace expression can exhaust memory during glob expansion. Sophon runs ESLint
with a fixed repository command and fixed configuration; it does not accept glob
patterns from application users. These packages are not present in the
production dependency audit and are not shipped in the extension.

There is no compatible patched release in the current Next.js ESLint dependency
chain. `brace-expansion@5` changed its CommonJS API, so forcing it under
`minimatch@3` is not compatible. The audit tool's suggested
`eslint-config-next@0.2.4` downgrade would also replace the supported Next.js
configuration and must not be used.

## Resolution condition

Remove this exception when supported releases of `eslint-plugin-import`,
`eslint-plugin-jsx-a11y`, and `eslint-plugin-react` no longer depend on the
vulnerable `minimatch@3`/`brace-expansion@1` chain. Re-run both:

```bash
npm audit
npm run audit:production
```

Any new production finding remains a release blocker regardless of this
development-only exception.
