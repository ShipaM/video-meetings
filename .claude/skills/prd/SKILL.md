---
name: prd
description: Creates a PRD document for a feature using the project's standard structure. Use when you need to describe the requirements of a new feature before implementing it.
---

# PRD generator

Create a PRD (Product Requirements Document) for the following feature:
$ARGUMENTS

Save the result to the file 'docs/prd-$ARGUMENTS.md' (translate the name to English and use kebab-case).

If the /docs folder does not exist, create it.

## PRD document structure

## PRD: {feature name}

**Date**: {current date}
**Status**: Draft

## Goal

One or two sentences: what the feature is and why the user needs it.

## User scenarios

- The user {action} -> {result}

## In scope

What is included in the feature - a concrete list.

## Out of scope

What we explicitly do not do in this iteration.

## Technical constraints

Known constraints that must be taken into account.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Rules

- Be specific - no fluff
- Acceptance criteria must be verifiable
- Do not describe how to implement it, only what and why
- If the description is short, ask clarifying questions until you fully understand the feature, before creating the file
