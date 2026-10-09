import type { QuestionType, TemplateSection } from "../types";

export function SectionEditor({ section, onChange }: { section: TemplateSection; onChange: (section: TemplateSection) => void }): JSX.Element {
  const patch = (value: Partial<TemplateSection>) => onChange({ ...section, ...value });
  return <div className="section-editor">
    <label><span>分区名称</span><input aria-label="分区名称" value={section.title} onChange={e => patch({ title: e.target.value })} /></label>
    <label><span>题型</span><select value={section.type} onChange={e => patch({ type: e.target.value as QuestionType })}><option value="choice">选择题</option><option value="fill">填空题</option><option value="solution">解答题</option><option value="short_answer">简答题</option></select></label>
    <label><span>题量</span><input type="number" min={1} max={100} value={section.count} onChange={e => patch({ count: Number(e.target.value) })} /></label>
    <label><span>每题分值</span><input type="number" min={0.5} step={0.5} value={section.score} onChange={e => patch({ score: Number(e.target.value) })} /></label>
    <label><span>限定标签（逗号分隔）</span><input defaultValue={((section.filters?.tags as string[]) ?? []).join(",")} onBlur={e => patch({ filters: { ...section.filters, tags: e.target.value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean) } })} /></label>
    <label><span>难度</span><select value={String(section.filters?.difficulty ?? "")} onChange={e => patch({ filters: { ...section.filters, difficulty: e.target.value } })}><option value="">不限</option><option value="easy">基础</option><option value="medium">中等</option><option value="hard">提高</option></select></label>
    {section.type === "choice" && <label><span>选择题模式</span><select value={String(section.filters?.answer_mode ?? "")} onChange={e => patch({ filters: { ...section.filters, answer_mode: e.target.value } })}><option value="">不限</option><option value="single">单选</option><option value="multiple">多选</option></select></label>}
  </div>;
}
