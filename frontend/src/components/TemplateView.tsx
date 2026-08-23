import { ArrowDown, ArrowUp, Check, CopyPlus, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getTemplates, saveTemplate, validateTemplate } from "../api";
import type { PaperTemplate, QuestionType, TemplateSection } from "../types";

type Props = {
  onChanged: () => void;
};

const typeLabels: Record<QuestionType, string> = { choice: "选择题", fill: "填空题", solution: "解答题" };

export function TemplateView({ onChanged }: Props): JSX.Element {
  const [templates, setTemplates] = useState<PaperTemplate[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<PaperTemplate | null>(null);
  const [message, setMessage] = useState("");
  const [valid, setValid] = useState<boolean | null>(null);

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

  function updateDraft(patch: Partial<PaperTemplate>): void {
    setDraft((current) => current ? { ...current, ...patch } : current);
  }

  function updateSection(index: number, patch: Partial<TemplateSection>): void {
    updateDraft({ sections: activeDraft.sections.map((section, sectionIndex) => sectionIndex === index ? { ...section, ...patch } : section) });
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
      setMessage(result.valid ? "模板结构通过校验。" : result.errors.join(" "));
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
        {message && <div className={`notice ${valid === false ? "notice-warning" : "notice-info"}`}>{message}</div>}
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
        <label><span>科目</span><input value={draft.subject} onChange={(event) => updateDraft({ subject: event.target.value })} /></label>
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
        <span className="eyebrow">SELECTED SECTION</span>
        <label><span>分区标题</span><input value={draft.sections[0]?.title ?? ""} onChange={(event) => updateSection(0, { title: event.target.value })} /></label>
        <p className="muted-copy">画布中的每个色块代表一个可组卷分区。通过上下箭头调整试卷顺序。</p>
      </aside>
    </div>
  );
}
