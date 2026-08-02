# Dependency audit policy

Glaux treats production and development dependency findings separately because
only production dependencies can be bundled into the web application.

## Enforced release gate

CI runs:

```bash
npm run audit:production
```

This fails on high or critical findings reachable from production dependencies.

CI enforces the production gate. Maintainers should also run the full audit
locally before dependency releases:

```bash
npm audit
npm run audit:production
```

The pinned transitive overrides in `package.json` keep security-sensitive archive
and image-processing dependencies on patched versions until their parent packages
adopt those versions directly. Any new production finding is a release blocker.
