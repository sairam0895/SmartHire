import React, { useState } from "react";
import { useLocation } from "wouter";
import { useCreateInterview, getListInterviewsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useToast } from "@/hooks/use-toast";
import { AppLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Loader2, Copy, Check, ExternalLink, ArrowRight } from "lucide-react";

const formSchema = z.object({
  recruiterName: z.string().min(2, "Recruiter name is required"),
  candidateName: z.string().min(2, "Candidate name is required"),
  candidateEmail: z.string().email("Invalid email address"),
  jobTitle: z.string().min(2, "Job title is required"),
  jobDescription: z.string().min(20, "Job description needs to be more detailed (min 20 chars)"),
});

export default function CreateInterview() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createInterview = useCreateInterview();
  
  const [createdData, setCreatedData] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      recruiterName: "",
      candidateName: "",
      candidateEmail: "",
      jobTitle: "",
      jobDescription: "",
    },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    createInterview.mutate({ data: values }, {
      onSuccess: (data) => {
        setCreatedData(data);
        queryClient.invalidateQueries({ queryKey: getListInterviewsQueryKey() });
        toast({
          title: "Interview generated successfully",
          description: "AI has created the questions based on the job description.",
        });
      },
      onError: (error) => {
        toast({
          variant: "destructive",
          title: "Failed to generate interview",
          description: error.error || "An unexpected error occurred.",
        });
      }
    });
  }

  const interviewUrl = createdData ? `${window.location.origin}/interview/${createdData.id}` : "";

  const copyToClipboard = () => {
    navigator.clipboard.writeText(interviewUrl);
    setCopied(true);
    toast({
      title: "Link copied!",
      description: "You can now share this with the candidate.",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Create New Interview</h1>
          <p className="text-muted-foreground mt-1">
            Provide the role details, and our AI will generate a tailored first-round interview.
          </p>
        </div>

        {!createdData ? (
          <Card>
            <CardHeader>
              <CardTitle>Interview Details</CardTitle>
              <CardDescription>All fields are required to generate an accurate assessment.</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" data-testid="form-create-interview">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField
                      control={form.control}
                      name="recruiterName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Recruiter Name</FormLabel>
                          <FormControl>
                            <Input placeholder="Jane Doe" {...field} data-testid="input-recruiter-name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="candidateName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Candidate Name</FormLabel>
                          <FormControl>
                            <Input placeholder="John Smith" {...field} data-testid="input-candidate-name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="candidateEmail"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Candidate Email</FormLabel>
                          <FormControl>
                            <Input placeholder="john@example.com" type="email" {...field} data-testid="input-candidate-email" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="jobTitle"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Job Title</FormLabel>
                          <FormControl>
                            <Input placeholder="Senior Frontend Engineer" {...field} data-testid="input-job-title" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="jobDescription"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Job Description</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Paste the full job description here..." 
                            className="min-h-[200px]"
                            {...field} 
                            data-testid="input-job-description"
                          />
                        </FormControl>
                        <FormDescription>
                          The AI will analyze this to generate relevant technical and behavioral questions.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex justify-end">
                    <Button 
                      type="submit" 
                      disabled={createInterview.isPending}
                      className="bg-accent hover:bg-accent/90 text-white min-w-[200px]"
                      data-testid="button-generate"
                    >
                      {createInterview.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Generating AI Interview...
                        </>
                      ) : (
                        "Generate Interview"
                      )}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <Card className="border-accent">
              <CardHeader className="bg-accent/5 rounded-t-lg">
                <CardTitle className="text-accent flex items-center gap-2">
                  <CheckCircle className="h-5 w-5" />
                  Interview Ready
                </CardTitle>
                <CardDescription>Share this link with the candidate to begin their assessment.</CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 p-3 bg-muted rounded-md border">
                  <Input readOnly value={interviewUrl} className="bg-transparent border-none font-mono text-sm focus-visible:ring-0" data-testid="input-share-link" />
                  <Button variant="outline" size="icon" onClick={copyToClipboard} data-testid="button-copy-link">
                    {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  </Button>
                  <Button variant="default" size="icon" onClick={() => window.open(interviewUrl, '_blank')} className="bg-primary" data-testid="button-open-link">
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
              <CardFooter className="flex justify-between bg-muted/20 border-t p-4">
                <Button variant="outline" onClick={() => navigate("/")}>Back to Dashboard</Button>
                <Button onClick={() => navigate(`/interview/${createdData.id}`)} className="gap-2">
                  Preview as Candidate <ArrowRight className="h-4 w-4" />
                </Button>
              </CardFooter>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Generated Questions Review</CardTitle>
                <CardDescription>AI generated {createdData.questions?.length} questions based on the job description.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {createdData.questions?.map((q: any, i: number) => (
                    <div key={q.id} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-lg text-primary">Q{i + 1}.</span>
                        <span className="text-sm font-medium uppercase tracking-wider text-muted-foreground px-2 py-1 bg-muted rounded-full">
                          {q.questionType}
                        </span>
                      </div>
                      <p className="text-base pl-8 border-l-2 border-muted leading-relaxed">
                        {q.questionText}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function CheckCircle(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}