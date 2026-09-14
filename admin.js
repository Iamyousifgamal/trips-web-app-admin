  const SUPABASE_URL = 'https://sdbvevefxziyhzqzilrv.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkYnZldmVmeHppeWh6cXppbHJ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzMjk0NjUsImV4cCI6MjEwNDkwNTQ2NX0.ugU0hZIdZmXYQXxdxGBSXJ8qy-EKBJ2pckemh8Yx7zg'

let supabaseClient = null;
let realtimeChannel = null;

const state = {
  range: "7d",
  customFrom: null,
  customTo: null,
  search: "",
  sortKey: "cost",
  sortDir: "desc",
  page: 1,
  pageSize: 20,
  trips: [],
  isAdmin: false,
  adminEmail: "",
};

let dailyChart = null;
let topUsersChart = null;

function initSupabase() {
  if (typeof window.supabase === "undefined") {
    showError("فشل تحميل مكتبة Supabase. يرجى تحديث الصفحة.");
    return false;
  }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return true;
}

async function realLogin(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

async function realCheckAdmin(userId) {
  const { data, error } = await supabaseClient
    .from("admins")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (error) return false;
  return !!data;
}

async function fetchTrips() {
  const { data, error } = await supabaseClient
    .from("trips")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

let realtimeChannel = null;

function initRealtime() {
  supabaseClient
    .channel('trips-changes')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'trips' },
      payload => {
        state.trips.unshift(payload.new);
        renderAll();
      }
    )
    .subscribe();
}
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'trips' },
      (payload) => {
        if (!payload?.old) return;
        state.trips = state.trips.filter((t) => t.id !== payload.old.id);
        renderAll();
      }
    )
    .subscribe((status) => {
      console.log('Realtime status:', status);
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setTimeout(initRealtime, 5000);
      }
    });
}

function stopRealtime() {
  if (realtimeChannel && supabaseClient) {
    supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

function fmtMoney(n) {
  const value = Number(n) || 0;
  return new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 }).format(value);
}

function fmtDate(d) {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ar-EG", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function fmtDateTime(d) {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleString("ar-EG", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function initials(name) {
  const clean = String(name || "").trim();
  return clean ? clean.charAt(0) : "?";
}

function showError(msg) {
  const banner = document.getElementById("error-banner");
  const text = document.getElementById("error-text");
  if (!banner || !text) return;
  text.textContent = msg;
  banner.style.display = "flex";
}

function hideError() {
  const banner = document.getElementById("error-banner");
  if (banner) banner.style.display = "none";
}

function getRangeBounds() {
  const now = new Date();
  let from = null;
  let to = now;
  switch (state.range) {
    case "24h":
      from = new Date(now.getTime() - 24 * 3600 * 1000);
      break;
    case "7d":
      from = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
      break;
    case "14d":
      from = new Date(now.getTime() - 14 * 24 * 3600 * 1000);
      break;
    case "30d":
      from = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
      break;
    case "all":
      from = null;
      break;
    case "custom":
      from = state.customFrom ? new Date(state.customFrom) : null;
      to = state.customTo ? new Date(state.customTo + "T23:59:59") : now;
      break;
  }
  return { from, to };
}

function getFilteredTrips() {
  const { from, to } = getRangeBounds();
  return state.trips.filter((t) => {
    const created = new Date(t.created_at);
    if (isNaN(created.getTime())) return false;
    if (from && created < from) return false;
    if (to && created > to) return false;
    return true;
  });
}

function aggregateByUser(trips) {
  const map = new Map();
  trips.forEach((t) => {
    const key = t.user_id || t.phone || t.id;
    if (!map.has(key)) {
      map.set(key, {
        key,
        full_name: t.full_name || "—",
        phone: t.phone || "—",
        trips: 0,
        totalCost: 0,
        lastTripDate: t.trip_date,
        rows: [],
      });
    }
    const entry = map.get(key);
    entry.trips += 1;
    entry.totalCost += Number(t.cost) || 0;
    if (new Date(t.trip_date) > new Date(entry.lastTripDate)) {
      entry.lastTripDate = t.trip_date;
    }
    entry.full_name = t.full_name || entry.full_name;
    entry.phone = t.phone || entry.phone;
    entry.rows.push(t);
  });
  return Array.from(map.values()).map((e) => ({
    ...e,
    avgCost: e.trips ? e.totalCost / e.trips : 0,
  }));
}

