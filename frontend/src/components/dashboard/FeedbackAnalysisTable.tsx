import { useQuery } from "@tanstack/react-query";
import { MessageSquareText } from "lucide-react";
import { api } from "../../lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

type FeedbackAnalysis = {
  id: string;
  feedback_id: string;
  customer_name: string;
  visit_type: string;
  rating: number;
  message: string;
  analysis: "Complaint" | "Praise" | "Suggestion" | "Question" | "General Feedback" | string;
  created_at: string;
};

const analysisClass: Record<string, string> = {
  Complaint: "bg-red-50 text-red-700 border-red-200",
  Praise: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Suggestion: "bg-amber-50 text-amber-700 border-amber-200",
  Question: "bg-blue-50 text-blue-700 border-blue-200",
  "General Feedback": "bg-slate-50 text-slate-700 border-slate-200"
};

function visitTypeLabel(value: string) {
  return value.replace(/_/g, " ");
}

export default function FeedbackAnalysisTable() {
  const feedbackQuery = useQuery({
    queryKey: ["staff-feedback-analysis"],
    queryFn: async () => (await api.get<{ feedback: FeedbackAnalysis[] }>("/api/staff/feedback/analysis")).data.feedback,
    retry: 1
  });

  const feedback = feedbackQuery.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-red-700">Customer Feedback</p>
          <CardTitle className="mt-1 flex items-center gap-2">
            <MessageSquareText className="h-5 w-5 text-red-700" />
            Feedback Analysis
          </CardTitle>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
          Latest 25
        </span>
      </CardHeader>
      <CardContent>
        {feedbackQuery.isLoading && <p className="text-sm text-slate-500">Loading customer feedback...</p>}
        {feedbackQuery.isError && <p className="text-sm text-red-700">Unable to load feedback analysis.</p>}

        {!feedbackQuery.isLoading && !feedbackQuery.isError && feedback.length === 0 && (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No customer feedback yet.</p>
        )}

        {feedback.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>Analysis</TableHead>
                  <TableHead>Summary</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {feedback.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-semibold">{item.feedback_id}</TableCell>
                    <TableCell>{item.customer_name}</TableCell>
                    <TableCell className="capitalize">{visitTypeLabel(item.visit_type)}</TableCell>
                    <TableCell>{item.rating}/5</TableCell>
                    <TableCell>
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${analysisClass[item.analysis] ?? analysisClass["General Feedback"]}`}>
                        {item.analysis}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-sm text-sm text-slate-600">
                      <span className="line-clamp-2">{item.message}</span>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">{new Date(item.created_at).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
