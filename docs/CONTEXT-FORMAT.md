# CONTEXT.md format

`CONTEXT.md` is the project's glossary: the canonical meaning of every domain term. It is **not** a spec, a design doc, or a place for implementation details or decisions. If you're tempted to write *how* something works or *why* a choice was made, it belongs in a spec or an ADR, not here.

## Structure

A short intro line, then one entry per term, alphabetical. Keep the whole file skimmable.

```markdown
# Glossary

The canonical vocabulary for <project / bounded context>. One meaning per term.

## Customer

The person or organisation that pays for the service. Owns one or more [Accounts](#account).

Not the same as a **User** (a User logs in; a Customer is billed). A Customer may have many Users.

## Account

A billing relationship between a [Customer](#customer) and the service. Holds the subscription and payment method.

Not a login. Logins belong to **Users**.
```

## Rules

- **One meaning per term.** If a word is used two ways, that's two terms (or a renamed concept), not one fuzzy entry.
- **Define by relationships and boundaries.** Say what a term connects to, and what it is explicitly *not*. The "not" line is often the most useful part.
- **No implementation.** No table names, file paths, API shapes, or "we store this in Redis." Those drift and don't belong in a glossary.
- **Keep it short.** A few sentences per term. If an entry grows into prose, the extra material is probably a spec or an ADR.
- **Link related terms** with anchor links so readers can navigate the web of concepts.
