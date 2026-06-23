import { Response } from "express";
import { openai } from "../config/openai";
import { getGameContext } from "../services/rag.service";
import { getOrCreateSession, updateSessionTitle, createNewSession } from "../services/session.service";
import { saveMessage, getSessionMessages } from "../services/chat.service";
import { getWebContext } from "../services/webSearch.service";
import { AuthRequest } from "../middleware/auth.middleware";

async function isBoardGameQuestion(message: string, history: string): Promise<boolean> {
  const result = await openai.responses.create({
    model: process.env.AZURE_OPENAI_DEPLOYMENT!,
    instructions: `You are a board game topic classifier.

Read the conversation history and the new message together as a whole.
If the overall conversation is about board games or the new message asks about games, gaming, playing — return YES.
Only return NO if the message is completely unrelated to games entirely (weather, cooking, politics etc).

Reply with ONLY one word: YES or NO.`,
    input: `Recent conversation:
${history || "None"}

New message: ${message}`,
  });
  return result.output_text.trim().toUpperCase().startsWith("YES");
}

export const chat = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { message, sessionId: clientSessionId } = req.body;

    if (!message) {
      res.status(400).json({ error: "Message is required" });
      return;
    }

    const userId = req.user!.id;

    const sessionId = clientSessionId
      ? Number(clientSessionId)
      : await createNewSession(userId);

    const historyRows = await getSessionMessages(sessionId);
    const conversationHistory = historyRows
      .slice(-6)
      .map((m) => `${m.Role}: ${m.Message}`)
      .join("\n");

    const relevant = await isBoardGameQuestion(message, conversationHistory);

    await saveMessage(sessionId, "user", message, null);
    await updateSessionTitle(sessionId, message.trim());

    if (!relevant) {
      const offTopicReply = "I'm BoardVerse AI, your board game expert! I can only help with board game rules, strategy, recommendations, and history. Ask me anything about your favourite games! 🎲";
      await saveMessage(sessionId, "assistant", offTopicReply, null);

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.write(`data: ${JSON.stringify({ type: "meta", sessionId, source: null, sourceUrls: [] })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "token", token: offTopicReply })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
      return;
    }

    const ragContext = await getGameContext(message);
    let source = "";
    let context = "";
    let sourceUrls: string[] = [];

    const ragIsUseful = ragContext && ragContext.trim().length > 50;

    const vagueFollowUp = /^(any more|what else|more|others|and\?|really|wow|ok|sure|yes|go on|continue)$/i.test(message.trim());

    if (ragIsUseful) {
      source = "RAG";
      context = ragContext;
    } else if (vagueFollowUp) {
      source = "WEB";
      context = conversationHistory; // reuse history as context
    } else {
      source = "WEB";
      const webResult = await getWebContext(message);
      context = webResult.context;
      sourceUrls = webResult.urls;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    res.write(`data: ${JSON.stringify({ type: "meta", sessionId, source, sourceUrls })}\n\n`);

    const stream = await openai.responses.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT!,
      stream: true,
      instructions: `You are BoardVerse AI, a friendly and knowledgeable board game expert.

RULES:
- Only answer board game questions.
- You have detailed knowledge about Catan, Chess, Ticket to Ride, Scrabble and Ludo from your knowledge base — always use the provided CONTEXT for these.
- For ANY other board game question, use the provided CONTEXT from web search to answer.
- NEVER say "I only specialize in 5 games" or "I don't have info on that" — always give a helpful answer.
- If user asks "what about board games" or "any more" or "what else" — give them a list of popular board games with brief descriptions.
- Use chat history to understand follow-up questions correctly.
- Use markdown formatting, **bold** for important terms, bullet points where helpful.
- Keep answers friendly, concise and helpful.`,
      input: `CHAT HISTORY
${conversationHistory}

CONTEXT
${context}

CURRENT QUESTION
${message}`,
    });

    let fullAnswer = "";

    for await (const event of stream) {
      if (event.type === "response.output_text.delta" && event.delta) {
        fullAnswer += event.delta;
        res.write(`data: ${JSON.stringify({ type: "token", token: event.delta })}\n\n`);
      }
    }

    await saveMessage(sessionId, "assistant", fullAnswer, source);

    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();

  } catch (error) {
    console.error(error);
    res.write(`data: ${JSON.stringify({ type: "error", message: "Something went wrong" })}\n\n`);
    res.end();
  }
};