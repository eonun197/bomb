/**
 * 폭탄 버튼 — abacus.jasoncameron.dev 기반 멀티유저 카운터
 *
 * 서버에는 hit 수만 +1씩 쌓이고, 화면에는 INITIAL - hit수가 표시됨.
 * (abacus는 무인증으로 +1 hit만 되고, 감소는 admin_key가 필요해서 역방향 사용)
 */

const TARGETS = ["학교", "회사", "시험", "월요일"];
const TARGET_KEYS = { "학교": "school", "회사": "company", "시험": "exam", "월요일": "monday" };
const INITIAL = 100000000000;             // 천억
const ABACUS_NS = "eonun197-bomb-hits";
const POLL_MS = 3000;

const ABACUS = {
  get: (k) => `https://abacus.jasoncameron.dev/get/${ABACUS_NS}/${k}`,
  hit: (k) => `https://abacus.jasoncameron.dev/hit/${ABACUS_NS}/${k}`,
};

let currentTarget = TARGETS[0];
let serverHits = { school: 0, company: 0, exam: 0, monday: 0 };
let pendingHits = { school: 0, company: 0, exam: 0, monday: 0 };
let firstFetchDone = false;

/* ── 서버 통신 ── */
async function fetchServer() {
  try {
    const all = await Promise.all(
      Object.values(TARGET_KEYS).map(async (k) => {
        const res = await fetch(ABACUS.get(k), { cache: "no-store" });
        if (!res.ok) throw new Error(k + " HTTP " + res.status);
        const d = await res.json();
        return { key: k, value: typeof d.value === "number" ? d.value : 0 };
      })
    );
    all.forEach(({ key, value }) => { serverHits[key] = value; });
    firstFetchDone = true;
    refreshDisplay();
    refreshTotalHits();
  } catch (e) {
    console.warn("[bomb] fetch fail:", e.message);
  }
}

async function pushHit(key) {
  // pendingHits[key]가 0보다 크면 그 횟수만큼 hit 보냄
  const queued = pendingHits[key];
  if (queued <= 0) return;
  pendingHits[key] = 0; // 일단 비움 (실패 시 복구)
  let success = 0;
  for (let i = 0; i < queued; i++) {
    try {
      const res = await fetch(ABACUS.hit(key), { method: "GET", cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const d = await res.json();
      if (typeof d.value === "number") serverHits[key] = d.value;
      success++;
    } catch (e) {
      // 실패: 남은 횟수 복구
      pendingHits[key] += (queued - success);
      console.warn("[bomb] hit fail:", e.message, "consumed", success, "of", queued);
      break;
    }
  }
  refreshDisplay();
  refreshTotalHits();
}

/* ── 화면 ── */
function formatNum(n) { return n.toLocaleString("en-US"); }

function getDisplayCount() {
  const k = TARGET_KEYS[currentTarget];
  const used = (serverHits[k] || 0) + (pendingHits[k] || 0);
  return Math.max(0, INITIAL - used);
}

function getTotalClicks() {
  let sum = 0;
  for (const k of Object.values(TARGET_KEYS)) {
    sum += (serverHits[k] || 0) + (pendingHits[k] || 0);
  }
  return sum;
}

function refreshDisplay() {
  const el = document.getElementById("counter");
  if (!el) return;
  const btn = document.getElementById("bomb-btn");
  if (!firstFetchDone) {
    el.textContent = "불러오는 중...";
    el.classList.add("is-loading");
    el.classList.remove("is-zero");
    if (btn) btn.disabled = true;
    return;
  }
  el.classList.remove("is-loading");
  const n = getDisplayCount();
  el.textContent = formatNum(n);
  el.classList.toggle("is-zero", n <= 0);
  if (btn) btn.disabled = n <= 0;
  if (n <= 0) triggerBigBang();
}

function refreshTotalHits() {
  const el = document.getElementById("total-hits");
  if (!el) return;
  el.textContent = firstFetchDone ? formatNum(getTotalClicks()) : "...";
}

function renderTarget() {
  const labelEl = document.getElementById("target-label");
  if (labelEl) labelEl.textContent = currentTarget;
  refreshDisplay();
}

/* ── 대상 드롭다운 ── */
function renderTargetMenu() {
  const ul = document.getElementById("target-menu");
  if (!ul) return;
  ul.innerHTML = TARGETS.map((t) => {
    const cls = t === currentTarget ? "is-active" : "";
    return `<li class="${cls}" data-target="${t}" role="option" tabindex="0">${t}</li>`;
  }).join("");
  ul.querySelectorAll("li").forEach((li) => {
    li.addEventListener("click", () => {
      currentTarget = li.dataset.target;
      renderTarget();
      closeMenu();
    });
  });
}
function openMenu() {
  const ul = document.getElementById("target-menu");
  const btn = document.getElementById("target-btn");
  renderTargetMenu();
  ul.hidden = false;
  btn.setAttribute("aria-expanded", "true");
}
function closeMenu() {
  const ul = document.getElementById("target-menu");
  const btn = document.getElementById("target-btn");
  ul.hidden = true;
  btn.setAttribute("aria-expanded", "false");
}
function toggleMenu() {
  const ul = document.getElementById("target-menu");
  if (ul.hidden) openMenu(); else closeMenu();
}

/* ── 폭탄 누르기 (낙관적 업데이트) ── */
let pushTimer = null;
function pressBomb(originX, originY) {
  if (getDisplayCount() <= 0) return;
  const k = TARGET_KEYS[currentTarget];
  // 1) 화면 즉시 감소
  pendingHits[k] = (pendingHits[k] || 0) + 1;
  refreshDisplay();
  refreshTotalHits();
  // 2) pop 애니메이션
  const el = document.getElementById("counter");
  if (el) {
    el.classList.remove("is-popping");
    void el.offsetWidth;
    el.classList.add("is-popping");
    setTimeout(() => el.classList.remove("is-popping"), 160);
  }
  // 3) 스파크
  if (typeof originX === "number") spawnSparks(originX, originY);
  // 4) 백그라운드 push (디바운스)
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    pushHit(k);
  }, 400);
}

