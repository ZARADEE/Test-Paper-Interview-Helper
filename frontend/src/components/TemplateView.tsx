import { ArrowDown, ArrowUp, Check, CopyPlus, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createTemplate, getTemplates, saveTemplate, validateTemplate } from "../api";
import type { PaperTemplate, QuestionBank, QuestionType, SubjectDistributionRule } from "../types";

type Props = {
  questionBanks: QuestionBank[];
  onChanged: () => void;
};

const typeLabels: Record<QuestionType, string> = { choice: "选择题", fill: "填空题", solution: "解答题" };
const defaultSubjectRules: SubjectDistributionRule[] = [
  { label: "高等数学", ratio: 0.6, tolerance: 0.08 },
  { label: "线性代数", ratio: 0.2, tolerance: 0.08 },
  { label: "概率论与数理统计", ratio: 0.2, tolerance: 0.08 }
];
const subjectLabels: Record<string, string> = {
  "高等数学": "高等数学",
  "线性代数": "线性代数",
  "概率论与数理统计": "概率与统计"
};

export function TemplateView({ questionBanks, onChanged }: Props): JSX.Element {
  const [templates, setTemplates] = useState<PaperTemplate[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<PaperTemplate | null>(null);
  const [message, setMessage] = useState("");
  const [valid, setValid] = useState<boolean | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    void getTemplates()
      .then((nextTemplates) => {
        setTemplates(nextTemplates);
        setSelectedId(nextTemplates[0]?.id ?? "");
        setDraft(nextTemplates[0] ?? null);
      })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "模板加载失败"));
  }, []);

  useEffect(() => {
    const next = templates.find((template) => template.id === selectedId);
    if (next) {
      setDraft(next);
      setValid(null);
      setWarnings([]);
    }
  }, [selectedId, templates]);

  const sectionScore = useMemo(
    () => draft?.sections.reduce((sum, section) => sum + section.count * section.score, 0) ?? 0,
    [draft]
  );

  if (!draft) {
    return <div className="empty-panel"><strong>暂无模板</strong><span>{message || "等待模板加载。"}</span></div>;
  }

  const activeDraft = draft;
  const subjectRules = activeDraft.distribution_rules.chapter_distribution?.length
    ? activeDraft.distribution_rules.chapter_distribution
    : defaultSubjectRules;
  const subjectRatioTotal = subjectRules.reduce((sum, rule) => sum + Number(rule.ratio || 0), 0);

  function updateDraft(patch: Partial<PaperTemplate>): void {
    setDraft((current) => current ? { ...current, ...patch } : current);
  }

  function updateSubjectRatio(index: number, percent: number): void {
    const nextPercent = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
    const nextRules = subjectRules.map((rule, ruleIndex) =>
      ruleIndex === index ? { ...rule, ratio: nextPercent / 100 } : rule
    );
    updateDraft({
      distribution_rules: {
        ...activeDraft.distribution_rules,
        chapter_distribution: nextRules
      }
    });
  }

  function moveSection(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= activeDraft.sections.length) return;
    const sections = [...activeDraft.sections];
    [sections[index], sections[target]] = [sections[target], sections[index]];
    updateDraft({ sections });
  }

  function addSection(): void {
    const id = `section-${Date.now()}`;
    updateDraft({
      sections: [
        ...activeDraft.sections,
        { id, title: "新题型分区", type: "solution", count: 1, score: 5, filters: {} }
      ]
    });
  }

  async function createNewTemplate(): Promise<void> {
    const bank = questionBanks[0];
    if (!bank) return;
    try {
      const created = await createTemplate({
        name: `${bank.name}新模板`,
        subject: bank.subject,
        question_bank_id: bank.id,
        duration_minutes: 180,
        total_score: 100,
        sections: [
          { id: "choice", title: "一、选择题", type: "choice", count: 10, score: 5, filters: {} },
          { id: "solution", title: "二、解答题", type: "solution", count: 5, score: 10, filters: {} }
        ],
        distribution_rules: {
          subject: bank.subject,
          chapter_distribution: [{ label: "综合", ratio: 1, tolerance: 0.2 }]
        }
      });
      setTemplates((current) => [...current, created]);
      setSelectedId(created.id);
      setDraft(created);
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "新建模板失败");
    }
  }

  function removeSection(index: number): void {
    updateDraft({ sections: activeDraft.sections.filter((_, sectionIndex) => sectionIndex !== index) });
  }

  async function save(): Promise<void> {
    try {
      const saved = await saveTemplate(activeDraft);
      setTemplates((current) => current.map((template) => template.id === saved.id ? saved : template));
      setDraft(saved);
      setMessage("模板已保存。");
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "模板保存失败");
    }
  }

  async function validate(): Promise<void> {
    try {
      const result = await validateTemplate(activeDraft.id);
      setValid(result.valid);
      const nextWarnings = result.warnings ?? [];
      setWarnings(nextWarnings);
      const messages = [
        ...(result.valid ? ["模板结构通过校验。"] : result.errors),
        ...nextWarnings
      ];
      setMessage(messages.join(" "));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "模板校验失败");
    }
  }

  return (
    <div className="template-layout">
      <aside className="template-list panel">
        <div className="section-kicker">03 / TEMPLATE</div>
        <h1>模板库</h1>
        {templates.map((template) => (
          <button
            className={`template-list-item ${template.id === selectedId ? "is-active" : ""}`}
            key={template.id}
            onClick={() => setSelectedId(template.id)}
            type="button"
          >
            <span>{template.name}</span>
            <small>{template.total_score} 分 / {template.duration_minutes} 分钟</small>
          </button>
        ))}
        <button className="outline-action" onClick={() => void createNewTemplate()} type="button"><Plus size={17} />新建试卷模板</button>
        <button className="outline-action" onClick={addSection} type="button"><CopyPlus size={17} />复制结构</button>
      </aside>

      <main className="template-canvas-area">
        <div className="canvas-toolbar panel">
          <div>
            <span className="eyebrow">STRUCTURE CANVAS</span>
            <strong>{draft.name}</strong>
          </div>
          <div className="toolbar-actions">
            <button onClick={() => void validate()} type="button"><Check size={17} />校验</button>
            <button className="primary-action compact" onClick={() => void save()} type="button"><Save size={17} />保存模板</button>
          </div>
        </div>
        {message && (
          <div className={`notice ${valid === false || warnings.length > 0 ? "notice-warning" : "notice-info"}`}>
            {message}
          </div>
        )}
        <div className="template-canvas panel">
          <div className="template-paper">
            <div className="template-paper-head">
              <span>EXAM PAPER / TEMPLATE PREVIEW</span>
              <strong>{draft.subject}</strong>
              <small>{draft.total_score} 分 · {draft.duration_minutes} 分钟</small>
            </div>
            {draft.sections.map((section, index) => (
              <div className={`template-section-block block-${section.type}`} key={section.id}>
                <div className="block-number">{String(index + 1).padStart(2, "0")}</div>
                <div className="block-copy">
                  <strong>{section.title}</strong>
                  <span>{typeLabels[section.type]} · {section.count} 题 · {section.count * section.score} 分</span>
                </div>
                <div className="block-actions">
                  <button onClick={() => moveSection(index, -1)} title="上移" type="button"><ArrowUp size={15} /></button>
                  <button onClick={() => moveSection(index, 1)} title="下移" type="button"><ArrowDown size={15} /></button>
                  <button onClick={() => removeSection(index)} title="删除" type="button"><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
            <button className="add-section-button" onClick={addSection} type="button"><Plus size={18} />新增题型分区</button>
          </div>
        </div>
      </main>

      <aside className="template-inspector panel">
        <div className="panel-title">属性检查器</div>
        <label><span>模板名称</span><input value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} /></label>
        <label>
          <span>关联题库</span>
          <select
            value={draft.question_bank_id}
            onChange={(event) => {
              const bank = questionBanks.find((item) => item.id === event.target.value);
              if (bank) updateDraft({ question_bank_id: bank.id, subject: bank.subject });
            }}
          >
            {questionBanks.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}
          </select>
        </label>
        <div className="two-fields">
          <label><span>总分</span><input type="number" value={draft.total_score} onChange={(event) => updateDraft({ total_score: Number(event.target.value) })} /></label>
          <label><span>时长</span><input type="number" value={draft.duration_minutes} onChange={(event) => updateDraft({ duration_minutes: Number(event.target.value) })} /></label>
        </div>
        <div className="inspector-divider" />
        <div className="panel-title">当前结构</div>
        <div className="metric-line"><span>配置总分</span><strong>{sectionScore.toFixed(1)}</strong></div>
        <div className="metric-line"><span>目标总分</span><strong>{draft.total_score}</strong></div>
        <div className={`metric-line ${Math.abs(sectionScore - draft.total_score) < 0.01 ? "metric-good" : "metric-bad"}`}>
          <span>分值状态</span><strong>{Math.abs(sectionScore - draft.total_score) < 0.01 ? "MATCH" : "CHECK"}</strong>
        </div>
        <div className="inspector-divider" />
        <div className="distribution-heading">
          <div className="panel-title">科目占比</div>
          <span className={`distribution-total ${Math.abs(subjectRatioTotal - 1) < 0.001 ? "is-valid" : "is-invalid"}`}>
            合计 {(subjectRatioTotal * 100).toFixed(0)}%
          </span>
        </div>
        <div className="subject-distribution-list">
          {subjectRules.map((rule, index) => {
            const percent = Math.round(Number(rule.ratio || 0) * 100);
            const label = subjectLabels[rule.label] ?? rule.label;
            return (
              <div className="subject-distribution-row" key={rule.label}>
                <div className="subject-distribution-row-head">
                  <strong>{label}</strong>
                  <input
                    aria-label={`${label}占比`}
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={percent}
                    onChange={(event) => updateSubjectRatio(index, Number(event.target.value))}
                  />
                  <span>%</span>
                </div>
                <input
                  aria-label={`${label}占比滑块`}
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={percent}
                  onChange={(event) => updateSubjectRatio(index, Number(event.target.value))}
                />
              </div>
            );
          })}
        </div>
        <div className={`metric-line ${Math.abs(subjectRatioTotal - 1) < 0.001 ? "metric-good" : "metric-bad"}`}>
          <span>科目比例状态</span>
          <strong>{Math.abs(subjectRatioTotal - 1) < 0.001 ? "MATCH" : "CHECK"}</strong>
        </div>
        <p className="muted-copy">组卷时按这三个大类分配题目。比例合计需要保持为 100%。</p>
      </aside>
    </div>
  );
}
