import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { resolveLanguage, translate, type Language } from "./locale";

const preferenceKey = "cg-site-language";
const LocaleContext = createContext({
  language: "zh" as Language,
  t: (text: string) => text,
  setLanguage: (_language: Language) => {},
});

function readLanguage(): Language {
  let saved: string | null = null;
  try { saved = localStorage.getItem(preferenceKey); } catch { /* 禁止存储时仍可通过 URL 切换。 */ }
  return resolveLanguage(location.search, saved, navigator.language);
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, updateLanguage] = useState<Language>(readLanguage);
  const setLanguage = useCallback((next: Language) => {
    const url = new URL(location.href);
    url.searchParams.set("lang", next);
    history.replaceState(history.state, "", url);
    try { localStorage.setItem(preferenceKey, next); } catch { /* 不要求存储权限。 */ }
    updateLanguage(next);
  }, []);
  useEffect(() => {
    const onHistory = () => updateLanguage(readLanguage());
    window.addEventListener("popstate", onHistory);
    return () => window.removeEventListener("popstate", onHistory);
  }, []);
  useEffect(() => {
    document.documentElement.lang = language === "en" ? "en" : "zh-CN";
    document.title = translate(language, "Context Guard · 让项目记住每一步");
    const description = translate(language, "Context Guard，为 Codex、Cursor 和 Claude 保存项目记忆。通过可交互的动画，了解架构地图、工作台、会话接续与 Debug 流程。");
    document.querySelector('meta[name="description"]')?.setAttribute("content", description);
    document.querySelector('meta[property="og:title"]')?.setAttribute("content", document.title);
    document.querySelector('meta[property="og:description"]')?.setAttribute("content", translate(language, "会话、坏例、任务、地图。让人和 Agent 从同一份项目记忆继续。"));
  }, [language]);
  const value = useMemo(() => ({ language, setLanguage, t: (text: string) => translate(language, text) }), [language, setLanguage]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export const useLanguage = () => useContext(LocaleContext);