/* ── 스파크 (점) → 별로 정착 ── */
const STAR_CAP = 800;
function spawnSparks(originX, originY) {
  const colors = ["#ffd166", "#ff9a3c", "#ff5522", "#ffe5b0", "#ffaf3a", "#ffeb8a"];
  const count = 28;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const reach = Math.max(vw, vh) * 0.55;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i / count) + (Math.random() - 0.5) * 0.45;
    const dist = reach * (0.55 + Math.random() * 0.55);
    const tx = Math.cos(angle) * dist;
    const ty = Math.sin(angle) * dist - 20;
    const c = colors[i % colors.length];
    const spark = document.createElement("div");
    spark.className = "spark";
    spark.style.left = originX + "px";
    spark.style.top = originY + "px";
    spark.style.color = c;
    spark.style.setProperty("--tx", tx + "px");
    spark.style.setProperty("--ty", ty + "px");
    const dur = 0.7 + Math.random() * 0.5;
    spark.style.setProperty("--dur", dur + "s");
    document.body.appendChild(spark);
    const finalX = originX + tx;
    const finalY = originY + ty;
    const settle = () => {
      if (spark.parentNode) spark.remove();
      settleAsStar(finalX, finalY, c);
    };
    spark.addEventListener("animationend", settle, { once: true });
    setTimeout(() => { if (spark.parentNode) settle(); }, dur * 1000 + 200);
  }
}

function settleAsStar(x, y, color) {
  if (x < -10 || x > window.innerWidth + 10) return;
  if (y < -10 || y > window.innerHeight + 10) return;
  const sf = document.getElementById("starfield");
  if (!sf) return;
  const star = document.createElement("div");
  star.className = "star";
  star.style.left = x + "px";
  star.style.top = y + "px";
  star.style.color = color;
  const size = 2.5 + Math.random() * 2;
  star.style.width = size + "px";
  star.style.height = size + "px";
  star.style.marginLeft = (-size / 2) + "px";
  star.style.marginTop = (-size / 2) + "px";
  star.style.setProperty("--tw-dur", (3 + Math.random() * 3).toFixed(1) + "s");
  star.style.setProperty("--tw-delay", (Math.random() * 4).toFixed(1) + "s");
  sf.appendChild(star);
  while (sf.childElementCount > STAR_CAP) {
    sf.firstElementChild.remove();
  }
}

/* ── 빅뱅 ── */
let bigBangFired = false;
function triggerBigBang() {
  if (bigBangFired) return;
  bigBangFired = true;
  document.body.classList.add("bigbang");

  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const reach = Math.max(window.innerWidth, window.innerHeight);
  document.querySelectorAll(".star").forEach((star) => {
    const rect = star.getBoundingClientRect();
    const sx = rect.left + rect.width / 2;
    const sy = rect.top + rect.height / 2;
    let dx = sx - cx;
    let dy = sy - cy;
    const mag = Math.hypot(dx, dy) || 1;
    if (mag < 5) {
      const a = Math.random() * Math.PI * 2;
      dx = Math.cos(a);
      dy = Math.sin(a);
    }
    const norm = reach / Math.max(mag, 1);
    star.style.setProperty("--ex", (dx * norm).toFixed(0) + "px");
    star.style.setProperty("--ey", (dy * norm).toFixed(0) + "px");
    star.classList.add("exploding");
  });

  const flash = document.createElement("div");
  flash.className = "bigbang-flash";
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 1200);

  setTimeout(() => spawnUniverse(), 1300);
  setTimeout(() => {
    const msg = document.createElement("div");
    msg.className = "bigbang-msg";
    msg.textContent = "우주가 시작됐다.";
    document.body.appendChild(msg);
  }, 1500);
}

function spawnUniverse() {
  const sf = document.getElementById("starfield");
  if (!sf) return;
  sf.innerHTML = "";
  const colors = ["#ffffff", "#ffeebb", "#bbeeff", "#ffccaa", "#aaccff", "#ffe9d4"];
  const W = window.innerWidth;
  const H = window.innerHeight;
  for (let i = 0; i < 320; i++) {
    settleAsStar(Math.random() * W, Math.random() * H, colors[i % colors.length]);
  }
}

/* ── 초기화 ── */
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("target-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu();
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".target-wrap")) closeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });

  document.getElementById("bomb-btn").addEventListener("click", (e) => {
    pressBomb(e.clientX, e.clientY);
  });

  renderTarget();

  // 첫 동기화 + 폴링
  fetchServer();
  setInterval(fetchServer, POLL_MS);
});
