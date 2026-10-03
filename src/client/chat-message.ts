export type Role = "user" | "bot";
export type Variant = "" | "pending" | "error";

/** <chat-message role="user|bot" variant="pending|error">contenido</chat-message> */
export class ChatMessage extends HTMLElement {
  static observedAttributes = ["role", "variant"];

  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML = `
      <style>
        :host { display:flex; gap:var(--sl-spacing-small); width:100%; }
        :host([role="user"]) { justify-content:flex-end; }
        .avatar { flex:none; width:28px; height:28px; border-radius:50%; background:var(--sl-color-primary-600); color:#fff; display:grid; place-items:center; font-size:14px; margin-top:2px; }
        :host([role="user"]) .avatar { display:none; }
        .body { min-width:0; line-height:1.65; white-space:pre-wrap; word-break:break-word; display:flex; align-items:flex-start; gap:var(--sl-spacing-small); }
        :host([role="user"]) .body { max-width:80%; padding:var(--sl-spacing-x-small) var(--sl-spacing-medium); border-radius:var(--sl-border-radius-x-large); background:var(--sl-color-neutral-100); }
        sl-spinner { display:none; flex:none; margin-top:4px; }
        :host([variant="pending"]) .body { color:var(--sl-color-neutral-500); }
        :host([variant="pending"]) sl-spinner { display:block; }
        :host([variant="error"]) .body { color:var(--sl-color-danger-700); background:var(--sl-color-danger-50); border:1px solid var(--sl-color-danger-200); border-radius:var(--sl-border-radius-large); padding:var(--sl-spacing-x-small) var(--sl-spacing-medium); }
        ::slotted(small) { display:block; margin-top:var(--sl-spacing-2x-small); font-size:var(--sl-font-size-small); color:var(--sl-color-neutral-500); }
      </style>
      <div class="avatar">✦</div>
      <div class="body"><sl-spinner></sl-spinner><div><slot></slot></div></div>`;
  }

  connectedCallback(): void {
    if (!this.hasAttribute("role")) this.setAttribute("role", "bot");
  }
}

customElements.define("chat-message", ChatMessage);
