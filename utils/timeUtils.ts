
import { SubtitleSegment } from '../types';

// Helper to pad numbers with leading zeros
const pad = (num: number, size: number): string => {
  return num.toString().padStart(size, '0');
};

// Format: HH:MM:SS,mmm (SRT Standard)
export const formatToSRTTime = (seconds: number): string => {
  if (isNaN(seconds) || seconds < 0) return "00:00:00,000";
  
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const sec = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const min = totalMinutes % 60;
  const hour = Math.floor(totalMinutes / 60);

  return `${pad(hour, 2)}:${pad(min, 2)}:${pad(sec, 2)},${pad(ms, 3)}`;
};

// Format: [MM:SS.xx] (LRC Standard - centiseconds)
export const formatToLRCTime = (seconds: number): string => {
  if (isNaN(seconds) || seconds < 0) return "[00:00.00]";

  const totalCentiseconds = Math.round(seconds * 100);
  const centis = totalCentiseconds % 100;
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const sec = totalSeconds % 60;
  const min = Math.floor(totalSeconds / 60);

  return `[${pad(min, 2)}:${pad(sec, 2)}.${pad(centis, 2)}]`;
};

// Format: MM:SS.mmm (For UI Display)
export const formatToDisplayTime = (seconds: number): string => {
  if (isNaN(seconds) || seconds < 0) return "00:00.000";

  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const sec = totalSeconds % 60;
  const min = Math.floor(totalSeconds / 60);

  return `${pad(min, 2)}:${pad(sec, 2)}.${pad(ms, 3)}`;
};

export const generateSRT = (segments: SubtitleSegment[]): string => {
  return segments.map((seg, index) => {
    return `${index + 1}\n${formatToSRTTime(seg.start)} --> ${formatToSRTTime(seg.end)}\n${seg.text}\n`;
  }).join('\n');
};

export const generateLRC = (
  segments: SubtitleSegment[], 
  metadata: { 
    title?: string; 
    artist?: string; 
    album?: string;
    by?: string;
  },
  audioDuration: number = 0
): string => {
  let lines: string[] = [];
  
  if (metadata.title) lines.push(`[ti:${metadata.title}]`);
  if (metadata.artist) lines.push(`[ar:${metadata.artist}]`);
  if (metadata.album) lines.push(`[al:${metadata.album}]`);
  lines.push(`[by:${metadata.by || 'LyricFlow AI'}]`);
  
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    lines.push(`${formatToLRCTime(seg.start)}${seg.text}`);
    
    // Logic for blank timestamp between segments (gap > 4s)
    if (i < segments.length - 1) {
      const nextSeg = segments[i + 1];
      const gap = nextSeg.start - seg.end;
      if (gap > 4.0) {
        lines.push(`${formatToLRCTime(seg.end + 1.0)}`); // Clear text 1s after segment ends
      }
    } else {
      // LAST LINE SPECIAL LOGIC:
      // Add a blank timestamp 4 seconds after the last line ends, 
      // ONLY if it fits within the audio duration.
      const targetBlankTime = seg.end + 4.0;
      if (audioDuration > 0 && targetBlankTime <= audioDuration) {
        lines.push(`${formatToLRCTime(targetBlankTime)}`);
      }
    }
  }
  
  return lines.join('\n');
};

export const formatDuration = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};
