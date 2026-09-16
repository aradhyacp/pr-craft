import { google } from "@ai-sdk/google";
import { defineAgent } from "eve";

/**
 * Gemini through the AI SDK's direct provider, not the Vercel AI Gateway, so
 * pr-craft needs only GOOGLE_GENERATIVE_AI_API_KEY to run locally.
 *
 * PRCRAFT_MODEL lets the CLI's --model flag select a different Gemini version
 * without editing source.
 */
export default defineAgent({
  model: google(process.env.PRCRAFT_MODEL ?? "gemini-3.5-flash-lite"),
  // eve otherwise looks the context window up in the AI Gateway catalog, which
  // a direct-provider model is not listed in. Set it so the lookup is skipped.
  modelContextWindowTokens: Number(process.env.PRCRAFT_CONTEXT_TOKENS ?? 1_048_576),
  // The agent only reads a local repository; the sandbox tools it would
  // otherwise get operate on the wrong filesystem and would only mislead it.
  defaultTools: false,
});
