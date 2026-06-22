import { SearchClient, AzureKeyCredential } from "@azure/search-documents";

const client = new SearchClient(
  process.env.AZURE_SEARCH_ENDPOINT!,
  process.env.AZURE_SEARCH_INDEX!,
  new AzureKeyCredential(process.env.AZURE_SEARCH_API_KEY!)
);

export const getGameContext = async (question: string) => {
  const results = await client.search(question, {
    top: 5,
    includeTotalCount: true,
  });

  let context = "";
  let highQualityResults = 0;

  for await (const result of results.results) {
    const score = result.score ?? 0;

    if (score < 0.5) continue;

    highQualityResults++;
    const doc: any = result.document;

    context += `
Name: ${doc.Name}

Description:
${doc.Description}

Rules:
${doc.Rules}

Strategy:
${doc.Strategy}

History:
${doc.History}

Keywords:
${doc.Keywords}

-------------------
`;
  }

  return context.trim();
};