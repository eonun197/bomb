/**
 * 폭탄 버튼 — Phase 2: npoint.io 서버 동기화
 *
 * ▼ 셋업 (1분):
 *   1) https://www.npoint.io 접속
 *   2) 빈 에디터에 아래 JSON 붙여넣기 → "Save" 클릭
 *      {"counts":{"학교":100000000000,"회사":100000000000,"시험":100000000000,"월요일":100000000000},"presence":{}}
 *   3) 주소창의 URL이 https://www.npoint.io/docs/abc123def456 형태로 바뀜
 *      → 마지막 영문/숫자(`abc123def456`) 부분이 BIN ID
 *   4) 아래 NPOINT_ID 자리에 붙여넣기
 */

const NPOINT_ID = "";  // ← 여기에 npoint.io bin ID 붙여넣기

const TARGETS = ["학교", "회사", "시험", "월요일"];
const INITIAL = 100000000000;          // 천억
const POLL_MS = 3000;                  // 3초마다 GET
const PUSH_MS = 1500;                  // 클릭 후 1.5초 디바운스 + 주기적 하트비트
const HEARTBEAT_MS = 5000;             // 5초마다 내 존재 신호
const PRESENCE_TTL_MS = 12000;         // 12초 안에 신호 보낸 사람만 active 카운트

const NPOINT_URL = NPOINT_ID
  ? `https://api.npoint.io/${NPOINT_ID}`
  : null;
const SID = Math.random().toString(36).slice(2) + Date.now().toString(36);

let currentTarget = TARGETS[0];
let serverData = { counts: {}, presence: {} };
let pendingDelta = {};            // { 학교: 5 } — 화면엔 반영했지만 서버에 못 보낸 클릭 수
let displayCount = INITIAL;
let isPushing = false;
let pushTimer = null;

/* ── 서버 통신 ── */
async function fetchServer() {
  if (!NPOINT_URL) return;
  try {
    const res = await fetch(NPOINT_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("GET " + res.status);
    const data = await res.json();
    serverData = {
      counts: (data && typeof data.counts === "object" && data.counts) || {},
      presence: (data && typeof data.presence === "object" && data.presence) || {},
    };
    refreshDisplay();
    refreshParticipants();
  } catch (e) {
    console.warn("[bomb] fetch fail:", e.message);
  }
}

async function pushToServer() {
  if (!NPOINT_URL) return;
  if (isPushing) return;
  isPushing = true;
  try {
    // 펜딩 델타 스냅샷 (이번 라운드에서 비울 양)
    const flushing = { ...pendingDelta };
    const myStamp = Date.now();

    // 최신 서버 상태 다시 읽기 (race 최소화)
    let fresh = serverData;
    try {
      const res = await fetch(NPOINT_URL, { cache: "no-store" });
      if (res.ok) {
        const j = await res.json();
        fresh = {
          counts: (j && typeof j.counts === "object" && j.counts) || {},
          presence: (j && typeof j.presence === "object" && j.presence) || {},
        };
      }
    } catch (e) { /* 그냥 있는 걸로 진행 */ }

    // 내 델타 적용
    for (const [target, delta] of Object.entries(flushing)) {
      if (delta > 0) {
        const cur = typeof fresh.counts[target] === "number" ? fresh.counts[target] : INITIAL;
        fresh.counts[target] = Math.max(0, cur - delta);
      }
    }

    // 내 하트비트 + 죽은 세션 정리
    fresh.presence[SID] = myStamp;
    const cutoff = myStamp - PRESENCE_TTL_MS * 3;
    for (const [sid, ts] of Object.entries(fresh.presence)) {
      if (typeof ts !== "number" || ts < cutoff) delete fresh.presence[sid];
    }

    const post = await fetch(NPOINT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fresh),
    });
    if (!post.ok) throw new Error("POST " + post.status);

    // 성공: 펜딩 델타에서 반영분 차감
    for (const target of Object.keys(flushing)) {
      pendingDelta[target] = (pendingDelta[target] || 0) - flushing[target];
      if (pendingDelta[target] <= 0) delete pendingDelta[target];
    }
    serverData = fresh;
    refreshDisplay();
    refreshParticipants();
  } catch (e) {
    console.warn("[bomb] push fail:", e.message);
    // 다음 라운드에 다시 시도 — 펜딩 그대로 둠
  } finally {
    isPushing = false;
  }
}

