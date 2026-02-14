
import { GoogleGenAI, Type } from "@google/genai";
import { SubtitleSegment, GeminiModel, TranscriptionMode } from "../types";

// Dynamic schema generation to reduce token load and complexity for the model
const getTranscriptionSchema = (mode: TranscriptionMode) => {
  const segmentProperties: any = {
    id: {
      type: Type.INTEGER,
      description: "Sequential ID (1, 2, 3...).",
    },
    startTime: {
      type: Type.STRING,
      description: "Start Timestamp (HH:MM:SS.mmm).",
    },
    endTime: {
      type: Type.STRING,
      description: "End Timestamp (HH:MM:SS.mmm).",
    },
    text: {
      type: Type.STRING,
      description: "Verbatim text.",
    }
  };

  const requiredProps = ["id", "startTime", "endTime", "text"];

  if (mode === 'word') {
    segmentProperties.words = {
      type: Type.ARRAY,
      description: "Word-level timing.",
      items: {
        type: Type.OBJECT,
        properties: {
          startTime: { type: Type.STRING },
          endTime: { type: Type.STRING },
          text: { type: Type.STRING }
        },
        required: ["startTime", "endTime", "text"]
      }
    };
    requiredProps.push("words");
  }

  return {
    type: Type.OBJECT,
    properties: {
      segments: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: segmentProperties,
          required: requiredProps,
        },
      },
    },
    required: ["segments"],
  };
};

function normalizeTimestamp(ts: string): string {
  if (!ts) return "00:00:00.000";
  
  // FIX: Replace comma with dot (SRT format compatibility) to prevent parsing errors
  let clean = ts.trim().replace(/,/g, '.');
  
  // Clean up non-numeric characters except colon and dot
  clean = clean.replace(/[^\d:.]/g, '');
  
  // Handle raw seconds (e.g. "12.5")
  if (!clean.includes(':') && /^[\d.]+$/.test(clean)) {
    const totalSeconds = parseFloat(clean);
    if (!isNaN(totalSeconds)) {
       const h = Math.floor(totalSeconds / 3600);
       const m = Math.floor((totalSeconds % 3600) / 60);
       const s = Math.floor(totalSeconds % 60);
       const ms = Math.round((totalSeconds % 1) * 1000);
       return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
    }
  }

  const parts = clean.split(':');
  let h = 0, m = 0, s = 0, ms = 0;

  if (parts.length === 3) {
    h = parseInt(parts[0], 10) || 0;
    m = parseInt(parts[1], 10) || 0;
    const secParts = parts[2].split('.');
    s = parseInt(secParts[0], 10) || 0;
    if (secParts[1]) {
      const msStr = secParts[1].substring(0, 3).padEnd(3, '0');
      ms = parseInt(msStr, 10);
    }
  } else if (parts.length === 2) {
    m = parseInt(parts[0], 10) || 0;
    const secParts = parts[1].split('.');
    s = parseInt(secParts[0], 10) || 0;
    if (secParts[1]) {
      const msStr = secParts[1].substring(0, 3).padEnd(3, '0');
      ms = parseInt(msStr, 10);
    }
  } else if (parts.length === 1) {
    const secParts = parts[0].split('.');
    s = parseInt(secParts[0], 10) || 0;
    if (secParts[1]) {
      const msStr = secParts[1].substring(0, 3).padEnd(3, '0');
      ms = parseInt(msStr, 10);
    }
  }

  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function tryRepairJson(jsonString: string): any {
  // 1. Basic cleanup: remove markdown and whitespace
  let clean = jsonString.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();

  // Handle potentially empty input
  if (!clean) return { segments: [] };

  // 2. Fix Common JSON issues
  // Remove trailing commas in objects/arrays (e.g., ", }" -> "}")
  clean = clean.replace(/,\s*([\]}])/g, '$1');

  // 3. Optimistic Parse
  try {
    const parsed = JSON.parse(clean);
    // Normalize format
    if (parsed.segments && Array.isArray(parsed.segments)) return parsed;
    if (Array.isArray(parsed)) return { segments: parsed };
    // If it's a single object that looks like a segment (rare), wrap it
    if (parsed.startTime && parsed.text) return { segments: [parsed] };
    if (parsed.segments) return parsed;
  } catch (e) {
    // Continue to repair
  }

  // 4. Truncation Repair
  // The response is likely truncated. We need to find the last valid segment closing brace '}'
  // We search backwards from the end of the string.
  
  const searchLimit = Math.max(0, clean.length - 2000);

  for (let i = clean.length - 1; i >= searchLimit; i--) {
    if (clean[i] === '}') {
      const candidate = clean.substring(0, i + 1);
      
      // Strategy A: Assume it was { "segments": [ ... ] } and needs ']}'
      try {
        const patched = candidate + ']}';
        const parsed = JSON.parse(patched);
        if (parsed.segments && Array.isArray(parsed.segments)) {
            console.warn("Repaired truncated JSON by closing array and root object.");
            return parsed;
        }
      } catch (e) {}

      // Strategy B: Assume it was [ ... ] and needs ']'
      try {
        const patched = candidate + ']';
        const parsed = JSON.parse(patched);
        if (Array.isArray(parsed)) {
             console.warn("Repaired truncated JSON by closing array.");
             return { segments: parsed };
        }
      } catch (e) {}

      // Strategy C: Maybe it was just { ... } and we found the end
      try {
        const patched = candidate + '}';
        const parsed = JSON.parse(patched);
        if (parsed.segments) return parsed;
      } catch (e) {}
    }
  }

  // 5. Desperate Stream-based Regex Fallback
  // If JSON structure is irretrievably broken, try to scrape key-value pairs.
  // This approach is robust against broken structural braces or commas.
  try {
    const segments: any[] = [];
    const keyValRegex = /"(\w+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let match;
    let currentSegment: any = {};

    while ((match = keyValRegex.exec(clean)) !== null) {
        const key = match[1];
        const val = match[2];
        
        if (key === 'startTime' || key === 'endTime' || key === 'text') {
            currentSegment[key] = val;
        }

        // Check if we have a "complete" segment (assuming keys are somewhat grouped)
        if (currentSegment.startTime && currentSegment.endTime && currentSegment.text) {
             segments.push({ ...currentSegment });
             // Soft reset, keep fields if next segment overrides them (rare) or full reset
             currentSegment = {}; 
        }
    }
    
    if (segments.length > 0) {
      console.warn("Recovered " + segments.length + " segments using Stream Regex fallback.");
      return { segments };
    }
  } catch (e) {
    console.error("Stream Regex fallback failed", e);
  }

  throw new Error("Transcription response malformed. The conversation might be too complex or long.");
}

