import { AlertTriangle, Check, Download, LockKeyhole, RefreshCw, Shuffle, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { composePaper, exportDownloadUrl, exportPaper, getQuestions, getTags, getTemplates, questionPreviewUrl } from "../api";
import type { Paper, PaperTemplate, Question, Tag } from "../types";

type Props = {
  tags: Tag[];
  onChanged: () => void;
};

const typeLabels = { choice: "选择题", fill: "填空题", solution: "解答题" };

export function ComposeView({ tags: initialTags, onChanged }: Props): JSX.Element {
  const [templates, setTemplates] = useState<PaperTemplate[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [tags, setTags] = useState<Tag[]>(initialTags);
  const [templateId, setTemplateId] = useState("");
  const [title, setTitle] = useState("2026 年考研数学一模拟卷");
  const [seed, setSeed] = useState(20260823);
  const [requiredTag, setRequiredTag] = useState("");
  const [paper, setPaper] = useState<Paper | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void Promise.all([getTemplates(), getQuestions(), getTags()])
      .then(([nextTemplates, nextQuestions, nextTags]) => {
        setTemplates(nextTemplates);
        setQuestions(nextQuestions);
        setTags(nextTags);
        setTemplateId((current) => current || nextTemplates[0]?.id || "");
      })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "无法加载组卷数据"));
  }, []);

  const selectedTemplate = templates.find((template) => template.id === templateId);
  const counts = useMemo(
    () =>
      questions.reduce(
        (result, question) => ({ ...result, [question.type]: (result[question.type] ?? 0) + 1 }),
        {} as Record<string, number>
      ),
    [questions]
  );

  async function buildPaper(): Promise<void> {
    if (!templateId) return;
    setBusy(true);
    setMessage("");
    try {
      const nextPaper = await composePaper({
        template_id: templateId,
        title,
        seed,
        required_tags: requiredTag ? [requiredTag] : []
      });
      setPaper(nextPaper);
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "组卷失败");
    } finally {
      setBusy(false);
    }
  }

  async function download(format: "pdf" | "docx", variant: "question" | "answer"): Promise<void> {
    if (!paper) return;
    try {
      const job = await exportPaper(paper.id, format, variant);
      window.open(exportDownloadUrl(job.id), "_blank");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导出失败");
    }
  }

  return (
    <div className="compose-layout">
      <section className="control-column">
        <div className="section-kicker">01 / COMPOSE</div>
        <div className="panel panel-blue control-hero">
          <div className="panel-title"><SlidersHorizontal size={20} />组卷参数</div>
          <label>
            <span>试卷名称</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            <span>模板</span>
            <select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
              {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
          </label>
          <label>
            <span>固定随机种子</span>
            <input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value))} />
          </label>
          <label>
            <span>必须包含 tag</span>
            <select value={requiredTag} onChange={(event) => setRequiredTag(event.target.value)}>
              <option value="">不限定</option>
              {tags.map((tag) => <option key={tag.id} value={tag.name}>{tag.name}</option>)}
            </select>
          </label>
          <button className="primary-action" onClick={() => void buildPaper()} disabled={busy || !templateId} type="button">
            <Shuffle size={19} />{busy ? "正在组卷..." : "自动组卷"}
          </button>
          {message && <div className="notice notice-danger">{message}</div>}
        </div>

        <div className="panel inventory-panel">
          <div className="panel-title"><Check size={20} />题库库存</div>
          <div className="inventory-grid">
            {(["choice", "fill", "solution"] as const).map((type) => (
              <div className={`inventory-chip inventory-${type}`} key={type}>
                <span>{typeLabels[type]}</span>
                <strong>{counts[type] ?? 0}</strong>
              </div>
            ))}
          </div>
          <p className="muted-copy">只使用已审核题目。固定种子可复现同一份试卷。</p>
        </div>
      </section>

      <section className="paper-column">
        <div className="section-kicker">LIVE PAPER / {selectedTemplate?.name ?? "等待模板"}</div>
        {!paper && (
          <div className="empty-panel">
            <RefreshCw size={42} />
            <strong>等待组卷</strong>
            <span>配置模板和约束后，生成一份可检查的试卷结构。</span>
          </div>
        )}
        {paper && (
          <>
            <div className="paper-head panel">
              <div>
                <span className="eyebrow">GENERATED PAPER / SEED {paper.seed}</span>
                <h1>{paper.title}</h1>
              </div>
              <div className={`validation-stamp ${paper.validation.valid ? "is-valid" : "is-invalid"}`}>
                {paper.validation.valid ? "规则通过" : "存在缺口"}
              </div>
            </div>
            {!paper.validation.valid && (
              <div className="notice notice-warning">
                <AlertTriangle size={18} />
                <div>{paper.validation.errors.map((error) => <span key={error}>{error}</span>)}</div>
              </div>
            )}
            <div className="paper-sections">
              {paper.sections.map((section) => {
                const sectionQuestions = paper.questions.filter((question) => question.section_id === section.id);
                return (
                  <article className="paper-section panel" key={section.id}>
                    <div className="paper-section-head">
                      <div>
                        <span className="eyebrow">{typeLabels[section.type]} / {section.selected_count} OF {section.requested_count}</span>
                        <h2>{section.title}</h2>
                      </div>
                      <strong>{section.score} 分 / 题</strong>
                    </div>
                    <div className="paper-question-list">
                      {sectionQuestions.map((question) => (
                        <div className="paper-question" key={question.id}>
                          <span className="question-index">{question.position}</span>
                          <div>
                            <p>{question.stem_markdown}</p>
                            {question.source_regions && question.source_regions.length > 0 && (
                              <details className="paper-source-preview">
                                <summary>查看原版题面</summary>
                                <img
                                  alt={`第 ${question.source_page ?? "?"} 页原版题面`}
                                  loading="lazy"
                                  src={questionPreviewUrl(question.id)}
                                />
                              </details>
                            )}
                            <div className="question-meta">
                              <span>{question.chapter || "未分类"}</span>
                              <span>{question.difficulty}</span>
                              {question.tags.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}
                            </div>
                          </div>
                          <LockKeyhole size={16} />
                        </div>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="export-bar panel">
              <div>
                <span className="eyebrow">EXPORT PACKAGE</span>
                <strong>题卷版 / 答案版</strong>
              </div>
              <div className="export-actions">
                <button onClick={() => void download("pdf", "question")} type="button"><Download size={17} />题卷 PDF</button>
                <button onClick={() => void download("pdf", "answer")} type="button"><Download size={17} />答案 PDF</button>
                <button onClick={() => void download("docx", "question")} type="button"><FileTextIcon />题卷 Word</button>
                <button onClick={() => void download("docx", "answer")} type="button"><FileTextIcon />答案 Word</button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function FileTextIcon(): JSX.Element {
  return <span className="text-icon">W</span>;
}
