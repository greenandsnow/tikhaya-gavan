console.log('ask.js loaded');
var chatHistory = [];
var isLoading = false;

function getTime() {
  return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function addMessage(role, text) {
  var msgs = document.getElementById('msgs');
  var div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'user' : 'bot');
  var avatar = role === 'user' ? '👤' : '🤖';
  var safe = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
  div.innerHTML = '<div class="ma">' + avatar + '</div><div><div class="mb">' + safe + '</div><div class="mt">' + getTime() + '</div></div>';
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function setLoading(val) {
  isLoading = val;
  document.getElementById('sbtn').disabled = val;
  var t = document.getElementById('typing');
  if (val) { t.classList.add('show'); } else { t.classList.remove('show'); }
  if (val) { document.getElementById('msgs').scrollTop = 99999; }
}

function useSug(btn) {
  document.getElementById('inp').value = btn.textContent;
  send();
}

function hideSugg() {
  var s = document.getElementById('sugg');
  if (s) s.style.display = 'none';
}

function send() {
  if (isLoading) return;
  var inp = document.getElementById('inp');
  var text = inp.value.trim();
  if (!text) return;
  hideSugg();
  inp.value = '';
  inp.style.height = 'auto';
  addMessage('user', text);
  chatHistory.push({ role: 'user', content: text });
  setLoading(true);
  fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: chatHistory })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    var reply = (data.content && data.content[0] && data.content[0].text) ? data.content[0].text : 'Извините, не удалось получить ответ.';
    chatHistory.push({ role: 'assistant', content: reply });
    addMessage('bot', reply);
  })
  .catch(function() {
    addMessage('bot', 'Произошла ошибка соединения. Попробуйте позже.');
  })
  .finally(function() {
    setLoading(false);
  });
}

function clearChat() {
  if (!confirm('Очистить историю?')) return;
  chatHistory = [];
  document.getElementById('msgs').innerHTML = '<div class="msg bot"><div class="ma">🤖</div><div><div class="mb">Здравствуйте! Задайте любой вопрос.</div><div class="mt">Сейчас</div></div></div>';
  document.getElementById('sugg').style.display = 'flex';
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
}

function resize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}
