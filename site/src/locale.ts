import englishMessages from "./locales/en.json" with { type: "json" };

export type Language = "zh" | "en";
const english: Readonly<Record<string, string>> = englishMessages;

export function translate(language: Language, text: string): string {
  return language === "en" ? english[text] ?? text : text;
}

// 只翻译值，不改 ID、对象键、路径或未列入词典的命令。
export function localizeData<T>(language: Language, value: T): T {
  if (language === "zh") return value;
  if (typeof value === "string") return translate(language, value) as T;
  if (Array.isArray(value)) return value.map((item) => localizeData(language, item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, localizeData(language, item)])) as T;
  }
  return value;
}

export function resolveLanguage(search: string, saved: string | null, browserLanguage: string): Language {
  const query = new URLSearchParams(search).get("lang");
  if (query === "en" || query === "zh") return query;
  if (saved === "en" || saved === "zh") return saved;
  return browserLanguage.toLowerCase().startsWith("zh") ? "zh" : "en";
}
