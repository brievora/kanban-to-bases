# Contributing

Thank you for helping with Kanban to Bases.

## Reporting a problem

Open an [issue](https://github.com/brievora/kanban-to-bases/issues) with:

- your Obsidian version and operating system;
- what you did, what you expected and what happened;
- if you can, a small board file that shows the problem (remove anything private first).

## Changing the code

```sh
pnpm install
pnpm test        # unit tests
pnpm run lint    # ESLint with eslint-plugin-obsidianmd
pnpm run build   # type check, then main.js
```

- Keep the original board untouched: the plugin only creates notes and a base, and updates linked notes.
- Add a unit test in `test/` for any change to how cards are read or converted.
- Keep the English and French strings in `src/i18n.ts` in sync.

Open a pull request against `main` with a short description of the change. Releases are published by the maintainers: pushing a version tag runs `.github/workflows/release.yml`, which builds, tests and attests the release files.
