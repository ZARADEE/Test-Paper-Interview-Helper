import type {
  Paper,
  PaperTemplate,
  QuestionBank,
  PracticeAnswerResult,
  PracticeCatalog,
  PracticeSession,
  Question,
  ReviewPage,
  Tag,
  WrongBookItem
} from "./types";

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

export async function getTags(questionBankId?: string): Promise<Tag[]> {
  const query = questionBankId ? `?question_bank_id=${encodeURIComponent(questionBankId)}` : "";
  return request(`/tags${query}`);
}

export async function createTag(name: string, questionBankId?: string, color = "#ffd23f"): Promise<Tag> {
  return request("/tags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, color, question_bank_id: questionBankId })
  });
}

export async function getQuestionBanks(): Promise<QuestionBank[]> {
  return request("/question-banks");
}

export async function createQuestionBank(payload: {
  name: string;
  subject: string;
  description?: string;
}): Promise<QuestionBank> {
  return request("/question-banks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function getQuestions(questionBankId?: string): Promise<Question[]> {
  const query = questionBankId ? `?question_bank_id=${encodeURIComponent(questionBankId)}` : "";
  return request(`/questions${query}`);
}

export async function getReviews(page = 1, pageSize = 12, questionBankId?: string): Promise<ReviewPage> {
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize)
  });
  if (questionBankId) query.set("question_bank_id", questionBankId);
  return request(`/reviews?${query.toString()}`);
}

export async function importDocument(
  file: File,
  questionBankId: string
): Promise<{ candidate_count: number; filename: string }> {
  const body = new FormData();
  body.append("file", file);
  body.append("question_bank_id", questionBankId);
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

export async function approveMatchedReviews(questionBankId?: string): Promise<{
  approved: number;
  skipped_without_matched_analysis: number;
}> {
  const query = questionBankId ? `?question_bank_id=${encodeURIComponent(questionBankId)}` : "";
  return request(`/reviews/batch-approve${query}`, { method: "POST" });
}

export async function deleteUnmatchedReviews(questionBankId?: string): Promise<{ deleted: number }> {
  const query = questionBankId ? `?question_bank_id=${encodeURIComponent(questionBankId)}` : "";
  return request(`/reviews/unmatched${query}`, { method: "DELETE" });
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

export async function createTemplate(payload: {
  name: string;
  subject: string;
  question_bank_id: string;
  duration_minutes: number;
  total_score: number;
  sections: PaperTemplate["sections"];
  distribution_rules: PaperTemplate["distribution_rules"];
}): Promise<PaperTemplate> {
  return request("/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function saveTemplate(template: PaperTemplate): Promise<PaperTemplate> {
  return request(`/templates/${template.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: template.name,
      subject: template.subject,
      question_bank_id: template.question_bank_id,
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

export async function getPracticeCatalog(): Promise<PracticeCatalog> {
  return request("/practice/catalog");
}

export async function startPractice(payload: {
  subject: string;
  question_bank_id?: string;
  major_tag: string;
  sub_tag: string;
  count: number;
  seed?: number;
}): Promise<PracticeSession> {
  return request("/practice/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function getPracticeSession(sessionId: string): Promise<PracticeSession> {
  return request(`/practice/sessions/${sessionId}`);
}

export async function answerPracticeQuestion(
  sessionId: string,
  questionId: string,
  selectedOptions: string[]
): Promise<PracticeAnswerResult> {
  return request(`/practice/sessions/${sessionId}/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question_id: questionId, selected_options: selectedOptions })
  });
}

export async function getWrongBook(filters: {
  subject?: string;
  major_tag?: string;
  sub_tag?: string;
} = {}): Promise<{ items: WrongBookItem[]; count: number }> {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request(`/practice/wrong-book${suffix}`);
}

export async function deleteWrongBookItem(questionId: string): Promise<{ ok: boolean; question_id: string }> {
  return request(`/practice/wrong-book/${encodeURIComponent(questionId)}`, {
    method: "DELETE"
  });
}

export async function exportPracticeMistakes(
  sessionId: string
): Promise<{ id: string; path: string; format: "pdf" }> {
  return request(`/practice/sessions/${sessionId}/export`, {
    method: "POST"
  });
}

export function practiceExportDownloadUrl(jobId: string): string {
  return `${API_BASE}/practice/exports/${jobId}/download`;
}
