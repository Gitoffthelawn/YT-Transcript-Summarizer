import { connect } from './cdp.mjs';

const c = await connect(9333);
const targets = (await c.targets()).filter(t => t.type === 'page' && t.url.includes('gemini.google.com'));
console.log('tab Gemini aperte:', targets.length);

const fn = function () {
  const el = document.querySelector('div.ql-editor[contenteditable="true"]') || document.querySelector('div[contenteditable="true"]');
  const blocks = el ? [...el.children].map(n => n.innerText || '').filter(t => t.length) : [];
  const joined = blocks.join('\n');
  const userTurns = document.querySelectorAll('user-query').length;
  const modelTurns = document.querySelectorAll('model-response').length;
  // Which "parte i di n" did each submitted turn carry?
  const parts = [...document.querySelectorAll('user-query')].map(q => {
    const m = /parte (\d+) di (\d+)/i.exec(q.innerText || '');
    return m ? `${m[1]}/${m[2]}` : (/riassunto complessivo|UN UNICO/i.test(q.innerText || '') ? 'MERGE' : '?');
  });
  const busy = !!document.querySelector('button[aria-label*="Stop" i], button[aria-label*="Interrompi" i]');
  return { userTurns, modelTurns, turnsSeen: parts, composerLen: joined.length, composerHead: joined.slice(0, 90), busy };
};

for (const t of targets) {
  const s = await c.attach(t.targetId);
  await c.send('Runtime.enable', {}, s);
  try {
    const r = await c.send('Runtime.evaluate', { expression: `(${fn.toString()})()`, returnByValue: true }, s);
    console.log('\n--- ' + t.targetId.slice(0, 8) + ' ---');
    console.log(JSON.stringify(r.result.value, null, 1));
  } catch (e) {
    console.log('\n--- ' + t.targetId.slice(0, 8) + ' --- ERRORE:', e.message);
  }
}
c.close();
