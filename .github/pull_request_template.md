## What and why

<!-- Which spec does this implement ("Implements spec 42.")? What changes, and why? -->

## How it was verified

<!-- The checks you ran, the tests you added, and what you tried in the browser: both themes and the phone layout where the interface changed. Screenshots help for anything visible. -->

## Checklist

- [ ] The title is a [Conventional Commit](https://www.conventionalcommits.org) (`feat(scope): …`); it becomes the squash commit on `main`
- [ ] The [checks](https://github.com/JulianRudrich/covibes/blob/main/CONTRIBUTING.md#checks-before-a-pull-request) pass: `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test`, `pnpm db:types:check` and `pnpm build`
- [ ] The spec's checklist is ticked and `context/progress-tracker.md` is updated
- [ ] New interface texts are in both `en.json` and `de.json`, and styles use the design tokens only
- [ ] New tables come with row-level security, policies, grants and database tests in their migration
- [ ] No secrets, tokens or private data in code, tests, logs or screenshots
