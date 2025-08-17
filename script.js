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
    addAmortBtn: document.getElementById('addAmortBtn'),
    saveBtn: document.getElementById('saveBtn'),
    loadInput: document.getElementById('loadInput'),
  };

  // State
  const state = {
    purchasePrice: 0,
    amortYears: 25,
    participants: [], // {name, percent, loanCost}
    charges: [], // {name, type: 'recurring'|'amortized', amount|total+years}
    year: new Date().getFullYear(),
    weeks: [], // {index,label,dates,who,weight,revisedPrice}
    categories: [
      { name: 'Propriétaires', factorPct: 100 },
      { name: 'Famille proche', factorPct: 100 },
      { name: 'Famille', factorPct: 125 },
      { name: 'Locataires externes', factorPct: 200 },
    ],
    people: [], // {name, categoryName}
  };

  // Charges
  function chargeAnnualValue(c){
    if (!c) return 0;
    if ((c.type||'recurring') === 'amortized'){
      const total = Math.max(0, +c.total || 0);
      const years = Math.max(1, +c.years || 1);
      return total / years;
    }
    return Math.max(0, +c.amount || 0);
  }

  function computeAnnual(){
    const price = Math.max(0, +state.purchasePrice || 0);
    const years = Math.max(1, +state.amortYears || 1);
    const amortAnnual = price / years;
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
      const prev = existingWeeks && existingWeeks[i] ? existingWeeks[i] : { who: '', weight: 100, revisedPrice: undefined };
      weeks.push({ index: i+1, label, dates, who: prev.who||'', weight: clamp(+prev.weight||100,0,1000), revisedPrice: Number.isFinite(+prev.revisedPrice)?+prev.revisedPrice:undefined });
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
      const factor = cat ? (cat.factorPct/100) : 1;
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
    const { total } = computeAnnual();
    let sumPct = 0, sumAmt = 0;
    state.participants.forEach((p, idx) => {
      const pct = clamp(+p.percent||0, 0, 100);
      const share = total * (pct/100);
      sumPct += pct; sumAmt += share;
      if (full){
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><input type="text" value="${p.name||''}" data-ptype="name" data-i="${idx}" /></td>
          <td><input type="number" min="0" max="100" step="1" value="${pct}" data-ptype="percent" data-i="${idx}" /></td>
          <td class="actions"><button class="remove-btn" data-action="remove-participant" data-i="${idx}">✕</button></td>
        `;
        els.participantsTbody.appendChild(tr);
      } else {
        const row = els.participantsTbody.rows[idx];
        if (!row) return;
        row.querySelector('input[data-ptype="name"]').value = p.name||'';
        row.querySelector('input[data-ptype="percent"]').value = pct;
      }
    });
    if (els.participantsPercentTotal) els.participantsPercentTotal.textContent = fmtPct(sumPct);
    if (els.participantsAmountTotal) els.participantsAmountTotal.textContent = fmtCurrency(sumAmt);
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
              <option value="recurring" ${c.type!=='amortized'?'selected':''}>Récurrent</option>
              <option value="amortized" ${c.type==='amortized'?'selected':''}>Amorti</option>
            </select>
          </td>
          <td><input type="number" min="0" step="50" value="${Math.max(0,+c.amount||0)}" data-ctype="amount" data-i="${idx}" /></td>
          <td><input type="number" min="0" step="50" value="${Math.max(0,+c.total||0)}" data-ctype="total" data-i="${idx}" /></td>
          <td><input type="number" min="1" step="1" value="${Math.max(1,+c.years||1)}" data-ctype="years" data-i="${idx}" /></td>
          <td class="charge-annual">${fmtCurrency(annual)}</td>
          <td class="actions"><button class="remove-btn" data-action="remove-charge" data-i="${idx}">✕</button></td>
        `;
        els.chargesTbody.appendChild(tr);
      } else {
        const row = els.chargesTbody.rows[idx];
        if (!row) return;
        const sel = row.querySelector('select[data-ctype="type"]');
        if (sel) sel.value = c.type||'recurring';
        const amountEl = row.querySelector('input[data-ctype="amount"]');
        const totalEl = row.querySelector('input[data-ctype="total"]');
        const yearsEl = row.querySelector('input[data-ctype="years"]');
        if (amountEl) amountEl.value = Math.max(0,+c.amount||0);
        if (totalEl) totalEl.value = Math.max(0,+c.total||0);
        if (yearsEl) yearsEl.value = Math.max(1,+c.years||1);
        const annualCell = row.querySelector('.charge-annual');
        if (annualCell) annualCell.textContent = fmtCurrency(annual);
      }
    });
    if (els.chargesTotal) els.chargesTotal.textContent = fmtCurrency(total);
  }

  function renderWeeks(full=false){
    if (!els.weeksTbody) return;
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
          <td><input type="number" min="0" step="5" value="${w.weight||0}" data-wtype="weight" data-i="${idx}" /></td>
          <td>
            <select data-wtype="who" data-i="${idx}">
              <option value=""></option>
              ${state.people.map(p=>`<option value="${p.name}" ${w.who===p.name?'selected':''}>${p.name}</option>`).join('')}
            </select>
          </td>
          <td class="week-suggested">${fmtCurrency(suggested)}</td>
          <td><input type="number" min="0" step="10" value="${Number.isFinite(w.revisedPrice)?w.revisedPrice:''}" data-wtype="revised" data-i="${idx}" /></td>
          <td class="week-price">${fmtCurrency(realPrice)}</td>
        `;
        els.weeksTbody.appendChild(tr);
      } else {
        const row = els.weeksTbody.rows[idx];
        if (!row) return;
        const weightEl = row.querySelector('input[data-wtype="weight"]');
        if (weightEl) weightEl.value = w.weight||0;
        const whoEl = row.querySelector('select[data-wtype="who"]');
        if (whoEl) whoEl.value = w.who||'';
        const priceCell = row.querySelector('.week-price');
        const suggCell = row.querySelector('.week-suggested');
        const revisedInput = row.querySelector('input[data-wtype="revised"]');
        if (suggCell) suggCell.textContent = fmtCurrency(suggested);
        if (revisedInput) revisedInput.value = Number.isFinite(w.revisedPrice)?w.revisedPrice:'';
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
          <td><input type="number" min="0" step="5" value="${c.factorPct||0}" data-ctype="factor" data-i="${idx}" /></td>
          <td class="actions"><button class="remove-btn" data-action="remove-category" data-i="${idx}">✕</button></td>
        `;
        els.categoriesTbody.appendChild(tr);
      } else {
        const row = els.categoriesTbody.rows[idx];
        if (!row) return;
        row.querySelector('input[data-ctype="name"]').value = c.name||'';
        row.querySelector('input[data-ctype="factor"]').value = c.factorPct||0;
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
      const pct = clamp(+p.percent||0, 0, 100);
      const share = annualTotal * (pct/100);
      const loan = Math.max(0, +p.loanCost || 0);
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
      const pct = clamp(+p.percent||0, 0, 100);
      sumPct += pct;
      const share = total * (pct/100);
      const loan = Math.max(0, +p.loanCost || 0);
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
      state.purchasePrice = Math.max(0, +e.target.value || 0);
      renderParticipants();
      renderAnnual();
      renderWeeks();
    });
    els.amortYears.addEventListener('input', (e)=>{
      state.amortYears = Math.max(1, +e.target.value || 1);
      renderAnnual();
      renderWeeks();
    });
    els.yearSelect.addEventListener('change', (e)=>{
      const yr = clamp(+e.target.value || new Date().getFullYear(), 1970, 2100);
      state.year = yr;
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
        if (t === 'percent') state.participants[i].percent = clamp(+e.target.value || 0, 0, 100);
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
      state.participants.push({ name: `P${state.participants.length+1}`, percent: 0, loanCost: 0 });
      renderParticipants(true);
      renderAnnual();
    });
    els.participantsSummaryTbody.addEventListener('input', (e)=>{
      const i = +e.target.dataset.i;
      if (Number.isInteger(i)){
        const t = e.target.dataset.ptype;
        if (t === 'loanCost') {
          state.participants[i].loanCost = Math.max(0, +e.target.value || 0);
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
        if (t === 'amount') state.charges[i].amount = Math.max(0, +e.target.value || 0);
        if (t === 'total') state.charges[i].total = Math.max(0, +e.target.value || 0);
        if (t === 'years') state.charges[i].years = Math.max(1, +e.target.value || 1);
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
        const val = e.target.value === 'amortized' ? 'amortized' : 'recurring';
        state.charges[i].type = val;
        if (val === 'recurring'){
          state.charges[i].amount = Math.max(0, +state.charges[i].amount || 0);
        } else {
          state.charges[i].total = Math.max(0, +state.charges[i].total || 0);
          state.charges[i].years = Math.max(1, +state.charges[i].years || 1);
        }
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
      state.charges.push({ name: 'Nouvelle charge', type: 'recurring', amount: 0 });
      renderCharges(true);
      renderAnnual();
      renderWeeks();
    });
    els.addAmortBtn.addEventListener('click', ()=>{
      state.charges.push({ name: 'Amortissement', type: 'amortized', total: 0, years: 5 });
      renderCharges(true);
      renderAnnual();
      renderWeeks();
    });
    els.weeksTbody.addEventListener('input', (e)=>{
      if (e.target && e.target.tagName === 'SELECT') return;
      const i = +e.target.dataset.i;
      if (Number.isInteger(i)){
        const t = e.target.dataset.wtype;
        if (t === 'weight') state.weeks[i].weight = clamp(+e.target.value || 0, 0, 1000);
        if (t === 'revised') state.weeks[i].revisedPrice = +e.target.value;
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
      state.categories.push({ name: `Catégorie ${state.categories.length+1}`, factorPct: 100 });
      renderCategories(true);
      renderWeeks(true);
      renderParticipantsSummary(computeAnnual().total);
    });
    els.categoriesTbody.addEventListener('input', (e)=>{
      const i = +e.target.dataset.i;
      if (!Number.isInteger(i)) return;
      const t = e.target.dataset.ctype;
      if (t==='name') state.categories[i].name = e.target.value;
      if (t==='factor') state.categories[i].factorPct = clamp(+e.target.value||0, 0, 1000);
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
      state.people.push({ name: `Personne ${state.people.length+1}`, categoryName: state.categories[0]?.name || '' });
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
        state.purchasePrice = Math.max(0, +obj.purchasePrice || 0);
        state.amortYears = Math.max(1, +obj.amortYears || 1);
        state.participants = Array.isArray(obj.participants) ? obj.participants.map(p=>({ name: p.name||'', percent: clamp(+p.percent||0,0,100), loanCost: Math.max(0, +p.loanCost || 0) })) : [];
        state.charges = Array.isArray(obj.charges) ? obj.charges.map(c=>({
          name: c.name||'',
          type: (c.type==='amortized') ? 'amortized' : 'recurring',
          amount: Math.max(0,+c.amount||0),
          total: Math.max(0,+c.total||0),
          years: Math.max(1,+c.years||1)
        })) : [];
        state.year = clamp(+obj.year || new Date().getFullYear(), 1970, 2100);
        const weeksInYear = buildWeeksForYear(state.year);
        if (Array.isArray(obj.weeks)){
          state.weeks = weeksInYear.map((w,i)=>{
            const src = obj.weeks[i] || {};
            return { ...w, who: (src.who||''), weight: clamp(+src.weight||w.weight,0,1000), revisedPrice: Number.isFinite(+src.revisedPrice)?+src.revisedPrice:undefined };
          });
        } else {
          state.weeks = weeksInYear;
        }
        if (Array.isArray(obj.categories)) state.categories = obj.categories.map(c=>({ name: c.name||'', factorPct: clamp(+c.factorPct||100, 0, 1000) }));
        if (Array.isArray(obj.people)) state.people = obj.people.map(pr=>({ name: pr.name||'', categoryName: pr.categoryName|| (state.categories[0]?.name||'') }));
        renderAll();
      } catch(err){
        alert('Fichier JSON invalide.');
        console.error(err);
      } finally {
        e.target.value = '';
      }
    });
  }

  // Init from defaults.json
  async function init(){
    try{
      const res = await fetch('defaults.json', { cache: 'no-store' });
      if (res.ok){
        const def = await res.json();
        state.purchasePrice = Math.max(0, +def.purchasePrice || 0);
        state.amortYears = Math.max(1, +def.amortYears || 25);
        state.participants = Array.isArray(def.participants) ? def.participants.map(p=>({ name: p.name||'', percent: clamp(+p.percent||0,0,100), loanCost: Math.max(0, +p.loanCost || 0) })) : [];
        state.charges = Array.isArray(def.charges) ? def.charges.map(c=>({
          name: c.name||'',
          type: (c.type==='amortized') ? 'amortized' : 'recurring',
          amount: Math.max(0,+c.amount||0),
          total: Math.max(0,+c.total||0),
          years: Math.max(1,+c.years||1)
        })) : [];
        state.year = new Date().getFullYear();
        const defaultWeight = def.weeksDefaults && Number.isFinite(+def.weeksDefaults.weight) ? +def.weeksDefaults.weight : 100;
        state.weeks = buildWeeksForYear(state.year).map(w=>({ ...w, weight: defaultWeight }));
        if (Array.isArray(def.categories) && def.categories.length) {
          state.categories = def.categories.map(c=>({ name: c.name||'', factorPct: clamp(+c.factorPct||100, 0, 1000) }));
        }
        if (Array.isArray(def.people)) {
          state.people = def.people.map(pr=>({ name: pr.name||'', categoryName: pr.categoryName|| (state.categories[0]?.name||'') }));
        } else {
          state.people = state.participants.map(p=>({ name: p.name||'', categoryName: 'Propriétaires' }));
        }
      } else {
        // Fallback
        state.purchasePrice = 500000;
        state.amortYears = 25;
        state.participants = [
          { name: 'P1', percent: 25, loanCost: 0 },
          { name: 'P2', percent: 25, loanCost: 0 },
          { name: 'P3', percent: 50, loanCost: 0 },
        ];
        state.charges = [
          { name: 'Eau', type: 'recurring', amount: 0 },
          { name: 'Electricité', type: 'recurring', amount: 0 },
          { name: "Taxe d'habitation", type: 'recurring', amount: 0 },
        ];
        state.year = new Date().getFullYear();
        state.weeks = buildWeeksForYear(state.year);
        state.people = state.participants.map(p=>({ name: p.name, categoryName: 'Propriétaires' }));
      }
    } catch(e){
      console.warn('defaults.json not loaded, using hardcoded defaults.', e);
      state.purchasePrice = 500000;
      state.amortYears = 25;
      state.participants = [
        { name: 'P1', percent: 25, loanCost: 0 },
        { name: 'P2', percent: 25, loanCost: 0 },
        { name: 'P3', percent: 50, loanCost: 0 },
      ];
      state.charges = [
        { name: 'Eau', type: 'recurring', amount: 0 },
        { name: 'Electricité', type: 'recurring', amount: 0 },
        { name: "Taxe d'habitation", type: 'recurring', amount: 0 },
      ];
      state.year = new Date().getFullYear();
      state.weeks = buildWeeksForYear(state.year);
      state.people = state.participants.map(p=>({ name: p.name, categoryName: 'Propriétaires' }));
    }
    renderAll();
    attachEvents();
  }

  init();
})();
