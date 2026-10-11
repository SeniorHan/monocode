/**
 * Interface language for the webview.
 *
 * The table is gettext-style: the English source string *is* the key, so `t()`
 * falls back to the key itself when a translation is missing. That lets the
 * app stay English-only on the surfaces we have not covered yet, and lets
 * coverage grow one screen at a time instead of in one big migration.
 *
 * The preference follows the OS by default (`auto`), the same way the color
 * scheme does. It persists to localStorage and fires a change event, so
 * `useT()` can subscribe through `useSyncExternalStore`.
 *
 * Language tags are `zh-Hans` / `zh-Hant` rather than a bare `zh`, so a
 * Traditional Chinese table can be added later without re-tagging stored
 * values or changing the preference type.
 */

const LANGUAGE_KEY = "monocode.language";

/** Stored preference; `auto` follows the OS language. */
export type Language = "auto" | "en" | "zh-Hans";

/** The language actually rendered, after resolving `auto`. */
export type ResolvedLanguage = "en" | "zh-Hans";

export const LANGUAGE_DEFAULT: Language = "auto";

/** Fired on `window` when the interface language preference flips. */
export const LANGUAGE_CHANGE_EVENT = "monocode:language-change";

/**
 * Simplified Chinese table. Keys must match the English source literal
 * exactly, including curly apostrophes and any trailing spacing.
 */
const ZH_HANS: Record<string, string> = {
  // Settings: general
  Language: "语言",
  "Interface language": "界面语言",
  "Follows your system language by default.": "默认跟随系统语言。",
  Auto: "自动",
  "Auto (follow system)": "自动（跟随系统）",
  English: "English",
  "Simplified Chinese": "简体中文",

  // Settings: sections
  App: "应用",
  Agents: "智能体",
  Workspace: "工作区",
  General: "通用",
  Connections: "连接",
  Appearance: "外观",
  Keybindings: "快捷键",
  Chat: "对话",
  Providers: "提供程序",
  Skills: "技能",
  Monos: "Mono",
  Inbox: "收件箱",
  Worktrees: "工作树",
  Archive: "归档",

  // Settings: search
  "Search settings": "搜索设置",
  "No matching settings": "没有匹配的设置",

  // Common verbs
  Cancel: "取消",
  Save: "保存",
  Reset: "重置",
  Close: "关闭",
  Remove: "移除",
  Add: "添加",
  Search: "搜索",
  Settings: "设置",
};

const TABLES: Record<ResolvedLanguage, Record<string, string> | null> = {
  en: null,
  "zh-Hans": ZH_HANS,
};

function isLanguage(value: unknown): value is Language {
  return value === "auto" || value === "en" || value === "zh-Hans";
}

export function loadLanguage(): Language {
  try {
    const raw = localStorage.getItem(LANGUAGE_KEY);
    return isLanguage(raw) ? raw : LANGUAGE_DEFAULT;
  } catch {
    return LANGUAGE_DEFAULT;
  }
}

export function saveLanguage(value: Language) {
  const next = isLanguage(value) ? value : LANGUAGE_DEFAULT;
  try {
    localStorage.setItem(LANGUAGE_KEY, next);
  } catch {
    // private mode / quota
  }
  const resolved = currentLanguage();
  applyDocumentLanguage(resolved);
  pushMenuLanguage(resolved);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<Language>(LANGUAGE_CHANGE_EVENT, { detail: next }),
  );
}

/**
 * Hands the resolved language to the macOS menu bar.
 *
 * The menu bar lives outside the webview and cannot read localStorage, so the
 * Rust side keeps a mirror and rebuilds the native menu from it. The command
 * is a no-op off macOS, but the dynamic `invoke` import keeps the Tauri API
 * out of web builds that never call it.
 */
function pushMenuLanguage(language: ResolvedLanguage) {
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("set_menu_language", { language }))
    .catch(() => {
      // Not running under Tauri (plain `vite dev`, tests, browser build).
    });
}

/**
 * Maps a BCP-47 tag onto a language we have a table for. Traditional tags
 * (`zh-TW`, `zh-Hant*`) are deliberately *not* folded into Simplified; they
 * fall back to English until a `zh-Hant` table exists.
 */
export function tagToLanguage(
  tag: string | null | undefined,
): ResolvedLanguage {
  const lower = (tag ?? "").trim().toLowerCase();
  if (!lower) return "en";
  if (lower.startsWith("zh")) {
    if (lower.startsWith("zh-hant")) return "en";
    if (lower.startsWith("zh-tw") || lower.startsWith("zh-hk")) return "en";
    if (lower.startsWith("zh-mo")) return "en";
    return "zh-Hans";
  }
  return "en";
}

function systemLanguage(): ResolvedLanguage {
  try {
    if (typeof navigator === "undefined") return "en";
    const primary = navigator.language;
    const resolved = tagToLanguage(primary);
    if (resolved !== "en") return resolved;
    for (const tag of navigator.languages ?? []) {
      const next = tagToLanguage(tag);
      if (next !== "en") return next;
    }
    return "en";
  } catch {
    return "en";
  }
}

export function resolveLanguage(value: Language): ResolvedLanguage {
  return value === "auto" ? systemLanguage() : value;
}

// Re-read on every call but cache in between: `t()` runs hundreds of times per
// render, and comparing the raw stored string also self-heals when another app
// window (or a test) rewrites localStorage directly.
let cachedRaw: string | null | undefined;
let cachedResolved: ResolvedLanguage = "en";

export function currentLanguage(): ResolvedLanguage {
  let raw: string | null;
  try {
    raw = localStorage.getItem(LANGUAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedResolved = resolveLanguage(isLanguage(raw) ? raw : LANGUAGE_DEFAULT);
  }
  return cachedResolved;
}

export function subscribeLanguage(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(LANGUAGE_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(LANGUAGE_CHANGE_EVENT, onStoreChange);
}

function applyDocumentLanguage(language: ResolvedLanguage) {
  try {
    document.documentElement.lang = language;
  } catch {
    // not in a DOM
  }
}

/** Applies the persisted language at startup; no re-render is needed yet. */
export function initLanguage() {
  const resolved = currentLanguage();
  applyDocumentLanguage(resolved);
  // The native menu is built before the webview loads, in English; hand it the
  // persisted language so a Chinese user does not see an English menu bar.
  pushMenuLanguage(resolved);
}

/**
 * Looks up the current table. With no table for the resolved language, or no
 * entry for the key, the key (the English source) is returned unchanged.
 */
export function t(
  key: string,
  params?: Record<string, string | number>,
): string {
  const table = TABLES[currentLanguage()];
  let text = table?.[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

/** Exposed for the key-coverage check and tests. */
export function translationTable(
  language: ResolvedLanguage,
): Record<string, string> | null {
  return TABLES[language];
}