function renderSummary(filtered, aggregated) {
  const totalTrips = filtered.length;
  const totalCost = filtered.reduce((s, t) => s + (Number(t.cost) || 0), 0);
  const uniqueUsers = aggregated.length;
  const avgCost = totalTrips ? totalCost / totalTrips : 0;

  const tripsEl = document.getElementById("stat-trips");
  const costEl = document.getElementById("stat-cost");
  const usersEl = document.getElementById("stat-users");
  const avgEl = document.getElementById("stat-avg");

  if (tripsEl) tripsEl.innerHTML = `${totalTrips}`;
  if (costEl) costEl.innerHTML = `${fmtMoney(totalCost)} <small>جنيه</small>`;
  if (usersEl) usersEl.innerHTML = `${uniqueUsers}`;
  if (avgEl) avgEl.innerHTML = `${fmtMoney(avgCost)} <small>جنيه</small>`;
}

function renderCharts(filtered, aggregated) {
  const dailyCanvas = document.getElementById("chart-daily");
  const topCanvas = document.getElementById("chart-top-users");
  if (!dailyCanvas || !topCanvas || typeof Chart === "undefined") return;

  const dailyMap = new Map();
  filtered.forEach((t) => {
    const day = t.trip_date;
    if (!day) return;
    dailyMap.set(day, (dailyMap.get(day) || 0) + 1);
  });
  const sortedDays = Array.from(dailyMap.keys()).sort();
  const dayLabels = sortedDays.map((d) => fmtDate(d));
  const dayValues = sortedDays.map((d) => dailyMap.get(d));

  const goldSolid = "#C9A052";
  const goldFaint = "rgba(201,160,82,0.35)";
  const gridColor = "rgba(255,255,255,0.05)";
  const textColor = "#93939C";

  const dailyCtx = dailyCanvas.getContext("2d");
  if (dailyChart) dailyChart.destroy();
  dailyChart = new Chart(dailyCtx, {
    type: "bar",
    data: {
      labels: dayLabels,
      datasets: [
        {
          data: dayValues,
          backgroundColor: goldFaint,
          hoverBackgroundColor: goldSolid,
          borderRadius: 4,
          maxBarThickness: 22,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: textColor, font: { family: "Cairo", size: 10 }, maxRotation: 0, autoSkip: true },
        },
        y: {
          beginAtZero: true,
          grid: { color: gridColor },
          ticks: { color: textColor, font: { family: "Cairo", size: 10 }, precision: 0 },
        },
      },
    },
  });

  const top5 = [...aggregated].sort((a, b) => b.totalCost - a.totalCost).slice(0, 5);
  const topCtx = topCanvas.getContext("2d");
  if (topUsersChart) topUsersChart.destroy();
  topUsersChart = new Chart(topCtx, {
    type: "bar",
    data: {
      labels: top5.map((u) => u.full_name),
      datasets: [
        {
          data: top5.map((u) => Math.round(u.totalCost)),
          backgroundColor: goldSolid,
          borderRadius: 4,
          maxBarThickness: 16,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: gridColor },
          ticks: { color: textColor, font: { family: "Cairo", size: 10 } },
        },
        y: {
          grid: { display: false },
          ticks: { color: textColor, font: { family: "Cairo", size: 11 } },
        },
      },
    },
  });

  const rangeLabelEl = document.getElementById("chart-daily-range");
  if (rangeLabelEl) {
    rangeLabelEl.textContent = sortedDays.length
      ? `${dayLabels[0]} — ${dayLabels[dayLabels.length - 1]}`
      : "—";
  }
}

function getSortedFilteredAggregated(aggregated) {
  let rows = aggregated;
  if (state.search.trim()) {
    const q = state.search.trim().toLowerCase();
    rows = rows.filter(
      (r) =>
        (r.full_name || "").toLowerCase().includes(q) ||
        (r.phone || "").toLowerCase().includes(q)
    );
  }
  const dir = state.sortDir === "asc" ? 1 : -1;
  rows = [...rows].sort((a, b) => {
    switch (state.sortKey) {
      case "trips":
        return (a.trips - b.trips) * dir;
      case "cost":
        return (a.totalCost - b.totalCost) * dir;
      case "last":
        return (new Date(a.lastTripDate) - new Date(b.lastTripDate)) * dir;
      default:
        return 0;
    }
  });
  return rows;
}

