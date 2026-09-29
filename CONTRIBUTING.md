# Contributing to Cubr

[Русская версия](CONTRIBUTING.ru.md)

Thanks for wanting to help. Cubr is a small project with one maintainer, so a
short, focused pull request that follows the rules below is the fastest way to
get something merged.

## Before you start

- **Bugs:** open an issue with steps to reproduce, what you expected and what
  happened. For anything camera-related, say which cube (stickered or
  stickerless) and what lighting you had — the vision code is sensitive to both.
- **Features:** open an issue first and describe the idea. The scope is kept
  tight on purpose, so a feature that was not discussed may be declined even if
  the code is good.
- **Security issues:** do not open a public issue. Report privately through
  GitHub's "Report a vulnerability" (Security tab) or contact the maintainer
  directly.

## Local setup

Backend (needs Docker for Postgres, Python 3.12, [`uv`](https://docs.astral.sh/uv/)):

```bash
cd backend
cp .env.example .env
docker-compose up -d
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

Frontend (Node 22.12+ or 24):

```bash
cd frontend
npm ci
npm run dev
```

More details: [`backend/README.md`](backend/README.md).

## Checks

CI runs all of these on every pull request; run them locally before pushing.

```bash
# backend
cd backend
uv run ruff check . && uv run ruff format --check . && uv run mypy app && uv run pytest -q

# frontend
cd frontend
npx prettier --check "src/**/*.{ts,tsx,css}" "tests/**/*.{ts,tsx}" "scripts/*.mjs"
npm run typecheck && npm run lint && npm test && npm run build
```

`npm run build` also enforces the entry-chunk size budget — a build over budget
fails.

## Rules for changes

- **Tests are required.** New behaviour comes with tests; a bug fix comes with a
  test that fails without the fix.
- **One change per pull request.** Don't mix a feature with an unrelated
  refactor or reformatting.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/):
  `feat(scope): ...`, `fix(scope): ...`, `docs: ...`, `chore: ...`. Keep the
  subject short and say what changed for the user, not which file was touched.
- **User-facing strings** go through `t()`, and every new string gets its key in
  `frontend/src/i18n/en.ts`. The key is the Russian string itself. Plurals are
  translated as whole phrases via `i18n/plural.ts`.
- **Database changes** need an Alembic migration.
- **No secrets in the repo.** Configuration lives in `.env` (git-ignored); add
  new variables to `.env.example` with a placeholder value.
- **Keep files small.** Around 400 lines is the limit; split a file before it
  grows past that.

## Pull requests

1. Fork the repo and branch off `main` (`fix/...`, `feat/...`).
2. Make the change, run the checks above.
3. Open a pull request against `main`. Describe what changed and why, and how
   you tested it. Screenshots help for UI changes.

## License

Cubr is licensed under the [GNU AGPL v3](LICENSE). By submitting a contribution
you agree that it is licensed under the same terms.
