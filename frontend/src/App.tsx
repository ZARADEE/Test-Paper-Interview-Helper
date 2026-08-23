import { BookOpenCheck, FileInput, FileText, LayoutTemplate, Settings2, SquareStack } from "lucide-react";
import { useEffect, useState } from "react";
import { getHealth, getTags } from "./api";
import { ComposeView } from "./components/ComposeView";
import { ImportView } from "./components/ImportView";
import { TemplateView } from "./components/TemplateView";
import type { TabId, Tag } from "./types";

const navItems: Array<{ id: TabId; label: string; number: string; icon: typeof BookOpenCheck }> = [
  { id: "compose", label: "考研组卷", number: "01", icon: BookOpenCheck },
  { id: "import", label: "试题导入", number: "02", icon: FileInput },
  { id: "templates", label: "试卷模板", number: "03", icon: LayoutTemplate }
];

export function App(): JSX.Element {
  const [activeTab, setActiveTab] = useState<TabId>("compose");
  const [tags, setTags] = useState<Tag[]>([]);
  const [status, setStatus] = useState<"online" | "offline">("offline");
  const [statusMessage, setStatusMessage] = useState("等待后端");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    void Promise.all([getHealth(), getTags()])
      .then(([health, nextTags]) => {
        setStatus(health.ok ? "online" : "offline");
        setStatusMessage(`${health.question_count} 道题 · ${health.template_count} 个模板`);
        setTags(nextTags);
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
            <span>试卷装配台 / 当前模块</span>
            <strong>{navItems.find((item) => item.id === activeTab)?.label}</strong>
          </div>
          <div className={`backend-status status-${status}`}>
            <span className="status-dot" />
            <span>{status === "online" ? "后端已连接" : "后端未连接"}</span>
            <small>{statusMessage}</small>
          </div>
        </header>

        <section className="workspace">
          {activeTab === "compose" && <ComposeView tags={tags} onChanged={refresh} />}
          {activeTab === "import" && <ImportView tags={tags} onChanged={refresh} />}
          {activeTab === "templates" && <TemplateView onChanged={refresh} />}
        </section>
      </main>
    </div>
  );
}

