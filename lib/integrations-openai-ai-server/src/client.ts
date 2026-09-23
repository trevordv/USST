import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY?.trim();

if (!apiKey) {
  throw new Error(
    "OPENAI_API_KEY must be set for OpenAI-powered project parsing and extraction.",
  );
}

// Do not provide baseURL here. The official SDK defaults to the standard
// OpenAI API endpoint, which is the deployment contract used by Railway.
export const openai = new OpenAI({ apiKey });
