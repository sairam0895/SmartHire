import React, { useState, useEffect } from "react";
import { useParams, Link } from "wouter";
import { useGetScorecard, getGetScorecardQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";
import { ArrowLeft, Clock, Calendar, Download, AlertCircle, Loader2, Bot, Globe, Mail, Video } from "lucide-react";
import { AppLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import { apiFetch, apiUrl } from "@/lib/api";
const PDF_BASE = `${apiUrl}/api`;

export default function ScorecardPage() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);

  const { data: scorecardData, isLoading, isError } = useGetScorecard(id, {
    query: {
      enabled: !!id,
      queryKey: getGetScorecardQueryKey(id)
    }
  });

  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState<number | null>(null);
  const [recordingLoading, setRecordingLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    apiFetch(`/api/interviews/${id}/recording`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: { recordingUrl: string; durationSeconds: number | null }) => {
        setRecordingUrl(data.recordingUrl);
        setRecordingDuration(data.durationSeconds);
      })
      .catch(() => {
        // 404 = no recording or S3 not configured — leave recordingUrl null
      })
      .finally(() => setRecordingLoading(false));
  }, [id]);

  const handleExportPdf = () => {
    window.open(`${PDF_BASE}/scorecard/${id}/pdf`, "_blank");
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin mb-4" />
          <p>Loading candidate scorecard...</p>
        </div>
      </AppLayout>
    );
  }

  if (isError || !scorecardData) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh]">
          <AlertCircle className="h-12 w-12 text-destructive mb-4" />
          <h2 className="text-xl font-bold mb-2">Scorecard Not Available</h2>
          <p className="text-muted-foreground text-center max-w-md">
            This interview either hasn't been completed yet, or the scorecard is still generating.
          </p>
          <Button variant="outline" className="mt-6" asChild>
            <Link href="/">Return to Dashboard</Link>
          </Button>
        </div>
      </AppLayout>
    );
  }

  const { scorecard, interview, questions, answers } = scorecardData;

  const getVerdictStyle = (verdict: string) => {
    const v = verdict.toLowerCase();
    if (v.includes("strong")) return "bg-green-100 text-green-800 border-green-200";
    if (v.includes("hire") && !v.includes("no")) return "bg-teal-100 text-teal-800 border-teal-200";
    if (v.includes("maybe")) return "bg-yellow-100 text-yellow-800 border-yellow-200";
    return "bg-red-100 text-red-800 border-red-200";
  };

  const getScoreColorClass = (score: number) => {
    if (score >= 8) return "bg-green-500";
    if (score >= 6) return "bg-orange-400";
    return "bg-red-500";
  };

  const getScoreTextClass = (score: number) => {
    if (score >= 8) return "text-green-600";
    if (score >= 6) return "text-orange-500";
    return "text-red-600";
  };

  const ScoreBar = ({ label, score, isNA = false }: { label: string; score: number | null | undefined; isNA?: boolean }) => (
    <div className="space-y-2" data-testid={`score-bar-${label.toLowerCase().replace(/\s/g, '-')}`}>
      <div className="flex justify-between items-center text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        {isNA || score == null ? (
          <span className="text-xs font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded">N/A</span>
        ) : (
          <span className={`font-bold ${getScoreTextClass(score)}`}>{score.toFixed(1)}/10</span>
        )}
      </div>
      <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
        {!isNA && score != null ? (
          <div
            className={`h-full rounded-full transition-all ${getScoreColorClass(score)}`}
            style={{ width: `${score * 10}%` }}
          />
        ) : (
          <div className="h-full rounded-full bg-slate-200 w-full" />
        )}
      </div>
    </div>
  );

  const sourceBadge = interview.source === "bot" ? (
    <Badge variant="outline" className="gap-1 text-xs font-medium text-blue-700 border-blue-200 bg-blue-50">
      <Bot className="h-3 w-3" /> Teams Audio
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1 text-xs font-medium text-slate-600 border-slate-200 bg-slate-50">
      <Globe className="h-3 w-3" /> Web
    </Badge>
  );

  // Candidate initials for avatar
  const initials = interview.candidateName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const reportUrl = `${window.location.origin}/scorecard/${id}`;
  const mailtoReport = `mailto:?subject=${encodeURIComponent(
    `AccionHire Interview Report - ${interview.candidateName}`
  )}&body=${encodeURIComponent(
    `Interview completed for ${interview.candidateName} for ${interview.jobTitle}. Overall Score: ${scorecard.overallScore.toFixed(1)}/10. Verdict: ${scorecard.verdict}. View full report at: ${reportUrl}`
  )}`;

  return (
    <div className="min-h-screen bg-slate-50 pb-12 print:bg-white print:pb-0">
      <div className="container mx-auto px-4 max-w-5xl">
        {/* Navigation & Actions */}
        <div className="py-6 flex items-center justify-between no-print">
          <Button variant="ghost" size="sm" asChild className="-ml-4 text-muted-foreground hover:text-foreground">
            <Link href="/">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={mailtoReport} className="gap-2 flex items-center">
                <Mail className="h-4 w-4" />
                Send Report
              </a>
            </Button>
            <Button
              size="sm"
              onClick={handleExportPdf}
              className="gap-2 bg-accent hover:bg-accent/90 text-white"
              data-testid="button-export-pdf"
            >
              <Download className="h-4 w-4" />
              Export PDF
            </Button>
          </div>
        </div>

        {/* Scorecard Header */}
        <div className="bg-white rounded-xl shadow-sm border p-8 mb-6 print:shadow-none print:border-none print:px-0">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
            <div className="flex items-start gap-5">
              {/* Candidate avatar */}
              <div className="w-16 h-16 rounded-full bg-accent flex items-center justify-center flex-shrink-0 shadow-md">
                <span className="text-white text-xl font-bold">{initials}</span>
              </div>
              <div>
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <h1 className="text-3xl font-bold text-slate-900 tracking-tight" data-testid="text-candidate-name">
                    {interview.candidateName}
                  </h1>
                  <Badge variant="outline" className={`px-3 py-1 text-sm font-semibold uppercase tracking-wider ${getVerdictStyle(scorecard.verdict)}`} data-testid="badge-verdict">
                    {scorecard.verdict}
                  </Badge>
                  {sourceBadge}
                </div>
                <p className="text-lg text-slate-600 mb-4 font-medium" data-testid="text-job-title">{interview.jobTitle}</p>

                <div className="flex items-center gap-6 text-sm text-slate-500 flex-wrap">
                  <div className="flex items-center gap-2 font-medium text-slate-700">
                    <Calendar className="h-4 w-4 text-accent" />
                    {format(new Date(scorecard.createdAt), "MMMM d, yyyy")}
                  </div>
                  {interview.duration && (
                    <div className="flex items-center gap-2 font-medium text-slate-700">
                      <Clock className="h-4 w-4 text-accent" />
                      {Math.round(interview.duration / 60)} mins
                    </div>
                  )}
                  {interview.llmUsed && (
                    <div className="text-xs text-slate-400">
                      LLM: {interview.llmUsed === "llama3+gpt" ? "LLaMA 3 + GPT" : "GPT"}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-slate-50 p-6 rounded-lg border text-center min-w-[200px] shrink-0">
              <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-1">Overall Score</p>
              <div className={`text-5xl font-black ${getScoreTextClass(scorecard.overallScore)}`} data-testid="text-overall-score">
                {scorecard.overallScore.toFixed(1)}
              </div>
              <p className="text-sm text-slate-500 mt-1">out of 10</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {/* Component Scores */}
          <Card className="md:col-span-1 shadow-sm border-slate-200 print:shadow-none print:border">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Assessment Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <ScoreBar label="Technical Knowledge" score={scorecard.technicalScore} />
              <ScoreBar label="Problem Solving" score={scorecard.problemSolvingScore} />
              <ScoreBar label="Communication Clarity" score={scorecard.communicationScore} />
              <ScoreBar label="Role Relevance" score={scorecard.roleRelevanceScore} />
            </CardContent>
          </Card>

          {/* AI Summary & Recommendation */}
          <Card className="md:col-span-2 shadow-sm border-slate-200 print:shadow-none print:border">
            <CardHeader className="pb-4 border-b bg-slate-50/50">
              <CardTitle className="text-lg">Recruiter Summary</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div>
                <p className="text-slate-700 leading-relaxed" data-testid="text-summary">{scorecard.summary}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4 border-t">
                <div>
                  <h4 className="font-semibold text-green-800 flex items-center gap-2 mb-3">
                    <span className="h-6 w-6 rounded bg-green-100 flex items-center justify-center text-sm">+</span>
                    Key Strengths
                  </h4>
                  <ul className="space-y-2">
                    {scorecard.strengths.map((s: string, i: number) => (
                      <li key={i} className="text-sm text-slate-600 flex items-start gap-2">
                        <span className="text-green-500 mt-1">•</span> {s}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="font-semibold text-red-800 flex items-center gap-2 mb-3">
                    <span className="h-6 w-6 rounded bg-red-100 flex items-center justify-center text-sm">-</span>
                    Areas to Probe
                  </h4>
                  <ul className="space-y-2">
                    {scorecard.improvements.map((imp: string, i: number) => (
                      <li key={i} className="text-sm text-slate-600 flex items-start gap-2">
                        <span className="text-red-500 mt-1">•</span> {imp}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="bg-accent/5 border border-accent/20 rounded-lg p-4 mt-4">
                <h4 className="font-semibold text-accent mb-2 text-sm uppercase tracking-wider">Recommended Action</h4>
                <p className="text-slate-800 text-sm font-medium">{scorecard.recruiterNote}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Interview Recording */}
        {!recordingLoading && (
          recordingUrl ? (
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden mb-6 print:hidden">
              <div className="bg-slate-50 border-b px-6 py-4 flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Video className="h-5 w-5 text-accent" />
                  Interview Recording
                </h2>
                {recordingDuration != null && (
                  <Badge variant="secondary" className="font-mono">
                    {Math.floor(recordingDuration / 60)}:{String(recordingDuration % 60).padStart(2, "0")}
                  </Badge>
                )}
              </div>
              <div className="p-4">
                <video
                  src={recordingUrl}
                  controls
                  className="w-full rounded-lg"
                  style={{ maxHeight: "400px", background: "#0f172a" }}
                />
                <div className="flex justify-end mt-3">
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={recordingUrl}
                      download={`interview-${id}-recording.webm`}
                      className="gap-2 flex items-center"
                    >
                      <Download className="h-4 w-4" />
                      Download Recording
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center mb-4">
              No recording available for this interview.
            </p>
          )
        )}

        {/* Transcript */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden print:shadow-none print:border">
          <div className="bg-slate-50 border-b px-6 py-4">
            <h2 className="text-lg font-bold text-slate-900">Full Interview Transcript</h2>
          </div>

          <div className="divide-y divide-slate-100">
            {questions.map((q: { id: number; questionIndex: number; questionType: string; questionText: string }) => {
              const answer = answers.find((a: { questionId: number }) => a.questionId === q.id);
              const answerScore = answer?.score ?? null;

              return (
                <div key={q.id} className="p-6 md:p-8 hover:bg-slate-50/50 transition-colors break-inside-avoid">
                  {/* Interviewer question */}
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex items-start gap-3">
                      <span className="flex-shrink-0 mt-1 px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs font-semibold rounded whitespace-nowrap">
                        Interviewer
                      </span>
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="inline-block px-2 py-0.5 bg-slate-100 text-slate-500 text-xs font-semibold uppercase tracking-wider rounded">
                            {q.questionType}
                          </span>
                        </div>
                        <h3 className="text-lg font-medium text-slate-900 leading-snug">{q.questionText}</h3>
                      </div>
                    </div>
                    {answerScore != null && (
                      <div className="flex-shrink-0 text-center bg-slate-50 border rounded-md px-3 py-2">
                        <div className={`text-lg font-bold ${getScoreTextClass(answerScore)}`}>
                          {answerScore}/10
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Candidate answer */}
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <span className="flex-shrink-0 mt-1 px-2 py-0.5 bg-slate-100 text-slate-600 text-xs font-semibold rounded whitespace-nowrap">
                        Candidate
                      </span>
                      <div className="flex-1">
                        <div className="bg-slate-50 rounded-lg p-4 border border-slate-100">
                          <p className="text-slate-700 whitespace-pre-wrap font-serif leading-relaxed">
                            {answer?.answerText || <span className="text-slate-400 italic">No answer provided</span>}
                          </p>
                        </div>
                        {answer?.feedback && (
                          <div className="pl-4 border-l-2 border-accent/40 py-1 mt-2">
                            <p className="text-sm text-slate-600">
                              <span className="font-semibold text-slate-800 mr-2">AI Evaluation:</span>
                              {answer.feedback}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