function schedulePush() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    pushToServer();
  }, PUSH_MS);
}

/* ── 화면 ── */
function formatNum(n) { return n.toLocaleString("en-US"); }

function refreshDisplay() {
  const target = currentTarget;
  const serverVal = typeof serverData.counts[target] === "number"
    ? serverData.counts[target] : INITIAL;
  const pending = pendingDelta[target] || 0;
  displayCount = Math.max(0, serverVal - pending);
  renderCounter();
}

function renderCounter() {
  const el = document.getElementById("counter");
  if (!el) return;
  el.textContent = formatNum(displayCount);
  el.classList.toggle("is-zero", displayCount <= 0);
  const btn = document.getElementById("bomb-btn");
  if (btn) btn.disabled = displayCount <= 0;
  if (displayCount <= 0) triggerBigBang();
}

function refreshParticipants() {
  const el = document.getElementById("participant-count");
  if (!el) return;
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  const active = Object.values(serverData.presence)
    .filter((ts) => typeof ts === "number" && ts > cutoff).length;
  el.textContent = Math.max(1, active);
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
function pressBomb(originX, originY) {
  if (displayCount <= 0) return;
  // 1) 화면 즉시 감소
  displayCount--;
  renderCounter();
  const el = document.getElementById("counter");
  if (el) {
    el.classList.remove("is-popping");
    void el.offsetWidth;
    el.classList.add("is-popping");
    setTimeout(() => el.classList.remove("is-popping"), 160);
  }
  // 2) 펜딩 델타 누적
  pendingDelta[currentTarget] = (pendingDelta[currentTarget] || 0) + 1;
  // 3) 백그라운드 푸시 예약
  schedulePush();
  // 4) 스파크
  if (typeof originX === "number") spawnSparks(originX, originY);
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
  // 화면 밖이면 스킵 (별은 보이는 영역에만 누적)
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

  // 1) 모든 별 → 화면 중앙에서 바깥으로 폭발
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
      // 거의 중앙에 있는 별은 임의 방향으로 튕기기
      const a = Math.random() * Math.PI * 2;
      dx = Math.cos(a);
      dy = Math.sin(a);
    }
    const norm = reach / Math.max(mag, 1);
    star.style.setProperty("--ex", (dx * norm).toFixed(0) + "px");
    star.style.setProperty("--ey", (dy * norm).toFixed(0) + "px");
    star.classList.add("exploding");
  });

  // 2) 플래시
  const flash = document.createElement("div");
  flash.className = "bigbang-flash";
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 1200);

  // 3) 폭발 후 우주 생성
  setTimeout(() => spawnUniverse(), 1300);

  // 4) 메시지
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
  // 대상 드롭다운
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

  // 폭탄
  document.getElementById("bomb-btn").addEventListener("click", (e) => {
    pressBomb(e.clientX, e.clientY);
  });

  // 첫 그림 (서버 응답 오기 전 INITIAL로)
  renderTarget();

  // 셋업 안 됐으면 콘솔에 알림
  if (!NPOINT_URL) {
    console.error("[bomb] NPOINT_ID가 비어 있어요. app.js 상단 안내를 보고 채워주세요.");
    return;
  }

  // 서버 첫 동기화 + 폴링 + 하트비트
  fetchServer();
  pushToServer(); // 등장 알림
  setInterval(fetchServer, POLL_MS);
  setInterval(pushToServer, HEARTBEAT_MS);

  // 탭 닫힐 때 마지막 푸시 시도 (남은 클릭 + 부재 신호)
  window.addEventListener("beforeunload", () => {
    if (!NPOINT_URL) return;
    try {
      delete serverData.presence[SID];
      navigator.sendBeacon(
        NPOINT_URL,
        new Blob([JSON.stringify(serverData)], { type: "application/json" })
      );
    } catch (e) {}
  });
});
