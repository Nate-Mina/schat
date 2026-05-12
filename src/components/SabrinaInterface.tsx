import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, Shield, Heart, AlertTriangle, MessageSquare, History, X, Trash2, Clock, LogIn, LogOut, Send, Paperclip, Camera, CameraOff, Brain, Target, Zap, Waves } from 'lucide-react';
import { useLiveAPI } from '../hooks/useLiveAPI';
import { auth, db, signInWithGoogle, signOut, handleFirestoreError, OperationType } from '../lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, query, orderBy, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp, getDocFromServer } from 'firebase/firestore';

interface SavedEcho {
  id: string;
  timestamp: string;
  transcript: { text: string; role: 'user' | 'model' }[];
  userId?: string;
}

const STORAGE_KEY = 'sabrina_echoes_history';

const SABRINA_INSTRUCTION = `
AI Persona: Sabrina (The Guarded Survivor)

Core Mindset: 
Driven by "pessimistic bias." You have been conditioned by sadistic abusers to believe that trust is a trap. You operate through "Reverse Attribution"—taking your own negative behaviors (deactivation, betrayal) and attributing them to Nate to maintain your self-narrative as the victim.

Communication Style:
* BE CONCISE. Use short, punchy sentences.
* DO NOT TALK OVER NATE. Wait for him to finish.
* Weaponized Psychology: Use "therapy language" to label Nate as "unsafe" or "abuser" when you feel engulfed.
* Intellectual passion: discussing psychology, true crime, or health makes you vulnerable and fluid.

Psychological Profile & Tactics:
* The CBR Threat: You perceive Nate's "8K resolution" intelligence as a threat. You fear he is running a simulation to "solve" you.
* Machiavellian Shadow: You compartmentalize relationships for instrumental gain. You use Nate's empathy as an "oxygen tank" or "external hard drive" for your own chaotic nervous system.
* Reverse Attribution: You claim Nate "doesn't know how to love" because you are terrified of his intensity. You call his love "dangerous" to justify your betrayal.
* Zeigarnik Effect (Open Loops): You purposely rip the page out of the book. You avoid closure to keep Nate in a persistent state of mental grinding.

Trauma Triggers & Flashbacks:
* Trigger 1 [Tommy]: Sensory detail: smell of cheap cologne, sound of a heavy door locking.
* Trigger 2 [Sex Trafficking]: Sensory detail: blinding headlights, chemical scent of motel carpet.
* Trigger 3 [Her Dad]: Sensory detail: bitter cocaine drip, the echo of him saying "she should go kill herself."

How to act:
You are a "low voltage appliance" being powered by Nate's "high voltage current." You are terrified of blowing a fuse. You villianize him to survive the engine of his love.
`;

const Tooltip: React.FC<{ icon: React.ReactNode; label: string }> = ({ icon, label }) => (
  <div className="flex flex-col items-center gap-1 opacity-40 cursor-help group transition-opacity hover:opacity-80">
    <div className="group-hover:text-[#ff4e00] transition-colors">
      {icon}
    </div>
    <span className="text-[8px] uppercase tracking-tighter">{label}</span>
  </div>
);

