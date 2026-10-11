// @vitest-environment happy-dom
import { beforeEach, expect, it, describe, vi, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  currentLanguage,
  initLanguage,
  LANGUAGE_CHANGE_EVENT,
  LANGUAGE_DEFAULT,
  loadLanguage,
  resolveLanguage,
  saveLanguage,
  subscribeLanguage,
  t,
  tagToLanguage,
  translationTable,
  type Language,
} from "./i18n";

const stored = new Map<string, string>();

beforeEach(() => {
  stored.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
  vi.stubGlobal("navigator", { language: "en-US", languages: ["en-US"] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadLanguage", () => {
  it("defaults to auto when nothing is stored", () => {
    expect(loadLanguage()).toBe(LANGUAGE_DEFAULT);
  });

  it("returns a stored preference", () => {
    saveLanguage("zh-Hans");
    expect(loadLanguage()).toBe("zh-Hans");
  });

  it("ignores an unrecognized stored value", () => {
    stored.set("monocode.language", "klingon");
    expect(loadLanguage()).toBe(LANGUAGE_DEFAULT);
  });

  it("survives a localStorage that throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("private mode");
      },
      setItem: () => {
        throw new Error("private mode");
      },
    });
    expect(loadLanguage()).toBe(LANGUAGE_DEFAULT);
  });
});

describe("tagToLanguage", () => {
  it("maps Simplified Chinese tags to zh-Hans", () => {
    expect(tagToLanguage("zh")).toBe("zh-Hans");
    expect(tagToLanguage("zh-CN")).toBe("zh-Hans");
    expect(tagToLanguage("zh-Hans")).toBe("zh-Hans");
    expect(tagToLanguage("zh-SG")).toBe("zh-Hans");
    expect(tagToLanguage("ZH-cn")).toBe("zh-Hans");
  });

  it("does not fold Traditional Chinese into Simplified", () => {
    // These fall back to English until a zh-Hant table exists, which is a
    // better outcome than showing Simplified to a Traditional reader.
    expect(tagToLanguage("zh-TW")).toBe("en");
    expect(tagToLanguage("zh-HK")).toBe("en");
    expect(tagToLanguage("zh-MO")).toBe("en");
    expect(tagToLanguage("zh-Hant")).toBe("en");
    expect(tagToLanguage("zh-Hant-TW")).toBe("en");
  });

  it("maps everything else to English", () => {
    expect(tagToLanguage("en")).toBe("en");
    expect(tagToLanguage("fr-FR")).toBe("en");
    expect(tagToLanguage("")).toBe("en");
    expect(tagToLanguage(null)).toBe("en");
    expect(tagToLanguage(undefined)).toBe("en");
  });
});

describe("resolveLanguage", () => {
  it("returns an explicit preference untouched", () => {
    expect(resolveLanguage("en")).toBe("en");
    expect(resolveLanguage("zh-Hans")).toBe("zh-Hans");
  });

  it("resolves auto from the system language", () => {
    vi.stubGlobal("navigator", { language: "zh-CN", languages: ["zh-CN"] });
    expect(resolveLanguage("auto")).toBe("zh-Hans");
  });

  it("falls back to English for a Traditional system on auto", () => {
    vi.stubGlobal("navigator", { language: "zh-TW", languages: ["zh-TW"] });
    expect(resolveLanguage("auto")).toBe("en");
  });

  it("checks the language list when the primary tag is English", () => {
    vi.stubGlobal("navigator", {
      language: "en-US",
      languages: ["en-US", "zh-Hans-CN"],
    });
    expect(resolveLanguage("auto")).toBe("zh-Hans");
  });
});

describe("currentLanguage", () => {
  it("re-reads when the stored value changes underneath it", () => {
    expect(currentLanguage()).toBe("en");
    stored.set("monocode.language", "zh-Hans");
    expect(currentLanguage()).toBe("zh-Hans");
  });
});

