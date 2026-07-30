const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseEmail(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!EMAIL_RE.test(value)) {
    return null;
  }
  return value;
}

export function parseRequiredText(raw: string, min = 2, max = 120): string | null {
  const value = raw.trim().replace(/\s+/g, " ");
  if (value.length < min || value.length > max) {
    return null;
  }
  return value;
}

export function isSkip(raw: string): boolean {
  const lower = raw.trim().toLowerCase();
  return ["pular", "skip", "-", "nao", "não", "n", "sem"].includes(lower);
}
