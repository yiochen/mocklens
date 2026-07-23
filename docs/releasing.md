# Releasing mocklens

Releases are intentionally lightweight: maintainers choose a semantic version,
write a short changelog entry, merge those metadata changes, and publish a
GitHub release. The `Publish to npm` workflow builds and verifies the package,
then publishes the exact release-tag commit to npm.

## Version and changelog policy

Use [Semantic Versioning](https://semver.org/):

- Patch (`0.1.1`): compatible fixes and documentation corrections.
- Minor (`0.2.0`): compatible features or meaningful behavior additions.
- Major (`1.0.0`): incompatible CLI, config, report, or package API changes.

Before 1.0, a breaking change normally increments the minor version and must
be called out clearly in the changelog. Keep `CHANGELOG.md` human-curated.
Collect user-visible changes under `Unreleased`, then move them into a dated
version heading when preparing a release. Do not generate a changelog from
commit messages.

Prereleases use semantic suffixes such as `0.2.0-beta.0`. Mark the GitHub
release as a prerelease; the workflow publishes it under npm's `next` tag.
Stable GitHub releases publish under `latest`. A prerelease is never promoted
in place: prepare and publish the final version, such as `0.2.0`, separately.

## One-time npm setup

npm trusted publishing is configured in an existing package's settings, so the
initial package publish needs a short-lived bootstrap token. Skip the
token-specific steps if `mocklens` already exists under the maintainer account.

1. Create the `npm` environment in the GitHub repository. Add a required
   reviewer if release approval is desired.
2. Create a granular npm access token that can create/publish `mocklens`, save
   it as the `NPM_TOKEN` environment secret, and publish `v0.1.0` using the
   checklist below.
3. On npmjs.com, open the new `mocklens` package settings and configure a
   [GitHub Actions trusted publisher](https://docs.npmjs.com/trusted-publishers/):
   - organization or user: `yiochen`
   - repository: `mocklens`
   - workflow filename: `publish.yml`
   - environment: `npm`
   - allowed action: `npm publish`
4. Delete the `NPM_TOKEN` secret and revoke the bootstrap token. Restrict
   token-based package publishing on npm after trusted publishing works.

The workflow grants only `contents: read` and `id-token: write`. npm trusted
publishing exchanges the GitHub OIDC identity for a short-lived credential and
automatically records
[provenance](https://docs.npmjs.com/generating-provenance-statements/) for
public packages built from this public repository. `publishConfig.provenance`
also requests provenance during the token-backed bootstrap publish.

## Release checklist

1. Start from the latest `main` and create a short release branch.
2. Choose a version and update both package files without creating a local tag:

   ```sh
   npm version patch --no-git-tag-version
   # or: npm version minor --no-git-tag-version
   # prerelease example:
   npm version prerelease --preid beta --no-git-tag-version
   ```

   For the initial `v0.1.0` publish, the package files already contain the
   intended version, so skip this command.

3. Move the relevant `Unreleased` entries in `CHANGELOG.md` under an exact,
   dated heading such as `## [0.1.1] - 2026-08-03`. Update the comparison links
   at the bottom of the file.
4. Run all release gates locally:

   ```sh
   npm ci
   npm exec playwright install chromium
   npm run release:check
   npm run release:verify -- --tag v0.1.1 --prerelease false
   ```

   `release:check` runs type checking, a clean build, the complete test suite
   (including packing, installing, and invoking the CLI from a temporary
   consumer), and `npm pack --dry-run`.
   Use `npm run test:package` when only that package-consumer smoke test needs
   to be repeated.

5. Inspect the dry-run file list. It should contain `dist/`, `package.json`,
   `README.md`, and `LICENSE`, and exclude source, tests, fixtures, and examples.
6. Open and merge the release PR. Wait for CI to pass.
7. From the merged commit on `main`, publish a GitHub release whose tag is
   exactly `v<package.json version>`. Copy the matching changelog section into
   the release notes and mark prereleases appropriately.
8. Watch the `Publish to npm` workflow. It refuses to publish when:
   - the tagged commit is not on `main`;
   - the tag and package version differ;
   - the changelog lacks the version;
   - stable/prerelease metadata disagree; or
   - lint, build, tests, package smoke installation, or dry-run packing fails.
9. Verify the registry metadata:

   ```sh
   npm view mocklens version dist-tags repository
   npx mocklens@0.1.1 --help
   ```

   Confirm the npm package page shows provenance. For a prerelease, use the
   exact version or `npx mocklens@next --help`; it must not replace `latest`.

If a publish fails, fix the cause in a new commit and prepare a new version.
Never move an existing release tag or reuse a version already accepted by npm.
