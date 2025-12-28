# publish-claude

A CLI tool to export [Claude Code](https://claude.ai/claude-code) sessions to readable markdown or GitHub gists.

Claude Code stores conversation history in `~/.claude/projects/` as JSONL files. This tool parses those files and converts them into clean, shareable markdown documents.

## Installation

Requires [Bun](https://bun.sh).

```bash
bun install
```

## Usage

### Interactive Mode

Run without arguments to browse and select sessions:

```bash
bun run dev
```

This will:
1. List sessions from the current directory (use `--all` to see all projects)
2. Let you select a session by number (or press `a` to show all projects)
3. Choose to export to a file or create a GitHub gist

### Commands

```bash
# List sessions in current directory
bun run dev list

# List all sessions across all projects
bun run dev list --all

# Print session to stdout as markdown
bun run dev print <session-id>

# Export to a markdown file
bun run dev export <session-id> [output-file]

# Create a GitHub gist (requires gh CLI to be installed and authenticated)
bun run dev gist <session-id>
bun run dev gist <session-id> --public
```

## Output Format

The generated markdown is optimized for readability:

- **Title**: Uses Claude's auto-generated session summary
- **User messages**: Displayed as blockquotes for visual distinction
- **Assistant responses**: Plain markdown text
- **Tool usage**: Tool calls, results, and thinking are grouped together and collapsed in expandable `<details>` sections, labeled with the tools used (e.g., "Bash, Read, Edit")
- **Structure**: Horizontal rules separate each conversation turn

## How It Works

Claude Code stores sessions in `~/.claude/projects/<encoded-project-path>/<session-id>.jsonl`. Each line in these files is a JSON object representing a message, tool call, or metadata.

This tool:
1. Scans the projects directory to find all sessions
2. Extracts the summary, timestamps, and message counts
3. Parses the JSONL to reconstruct the conversation
4. Formats everything into clean markdown suitable for sharing or archiving
