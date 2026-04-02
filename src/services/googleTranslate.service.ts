import axios from "axios";
import ApiError from "../utils/ApiError";
import { config } from "../config/config";

type TranslateTextInput = {
  texts: string[];
  targetLanguage: string;
  sourceLanguage?: string;
};

const GOOGLE_TRANSLATE_URL =
  "https://translation.googleapis.com/language/translate/v2";

const normalizeLanguage = (value?: string) =>
  String(value || "").trim().toLowerCase() || "en";

export const translateTexts = async ({
  texts,
  targetLanguage,
  sourceLanguage,
}: TranslateTextInput) => {
  const cleanedTexts = Array.from(
    new Set(
      (texts || [])
        .map((text) => String(text || "").trim())
        .filter(Boolean),
    ),
  );

  if (cleanedTexts.length === 0) {
    return {
      provider: "none",
      targetLanguage: normalizeLanguage(targetLanguage),
      sourceLanguage: normalizeLanguage(sourceLanguage),
      translations: [] as Array<{ original: string; translated: string }>,
    };
  }

  const target = normalizeLanguage(targetLanguage);
  const source = normalizeLanguage(sourceLanguage);

  const apiKey = config.integrations.googleTranslate.apiKey;
  if (!apiKey) {
    return {
      provider: "fallback",
      targetLanguage: target,
      sourceLanguage: source,
      translations: cleanedTexts.map((text) => ({
        original: text,
        translated: text,
      })),
    };
  }

  try {
    const response = await axios.post(
      `${GOOGLE_TRANSLATE_URL}?key=${apiKey}`,
      {
        q: cleanedTexts,
        target,
        source: source !== "auto" ? source : undefined,
        format: "text",
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: config.surepass.timeoutMs || 10000,
      },
    );

    const translations = response.data?.data?.translations || [];
    const translatedMap = cleanedTexts.map((text, index) => ({
      original: text,
      translated:
        translations[index]?.translatedText ||
        translations[index]?.text ||
        text,
    }));

    return {
      provider: "google",
      targetLanguage: target,
      sourceLanguage: source,
      translations: translatedMap,
    };
  } catch (error: any) {
    throw new ApiError(
      error?.response?.status || 500,
      error?.response?.data?.error?.message ||
        error?.response?.data?.message ||
        error?.message ||
        "Failed to translate text",
      error?.response?.data,
    );
  }
};
