// app.js — ES module
const LS_KEY = 'todo_v2_tasks';
const THEME_KEY = 'todo_v2_theme';
const RENDER_BATCH = 30; // how many tasks to render per "load more"

class Store {
  static load() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY)) || [];
    } catch (e) {
      console.error('Load error', e);
      return [];
    }
  }
  static save(tasks) {
    localStorage.setItem(LS_KEY, JSON.stringify(tasks));
  }
}

// Utility helpers
const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const k in attrs) {
    if (k.startsWith('on') && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
    else if (k === 'html') node.innerHTML = attrs[k];
    else node.setAttribute(k, attrs[k]);
  }
  children.forEach(c => { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  return node;
};

// Application State
const state = {
  tasks: Store.load(),
  filtered: [],       // after search/filter
  renderIndex: 0,     // how many items rendered so far
  search: '',
  filterPriority: 'All',
  filterComplete: 'All',
};

// DOM refs
const refs = {
  taskForm: $('#taskForm'),
  title: $('#title'),
  desc: $('#description'),
  due: $('#dueDate'),
  priority: $('#priority'),
  addBtn: $('#addBtn'),
  clearBtn: $('#clearBtn'),
  errorMsg: $('#errorMsg'),
  taskList: $('#taskList'),
  stats: $('#stats'),
  progressBar: $('#progressBar'),
  progressText: $('#progressText'),
  renderCount: $('#renderCount'),
  totalCount: $('#totalCount'),
  loadMore: $('#loadMore'),
  search: $('#search'),
  filterPriority: $('#filterPriority'),
  filterComplete: $('#filterComplete'),
  clearAll: $('#clearAll'),
  themeToggle: $('#themeToggle'),
  confettiCanvas: $('#confettiCanvas'),
};

// Init app
function init() {
  applyThemeFromStore();
  bindEvents();
  rebuildFiltered();
  renderInitial();
  requestNotificationPermissionIfNeeded();
  window.addEventListener('resize', onResize);
}

// --- Theme ---
function applyThemeFromStore() {
  const t = localStorage.getItem(THEME_KEY) || 'light';
  document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(THEME_KEY, next);
}

// --- Forms ---
function bindEvents() {
  refs.taskForm.addEventListener('submit', onAddTask);
  refs.clearBtn.addEventListener('click', onClearForm);
  refs.taskList.addEventListener('click', onListClick);
  refs.taskList.addEventListener('change', onListChange);
  refs.loadMore.addEventListener('click', onLoadMore);
  refs.search.addEventListener('input', debounce(onSearch, 250));
  refs.filterPriority.addEventListener('change', onFilterChange);
  refs.filterComplete.addEventListener('change', onFilterChange);
  refs.clearAll.addEventListener('click', onClearAll);
  refs.themeToggle.addEventListener('click', toggleTheme);
  refs.taskList.addEventListener('scroll', onListScroll);
  window.addEventListener('beforeunload', () => Store.save(state.tasks));
}

// Debounce helper
function debounce(fn, wait=200) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

// --- CRUD operations ---
function onAddTask(e) {
  e.preventDefault();
  const title = refs.title.value.trim();
  const description = refs.desc.value.trim();
  const dueDate = refs.due.value || '';
  const priority = refs.priority.value || 'Medium';
  if (!title) return showError('Title is required.');
  if (state.tasks.some(t => t.title.toLowerCase() === title.toLowerCase())) return showError('A task with this title already exists.');
  const task = {
    id: Date.now() + Math.floor(Math.random()*999),
    title, description, dueDate, priority, completed:false, createdAt: new Date().toISOString()
  };
  state.tasks.push(task);
  Store.save(state.tasks);
  clearForm();
  rebuildFiltered(); // reapply filters/search
  // Auto-render newest at top
  renderNewTaskIfNeeded(task);
  checkRemindersForTask(task);
  showTempMessage('Task added');
}

function onClearForm() {
  clearForm();
}
function clearForm() {
  refs.title.value = '';
  refs.desc.value = '';
  refs.due.value = '';
  refs.priority.value = 'Medium';
  refs.errorMsg.textContent = '';
}

function showError(msg) {
  refs.errorMsg.textContent = msg;
  setTimeout(()=> { if (refs.errorMsg.textContent === msg) refs.errorMsg.textContent = ''; }, 3500);
}
function showTempMessage(txt) {
  refs.errorMsg.textContent = txt;
  setTimeout(()=> { if (refs.errorMsg.textContent === txt) refs.errorMsg.textContent = ''; }, 1800);
}

function onListClick(ev) {
  const btn = ev.target.closest('button');
  if (!btn) return;
  const id = btn.dataset.id && Number(btn.dataset.id);
  if (btn.classList.contains('edit')) {
    onEdit(id);
  } else if (btn.classList.contains('del')) {
    onDelete(id);
  } else if (btn.classList.contains('toggle')) {
    // handled by change event on checkbox; ignore here
  }
}

function onListChange(ev) {
  const cb = ev.target.closest('input[type="checkbox"]');
  if (!cb) return;
  const id = Number(cb.dataset.id);
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  task.completed = !!cb.checked;
  Store.save(state.tasks);
  updateProgress();
  // small celebration on marking complete
  if (task.completed) celebrate();
  // optionally re-render item to show strike
  const li = document.querySelector(`li[data-id="${id}"]`);
  if (li) {
    li.querySelector('.task-title').classList.toggle('strike', task.completed);
  }
}

function onEdit(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  // Modal-less simple inline edit: prompt (could be upgraded to modal)
  const newTitle = prompt('Edit title', task.title);
  if (newTitle === null) return;
  const trimmed = newTitle.trim();
  if (!trimmed) return alert('Title cannot be empty.');
  // check duplicates
  if (state.tasks.some(t => t.id !== id && t.title.toLowerCase() === trimmed.toLowerCase())) {
    return alert('Another task with same title exists.');
  }
  task.title = trimmed;
  const newDesc = prompt('Edit description', task.description || '');
  if (newDesc !== null) task.description = newDesc.trim();
  const newDue = prompt('Edit due date (YYYY-MM-DD) or blank', task.dueDate || '');
  if (newDue !== null) task.dueDate = newDue.trim();
  const newPriority = prompt('Priority (Low / Medium / High)', task.priority) || task.priority;
  task.priority = ['Low','Medium','High'].includes(newPriority) ? newPriority : task.priority;
  Store.save(state.tasks);
  rebuildFiltered();
  reRenderAllVisible();
  showTempMessage('Task updated');
}

function onDelete(id) {
  if (!confirm('Delete this task?')) return;
  state.tasks = state.tasks.filter(t => t.id !== id);
  Store.save(state.tasks);
  rebuildFiltered();
  reRenderAllVisible();
  showTempMessage('Task deleted');
}

function onClearAll() {
  if (!confirm('This will permanently delete ALL tasks. Continue?')) return;
  state.tasks = [];
  Store.save(state.tasks);
  rebuildFiltered();
  reRenderAllVisible();
}

// --- Search & Filters ---
function onSearch(e) {
  state.search = e.target.value.trim().toLowerCase();
  rebuildFiltered();
  reRenderAllVisible(true);
}
function onFilterChange() {
  state.filterPriority = refs.filterPriority.value;
  state.filterComplete = refs.filterComplete.value;
  rebuildFiltered();
  reRenderAllVisible(true);
}
function rebuildFiltered() {
  const s = state.search;
  state.filtered = state.tasks.filter(t => {
    if (s && !(t.title.toLowerCase().includes(s) || (t.description || '').toLowerCase().includes(s))) return false;
    if (state.filterPriority !== 'All' && t.priority !== state.filterPriority) return false;
    if (state.filterComplete === 'Pending' && t.completed) return false;
    if (state.filterComplete === 'Completed' && !t.completed) return false;
    return true;
  }).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  // reset render index
  state.renderIndex = 0;
  // update counters
  refs.totalCount.textContent = state.filtered.length;
  updateProgress();
}

// --- Rendering ---
function renderInitial() {
  refs.taskList.innerHTML = '';
  refs.renderCount.textContent = '0';
  refs.totalCount.textContent = state.filtered.length;
  renderBatch();
}

function renderBatch() {
  const start = state.renderIndex;
  const end = Math.min(state.renderIndex + RENDER_BATCH, state.filtered.length);
  const subset = state.filtered.slice(start, end);
  const frag = document.createDocumentFragment();
  for (const t of subset) frag.appendChild(renderTaskItem(t));
  refs.taskList.appendChild(frag);
  state.renderIndex = end;
  refs.renderCount.textContent = state.renderIndex;
  // hide load more if all rendered
  refs.loadMore.style.display = state.renderIndex < state.filtered.length ? 'inline-block' : 'none';
  updateProgress();
}
function onLoadMore() { renderBatch(); }

function renderTaskItem(task) {
  const li = document.createElement('li');
  li.className = 'task-item';
  li.dataset.id = task.id;

  const left = el('div', {class:'task-left'},
    el('input', {type:'checkbox', class:'checkbox', 'data-id':task.id}),
    el('div', {class:'task-meta'},
       el('div', {},
         el('div', {class:'task-title'}, task.title),
         el('div', {class:'muted small'}, task.description || '')
       ),
       el('div', {},
         el('span', {class:`priority ${task.priority}`}, task.priority),
         task.dueDate ? el('span', {class:'muted small', style:'margin-left:8px'}, `Due: ${task.dueDate}`) : null
       )
    )
  );

  const controls = el('div', {class:'task-controls'},
    el('button', {class:'btn edit', 'data-id':task.id}, 'Edit'),
    el('button', {class:'btn del', 'data-id':task.id}, 'Delete')
  );

  li.appendChild(left);
  li.appendChild(controls);

  // set checkbox state and strike
  const checkbox = li.querySelector('input[type="checkbox"]');
  checkbox.checked = !!task.completed;
  const titleEl = li.querySelector('.task-title');
  if (task.completed) titleEl.classList.add('strike');

  return li;
}

function reRenderAllVisible() {
  // clear and re-render from scratch up to renderIndex
  refs.taskList.innerHTML = '';
  state.renderIndex = 0;
  renderBatch();
  // update counters
  refs.renderCount.textContent = state.renderIndex;
  refs.totalCount.textContent = state.filtered.length;
}

function renderNewTaskIfNeeded(task) {
  // If current filters allow this task, re-run filtered and then render from top
  rebuildFiltered();
  // Option: prepend new item (we re-render all for simplicity)
  reRenderAllVisible();
}

// --- Progress & Stats ---
function updateProgress() {
  const total = state.filtered.length;
  const done = state.filtered.filter(t => t.completed).length;
  refs.stats.textContent = `${total} task${total!==1?'s':''} • ${done} done`;
  refs.progressText.textContent = `Completed ${done} / ${total}`;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  // update progress bar
  refs.progressBar.innerHTML = `<div class="bar" style="width:${pct}%"></div>`;
}

// --- Notifications / Reminders ---
function requestNotificationPermissionIfNeeded() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    // ask only once gently
    setTimeout(()=> {
      Notification.requestPermission().then(p => {
        // no-op; just store value
      }).catch(()=>{});
    }, 2000);
  }
}
function checkRemindersForTask(task) {
  if (!task.dueDate) return;
  // schedule a simple check (if page open): if due within 24h, show immediate notification
  const now = new Date();
  const due = new Date(task.dueDate + 'T23:59:59'); // end-of-day
  const diffH = (due - now) / (1000*60*60);
  if (diffH <= 24 && diffH >= 0) {
    notify(`Reminder: ${task.title} is due within 24 hours`);
  }
}
function notify(msg) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(msg);
  } else {
    // fallback in-page toast
    alert(msg);
  }
}

