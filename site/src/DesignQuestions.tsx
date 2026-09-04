import { useState } from "react";
import { designQuestions } from "./design-questions";
import { useLanguage } from "./i18n";

export function DesignQuestions() {
  const { t } = useLanguage();
  const [selectedId, setSelectedId] = useState(designQuestions[0].id);
  const selected = designQuestions.find((item) => item.id === selectedId) ?? designQuestions[0];

  return (
    <section className="decision-section" id="decisions" aria-labelledby="decision-title">
      <header className="decision-heading">
        <div>
          <p className="decision-kicker">{t("设计问答")}</p>
          <h2 id="decision-title">{t("为什么这样管理 Context？")}</h2>
        </div>
        <p className="decision-intro">
          {t("把开发中的问题整理成可以复用的设计理由，而不是散落在聊天记录里。")}
        </p>
      </header>

      <div className="decision-layout">
        <div className="decision-list" aria-label={t("选择设计问题")}>
          {designQuestions.map((item, index) => (
            <button
              type="button"
              key={item.id}
              className={item.id === selected.id ? "active" : undefined}
              aria-pressed={item.id === selected.id}
              onClick={() => setSelectedId(item.id)}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              {t(item.title)}
            </button>
          ))}
        </div>

        <article className="decision-answer" aria-live="polite">
          <p className="decision-number">Q / {String(designQuestions.indexOf(selected) + 1).padStart(2, "0")}</p>
          <h3>{t(selected.question)}</h3>
          <p className="decision-thesis">{t(selected.answer)}</p>
          <p className="decision-reason">{t(selected.reason)}</p>
          <div className="decision-trail" aria-label={t("设计逻辑")}>
            {selected.trail.map((step, index) => (
              <span key={step}>
                <b>{t(step)}</b>
                {index < selected.trail.length - 1 && <i aria-hidden="true">→</i>}
              </span>
            ))}
          </div>
          <div className="decision-example">
            <strong>{t("项目里的例子")}</strong>
            <p>{t(selected.example)}</p>
          </div>
        </article>
      </div>
    </section>
  );
}
