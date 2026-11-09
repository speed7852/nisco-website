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
  const welcomeMessage = "Hello! I’m the NISCO AI assistant. I can help with NISCO websites, business automation and AI chatbots for Indian businesses. I can understand your requirements and prepare an enquiry. What would you like to work on?";
  let busy = false;
  let leadSaved = false;

  function startFreshConversation() {
    history.length = 0;
    leadSaved = false;
    messagesEl.replaceChildren();
    addMessage(welcomeMessage, "assistant");
    suggestions.hidden = false;
  }

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
  async function send(text, displayText = text) {
    const message = text.trim();
    if (!message || busy) return;
    if (leadSaved) {
      addMessage("You're very welcome. Your enquiry is already recorded with the NISCO team. Use a suggestion below to start a new enquiry.", "assistant");
      input.value = "";
      return;
    }
    busy = true;
    suggestions.hidden = true;
    addMessage(displayText, "user");
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
        body: JSON.stringify({ messages: history.slice(-24) })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The assistant is temporarily unavailable.");
      const reply = String(data.reply || "I couldn't prepare a response. Please try again.");
      if (data.lead_saved === true) leadSaved = true;
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
  const starterPrompts = {
    "I need a website": "I need a website. Please guide me through a website enquiry and ask one question at a time. Start by asking what type of website I need.",
    "Grow my business": "I want to grow my business. Please guide me through a digital marketing enquiry and ask one question at a time. Start by asking what my business does and what growth goal I want to achieve.",
    "Automate a process": "I want to automate a business process. Please guide me through a business transformation enquiry and ask one question at a time. Start by asking which process I want to improve or automate."
  };
  suggestions.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;
    const label = button.textContent.trim();
    if (busy) return;
    startFreshConversation();
    send(starterPrompts[label] || label, label);
  });
})();