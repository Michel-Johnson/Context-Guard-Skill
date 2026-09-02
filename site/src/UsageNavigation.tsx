import type { ReactNode } from "react";
import { getUsages, type Usage } from "./app-usage";
import { getFirstUseStory } from "./first-use-story";
import { useLanguage } from "./i18n";

export function UsageNavigation({ usageId, chapter = 0, onChapterSelect, onUsageChange, playbackMode }: {
  usageId: Usage["id"];
  chapter?: number;
  onChapterSelect: (index: number) => void;
  onUsageChange: (id: Usage["id"]) => void;
  playbackMode?: ReactNode;
}) {
  const { language, t } = useLanguage();
  const { chapters } = getFirstUseStory(language);
  const usages = getUsages(language);
  return <nav className="client-route" aria-label={t("演示流程")}>
    {playbackMode && <div className="client-route-heading">{playbackMode}</div>}
    <select className="client-chapter-select" aria-label={t("选择演示章节")}
      value={usageId === "first" ? `chapter:${chapter}` : `usage:${usageId}`}
      onChange={(event) => {
        const [kind, value] = event.target.value.split(":");
        if (kind === "usage") onUsageChange(value as Usage["id"]);
        else onChapterSelect(Number(value));
      }}>
      <optgroup label={t("第一次使用")}>
        {chapters.map((item, index) => <option key={item.id} value={`chapter:${index}`}>{String(index + 1).padStart(2, "0")}　{item.title}</option>)}
      </optgroup>
      <optgroup label={t("更多场景")}>
        {usages.filter((item) => item.id !== "first").map((item) => <option key={item.id} value={`usage:${item.id}`}>{item.title}</option>)}
      </optgroup>
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
  </nav>;
}
