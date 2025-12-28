#!/usr/bin/env bun

import * as readline from "readline";
import { spawn } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import {
  listSessions,
  findSessionFile,
  parseSession,
  formatSessionToMarkdown,
  formatSessionsTable,
  type SessionInfo,
} from "./sessions";

let rl: readline.Interface | null = null;

function getReadline(): readline.Interface {
  if (!rl) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }
  return rl;
}

function closeReadline(): void {
  if (rl) {
    closeReadline();
    rl = null;
  }
}

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    getReadline().question(question, (answer) => {
      resolve(answer);
    });
  });
}

function printUsage(): void {
  console.log(`
publish-claude - Export Claude Code sessions to markdown

Usage:
  publish-claude                     Interactive mode: list sessions and pick one
  publish-claude list [--all]        List sessions (current directory by default)
  publish-claude print <session-id>  Print a session to stdout as markdown
  publish-claude export <session-id> [output-file]
                                     Export a session to a markdown file
  publish-claude gist <session-id>   Create a GitHub gist (requires gh CLI)
  publish-claude --help              Show this help message

Options:
  --all                              Show sessions from all projects, not just current directory

Examples:
  publish-claude
  publish-claude list
  publish-claude list --all
  publish-claude print a3c97c84-8c6c-4e11-8634-8794688ba6e1
  publish-claude export a3c97c84-8c6c-4e11-8634-8794688ba6e1 session.md
  publish-claude gist a3c97c84-8c6c-4e11-8634-8794688ba6e1
`);
}

async function handleList(showAll: boolean): Promise<void> {
  const filterPath = showAll ? undefined : process.cwd();
  const sessions = await listSessions(filterPath);

  if (sessions.length === 0) {
    if (showAll) {
      console.log("No sessions found.");
    } else {
      console.log("No sessions found in current directory.");
      console.log("Use --all to show sessions from all projects.");
    }
    return;
  }

  console.log(formatSessionsTable(sessions));
}

async function handlePrint(sessionId: string): Promise<void> {
  const result = findSessionFile(sessionId);

  if (!result) {
    console.error(`Session not found: ${sessionId}`);
    console.error("\nUse 'publish-claude list' to see available sessions.");
    process.exit(1);
  }

  const { filePath, projectPath } = result;
  const messages = await parseSession(filePath);

  if (messages.length === 0) {
    console.error("No messages found in session.");
    process.exit(1);
  }

  const markdown = formatSessionToMarkdown(sessionId, projectPath, messages);
  console.log(markdown);
}

async function handleExport(
  sessionId: string,
  outputFile?: string
): Promise<void> {
  const result = findSessionFile(sessionId);

  if (!result) {
    console.error(`Session not found: ${sessionId}`);
    console.error("\nUse 'publish-claude list' to see available sessions.");
    process.exit(1);
  }

  const { filePath, projectPath } = result;
  const messages = await parseSession(filePath);

  if (messages.length === 0) {
    console.error("No messages found in session.");
    process.exit(1);
  }

  const markdown = formatSessionToMarkdown(sessionId, projectPath, messages);

  const filename = outputFile || `session-${sessionId}.md`;
  await Bun.write(filename, markdown);
  console.log(`Exported session to: ${filename}`);
}

async function createGist(
  filename: string,
  description: string,
  isPublic: boolean
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["gist", "create", filename, "--desc", description];
    if (isPublic) {
      args.push("--public");
    }

    const proc = spawn("gh", args, { stdio: ["inherit", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr || `gh exited with code ${code}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to run gh CLI: ${err.message}`));
    });
  });
}

async function handleGist(
  sessionId: string,
  isPublic: boolean = false
): Promise<string> {
  const result = findSessionFile(sessionId);

  if (!result) {
    console.error(`Session not found: ${sessionId}`);
    console.error("\nUse 'publish-claude list' to see available sessions.");
    process.exit(1);
  }

  const { filePath, projectPath } = result;
  const messages = await parseSession(filePath);

  if (messages.length === 0) {
    console.error("No messages found in session.");
    process.exit(1);
  }

  const markdown = formatSessionToMarkdown(sessionId, projectPath, messages);

  // Write to temp file
  const tempFile = join(tmpdir(), `claude-session-${sessionId}.md`);
  await Bun.write(tempFile, markdown);

  // Create gist
  const date = new Date().toISOString().split("T")[0];
  const description = `Claude Code Session - ${projectPath} - ${date}`;

  const gistUrl = await createGist(tempFile, description, isPublic);
  console.log(`Created gist: ${gistUrl}`);

  return gistUrl;
}

async function promptForNumber(
  question: string,
  min: number,
  max: number
): Promise<number> {
  while (true) {
    const answer = await prompt(question);
    const num = parseInt(answer.trim(), 10);
    if (!isNaN(num) && num >= min && num <= max) {
      return num;
    }
    question = `Please enter a number between ${min} and ${max}: `;
  }
}

