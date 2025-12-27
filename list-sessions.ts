import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";

interface SessionMessage {
  type: "user" | "assistant";
  message: {
    role: "user" | "assistant";
    content: string | unknown[];
  };
  uuid: string;
  timestamp: string;
  sessionId: string;
  cwd: string;
  isMeta?: boolean;
}

interface SessionInfo {
  sessionId: string;
  projectPath: string;
  date: string;
  messageCount: number;
  firstUserMessage: string;
}

function decodeProjectPath(encoded: string): string {
  // Convert -Users-james-dev-foo to /Users/james/dev/foo
  return encoded.replace(/-/g, "/");
}

async function getFirstUserMessage(filePath: string): Promise<string> {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    try {
      const parsed = JSON.parse(line);
      if (
        parsed.type === "user" &&
        !parsed.isMeta &&
        parsed.message?.content
      ) {
        const content = parsed.message.content;
        if (typeof content === "string") {
          // Skip command-related messages
          if (content.startsWith("<command-name>") || content.startsWith("<local-command-stdout>")) {
            continue;
          }
          rl.close();
          return content.slice(0, 60) + (content.length > 60 ? "..." : "");
        }
      }
    } catch {
      // Skip invalid JSON lines
    }
  }
  return "";
}

async function countMessages(filePath: string): Promise<number> {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let count = 0;
  for await (const line of rl) {
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
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.timestamp) {
        rl.close();
        return parsed.timestamp;
      }
    } catch {
      // Skip invalid JSON lines
    }
  }
  return "";
}

async function listSessions(): Promise<SessionInfo[]> {
  const claudeDir = path.join(os.homedir(), ".claude", "projects");
  const sessions: SessionInfo[] = [];

  if (!fs.existsSync(claudeDir)) {
    console.error("Claude projects directory not found:", claudeDir);
    return sessions;
  }

  const projectDirs = fs.readdirSync(claudeDir);

  for (const projectDir of projectDirs) {
    const projectPath = path.join(claudeDir, projectDir);
    const stat = fs.statSync(projectPath);

    if (!stat.isDirectory()) continue;

    const files = fs.readdirSync(projectPath);

    for (const file of files) {
      // Skip agent files, only process UUID.jsonl files
      if (!file.endsWith(".jsonl") || file.startsWith("agent-")) continue;

      const sessionId = file.replace(".jsonl", "");
      const filePath = path.join(projectPath, file);

      const [date, messageCount, firstUserMessage] = await Promise.all([
        getSessionDate(filePath),
        countMessages(filePath),
        getFirstUserMessage(filePath),
      ]);

      sessions.push({
        sessionId,
        projectPath: decodeProjectPath(projectDir),
        date,
        messageCount,
        firstUserMessage,
      });
    }
  }

  // Sort by date descending (newest first)
  sessions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return sessions;
}

function formatDate(isoDate: string): string {
  if (!isoDate) return "N/A";
  const date = new Date(isoDate);
  return date.toISOString().split("T")[0];
}

function truncate(str: string, len: number): string {
  if (str.length <= len) return str.padEnd(len);
  return str.slice(0, len - 3) + "...";
}

async function main() {
  const sessions = await listSessions();

  if (sessions.length === 0) {
    console.log("No sessions found.");
    return;
  }

  // Print header
  console.log(
    `${"Session ID".padEnd(38)}| ${"Project".padEnd(30)}| ${"Date".padEnd(12)}| ${"Msgs".padEnd(5)}| First Message`
  );
  console.log("-".repeat(120));

  for (const session of sessions) {
    console.log(
      `${session.sessionId.padEnd(38)}| ${truncate(session.projectPath, 30)}| ${formatDate(session.date).padEnd(12)}| ${String(session.messageCount).padEnd(5)}| ${session.firstUserMessage}`
    );
  }

  console.log(`\nTotal: ${sessions.length} sessions`);
}

main().catch(console.error);
