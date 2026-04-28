import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useParams } from "wouter";
import { apiUrl, apiFetch } from "@/lib/api";
import { Logo } from "../components/Logo";

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase =
  | "loading"
  | "waiting"
  | "permissions"
  | "camera-starting"
  | "greeting"
  | "listening"
  | "thinking"
  | "speaking"
  | "submitting"
  | "complete"
  | "resume"
  | "completed-already"
  | "expired"
  | "cancelled"
  | "rejected"
  | "error";

interface InterviewData {
  id: number;
  access?: string;
  candidateName: string;
  jobTitle: string;
  jobDescription: string;
  recruiterName: string;
  candidateEmail: string;
  scheduledAt: string | null;
  durationMinutes: number | null;
  timezone: string | null;
  status?: string;
  conversationState?: ConversationEntry[] | null;
  elapsedSeconds?: number;
  interviewStartedAt?: string | null;
  hasActiveSession?: boolean;
  minutesUntil?: number;
  message?: string;
  persona?: string | null;
  personaName?: string | null;
}

interface ConversationEntry {
  role: "ai" | "candidate";
  text: string;
}

interface ConversationApiResponse {
  nextQuestion: string;
  isComplete: boolean;
  topicArea: string;
}

// ─── Persona Configs (client-side display only) ───────────────────────────────

const CLIENT_PERSONAS = {
  technical: {
    name: 'Priya',
    title: 'Senior Technical Interviewer',
    avatarColor: '#6366F1',
    avatarInitial: 'P',
    greeting: 'Hi there! I am Priya, your interviewer today from AccionHire. It is wonderful to meet you! I want this to feel like a real technical conversation — so please be yourself. There are no trick questions here, just genuine curiosity about how you think and what you have built. To kick us off — tell me about yourself and what you are most proud of in your technical journey so far.',
  },
  hr: {
    name: 'Meera',
    title: 'People & Culture Specialist',
    avatarColor: '#0D9488',
    avatarInitial: 'M',
    greeting: 'Hello! I am Meera from AccionHire, and I am so glad you could join us today. I want you to feel completely comfortable — this is just a friendly conversation to get to know you better as a person. No pressure at all. So let us start easy — tell me a little about yourself and what has brought you to this point in your career.',
  },
  leadership: {
    name: 'Arjun',
    title: 'Senior Leadership Assessor',
    avatarColor: '#1E3A5F',
    avatarInitial: 'A',
    greeting: 'Good day! I am Arjun from AccionHire. I appreciate you making the time. I like to keep these conversations direct and substantive — I find that is most respectful of your time. I am looking forward to understanding your leadership philosophy and how you think about building and scaling teams. So tell me — what has been your most significant leadership achievement and what made it challenging?',
  },
  sales: {
    name: 'Kavya',
    title: 'Business Excellence Interviewer',
    avatarColor: '#EA580C',
    avatarInitial: 'K',
    greeting: 'Hey! I am Kavya from AccionHire — great to connect! I love talking to sales and business folks because every conversation is different. I want to hear about your wins, your challenges, and how you think about building client relationships. So let us dive right in — tell me about your proudest business development moment and what drove that success.',
  },
} as const;

type ClientPersonaKey = keyof typeof CLIENT_PERSONAS;

// ─── Constants ────────────────────────────────────────────────────────────────

const API_BASE = `${apiUrl}/api`;

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function topicLabel(area: string): string {
  const labels: Record<string, string> = {
    introduction: "Introduction",
    technical: "Technical",
    problemSolving: "Problem Solving",
    behavioral: "Behavioral",
    situational: "Situational",
    wrapup: "Wrap Up",
  };
  return labels[area] ?? area;
}

// ─── Speaking Bars ────────────────────────────────────────────────────────────

