export type Role = "user" | "bot";
export type Variant = "" | "pending" | "error";

/** <chat-message role="user|bot" variant="pending|error">contenido</chat-message> */
export class ChatMessage extends HTMLElement {
  static observedAttributes = ["role", "variant"];

  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML = `
      <style>
        :host { display:flex; }
        :host([role="user"]) { justify-content:flex-end; }
        .bubble { max-width:min(680px,85%); padding:10px 14px; border-radius:14px; white-space:pre-wrap; word-break:break-word; background:var(--bot); }
        :host([role="user"]) .bubble { background:var(--user); color:#fff; border-bottom-right-radius:4px; }
        :host([role="bot"]) .bubble { border-bottom-left-radius:4px; }
        :host([variant="pending"]) .bubble { color:var(--muted); font-style:italic; }
        :host([variant="error"]) .bubble { color:var(--err); }
        ::slotted(a) { color:inherit; }
        ::slotted(small) { display:block; margin-top:4px; font-size:12px; color:var(--muted); }
      </style>
      <div class="bubble"><slot></slot></div>`;
  }

  connectedCallback(): void {
    if (!this.hasAttribute("role")) this.setAttribute("role", "bot");
  }
}

customElements.define("chat-message", ChatMessage);
