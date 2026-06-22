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

Consider the recent conversation history to understand follow-up questions like:
"what does it cost?", "tell me more", "any others?", "which is best?",
"do you have more?", "any other options?", "what else?", "tell me more about it"
— these ARE board game related if the history is about board games.

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
      const offTopicReply =
        "I'm BoardVerse AI, your board game expert! I can only help with board game rules, strategy, recommendations, and history. Ask me anything about your favourite games! 🎲";

      await saveMessage(sessionId, "assistant", offTopicReply, null);

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.write(`data: ${JSON.stringify({ type: "meta", sessionId, source: null })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "token", token: offTopicReply })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
      return;
    }

    const ragContext = await getGameContext(message);
    let source = "";
    let context = "";

    const ragIsUseful = ragContext && ragContext.trim().length > 50;

    if (ragIsUseful) {
      source = "RAG";
      context = ragContext;
    } else {
      source = "WEB";
      context = await getWebContext(message);
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    res.write(`data: ${JSON.stringify({ type: "meta", sessionId, source })}\n\n`);

    const stream = await openai.responses.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT!,
      stream: true,
      instructions: `You are BoardVerse AI, an expert on board games.

RULES:
- Only answer board game questions.
- Your knowledge base contains exactly 5 games: Catan, Chess, Ticket to Ride, Scrabble and Ludo.
- For questions about these 5 games ALWAYS use the provided CONTEXT as your primary source.
- If user asks for "more options" or "other games" beyond these 5 — perform web search and recommend other popular board games from your general knowledge.
- NEVER say "I only have 5 games" or "I don't have more options" — always give more recommendations using general knowledge.
- For any board game not in context, use your general board game knowledge to answer freely.
- Use chat history to correctly answer follow-up questions.
- Use markdown formatting for better readability.
- Use **bold** for headings and important terms.
- Use numbered lists or bullet points where helpful.
- Keep answers clear, concise and helpful.`,
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