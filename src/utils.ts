/** Clipboard with an execCommand fallback for restrictive contexts (file://, some WebViews). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function download(name: string, href: string) {
  const a = document.createElement("a");
  a.download = name;
  a.href = href;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Object-URL download for a Blob, with the URL revoked once saved. */
export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  download(name, url);
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
