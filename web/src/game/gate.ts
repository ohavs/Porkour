import { hasAccess, useCode } from '../net/access';
import { IC } from './icons';
import { ui } from './uiIcons';
import { t } from '../i18n';

/**
 * Early access gate (net/access.ts), before anything loads. A tester's link (`?code=…`) opens it by itself and the code
 * is wiped from the address bar (so a copied room link doesn't hand it on); after that the browser remembers it.
 * Otherwise: a wood card with a lock, one field and a ✓ — nothing else of the game shows.
 */
export async function gate(): Promise<void> {
  try {
    const u = new URL(location.href);
    const q = u.searchParams.get('code');
    if (q !== null) {
      await useCode(q);
      u.searchParams.delete('code'); history.replaceState(null, '', u.toString());
    }
  } catch { /* */ }
  if (await hasAccess()) return;
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.id = 'gate'; el.className = 'overlay show';
    el.innerHTML = `<div class="panel txt"><div class="glock">${IC.lock}</div><h2>${t('ea.title')}</h2>
      <div class="lrow"><input class="tin" id="gCode" maxlength="20" placeholder="XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" title="${t('ea.code')}" aria-label="${t('ea.code')}">
      <button class="chip big" id="gGo" title="${t('ea.code')}">${ui('check', 28)}</button></div>
      <div class="gerr" id="gErr"></div></div>`;
    document.body.appendChild(el);
    const input = el.querySelector('#gCode') as HTMLInputElement, err = el.querySelector('#gErr') as HTMLElement;
    const card = el.querySelector('.panel') as HTMLElement;
    const go = async () => {
      if (await useCode(input.value)) { el.remove(); resolve(); return; }
      err.textContent = t('ea.wrong');
      card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
      input.select();
    };
    el.querySelector('#gGo')!.addEventListener('click', go);
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') go(); });
    input.addEventListener('input', () => (err.textContent = ''));
    setTimeout(() => input.focus(), 50);
  });
}
