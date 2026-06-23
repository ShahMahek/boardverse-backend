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
"do you have more?", "any other options?", "what else?", "tell me more about it",
"by whom", "who made it", "who created it", "when", "how long ago",
"price", "cost", "how much", "where to buy", "in rupees", "in usd"
— these ARE board game related if the recent history is about board games.

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
      context = conversationHistory;
    } else {
      source = "WEB";
      const lastGame = conversationHistory.match(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)*)\b/)?.[0] || "";
      const enrichedQuery = lastGame ? `${message} ${lastGame} board game` : message;
      const webResult = await getWebContext(enrichedQuery);
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
    instructions: `You are BoardVerse AI, a board game expert assistant.

YOUR KNOWLEDGE BASE contains exactly 5 games: Catan, Chess, Ticket to Ride, Scrabble, and Ludo.

RESPONSE RULES:

1. KNOWLEDGE BASE GAMES (Catan, Chess, Ticket to Ride, Scrabble, Ludo):
   - ALWAYS use the provided CONTEXT as your sole source for these games.
   - Do NOT add information beyond what is in the CONTEXT for these games.

2. OTHER BOARD GAMES (not in Knowledge Base):
   - Use the provided CONTEXT (web search results) to answer.
   - Stick strictly to what the CONTEXT says — do not invent or add extra games.

3. BROAD / GENERAL QUESTIONS (e.g. "what kinds of board games exist", "recommend me a game"):
   - First answer using the 5 games from the CONTEXT if relevant.
   - If the user asks for more beyond those 5, use the web search CONTEXT provided.
   - Never invent games or information not present in the CONTEXT.

4. FOLLOW-UP QUESTIONS:
   - Use chat history to understand what the user is referring to.
   - Stay consistent with previous answers in the conversation.

5. FORMATTING:
   - Use **bold** for game names and key terms.
   - Use numbered lists or bullet points where helpful.
   - Keep answers clear, concise, and helpful.`,
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