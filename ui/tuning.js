const sections = [
  ['basic', '模型与资源'], ['sampling', '采样'], ['draft', '草稿与学习'], ['advanced', '高级引擎'],
];
const labels = {
  context:'上下文（tokens）', kv:'KV 精度', kvResident:'GPU KV 驻留（tokens）', port:'模型 API 端口',
  expertGiB:'专家 RAM 预算（GiB）', headroomGiB:'系统 RAM 留白（GiB）', vramMiB:'显存预留（MiB）',
  workers:'CPU 工作线程', output:'总输出上限（tokens）', thinking:'思考上限（tokens）', effort:'思考强度',
  visionThreads:'视觉 CPU 线程', imageTokens:'图像 token 上限', drafting:'草稿器', spec:'MTP 草稿长度',
  specMinP:'MTP 最低概率', temperature:'温度', top_p:'Top-p', top_k:'Top-k', min_p:'Min-p',
  repetition_penalty:'重复惩罚', presence_penalty:'存在惩罚', frequency_penalty:'频率惩罚',
  penalty_last_n:'惩罚回看（tokens）', seed:'固定 Seed（留空为随机）', pack:'DFlash2 草稿包',
  window:'手动窗口', confidence:'置信阈值', enabled:'保存专家路由学习', reuse:'复用已保存的路由表',
  scope:'用途分类', saveEveryMinutes:'保存间隔（分钟）', 'sampling.mode':'模式', 'draftOptions.mode':'DFlash2 模式',
};
const choiceLabels = {
  default:'继承（不覆盖）', model:'跟随模型', custom:'自定义', auto:'自动', manual:'手动',
  off:'关闭', on:'开启', stock:'标准', tuned:'调优', general:'通用', video:'视频', coding:'编程',
  mtp:'MTP', dflash2:'DFlash2', low:'低', medium:'中', high:'高',
};
const element = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const button = (cls, label) => {
  const b = element('button', cls, label);
  b.type = 'button';
  return b;
};

