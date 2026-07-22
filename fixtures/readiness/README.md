# Readiness fixtures

`project/` is the immutable base project copied into a temporary directory by
`tests/checkpoint.test.ts`. `manifests/` contains every UX-manifest validation
input. `variants/` contains complete replacement files used to exercise stale
screen, stylesheet, requirement, device, and runtime states.

The corresponding human-readable CLI transcripts live in
`fixture_results/readiness/`. The test compares fresh output against those
checked-in files; regenerate them intentionally with:

```sh
UPDATE_FIXTURE_RESULTS=1 npx vitest run tests/checkpoint.test.ts
```
