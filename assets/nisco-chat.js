(() => {
  const panel = document.getElementById("nisco-chat-panel");
  const launcher = document.querySelector(".nisco-chat-launcher");
  const close = document.querySelector(".nisco-chat-close");
  const form = document.getElementById("nisco-chat-form");
  const input = document.getElementById("nisco-chat-input");
  const messagesEl = document.getElementById("nisco-chat-messages");
  const suggestions = document.getElementById("nisco-chat-suggestions");
  if (!panel || !launcher || !form || !input || !messagesEl || !suggestions || !close) return;

  const API_URL = "https://nisco-ai.speedhome7852.workers.dev/chat";
  const history = [];
  const welcomeMessage = "Hello! I’m NISCO AI, your business guide. I can help with websites, automation, AI chatbots, digital marketing and ongoing support. I can also explain our India starting prices. What would you like to explore?";
  let busy = false;
  let leadSaved = false;
  let consentToken = "";

  function startFreshConversation() {
    history.length = 0;
    leadSaved = false;
    consentToken = "";
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
      addMessage("Your enquiry is already recorded with the NISCO team. Choose a service below to start a new enquiry.", "assistant");
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
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-24), consent_token: consentToken || undefined })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The assistant is temporarily unavailable.");
      const reply = String(data.reply || "I couldn't prepare a response. Please try again.");
      if (data.lead_saved === true) { leadSaved = true; consentToken = ""; }
      if (typeof data.consent_token === "string") consentToken = data.consent_token;
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
    "I need an AI chatbot": "I need an AI chatbot. Please guide me through an AI chatbot enquiry and ask one question at a time. Start by asking what I want the chatbot to do.",
    "Automate a process": "I want business automation. Please guide me through a business automation enquiry and ask one question at a time. Start by asking which process I want to improve.",
    "Grow my business": "I want to grow my business. Please guide me through a digital marketing enquiry and ask one question at a time. Start by asking about my business and growth goal.",
    "Website maintenance": "I need website maintenance. Please guide me through a website maintenance enquiry and ask one question at a time. Start by asking about my current website."
  };
  suggestions.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button || busy) return;
    const label = button.textContent.trim();
    startFreshConversation();
    send(starterPrompts[label] || label, label);
  });
})();