// --- Small celebration / confetti ---
function celebrate() {
  // quick background flash + simple canvas confetti burst
  flashBackground();
  confettiBurst(40);
}
function flashBackground() {
  document.body.animate([{filter:'brightness(1)'},{filter:'brightness(1.15)'},{filter:'brightness(1)'}], {duration:500});
}

// Confetti implementation (lightweight)
function confettiBurst(particles=30) {
  const canvas = refs.confettiCanvas;
  const ctx = canvas.getContext('2d');
  const DPR = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * DPR;
  canvas.height = window.innerHeight * DPR;
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.scale(DPR, DPR);

  const parts = [];
  for (let i=0;i<particles;i++){
    parts.push({
      x: Math.random()*window.innerWidth,
      y: Math.random()*window.innerHeight*0.3,
      vx: (Math.random()-0.5)*6,
      vy: Math.random()*4 + 2,
      size: Math.random()*6 + 4,
      color: ['#ff4d6d','#ffd166','#6ee7b7','#60a5fa','#c084fc'][Math.floor(Math.random()*5)],
      rot: Math.random()*360
    });
  }
  let t=0;
  function frame(){
    t++;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    for (const p of parts){
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15; // gravity
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size*0.6);
      ctx.restore();
    }
    if (t < 90) requestAnimationFrame(frame);
    else ctx.clearRect(0,0,canvas.width,canvas.height);
  }
  frame();
}

// --- scroll / lazy UI helpers ---
function onListScroll() {
  // optional: auto load more when scrolled near bottom
  const ul = refs.taskList;
  if (ul.scrollTop + ul.clientHeight >= ul.scrollHeight - 60) {
    if (state.renderIndex < state.filtered.length) renderBatch();
  }
}
function onResize() {
  // keep canvas sized properly
  refs.confettiCanvas.width = window.innerWidth;
  refs.confettiCanvas.height = window.innerHeight;
}

// --- Misc: check due tasks on load and notify if needed ---
function checkDueSoonOnLoad() {
  const now = new Date();
  for (const t of state.tasks) {
    if (!t.dueDate) continue;
    const due = new Date(t.dueDate + 'T23:59:59');
    const diffH = (due - now) / (1000*60*60);
    if (diffH <= 24 && diffH >= 0 && !t.completed) {
      // show one small summary notification (don't spam)
      notify(`Upcoming: ${t.title} due by ${t.dueDate}`);
      break;
    }
  }
}

// initial run
init();
checkDueSoonOnLoad();