function SpeakingBars({ color = "bg-blue-400" }: { color?: string }) {
  return (
    <div className="flex items-center gap-0.5">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={`w-0.5 rounded-full animate-pulse ${color}`}
          style={{ height: `${6 + i * 3}px`, animationDelay: `${i * 0.1}s`, animationDuration: "0.6s" }}
        />
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function VoiceInterview() {
  const [, navigate] = useLocation();
  const params = useParams<{ id?: string; token?: string }>();
  const urlToken = params.token ?? null;
  const urlId = params.id ? Number(params.id) : null;

  // ── Browser / device detection (EDGE 1) ──────────────────────────────────
  const isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
  const isMobile = /Android|iPhone|iPad/.test(navigator.userAgent);
  const [browserWarningDismissed, setBrowserWarningDismissed] = useState(false);

  // ── State ─────────────────────────────────────────────────────────────────
  const [hasConsented, setHasConsented] = useState(false);
  const [phase, setPhase] = useState<Phase>("loading");
  const [interview, setInterview] = useState<InterviewData | null>(null);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [aiMessage, setAiMessage] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [conversationHistory, setConversationHistory] = useState<ConversationEntry[]>([]);
  const [topicArea, setTopicArea] = useState("introduction");
  const [errorMsg, setErrorMsg] = useState("");
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [waitingSecondsLeft, setWaitingSecondsLeft] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "done" | "failed">("idle");
  const [recordingChunkCount, setRecordingChunkCount] = useState(0);
  const [cameraOff, setCameraOff] = useState(false);
  const [cameraWarnings, setCameraWarnings] = useState(0);
  const [cameraCountdown, setCameraCountdown] = useState(60);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isFetchingTTS, setIsFetchingTTS] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [showQuestion, setShowQuestion] = useState(false);
  const [activityBadgeVisible, setActivityBadgeVisible] = useState(false);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const phaseRef = useRef<Phase>("loading");
  const conversationRef = useRef<ConversationEntry[]>([]);
  const elapsedSecondsRef = useRef(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const interviewRef = useRef<InterviewData | null>(null);
  const interviewIdRef = useRef<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const isRecordingRef = useRef(false);
  const cameraCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cameraOffRef = useRef(false);
  const cameraWarningsRef = useRef(0);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const faceDetectionRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const noFaceCountRef = useRef(0);
  const faceWarningRef = useRef(false);
  const faceViolationsRef = useRef(0);
  const [faceWarning, setFaceWarning] = useState(false);
  const [faceViolationCount, setFaceViolationCount] = useState(0);

  // Proctoring refs
  const tabSwitchCountRef = useRef(0);
  const windowBlurRef = useRef(0);
  const gazeAnomalyRef = useRef(0);
  const multiPersonCountRef = useRef(0);
  const suspiciousRef = useRef<string[]>([]);
  const gazeWarnedRef = useRef(false);
  const multiPersonWarnedRef = useRef(false);
  const gazeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const multiplePersonIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gazeConsecutiveRef = useRef(0);
  const autoSaveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastAnswerTimeRef = useRef<number>(Date.now());
  const silenceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSpeakingRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastFaceWarnRef = useRef(0);
  const isProcessingRef = useRef(false);

  // RAG — resume upload
  const [resumeUploaded, setResumeUploaded] = useState(false);

  // ── Sync helpers ──────────────────────────────────────────────────────────
  const setPhaseSync = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const addToConversation = useCallback((entry: ConversationEntry) => {
    const next = [...conversationRef.current, entry];
    conversationRef.current = next;
    setConversationHistory([...next]);
  }, []);

  // Silent proctoring log — never interrupts interview
  function logSuspicious(event: string) {
    suspiciousRef.current.push(event);
    setActivityBadgeVisible(true);
    setTimeout(() => setActivityBadgeVisible(false), 2000);
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!urlToken && (!urlId || isNaN(urlId))) {
      setErrorMsg("Invalid interview URL. Please check the link provided to you.");
      setPhaseSync("error");
      return;
    }
    loadInterview();
    return () => cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Schedule helpers ─────────────────────────────────────────────────────

  function secondsUntilActive(scheduledAt: string): number {
    const activateMs = new Date(scheduledAt).getTime() - 10 * 60 * 1000;
    return Math.max(0, Math.floor((activateMs - Date.now()) / 1000));
  }

  function formatCountdown(secs: number): string {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function formatScheduledDateTime(isoString: string): { date: string; time: string } {
    const d = new Date(isoString);
    return {
      date: d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
      time: d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
    };
  }

  // ─── Waiting countdown ────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "waiting") return;
    const iv = interviewRef.current;
    if (!iv?.scheduledAt) return;

    const tick = () => {
      const secs = secondsUntilActive(iv.scheduledAt!);
      setWaitingSecondsLeft(secs);
      if (secs === 0) setPhaseSync("permissions");
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ─── Load interview ───────────────────────────────────────────────────────
  async function loadInterview() {
    try {
      let data: InterviewData;

      if (urlToken) {
        const res = await fetch(`${API_BASE}/interviews/token/${urlToken}`);
        if (!res.ok) throw new Error("Interview not found");
        const raw = (await res.json()) as InterviewData;

        switch (raw.access) {
          case "cancelled":
            setPhaseSync("cancelled");
            return;
          case "completed":
            setPhaseSync("completed-already");
            return;
          case "expired":
            setPhaseSync("expired");
            return;
          case "waiting":
            setInterview(raw);
            interviewRef.current = raw;
            interviewIdRef.current = raw.id;
            setWaitingSecondsLeft(secondsUntilActive(raw.scheduledAt!));
            setPhaseSync("waiting");
            return;
          default:
            data = raw;
        }
      } else {
        const res = await fetch(`${API_BASE}/livekit/interview/${urlId}`);
        if (!res.ok) throw new Error("Interview not found");
        data = (await res.json()) as InterviewData;
      }

      setInterview(data);
      interviewRef.current = data;
      interviewIdRef.current = data.id;

      // Resume after disconnect — existing session detected
      const hasSession =
        data.hasActiveSession &&
        data.conversationState &&
        data.conversationState.length > 0 &&
        (data.elapsedSeconds ?? 0) > 60;

      if (hasSession) {
        setPhaseSync("resume");
      } else if (data.scheduledAt && secondsUntilActive(data.scheduledAt) > 0) {
        setWaitingSecondsLeft(secondsUntilActive(data.scheduledAt));
        setPhaseSync("waiting");
      } else {
        setPhaseSync("permissions");
      }
    } catch {
      setErrorMsg("Failed to load interview. Please check the link and try again.");
      setPhaseSync("error");
    }
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────
  function cleanup() {
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    if (cameraCheckRef.current) clearInterval(cameraCheckRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (faceDetectionRef.current) clearInterval(faceDetectionRef.current);
    if (gazeIntervalRef.current) clearInterval(gazeIntervalRef.current);
    if (multiplePersonIntervalRef.current) clearInterval(multiplePersonIntervalRef.current);
    if (autoSaveIntervalRef.current) clearInterval(autoSaveIntervalRef.current);
    if (silenceIntervalRef.current) clearInterval(silenceIntervalRef.current);
    stopAudioRecorderInternal();
    stopCameraInternal();
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    window.speechSynthesis.cancel();
  }

  // ─── Camera ──────────────────────────────────────────────────────────────
  async function initCamera(retries = 3): Promise<boolean> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }

        if (attempt > 1) {
          await new Promise((r) => setTimeout(r, 1000));
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: "user",
            aspectRatio: { ideal: 16 / 9 },
          },
          audio: true,
        });

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        setIsCameraReady(true);

        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.onended = () => {
            console.log("Camera track ended unexpectedly");
            setCameraError("Camera disconnected. Click Try Again to reconnect.");
            clearInterval(faceDetectionRef.current!);
            speak("I notice your camera has disconnected. Please reconnect your camera to continue.");
          };
        }

        console.log(`Camera started on attempt ${attempt}`);
        return true;
      } catch (err: unknown) {
        const domErr = err as { name?: string };
        console.error(`Camera attempt ${attempt} failed:`, err);
        setIsCameraReady(false);

        if (attempt === retries) {
          if (domErr?.name === "NotAllowedError") {
            setCameraError("Camera permission denied. Please allow camera access and refresh.");
          } else if (domErr?.name === "NotFoundError") {
            setCameraError("No camera found. Please connect a camera.");
          } else {
            setCameraError("Camera unavailable. Please check your camera and try again.");
          }
          return false;
        }
      }
    }
    return false;
  }

  function stopCameraInternal() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsCameraReady(false);
  }

  // ─── Elapsed timer ────────────────────────────────────────────────────────
  function startElapsedTimer() {
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = setInterval(() => {
      setElapsedSeconds((prev) => {
        const next = prev + 1;
        elapsedSecondsRef.current = next;
        return next;
      });
    }, 1000);
  }

  // ─── Voice cache ──────────────────────────────────────────────────────────
  useEffect(() => {
    const load = () => {
      const v = window.speechSynthesis.getVoices();
      if (v.length > 0) voicesRef.current = v;
    };
    load();
    window.speechSynthesis.onvoiceschanged = () => { window.speechSynthesis.getVoices(); load(); };
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  // ─── Proctoring event listeners ──────────────────────────────────────────
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && phaseRef.current !== "complete" && phaseRef.current !== "submitting" && phaseRef.current !== "rejected") {
        tabSwitchCountRef.current++;
        logSuspicious(`Tab switch #${tabSwitchCountRef.current}`);
        // Only warn on 3rd switch — single or double is not suspicious
        if (tabSwitchCountRef.current === 3) {
          speak("Please keep this interview window active throughout the interview.");
        }
      }
    };
    const onBlur = () => {
      if (phaseRef.current !== "complete" && phaseRef.current !== "submitting" && phaseRef.current !== "rejected") {
        windowBlurRef.current++;
        // Log silently — window blur alone is not a violation
        suspiciousRef.current.push("Window lost focus");
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Silence detection (EDGE 3) ──────────────────────────────────────────
  useEffect(() => {
    const activePhases: Phase[] = ["greeting", "listening", "thinking", "speaking"];
    if (!activePhases.includes(phase as Phase)) return;

    if (silenceIntervalRef.current) clearInterval(silenceIntervalRef.current);

    silenceIntervalRef.current = setInterval(() => {
      const currentPhase = phaseRef.current;
      if (!activePhases.includes(currentPhase as Phase)) return;
      if (currentPhase === "speaking" || currentPhase === "greeting") return;

      const silentFor = Date.now() - lastAnswerTimeRef.current;

      if (silentFor > 300000) {
        clearInterval(silenceIntervalRef.current!);
        speak("It seems you may have stepped away. I will save your progress. You can rejoin using the same link.").then(() => {
          setPhaseSync("complete");
        });
        return;
      }

      if (silentFor > 120000) {
        lastAnswerTimeRef.current = Date.now();
        speak("Are you still there? Take your time — just let me know when you are ready to continue.");
      }
    }, 30000);

    return () => {
      if (silenceIntervalRef.current) clearInterval(silenceIntervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ─── Beforeunload warning during active interview (EDGE 5) ───────────────
  useEffect(() => {
    const activePhases: Phase[] = ["greeting", "listening", "thinking", "speaking"];
    if (!activePhases.includes(phase as Phase)) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Your interview is in progress. Are you sure you want to leave? Your progress is saved.";
      return e.returnValue;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [phase]);

  function getPersonaVoiceId(): string {
    const persona = interviewRef.current?.persona ?? 'technical';
    const voiceMap: Record<string, string> = {
      technical: 'MwUMLXurEzSN7bIfIdXF',  // Tripti — Priya
      hr:        'MwUMLXurEzSN7bIfIdXF',  // Tripti — Meera
      leadership:'wJ5MX7uuKXZwFqGdWM4N', // Raj    — Arjun
      sales:     'MwUMLXurEzSN7bIfIdXF',  // Tripti — Kavya
    };
    return voiceMap[persona] ?? 'MwUMLXurEzSN7bIfIdXF';
  }

  function speakFallback(text: string, resolve: () => void): void {
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = voicesRef.current.length > 0
      ? voicesRef.current
      : window.speechSynthesis.getVoices();
    const voice =
      voices.find(v => v.name.includes('Heera')) ||
      voices.find(v => v.name.includes('Neerja')) ||
      voices.find(v => v.lang === 'en-IN') ||
      voices.find(v => v.lang.startsWith('en')) ||
      null;
    if (voice) utterance.voice = voice;
    utterance.rate = 1.1;
    utterance.pitch = 1.2;
    utterance.lang = 'en-IN';
    utterance.onend  = () => { isSpeakingRef.current = false; setTimeout(resolve, 300); };
    utterance.onerror = () => { isSpeakingRef.current = false; setTimeout(resolve, 300); };
    window.speechSynthesis.speak(utterance);
  }

  function speak(text: string, delayMs = 0): Promise<void> {
    return new Promise<void>((resolve) => {
      window.speechSynthesis.cancel();
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
      isSpeakingRef.current = true;

      const doSpeak = async () => {
        try {
          const voiceId = getPersonaVoiceId();
          setIsFetchingTTS(true);
          const response = await fetch(`${API_BASE}/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text.substring(0, 1000), voiceId }),
          });
          setIsFetchingTTS(false);

          if (!response.ok) throw new Error('TTS API failed');

          const audioBlob = await response.blob();
          const audioUrl = URL.createObjectURL(audioBlob);
          const audio = new Audio(audioUrl);
          currentAudioRef.current = audio;

          audio.onended = () => {
            URL.revokeObjectURL(audioUrl);
            currentAudioRef.current = null;
            isSpeakingRef.current = false;
            setTimeout(resolve, 300);
          };
          audio.onerror = () => {
            URL.revokeObjectURL(audioUrl);
            currentAudioRef.current = null;
            isSpeakingRef.current = false;
            speakFallback(text, resolve);
          };

          await audio.play();
        } catch (err) {
          console.error('ElevenLabs speak error:', err);
          setIsFetchingTTS(false);
          speakFallback(text, resolve);
        }
      };

      if (delayMs > 0) {
        setTimeout(doSpeak, delayMs);
      } else {
        doSpeak();
      }
    });
  }

  // ─── Whisper Audio Recording ──────────────────────────────────────────────

  function stopAudioRecorderInternal() {
    if (audioRecorderRef.current && audioRecorderRef.current.state !== "inactive") {
      try { audioRecorderRef.current.stop(); } catch { /* ignore */ }
    }
    isRecordingRef.current = false;
  }

  function startListening() {
    if (!streamRef.current) return;
    // Don't start capturing while AI is speaking
    const p = phaseRef.current;
    if (p === "speaking" || p === "greeting" || p === "thinking") return;

    // Stop any existing recorder before creating a fresh one
    if (audioRecorderRef.current && audioRecorderRef.current.state !== "inactive") {
      try { audioRecorderRef.current.stop(); } catch { /* ignore */ }
    }

    audioChunksRef.current = [];
    isRecordingRef.current = true;
    setLiveTranscript("");

    const audioStream = new MediaStream(streamRef.current.getAudioTracks());
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    const recorder = new MediaRecorder(audioStream, { mimeType });
    recorder.ondataavailable = (e) => {
      // Only collect chunks when AI is NOT speaking
      if (e.data.size > 0 && !isSpeakingRef.current) {
        audioChunksRef.current.push(e.data);
      }
    };
    audioRecorderRef.current = recorder;
    recorder.start(500);
  }

  async function stopAndTranscribe(): Promise<string> {
    if (!audioRecorderRef.current || !isRecordingRef.current) return "";

    isRecordingRef.current = false;
    setLiveTranscript("Transcribing...");

    return new Promise((resolve) => {
      audioRecorderRef.current!.onstop = async () => {
        try {
          // Empty chunks = AI was speaking the entire time, nothing to transcribe
          if (audioChunksRef.current.length === 0) {
            setLiveTranscript("Nothing captured — please try again");
            setTimeout(() => {
              setLiveTranscript("");
              startListening();
            }, 1000);
            resolve("");
            return;
          }

          const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });

          if (blob.size < 500) {
            setLiveTranscript("Nothing captured — please try again");
            setTimeout(() => {
              setLiveTranscript("");
              startListening();
            }, 1000);
            resolve("");
            return;
          }

          const formData = new FormData();
          formData.append("audio", blob, "recording.webm");

          const res = await fetch(`${API_BASE}/transcribe`, {
            method: "POST",
            body: formData,
          });
          const data = (await res.json()) as { transcript?: string };
          const transcript = data.transcript ?? "";
          setLiveTranscript(transcript);
          resolve(transcript);
        } catch {
          setLiveTranscript("");
          resolve("");
        }
      };
      audioRecorderRef.current!.stop();
    });
  }

  // ─── Video Recording ──────────────────────────────────────────────────────
  function startRecording() {
    if (!streamRef.current) return;
    recordingChunksRef.current = [];

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : "video/webm";

    try {
      const recorder = new MediaRecorder(streamRef.current, { mimeType });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          recordingChunksRef.current.push(e.data);
          setRecordingChunkCount((n) => n + 1);
        }
      };
      recorder.start(1000);
      mediaRecorderRef.current = recorder;
    } catch (err) {
      console.warn("[recording] MediaRecorder failed to start:", err);
    }
  }

  async function uploadRecording(id: number): Promise<void> {
    const chunks = recordingChunksRef.current;
    if (chunks.length === 0) return;

    const blob = new Blob(chunks, { type: "video/webm" });
    const sizeMB = blob.size / (1024 * 1024);

    if (sizeMB > 500) {
      console.warn("[recording] File too large:", sizeMB.toFixed(1), "MB — skipping");
      setUploadStatus("failed");
      return;
    }

    setUploadStatus("uploading");

    try {
      const formData = new FormData();
      formData.append("recording", blob, `interview-${id}.webm`);

      const res = await fetch(`${API_BASE}/interviews/${id}/upload-recording`, {
        method: "POST",
        body: formData,
      });
      setUploadStatus(res.ok ? "done" : "failed");
    } catch (err) {
      console.warn("[recording] Upload failed:", err);
      setUploadStatus("failed");
    }
  }

  // ─── Camera Monitoring ────────────────────────────────────────────────────

  function startCameraMonitoring() {
    cameraCheckRef.current = setInterval(() => {
      const track = streamRef.current?.getVideoTracks()[0];
      // Only trigger on hardware disconnect — not on track.enabled toggle
      if (!track || track.readyState === "ended") {
        if (!cameraOffRef.current) handleCameraOff();
      }
    }, 5000);
  }

  function handleCameraOff() {
    cameraOffRef.current = true;
    setCameraOff(true);
    window.speechSynthesis.cancel();

    cameraWarningsRef.current += 1;
    const warnings = cameraWarningsRef.current;
    setCameraWarnings(warnings);

    if (warnings >= 3) {
      handleRejected();
      return;
    }

    speak(
      "I notice your camera seems to have turned off. Please turn it back on when you are ready. You have 60 seconds."
    );

    setCameraCountdown(60);
    countdownRef.current = setInterval(() => {
      setCameraCountdown((p) => {
        if (p <= 1) {
          clearInterval(countdownRef.current!);
          handleRejected();
          return 0;
        }
        return p - 1;
      });
    }, 1000);
  }

  function handleCameraBack() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || track.readyState === "ended") return;
    clearInterval(countdownRef.current!);
    cameraOffRef.current = false;
    setCameraOff(false);
    speak("Thank you for turning your camera back on. Let us continue.");
  }

  function startFaceDetection() {
    faceDetectionRef.current = setInterval(() => {
      if (!videoRef.current) return;

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      canvas.width = 320;
      canvas.height = 240;
      ctx.drawImage(videoRef.current, 0, 0, 320, 240);
      const imageData = ctx.getImageData(0, 0, 320, 240);
      const data = imageData.data;

      let skinPixels = 0;
      let darkPixels = 0;
      let totalPixels = 0;

      for (let y = 40; y < 200; y++) {
        for (let x = 60; x < 260; x++) {
          const idx = (y * 320 + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const brightness = (r + g + b) / 3;

          totalPixels++;
          if (brightness < 30) darkPixels++;

          // Inclusive skin detection: handles glasses, lighting, skin tone variation
          const isSkin =
            (r > 60 && g > 35 && b > 15 && r > g && r - b > 8) ||
            (r > 40 && g > 25 && b > 10 && r > b && r >= g * 0.7) ||
            (r > 80 && g > 55 && b > 35 && Math.abs(r - g) < 40 && r > b);

          if (isSkin) skinPixels++;
        }
      }

      const skinRatio = skinPixels / totalPixels;
      const darkRatio = darkPixels / totalPixels;
      // Much lower thresholds — avoid false positives from lighting/glasses
      const faceVisible = skinRatio >= 0.008 && darkRatio < 0.80;

      if (!faceVisible) {
        noFaceCountRef.current++;
        // 150 × 2s = 5 consecutive minutes with no face — only then act
        if (noFaceCountRef.current >= 150) {
          noFaceCountRef.current = 0;
          faceViolationsRef.current++;
          logSuspicious(`Face absent 5+ minutes (violation #${faceViolationsRef.current})`);

          if (faceViolationsRef.current >= 3) {
            handleRejected("Face not visible during interview");
            return;
          }

          speak("I notice your face has not been visible for a while. Please make sure you are clearly on camera.");
        }
      } else {
        noFaceCountRef.current = 0;
      }
    }, 2000);
  }

  async function handleRejected(reason: string = "Camera turned off during interview") {
    if (cameraCheckRef.current) clearInterval(cameraCheckRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (faceDetectionRef.current) clearInterval(faceDetectionRef.current);
    cameraOffRef.current = false;
    setCameraOff(false);

    const rejectionMessage = reason.startsWith("Face")
      ? "This interview is being ended because your face has not been visible multiple times. The recruiting team will be notified."
      : "This interview has been ended due to camera violations. The recruiter will be notified.";
    speak(rejectionMessage);
    setPhaseSync("rejected");

    const interviewId = interviewIdRef.current;
    try {
      await apiFetch(`/api/interviews/${interviewId}/submit`, {
        method: "POST",
        body: JSON.stringify({
          answers: [],
          rejectedReason: reason,
          faceViolations: faceViolationsRef.current,
        }),
      });
    } catch (err) {
      console.error("[rejected] Failed to submit rejection:", err);
    }
  }

  // ─── Resume upload ────────────────────────────────────────────────────────
  async function handleResumeUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !interviewIdRef.current) return;
    const formData = new FormData();
    formData.append("resume", file, file.name);
    try {
      const res = await fetch(`${API_BASE}/interviews/${interviewIdRef.current}/upload-resume`, {
        method: "POST",
        body: formData,
      });
      if (res.ok) setResumeUploaded(true);
    } catch (err) {
      console.warn("[resume] Upload failed:", err);
    }
  }

  // ─── Auto-save session state ─────────────────────────────────────────────
  function startAutoSave(interviewId: number) {
    if (autoSaveIntervalRef.current) clearInterval(autoSaveIntervalRef.current);
    autoSaveIntervalRef.current = setInterval(() => {
      const state = conversationRef.current;
      const elapsed = elapsedSecondsRef.current;
      if (state.length === 0) return;
      fetch(`${API_BASE}/interviews/${interviewId}/save-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationState: state, elapsedSeconds: elapsed }),
      }).catch(() => {/* ignore */});
    }, 30000);
  }

  // ─── Resume after disconnect ──────────────────────────────────────────────
  async function resumeInterview() {
    const data = interviewRef.current!;
    if (data.conversationState && data.conversationState.length > 0) {
      conversationRef.current = data.conversationState;
      setConversationHistory([...data.conversationState]);
    }
    if (data.elapsedSeconds) {
      elapsedSecondsRef.current = data.elapsedSeconds;
      setElapsedSeconds(data.elapsedSeconds);
    }

    setPhaseSync("camera-starting");
    await initCamera();
    startRecording();
    startElapsedTimer();
    startCameraMonitoring();
    startFaceDetection();
    startGazeDetection();
    startMultiplePersonDetection();
    startAutoSave(data.id);

    const lastAiMsg = conversationRef.current.filter((e) => e.role === "ai").at(-1)?.text;
    const resumeMsg = lastAiMsg
      ? `Welcome back! Let us continue. My last question was: ${lastAiMsg}`
      : "Welcome back! Let us continue the interview.";

    setPhaseSync("speaking");
    setAiMessage(resumeMsg);
    addToConversation({ role: "ai", text: resumeMsg });
    await speak(resumeMsg);
    setPhaseSync("listening");
    startListening();
  }

  // ─── Start fresh (discard previous session) ───────────────────────────────
  async function startFresh() {
    const data = interviewRef.current!;
    fetch(`${API_BASE}/interviews/${data.id}/save-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationState: [], elapsedSeconds: 0 }),
    }).catch(() => {/* ignore */});
    conversationRef.current = [];
    setConversationHistory([]);
    elapsedSecondsRef.current = 0;
    setElapsedSeconds(0);
    setHasConsented(false);
    setPhaseSync("permissions");
  }

  // ─── Integrity score ─────────────────────────────────────────────────────
  function calculateIntegrityScore(): number {
    let score = 100;
    score -= tabSwitchCountRef.current * 10;
    score -= windowBlurRef.current * 5;
    score -= faceViolationsRef.current * 15;
    score -= gazeAnomalyRef.current * 3;
    score -= multiPersonCountRef.current * 20;
    return Math.max(0, score);
  }

  // ─── Gaze detection (every 3 seconds) — silent logging only ────────────
  function startGazeDetection() {
    gazeIntervalRef.current = setInterval(() => {
      if (!videoRef.current) return;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = 320;
      canvas.height = 240;
      ctx.drawImage(videoRef.current, 0, 0, 320, 240);
      const imageData = ctx.getImageData(0, 0, 320, 240);
      const data = imageData.data;

      let leftSkin = 0, rightSkin = 0;
      for (let y = 40; y < 180; y++) {
        for (let x = 80; x < 240; x++) {
          const idx = (y * 320 + x) * 4;
          const r = data[idx], g = data[idx + 1], b = data[idx + 2];
          const isSkin = r > 80 && g > 50 && b > 30 && r > g && r > b && r - b > 15;
          if (isSkin) {
            if (x < 160) leftSkin++;
            else rightSkin++;
          }
        }
      }
      const total = leftSkin + rightSkin;
      if (total < 50) return;
      const asymmetry = Math.abs(leftSkin - rightSkin) / total;

      if (asymmetry > 0.45) {
        gazeConsecutiveRef.current++;
        // 10 × 3s = 30 seconds looking away — log silently, never interrupt
        if (gazeConsecutiveRef.current >= 10) {
          gazeConsecutiveRef.current = 0;
          gazeAnomalyRef.current++;
          logSuspicious(`Extended gaze away at ${new Date().toLocaleTimeString()}`);
        }
      } else {
        gazeConsecutiveRef.current = 0;
      }
    }, 3000);
  }

  // ─── Multiple person detection (every 5 seconds) — silent logging only ──
  function startMultiplePersonDetection() {
    multiplePersonIntervalRef.current = setInterval(() => {
      if (!videoRef.current) return;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = 320;
      canvas.height = 240;
      ctx.drawImage(videoRef.current, 0, 0, 320, 240);
      const imageData = ctx.getImageData(0, 0, 320, 240);
      const data = imageData.data;

      const skinCols: boolean[] = new Array(32).fill(false);
      for (let col = 0; col < 32; col++) {
        let skinCount = 0;
        for (let row = 20; row < 200; row++) {
          const x = col * 10;
          const idx = (row * 320 + x) * 4;
          const r = data[idx], g = data[idx + 1], b = data[idx + 2];
          if (r > 80 && g > 50 && b > 30 && r > g && r > b && r - b > 15) skinCount++;
        }
        skinCols[col] = skinCount > 8;
      }

      // Count skin cluster transitions (raised threshold to 3 to reduce false positives)
      let transitions = 0;
      let inCluster = false;
      for (let i = 0; i < 32; i++) {
        if (skinCols[i] && !inCluster) { transitions++; inCluster = true; }
        else if (!skinCols[i]) inCluster = false;
      }

      if (transitions >= 3) {
        multiPersonCountRef.current++;
        // After 10 consecutive detections (50 seconds) — log silently, never interrupt
        if (multiPersonCountRef.current >= 10) {
          logSuspicious(`Multiple people possibly detected at ${new Date().toLocaleTimeString()}`);
          multiPersonCountRef.current = 0;
        }
      } else {
        multiPersonCountRef.current = 0;
      }
    }, 5000);
  }

  // ─── Handle "Allow & Start" button ───────────────────────────────────────
  async function handleRequestPermissions() {
    setPhaseSync("camera-starting");
    await initCamera();
    startRecording();
    startElapsedTimer();
    startCameraMonitoring();
    startFaceDetection();
    startGazeDetection();
    startMultiplePersonDetection();
    startAutoSave(interviewIdRef.current);

    lastAnswerTimeRef.current = Date.now();
    const pKey: ClientPersonaKey = (interviewRef.current?.persona && interviewRef.current.persona in CLIENT_PERSONAS)
      ? (interviewRef.current.persona as ClientPersonaKey)
      : 'technical';
    const greeting = CLIENT_PERSONAS[pKey].greeting;
    setPhaseSync("greeting");
    setAiMessage(greeting);
    addToConversation({ role: "ai", text: greeting });
    await speak(greeting, 150);

    setPhaseSync("listening");
    startListening();
  }

  // ─── Handle "Done Answering" button ──────────────────────────────────────
  async function handleDoneAnswering() {
    if (phaseRef.current !== "listening") return;
    if (!isRecordingRef.current) return;
    if (isProcessingRef.current) {
      console.log('[Done Answering] Already processing — ignoring duplicate call');
      return;
    }
    isProcessingRef.current = true;

    try {
      setShowQuestion(false);
      setCurrentQuestion("");

      const transcript = await stopAndTranscribe();

      lastAnswerTimeRef.current = Date.now();
      if (!transcript || transcript.trim().length < 3) {
        setLiveTranscript("Nothing captured — please try again");
        setTimeout(() => {
          setLiveTranscript("");
          startListening();
        }, 2000);
        return;
      }

      console.log('[Done Answering] history BEFORE adding candidate answer:', conversationRef.current.length);

      const answerText = transcript.trim();
      addToConversation({ role: "candidate", text: answerText });

      console.log('[Done Answering] history AFTER adding candidate answer:', conversationRef.current.length);

      setPhaseSync("thinking");
      setLiveTranscript("");

      const data = interviewRef.current!;
      const currentConversation = [...conversationRef.current];
      const elapsed = elapsedSecondsRef.current;
      const durationSecs = (data.durationMinutes ?? 30) * 60;
      const forceComplete = elapsed >= durationSecs;

      console.log('[API Call] sending history length:', conversationRef.current.length);
      console.log('[API Call] last message in history:', JSON.stringify(conversationRef.current.slice(-2)));

      const res = await fetch(`${API_BASE}/interview-conversation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interviewId: data.id,
          jobTitle: data.jobTitle,
          jobDescription: data.jobDescription,
          conversationHistory: currentConversation,
          elapsedSeconds: elapsed,
          durationMinutes: data.durationMinutes ?? 30,
        }),
      });

      const result = (await res.json()) as ConversationApiResponse;
      console.log('[API Response] nextQuestion:', result.nextQuestion?.substring(0, 100));

      if (forceComplete && !result.isComplete) {
        result.isComplete = true;
        result.nextQuestion =
          "Thank you so much for your time today. It's been a wonderful conversation and I've really enjoyed learning about you. Our team will carefully review your interview and we'll be in touch with detailed feedback soon. All the very best!";
      }

      if (result.isComplete) {
        setTopicArea("wrapup");
        setAiMessage(result.nextQuestion);
        addToConversation({ role: "ai", text: result.nextQuestion });
        setPhaseSync("speaking");
        await speak(result.nextQuestion);
        await submitInterview();
      } else {
        setTopicArea(result.topicArea ?? "technical");
        setAiMessage(result.nextQuestion);
        setCurrentQuestion(result.nextQuestion);
        setShowQuestion(true);
        addToConversation({ role: "ai", text: result.nextQuestion });
        console.log('[API Call] history AFTER AI response added:', conversationRef.current.length);
        setPhaseSync("speaking");
        await speak(result.nextQuestion);
        setPhaseSync("listening");
        startListening();
      }
    } catch (err) {
      console.error("Failed to get next question:", err);
      const fallback =
        "Could you tell me about a recent project you're most proud of and what your specific contributions were to its success?";
      setAiMessage(fallback);
      addToConversation({ role: "ai", text: fallback });
      setPhaseSync("speaking");
      await speak(fallback);
      setPhaseSync("listening");
      startListening();
    } finally {
      isProcessingRef.current = false;
    }
  }

  // ─── Submit interview ─────────────────────────────────────────────────────
  async function submitInterview() {
    setPhaseSync("submitting");
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    if (cameraCheckRef.current) clearInterval(cameraCheckRef.current);
    if (faceDetectionRef.current) clearInterval(faceDetectionRef.current);
    if (gazeIntervalRef.current) clearInterval(gazeIntervalRef.current);
    if (multiplePersonIntervalRef.current) clearInterval(multiplePersonIntervalRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (autoSaveIntervalRef.current) clearInterval(autoSaveIntervalRef.current);
    if (silenceIntervalRef.current) clearInterval(silenceIntervalRef.current);
    setFaceWarning(false);
    setCameraOff(false);
    noFaceCountRef.current = 0;

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
    }

    stopCameraInternal();

    const history = conversationRef.current;
    const aiTurns = history.filter((entry) => entry.role === "ai");
    const answers = history
      .filter((entry) => entry.role === "candidate")
      .map((entry, i) => ({
        questionIndex: i,
        questionText: aiTurns[i]?.text ?? "",
        answerText: entry.text,
      }));

    const interviewId = interviewIdRef.current;

    // Upload in background — don't block the thank-you screen
    uploadRecording(interviewId).catch(console.error);

    try {
      const res = await apiFetch(`/api/interviews/${interviewId}/submit`, {
        method: "POST",
        body: JSON.stringify({
          answers,
          conversationHistory: conversationRef.current,
          faceViolations: faceViolationsRef.current,
          proctoring: {
            tabSwitches: tabSwitchCountRef.current,
            windowBlurs: windowBlurRef.current,
            faceViolations: faceViolationsRef.current,
            gazeAnomalies: gazeAnomalyRef.current,
            multiplePersonEvents: multiPersonCountRef.current,
            cameraViolations: faceViolationsRef.current,
            suspicious: suspiciousRef.current,
            integrityScore: calculateIntegrityScore(),
          },
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Submit returned ${res.status}: ${body}`);
      }
    } catch (err) {
      console.error("[submit] Failed to submit interview for evaluation:", err);
    }

    setPhaseSync("complete");
  }

  // ─── Derived state ────────────────────────────────────────────────────────
  const personaKey: ClientPersonaKey = (interview?.persona && interview.persona in CLIENT_PERSONAS)
    ? (interview.persona as ClientPersonaKey)
    : 'technical';
  const currentPersona = CLIENT_PERSONAS[personaKey];

  const isInterviewActive = !["loading", "waiting", "permissions", "camera-starting", "submitting", "complete", "rejected", "error"].includes(phase);
  const isAISpeaking = phase === "greeting" || phase === "speaking";
  const answersCount = conversationHistory.filter((m) => m.role === "candidate").length;
  const isNearEnd = elapsedSeconds >= 1680;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="relative h-screen w-screen bg-black overflow-hidden select-none">

      {/* VIDEO ELEMENT */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="absolute inset-0"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          transform: "scaleX(-1)",
          backgroundColor: "#000",
          display: "block",
        }}
      />

      {/* Starting camera placeholder */}
      {isInterviewActive && !isCameraReady && !cameraError && (
        <div style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          textAlign: "center",
        }}>
          <div style={{ fontSize: 48, opacity: 0.3 }}>📷</div>
          <p style={{ color: "#64748B", fontSize: 14, marginTop: 8 }}>
            Starting camera...
          </p>
        </div>
      )}

      {/* ════════════════ CAMERA OFF OVERLAY ════════════════ */}
      {cameraOff && !["complete", "rejected", "submitting"].includes(phase) && (
        <div className="absolute inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.92)" }}>
          <div className="text-center p-8 max-w-sm w-full">
            <div className="text-5xl mb-4 animate-pulse">⚠️</div>
            <h2 className="text-2xl font-bold text-red-500 mb-3">Camera Required</h2>
            <p className="text-white mb-2">
              Turn your camera back on within
            </p>
            <p className={`font-mono font-bold text-4xl mb-4 ${cameraCountdown <= 10 ? "text-red-400" : "text-white"}`}>
              {cameraCountdown}s
            </p>
            {cameraWarnings > 1 && (
              <p className="text-yellow-400 text-sm mb-4">Warning {cameraWarnings}/3</p>
            )}
            <button
              onClick={handleCameraBack}
              className="w-full py-3 rounded-xl text-white font-semibold text-base"
              style={{ backgroundColor: "#6366F1" }}
            >
              My Camera is On — Continue
            </button>
          </div>
        </div>
      )}

      {/* ════════════════ ACTIVITY BADGE (subtle, non-blocking) ════════════ */}
      {activityBadgeVisible && !["complete", "rejected", "submitting", "loading", "permissions", "camera-starting", "waiting"].includes(phase) && (
        <div style={{
          position: "absolute",
          bottom: 100,
          right: 16,
          zIndex: 40,
          backgroundColor: "rgba(15,23,42,0.85)",
          border: "1px solid #F59E0B",
          borderRadius: 8,
          padding: "6px 12px",
          display: "flex",
          alignItems: "center",
          gap: 6,
          backdropFilter: "blur(8px)",
          pointerEvents: "none",
        }}>
          <span style={{ fontSize: 12 }}>⚠️</span>
          <span style={{ color: "#F59E0B", fontSize: 11, fontWeight: 600 }}>Activity noted</span>
        </div>
      )}

      {/* ════════════════ BROWSER — MOBILE WARNING (EDGE 1) ════════════════ */}
      {isMobile && !browserWarningDismissed && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-950 p-6">
          <div className="max-w-sm w-full text-center bg-gray-900 rounded-2xl p-8 border border-yellow-700/40">
            <div className="text-5xl mb-4">📱</div>
            <h2 className="text-xl font-bold text-white mb-3">Desktop Recommended</h2>
            <p className="text-gray-400 text-sm leading-relaxed mb-6">
              For the best interview experience please use <strong className="text-white">Google Chrome on a desktop or laptop computer</strong>.
            </p>
            <button
              onClick={() => setBrowserWarningDismissed(true)}
              className="w-full py-3 rounded-xl border border-gray-600 text-gray-300 text-sm font-medium hover:bg-gray-800 transition-colors"
            >
              I understand, continue anyway
            </button>
          </div>
        </div>
      )}

      {/* ════════════════ BROWSER — NON-CHROME WARNING (EDGE 1) ════════════════ */}
      {!isMobile && !isChrome && !browserWarningDismissed && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-950 p-6">
          <div className="max-w-sm w-full text-center bg-gray-900 rounded-2xl p-8 border border-yellow-700/40">
            <div className="text-5xl mb-4">⚠️</div>
            <h2 className="text-xl font-bold text-white mb-3">Chrome Recommended</h2>
            <p className="text-gray-400 text-sm leading-relaxed mb-6">
              AccionHire works best on <strong className="text-white">Google Chrome</strong>. Some features (audio recording, speech synthesis) may not work on other browsers.
            </p>
            <div className="flex gap-3">
              <a
                href="googlechrome://navigate?url=window.location.href"
                onClick={(e) => { e.preventDefault(); window.open(`https://www.google.com/chrome/`, "_blank"); }}
                className="flex-1 py-3 rounded-xl text-white text-sm font-semibold text-center"
                style={{ backgroundColor: "#6366F1" }}
              >
                Open in Chrome
              </a>
              <button
                onClick={() => setBrowserWarningDismissed(true)}
                className="flex-1 py-3 rounded-xl border border-gray-600 text-gray-400 text-sm font-medium hover:bg-gray-800 transition-colors"
              >
                Continue anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════ CAMERA ERROR OVERLAY ════════════════ */}
      {cameraError && !["complete", "rejected", "submitting"].includes(phase) && (
        <div style={{
          position: "absolute",
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: "#0F172A",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          zIndex: 20,
        }}>
          <div style={{ fontSize: 48 }}>📷</div>
          <h3 style={{ color: "white", fontSize: 18, fontWeight: 700 }}>
            Camera Unavailable
          </h3>
          <p style={{ color: "#94A3B8", textAlign: "center", maxWidth: 320, fontSize: 14 }}>
            {cameraError}
          </p>
          <button
            onClick={async () => {
              setCameraError(null);
              const ok = await initCamera();
              if (!ok) setCameraError("Still unable to access camera. Please refresh the page.");
            }}
            style={{
              background: "#6366F1",
              border: "none",
              borderRadius: 8,
              padding: "12px 24px",
              color: "white",
              fontWeight: 700,
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            🔄 Try Again
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: "transparent",
              border: "1px solid #334155",
              borderRadius: 8,
              padding: "10px 24px",
              color: "#64748B",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Refresh Page
          </button>
        </div>
      )}

      {/* ════════════════ LOADING ════════════════ */}
      {phase === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950">
          <div className="text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center mx-auto mb-6">
              <span className="text-white text-2xl font-black">S</span>
            </div>
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-gray-400 text-sm">Loading your interview...</p>
          </div>
        </div>
      )}

      {/* ════════════════ WAITING ════════════════ */}
      {phase === "waiting" && interview?.scheduledAt && (() => {
        const { date, time } = formatScheduledDateTime(interview.scheduledAt);
        return (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-950 p-6">
            <div className="max-w-md w-full text-center">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-700 to-indigo-500 flex items-center justify-center mx-auto mb-6 shadow-xl">
                <span className="text-white text-3xl font-black">A</span>
              </div>
              <h1 className="text-2xl font-bold text-white mb-2">Interview Not Started Yet</h1>
              <p className="text-gray-400 text-sm mb-6">Your interview is scheduled for</p>
              <div className="bg-gray-900 rounded-2xl border border-gray-700 p-5 mb-6 text-left space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">📅</span>
                  <div>
                    <p className="text-gray-400 text-xs uppercase tracking-wider">Date</p>
                    <p className="text-white font-semibold">{date}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">⏰</span>
                  <div>
                    <p className="text-gray-400 text-xs uppercase tracking-wider">Time</p>
                    <p className="text-white font-semibold">{time}</p>
                  </div>
                </div>
                {interview.durationMinutes && (
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">⏱️</span>
                    <div>
                      <p className="text-gray-400 text-xs uppercase tracking-wider">Duration</p>
                      <p className="text-white font-semibold">{interview.durationMinutes} minutes</p>
                    </div>
                  </div>
                )}
              </div>
              <div className="bg-blue-950/40 border border-blue-700/40 rounded-xl px-5 py-4 mb-6">
                <p className="text-blue-400 text-xs uppercase tracking-wider mb-1">Link activates in</p>
                <p className="text-white text-3xl font-mono font-bold tracking-wider">{formatCountdown(waitingSecondsLeft)}</p>
              </div>
              <p className="text-gray-600 text-sm">Please join back closer to your interview time.<br />This page checks automatically every second.</p>
            </div>
          </div>
        );
      })()}

      {/* ════════════════ CONSENT ════════════════ */}
      {phase === "permissions" && !hasConsented && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950 p-6">
          <div className="bg-gray-900 rounded-2xl p-8 max-w-md w-full">
            <div className="mb-6"><Logo variant="light" size={32} /></div>
            <h2 className="text-white text-2xl font-bold mb-2">Before We Begin</h2>
            <p className="text-gray-400 mb-6">This interview will be:</p>
            <ul className="space-y-3 mb-8">
              {[
                "Conducted by AccionHire AI",
                "Recorded (video + audio)",
                "Evaluated automatically",
                "Shared with the recruiting team",
              ].map((item) => (
                <li key={item} className="flex items-center gap-3 text-gray-300">
                  <span className="text-green-400">✓</span>
                  {item}
                </li>
              ))}
            </ul>
            <p className="text-gray-500 text-sm mb-4">
              By clicking "I Agree &amp; Continue", you consent to this interview being recorded and evaluated.
            </p>
            <div style={{ border: '1px dashed #334155', borderRadius: 8, padding: 14, marginBottom: 16 }}>
              <p className="text-gray-400 text-sm mb-2">📄 Upload your resume <span className="text-gray-600">(optional — personalises interview questions)</span></p>
              <input
                type="file"
                accept=".pdf,.doc,.docx,.txt"
                onChange={handleResumeUpload}
                className="text-gray-500 text-xs w-full"
              />
              {resumeUploaded && (
                <p className="text-green-400 text-xs mt-2">✓ Resume uploaded — interview personalised</p>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={() => navigate("/")} className="flex-1 py-3 rounded-lg border border-gray-600 text-gray-400 hover:bg-gray-800">
                Decline
              </button>
              <button onClick={() => setHasConsented(true)} className="flex-1 py-3 rounded-lg text-white font-semibold" style={{ backgroundColor: "#6366F1" }}>
                I Agree &amp; Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════ PERMISSIONS ════════════════ */}
      {phase === "permissions" && hasConsented && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950 p-6 overflow-y-auto">
          <div className="max-w-md w-full my-auto">
            <div className="bg-gray-900 rounded-2xl p-8 border border-gray-800 text-center">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-700 to-indigo-500 flex items-center justify-center mx-auto mb-6 shadow-xl">
                <span className="text-white text-3xl font-black">A</span>
              </div>
              <h1 className="text-2xl font-bold text-white mb-1">AccionHire Interview</h1>
              <p className="text-gray-400 text-sm mb-6">
                Welcome, <span className="text-white font-semibold">{interview?.candidateName}</span>.<br />
                You're interviewing for <span className="text-blue-400 font-semibold">{interview?.jobTitle}</span>.
              </p>
              <div className="space-y-3 mb-8 text-left">
                {[
                  { icon: "📷", color: "bg-green-500/20 text-green-400", title: "Camera access", desc: "Your video + audio will be recorded and stored securely for HR review" },
                  { icon: "🎙️", color: "bg-blue-500/20 text-blue-400", title: "Microphone access", desc: "Audio transcribed via Whisper AI — speak clearly for best results" },
                  { icon: "⏱️", color: "bg-purple-500/20 text-purple-400", title: "~30 minute session", desc: "Conversational AI interview — no per-answer time limit, speak freely" },
                ].map(({ icon, color, title, desc }) => (
                  <div key={title} className="flex items-start gap-3 bg-gray-800/50 rounded-xl p-3 border border-gray-700/30">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${color}`}>
                      <span className="text-base">{icon}</span>
                    </div>
                    <div>
                      <p className="text-white text-sm font-medium leading-tight">{title}</p>
                      <p className="text-gray-500 text-xs mt-0.5">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={handleRequestPermissions}
                className="w-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold py-4 px-6 rounded-xl transition-all text-base shadow-lg shadow-blue-900/50"
              >
                Allow &amp; Start Interview
              </button>
              <p className="text-gray-700 text-xs mt-3">Best in Chrome · Requires camera + microphone permissions</p>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════ CAMERA STARTING ════════════════ */}
      {phase === "camera-starting" && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950">
          <div className="text-center">
            <div className="w-12 h-12 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-400 text-sm">Starting camera...</p>
          </div>
        </div>
      )}

      {/* ════════════════ ACTIVE INTERVIEW ════════════════ */}
      {isInterviewActive && (
        <>
          {/* Top bar */}
          <div className="absolute top-0 left-0 right-0 z-10 flex justify-between items-center p-3 sm:p-4">
            <div className="flex items-center gap-2 bg-black/70 backdrop-blur-md rounded-full px-3 py-1.5 border border-white/10">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <div>
                <span className="text-white text-xs font-bold tracking-widest">LIVE</span>
                <span className="text-red-400 text-xs ml-1.5">Proctored</span>
              </div>
              {recordingChunkCount > 0 && (
                <span className="text-white/50 text-xs">{(recordingChunkCount * 1000 / (1024 * 1024)).toFixed(1)}MB</span>
              )}
            </div>
            <div className="bg-black/70 backdrop-blur-md rounded-full px-4 py-1.5 border border-white/10">
              <Logo variant="light" size={20} />
            </div>
            <div className="flex items-center gap-1.5 bg-black/70 backdrop-blur-md rounded-full px-3 py-1.5 border border-white/10">
              <div className={`w-1.5 h-1.5 rounded-full ${isNearEnd ? "bg-orange-400 animate-pulse" : "bg-[#6366F1]"}`} />
              <span className={`text-sm font-mono font-bold ${isNearEnd ? "text-orange-400" : "text-[#6366F1]"}`}>
                {formatTime(elapsedSeconds)}
              </span>
            </div>
          </div>

          {/* Candidate name label */}
          <div className="absolute z-10" style={{ bottom: "calc(var(--bottom-panel-height, 220px) + 12px)", left: "16px" }}>
            <div className="bg-black/70 backdrop-blur-md rounded-lg px-3 py-1.5 border border-white/10">
              <span className="text-white text-sm font-medium">{interview?.candidateName}</span>
            </div>
          </div>

          {/* Persona avatar */}
          <div
            className="absolute z-10"
            style={{
              bottom: "calc(var(--bottom-panel-height, 220px) + 12px)",
              right: 16,
              backgroundColor: "#1E293B",
              borderRadius: 16,
              padding: "12px 16px",
              display: "flex",
              alignItems: "center",
              gap: 12,
              border: "1px solid #334155",
            }}
          >
            <div style={{ width: 44, height: 44, borderRadius: "50%", backgroundColor: currentPersona.avatarColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700, color: "white", flexShrink: 0, position: "relative" }}>
              {currentPersona.avatarInitial}
              <div style={{ position: "absolute", bottom: 2, right: 2, width: 10, height: 10, backgroundColor: "#10B981", borderRadius: "50%", border: "2px solid #1E293B" }} />
            </div>
            <div>
              <div style={{ color: "white", fontWeight: 700, fontSize: 14 }}>{currentPersona.name}</div>
              <div style={{ color: "#64748B", fontSize: 11 }}>{currentPersona.title}</div>
              <div style={{ color: isFetchingTTS ? "#F59E0B" : isAISpeaking ? currentPersona.avatarColor : "#94A3B8", fontSize: 11, marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                {isFetchingTTS ? "⏳ Preparing..." : isAISpeaking ? (
                  <>
                    <span style={{ display: "flex", gap: 2, alignItems: "center" }}>
                      {[1, 2, 3, 4].map((i) => (
                        <div key={i} style={{ width: 3, backgroundColor: currentPersona.avatarColor, borderRadius: 2, height: i % 2 === 0 ? 12 : 8 }} />
                      ))}
                    </span>
                    Speaking...
                  </>
                ) : phase === "thinking" ? "Thinking..." : "Listening"}
              </div>
            </div>
          </div>

          {/* Topic badge */}
          {topicArea && (
            <div className="absolute top-14 sm:top-16 left-3 sm:left-4 z-10">
              <div className="bg-black/60 backdrop-blur-md rounded-full px-3 py-1 border border-white/10">
                <span className="text-xs font-medium" style={{ color: "#6366F1" }}>{topicLabel(topicArea)}</span>
              </div>
            </div>
          )}

          {/* Bottom panel */}
          <div className="absolute bottom-0 left-0 right-0 z-10">
            <div className="h-16 bg-gradient-to-t from-black/90 to-transparent pointer-events-none" />
            <div className="bg-black/90 backdrop-blur-md px-4 pt-3 pb-6 border-t border-white/5 space-y-3">

              {/* AI message (greeting / speaking) */}
              {(phase === "greeting" || phase === "speaking") && aiMessage && (
                <div className="bg-blue-950/60 rounded-xl px-4 py-3 border border-blue-700/30">
                  <div className="flex items-center gap-2 mb-1.5">
                    <SpeakingBars color="bg-blue-400" />
                    <span className="text-xs font-semibold" style={{ color: currentPersona.avatarColor }}>
                      {currentPersona.name}
                    </span>
                  </div>
                  <p className="text-white text-sm leading-relaxed line-clamp-3">{aiMessage}</p>
                </div>
              )}

              {/* Thinking */}
              {phase === "thinking" && (
                <div className="flex items-center justify-center gap-3 py-2">
                  <div className="flex gap-1.5">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="w-2.5 h-2.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </div>
                  <span className="text-gray-300 text-sm">⏳ Processing your answer...</span>
                </div>
              )}

              {/* Live transcript / recording status */}
              {phase === "listening" && (
                <div className="bg-gray-900/80 rounded-xl px-4 py-3 border border-gray-700/50 min-h-[60px]">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                    <span className="text-red-400 text-xs font-semibold">🎤 Recording — click Done when finished</span>
                  </div>
                  {liveTranscript === "Transcribing..." ? (
                    <p className="text-blue-400 text-sm italic">⏳ Transcribing your answer...</p>
                  ) : liveTranscript ? (
                    <p className="text-white text-sm leading-relaxed">{liveTranscript}</p>
                  ) : (
                    <p className="text-gray-600 text-sm italic">Your answer will appear here after you click Done...</p>
                  )}
                </div>
              )}

              {/* Current question reference card — visible during listening */}
              {phase === "listening" && showQuestion && currentQuestion && (
                <div style={{
                  backgroundColor: "rgba(15, 23, 42, 0.95)",
                  border: "1px solid #6366F1",
                  borderRadius: 12,
                  padding: "14px 16px",
                  backdropFilter: "blur(10px)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: "50%",
                      backgroundColor: currentPersona.avatarColor,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 700, color: "white", flexShrink: 0,
                    }}>
                      {currentPersona.avatarInitial}
                    </div>
                    <span style={{ color: currentPersona.avatarColor, fontSize: 11, fontWeight: 600 }}>
                      {currentPersona.name} asked:
                    </span>
                  </div>
                  <p style={{ color: "white", fontSize: 14, lineHeight: 1.55, margin: 0 }}>
                    {currentQuestion}
                  </p>
                </div>
              )}

              {/* Done Answering button — hidden while transcribing */}
              {phase === "listening" && liveTranscript !== "Transcribing..." && (
                <button
                  onClick={handleDoneAnswering}
                  className="w-full bg-[#6366F1] hover:bg-[#4F46E5] active:bg-[#4F46E5] text-white font-bold py-3.5 px-6 rounded-xl transition-all text-base shadow-xl shadow-indigo-900/40 flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                  Done Answering
                </button>
              )}

              {/* Speaking hint */}
              {(phase === "greeting" || phase === "speaking") && (
                <p className="text-center text-gray-600 text-xs pb-1">{currentPersona.name} is speaking — please listen</p>
              )}

              {/* Answer counter */}
              {answersCount > 0 && phase === "listening" && (
                <p className="text-center text-gray-700 text-xs">
                  {answersCount} answer{answersCount !== 1 ? "s" : ""} recorded
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {/* ════════════════ SUBMITTING ════════════════ */}
      {phase === "submitting" && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950">
          <div className="text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center mx-auto mb-6 animate-pulse">
              <span className="text-white text-2xl font-black">S</span>
            </div>
            <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-white font-semibold mb-1">Submitting your interview...</p>
            {uploadStatus === "uploading" ? (
              <p className="text-blue-400 text-sm">Uploading recording...</p>
            ) : uploadStatus === "done" ? (
              <p className="text-green-400 text-sm">Recording saved</p>
            ) : uploadStatus === "failed" ? (
              <p className="text-yellow-400 text-sm">Upload failed — recording not saved</p>
            ) : (
              <p className="text-gray-500 text-sm">Evaluating your responses with AI</p>
            )}
          </div>
        </div>
      )}

      {/* ════════════════ COMPLETE ════════════════ */}
      {phase === "complete" && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950 p-6 overflow-y-auto">
          <div className="max-w-md w-full my-auto text-center">
            <div className="w-24 h-24 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6">
              <svg className="w-12 h-12 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-white mb-3">Interview Complete!</h1>
            <p className="text-gray-300 text-lg mb-2">Your recruiter will receive a detailed report shortly.</p>
            <p className="text-gray-500 text-sm mb-8 leading-relaxed">
              Thank you, {interview?.candidateName?.split(" ")[0]}. We appreciate your time and wish you all the best.
            </p>
            <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800 text-left space-y-3 mb-6">
              <p className="text-gray-500 text-xs uppercase tracking-widest mb-2">Session Summary</p>
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm">Role</span>
                <span className="text-white text-sm font-medium">{interview?.jobTitle}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm">Duration</span>
                <span className="text-white text-sm font-mono font-medium">{formatTime(elapsedSeconds)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm">Questions answered</span>
                <span className="text-white text-sm font-medium">{answersCount}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm">Recording</span>
                {uploadStatus === "done" && <span className="text-green-400 text-sm font-medium">Saved ✓</span>}
                {uploadStatus === "failed" && <span className="text-yellow-400 text-sm font-medium">Upload failed</span>}
                {(uploadStatus === "idle" || uploadStatus === "uploading") && <span className="text-gray-500 text-sm">—</span>}
              </div>
            </div>
            <p className="text-gray-700 text-xs">You may now close this tab.</p>
          </div>
        </div>
      )}

      {/* ════════════════ REJECTED ════════════════ */}
      {phase === "rejected" && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950 p-6">
          <div className="max-w-sm w-full text-center">
            <div className="w-24 h-24 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-6">
              <span className="text-5xl">❌</span>
            </div>
            <h1 className="text-2xl font-bold text-white mb-3">Interview Ended</h1>
            <p className="text-gray-400 text-sm leading-relaxed">
              Camera was turned off multiple times.<br />
              The recruiting team has been notified.
            </p>
          </div>
        </div>
      )}

      {/* ════════════════ RESUME AFTER DISCONNECT ════════════════ */}
      {phase === "resume" && interview && (
        <div style={{ minHeight: "100vh", backgroundColor: "#0F172A", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: "#1E293B", borderRadius: 20, padding: 48, maxWidth: 480, width: "100%", textAlign: "center", border: "1px solid #334155" }}>
            <div style={{ fontSize: 56, marginBottom: 20 }}>🔄</div>
            <h2 style={{ color: "white", fontSize: 26, fontWeight: 800, marginBottom: 12 }}>
              Welcome Back!
            </h2>
            <p style={{ color: "#94A3B8", lineHeight: 1.7, marginBottom: 8, fontSize: 15 }}>
              It looks like your interview was interrupted.<br />
              Don&apos;t worry — your progress has been saved!
            </p>
            <div style={{ background: "rgba(99,102,241,0.1)", border: "1px solid #6366F1", borderRadius: 10, padding: "12px 20px", margin: "20px 0", display: "flex", justifyContent: "center", gap: 24 }}>
              <div>
                <div style={{ color: "#6366F1", fontSize: 22, fontWeight: 700 }}>
                  {Math.floor((interview.elapsedSeconds ?? 0) / 60)}:{String((interview.elapsedSeconds ?? 0) % 60).padStart(2, "0")}
                </div>
                <div style={{ color: "#64748B", fontSize: 11 }}>completed</div>
              </div>
              <div style={{ width: 1, background: "#334155" }} />
              <div>
                <div style={{ color: "#6366F1", fontSize: 22, fontWeight: 700 }}>
                  {interview.conversationState?.filter((m) => m.role === "candidate").length ?? 0}
                </div>
                <div style={{ color: "#64748B", fontSize: 11 }}>answers saved</div>
              </div>
            </div>
            <p style={{ color: "#64748B", fontSize: 12, marginBottom: 28 }}>
              Click &quot;Resume&quot; to continue from where you left off.
            </p>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={resumeInterview}
                style={{ flex: 2, background: "#6366F1", border: "none", borderRadius: 10, padding: 14, color: "white", fontWeight: 700, cursor: "pointer", fontSize: 15 }}
              >
                ▶ Resume Interview
              </button>
              <button
                onClick={startFresh}
                style={{ flex: 1, background: "transparent", border: "1px solid #334155", borderRadius: 10, padding: 14, color: "#64748B", cursor: "pointer", fontSize: 13 }}
              >
                Start Over
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════ COMPLETED ALREADY ════════════════ */}
      {phase === "completed-already" && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950 p-6">
          <div className="max-w-sm w-full text-center">
            <div className="w-24 h-24 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6">
              <svg className="w-12 h-12 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white mb-3">Interview Already Completed</h1>
            <p className="text-gray-400 text-sm leading-relaxed">
              You have already completed this interview.<br />
              The recruiting team will be in touch with you shortly.
            </p>
          </div>
        </div>
      )}

      {/* ════════════════ EXPIRED ════════════════ */}
      {phase === "expired" && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950 p-6">
          <div className="max-w-sm w-full text-center">
            <div className="w-24 h-24 rounded-full bg-orange-500/20 flex items-center justify-center mx-auto mb-6">
              <span className="text-5xl">⏰</span>
            </div>
            <h1 className="text-2xl font-bold text-white mb-3">Interview Link Expired</h1>
            <p className="text-gray-400 text-sm leading-relaxed">
              This interview link has expired.<br />
              Please contact your recruiter to reschedule.
            </p>
          </div>
        </div>
      )}

      {/* ════════════════ CANCELLED ════════════════ */}
      {phase === "cancelled" && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950 p-6">
          <div className="max-w-sm w-full text-center">
            <div className="w-24 h-24 rounded-full bg-yellow-500/20 flex items-center justify-center mx-auto mb-6">
              <span className="text-5xl">🚫</span>
            </div>
            <h1 className="text-2xl font-bold text-white mb-3">This Interview Has Been Cancelled</h1>
            <p className="text-gray-400 text-sm leading-relaxed">
              Please contact your recruiter for next steps.
            </p>
          </div>
        </div>
      )}

      {/* ════════════════ ERROR ════════════════ */}
      {phase === "error" && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950 p-6">
          <div className="max-w-sm w-full text-center">
            <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-white mb-3">Something went wrong</h1>
            <p className="text-red-400 text-sm mb-6 leading-relaxed">{errorMsg}</p>
            <button
              onClick={() => window.location.reload()}
              className="bg-gray-800 hover:bg-gray-700 text-white px-6 py-3 rounded-xl text-sm font-medium transition-colors border border-gray-700"
            >
              Try Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
