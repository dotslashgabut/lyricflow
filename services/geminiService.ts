
import { GoogleGenAI, Type } from "@google/genai";
import { SubtitleSegment, GeminiModel } from "../types";

export const transcribeAudio = async (
  base64Audio: string,
  mimeType: string,
  modelName: GeminiModel
): Promise<SubtitleSegment[]> => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing. Please check your environment configuration.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  // Base prompt for standard models (Gemini 2.5)
  let prompt = `
    Act as a professional audio transcriber and lyric synchronizer. 
    Analyze the provided audio and generate highly accurate subtitles/lyrics.

    TIMESTAMP PRECISION RULES:
    1. **FORMAT**: Timestamps MUST be strings in "MM:SS.mmm" format (e.g., "00:04.250").
    2. **SYNC**: The "start" timestamp must align exactly with the very first audible syllable or sound of the phrase.
    3. **DURATION**: The "end" timestamp must mark exactly when the phrase or vocal line concludes.
    4. **CONSISTENCY**: Timestamps must be absolute and strictly chronological.

    BEHAVIOR:
    - If it's a song, capture lyrics.
    - If it's speech, capture the spoken words.
    - Ensure no overlapping segments.
    
    OUTPUT: Return a JSON array of objects with keys: "start", "end", "text".
  `;

  // Specialized High-Precision Prompt for Gemini 3 Flash
  // Optimized for songs: handles repetitions, instrumental gaps, and enforces verbatim transcription.
  if (modelName === 'gemini-3-flash-preview') {
    prompt = `
      You are an AI specialized in **Verbatim Audio Transcription**. 
      Your task is to transcribe the audio file exactly as heard with **millisecond-accurate** timestamps.

      ### CRITICAL INSTRUCTION: AUDIO ONLY
      - **DO NOT** use internal knowledge of song lyrics. Transcribe ONLY what you hear.
      - **IF** the audio differs from "official" lyrics, the AUDIO wins.
      - **REPETITION**: If a line is repeated (e.g., "Yeah / Yeah / Yeah"), output it as separate segments. Do NOT merge.
      - **INSTRUMENTALS**: Do not hallucinate text during instrumental breaks. If there is music but no vocals, output nothing for that duration, but ensure the NEXT vocal segment starts at the correct timestamp.

      ### TIMING RULES
      - **Start Time**: When the sound actually starts.
      - **End Time**: When the sound actually ends.
      - **Format**: "MM:SS.mmm"

      ### OUTPUT
      - JSON Array of { "start": "MM:SS.mmm", "end": "MM:SS.mmm", "text": "string" }
    `;
  }

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Audio
            }
          },
          { text: prompt }
        ]
      },
      config: {
        // User requested to disable thinking budget to prevent hallucinations
        thinkingConfig: modelName === 'gemini-3-flash-preview' ? { thinkingBudget: 0 } : undefined,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              start: { type: Type.STRING, description: "Start time 'MM:SS.mmm'" },
              end: { type: Type.STRING, description: "End time 'MM:SS.mmm'" },
              text: { type: Type.STRING, description: "Verbatim text content" }
            },
            required: ["start", "end", "text"]
          }
        }
      }
    });

    let jsonText = response.text || "";
    jsonText = jsonText.replace(/```json|```/g, "").trim();

    if (!jsonText) throw new Error("Empty response from AI.");

    const rawSegments = JSON.parse(jsonText) as any[];

    // Robust timestamp parsing handling both strings and potential numbers
    const parseTimestamp = (ts: string | number): number => {
      if (typeof ts === 'number') return ts;
      if (!ts || typeof ts !== 'string') return 0;
      
      // Clean up any stray characters
      ts = ts.trim();
      
      const parts = ts.split(':');
      if (parts.length === 2) {
        // MM:SS.mmm
        return (parseFloat(parts[0]) * 60) + parseFloat(parts[1]);
      }
      if (parts.length === 3) {
        // HH:MM:SS.mmm
        return (parseFloat(parts[0]) * 3600) + (parseFloat(parts[1]) * 60) + parseFloat(parts[2]);
      }
      return parseFloat(ts) || 0;
    };

    return rawSegments.map(seg => ({
      start: parseTimestamp(seg.start),
      end: parseTimestamp(seg.end),
      text: seg.text || ""
    }));

  } catch (error) {
    console.error("Transcription error:", error);
    throw error;
  }
};

export const fileToBase64 = (file: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
  });
};