function renderTable(aggregated) {
  const rows = getSortedFilteredAggregated(aggregated);
  const tbody = document.getElementById("table-body");
  const emptyState = document.getElementById("empty-state");
  const resultsCount = document.getElementById("results-count");
  const tableWrap = document.querySelector(".table-wrap");

  if (resultsCount) resultsCount.textContent = `${rows.length} مستخدم`;

  if (!rows.length) {
    if (tbody) tbody.innerHTML = "";
    if (emptyState) emptyState.classList.remove("hidden");
    if (tableWrap) tableWrap.style.display = "none";
    const gt = document.getElementById("grand-total");
    if (gt) gt.textContent = fmtMoney(0);
    renderPager(0);
    return;
  }

  if (emptyState) emptyState.classList.add("hidden");
  if (tableWrap) tableWrap.style.display = "";

  const totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  state.page = Math.min(state.page, totalPages);
  const start = (state.page - 1) * state.pageSize;
  const pageRows = rows.slice(start, start + state.pageSize);

  if (tbody) {
    tbody.innerHTML = pageRows
      .map(
        (r) => `
      <tr>
        <td>
          <div class="name-cell">
            <div class="avatar">${escapeHtml(initials(r.full_name))}</div>
            <div class="who"><div class="full">${escapeHtml(r.full_name)}</div></div>
          </div>
        </td>
        <td class="phone-cell">${escapeHtml(r.phone)}</td>
        <td class="num-cell">${r.trips}</td>
        <td class="cost-cell">${fmtMoney(r.totalCost)}</td>
        <td class="num-cell">${fmtMoney(r.avgCost)}</td>
        <td class="date-cell">${fmtDate(r.lastTripDate)}</td>
        <td><button class="link-btn" data-key="${escapeAttr(r.key)}">عرض التفاصيل</button></td>
      </tr>
    `
      )
      .join("");
  }

  const grandTotal = rows.reduce((s, r) => s + r.totalCost, 0);
  const gtEl = document.getElementById("grand-total");
  if (gtEl) gtEl.textContent = fmtMoney(grandTotal) + " جنيه";

  if (tbody) {
    tbody.querySelectorAll(".link-btn").forEach((btn) => {
      btn.addEventListener("click", () => openDetails(btn.dataset.key, rows));
    });
  }

  renderPager(rows.length);
  const pageInfo = document.getElementById("page-info-text");
  if (pageInfo) {
    pageInfo.textContent = `عرض ${start + 1}–${Math.min(
      start + state.pageSize,
      rows.length
    )} من ${rows.length}`;
  }
}

function renderPager(totalRows) {
  const totalPages = Math.max(1, Math.ceil(totalRows / state.pageSize));
  const pager = document.getElementById("pager");
  if (!pager) return;

  let html = `<button ${state.page === 1 ? "disabled" : ""} id="pg-prev">‹</button>`;
  const maxButtons = 5;
  let startPage = Math.max(1, state.page - 2);
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  startPage = Math.max(1, endPage - maxButtons + 1);
  for (let p = startPage; p <= endPage; p++) {
    html += `<button class="${p === state.page ? "active" : ""}" data-page="${p}">${p}</button>`;
  }
  html += `<button ${state.page === totalPages ? "disabled" : ""} id="pg-next">›</button>`;
  pager.innerHTML = html;

  pager.querySelectorAll("[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.page = parseInt(btn.dataset.page);
      renderAll();
    });
  });
  const prev = document.getElementById("pg-prev");
  const next = document.getElementById("pg-next");
  if (prev) {
    prev.addEventListener("click", () => {
      state.page = Math.max(1, state.page - 1);
      renderAll();
    });
  }
  if (next) {
    next.addEventListener("click", () => {
      state.page = Math.min(totalPages, state.page + 1);
      renderAll();
    });
  }
}

