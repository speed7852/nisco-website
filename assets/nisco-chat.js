(() => {
  const panel = document.getElementById("nisco-chat-panel");
  const launcher = document.querySelector(".nisco-chat-launcher");
  const close = document.querySelector(".nisco-chat-close");
  const form = document.getElementById("nisco-chat-form");
  const input = document.getElementById("nisco-chat-input");
  const messagesEl = document.getElementById("nisco-chat-messages");
  const suggestions = document.getElementById("nisco-chat-suggestions");
  if (!panel || !launcher || !form) return;

  // Set this to the deployed NISCO AI Worker URL after deployment.
  const API_URL = "https://nisco-ai.speedhome7852.workers.dev/chat";
  const history = [];
  let busy = false;

  function toggle(open) {
    panel.hidden = !open;
    launcher.setAttribute("aria-expanded", String(open));
    if (open) input.focus();
  }
  function addMessage(text, role, extraClass = "") {
    const node = document.createElement("div");
    node.className = "nisco-chat-message " + role + (extraClass ? " " + extraClass : "");
    node.textContent = text;
    messagesEl.appendChild(node);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return node;
  }
  async function send(text) {
    const message = text.trim();
    if (!message || busy) return;
    busy = true;
    suggestions.hidden = true;
    addMessage(message, "user");
    history.push({ role: "user", content: message });
    input.value = "";
    const typing = addMessage("NISCO AI is thinking…", "assistant", "typing");
    const submit = form.querySelector("button");
    submit.disabled = true;
    try {
      if (API_URL.includes("YOUR-SUBDOMAIN")) {
        throw new Error("NISCO AI is being configured. Please check back shortly.");
      }
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-12) })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The assistant is temporarily unavailable.");
      const reply = String(data.reply || "I couldn't prepare a response. Please try again.");
      history.push({ role: "assistant", content: reply });
      typing.textContent = reply;
      typing.classList.remove("typing");
    } catch (error) {
      typing.textContent = error.message || "Something went wrong. Please try again.";
      typing.classList.remove("typing");
      typing.classList.add("error");
      history.pop();
    } finally {
      busy = false;
      submit.disabled = false;
      input.focus();
    }
  }
  launcher.addEventListener("click", () => toggle(panel.hidden));
  close.addEventListener("click", () => toggle(false));
  form.addEventListener("submit", event => {
    event.preventDefault();
    send(input.value);
  });
  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  suggestions.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (button) send(button.textContent);
  });
})();