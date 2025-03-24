# Slack Agent

A Cloudflare Worker that ingests messages from Slack, stores them in D1, and vectorizes them for semantic search and RAG (Retrieval Augmented Generation).

## Features

- Fetches messages from a Slack channel
- Retrieves and processes thread replies
- Stores messages and threads in D1 database
- Creates vector embeddings using OpenAI's text-embedding-ada-002 model via AI SDK
- Provides semantic search functionality
- Implements RAG for answering questions based on Slack message content

## API Endpoints

- `GET /health` - Health check endpoint
- `GET /ingest` - Ingests messages from the configured Slack channel
  - Query parameters:
    - `limit` - Number of messages to fetch (default: 10)
    - `cursor` - Pagination cursor for fetching more messages
- `GET /channels` - Lists all available Slack channels
- `POST /ask` - RAG endpoint for asking questions about Slack messages
  - Request body:
    ```json
    {
      "query": "Your question here"
    }
    ```
  - Response:
    ```json
    {
      "answer": "The answer to your question",
      "sources": [
        {
          "score": 0.95,
          "title": "Original message title"
        }
      ]
    }
    ```

## Setup

1. Create a D1 database:
   ```
   wrangler d1 create slack-agent-db
   ```

2. Update the `wrangler.jsonc` file with your D1 database ID.

3. Create a Vectorize index:
   ```
   wrangler vectorize create slack-messages --dimensions=1536 --metric=cosine
   ```

4. Set your OpenAI API key in the `wrangler.jsonc` file:
   ```json
   "vars": {
     "OPENAI_API_KEY": "your-api-key-here"
   }
   ```

5. Update the Slack token and channel ID in `src/index.ts`.

6. Deploy the worker:
   ```
   npm run deploy
   ```

## Development

1. Install dependencies:
   ```
   npm install
   ```

2. Run locally:
   ```
   npm run dev
   ```

## Database Schema

The project uses the following database schema:

- `messages` - Stores individual Slack messages
- `threads` - Stores thread information and replies
- `message_embeddings` - Maps messages to their vector embeddings in Cloudflare Vectorize

## Implementation Details

- Messages are fetched from Slack using the Slack Web API
- Thread replies are fetched and stored along with their parent messages
- Vector embeddings are created using OpenAI's text-embedding-ada-002 model via the AI SDK
- The D1 database is used for persistent storage
- Cloudflare Vectorize is used for vector storage and similarity search
- RAG implementation uses OpenAI's GPT-3.5 Turbo model via the AI SDK to generate answers based on retrieved context

## How RAG Works

1. When a question is asked via the `/ask` endpoint:
   - The question is converted to a vector embedding using OpenAI's text-embedding-ada-002 model via the AI SDK
   - The embedding is used to search for similar messages in Vectorize
   - The top 5 most relevant messages are retrieved
   - The content of these messages is used as context for the LLM
   - GPT-3.5 Turbo generates an answer based on the provided context via the AI SDK
   - The answer and source information are returned to the user