async function promptForFilename(defaultName: string): Promise<string> {
  const answer = await prompt(`Output file [${defaultName}]: `);
  return answer.trim() || defaultName;
}

async function promptForSession(
  sessions: SessionInfo[],
  canShowAll: boolean
): Promise<number> {
  const hint = canShowAll ? ", or 'a' to show all projects" : "";
  let question = `Select a session (1-${sessions.length}${hint}): `;

  while (true) {
    const answer = await prompt(question);
    const trimmed = answer.trim().toLowerCase();

    if (canShowAll && trimmed === "a") {
      // Return -1 to signal "show all"
      return -1;
    }

    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 1 && num <= sessions.length) {
      return num;
    }

    question = `Please enter 1-${sessions.length}${hint}: `;
  }
}

async function interactiveMode(showAll: boolean): Promise<void> {
  const filterPath = showAll ? undefined : process.cwd();
  let sessions = await listSessions(filterPath);

  if (sessions.length === 0) {
    if (showAll) {
      console.log("No sessions found.");
      closeReadline();
      return;
    } else {
      console.log("No sessions found in current directory. Showing all sessions.\n");
      sessions = await listSessions();
      if (sessions.length === 0) {
        console.log("No sessions found.");
        closeReadline();
        return;
      }
    }
  }

  console.log("\nClaude Code Sessions\n");
  console.log(formatSessionsTable(sessions, false));
  console.log();

  let selection = await promptForSession(sessions, !showAll);

  // If user chose "all", reload and re-prompt
  if (selection === -1) {
    sessions = await listSessions();
    console.log("\nAll Sessions\n");
    console.log(formatSessionsTable(sessions, false));
    console.log();
    selection = await promptForSession(sessions, false);
  }

  const selectedSession = sessions[selection - 1];
  console.log(`\nSelected: ${selectedSession.sessionId}`);
  console.log(`Project: ${selectedSession.projectPath}`);

  console.log("\nWhat would you like to do?");
  console.log("  1. Export to file");
  console.log("  2. Create GitHub gist (private)");
  console.log("  3. Create GitHub gist (public)");

  const action = await promptForNumber("Choose an action (1-3): ", 1, 3);

  const result = findSessionFile(selectedSession.sessionId);
  if (!result) {
    console.error("Session file not found.");
    closeReadline();
    process.exit(1);
  }

  const messages = await parseSession(result.filePath);
  if (messages.length === 0) {
    console.error("No messages found in session.");
    closeReadline();
    process.exit(1);
  }

  const markdown = formatSessionToMarkdown(
    selectedSession.sessionId,
    selectedSession.projectPath,
    messages
  );

  if (action === 1) {
    const defaultFilename = `session-${selectedSession.sessionId}.md`;
    const filename = await promptForFilename(defaultFilename);
    await Bun.write(filename, markdown);
    console.log(`\nExported session to: ${filename}`);
  } else {
    const isPublic = action === 3;
    const tempFile = join(tmpdir(), `claude-session-${selectedSession.sessionId}.md`);
    await Bun.write(tempFile, markdown);

    const date = new Date().toISOString().split("T")[0];
    const description = `Claude Code Session - ${selectedSession.projectPath} - ${date}`;

    try {
      const gistUrl = await createGist(tempFile, description, isPublic);
      console.log(`\nCreated gist: ${gistUrl}`);
    } catch (error) {
      console.error(`\nFailed to create gist: ${(error as Error).message}`);
      console.error("Make sure you have the gh CLI installed and authenticated.");
      closeReadline();
      process.exit(1);
    }
  }

  closeReadline();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const showAll = args.includes("--all");
  const filteredArgs = args.filter((arg) => arg !== "--all");

  if (filteredArgs.length === 0) {
    await interactiveMode(showAll);
    return;
  }

  const command = filteredArgs[0];

  switch (command) {
    case "--help":
    case "-h":
    case "help":
      printUsage();
      break;

    case "list":
    case "ls":
      await handleList(showAll);
      break;

    case "print":
      if (!filteredArgs[1]) {
        console.error("Error: session-id is required");
        console.error("Usage: publish-claude print <session-id>");
        process.exit(1);
      }
      await handlePrint(filteredArgs[1]);
      break;

    case "export":
      if (!filteredArgs[1]) {
        console.error("Error: session-id is required");
        console.error("Usage: publish-claude export <session-id> [output-file]");
        process.exit(1);
      }
      await handleExport(filteredArgs[1], filteredArgs[2]);
      break;

    case "gist":
      if (!filteredArgs[1]) {
        console.error("Error: session-id is required");
        console.error("Usage: publish-claude gist <session-id> [--public]");
        process.exit(1);
      }
      await handleGist(filteredArgs[1], args.includes("--public"));
      break;

    default:
      // If it looks like a session ID, treat it as print command
      if (command.match(/^[a-f0-9-]{36}$/)) {
        await handlePrint(command);
      } else {
        console.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
      }
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
