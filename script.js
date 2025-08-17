/*
  Simulateur coût maison (SPA locale)
  - Achat: prix + amortissement (années)
  - Participants: parts % et coût d'emprunt
  - Charges: récurrentes et amorties (total/années)
  - Coût annuel = amortissement annuel + total charges
  - Répartition hebdomadaire ISO réelle (52/53)
  - Prix par semaine: suggéré (catégorie incluse) et révisé; réel = révisé ou suggéré
  - Si des prix révisés existent, ils réduisent le budget restant et les suggérés des semaines non révisées sont mis à l'échelle pour s'ajuster
*/

(function(){
  // Helpers
  function clamp(v, min, max){
    v = Number.isFinite(+v) ? +v : min;
    return Math.min(max, Math.max(min, v));
  }
  function showDefaultsError(msg){
    const box = document.getElementById('defaultsError');
    if (!box) return;
    box.textContent = msg;
    box.style.display = 'block';
  }
  function fmtCurrency(v){
    const n = Number.isFinite(+v) ? +v : 0;
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
  }
  function fmtPct(v){
    const n = Number.isFinite(+v) ? +v : 0;
    return `${n}%`;
  }

  // DOM
  const els = {
    purchasePrice: document.getElementById('purchasePrice'),
    amortYears: document.getElementById('amortYears'),
    participantsTbody: document.getElementById('participantsTbody'),
    participantsPercentTotal: document.getElementById('participantsPercentTotal'),
    participantsAmountTotal: document.getElementById('participantsAmountTotal'),
    participantsWarning: document.getElementById('participantsWarning'),
    chargesTbody: document.getElementById('chargesTbody'),
    chargesTotal: document.getElementById('chargesTotal'),
    amortAnnual: document.getElementById('amortAnnual'),
    chargesAnnual: document.getElementById('chargesAnnual'),
    annualTotal: document.getElementById('annualTotal'),
    participantsSummaryTbody: document.getElementById('participantsSummaryTbody'),
    summaryPercentTotal: document.getElementById('summaryPercentTotal'),
    summaryShareTotal: document.getElementById('summaryShareTotal'),
    summaryLoanTotal: document.getElementById('summaryLoanTotal'),
    weeksTbody: document.getElementById('weeksTbody'),
    usedWeeks: document.getElementById('usedWeeks'),
    sumWeights: document.getElementById('sumWeights'),
    baseWeekPrice: document.getElementById('baseWeekPrice'),
    sumWeeksPrices: document.getElementById('sumWeeksPrices'),
    yearSelect: document.getElementById('yearSelect'),
    categoriesTbody: document.getElementById('categoriesTbody'),
    peopleTbody: document.getElementById('peopleTbody'),
    addCategoryBtn: document.getElementById('addCategoryBtn'),
    addPersonBtn: document.getElementById('addPersonBtn'),
    addParticipantBtn: document.getElementById('addParticipantBtn'),
    addChargeBtn: document.getElementById('addChargeBtn'),
  // addAmortBtn removed per request
    saveBtn: document.getElementById('saveBtn'),
    loadInput: document.getElementById('loadInput'),
  // Config management UI
  configSelect: document.getElementById('configSelect'),
  newConfigBtn: document.getElementById('newConfigBtn'),
  saveConfigBtn: document.getElementById('saveConfigBtn'),
  copyConfigBtn: document.getElementById('copyConfigBtn'),
  deleteConfigBtn: document.getElementById('deleteConfigBtn'),
  importLocalToDriveBtn: document.getElementById('importLocalToDriveBtn'),
  // OneDrive UI
  oneDriveConnectBtn: document.getElementById('oneDriveConnectBtn'),
  oneDriveDisconnectBtn: document.getElementById('oneDriveDisconnectBtn'),
  oneDriveStatus: document.getElementById('oneDriveStatus'),
  };

  // State
  const state = {
    purchasePrice: undefined,
    amortYears: undefined,
    participants: [], // {name, percent, loanCost}
    charges: [], // {name, type: 'recurring'|'amortized', amount|total+years}
    year: undefined,
    weeks: [], // {index,label,dates,who,weight,revisedPrice}
    categories: [],
    people: [], // {name, categoryName}
  };

  // Config storage (localStorage)
  const CONFIGS_KEY = 'houseSim.configs.v1';
  const CURRENT_KEY = 'houseSim.currentName.v1';
  let currentConfigName = null;
  let currentSource = 'local'; // 'local' | 'drive'
  let defaultTemplateState = null; // snapshot of defaults.json-loaded state
  let remoteAPI = null; // generic remote API (now Google Drive)
  let gdriveCfg = { clientId: null, apiKey: null, folderName: 'SimulateurMaison', discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'], scope: 'https://www.googleapis.com/auth/drive.file' };

  function getAllConfigs(){
    try{ return JSON.parse(localStorage.getItem(CONFIGS_KEY)||'{}') || {}; }catch{return {}};
  }
  function setAllConfigs(obj){
    localStorage.setItem(CONFIGS_KEY, JSON.stringify(obj));
  }
  function setCurrentName(name){
    currentConfigName = name || null;
    if (name) localStorage.setItem(CURRENT_KEY, name); else localStorage.removeItem(CURRENT_KEY);
  }
  function loadCurrentName(){
    const v = localStorage.getItem(CURRENT_KEY);
    currentConfigName = v || null;
  }
  function updateConfigSelect(){
    if (!els.configSelect) return;
  const all = getAllConfigs();
  const names = Object.keys(all).sort((a,b)=>a.localeCompare(b,'fr'));
  els.configSelect.innerHTML = names.map(n=>`<option value="local::${n}" ${n===currentConfigName?'selected':''}>${n} (local)</option>`).join('');
  }
  function getDefaultTemplate(){
    const all = getAllConfigs();
    return defaultTemplateState || all['Défaut'] || cloneState();
  }
  function promptName(defaultVal=''){
    // Using window.prompt for simplicity
    // eslint-disable-next-line no-alert
    return window.prompt('Nom de la configuration', defaultVal || '');
  }
  function cloneState(){
    return JSON.parse(JSON.stringify(state));
  }
  function applyObjectToState(obj){
    // Adapted from the JSON import logic
    state.purchasePrice = Number.isFinite(+obj.purchasePrice) ? Math.max(0, +obj.purchasePrice) : undefined;
    state.amortYears = Number.isFinite(+obj.amortYears) && +obj.amortYears>0 ? +obj.amortYears : undefined;
    state.participants = Array.isArray(obj.participants) ? obj.participants.map(p=>({ name: p.name||'', percent: Number.isFinite(+p.percent)? clamp(+p.percent,0,100): undefined, loanCost: Number.isFinite(+p.loanCost)? Math.max(0, +p.loanCost) : undefined })) : [];
    state.charges = Array.isArray(obj.charges) ? obj.charges.map(c=>({
      name: c.name||'',
      type: (c.type==='amortized' || c.type==='recurring') ? c.type : undefined,
      amount: Number.isFinite(+c.amount)? Math.max(0,+c.amount): undefined,
      total: Number.isFinite(+c.total)? Math.max(0,+c.total): undefined,
      years: Number.isFinite(+c.years) && +c.years>0 ? +c.years : undefined
    })) : [];
    state.year = Number.isFinite(+obj.year) ? clamp(+obj.year, 1970, 2100) : undefined;
    if (Number.isFinite(state.year)){
      const weeksInYear = buildWeeksForYear(state.year);
      if (Array.isArray(obj.weeks)){
        state.weeks = weeksInYear.map((w,i)=>{
          const src = obj.weeks[i] || {};
          return { ...w, who: (src.who||''), weight: Number.isFinite(+src.weight)? clamp(+src.weight,0,1000): undefined, revisedPrice: Number.isFinite(+src.revisedPrice)?+src.revisedPrice:undefined };
        });
      } else {
        state.weeks = weeksInYear;
      }
    } else {
      state.weeks = [];
    }
    if (Array.isArray(obj.categories)) state.categories = obj.categories.map(c=>({ name: c.name||'', factorPct: Number.isFinite(+c.factorPct)? clamp(+c.factorPct, 0, 1000) : undefined }));
    if (Array.isArray(obj.people)) state.people = obj.people.map(pr=>({ name: pr.name||'', categoryName: pr.categoryName|| '' }));
    renderAll();
  }

  // Charges
  function chargeAnnualValue(c){
    if (!c) return 0;
    if (c.type === 'amortized'){
      const total = Number.isFinite(+c.total) ? Math.max(0, +c.total) : 0;
      const years = Number.isFinite(+c.years) && +c.years > 0 ? +c.years : 0;
      return years > 0 ? (total / years) : 0;
    }
    if (c.type === 'recurring'){
      return Number.isFinite(+c.amount) ? Math.max(0, +c.amount) : 0;
    }
    return 0;
  }

  function computeAnnual(){
    const price = Number.isFinite(+state.purchasePrice) ? Math.max(0, +state.purchasePrice) : 0;
    const yearsVal = Number.isFinite(+state.amortYears) ? +state.amortYears : 0;
    const amortAnnual = (price > 0 && yearsVal > 0) ? (price / yearsVal) : 0;
    const chargesAnnual = state.charges.reduce((s,c)=> s + chargeAnnualValue(c), 0);
    const total = amortAnnual + chargesAnnual;
    return { amortAnnual, chargesAnnual, total };
  }

  // ISO weeks
  function getISOWeek1(year){
    const d = new Date(Date.UTC(year, 0, 4));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() - (day - 1));
    return d; // Monday of ISO week 1
  }
  function getISOWeeksCount(year){
    const week1Next = getISOWeek1(year + 1);
    const week1This = getISOWeek1(year);
    const diffDays = Math.round((week1Next - week1This) / (24*3600*1000));
    return diffDays / 7; // 52 or 53
  }
  function buildWeeksForYear(year, existingWeeks){
    const count = getISOWeeksCount(year);
    const start = getISOWeek1(year);
    const weeks = [];
    for (let i=0;i<count;i++){
      const monday = new Date(start.getTime() + i*7*24*3600*1000);
      const sunday = new Date(monday.getTime() + 6*24*3600*1000);
      const label = `S${String(i+1).padStart(2,'0')}`;
      const dates = `${monday.getUTCDate().toString().padStart(2,'0')}/${(monday.getUTCMonth()+1).toString().padStart(2,'0')} – ${sunday.getUTCDate().toString().padStart(2,'0')}/${(sunday.getUTCMonth()+1).toString().padStart(2,'0')}`;
      const prev = existingWeeks && existingWeeks[i] ? existingWeeks[i] : { who: '', weight: 0, revisedPrice: undefined };
      weeks.push({ index: i+1, label, dates, who: prev.who||'', weight: Number.isFinite(+prev.weight)? clamp(+prev.weight,0,1000) : 0, revisedPrice: Number.isFinite(+prev.revisedPrice)?+prev.revisedPrice:undefined });
    }
    return weeks;
  }

  // Common week pricing computation
  function computeWeeksPricing(){
    const { total } = computeAnnual();
    const used = state.weeks.filter(w => (w.who||'').trim() !== '');
    const n = used.length;
    const sumWeights = used.reduce((s, w) => s + (Number.isFinite(+w.weight) ? Math.max(0, +w.weight) : 0), 0);
    const base = (n === 0) ? 0 : (sumWeights > 0 ? (total / (sumWeights/100)) : (total / n));

    const suggestedPreByIndex = state.weeks.map((w)=>{
      const usedWeek = (w.who||'').trim() !== '';
      if (!usedWeek) return 0;
      const weight = clamp(+w.weight || 0, 0, 1000);
  const person = state.people.find(p=>p.name===w.who);
  const cat = person ? state.categories.find(c=>c.name===person.categoryName) : null;
  const factor = (cat && Number.isFinite(+cat.factorPct)) ? (+cat.factorPct/100) : 1;
      const basePrice = (sumWeights > 0) ? base * (weight/100) : (total/(n||1));
      return basePrice * factor;
    });
    const revisedByIndex = state.weeks.map((w)=>{
      const usedWeek = (w.who||'').trim() !== '';
      if (!usedWeek) return null;
      const val = +w.revisedPrice;
      return (Number.isFinite(val) && val > 0) ? val : null;
    });
    let sumRevised = 0; let sumSuggestedNon = 0;
    suggestedPreByIndex.forEach((s,i)=>{
      if ((state.weeks[i].who||'').trim()==='') return;
      if (revisedByIndex[i]!=null) sumRevised += revisedByIndex[i]; else sumSuggestedNon += s;
    });
    const targetForNon = Math.max(0, total - sumRevised);
    const scale = (sumSuggestedNon > 0) ? (targetForNon / sumSuggestedNon) : 0;
    const suggestedByIndex = state.weeks.map((_, i)=>{
      if ((state.weeks[i].who||'').trim()==='') return 0;
      if (revisedByIndex[i]!=null) return suggestedPreByIndex[i];
      return suggestedPreByIndex[i] * scale;
    });
    const realByIndex = state.weeks.map((_, i)=>{
      const usedWeek = (state.weeks[i].who||'').trim() !== '';
      if (!usedWeek) return 0;
      if (revisedByIndex[i] != null) return revisedByIndex[i];
      return suggestedByIndex[i];
    });
    return { total, n, sumWeights, base, suggestedPreByIndex, revisedByIndex, suggestedByIndex, realByIndex };
  }

  // Renders
  function renderPurchase(){
    if (els.purchasePrice) els.purchasePrice.value = Number.isFinite(+state.purchasePrice) ? Math.max(0, +state.purchasePrice) : '';
    if (els.amortYears) els.amortYears.value = Number.isFinite(+state.amortYears) ? Math.max(1, +state.amortYears) : '';
  }
  function renderAnnual(){
    const { amortAnnual, chargesAnnual, total } = computeAnnual();
    els.amortAnnual.textContent = fmtCurrency(amortAnnual);
    els.chargesAnnual.textContent = fmtCurrency(chargesAnnual);
    els.annualTotal.textContent = fmtCurrency(total);
    renderParticipantsSummary(total);
  }

  function renderParticipants(full=false){
    if (!els.participantsTbody) return;
    if (full) els.participantsTbody.innerHTML = '';
    const purchaseTotal = Number.isFinite(+state.purchasePrice) ? Math.max(0, +state.purchasePrice) : 0;
    let sumPct = 0, sumAmt = 0;
    state.participants.forEach((p, idx) => {
      const pct = Number.isFinite(+p.percent) ? clamp(+p.percent, 0, 100) : 0;
      const share = purchaseTotal * (pct/100);
      sumPct += pct; sumAmt += share;
      if (full){
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><input type="text" value="${p.name||''}" data-ptype="name" data-i="${idx}" /></td>
          <td><input type="number" min="0" max="100" step="1" value="${Number.isFinite(+p.percent)?pct:''}" data-ptype="percent" data-i="${idx}" /></td>
          <td class="participant-share">${fmtCurrency(share)}</td>
          <td class="actions"><button class="remove-btn" data-action="remove-participant" data-i="${idx}">✕</button></td>
        `;
        els.participantsTbody.appendChild(tr);
      } else {
        const row = els.participantsTbody.rows[idx];
        if (!row) return;
        row.querySelector('input[data-ptype="name"]').value = p.name||'';
        row.querySelector('input[data-ptype="percent"]').value = Number.isFinite(+p.percent)?pct:'';
        const shareCell = row.querySelector('.participant-share');
        if (shareCell) shareCell.textContent = fmtCurrency(share);
      }
    });
    if (els.participantsPercentTotal) els.participantsPercentTotal.textContent = fmtPct(sumPct);
    if (els.participantsAmountTotal) els.participantsAmountTotal.textContent = fmtCurrency(purchaseTotal);
    if (els.participantsWarning){
      els.participantsWarning.style.display = (sumPct === 100 ? 'none' : 'inline');
    }
  }

  function renderCharges(full=false){
    if (!els.chargesTbody) return;
    if (full) els.chargesTbody.innerHTML = '';
    let total = 0;
    state.charges.forEach((c, idx) => {
      const annual = chargeAnnualValue(c);
      total += annual;
      if (full){
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><input type="text" value="${c.name||''}" data-ctype="name" data-i="${idx}" /></td>
          <td>
            <select data-ctype="type" data-i="${idx}">
              <option value=""></option>
              <option value="recurring" ${c.type==='recurring'?'selected':''}>Récurrent</option>
              <option value="amortized" ${c.type==='amortized'?'selected':''}>Amorti</option>
            </select>
          </td>
          <td><input type="number" min="0" step="50" data-ctype="amount" data-i="${idx}" /></td>
          <td><input type="number" min="0" step="50" data-ctype="total" data-i="${idx}" /></td>
          <td><input type="number" min="1" step="1" data-ctype="years" data-i="${idx}" /></td>
          <td class="charge-annual">${fmtCurrency(annual)}</td>
          <td class="actions"><button class="remove-btn" data-action="remove-charge" data-i="${idx}">✕</button></td>
        `;
        els.chargesTbody.appendChild(tr);
        // Set disabled/enabled and visible values after append
        const row = els.chargesTbody.lastElementChild;
        const amountEl = row.querySelector('input[data-ctype="amount"]');
        const totalEl = row.querySelector('input[data-ctype="total"]');
        const yearsEl = row.querySelector('input[data-ctype="years"]');
        const isAmort = c.type === 'amortized';
        const isRecurring = c.type === 'recurring';
        if (amountEl){ amountEl.disabled = !isRecurring; amountEl.value = (isRecurring && Number.isFinite(+c.amount)) ? Math.max(0,+c.amount) : ''; }
        if (totalEl){ totalEl.disabled = !isAmort; totalEl.value = (isAmort && Number.isFinite(+c.total)) ? Math.max(0,+c.total) : ''; }
        if (yearsEl){ yearsEl.disabled = !isAmort; yearsEl.value = (isAmort && Number.isFinite(+c.years)) ? Math.max(1,+c.years) : ''; }
      } else {
        const row = els.chargesTbody.rows[idx];
        if (!row) return;
        const sel = row.querySelector('select[data-ctype="type"]');
        if (sel) sel.value = c.type || '';
        const amountEl = row.querySelector('input[data-ctype="amount"]');
        const totalEl = row.querySelector('input[data-ctype="total"]');
        const yearsEl = row.querySelector('input[data-ctype="years"]');
        const isAmort = c.type === 'amortized';
        const isRecurring = c.type === 'recurring';
        if (amountEl){ amountEl.disabled = !isRecurring; amountEl.value = (isRecurring && Number.isFinite(+c.amount)) ? Math.max(0,+c.amount) : ''; }
        if (totalEl){ totalEl.disabled = !isAmort; totalEl.value = (isAmort && Number.isFinite(+c.total)) ? Math.max(0,+c.total) : ''; }
        if (yearsEl){ yearsEl.disabled = !isAmort; yearsEl.value = (isAmort && Number.isFinite(+c.years)) ? Math.max(1,+c.years) : ''; }
        const annualCell = row.querySelector('.charge-annual');
        if (annualCell) annualCell.textContent = fmtCurrency(annual);
      }
    });
    if (els.chargesTotal) els.chargesTotal.textContent = fmtCurrency(total);
  }

  function renderWeeks(full=false){
    if (!els.weeksTbody) return;
  if (els.yearSelect) els.yearSelect.value = Number.isFinite(+state.year) ? state.year : '';
    if (full) els.weeksTbody.innerHTML = '';
  const calc = computeWeeksPricing();
  els.usedWeeks.textContent = String(calc.n);
  els.sumWeights.textContent = fmtPct(calc.sumWeights);
  els.baseWeekPrice.textContent = fmtCurrency(calc.base);

    let sumWeeks = 0;
    state.weeks.forEach((w, idx) => {
      const usedWeek = (w.who||'').trim() !== '';
      const suggested = calc.suggestedByIndex[idx]||0;
      const realPrice = calc.realByIndex[idx]||0;
      if (usedWeek) sumWeeks += realPrice;
      if (full){
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${w.label || w.index}</td>
          <td>${w.dates || ''}</td>
          <td><input type="number" min="0" step="5" value="${Number.isFinite(+w.weight)?w.weight:''}" data-wtype="weight" data-i="${idx}" /></td>
          <td>
            <select data-wtype="who" data-i="${idx}">
              <option value=""></option>
              ${state.people.map(p=>`<option value="${p.name}" ${w.who===p.name?'selected':''}>${p.name}</option>`).join('')}
            </select>
          </td>
          <td class="week-suggested">${fmtCurrency(suggested)}</td>
          <td><input type="number" min="0" step="10" value="${Number.isFinite(+w.revisedPrice)?w.revisedPrice:''}" data-wtype="revised" data-i="${idx}" /></td>
          <td class="week-price">${fmtCurrency(realPrice)}</td>
        `;
        els.weeksTbody.appendChild(tr);
      } else {
        const row = els.weeksTbody.rows[idx];
        if (!row) return;
        const weightEl = row.querySelector('input[data-wtype="weight"]');
        if (weightEl) weightEl.value = Number.isFinite(+w.weight)?w.weight:'';
        const whoEl = row.querySelector('select[data-wtype="who"]');
        if (whoEl) whoEl.value = w.who||'';
        const priceCell = row.querySelector('.week-price');
        const suggCell = row.querySelector('.week-suggested');
        const revisedInput = row.querySelector('input[data-wtype="revised"]');
        if (suggCell) suggCell.textContent = fmtCurrency(suggested);
        if (revisedInput) revisedInput.value = Number.isFinite(+w.revisedPrice)?w.revisedPrice:'';
        if (priceCell) priceCell.textContent = fmtCurrency(realPrice);
      }
    });
    els.sumWeeksPrices.textContent = fmtCurrency(sumWeeks);
  }

  function renderCategories(full=false){
    if (!els.categoriesTbody) return;
    if (full) els.categoriesTbody.innerHTML = '';
    state.categories.forEach((c, idx) => {
      if (full){
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><input type="text" value="${c.name||''}" data-ctype="name" data-i="${idx}" /></td>
          <td><input type="number" min="0" step="5" value="${Number.isFinite(+c.factorPct)?c.factorPct:''}" data-ctype="factor" data-i="${idx}" /></td>
          <td class="actions"><button class="remove-btn" data-action="remove-category" data-i="${idx}">✕</button></td>
        `;
        els.categoriesTbody.appendChild(tr);
      } else {
        const row = els.categoriesTbody.rows[idx];
        if (!row) return;
        row.querySelector('input[data-ctype="name"]').value = c.name||'';
        row.querySelector('input[data-ctype="factor"]').value = Number.isFinite(+c.factorPct)?c.factorPct:'';
      }
    });
  }

  function renderPeople(full=false){
    if (!els.peopleTbody) return;
    if (full) els.peopleTbody.innerHTML = '';
    state.people.forEach((p, idx) => {
      if (full){
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><input type="text" value="${p.name||''}" data-ptype="name" data-i="${idx}" /></td>
          <td>
            <select data-ptype="category" data-i="${idx}">
              ${state.categories.map(c=>`<option value="${c.name}" ${p.categoryName===c.name?'selected':''}>${c.name}</option>`).join('')}
            </select>
          </td>
          <td class="actions"><button class="remove-btn" data-action="remove-person" data-i="${idx}">✕</button></td>
        `;
        els.peopleTbody.appendChild(tr);
      } else {
        const row = els.peopleTbody.rows[idx];
        if (!row) return;
        row.querySelector('input[data-ptype="name"]').value = p.name||'';
        const sel = row.querySelector('select[data-ptype="category"]');
        if (sel) sel.value = p.categoryName||'';
      }
    });
  }

  function renderParticipantsSummary(annualTotal){
    const calc = computeWeeksPricing();
    const totalRents = calc.realByIndex.reduce((s,v)=>s+v,0);
    els.participantsSummaryTbody.innerHTML = '';
    let sumPct = 0, sumShare = 0, sumLoan = 0, sumSelf = 0, sumRent = 0, sumRevenue = 0, sumNet = 0;
    state.participants.forEach((p, idx) => {
  const pct = Number.isFinite(+p.percent) ? clamp(+p.percent, 0, 100) : 0;
      const share = annualTotal * (pct/100);
  const loan = Number.isFinite(+p.loanCost) ? Math.max(0, +p.loanCost) : 0;
      const selfPaid = state.weeks.reduce((s,w,wi)=> s + ((w.who===p.name) ? (calc.realByIndex[wi]||0) : 0), 0);
      const rent = totalRents * (pct/100);
      const revenue = rent - selfPaid;
      const net = (share + loan) - revenue;
      sumPct += pct; sumShare += share; sumLoan += loan; sumSelf += selfPaid; sumRent += rent; sumRevenue += revenue; sumNet += net;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${p.name||''}</td>
        <td>${pct}%</td>
        <td>${fmtCurrency(share)}</td>
        <td><input type="number" min="0" step="100" value="${loan}" data-ptype="loanCost" data-i="${idx}" /></td>
        <td class="summary-self">${fmtCurrency(selfPaid)}</td>
        <td class="summary-rent">${fmtCurrency(rent)}</td>
        <td class="summary-revenue">${fmtCurrency(revenue)}</td>
        <td class="summary-net">${fmtCurrency(net)}</td>
      `;
      els.participantsSummaryTbody.appendChild(tr);
    });
    els.summaryPercentTotal.textContent = fmtPct(sumPct);
    els.summaryShareTotal.textContent = fmtCurrency(sumShare);
    els.summaryLoanTotal.textContent = fmtCurrency(sumLoan);
    const sumSelfEl = document.getElementById('summarySelfPaidTotal');
    if (sumSelfEl) sumSelfEl.textContent = fmtCurrency(sumSelf);
    const sumRentEl = document.getElementById('summaryRentTotal');
    if (sumRentEl) sumRentEl.textContent = fmtCurrency(sumRent);
    const sumRevenueEl = document.getElementById('summaryRevenueTotal');
    if (sumRevenueEl) sumRevenueEl.textContent = fmtCurrency(sumRevenue);
    const sumNetEl = document.getElementById('summaryNetTotal');
    if (sumNetEl) sumNetEl.textContent = fmtCurrency(sumNet);
  }

  function updateParticipantsSummaryFooter(){
    const { total } = computeAnnual();
    const calc = computeWeeksPricing();
    const rents = calc.realByIndex.reduce((s,v)=>s+v,0);
    let sumPct = 0, sumShare = 0, sumLoan = 0, sumRent = 0, sumSelf = 0, sumRevenue = 0, sumNet = 0;
    state.participants.forEach((p, idx) => {
  const pct = Number.isFinite(+p.percent) ? clamp(+p.percent, 0, 100) : 0;
      sumPct += pct;
      const share = total * (pct/100);
  const loan = Number.isFinite(+p.loanCost) ? Math.max(0, +p.loanCost) : 0;
      const rent = rents * (pct/100);
      const selfPaid = state.weeks.reduce((s,w,wi)=> s + ((w.who===p.name) ? (calc.realByIndex[wi]||0) : 0), 0);
      const revenue = rent - selfPaid;
      const net = (share + loan) - revenue;
      sumShare += share; sumLoan += loan; sumRent += rent; sumSelf += selfPaid; sumRevenue += revenue; sumNet += net;
      const row = els.participantsSummaryTbody && els.participantsSummaryTbody.rows[idx];
      if (row){
        const selfCell = row.querySelector('.summary-self');
        const rentCell = row.querySelector('.summary-rent');
        const revenueCell = row.querySelector('.summary-revenue');
        const netCell = row.querySelector('.summary-net');
        if (selfCell) selfCell.textContent = fmtCurrency(selfPaid);
        if (rentCell) rentCell.textContent = fmtCurrency(rent);
        if (revenueCell) revenueCell.textContent = fmtCurrency(revenue);
        if (netCell) netCell.textContent = fmtCurrency(net);
      }
    });
    els.summaryPercentTotal.textContent = fmtPct(sumPct);
    els.summaryShareTotal.textContent = fmtCurrency(sumShare);
    els.summaryLoanTotal.textContent = fmtCurrency(sumLoan);
    const sumSelfEl = document.getElementById('summarySelfPaidTotal');
    if (sumSelfEl) sumSelfEl.textContent = fmtCurrency(sumSelf);
    const sumRentEl = document.getElementById('summaryRentTotal');
    if (sumRentEl) sumRentEl.textContent = fmtCurrency(sumRent);
    const sumRevenueEl = document.getElementById('summaryRevenueTotal');
    if (sumRevenueEl) sumRevenueEl.textContent = fmtCurrency(sumRevenue);
    const sumNetEl = document.getElementById('summaryNetTotal');
    if (sumNetEl) sumNetEl.textContent = fmtCurrency(sumNet);
  }

  function renderAll(){
  renderPurchase();
    renderParticipants(true);
    renderCharges(true);
    renderAnnual();
    renderCategories(true);
    renderPeople(true);
    renderWeeks(true);
  }

  // Events
  function attachEvents(){
    els.purchasePrice.addEventListener('input', (e)=>{
      state.purchasePrice = (e.target.value==='') ? undefined : Math.max(0, +e.target.value || 0);
      renderParticipants();
      renderAnnual();
      renderWeeks();
    });
    els.amortYears.addEventListener('input', (e)=>{
      state.amortYears = (e.target.value==='') ? undefined : Math.max(1, +e.target.value || 1);
      renderAnnual();
      renderWeeks();
    });
    els.yearSelect.addEventListener('change', (e)=>{
      const raw = +e.target.value;
      if (!Number.isFinite(raw) || raw < 1970 || raw > 2100){
        state.year = undefined;
        state.weeks = [];
        renderWeeks(true);
        renderParticipantsSummary(computeAnnual().total);
        return;
      }
      state.year = raw;
      const oldWeeks = state.weeks;
      state.weeks = buildWeeksForYear(state.year, oldWeeks);
      renderWeeks(true);
      renderParticipantsSummary(computeAnnual().total);
    });
  els.participantsTbody.addEventListener('input', (e)=>{
      const i = +e.target.dataset.i;
      if (Number.isInteger(i)){
        const t = e.target.dataset.ptype;
        if (t === 'name') state.participants[i].name = e.target.value;
    if (t === 'percent') state.participants[i].percent = (e.target.value==='') ? undefined : clamp(+e.target.value || 0, 0, 100);
        renderParticipants();
        renderAnnual();
      }
    });
    els.participantsTbody.addEventListener('click', (e)=>{
      const btn = e.target.closest('button[data-action="remove-participant"]');
      if (btn){
        const i = +btn.dataset.i;
        const removedName = state.participants[i]?.name;
        state.participants.splice(i, 1);
        if (removedName) {
          state.people = state.people.filter(p => p.name !== removedName);
          state.weeks.forEach(w => { if (w.who === removedName) w.who = ''; });
        }
        renderParticipants(true);
        renderAnnual();
        renderPeople(true);
        renderWeeks(true);
      }
    });
    els.addParticipantBtn.addEventListener('click', ()=>{
      state.participants.push({ name: '', percent: undefined, loanCost: undefined });
      renderParticipants(true);
      renderAnnual();
    });
    els.participantsSummaryTbody.addEventListener('input', (e)=>{
      const i = +e.target.dataset.i;
      if (Number.isInteger(i)){
        const t = e.target.dataset.ptype;
        if (t === 'loanCost') {
          state.participants[i].loanCost = (e.target.value==='') ? undefined : Math.max(0, +e.target.value || 0);
          updateParticipantsSummaryFooter();
        }
      }
    });
    els.chargesTbody.addEventListener('input', (e)=>{
      if (e.target && e.target.tagName === 'SELECT') return;
      const i = +e.target.dataset.i;
      if (Number.isInteger(i)){
        const t = e.target.dataset.ctype;
        if (t === 'name') state.charges[i].name = e.target.value;
        if (t === 'amount') state.charges[i].amount = (e.target.value==='') ? undefined : Math.max(0, +e.target.value || 0);
        if (t === 'total') state.charges[i].total = (e.target.value==='') ? undefined : Math.max(0, +e.target.value || 0);
        if (t === 'years') state.charges[i].years = (e.target.value==='') ? undefined : Math.max(1, +e.target.value || 1);
        renderCharges();
        renderAnnual();
        renderWeeks();
      }
    });
    els.chargesTbody.addEventListener('change', (e)=>{
      const i = +e.target.dataset.i;
      if (!Number.isInteger(i)) return;
      const t = e.target.dataset.ctype;
      if (t === 'type'){
        const val = (e.target.value === 'amortized' || e.target.value === 'recurring') ? e.target.value : undefined;
        state.charges[i].type = val;
        renderCharges();
        renderAnnual();
        renderWeeks();
      }
    });
    els.chargesTbody.addEventListener('click', (e)=>{
      const btn = e.target.closest('button[data-action="remove-charge"]');
      if (btn){
        const i = +btn.dataset.i;
        state.charges.splice(i, 1);
        renderCharges(true);
        renderAnnual();
        renderWeeks();
      }
    });
    els.addChargeBtn.addEventListener('click', ()=>{
      state.charges.push({});
      renderCharges(true);
      renderAnnual();
      renderWeeks();
    });
  // removed the dedicated amortization add button; use the type dropdown instead
    els.weeksTbody.addEventListener('input', (e)=>{
      if (e.target && e.target.tagName === 'SELECT') return;
      const i = +e.target.dataset.i;
      if (Number.isInteger(i)){
        const t = e.target.dataset.wtype;
        if (t === 'weight') state.weeks[i].weight = (e.target.value==='') ? undefined : clamp(+e.target.value || 0, 0, 1000);
        if (t === 'revised') state.weeks[i].revisedPrice = (e.target.value==='') ? undefined : +e.target.value;
        renderWeeks();
        renderParticipantsSummary(computeAnnual().total);
      }
    });
    els.weeksTbody.addEventListener('change', (e)=>{
      const i = +e.target.dataset.i;
      if (Number.isInteger(i)){
        const t = e.target.dataset.wtype;
        if (t === 'who'){
          state.weeks[i].who = e.target.value;
          renderWeeks();
          renderParticipantsSummary(computeAnnual().total);
        }
      }
    });
    els.addCategoryBtn.addEventListener('click', ()=>{
      const newCatName = `Catégorie ${state.categories.length+1}`;
      state.categories.push({ name: newCatName, factorPct: 100 });
      // Add a default person tied to this new category
      state.people.push({ name: `${newCatName} (défaut)`, categoryName: newCatName });
      renderCategories(true);
      renderPeople(true);
      renderWeeks(true);
      renderParticipantsSummary(computeAnnual().total);
    });
    els.categoriesTbody.addEventListener('input', (e)=>{
      const i = +e.target.dataset.i;
      if (!Number.isInteger(i)) return;
      const t = e.target.dataset.ctype;
      if (t==='name') state.categories[i].name = e.target.value;
  if (t==='factor') state.categories[i].factorPct = (e.target.value==='') ? undefined : clamp(+e.target.value||0, 0, 1000);
      renderCategories();
      renderWeeks();
      renderParticipantsSummary(computeAnnual().total);
    });
    els.categoriesTbody.addEventListener('click', (e)=>{
      const btn = e.target.closest('button[data-action="remove-category"]');
      if (!btn) return;
      const i = +btn.dataset.i;
      const removed = state.categories[i];
      state.categories.splice(i,1);
      const fallback = state.categories[0]?.name || '';
      state.people.forEach(p=>{ if (p.categoryName===removed?.name) p.categoryName = fallback; });
      renderCategories(true);
      renderPeople(true);
      renderWeeks(true);
      renderParticipantsSummary(computeAnnual().total);
    });
    els.addPersonBtn.addEventListener('click', ()=>{
      state.people.push({ name: '', categoryName: '' });
      renderPeople(true);
      renderWeeks(true);
      renderParticipantsSummary(computeAnnual().total);
    });
    els.peopleTbody.addEventListener('input', (e)=>{
      if (e.target && e.target.tagName === 'SELECT') return;
      const i = +e.target.dataset.i;
      if (!Number.isInteger(i)) return;
      const t = e.target.dataset.ptype;
      if (t==='name') state.people[i].name = e.target.value;
      renderPeople();
      renderWeeks();
      renderParticipantsSummary(computeAnnual().total);
    });
    els.peopleTbody.addEventListener('change', (e)=>{
      const i = +e.target.dataset.i;
      if (!Number.isInteger(i)) return;
      const t = e.target.dataset.ptype;
      if (t==='category') state.people[i].categoryName = e.target.value;
      renderPeople();
      renderWeeks();
      renderParticipantsSummary(computeAnnual().total);
    });
    els.peopleTbody.addEventListener('click', (e)=>{
      const btn = e.target.closest('button[data-action="remove-person"]');
      if (!btn) return;
      const i = +btn.dataset.i;
      const removedName = state.people[i]?.name;
      state.people.splice(i,1);
      state.weeks.forEach(w=>{ if (w.who===removedName) w.who=''; });
      renderPeople(true);
      renderWeeks(true);
      renderParticipantsSummary(computeAnnual().total);
    });
    els.saveBtn.addEventListener('click', ()=>{
      const data = JSON.stringify(state, null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const date = new Date().toISOString().slice(0,10);
      a.download = `simulation-maison-${date}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
    els.loadInput.addEventListener('change', async (e)=>{
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const obj = JSON.parse(text);
        state.purchasePrice = Number.isFinite(+obj.purchasePrice) ? Math.max(0, +obj.purchasePrice) : undefined;
        state.amortYears = Number.isFinite(+obj.amortYears) && +obj.amortYears>0 ? +obj.amortYears : undefined;
        state.participants = Array.isArray(obj.participants) ? obj.participants.map(p=>({ name: p.name||'', percent: Number.isFinite(+p.percent)? clamp(+p.percent,0,100): undefined, loanCost: Number.isFinite(+p.loanCost)? Math.max(0, +p.loanCost) : undefined })) : [];
        state.charges = Array.isArray(obj.charges) ? obj.charges.map(c=>({
          name: c.name||'',
          type: (c.type==='amortized' || c.type==='recurring') ? c.type : undefined,
          amount: Number.isFinite(+c.amount)? Math.max(0,+c.amount): undefined,
          total: Number.isFinite(+c.total)? Math.max(0,+c.total): undefined,
          years: Number.isFinite(+c.years) && +c.years>0 ? +c.years : undefined
        })) : [];
        state.year = Number.isFinite(+obj.year) ? clamp(+obj.year, 1970, 2100) : undefined;
        if (Number.isFinite(state.year)){
          const weeksInYear = buildWeeksForYear(state.year);
          if (Array.isArray(obj.weeks)){
            state.weeks = weeksInYear.map((w,i)=>{
              const src = obj.weeks[i] || {};
              return { ...w, who: (src.who||''), weight: Number.isFinite(+src.weight)? clamp(+src.weight,0,1000): undefined, revisedPrice: Number.isFinite(+src.revisedPrice)?+src.revisedPrice:undefined };
            });
          } else {
            state.weeks = weeksInYear;
          }
        } else {
          state.weeks = [];
        }
        if (Array.isArray(obj.categories)) state.categories = obj.categories.map(c=>({ name: c.name||'', factorPct: Number.isFinite(+c.factorPct)? clamp(+c.factorPct, 0, 1000) : undefined }));
        if (Array.isArray(obj.people)) state.people = obj.people.map(pr=>({ name: pr.name||'', categoryName: pr.categoryName|| '' }));
        renderAll();
      } catch(err){
        alert('Fichier JSON invalide.');
        console.error(err);
      } finally {
        e.target.value = '';
      }
    });

    // Config management events (localStorage mode only)
    if (!remoteAPI){
      if (els.newConfigBtn) els.newConfigBtn.addEventListener('click', ()=>{
        const name = promptName('Nouvelle config');
        if (!name) return;
        const all = getAllConfigs();
        if (all[name]){
          if (!confirm('Ce nom existe déjà. Écraser ?')) return;
        }
        // Create from default template
        all[name] = JSON.parse(JSON.stringify(getDefaultTemplate()));
        setAllConfigs(all);
        setCurrentName(name);
        updateConfigSelect();
        applyObjectToState(all[name]);
      });

      if (els.saveConfigBtn) els.saveConfigBtn.addEventListener('click', ()=>{
        let name = currentConfigName;
        if (!name){
          name = promptName('Nom de la config');
          if (!name) return;
        }
        const all = getAllConfigs();
        all[name] = cloneState();
        setAllConfigs(all);
        setCurrentName(name);
        updateConfigSelect();
        alert('Configuration sauvegardée.');
      });

      if (els.copyConfigBtn) els.copyConfigBtn.addEventListener('click', ()=>{
        const name = promptName('Nom de la copie');
        if (!name) return;
        const all = getAllConfigs();
        if (all[name]){
          if (!confirm('Ce nom existe déjà. Écraser ?')) return;
        }
        all[name] = cloneState();
        setAllConfigs(all);
        setCurrentName(name);
        updateConfigSelect();
        alert('Copie enregistrée.');
      });

      if (els.deleteConfigBtn) els.deleteConfigBtn.addEventListener('click', ()=>{
        if (!currentConfigName){ alert('Aucune configuration sélectionnée.'); return; }
        if (currentConfigName === 'Défaut'){ alert('La configuration "Défaut" ne peut pas être supprimée.'); return; }
        if (!confirm(`Supprimer la configuration "${currentConfigName}" ?`)) return;
        const all = getAllConfigs();
        delete all[currentConfigName];
        setAllConfigs(all);
        setCurrentName(null);
        updateConfigSelect();
        // Garder l'état actuel affiché, ou recharger défauts au choix. On garde tel quel.
      });

      if (els.configSelect) els.configSelect.addEventListener('change', ()=>{
        let selected = els.configSelect.value;
        if (!selected) return;
        if (selected.startsWith('local::')) selected = selected.slice('local::'.length);
        const all = getAllConfigs();
        const obj = all[selected];
        if (!obj) return;
        setCurrentName(selected);
        currentSource = 'local';
        applyObjectToState(obj);
      });
    }
  }

  // Init from defaults.json
  async function init(){
    try{
      const res = await fetch('defaults.json', { cache: 'no-store' });
      if (res.ok){
        const def = await res.json();
        if ('purchasePrice' in def) state.purchasePrice = Number.isFinite(+def.purchasePrice)? Math.max(0, +def.purchasePrice) : undefined;
        if ('amortYears' in def) state.amortYears = (Number.isFinite(+def.amortYears) && +def.amortYears>0) ? +def.amortYears : undefined;
        if (Array.isArray(def.participants)) state.participants = def.participants.map(p=>({ name: p.name||'', percent: Number.isFinite(+p.percent)? clamp(+p.percent,0,100): undefined, loanCost: Number.isFinite(+p.loanCost)? Math.max(0, +p.loanCost) : undefined }));
        if (Array.isArray(def.charges)) state.charges = def.charges.map(c=>({
          name: c.name||'',
          type: (c.type==='amortized' || c.type==='recurring') ? c.type : undefined,
          amount: Number.isFinite(+c.amount)? Math.max(0,+c.amount): undefined,
          total: Number.isFinite(+c.total)? Math.max(0,+c.total): undefined,
          years: Number.isFinite(+c.years) && +c.years>0 ? +c.years : undefined
        }));
        if ('year' in def && Number.isFinite(+def.year)) state.year = +def.year;
        if (Array.isArray(def.categories)) state.categories = def.categories.map(c=>({ name: c.name||'', factorPct: Number.isFinite(+c.factorPct)? clamp(+c.factorPct, 0, 1000) : undefined }));
        if (Array.isArray(def.people)) state.people = def.people.map(pr=>({ name: pr.name||'', categoryName: pr.categoryName|| '' }));
        if (Number.isFinite(state.year)){
          const w = buildWeeksForYear(state.year);
          const defaultWeight = (def.weeksDefaults && Number.isFinite(+def.weeksDefaults.weight)) ? +def.weeksDefaults.weight : undefined;
          state.weeks = w.map(week=> ({ ...week, weight: Number.isFinite(defaultWeight) ? defaultWeight : week.weight }));
        }
        // Capture defaults template after applying defaults.json
        defaultTemplateState = cloneState();
      } else {
        const hint = (location && location.protocol === 'file:')
          ? "defaults.json n'a pas pu être chargé (ouvert en file://). Lancez la page via un petit serveur local (ex: VS Code Live Server) pour autoriser l'accès au fichier."
          : "defaults.json n'a pas pu être chargé (réponse réseau non OK).";
        showDefaultsError(hint);
      }
    } catch(e){
      console.warn('defaults.json load failed:', e);
      const hint = (location && location.protocol === 'file:')
        ? "defaults.json n'a pas pu être chargé (ouvert en file://). Lancez la page via un petit serveur local (ex: VS Code Live Server) pour autoriser l'accès au fichier."
        : "defaults.json n'a pas pu être chargé (erreur).";
      showDefaultsError(hint);
    }
    // Load config list and current selection; ensure 'Défaut' exists
    loadCurrentName();
    const allAtStart = getAllConfigs();
    if (!allAtStart['Défaut']){
      allAtStart['Défaut'] = defaultTemplateState ? JSON.parse(JSON.stringify(defaultTemplateState)) : cloneState();
      setAllConfigs(allAtStart);
      if (!currentConfigName) setCurrentName('Défaut');
    }
    // Remove server persistence entirely (as requested) and load Google Drive config if present
    try{
      const r = await fetch('gdrive.config.json', { cache: 'no-store' });
      if (r.ok){
        const cfg = await r.json();
        if (cfg.clientId) gdriveCfg.clientId = cfg.clientId;
        if (cfg.apiKey) gdriveCfg.apiKey = cfg.apiKey;
        if (cfg.folderName) gdriveCfg.folderName = cfg.folderName;
        if (cfg.scope) gdriveCfg.scope = cfg.scope;
      }
    } catch {}
    updateConfigSelect();
    if (currentConfigName){
      const all = getAllConfigs();
      const obj = all[currentConfigName];
      if (obj) applyObjectToState(obj);
    }
    renderAll();
    attachEvents();
  setupGoogleDriveUI();
  }

  init();

  // ============ Google Drive Integration (optional) ============
  function setGDriveStatus(text, show=true){
    if (!els.googleDriveStatus) return;
    els.googleDriveStatus.textContent = text || '';
    els.googleDriveStatus.style.display = show && text ? 'inline' : 'none';
  }
  function toggleGDriveButtons(connected){
    if (els.googleDriveConnectBtn) els.googleDriveConnectBtn.style.display = connected ? 'none' : '';
    if (els.googleDriveDisconnectBtn) els.googleDriveDisconnectBtn.style.display = connected ? '' : 'none';
  }
  function replaceNode(node){
    if (!node || !node.parentNode) return node;
    const clone = node.cloneNode(true);
    node.parentNode.replaceChild(clone, node);
    return clone;
  }
  function switchToRemoteHandlers(api, initialCache){
    remoteAPI = api;
    // Remove previous listeners by replacing nodes
    els.newConfigBtn = replaceNode(els.newConfigBtn);
    els.saveConfigBtn = replaceNode(els.saveConfigBtn);
    els.copyConfigBtn = replaceNode(els.copyConfigBtn);
    els.deleteConfigBtn = replaceNode(els.deleteConfigBtn);
    els.configSelect = replaceNode(els.configSelect);

    const serverCache = initialCache || {};
    async function refreshServerCache(){
      const all = await remoteAPI.list();
      // Replace content of serverCache
      for (const k of Object.keys(serverCache)) delete serverCache[k];
      Object.assign(serverCache, all || {});
      updateConfigSelect();
    }
    // Override selector renderer to use remote cache
    updateConfigSelect = function(){
      if (!els.configSelect) return;
      const local = getAllConfigs();
      const localNames = Object.keys(local).sort((a,b)=>a.localeCompare(b,'fr'));
      const driveNames = Object.keys(serverCache).sort((a,b)=>a.localeCompare(b,'fr'));
      const opts = [
        ...localNames.map(n=>`<option value="local::${n}" ${currentConfigName===n&&currentSource==='local'?'selected':''}>${n} (local)</option>`),
        ...driveNames.map(n=>`<option value="drive::${n}" ${currentConfigName===n&&currentSource==='drive'?'selected':''}>${n} (drive)</option>`)
      ];
      els.configSelect.innerHTML = opts.join('');
      if (els.importLocalToDriveBtn) els.importLocalToDriveBtn.style.display = '';
    };

    // Wire events to remote
    els.newConfigBtn.onclick = async ()=>{
      const name = promptName('Nouvelle config');
      if (!name) return;
      const tpl = getDefaultTemplate();
      await remoteAPI.save(name, tpl);
      await refreshServerCache();
      setCurrentName(name);
      currentSource = 'drive';
      applyObjectToState(tpl);
    };
    els.saveConfigBtn.onclick = async ()=>{
      let name = currentConfigName;
      if (!name){ name = promptName('Nom de la config'); if (!name) return; }
      await remoteAPI.save(name, cloneState());
      await refreshServerCache();
      setCurrentName(name);
      currentSource = 'drive';
      alert('Configuration sauvegardée.');
    };
    els.copyConfigBtn.onclick = async ()=>{
      const name = promptName('Nom de la copie');
      if (!name) return;
      await remoteAPI.save(name, cloneState());
      await refreshServerCache();
      setCurrentName(name);
      currentSource = 'drive';
      alert('Copie enregistrée.');
    };
    els.deleteConfigBtn.onclick = async ()=>{
      if (!currentConfigName){ alert('Aucune configuration sélectionnée.'); return; }
      if (currentConfigName === 'Défaut'){ alert('La configuration "Défaut" ne peut pas être supprimée.'); return; }
      if (!confirm(`Supprimer la configuration "${currentConfigName}" ?`)) return;
      await remoteAPI.remove(currentConfigName);
      await refreshServerCache();
      setCurrentName('Défaut');
      currentSource = 'drive';
      const obj = await remoteAPI.get('Défaut');
      if (obj) applyObjectToState(obj);
    };
    if (els.importLocalToDriveBtn){
      els.importLocalToDriveBtn.onclick = async ()=>{
        const local = getAllConfigs();
        const names = Object.keys(local).sort((a,b)=>a.localeCompare(b,'fr'));
        const choice = promptName(`Nom local à copier vers Drive (disponibles: ${names.join(', ')})`);
        if (!choice) return;
        if (!local[choice]){ alert('Nom local introuvable.'); return; }
        await remoteAPI.save(choice, local[choice]);
        await refreshServerCache();
        setCurrentName(choice);
        currentSource = 'drive';
        alert('Copié sur Drive.');
      };
    }
    els.configSelect.onchange = async ()=>{
      const selected = els.configSelect.value;
      if (!selected) return;
      const [src, name] = selected.split('::');
      if (src === 'local'){
        const all = getAllConfigs();
        const obj = all[name];
        if (!obj) return;
        setCurrentName(name);
        currentSource = 'local';
        applyObjectToState(obj);
      } else if (src === 'drive'){
        const obj = await remoteAPI.get(name);
        if (!obj) return;
        setCurrentName(name);
        currentSource = 'drive';
        applyObjectToState(obj);
      }
    };

    // Initial cache
  (async ()=>{
      if (!initialCache || Object.keys(initialCache).length === 0){
        await refreshServerCache();
      } else {
        updateConfigSelect();
      }
    })();
  }

  function setupGoogleDriveUI(){
    if (!els.googleDriveConnectBtn || !els.googleDriveDisconnectBtn || !els.googleDriveStatus) return;
    if (!gdriveCfg.clientId || !gdriveCfg.apiKey){
      setGDriveStatus('Google Drive non configuré.');
    }
    toggleGDriveButtons(false);

    els.googleDriveConnectBtn.addEventListener('click', async ()=>{
      try{
        if (!gdriveCfg.clientId || !gdriveCfg.apiKey){
          alert('Google Drive n\'est pas configuré. Renseignez gdrive.config.json (clientId, apiKey).');
          return;
        }
        setGDriveStatus('Connexion à Google…');
        await loadGapi();
        const gapi = window.gapi;
        await new Promise((resolve, reject)=>{
          gapi.load('client:auth2', async ()=>{
            try {
              await gapi.client.init({ apiKey: gdriveCfg.apiKey, clientId: gdriveCfg.clientId, discoveryDocs: gdriveCfg.discoveryDocs, scope: gdriveCfg.scope });
              const auth = gapi.auth2.getAuthInstance();
              if (!auth.isSignedIn.get()){
                await auth.signIn();
              }
              resolve();
            } catch (e){ reject(e); }
          });
        });
  setGDriveStatus('Connecté à Google Drive');
  toggleGDriveButtons(true);
  currentSource = 'drive';

        async function ensureFolder(){
          const name = gdriveCfg.folderName || 'SimulateurMaison';
          // Find folder
          const q = `name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false`;
          let resp = await gapi.client.drive.files.list({ q, fields: 'files(id,name)' });
          if (resp.result.files && resp.result.files[0]) return resp.result.files[0].id;
          // Create folder
          resp = await gapi.client.drive.files.create({ resource: { name, mimeType: 'application/vnd.google-apps.folder', parents: ['root'] }, fields: 'id' });
          return resp.result.id;
        }
        async function list(){
          const folderId = await ensureFolder();
          const resp = await gapi.client.drive.files.list({ q: `'${folderId}' in parents and mimeType = 'application/json' and trashed = false`, fields: 'files(id,name)' });
          const out = {};
          for (const f of (resp.result.files||[])){
            const name = f.name.replace(/\.json$/i,'');
            out[name] = { __placeholder: true };
          }
          if (Object.keys(out).length === 0){
            await save('Défaut', getDefaultTemplate());
            return { 'Défaut': getDefaultTemplate() };
          }
          return out;
        }
        async function get(name){
          const folderId = await ensureFolder();
          const filename = `${name}.json`;
          const resp = await gapi.client.drive.files.list({ q: `'${folderId}' in parents and name = '${filename.replace(/'/g, "\\'")}' and trashed = false`, fields: 'files(id,name)' });
          const file = (resp.result.files||[])[0];
          if (!file) return null;
          const download = await gapi.client.drive.files.get({ fileId: file.id, alt: 'media' });
          try{ return JSON.parse(download.body); } catch { return null; }
        }
        async function save(name, obj){
          const folderId = await ensureFolder();
          const filename = `${name}.json`;
          // Check if exists
          const resp = await gapi.client.drive.files.list({ q: `'${folderId}' in parents and name = '${filename.replace(/'/g, "\\'")}' and trashed = false`, fields: 'files(id,name)' });
          const file = (resp.result.files||[])[0];
          const metadata = { name: filename, mimeType: 'application/json', parents: [folderId] };
          const boundary = '-------314159265358979323846';
          const delimiter = `\r\n--${boundary}\r\n`;
          const closeDelim = `\r\n--${boundary}--`;
          const multipartBody =
            delimiter + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
            JSON.stringify(metadata) +
            delimiter + 'Content-Type: application/json\r\n\r\n' +
            JSON.stringify(obj) +
            closeDelim;
          if (file){
            await gapi.client.request({ path: `/upload/drive/v3/files/${file.id}`, method: 'PATCH', params: { uploadType: 'multipart' }, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipartBody });
          } else {
            await gapi.client.request({ path: '/upload/drive/v3/files', method: 'POST', params: { uploadType: 'multipart' }, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipartBody });
          }
        }
        async function remove(name){
          const folderId = await ensureFolder();
          const filename = `${name}.json`;
          const resp = await gapi.client.drive.files.list({ q: `'${folderId}' in parents and name = '${filename.replace(/'/g, "\\'")}' and trashed = false`, fields: 'files(id,name)' });
          const file = (resp.result.files||[])[0];
          if (file){ await gapi.client.drive.files.delete({ fileId: file.id }); }
        }
        const gdAPI = { list, get, save, remove };
        const initial = await gdAPI.list();
        switchToRemoteHandlers(gdAPI, initial);
      } catch (err){
        console.error(err);
        alert('Connexion Google Drive échouée.');
        setGDriveStatus('Erreur de connexion');
        toggleGDriveButtons(false);
      }
    });

    els.googleDriveDisconnectBtn.addEventListener('click', async ()=>{
      setGDriveStatus('Déconnexion…');
      try{
        const gapi = window.gapi || (await loadGapi());
        const auth = gapi.auth2 && gapi.auth2.getAuthInstance && gapi.auth2.getAuthInstance();
        if (auth) await auth.signOut();
      } catch {}
      location.reload();
    });
  }

  async function loadGapi(){
    if (window.gapi && window.gapi.client) return window.gapi;
    await new Promise((resolve, reject)=>{
      const s = document.createElement('script');
      s.src = 'https://apis.google.com/js/api.js';
      s.async = true;
      s.onload = resolve;
      s.onerror = ()=>reject(new Error('GAPI load failed'));
      document.head.appendChild(s);
    });
    return window.gapi;
  }
})();
