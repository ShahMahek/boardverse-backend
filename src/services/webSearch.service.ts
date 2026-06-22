import { tavily } from "@tavily/core";

const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY! });

export const getWebContext = async (question: string): Promise<string> => {
  try {
    const response = await tvly.search(question, {
      maxResults: 3,
      searchDepth: "advanced",
    });

    if (!response.results?.length) return "";

    return response.results
      .map(
        (result, index) => `
Result ${index + 1}

Title:
${result.title}

Content:
${result.content}

URL:
${result.url}
`
      )
      .join("\n----------------------\n");
  } catch (error) {
    console.error("Tavily Error:", error);
    return "";
  }
};