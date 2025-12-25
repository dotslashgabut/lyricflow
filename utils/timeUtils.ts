
import { SubtitleSegment } from '../types';

// Helper to pad numbers with leading zeros
const pad = (num: number, size: number): string => {
  return num.toString().padStart(size, '0');
};

// Format: HH:MM:SS,mmm (SRT Standard)
// Example: 00:00:28,106
export const formatToSRTTime = (seconds: number): string => {
  if (isNaN(seconds)) return "00:00:00,000";
  
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
// Example: [00:28.19]
export const formatToLRCTime = (seconds: number): string => {
  if (isNaN(seconds)) return "[00:00.00]";

  // Round to nearest centisecond (1/100th of a second)
  const totalCentiseconds = Math.round(seconds * 100);
  
  const centis = totalCentiseconds % 100;
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const sec = totalSeconds % 60;
  const min = Math.floor(totalSeconds / 60);

  // Standard LRC usually keeps minutes to 2 digits, but expands if needed.
  const minStr = pad(min, 2);
  const secStr = pad(sec, 2);
  const centiStr = pad(centis, 2);

  return `[${minStr}:${secStr}.${centiStr}]`;
};

// Format: MM:SS.mmm (For UI Display)
// Example: 00:28.106
export const formatToDisplayTime = (seconds: number): string => {
  if (isNaN(seconds)) return "00:00.000";

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
  metadata?: { 
    title?: string; 
    artist?: string; 
    album?: string;
    by?: string;
  }
): string => {
  let lines: string[] = [];
  
  // Headers
  if (metadata?.title) lines.push(`[ti:${metadata.title}]`);
  if (metadata?.artist) lines.push(`[ar:${metadata.artist}]`);
  if (metadata?.album) lines.push(`[al:${metadata.album}]`);
  lines.push(`[by:${metadata?.by || 'LyricFlow AI'}]`);
  
  // Content
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    
    // Add the current line
    lines.push(`${formatToLRCTime(seg.start)}${seg.text}`);
    
    // Gap check: if gap to next segment is > 4 seconds, add a "clear" timestamp
    if (i < segments.length - 1) {
      const nextSeg = segments[i + 1];
      const gap = nextSeg.start - seg.end;
      
      if (gap > 4.0) {
        lines.push(`${formatToLRCTime(seg.end + 4.0)}`);
      }
    } else {
      // Per user request: for the very last line, add a clear timestamp 4 seconds after end
      lines.push(`${formatToLRCTime(seg.end + 4.0)}`);
    }
  }
  
  return lines.join('\n');
};

export const formatDuration = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};
