---
name: add-api-route
description: Create a Next.js API route for Intent IDE with input validation, LLM client usage, and streaming. Use when adding server endpoints.
---

# Add API Route

## Steps

1. Create the route file at `src/app/api/{name}/route.ts`.

2. Read API keys from request headers (never hardcode secrets):
   ```ts
   const apiKey = request.headers.get('x-api-key');
   if (!apiKey) {
     return Response.json({ error: 'Missing API key' }, { status: 401 });
   }
   ```

3. Validate input from the request body:
   ```ts
   const body = await request.json();
   // Validate required fields, return 400 on bad input
   ```

4. For LLM routes, use the client abstraction from `src/lib/ai/client.ts` rather than calling provider SDKs directly.

5. For streaming responses, use `ReadableStream` with `TextEncoder`:
   ```ts
   const stream = new ReadableStream({
     async start(controller) {
       const encoder = new TextEncoder();
       // Push chunks with controller.enqueue(encoder.encode(chunk))
       controller.close();
     },
   });
   return new Response(stream, {
     headers: { 'Content-Type': 'text/plain; charset=utf-8' },
   });
   ```

6. For non-streaming responses, return typed JSON:
   ```ts
   return Response.json({ result }, { status: 200 });
   ```

7. Handle errors with proper status codes (400 for bad input, 401 for auth, 500 for server errors).

## Rules

- Use `@/` path aliases for all imports.
- Export only the HTTP method handler as a named export (e.g., `export async function POST`).
- Never import or bundle API keys in client code.
- Always validate input before processing.
