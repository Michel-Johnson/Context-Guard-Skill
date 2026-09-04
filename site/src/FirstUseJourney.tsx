import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { clientViewport, type Client } from "./clients";
import { conversationTiming, type Usage } from "./app-usage";
import { getFirstUseStory } from "./first-use-story";
import { useLanguage } from "./i18n";
import type { ChapterId } from "./storyboard";
import { NativeClientFrame } from "./NativeClientFrame";
import { AnimatedNativeConversation } from "./NativeConversation";
import { NativeViewport } from "./NativeViewport";
import { useUsagePlayer } from "./useUsagePlayer";
import { Icon } from "./components";
import { UsageNavigation } from "./UsageNavigation";
import { TourStage } from "./Workbench";
import { getChapters } from "./storyboard";

export function FirstUseJourney({ client, reduced, active = true, initialChapter = 0, onUsageChange, onOpenDemo }: {
  client: Client;
  reduced: boolean;
  active?: boolean;
  initialChapter?: number;
  onUsageChange: (id: Usage["id"]) => void;
  onOpenDemo: (chapter: ChapterId) => void;
}) {
  const { language, t } = useLanguage();
  const { chapters, turns } = getFirstUseStory(language);
  const firstIndex = Math.max(0, Math.min(chapters.length - 1, initialChapter));
  const [position, setPosition] = useState({ index: firstIndex, revision: 0 });
  const [mode, setMode] = useState<"all" | "chapter">("all");
  const [finished, setFinished] = useState(false);
  const [full, setFull] = useState(false);
  const [cursorWorkbench, setCursorWorkbench] = useState(false);
  const chapter = chapters[position.index] ?? chapters[0];
  const turn = turns[chapter.turn];
  const timing = useMemo(() => conversationTiming(turn, client), [turn, client]);
  const history = useMemo(() => turns.slice(0, chapter.turn), [turns, chapter.turn]);
  const current = useRef({ position, mode, reduced });
  current.current = { position, mode, reduced };

  const player = useUsagePlayer(reduced, {
    duration: timing.end,
    milestones: [timing.command, timing.sent, timing.result],
    enabled: true,
    selected: active,
    scene: String(position.revision),
    onComplete: () => finishChapter(),
  });
  useLayoutEffect(() => { player.seek(0); }, [position.revision, reduced]);
  const openWorkbench = useCallback(() => {
    player.pause();
    setFinished(true);
    if (client.id === "cursor") {
      setCursorWorkbench(true);
      setFull(true);
      return;
    }
    onOpenDemo("map");
  }, [client.id, player.pause, onOpenDemo]);

  function select(index: number, resume = false) {
    setFinished(false);
    setCursorWorkbench(false);
    if (!resume) setFull(false);
    setPosition((value) => ({ index, revision: value.revision + 1 }));
    player.setPlaying(!reduced);
  }
  function finishChapter() {
    const state = current.current;
    if (!state.reduced && state.mode === "all" && state.position.index < chapters.length - 1)
      select(state.position.index + 1, true);
    else if (!state.reduced && state.position.index === chapters.length - 1)
      openWorkbench();
    else {
      player.pause();
      setFinished(true);
    }
  }
  const previousReduced = useRef(reduced);
  useEffect(() => {
    if (previousReduced.current !== reduced) {
      previousReduced.current = reduced;
      select(position.index);
    }
  }, [reduced]);
  function restart() { select(mode === "all" ? 0 : position.index); }
  const workbenchScene = useMemo(() => getChapters(language).find((item) => item.id === "map")!, [language]);
  const workspace = cursorWorkbench ? <TourStage chapter="map" steps={workbenchScene.steps} captions={workbenchScene.captions}
    label={t("工作台")} reduced={reduced} /> : undefined;
  const clientWindow = useMemo(() => <NativeClientFrame client={client} title={t("一起建立项目地图")} workspace={workspace}>
    <AnimatedNativeConversation resetToken={position.revision} reduced={reduced} client={client} usage={turn}
      history={history} workbenchLink={Boolean(turn.opensWorkbench)} clock={player.clock}
      onSeek={player.seek} onOpen={openWorkbench} />
  </NativeClientFrame>, [client, turn, history, player.clock, player.seek, openWorkbench, position.revision, reduced, t, workspace]);

  return <div className={`client-demo-body first-use-journey ${!player.active ? "is-paused" : ""} ${reduced ? "is-reduced" : ""}`} data-demo-scope="app">
    <UsageNavigation usageId="first" chapter={position.index} onChapterSelect={select}
      onUsageChange={onUsageChange} playbackMode={<div className="journey-mode" role="group" aria-label={t("播放方式")}>
        <button type="button" aria-pressed={mode === "all"} onClick={() => { setMode("all"); select(0); }}>{t("完整播放")}</button>
        <button type="button" aria-pressed={mode === "chapter"} onClick={() => { setMode("chapter"); select(position.index); }}>{t("单章播放")}</button>
      </div>} />
    <div className="client-reference-stage" ref={player.region}>
      <NativeViewport clock={player.clock} full={full} reduced={reduced} timing={timing} turnKey={turn.title}
        {...clientViewport(client)}>{clientWindow}</NativeViewport>
      <div className="client-demo-controls journey-controls" onMouseDown={(event) => event.preventDefault()}>
        <button type="button" disabled={reduced} aria-label={t(player.playing && !finished ? "暂停完整流程" : "播放完整流程")}
          onClick={() => finished ? restart() : player.setPlaying(!player.playing)}><Icon name={player.playing && !finished ? "pause" : "play"} size={15} /></button>
        <div className="journey-caption" aria-live="polite"><strong>{chapter.title}</strong></div>
        <button type="button" className="lesson-view-toggle" aria-pressed={full} onClick={() => setFull((value) => !value)}>{t(full ? "聚焦操作" : "查看全窗")}</button>
        <button type="button" aria-label={t("重播当前章节")} onClick={() => select(position.index)}><Icon name="reset" size={16} /></button>
        <button type="button" className="journey-next" disabled={position.index === chapters.length - 1} onClick={() => select(position.index + 1)}>{t("下一章")} <Icon name="arrow" size={14} /></button>
      </div>
    </div>
  </div>;
}
