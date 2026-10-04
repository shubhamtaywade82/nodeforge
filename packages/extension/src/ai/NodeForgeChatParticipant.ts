/**
 * `@nodeforge` chat participant — native VS Code Chat entry point.
 *
 * Uses the model the user selected in the Chat UI (`request.model`) and the
 * NodeForge language-model tools through `vscode.lm.invokeTool`, so tool
 * confirmations and Workspace Trust behave exactly as they do for Agent mode.
 */

import * as vscode from "vscode";
import {
  buildSystemPrompt,
  clampToolRounds,
  findParticipantCommand,
  selectTools
} from "./participantCommands.js";
import { logger } from "../core/Logger.js";

export const CHAT_PARTICIPANT_ID = "nodeforge.engineer";
const MAX_HISTORY_TURNS = 6;

export function registerNodeForgeChatParticipant(
  context: vscode.ExtensionContext,
  isTrusted: () => boolean
): void {
  const participant = vscode.chat.createChatParticipant(
    CHAT_PARTICIPANT_ID,
    (request, chatContext, stream, token) =>
      handleRequest(request, chatContext, stream, token, isTrusted())
  );
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "nodeforge.svg");
  context.subscriptions.push(participant);
}

async function handleRequest(
  request: vscode.ChatRequest,
  chatContext: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  trusted: boolean
): Promise<vscode.ChatResult> {
  const command = findParticipantCommand(request.command);
  const tools = selectTools(vscode.lm.tools, command, trusted).map<vscode.LanguageModelChatTool>(
    (t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })
  );

  if (!trusted && command) {
    stream.markdown(
      "This workspace is in **Restricted Mode**. Trust the workspace to let NodeForge run diagnostics, tests and scripts."
    );
    return { metadata: { command: command.name, blocked: "untrusted" } };
  }

  const messages: vscode.LanguageModelChatMessage[] = [
    vscode.LanguageModelChatMessage.User(buildSystemPrompt(command, trusted)),
    ...historyMessages(chatContext),
    vscode.LanguageModelChatMessage.User(request.prompt || "Proceed.")
  ];

  const maxRounds = clampToolRounds(
    vscode.workspace.getConfiguration("nodeforge.chat").get<number>("maxToolRounds", 8)
  );

  try {
    for (let round = 0; round < maxRounds; round++) {
      const response = await request.model.sendRequest(
        messages,
        { tools, toolMode: vscode.LanguageModelChatToolMode.Auto },
        token
      );

      const calls: vscode.LanguageModelToolCallPart[] = [];
      const text: string[] = [];
      for await (const part of response.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
          stream.markdown(part.value);
          text.push(part.value);
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          calls.push(part);
        }
      }

      if (calls.length === 0) return { metadata: { command: request.command, rounds: round + 1 } };

      messages.push(
        vscode.LanguageModelChatMessage.Assistant([
          ...(text.length ? [new vscode.LanguageModelTextPart(text.join(""))] : []),
          ...calls
        ])
      );

      const results: vscode.LanguageModelToolResultPart[] = [];
      for (const call of calls) {
        results.push(await invokeTool(call, request, stream, token));
      }
      messages.push(vscode.LanguageModelChatMessage.User(results));
    }

    stream.markdown(`\n\n_Stopped after ${maxRounds} tool rounds (nodeforge.chat.maxToolRounds)._`);
    return { metadata: { command: request.command, truncated: true } };
  } catch (err) {
    if (err instanceof vscode.CancellationError) return {};
    logger.error("@nodeforge request failed", err);
    const message = err instanceof Error ? err.message : String(err);
    stream.markdown(`NodeForge could not complete the request: ${message}`);
    return { errorDetails: { message } };
  }
}

async function invokeTool(
  call: vscode.LanguageModelToolCallPart,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<vscode.LanguageModelToolResultPart> {
  stream.progress(`Running ${call.name}`);
  try {
    const result = await vscode.lm.invokeTool(
      call.name,
      { input: call.input, toolInvocationToken: request.toolInvocationToken },
      token
    );
    return new vscode.LanguageModelToolResultPart(call.callId, result.content);
  } catch (err) {
    if (err instanceof vscode.CancellationError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`Tool ${call.name} failed: ${message}`);
    return new vscode.LanguageModelToolResultPart(call.callId, [
      new vscode.LanguageModelTextPart(JSON.stringify({ error: message }))
    ]);
  }
}

function historyMessages(chatContext: vscode.ChatContext): vscode.LanguageModelChatMessage[] {
  const out: vscode.LanguageModelChatMessage[] = [];
  for (const turn of chatContext.history.slice(-MAX_HISTORY_TURNS)) {
    if (turn instanceof vscode.ChatRequestTurn) {
      out.push(vscode.LanguageModelChatMessage.User(turn.prompt));
    } else if (turn instanceof vscode.ChatResponseTurn) {
      const text = turn.response
        .map((part) => (part instanceof vscode.ChatResponseMarkdownPart ? part.value.value : ""))
        .join("");
      if (text) out.push(vscode.LanguageModelChatMessage.Assistant(text));
    }
  }
  return out;
}
