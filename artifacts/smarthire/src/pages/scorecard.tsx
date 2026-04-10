import React from "react";
import { useParams, Link } from "wouter";
import { useGetScorecard, getGetScorecardQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";
import { ArrowLeft, Clock, Calendar, Download, AlertCircle, Loader2 } from "lucide-react";
import { AppLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export default function ScorecardPage() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);

  const { data: scorecardData, isLoading, isError } = useGetScorecard(id, {
    query: {
      enabled: !!id,
      queryKey: getGetScorecardQueryKey(id)
    }
  });

  const handlePrint = () => {
    window.print();
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
    if (score >= 6) return "bg-yellow-500";
    return "bg-red-500";
  };

  const ScoreBar = ({ label, score }: { label: string, score: number }) => (
    <div className="space-y-2" data-testid={`score-bar-${label.toLowerCase().replace(/\s/g, '-')}`}>
      <div className="flex justify-between items-center text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="font-bold text-slate-900">{score.toFixed(1)}/10</span>
      </div>
      <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
        <div 
          className={`h-full rounded-full transition-all ${getScoreColorClass(score)}`} 
          style={{ width: `${score * 10}%` }}
        />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 pb-12 print:bg-white print:pb-0">
      <div className="container mx-auto px-4 max-w-5xl">
        {/* Navigation & Actions (No Print) */}
        <div className="py-6 flex items-center justify-between no-print">
          <Button variant="ghost" size="sm" asChild className="-ml-4 text-muted-foreground hover:text-foreground">
            <Link href="/">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint} className="gap-2" data-testid="button-export-pdf">
            <Download className="h-4 w-4" />
            Export PDF
          </Button>
        </div>

        {/* Scorecard Header */}
        <div className="bg-white rounded-xl shadow-sm border p-8 mb-6 print:shadow-none print:border-none print:px-0">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-bold text-slate-900 tracking-tight" data-testid="text-candidate-name">
                  {interview.candidateName}
                </h1>
                <Badge variant="outline" className={`px-3 py-1 text-sm font-semibold uppercase tracking-wider ${getVerdictStyle(scorecard.verdict)}`} data-testid="badge-verdict">
                  {scorecard.verdict}
                </Badge>
              </div>
              <p className="text-lg text-slate-600 mb-4 font-medium" data-testid="text-job-title">{interview.jobTitle}</p>
              
              <div className="flex items-center gap-6 text-sm text-slate-500">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  {format(new Date(scorecard.createdAt), "MMMM d, yyyy")}
                </div>
                {interview.duration && (
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    {Math.round(interview.duration / 60)} mins
                  </div>
                )}
              </div>
            </div>

            <div className="bg-slate-50 p-6 rounded-lg border text-center min-w-[200px] shrink-0">
              <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-1">Overall Score</p>
              <div className="text-5xl font-black text-slate-900" data-testid="text-overall-score">
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
                    {scorecard.strengths.map((s, i) => (
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
                    {scorecard.improvements.map((imp, i) => (
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

        {/* Transcript */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden print:shadow-none print:border">
          <div className="bg-slate-50 border-b px-6 py-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">Full Interview Transcript</h2>
            <Badge variant="secondary" className="font-mono">{questions.length} Questions</Badge>
          </div>
          
          <div className="divide-y divide-slate-100">
            {questions.map((q) => {
              const answer = answers.find(a => a.questionId === q.id);
              return (
                <div key={q.id} className="p-6 md:p-8 hover:bg-slate-50/50 transition-colors break-inside-avoid">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex gap-3">
                      <span className="flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-full bg-slate-100 text-slate-600 font-bold text-sm">
                        {q.questionIndex + 1}
                      </span>
                      <div>
                        <span className="inline-block px-2 py-0.5 bg-slate-100 text-slate-500 text-xs font-semibold uppercase tracking-wider rounded mb-2">
                          {q.questionType}
                        </span>
                        <h3 className="text-lg font-medium text-slate-900 leading-snug">{q.questionText}</h3>
                      </div>
                    </div>
                    {answer?.score && (
                      <div className="flex-shrink-0 text-center bg-slate-50 border rounded-md px-3 py-2">
                        <div className={`text-lg font-bold ${getScoreColorClass(answer.score).replace('bg-', 'text-').replace('500', '600')}`}>
                          {answer.score}/10
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <div className="pl-11 space-y-4">
                    <div className="bg-slate-50 rounded-lg p-5 border border-slate-100">
                      <p className="text-slate-700 whitespace-pre-wrap font-serif leading-relaxed">
                        {answer?.answerText || <span className="text-slate-400 italic">No answer provided</span>}
                      </p>
                    </div>
                    
                    {answer?.feedback && (
                      <div className="pl-4 border-l-2 border-accent/40 py-1">
                        <p className="text-sm text-slate-600">
                          <span className="font-semibold text-slate-800 mr-2">AI Evaluation:</span>
                          {answer.feedback}
                        </p>
                      </div>
                    )}
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