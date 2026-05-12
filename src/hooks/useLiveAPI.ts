import { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { floatTo16BitPCM, arrayBufferToBase64, base64ToArrayBuffer, pcm16ToFloat32 } from '../lib/audio-processing';

const MODEL = "gemini-3.1-flash-live-preview";

export interface LiveAPIState {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  transcript: { text: string; role: 'user' | 'model' }[];
  isTalking: boolean;
}

export const useLiveAPI = (systemInstruction: string) => {
  const [state, setState] = useState<LiveAPIState>({
    isConnected: false,
    isConnecting: false,
    error: null,
    transcript: [],
    isTalking: false,
  });

  const sessionRef = useRef<Promise<unknown> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);
  const nextPlayTimeRef = useRef(0);
  const [playbackOptions, setPlaybackOptions] = useState({ intensity: 0, mood: 'Wary' });

  const cleanup = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setState(prev => ({ ...prev, isConnected: false, isConnecting: false, isTalking: false }));
    isPlayingRef.current = false;
    audioQueueRef.current = [];
  }, []);

  const clearTranscript = useCallback(() => {
    setState(prev => ({ ...prev, transcript: [] }));
  }, []);

  const playAudioChunk = useCallback((floatData: Float32Array) => {
    if (!audioContextRef.current) return;

    const buffer = audioContextRef.current.createBuffer(1, floatData.length, 24000); 
    buffer.copyToChannel(floatData, 0);

    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContextRef.current.destination);

    // DYNAMIC ADJUSTMENT
    const { intensity, mood } = playbackOptions;
    
    const playbackRate = 1.0 - (intensity * 0.25);
    source.playbackRate.value = playbackRate;

    const startTime = Math.max(audioContextRef.current.currentTime, nextPlayTimeRef.current);
    const pauseFactor = (mood === 'Hyper-vigilant' || intensity > 0.7) ? (intensity * 0.05) : 0;
    
    source.start(startTime);
    nextPlayTimeRef.current = startTime + (buffer.duration / playbackRate) + pauseFactor;
    
    setState(prev => ({ ...prev, isTalking: true }));
    source.onended = () => {
      if (audioContextRef.current && audioContextRef.current.currentTime >= nextPlayTimeRef.current - 0.1) {
        setState(prev => ({ ...prev, isTalking: false }));
      }
    };
  }, [playbackOptions]);

  const connect = useCallback(async () => {
    if (state.isConnected || state.isConnecting) return;

    setState(prev => ({ ...prev, isConnecting: true, error: null }));

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioContextRef.current = new AudioContextClass({
        sampleRate: 16000, 
      });

      // Load AudioWorklet
      try {
        await audioContextRef.current.audioWorklet.addModule('/audio-processor.js');
      } catch (e) {
        console.error("Failed to load AudioWorklet, falling back to basic checks", e);
      }

      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      if (!audioContextRef.current) return;
      
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const source = audioContextRef.current.createMediaStreamSource(streamRef.current);
      
      workletNodeRef.current = new AudioWorkletNode(audioContextRef.current, 'audio-processor');
      
      const sessionPromise = ai.live.connect({
        model: MODEL,
        callbacks: {
          onopen: () => {
            console.log("Live connection opened");
            setState(prev => ({ ...prev, isConnected: true, isConnecting: false }));
            
            source.connect(workletNodeRef.current!);
            // Removed: workletNodeRef.current!.connect(audioContextRef.current!.destination); // Fix mic feedback
            
            workletNodeRef.current!.port.onmessage = (e) => {
              const inputData = e.data; 
              const pcmData = floatTo16BitPCM(inputData);
              const base64Audio = arrayBufferToBase64(pcmData);
              
              sessionPromise.then(session => {
                session.sendRealtimeInput({
                  audio: { data: base64Audio, mimeType: 'audio/pcm;rate=16000' }
                });
              });
            };
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle GoAway or other close signals if they appear in serverContent
            // The API sends a GoAway signal when session limits are reached.
            const serverContent = message.serverContent;
            if (serverContent?.modelTurn?.parts?.[0]?.text === "GoAway") {
              console.log("Received GoAway signal from server");
              cleanup();
              return;
            }

            // Handle model audio output
            if (message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data) {
              const base64Audio = message.serverContent.modelTurn.parts[0].inlineData.data;
              const arrayBuffer = base64ToArrayBuffer(base64Audio);
              const pcm16 = new Int16Array(arrayBuffer);
              const float32 = pcm16ToFloat32(pcm16);
              playAudioChunk(float32);
            }

            // Handle tool calls, interruptions, transcripts
            if (message.serverContent?.interrupted) {
              // Interruption: clear queue and stop current playback if possible
              // Note: Stopping specific BufferSource is hard without keeping refs to all active ones
              nextPlayTimeRef.current = audioContextRef.current?.currentTime || 0;
              setState(prev => ({ ...prev, isTalking: false }));
            }

            // Handle model transcripts
            if (message.serverContent?.modelTurn?.parts?.[0]?.text) {
              const text = message.serverContent.modelTurn.parts[0].text;
               setState(prev => ({
                ...prev,
                transcript: [...prev.transcript, { text, role: 'model' }]
              }));
            }
          },
          onclose: (e) => {
            console.log("Live connection closed", e);
            cleanup();
          },
          onerror: (e) => {
            console.error("Live mistake", e);
            setState(prev => ({ ...prev, error: "Connection error. Please try again." }));
            cleanup();
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction,
          tools: [{ googleSearch: {} }],
          // Transcriptions optional but good for UI
          outputAudioTranscription: {},
        }
      });

      sessionRef.current = await sessionPromise;
      
    } catch (err) {
      console.error(err);
      setState(prev => ({ ...prev, isConnecting: false, error: (err as Error).message }));
      cleanup();
    }
  }, [state.isConnected, state.isConnecting, cleanup, playAudioChunk, systemInstruction]);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const sendText = useCallback(async (text: string) => {
    if (!sessionRef.current || !text.trim()) return;

    try {
      await sessionRef.current.sendRealtimeInput({
        text
      });
      setState(prev => ({
        ...prev,
        transcript: [...prev.transcript, { text, role: 'user' }]
      }));
    } catch (err) {
      console.error("Failed to send text:", err);
    }
  }, []);

  const sendImage = useCallback(async (base64: string, mimeType: string) => {
    if (!sessionRef.current) return;
    try {
      await sessionRef.current.sendRealtimeInput({
        video: { data: base64, mimeType }
      });
       setState(prev => ({
        ...prev,
        transcript: [...prev.transcript, { text: `[Image sent: ${mimeType}]`, role: 'user' }]
      }));
    } catch (err) {
      console.error("Failed to send image:", err);
    }
  }, []);

  const sendVideoFrame = useCallback(async (base64: string, mimeType: string) => {
    if (!sessionRef.current) return;
    try {
      await sessionRef.current.sendRealtimeInput({
        video: { data: base64, mimeType }
      });
      // No transcript update for video frames to keep it clean
    } catch (err) {
      console.error("Failed to send video frame:", err);
    }
  }, []);

  return { ...state, connect, disconnect: cleanup, sendText, sendImage, sendVideoFrame, setPlaybackOptions, clearTranscript };
};
