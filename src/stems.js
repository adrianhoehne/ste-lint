/** Word forms to try against a vocabulary entry. Deliberately small and data-first. */

export function stems(word, mode) {
  const lower = String(word).toLowerCase();
  const forms = new Set([lower]);
  if (mode === "en") {
    if (lower.endsWith("ies") && lower.length > 4) forms.add(lower.slice(0, -3) + "y");
    if (lower.endsWith("es") && lower.length > 4) forms.add(lower.slice(0, -2));
    if (lower.endsWith("s") && lower.length > 3) forms.add(lower.slice(0, -1));
    if (lower.endsWith("ed") && lower.length > 4) {
      forms.add(lower.slice(0, -2));
      forms.add(lower.slice(0, -1));
    }
    if (lower.endsWith("ing") && lower.length > 5) {
      forms.add(lower.slice(0, -3));
      forms.add(lower.slice(0, -3) + "e");
    }
    if (lower.endsWith("ly") && lower.length > 4) forms.add(lower.slice(0, -2));
  } else if (mode === "de") {
    for (const suffix of ["en", "n", "e", "s", "es", "em", "er"]) {
      if (lower.endsWith(suffix) && lower.length - suffix.length >= 4) forms.add(lower.slice(0, -suffix.length));
    }
  }
  return forms;
}
