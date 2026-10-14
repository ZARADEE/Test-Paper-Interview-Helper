import { BookOpenCheck, Home, LayoutTemplate, ListChecks, Settings2, SquareStack } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { getHealth, getQuestionBanks, getTags } from "./api";
import { ComposeView } from "./components/ComposeView";
import { HomeDashboard } from "./components/HomeDashboard";
import { PetTodoPanel } from "./components/PetTodoPanel";
import { AmbientTimer, TimerDock } from './components/TimerCard';
import { OPEN_TIMER, OPEN_TIMER_PAPER } from './timer/client';
import type { PaperLink } from './timer/model';
import { DesktopPetView } from "./components/DesktopPetView";
import { PracticeWorkspace } from "./components/PracticeWorkspace";
import { OPEN_REVIEW, ReviewReminder } from "./components/ReviewTask";
import { TemplateView } from "./components/TemplateView";
import { ViewErrorBoundary } from "./components/ViewErrorBoundary";
import type { QuestionBank, TabId, Tag } from "./types";

const navItems: Array<{ id: TabId; label: string; number: string; icon: LucideIcon }> = [
  { id: "home", label: "首页", number: "00", icon: Home },
  { id: "compose", label: "考研组卷", number: "01", icon: BookOpenCheck },
  { id: "practice", label: "小题狂练", number: "02", icon: ListChecks },
  { id: "templates", label: "试卷模板", number: "03", icon: LayoutTemplate }
];

export function App(): JSX.Element {
  const surface = new URLSearchParams(window.location.search).get("surface");
  return surface === 'timer' ? <AmbientTimer/> : surface === "todos" ? <PetTodoPanel /> : surface === "pet" || surface === "ball" ? <DesktopPetView /> : <MainApp />;
}

function MainApp(): JSX.Element {
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [timerPaper,setTimerPaper] = useState<PaperLink|undefined>();
  useEffect(()=>{
    const open=()=>{setActiveTab('home');setTimeout(()=>document.querySelector('.home-pomodoro')?.scrollIntoView({block:'center'}),80);};
    const paper=(e:Event)=>{setTimerPaper((e as CustomEvent<PaperLink>).detail);setActiveTab('compose');};
    window.addEventListener(OPEN_TIMER,open);window.addEventListener(OPEN_TIMER_PAPER,paper);
    const stop=window.paperHelper?.onTimerOpen(p=>p?paper(new CustomEvent(OPEN_TIMER_PAPER,{detail:p})):open());
    return()=>{window.removeEventListener(OPEN_TIMER,open);window.removeEventListener(OPEN_TIMER_PAPER,paper);stop?.();};
  },[]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [questionBanks, setQuestionBanks] = useState<QuestionBank[]>([]);
  const [questionCount, setQuestionCount] = useState(0);
  const [templateCount, setTemplateCount] = useState(0);
  const [status, setStatus] = useState<"online" | "offline">("offline");
  const [statusMessage, setStatusMessage] = useState("等待后端");
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(()=>{
    const open=()=>setActiveTab("practice");
    window.addEventListener(OPEN_REVIEW,open);
    const stop=window.paperHelper?.onOpenReview(()=>window.dispatchEvent(new Event(OPEN_REVIEW)));
    return()=>{window.removeEventListener(OPEN_REVIEW,open);stop?.();};
  },[]);

  useEffect(() => {
    void Promise.all([getHealth(), getQuestionBanks(), getTags()])
      .then(([health, nextBanks, nextTags]) => {
        setStatus(health.ok ? "online" : "offline");
        setStatusMessage(`${health.question_count} 道题 · ${health.template_count} 个模板`);
        setQuestionCount(health.question_count);
        setTemplateCount(health.template_count);
        setTags(nextTags);
        setQuestionBanks(nextBanks);
      })
      .catch((error: unknown) => {
        setStatus("offline");
        setStatusMessage(error instanceof Error ? error.message : "后端未连接");
      });
  }, [refreshKey]);

  function refresh(): void {
    setRefreshKey((value) => value + 1);
  }

  return (
    <div className="app-shell">
      <ReviewReminder />
      <TimerDock home={activeTab==='home'}/>
      <aside className="left-rail">
        <div className="brand-block">
          <SquareStack size={28} strokeWidth={3} />
          <strong>组卷<br />助手</strong>
          <span>BUILD / PAPER</span>
        </div>
        <nav className="rail-nav" aria-label="主导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`rail-button ${activeTab === item.id ? "is-active" : ""}`}
                onClick={() => setActiveTab(item.id)}
                type="button"
              >
                <Icon size={22} />
                <span>{item.label}</span>
                <small>{item.number}</small>
              </button>
            );
          })}
        </nav>
        <div className="rail-footer">
          <Settings2 size={18} />
          <span>LOCAL / WIN</span>
        </div>
      </aside>

      <main className="main-workspace">
        <header className="top-strip">
          <div className="page-code">PAPER<br />LAB</div>
          <div className="top-title">
            <span>{activeTab === "home" ? "考研复习工作台 / 当前模块" : "试卷装配台 / 当前模块"}</span>
            <strong>{navItems.find((item) => item.id === activeTab)?.label}</strong>
          </div>
          <div className={`backend-status status-${status}`}>
            <span className="status-dot" />
            <span>{status === "online" ? "后端已连接" : "后端未连接"}</span>
            <small>{statusMessage}</small>
          </div>
        </header>

        <section className="workspace">
          <ViewErrorBoundary key={activeTab}>
          {activeTab === "home" && (
            <HomeDashboard
              questionBanks={questionBanks}
            />
          )}
          {activeTab === "compose" && <ComposeView tags={tags} questionBanks={questionBanks} onChanged={refresh} timerPaper={timerPaper} />}
          {activeTab === "templates" && <TemplateView tags={tags} questionBanks={questionBanks} onChanged={refresh} />}
          </ViewErrorBoundary>
          <div className={`tab-view ${activeTab === "practice" ? "" : "tab-view-hidden"}`}><ViewErrorBoundary><PracticeWorkspace active={activeTab==="practice"} /></ViewErrorBoundary></div>
        </section>
      </main>
    </div>
  );
}
