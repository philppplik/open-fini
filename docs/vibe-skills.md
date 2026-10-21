# Vibe skills: format reference and authoring guide

A skill is a Markdown file (`SKILL.md` style) that teaches the Vibe assistant one kind of job: the workflow, the
rules with numbers, which tools to use and how to check the result. Vibe sees only a one-line catalog entry per skill
and loads the full text with `use_skill` when a task matches, so skills cost almost nothing until they are used.

OpenFini ships 27 built-in skills (Vibe ▸ Skills ▸ Built in; among them `about-the-developer`, which answers "who made
OpenFini?" with only the publicly stated facts about Philipp Paulik and the project, and sends everything else to
philipp-paulik.de and GitHub). You can write your own, import them, share them as
`.skill.md` files or `.skillpack` bundles, and let Vibe draft one from a chat.

## Format

```markdown
---
name: social-campaign-kit             # required: 2-64 chars, lowercase letters, digits, dashes
description: Produce a matching set of social graphics for one campaign message.   # required, one sentence
version: 1.0.0                        # optional, shown in the Skills panel
tags: [layout, social]                # optional, used for filters and suggestions
allowed-tools: add_text, add_shape, run_plan, screenshot   # tools the skill uses
enforce-tools: false                  # true = only allowed-tools (plus use_skill, update_plan, ask_user,
                                      #        get_document_info, screenshot) may run while the skill is active
params:                               # optional named parameters
  - "message: The one campaign message"              # required
  - "brand_color: Main color (default: #4f46e5)"     # optional with a default
  - "size?: Canvas size"                             # optional without a default
argument-hint: message brand_color    # optional, shown in the / menu
when-to-use: social campaign, instagram set, post and story   # trigger words for auto-suggestion
requires: [brand-kit]                 # composition: these skills' bodies are included when this one loads
references: [checklist.md]            # extra files loaded on demand (use_skill with file)
studios: [layout, vector]             # only offered in these studios (default: all)
---
# Social campaign kit

Message: {{message}}. Brand color {{brand_color}}. Everything the user typed: $ARGUMENTS

## Workflow
1. ...

## Verify
Call screenshot and fix ...
```

* **Placeholders**: `{{name}}` is replaced by the parameter value (or its default); `$ARGUMENTS` by the raw argument
  text. Values the body does not mention are appended in an "Arguments" list.
* **Lists** can be inline (`[a, b]`), comma separated or YAML dash lists. Use dash lists with quotes for parameter
  specs that contain commas or colons.
* Unknown keys are kept verbatim (`skill.meta`) and survive export and import.

## How skills are used

1. The system prompt lists every enabled skill as `- name: description [args: a, b?]`.
2. **The user** starts one with `/name` in the composer. A skill with parameters opens a small form (required fields
   are marked, defaults filled in). The message then reads `Use the “name” skill with args {...}.`
3. **Auto-suggest**: while the user types, a cheap BM25 ranking over name, description, tags and `when-to-use`
   shows a chip "Use skill X?" (turn it off in Models ▸ Engine).
4. **The model** calls `use_skill { name, args }`. Missing required arguments come back as a clear error so the model
   asks the user. `use_skill { name, file }` loads a reference file.
5. While a skill with `enforce-tools: true` is active (until the request ends), any other tool call fails with an
   explanation. The setting "Enforce tool restrictions of skills" can switch enforcement off globally.
6. Usage counts and the last use are stored on this device and shown in the Skills panel.

## Creating skills

* **Skills panel ▸ New**: an editor with a live preview (rendered with default arguments) and validation (name,
  description, body, Verify section, unknown tools, undeclared placeholders, unknown required skills).
* **Customize** a built-in skill: makes an editable copy under "Your skills" (same name overrides the built-in).
* **Create from this chat** (Skills panel button or `/create-skill`): asks Vibe to distill the workflow it just
  performed into a skill with the `create_skill` tool. The result is saved as a **draft** (disabled, tagged `draft`)
  so you review and edit it before enabling it.
* **Test**: runs the skill in a new chat with the offline Demo provider. The Demo provider only loads the skill and
  echoes it (it does not follow the instructions), which checks the format, parameters and composition.

## Import and export

* `.skill.md`: one skill, plain Markdown. Import also accepts `.md`.
* `.skillpack`: a ZIP with `skillpack.json` (`{ "format": "openfini-skillpack", "version": 1, "skills": [...] }`)
  and one folder per skill: `<name>/SKILL.md` plus reference files (`.md`, `.txt`, `.json`, `.csv`, max 400 KB each).

## Authoring best practices

* **One job per skill.** "Social campaign kit", not "marketing".
* **Concrete numbers beat adjectives**: sizes in px, margins, contrast ratios, word limits.
* **Name the tools and the order**, including the cheap ones: `describe_page` instead of `list_layers`,
  `query_layers` to find things, `run_plan` for known sequences, `apply_to_many` for bulk edits, `evaluate` for math.
* **Token-saving tips** belong in the skill: read once, batch writes, screenshot at the end (with `lowRes` when
  enough).
* **Always end with `## Verify`**: how the assistant checks the result (screenshot, read_chart, check_problems ...).
* **Parameters** for the parts that change between uses; keep defaults sensible so the skill works without a form.
* **Sub-agents**: for big multi-part jobs, say which parts may be delegated with `spawn_agent` and what each task must
  contain (see the built-in `multi-agent-project-lead`).
* Keep skills under about 150 lines; move long reference material into `references`.

## Where things live

| What | File |
| --- | --- |
| Parser, serializer, renderer, validation, suggestions (pure) | `app/src/ai/skills.js` |
| Built-in skills | `app/src/ai/skills-builtin.js`, `app/src/ai/skills-library.js` |
| `use_skill`, `create_skill` tools | `app/src/vibe/tools/meta.js` |
| Enforcement, usage stats, drafts | `app/src/vibe/session.js`, `app/src/vibe/store.js` |
| Skills panel, argument form | `app/src/ui/vibe/panel-skills.js`, `app/src/ui/vibe/skill-form.js` |
| Tests | `tests/ai/skills.test.js`, `tests/ai/skills-v2.test.js`, `tests/vibe/hub.test.js` |

To add a built-in skill, append a SKILL.md string to `LIBRARY_SKILLS` in `skills-library.js`. The tests require a
description over 40 characters, a body over 1200 characters, at least three existing `allowed-tools`, a `## Verify`
section, only existing tool names in the body, and declared placeholders.
