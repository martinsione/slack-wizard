import { env } from "cloudflare:workers";
import { createOpenAI } from "@ai-sdk/openai";
import { WebClient } from "@slack/web-api";
import { customProvider, embed, generateText } from "ai";
import { Hono } from "hono";

const slack = new WebClient(env.SLACK_BOT_TOKEN);

const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });

const aiProvider = customProvider({
  languageModels: {
    "chat-model-small": openai("gpt-4o-mini"),
  },
  textEmbeddingModels: {
    "embedding-model-small": openai.embedding("text-embedding-3-small", {
      dimensions: 1536,
    }),
  },
});

async function getMessagesWithReplies({
  channelId,
  limit = 10,
  cursor,
}: { slack: WebClient; channelId: string; limit?: number; cursor?: string }) {
  const messages = await slack.conversations.history({
    channel: channelId,
    limit,
    cursor,
  });
  const messagesWithReplies = await Promise.all(
    messages.messages?.map(async (message) => {
      if (!message.ts) return null;
      const replies = await slack.conversations.replies({
        channel: channelId,
        ts: message.ts,
        limit,
      });
      return { ...message, replies };
    }) || [],
  );

  return messagesWithReplies;
}

// biome-ignore lint/complexity/noBannedTypes: <explanation>
type HonoEnv = { Variables: {}; Bindings: CloudflareEnv };

const app = new Hono<HonoEnv>()
  .onError((err, c) => {
    console.error(err);
    return c.json({ error: err.message || "Internal server error" }, 500);
  })
  .get("/health", (c) => c.json({ ok: true }))
  .get("/channels", async (c) => {
    const res = await slack.conversations.list({ limit: 1000 });
    return c.json(res.channels?.map((c) => ({ id: c.id, name: c.name })));
  })
  .post("/ingest/:channelId", async (c) => {
    const channelId = c.req.param("channelId");

    const messages = await getMessagesWithReplies({
      slack,
      channelId,
      limit: 10,
      cursor: undefined,
    });

    const processedMessages = await Promise.all(
      messages.map(async (msg) => {
        try {
          if (!msg) return;
          // biome-ignore lint/style/noNonNullAssertion: <explanation>
          const id = msg.client_msg_id!;
          const content = `
          Question: ${msg.text} 
          Replies: ${msg.replies?.messages?.map((reply) => reply.text).join("\n")}
          `;

          const { embedding } = await embed({
            model: aiProvider.textEmbeddingModel("embedding-model-small"),
            value: content,
          });

          const vectors = await c.env.VECTORIZE.upsert([
            {
              id,
              namespace: channelId,
              values: embedding,
              metadata: { content },
            },
          ]);

          return { id, content, vectors };
        } catch (error) {
          console.error("Error processing message:", error);
        }
      }),
    );

    return c.json({
      processed: processedMessages.length,
      messages: processedMessages,
    });
  })
  .post("/ask", async (c) => {
    const { query } = await c.req.json();

    if (!query || typeof query !== "string") {
      return c.json({ error: "Query is required and must be a string" }, 400);
    }

    // Create embedding for the query
    const { embedding: queryEmbedding } = await embed({
      model: aiProvider.textEmbeddingModel("embedding-model-small"),
      value: query,
    });

    // Search for similar vectors
    const queryResult = await c.env.VECTORIZE.query(queryEmbedding, {
      returnMetadata: true,
      topK: 3,
    }).then((results) => {
      if (results.count === 0) return results;

      return {
        ...results,
        matches: results.matches.filter((match) => match.score > 0.5),
      };
    });

    if (!queryResult.matches.length) {
      return c.json({
        answer:
          "I couldn't find any relevant information to answer your question.",
      });
    }

    console.log(queryResult.matches);

    // Generate answer using AI SDK
    const prompt = `
You are a helpful assistant that answers questions based on the provided context.

Context:
${queryResult.matches
  .map((match) => match.metadata?.content || "")
  .join("\n\n")}

Question: ${query}

Answer the question based only on the provided context. If the context doesn't contain the information needed to answer the question, say "I don't have enough information to answer that question."
`;

    // Generate text using the AI SDK
    const completion = await generateText({
      model: aiProvider.languageModel("chat-model-small"),
      prompt,
      temperature: 0.3,
      maxTokens: 500,
    });

    return c.json({
      answer: completion.text,
      sources: queryResult.matches
        .filter((match) => match.score > 0.5)
        .map((match) => ({
          score: match.score,
          content: match.metadata?.content,
        })),
    });
  });

export default {
  fetch: (req, env, ctx) => {
    return app.fetch(req, env, ctx);
  },
  queue: (batch, env, ctx) => {
    console.log("batch", batch);
  },
} satisfies ExportedHandler<CloudflareEnv>;
