export type TabId = "compose" | "import" | "templates";
export type QuestionType = "choice" | "fill" | "solution";

export type Tag = {
  id: string;
  name: string;
  color: string;
  created_at: string;
};

export type Question = {
  id: string;
  type: QuestionType;
  subject: string;
  stem_markdown: string;
  options: Array<{ key: string; text: string }>;
  answer_markdown: string;
  analysis_markdown: string;
  scoring_points: Array<{ label: string; score: number }>;
  tags: string[];
  chapter: string;
  knowledge_points: string[];
  difficulty: "easy" | "medium" | "hard";
  score: number;
  review_status?: string;
  source_page?: number | null;
  source_regions?: Array<{ page: number; bbox: number[] }>;
  analysis_source_document_id?: string | null;
  analysis_regions?: Array<{ page: number; bbox: number[] }>;
  analysis_matched?: boolean;
};

export type ReviewItem = {
  id: string;
  source_document_id: string;
  raw_text: string;
  parsed_question: Partial<Question> & { confidence?: number; source_page?: number };
  confidence: number;
  status: string;
  review_notes: string;
};

export type ReviewPage = {
  items: ReviewItem[];
  page: number;
  page_size: number;
  total: number;
  pages: number;
  matched_count: number;
  unmatched_count: number;
};

export type TemplateSection = {
  id: string;
  title: string;
  type: QuestionType;
  count: number;
  score: number;
  filters?: Record<string, unknown>;
};

export type PaperTemplate = {
  id: string;
  name: string;
  subject: string;
  duration_minutes: number;
  total_score: number;
  sections: TemplateSection[];
  distribution_rules: Record<string, unknown>;
  version: number;
};

export type Paper = {
  id: string;
  template_id: string;
  title: string;
  seed: number;
  sections: Array<{
    id: string;
    title: string;
    type: QuestionType;
    requested_count: number;
    selected_count: number;
    score: number;
  }>;
  questions: Array<Question & {
    section_id: string;
    section_title?: string;
    position: number;
    allocated_score: number;
  }>;
  validation: {
    valid: boolean;
    errors: string[];
    selected_count: number;
    total_score: number;
  };
};
