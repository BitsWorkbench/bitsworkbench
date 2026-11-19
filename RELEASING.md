# Releasing

The site serves `main`: every merge is built, tested and published by
`.github/workflows/deploy.yml`. A release does not change what is served. It
names a tested point on `main`, so a teacher's bug report, a changelog entry
and the code all mean the same thing.

## Versions

`MAJOR.MINOR.PATCH`, in `package.json`, following
[Semantic Versioning](https://semver.org/) as it applies to people, not an API:

- **PATCH**: fixes only.
- **MINOR**: something new a teacher or student can use; nothing they rely on
  goes away.
- **MAJOR**: something they rely on changes or goes: a saved program, a pack or a
  block that no longer opens as it did. Avoid it. A program saved in any
  release must open in every later one.

About shows the version and the commit the site was built from.

## Making a release

1. On a branch from `main`: move the **Unreleased** lines in `CHANGELOG.md` under
   a new heading, `## <version> (<date>)`, and set `version` in `package.json`
   to match. Open a pull request; merge it when its checks pass.
2. Wait for that merge's **Deploy** run to go green, and open the site: About
   should show the new version.
3. Tag the merge commit, with the changelog section as the tag's message, and
   publish a GitHub release from the tag with the same notes:

   ```bash
   git fetch origin main
   git tag -a v<version> origin/main -m "<version>" -m "<the changelog section>"
   git push origin v<version>
   gh release create v<version> --verify-tag --notes-file <the section, as a file>
   ```

   Tags are never moved or deleted; a mistake is fixed by the next release.

## What is public, and what is not

Everything in this repository is public: code (MIT), the simulator's artwork
and models (CC BY-NC 4.0), and the free first missions of Firia Labs' courses in
`public/learn/packs/` (CC BY-NC 4.0). The rest of each course is Firia Labs'
paid curriculum: it never goes in this repository, in a release, or in a pack
file published with the site. Names and logos are trademarks
([TRADEMARKS.md](TRADEMARKS.md)).

Before tagging, check the release carries its notices: `dist/licenses/` holds
`THIRD_PARTY_NOTICES.md` and, in a build with CodeAIR flight, the GPL text and
the flight library's source link (`npm test` checks the build; see
`sim/README.md`, "CodeAIR flight").