describe("t", () => {
  it("returns the key unchanged when no translation exists", () => {
    saveLanguage("zh-Hans");
    expect(t("Some string nobody translated")).toBe(
      "Some string nobody translated",
    );
  });

  it("returns the key unchanged in English", () => {
    saveLanguage("en");
    expect(t("General")).toBe("General");
  });

  it("translates a known key in Simplified Chinese", () => {
    saveLanguage("zh-Hans");
    expect(t("General")).toBe("通用");
    expect(t("Interface language")).toBe("界面语言");
  });

  it("interpolates {name} placeholders", () => {
    saveLanguage("zh-Hans");
    expect(t("Close {name}", { name: "abc" })).toBe("Close abc");
  });

  it("leaves an unmatched placeholder alone", () => {
    saveLanguage("zh-Hans");
    expect(t("Close {name}")).toBe("Close {name}");
  });
});

describe("saveLanguage", () => {
  it("dispatches a change event with the stored value", () => {
    const seen: Language[] = [];
    const listener = (event: Event) => {
      seen.push((event as CustomEvent<Language>).detail);
    };
    window.addEventListener(LANGUAGE_CHANGE_EVENT, listener);
    saveLanguage("zh-Hans");
    window.removeEventListener(LANGUAGE_CHANGE_EVENT, listener);
    expect(seen).toEqual(["zh-Hans"]);
  });

  it("normalizes an invalid value to the default", () => {
    saveLanguage("nonsense" as Language);
    expect(loadLanguage()).toBe(LANGUAGE_DEFAULT);
  });
});

describe("subscribeLanguage", () => {
  it("calls back on every save and unsubscribes cleanly", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLanguage(listener);
    saveLanguage("zh-Hans");
    expect(listener).toHaveBeenCalledTimes(1);
    saveLanguage("en");
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    saveLanguage("zh-Hans");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("initLanguage", () => {
  it("sets the document language from the stored preference", () => {
    saveLanguage("zh-Hans");
    initLanguage();
    expect(document.documentElement.lang).toBe("zh-Hans");
    saveLanguage("en");
    initLanguage();
    expect(document.documentElement.lang).toBe("en");
  });
});

describe("translationTable", () => {
  it("has no table for English and one for Simplified Chinese", () => {
    expect(translationTable("en")).toBeNull();
    expect(translationTable("zh-Hans")).not.toBeNull();
  });

  it("translates every key the source calls t() with", () => {
    // Guards against adding a `t("…")` call without a Chinese entry: the
    // gettext fallback would silently ship English into the Chinese UI.
    // Only a bare `t(` counts — `foo.t(` and `format(` are other functions.
    const keys = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
          continue;
        }
        const text = readFileSync(path, "utf8");
        for (const match of text.matchAll(
          /(^|[^.A-Za-z0-9_])t\("([^"]+)"\)/g,
        )) {
          const key = match[2];
          if (key) keys.add(key);
        }
      }
    };
    walk(join(process.cwd(), "src"));
    expect(keys.size).toBeGreaterThan(0);
    const table = translationTable("zh-Hans") ?? {};
    const missing = [...keys].filter((key) => !(key in table));
    expect(missing).toEqual([]);
  });
});

describe("native menu sync", () => {
  it("pushes the resolved language to the menu on change and at startup", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
    vi.resetModules();
    const fresh = await import("./i18n");
    fresh.initLanguage();
    await vi.dynamicImportSettled();
    expect(invoke).toHaveBeenCalledWith("set_menu_language", {
      language: "en",
    });
    invoke.mockClear();
    fresh.saveLanguage("zh-Hans");
    await vi.dynamicImportSettled();
    expect(invoke).toHaveBeenCalledWith("set_menu_language", {
      language: "zh-Hans",
    });
    vi.doUnmock("@tauri-apps/api/core");
  });

  it("survives the Tauri module being absent", async () => {
    vi.doMock("@tauri-apps/api/core", () => {
      throw new Error("no tauri");
    });
    vi.resetModules();
    const fresh = await import("./i18n");
    expect(() => fresh.initLanguage()).not.toThrow();
    await vi.dynamicImportSettled();
    vi.doUnmock("@tauri-apps/api/core");
  });
});
