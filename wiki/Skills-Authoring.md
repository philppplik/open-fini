# Skills Authoring

A skill is a Markdown file (SKILL.md style) that teaches the Vibe assistant one kind of job: the workflow, the rules with numbers, the tools to use and how to check the result. The assistant sees only a one-line catalog entry per skill and loads the full text when a task matches, so skills cost almost no context until used. OpenFini ships 26 built-in skills; you can write, import and share your own.

## Format

```markdown
---
name: social-campaign-kit             # required: 2-64 chars, lowercase letters, digits, dashes
description: Produce a matching set of social graphics for one campaign message.
version: 1.0.0                        # optional
tags: [layout, social]                # optional: filters and suggestions
allowed-tools: add_text, add_shape, run_plan, screenshot
enforce-tools: false                  # true = only allowed-tools (plus a few basics) while the skill is active
params:                               # optional named parameters
  - "message: The one campaign message"              # required
  - "brand_color: Main color (default: #4f46e5)"     # optional with a default
  - "size?: Canvas size"                             # optional without a default
argument-hint: message brand_color
when-to-use: social campaign, instagram set, post and story
requires: [brand-kit]                 # these skills' bodies are included when this one loads
references: [checklist.md]            # extra files loaded on demand
studios: [layout, vector]             # only offered in these studios (default: all)
---
# Social campaign kit

Message: {{message}}. Brand color {{brand_color}}. Everything the user typed: $ARGUMENTS

## Workflow
1. Create the page...

## Verify
Call screenshot and fix any overlap.
```

- `{{name}}` is replaced by the parameter value (or its default) and `$ARGUMENTS` by the raw argument text; values the body does not mention are appended in an Arguments list.
- Lists may be inline (`[a, b]`), comma separated or YAML dash lists; quote parameter specs that contain commas or colons.
- Unknown keys are kept and survive export and import.

## How skills are used

1. The system prompt lists each enabled skill as `- name: description [args: a, b?]`.
2. **You** start one with `/name` in the composer; a skill with parameters opens a small form. A chip "Use skill X?" may suggest one while you type (turn it off in Models ▸ Engine).
3. **The model** calls `use_skill { name, args }`; missing required arguments produce a clear error so it asks you. `use_skill { name, file }` loads a reference file.
4. While a skill with `enforce-tools: true` is active (until the request ends), other tool calls fail with an explanation. A global setting switches enforcement off.

## Create skills

| Way | What happens |
| --- | --- |
| Skills panel, *New* | Editor with live preview and validation (name, description, body, Verify section, unknown tools, undeclared placeholders, unknown required skills) |
| *Customize* a built-in | Makes an editable copy under "Your skills"; the same name overrides the built-in |
| *Create from this chat* (`/create-skill`) | The assistant distills the workflow into a **draft** (disabled, tagged `draft`) for you to review |
| *Test* | Runs the skill in a new chat with the offline Demo provider, which only loads and echoes it; this checks format, parameters and composition |

## Import and export

`.skill.md` is one skill as plain Markdown (import also accepts `.md`). `.skillpack` is a ZIP with `skillpack.json` (`{ "format": "openfini-skillpack", "version": 1, "skills": [...] }`) and one folder per skill with `SKILL.md` and reference files (`.md`, `.txt`, `.json`, `.csv`, at most 400 KB each).

## Best practices

- One job per skill: "Social campaign kit", not "marketing".
- Concrete numbers beat adjectives: sizes in px, margins, contrast ratios, word limits.
- Name the tools and the order, including the cheap ones: `describe_page` instead of `list_layers`, `query_layers` to find things, `run_plan` for known sequences, `apply_to_many` for bulk edits.
- Put token-saving advice in the skill: read once, batch writes, screenshot at the end.
- End with `## Verify`: how the assistant checks the result.
- Use parameters for the parts that change; give sensible defaults so the skill works without a form.
- For large jobs say which parts may go to sub-agents (see the built-in `multi-agent-project-lead`).
- Keep skills under about 150 lines and move long reference material into `references`.

## Built-in skills

26 are built in, including workflows for design systems, responsive sites from a brief, photo compositing, icon sets, presentations, print brochures, social campaign kits, mobile UI mockups, data reports (`report-with-charts`), business documents (`write-business-document`), code refactoring, SEO, accessibility fixes, localization, brand kits from a logo, CSS animation, `help-me-use-openfini` and `multi-agent-project-lead`.

## For contributors

The parser, serializer and validation are pure (`app/src/ai/skills.js`); built-ins are strings in `app/src/ai/skills-library.js`. Tests require a description over 40 characters, a body over 1200 characters, at least three existing `allowed-tools`, a `## Verify` section, only existing tool names and declared placeholders. See [[Extending OpenFini]].

## See also

- [[Vibe Studio]]
- [[Vibe Tools Reference]]
- [[Extensions]]
- [[Extending OpenFini]]
