import { useLanguage } from "./i18n";

const records = [
  { title: "会话", detail: "做到哪里，下一步从哪里继续。" },
  { title: "任务", detail: "留下走通过的方法，复用工作经验。" },
  {
    title: "坏例",
    detail: "记住问题与修复，少踩一次旧坑。",
  },
  { title: "地图", detail: "把模块、路径和短记忆连在一起。" },
];

export function RecordGuide() {
  const { t } = useLanguage();
  return (
    <section
      className="memory-section"
      id="memory"
      aria-labelledby="memory-title"
    >
      <div className="memory-heading">
        <h2 id="memory-title">{t("记住进度，也记住来路。")}</h2>
      </div>
      <div className="record-grid">
        {records.map((record) => (
          <article className="record-item" key={record.title}>
            <h3>{t(record.title)}</h3>
            <p>{t(record.detail)}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
