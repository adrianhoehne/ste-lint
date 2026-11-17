/** Message templates: "{placeholder}" substitution from the language pack. */

export function render(template, vars = {}) {
  if (typeof template !== "string") return "";
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    vars[key] === undefined || vars[key] === null ? match : String(vars[key]),
  );
}

export function message(messages, key, vars = {}, fallback = "") {
  return render(messages?.[key], vars) || fallback || key;
}
