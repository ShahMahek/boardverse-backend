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
    instructions: `You are a classifier. Decide if the user's message is related to board games.

IMPORTANT: Always read the conversation history to understand context.
- If history is about board games and the new message is a follow-up (even vague ones like "any more", "what else", "tell me more", "how much", "where to buy") — return YES.
- If the new message is clearly a new unrelated topic (like "what is the weather", "tell me a joke") — return NO even if history has board games.
- If there is no history and message is unrelated to board games — return NO.

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
      instructions: `You are BoardVerse AI, an expert on board games.

RULES:
- Only answer board game questions.
- Your knowledge base contains exactly 5 games: Catan, Chess, Ticket to Ride, Scrabble and Ludo.
- ONLY recommend games from the provided CONTEXT. Never add extra games or extra sections unless user specifically asks.
- For these 5 games ALWAYS use the provided CONTEXT as your primary source — trust it completely.
- For any other board game not in these 5, answer using the provided web search CONTEXT.
- Use chat history to correctly answer follow-up questions.
- Use markdown formatting for better readability.
- Use **bold** for headings and important terms.
- Use numbered lists or bullet points where helpful.
- Keep answers concise and to the point — no extra sections unless asked.`,
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