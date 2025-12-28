import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result" | "thinking";
  text?: string;
  thinking?: string;
  name?: string;
  input?: unknown;
  content?: string | ContentBlock[];
  tool_use_id?: string;
}

export interface SessionMessage {
  type: "user" | "assistant";
  message: {
    role: "user" | "assistant";
    content: string | ContentBlock[];
    model?: string;
  };
  uuid: string;
  timestamp: string;
  sessionId: string;
  cwd: string;
  isMeta?: boolean;
}

export interface SessionInfo {
  sessionId: string;
  projectPath: string;
  filePath: string;
  date: string;
  messageCount: number;
  summary: string;
}

function encodeProjectPath(path: string): string {
  return path.replace(/\//g, "-");
}

function decodeProjectPath(encoded: string): string {
  // Claude's encoding is lossy (- could be / or literal -)
  // Try to find the actual path by checking if it exists
  const simple = encoded.replace(/-/g, "/");
  if (existsSync(simple)) {
    return simple;
  }

  // Try to reconstruct by checking each segment
  const parts = encoded.split("-").filter(Boolean);
  let path = "";
  for (const part of parts) {
    const withSlash = path + "/" + part;
    const withDash = path ? path + "-" + part : part;

    if (existsSync(withSlash)) {
      path = withSlash;
    } else if (path && existsSync(withDash)) {
      path = withDash;
    } else {
      // Default to slash if we can't determine
      path = withSlash;
    }
  }

  return path || simple;
}

export function getClaudeProjectsDir(): string {
  return join(homedir(), ".claude", "projects");
}

export function findSessionFile(
  sessionId: string
): { filePath: string; projectPath: string } | null {
  const claudeDir = getClaudeProjectsDir();

  if (!existsSync(claudeDir)) {
    return null;
  }

  const projectDirs = readdirSync(claudeDir);

  for (const projectDir of projectDirs) {
    const projectPath = join(claudeDir, projectDir);
    const stat = statSync(projectPath);

    if (!stat.isDirectory()) continue;

    const sessionFile = join(projectPath, `${sessionId}.jsonl`);
    if (existsSync(sessionFile)) {
      return {
        filePath: sessionFile,
        projectPath: decodeProjectPath(projectDir),
      };
    }
  }

  return null;
}

async function getSessionSummary(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  const text = await file.text();
  const lines = text.split("\n");

  // First, look for a summary line
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === "summary" && parsed.summary) {
        return parsed.summary;
      }
    } catch {
      // Skip invalid JSON lines
    }
  }

  // Fall back to first user message if no summary
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (
        parsed.type === "user" &&
        !parsed.isMeta &&
        parsed.message?.content
      ) {
        const content = parsed.message.content;
        if (typeof content === "string") {
          if (
            content.startsWith("<command-name>") ||
            content.startsWith("<local-command-stdout>")
          ) {
            continue;
          }
          return content.slice(0, 80) + (content.length > 80 ? "..." : "");
        }
      }
    } catch {
      // Skip invalid JSON lines
    }
  }
  return "";
}

async function countMessages(filePath: string): Promise<number> {
  const file = Bun.file(filePath);
  const text = await file.text();
  const lines = text.split("\n");

  let count = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (
        (parsed.type === "user" || parsed.type === "assistant") &&
        !parsed.isMeta
      ) {
        count++;
      }
    } catch {
      // Skip invalid JSON lines
    }
  }
  return count;
}

async function getSessionDate(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  const text = await file.text();
  const lines = text.split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.timestamp) {
        return parsed.timestamp;
      }
    } catch {
      // Skip invalid JSON lines
    }
  }
  return "";
}

export async function listSessions(filterPath?: string): Promise<SessionInfo[]> {
  const claudeDir = getClaudeProjectsDir();
  const sessions: SessionInfo[] = [];

  if (!existsSync(claudeDir)) {
    return sessions;
  }

  const projectDirs = readdirSync(claudeDir);

  for (const projectDir of projectDirs) {
    const projectPath = join(claudeDir, projectDir);
    const stat = statSync(projectPath);

    if (!stat.isDirectory()) continue;

    const files = readdirSync(projectPath);

    // Filter by path if specified (compare encoded paths to avoid lossy decode issues)
    if (filterPath) {
      const encodedFilter = encodeProjectPath(filterPath);
      if (!projectDir.startsWith(encodedFilter)) {
        continue;
      }
    }

    const decodedProjectPath = decodeProjectPath(projectDir);

    for (const file of files) {
      // Skip agent files, only process UUID.jsonl files
      if (!file.endsWith(".jsonl") || file.startsWith("agent-")) continue;

      const sessionId = file.replace(".jsonl", "");
      const filePath = join(projectPath, file);

      const [date, messageCount, summary] = await Promise.all([
        getSessionDate(filePath),
        countMessages(filePath),
        getSessionSummary(filePath),
      ]);

      sessions.push({
        sessionId,
        projectPath: decodedProjectPath,
        filePath,
        date,
        messageCount,
        summary,
      });
    }
  }

  // Sort by date descending (newest first)
  sessions.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  return sessions;
}

