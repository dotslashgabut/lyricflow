
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
  // leveraging its reasoning capabilities for tighter timestamp alignment
  if (modelName === 'gemini-3-flash-preview') {
    prompt = `
      Act as a Lead Audio Timing Engineer using the Gemini 3 engine.
      Your primary objective is **Sub-Second Precision** alignment of text to audio.

      CRITICAL TIMING INSTRUCTIONS:
      1. **NO ROUNDING**: Do NOT round timestamps to the nearest 100ms or 500ms. I require raw millisecond precision (e.g., "00:12.483", NOT "00:12.500").
      2. **AUDIO ENVELOPE ANALYSIS**:
         - **Start Time**: Detect the exact millisecond of the 'Attack' phase (when the first phoneme breaks silence).
         - **End Time**: Detect the exact millisecond of the 'Release' phase (when the voice fully decays to the noise floor).
      3. **RAPID SPEECH**: If lyrics/speech are fast, break them into smaller segments for better synchronization.
      4. **GAPS**: Strictly respect silence. If there is a pause > 300ms, close the current segment and start a new one.

      OUTPUT FORMAT:
      Return a pure JSON array (no markdown) where 'start' and 'end' are strings in "MM:SS.mmm" format.
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
        // Higher thinking budget for Gemini 3 to allow for "Timing Analysis"
        thinkingConfig: modelName === 'gemini-3-flash-preview' ? { thinkingBudget: 8192 } : undefined,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              start: { type: Type.STRING, description: "Start time 'MM:SS.mmm'" },
              end: { type: Type.STRING, description: "End time 'MM:SS.mmm'" },
              text: { type: Type.STRING }
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

    const parseTimestamp = (ts: string): number => {
      if (!ts || typeof ts !== 'string') return 0;
      const parts = ts.split(':');
      if (parts.length === 2) {
        return (parseFloat(parts[0]) * 60) + parseFloat(parts[1]);
      }
      if (parts.length === 3) {
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
