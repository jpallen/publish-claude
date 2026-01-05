# publish-claude

A CLI tool to export [Claude Code](https://claude.ai/claude-code) sessions to readable markdown or GitHub gists.

Claude Code stores conversation history in `~/.claude/projects/` as JSONL files. This tool parses those files and converts them into clean, shareable markdown documents.

## Installation

```bash
npm install -g publish-claude
```

Requires Node.js 18+.

## Usage

### Interactive Mode

Run without arguments to browse and select sessions:

```bash
publish-claude
```

This will:
1. List sessions from the current directory (use `--all` to see all projects)
2. Let you select a session by number (or press `a` to show all projects)
3. Choose to export to a file or create a GitHub gist

### Commands

```bash
# List sessions in current directory
publish-claude list

# List all sessions across all projects
publish-claude list --all

# Print session to stdout as markdown
publish-claude print <session-id>

# Export to a markdown file
publish-claude export <session-id> [output-file]

# Create a GitHub gist (requires gh CLI to be installed and authenticated)
publish-claude gist <session-id>
publish-claude gist <session-id> --public
```

## Output Format

The generated markdown is optimized for readability:

- **Title**: Uses Claude's auto-generated session summary
- **User messages**: Displayed as blockquotes for visual distinction
- **Assistant responses**: Plain markdown text
- **Tool usage**: Tool calls, results, and thinking are grouped together and collapsed in expandable `<details>` sections, labeled with the tools used (e.g., "Bash, Read, Edit")
- **Structure**: Horizontal rules separate each conversation turn

## Development

```bash
# Install dependencies
npm install

# Run from source
npm run dev

# Type check
npm run typecheck

# Build
npm run build
```

## How It Works

Claude Code stores sessions in `~/.claude/projects/<encoded-project-path>/<session-id>.jsonl`. Each line in these files is a JSON object representing a message, tool call, or metadata.

This tool:
1. Scans the projects directory to find all sessions
2. Extracts the summary, timestamps, and message counts
3. Parses the JSONL to reconstruct the conversation
4. Formats everything into clean markdown suitable for sharing or archiving
