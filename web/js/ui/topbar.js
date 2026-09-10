// 頂列：資料夾 / 版型 pill、AI 辨識、批次修改設計值、產生檔案（Word / Excel）。
// 檢查日期不在這裡：每個資料夾各自一個，在表格的資料夾列上填。

import { esc, showDialog, alertDialog, confirmDialog, toast } from './dialog.js';
import { runRecognize, engineLabel } from './recognize.js';
import { loadPdfFont } from '../pdf-font.js';
import { DEFAULT_FONT } from '../template/spec.js';
import { FORMATS, defaultFormat } from '../docx-model.js';

export function mountTopbar(container, app) {
  container.className = 'topbar';

  function render() {
    const { root, readOnly, template, recognizing } = app.state;
    const eng = engineLabel(app.state);
    const busy = recognizing ? 'disabled' : '';
    container.innerHTML = `
      <div class="brand" data-act="home" title="回首頁"><span>自懂填</span> Auto-Fit</div>
      <span class="pill" title="${esc(root?.name ?? '')}">🗀 資料夾 ${esc(root?.name ?? '')}${readOnly ? '（唯讀複本）' : ''}</span>
      <span class="pill" title="${esc(template?.name ?? '')}">📄 版型 ${template ? esc(template.name) : '預設（每頁 3 列 × 2 張）'}</span>
      ${eng ? `<span class="pill engine" title="${esc(eng.title)}">🤖 ${esc(eng.text)}</span>` : ''}
      <span class="spacer"></span>
      <button class="btn" data-act="recognize" title="選辨識方式與提示詞，讓 AI 填三欄" ${busy}>🤖 AI 辨識</button>
      <button class="btn" data-act="batch" ${busy}>批次修改設計值</button>
      <button class="btn btn-primary" data-act="export" ${busy}>產生 ${defaultFormat(template?.spec) === 'xlsx' ? 'Excel' : 'Word'} 檔</button>`;
  }

  container.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'home') {
      const ok = await confirmDialog('回首頁', '校對結果已暫存在瀏覽器裡，下次開同一個資料夾會接回來。要回首頁嗎？');
      if (ok) app.goHome();
    } else if (act === 'recognize') {
      await runRecognize(app);
    } else if (act === 'batch') {
      await batchDesign(app);
    } else if (act === 'export') {
      await exportFiles(app);
    }
  });

  const unsubscribe = app.subscribe((what) => {
    if (what === 'page' || what === 'engine' || what === 'date' || what === 'recognize-progress') render();
    if (what === 'recognize-failed') {
      const f = app.state.lastFailed || [];
      const first = f[0]?.error ?? '';
      toast(`${f.length} 張辨識失敗：${first}${f.length > 1 ? '（其餘見各張的狀態說明）' : ''}`, { error: true, ms: 12000 });
    }
  });
  render();
  if (app.state.lastOpen?.redo) {
    toast(`換了辨識引擎：${app.state.lastOpen.redo} 張先前未確認的 AI 結果會重新辨識`, { ms: 6000 });
    app.state.lastOpen = null;
  }
  return unsubscribe;
}

async function batchDesign(app) {
  const visibleN = app.visiblePhotos().length;
  const dirName = app.state.dirFilter == null ? '（未選資料夾）' : app.dirOf(app.state.dirFilter)?.name;
  let scope;
  let value;
  const ok = await showDialog({
    title: '批次修改設計值',
    body: `
      <div class="opt"><label>套用範圍
        <select id="scope">
          <option value="visible">目前篩選出的 ${visibleN} 列</option>
          <option value="dir" ${app.state.dirFilter == null ? 'disabled' : ''}>目前選取的資料夾 ${esc(dirName)}</option>
          <option value="all">全部 ${app.state.photos.length} 張</option>
        </select></label></div>
      <div class="opt"><label>設計值<input type="text" id="val" placeholder="例如 700mm±10"></label></div>`,
    buttons: [
      { label: '取消', value: false },
      { label: '套用', value: true, primary: true },
    ],
    onOpen: (d) => d.querySelector('#val').focus(),
    beforeClose: (v, d) => {
      scope = d.querySelector('#scope').value;
      value = d.querySelector('#val').value.trim();
      if (v === true && !value) {
        toast('請輸入設計值', { error: true });
        return false;
      }
      return true;
    },
  });
  if (ok !== true) return;
  const n = app.batchDesign(value, scope);
  toast(`已把 ${n} 張的設計值改成「${value}」`);
}

