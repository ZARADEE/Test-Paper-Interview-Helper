import { AlertTriangle, Check, Download, LockKeyhole, RefreshCw, Shuffle, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AgentDialog, getAgentSettings } from "./AgentDialog";
import type { AgentSettings } from "../types";
import { composePaper, exportDownloadUrl, exportPaper, getQuestions, getTemplates, questionPreviewUrl } from "../api";
import type { Paper, PaperTemplate, Question, QuestionBank, Tag } from "../types";
import { buildPaperPackage, getPaper, packagePreviewUrl, preparePaperPackage } from '../api';
import type { PaperPackage } from '../api';
import type { PaperLink } from '../timer/model';
import { TimerSetup } from './TimerCard';
import { openTimer } from '../timer/client';

type Props = {
  tags: Tag[];
  questionBanks: QuestionBank[];
  onChanged: () => void;
  timerPaper?: PaperLink;
};

const typeLabels = { choice: "选择题", fill: "填空题", solution: "解答题", short_answer: "简答题" };
const majorTagLabels: Record<string, string> = {
  "高等数学": "高等数学",
  "线性代数": "线性代数",
  "概率论与数理统计": "概率与统计"
};

export function ComposeView({ tags: initialTags, questionBanks, onChanged, timerPaper }: Props): JSX.Element {
  const [templates, setTemplates] = useState<PaperTemplate[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [title, setTitle] = useState("2026 年考研数学一模拟卷");
  const [seed, setSeed] = useState(20260823);
  const [requiredMajorTag, setRequiredMajorTag] = useState("");
  const [requiredSubTag, setRequiredSubTag] = useState("");
  const [paper, setPaper] = useState<Paper | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAgent, setShowAgent] = useState(false);
  const [message, setMessage] = useState("");
  const [packageState,setPackageState]=useState<PaperPackage|null>(null);
  const [packageBusy,setPackageBusy]=useState(false);
  const [downloadId,setDownloadId]=useState('');
  const [showTiming,setShowTiming]=useState(false);
  useEffect(()=>{if(!timerPaper)return;let cancelled=false;setShowTiming(false);setPackageState(null);setDownloadId('');void getPaper(timerPaper.id,timerPaper.version).then(value=>{if(!cancelled){setPaper(value);setTitle(value.title);setTemplateId(value.template_id);setSeed(value.seed);}}).catch(e=>{if(!cancelled)setMessage(String(e));});return()=>{cancelled=true;};},[timerPaper]);

  useEffect(() => {
    void getTemplates()
      .then((nextTemplates) => {
        setTemplates(nextTemplates);
        setTemplateId((current) => current || nextTemplates[0]?.id || "");
      })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "无法加载组卷数据"));
  }, []);

  const selectedTemplate = templates.find((template) => template.id === templateId);
  useEffect(() => {
    if (!selectedTemplate?.question_bank_id) {
      setQuestions([]);
      return;
    }
    void getQuestions(selectedTemplate.question_bank_id)
      .then(setQuestions)
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "无法加载题库"));
  }, [selectedTemplate?.question_bank_id]);
  const counts = useMemo(
    () =>
      questions.reduce(
        (result, question) => ({ ...result, [question.type]: (result[question.type] ?? 0) + 1 }),
        {} as Record<string, number>
      ),
    [questions]
  );
  const majorTagOptions = useMemo(
    () =>
      [
        ...new Set([
          ...questions.map((question) => question.tags[0]).filter(Boolean)
        ])
      ].sort((left, right) =>
        left.localeCompare(right, "zh-CN")
      ),
    [initialTags, questions]
  );
  const subTagOptions = useMemo(
    () =>
      [
        ...new Set(
          questions
            .filter((question) => !requiredMajorTag || question.tags[0] === requiredMajorTag)
            .map((question) => question.tags[1])
            .filter(Boolean)
        )
      ].sort((left, right) => left.localeCompare(right, "zh-CN")),
    [questions, requiredMajorTag]
  );

  async function buildPaper(settings?: AgentSettings): Promise<void> {
    if (!templateId) return;
    const agent = settings ?? getAgentSettings();
    if (selectedTemplate?.distribution_rules.agent_enabled && !agent) { setShowAgent(true); return; }
    setBusy(true);
    setMessage("");
    try {
      const nextPaper = await composePaper({
        agent: selectedTemplate?.distribution_rules.agent_enabled ? agent : undefined,
        template_id: templateId,
        title,
        seed,
        required_tags: [requiredMajorTag, requiredSubTag].filter(Boolean)
      });
      setPaper(nextPaper);
      setPackageState(null);setDownloadId('');setShowTiming(false);
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

  async function finishPackage(prepared:PaperPackage,allowMissing=false):Promise<void>{
    if(!paper)return;setPackageBusy(true);setMessage('');
    try{const job=await buildPaperPackage(paper.id,prepared.version,allowMissing);setDownloadId(job.id);setPaper(await getPaper(paper.id,job.version));setPackageState(null);}
    catch(e){setMessage(e instanceof Error?e.message:'整套导出失败，可按原版本重试');setPackageState(prepared);}
    finally{setPackageBusy(false);}
  }
  async function downloadPackage(format:'pdf'|'docx'):Promise<void>{
    if(!paper)return;setPackageBusy(true);setMessage('');setDownloadId('');setShowTiming(false);
    try{const prepared=await preparePaperPackage(paper.id,format,paper.export_version);setPackageState(prepared);if(!prepared.issues.length)await finishPackage(prepared);}
    catch(e){setMessage(e instanceof Error?e.message:'无法准备成套导出');}
    finally{setPackageBusy(false);}
  }

  return (
    <div className="compose-layout">
      {showAgent && <AgentDialog onClose={() => setShowAgent(false)} onConfirm={settings => { setShowAgent(false); void buildPaper(settings); }} />}
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
          <div className="metric-line">
            <span>关联题库</span>
            <strong>{questionBanks.find((bank) => bank.id === selectedTemplate?.question_bank_id)?.name ?? "未关联"}</strong>
          </div>
          <label>
            <span>固定随机种子</span>
            <input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value))} />
          </label>
          <label>
            <span>必须包含复式 tag</span>
            <div className="tag-filter-grid">
              <select
                aria-label="必须包含的大类 tag"
                value={requiredMajorTag}
                onChange={(event) => {
                  const nextMajor = event.target.value;
                  setRequiredMajorTag(nextMajor);
                  if (
                    requiredSubTag &&
                    !questions.some((question) => question.tags[0] === nextMajor && question.tags[1] === requiredSubTag)
                  ) {
                    setRequiredSubTag("");
                  }
                }}
              >
                <option value="">大类不限</option>
                {majorTagOptions.map((tag) => (
                  <option key={tag} value={tag}>{majorTagLabels[tag] ?? tag}</option>
                ))}
              </select>
              <select
                aria-label="必须包含的小类 tag"
                value={requiredSubTag}
                onChange={(event) => setRequiredSubTag(event.target.value)}
              >
                <option value="">小类不限</option>
                {subTagOptions.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
              </select>
            </div>
          </label>
          {selectedTemplate?.distribution_rules.agent_enabled && <button type="button" disabled={busy} onClick={() => setShowAgent(true)}>Agent 已开启 · 配置连接</button>}
          <button className="primary-action" onClick={() => void buildPaper()} disabled={busy || packageBusy || !templateId} type="button">
            <Shuffle size={19} />{busy ? "正在组卷..." : selectedTemplate?.distribution_rules.agent_enabled ? "Agent 组卷" : "本地规则组卷"}
          </button>
          {message && <div className="notice notice-danger">{message}</div>}
        </div>

        <div className="panel inventory-panel">
          <div className="panel-title"><Check size={20} />题库库存</div>
          <div className="inventory-grid">
            {(["choice", "fill", "solution", "short_answer"] as const).map((type) => (
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
            <div className="export-bar panel">
              <div>
                <span className="eyebrow">EXPORT PACKAGE</span>
                <strong>题卷 + 答案册</strong>
                <small>答案册包含已有参考答案、解析及评分点。</small>
              </div>
              <div className="export-actions">
                <button disabled={packageBusy||busy||!paper.validation.valid} onClick={()=>void downloadPackage('pdf')} type="button"><Download size={17}/>{packageBusy?'正在处理…':'整套 PDF（ZIP）'}</button>
                <button disabled={packageBusy||busy||!paper.validation.valid} onClick={()=>void downloadPackage('docx')} type="button">整套 Word（ZIP）</button>
              </div>
              <details><summary>单独导出</summary><p className="muted-copy">使用题库当前内容；需要版本一致请使用整套导出。</p><div className="export-actions">
                <button onClick={() => void download("pdf", "question")} type="button"><Download size={17} />题卷 PDF</button>
                <button onClick={() => void download("pdf", "answer")} type="button"><Download size={17} />答案 PDF</button>
                <button onClick={() => void download("docx", "question")} type="button"><FileTextIcon />题卷 Word</button>
                <button onClick={() => void download("docx", "answer")} type="button"><FileTextIcon />答案 Word</button>
              </div></details>
            </div>
            {packageState&&<div className="panel package-confirm" role="group" aria-label="检查导出内容"><strong>{packageState.issues.length?'部分答案或素材缺失':'导出未完成'}</strong><p>本次版本已固定，重试仍使用相同内容。</p><ul>{packageState.issues.map(issue=><li key={issue.question_id}>第 {issue.number} 题：{issue.messages.join('；')}</li>)}</ul><button disabled={packageBusy} onClick={()=>void finishPackage(packageState,true)}>{packageState.issues.length?'带缺失标注导出':'重试整套导出'}</button><button disabled={packageBusy} onClick={()=>setPackageState(null)}>取消</button></div>}
            {downloadId&&<div className="notice notice-info">整套文件已生成，题卷与答案册使用同一版本。<a href={exportDownloadUrl(downloadId)} target="_blank" rel="noreferrer" download>下载 ZIP</a></div>}
            <div className="panel paper-timer"><strong>用本卷时长计时</strong><p>计划 {paper.template?.duration_minutes??'待设置'} 分钟。到点提醒并记录超时，点击结束后保存用时。</p>{paper.export_version&&<small>关联导出版本：{paper.export_version}</small>}{showTiming?<TimerSetup key={paper.id+String(paper.export_version)} paper={{id:paper.id,version:paper.export_version}} title={paper.title} minutes={paper.template?.duration_minutes} onCancel={()=>setShowTiming(false)} onStarted={()=>{setShowTiming(false);openTimer();}}/>:<button disabled={packageBusy} onClick={()=>setShowTiming(true)}>准备计时</button>}</div>
            <div className="paper-sections">
              {paper.composition && <div className="notice notice-info">{paper.composition.rationale}</div>}
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
                            {(paper.export_version?question.frozen_question_preview:question.source_document_id && (question.source_regions?.length || question.source_page)) ? (
                              <div className="paper-source-preview">
                                <img
                                  alt={`第 ${question.source_page ?? "?"} 页原版题面`}
                                  loading="lazy"
                                  src={paper.export_version?packagePreviewUrl(paper.id,paper.export_version,question.id):questionPreviewUrl(question.id)}
                                />
                              </div>
                            ) : (
                              <div className="question-text">{question.stem_markdown}{question.options.map(option => <p key={option.key}>{option.key}. {option.text}</p>)}</div>
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
          </>
        )}
      </section>
    </div>
  );
}

function FileTextIcon(): JSX.Element {
  return <span className="text-icon">W</span>;
}
