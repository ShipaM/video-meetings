---
name: review-all
description: Runs a full code review through three parallel subagents
---

Run three subagents in parallel through the Task tool:

1. security-reviewer — check the security of the changes
2. performance-reviewer — check performance
3. test-coverage-reviewer — check test coverage

Start all three at the same time. When all of them finish, combine the results into a single report.
