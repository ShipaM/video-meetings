# Ralph loop - rules for autonomous work

The runner (`scripts/ralph.mjs`) hands you one issue per run. Implement exactly that issue, then stop; the
runner starts a new run for the next one.

### 1. Issues

- Read the issue title, body and its "Done when" criteria (`gh issue view <number>`).
- Work only on the issue you were given; do not touch other issues of the milestone.

### 2. Branch

- Check that the branch from the prompt exists (`git branch --list <branch>`). If it does not, create it from
  `master`; if it does, switch to it.
- Work only in this branch and do not create other branches.
- Commit with the `git-commit` skill (conventional commits). Commit messages never mention Claude or AI.

### 3. Implementation (TDD)

- Write the tests first, then the implementation.
- The dev servers (web on :3000, api on :4000) are already running; never start or stop them. If they do not
  respond, comment on the issue and leave it open.
- Run the affected tests after every change (`npm run test`, plus `npm run test:e2e --workspace=api` for API
  routes; e2e needs `npm run db:up`).
- If the tests are still red after five attempts, stop: write an issue comment
  (`gh issue comment <number>`) that describes the problem and leave the issue open. The runner then ends the loop.

### 4. Finishing the issue

- All tests are green, `npm run lint` passes.
- Every requirement of the issue is met.
- Run the `code-review` skill on your changes and fix what it finds.
- Commit, then close the issue: `gh issue close <number> --comment "<short summary>"`.
- Do not push and do not create a pull request: the runner does it when the milestone has no open issues.
