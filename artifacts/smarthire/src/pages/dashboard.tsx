import React, { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Plus,
  Users,
  BarChart,
  ChevronRight,
  Loader2,
  ThumbsUp,
  ThumbsDown,
  Bot,
  Globe,
  Cpu,
  RefreshCw,
  Calendar,
  MoreVertical,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AppLayout } from "@/components/layout";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

const PAGE_SIZE = 10;

type FilterOption = "all" | "web" | "bot" | "pending" | "completed" | "cancelled";

interface Interview {
  id: number;
  candidateName: string;
  candidateEmail: string | null;
  recruiterName: string;
  jobTitle: string;
  status: string;
  source: string | null;
  llmUsed: string | null;
  overallScore: number | null;
  createdAt: string;
  completedAt: string | null;
  scheduledAt: string | null;
  candidateToken: string | null;
  durationMinutes: number | null;
}

interface InterviewStats {
  total: number;
  completed: number;
  pending: number;
  averageScore: number | null;
  verdictBreakdown: {
    strongHire: number;
    hire: number;
    maybe: number;
    noHire: number;
  };
}

export default function Dashboard() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [filter, setFilter] = useState<FilterOption>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Reschedule modal
  const [rescheduleTarget, setRescheduleTarget] = useState<Interview | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [rescheduleDuration, setRescheduleDuration] = useState(30);
  const [isRescheduling, setIsRescheduling] = useState(false);

  // Cancel confirmation
  const [cancelTarget, setCancelTarget] = useState<Interview | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  const interviewsKey = ["interviews", isAdmin ? "all" : user?.email ?? ""];
  const statsKey = ["interviews-stats"];

  const { data: interviews, isLoading: interviewsLoading } = useQuery<Interview[]>({
    queryKey: interviewsKey,
    queryFn: async () => {
      const url = !isAdmin && user?.email
        ? `/api/interviews?email=${encodeURIComponent(user.email)}`
        : "/api/interviews";
      const res = await apiFetch(url);
      if (!res.ok) throw new Error("Failed to fetch interviews");
      return res.json() as Promise<Interview[]>;
    },
    enabled: !!user,
  });

  const { data: stats, isLoading: statsLoading } = useQuery<InterviewStats>({
    queryKey: statsKey,
    queryFn: async () => {
      const res = await apiFetch("/api/interviews/stats");
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json() as Promise<InterviewStats>;
    },
    enabled: !!user,
  });

  const filteredInterviews = useMemo(() => {
    if (!interviews) return [];
    let list = [...interviews];

    switch (filter) {
      case "web":       list = list.filter((i) => i.source === "web" || i.source == null); break;
      case "bot":       list = list.filter((i) => i.source === "bot"); break;
      case "pending":   list = list.filter((i) => i.status === "pending" || i.status === "evaluating"); break;
      case "completed": list = list.filter((i) => i.status === "completed"); break;
      case "cancelled": list = list.filter((i) => i.status === "cancelled"); break;
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (i) =>
          i.candidateName?.toLowerCase().includes(q) ||
          i.jobTitle?.toLowerCase().includes(q) ||
          i.candidateEmail?.toLowerCase().includes(q) ||
          i.recruiterName?.toLowerCase().includes(q) ||
          i.status?.toLowerCase().includes(q)
      );
    }

    return list.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [interviews, filter, searchQuery]);

  const handleFilterChange = (f: FilterOption) => {
    setFilter(f);
    setCurrentPage(1);
  };

  const totalItems = filteredInterviews.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const pagedInterviews = filteredInterviews.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );
  const showingFrom = totalItems === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(currentPage * PAGE_SIZE, totalItems);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: interviewsKey });
    await queryClient.invalidateQueries({ queryKey: statsKey });
    setIsRefreshing(false);
  };

  const filterButtons: { key: FilterOption; label: string }[] = [
    { key: "all", label: "All" },
    { key: "web", label: "Web" },
    { key: "bot", label: "Teams Bot" },
    { key: "pending", label: "Pending" },
    { key: "completed", label: "Completed" },
    { key: "cancelled", label: "Cancelled" },
  ];

  const getStatusBadge = (status: string, scheduledAt: string | null | undefined) => {
    if (status === "cancelled") {
      return (
        <Badge variant="secondary" style={{ backgroundColor: "#FEE2E2", color: "#DC2626" }}>
          Cancelled
        </Badge>
      );
    }
    if (scheduledAt && status !== "completed") {
      return (
        <Badge variant="secondary" className="bg-blue-100 text-blue-800 hover:bg-blue-100 gap-1">
          <Calendar className="h-3 w-3" /> Scheduled
        </Badge>
      );
    }
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

  const handleRowClick = (interview: Interview) => {
    if (interview.status === "completed") {
      navigate(`/scorecard/${interview.id}`);
    } else if (interview.status === "cancelled") {
      toast({ title: "Interview cancelled", description: "This interview has been cancelled and cannot be accessed." });
    } else {
      navigate(`/interview/${interview.candidateToken ?? interview.id}`);
    }
  };

  const openReschedule = (e: React.MouseEvent, interview: Interview) => {
    e.stopPropagation();
    const d = interview.scheduledAt ? new Date(interview.scheduledAt) : null;
    setRescheduleDate(d ? format(d, "yyyy-MM-dd") : "");
    setRescheduleTime(d ? format(d, "HH:mm") : "");
    setRescheduleDuration(interview.durationMinutes ?? 30);
    setRescheduleTarget(interview);
  };

  const openCancel = (e: React.MouseEvent, interview: Interview) => {
    e.stopPropagation();
    setCancelTarget(interview);
  };

  const handleReschedule = async () => {
    if (!rescheduleTarget) return;
    setIsRescheduling(true);
    try {
      const scheduledAt =
        rescheduleDate && rescheduleTime
          ? new Date(`${rescheduleDate}T${rescheduleTime}:00`).toISOString()
          : null;
      const res = await apiFetch(`/api/interviews/${rescheduleTarget.id}/reschedule`, {
        method: "PATCH",
        body: JSON.stringify({ scheduledAt, durationMinutes: rescheduleDuration }),
      });
      if (!res.ok) throw new Error("Failed to reschedule");
      await queryClient.invalidateQueries({ queryKey: interviewsKey });
      toast({ title: "Interview rescheduled", description: "The schedule has been updated." });
      setRescheduleTarget(null);
    } catch {
      toast({ variant: "destructive", title: "Failed to reschedule interview" });
    } finally {
      setIsRescheduling(false);
    }
  };

  const handleCancel = async () => {
    if (!cancelTarget) return;
    setIsCancelling(true);
    try {
      const res = await apiFetch(`/api/interviews/${cancelTarget.id}/cancel`, {
        method: "PATCH",
      });
      if (!res.ok) throw new Error("Failed to cancel");
      await queryClient.invalidateQueries({ queryKey: interviewsKey });
      toast({ title: "Interview cancelled", description: "The interview has been cancelled." });
      setCancelTarget(null);
    } catch {
      toast({ variant: "destructive", title: "Failed to cancel interview" });
    } finally {
      setIsCancelling(false);
    }
  };

  const getPageNumbers = () => {
    const pages: (number | "...")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push("...");
      for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
        pages.push(i);
      }
      if (currentPage < totalPages - 2) pages.push("...");
      pages.push(totalPages);
    }
    return pages;
  };

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Recruiter Dashboard</h1>
            <p className="text-muted-foreground mt-1">
              {isAdmin ? "Viewing all interviews (Admin)." : "Viewing your interviews."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="gap-1.5"
              data-testid="button-refresh"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button onClick={() => navigate("/create")} className="gap-2 text-white" style={{ backgroundColor: "#6366F1" }} data-testid="button-new-interview">
              <Plus className="h-4 w-4" />
              New Interview
            </Button>
          </div>
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
                  {stats?.averageScore ? stats.averageScore.toFixed(1) : "-"}
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
                    className={`text-xs ${filter === btn.key ? "text-white" : ""}`}
                    style={filter === btn.key ? { backgroundColor: "#6366F1" } : undefined}
                    onClick={() => handleFilterChange(btn.key)}
                  >
                    {btn.label}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "center" }}>
              <div style={{ position: "relative", flex: 1 }}>
                <input
                  type="text"
                  placeholder="Search by candidate name, role, or email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 16px 10px 40px",
                    borderRadius: 8,
                    border: "1px solid #E2E8F0",
                    fontSize: 14,
                    outline: "none",
                    backgroundColor: "#F8FAFC",
                  }}
                />
                <span
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "#94A3B8",
                    fontSize: 16,
                  }}
                >
                  🔍
                </span>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    style={{
                      position: "absolute",
                      right: 12,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "#94A3B8",
                      fontSize: 18,
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
              {searchQuery && (
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                  {filteredInterviews.length} of {interviews?.length ?? 0} interviews
                </span>
              )}
            </div>
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
              <>
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Candidate</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Scheduled</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>LLM Used</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Score</TableHead>
                        <TableHead className="w-[50px]"></TableHead>
                        <TableHead className="w-[40px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedInterviews.map((interview) => (
                        <TableRow
                          key={interview.id}
                          className="cursor-pointer hover:bg-muted/50 transition-colors"
                          onClick={() => handleRowClick(interview)}
                          data-testid={`row-interview-${interview.id}`}
                        >
                          <TableCell className="font-medium">{interview.candidateName}</TableCell>
                          <TableCell>{interview.jobTitle}</TableCell>
                          <TableCell className="text-muted-foreground whitespace-nowrap">
                            {interview.scheduledAt ? (
                              <span className="font-medium" style={{ color: "#6366F1" }}>
                                {format(new Date(interview.scheduledAt), "MMM d, yyyy h:mm a")}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {format(new Date(interview.createdAt), "MMM d, yyyy")}
                          </TableCell>
                          <TableCell>{getSourceBadge(interview.source)}</TableCell>
                          <TableCell>{getLlmBadge(interview.llmUsed)}</TableCell>
                          <TableCell>{getStatusBadge(interview.status, interview.scheduledAt)}</TableCell>
                          <TableCell className="text-right">
                            <span className={getScoreColorClass(interview.overallScore)}>
                              {interview.overallScore ? interview.overallScore.toFixed(1) : "-"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            {interview.status !== "completed" && interview.status !== "cancelled" && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7">
                                    <MoreVertical className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={(e) => openReschedule(e, interview)}>
                                    Reschedule
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-red-600 focus:text-red-600"
                                    onClick={(e) => openCancel(e, interview)}
                                  >
                                    Cancel
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 px-1">
                    <p className="text-sm text-muted-foreground">
                      Showing {showingFrom}–{showingTo} of {totalItems} interviews
                    </p>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="text-xs"
                      >
                        Previous
                      </Button>
                      {getPageNumbers().map((p, idx) =>
                        p === "..." ? (
                          <span key={`ellipsis-${idx}`} className="px-2 text-muted-foreground text-sm">…</span>
                        ) : (
                          <Button
                            key={p}
                            variant={currentPage === p ? "default" : "outline"}
                            size="sm"
                            onClick={() => setCurrentPage(p as number)}
                            className={`text-xs w-8 ${currentPage === p ? "text-white" : ""}`}
                            style={currentPage === p ? { backgroundColor: "#6366F1" } : undefined}
                          >
                            {p}
                          </Button>
                        )
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="text-xs"
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
                {totalPages === 1 && totalItems > 0 && (
                  <p className="text-sm text-muted-foreground mt-4 px-1">
                    Showing {showingFrom}–{showingTo} of {totalItems} interviews
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Reschedule Modal */}
      <Dialog open={!!rescheduleTarget} onOpenChange={(open) => { if (!open) setRescheduleTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reschedule Interview</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {rescheduleTarget?.candidateName} — {rescheduleTarget?.jobTitle}
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium">Date</label>
              <Input
                type="date"
                value={rescheduleDate}
                onChange={(e) => setRescheduleDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Time</label>
              <Input
                type="time"
                value={rescheduleTime}
                onChange={(e) => setRescheduleTime(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Duration</label>
              <Select
                value={String(rescheduleDuration)}
                onValueChange={(v) => setRescheduleDuration(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">15 minutes</SelectItem>
                  <SelectItem value="30">30 minutes</SelectItem>
                  <SelectItem value="45">45 minutes</SelectItem>
                  <SelectItem value="60">60 minutes</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRescheduleTarget(null)}>Cancel</Button>
            <Button
              onClick={handleReschedule}
              disabled={isRescheduling}
              className="text-white"
              style={{ backgroundColor: "#6366F1" }}
            >
              {isRescheduling ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving...</> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Confirmation */}
      <Dialog open={!!cancelTarget} onOpenChange={(open) => { if (!open) setCancelTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel Interview</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Are you sure you want to cancel the interview for <strong>{cancelTarget?.candidateName}</strong>? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>Go Back</Button>
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={isCancelling}
            >
              {isCancelling ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Cancelling...</> : "Cancel Interview"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
