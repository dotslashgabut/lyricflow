
import React, { useState, useEffect, useRef } from 'react';
import { SubtitleSegment, AspectRatio } from '../types';
import { generateLRC, generateSRT, formatToDisplayTime } from '../utils/timeUtils';
import { 
  FileText, 
  Music, 
  Video, 
  Settings, 
  ChevronDown, 
  ChevronUp, 
  Loader2, 
  ArrowLeft,
  Layout,
  Type as TypeIcon,
  Monitor,
  Smartphone,
  Sparkles,
  Layers,
  Activity,
  XCircle
} from 'lucide-react';

interface ResultsViewProps {
  segments: SubtitleSegment[];
  onReset: () => void;
  audioName: string;
  audioFile: Blob | null;
}

type Resolution = '720p' | '1080p';

const ResultsView: React.FC<ResultsViewProps> = ({ segments, onReset, audioName, audioFile }) => {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [resolution, setResolution] = useState<Resolution>('1080p');
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  
  const [metadata, setMetadata] = useState({
    title: '',
    artist: '',
    album: ''
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  
  const audioRef = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Refs for aborting export
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const nameWithoutExt = audioName.replace(/\.[^/.]+$/, "");
    setMetadata(prev => ({ ...prev, title: nameWithoutExt }));
  }, [audioName]);

  useEffect(() => {
    if (audioFile) {
      const url = URL.createObjectURL(audioFile);
      setAudioUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [audioFile]);

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleSeek = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      audioRef.current.play();
    }
  };

  useEffect(() => {
    const index = segments.findIndex(s => currentTime >= s.start && currentTime <= s.end);
    if (index !== activeIndex) {
      setActiveIndex(index);
    }
  }, [currentTime, segments, activeIndex]);

  const downloadTextFile = (content: string, extension: string) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const baseName = metadata.title.trim() || audioName.replace(/\.[^/.]+$/, "");
    const safeName = baseName.replace(/[^a-z0-9_\-\s]/gi, '').trim() || 'lyrics';
    a.download = `${safeName}.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const abortExport = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    setIsExporting(false);
    setExportProgress(0);
  };

  const exportVideo = async () => {
    if (!canvasRef.current || !audioRef.current) return;
    
    setIsExporting(true);
    setExportProgress(0);
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    const audio = audioRef.current;
    
    const isHD = resolution === '1080p';
    let baseW = isHD ? 1920 : 1280;
    let baseH = isHD ? 1080 : 720;
    
    let width = baseW;
    let height = baseH;

    if (aspectRatio === '9:16') {
      width = baseH;
      height = baseW;
    } else if (aspectRatio === '3:4') {
      width = isHD ? 1080 : 720;
      height = isHD ? 1440 : 960;
    }
    
    canvas.width = width;
    canvas.height = height;

    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioContextRef.current = audioContext;
    const source = audioContext.createMediaElementSource(audio);
    
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const dest = audioContext.createMediaStreamDestination();
    
    source.connect(analyser);
    analyser.connect(dest);
    analyser.connect(audioContext.destination);

    const canvasStream = canvas.captureStream(30);
    const combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...dest.stream.getAudioTracks()
    ]);

    const mediaRecorder = new MediaRecorder(combinedStream, {
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: isHD ? 16000000 : 8000000
    });
    mediaRecorderRef.current = mediaRecorder;

    const chunks: Blob[] = [];
    mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
    mediaRecorder.onstop = () => {
      // Only download if we didn't just cancel manually
      if (isExporting && chunks.length > 0) {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${metadata.title || 'lyricflow_pro'}.webm`;
        a.click();
      }
      setIsExporting(false);
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };

    mediaRecorder.start();
    audio.currentTime = 0;
    audio.play();

    const drawFrame = () => {
      if (audio.paused || audio.ended) {
        if (mediaRecorder.state === 'recording') mediaRecorder.stop();
        return;
      }

      // 1. CLEAR & BACKGROUND
      const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
      bgGrad.addColorStop(0, '#020617'); 
      bgGrad.addColorStop(1, '#1e1b4b');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // 2. REAL SYNCED VISUALIZER
      analyser.getByteFrequencyData(dataArray);
      
      const barCount = 64;
      const barWidth = (width / barCount);
      const visualizerHeight = height * 0.35;
      
      ctx.save();
      for (let i = 0; i < barCount; i++) {
        const segmentSize = Math.floor(bufferLength / barCount);
        let sum = 0;
        for (let j = 0; j < segmentSize; j++) {
          sum += dataArray[i * segmentSize + j];
        }
        const val = sum / segmentSize;
        const percent = val / 255;
        const barH = percent * visualizerHeight;
        
        const x = i * barWidth;
        const y = height - barH;

        const barGrad = ctx.createLinearGradient(0, height - visualizerHeight, 0, height);
        barGrad.addColorStop(1, 'rgba(79, 70, 229, 0.4)');
        barGrad.addColorStop(0.5, 'rgba(129, 140, 248, 0.2)');
        barGrad.addColorStop(0, 'rgba(129, 140, 248, 0)');

        ctx.fillStyle = barGrad;
        ctx.beginPath();
        ctx.roundRect(x + 1, y, barWidth - 2, barH, [4, 4, 0, 0]);
        ctx.fill();
      }
      ctx.restore();

      // 3. PERFECTLY CENTERED LYRICS
      const time = audio.currentTime;
      const activeSeg = segments.find(s => time >= s.start && time <= s.end);
      
      if (activeSeg) {
        ctx.save();
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        const isPortrait = aspectRatio === '9:16' || aspectRatio === '3:4';
        const fontSize = isPortrait ? width / 12 : width / 18;
        ctx.font = `900 ${fontSize}px sans-serif`;
        
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = fontSize / 3;
        ctx.shadowOffsetY = fontSize / 10;

        const words = activeSeg.text.split(' ');
        let line = '';
        const lines = [];
        const maxWidth = width * 0.82;
        
        for (let n = 0; n < words.length; n++) {
          const testLine = line + words[n] + ' ';
          const metrics = ctx.measureText(testLine);
          if (metrics.width > maxWidth && n > 0) {
            lines.push(line);
            line = words[n] + ' ';
          } else {
            line = testLine;
          }
        }
        lines.push(line);

        const lineHeight = fontSize * 1.25;
        const totalBlockHeight = lines.length * lineHeight;
        const startY = (height / 2) - (totalBlockHeight / 2) + (lineHeight / 2);
        
        lines.forEach((l, i) => {
          ctx.fillText(l.trim(), width / 2, startY + i * lineHeight);
        });
        ctx.restore();
      }

      // 4. METADATA FOOTER - FIXED CENTERING
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = 'white';
      ctx.textAlign = 'center'; // Explicitly set centering
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${width / 45}px sans-serif`;
      const displayMeta = `${metadata.title}${metadata.artist ? ' • ' + metadata.artist : ''}`;
      ctx.fillText(displayMeta, width / 2, height - (height * 0.08));
      ctx.restore();

      setExportProgress((audio.currentTime / audio.duration) * 100);
      animationFrameRef.current = requestAnimationFrame(drawFrame);
    };

    drawFrame();
  };

  return (
    <div className="w-full max-w-5xl mx-auto animate-fade-in mb-24">
      <div className="bg-slate-900 rounded-3xl shadow-2xl overflow-hidden border border-slate-800">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex flex-col md:flex-row justify-between items-center gap-6 bg-slate-900/40">
          <div className="flex items-center gap-5">
            <button 
              onClick={onReset}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl transition-all group border border-slate-700"
            >
              <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" />
              <span className="font-semibold text-sm">New Project</span>
            </button>
            <div className="h-8 w-px bg-slate-800 hidden md:block" />
            <h2 className="text-xl font-bold text-white flex items-center gap-3">
              <span className="w-1.5 h-6 bg-indigo-500 rounded-full"></span>
              Results
            </h2>
          </div>
          <div className="flex flex-wrap gap-3 justify-center">
            <div className="flex bg-slate-800 p-1 rounded-xl border border-slate-700 shadow-inner">
              <button 
                onClick={() => downloadTextFile(generateSRT(segments), 'srt')}
                className="flex items-center gap-2 px-4 py-1.5 text-slate-400 hover:text-white rounded-lg transition-colors text-xs font-bold"
              >
                <FileText size={14} /> SRT
              </button>
              <button 
                onClick={() => downloadTextFile(generateLRC(segments, metadata), 'lrc')}
                className="flex items-center gap-2 px-4 py-1.5 text-slate-400 hover:text-white rounded-lg transition-colors text-xs font-bold"
              >
                <Music size={14} /> LRC
              </button>
            </div>
            <button 
              onClick={exportVideo}
              disabled={isExporting}
              className="flex items-center gap-2 px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-all text-sm font-bold disabled:opacity-50 shadow-lg shadow-indigo-600/30 active:scale-95"
            >
              {isExporting ? <Loader2 className="animate-spin" size={18} /> : <Video size={18} />}
              Export Video
            </button>
          </div>
        </div>

        {/* Export Settings */}
        <div 
          className="px-6 py-4 bg-slate-950/20 border-b border-slate-800 flex items-center justify-between cursor-pointer group hover:bg-slate-950/40 transition-colors"
          onClick={() => setIsSettingsOpen(!isSettingsOpen)}
        >
          <div className="flex items-center gap-4">
            <div className={`p-2.5 rounded-xl transition-all ${isSettingsOpen ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'bg-slate-800 text-slate-400 group-hover:text-slate-200'}`}>
              <Settings size={18} />
            </div>
            <div>
              <p className="text-sm font-bold text-white">Video & Metadata Configuration</p>
              <p className="text-xs text-slate-500">Edit titles, aspect ratio, and resolution</p>
            </div>
          </div>
          <div className="text-slate-500 group-hover:text-slate-300">
            {isSettingsOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </div>
        </div>

        {isSettingsOpen && (
          <div className="p-8 bg-slate-900/60 border-b border-slate-800 animate-fade-in-down grid grid-cols-1 lg:grid-cols-2 gap-10">
            <div className="space-y-6">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <TypeIcon size={14} /> Track Information
              </h3>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-500 mb-2 ml-1 font-bold">TITLE</label>
                    <input 
                      type="text" 
                      value={metadata.title}
                      onChange={(e) => setMetadata({...metadata, title: e.target.value})}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-2 ml-1 font-bold">ARTIST</label>
                    <input 
                      type="text" 
                      value={metadata.artist}
                      onChange={(e) => setMetadata({...metadata, artist: e.target.value})}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-2 ml-1 font-bold">ALBUM (OPTIONAL)</label>
                  <input 
                    type="text" 
                    value={metadata.album}
                    onChange={(e) => setMetadata({...metadata, album: e.target.value})}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-8">
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <Layout size={14} /> Aspect Ratio
                </h3>
                <div className="flex gap-3">
                  {(['16:9', '9:16', '3:4'] as AspectRatio[]).map(ratio => (
                    <button
                      key={ratio}
                      onClick={() => setAspectRatio(ratio)}
                      className={`flex-1 py-4 rounded-xl border-2 transition-all flex flex-col items-center gap-3 ${
                        aspectRatio === ratio 
                          ? 'bg-indigo-600/10 border-indigo-600 text-indigo-400' 
                          : 'bg-slate-800 border-transparent text-slate-500 hover:bg-slate-700 hover:text-slate-300'
                      }`}
                    >
                      {ratio === '16:9' ? <Monitor size={22} /> : ratio === '9:16' ? <Smartphone size={22} /> : <Layers size={22} />}
                      <span className="text-xs font-black tracking-tighter">{ratio}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <Sparkles size={14} /> Export Resolution
                </h3>
                <div className="flex bg-slate-800 p-1.5 rounded-2xl border border-slate-700">
                  {(['720p', '1080p'] as Resolution[]).map(res => (
                    <button
                      key={res}
                      onClick={() => setResolution(res)}
                      className={`flex-1 py-2.5 text-xs font-black rounded-xl transition-all ${
                        resolution === res ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {res === '1080p' ? '1080p FULL HD' : '720p STANDARD'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Player & Subtitles */}
        <div className="bg-slate-950/40">
           {audioUrl && (
            <div className="p-5 bg-slate-900/80 border-b border-slate-800 sticky top-0 z-20 backdrop-blur-md">
              <audio 
                ref={audioRef}
                src={audioUrl}
                controls
                className="w-full h-11 accent-indigo-500"
                onTimeUpdate={handleTimeUpdate}
              />
            </div>
          )}

          <div ref={containerRef} className="h-[480px] overflow-y-auto scroll-smooth">
            <div className="p-8 space-y-4">
              {segments.map((seg, idx) => (
                <div 
                  key={idx} 
                  onClick={() => handleSeek(seg.start)}
                  className={`flex gap-8 p-5 rounded-2xl transition-all cursor-pointer border-2 group ${
                    idx === activeIndex 
                      ? 'bg-indigo-600/10 border-indigo-500/30 scale-[1.01] shadow-xl shadow-indigo-500/5' 
                      : 'border-transparent bg-slate-800/10 hover:bg-slate-800/40'
                  }`}
                >
                  <div className={`text-xs font-mono min-w-[90px] text-right pt-1.5 tabular-nums transition-colors ${idx === activeIndex ? 'text-indigo-400' : 'text-slate-500'}`}>
                    {formatToDisplayTime(seg.start)}
                  </div>
                  <p className={`flex-1 text-lg leading-relaxed transition-all ${idx === activeIndex ? 'text-white font-semibold' : 'text-slate-400 group-hover:text-slate-300'}`}>
                    {seg.text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Export Overlay with Abort Button */}
        {isExporting && (
          <div className="absolute inset-0 z-50 bg-slate-950/98 flex flex-col items-center justify-center p-12 text-center animate-fade-in backdrop-blur-xl">
            <div className="relative w-48 h-48 mb-12 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border-4 border-slate-900" />
              <div 
                className="absolute inset-0 rounded-full border-4 border-indigo-500 transition-all duration-300 ease-out shadow-[0_0_35px_rgba(99,102,241,0.6)]"
                style={{ 
                  clipPath: `conic-gradient(white ${exportProgress}%, transparent 0)`,
                  transform: 'rotate(-90deg)'
                }}
              />
              <div className="absolute w-36 h-36 rounded-full bg-slate-900/80 flex items-center justify-center border border-slate-800/50 backdrop-blur-sm">
                <div className="flex flex-col items-center">
                  <span className="text-4xl font-black text-white">{Math.round(exportProgress)}%</span>
                  <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mt-1">Exporting</span>
                </div>
              </div>
              <div className="absolute -inset-6 rounded-full border border-indigo-500/10 animate-ping" />
            </div>
            
            <div className="space-y-6 max-w-md">
              <h3 className="text-3xl font-black text-white tracking-tight">Synchronizing Visuals</h3>
              <p className="text-slate-400 text-sm leading-relaxed px-4">
                Rendering audio-reactive bars and perfectly aligned lyrics.
                <span className="block mt-2 font-bold text-indigo-400/80 italic">Keep this window visible for seamless recording.</span>
              </p>
              
              <button 
                onClick={abortExport}
                className="mt-4 px-6 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl transition-all flex items-center gap-2 mx-auto text-sm font-bold active:scale-95"
              >
                <XCircle size={18} />
                Abort Rendering
              </button>
            </div>
            
            <div className="mt-12 flex items-center gap-3 px-6 py-2.5 bg-slate-900/60 rounded-full border border-indigo-500/20 shadow-lg">
              <Activity className="w-4 h-4 text-emerald-500 animate-pulse" />
              <span className="text-[11px] font-black text-slate-300 uppercase tracking-[0.2em]">Real-time Capture Engine</span>
            </div>
          </div>
        )}

        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  );
};

export default ResultsView;
