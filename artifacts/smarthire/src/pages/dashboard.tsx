import React, { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import {
  useListInterviews,
  useGetInterviewStats,
  getListInterviewsQueryKey
} from "@workspace/api-client-react";
import { format } from "date-fns";
import {
  Plus,
  Users,
  CheckCircle2,
  Clock,
  BarChart,
  ChevronRight,
  Loader2,
  ThumbsUp,
  ThumbsDown,
  Bot,
  Globe,
  Cpu,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AppLayout } from "@/components/layout";

type FilterOption = "all" | "web" | "bot" | "pending" | "completed";

export default function Dashboard() {
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<FilterOption>("all");

  const { data: stats, isLoading: statsLoading } = useGetInterviewStats();
  const { data: interviews, isLoading: interviewsLoading } = useListInterviews();

  const filteredInterviews = useMemo(() => {
    if (!interviews) return [];
    switch (filter) {
      case "web": return interviews.filter((i) => i.source === "web" || i.source == null);
      case "bot": return interviews.filter((i) => i.source === "bot");
      case "pending": return interviews.filter((i) => i.status === "pending" || i.status === "evaluating");
      case "completed": return interviews.filter((i) => i.status === "completed");
      default: return interviews;
    }
  }, [interviews, filter]);

  const filterButtons: { key: FilterOption; label: string }[] = [
    { key: "all", label: "All" },
    { key: "web", label: "Web" },
    { key: "bot", label: "Teams Bot" },
    { key: "pending", label: "Pending" },
    { key: "completed", label: "Completed" },
  ];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge variant="secondary" className="bg-green-100 text-green-800 hover:bg-green-100">Completed</Badge>;
      case "in_progress":
        return <Badge variant="secondary" className="bg-blue-100 text-blue-800 hover:bg-blue-100">In Progress</Badge>;
      case "evaluating":
        return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Evaluating</Badge>;
      default:
        return <Badge variant="secondary" className="bg-slate-100 text-slate-800 hover:bg-slate-100">Pending</Badge>;
    }
  };

  const getScoreColorClass = (score: number | null) => {
    if (score === null) return "text-muted-foreground";
    if (score >= 8) return "text-green-600 font-medium";
    if (score >= 6) return "text-yellow-600 font-medium";
    return "text-red-600 font-medium";
  };

  const getSourceBadge = (source: string | null) => {
    if (source === "bot") {
      return (
        <Badge variant="outline" className="gap-1 text-xs text-blue-700 border-blue-200 bg-blue-50 font-medium">
          <Bot className="h-3 w-3" /> Teams Bot
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="gap-1 text-xs text-slate-600 border-slate-200 bg-slate-50 font-medium">
        <Globe className="h-3 w-3" /> Web
      </Badge>
    );
  };

  const getLlmBadge = (llmUsed: string | null) => {
    if (llmUsed === "llama3+gpt") {
      return (
        <Badge variant="outline" className="gap-1 text-xs text-purple-700 border-purple-200 bg-purple-50 font-medium">
          <Cpu className="h-3 w-3" /> LLaMA 3 + GPT
        </Badge>
      );
    }
    if (llmUsed === "gpt") {
      return (
        <Badge variant="outline" className="gap-1 text-xs text-emerald-700 border-emerald-200 bg-emerald-50 font-medium">
          <Cpu className="h-3 w-3" /> GPT
        </Badge>
      );
    }
    return <span className="text-muted-foreground text-sm">—</span>;
  };

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Recruiter Dashboard</h1>
            <p className="text-muted-foreground mt-1">Manage and track candidate interviews.</p>
          </div>
          <Button onClick={() => navigate("/create")} className="gap-2 bg-accent hover:bg-accent/90 text-white" data-testid="button-new-interview">
            <Plus className="h-4 w-4" />
            New Interview
          </Button>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Interviews</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {statsLoading ? <Skeleton className="h-7 w-16" /> : (
                <div className="text-2xl font-bold" data-testid="stat-total">{stats?.total || 0}</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Average Score</CardTitle>
              <BarChart className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {statsLoading ? <Skeleton className="h-7 w-16" /> : (
                <div className="text-2xl font-bold" data-testid="stat-average-score">
                  {stats?.averageScore ? stats.averageScore.toFixed(1) : '-'}
                  <span className="text-sm font-normal text-muted-foreground ml-1">/ 10</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Strong Hires</CardTitle>
              <ThumbsUp className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              {statsLoading ? <Skeleton className="h-7 w-16" /> : (
                <div className="text-2xl font-bold text-green-600" data-testid="stat-strong-hires">
                  {stats?.verdictBreakdown?.strongHire || 0}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">No Hires</CardTitle>
              <ThumbsDown className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              {statsLoading ? <Skeleton className="h-7 w-16" /> : (
                <div className="text-2xl font-bold text-red-500" data-testid="stat-no-hires">
                  {stats?.verdictBreakdown?.noHire || 0}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Interviews Table */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <CardTitle>Recent Interviews</CardTitle>
                <CardDescription className="mt-1">A list of all interview sessions and their current status.</CardDescription>
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {filterButtons.map((btn) => (
                  <Button
                    key={btn.key}
                    variant={filter === btn.key ? "default" : "outline"}
                    size="sm"
                    className={`text-xs ${filter === btn.key ? "bg-accent text-white hover:bg-accent/90" : ""}`}
                    onClick={() => setFilter(btn.key)}
                  >
                    {btn.label}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {interviewsLoading ? (
              <div className="flex justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : !filteredInterviews || filteredInterviews.length === 0 ? (
              <div className="text-center p-8 text-muted-foreground border rounded-md bg-muted/20">
                {filter === "all"
                  ? <p>No interviews found. Create one to get started.</p>
                  : <p>No interviews match this filter.</p>
                }
                {filter === "all" && (
                  <Button variant="outline" className="mt-4" onClick={() => navigate("/create")}>
                    Create First Interview
                  </Button>
                )}
              </div>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Candidate</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>LLM Used</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredInterviews.map((interview) => (
                      <TableRow
                        key={interview.id}
                        className="cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => navigate(interview.status === 'completed' ? `/scorecard/${interview.id}` : `/interview/${interview.id}`)}
                        data-testid={`row-interview-${interview.id}`}
                      >
                        <TableCell className="font-medium">{interview.candidateName}</TableCell>
                        <TableCell>{interview.jobTitle}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {format(new Date(interview.createdAt), "MMM d, yyyy")}
                        </TableCell>
                        <TableCell>{getSourceBadge(interview.source)}</TableCell>
                        <TableCell>{getLlmBadge(interview.llmUsed)}</TableCell>
                        <TableCell>{getStatusBadge(interview.status)}</TableCell>
                        <TableCell className="text-right">
                          <span className={getScoreColorClass(interview.overallScore)}>
                            {interview.overallScore ? interview.overallScore.toFixed(1) : '-'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
