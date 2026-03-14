/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Mic, 
  Upload, 
  Play, 
  Square, 
  CheckCircle2, 
  AlertCircle, 
  ChevronRight, 
  Code2, 
  FileAudio,
  Sparkles,
  RefreshCw,
  Copy,
  Terminal,
  Download,
  Volume2,
  Zap,
  Waves,
  History,
  Settings2,
  X,
  Activity,
  FileText,
  LayoutDashboard,
  Trash2,
  ExternalLink,
  BarChart3,
  Clock,
  LogIn,
  LogOut,
  User as UserIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useDropzone } from 'react-dropzone';
import { GoogleGenAI, Modality } from "@google/genai";
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  onAuthStateChanged, 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  Timestamp,
  User
} from './firebase';

// Error Boundary Component
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, errorInfo: string | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorInfo: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, errorInfo: error.message };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#41291d] p-4">
          <div className="glass-card p-10 max-w-md w-full text-center border border-red-500/20">
            <AlertCircle size={48} className="text-red-500 mx-auto mb-6" />
            <h2 className="text-2xl font-black uppercase tracking-tighter mb-4">System Error</h2>
            <p className="text-sm opacity-60 mb-8 leading-relaxed">
              An unexpected error occurred. Please try refreshing the application.
            </p>
            <pre className="text-[10px] bg-black/5 p-4 rounded-xl overflow-auto text-left mb-8 max-h-40">
              {this.state.errorInfo}
            </pre>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-violet-600 text-white rounded-xl font-black uppercase tracking-widest text-xs hover:bg-violet-700 transition-all"
            >
              Reload System
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Types
interface ProcessingResult {
  transcription: string;
  issues: string[];
  correctedText: string;
  audioUrl?: string;
  timestamp: number;
  language?: string;
  suggestedVoice?: 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';
  vocalProfile?: {
    pitch: string;
    pace: string;
    tone: string;
    energy: string;
    description: string;
  };
}

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ja', name: 'Japanese' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ar', name: 'Arabic' },
  { code: 'te', name: 'Telugu' },
];

type Step = 'idle' | 'transcribing' | 'analyzing' | 'correcting' | 'generating_audio' | 'completed';

