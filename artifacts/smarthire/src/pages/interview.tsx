// @ts-nocheck — legacy text-interview page, superseded by voice-interview.tsx
import React, { useState } from "react";
import { useLocation, useParams } from "wouter";
import { useGetInterview, useSubmitInterview, getGetInterviewQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, ArrowRight, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";

export default function InterviewPage() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const { data: interview, isLoading, isError } = useGetInterview(id, { 
    query: { 
      enabled: !!id, 
      queryKey: getGetInterviewQueryKey(id) 
    } 
  });

  const submitInterview = useSubmitInterview();

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4 text-slate-500">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p>Loading your interview session...</p>
        </div>
      </div>
    );
  }

  if (isError || !interview) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="text-red-600">Interview Not Found</CardTitle>
            <CardDescription>We couldn't load this interview session. The link might be invalid or expired.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (interview.status === "completed" || interview.status === "evaluating") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Card className="max-w-md w-full text-center p-6 border-none shadow-md">
          <div className="flex justify-center mb-4">
            <div className="h-16 w-16 bg-green-100 rounded-full flex items-center justify-center text-green-600">
              <CheckCircle className="h-8 w-8" />
            </div>
          </div>
          <h2 className="text-2xl font-bold tracking-tight mb-2">Interview Completed</h2>
          <p className="text-muted-foreground mb-6">
            Thank you for completing the interview for the {interview.jobTitle} position. Your responses have been submitted successfully.
          </p>
        </Card>
      </div>
    );
  }

  if (isSubmitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <Card className="max-w-lg w-full text-center border-none shadow-md bg-white">
          <CardHeader className="pt-8">
            <div className="flex justify-center mb-4">
              <div className="h-16 w-16 bg-green-100 rounded-full flex items-center justify-center text-green-600">
                <CheckCircle className="h-8 w-8" />
              </div>
            </div>
            <CardTitle className="text-2xl">Thank you, {interview.candidateName}!</CardTitle>
            <CardDescription className="text-base mt-2">
              Your interview is complete and has been submitted to the {interview.recruiterName}.
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-8 text-muted-foreground">
            You may now close this window. The recruiting team will review your responses and get back to you shortly.
          </CardContent>
        </Card>
      </div>
    );
  }

  const questions = interview.questions || [];
  const currentQuestion = questions[currentQuestionIndex];
  const isLastQuestion = currentQuestionIndex === questions.length - 1;
  const progress = ((currentQuestionIndex) / questions.length) * 100;
  
  const currentAnswer = answers[currentQuestion?.questionIndex] || "";

  const handleNext = () => {
    if (!currentAnswer.trim()) {
      toast({
        title: "Please provide an answer",
        description: "An answer is required to proceed to the next question.",
        variant: "destructive"
      });
      return;
    }

    if (isLastQuestion) {
      handleSubmit();
    } else {
      setCurrentQuestionIndex(prev => prev + 1);
    }
  };

  const handlePrevious = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
    }
  };

  const handleSubmit = () => {
    const formattedAnswers = Object.entries(answers).map(([index, text]) => ({
      questionIndex: parseInt(index, 10),
      answerText: text
    }));

    submitInterview.mutate({ id, data: { answers: formattedAnswers } }, {
      onSuccess: () => {
        setIsSubmitted(true);
        // We don't invalidate here because the candidate doesn't need to see the updated list
      },
      onError: (error) => {
        toast({
          title: "Submission Failed",
          description: error.error || "An error occurred while submitting your interview.",
          variant: "destructive"
        });
      }
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Candidate Header */}
      <header className="bg-white border-b py-4 px-6 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-semibold text-lg">AccionHire Assessment</h1>
            <p className="text-sm text-muted-foreground">{interview.jobTitle}</p>
          </div>
          <div className="text-sm font-medium text-slate-500">
            Candidate: {interview.candidateName}
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col max-w-3xl w-full mx-auto p-4 md:p-8 pt-8">
        <div className="mb-8">
          <div className="flex justify-between items-end mb-2">
            <h2 className="text-xl font-medium text-slate-700">
              Question {currentQuestionIndex + 1} <span className="text-slate-400 text-sm">of {questions.length}</span>
            </h2>
            <span className="text-sm font-medium text-slate-500 uppercase tracking-wider bg-slate-100 px-2 py-1 rounded">
              {currentQuestion?.questionType}
            </span>
          </div>
          <Progress value={progress} className="h-2 bg-slate-200" />
        </div>

        <Card className="flex-1 border-none shadow-md rounded-xl bg-white overflow-hidden flex flex-col">
          <CardHeader className="bg-slate-50 border-b pb-6 pt-8 px-6 sm:px-8">
            <CardTitle className="text-xl md:text-2xl leading-relaxed text-slate-800 font-medium">
              {currentQuestion?.questionText}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-6 sm:p-8 flex flex-col">
            <Textarea
              placeholder="Type your answer here..."
              className="flex-1 min-h-[250px] resize-none text-base p-4 bg-slate-50 border-slate-200 focus-visible:ring-accent focus-visible:bg-white transition-colors"
              value={currentAnswer}
              onChange={(e) => setAnswers(prev => ({ ...prev, [currentQuestion.questionIndex]: e.target.value }))}
              data-testid={`textarea-answer-${currentQuestionIndex}`}
            />
          </CardContent>
          <CardFooter className="bg-slate-50 border-t p-4 sm:px-8 flex justify-between">
            <Button 
              variant="outline" 
              onClick={handlePrevious} 
              disabled={currentQuestionIndex === 0 || submitInterview.isPending}
              data-testid="button-previous"
            >
              Previous
            </Button>
            <Button 
              onClick={handleNext} 
              disabled={submitInterview.isPending}
              className="bg-accent hover:bg-accent/90 text-white px-8"
              data-testid={isLastQuestion ? "button-submit" : "button-next"}
            >
              {submitInterview.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : isLastQuestion ? (
                "Submit Interview"
              ) : (
                <>
                  Next <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </CardFooter>
        </Card>
      </main>
    </div>
  );
}