export function openTuning(profile, api) {
  const endpoint = '/api/tuning?id='+encodeURIComponent(profile.id);
  const dialog = element('dialog','tune');
  dialog.setAttribute('aria-labelledby','tune-title');
  const head = element('header','tune-head');
  const title = element('h2',null,profile.id+' · 参数');
  title.id = 'tune-title';
  const heading = element('div');
  heading.append(title,element('p',null,'下次启动配置 · 当前模型不变'));
  const close = button('ghost','关闭');
  head.append(heading,close);
  const nav = element('nav','tune-nav');
  nav.setAttribute('aria-label','参数分类');
  const body = element('div','tune-body');
  const footer = element('footer','tune-footer');
  const status = element('p');
  status.setAttribute('role','status');
  status.setAttribute('aria-live','polite');
  const actions = element('div','row');
  const save = button('tune-save','保存参数');
  const reload = button('ghost','重新读取');
  actions.append(save,reload);
  footer.append(status,actions);
  dialog.append(head,nav,body,footer);
  document.body.append(dialog);

  let data, running = false, active = 'basic';
  let fields = [], controls = {};
  let customSeeded = false;
  const tabs = new Map(), pages = new Map();

  function select(key) {
    active = key;
    for (const [id, tab] of tabs) {
      tab.setAttribute('aria-pressed',String(id === key));
      pages.get(id).hidden = id !== key;
    }
    body.scrollTop = 0;
  }
  function message(text, error = false) {
    status.textContent = text;
    status.classList.toggle('err',error);
  }
  function settingsSamplingDefaults() {
    const think = controls.settings.effort.value !== 'off' && controls.settings.thinking.valueAsNumber !== 0;
    return think ? data.samplingDefaults.thinking : data.samplingDefaults.withoutThinking;
  }
  function read(field) {
    const c = field.control;
    if (c.type === 'checkbox') return c.checked;
    if (c.type === 'number') return c.value === '' && field.nullable && !c.validity.badInput ? null : c.valueAsNumber;
    return c.value;
  }
  function edits() {
    const changes = {};
    const seedCustom = data?.values.sampling.mode === 'model' && controls.sampling?.mode.value === 'custom';
    for (const field of fields) {
      const value = read(field);
      const changed = !field.control.disabled && (value !== field.initial || seedCustom && field.section === 'sampling');
      field.row.toggleAttribute('data-changed',changed);
      if (changed) (changes[field.section] ??= {})[field.key] = value;
    }
    return changes;
  }
  function busy(value) {
    running = value;
    reload.disabled = value;
    close.disabled = value;
    body.inert = value;
    save.disabled = value || Object.keys(edits()).length === 0;
  }
  function field(parent, section, key, titleText = labels[section+'.'+key] ?? labels[key], info = '') {
    const spec = data.specs[section][key];
    const nullable = Array.isArray(spec.type) && spec.type.includes('null');
    const row = element('div','tune-field');
    const label = element('label');
    const control = element(spec.enum ? 'select' : 'input');
    const id = 'tune-'+section+'-'+key;
    control.id = id;
    control.name = section+'.'+key;
    label.htmlFor = id;
    label.append(element('strong', null, titleText));
    const value = data.values[section][key] ?? (section === 'sampling' ? settingsSamplingDefaults()[key] : undefined);
    if (spec.enum) {
      for (const option of spec.enum) {
        const opt = element('option',null,choiceLabels[option] ?? option);
        opt.value = option;
        control.append(opt);
      }
      control.value = value;
    } else if (spec.type === 'boolean') {
      control.type = 'checkbox';
      control.checked = value;
    } else {
      control.type = 'number';
      control.min = spec.minimum;
      control.max = spec.maximum;
      control.step = [spec.type].flat().includes('integer') ? '1' : 'any';
      control.required = !nullable;
      control.value = value ?? '';
    }
    row.append(label,control);
    if (info) {
      const hint = element('div','tune-hint',info);
      hint.id = id+'-hint';
      control.setAttribute('aria-describedby',hint.id);
      row.append(hint);
    }
    parent.append(row);
    (controls[section] ??= {})[key] = control;
    fields.push({row,section,key,control,nullable,initial:value ?? null,page:parent.closest('[data-page]').dataset.page});
    return control;
  }
  function group(page,titleText,section,keys) {
    const grid = element('div','tune-group');
    grid.append(element('h3',null,titleText));
    page.append(grid);
    for (const key of keys) field(grid,section,key);
  }
  function refresh({seed = false} = {}) {
    const custom = controls.sampling.mode.value === 'custom';
    const dflash = controls.settings.drafting.value === 'dflash2';
    const manual = controls.draftOptions.mode.value === 'manual';
    if (seed && custom && !customSeeded && data.values.sampling.mode === 'model') {
      for (const [key,value] of Object.entries(settingsSamplingDefaults())) controls.sampling[key].value = value ?? '';
      customSeeded = true;
    }
    for (const key of Object.keys(controls.sampling)) if (key !== 'mode') controls.sampling[key].disabled = !custom;
    for (const key of ['spec','specMinP']) controls.settings[key].disabled = dflash;
    for (const [key,control] of Object.entries(controls.draftOptions)) {
      control.disabled = !dflash || (['window','confidence'].includes(key) && !manual);
    }
    for (const key of ['reuse','scope','saveEveryMinutes']) controls.learning[key].disabled = !controls.learning.enabled.checked;
    const changes = edits();
    save.disabled = running || Object.keys(changes).length === 0;
    const count = Object.values(changes).reduce((n,section)=>n+Object.keys(section).length,0);
    message(count ? count+' 项未保存' : '没有未保存的修改');
  }
  function render() {
    fields = [];
    controls = {};
    customSeeded = false;
    tabs.clear(); pages.clear();
    nav.replaceChildren();
    body.replaceChildren();
    for (const [id,titleText] of sections) {
      const tab = button(null,titleText);
      tab.onclick = ()=>select(id);
      const page = element('div');
      page.dataset.page = id;
      nav.append(tab); body.append(page);
      tabs.set(id,tab); pages.set(id,page);
    }
    const basic = pages.get('basic');
    group(basic,'上下文与连接','settings',['context','kv','kvResident','port']);
    group(basic,'内存与显存','settings',['expertGiB','headroomGiB','vramMiB','workers']);
    group(basic,'生成与思考','settings',['output','thinking','effort']);
    if (data.vision) group(basic,'视觉','settings',['visionThreads','imageTokens']);
    const sampling = pages.get('sampling');
    const samplingFields = Object.keys(data.specs.sampling).filter(key=>key!=='mode');
    group(sampling,'采样模式','sampling',['mode',...samplingFields]);
    const draft = pages.get('draft');
    group(draft,'草稿器 / MTP','settings',['drafting','spec','specMinP']);
    group(draft,'DFlash2','draftOptions',['mode','pack','window','confidence']);
    group(draft,'路由学习','learning',['enabled','reuse','scope','saveEveryMinutes']);
    const advanced = pages.get('advanced');
    advanced.classList.add('tune-engine');
    const search = element('input','tune-engine-search');
    search.type = 'search'; search.placeholder = '筛选参数名、环境变量或分类';
    search.setAttribute('aria-label','筛选高级参数');
    advanced.append(search);
    const empty = element('p','tune-hint','没有匹配的参数。');
    advanced.append(empty);
    const rows = [];
    for (const spec of data.engineOptions) {
      const technical = spec.env ?? spec.flag;
      const inherited = data.inherited[spec.key];
      const control = field(advanced,'engineOptions',spec.key,spec.label,
        [spec.group,technical,spec.risk,spec.hint,'继承来源：'+inherited].join(' · '));
      rows.push([control.closest('.tune-field'),[spec.key,spec.label,technical,spec.group].join(' ').toLowerCase()]);
    }
    function filter() {
      const term = search.value.trim().toLowerCase();
      for (const [row,text] of rows) row.hidden = !text.includes(term);
      empty.hidden = rows.some(([row])=>!row.hidden);
    }
    search.addEventListener('input',filter);
    filter();
    select(active);
    refresh();
  }
  function mayDiscard() {
    return !Object.keys(edits()).length || window.confirm('放弃本次未保存修改？');
  }
  async function load() {
    busy(true);
    message('正在读取参数…');
    try {
      data = await api('GET',endpoint);
      render();
    } catch (error) {
      message('读取失败：'+error.message,true);
    } finally { busy(false); }
  }
  body.addEventListener('input',event=>{
    if (event.target.type !== 'search') refresh({seed: event.target === controls.sampling?.mode});
  });
  close.onclick = ()=>{ if (!running && mayDiscard()) dialog.close(); };
  reload.onclick = ()=>{ if (!running && mayDiscard()) load(); };
  dialog.addEventListener('cancel',event=>{ if (running || !mayDiscard()) event.preventDefault(); });
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  save.onclick = async ()=>{
    if (running || !data) return;
    const changes = edits();
    const invalid = fields.find(field=>!field.control.disabled && !field.control.validity.valid);
    if (invalid) {
      select(invalid.page);
      if (invalid.row.hidden) {
        const search = pages.get('advanced').querySelector('input[type="search"]');
        search.value = '';
        search.dispatchEvent(new Event('input'));
      }
      invalid.control.reportValidity();
      return;
    }
    if (!Object.keys(changes).length) return;
    busy(true);
    message('正在校验并保存…');
    try {
      await api('POST',endpoint,{revision:data.revision,changes});
      // A separate reload failure is not a failed write; do not submit the old revision again.
      try { data = await api('GET',endpoint); render(); }
      catch { data = undefined; nav.replaceChildren(); body.replaceChildren(); fields = []; }
      message(data ? '已保存，仅在下次启动时生效。' : '已保存。读取最新配置失败，请重新读取。');
    } catch (error) { message('保存失败：'+error.message,true); }
    finally { busy(false); }
  };
  dialog.showModal();
  load();
}
