import React, { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { format } from "date-fns";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Loader2, Copy, Check, ExternalLink, ArrowRight, Mail, Calendar, Clock, CheckCircle2 } from "lucide-react";
import { apiFetch } from "@/lib/api";

const formSchema = z.object({
  recruiterName: z.string().min(2, "Recruiter name is required"),
  candidateName: z.string().min(2, "Candidate name is required"),
  candidateEmail: z.string().email("Invalid email address"),
  jobTitle: z.string().min(2, "Job title is required"),
  jobDescription: z.string().min(50, "Please provide a more detailed job description (minimum 50 characters). This helps AccionHire ask relevant questions."),
  interviewDate: z.string().optional(),
  interviewTime: z.string().optional(),
  durationMinutes: z.number().int().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface CreatedInterview {
  id: number;
  candidateName: string;
  candidateEmail: string;
  jobTitle: string;
  scheduledAt: string | null;
  durationMinutes: number | null;
  candidateToken: string | null;
}

export default function CreateInterview() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [createdData, setCreatedData] = useState<CreatedInterview | null>(null);
  const [copied, setCopied] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [jdUploaded, setJdUploaded] = useState(false);
  const [jdUploading, setJdUploading] = useState(false);

  const [timezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

  const form = useForm<FormValues>({
    defaultValues: {
      recruiterName: "",
      candidateName: "",
      candidateEmail: "",
      jobTitle: "",
      jobDescription: "",
      interviewDate: "",
      interviewTime: "",
      durationMinutes: 30,
    },
  });

  async function onSubmit(values: FormValues) {
    setIsSubmitting(true);
    try {
      const scheduledAt =
        values.interviewDate && values.interviewTime
          ? new Date(`${values.interviewDate}T${values.interviewTime}:00`).toISOString()
          : null;

      const res = await apiFetch("/api/interviews", {
        method: "POST",
        body: JSON.stringify({
          recruiterName: values.recruiterName,
          candidateName: values.candidateName,
          candidateEmail: values.candidateEmail,
          jobTitle: values.jobTitle,
          jobDescription: values.jobDescription,
          scheduledAt,
          durationMinutes: values.durationMinutes ?? 30,
          timezone,
        }),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Failed to create interview");
      }

      const data = (await res.json()) as CreatedInterview;
      setCreatedData(data);
      queryClient.invalidateQueries({ queryKey: ["interviews"] });
      toast({
        title: "Interview created",
        description: "Share the link below with the candidate.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed to create interview",
        description: err instanceof Error ? err.message : "An unexpected error occurred.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleJdUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !createdData) return;
    setJdUploading(true);
    const formData = new FormData();
    formData.append("jd", file, file.name);
    try {
      const res = await apiFetch(`/api/interviews/${createdData.id}/upload-jd`, {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        setJdUploaded(true);
        toast({ title: "JD uploaded", description: "AI will use this to tailor interview questions." });
      } else {
        toast({ variant: "destructive", title: "Upload failed", description: "Could not upload JD file." });
      }
    } catch {
      toast({ variant: "destructive", title: "Upload failed", description: "Network error." });
    } finally {
      setJdUploading(false);
    }
  }

  const interviewUrl = createdData
    ? `${window.location.origin}/interview/${createdData.candidateToken ?? createdData.id}`
    : "";

  const copyToClipboard = () => {
    navigator.clipboard.writeText(interviewUrl);
    setCopied(true);
    toast({ title: "Link copied!", description: "Share this with the candidate." });
    setTimeout(() => setCopied(false), 2000);
  };

  const scheduledLabel = (() => {
    if (!createdData?.scheduledAt) return null;
    const d = new Date(createdData.scheduledAt);
    return {
      date: format(d, "EEEE, MMMM d, yyyy"),
      time: format(d, "h:mm a"),
    };
  })();

  const mailtoLink = (() => {
    if (!createdData) return "#";
    const subject = encodeURIComponent(
      `AccionHire Interview Invitation — ${createdData.jobTitle}`
    );
    const bodyLines = [
      `Dear ${createdData.candidateName},`,
      "",
      `You have been invited to an AccionHire AI interview for the role of ${createdData.jobTitle}.`,
      "",
      scheduledLabel ? `📅 Scheduled: ${scheduledLabel.date} at ${scheduledLabel.time}` : "",
      scheduledLabel ? `⏱ Duration: ${createdData.durationMinutes ?? 30} minutes` : "",
      scheduledLabel ? "" : "",
      `Please join your interview using the link below:`,
      interviewUrl,
      "",
      scheduledLabel ? "Note: The link activates 10 minutes before your interview time." : "",
      "",
      "Best of luck!",
      "AccionHire Team",
    ]
      .filter((l) => l !== undefined)
      .join("\n");

    return `mailto:${createdData.candidateEmail}?subject=${subject}&body=${encodeURIComponent(bodyLines)}`;
  })();

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Create New Interview</h1>
          <p className="text-muted-foreground mt-1">
            Provide the role details and our AI will conduct a fully dynamic interview.
          </p>
        </div>

        {!createdData ? (
          <Card>
            <CardHeader>
              <CardTitle>Interview Details</CardTitle>
              <CardDescription>
                All candidate and role fields are required. Schedule fields are optional.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="space-y-6"
                  data-testid="form-create-interview"
                >
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
                            <Input
                              placeholder="john@example.com"
                              type="email"
                              {...field}
                              data-testid="input-candidate-email"
                            />
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
                            <Input
                              placeholder="Senior Frontend Engineer"
                              {...field}
                              data-testid="input-job-title"
                            />
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
                          The AI will use this to ask dynamic, role-relevant questions throughout the interview.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Separator />

                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-1">Schedule (Optional)</h3>
                    <p className="text-xs text-muted-foreground mb-4">
                      Leave blank for an always-active link (useful for demos and testing).
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <FormField
                        control={form.control}
                        name="interviewDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex items-center gap-1.5">
                              <Calendar className="h-3.5 w-3.5" /> Interview Date
                            </FormLabel>
                            <FormControl>
                              <Input type="date" {...field} data-testid="input-interview-date" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="interviewTime"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex items-center gap-1.5">
                              <Clock className="h-3.5 w-3.5" /> Interview Time
                            </FormLabel>
                            <FormControl>
                              <Input type="time" {...field} data-testid="input-interview-time" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="durationMinutes"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Duration</FormLabel>
                            <Select
                              onValueChange={(v) => field.onChange(Number(v))}
                              defaultValue={String(field.value ?? 30)}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="select-duration">
                                  <SelectValue placeholder="Select duration" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="2">2 min (Test only)</SelectItem>
                                <SelectItem value="15">15 minutes</SelectItem>
                                <SelectItem value="30">30 minutes</SelectItem>
                                <SelectItem value="45">45 minutes</SelectItem>
                                <SelectItem value="60">60 minutes</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="mt-4">
                      <p className="text-xs font-medium text-muted-foreground mb-1">Timezone (auto-detected)</p>
                      <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-md border text-sm text-muted-foreground">
                        🌐 {timezone}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="text-white min-w-[200px]"
                      style={{ backgroundColor: '#6366F1' }}
                      data-testid="button-generate"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Creating Interview...
                        </>
                      ) : (
                        "Create Interview"
                      )}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* ── Interview Ready Card ── */}
            <Card className="border-accent">
              <CardHeader className="bg-accent/5 rounded-t-lg">
                <CardTitle className="text-accent flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5" />
                  Interview Ready
                </CardTitle>
                <CardDescription>
                  Share this link with the candidate to begin their AI interview.
                </CardDescription>
              </CardHeader>

              <CardContent className="pt-6 space-y-5">
                {/* Share link */}
                <div className="flex items-center gap-2 p-3 bg-muted rounded-md border">
                  <Input
                    readOnly
                    value={interviewUrl}
                    className="bg-transparent border-none font-mono text-sm focus-visible:ring-0"
                    data-testid="input-share-link"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={copyToClipboard}
                    data-testid="button-copy-link"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="default"
                    size="icon"
                    onClick={() => window.open(interviewUrl, "_blank")}
                    className="text-white"
                    style={{ backgroundColor: '#6366F1' }}
                    data-testid="button-open-link"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>

                {/* Schedule summary */}
                {scheduledLabel && (
                  <div className="rounded-lg border bg-blue-50/50 dark:bg-blue-950/20 p-4 space-y-2">
                    <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400">
                      <Calendar className="h-4 w-4" />
                      <span className="font-semibold text-sm">Scheduled Interview</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Date</span>
                        <p className="font-medium">{scheduledLabel.date}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Time</span>
                        <p className="font-medium">{scheduledLabel.time}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Duration</span>
                        <p className="font-medium">{createdData.durationMinutes ?? 30} minutes</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Timezone</span>
                        <p className="font-medium text-xs">{timezone}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Activation note */}
                <div className="flex items-start gap-2 text-sm text-muted-foreground bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/40 rounded-lg px-3 py-2.5">
                  <Clock className="h-4 w-4 mt-0.5 text-amber-600 flex-shrink-0" />
                  <span>
                    {scheduledLabel
                      ? "This link activates 10 minutes before the scheduled interview time. Candidates opening it earlier will see a waiting screen."
                      : "No schedule set — this link is always active. Useful for demos and testing."}
                  </span>
                </div>
              </CardContent>

              <CardFooter className="flex flex-wrap justify-between gap-2 bg-muted/20 border-t p-4">
                <Button variant="outline" onClick={() => navigate("/")}>
                  Back to Dashboard
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" asChild>
                    <a href={mailtoLink} className="gap-2 flex items-center">
                      <Mail className="h-4 w-4" />
                      Send Email
                    </a>
                  </Button>
                  <Button
                    onClick={() => window.open(interviewUrl, "_blank")}
                    className="gap-2"
                  >
                    Preview as Candidate <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </CardFooter>
            </Card>
            {/* ── JD Upload Card ── */}
            <Card className="border-slate-200">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  📄 Upload Full JD File <span className="text-xs font-normal text-muted-foreground">(Optional — improves AI question targeting)</span>
                </CardTitle>
                <CardDescription>
                  Upload a PDF or Word version of the JD to give the AI deeper context for this interview.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {jdUploaded ? (
                  <div className="flex items-center gap-2 text-green-600 text-sm font-medium">
                    <CheckCircle2 className="h-4 w-4" />
                    JD file uploaded — AI will use it to personalise questions.
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx,.txt"
                      onChange={handleJdUpload}
                      disabled={jdUploading}
                      className="text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-slate-200 file:text-sm file:font-medium file:bg-slate-50 hover:file:bg-slate-100"
                    />
                    {jdUploading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
