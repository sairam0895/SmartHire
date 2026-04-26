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
  | "cancelled"
  | "rejected"
  | "error";

interface InterviewData {
  id: number;
  candidateName: string;
  jobTitle: string;
  jobDescription: string;
  recruiterName: string;
  candidateEmail: string;
  scheduledAt: string | null;
  durationMinutes: number | null;
  timezone: string | null;
  status?: string;
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

// ─── Constants ────────────────────────────────────────────────────────────────

const GREETING =
  "Hi there! I am AccionHire, your AI interviewer today. It is so lovely to meet you! " +
  "This is a real conversation — no trick questions, just a genuine chat. " +
  "Take a breath, be yourself, and let us have a wonderful conversation. " +
  "To get us started — tell me about yourself and what has been the most exciting chapter of your career so far?";

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
  const [cameraCountdown, setCameraCountdown] = useState(30);

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
        if (raw.status === "cancelled") {
          setPhaseSync("cancelled");
          return;
        }
        data = raw;
      } else {
        const res = await fetch(`${API_BASE}/livekit/interview/${urlId}`);
        if (!res.ok) throw new Error("Interview not found");
        data = (await res.json()) as InterviewData;
      }

      setInterview(data);
      interviewRef.current = data;
      interviewIdRef.current = data.id;

      if (data.scheduledAt && secondsUntilActive(data.scheduledAt) > 0) {
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
    stopAudioRecorderInternal();
    stopCameraInternal();
    window.speechSynthesis.cancel();
  }

  // ─── Camera ──────────────────────────────────────────────────────────────
  async function startCamera(): Promise<boolean> {
    try {
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
        try {
          await videoRef.current.play();
        } catch {
          // autoplay attr handles it
        }
      }
      setIsCameraReady(true);
      return true;
    } catch (err) {
      console.warn("Camera/mic access failed:", err);
      setIsCameraReady(false);
      return false;
    }
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
        suspiciousRef.current.push(`Tab switch #${tabSwitchCountRef.current}`);
        if (tabSwitchCountRef.current === 2) {
          speak("Please keep this window active throughout the interview.");
        }
      }
    };
    const onBlur = () => {
      if (phaseRef.current !== "complete" && phaseRef.current !== "submitting" && phaseRef.current !== "rejected") {
        windowBlurRef.current++;
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

  function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    if (voices.length === 0) return null;
    return (
      voices.find((v) => v.name.includes("Heera")) ||
      voices.find((v) => v.name.includes("Neerja")) ||
      voices.find((v) => v.lang === "en-IN") ||
      voices.find((v) => v.name.includes("Zira")) ||
      voices.find((v) => v.name.includes("Samantha")) ||
      voices.find((v) => v.lang.startsWith("en")) ||
      null
    );
  }

  function speak(text: string, delayMs = 0): Promise<void> {
    return new Promise<void>((resolve) => {
      window.speechSynthesis.cancel();

      const doSpeak = () => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "en-IN";
        utterance.rate = 1.15;
        utterance.pitch = 1.4;
        utterance.volume = 1.0;

        const voices = voicesRef.current.length > 0
          ? voicesRef.current
          : window.speechSynthesis.getVoices();
        utterance.voice = pickVoice(voices);

        const resumeTimer = setInterval(() => {
          if (window.speechSynthesis.paused) window.speechSynthesis.resume();
        }, 200);

        utterance.onend = () => { clearInterval(resumeTimer); resolve(); };
        utterance.onerror = () => { clearInterval(resumeTimer); resolve(); };

        window.speechSynthesis.speak(utterance);
      };

      const fire = () => delayMs > 0 ? setTimeout(doSpeak, delayMs) : doSpeak();

      if (voicesRef.current.length > 0) {
        fire();
      } else {
        let called = false;
        const once = () => {
          if (called) return;
          called = true;
          const v = window.speechSynthesis.getVoices();
          if (v.length > 0) voicesRef.current = v;
          fire();
        };
        window.speechSynthesis.addEventListener("voiceschanged", once, { once: true });
        setTimeout(once, 600);
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
    audioChunksRef.current = [];
    isRecordingRef.current = true;
    setLiveTranscript("");

    const audioStream = new MediaStream(streamRef.current.getAudioTracks());
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    const recorder = new MediaRecorder(audioStream, { mimeType });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };
    audioRecorderRef.current = recorder;
    recorder.start(1000);
  }

  async function stopAndTranscribe(): Promise<string> {
    if (!audioRecorderRef.current || !isRecordingRef.current) return "";

    isRecordingRef.current = false;
    setLiveTranscript("Transcribing...");

    return new Promise((resolve) => {
      audioRecorderRef.current!.onstop = async () => {
        try {
          const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
          if (blob.size < 1000) {
            setLiveTranscript("");
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
      if (!track || track.readyState === "ended" || !track.enabled) {
        if (!cameraOffRef.current) handleCameraOff();
      }
    }, 2000);
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
      "I notice your camera has been turned off. Please turn it back on within 30 seconds to continue the interview."
    );

    setCameraCountdown(30);
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

          const isSkin =
            (r > 80 && g > 50 && b > 30 && r > g && r > b && r - b > 15 && r < 250) ||
            (r > 50 && g > 35 && b > 20 && r > b && r - b > 10 && g > b * 0.8);

          if (isSkin) skinPixels++;
        }
      }

      const skinRatio = skinPixels / totalPixels;
      const darkRatio = darkPixels / totalPixels;
      const faceVisible = skinRatio >= 0.02 && darkRatio < 0.60;

      if (!faceVisible) {
        noFaceCountRef.current++;
        if (noFaceCountRef.current >= 5) {
          noFaceCountRef.current = 0;
          faceViolationsRef.current++;
          faceWarningRef.current = true;
          setFaceWarning(true);

          window.speechSynthesis.cancel();

          if (faceViolationsRef.current >= 3) {
            handleRejected("Face not visible during interview");
            return;
          }

          const msg = new SpeechSynthesisUtterance(
            `I notice your face is not clearly visible. Please ensure your face is on camera. This is warning ${faceViolationsRef.current} of 3.`
          );
          window.speechSynthesis.speak(msg);
        }
      } else {
        noFaceCountRef.current = 0;
        if (faceWarningRef.current) {
          faceWarningRef.current = false;
          setFaceWarning(false);
        }
      }
    }, 2000);
  }

  function handleFaceNotDetected() {
    noFaceCountRef.current = 0;
    faceViolationsRef.current++;
    setFaceViolationCount(faceViolationsRef.current);
    faceWarningRef.current = true;
    setFaceWarning(true);

    window.speechSynthesis.cancel();

    if (faceViolationsRef.current >= 3) {
      handleRejected("Face not visible during interview");
      return;
    }

    speak(
      `I notice I cannot see your face clearly. Please make sure your face is visible on camera. This is warning ${faceViolationsRef.current} of 3. Repeated violations will end the interview.`
    );
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

  // ─── Gaze detection (every 3 seconds) ───────────────────────────────────
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

      // Measure skin pixel distribution left vs right half
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
      if (total < 50) return; // not enough face pixels
      const asymmetry = Math.abs(leftSkin - rightSkin) / total;

      if (asymmetry > 0.45) {
        gazeConsecutiveRef.current++;
        if (gazeConsecutiveRef.current >= 4) {
          gazeConsecutiveRef.current = 0;
          gazeAnomalyRef.current++;
          suspiciousRef.current.push(`Gaze anomaly #${gazeAnomalyRef.current}`);
          if (!gazeWarnedRef.current) {
            gazeWarnedRef.current = true;
            speak("Please look directly at the camera.");
            setTimeout(() => { gazeWarnedRef.current = false; }, 15000);
          }
        }
      } else {
        gazeConsecutiveRef.current = 0;
      }
    }, 3000);
  }

  // ─── Multiple person detection (every 5 seconds) ─────────────────────────
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

      // Cluster skin pixels horizontally — detect 2+ distinct clusters
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
      // Count distinct clusters
      let clusters = 0;
      let inCluster = false;
      for (let i = 0; i < 32; i++) {
        if (skinCols[i] && !inCluster) { clusters++; inCluster = true; }
        else if (!skinCols[i]) inCluster = false;
      }

      if (clusters >= 2) {
        multiPersonCountRef.current++;
        suspiciousRef.current.push(`Multiple persons detected #${multiPersonCountRef.current}`);
        if (!multiPersonWarnedRef.current) {
          multiPersonWarnedRef.current = true;
          speak("Please ensure you are alone during this interview.");
          setTimeout(() => { multiPersonWarnedRef.current = false; }, 20000);
        }
      }
    }, 5000);
  }

  // ─── Handle "Allow & Start" button ───────────────────────────────────────
  async function handleRequestPermissions() {
    setPhaseSync("camera-starting");
    await startCamera();
    startRecording();
    startElapsedTimer();
    startCameraMonitoring();
    startFaceDetection();
    startGazeDetection();
    startMultiplePersonDetection();

    setPhaseSync("greeting");
    setAiMessage(GREETING);
    addToConversation({ role: "ai", text: GREETING });
    await speak(GREETING, 150);

    setPhaseSync("listening");
    startListening();
  }

  // ─── Handle "Done Answering" button ──────────────────────────────────────
  async function handleDoneAnswering() {
    if (phaseRef.current !== "listening") return;
    if (!isRecordingRef.current) return;

    const transcript = await stopAndTranscribe();

    if (!transcript || transcript.trim().length < 3) {
      setLiveTranscript("Nothing captured — please try again");
      setTimeout(() => {
        setLiveTranscript("");
        startListening();
      }, 2000);
      return;
    }

    const answerText = transcript.trim();
    addToConversation({ role: "candidate", text: answerText });
    setPhaseSync("thinking");
    setLiveTranscript("");

    const data = interviewRef.current!;
    const currentConversation = [...conversationRef.current];
    const elapsed = elapsedSecondsRef.current;
    const durationSecs = (data.durationMinutes ?? 30) * 60;
    const forceComplete = elapsed >= durationSecs;

    try {
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
        addToConversation({ role: "ai", text: result.nextQuestion });
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
        className={`absolute inset-0 transition-opacity duration-500 ${
          isInterviewActive && isCameraReady ? "opacity-100" : "opacity-0"
        }`}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          transform: "scaleX(-1)",
          backgroundColor: "#000",
        }}
      />

      {/* Camera unavailable placeholder */}
      {isInterviewActive && !isCameraReady && (
        <div className="absolute inset-0 bg-gray-950 flex items-center justify-center">
          <div className="text-center">
            <div className="w-20 h-20 rounded-full bg-gray-800 flex items-center justify-center mx-auto mb-3">
              <svg className="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0121 8.882v6.236a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
              </svg>
            </div>
            <p className="text-gray-500 text-sm">Camera unavailable</p>
          </div>
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

      {/* ════════════════ FACE WARNING OVERLAY ════════════════ */}
      {faceWarning && !["complete", "rejected", "submitting"].includes(phase) && (
        <div style={{
          position: "absolute",
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: "rgba(0,0,0,0.85)",
          zIndex: 50,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
        }}>
          <div style={{ fontSize: 48 }}>⚠️</div>
          <h3 style={{ color: "#EF4444", fontSize: 20, fontWeight: 700 }}>
            Face Not Detected
          </h3>
          <p style={{ color: "white", textAlign: "center", maxWidth: 320 }}>
            Please ensure your face is clearly visible on camera.
          </p>
          <p style={{ color: "#F59E0B", fontSize: 13 }}>
            Warning {faceViolationsRef.current} of 3
          </p>
          <button
            onClick={() => { faceWarningRef.current = false; setFaceWarning(false); }}
            style={{
              background: "#6366F1",
              border: "none",
              borderRadius: 8,
              padding: "10px 24px",
              color: "white",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            My Face is Visible — Continue
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

          {/* AccionHire avatar */}
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
            <div style={{ width: 44, height: 44, borderRadius: "50%", backgroundColor: "#6366F1", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700, color: "white", flexShrink: 0, position: "relative" }}>
              A
              <div style={{ position: "absolute", bottom: 2, right: 2, width: 10, height: 10, backgroundColor: "#10B981", borderRadius: "50%", border: "2px solid #1E293B" }} />
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                <span style={{ color: "#CE3D3A" }}>Accion</span><span style={{ color: "#555555" }}>Hire</span>
              </div>
              <div style={{ color: isAISpeaking ? "#6366F1" : "#94A3B8", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                {isAISpeaking ? (
                  <>
                    <span style={{ display: "flex", gap: 2, alignItems: "center" }}>
                      {[1, 2, 3, 4].map((i) => (
                        <div key={i} style={{ width: 3, backgroundColor: "#6366F1", borderRadius: 2, height: i % 2 === 0 ? 12 : 8 }} />
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
                    <span className="text-xs font-semibold">
                      <span style={{ color: "#CE3D3A" }}>Accion</span><span style={{ color: "#555555" }}>Hire</span>
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
                <p className="text-center text-gray-600 text-xs pb-1">AccionHire is speaking — please listen</p>
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
