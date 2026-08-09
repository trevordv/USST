import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error(
    "OPENAI_API_KEY must be set for OpenAI-powered project parsing and extraction.",
  );
}

export const openai = new OpenAI({ apiKey });