function escapeHtml(str) {
  return String(str ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function escapeAttr(str) {
  return String(str ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function openDetails(key, aggregatedRows) {
  const user = aggregatedRows.find((r) => String(r.key) === String(key));
  if (!user) return;

  const avatarEl = document.getElementById("modal-avatar");
  const nameEl = document.getElementById("modal-name");
  const phoneEl = document.getElementById("modal-phone");
  const bodyEl = document.getElementById("modal-table-body");

  if (avatarEl) avatarEl.textContent = initials(user.full_name);
  if (nameEl) nameEl.textContent = user.full_name;
  if (phoneEl) phoneEl.textContent = user.phone;

  const sortedTrips = [...user.rows].sort(
    (a, b) => new Date(b.trip_date) - new Date(a.trip_date)
  );

  if (bodyEl) {
    bodyEl.innerHTML = sortedTrips
      .map(
        (t) => `
      <tr>
        <td class="date-cell">${fmtDate(t.trip_date)}</td>
        <td>${escapeHtml(t.from_location)}</td>
        <td>${escapeHtml(t.to_location)}</td>
        <td>${escapeHtml(t.transport_type)}</td>
        <td class="cost-cell">${fmtMoney(t.cost)}</td>
        <td class="date-cell">${fmtDateTime(t.created_at)}</td>
      </tr>
    `
      )
      .join("");
  }

  const tripsTotalEl = document.getElementById("modal-total-trips");
  const costTotalEl = document.getElementById("modal-total-cost");
  if (tripsTotalEl) tripsTotalEl.textContent = user.trips;
  if (costTotalEl) costTotalEl.textContent = fmtMoney(user.totalCost);

  const overlay = document.getElementById("modal-overlay");
  if (overlay) overlay.classList.add("show");
}

function closeDetails() {
  const overlay = document.getElementById("modal-overlay");
  if (overlay) overlay.classList.remove("show");
}

function exportCSV(aggregated) {
  const rows = getSortedFilteredAggregated(aggregated);
  const header = ["الاسم", "رقم التليفون", "عدد الرحلات", "إجمالي التكلفة", "متوسط التكلفة", "آخر رحلة"];
  const lines = [header.join(",")];
  rows.forEach((r) => {
    lines.push(
      [
        `"${String(r.full_name).replace(/"/g, '""')}"`,
        r.phone,
        r.trips,
        r.totalCost.toFixed(2),
        r.avgCost.toFixed(2),
        r.lastTripDate,
      ].join(",")
    );
  });
  const csv = "\uFEFF" + lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `trips-report-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function renderAll() {
  const filtered = getFilteredTrips();
  const aggregated = aggregateByUser(filtered);
  renderSummary(filtered, aggregated);
  renderCharts(filtered, aggregated);
  renderTable(aggregated);
  window.__aggregatedCache = aggregated;
}

function bindSortHeaders() {
  document.querySelectorAll("th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = key;
        state.sortDir = "desc";
      }
      document.querySelectorAll("th.sortable").forEach((t) => t.classList.remove("sort-active"));
      th.classList.add("sort-active");
      const arrow = th.querySelector(".sort-arrow");
      if (arrow) arrow.textContent = state.sortDir === "asc" ? "▴" : "▾";
      state.page = 1;
      renderAll();
    });
  });
}

function bindFilters() {
  document.querySelectorAll("#filters-row .pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      document.querySelectorAll("#filters-row .pill").forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      state.range = pill.dataset.range;
      state.page = 1;
      renderAll();
    });
  });
  const applyBtn = document.getElementById("apply-custom");
  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      const from = document.getElementById("range-from").value;
      const to = document.getElementById("range-to").value;
      if (!from || !to) {
        showError("يرجى تحديد تاريخ البداية والنهاية");
        return;
      }
      hideError();
      state.range = "custom";
      state.customFrom = from;
      state.customTo = to;
      document.querySelectorAll("#filters-row .pill").forEach((p) => p.classList.remove("active"));
      state.page = 1;
      renderAll();
    });
  }
}

function bindSearch() {
  let debounce;
  const input = document.getElementById("search-input");
  if (!input) return;
  input.addEventListener("input", (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.search = e.target.value;
      state.page = 1;
      renderAll();
    }, 200);
  });
}

function bindModal() {
  const close1 = document.getElementById("modal-close");
  const close2 = document.getElementById("modal-close-2");
  const overlay = document.getElementById("modal-overlay");
  if (close1) close1.addEventListener("click", closeDetails);
  if (close2) close2.addEventListener("click", closeDetails);
  if (overlay) {
    overlay.addEventListener("click", (e) => {
      if (e.target.id === "modal-overlay") closeDetails();
    });
  }
}

function bindExport() {
  const btn = document.getElementById("export-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    exportCSV(window.__aggregatedCache || []);
  });
}

function bindErrorBanner() {
  const btn = document.getElementById("error-close");
  if (!btn) return;
  btn.addEventListener("click", hideError);
}

function showSkeleton() {
  const tbody = document.getElementById("table-body");
  const tableWrap = document.querySelector(".table-wrap");
  const emptyState = document.getElementById("empty-state");
  if (tableWrap) tableWrap.style.display = "";
  if (emptyState) emptyState.classList.add("hidden");
  if (!tbody) return;
  tbody.innerHTML = Array.from({ length: 6 })
    .map(
      () => `
    <tr class="skeleton-row">
      <td><div class="skel" style="width:140px"></div></td>
      <td><div class="skel" style="width:90px"></div></td>
      <td><div class="skel" style="width:40px"></div></td>
      <td><div class="skel" style="width:70px"></div></td>
      <td><div class="skel" style="width:60px"></div></td>
      <td><div class="skel" style="width:80px"></div></td>
      <td><div class="skel" style="width:70px"></div></td>
    </tr>
  `
    )
    .join("");
}

function showAppLoading() {
  const loginScreen = document.getElementById("login-screen");
  const deniedScreen = document.getElementById("denied-screen");
  const app = document.getElementById("app");
  if (loginScreen) loginScreen.style.display = "none";
  if (deniedScreen) deniedScreen.classList.add("hidden");
  if (app) app.style.display = "block";
}

async function handleLogin() {
  const emailEl = document.getElementById("login-email");
  const passwordEl = document.getElementById("login-password");
  const errorBox = document.getElementById("login-error");
  const btn = document.getElementById("login-btn");

  const email = emailEl ? emailEl.value.trim() : "";
  const password = passwordEl ? passwordEl.value.trim() : "";

  if (errorBox) errorBox.style.display = "none";
  if (!email || !password) {
    if (errorBox) {
      errorBox.textContent = "يرجى إدخال البريد الإلكتروني وكلمة المرور";
      errorBox.style.display = "block";
    }
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = "جاري الدخول...";
  }

  try {
    const user = await realLogin(email, password);
    const isAdmin = await realCheckAdmin(user.id);
    if (!isAdmin) {
      try {
        await supabaseClient.auth.signOut();
      } catch (_) {}
      const loginScreen = document.getElementById("login-screen");
      const deniedScreen = document.getElementById("denied-screen");
      if (loginScreen) loginScreen.style.display = "none";
      if (deniedScreen) deniedScreen.classList.remove("hidden");
      return;
    }
    state.isAdmin = true;
    state.adminEmail = user.email || "—";
    await bootApp();
  } catch (err) {
    if (errorBox) {
      errorBox.textContent = err.message || "حدث خطأ أثناء تسجيل الدخول";
      errorBox.style.display = "block";
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "دخول";
    }
  }
}

async function handleLogout() {
  stopRealtime();
  try {
    await supabaseClient.auth.signOut();
  } catch (_) {}
  state.isAdmin = false;
  state.trips = [];
  state.adminEmail = "";
  const app = document.getElementById("app");
  const loginScreen = document.getElementById("login-screen");
  const passwordEl = document.getElementById("login-password");
  if (app) app.style.display = "none";
  if (loginScreen) loginScreen.style.display = "flex";
  if (passwordEl) passwordEl.value = "";
}

async function bootApp() {
  showAppLoading();
  const adminEmailEl = document.getElementById("admin-email");
  if (adminEmailEl) adminEmailEl.textContent = state.adminEmail;

  showSkeleton();
  try {
    hideError();
    state.trips = await fetchTrips();
    renderAll();
    initRealtime();
  } catch (err) {
    showError(err.message || "تعذر تحميل بيانات الرحلات");
    state.trips = [];
    renderAll();
  }
}

async function checkExistingSession() {
  try {
    const { data } = await supabaseClient.auth.getSession();
    const session = data?.session;
    if (!session) return;
    const isAdmin = await realCheckAdmin(session.user.id);
    if (!isAdmin) {
      try {
        await supabaseClient.auth.signOut();
      } catch (_) {}
      return;
    }
    state.isAdmin = true;
    state.adminEmail = session.user.email || "—";
    await bootApp();
  } catch (_) {}
}

document.addEventListener("DOMContentLoaded", () => {
  if (!initSupabase()) return;

  bindSortHeaders();
  bindFilters();
  bindSearch();
  bindModal();
  bindExport();
  bindErrorBanner();

  const loginBtn = document.getElementById("login-btn");
  const passwordEl = document.getElementById("login-password");
  const logoutBtn = document.getElementById("logout-btn");
  const deniedBack = document.getElementById("denied-back");

  if (loginBtn) loginBtn.addEventListener("click", handleLogin);
  if (passwordEl) {
    passwordEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleLogin();
    });
  }
  if (logoutBtn) logoutBtn.addEventListener("click", handleLogout);
  if (deniedBack) {
    deniedBack.addEventListener("click", () => {
      const deniedScreen = document.getElementById("denied-screen");
      const loginScreen = document.getElementById("login-screen");
      if (deniedScreen) deniedScreen.classList.add("hidden");
      if (loginScreen) loginScreen.style.display = "flex";
    });
  }

  checkExistingSession();
});
