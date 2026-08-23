import type { Paper, PaperTemplate, Question, ReviewPage, Tag } from "./types";

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, options);
  const payload = (await response.json().catch(() => ({}))) as { detail?: string };
  if (!response.ok) {
    throw new Error(payload.detail ?? `请求失败：${response.status}`);
  }
  return payload as T;
}

export async function getHealth(): Promise<{ ok: boolean; question_count: number; template_count: number }> {
  return request("/health");
}

export async function getTags(): Promise<Tag[]> {
  return request("/tags");
}

export async function createTag(name: string, color = "#ffd23f"): Promise<Tag> {
  return request("/tags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, color })
  });
}

export async function getQuestions(): Promise<Question[]> {
  return request("/questions");
}

export async function getReviews(page = 1, pageSize = 12): Promise<ReviewPage> {
  return request(`/reviews?page=${page}&page_size=${pageSize}`);
}

export async function importDocument(file: File): Promise<{ candidate_count: number; filename: string }> {
  const body = new FormData();
  body.append("file", file);
  return request("/documents/import", { method: "POST", body });
}

export async function updateReview(
  reviewId: string,
  parsedQuestion: Partial<Question>,
  reviewNotes = ""
): Promise<{ ok: boolean }> {
  return request(`/reviews/${reviewId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parsed_question: parsedQuestion, review_notes: reviewNotes })
  });
}

export async function approveReview(reviewId: string): Promise<Question> {
  return request(`/reviews/${reviewId}/approve`, { method: "POST" });
}

export async function approveMatchedReviews(): Promise<{
  approved: number;
  skipped_without_matched_analysis: number;
}> {
  return request("/reviews/batch-approve", { method: "POST" });
}

export async function deleteUnmatchedReviews(): Promise<{ deleted: number }> {
  return request("/reviews/unmatched", { method: "DELETE" });
}

export async function deleteReview(reviewId: string): Promise<{ ok: boolean; id: string }> {
  return request(`/reviews/${reviewId}`, { method: "DELETE" });
}

export function reviewPreviewUrl(reviewId: string, kind: "question" | "analysis" = "question"): string {
  return `${API_BASE}/reviews/${reviewId}/preview?kind=${kind}`;
}

export function questionPreviewUrl(questionId: string, kind: "question" | "analysis" = "question"): string {
  return `${API_BASE}/questions/${questionId}/preview?kind=${kind}`;
}

export async function getTemplates(): Promise<PaperTemplate[]> {
  return request("/templates");
}

export async function saveTemplate(template: PaperTemplate): Promise<PaperTemplate> {
  return request(`/templates/${template.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: template.name,
      subject: template.subject,
      duration_minutes: template.duration_minutes,
      total_score: template.total_score,
      sections: template.sections,
      distribution_rules: template.distribution_rules
    })
  });
}

export async function validateTemplate(templateId: string): Promise<{ valid: boolean; errors: string[] }> {
  return request(`/templates/${templateId}/validate`, { method: "POST" });
}

export async function composePaper(payload: {
  template_id: string;
  title: string;
  seed: number;
  required_tags: string[];
}): Promise<Paper> {
  return request("/papers/compose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function exportPaper(
  paperId: string,
  format: "pdf" | "docx",
  variant: "question" | "answer"
): Promise<{ id: string; path: string }> {
  return request(`/papers/${paperId}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format, variant })
  });
}

export function exportDownloadUrl(jobId: string): string {
  return `${API_BASE}/exports/${jobId}/download`;
}
