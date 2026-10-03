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
        .bubble { max-width:min(680px,85%); padding:var(--sl-spacing-small) var(--sl-spacing-medium); border-radius:var(--sl-border-radius-large); white-space:pre-wrap; word-break:break-word; background:var(--sl-color-neutral-0); border:1px solid var(--sl-color-neutral-200); box-shadow:var(--sl-shadow-x-small); display:flex; align-items:center; gap:var(--sl-spacing-small); }
        .content { min-width:0; }
        sl-spinner { display:none; flex:none; }
        :host([role="user"]) .bubble { background:var(--sl-color-primary-600); border-color:var(--sl-color-primary-600); color:var(--sl-color-neutral-0); border-bottom-right-radius:var(--sl-border-radius-small); }
        :host([role="bot"]) .bubble { border-bottom-left-radius:var(--sl-border-radius-small); }
        :host([variant="pending"]) .bubble { color:var(--sl-color-neutral-600); }
        :host([variant="pending"]) sl-spinner { display:block; }
        :host([variant="error"]) .bubble { background:var(--sl-color-danger-50); border-color:var(--sl-color-danger-300); color:var(--sl-color-danger-800); }
        ::slotted(a) { color:var(--sl-color-primary-600); }
        ::slotted(small) { display:block; margin-top:var(--sl-spacing-3x-small); font-size:var(--sl-font-size-x-small); color:var(--sl-color-neutral-500); }
      </style>
      <div class="bubble"><sl-spinner></sl-spinner><div class="content"><slot></slot></div></div>`;
  }

  connectedCallback(): void {
    if (!this.hasAttribute("role")) this.setAttribute("role", "bot");
  }
}

customElements.define("chat-message", ChatMessage);
