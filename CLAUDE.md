@AGENTS.md

# Working efficiently with Claude (avoid burning tokens)

- **Don't fan out into many subagents for sequential/repetitive work.** Each subagent reloads its own full system context from scratch, so splitting a task like "translate 10 pages" or "review 8 subsystems" into 10-8 separate subagents costs far more tokens than doing the same work as one pass through the same conversation. Reserve subagents for work that genuinely needs isolation or parallelism (independent research branches, adversarial verification, or a task big enough to blow the main context on its own).
- **Batch related asks into one instruction** ("translate every page under src/app to English") instead of issuing them one file/page at a time — each new instruction re-reads the same standing context.
- **Check this file and the existing schema/docs before re-exploring the codebase.** An Explore/review subagent sent to "understand the auth layer" or "understand the DB schema" re-derives things that are often already written down here or in `src/db/schema.ts`'s own comments.
- **When pulling Railway logs**, prefer a narrow `startDate`/`endDate` or a `filter` expression over a full unbounded pull — large log dumps exceed the tool's output limit, get written to disk, and need a second read pass anyway (use `jq`/`grep` on the saved file instead of reading the whole thing back into context).
- **Deliver code changes via the device-bridge file-write + the user's own `push.bat`**, not `git format-patch`/`git am` round-trips — the sandbox's git remote here is read-only, so direct pushes and patch files both fail; the device-bridge write is the working path.

# Known ops quirks (save yourself re-discovering these)

- **Railway's GitHub App auto-deploy is not installed on this repo.** A push does not trigger a build on its own — after pushing, call `connect-service-source` for both the `web` and `bot` Railway services to force an immediate build from the latest commit. This stays necessary until the user reinstalls the GitHub App (GitHub Settings → Applications → Installed GitHub Apps → Railway → grant `Ryuuuuu-bit/rooc-guild-manager` access → re-enable auto-deploy in Railway).
- `mcp__Railway__get-service-config` and `mcp__Railway__get-status` currently error ("Structured content does not match the tool's output schema") — use `mcp__Railway__environment-status` or `mcp__Railway__railway-agent` instead.