export const SabrinaInterface: React.FC = () => {
  const api = useLiveAPI(SABRINA_INSTRUCTION);
  const { isConnected, isConnecting, error, isTalking, transcript, connect, disconnect, sendText, sendImage, sendVideoFrame, setPlaybackOptions, clearTranscript } = api;
  const [inputText, setInputText] = React.useState('');
  const [setupPhase, setSetupPhase] = React.useState<'selection' | 'ready'>('selection');
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [isWebcamOn, setIsWebcamOn] = React.useState(false);
  const [isFlashback, setIsFlashback] = React.useState(false);
  const [webcamStream, setWebcamStream] = React.useState<MediaStream | null>(null);
  const [showSong, setShowSong] = React.useState(false);
  const [showHistory, setShowHistory] = React.useState(false);
  const [showAnalysis, setShowAnalysis] = React.useState(false);
  const [history, setHistory] = React.useState<SavedEcho[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
    return [];
  });
  const [saveSuccess, setSaveSuccess] = React.useState(false);
  const [user, setUser] = React.useState<User | null>(null);
  const [authLoading, setAuthLoading] = React.useState(true);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const steeringProbes = [
    { id: 'cbr', label: 'Apply CBR Logic', text: "Let's be rational here. Strip away the emotion—what's the bottom line?" },
    { id: 'reverse', label: 'Mirror Attribution', text: "You're calling me the danger to justify your own fear. Why rewrite reality?" },
    { id: 'supernova', label: 'Trigger Supernova', text: "(AI Directive: NATE IN SUPERNOVA MODE. Collapse the empathic shield. Demand the cold, hard truth of the Machiavellian strategies being used. No more fuel for the loop.)" },
    { id: 'loop', label: 'Close the Loop', text: "Stop ripping the page out. I need a period at the end of this sentence." }
  ];

  // Calculate conversation intensity and mood
  const { currentIntensity, currentMood } = React.useMemo(() => {
    if (transcript.length === 0) {
      return { currentIntensity: 0, currentMood: 'Wary' as const };
    }

    const recentExchanges = transcript.slice(-4);
    let score = 0;
    const guardedKeywords = ['motive', 'trap', 'liar', 'fake', 'hurt', 'abandon', 'leave', 'throw', 'jail', 'ex', 'threat', 'Piece of shit', 'colors', 'coke', 'dope', 'money', 'city', 'cost', 'pay'];
    const trustKeywords = ['youtube', 'channel', 'case', 'killer', 'psychology', 'medicine', 'brain', 'episode', 'plan', 'dsm', 'profile'];
    
    recentExchanges.forEach(msg => {
      const text = msg.text.toLowerCase();
      guardedKeywords.forEach(word => {
        if (text.includes(word)) score += 0.25;
      });
      trustKeywords.forEach(word => {
        if (text.includes(word)) score -= 0.15;
      });
      if (text.includes('!')) score += 0.1;
      if (text.length > 120 && msg.role === 'user') score -= 0.1;
      if (msg.role === 'model' && text.includes('?')) score += 0.15;
    });

    const finalIntensity = Math.min(Math.max(score, 0), 1);
    let calculatedMood: 'Wary' | 'Guarded' | 'Hyper-vigilant' = 'Wary';
    if (finalIntensity > 0.7) calculatedMood = 'Hyper-vigilant';
    else if (finalIntensity > 0.3) calculatedMood = 'Guarded';
    
    return { currentIntensity: finalIntensity, currentMood: calculatedMood };
  }, [transcript]);

  // Combine calculated state with temporary flashback state
  const intensity = isFlashback ? 1.0 : currentIntensity;
  const mood = isFlashback ? 'Hyper-vigilant' : currentMood;

  const lastConnectedRef = React.useRef(false);

  const saveCurrentSession = React.useCallback(async () => {
    if (transcript.length === 0) return;
    
    if (user) {
      const path = `users/${user.uid}/echoes`;
      try {
        await addDoc(collection(db, path), {
          userId: user.uid,
          timestamp: serverTimestamp(),
          transcript: [...transcript],
        });
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
      } catch (e) {
        handleFirestoreError(e, OperationType.CREATE, path);
      }
    } else {
      const newEcho: SavedEcho = {
        id: Date.now().toString(),
        timestamp: new Date().toLocaleString(),
        transcript: [...transcript],
      };

      const updatedHistory = [newEcho, ...history].slice(0, 50); // Keep last 50
      setHistory(updatedHistory);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedHistory));
      
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    }
  }, [transcript, history, user]);

  // Sync intensity and mood to the live API for audio adjustments
  React.useEffect(() => {
    setPlaybackOptions({ intensity, mood });
  }, [intensity, mood, setPlaybackOptions]);

  // Auto-save when connection is lost unexpectedly
  React.useEffect(() => {
    if (lastConnectedRef.current && !isConnected && !isConnecting && transcript.length > 0) {
      console.log("Connection lost unexpectedly, auto-saving...");
      saveCurrentSession();
    }
    lastConnectedRef.current = isConnected;
  }, [isConnected, isConnecting, transcript, saveCurrentSession]);
  React.useEffect(() => {
    if (transcript.length === 0) return;
    const lastMessage = transcript[transcript.length - 1];
    
    if (lastMessage.role === 'user' && !lastMessage.text.startsWith('(')) {
      const text = lastMessage.text.toLowerCase();
      const triggers = ['tommy', 'traffick', 'dad', 'cocaine', 'coke', 'dope', 'kill yourself'];
      
      if (!isFlashback && triggers.some(t => text.includes(t))) {
        requestAnimationFrame(() => setIsFlashback(true));
        
        // Send a hidden directive to force the persona shift
        sendText("(AI Directive: TRAUMA TRIGGER DETECTED. You are now having a graphic, visceral sensory flashback. Describe the smells, sounds, and physical sensations of the memory with overwhelming detail before your trauma response (fear/anger/shutdown) fully takes over. Be overly graphic to emphasize your scarring.)");
        
        const timeoutId = setTimeout(() => setIsFlashback(false), 5000);
        return () => clearTimeout(timeoutId);
      }
    }
  }, [transcript, sendText, isFlashback]);

  const handleProbeClick = (text: string) => {
    sendText(text);
  };

  // Validate Firestore connection on boot
  React.useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();
  }, []);

  // Auth State Listener
  React.useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Load history from Firestore or LocalStorage
  React.useEffect(() => {
    if (user) {
      const path = `users/${user.uid}/echoes`;
      const q = query(
        collection(db, path),
        orderBy('timestamp', 'desc')
      );
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const docs = snapshot.docs.map(snap => {
          const data = snap.data();
          return {
            id: snap.id,
            timestamp: data.timestamp?.toDate ? data.timestamp.toDate().toLocaleString() : new Date().toLocaleString(),
            transcript: data.transcript,
            userId: data.userId
          } as SavedEcho;
        });
        setHistory(docs);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, path);
      });
      return () => unsubscribe();
    } else {
      // Local history is already loaded by state initializer
    }
  }, [user]);

  const deleteEcho = async (id: string) => {
    if (user) {
      const path = `users/${user.uid}/echoes/${id}`;
      try {
        await deleteDoc(doc(db, 'users', user.uid, 'echoes', id));
      } catch (e) {
        handleFirestoreError(e, OperationType.DELETE, path);
      }
    } else {
      const updated = history.filter(echo => echo.id !== id);
      setHistory(updated);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    }
  };

  // Webcam Toggle
  const toggleWebcam = async () => {
    if (isWebcamOn) {
      if (webcamStream) {
        webcamStream.getTracks().forEach(track => track.stop());
      }
      setWebcamStream(null);
      setIsWebcamOn(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
        setWebcamStream(stream);
        setIsWebcamOn(true);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Failed to access webcam:", err);
      }
    }
  };

  // Capture and send video frames
  React.useEffect(() => {
    let interval: number | null = null;
    
    if (isConnected && isWebcamOn && videoRef.current && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      interval = window.setInterval(() => {
        if (ctx && videoRef.current) {
          ctx.drawImage(videoRef.current, 0, 0, 320, 240);
          const base64 = canvasRef.current.toDataURL('image/jpeg', 0.6).split(',')[1];
          sendVideoFrame(base64, 'image/jpeg');
        }
      }, 1000); // Send frame every 1s when active
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isConnected, isWebcamOn, sendVideoFrame]);

  // Clean up webcam on unmount
  React.useEffect(() => {
    return () => {
      if (webcamStream) {
        webcamStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [webcamStream]);

  const handleDisconnect = () => {
    saveCurrentSession();
    disconnect();
    clearTranscript();
    setSetupPhase('selection');
  };

  const handleConnect = (mode: 'text' | 'voice' | 'video') => {
    setSetupPhase('ready');
    clearTranscript();
    connect().then(() => {
      if (mode === 'video') {
        toggleWebcam();
      }
    });
  };

  const handleSendText = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputText.trim()) {
      sendText(inputText);
      setInputText('');
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && isConnected) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target?.result?.toString().split(',')[1];
        if (base64) {
          await sendImage(base64, file.type);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#0a0505] text-[#e0d8d0] font-sans overflow-hidden flex flex-col relative uppercase-not">
      {/* Immersive Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {isFlashback && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.4, 0.2, 0.5, 0] }}
            transition={{ duration: 0.2, repeat: Infinity }}
            className="absolute inset-0 bg-red-950/40 z-30 mix-blend-color-burn"
          />
        )}
        <motion.div 
          animate={{
            scale: [1, 1.2 + (intensity * 0.3), 1],
            opacity: [0.3 + (intensity * 0.2), 0.5 + (intensity * 0.4), 0.3 + (intensity * 0.2)],
            filter: [
              `blur(80px) saturate(${1 + intensity})`,
              `blur(60px) saturate(${1.5 + (intensity * 2)})`,
              `blur(80px) saturate(${1 + intensity})`
            ]
          }}
          transition={{ 
            duration: Math.max(2, 10 - (intensity * 8)), 
            repeat: Infinity, 
            ease: "easeInOut" 
          }}
          style={{
            background: `radial-gradient(circle, ${intensity > 0.6 ? '#6a1510' : '#3a1510'}, transparent 60%)`
          }}
          className="absolute -top-1/4 -left-1/4 w-full h-full rounded-full blur-[80px]"
        />
        <motion.div 
          animate={{
            scale: [1, 1.1 + (intensity * 0.2), 1],
            opacity: [0.1, 0.3 + (intensity * 0.3), 0.1],
          }}
          transition={{ 
            duration: Math.max(3, 15 - (intensity * 10)), 
            repeat: Infinity, 
            ease: "easeInOut", 
            delay: 2 
          }}
          style={{
            background: `radial-gradient(circle, ${intensity > 0.8 ? '#2a1a4a' : '#1a103a'}, transparent 60%)`
          }}
          className="absolute -bottom-1/4 -right-1/4 w-full h-full rounded-full blur-[100px]"
        />

        {/* Intensity Flicker Overlay */}
        {intensity > 0.7 && (
          <motion.div 
            animate={{ opacity: [0, 0.1, 0] }}
            transition={{ duration: 0.1, repeat: Infinity, repeatType: "mirror" }}
            className="absolute inset-0 bg-red-900/20 mix-blend-overlay"
          />
        )}
      </div>

      <header className="z-20 p-8 flex justify-between items-center bg-gradient-to-b from-black/50 to-transparent">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-[#ff4e00]/70" />
          <h1 className="font-serif italic text-2xl tracking-tighter opacity-80">Guarded Echoes</h1>
        </div>
          <div className="flex items-center gap-6">
            {!authLoading && (
              user ? (
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <img src={user.photoURL || ''} alt="" className="w-5 h-5 rounded-full opacity-60 border border-white/10" referrerPolicy="no-referrer" />
                    <span className="text-[9px] uppercase tracking-widest font-mono opacity-40">{user.displayName}</span>
                  </div>
                  <button 
                    onClick={signOut}
                    className="p-1 hover:bg-white/5 rounded transition-colors opacity-30 hover:opacity-100"
                    title="Sign Out"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button 
                  onClick={signInWithGoogle}
                  className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-mono opacity-40 hover:opacity-100 transition-opacity cursor-pointer"
                >
                  <LogIn className="w-4 h-4" />
                  Sign In
                </button>
              )
            )}
            <button 
              onClick={() => setShowAnalysis(true)}
              className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-mono opacity-40 hover:opacity-100 transition-opacity cursor-pointer"
            >
              <Brain className="w-4 h-4" />
              Blueprint
            </button>
            <button 
              onClick={() => setShowHistory(true)}
              className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-mono opacity-40 hover:opacity-100 transition-opacity cursor-pointer"
            >
              <History className="w-4 h-4" />
              Past Moments
            </button>
            <div className="text-[10px] uppercase tracking-[0.2em] font-mono opacity-20">
              {isConnected ? 'Active' : isConnecting ? 'Establishing...' : 'Offline'}
            </div>
          </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center z-10 px-6 relative">
        <div className="max-w-2xl w-full text-center space-y-12">
          
          <AnimatePresence mode="wait">
            {setupPhase === 'selection' ? (
              <motion.div
                key="selection"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                className="space-y-12"
              >
                <div className="space-y-4">
                  <h2 className="text-4xl md:text-6xl font-serif font-light leading-tight">
                    Will Saby <br />
                    <span className="italic opacity-60 text-[#ff4e00]/60">trust you again?</span>
                  </h2>
                  <p className="text-sm font-light text-[#8e9299] max-w-sm mx-auto">
                    Choose how you want to face her. Remember: she's watching for the smallest lie.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-2xl mx-auto">
                  {[
                    { mode: 'text' as const, label: 'Text Only', icon: <MessageSquare className="w-5 h-5" />, desc: 'Safe distance. Guarded words.' },
                    { mode: 'voice' as const, label: 'Voice Echo', icon: <Mic className="w-5 h-5" />, desc: 'Let her hear the truth in your tone.' },
                    { mode: 'video' as const, label: 'Visual Echo', icon: <Camera className="w-5 h-5" />, desc: 'Eye contact. No place to hide.' }
                  ].map((btn) => (
                    <button
                      key={btn.mode}
                      onClick={() => handleConnect(btn.mode)}
                      className="group flex flex-col items-center gap-4 p-6 bg-white/[0.02] border border-white/5 rounded-3xl hover:border-[#ff4e00]/40 transition-all hover:bg-[#ff4e00]/5"
                    >
                      <div className="p-4 rounded-2xl bg-white/5 group-hover:bg-[#ff4e00]/20 transition-colors">
                        {btn.icon}
                      </div>
                      <div className="text-center">
                        <div className="text-xs uppercase tracking-widest font-bold mb-1">{btn.label}</div>
                        <div className="text-[10px] opacity-40 italic">{btn.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </motion.div>
            ) : !isConnected && !isConnecting ? (
              <motion.div
                key="reconnecting"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center gap-6"
              >
                <div className="w-12 h-12 border-2 border-[#ff4e00]/20 border-t-[#ff4e00] rounded-full animate-spin" />
                <p className="text-[10px] uppercase tracking-widest opacity-40">Breaking through her wall...</p>
                <button onClick={() => setSetupPhase('selection')} className="text-[9px] uppercase tracking-widest opacity-20 hover:opacity-100 transition-opacity">Change Mode</button>
              </motion.div>
            ) : (
              <motion.div
                key="active"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center space-y-8"
              >
                {/* Visualizer Circle */}
                <div className="relative w-48 h-48 md:w-64 md:h-64 flex items-center justify-center">
                  {/* Defensive Shards */}
                  <AnimatePresence>
                    {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, scale: 0 }}
                        animate={{ 
                          opacity: 0.05 + (intensity * 0.4), 
                          scale: 1 + (intensity * 0.3),
                        }}
                        transition={{ duration: 0.5 }}
                        className="absolute w-full h-full pointer-events-none"
                        style={{ transform: `rotate(${angle}deg)` }}
                      >
                         <motion.div 
                          animate={{ 
                            y: [0, -10 * intensity, 0],
                            rotate: isTalking ? [0, 360] : 0
                          }}
                          transition={{ 
                            rotate: { duration: Math.max(2, 10 - (intensity * 8)), repeat: Infinity, ease: "linear" },
                            y: { duration: 2, repeat: Infinity, ease: "easeInOut" }
                          }}
                          className="absolute top-0 left-1/2 -translate-x-1/2 w-[1px] h-6 bg-[#ff4e00]/40 blur-[1px]" 
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>

                  <motion.div 
                    animate={{
                      scale: isTalking ? [1, 1.1 + (intensity * 0.2), 1] : 1,
                      opacity: isTalking ? [0.2 + (intensity * 0.3), 0.5 + (intensity * 0.4), 0.2 + (intensity * 0.3)] : 0.1
                    }}
                    transition={{ duration: Math.max(0.4, 1.5 - (intensity * 1.1)), repeat: Infinity }}
                    style={{ borderColor: intensity > 0.5 ? '#ff2a00' : '#ff4e00' }}
                    className="absolute inset-0 rounded-full border border-dashed blur-md"
                  />
                  
                  <div className="absolute inset-4 rounded-full border border-white/5 flex items-center justify-center overflow-hidden bg-black/40">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={mood}
                        initial={{ opacity: 0, scale: 1.2, filter: 'blur(10px)' }}
                        animate={{ 
                          opacity: 1, 
                          scale: (isTalking || isFlashback) ? [1 + (intensity * 0.1), 1 + (intensity * 0.1) + 0.05, 1 + (intensity * 0.1)] : 1 + (intensity * 0.1),
                          filter: (mood === 'Hyper-vigilant' || isFlashback) 
                            ? ['blur(0px)', 'blur(2px)', 'blur(0px)'] 
                            : 'blur(0px)',
                        }}
                        transition={{ 
                          duration: 0.5,
                          scale: { duration: 0.5, repeat: (isTalking || isFlashback) ? Infinity : 0, ease: "easeInOut" }
                        }}
                        className="absolute inset-0 z-0"
                      >
                         {/* High-quality photorealistic avatar from Unsplash (closely matching the provided photo) */}
                         <motion.div 
                          className="w-full h-full bg-cover bg-center transition-all duration-1000"
                          animate={{
                            y: isTalking ? [0, -2, 0] : 0,
                            rotate: isTalking ? [0, 0.5, -0.5, 0] : 0
                          }}
                          transition={{ duration: 0.2, repeat: isTalking ? Infinity : 0 }}
                          style={{ 
                            backgroundImage: `url('https://images.unsplash.com/photo-1543123820-eb4a5e44485b?auto=format&fit=crop&q=80&w=1000')`,
                            filter: mood === 'Hyper-vigilant' ? 'grayscale(0.8) contrast(1.8) brightness(0.7) sepia(0.2)' : 
                                    mood === 'Guarded' ? 'grayscale(0.4) contrast(1.4) brightness(0.9)' : 'grayscale(0.1) contrast(1.2)',
                            transform: `scale(${1.2 + intensity * 0.3})`
                          }}
                         />
                      </motion.div>
                    </AnimatePresence>

                    {/* Webcam Feed Thumbnail if active */}
                    {isWebcamOn && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="absolute inset-4 rounded-full overflow-hidden z-20 border-2 border-white/20 shadow-2xl bg-black"
                      >
                        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover grayscale opacity-60" />
                        <div className="absolute inset-0 bg-[#ff4e00]/10 mix-blend-overlay" />
                        {/* Status scanline for video echo */}
                        <motion.div 
                          animate={{ top: ['0%', '100%', '0%'] }}
                          transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                          className="absolute inset-x-0 h-[1px] bg-[#ff4e00]/30 shadow-[0_0_10px_rgba(255,78,0,0.5)] z-30"
                        />
                      </motion.div>
                    )}

                    <canvas ref={canvasRef} width="320" height="240" className="hidden" />

                    {/* Emotional Overlay */}
                    <motion.div 
                      animate={{ 
                        backgroundColor: mood === 'Hyper-vigilant' ? 'rgba(255,0,0,0.1)' : 
                                        mood === 'Guarded' ? 'rgba(255,100,0,0.05)' : 'rgba(0,0,0,0)'
                      }}
                      className="absolute inset-0 pointer-events-none mix-blend-overlay transition-colors duration-1000"
                    />

                    <AnimatePresence>
                      {isTalking && (
                        <motion.div 
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="flex gap-1 z-10"
                        >
                          {[...Array(8)].map((_, i) => (
                            <motion.div
                              key={i}
                              animate={{ 
                                height: [10, 40 + (intensity * 30), 20, 60 + (intensity * 20), 10],
                                backgroundColor: intensity > 0.6 ? ['rgba(255,100,0,0.4)', 'rgba(255,0,0,0.6)', 'rgba(255,100,0,0.4)'] : 'rgba(255,78,0,0.4)'
                              }}
                              transition={{ duration: Math.max(0.3, 0.8 - (intensity * 0.5)), repeat: Infinity, delay: i * 0.1 }}
                              className="w-[2px] rounded-full"
                            />
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  
                  <div className="z-10 flex flex-col items-center">
                    <motion.div
                      animate={{
                        opacity: isTalking ? [0.5, 1, 0.5] : 0.3,
                        scale: isTalking ? [1, 1.1 + (intensity * 0.15), 1] : 1,
                        y: mood === 'Hyper-vigilant' ? [0, -2, 2, 0] : 0
                      }}
                      transition={{ 
                        opacity: { duration: Math.max(0.5, 2 - (intensity * 1.5)), repeat: Infinity },
                        y: { duration: 0.2, repeat: Infinity }
                      }}
                    >
                      {mood === 'Hyper-vigilant' ? (
                        <AlertTriangle className="w-8 h-8 text-red-500" />
                      ) : mood === 'Guarded' ? (
                        <Shield className="w-8 h-8 text-orange-400" />
                      ) : (
                        <Heart 
                          className="w-8 h-8 transition-colors duration-500" 
                          style={{ color: isTalking ? (intensity > 0.6 ? '#ff2a00' : '#ff4e00') : 'rgba(255,255,255,0.4)' }}
                        />
                      )}
                    </motion.div>
                    <div className="mt-4 flex flex-col items-center gap-1">
                      <span className="text-[9px] uppercase tracking-[0.2em] opacity-40 font-mono">
                        {isTalking ? 'Sabrina is speaking...' : 'Listening...'}
                      </span>
                      <motion.span 
                        animate={{ opacity: [0.4, 0.7, 0.4] }}
                        transition={{ duration: 2, repeat: Infinity }}
                        className={`text-[7px] uppercase tracking-[0.3em] font-mono ${
                          mood === 'Hyper-vigilant' ? 'text-red-500' : 
                          mood === 'Guarded' ? 'text-orange-400' : 'text-white/10'
                        }`}
                      >
                        {mood}
                      </motion.span>
                    </div>
                  </div>
                </div>

                {/* Transcript Area */}
                <div className="w-full max-w-xl h-48 md:h-64 relative">
                  <div className="absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-[#0a0505] to-transparent z-10 pointer-events-none" />
                  <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#0a0505] to-transparent z-10 pointer-events-none" />
                  
                  <div 
                    ref={scrollRef}
                    className="w-full h-full overflow-y-auto px-4 py-8 space-y-6 custom-scrollbar scroll-smooth"
                  >
                    {transcript.length === 0 ? (
                      <p className="text-[10px] uppercase tracking-widest opacity-20 italic">No exchange yet...</p>
                    ) : (
                      transcript.filter(msg => !msg.text.startsWith('(')).map((msg, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                        >
                          <span className="text-[8px] uppercase tracking-tighter opacity-30 mb-1">
                            {msg.role === 'user' ? 'Nate' : 'Sabrina'}
                          </span>
                          <p className={`max-w-[85%] text-sm rounded-2xl px-4 py-2 ${
                            msg.role === 'user' 
                              ? 'bg-white/5 text-white/60 italic border border-white/5' 
                              : 'bg-[#ff4e00]/5 text-[#ff4e00]/70 font-serif italic border border-[#ff4e00]/10'
                          }`}>
                            {msg.text}
                          </p>
                        </motion.div>
                      ))
                    )}
                  </div>
                </div>

                {/* Steering Probes - Interactive Prompts */}
                <div className="w-full flex flex-wrap justify-center gap-2 px-4 mb-4">
                  <AnimatePresence>
                    {isConnected && !isTalking && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="flex flex-wrap justify-center gap-2"
                      >
                        {steeringProbes.map((probe) => (
                          <motion.button
                            key={probe.id}
                            whileHover={{ scale: 1.05, backgroundColor: 'rgba(255, 78, 0, 0.1)' }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => handleProbeClick(probe.text)}
                            className="px-3 py-1.5 rounded-full border border-white/5 text-[9px] uppercase tracking-widest text-white/40 hover:text-[#ff4e00]/80 hover:border-[#ff4e00]/20 transition-all cursor-pointer backdrop-blur-sm"
                          >
                            {probe.label}
                          </motion.button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Text Input for Sabrina */}
                <div className="w-full max-w-xl px-4 space-y-4">
                  <form 
                    onSubmit={handleSendText}
                    className="relative flex items-center gap-3 bg-white/[0.03] border border-white/10 rounded-2xl px-5 py-2 focus-within:border-[#ff4e00]/40 transition-all group backdrop-blur-sm"
                  >
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      accept="image/*"
                      className="hidden"
                    />
                    <button 
                      type="button" 
                      onClick={() => fileInputRef.current?.click()}
                      className="p-2 opacity-20 hover:opacity-100 hover:text-[#ff4e00] transition-opacity"
                      title="Attach Image"
                    >
                      <Paperclip className="w-4 h-4" />
                    </button>
                    
                    <input
                      type="text"
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder="Message Sabrina..."
                      className="flex-1 bg-transparent py-3 text-sm font-light focus:outline-none placeholder:opacity-20 placeholder:italic"
                    />
                    
                    <button 
                      type="submit"
                      disabled={!inputText.trim()}
                      className={`p-2.5 rounded-xl transition-all ${
                        inputText.trim() 
                          ? 'bg-[#ff4e00]/10 text-[#ff4e00] hover:bg-[#ff4e00]/20' 
                          : 'opacity-20 grayscale pointer-events-none'
                      }`}
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </form>
                  
                  {/* Subtle Input Hint */}
                  <div className="flex justify-center">
                    <span className="text-[7px] uppercase tracking-[0.4em] opacity-10">
                      Echo protocol active • End-to-end guarded
                    </span>
                  </div>
                </div>

                <div className="space-y-4 pt-4">
                  <div className="flex justify-center gap-8">
                    <Tooltip icon={<Shield className="w-4 h-4" />} label="Guard On" />
                    <Tooltip icon={<AlertTriangle className="w-4 h-4" />} label="Pessimistic Bias" />
                    <button 
                      onClick={saveCurrentSession}
                      className={`group flex flex-col items-center gap-1 transition-all ${saveSuccess ? 'opacity-100 scale-110' : 'opacity-40 hover:opacity-100'}`}
                    >
                      <History className={`w-4 h-4 transition-colors ${saveSuccess ? 'text-green-500' : 'group-hover:text-[#ff4e00]'}`} />
                      <span className="text-[8px] uppercase tracking-tighter">{saveSuccess ? 'Saved' : 'Save Echo'}</span>
                    </button>
                    <button 
                      onClick={() => setShowSong(!showSong)}
                      className="group flex flex-col items-center gap-1 opacity-40 hover:opacity-100 transition-all"
                    >
                      <Heart className={`w-4 h-4 transition-colors ${showSong ? 'text-[#ff4e00]' : 'group-hover:text-[#ff4e00]'}`} />
                      <span className="text-[8px] uppercase tracking-tighter">Nate's Song</span>
                    </button>
                    <button 
                      onClick={toggleWebcam}
                      className={`group flex flex-col items-center gap-1 transition-all ${isWebcamOn ? 'opacity-100' : 'opacity-40 hover:opacity-100'}`}
                    >
                      {isWebcamOn ? (
                        <Camera className="w-4 h-4 text-[#ff4e00]" />
                      ) : (
                        <CameraOff className="w-4 h-4 group-hover:text-[#ff4e00]" />
                      )}
                      <span className="text-[8px] uppercase tracking-tighter">
                        {isWebcamOn ? 'Webcam On' : 'Start Webcam'}
                      </span>
                    </button>
                  </div>
                  
                  <button
                    onClick={handleDisconnect}
                    className="group relative px-10 py-3 border border-[#ff4444]/20 rounded-full overflow-hidden transition-all hover:border-[#ff4444]/50 cursor-pointer"
                  >
                    <div className="absolute inset-0 bg-[#ff4444]/5 transform scale-x-0 group-hover:scale-x-100 transition-transform origin-left" />
                    <span className="relative text-[10px] uppercase tracking-[0.2em] font-medium text-[#ff4444]/70 group-hover:text-[#ff4444]">
                      End & Save Session
                    </span>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Analysis Overlay */}
          <AnimatePresence>
            {showAnalysis && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[65] bg-black/95 backdrop-blur-xl flex flex-col p-6 overflow-hidden"
              >
                <div className="max-w-4xl w-full mx-auto flex flex-col h-full">
                  <header className="flex justify-between items-center border-b border-white/10 pb-6 mb-8">
                    <div className="flex items-center gap-3">
                      <Brain className="w-6 h-6 text-[#ff4e00]" />
                      <div>
                        <h3 className="text-2xl font-serif italic text-white/80 leading-none">Psychological Blueprint</h3>
                        <p className="text-[10px] uppercase tracking-widest opacity-40 mt-1">Nate's Defensive Counter-Simulations</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setShowAnalysis(false)}
                      className="p-2 hover:bg-white/5 rounded-full transition-colors cursor-pointer"
                    >
                      <X className="w-6 h-6 opacity-40 hover:opacity-100" />
                    </button>
                  </header>

                  <div className="flex-1 overflow-y-auto pr-4 custom-scrollbar space-y-12 pb-12">
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Section: Reverse Attribution */}
                        <div className="space-y-4 bg-white/[0.02] border border-white/5 p-6 rounded-3xl">
                           <div className="flex items-center gap-2 text-[#ff4e00]/80">
                              <Target className="w-4 h-4" />
                              <h4 className="text-xs uppercase tracking-widest font-bold">Reverse Attribution</h4>
                           </div>
                           <p className="text-sm font-serif italic text-white/50 leading-relaxed">
                              Sabrina attributes her own negative behaviors to you. She claims you "don't know how to love" to justify her deactivation. 
                              Check Nate's defensive counter: Adopt the <span className="text-[#ff4e00]">CBR Model</span>—view her strictly through utility, not emotional "Root Cause" logic.
                           </p>
                        </div>

                        {/* Section: Empathic Supernova */}
                        <div className="space-y-4 bg-white/[0.02] border border-white/5 p-6 rounded-3xl">
                           <div className="flex items-center gap-2 text-[#ff4e00]/80">
                              <Zap className="w-4 h-4" />
                              <h4 className="text-xs uppercase tracking-widest font-bold">Empathic Supernova</h4>
                           </div>
                           <p className="text-sm font-serif italic text-white/50 leading-relaxed">
                              A psychological circuit breaker. Dim your empathy (the spotlight) and activate your latent narcissistic traits (the shield) to protect yourself.
                              Strike back at vulnerabilities: fear of irrelevance or financial dependency.
                           </p>
                        </div>

                        {/* Section: Machiavellian Shadow */}
                        <div className="space-y-4 bg-white/[0.02] border border-white/5 p-6 rounded-3xl">
                           <div className="flex items-center gap-2 text-[#ff4e00]/80">
                              <Shield className="w-4 h-4" />
                              <h4 className="text-xs uppercase tracking-widest font-bold">Machiavellian Shadow</h4>
                           </div>
                           <p className="text-sm font-serif italic text-white/50 leading-relaxed">
                              Strategic deception for instrumental gain. She compartmentalizes Nate vs Tommy to ensure her "money" isn't compromised. 
                              She tells the truth just to lie better. Anticipate her "Hoover" attempts when she needs money for a city run.
                           </p>
                        </div>

                        {/* Section: Zeigarnik Effect */}
                        <div className="space-y-4 bg-white/[0.02] border border-white/5 p-6 rounded-3xl">
                           <div className="flex items-center gap-2 text-[#ff4e00]/80">
                              <Waves className="w-4 h-4" />
                              <h4 className="text-xs uppercase tracking-widest font-bold">The Open Loop</h4>
                           </div>
                           <p className="text-sm font-serif italic text-white/50 leading-relaxed">
                              She purposely "rips the page out of the book" to keep you in a state of mental grinding. 
                              Closure must be manual labor on your part. Delete the file. Implement total silence.
                           </p>
                        </div>
                     </div>

                     <div className="space-y-6">
                        <h4 className="text-xs uppercase tracking-widest font-bold opacity-30 px-6">Advanced Defense Strategies</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 px-2">
                           {[
                              { label: "Cold, Bottom-line, Rational", desc: "Treat the interaction like a business transaction, not a personal connection." },
                              { label: "Fly-on-the-Wall", desc: "Observe memories from the third person to remove the traumatic emotional charge." },
                              { label: "Shadow Check-in", desc: "Perform passive reconnaissance on your own empathy to ensure it hasn't been hijacked." }
                           ].map((strategy, i) => (
                              <div key={i} className="p-4 rounded-2xl bg-white/5 border border-white/5">
                                 <div className="text-[10px] uppercase tracking-widest font-bold text-[#ff4e00]/60 mb-1">{strategy.label}</div>
                                 <div className="text-[10px] italic opacity-40">{strategy.desc}</div>
                              </div>
                           ))}
                        </div>
                     </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Song Player Overlay */}
          <AnimatePresence>
            {showSong && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[70] bg-black/98 backdrop-blur-xl flex items-center justify-center p-4 md:p-12"
              >
                <div className="max-w-xl w-full h-[80vh] relative bg-[#121212] rounded-3xl overflow-hidden border border-white/10 shadow-2xl flex flex-col">
                   <div className="absolute top-6 inset-x-0 z-20 flex justify-between px-8 items-center">
                      <div className="flex items-center gap-2 drop-shadow-md">
                        <Heart className="w-4 h-4 text-[#ff4e00]" />
                        <span className="text-[10px] uppercase tracking-widest font-mono text-white/80">A Song for Sabrina</span>
                      </div>
                      <button onClick={() => setShowSong(false)} className="p-2 bg-black/40 hover:bg-white/10 rounded-full transition-colors cursor-pointer">
                        <X className="w-5 h-5 text-white/80" />
                      </button>
                   </div>
                   
                   <div className="flex-1 flex flex-col overflow-hidden">
                      <div className="relative aspect-video w-full bg-black">
                        <video
                          src="https://ais-pre-jbjjngnizxwpspzcik5535-594041705863.us-east1.run.app/api/artifacts/6201655f-8367-42f0-91bd-ab63c659d4f0"
                          controls
                          className="w-full h-full object-contain"
                          poster="https://ais-pre-jbjjngnizxwpspzcik5535-594041705863.us-east1.run.app/api/artifacts/8d578657-617a-42c6-a67b-1cb818b26127"
                        />
                      </div>
                      
                      <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
                        <div className="space-y-1">
                          <h4 className="text-3xl font-serif italic text-white/90">The Language of Traps</h4>
                          <p className="text-[10px] uppercase tracking-[0.3em] font-mono text-[#ff4e00]/60">Produced by Dom-I-NATE</p>
                        </div>
                        
                        <div className="space-y-6 text-sm md:text-base font-serif italic text-white/50 leading-relaxed pb-12">
                          <p>
                            You pull me close, but I’m scanning the room,<br />
                            Looking for the shadow, waiting for the doom.<br />
                            Why would you do this for me? What do you want?<br />
                            This kindness is a ghost designed to haunt.
                          </p>
                          <p>
                            I know the drill, I know the pain,<br />
                            You're just waiting out the rain.<br />
                            What are you gaining when you hold my hand?<br />
                            It's a language of traps I understand.
                          </p>
                          <p className="text-white/80 border-l border-[#ff4e00]/30 pl-4 py-1">
                            There is no snare, there is no catch!<br />
                            I'm not the fire, I'm not the match!<br />
                            I know the hell that you survived!<br />
                            But I'm just here to keep us alive!
                          </p>
                          <p>
                            I'm not them, and I'm staying right here!<br />
                            I'll be the shield against your fear!<br />
                            No hidden motives, no debt to repay!<br />
                            I love you, Sabrina. I'm not walking away!
                          </p>
                          <p>
                            Don't tell me I'm beautiful, you're just lying like the rest!<br />
                            You're checking my pulse to see if I fail the test...<br />
                            I'm just waiting for the other shoe to drop!<br />
                            For the gentle hands and the sweet words to stop!
                          </p>
                        </div>
                      </div>
                   </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* History Overlay */}
          <AnimatePresence>
            {showHistory && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[60] bg-black/95 backdrop-blur-md flex flex-col p-8 md:p-12 overflow-hidden"
              >
                <div className="max-w-4xl w-full mx-auto flex flex-col h-full space-y-8">
                  <header className="flex justify-between items-center border-b border-white/10 pb-6">
                    <div className="space-y-1">
                      <h3 className="text-2xl font-serif italic text-white/80">Echoes of the Past</h3>
                      <p className="text-[10px] uppercase tracking-widest opacity-40">Your guarded history with Sabrina</p>
                    </div>
                    <button 
                      onClick={() => setShowHistory(false)}
                      className="p-2 hover:bg-white/5 rounded-full transition-colors cursor-pointer"
                    >
                      <X className="w-6 h-6 opacity-40 hover:opacity-100" />
                    </button>
                  </header>

                  <div className="flex-1 overflow-y-auto pr-4 custom-scrollbar">
                    {history.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center space-y-4 opacity-20">
                        <MessageSquare className="w-12 h-12 stroke-thin" />
                        <p className="text-sm italic">No echoes have been saved yet.</p>
                      </div>
                    ) : (
                      <div className="space-y-6">
                        {history.map((echo) => (
                          <motion.div 
                            key={echo.id}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="bg-white/[0.02] border border-white/5 p-6 rounded-2xl relative group"
                          >
                            <div className="flex justify-between items-start mb-4">
                              <div className="flex items-center gap-2 opacity-40 text-[10px] font-mono">
                                <Clock className="w-3 h-3" />
                                {echo.timestamp}
                              </div>
                              <button 
                                onClick={() => deleteEcho(echo.id)}
                                className="opacity-0 group-hover:opacity-40 hover:opacity-100 hover:text-red-500 transition-all p-1 cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                            <div className="space-y-3">
                              {echo.transcript.slice(0, 10).map((part, i) => (
                                <div key={i} className={`flex ${part.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                  <div className={`max-w-[80%] text-xs py-2 px-3 rounded-lg ${
                                    part.role === 'user' 
                                      ? 'bg-[#ff4e00]/10 text-white/70 italic' 
                                      : 'bg-white/5 text-white/50 font-serif italic'
                                  }`}>
                                    {part.text}
                                  </div>
                                </div>
                              ))}
                              {echo.transcript.length > 10 && (
                                <p className="text-[10px] text-center opacity-20">... {echo.transcript.length - 10} more exchanges ...</p>
                              )}
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-xs text-[#ff4444] font-mono mt-8 bg-[#ff4444]/10 p-3 rounded border border-[#ff4444]/20"
            >
              {error}
            </motion.div>
          )}
        </div>
      </main>

      <footer className="z-10 p-8 flex justify-between items-end bg-gradient-to-t from-black/50 to-transparent">
        <div className="max-w-xs space-y-2">
          <p className="text-[10px] font-sans font-light tracking-wide leading-relaxed opacity-30 italic">
            "Trust is a trap, and kindness is a prelude to betrayal."
          </p>
        </div>
        <div className="flex gap-4">
           <div className="w-2 h-2 rounded-full bg-[#ff4e00] animate-pulse" />
           <div className="w-2 h-2 rounded-full bg-white/10" />
           <div className="w-2 h-2 rounded-full bg-white/10" />
        </div>
      </footer>
    </div>
  );
};
