import { ArrowDown, ArrowUp, Check, CopyPlus, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createTemplate, getTemplates, install408Templates, saveTemplate, validateTemplate } from "../api";
import { ImportView } from "./ImportView";
import { AgentDialog } from "./AgentDialog";
import { SectionEditor } from "./SectionEditor";
import type { PaperTemplate, QuestionBank, QuestionType, Tag } from "../types";

type Props = {
  tags: Tag[];
  questionBanks: QuestionBank[];
  onChanged: () => void;
};

const typeLabels: Record<QuestionType, string> = { choice: "选择题", fill: "填空题", solution: "解答题", short_answer: "简答题" };
const subjectLabels: Record<string, string> = {
  "高等数学": "高等数学",
  "线性代数": "线性代数",
  "概率论与数理统计": "概率与统计"
};

export function TemplateView({ tags, questionBanks, onChanged }: Props): JSX.Element {
  const [showAgent, setShowAgent] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [activePane, setActivePane] = useState<"assemble" | "import">("assemble");
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
    : [];
  const subjectRatioTotal = subjectRules.reduce((sum, rule) => sum + Number(rule.ratio || 0), 0);

  function updateDraft(patch: Partial<PaperTemplate>): void {
    setValid(null);
    setWarnings([]);
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

  async function add408Suite(): Promise<void> {
    setInstalling(true);
    try {
      const presets = await install408Templates();
      setTemplates(await getTemplates());
      setSelectedId(presets.find(item => item.id === "template-408-choice")?.id ?? "template-408-full");
      setMessage("已加入 408 四科选择题训练和四个专项模板。");
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "添加模板套件失败");
    } finally {
      setInstalling(false);
    }
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
          chapter_distribution: []
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

  async function duplicate(): Promise<void> {
    try {
      const created = await createTemplate({ ...activeDraft, name: activeDraft.name + " · 副本" });
      setTemplates(current => [...current, created]); setSelectedId(created.id); onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : "复制失败"); }
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
      const saved = await saveTemplate(activeDraft);
      setTemplates(current => current.map(item => item.id === saved.id ? saved : item));
      onChanged();
      const result = await validateTemplate(saved.id);
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
    <div className="template-shell">
      {showAgent && <AgentDialog onClose={() => setShowAgent(false)} onConfirm={() => { updateDraft({ distribution_rules: { ...activeDraft.distribution_rules, agent_enabled: true } }); setShowAgent(false); }} />}
      <div className="canvas-toolbar panel template-switch-bar">
        <div>
          <span className="eyebrow">STRUCTURE CANVAS</span>
          <strong>{draft.name}</strong>
          <div className="template-mode-switch">
            <button className={activePane === "assemble" ? "is-active" : ""} onClick={() => setActivePane("assemble")} type="button">试卷装配台</button>
            <button className={activePane === "import" ? "is-active" : ""} onClick={() => setActivePane("import")} type="button">试题导入</button>
          </div>
        </div>
        <div className="toolbar-actions">
          <button className="outline-action" type="button" disabled={installing} onClick={() => void add408Suite()}>
            <Plus size={17} />{installing ? "正在添加…" : "增加 408 模板套件"}
          </button>
          <button onClick={() => void validate()} type="button"><Check size={17} />校验</button>
          <button className="primary-action compact" onClick={() => void save()} type="button"><Save size={17} />保存模板</button>
        </div>
      </div>
      {message && (
        <div className={`notice ${valid === false || warnings.length > 0 ? "notice-warning" : "notice-info"}`}>
          {message}
        </div>
      )}

      {activePane === "assemble" ? (
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
            <button className="outline-action" onClick={() => void duplicate()} type="button"><CopyPlus size={17} />复制模板</button>
          </aside>

          <main className="template-canvas-area">
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
                      <SectionEditor key={`${draft.id}-${section.id}`} section={section} onChange={next => updateDraft({ sections: activeDraft.sections.map((item, i) => i === index ? next : item) })} />
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
            <label className="agent-toggle"><span>使用 Agent 组卷</span><input type="checkbox" checked={Boolean(draft.distribution_rules.agent_enabled)} onChange={event => event.target.checked ? setShowAgent(true) : updateDraft({ distribution_rules: { ...activeDraft.distribution_rules, agent_enabled: false } })} /></label>
            <p className="muted-copy">开启后由模型选题，本地校验约束；关闭时完全使用本地规则。</p>
            <label><span>模板名称</span><input value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} /></label>
            <label>
              <span>关联题库</span>
              <select
                value={draft.question_bank_id}
                onChange={(event) => {
                  const bank = questionBanks.find((item) => item.id === event.target.value);
                  if (bank) updateDraft({ question_bank_id: bank.id, subject: bank.subject, distribution_rules: { ...activeDraft.distribution_rules, subject: bank.subject, chapter_distribution: [] } });
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
              <span className={`distribution-total ${(!subjectRules.length || Math.abs(subjectRatioTotal - 1) < 0.001) ? "is-valid" : "is-invalid"}`}>
                合计 {(subjectRatioTotal * 100).toFixed(0)}%
              </span>
            </div>
            <div className="subject-distribution-list">
              <button type="button" onClick={() => updateDraft({ distribution_rules: { ...activeDraft.distribution_rules, chapter_distribution: [...subjectRules, { label: `科目 ${subjectRules.length + 1}`, ratio: subjectRules.length ? 0 : 1, tolerance: 0.08 }] } })}>添加科目占比</button>
              {subjectRules.map((rule, index) => {
                const percent = Math.round(Number(rule.ratio || 0) * 100);
                const label = subjectLabels[rule.label] ?? rule.label;
                return (
                  <div className="subject-distribution-row" key={rule.label}>
                    <div className="subject-distribution-row-head">
                      <input aria-label="科目名称" defaultValue={label} onBlur={event => updateDraft({ distribution_rules: { ...activeDraft.distribution_rules, chapter_distribution: subjectRules.map((item, i) => i === index ? { ...item, label: event.target.value.trim() } : item) } })} />
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
                    <button type="button" onClick={() => updateDraft({ distribution_rules: { ...activeDraft.distribution_rules, chapter_distribution: subjectRules.filter((_, i) => i !== index) } })}>移除此占比</button>
                  </div>
                );
              })}
            </div>
            <div className={`metric-line ${(!subjectRules.length || Math.abs(subjectRatioTotal - 1) < 0.001) ? "metric-good" : "metric-bad"}`}>
              <span>科目比例状态</span>
              <strong>{(!subjectRules.length || Math.abs(subjectRatioTotal - 1) < 0.001) ? "MATCH" : "CHECK"}</strong>
            </div>
            <p className="muted-copy">按配置的大类分配题目；留空表示不限占比。设置时合计须为 100%。</p>
          </aside>
        </div>
      ) : (
        <div className="template-import-slot">
          <ImportView tags={tags} questionBanks={questionBanks} onChanged={onChanged} />
        </div>
      )}
    </div>
  );
}
