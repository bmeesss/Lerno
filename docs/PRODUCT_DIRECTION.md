# Lerno Product Direction

## North star

Lerno should be a complete study workspace, not a flashcard site with AI attached.

The core workflow is:

1. Bring in study material.
2. Organize it into a study pack.
3. Understand the material.
4. Generate useful study resources.
5. Learn and practice.
6. Get tested.
7. Review weak knowledge with spaced repetition.
8. Plan toward an exam date.
9. Return to a single home screen that tells the student what to do next.

## Product position

Lerno is a free-first, study-first platform for students.

The differentiating product idea is not another isolated flashcard editor. The differentiator is that different sources can feed one continuous learning system.

Initial sources:

- pasted notes
- selectable-text PDFs
- existing Lerno sets

Planned sources:

- PowerPoint
- YouTube
- images and handwritten notes
- audio
- licensed school-method content or official integrations where available

## Information architecture

Primary navigation:

- Home
- My Study
- Discover
- Progress

Secondary navigation:

- Study packs
- Subjects
- Review
- AI Tutor
- Favorites
- Settings

The main call to action is **Add study material**.

## Domain model direction

The current `study_sets -> cards` model remains supported for compatibility.

The target model is:

`Study Pack -> Sources -> Concepts -> Generated Content -> Learning Progress`

A Study Pack can contain:

- one or more source documents
- a structured summary
- important concepts
- flashcards
- practice questions
- quizzes/tests
- an AI tutor context
- an optional exam date
- a generated study plan

The existing set/card data should migrate gradually rather than being replaced in one release.

## Learning model

Lerno should optimize for mastery rather than content generation.

Every generated learning object should be connected to the underlying study pack and, where possible, to one or more concepts.

This allows Lerno to answer:

- what the student has already mastered
- what is due for review
- which concepts cause mistakes
- what should be practiced next
- what still needs attention before an exam

## AI model

AI is an engine inside the study workflow.

AI should be source-grounded whenever the user asks about their material.

Core generation actions:

- summary
- key concepts
- flashcards
- practice questions
- quiz
- practice test
- study plan
- explanation
- hints

AI output should remain editable and should never silently overwrite existing student-created content.

## Study modes

The long-term study pack should expose one consistent set of modes:

- Learn
- Flashcards
- Practice
- Test
- Review
- Match
- AI Tutor

The student should not need to understand Lerno's internal data model to use these modes.

## Exam planning

An exam date turns a static study pack into a plan.

The system should calculate a practical sequence of learning, practice and review tasks based on:

- days remaining
- material size
- current mastery
- due reviews
- weak concepts

The exact algorithm can start simple and become more adaptive later.

## School-method integrations

Lerno must not scrape or redistribute copyrighted school books without permission.

The preferred long-term model is:

- official metadata and method structure
- licensed content access
- publisher or school integrations
- user-authorized access to materials the student is already entitled to use

A student should be able to identify their method, level, edition and chapter, then study that material through Lerno's learning engine when the required rights or integration are available.

## Product phases

### Phase 1 — Study-first shell

- My Study page
- simplified primary navigation
- Add study material as the primary CTA
- study-pack language
- existing learning modes retained

### Phase 2 — Real Study Packs

- study pack detail page
- source management
- unified overview
- generated content tabs
- pack-level progress

### Phase 3 — Source ingestion

- robust PDF ingestion
- PowerPoint ingestion
- YouTube ingestion
- images and OCR
- source processing states
- provenance links from generated content back to source

### Phase 4 — Mastery engine

- concept extraction
- concept-level progress
- stronger adaptive Learn mode
- weak-concept queues
- cross-pack review

### Phase 5 — Exam planner

- exam dates
- automatic study plans
- daily tasks
- deadline-aware review

### Phase 6 — Dutch education ecosystem

- school-method catalog
- official publisher integrations
- method/edition/chapter matching
- school/ELO integrations where technically and contractually possible

## Product rule

Every new feature should answer at least one of these questions:

- Does this help a student understand material?
- Does this help a student practice?
- Does this help a student remember?
- Does this help a student prepare for a test?
- Does this make the next study action clearer?

Features that do not support the core study loop should not become first-class navigation.