async function exportFiles(app) {
  const plan = app.exportPlan();
  if (!plan.groups.length) {
    await alertDialog('無法產生', '沒有可輸出的照片（內容說明都是空的）。');
    return;
  }
  const list = plan.groups.map((g) => `<li>${esc(g.folderName)}：${g.photos.length} 張</li>`).join('');
  const trashed = plan.trashed?.length ? `<p class="muted">回收桶（_回收桶）裡的 ${plan.trashed.length} 張不輸出。</p>` : '';
  const warn = plan.warnings.length ? `<p style="color:var(--yellow-text)">${plan.warnings.map(esc).join('<br>')}</p>` : '';
  const rootName = app.state.root?.name ?? 'Auto-Fit';
  const family = app.state.template?.spec?.font ?? DEFAULT_FONT;
  // 版型是從哪種檔案讀來的就預設產哪一種；兩種用的是同一份版型，隨時可以改
  let format = defaultFormat(app.state.template?.spec);
  const formatRadios = Object.entries(FORMATS)
    .map(
      ([k, label]) =>
        `<label class="fmt"><input type="radio" name="fmt" value="${k}" ${k === format ? 'checked' : ''}> ${esc(label)}</label>`,
    )
    .join('');

  // 打勾時就先去要字型：queryLocalFonts() 要在使用者的點擊事件裡呼叫才跳得出授權，
  // 等按下「產生」才要就已經不是使用者手勢了。拿不到字型直接把勾取消並說明原因。
  let pdfFont = null;
  let wantPdf = false;
  const go = await showDialog({
    title: '產生檔案',
    body: `<div class="opt">格式：${formatRadios}</div>
      <p>每個資料夾各產生一份，存在該資料夾${app.state.readOnly ? '（唯讀模式改為下載）' : ''}，檔名「該資料夾的檢查日期 + 資料夾名」加副檔名。</p><ul>${list}</ul>${trashed}${warn}
      <div class="opt"><label><input type="checkbox" id="pdf"> 同時產出 PDF（把上面全部接成一份「${esc(rootName)}.pdf」放根資料夾）</label></div>
      <div class="small muted" id="pdf-note" hidden></div>`,
    buttons: [
      { label: '取消', value: false },
      { label: '產生', value: true, primary: true },
    ],
    onOpen: (d) => {
      const box = d.querySelector('#pdf');
      const note = d.querySelector('#pdf-note');
      const say = (text, bad = false) => {
        note.hidden = !text;
        note.textContent = text;
        note.style.color = bad ? 'var(--red-text)' : '';
      };
      box.addEventListener('change', async () => {
        if (!box.checked) {
          say('');
          return;
        }
        say('正在取得中文字型…');
        box.disabled = true;
        try {
          pdfFont = await loadPdfFont(family);
          say(pdfFont.source === 'local' ? `字型：${pdfFont.label}（這台電腦）` : `字型：${pdfFont.label}（內建備用）— ${pdfFont.notes.join('；')}`);
        } catch (e) {
          pdfFont = null;
          box.checked = false;
          say(`拿不到中文字型，PDF 無法產生：${e.message}`, true);
        } finally {
          box.disabled = false;
        }
      });
    },
    beforeClose: (v, d) => {
      format = d.querySelector('input[name="fmt"]:checked')?.value ?? format;
      wantPdf = d.querySelector('#pdf').checked;
      if (v === true && wantPdf && !pdfFont) {
        toast('中文字型還沒準備好', { error: true });
        return false;
      }
      return true;
    },
  });
  if (go !== true) return;

  let progressEl;
  const done = showDialog({
    title: '產生中…',
    body: '<div id="pg">準備中</div><div class="progress-bar"><div style="width:0"></div></div>',
    buttons: [],
    onOpen: (d) => (progressEl = d),
  });
  const closeProgress = () => done.close();
  try {
    const { results, skipped, pdf } = await app.exportWord({
      format,
      pdf: wantPdf && pdfFont ? { fontBytes: pdfFont.bytes } : null,
      onProgress: ({ group, groups, i, n, folder, phase }) => {
        if (!progressEl) return;
        const what = phase === 'pdf' ? 'PDF ' : '';  // 'word' 這個階段名兩種格式共用
        progressEl.querySelector('#pg').textContent = `${what}資料夾 ${folder}（${group}/${groups}）：照片 ${i}/${n}`;
        progressEl.querySelector('.progress-bar > div').style.width = `${Math.round((i / n) * 100)}%`;
      },
    });
    closeProgress();
    const lines = results.map(
      (r) =>
        `<li>${esc(r.file)}（${r.count} 張）${r.failures.length ? `<br><span style="color:var(--red-text)">${r.failures.map(esc).join('<br>')}</span>` : ''}</li>`,
    );
    if (pdf) {
      const bad = [...pdf.failures, ...pdf.warnings];
      lines.push(
        `<li>${esc(pdf.file)}（合併 ${pdf.pages} 頁）${bad.length ? `<br><span style="color:var(--red-text)">${bad.map(esc).join('<br>')}</span>` : ''}</li>`,
      );
    }
    const skip = skipped.length ? `<p class="muted">略過（內容說明為空）：${skipped.map((p) => esc(p.name)).join('、')}</p>` : '';
    await alertDialog('完成', `<ul>${lines.join('')}</ul>${skip}`);
  } catch (err) {
    closeProgress();
    console.error(err);
    await alertDialog('產生失敗', `<pre style="white-space:pre-wrap">${esc(err.message)}</pre>`);
  }
}
