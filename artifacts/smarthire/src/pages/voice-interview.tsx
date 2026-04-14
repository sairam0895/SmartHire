import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";

type InterviewStatus =
  | "connecting"
  | "ready"
  | "speaking"
  | "listening"
  | "processing"
  | "complete"
  | "error";

interface Answer {
  questionIndex: number;
  questionText: string;
  answerText: string;
  duration: number;
}

export default function VoiceInterview() {
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<InterviewStatus>("connecting");
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [transcript, setTranscript] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [timeLeft, setTimeLeft] = useState(60);
  const [candidateName, setCandidateName] = useState("Candidate");
  const [jobTitle, setJobTitle] = useState("Software Engineer");
  const [jobDescription, setJobDescription] = useState("");
  const [cameraReady, setCameraReady] = useState(false);

  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesisUtterance | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const answerStartRef = useRef<number>(0);
  const questionsRef = useRef<string[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const idFromUrl = Number(window.location.pathname.split("/").pop());

  useEffect(() => {
    if (idFromUrl) {
      loadInterview(idFromUrl);
    }
    return () => {
      stopCamera();
      window.speechSynthesis.cancel();
    };
  }, []);

  async function loadInterview(id: number) {
    try {
      const res = await fetch(`http://localhost:8080/api/livekit/interview/${id}`);
      if (!res.ok) throw new Error("Interview not found");
      const interview = await res.json();

      setCandidateName(interview.candidateName ?? "Candidate");
      setJobTitle(interview.jobTitle ?? "Software Engineer");
      setJobDescription(interview.jobDescription ?? "");

      const qRes = await fetch("http://localhost:8080/api/interviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recruiterName: interview.recruiterName,
          candidateName: interview.candidateName,
          candidateEmail: interview.candidateEmail,
          jobTitle: interview.jobTitle,
          jobDescription: interview.jobDescription,
        }),
      });

      const qData = await qRes.json();
      const qs = qData.questions?.map((q: any) => q.questionText) ?? [];
      setQuestions(qs);
      questionsRef.current = qs;
      setStatus("ready");
    } catch (err) {
      setErrorMsg("Failed to load interview. Please try again.");
      setStatus("error");
    }
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: "user" },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      // Start recording
      const recorder = new MediaRecorder(stream, {
        mimeType: "video/webm;codecs=vp9,opus",
      });
      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.start(1000);
      mediaRecorderRef.current = recorder;

      setCameraReady(true);
    } catch (err) {
      console.error("Camera access failed:", err);
      // Continue without camera
      setCameraReady(false);
    }
  }

  function stopCamera() {
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setCameraReady(false);
  }

  async function handleStartClick() {
    await startCamera();
    startInterview(questionsRef.current);
  }

  function startInterview(qs: string[]) {
    setCurrentQuestion(0);
    askQuestion(0, qs);
  }

  function askQuestion(index: number, qs: string[]) {
    if (index >= qs.length) {
      finishInterview();
      return;
    }

    setCurrentQuestion(index);
    setTranscript("");
    setStatus("speaking");

    const questionText = `Question ${index + 1} of ${qs.length}. ${qs[index]}`;
    speak(questionText, () => {
      setStatus("listening");
      answerStartRef.current = Date.now();
      startListening(index, qs);
      startTimer(index, qs);
    });
  }

  function speak(text: string, onEnd?: () => void) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.volume = 1;

    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(
      (v) =>
        v.name.includes("Google") ||
        v.name.includes("Natural") ||
        v.name.includes("Neural")
    );
    if (preferred) utterance.voice = preferred;

    utterance.onend = () => onEnd?.();
    synthRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }

  function startListening(index: number, qs: string[]) {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setErrorMsg("Speech recognition not supported. Please use Chrome.");
      setStatus("error");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      setTranscript(final || interim);
    };

    recognition.onerror = (event: any) => {
      if (event.error !== "no-speech") {
        console.error("Speech recognition error:", event.error);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }

  function startTimer(index: number, qs: string[]) {
    setTimeLeft(60);
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          submitAnswer(index, qs);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  function submitAnswer(index: number, qs: string[]) {
    if (timerRef.current) clearInterval(timerRef.current);
    if (recognitionRef.current) recognitionRef.current.stop();

    setStatus("processing");
    const duration = Math.round((Date.now() - answerStartRef.current) / 1000);

    setAnswers((prev) => {
      const newAnswers = [
        ...prev,
        {
          questionIndex: index,
          questionText: qs[index] ?? "",
          answerText: transcript || "No answer provided",
          duration,
        },
      ];

      setTimeout(() => {
        if (index + 1 < qs.length) {
          speak("Got it. Next question.", () => {
            askQuestion(index + 1, qs);
          });
        } else {
          finishInterview(newAnswers);
        }
      }, 1000);

      return newAnswers;
    });
  }

  async function finishInterview(finalAnswers?: Answer[]) {
    stopCamera();
    setStatus("complete");
    window.speechSynthesis.cancel();

    speak(
      "Thank you for completing the interview. I am now evaluating your responses. " +
        "The recruiter will receive a detailed report shortly."
    );

    const answersToSubmit = finalAnswers ?? answers;

    try {
      const res = await fetch("http://localhost:8080/api/bot/submit-interview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "smarthire-bot-key",
        },
        body: JSON.stringify({
          candidateName,
          recruiterEmail: "recruiter@company.com",
          jobTitle,
          jobDescription,
          answers: answersToSubmit.map((a) => ({
            questionText: a.questionText,
            answerText: a.answerText,
            confidenceScore: null,
            fillerWordCount: null,
            pauseCount: null,
            speechDurationSeconds: a.duration,
          })),
        }),
      });

      if (res.ok) {
        const result = await res.json();
        setTimeout(() => {
          navigate(`/scorecard/${result.interviewId}`);
        }, 5000);
      }
    } catch (err) {
      console.error("Failed to submit:", err);
    }
  }

  const handleNextAnswer = () => {
    if (status !== "listening") return;
    submitAnswer(currentQuestion, questions);
  };

  const statusMessages: Record<InterviewStatus, string> = {
    connecting: "Loading interview...",
    ready: "Ready to begin",
    speaking: "SmartHire is speaking...",
    listening: "Listening to your answer...",
    processing: "Processing your answer...",
    complete: "Interview complete! Evaluating responses...",
    error: errorMsg,
  };

  const statusColors: Record<InterviewStatus, string> = {
    connecting: "bg-gray-500",
    ready: "bg-blue-500",
    speaking: "bg-purple-500",
    listening: "bg-green-500",
    processing: "bg-yellow-500",
    complete: "bg-green-600",
    error: "bg-red-500",
  };

  const isActive =
    status === "speaking" ||
    status === "listening" ||
    status === "processing";

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6">
      {/* Header */}
      <div className="text-center mb-6">
        <h1 className="text-3xl font-bold text-white mb-1">SmartHire</h1>
        <p className="text-gray-400 text-sm">AI Video Interview</p>
      </div>

      {/* Status */}
      <div className="flex items-center gap-3 mb-6">
        <div className={`w-3 h-3 rounded-full ${statusColors[status]} animate-pulse`} />
        <span className="text-gray-300 text-sm">{statusMessages[status]}</span>
      </div>

      {/* Main layout — side by side when active */}
      <div className={`w-full ${isActive ? "max-w-5xl flex gap-6" : "max-w-2xl"}`}>

        {/* Video feed — shown during active interview */}
        {isActive && (
          <div className="flex-1">
            <div className="relative rounded-2xl overflow-hidden bg-gray-900 border border-gray-800"
              style={{ aspectRatio: "16/9" }}>
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover"
                style={{ transform: "scaleX(-1)" }}
              />

              {/* Camera off fallback */}
              {!cameraReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                  <div className="text-center">
                    <div className="text-5xl mb-2">👤</div>
                    <p className="text-gray-500 text-sm">Camera unavailable</p>
                  </div>
                </div>
              )}

              {/* Name badge */}
              <div className="absolute bottom-3 left-3 bg-black/70 rounded-lg px-3 py-1">
                <span className="text-white text-sm font-medium">
                  📹 {candidateName}
                </span>
              </div>

              {/* LIVE badge */}
              <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-red-600/90 rounded-full px-3 py-1">
                <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                <span className="text-white text-xs font-bold tracking-wide">REC</span>
              </div>

              {/* AI Speaking overlay */}
              {status === "speaking" && (
                <div className="absolute bottom-3 right-3 bg-purple-600/90 rounded-lg px-3 py-1 flex items-center gap-2">
                  <div className="flex gap-0.5">
                    {[...Array(4)].map((_, i) => (
                      <div
                        key={i}
                        className="w-1 bg-white rounded-full animate-pulse"
                        style={{
                          height: `${8 + i * 3}px`,
                          animationDelay: `${i * 0.15}s`,
                        }}
                      />
                    ))}
                  </div>
                  <span className="text-white text-xs">AI Speaking</span>
                </div>
              )}

              {/* Listening indicator */}
              {status === "listening" && (
                <div className="absolute bottom-3 right-3 bg-green-600/90 rounded-lg px-3 py-1 flex items-center gap-2">
                  <div className="flex gap-0.5">
                    {[...Array(4)].map((_, i) => (
                      <div
                        key={i}
                        className="w-1 bg-white rounded-full animate-pulse"
                        style={{
                          height: `${8 + i * 3}px`,
                          animationDelay: `${i * 0.1}s`,
                        }}
                      />
                    ))}
                  </div>
                  <span className="text-white text-xs">Listening</span>
                </div>
              )}
            </div>

            {/* Timer below video */}
            {status === "listening" && (
              <div className="mt-3 flex items-center justify-between px-1">
                <span className="text-gray-500 text-xs">Time remaining</span>
                <span className={`text-sm font-bold ${timeLeft <= 10 ? "text-red-400" : "text-gray-300"}`}>
                  {timeLeft}s
                </span>
              </div>
            )}
          </div>
        )}

        {/* Right panel / main card */}
        <div className={`${isActive ? "w-80 flex-shrink-0" : "w-full"} bg-gray-900 rounded-2xl p-6 border border-gray-800`}>

          {/* CONNECTING */}
          {status === "connecting" && (
            <div className="text-center py-8">
              <div className="text-4xl mb-4 animate-spin">⏳</div>
              <p className="text-gray-400">Loading your interview...</p>
            </div>
          )}

          {/* READY */}
          {status === "ready" && (
            <div className="text-center py-4">
              <div className="text-5xl mb-4">🎥</div>
              <h2 className="text-xl font-semibold text-white mb-2">
                Hello, {candidateName}!
              </h2>
              <p className="text-gray-400 text-sm mb-2">
                Role: <strong className="text-orange-400">{jobTitle}</strong>
              </p>
              <p className="text-gray-500 text-sm mb-8">
                <strong>{questions.length} questions</strong> · 60 seconds each<br />
                Camera + microphone will be requested.<br />
                Speak clearly and look at the camera.
              </p>
              <button
                onClick={handleStartClick}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-4 px-8 rounded-xl text-lg transition-all transform hover:scale-105"
              >
                🎥 Start Interview
              </button>
              <p className="text-gray-600 text-xs mt-3">
                Chrome recommended · Allow camera & mic access
              </p>
            </div>
          )}

          {/* ACTIVE INTERVIEW */}
          {isActive && (
            <>
              {/* Progress */}
              <div className="mb-4">
                <div className="flex justify-between text-xs text-gray-400 mb-2">
                  <span>Q{currentQuestion + 1} of {questions.length}</span>
                  <span className="text-orange-400 font-medium">
                    {Math.round((currentQuestion / questions.length) * 100)}% done
                  </span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-1.5">
                  <div
                    className="bg-orange-500 h-1.5 rounded-full transition-all duration-500"
                    style={{ width: `${(currentQuestion / questions.length) * 100}%` }}
                  />
                </div>
              </div>

              {/* Question */}
              <div className="mb-4">
                <p className="text-xs text-orange-400 uppercase tracking-wider mb-2">
                  Question {currentQuestion + 1}
                </p>
                <p className="text-white text-sm leading-relaxed">
                  {questions[currentQuestion]}
                </p>
              </div>

              {/* Live transcript */}
              {status === "listening" && transcript && (
                <div className="bg-gray-800 rounded-xl p-3 mb-4 border border-gray-700">
                  <p className="text-xs text-gray-500 mb-1">Your answer</p>
                  <p className="text-white text-xs leading-relaxed">{transcript}</p>
                </div>
              )}

              {/* Done button */}
              {status === "listening" && (
                <button
                  onClick={handleNextAnswer}
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 px-4 rounded-xl transition-colors text-sm"
                >
                  ✓ Done — Next Question
                </button>
              )}

              {status === "processing" && (
                <div className="text-center py-4">
                  <p className="text-yellow-400 text-sm animate-pulse">
                    ⏳ Processing...
                  </p>
                </div>
              )}

              {/* Previous answers */}
              {answers.length > 0 && (
                <div className="mt-4 border-t border-gray-800 pt-4">
                  <p className="text-xs text-gray-600 uppercase tracking-wider mb-2">
                    Completed
                  </p>
                  <div className="space-y-1">
                    {answers.map((a, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                          <span className="text-green-400 text-xs">✓</span>
                        </div>
                        <p className="text-gray-500 text-xs truncate">Q{i + 1}: {a.answerText}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* COMPLETE */}
          {status === "complete" && (
            <div className="text-center py-4">
              <div className="text-6xl mb-4">✅</div>
              <h2 className="text-xl font-semibold text-white mb-2">
                Interview Complete!
              </h2>
              <p className="text-gray-400 text-sm mb-6">
                Evaluating your responses...<br />
                Redirecting to scorecard shortly.
              </p>
              <div className="space-y-2 text-left">
                {answers.map((a, i) => (
                  <div key={i} className="bg-gray-800 rounded-lg p-3">
                    <p className="text-xs text-orange-400 mb-1">Q{i + 1}</p>
                    <p className="text-xs text-gray-300 truncate">{a.answerText}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ERROR */}
          {status === "error" && (
            <div className="text-center py-4">
              <div className="text-5xl mb-4">❌</div>
              <p className="text-red-400 text-sm">{errorMsg}</p>
            </div>
          )}
        </div>
      </div>

      <p className="text-gray-700 text-xs mt-6">
        Powered by SmartHire AI · Chrome recommended
      </p>
    </div>
  );
}