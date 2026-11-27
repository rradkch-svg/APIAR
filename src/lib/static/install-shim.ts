"use client";

import { handleStaticApiRequest, subscribeStaticRealtime } from "./client-backend";

declare global {
  interface Window {
    __velaStaticShimInstalled?: boolean;
  }
}

function isStaticApiUrl(input: RequestInfo | URL): string | null {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

  try {
    const parsed = new URL(raw, window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
    const path =
      base && parsed.pathname.startsWith(base)
        ? parsed.pathname.slice(base.length) || "/"
        : parsed.pathname;
    if (path.startsWith("/api/v1/")) {
      return parsed.href;
    }
  } catch {
    // ignore invalid URLs
  }
  return null;
}

class StaticEventSourceShim {
  public readonly url: string;
  public readyState = 0;
  public onopen: ((ev: Event) => void) | null = null;
  public onerror: ((ev: Event) => void) | null = null;
  public onmessage: ((ev: MessageEvent) => void) | null = null;
  private listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  private unsubscribe: (() => void) | null = null;

  constructor(url: string | URL) {
    this.url = typeof url === "string" ? url : url.href;
    this.readyState = 1;
    this.unsubscribe = subscribeStaticRealtime((evName, data) => {
      this.dispatch(evName, data);
    });
    setTimeout(() => {
      if (this.readyState === 1) {
        this.dispatch("connected", { ok: true, mode: "static" });
      }
    }, 0);
  }

  private dispatch(evName: string, data: Record<string, unknown>) {
    const set = this.listeners.get(evName);
    if (!set || set.size === 0) return;
    const ev = new MessageEvent(evName, { data: JSON.stringify(data) });
    for (const fn of set) {
      if (typeof fn === "function") fn(ev);
      else fn.handleEvent(ev);
    }
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.get(type)?.delete(listener);
  }

  close() {
    this.readyState = 2;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.listeners.clear();
  }
}

export function installStaticShimIfNeeded() {
  if (process.env.NEXT_PUBLIC_STATIC_MODE !== "1") return;
  if (typeof window === "undefined") return;
  if (window.__velaStaticShimInstalled) return;
  window.__velaStaticShimInstalled = true;

  const nativeFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const apiHref = isStaticApiUrl(input);
    if (apiHref) {
      return handleStaticApiRequest(apiHref, init, nativeFetch);
    }
    return nativeFetch(input, init);
  };

  const NativeEventSource = window.EventSource;
  window.EventSource = class extends StaticEventSourceShim {
    constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
      const href = typeof url === "string" ? url : url.href;
      if (href.includes("/api/v1/events")) {
        super(url);
      } else if (NativeEventSource) {
        return new NativeEventSource(url, eventSourceInitDict) as unknown as StaticEventSourceShim;
      } else {
        super(url);
      }
    }
  } as unknown as typeof EventSource;
}

// Execute synchronously on module evaluation so child effects always see the shimmed APIs
installStaticShimIfNeeded();