function timestampToSeconds(ts: string): number {
  if (!ts) return 0;
  const parts = ts.split(':');
  if (parts.length === 3) {
      const h = parseFloat(parts[0]);
      const m = parseFloat(parts[1]);
      const s = parseFloat(parts[2]);
      return (h * 3600) + (m * 60) + s;
  }
  return 0;
}

export const transcribeAudio = async (
  base64Audio: string,
  mimeType: string,
  modelName: GeminiModel,
  mode: TranscriptionMode = 'line'
): Promise<SubtitleSegment[]> => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing. Please check your environment configuration.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const useThinking = modelName.includes('gemini-3'); 

  const timingPolicy = `
    TIMING PRECISION RULES:
    1. FORMAT: **HH:MM:SS.mmm** (e.g., 00:00:12.450). Use DOT (.) for milliseconds.
    2. CONTINUITY: Timestamps must NOT jump. The endTime of Segment N should be close to startTime of Segment N+1.
    3. NO HALLUCINATION: Do not invent time gaps. If the audio is continuous, the timestamps must be continuous.
  `;

  let modeInstructions = "";
  if (mode === 'word') {
    modeInstructions = `
    MODE: KARAOKE / WORD-LEVEL
    - Output a "words" array for every segment.
    - Capture every single repeated word as a distinct object with unique timestamps.
    - Do not group repetitions.
    `;
  } else {
    modeInstructions = `
    MODE: SUBTITLE / LINE-LEVEL
    - Create a new segment for each line/phrase.
    - If a line is repeated, CREATE A NEW SEGMENT.
    - DO NOT MERGE REPEATS. 
    - DO NOT USE "x2" or notations. WRITE IT OUT FULLY.
    `;
  }

  const oneShotExample = `
    EXAMPLE OF CONTINUITY HANDLING:
    Audio: "Yeah" (0s) -> "Yeah" (1s) -> [Short Pause] -> "Party start" (3s)

    CORRECT JSON OUTPUT:
    {
      "segments": [
        { "id": 1, "startTime": "00:00:00.000", "endTime": "00:00:01.000", "text": "Yeah" },
        { "id": 2, "startTime": "00:00:01.000", "endTime": "00:00:02.000", "text": "Yeah" },
        { "id": 3, "startTime": "00:00:03.000", "endTime": "00:00:04.500", "text": "Party start" }
      ]
    }
  `;

  const persona = "ROLE: RAW FORENSIC AUDIO TRANSCRIBER. VERBATIM MODE.";

  const systemInstructions = `
    ${persona}
    
    OBJECTIVE: 
    Convert the ENTIRE audio file to a JSON log of the spoken/sung content.
    The goal is RAW ACCURACY. Do not edit, summarize, or "clean up" the text.
    
    ${timingPolicy}
    
    ${modeInstructions}

    MANDATORY RULES FOR COMPLETENESS & REPETITION:
    1. **PROCESS FULL DURATION**: You MUST transcribe from the start (00:00:00) to the very end of the audio file.
    2. **DO NOT STOP EARLY**: Even if the audio starts with many repeated words (e.g., "Intro intro intro"), you must transcribe ALL of them and then CONTINUE to transcribe the rest of the song/speech.
    3. **ABSOLUTE VERBATIM**: 
       - If the singer says "No no no no no", you MUST write "No no no no no". 
       - Do not write "No (x5)" or "No...".
       - CAPTURE EVERY SINGLE REPETITION as individual text or segments.
    4. **NO HALLUCINATIONS**: Do not generate text if there is silence or pure instrumental.

    CRITICAL: 
    Do not assume the audio is finished just because a section is repetitive. Listen until the stream ends.

    ${oneShotExample}

    OUTPUT:
    Return ONLY valid JSON.
  `;

  const requestConfig: any = {
    responseMimeType: "application/json",
    responseSchema: getTranscriptionSchema(mode),
    temperature: 0.0, // Strict determinism
    maxOutputTokens: 8192,
  };

  if (useThinking) {
    // Gemini 3 uses thinking to plan complex layouts
    requestConfig.thinkingConfig = { thinkingBudget: 2048 }; 
  } else {
    // Gemini 2.5 Flash: Disable thinking
    delete requestConfig.thinkingConfig;
  }

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: [
        {
          parts: [
            {
              inlineData: {
                data: base64Audio,
                mimeType: mimeType,
              },
            },
            {
              text: systemInstructions,
            },
          ],
        },
      ],
      config: requestConfig,
    });

    const text = response.text || "";
    const rawData = tryRepairJson(text);

    if (!rawData.segments || !Array.isArray(rawData.segments)) {
      throw new Error("Invalid transcription format received.");
    }

    return rawData.segments.map((seg: any) => {
        const startStr = normalizeTimestamp(seg.startTime);
        const endStr = normalizeTimestamp(seg.endTime);
        
        const segment: SubtitleSegment = {
            start: timestampToSeconds(startStr),
            end: timestampToSeconds(endStr),
            text: seg.text,
            words: []
        };

        if (seg.words && Array.isArray(seg.words)) {
           segment.words = seg.words.map((w: any) => ({
             start: timestampToSeconds(normalizeTimestamp(w.startTime)),
             end: timestampToSeconds(normalizeTimestamp(w.endTime)),
             text: w.text
           })).sort((a: any, b: any) => a.start - b.start);
        }

        return segment;
    }).sort((a: SubtitleSegment, b: SubtitleSegment) => a.start - b.start);

  } catch (error) {
    console.error("Transcription API Failure:", error);
    throw error;
  }
};

export const fileToBase64 = (file: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
  });
};