function formatContentBlock(block: ContentBlock): string {
  switch (block.type) {
    case "text":
      return block.text || "";

    case "thinking":
      return `<details>\n<summary>Thinking</summary>\n\n${block.thinking || ""}\n\n</details>\n`;

    case "tool_use":
      return `**Tool Use: ${block.name}**\n\`\`\`json\n${JSON.stringify(block.input, null, 2)}\n\`\`\`\n`;

    case "tool_result": {
      const content = block.content;
      if (typeof content === "string") {
        const truncated =
          content.length > 500
            ? content.slice(0, 500) + "\n... (truncated)"
            : content;
        return `**Tool Result:**\n\`\`\`\n${truncated}\n\`\`\`\n`;
      }
      if (Array.isArray(content)) {
        return content
          .map((c) => {
            if (typeof c === "object" && c.type === "text") {
              const text = (c as ContentBlock).text || "";
              const truncated =
                text.length > 500
                  ? text.slice(0, 500) + "\n... (truncated)"
                  : text;
              return `**Tool Result:**\n\`\`\`\n${truncated}\n\`\`\`\n`;
            }
            return "";
          })
          .join("\n");
      }
      return "";
    }

    default:
      return "";
  }
}

function formatMessage(msg: SessionMessage): string {
  const role = msg.type === "user" ? "User" : "Assistant";
  const content = msg.message.content;

  let formattedContent = "";

  if (typeof content === "string") {
    if (
      content.startsWith("<command-name>") ||
      content.startsWith("<local-command-stdout>")
    ) {
      return "";
    }
    formattedContent = content;
  } else if (Array.isArray(content)) {
    const parts: string[] = [];

    for (const block of content) {
      const formatted = formatContentBlock(block as ContentBlock);
      if (formatted) {
        parts.push(formatted);
      }
    }

    formattedContent = parts.join("\n\n");
  }

  if (!formattedContent.trim()) {
    return "";
  }

  const timestamp = new Date(msg.timestamp).toLocaleString();
  return `## ${role}\n*${timestamp}*\n\n${formattedContent}`;
}

export async function parseSession(filePath: string): Promise<SessionMessage[]> {
  const file = Bun.file(filePath);
  const text = await file.text();
  const lines = text.split("\n");

  const messages: SessionMessage[] = [];
  const seenUuids = new Set<string>();

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);

      // Skip non-message lines
      if (parsed.type === "file-history-snapshot") continue;

      // Skip meta messages
      if (parsed.isMeta) continue;

      // Skip if not a user/assistant message
      if (parsed.type !== "user" && parsed.type !== "assistant") continue;

      // Skip duplicate UUIDs (streaming can create multiple entries)
      if (seenUuids.has(parsed.uuid)) continue;
      seenUuids.add(parsed.uuid);

      messages.push(parsed as SessionMessage);
    } catch {
      // Skip invalid JSON lines
    }
  }

  return messages;
}

export function formatSessionToMarkdown(
  sessionId: string,
  projectPath: string,
  messages: SessionMessage[]
): string {
  if (messages.length === 0) {
    return "";
  }

  const firstMessage = messages[0];
  const sessionDate = new Date(firstMessage.timestamp).toLocaleString();

  const lines: string[] = [];

  // Header
  lines.push(`# Session: ${sessionId}\n`);
  lines.push(`**Project:** ${projectPath}`);
  lines.push(`**Date:** ${sessionDate}`);
  lines.push(`**Messages:** ${messages.length}`);
  lines.push("\n---\n");

  // Messages
  for (const msg of messages) {
    const formatted = formatMessage(msg);
    if (formatted) {
      lines.push(formatted);
      lines.push("\n---\n");
    }
  }

  return lines.join("\n");
}

export function formatDate(isoDate: string): string {
  if (!isoDate) return "N/A";
  const date = new Date(isoDate);
  return date.toISOString().split("T")[0];
}

export function truncate(str: string, len: number): string {
  if (str.length <= len) return str.padEnd(len);
  return str.slice(0, len - 3) + "...";
}

export function formatSessionsTable(
  sessions: SessionInfo[],
  showSessionId: boolean = true
): string {
  const lines: string[] = [];

  if (showSessionId) {
    lines.push(
      `${"#".padEnd(4)}| ${"Session ID".padEnd(38)}| ${"Project".padEnd(30)}| ${"Date".padEnd(12)}| ${"Msgs".padEnd(5)}| Summary`
    );
    lines.push("-".repeat(130));

    sessions.forEach((session, index) => {
      lines.push(
        `${String(index + 1).padEnd(4)}| ${session.sessionId.padEnd(38)}| ${truncate(session.projectPath, 30)}| ${formatDate(session.date).padEnd(12)}| ${String(session.messageCount).padEnd(5)}| ${session.summary}`
      );
    });
  } else {
    lines.push(
      `${"#".padEnd(4)}| ${"Project".padEnd(35)}| ${"Date".padEnd(12)}| ${"Msgs".padEnd(5)}| Summary`
    );
    lines.push("-".repeat(100));

    sessions.forEach((session, index) => {
      lines.push(
        `${String(index + 1).padEnd(4)}| ${truncate(session.projectPath, 35)}| ${formatDate(session.date).padEnd(12)}| ${String(session.messageCount).padEnd(5)}| ${session.summary}`
      );
    });
  }

  lines.push(`\nTotal: ${sessions.length} sessions`);

  return lines.join("\n");
}
