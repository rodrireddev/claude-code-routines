/** Creates an element; string children are inserted as text (never parsed as HTML). */
export function h(tag: string, props: Record<string, string> = {}, ...children: (Node | string | null)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) el.setAttribute(k, v);
  for (const c of children) if (c !== null) el.append(c);
  return el;
}
