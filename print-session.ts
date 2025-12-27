import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";

interface ContentBlock {
  type: "text" | "tool_use" | "tool_result" | "thinking";
  text?: string;
  thinking?: string;
  name?: string;
  input?: unknown;
  content?: string | ContentBlock[];
  tool_use_id?: string;
}

interface SessionMessage {
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

function decodeProjectPath(encoded: string): string {
  return encoded.replace(/-/g, "/");
}

function findSessionFile(sessionId: string): { filePath: string; projectPath: string } | null {
  const claudeDir = path.join(os.homedir(), ".claude", "projects");

  if (!fs.existsSync(claudeDir)) {
    return null;
  }

  const projectDirs = fs.readdirSync(claudeDir);

  for (const projectDir of projectDirs) {
    const projectPath = path.join(claudeDir, projectDir);
    const stat = fs.statSync(projectPath);

    if (!stat.isDirectory()) continue;

    const sessionFile = path.join(projectPath, `${sessionId}.jsonl`);
    if (fs.existsSync(sessionFile)) {
      return {
        filePath: sessionFile,
        projectPath: decodeProjectPath(projectDir),
      };
    }
  }

  return null;
}

function formatContentBlock(block: ContentBlock, indent = ""): string {
  switch (block.type) {
    case "text":
      return block.text || "";

    case "thinking":
      return `<details>\n<summary>Thinking</summary>\n\n${block.thinking || ""}\n\n</details>\n`;

    case "tool_use":
      return `**Tool Use: ${block.name}**\n\`\`\`json\n${JSON.stringify(block.input, null, 2)}\n\`\`\`\n`;

    case "tool_result":
      const content = block.content;
      if (typeof content === "string") {
        // Truncate very long tool results
        const truncated = content.length > 500
          ? content.slice(0, 500) + "\n... (truncated)"
          : content;
        return `**Tool Result:**\n\`\`\`\n${truncated}\n\`\`\`\n`;
      }
      if (Array.isArray(content)) {
        return content
          .map((c) => {
            if (typeof c === "object" && c.type === "text") {
              const text = (c as ContentBlock).text || "";
              const truncated = text.length > 500
                ? text.slice(0, 500) + "\n... (truncated)"
                : text;
              return `**Tool Result:**\n\`\`\`\n${truncated}\n\`\`\`\n`;
            }
            return "";
          })
          .join("\n");
      }
      return "";

    default:
      return "";
  }
}

function formatMessage(msg: SessionMessage): string {
  const role = msg.type === "user" ? "User" : "Assistant";
  const content = msg.message.content;

  let formattedContent = "";

  if (typeof content === "string") {
    // Skip command-related meta content
    if (content.startsWith("<command-name>") || content.startsWith("<local-command-stdout>")) {
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

async function parseSession(filePath: string): Promise<SessionMessage[]> {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const messages: SessionMessage[] = [];
  const seenUuids = new Set<string>();

  for await (const line of rl) {
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

async function printSession(sessionId: string) {
  const result = findSessionFile(sessionId);

  if (!result) {
    console.error(`Session not found: ${sessionId}`);
    console.error("\nUse list-sessions.ts to see available sessions.");
    process.exit(1);
  }

  const { filePath, projectPath } = result;
  const messages = await parseSession(filePath);

  if (messages.length === 0) {
    console.error("No messages found in session.");
    process.exit(1);
  }

  const firstMessage = messages[0];
  const sessionDate = new Date(firstMessage.timestamp).toLocaleString();

  // Print header
  console.log(`# Session: ${sessionId}\n`);
  console.log(`**Project:** ${projectPath}`);
  console.log(`**Date:** ${sessionDate}`);
  console.log(`**Messages:** ${messages.length}`);
  console.log("\n---\n");

  // Print messages
  for (const msg of messages) {
    const formatted = formatMessage(msg);
    if (formatted) {
      console.log(formatted);
      console.log("\n---\n");
    }
  }
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: npx ts-node print-session.ts <session-id>");
    console.error("\nExample: npx ts-node print-session.ts a3c97c84-8c6c-4e11-8634-8794688ba6e1");
    process.exit(1);
  }

  const sessionId = args[0];
  printSession(sessionId).catch(console.error);
}

main();
