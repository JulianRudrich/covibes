# Covibes

Covibes is a shared planning space made of chat and canvas. Teams (or individuals) work with specialized AI agents and a neutral AI moderator on the very foundation of a project: brainstorming, decisions, architecture and the project plan. **Covibes steers, coding agents build.**

## Read before every task, in this order

1. `context/project-overview.md`: what we build and why
2. `context/architecture.md`: tech stack, system boundaries, core flows, invariants
3. `context/code-standards.md`: code conventions
4. `context/ai-workflow-rules.md`: how we work with coding agents
5. `context/ui-context.md`: design tokens and UI conventions
6. `context/progress-tracker.md`: where we stand

If one of these files does not exist yet, the decision behind it is still open. Do not guess; ask.

Read as needed:
- `context/dry-run.md`: the acceptance scenario for V1, a complete session with the expected behavior step by step
- `context/design/`: design handoffs from Claude Design, the pixel-exact reference for UI work. Open the prototype (`*.dc.html`) with `support.js` next to it.

## Way of working

- Work proceeds unit by unit along the numbered feature specs in `context/feature-specs/`.
- **Before starting a unit:** mark it as "in progress" in `context/progress-tracker.md`.
- **After finishing:** check the spec's checklist and update the tracker (status, decisions, session notes).
- Application code is only written through feature specs from `context/feature-specs/`. No spec, no code.
- The repository is written in English: documentation, code, comments, commit messages and branch names. Commits follow Conventional Commits.
- The repository is local only; it is published at the very end. The coding agent maintains Git completely. Every finished change is committed. Documentation goes straight to `main`. Every spec runs on its own branch `spec/NN-short-name` and is squash-merged into `main` once all checks pass, so there is exactly one commit per spec. Details are in `context/ai-workflow-rules.md`.
- Conversations with the owner are in German.
