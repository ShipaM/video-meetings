---
name: plan-phase
description: Breaks a PRD down into independent implementation phases. Use when a PRD is ready and you need a development plan made of independent phases.
---

# Plan generator

Read the PRD from the file:
$ARGUMENTS

Create an implementation plan and save it to 'docs/plan-$ARGUMENTS.md' (use an English translation in kebab-case for the name)

## Plan structure

## Plan: {feature name}

**PRD**: $ARGUMENTS
**Date**: {current date}

## Implementation phases

### Phase 1: {name}

**Goal**: What this phase delivers
**Affects**: backend / frontend / database
**Tasks**

- [ ] Task 1
- [ ] Task 2
      **Done when:** A concrete criterion

### Phase 2: {name}

...

## Rules for splitting into phases

- Every phase delivers a working result. A phase cannot be finished while the code does not work.
- Phases are independent. You can stop after any phase without losing the previous result. The next phase does not break the previous one.
- The first phase is the minimal end-to-end path (Tracer Bullet).
- No more than five tasks per phase. If there are more, split the phase further.
- Backend and frontend of the same feature go into separate phases. API first, then UI.
- Every phase includes planned tests that cover its functionality.

## Rules

- Read the PRD carefully.
- The plan must cover all acceptance criteria from the PRD.
- Do not add tasks that are not in the PRD.
- If the PRD is incomplete, ask clarifying questions before creating the plan.
