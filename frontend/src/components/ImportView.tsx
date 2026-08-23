import { Check, FileInput, Plus, Save, Trash2, UploadCloud } from "lucide-react";
import { useEffect, useState } from "react";
import {
  approveMatchedReviews,
  approveReview,
  createTag,
  deleteReview,
  deleteUnmatchedReviews,
  getReviews,
  importDocument,
  reviewPreviewUrl,
  updateReview
} from "../api";
import type { Question, ReviewItem, Tag } from "../types";

type Props = {
  tags: Tag[];
  onChanged: () => void;
};

const typeLabels = { choice: "选择题", fill: "填空题", solution: "解答题" };
const majorTagLabels: Record<string, string> = {
  "高等数学": "高等数学",
  "线性代数": "线性代数",
  "概率论与数理统计": "概率与统计"
};
const REVIEW_PAGE_SIZE = 12;

export function ImportView({ tags: initialTags, onChanged }: Props): JSX.Element {
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewPages, setReviewPages] = useState(1);
  const [reviewTotal, setReviewTotal] = useState(0);
  const [matchedCount, setMatchedCount] = useState(0);
  const [unmatchedCount, setUnmatchedCount] = useState(0);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [tags, setTags] = useState<Tag[]>(initialTags);
  const [selectedMajorTag, setSelectedMajorTag] = useState("");
  const [selectedSubTag, setSelectedSubTag] = useState("");
  const [newTag, setNewTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Partial<Question>>>({});
  const majorTagOptions = tags
    .map((tag) => tag.name)
    .filter((tag) => ["高等数学", "线性代数", "概率论与数理统计"].includes(tag));
  const subTagOptions = tags
    .map((tag) => tag.name)
    .filter((tag) => !["高等数学", "线性代数", "概率论与数理统计"].includes(tag));

  async function refresh(page = 1, append = false): Promise<void> {
    setReviewsLoading(true);
    try {
      const result = await getReviews(page, REVIEW_PAGE_SIZE);
      setReviews((current) => append ? [...current, ...result.items] : result.items);
      setReviewPage(result.page);
      setReviewPages(result.pages);
      setReviewTotal(result.total);
      setMatchedCount(result.matched_count);
      setUnmatchedCount(result.unmatched_count);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法加载审核队列");
    } finally {
      setReviewsLoading(false);
    }
  }

  useEffect(() => {
    void refresh(1, false);
  }, []);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await importDocument(file);
      setMessage(`${result.filename} 已提取 ${result.candidate_count} 道候选题。`);
      await refresh(1, false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入失败");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function handleCreateTag(): Promise<void> {
    if (!newTag.trim()) return;
    try {
      const tag = await createTag(newTag.trim());
      setTags((current) => [...current, tag]);
      setSelectedSubTag(tag.name);
      setNewTag("");
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "tag 创建失败");
    }
  }

  function draftFor(review: ReviewItem): Partial<Question> {
    return { ...review.parsed_question, ...(drafts[review.id] ?? {}) };
  }

  function updateDraft(review: ReviewItem, patch: Partial<Question>): void {
    setDrafts((current) => ({ ...current, [review.id]: { ...draftFor(review), ...patch } }));
  }

  async function saveDraft(review: ReviewItem): Promise<void> {
    try {
      const draft = draftFor(review);
      await updateReview(review.id, {
        ...draft,
        type: draft.type ?? "solution",
        subject: draft.subject ?? "考研数学一",
        stem_markdown: draft.stem_markdown ?? "",
        options: draft.options ?? [],
        answer_markdown: draft.answer_markdown ?? "",
        analysis_markdown: draft.analysis_markdown ?? "",
        scoring_points: draft.scoring_points ?? [],
        tags: [
          selectedMajorTag || draft.tags?.[0] || "",
          selectedSubTag || draft.tags?.[1] || ""
        ].filter(Boolean),
        chapter: draft.chapter ?? "",
        knowledge_points: draft.knowledge_points ?? [],
        difficulty: draft.difficulty ?? "medium",
        score: draft.score ?? 5
      });
      setMessage("草稿已保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    }
  }

  async function approve(review: ReviewItem): Promise<void> {
    await saveDraft(review);
    try {
      await approveReview(review.id);
      setMessage("题目已审核入库。");
      await refresh(1, false);
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "审核失败");
    }
  }

  async function approveMatched(): Promise<void> {
    if (!matchedCount || actionBusy) return;
    setActionBusy(true);
    setMessage("");
    try {
      const result = await approveMatchedReviews();
      setMessage(`已一键通过 ${result.approved} 道有解析题目。`);
      await refresh(1, false);
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "批量审核失败");
    } finally {
      setActionBusy(false);
    }
  }

  async function removeUnmatched(): Promise<void> {
    if (!unmatchedCount || actionBusy) return;
    if (!window.confirm(`确定删除 ${unmatchedCount} 道没有匹配解析的题目吗？`)) return;
    setActionBusy(true);
    setMessage("");
    try {
      const result = await deleteUnmatchedReviews();
      setMessage(`已删除 ${result.deleted} 道未匹配解析的题目。`);
      await refresh(1, false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "批量删除失败");
    } finally {
      setActionBusy(false);
    }
  }

  async function removeReview(review: ReviewItem): Promise<void> {
    if (actionBusy) return;
    if (!window.confirm("确定删除这道待审核题目吗？")) return;
    setActionBusy(true);
    try {
      await deleteReview(review.id);
      setMessage("题目已删除。");
      await refresh(1, false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败");
    } finally {
      setActionBusy(false);
    }
  }

  async function loadMore(): Promise<void> {
    if (reviewsLoading || reviewPage >= reviewPages) return;
    await refresh(reviewPage + 1, true);
  }

  return (
    <div className="import-layout">
      <section className="import-top panel panel-yellow">
        <div>
          <div className="section-kicker">02 / INGEST</div>
          <h1>把文档拆成可组卷题目</h1>
          <p>支持文本 PDF、DOCX 和 DOC。抽取结果先进入审核队列，不会直接污染题库。</p>
        </div>
        <label className="upload-button">
          <UploadCloud size={22} />
          <span>{busy ? "正在提取..." : "选择题目文件"}</span>
          <input accept=".pdf,.doc,.docx" disabled={busy} onChange={(event) => void handleFile(event)} type="file" />
        </label>
      </section>

      <section className="import-toolbar panel">
        <div className="toolbar-block">
          <span className="eyebrow">TAG CONTROL</span>
          <div className="tag-creator">
            <select value={selectedMajorTag} onChange={(event) => setSelectedMajorTag(event.target.value)}>
              <option value="">选择大类 tag</option>
              {[...new Set(majorTagOptions)].map((tag) => (
                <option key={tag} value={tag}>{majorTagLabels[tag] ?? tag}</option>
              ))}
            </select>
            <select value={selectedSubTag} onChange={(event) => setSelectedSubTag(event.target.value)}>
              <option value="">选择小类 tag</option>
              {[...new Set(subTagOptions)].map((tag) => <option key={tag} value={tag}>{tag}</option>)}
            </select>
            <input placeholder="新建小分类 tag" value={newTag} onChange={(event) => setNewTag(event.target.value)} />
            <button onClick={() => void handleCreateTag()} title="新建小分类 tag" type="button"><Plus size={17} /></button>
          </div>
        </div>
        <div className="queue-count">
          <span>待审核</span>
          <strong>{reviews.length}</strong>
        </div>
        <div className="review-bulk-actions">
          <button
            className="approve-button"
            disabled={!matchedCount || actionBusy || reviewsLoading}
            onClick={() => void approveMatched()}
            type="button"
          >
            <Check size={17} />
            一键通过（有解析 {matchedCount}）
          </button>
          <button
            className="delete-button"
            disabled={!unmatchedCount || actionBusy || reviewsLoading}
            onClick={() => void removeUnmatched()}
            type="button"
          >
            <Trash2 size={17} />
            删除未匹配（{unmatchedCount}）
          </button>
        </div>
        {message && <div className="notice notice-info">{message}</div>}
      </section>

      <section className="review-grid">
        {reviewsLoading && reviews.length === 0 && (
          <div className="empty-panel">
            <FileInput size={42} />
            <strong>正在加载审核队列</strong>
            <span>正在读取第一批题目。</span>
          </div>
        )}
        {!reviewsLoading && reviewTotal === 0 && (
          <div className="empty-panel">
            <FileInput size={42} />
            <strong>审核队列为空</strong>
            <span>选择一个 PDF 或 Word 文件开始抽取。</span>
          </div>
        )}
        {reviews.map((review) => {
          const draft = draftFor(review);
          return (
            <article className="review-card panel" key={review.id}>
              <div className="review-head">
                <span className="question-index">{review.id.slice(-4)}</span>
                <div>
                  <span className="eyebrow">CONFIDENCE {(review.confidence * 100).toFixed(0)}%</span>
                  <strong>{typeLabels[draft.type as keyof typeof typeLabels] ?? "待分类"}</strong>
                  <small className={`analysis-status ${draft.analysis_matched ? "is-matched" : "is-unmatched"}`}>
                    {draft.analysis_matched ? "解析已匹配" : "未匹配解析"}
                  </small>
                </div>
                <span className="review-page">P.{draft.source_page ?? "?"}</span>
              </div>
              <div className="source-preview">
                <div className="source-preview-head">
                  <span>原始 PDF 题面</span>
                  <small>公式按原版显示</small>
                </div>
                <img
                  alt={`第 ${draft.source_page ?? "?"} 页原始题面`}
                  loading="lazy"
                  src={reviewPreviewUrl(review.id)}
                />
                {draft.analysis_matched && draft.analysis_regions && draft.analysis_regions.length > 0 && (
                  <details>
                    <summary>查看原版解析</summary>
                    <img
                      alt={`第 ${draft.source_page ?? "?"} 页原版解析`}
                      loading="lazy"
                      src={reviewPreviewUrl(review.id, "analysis")}
                    />
                  </details>
                )}
              </div>
              <div className="two-fields">
                <label>
                  <span>题型</span>
                  <select
                    value={draft.type ?? "solution"}
                    onChange={(event) => updateDraft(review, { type: event.target.value as Question["type"] })}
                  >
                    <option value="choice">选择题</option>
                    <option value="fill">填空题</option>
                    <option value="solution">解答题</option>
                  </select>
                </label>
                <label>
                  <span>章节</span>
                  <input value={String(draft.chapter ?? "")} onChange={(event) => updateDraft(review, { chapter: event.target.value })} />
                </label>
              </div>
              <label>
                <span>答案</span>
                <input value={String(draft.answer_markdown ?? "")} onChange={(event) => updateDraft(review, { answer_markdown: event.target.value })} />
              </label>
              <div className="review-actions">
                <button onClick={() => void saveDraft(review)} type="button"><Save size={17} />保存</button>
                <button className="approve-button" onClick={() => void approve(review)} type="button"><Check size={17} />审核入库</button>
                <button className="delete-button" disabled={actionBusy} onClick={() => void removeReview(review)} type="button"><Trash2 size={17} />删除</button>
              </div>
            </article>
          );
        })}
      </section>
      {reviews.length > 0 && (
        <section className="review-load-more panel">
          <span>已加载 {reviews.length} / {reviewTotal} 道</span>
          {reviewPage < reviewPages ? (
            <button disabled={reviewsLoading} onClick={() => void loadMore()} type="button">
              {reviewsLoading ? "正在加载..." : `加载下一批（${REVIEW_PAGE_SIZE} 道）`}
            </button>
          ) : (
            <small>已加载全部待审核题目</small>
          )}
        </section>
      )}
    </div>
  );
}