// Helper to wrap raw PCM in WAV header
function pcmToWav(pcmBase64: string, sampleRate: number = 24000): string {
  const binaryString = window.atob(pcmBase64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);

  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + len, true);    // file length
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);          // length of fmt chunk
  view.setUint16(20, 1, true);           // format (1 = PCM)
  view.setUint16(22, 1, true);           // channels (1 = mono)
  view.setUint32(24, sampleRate, true);  // sample rate
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);           // block align
  view.setUint16(34, 16, true);          // bits per sample
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, len, true);         // data length

  const blob = new Blob([wavHeader, bytes], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

export default function AppWrapper() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<'editor' | 'dashboard'>('editor');
  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [step, setStep] = useState<Step>('idle');
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [history, setHistory] = useState<ProcessingResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [voice, setVoice] = useState<'User' | 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr'>('User');
  const [targetLanguage, setTargetLanguage] = useState('en');
  const [isTranslating, setIsTranslating] = useState(false);
  const [autoVoiceSync, setAutoVoiceSync] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setHistory([]);
      return;
    }

    const q = query(
      collection(db, 'voice_analyses'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          ...data,
          timestamp: data.createdAt?.toMillis() || Date.now(),
        } as ProcessingResult;
      });
      setHistory(docs);
    }, (err) => {
      console.error("Firestore error:", err);
    });

    return () => unsubscribe();
  }, [user]);

  const login = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error("Login error:", err);
      setError("Failed to sign in with Google.");
    }
  };

  const logout = async () => {
    try {
      await auth.signOut();
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  const saveToFirestore = async (data: ProcessingResult) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'voice_analyses'), {
        userId: user.uid,
        originalText: data.transcription,
        correctedText: data.correctedText,
        vocalProfile: data.vocalProfile,
        audioUrl: data.audioUrl || null,
        language: data.language || 'en',
        createdAt: Timestamp.now()
      });
    } catch (err) {
      console.error("Error saving to Firestore:", err);
    }
  };

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);

  const getAI = () => {
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (!apiKey) {
      throw new Error("API_KEY_MISSING");
    }
    return new GoogleGenAI({ apiKey });
  };

  const callWithRetry = async (fn: () => Promise<any>, retries = 2) => {
    for (let i = 0; i <= retries; i++) {
      try {
        return await fn();
      } catch (err: any) {
        const isNetworkError = err.message?.includes("Rpc failed") || 
                              err.message?.includes("xhr error") || 
                              err.message?.includes("fetch");
        if (i < retries && isNetworkError) {
          console.warn(`Retrying API call (${i + 1}/${retries})...`);
          await new Promise(r => setTimeout(r, 1000 * (i + 1)));
          continue;
        }
        throw err;
      }
    }
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const selectedFile = acceptedFiles[0];
    if (selectedFile) {
      setFile(selectedFile);
      setAudioUrl(URL.createObjectURL(selectedFile));
      setResult(null);
      setStep('idle');
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'audio/*': ['.wav', '.aac', '.mp3', '.m4a'] },
    multiple: false
  });

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      audioChunks.current = [];

      mediaRecorder.current.ondataavailable = (event) => {
        audioChunks.current.push(event.data);
      };

      mediaRecorder.current.onstop = () => {
        const audioBlob = new Blob(audioChunks.current, { type: 'audio/wav' });
        const audioFile = new File([audioBlob], "recording.wav", { type: 'audio/wav' });
        setFile(audioFile);
        setAudioUrl(URL.createObjectURL(audioBlob));
      };

      mediaRecorder.current.start();
      setIsRecording(true);
      setResult(null);
      setStep('idle');
    } catch (err) {
      setError("Microphone access denied.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && isRecording) {
      mediaRecorder.current.stop();
      setIsRecording(false);
      mediaRecorder.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const deleteHistoryItem = (timestamp: number) => {
    setHistory(prev => prev.filter(item => item.timestamp !== timestamp));
    if (result?.timestamp === timestamp) {
      setResult(null);
      setStep('idle');
    }
  };

  const processAudio = async () => {
    if (!file) return;

    setStep('transcribing');
    setError(null);
    setResult(null);

    try {
      const ai = getAI();
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
      });
      reader.readAsDataURL(file);
      const base64Data = await base64Promise;

      const analysisResponse = await callWithRetry(() => ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: file.type || "audio/wav",
                  data: base64Data
                }
              },
              {
                text: `Analyze this audio for unclear speech. 
                CRITICAL: The output must be "the same as the input" in terms of meaning, tone, and intent, but perfectly clear and grammatically correct.
                1. Transcribe the audio exactly as heard (including stutters or errors).
                2. Identify specific unclear words or grammar mistakes.
                3. Provide a corrected, natural-sounding version that preserves the user's original voice and intent perfectly.
                4. Analyze the speaker's voice in detail. Suggest which of these 5 neural voices best matches their base characteristics: 
                   - "Kore": Female, warm, professional
                   - "Puck": Male, energetic, youthful
                   - "Charon": Male, deep, authoritative
                   - "Fenrir": Male, calm, steady
                   - "Zephyr": Female, light, airy
                5. Provide a "vocalProfile" object with keys: "pitch", "pace", "tone", "energy", and a "description" (a one-sentence summary of how they sound).
                6. If the target language is not English, translate the final corrected text to ${LANGUAGES.find(l => l.code === targetLanguage)?.name || 'English'}.
                Return ONLY a JSON object with keys: "transcription", "issues" (array of strings), "correctedText", "suggestedVoice", and "vocalProfile".`
              }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json"
        }
      }));

      const data = JSON.parse(analysisResponse.text || '{}') as ProcessingResult;
      data.timestamp = Date.now();
      data.language = targetLanguage;
      
      if (autoVoiceSync && data.suggestedVoice) {
        setVoice(data.suggestedVoice);
      }
      
      setStep('analyzing');
      await new Promise(r => setTimeout(r, 600));
      
      setStep('correcting');
      setResult({ ...data, correctedText: '...' });
      await new Promise(r => setTimeout(r, 600));
      
      setResult(data);
      setStep('generating_audio');

      await generateAudio(data);
      
      if (user) {
        await saveToFirestore(data);
      } else {
        setHistory(prev => [data, ...prev].slice(0, 10));
      }
      setStep('completed');

    } catch (err: any) {
      console.error("Processing error:", err);
      if (err.message === "API_KEY_MISSING") {
        setError("Gemini API key is missing. Please configure it in the settings.");
      } else if (err.message?.includes("429") || err.message?.includes("RESOURCE_EXHAUSTED") || err.message?.includes("quota")) {
        setError("API Quota Exceeded: You've reached the rate limit for your Gemini API key. Please wait a minute or check your billing plan at ai.google.dev.");
      } else if (err.message?.includes("Rpc failed") || err.message?.includes("xhr error")) {
        setError("Network error: The AI service is temporarily unavailable. If this persists, please ensure you have selected a valid API key in the settings.");
        // Try to trigger key selection if it's a permission issue
        if (window.aistudio && (err.message?.includes("code: 6") || err.message?.includes("code: 7"))) {
          window.aistudio.openSelectKey();
        }
      } else {
        setError("Failed to process audio. Please try again.");
      }
      setStep('idle');
    }
  };

  const generateAudio = async (data: ProcessingResult) => {
    try {
      const ai = getAI();
      
      // Determine the base voice to use
      let baseVoice: 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr' = 'Kore';
      
      if (voice === 'User') {
        // If "My Voice" is selected, use the auto-matched voice or default to a neutral one
        baseVoice = data.suggestedVoice || 'Kore';
      } else {
        baseVoice = voice as any;
      }
      
      // Style Injection: Use the vocal profile to guide the TTS
      const styleInstruction = data.vocalProfile 
        ? `In the exact style of the original speaker (${data.vocalProfile.description}), speak at a ${data.vocalProfile.pace} pace with ${data.vocalProfile.energy} energy: `
        : "Say clearly and naturally: ";

      const ttsResponse = await callWithRetry(() => ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `${styleInstruction}${data.correctedText}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: baseVoice },
            },
          },
        },
      }));

      const base64Audio = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        data.audioUrl = pcmToWav(base64Audio, 24000);
        setResult({ ...data });
      }
    } catch (ttsErr: any) {
      console.warn("TTS Generation failed:", ttsErr);
      if (ttsErr.message?.includes("429") || ttsErr.message?.includes("RESOURCE_EXHAUSTED") || ttsErr.message?.includes("quota")) {
        setError("Audio synthesis failed: API quota exceeded. Please wait a moment.");
      } else if (ttsErr.message?.includes("Rpc failed") || ttsErr.message?.includes("xhr error")) {
        setError("Audio synthesis failed due to a network error. Please try again.");
        if (window.aistudio && (ttsErr.message?.includes("code: 6") || ttsErr.message?.includes("code: 7"))) {
          window.aistudio.openSelectKey();
        }
      }
    }
  };

  const handleLanguageChange = async (newLang: string) => {
    if (!result || step !== 'completed' || isTranslating) return;
    
    setTargetLanguage(newLang);
    setIsTranslating(true);
    
    try {
      const ai = getAI();
      const translationResponse = await callWithRetry(() => ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{
          parts: [{
            text: `Translate the following text to ${LANGUAGES.find(l => l.code === newLang)?.name || 'English'}. 
            Preserve the tone, intent, and meaning perfectly.
            Text: "${result.correctedText}"
            Return ONLY the translated text.`
          }]
        }]
      }));

      const translatedText = translationResponse.text?.trim() || result.correctedText;
      const updatedResult = { 
        ...result, 
        correctedText: translatedText, 
        language: newLang,
        audioUrl: undefined // Reset audio to regenerate
      };
      
      setResult(updatedResult);
      await generateAudio(updatedResult);
      
      if (user) {
        await saveToFirestore(updatedResult);
      } else {
        // Update history
        setHistory(prev => prev.map(item => item.timestamp === result.timestamp ? updatedResult : item));
      }
      
    } catch (err: any) {
      console.error("Translation failed:", err);
      if (err.message?.includes("429") || err.message?.includes("RESOURCE_EXHAUSTED") || err.message?.includes("quota")) {
        setError("Translation failed: API quota exceeded. Please wait a moment before trying again.");
      } else {
        setError("Failed to translate text.");
      }
    } finally {
      setIsTranslating(false);
    }
  };

  return (
    <div 
      className="min-h-screen text-[#1a1a1a] font-sans selection:bg-violet-500 selection:text-white overflow-x-hidden p-4 md:p-8 relative"
      style={{ backgroundColor: '#41291d' }}
    >
      {/* Background Image / Watermark */}
      <div className="fixed inset-0 pointer-events-none z-0 flex items-center justify-center opacity-[0.04]">
        <img 
          src="https://images.unsplash.com/photo-1581579438747-1dc8d17bbce4?auto=format&fit=crop&q=80&w=2000" 
          alt="Helpful Concept" 
          className="w-full h-full object-cover grayscale"
          referrerPolicy="no-referrer"
        />
      </div>

      {/* Atmospheric Background Glows */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-violet-500/10 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[70%] h-[70%] bg-green-500/10 blur-[150px] rounded-full" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[50%] h-[50%] bg-red-500/5 blur-[180px] rounded-full" />
      </div>

      <div 
        className="max-w-7xl mx-auto relative z-10 p-8 rounded-3xl"
        style={{ backgroundColor: '#e2d596' }}
      >
        {/* Main Heading */}
        <div className="text-center mb-[10px] pl-[1px]">
          <h1 className="font-black tracking-tighter uppercase leading-none" style={{ fontSize: '45px' }}>
            Unclear Voice <span className="text-violet-500">to</span> <br />
            <span className="text-green-600">Perfect Voice</span>
          </h1>
          <p className="text-xs font-black uppercase tracking-[0.5em] opacity-30 mt-6">
            Neural Reconstruction & Spectral Clarity
          </p>
        </div>

        {/* Header */}
        <header className="flex items-center justify-between mb-12">
          <div className="flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-3 bg-white/50 backdrop-blur-md border border-black/5 rounded-2xl p-2 pr-4">
                <img src={user.photoURL || ''} alt={user.displayName || ''} className="w-10 h-10 rounded-xl border border-black/5" />
                <div className="hidden md:block">
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-40">Active Session</p>
                  <p className="text-xs font-bold">{user.displayName}</p>
                </div>
                <button onClick={logout} className="ml-2 p-2 hover:bg-red-500/10 text-red-500 rounded-lg transition-colors">
                  <LogOut size={18} />
                </button>
              </div>
            ) : (
              <button 
                onClick={login}
                className="flex items-center gap-3 px-6 py-3 bg-violet-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-violet-700 transition-all shadow-lg"
              >
                <LogIn size={18} />
                Connect Identity
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-white border border-black/5 rounded-xl p-1 shadow-sm">
              <div className="flex items-center gap-2 px-3 py-2 border-r border-black/5">
                <Volume2 size={16} className="text-violet-500" />
                <select 
                  value={voice}
                  onChange={(e) => setVoice(e.target.value as any)}
                  className="bg-transparent border-none text-xs uppercase font-black tracking-widest focus:ring-0 outline-none cursor-pointer"
                >
                  <option value="User">Voice: Auto</option>
                  <option value="Kore">Kore</option>
                  <option value="Puck">Puck</option>
                  <option value="Charon">Charon</option>
                  <option value="Fenrir">Fenrir</option>
                  <option value="Zephyr">Zephyr</option>
                </select>
              </div>
              <div className="flex items-center gap-2 px-3 py-2">
                <Activity size={16} className="text-green-500" />
                <select 
                  value={targetLanguage}
                  onChange={(e) => handleLanguageChange(e.target.value)}
                  className="bg-transparent border-none text-xs uppercase font-black tracking-widest focus:ring-0 outline-none cursor-pointer"
                >
                  {LANGUAGES.map(lang => (
                    <option key={lang.code} value={lang.code}>{lang.name}</option>
                  ))}
                </select>
              </div>
            </div>
            
            <button 
              onClick={() => setView(view === 'editor' ? 'dashboard' : 'editor')}
              className="w-10 h-10 flex items-center justify-center bg-white border border-black/5 rounded-xl hover:bg-black/5 transition-all shadow-sm"
              title={view === 'editor' ? "Archive" : "Lab"}
            >
              {view === 'editor' ? <LayoutDashboard size={18} className="text-violet-500" /> : <Zap size={18} className="text-red-500" />}
            </button>
          </div>
        </header>

        <AnimatePresence mode="wait">
          {view === 'editor' ? (
            <motion.main 
              key="editor"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-2xl mx-auto space-y-6"
            >
              {/* Input Section */}
              <div className="glass-card overflow-hidden border border-black/5 shadow-xl">
                <div 
                  {...getRootProps()} 
                  className={cn(
                    "h-64 flex flex-col items-center justify-center p-8 text-center transition-all cursor-pointer",
                    isDragActive ? "bg-violet-500/5" : "hover:bg-black/[0.01]"
                  )}
                >
                  <input {...getInputProps()} />
                  {step === 'idle' ? (
                    <>
                      <div className="w-20 h-20 rounded-full bg-black/5 flex items-center justify-center mb-6">
                        <Upload className="text-violet-500 opacity-40" size={32} />
                      </div>
                      <p className="text-2xl font-black opacity-40 uppercase tracking-widest">
                        {file ? file.name : "Input Signal"}
                      </p>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-6">
                      <RefreshCw className="animate-spin text-violet-500" size={48} />
                      <p className="text-lg font-black uppercase tracking-[0.4em] text-violet-500">
                        {step.replace('_', ' ')}
                      </p>
                    </div>
                  )}
                </div>
                
                <div className="flex border-t border-black/5">
                  <button 
                    {...getRootProps()}
                    className="flex-1 py-6 text-sm font-black uppercase tracking-widest hover:bg-black/5 transition-all border-r border-black/5 flex items-center justify-center gap-3 text-violet-600"
                  >
                    <Upload size={18} />
                    Upload
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); isRecording ? stopRecording() : startRecording(); }}
                    className={cn(
                      "flex-1 py-6 text-sm font-black uppercase tracking-widest transition-all flex items-center justify-center gap-3",
                      isRecording ? "bg-red-500 text-white" : "hover:bg-black/5 text-red-600"
                    )}
                  >
                    <Mic size={18} />
                    {isRecording ? "Stop" : "Record"}
                  </button>
                  {file && step === 'idle' && (
                    <button 
                      onClick={(e) => { e.stopPropagation(); processAudio(); }}
                      className="px-12 bg-green-500 text-white text-sm font-black uppercase tracking-widest hover:bg-green-600 transition-all"
                    >
                      Process
                    </button>
                  )}
                </div>
              </div>

              {/* Output Section */}
              {(result || step !== 'idle') && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="glass-card border border-black/5 shadow-xl overflow-hidden"
                >
                  <div className="flex items-center gap-6 p-8 bg-violet-500/5 border-b border-black/5">
                    <div className="flex-1">
                      <audio src={result?.audioUrl} controls className="w-full h-14" />
                    </div>
                    <button 
                      onClick={() => result?.audioUrl && window.open(result.audioUrl)}
                      className="h-14 px-10 rounded-xl bg-violet-600 text-white text-sm font-black uppercase tracking-widest hover:bg-violet-700 transition-all flex items-center gap-3 shadow-lg"
                    >
                      <Download size={20} />
                      Audio
                    </button>
                  </div>
                  <div className="p-12">
                    <h3 className="text-sm font-black uppercase tracking-widest text-violet-500 mb-8">Output Reconstruction</h3>
                    <p className="text-[25px] font-bold leading-tight text-black min-h-[100px]">
                      {result?.correctedText || "..."}
                    </p>
                  </div>
                </motion.div>
              )}

              {/* Description Section */}
              {result?.vocalProfile && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="glass-card p-10 border border-black/5 shadow-xl relative overflow-hidden"
                >
                  {/* Section-specific background image */}
                  <div className="absolute top-0 right-0 w-1/3 h-full opacity-[0.08] pointer-events-none">
                    <img 
                      src="https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&q=80&w=800" 
                      alt="Voice Analysis Context" 
                      className="w-full h-full object-cover grayscale"
                      referrerPolicy="no-referrer"
                    />
                  </div>

                  <h3 className="text-sm font-black uppercase tracking-widest text-green-600 mb-10 relative z-10">Description & Analysis</h3>
                  <div className="space-y-10 relative z-10">
                    <p className="text-2xl font-serif italic opacity-80 leading-relaxed text-black">
                      "{result.vocalProfile.description}"
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
                      {Object.entries(result.vocalProfile).filter(([k]) => k !== 'description').map(([key, value]) => (
                        <div key={key} className="bg-green-500/[0.05] rounded-2xl p-6 border border-green-500/10">
                          <span className="block text-[10px] uppercase text-green-600 font-black mb-3 tracking-widest">{key}</span>
                          <span className="text-sm font-bold text-black">{value as string}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </motion.main>
          ) : (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8 pb-20 pt-8"
            >
              {/* Stats Overview */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="glass-card p-6 border border-black/5">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-[#ff4e00]/10 flex items-center justify-center">
                      <FileAudio size={18} className="text-[#ff4e00]" />
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest opacity-40">Total Signals</span>
                  </div>
                  <p className="text-4xl font-black tracking-tighter">{history.length}</p>
                </div>
                <div className="glass-card p-6 border border-black/5">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                      <CheckCircle2 size={18} className="text-emerald-500" />
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest opacity-40">Perfected</span>
                  </div>
                  <p className="text-4xl font-black tracking-tighter">{history.length}</p>
                </div>
                <div className="glass-card p-6 border border-black/5">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                      <BarChart3 size={18} className="text-blue-500" />
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest opacity-40">Neural Syncs</span>
                  </div>
                  <p className="text-4xl font-black tracking-tighter">{history.filter(h => h.vocalProfile).length}</p>
                </div>
                <div className="glass-card p-6 border border-black/5">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
                      <Clock size={18} className="text-purple-500" />
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest opacity-40">Last Activity</span>
                  </div>
                  <p className="text-lg font-bold tracking-tight">
                    {history.length > 0 ? new Date(history[0].timestamp).toLocaleDateString() : 'No data'}
                  </p>
                </div>
              </div>

              {/* Archive Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {history.length === 0 ? (
                  <div className="col-span-full py-40 text-center glass-card border border-dashed border-black/10">
                    <Waves size={48} className="mx-auto mb-6 opacity-10" />
                    <p className="text-sm font-bold opacity-20 uppercase tracking-[0.3em]">No historical signals detected</p>
                    <button 
                      onClick={() => setView('editor')}
                      className="mt-6 px-6 py-3 bg-[#ff4e00] text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-transform"
                    >
                      Start Processing
                    </button>
                  </div>
                ) : (
                  history.map((item) => (
                    <motion.div 
                      layout
                      key={item.timestamp}
                      className="glass-card p-6 border border-black/5 hover:border-[#ff4e00]/30 transition-all group"
                    >
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-black/5 flex items-center justify-center">
                            <FileAudio size={14} className="opacity-40" />
                          </div>
                          <div>
                            <p className="text-[10px] font-mono opacity-40">{new Date(item.timestamp).toLocaleString()}</p>
                            <span className="text-[8px] font-black uppercase tracking-widest bg-[#ff4e00]/10 text-[#ff4e00] px-2 py-0.5 rounded">
                              {LANGUAGES.find(l => l.code === item.language)?.name}
                            </span>
                          </div>
                        </div>
                        <button 
                          onClick={() => deleteHistoryItem(item.timestamp)}
                          className="w-8 h-8 rounded-lg bg-red-500/10 text-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500 hover:text-white"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>

                      <div className="space-y-4 mb-8">
                        <p className="text-sm font-serif italic line-clamp-3 opacity-80 leading-relaxed">
                          "{item.correctedText}"
                        </p>
                        {item.vocalProfile && (
                          <div className="flex flex-wrap gap-2">
                            <span className="text-[8px] font-bold uppercase tracking-widest bg-black/5 px-2 py-1 rounded border border-black/5">
                              {item.vocalProfile.pitch}
                            </span>
                            <span className="text-[8px] font-bold uppercase tracking-widest bg-black/5 px-2 py-1 rounded border border-black/5">
                              {item.vocalProfile.energy}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 pt-4 border-t border-black/5">
                        <button 
                          onClick={() => { setResult(item); setView('editor'); setStep('completed'); }}
                          className="flex-1 h-10 rounded-xl bg-black/5 hover:bg-black/10 transition-all text-[9px] font-black uppercase tracking-widest flex items-center justify-center gap-2"
                        >
                          <ExternalLink size={12} />
                          Open in Lab
                        </button>
                        {item.audioUrl && (
                          <button 
                            onClick={() => window.open(item.audioUrl)}
                            className="w-10 h-10 rounded-xl bg-[#ff4e00]/10 text-[#ff4e00] flex items-center justify-center hover:bg-[#ff4e00] hover:text-white transition-all"
                          >
                            <Download size={14} />
                          </button>
                        )}
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* History Sidebar (Legacy - can be removed or kept as quick access) */}
        <AnimatePresence>
          {showHistory && (
            <>
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowHistory(false)}
                className="fixed inset-0 bg-white/60 backdrop-blur-sm z-[100]"
              />
              <motion.div 
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                className="fixed top-0 right-0 h-full w-full max-w-md bg-white border-l border-black/5 z-[110] p-8 overflow-y-auto shadow-2xl"
              >
                <div className="flex items-center justify-between mb-12">
                  <h2 className="text-xl font-black uppercase tracking-tighter">Quick Archive</h2>
                  <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-black/5 rounded-full">
                    <X size={24} />
                  </button>
                </div>

                <div className="space-y-6">
                  {history.length === 0 ? (
                    <div className="py-20 text-center opacity-20 italic">No historical records found.</div>
                  ) : (
                    history.map((item, i) => (
                      <div 
                        key={i} 
                        className="p-6 rounded-3xl bg-black/5 border border-black/5 hover:border-[#ff4e00]/30 transition-all cursor-pointer group relative"
                      >
                        <div onClick={() => { setResult(item); setView('editor'); setStep('completed'); setShowHistory(false); }}>
                          <div className="flex justify-between items-start mb-4">
                            <span className="text-[10px] font-mono opacity-40">{new Date(item.timestamp).toLocaleTimeString()}</span>
                            <span className="text-[8px] font-black uppercase tracking-widest bg-[#ff4e00]/10 text-[#ff4e00] px-2 py-0.5 rounded">
                              {LANGUAGES.find(l => l.code === item.language)?.name}
                            </span>
                          </div>
                          <p className="text-sm font-serif italic line-clamp-2 opacity-60 group-hover:opacity-100 transition-opacity">
                            "{item.correctedText}"
                          </p>
                        </div>
                        <button 
                          onClick={(e) => { e.stopPropagation(); deleteHistoryItem(item.timestamp); }}
                          className="absolute top-4 right-4 p-2 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/10 rounded-lg"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Global Error Toast */}
        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] px-6 py-4 bg-red-500 text-white rounded-2xl shadow-2xl flex flex-col gap-2 border border-white/20 min-w-[320px]"
            >
              <div className="flex items-center gap-4">
                <AlertCircle size={20} className="shrink-0" />
                <p className="text-sm font-bold flex-1">{error}</p>
                <button onClick={() => setError(null)} className="p-1 hover:bg-white/20 rounded shrink-0">
                  <X size={16} />
                </button>
              </div>
              {error.includes("Quota") && (
                <div className="flex justify-end pt-2">
                  <button 
                    onClick={() => {
                      setError(null);
                      if (file) processAudio();
                    }}
                    className="px-4 py-1.5 bg-white text-red-500 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-white/90 transition-colors"
                  >
                    Retry Now
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
