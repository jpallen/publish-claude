#!/usr/bin/env bun

import * as readline from "readline";
import {
  listSessions,
  findSessionFile,
  parseSession,
  formatSessionToMarkdown,
  formatSessionsTable,
  type SessionInfo,
} from "./sessions";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

function printUsage(): void {
  console.log(`
publish-claude - Export Claude Code sessions to markdown

Usage:
  publish-claude                     Interactive mode: list sessions and pick one to export
  publish-claude list                List all sessions
  publish-claude print <session-id>  Print a session to stdout as markdown
  publish-claude export <session-id> [output-file]
                                     Export a session to a markdown file
  publish-claude --help              Show this help message

Examples:
  publish-claude
  publish-claude list
  publish-claude print a3c97c84-8c6c-4e11-8634-8794688ba6e1
  publish-claude export a3c97c84-8c6c-4e11-8634-8794688ba6e1 session.md
`);
}

async function handleList(): Promise<void> {
  const sessions = await listSessions();

  if (sessions.length === 0) {
    console.log("No sessions found.");
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

async function interactiveMode(): Promise<void> {
  const sessions = await listSessions();

  if (sessions.length === 0) {
    console.log("No sessions found.");
    rl.close();
    return;
  }

  console.log("\nClaude Code Sessions\n");
  console.log(formatSessionsTable(sessions));
  console.log();

  const selection = await promptForNumber(
    `Select a session (1-${sessions.length}): `,
    1,
    sessions.length
  );

  const selectedSession = sessions[selection - 1];
  console.log(`\nSelected: ${selectedSession.sessionId}`);
  console.log(`Project: ${selectedSession.projectPath}`);

  const defaultFilename = `session-${selectedSession.sessionId}.md`;
  const filename = await promptForFilename(defaultFilename);

  const result = findSessionFile(selectedSession.sessionId);
  if (!result) {
    console.error("Session file not found.");
    rl.close();
    process.exit(1);
  }

  const messages = await parseSession(result.filePath);
  if (messages.length === 0) {
    console.error("No messages found in session.");
    rl.close();
    process.exit(1);
  }

  const markdown = formatSessionToMarkdown(
    selectedSession.sessionId,
    selectedSession.projectPath,
    messages
  );

  await Bun.write(filename, markdown);
  console.log(`\nExported session to: ${filename}`);
  rl.close();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    await interactiveMode();
    return;
  }

  const command = args[0];

  switch (command) {
    case "--help":
    case "-h":
    case "help":
      printUsage();
      break;

    case "list":
    case "ls":
      await handleList();
      break;

    case "print":
      if (!args[1]) {
        console.error("Error: session-id is required");
        console.error("Usage: publish-claude print <session-id>");
        process.exit(1);
      }
      await handlePrint(args[1]);
      break;

    case "export":
      if (!args[1]) {
        console.error("Error: session-id is required");
        console.error("Usage: publish-claude export <session-id> [output-file]");
        process.exit(1);
      }
      await handleExport(args[1], args[2]);
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
