export type TabId = "compose" | "practice" | "import" | "templates";
export type QuestionType = "choice" | "fill" | "solution";

export type Tag = {
  id: string;
  name: string;
  color: string;
  created_at: string;
  question_bank_id?: string | null;
};

export type QuestionBank = {
  id: string;
  name: string;
  subject: string;
  description: string;
  created_at: string;
  updated_at: string;
};

export type Question = {
  id: string;
  type: QuestionType;
  subject: string;
  question_bank_id?: string | null;
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
  answer_mode?: "single" | "multiple";
};

export type PracticeSubTag = {
  value: string;
  label: string;
  count: number;
};

export type PracticeMajorTag = {
  value: string;
  label: string;
  count: number;
  sub_tags: PracticeSubTag[];
};

export type PracticeSubject = {
  value: string;
  label: string;
  count: number;
  question_bank_id?: string | null;
  major_tags: PracticeMajorTag[];
};

export type PracticeCatalog = {
  subjects: PracticeSubject[];
  wrong_book_count: number;
};

export type PracticeMode = "standard" | "wrong_book";

export type PracticeAttempt = {
  question_id: string;
  selected_options: string[];
  correct_options: string[];
  is_correct: boolean;
  created_at: string;
};

export type PracticeQuestion = Question & {
  answer_mode: "single" | "multiple";
  attempt?: PracticeAttempt;
};

export type PracticeSession = {
  id: string;
  subject: string;
  major_tag: string;
  sub_tag: string;
  mode: PracticeMode;
  total_count: number;
  answered_count: number;
  completed: boolean;
  created_at: string;
  completed_at?: string | null;
  wrong_question_ids: string[];
  questions: PracticeQuestion[];
};

export type PracticeAnswerResult = {
  question_id: string;
  selected_options: string[];
  correct_options: string[];
  correct: boolean;
  question: Question;
  answered_count: number;
  total_count: number;
  wrong_question_ids: string[];
};

export type WrongBookItem = Question & {
  wrong_count: number;
  first_wrong_at: string;
  last_wrong_at: string;
  last_selected_option: string[];
  last_correct_option: string[];
};

export type ReviewItem = {
  id: string;
  source_document_id: string;
  raw_text: string;
  parsed_question: Partial<Question> & { confidence?: number; source_page?: number };
  confidence: number;
  status: string;
  review_notes: string;
  question_bank_id?: string | null;
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

export type SubjectDistributionRule = {
  label: string;
  ratio: number;
  tolerance?: number;
};

export type TemplateDistributionRules = {
  subject?: string;
  chapter_distribution?: SubjectDistributionRule[];
  chapter_weights_note?: string;
  difficulty_distribution?: Array<{ label: string; ratio: number; tolerance?: number }>;
  [key: string]: unknown;
};

export type PaperTemplate = {
  id: string;
  name: string;
  subject: string;
  question_bank_id: string;
  duration_minutes: number;
  total_score: number;
  sections: TemplateSection[];
  distribution_rules: TemplateDistributionRules;
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
