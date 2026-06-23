import { tavily } from "@tavily/core";

const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY! });

export interface WebResult {
  context: string;
  urls: string[];
}

export const getWebContext = async (question: string): Promise<WebResult> => {
  try {
    const response = await tvly.search(question, {
      maxResults: 3,
      searchDepth: "advanced",
    });

    if (!response.results?.length) return { context: "", urls: [] };

    const urls = response.results.map((r) => r.url);

    const context = response.results
      .map((result, index) => `
Result ${index + 1}
Title: ${result.title}
Content: ${result.content}
URL: ${result.url}
`)
      .join("\n----------------------\n");

    return { context, urls };
  } catch (error) {
    console.error("Tavily Error:", error);
    return { context: "", urls: [] };
  }
};