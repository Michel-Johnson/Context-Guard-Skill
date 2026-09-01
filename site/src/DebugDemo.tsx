import { TourStage } from "./Workbench";
import { debugCaptions, debugSteps } from "./storyboard";
import { useLanguage } from "./i18n";

export function DebugDemo({ reduced = false, restartToken = 0 }: { reduced?: boolean; restartToken?: number }) {
  const { t } = useLanguage();
  return (
    <section className="debug-feature" id="debug">
      <div className="debug-feature-copy">
        <h2>
          {t("每个 Bug，")}
          <br />
          {t("都有来处。")}
        </h2>
      </div>
      <TourStage
        chapter="debug"
        steps={debugSteps.map(t)}
        captions={debugCaptions.map(t)}
        label="Debug"
        reduced={reduced}
        restartToken={restartToken}
      />
    </section>
  );
}
