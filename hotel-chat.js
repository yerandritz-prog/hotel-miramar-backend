var BACKEND_URL = 'https://hotel-miramar-backend-production.up.railway.app';
var chatOpen = false;
var isLoading = false;
var conversationHistory = [];

function toggleChat() {
  chatOpen = !chatOpen;
  document.getElementById('chatWindow').classList.toggle('open', chatOpen);
  document.querySelector('.chat-badge').style.display = chatOpen ? 'none' : 'flex';
}

function addMsg(text, type) {
  var msgs = document.getElementById('chatMessages');
  var d = document.createElement('div');
  d.className = 'chat-msg ' + type;
  d.textContent = text;
  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
}

function showTyping() {
  var msgs = document.getElementById('chatMessages');
  var d = document.createElement('div');
  d.className = 'chat-msg bot typing';
  d.innerHTML = '<span></span><span></span><span></span>';
  d.id = 'typingIndicator';
  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
}

function removeTyping() {
  var t = document.getElementById('typingIndicator');
  if (t) t.remove();
}

function callBackend(userMsg) {
  conversationHistory.push({ role: 'user', content: userMsg });
  showTyping();
  fetch(BACKEND_URL + '/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: conversationHistory })
  })
  .then(function(res) { return res.json(); })
  .then(function(data) {
    removeTyping();
    var reply = data.reply || 'Lo siento, ha habido un error. Llamenos al +34 971 XXX XXX.';
    conversationHistory.push({ role: 'assistant', content: reply });
    addMsg(reply, 'bot');
    isLoading = false;
  })
  .catch(function() {
    removeTyping();
    addMsg('Lo siento, ha habido un problema. Contactenos en info@hotelmiramar.es', 'bot');
    isLoading = false;
  });
}

function sendMsg() {
  if (isLoading) return;
  var input = document.getElementById('chatInput');
  var msg = input.value.trim();
  if (!msg) return;
  document.getElementById('suggestions').style.display = 'none';
  addMsg(msg, 'user');
  input.value = '';
  isLoading = true;
  callBackend(msg);
}

function quickMsg(msg) {
  if (isLoading) return;
  document.getElementById('suggestions').style.display = 'none';
  addMsg(msg, 'user');
  isLoading = true;
  callBackend(msg);
}

document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('chatToggle').addEventListener('click', toggleChat);
  document.getElementById('chatSend').addEventListener('click', sendMsg);
  document.getElementById('chatInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') sendMsg();
  });
  document.querySelectorAll('.chat-sug').forEach(function(btn) {
    btn.addEventListener('click', function() {
      quickMsg(btn.textContent.trim());
    });
  });
});
