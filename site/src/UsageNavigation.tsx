import type { ReactNode } from "react";
import type { Client } from "./clients";
import { getUsages, type Usage } from "./app-usage";
import { getFirstUseStory } from "./first-use-story";
import { useLanguage } from "./i18n";

export function UsageNavigation({ client, usageId, chapter = 0, onChapterSelect, onUsageChange, onPause, playbackMode }: {
  client: Client;
  usageId: Usage["id"];
  chapter?: number;
  onChapterSelect: (index: number) => void;
  onUsageChange: (id: Usage["id"]) => void;
  onPause: () => void;
  playbackMode?: ReactNode;
}) {
  const { language, t } = useLanguage();
  const { chapters } = getFirstUseStory(language);
  const usages = getUsages(language);
  return <nav className="client-route" aria-label={t("演示流程")}>
    {playbackMode && <div className="client-route-heading">{playbackMode}</div>}
    <select className="client-chapter-select" aria-label={t("选择演示章节")} value={usageId === "first" ? String(chapter) : ""}
      onChange={(event) => onChapterSelect(Number(event.target.value))}>
      {usageId !== "first" && <option value="" disabled>{t("选择首用章节")}</option>}
      {chapters.map((item, index) => <option key={item.id} value={index}>{String(index + 1).padStart(2, "0")}　{item.title}</option>)}
    </select>
    <div className="client-route-chapters">
      {chapters.map((item, index) => <button type="button" key={item.id}
        aria-current={usageId === "first" && chapter === index ? "step" : undefined}
        className={usageId === "first" && index < chapter ? "passed" : ""}
        onClick={() => onChapterSelect(index)}>
        <span>{String(index + 1).padStart(2, "0")}</span>{item.title}
      </button>)}
    </div>
    <div className="client-route-followups">
      {usages.filter((item) => item.id !== "first").map((item) => <button type="button" key={item.id}
        aria-current={usageId === item.id ? "step" : undefined} onClick={() => onUsageChange(item.id)}>
        {item.title}
      </button>)}
    </div>
    <details className="client-precondition" onToggle={(event) => { if (event.currentTarget.open) onPause(); }}>
      <summary>{t("使用前提")}</summary><p>{client.precondition}</p>
      <a href="#install" onClick={onPause}>{t("安装方式")} ↗</a>
      <a href={client.source} target="_blank" rel="noreferrer">{client.label} {t("使用说明")} ↗</a>
    </details>
  </nav>;
}
