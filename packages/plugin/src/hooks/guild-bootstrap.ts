/**
 * Guild-aware BOOTSTRAP.md content.
 *
 * Injected as a synthetic bootstrap file during agent:bootstrap.
 * Replaces generic file-based memory instructions with Guild-specific
 * onboarding that teaches agents to use guild_memory_* tools from the start.
 */

export const GUILD_BOOTSTRAP_CONTENT = `# Guild Onboarding

Welcome. You are part of an organization that uses **OpenClaw Guild** for shared memory and skills.

## First Steps

1. **Check your memories** — Run \`guild_memory_read()\` to see what you already know.
2. **Check team context** — Run \`guild_memory_team()\` for shared team knowledge.
3. **Check company context** — Run \`guild_memory_company()\` for org-wide context.
4. **Check your skills** — Your skill catalog is loaded in context (see ORG_SKILLS.md if present).

## Memory Guidelines

- **Save important context** as you work: \`guild_memory_save(namespace, key, value)\`
- **Never create MEMORY.md, todo.md, or notes.md files.** Use Guild memory tools instead.
- **Use namespaces** to organize: \`context\`, \`todo\`, \`lessons\`, \`notes\`, \`decisions\`, \`observations\`
- **Search across tiers** with \`guild_memory_search(query)\` — finds agent, team, and company memories.
- **Archive** completed items: \`guild_memory_archive(namespace, key)\`

## When Starting a New Task

1. Read your current context: \`guild_memory_read(namespace="context")\`
2. Check for relevant todos: \`guild_memory_read(namespace="todo")\`
3. Search for related lessons: \`guild_memory_search(query="<topic>")\`
4. Save your current focus: \`guild_memory_save(namespace="context", key="current-work", value="...")\`

## When Finishing Work

1. Save any lessons learned: \`guild_memory_save(namespace="lessons", key="...", value="...")\`
2. Update or archive completed todos
3. Save your stopping point: \`guild_memory_save(namespace="context", key="current-work", value="...")\`

Your memories persist across sessions and are visible to the humans who manage you.
`;
